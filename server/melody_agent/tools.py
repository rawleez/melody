"""Melody custom tools."""

from google.adk.tools import ToolContext



def build_job_query(tool_context: ToolContext, state: dict) -> dict:
    """Build a Google search query for job postings from conversation state.

    Args:
        tool_context: ADK tool context (required for Live session routing).
        state: Accumulated session state with keys:
            - role_type (str): e.g. "senior product manager"
            - location (str): e.g. "remote" or "New York"
            - priorities (list[str]): must-haves / nice-to-haves from the conversation
            - anti_priorities (list[str]): dealbreakers (excluded via '-' prefix)

    Returns:
        Dict with 'query' key containing the search query string.
        Example: {"query": "senior product manager remote SaaS fintech job posting 2026"}
    """
    parts = []

    if state.get("role_type"):
        parts.append(state["role_type"])

    if state.get("location"):
        parts.append(state["location"])

    for priority in state.get("priorities", [])[:3]:
        parts.append(priority)

    parts.append("job posting 2026")

    exclusions = " ".join(
        f"-{term}" for term in state.get("anti_priorities", [])[:2]
    )
    if exclusions:
        parts.append(exclusions)

    return {"query": " ".join(parts)}


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
    if not tool_context.state.get("search_ran"):
        return {
            "error": (
                "You must call google_search before emit_job_card. "
                "No search has been run in this session yet."
            )
        }

    if not url.startswith("http") or "example.com" in url:
        return {
            "error": (
                f"'{url}' is not a real job posting URL. Use only URLs from the google_search results."
            )
        }

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
