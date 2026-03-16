# Issue #106: SessionResumptionConfig transparent=True crashes on non-Vertex backend

**Issue:** https://github.com/rawleez/melody/issues/106
**Branch:** fix/106-session-resumption-transparent

## Problem

PR #104 (issue #102 fix) added `SessionResumptionConfig(transparent=True)` to `RunConfig`.
`transparent=True` is Vertex AI-only. Melody runs with `GOOGLE_GENAI_USE_VERTEXAI=0`,
so every session crashes immediately with:

```
ValueError: Transparent session resumption is only supported for Vertex AI backend.
```

## Fix

Remove `transparent=True` from `SessionResumptionConfig` in `server/main.py`.

The manual reconnect loop and handle tracking still work without it — `transparent=True`
just tells Google to silently reconnect server-side; our client-side retry loop handles
reconnects explicitly, so we don't need it.

## Change

- `server/main.py` — remove `transparent=True` from `SessionResumptionConfig`
