"""Melody ADK agent definition."""

from google.adk.agents import Agent
from google.adk.tools import google_search
from google.genai import types

from melody_agent.prompts import build_prompt
from melody_agent.tools import build_job_query, emit_job_card

_VOICE_CONFIG = types.GenerateContentConfig(
    speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Aoede")
        )
    )
)


def create_agent(resume_data: dict) -> Agent:
    """Instantiate Melody with resume data injected into the system prompt.

    Called once per WebSocket session so each user gets a prompt personalised
    to their own resume.
    """
    return Agent(
        name="melody",
        model="gemini-2.5-flash-native-audio-latest",
        instruction=build_prompt(resume_data),
        tools=[google_search, build_job_query, emit_job_card],
        generate_content_config=_VOICE_CONFIG,
    )


# Module-level instance required for ADK app discovery (`adk web` / `adk run`).
# The WebSocket handler always calls create_agent(resume_data) instead.
root_agent = create_agent({})
