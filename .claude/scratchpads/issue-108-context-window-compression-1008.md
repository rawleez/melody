# Issue #108 — bug: ContextWindowCompressionConfig causes 1008 crash on non-Vertex backend

https://github.com/rawleez/melody/issues/108

## Problem

Sessions crash ~37 seconds in with:
```
1008 None. Operation is not implemented, or supported, or enabled.
```

After the fix for #106 was deployed (revision melody-00016-drs).

## Root cause

Two Vertex AI-only features in `RunConfig` (server/main.py):
1. `ContextWindowCompressionConfig` — confirmed Vertex-only, causes 1008 after ~37s
2. `SessionResumptionConfig(handle=...)` — likely also Vertex-only; the initial `handle=None`
   may not crash immediately but a reconnect with a handle would fail

## Pattern

A series of "add Vertex feature" → "1008/ValueError crash" → "remove it" bugs:
- #102 added `SessionResumptionConfig(transparent=True)` → #106/#107 removed `transparent=True`
- #102 added `ContextWindowCompressionConfig` → #108 removes it
- `SessionResumptionConfig` without `transparent=True` is also suspect

## Fix plan

1. Remove `ContextWindowCompressionConfig` from `RunConfig` — definite fix
2. Remove `SessionResumptionConfig` from `RunConfig` — precautionary, safe on non-Vertex
3. Remove resumption handle tracking (`resumption_handle` list, update loop in `send_events`)
4. On 1011 reconnect: clean restart (new queue, no handle) — conversation state is lost
   but session doesn't crash

### Files changed
- `server/main.py`

### What we keep
- The retry loop (up to 3 retries, exponential backoff) — still useful for transient 1011s
- The `LiveRequestQueue` swap on reconnect
- The initial "Hello" greeting on reconnect is now needed (no state restoration via handle)
