"""HakDaar API — FastAPI entrypoint."""
import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import auth, chat, db, ledger, llm, memory, nudges
from .config import settings
from .health import check_groq, check_hindsight

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("hakdaar.api")


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


@app.middleware("http")
async def _own_data_only(request: Request, call_next):
    """Every /workers/{id}/... route needs that worker's session token (public mode only)."""
    parts = request.url.path.strip("/").split("/")
    if settings.public_mode and len(parts) >= 2 and parts[0] == "workers" and request.method != "OPTIONS":
        try:
            auth.require(request, parts[1])
        except HTTPException as e:
            return JSONResponse(status_code=e.status_code, content={"detail": e.detail})
    return await call_next(request)


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


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    phone: str = Field(min_length=6, max_length=20)
    pin: str = Field(pattern=r"^\d{4}$")
    pin_confirm: str | None = Field(default=None, pattern=r"^\d{4}$")
    language: Literal["en", "te", "hi"] = "en"
    recovery_question: int | None = Field(default=None, ge=1, le=4)
    recovery_answer: str | None = Field(default=None, min_length=2, max_length=80)
    accept_terms: bool = False


class RecoveryLookupIn(BaseModel):
    phone: str = Field(min_length=6, max_length=20)


class ResetPinIn(BaseModel):
    phone: str = Field(min_length=6, max_length=20)
    answer: str = Field(min_length=1, max_length=80)
    new_pin: str = Field(pattern=r"^\d{4}$")


class LoginIn(BaseModel):
    phone: str = Field(min_length=6, max_length=20)
    pin: str = Field(pattern=r"^\d{4}$")


def _norm_phone(phone: str) -> str:
    digits = "".join(c for c in phone if c.isdigit())
    return digits[-10:] if len(digits) >= 10 else digits  # '+91 98765 43210' == '9876543210'


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
        "public_mode": settings.public_mode,
    }


@app.get("/workers")
def list_workers():
    auth.demo_only()
    return db.list_workers()


@app.post("/workers", status_code=201)
async def create_worker(body: WorkerIn):
    auth.demo_only()
    w = db.create_worker(body.name.strip(), body.language, body.phone)
    await memory.ensure_bank(memory.worker_bank(w["id"]))  # best-effort, never fails the request
    return w


@app.post("/auth/register", status_code=201)
async def register(body: RegisterIn):
    """Create an account with a phone number and a 4-digit PIN (simple enough for any phone user).
    Note: hackathon-grade identification, not production authentication."""
    phone = _norm_phone(body.phone)
    if len(phone) != 10:
        raise HTTPException(422, "Enter a 10-digit mobile number.")
    if body.pin_confirm is not None and body.pin_confirm != body.pin:
        raise HTTPException(422, "The two PINs do not match.")
    if not body.accept_terms:
        raise HTTPException(422, "Please accept the Terms of Use and Privacy Policy.")
    if bool(body.recovery_question) != bool(body.recovery_answer and body.recovery_answer.strip()):
        raise HTTPException(422, "Choose a security question and write its answer.")
    if db.find_by_phone(phone):
        raise HTTPException(409, "This phone number already has an account. Please log in.")
    w = db.create_worker(body.name.strip(), body.language, phone, body.pin,
                         recovery_question=body.recovery_question, recovery_answer=body.recovery_answer,
                         terms_accepted=True)
    await memory.ensure_bank(memory.worker_bank(w["id"]))
    return w


# Free PIN recovery (no paid SMS): answer the security question chosen at sign-up.
# A simple in-memory limit stops someone from guessing answers endlessly.
_reset_failures: dict[str, list[float]] = {}
RESET_MAX_FAILURES, RESET_WINDOW_S = 5, 15 * 60


def _reset_blocked(phone: str) -> bool:
    import time
    recent = [t for t in _reset_failures.get(phone, []) if time.time() - t < RESET_WINDOW_S]
    _reset_failures[phone] = recent
    return len(recent) >= RESET_MAX_FAILURES


@app.post("/auth/recovery-question")
def recovery_question(body: RecoveryLookupIn):
    row = db.find_by_phone(_norm_phone(body.phone))
    if not row:
        raise HTTPException(404, "No account found for this phone number.")
    if not row.get("recovery_question") or not row.get("recovery_hash"):
        raise HTTPException(409, "This account has no security question. Please create a new account.")
    return {"question": row["recovery_question"]}


