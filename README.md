# Melody

Melody is a live voice AI job search companion built on Google ADK and Gemini Live. She listens to how you talk about your work — not just what your resume says — asks you emotionally intelligent questions to extract your must-haves, nice-to-haves, and dealbreakers, then searches the web in real time and reads back job matches that fit who you actually are.

Built for the **Gemini Live Agent Challenge** (March 2026).

---

## Prerequisites

- Python 3.11+
- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- A Google AI Studio API key with the Gemini API enabled
- A Google Cloud project (for deployment only)

---

## Local Setup

```bash
# 1. Clone the repo
git clone https://github.com/rawleez/melody.git
cd melody

# 2. Copy the env template and fill in your key
cp .env.example .env
# Edit .env and set GOOGLE_API_KEY=<your key>

# 3. Install server dependencies
pip install -r server/requirements.txt

# 4. Run locally
./run_local.sh
```

Open `http://localhost:8000` in your browser, upload a resume (PDF or .txt), and start talking to Melody.

---

## Cloud Deployment

```bash
# Set your GCP project
export GOOGLE_CLOUD_PROJECT=your-project-id

# Store your API key in Secret Manager (first time only)
echo -n "your-api-key" | gcloud secrets create GOOGLE_API_KEY \
  --data-file=- --project "$GOOGLE_CLOUD_PROJECT"

# Deploy to Cloud Run
./deploy.sh
```

`deploy.sh` enables the required GCP APIs, builds the container, and deploys to Cloud Run in `us-central1`. It prints the live URL when done.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_API_KEY` | Yes | Google AI Studio API key. Loaded from Secret Manager in Cloud Run; loaded from `.env` locally. |
| `GOOGLE_GENAI_USE_VERTEXAI` | No | Set to `0` to use the Gemini API directly (not Vertex AI). Default is `0`. |
| `APP_NAME` | No | Application name passed to the ADK runner. Defaults to `melody`. |
| `AGENT_VOICE` | No | Gemini TTS voice name for Melody's voice. Defaults to `Aoede`. |
| `AGENT_LANGUAGE` | No | BCP-47 language code for speech recognition. Defaults to `en-US`. |

---

## Architecture

```
client/              # Static frontend (HTML/CSS/JS + AudioWorklets)
server/
  main.py            # FastAPI app — /upload, /ws/{session_id}
  melody_agent/
    agent.py         # ADK Agent definition + callbacks
    prompts.py       # System prompt
    tools.py         # emit_job_card tool
    resume_parser.py # PDF/text resume extraction
```

**Voice pipeline:** Browser captures PCM audio → base64 JSON over WebSocket → FastAPI forwards to ADK `LiveRequestQueue` → Gemini Live streams audio responses back → AudioWorklet plays them in real time.

**Job search:** Melody uses `google_search` during the conversation to find real, current job listings. Results are truncated before being added to context to prevent context window overflow.
