"""Resume parser — uses Gemini 2.5 Flash to extract structured data from a resume."""

import os
from typing import Any

from google import genai
from google.genai import types
from pydantic import BaseModel


class ResumeData(BaseModel):
    strengths: list[str]
    titles: list[str]
    experience_years: float
    tone: str
    raw_text: str


_PROMPT = """\
You are an expert career coach reading a resume to help a recruiter understand this person.

Extract the following fields:

1. **strengths** — 3 to 6 genuinely standout strengths specific to *this* person.
   These must be concrete and particular: skills, accomplishments, or patterns you could
   only say about them — not generic phrases like "strong communicator" or "team player".
   Ground each strength in evidence from the resume.

2. **titles** — All distinct job titles this person has held, in the order they appear.

3. **experience_years** — Total years of professional experience as a single number
   (estimate from date ranges; use 0 if none found).

4. **tone** — One short phrase describing the writing style and personality that comes
   through (e.g. "methodical and data-driven", "entrepreneurial and high-energy").

5. **raw_text** — The full plain-text content of the resume, preserving line breaks.

Return ONLY valid JSON matching this schema — no markdown fences, no extra keys:
{
  "strengths": ["..."],
  "titles": ["..."],
  "experience_years": 0,
  "tone": "...",
  "raw_text": "..."
}
"""


async def parse_resume(file_bytes: bytes, content_type: str) -> dict[str, Any]:
    """Parse resume bytes with Gemini 2.5 Flash and return structured data.

    Args:
        file_bytes: Raw bytes of the uploaded file.
        content_type: MIME type — 'application/pdf' or 'text/plain'.

    Returns:
        Dict with keys: strengths, titles, experience_years, tone, raw_text.
    """
    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

    if content_type == "application/pdf":
        part = types.Part.from_bytes(data=file_bytes, mime_type="application/pdf")
        contents = [part, _PROMPT]
    else:
        text = file_bytes.decode("utf-8", errors="replace")
        contents = [f"{_PROMPT}\n\n---RESUME---\n{text}"]

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=contents,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ResumeData,
            temperature=0.2,
        ),
    )

    return response.parsed.model_dump()
