# Issue #100: emit_job_card fires duplicate calls in same session

**Issue:** https://github.com/rawleez/melody/issues/100
**Branch:** fix/100-emit-job-card-dedupe

## Problem

`emit_job_card` is being called twice for the same jobs within a single session. The `search_ran` guard (from #96) prevents duplicate searches but does not prevent the model from re-calling `emit_job_card` for already-presented jobs.

## Root Cause

`tools.py` `emit_job_card` — no deduplication guard on emitted job URLs. The model can loop back and re-present jobs it already called `emit_job_card` for.

## Plan

### Step 1 — Add URL deduplication guard in `tools.py`
- On each `emit_job_card` call, check `tool_context.state.get("emitted_urls", [])`
- If the URL is already in the list, return an error/skip response
- Otherwise, append the URL to the list before emitting

### Step 2 — Strengthen system prompt in `prompts.py`
- Add explicit instruction: do NOT re-call `emit_job_card` for jobs already presented
- Reference the fact that the tool will reject duplicates

## Changes

- `server/melody_agent/tools.py` — add `emitted_urls` guard
- `server/melody_agent/prompts.py` — strengthen delivery phase instructions
