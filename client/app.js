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

// --- Meet Melody ---
meetMelodyBtn.addEventListener('click', () => {
  if (!sessionId) return;
  // Voice session wiring comes in issue #5.4 — placeholder for now
  meetMelodyBtn.textContent = 'Starting session…';
  meetMelodyBtn.disabled = true;
  console.log('Starting voice session', { sessionId, resumeData });
});

// --- Helpers ---
function showError(msg) {
  uploadError.textContent = msg;
  uploadError.hidden = false;
}
function hideError() {
  uploadError.hidden = true;
}
