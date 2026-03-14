"""Melody ADK agent definition."""

import time

from google.adk.agents import Agent
from google.adk.tools.google_search_tool import GoogleSearchTool
from google.genai import types

from melody_agent.prompts import build_prompt
from melody_agent.tools import build_job_query, emit_job_card


def _before_tool(tool, args, tool_context):
    """Log tool call start and record timestamp for elapsed-time tracking."""
    tool_context.state[f"_tool_start_{tool.name}"] = time.time()
    print(f"[tool] {tool.name} START | args={args}", flush=True)
    return None


def _after_tool(tool, args, tool_context, tool_response):
    """Log tool call completion with elapsed time."""
    start = tool_context.state.get(f"_tool_start_{tool.name}", time.time())
    elapsed = time.time() - start
    print(f"[tool] {tool.name} END   | elapsed={elapsed:.1f}s", flush=True)
    return None


def create_agent(resume_data: dict) -> Agent:
    """Instantiate Melody with resume data injected into the system prompt.

    Called once per WebSocket session so each user gets a prompt personalised
    to their own resume.
    """
    return Agent(
        name="melody",
        model="gemini-2.5-flash-native-audio-preview-12-2025",
        instruction=build_prompt(resume_data),
        tools=[GoogleSearchTool(bypass_multi_tools_limit=True), build_job_query, emit_job_card],
        before_tool_callback=_before_tool,
        after_tool_callback=_after_tool,
    )


# Module-level instance required for ADK app discovery (`adk web` / `adk run`).
# The WebSocket handler always calls create_agent(resume_data) instead.
root_agent = create_agent({})
