"""Melody custom tools — stub until Issues 4.1 and 4.2 are implemented."""

from google.adk.tools import ToolContext


def emit_job_card(
    tool_context: ToolContext,
    title: str,
    company: str,
    reasons: list[str],
    url: str,
    salary: str = "Not listed",
) -> dict:
    """Emit a job card to the client (stub — Issue 4.1).

    Appends a card dict to tool_context.state['pending_cards'] so the
    WebSocket handler can forward it to the browser as a JSON event.
    """
    raise NotImplementedError("emit_job_card is not yet implemented (Issue 4.1)")
