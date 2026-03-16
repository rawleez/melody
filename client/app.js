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

// --- Base64 ↔ ArrayBuffer utilities (for WebSocket audio protocol) ---
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// --- Voice session state ---
let audioCtxRecorder = null;
let audioCtxPlayer   = null;  // fixed 24 kHz — never closed, only suspended
let recorderNode = null;
let playerNode = null;
let ws = null;

// --- Meet Melody ---
meetMelodyBtn.addEventListener('click', async () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    stopVoiceSession();
    return;
  }
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
  console.log('[melody] requesting mic...');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch {
    throw new Error('Microphone access denied. Please allow mic access and try again.');
  }
  console.log('[melody] mic granted');

  // 2. AudioContext + worklets
  // Recorder context: fixed 16 kHz so the worklet's hardcoded sampleRate=16000 is correct —
  // this is the key fix for VAD timing and removes the need for in-worklet resampling.
  // Create once, suspend on stop (closing + recreating causes Chrome to silently fail
  // when re-adding the worklet module on the next session start).
  if (!audioCtxRecorder) {
    audioCtxRecorder = new AudioContext({ sampleRate: 16000 });
    await audioCtxRecorder.audioWorklet.addModule('audio-recorder-worklet.js');
    console.log('[melody] recorder worklet loaded');
  }
  if (audioCtxRecorder.state === 'suspended') await audioCtxRecorder.resume();
  console.log('[melody] recorder AudioContext state:', audioCtxRecorder.state);

  // Player context: fixed 24 kHz to match Gemini output — create once, suspend on stop
  if (!audioCtxPlayer) {
    audioCtxPlayer = new AudioContext({ sampleRate: 24000 });
    await audioCtxPlayer.audioWorklet.addModule('audio-player-worklet.js');
    console.log('[melody] player worklet loaded');
  }
  if (audioCtxPlayer.state === 'suspended') await audioCtxPlayer.resume();

  // Recorder: mic → worklet
  const micSource = audioCtxRecorder.createMediaStreamSource(stream);
  recorderNode = new AudioWorkletNode(audioCtxRecorder, 'audio-recorder-processor');
  micSource.connect(recorderNode);
  recorderNode.connect(audioCtxRecorder.destination); // keeps worklet alive; muted by default

  // Player: worklet → speakers (no processorOptions — ClearRight worklet uses none)
  playerNode = new AudioWorkletNode(audioCtxPlayer, 'audio-player-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  playerNode.connect(audioCtxPlayer.destination);

  // 3. WebSocket
  console.log('[melody] opening WebSocket...');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/${sid}`);

  ws.addEventListener('open', () => {
    meetMelodyBtn.textContent = 'End session';
    meetMelodyBtn.disabled = false;
    // Forward PCM chunks from recorder worklet → WebSocket as base64 JSON.
    // On speech_start, flush the player ring buffer so stale audio from
    // Melody's previous turn doesn't delay playback of the next response.
    recorderNode.port.onmessage = (e) => {
      if (e.data?.type === 'audio_data') {
        if (ws.readyState === WebSocket.OPEN) {
          const base64 = arrayBufferToBase64(e.data.buffer);
          ws.send(JSON.stringify({ mime_type: 'audio/pcm', data: base64 }));
        }
      } else if (e.data?.type === 'speech_start') {
        if (playerNode) playerNode.port.postMessage({ type: 'flush' });
      } else if (e.data?.type === 'speech_end') {
        // speech_end: user stopped talking — clear any speaking UI state here if added later
      }
    };
  });

  ws.addEventListener('message', (e) => {
    if (typeof e.data !== 'string') return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    // Audio + control envelope from agent
    if (msg.parts) {
      for (const part of msg.parts) {
        if ((part.type === 'audio/pcm' || part.mime_type === 'audio/pcm') && part.data) {
          const buffer = base64ToArrayBuffer(part.data);
          playerNode.port.postMessage({ type: 'audio_data', buffer }, [buffer]);
        }
      }
    }
    // Barge-in: agent was interrupted — flush buffered playback immediately
    if (msg.interrupted) {
      if (playerNode) playerNode.port.postMessage({ type: 'flush' });
    }
    // Job card event — sent as a separate frame by the server
    if (msg.type === 'job_card') {
      renderJobCard(msg);
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
  if (recorderNode) { recorderNode.disconnect(); recorderNode = null; }
  if (playerNode) { playerNode.disconnect(); playerNode = null; }
  // Suspend (not close) both contexts — closing and recreating causes Chrome to silently
  // fail when re-adding a worklet module on the next session start.
  if (audioCtxRecorder) audioCtxRecorder.suspend();
  if (audioCtxPlayer) audioCtxPlayer.suspend();
  meetMelodyBtn.textContent = 'Session ended';
}

// --- Job card renderer ---
const jobCardsSection = document.getElementById('job-cards');
let jobCardCount = 0;

function renderJobCard(card) {
  if (jobCardCount >= 3) return;
  jobCardCount++;

  jobCardsSection.hidden = false;

  const reasonsHTML = (card.reasons || [])
    .slice(0, 3)
    .map(r => `<li>${escapeHTML(r)}</li>`)
    .join('');

  const el = document.createElement('article');
  el.className = 'job-card';
  el.innerHTML =
    `<div class="job-card-header">` +
      `<h3 class="job-title">${escapeHTML(card.title)}</h3>` +
      `<span class="job-company">${escapeHTML(card.company)}</span>` +
    `</div>` +
    `<ul class="job-reasons">${reasonsHTML}</ul>` +
    `<div class="job-card-footer">` +
      `<span class="job-salary">${escapeHTML(card.salary || 'Not listed')}</span>` +
      `<a class="job-link" href="${escapeHTML(card.url)}" target="_blank" rel="noopener noreferrer">View posting</a>` +
    `</div>`;

  jobCardsSection.appendChild(el);
  // Defer class add so CSS transition fires
  requestAnimationFrame(() => el.classList.add('visible'));
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

// --- Helpers ---
function showError(msg) {
  uploadError.textContent = msg;
  uploadError.hidden = false;
}
function hideError() {
  uploadError.hidden = true;
}
