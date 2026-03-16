# Issue #102 — bug: session drops mid-delivery with 1011 Internal error

https://github.com/rawleez/melody/issues/102

## Problem

Voice sessions terminate mid-response with a 1011 WebSocket close from Google's servers.
The session is unrecoverable — no retry/reconnect logic exists, user must start over.

## Root cause

1011 is a Google-side transient error. No retry logic exists in `send_events()`.

## Fix plan

### What to implement

1. Enable `SessionResumptionConfig(transparent=True)` in `RunConfig` so Google sends
   `live_session_resumption_update` events with a `new_handle` whenever the session
   is in a resumable state.

2. In `send_events`, track the latest resumable handle from
   `event.live_session_resumption_update.new_handle`.

3. Wrap `runner.run_live(...)` in a retry loop (max 3 retries, exponential backoff:
   1s → 2s → 4s) that catches 1011 `google.genai.errors.APIError`.

4. On 1011:
   - Close the old `LiveRequestQueue`
   - Create a new one (stored in a mutable shared ref so `receive_audio` picks it up)
   - Rebuild `RunConfig` with `SessionResumptionConfig(handle=last_good_handle)` if available
   - Retry `run_live` with the new queue

5. `receive_audio` reads from `queue_ref[0]` (mutable list) instead of a fixed queue
   reference, so it automatically routes audio to the current queue after reconnect.

### Key ADK types used

- `RunConfig.session_resumption: SessionResumptionConfig`
- `SessionResumptionConfig(handle=None, transparent=True)` — first connection
- `SessionResumptionConfig(handle=saved_handle, transparent=True)` — reconnect
- `Event.live_session_resumption_update: LiveServerSessionResumptionUpdate`
  - `.resumable: bool` — True if session can be resumed right now
  - `.new_handle: str` — opaque token to use on reconnect

### Files changed

- `server/main.py` — reconnect loop in `websocket_session`

### What we do NOT change

- The initial greeting `send_content("Hello")` is only sent on first connect,
  not on reconnect (conversation state is restored via the handle).
- `agent.py` is unchanged.
