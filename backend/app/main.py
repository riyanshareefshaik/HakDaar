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

from . import auth, chat, db, ledger, llm, memory, nudges, orgs
from .org_routes import router as org_router
from .config import settings
from .health import check_groq, check_hindsight

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("hakdaar.api")


def ensure_admin() -> None:
    """Create the admin account from ADMIN_PHONE / ADMIN_NAME / ADMIN_PIN (env only), or reset its
    PIN to ADMIN_PIN, so the admin PIN always matches the server settings."""
    if not (settings.admin_phone and settings.admin_pin):
        return
    if len(settings.admin_phone) != 10 or not (settings.admin_pin.isdigit() and len(settings.admin_pin) == 4):
        log.warning("ADMIN_PHONE must be 10 digits and ADMIN_PIN 4 digits; admin account not set up")
        return
    row = db.find_by_phone(settings.admin_phone)
    if row:
        db.set_pin(row["id"], settings.admin_pin)
    else:
        db.create_worker(settings.admin_name, "en", settings.admin_phone, settings.admin_pin, terms_accepted=True)
    log.info("Admin account ready for the configured ADMIN_PHONE")


def is_admin(worker: dict | None) -> bool:
    return bool(worker and settings.admin_phone and worker.get("phone") == settings.admin_phone)


def _with_role(worker: dict) -> dict:
    return {**worker, "is_admin": is_admin(worker)}


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    ensure_admin()
    yield
    await memory.close()


app = FastAPI(
    title="HakDaar API",
    description="AI rights companion for migrant and daily-wage workers. Memory by Hindsight.",
    version="0.2.0",
    lifespan=lifespan,
)

app.include_router(org_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex or None,
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


# One person shouldn't be able to make many accounts (e.g. to post fake reports about an employer).
# In public mode, allow a few new accounts per network per day. In memory, like the PIN-reset limit.
_signups: dict[str, list[float]] = {}
SIGNUPS_PER_DAY = 5


def _signup_allowed(ip: str) -> bool:
    import time
    now = time.time()
    recent = [t for t in _signups.get(ip, []) if now - t < 24 * 3600]
    _signups[ip] = recent
    if len(recent) >= SIGNUPS_PER_DAY:
        return False
    recent.append(now)
    return True


@app.post("/auth/register", status_code=201)
async def register(body: RegisterIn, request: Request):
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
    if settings.admin_phone and phone == settings.admin_phone:
        raise HTTPException(409, "This phone number can't be used for a new account.")
    if settings.public_mode and not _signup_allowed(request.client.host if request.client else "unknown"):
        raise HTTPException(429, "Too many new accounts from this network today. Please try again tomorrow.")
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
    if settings.admin_phone and _norm_phone(body.phone) == settings.admin_phone:
        raise HTTPException(409, "This account's PIN can only be changed on the server.")
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
    if settings.admin_phone and phone == settings.admin_phone:
        raise HTTPException(409, "This account's PIN can only be changed on the server.")
    if _reset_blocked(phone):
        raise HTTPException(429, "Too many wrong answers. Please try again after 15 minutes.")
    row = db.find_by_phone(phone)
    if not row or not row.get("recovery_hash") or not db.check_pin(db.normalize_answer(body.answer), row["recovery_hash"]):
        _reset_failures.setdefault(phone, []).append(time.time())
        raise HTTPException(401, "That answer does not match. Please try again.")
    db.set_pin(row["id"], body.new_pin)
    _reset_failures.pop(phone, None)
    return {"ok": True}


# A 4-digit PIN has only 10,000 possibilities, so wrong guesses are limited per phone number.
_login_failures: dict[str, list[float]] = {}
LOGIN_MAX_FAILURES, LOGIN_WINDOW_S = 5, 15 * 60


@app.post("/auth/login")
def login(body: LoginIn):
    import time
    phone = _norm_phone(body.phone)
    now = time.time()
    recent = [t for t in _login_failures.get(phone, []) if now - t < LOGIN_WINDOW_S]
    _login_failures[phone] = recent
    if len(recent) >= LOGIN_MAX_FAILURES:
        raise HTTPException(429, "Too many wrong PINs. Please wait 15 minutes and try again.")
    row = db.find_by_phone(phone)
    if not row or not db.check_pin(body.pin, row.get("pin_hash")):
        recent.append(now)
        raise HTTPException(401, "Wrong phone number or PIN.")
    _login_failures.pop(phone, None)
    return {**_with_role(db.get_worker(row["id"])), "token": auth.issue(row["id"])}


class WorkerPatch(BaseModel):
    language: Literal["en", "te", "hi"]


@app.patch("/workers/{worker_id}")
def update_worker(worker_id: str, body: WorkerPatch):
    """Change the language HakDaar replies in (the UI's language toggle)."""
    w = _worker_or_404(worker_id)
    db.update_worker_language(w["id"], body.language)
    return _with_role(db.get_worker(w["id"]))


@app.get("/workers/{worker_id}")
def get_worker(worker_id: str):
    return _with_role(_worker_or_404(worker_id))


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
    if not ev or ev["status"] != "confirmed":
        raise HTTPException(404, "Entry not found")
    # An employer's entry goes back to 'waiting for your OK' rather than disappearing.
    orgs.undo_entry(w["id"], ev)
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
            f"or were they paid fully and on time? Answer in 2-3 short sentences. These are unverified "
            f"reports from workers: say how many workers reported what, mention anyone who was paid "
            f"in full, and do not call the employer dishonest.",
        )
    except memory.MemoryUnavailable as e:
        error = str(e)
    if not summary and not error and stats["workers_reporting_problems"] + stats["paid_ok"] == 0:
        summary = f"No worker has reported anything about {employer} yet."
    return {"employer_name": employer, "stats": stats, "summary": summary, "error": error,
            "employer_reply": orgs.latest_verified_reply(employer)}


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


