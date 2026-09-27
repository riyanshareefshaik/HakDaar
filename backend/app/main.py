"""HakDaar API — FastAPI entrypoint."""
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import chat, db, ledger, llm, memory
from .config import settings
from .health import check_groq, check_hindsight

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    yield
    await memory.close()


app = FastAPI(
    title="HakDaar API",
    description="AI rights companion for migrant and daily-wage workers. Memory by Hindsight.",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Dependency outages become clear 503s instead of stack traces.
@app.exception_handler(llm.LLMUnavailable)
async def _llm_down(_: Request, exc: llm.LLMUnavailable):
    return JSONResponse(status_code=503, content={"detail": str(exc), "service": "groq"})


@app.exception_handler(memory.MemoryUnavailable)
async def _memory_down(_: Request, exc: memory.MemoryUnavailable):
    return JSONResponse(status_code=503, content={"detail": str(exc), "service": "hindsight"})


# ---------------------------------------------------------------- models

class WorkerIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    language: Literal["en", "te", "hi"] = "en"
    phone: str | None = Field(default=None, max_length=20)


class ChatIn(BaseModel):
    worker_id: str = Field(description="Worker id (e.g. from GET /workers) or a unique worker name like 'Ravi'",
                           examples=["Ravi"])
    message: str = Field(min_length=1, max_length=2000)


def _worker_or_404(worker_id: str) -> dict:
    w = db.get_worker(worker_id)
    if not w:
        raise HTTPException(404, f"Worker '{worker_id}' not found. Use an id from GET /workers "
                             f"(or a worker name).")
    return w


# ---------------------------------------------------------------- routes

@app.get("/")
def root():
    return {"name": "HakDaar", "tagline": "Your work. Your wages. Remembered.", "docs": "/docs"}


@app.get("/health")
async def health():
    """Checks Hindsight and Groq in parallel. Always returns 200 so the UI can show details."""
    hindsight, groq = await asyncio.gather(check_hindsight(), check_groq())
    return {
        "status": "ok" if hindsight["ok"] and groq["ok"] else "degraded",
        "hindsight": hindsight,
        "groq": groq,
    }


@app.get("/workers")
def list_workers():
    return db.list_workers()


@app.post("/workers", status_code=201)
async def create_worker(body: WorkerIn):
    w = db.create_worker(body.name.strip(), body.language, body.phone)
    await memory.ensure_bank(memory.worker_bank(w["id"]))  # best-effort, never fails the request
    return w


class WorkerPatch(BaseModel):
    language: Literal["en", "te", "hi"]


@app.patch("/workers/{worker_id}")
def update_worker(worker_id: str, body: WorkerPatch):
    """Change the language HakDaar replies in (the UI's language toggle)."""
    w = _worker_or_404(worker_id)
    db.update_worker_language(w["id"], body.language)
    return db.get_worker(w["id"])


@app.delete("/workers/{worker_id}")
async def delete_worker(worker_id: str):
    """Remove a worker, their ledger, chats and their private memory bank."""
    w = _worker_or_404(worker_id)
    db.delete_worker(w["id"])
    warning = None
    try:
        await memory.delete_bank(memory.worker_bank(w["id"]))
    except memory.MemoryUnavailable as e:
        warning = str(e)
    return {"deleted": w["id"], "warning": warning}


@app.get("/workers/{worker_id}/messages")
def get_messages(worker_id: str, limit: int = 100):
    """Chat history; each user message carries the ledger entries it produced."""
    w = _worker_or_404(worker_id)
    return db.list_messages(w["id"], limit=limit, with_events=True)


@app.get("/workers/{worker_id}/events")
def get_events(worker_id: str):
    w = _worker_or_404(worker_id)
    return db.list_events(w["id"])


@app.delete("/workers/{worker_id}/events/{event_id}")
async def delete_event(worker_id: str, event_id: int):
    """Undo a wrongly recorded entry. The ledger is recomputed, reputation reports for that
    employer are rebuilt, and a correction is retained so memory stays consistent."""
    w = _worker_or_404(worker_id)
    ev = db.get_event(w["id"], event_id)
    if not ev:
        raise HTTPException(404, "Entry not found")
    db.delete_event(w["id"], event_id)
    rows = ledger.summarize(db.list_events(w["id"]))
    chat.rebuild_reputation(w["id"], ev["employer_name"], rows)

    warning = None
    try:
        await memory.retain(
            memory.worker_bank(w["id"]),
            f"Correction from {w['name']}: this earlier record was wrong and has been removed: "
            f"{chat.event_to_memory(ev)}",
            context="worker corrected the wage ledger",
            metadata={"worker_id": w["id"], "kind": "correction"},
        )
    except memory.MemoryUnavailable as e:
        warning = str(e)
    return {"deleted": ev, "ledger": _ledger_payload(w["id"], rows), "warning": warning}


@app.post("/chat")
async def post_chat(body: ChatIn):
    worker = _worker_or_404(body.worker_id)
    return await chat.handle_message(worker, body.message.strip())


def _ledger_payload(worker_id: str, rows: list[dict] | None = None) -> dict:
    events = db.list_events(worker_id)
    rows = rows if rows is not None else ledger.summarize(events)
    # Each employer row carries its underlying entries so the worker can verify every rupee.
    for r in rows:
        r["entries"] = [e for e in events if e["employer_name"] == r["employer_name"]]
    return {"worker_id": worker_id, "employers": rows, "totals": ledger.totals(rows)}


@app.get("/workers/{worker_id}/ledger")
def get_ledger(worker_id: str):
    w = _worker_or_404(worker_id)
    return _ledger_payload(w["id"])


@app.get("/workers/{worker_id}/memories")
async def get_memories(worker_id: str, q: str | None = None):
    w = _worker_or_404(worker_id)
    query = q or (f"What do I know about {w['name']}'s employers, promised daily wages, "
                  f"days worked, payments received and problems?")
    bank = memory.worker_bank(w["id"])
    mems, learned = await asyncio.gather(memory.recall(bank, query, limit=12), memory.list_learned(bank))
    return {"worker_id": w["id"], "bank_id": bank, "query": query, "memories": mems,
            "learned": learned["items"], "total_learned": learned["total"]}


@app.get("/workers/{worker_id}/alerts")
def get_alerts(worker_id: str):
    """Current alerts without sending a message (used when switching workers in the UI)."""
    w = _worker_or_404(worker_id)
    rows = ledger.summarize(db.list_events(w["id"]))
    return chat.build_alerts(w["id"], rows, focus=set())


@app.get("/employers/{name}/reputation")
async def employer_reputation(name: str):
    employer = chat.canonical_employer(name, db.all_employer_names()) or name
    stats = db.employer_report_stats(employer)
    summary, error = None, None
    try:
        summary = await memory.reflect(
            memory.REPUTATION_BANK,
            f"How does {employer} treat workers' wages? Have workers reported short or late payments, "
            f"or were they paid fully and on time? Answer in 2-3 short sentences.",
        )
    except memory.MemoryUnavailable as e:
        error = str(e)
    if not summary and not error and stats["workers_reporting_problems"] + stats["paid_ok"] == 0:
        summary = f"No worker has reported anything about {employer} yet."
    return {"employer_name": employer, "stats": stats, "summary": summary, "error": error}


@app.post("/reset")
async def reset_all():
    """Wipe SQLite and every HakDaar memory bank (fresh start)."""
    bank_ids = [memory.worker_bank(w["id"]) for w in db.list_workers()] + [memory.REPUTATION_BANK]
    db.reset_db()
    deleted, warning = 0, None
    for b in bank_ids:
        try:
            deleted += await memory.delete_bank(b)
        except memory.MemoryUnavailable as e:
            warning = str(e)
            break
    return {"banks_deleted": deleted, "warning": warning}
