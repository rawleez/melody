import os
import uuid
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

from melody_agent.resume_parser import parse_resume

app = FastAPI()

# In-memory store: session_id -> parsed resume data
_sessions: dict[str, Any] = {}

_MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB
_ALLOWED_CONTENT_TYPES = {"application/pdf", "text/plain"}


@app.post("/upload")
async def upload_resume(file: UploadFile = File(...)):
    if file.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{file.content_type}'. Upload a PDF or plain-text file.",
        )

    data = await file.read()
    if len(data) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 20 MB limit.")

    parsed = await parse_resume(data, content_type=file.content_type)

    session_id = str(uuid.uuid4())
    _sessions[session_id] = parsed

    return {"session_id": session_id, **parsed}


# Static files — mounted last so API routes take priority
_client_dir = os.path.join(os.path.dirname(__file__), "..", "client")
app.mount("/", StaticFiles(directory=_client_dir, html=True), name="static")
