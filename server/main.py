import asyncio
import base64
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


_MAX_RECONNECTS = 3
_RECONNECT_BACKOFF_BASE = 1.0  # seconds; doubles each retry


@app.websocket("/ws/{session_id}")
async def websocket_session(websocket: WebSocket, session_id: str):
    """Live voice session for a given resume session.

    Binary frames in:  PCM 16-bit mono 16 kHz (from browser audio worklet)
    Binary frames out: PCM 16-bit mono 24 kHz (Gemini Live audio)
    Text frames out:   JSON {"type": "job_card", ...} after each agent turn

    Reconnect on 1011 (Google transient internal error): up to _MAX_RECONNECTS
    attempts using SessionResumptionConfig to restore conversation state.
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

    # Mutable ref so receive_audio always routes to the current queue,
    # even after a reconnect swaps it out.
    queue_ref: list[LiveRequestQueue] = [LiveRequestQueue()]

    # Latest resumable session handle from Google (updated as events arrive).
    resumption_handle: list[str | None] = [None]

    async def receive_audio():
        """Browser → LiveRequestQueue: decode base64 JSON envelope and forward PCM."""
        try:
            while True:
                text = await websocket.receive_text()
                try:
                    msg = json.loads(text)
                    pcm_data = base64.b64decode(msg["data"])
                except (json.JSONDecodeError, KeyError, Exception):
                    continue  # drop malformed frames
                queue_ref[0].send_realtime(
                    genai_types.Blob(data=pcm_data, mime_type="audio/pcm;rate=16000")
                )
        except WebSocketDisconnect:
            queue_ref[0].close()

    async def send_events():
        """ADK events → browser: base64 JSON audio envelope and job cards.

        Retries up to _MAX_RECONNECTS times on 1011 transient Google errors,
        using the last known resumption handle to restore conversation state.
        """
        retry = 0
        while True:
            run_config = RunConfig(
                streaming_mode=StreamingMode.BIDI,
                session_resumption=genai_types.SessionResumptionConfig(
                    handle=resumption_handle[0],
                ),
                context_window_compression=genai_types.ContextWindowCompressionConfig(
                    sliding_window=genai_types.SlidingWindow(target_tokens=20000),
                    trigger_tokens=25000,
                ),
            )
            try:
                async for event in runner.run_live(
                    user_id="user",
                    session_id=adk_session_id,
                    live_request_queue=queue_ref[0],
                    run_config=run_config,
                ):
                    # Track the latest resumable handle for reconnect.
                    upd = event.live_session_resumption_update
                    if upd and upd.resumable and upd.new_handle:
                        resumption_handle[0] = upd.new_handle

                    # Collect audio parts and send as a single JSON envelope.
                    audio_parts = []
                    if event.content and event.content.parts:
                        for part in event.content.parts:
                            if part.inline_data and part.inline_data.data:
                                audio_parts.append({
                                    "type": "audio/pcm",
                                    "data": base64.b64encode(part.inline_data.data).decode("ascii"),
                                })

                    if audio_parts or event.turn_complete or getattr(event, "interrupted", False):
                        envelope: dict = {
                            "parts": audio_parts,
                            "turn_complete": bool(event.turn_complete),
                            "interrupted": bool(getattr(event, "interrupted", False)),
                        }
                        await websocket.send_text(json.dumps(envelope))

                    # After each turn flush pending job cards from session state.
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

                # run_live exhausted normally — session complete.
                break

            except WebSocketDisconnect:
                break
            except Exception as exc:
                err = str(exc)
                if "1011" in err and retry < _MAX_RECONNECTS:
                    retry += 1
                    backoff = _RECONNECT_BACKOFF_BASE * (2 ** (retry - 1))
                    print(
                        f"[send_events] 1011 error — reconnect attempt {retry}/{_MAX_RECONNECTS} "
                        f"in {backoff:.0f}s (handle={'set' if resumption_handle[0] else 'none'})",
                        flush=True,
                    )
                    await asyncio.sleep(backoff)
                    # Swap to a fresh queue; receive_audio picks it up via queue_ref.
                    queue_ref[0].close()
                    queue_ref[0] = LiveRequestQueue()
                else:
                    print(f"[send_events] error: {exc}", flush=True)
                    raise

    # Kick off Melody's opening greeting — without this, BIDI mode waits
    # for the user to speak first and the session appears stalled.
    # Only sent on first connect; reconnects restore state via resumption handle.
    queue_ref[0].send_content(
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
