"""Melody ADK agent definition."""

from google.adk.agents import Agent
from google.adk.tools.google_search_tool import GoogleSearchTool
from google.genai import types

from melody_agent.prompts import build_prompt
from melody_agent.tools import build_job_query, emit_job_card

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
    )


# Module-level instance required for ADK app discovery (`adk web` / `adk run`).
# The WebSocket handler always calls create_agent(resume_data) instead.
root_agent = create_agent({})
