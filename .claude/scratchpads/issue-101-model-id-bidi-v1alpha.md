# Issue #101 — bug: pinned model ID gemini-live-2.5-flash-native-audio rejected by API v1alpha

https://github.com/rawleez/melody/issues/101

## Problem

`gemini-live-2.5-flash-native-audio` (added in PR #99 / issue #94) returns:
```
1008 None. models/gemini-live-2.5-flash-native-audio is not found for API version v1alpha,
or is not supported for bidiGenerateContent
```
This is the Vertex AI naming convention; Gemini API (non-Vertex) uses a different string.

## Model string history

| String | Result |
|---|---|
| `gemini-2.5-flash-native-audio-preview-12-2025` | PR #79 → 1011 "Deadline expired" (but alongside response_modalities Pydantic bug) |
| `gemini-2.5-flash-native-audio-latest` | Works (PR #80) but unstable alias |
| `gemini-live-2.5-flash-native-audio` | PR #99 → 1008, Vertex AI name only |

## Root cause

- `gemini-live-*` prefix = Vertex AI naming convention → not found on v1alpha Gemini API
- The 1011 errors from PR #79 may have been caused by the `response_modalities` Pydantic
  serialization bug that was fixed in PR #84 (using string `"AUDIO"` instead of enum)
- PR #84 removed `response_modalities` from RunConfig entirely, so that bug is gone

## Fix plan

1. Change model to `gemini-2.5-flash-native-audio-preview-12-2025` in agent.py
   - This is the canonical documented Gemini API string for bidiGenerateContent
   - The previous 1011 errors coincided with the (now-fixed) response_modalities bug
2. Update CLAUDE.md to clarify the naming inconsistency resolution
3. Open PR, deploy, verify no 1008 or 1011 errors in logs

## Implementation

- File: `server/melody_agent/agent.py`
- Change: `model="gemini-2.5-flash-native-audio-latest"` → `model="gemini-2.5-flash-native-audio-preview-12-2025"`
