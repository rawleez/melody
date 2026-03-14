"""Melody custom tools."""

from google.adk.tools import ToolContext


def emit_job_card(
    tool_context: ToolContext,
    title: str,
    company: str,
    reasons: list[str],
    url: str,
    salary: str = "Not listed",
) -> dict:
    """Emit a job card to the client.

    Appends a card dict to tool_context.state['pending_cards'] so the
    WebSocket handler can forward it to the browser as a JSON event.
    """
    card = {
        "title": title,
        "company": company,
        "reasons": reasons[:3],
        "url": url,
        "salary": salary,
    }

    if "pending_cards" not in tool_context.state:
        tool_context.state["pending_cards"] = []
    tool_context.state["pending_cards"].append(card)

    return {"status": "emitted", "card": card}
