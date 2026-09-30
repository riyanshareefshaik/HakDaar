"""Thin async wrapper around the Hindsight client.

Banks:
  worker-{worker_id}    private memory for one worker (strictly isolated)
  employer-reputation   shared, anonymised reports about how employers pay
"""
import asyncio
import logging
from datetime import datetime

import aiohttp
from hindsight_client import Hindsight
from hindsight_client_api.exceptions import ApiException, NotFoundException

from .config import settings

log = logging.getLogger("hakdaar.memory")

REPUTATION_BANK = "employer-reputation"

WORKER_MISSION = (
    "Personal memory for one daily-wage worker in Hyderabad. Remember employers, the daily rate each "
    "employer promised and when, days worked, payments received, delays, and anything the worker is "
    "worried about. Amounts are in Indian rupees."
)
REPUTATION_MISSION = (
    "Shared, anonymous memory about how employers and contractors in Hyderabad pay daily-wage workers: "
    "short payments, late payments, broken promises, and employers who paid fully and on time. "
    "Never store or reveal worker names."
)


class MemoryUnavailable(Exception):
    """Raised with a user-presentable message when Hindsight can't be used."""


def worker_bank(worker_id: str) -> str:
    return f"worker-{worker_id}"


_client: Hindsight | None = None


def client() -> Hindsight:
    global _client
    if _client is None:
        _client = Hindsight(base_url=settings.hindsight_url, timeout=60.0)
    return _client


async def close() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


# When Hindsight is unreachable, don't make every chat message wait for a timeout: after one
# failure, skip memory for a short cool-down and answer from the ledger straight away.
CALL_TIMEOUT = 8.0      # recall / retain (retain is queued server-side, so it returns fast)
REFLECT_TIMEOUT = 25.0  # reflect runs an LLM inside Hindsight
COOLDOWN = 60.0
_down_until = 0.0


def _unavailable() -> MemoryUnavailable:
    return MemoryUnavailable(f"Cannot reach Hindsight at {settings.hindsight_url}.")


async def _call(coro_fn, *args, timeout: float | None = None, **kwargs):
    """Run a Hindsight call and translate transport/API errors into MemoryUnavailable."""
    global _down_until
    loop = asyncio.get_running_loop()
    if loop.time() < _down_until:
        raise _unavailable()
    try:
        return await asyncio.wait_for(coro_fn(*args, **kwargs), timeout or CALL_TIMEOUT)
    except (aiohttp.ClientConnectionError, ConnectionError, OSError, asyncio.TimeoutError) as e:
        _down_until = loop.time() + COOLDOWN
        log.warning("Hindsight unreachable (%s); skipping memory for %.0fs", type(e).__name__, COOLDOWN)
        raise _unavailable() from e
    except ApiException as e:
        raise MemoryUnavailable(f"Hindsight returned an error ({e.status}): {e.reason}") from e


def reset_cooldown() -> None:
    global _down_until
    _down_until = 0.0


async def ensure_bank(bank_id: str) -> None:
    """Banks are auto-created on first retain, but setting a mission improves what Hindsight
    extracts and how reflect answers. Best-effort: failures here are not fatal."""
    reputation = bank_id == REPUTATION_BANK
    try:
        await _call(
            client().acreate_bank, bank_id,
            retain_mission=REPUTATION_MISSION if reputation else WORKER_MISSION,
            reflect_mission=(
                "Summarise how this employer treats workers' wages, fairly and factually. Never name workers."
                if reputation else
                "Help this worker understand their wages and promises made to them."
            ),
        )
    except MemoryUnavailable as e:
        log.warning("Could not configure bank %s: %s", bank_id, e)


async def retain(bank_id: str, content: str, *, context: str, timestamp: datetime | None = None,
                 metadata: dict[str, str] | None = None, document_id: str | None = None) -> None:
    # retain_async: Hindsight queues fact extraction in the background so chat stays fast.
    await _call(client().aretain, bank_id=bank_id, content=content, context=context,
                timestamp=timestamp, metadata=metadata, document_id=document_id, retain_async=True)


async def retain_batch(bank_id: str, items: list[dict]) -> None:
    await _call(client().aretain_batch, bank_id=bank_id, items=items, retain_async=True)


async def recall(bank_id: str, query: str, limit: int = 8) -> list[dict]:
    """Returns a small list of memories as plain dicts. A bank that doesn't exist yet = no memories."""
    try:
        resp = await _call(client().arecall, bank_id=bank_id, query=query, budget="low", max_tokens=2048)
    except MemoryUnavailable as e:
        if isinstance(e.__cause__, NotFoundException):
            return []
        raise
    out = []
    for r in (resp.results or [])[:limit]:
        when = r.occurred_start or r.mentioned_at
        out.append({
            "id": r.id,
            "text": r.text,
            "type": r.type,
            "date": when.isoformat() if hasattr(when, "isoformat") else when,
            "bank": bank_id,
        })
    return out


async def list_learned(bank_id: str, limit: int = 30) -> dict:
    """Everything Hindsight has extracted into a bank, newest first. This is what the worker's
    memory has *learned* over time (as opposed to recall, which is relevance-ranked)."""
    try:
        resp = await _call(client().alist_memories, bank_id=bank_id, limit=limit)
    except MemoryUnavailable as e:
        if isinstance(e.__cause__, NotFoundException):
            return {"total": 0, "items": []}
        raise
    items = []
    for m in resp.items or []:
        when = m.occurred_start or m.mentioned_at or m.var_date
        items.append({
            "id": m.id,
            "text": m.text,
            "type": m.fact_type,
            "date": when.isoformat() if hasattr(when, "isoformat") else when,
            "bank": bank_id,
        })
    return {"total": resp.total, "items": items}


async def reflect(bank_id: str, query: str, context: str | None = None) -> str:
    """Hindsight's reasoned answer over a bank. Empty string if the bank doesn't exist yet."""
    try:
        resp = await _call(client().areflect, bank_id=bank_id, query=query, budget="low", context=context,
                           timeout=REFLECT_TIMEOUT)
    except MemoryUnavailable as e:
        if isinstance(e.__cause__, NotFoundException):
            return ""
        raise
    return (resp.text or "").strip()


async def delete_bank(bank_id: str) -> bool:
    try:
        await _call(client().adelete_bank, bank_id)
        return True
    except MemoryUnavailable as e:
        if isinstance(e.__cause__, NotFoundException):
            return False
        raise
