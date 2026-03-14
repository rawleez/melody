// Client-side state — populated after a successful /upload response
let sessionId = null;
let resumeData = null;

// --- DOM refs ---
const resumeInput   = document.getElementById('resume-input');
const dropZone      = document.getElementById('drop-zone');
const dropLabel     = document.getElementById('drop-label');
const fileNameEl    = document.getElementById('file-name');
const uploadBtn     = document.getElementById('upload-btn');
const uploadError   = document.getElementById('upload-error');
const uploadSection = document.getElementById('upload-section');
const ctaSection    = document.getElementById('cta-section');
const resumeSummary = document.getElementById('resume-summary');
const meetMelodyBtn = document.getElementById('meet-melody-btn');

// --- File selection ---
resumeInput.addEventListener('change', () => {
  const file = resumeInput.files[0];
  if (!file) return;
  showFileName(file.name);
  uploadBtn.disabled = false;
});

// Drag-and-drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  // Validate type client-side before sending
  if (!file.name.match(/\.(pdf|txt)$/i)) {
    showError('Please upload a PDF or .txt file.');
    return;
  }
  // Inject into the file input so the upload handler reuses the same path
  const dt = new DataTransfer();
  dt.items.add(file);
  resumeInput.files = dt.files;
  showFileName(file.name);
  uploadBtn.disabled = false;
});

function showFileName(name) {
  dropLabel.hidden = true;
  fileNameEl.textContent = name;
  fileNameEl.hidden = false;
  hideError();
}

// --- Upload ---
uploadBtn.addEventListener('click', async () => {
  const file = resumeInput.files[0];
  if (!file) return;

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading…';
  hideError();

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Server error ${res.status}`);
    }

    const data = await res.json();
    sessionId  = data.session_id;
    resumeData = {
      strengths:        data.strengths,
      titles:           data.titles,
      experience_years: data.experience_years,
      tone:             data.tone,
      raw_text:         data.raw_text,
    };

    showCTA();
  } catch (err) {
    showError(err.message);
    uploadBtn.textContent = 'Upload Resume';
    uploadBtn.disabled = false;
  }
});

function showCTA() {
  uploadSection.hidden = true;
  const topTitle = resumeData.titles[0] ?? 'professional';
  resumeSummary.textContent =
    `Got it — I can see you're a ${topTitle}. Ready to find your next role?`;
  ctaSection.hidden = false;
}

// --- Voice session state ---
let audioCtx = null;
let recorderNode = null;
let playerNode = null;
let ws = null;

// --- Meet Melody ---
meetMelodyBtn.addEventListener('click', async () => {
  if (!sessionId) return;
  meetMelodyBtn.textContent = 'Starting session…';
  meetMelodyBtn.disabled = true;
  try {
    await startVoiceSession(sessionId);
  } catch (err) {
    showError('Could not start session: ' + err.message);
    meetMelodyBtn.textContent = 'Try again';
    meetMelodyBtn.disabled = false;
  }
});

async function startVoiceSession(sid) {
  // 1. Microphone access
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    throw new Error('Microphone access denied. Please allow mic access and try again.');
  }

  // 2. AudioContext + worklets
  audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule('audio-recorder-worklet.js');
  await audioCtx.audioWorklet.addModule('audio-player-worklet.js');

  // Recorder: mic → worklet
  const micSource = audioCtx.createMediaStreamSource(stream);
  recorderNode = new AudioWorkletNode(audioCtx, 'audio-recorder-processor', {
    processorOptions: { targetSampleRate: 16000 },
  });
  micSource.connect(recorderNode);
  recorderNode.connect(audioCtx.destination); // keeps worklet alive; muted by default

  // Player: worklet → speakers
  playerNode = new AudioWorkletNode(audioCtx, 'audio-player-processor', {
    processorOptions: { inputSampleRate: 24000 },
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  playerNode.connect(audioCtx.destination);

  // 3. WebSocket
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/${sid}`);
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => {
    meetMelodyBtn.textContent = 'Listening…';
    // Forward PCM chunks from recorder worklet → WebSocket
    recorderNode.port.onmessage = (e) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(e.data); // ArrayBuffer (Int16 PCM 16kHz)
      }
    };
  });

  ws.addEventListener('message', (e) => {
    if (e.data instanceof ArrayBuffer) {
      // Binary frame: agent audio (Int16 PCM 24kHz) → player worklet
      playerNode.port.postMessage(e.data, [e.data]);
    } else if (typeof e.data === 'string') {
      // Text frame: JSON event
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'job_card') {
        renderJobCard(msg); // implemented in issue #6.1
      }
    }
  });

  ws.addEventListener('close', (e) => {
    stopVoiceSession();
    if (e.code !== 1000 && e.code !== 1001) {
      showError('Connection closed unexpectedly (code ' + e.code + '). Refresh to try again.');
    }
  });

  ws.addEventListener('error', () => {
    stopVoiceSession();
    showError('WebSocket error. Check your connection and try again.');
  });
}

function stopVoiceSession() {
  if (ws && ws.readyState < WebSocket.CLOSING) ws.close(1000);
  ws = null;
  if (recorderNode) { recorderNode.port.postMessage('stop'); recorderNode.disconnect(); recorderNode = null; }
  if (playerNode) { playerNode.disconnect(); playerNode = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  meetMelodyBtn.textContent = 'Session ended';
}

// Stub — replaced by issue #6.1
function renderJobCard(card) {
  console.log('job_card received', card);
}

// --- Helpers ---
function showError(msg) {
  uploadError.textContent = msg;
  uploadError.hidden = false;
}
function hideError() {
  uploadError.hidden = true;
}