@app.post("/auth/reset-pin")
def reset_pin(body: ResetPinIn):
    import time
    phone = _norm_phone(body.phone)
    if _reset_blocked(phone):
        raise HTTPException(429, "Too many wrong answers. Please try again after 15 minutes.")
    row = db.find_by_phone(phone)
    if not row or not row.get("recovery_hash") or not db.check_pin(db.normalize_answer(body.answer), row["recovery_hash"]):
        _reset_failures.setdefault(phone, []).append(time.time())
        raise HTTPException(401, "That answer does not match. Please try again.")
    db.set_pin(row["id"], body.new_pin)
    _reset_failures.pop(phone, None)
    return {"ok": True}


@app.post("/auth/login")
def login(body: LoginIn):
    row = db.find_by_phone(_norm_phone(body.phone))
    if not row or not db.check_pin(body.pin, row.get("pin_hash")):
        raise HTTPException(401, "Wrong phone number or PIN.")
    return {**db.get_worker(row["id"]), "token": auth.issue(row["id"])}


class WorkerPatch(BaseModel):
    language: Literal["en", "te", "hi"]


@app.patch("/workers/{worker_id}")
def update_worker(worker_id: str, body: WorkerPatch):
    """Change the language HakDaar replies in (the UI's language toggle)."""
    w = _worker_or_404(worker_id)
    db.update_worker_language(w["id"], body.language)
    return db.get_worker(w["id"])


@app.get("/workers/{worker_id}")
def get_worker(worker_id: str):
    return _worker_or_404(worker_id)


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
async def post_chat(body: ChatIn, request: Request, stream: bool = False):
    """With ?stream=true the answer is NDJSON in two parts: {"stage": "recorded", ledger, ...} as soon
    as the facts are saved (so the wallet updates instantly), then {"stage": "done", ...the full reply}."""
    auth.require(request, body.worker_id)
    worker = _worker_or_404(body.worker_id)
    if not stream:
        return await chat.handle_message(worker, body.message.strip())

    queue: asyncio.Queue = asyncio.Queue()

    async def recorded(events, alerts):
        await queue.put({"stage": "recorded", "extracted_events": events, "alerts": alerts,
                         "ledger": _ledger_payload(worker["id"])})

    async def run():
        try:
            result = await chat.handle_message(worker, body.message.strip(), on_recorded=recorded)
            await queue.put({"stage": "done", **result})
        except Exception as e:  # noqa: BLE001 - reported to the client below
            await queue.put(e)

    task = asyncio.create_task(run())
    first = await queue.get()
    if isinstance(first, Exception):
        raise first  # nothing saved yet: normal error response (503 if Groq is down)

    async def lines():
        item = first
        while True:
            if isinstance(item, Exception):
                log.exception("chat failed after recording", exc_info=item)
                yield json.dumps({"stage": "error", "detail": str(item) or "Something went wrong."}) + "\n"
                break
            yield json.dumps(item, default=str) + "\n"
            if item["stage"] == "done":
                break
            item = await queue.get()
        await task

    return StreamingResponse(lines(), media_type="application/x-ndjson")


def _ledger_payload(worker_id: str, rows: list[dict] | None = None) -> dict:
    events = db.list_events(worker_id)
    rows = rows if rows is not None else ledger.summarize(events)
    # Each employer row carries its underlying entries so the worker can verify every rupee.
    for r in rows:
        r["entries"] = [e for e in events if e["employer_name"] == r["employer_name"]]
    return {"worker_id": worker_id, "employers": rows, "totals": ledger.totals(rows)}


MAX_AUDIO_BYTES = 10 * 1024 * 1024  # ~10 minutes of compressed speech; Groq's limit is 25 MB


@app.post("/transcribe")
async def transcribe(request: Request, audio: UploadFile = File(...),
                     language: Literal["en", "te", "hi"] | None = Form(None)):
    """Voice input: the browser records audio, Groq Whisper turns it into text."""
    auth.require_any(request)
    data = await audio.read()
    if not data:
        raise HTTPException(400, "The recording was empty. Please try again.")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "The recording is too long. Please keep it under a few minutes.")
    text = await llm.transcribe(data, audio.filename or "speech.webm", language)
    return {"text": text}


@app.get("/workers/{worker_id}/welcome")
async def get_welcome(worker_id: str):
    """Welcome-back greeting (LLM + Hindsight recall) and follow-up nudges (exact, from the ledger)."""
    return await nudges.welcome(_worker_or_404(worker_id))


@app.get("/workers/{worker_id}/nudges")
def get_nudges(worker_id: str):
    return nudges.compute_nudges(_worker_or_404(worker_id)["id"])


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
    """Wipe SQLite and every HakDaar memory bank (fresh start). Local demo only."""
    auth.demo_only()
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
