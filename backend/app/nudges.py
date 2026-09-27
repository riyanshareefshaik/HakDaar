"""Follow-up nudges and the welcome-back greeting.

Nudges are computed in Python from the exact ledger (never by the LLM): money still owed and how long
it has been, an employer whose daily rate we still don't know, a promise to "pay the rest later".
The greeting is written by the LLM from those nudges plus what Hindsight recalls, so a returning worker
immediately hears what HakDaar remembers.
"""
import logging
from datetime import date

from . import db, ledger, llm, memory

log = logging.getLogger("hakdaar.nudges")

LATER_WORDS = ("later", "rest", "baad", "बाद", "తర్వాత", "remaining", "balance")


def _days_since(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        return (date.today() - date.fromisoformat(iso[:10])).days
    except ValueError:
        return None


def compute_nudges(worker_id: str) -> list[dict]:
    events = db.list_events(worker_id)
    rows = ledger.summarize(events)
    nudges = []
    for r in rows:
        mine = [e for e in events if e["employer_name"] == r["employer_name"]]
        last = max((e.get("date") or e["created_at"][:10] for e in mine), default=None)
        since = _days_since(last)
        if r["status"] == "unknown_rate":
            nudges.append({"type": "missing_rate", "employer_name": r["employer_name"], "priority": 1})
        elif (r["amount_owed"] or 0) > 0:
            later = any(e["type"] == "payment" and any(w in (e.get("notes") or "").lower() for w in LATER_WORDS)
                        for e in mine)
            nudges.append({
                "type": "owed", "employer_name": r["employer_name"], "amount_owed": r["amount_owed"],
                "days_since": since, "promised_later": later, "priority": 0,
            })
    nudges.sort(key=lambda n: (n["priority"], -(n.get("amount_owed") or 0)))
    return nudges[:3]


GREETING_PROMPT = """You are HakDaar, a warm friend who helps a daily-wage worker keep track of wages.
{name} has just opened the app again. Write a short welcome-back message in {language}:
- at most 40 words, very simple words, like a friend speaking; no markdown, no lists
- greet them by name
- mention the MOST important item from PENDING (use the exact rupee amounts and days written there)
- mention one thing you remember from MEMORIES, if useful
- end with one simple yes/no question (e.g. did they get paid?)
Never invent numbers.

PENDING (exact, computed by the app):
{pending}

MEMORIES from earlier conversations:
{memories}
"""


def _pending_text(nudges: list[dict]) -> str:
    lines = []
    for n in nudges:
        if n["type"] == "owed":
            line = f"- {n['employer_name']} still owes {ledger.format_inr(n['amount_owed'])}"
            if n.get("days_since"):
                line += f"; last update {n['days_since']} days ago"
            if n.get("promised_later"):
                line += "; they said they would pay the rest later"
            lines.append(line)
        elif n["type"] == "missing_rate":
            lines.append(f"- we don't know the daily rate {n['employer_name']} promised yet")
    return "\n".join(lines) or "(nothing pending)"


async def welcome(worker: dict) -> dict:
    """Returns {greeting, nudges, has_history}. greeting is None if there is nothing to recall yet
    or the LLM is unavailable (the UI then shows a friendly template)."""
    nudges = compute_nudges(worker["id"])
    has_history = bool(db.list_messages(worker["id"], limit=1))
    if not has_history:
        return {"greeting": None, "nudges": nudges, "has_history": False, "memories": []}

    mems = []
    try:
        mems = await memory.recall(
            memory.worker_bank(worker["id"]),
            f"What did {worker['name']} tell me recently about employers, promises, work and payments?",
            limit=5,
        )
    except memory.MemoryUnavailable as e:
        log.warning("welcome recall failed: %s", e)

    greeting = None
    try:
        greeting = await llm.complete(
            GREETING_PROMPT.format(
                name=worker["name"], language=llm.LANGUAGES.get(worker["language"], "English"),
                pending=_pending_text(nudges),
                memories="\n".join(f"- {m['text']}" for m in mems) or "(none)",
            ),
            max_tokens=200,
        )
    except llm.LLMUnavailable as e:
        log.warning("welcome greeting failed: %s", e)
    return {"greeting": greeting or None, "nudges": nudges, "has_history": True, "memories": mems}
