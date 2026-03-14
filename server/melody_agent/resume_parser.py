"""Resume parser — stub until Issue 2.3 is implemented."""

from typing import Any


async def parse_resume(file_bytes: bytes, content_type: str) -> dict[str, Any]:
    """Parse resume bytes and return structured data.

    Args:
        file_bytes: Raw bytes of the uploaded file.
        content_type: MIME type, either 'application/pdf' or 'text/plain'.

    Returns:
        Dict with keys: strengths, titles, experience_years, tone, raw_text.
    """
    raise NotImplementedError("resume_parser is not yet implemented (Issue 2.3)")