# ---------------------------------------------------------------- admin dashboard

def _require_admin(request: Request) -> dict:
    """Only the signed-in admin account (ADMIN_PHONE), in every mode."""
    wid = auth.worker_from(request)
    worker = db.get_worker(wid) if wid else None
    if not worker or worker["id"] != wid:
        raise HTTPException(401, "Please log in again.")
    if not is_admin(worker):
        raise HTTPException(403, "Admins only.")
    return worker


@app.get("/admin/overview")
def admin_overview(request: Request):
    _require_admin(request)
    stats = db.admin_overview()
    owed = paid = 0
    for w in db.list_workers():
        t = ledger.totals(ledger.summarize(db.list_events(w["id"])))
        owed += t["amount_owed"]
        paid += t["amount_paid"]
    return {**stats, "total_owed": owed, "total_paid": paid}


@app.get("/admin/workers")
def admin_workers(request: Request):
    _require_admin(request)
    out = []
    for w in db.admin_workers():
        t = ledger.totals(ledger.summarize(db.list_events(w["id"])))
        out.append({**w, "is_admin": is_admin(w), "owed": t["amount_owed"], "paid": t["amount_paid"]})
    return out


@app.delete("/admin/workers/{worker_id}")
async def admin_delete_worker(worker_id: str, request: Request):
    """Remove an account (e.g. a fake one), with its chats, ledger, reports and private memory."""
    admin = _require_admin(request)
    w = db.get_worker(worker_id)
    if not w or w["id"] != worker_id:
        raise HTTPException(404, "No such account.")
    if w["id"] == admin["id"]:
        raise HTTPException(400, "You can't delete the admin account.")
    db.delete_worker(w["id"])
    warning = None
    try:
        await memory.delete_bank(memory.worker_bank(w["id"]))
    except memory.MemoryUnavailable as e:
        warning = str(e)
    return {"deleted": w["id"], "warning": warning}


@app.get("/admin/reports")
def admin_reports(request: Request):
    _require_admin(request)
    return db.admin_reports()


@app.delete("/admin/reports/{report_id}")
def admin_delete_report(report_id: int, request: Request):
    """Remove a report you believe is false. Warnings are recounted from the remaining reports."""
    _require_admin(request)
    if not db.delete_report(report_id):
        raise HTTPException(404, "No such report.")
    return {"deleted": report_id}


@app.post("/admin/reset")
async def admin_reset(request: Request):
    """Delete ALL data: every account, chat, ledger, report and memory bank. The admin account is
    recreated from the server settings, so the admin just logs in again."""
    _require_admin(request)
    bank_ids = [memory.worker_bank(w["id"]) for w in db.list_workers()] + [memory.REPUTATION_BANK]
    db.reset_db()
    ensure_admin()
    deleted, warning = 0, None
    for b in bank_ids:
        try:
            deleted += await memory.delete_bank(b)
        except memory.MemoryUnavailable as e:
            warning = str(e)
            break
    return {"banks_deleted": deleted, "warning": warning}


@app.get("/admin/orgs")
def admin_orgs(request: Request):
    _require_admin(request)
    return [{**o, "verified": bool(o["verified"])} for o in orgs.list_orgs()]


class VerifyIn(BaseModel):
    verified: bool


@app.post("/admin/orgs/{org_id}/verify")
def admin_verify_org(org_id: str, body: VerifyIn, request: Request):
    """Verified employer organizations can reply publicly to reports; workers see a 'verified' badge."""
    _require_admin(request)
    if not orgs.set_verified(org_id, body.verified):
        raise HTTPException(404, "No such organization.")
    return {"id": org_id, "verified": body.verified}


@app.delete("/admin/orgs/{org_id}")
def admin_delete_org(org_id: str, request: Request):
    _require_admin(request)
    if not orgs.delete_org(org_id):
        raise HTTPException(404, "No such organization.")
    return {"deleted": org_id}
