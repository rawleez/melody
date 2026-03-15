import asyncio
import json
import os
import uuid
from typing import Any

from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import InMemoryRunner
from google.genai import types as genai_types

from melody_agent.agent import create_agent
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


@app.websocket("/ws/{session_id}")
async def websocket_session(websocket: WebSocket, session_id: str):
    """Live voice session for a given resume session.

    Binary frames in:  PCM 16-bit mono 16 kHz (from browser audio worklet)
    Binary frames out: PCM 16-bit mono 24 kHz (Gemini Live audio)
    Text frames out:   JSON {"type": "job_card", ...} after each agent turn
    """
    resume_data = _sessions.get(session_id)
    if resume_data is None:
        await websocket.close(code=4404)
        return

    await websocket.accept()

    agent = create_agent(resume_data)
    runner = InMemoryRunner(agent=agent, app_name="melody")

    adk_session = await runner.session_service.create_session(
        app_name=runner.app_name,
        user_id="user",
    )
    adk_session_id = adk_session.id

    live_queue = LiveRequestQueue()
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=[genai_types.Modality.AUDIO],
    )

    async def receive_audio():
        """Browser → LiveRequestQueue: forward raw PCM blobs."""
        try:
            while True:
                data = await websocket.receive_bytes()
                live_queue.send_realtime(
                    genai_types.Blob(data=data, mime_type="audio/pcm;rate=16000")
                )
        except WebSocketDisconnect:
            live_queue.close()

    async def send_events():
        """ADK events → browser: audio chunks and job cards."""
        try:
            async for event in runner.run_live(
                user_id="user",
                session_id=adk_session_id,
                live_request_queue=live_queue,
                run_config=run_config,
            ):
                # Forward agent audio as binary frames
                if event.content and event.content.parts:
                    for part in event.content.parts:
                        if part.inline_data and part.inline_data.data:
                            await websocket.send_bytes(part.inline_data.data)

                # After each turn flush pending job cards from session state
                if event.turn_complete:
                    try:
                        real_session = runner.session_service.sessions[
                            runner.app_name
                        ]["user"][adk_session_id]
                        cards = real_session.state.pop("pending_cards", [])
                        for card in cards:
                            await websocket.send_text(
                                json.dumps({"type": "job_card", **card})
                            )
                    except (KeyError, AttributeError):
                        pass  # state not yet populated or structure differs
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            print(f"[send_events] error: {exc}", flush=True)
            raise

    # Kick off Melody's opening greeting — without this, BIDI mode waits
    # for the user to speak first and the session appears stalled.
    live_queue.send_content(
        content=genai_types.Content(
            role="user",
            parts=[genai_types.Part(text="Hello")],
        )
    )

    recv_task = asyncio.create_task(receive_audio())
    send_task = asyncio.create_task(send_events())

    done, pending = await asyncio.wait(
        [recv_task, send_task], return_when=asyncio.FIRST_COMPLETED
    )
    for task in pending:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, WebSocketDisconnect):
            pass


# Static files — mounted last so API routes take priority
_client_dir = os.path.join(os.path.dirname(__file__), "..", "client")
app.mount("/", StaticFiles(directory=_client_dir, html=True), name="static")
