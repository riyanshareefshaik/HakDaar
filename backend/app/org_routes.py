"""API for organizations (employer companies and worker-support groups) and the worker's side of it:
invites, and confirming or disputing entries an employer recorded. See orgs.py for the rules."""
import asyncio
import logging
import time
from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from . import auth, chat, db, ledger, memory, orgs, validators
from .config import settings

log = logging.getLogger("hakdaar.orgs")
router = APIRouter()

PIN = Field(pattern=r"^\d{4}$")


def _norm_phone(phone: str) -> str:
    digits = "".join(c for c in phone if c.isdigit())
    return digits[-10:] if len(digits) >= 10 else digits


# ---------------------------------------------------------------- limits (same rules as worker accounts)

_signups: dict[str, list[float]] = {}
_login_failures: dict[str, list[float]] = {}


def _recent(bucket: dict[str, list[float]], key: str, window: float) -> list[float]:
    now = time.time()
    bucket[key] = [t for t in bucket.get(key, []) if now - t < window]
    return bucket[key]


# ---------------------------------------------------------------- who is calling

def _member(request: Request) -> tuple[dict, dict]:
    mid = auth.member_from(request)
    member = orgs.get_member(mid) if mid else None
    org = orgs.get_org(member["org_id"]) if member else None
    if not member or not org:
        raise HTTPException(401, "Please log in again.")
    return member, org


def _need(member: dict, *roles: str) -> None:
    if member["role"] not in roles:
        raise HTTPException(403, "Your role can't do this. Ask your organization's owner.")


def _kind(org: dict, kind: str) -> None:
    if org["kind"] != kind:
        raise HTTPException(403, "Not available for this kind of organization.")


def _active_worker(org: dict, worker_id: str) -> dict:
    link = orgs.link_for(org["id"], worker_id)
    if not link or link["status"] != "active":
        raise HTTPException(404, "This worker hasn't joined your organization.")
    return db.get_worker(worker_id)


def _public_org(org: dict) -> dict:
    keys = ("id", "name", "kind", "verified", "created_at", "category", "city")
    return {k: org.get(k) for k in keys} | {"verified": bool(org["verified"])}


# ---------------------------------------------------------------- sign up / log in

EMPLOYER_CATEGORIES = {
    "construction": "Construction contractor", "builder": "Builder / real-estate developer",
    "factory": "Factory / manufacturing", "shop": "Shop / commercial establishment",
    "hospitality": "Hotel / restaurant", "agriculture": "Agriculture / farm", "transport": "Transport / logistics",
    "household": "Household employer", "other": "Other business",
}
SUPPORT_CATEGORIES = {
    "ngo": "NGO (registered on NGO Darpan)", "union": "Trade union", "labour_office": "Government labour office",
    "legal_aid": "Legal aid / law clinic", "other": "Other workers' group",
}


class OrgRegisterIn(BaseModel):
    org_name: str = Field(min_length=3, max_length=80)
    kind: Literal["employer", "support"]
    category: str = Field(max_length=30)
    # Employers: a GST, Udyam (MSME) or PAN number. Support groups: their registration number.
    reg_type: Literal["gstin", "udyam", "pan", "darpan", "registration"]
    reg_number: str = Field(max_length=40)
    email: str = Field(max_length=120)
    area: str | None = Field(default=None, max_length=80)
    city: str = Field(min_length=2, max_length=60)
    pincode: str = Field(max_length=6)
    phone: str = Field(max_length=20)
    pin: str = PIN
    pin_confirm: str = PIN
    accept_terms: bool = False


def _registration_details(body: OrgRegisterIn) -> dict:
    """Check every sign-up detail and return them cleaned, or raise a clear 422 / 409."""
    if body.kind == "employer":
        if body.category not in EMPLOYER_CATEGORIES:
            raise HTTPException(422, "Choose what kind of business this is.")
        if body.reg_type not in ("gstin", "udyam", "pan"):
            raise HTTPException(422, "Choose GSTIN, Udyam or PAN.")
        if not (body.area or "").strip():
            raise HTTPException(422, "Enter the work-site area (e.g. Kukatpally).")
    else:
        if body.category not in SUPPORT_CATEGORIES:
            raise HTTPException(422, "Choose what kind of organization this is.")
        expected = "darpan" if body.category == "ngo" else "registration"
        if body.reg_type != expected:
            raise HTTPException(422, "Enter the registration number for this kind of organization.")
    reg = validators.normalize_id(body.reg_number)
    error = (validators.business_id_error(body.reg_type, reg) if body.kind == "employer"
             else validators.support_reg_error(body.category, body.reg_number.strip().upper()))
    if body.kind == "support":
        reg = " ".join(body.reg_number.strip().upper().split())
    email = body.email.strip().lower()
    pincode = body.pincode.strip()
    error = error or validators.email_error(email) or validators.pincode_error(pincode)
    if error:
        raise HTTPException(422, error)
    if orgs.find_by_registration(body.reg_type, reg):
        raise HTTPException(409, "An organization with this registration number already exists. "
                                 "If it's yours, ask its owner to add you to the team.")
    if orgs.find_by_email(email):
        raise HTTPException(409, "This email is already used by another organization.")
    return {"category": body.category, "reg_type": body.reg_type, "reg_number": reg, "email": email,
            "area": (body.area or "").strip() or None, "city": body.city.strip(), "pincode": pincode}


@router.get("/org/options")
def org_options():
    """Business / organization types for the sign-up form (one list, shared with the app)."""
    return {"employer": EMPLOYER_CATEGORIES, "support": SUPPORT_CATEGORIES}


@router.post("/org/register", status_code=201)
def org_register(body: OrgRegisterIn, request: Request):
    phone = _norm_phone(body.phone)
    if len(phone) != 10:
        raise HTTPException(422, "Enter a 10-digit mobile number.")
    if body.pin != body.pin_confirm:
        raise HTTPException(422, "The two PINs do not match.")
    if not body.accept_terms:
        raise HTTPException(422, "Please accept the Terms of Use and Privacy Policy.")
    details = _registration_details(body)
    if orgs.member_by_phone(phone):
        raise HTTPException(409, "This phone number already has an organization login. Please log in.")
    if body.kind == "employer" and orgs.find_employer_org(body.org_name):
        raise HTTPException(409, "An employer with this name is already registered. Use a more specific name, "
                                 "e.g. with your area.")
    ip = request.client.host if request.client else "unknown"
    if settings.public_mode and len(_recent(_signups, ip, 24 * 3600)) >= 3:
        raise HTTPException(429, "Too many new organizations from this network today. Please try again tomorrow.")
    _signups.setdefault(ip, []).append(time.time())
    org, member = orgs.create_org(body.org_name, body.kind, phone, body.pin, details)
    return {"org": _public_org(org), "member": member}


class OrgLoginIn(BaseModel):
    phone: str = Field(max_length=20)
    pin: str = Field(max_length=4)


@router.post("/org/login")
def org_login(body: OrgLoginIn):
    phone = _norm_phone(body.phone)
    fails = _recent(_login_failures, phone, 15 * 60)
    if len(fails) >= 5:
        raise HTTPException(429, "Too many wrong PINs. Please wait 15 minutes and try again.")
    row = orgs.member_by_phone(phone)
    if not row or not db.check_pin(body.pin, row["pin_hash"]):
        fails.append(time.time())
        raise HTTPException(401, "Wrong phone number or PIN.")
    _login_failures.pop(phone, None)
    member = orgs.get_member(row["id"])
    return {"member": member, "org": _public_org(orgs.get_org(member["org_id"])),
            "token": auth.issue_member(member["id"])}


@router.get("/org/me")
def org_me(request: Request):
    member, org = _member(request)
    return {"member": member, "org": _public_org(org)}


# ---------------------------------------------------------------- team

class MemberIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    phone: str = Field(max_length=20)
    pin: str = PIN
    role: Literal["manager", "supervisor", "caseworker"]


@router.get("/org/members")
def org_members(request: Request):
    member, org = _member(request)
    return orgs.list_members(org["id"])


@router.post("/org/members", status_code=201)
def org_add_member(body: MemberIn, request: Request):
    member, org = _member(request)
    _need(member, "owner")
    if body.role not in orgs.roles_for(org["kind"]):
        raise HTTPException(422, f"'{body.role}' isn't a role for this organization.")
    phone = _norm_phone(body.phone)
    if len(phone) != 10:
        raise HTTPException(422, "Enter a 10-digit mobile number.")
    if orgs.member_by_phone(phone):
        raise HTTPException(409, "This phone number already has an organization login.")
    return orgs.add_member(org["id"], body.name, phone, body.pin, body.role)


@router.delete("/org/members/{member_id}")
def org_remove_member(member_id: str, request: Request):
    member, org = _member(request)
    _need(member, "owner")
    if member_id == member["id"]:
        raise HTTPException(400, "You can't remove yourself.")
    if not orgs.remove_member(org["id"], member_id):
        raise HTTPException(404, "No such team member.")
    return {"removed": member_id}


# ---------------------------------------------------------------- workers (invites)

class InviteIn(BaseModel):
    phone: str = Field(max_length=20)


@router.post("/org/invites", status_code=201)
def org_invite(body: InviteIn, request: Request):
    member, org = _member(request)
    _need(member, "owner", "manager", "caseworker")
    row = db.find_by_phone(_norm_phone(body.phone))
    if not row:
        raise HTTPException(404, "No HakDaar worker account uses this number yet. Ask them to sign up first.")
    link = orgs.invite(org["id"], row["id"], member["id"])
    return {"status": link["status"], "worker_name": row["name"]}


@router.get("/org/workers")
def org_workers(request: Request):
    member, org = _member(request)
    return orgs.org_links(org["id"])


@router.delete("/org/workers/{worker_id}")
def org_remove_worker(worker_id: str, request: Request):
    member, org = _member(request)
    _need(member, "owner", "manager", "caseworker")
    link = orgs.link_for(org["id"], worker_id)
    if not link or link["status"] not in ("invited", "active"):
        raise HTTPException(404, "This worker isn't linked to your organization.")
    orgs.set_link_status(link["id"], "removed")
    return {"removed": worker_id}


# ---------------------------------------------------------------- employer: entries & dues

class EntryIn(BaseModel):
    type: Literal["work_day", "payment"]
    days: float | None = Field(default=None, ge=0.5, le=60)
    amount: int | None = Field(default=None, ge=1, le=10_000_000)
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    note: str | None = Field(default=None, max_length=200)


@router.post("/org/workers/{worker_id}/entries", status_code=201)
def org_record_entry(worker_id: str, body: EntryIn, request: Request):
    """The employer records days worked or a payment. It waits for the worker to confirm it."""
    member, org = _member(request)
    _kind(org, "employer")
    _active_worker(org, worker_id)
    if body.type == "work_day" and not body.days:
        raise HTTPException(422, "How many days?")
    if body.type == "payment" and not body.amount:
        raise HTTPException(422, "How much was paid?")
    if body.date and body.date > date.today().isoformat():
        raise HTTPException(422, "The date can't be in the future.")
    entry = body.model_dump()
    # Same entry already waiting? Don't add it twice.
    if orgs.find_pending_match(worker_id, {**entry, "employer_name": org["name"],
                                           "date": body.date or date.today().isoformat()}):
        raise HTTPException(409, "This entry is already waiting for the worker's confirmation.")
    return orgs.record_entry(org, member, worker_id, entry)


def _employer_row(org: dict, worker_id: str) -> dict:
    events = [e for e in db.list_events(worker_id) if e["employer_name"].lower() == org["name"].lower()]
    rows = ledger.summarize(events)
    return rows[0] if rows else {"rate_per_day": None, "days_worked": 0, "amount_earned": 0, "amount_paid": 0,
                                 "amount_owed": 0, "advance": 0, "status": "none"}


@router.get("/org/dues")
def org_dues(request: Request):
    """Every linked worker: earned, paid and still owed by this employer (confirmed entries only)."""
    member, org = _member(request)
    _kind(org, "employer")
    out, totals = [], {"earned": 0, "paid": 0, "owed": 0, "advance": 0, "pending": 0, "disputed": 0}
    for link in orgs.org_links(org["id"]):
        if link["status"] != "active":
            continue
        row = _employer_row(org, link["worker_id"])
        counts = orgs.org_entry_counts(org["id"], link["worker_id"])
        item = {
            "worker_id": link["worker_id"], "worker_name": link["worker_name"], "worker_phone": link["worker_phone"],
            "rate_per_day": row["rate_per_day"], "days_worked": row["days_worked"],
            "earned": row["amount_earned"] or 0, "paid": row["amount_paid"] or 0, "owed": row["amount_owed"] or 0,
            "advance": row.get("advance") or 0, "pending": counts.get("pending", 0), "disputed": counts.get("disputed", 0),
        }
        out.append(item)
        for k in totals:
            totals[k] += item[k]
    out.sort(key=lambda r: -r["owed"])
    return {"workers": out, "totals": totals}


@router.get("/org/workers/{worker_id}/entries")
def org_worker_entries(worker_id: str, request: Request):
    """Entries this employer recorded for one worker, with their status."""
    member, org = _member(request)
    _kind(org, "employer")
    _active_worker(org, worker_id)
    with db.connect() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT id, type, amount, days, date, notes, status, dispute_reason, created_at FROM events "
            "WHERE org_id = ? AND worker_id = ? ORDER BY id DESC", (org["id"], worker_id))]


# ---------------------------------------------------------------- employer: reputation

async def _reflect(name: str) -> tuple[str | None, str | None]:
    try:
        return await memory.reflect(
            memory.REPUTATION_BANK,
            f"How does {name} treat workers' wages? Have workers reported short or late payments, or were they "
            f"paid fully and on time? Answer in 2-3 short sentences. These are unverified reports from workers: "
            f"say how many workers reported what, mention anyone paid in full, and do not call anyone dishonest.",
        ), None
    except memory.MemoryUnavailable as e:
        return None, str(e)


@router.get("/org/reputation")
async def org_reputation(request: Request):
    """What workers have reported about this employer. Never who reported."""
    member, org = _member(request)
    _kind(org, "employer")
    summary, error = await _reflect(org["name"])
    return {"employer_name": org["name"], "verified": bool(org["verified"]),
            "stats": db.employer_report_stats(org["name"]), "summary": summary, "error": error,
            "replies": orgs.list_replies(org["id"])}


class ReplyIn(BaseModel):
    text: str = Field(min_length=3, max_length=500)


@router.post("/org/reputation/reply", status_code=201)
def org_reply(body: ReplyIn, request: Request):
    member, org = _member(request)
    _kind(org, "employer")
    _need(member, "owner", "manager")
    if not org["verified"]:
        raise HTTPException(403, "Replies are shown once HakDaar has verified your organization.")
    return orgs.add_reply(org, body.text)


# ---------------------------------------------------------------- support organizations: cases

@router.get("/org/cases")
def org_cases(request: Request):
    member, org = _member(request)
    _kind(org, "support")
    out = []
    for link in orgs.org_links(org["id"]):
        if link["status"] != "active":
            continue
        rows = ledger.summarize(db.list_events(link["worker_id"]))
        t = ledger.totals(rows)
        disputed = len(orgs.entries_for_worker(link["worker_id"], ("disputed",)))
        out.append({"worker_id": link["worker_id"], "worker_name": link["worker_name"],
                    "worker_phone": link["worker_phone"], "case_status": link["case_status"],
                    "owed": t["amount_owed"], "paid": t["amount_paid"], "earned": t["amount_earned"],
                    "employers_owing": [r["employer_name"] for r in rows if (r["amount_owed"] or 0) > 0],
                    "disputed": disputed, "notes": len(orgs.list_notes(org["id"], link["worker_id"]))})
    out.sort(key=lambda c: (c["case_status"] != "open", -c["owed"]))
    return out


@router.get("/org/cases/{worker_id}")
def org_case(worker_id: str, request: Request):
    member, org = _member(request)
    _kind(org, "support")
    w = _active_worker(org, worker_id)
    rows = ledger.summarize(db.list_events(worker_id))
    return {"worker": {"id": w["id"], "name": w["name"], "phone": w["phone"]},
            "case_status": orgs.link_for(org["id"], worker_id)["case_status"],
            "ledger": rows, "totals": ledger.totals(rows),
            "disputes": orgs.entries_for_worker(worker_id, ("disputed",)),
            "notes": orgs.list_notes(org["id"], worker_id)}


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


@router.post("/org/cases/{worker_id}/notes", status_code=201)
def org_add_note(worker_id: str, body: NoteIn, request: Request):
    member, org = _member(request)
    _kind(org, "support")
    _active_worker(org, worker_id)
    return orgs.add_note(org["id"], worker_id, member["id"], body.text)


class CaseStatusIn(BaseModel):
    status: Literal["open", "resolved"]


@router.patch("/org/cases/{worker_id}")
def org_case_status(worker_id: str, body: CaseStatusIn, request: Request):
    member, org = _member(request)
    _kind(org, "support")
    _active_worker(org, worker_id)
    orgs.set_case_status(org["id"], worker_id, body.status)
    return {"worker_id": worker_id, "case_status": body.status}


# ---------------------------------------------------------------- the worker's side

def _worker(worker_id: str) -> dict:
    w = db.get_worker(worker_id)
    if not w or w["id"] != worker_id:
        raise HTTPException(404, "Worker not found.")
    return w


@router.get("/workers/{worker_id}/organizations")
def worker_orgs(worker_id: str):
    """Invites waiting for an answer, organizations joined, and employer entries waiting for an OK."""
    _worker(worker_id)
    links = orgs.worker_links(worker_id)
    names = db.employer_names_for_worker(worker_id)
    for link in links:
        if link["status"] == "invited" and link["kind"] == "employer":
            # Suggest which of the worker's employers this is (they choose; nothing merges without them).
            link["suggested_alias"] = next(
                (n for n in names if chat.canonical_employer(n, [link["org_name"]]) == link["org_name"]), None)
        link["verified"] = bool(link["verified"])
    return {"invites": [l for l in links if l["status"] == "invited"],
            "joined": [l for l in links if l["status"] == "active"],
            "my_employers": names,
            "pending": orgs.entries_for_worker(worker_id, ("pending",)),
            "disputed": orgs.entries_for_worker(worker_id, ("disputed",))}


class InviteAnswerIn(BaseModel):
    accept: bool
    employer_alias: str | None = Field(default=None, max_length=80)


@router.post("/workers/{worker_id}/invites/{link_id}")
def worker_answer_invite(worker_id: str, link_id: int, body: InviteAnswerIn):
    _worker(worker_id)
    link = orgs.get_link(link_id)
    if not link or link["worker_id"] != worker_id or link["status"] != "invited":
        raise HTTPException(404, "This invite is no longer open.")
    org = orgs.get_org(link["org_id"])
    if not body.accept:
        orgs.set_link_status(link_id, "declined")
        return {"status": "declined"}
    merged = 0
    if org["kind"] == "employer" and body.employer_alias:
        if body.employer_alias not in db.employer_names_for_worker(worker_id):
            raise HTTPException(422, "Pick one of your employers, or none.")
        merged = orgs.merge_employer_name(worker_id, body.employer_alias, org["name"])
    orgs.set_link_status(link_id, "active")
    return {"status": "active", "merged_entries": merged}


@router.delete("/workers/{worker_id}/organizations/{link_id}")
def worker_leave_org(worker_id: str, link_id: int):
    """A worker can leave any organization at any time; it then sees nothing new about them."""
    _worker(worker_id)
    link = orgs.get_link(link_id)
    if not link or link["worker_id"] != worker_id or link["status"] != "active":
        raise HTTPException(404, "You're not in this organization.")
    orgs.set_link_status(link_id, "removed")
    return {"status": "removed"}


async def _after_confirm(worker: dict, event: dict) -> None:
    """Keep reputation and memory in step with a newly confirmed employer entry."""
    current = ledger.summarize(db.list_events(worker["id"]))
    reports = chat.record_reputation(worker["id"], current, {event["employer_name"]}) if event["type"] == "payment" else []
    fact = chat.event_to_memory(event)
    try:
        await memory.retain(memory.worker_bank(worker["id"]),
                            f"{worker['name']} confirmed an entry recorded by their employer: {fact}",
                            context="employer entry confirmed by worker", metadata={"worker_id": worker["id"]})
        for employer, kind, summary in reports:
            await memory.retain(memory.REPUTATION_BANK, summary, context=f"anonymous wage report ({kind})",
                                metadata={"employer": employer, "kind": kind})
    except Exception as e:  # noqa: BLE001 - memory is best effort; the ledger is already right
        log.warning("memory update after confirm failed: %s", e)


@router.post("/workers/{worker_id}/entries/{event_id}/confirm")
async def worker_confirm_entry(worker_id: str, event_id: int):
    w = _worker(worker_id)
    kept = orgs.confirm_entry(worker_id, event_id)
    if not kept:
        raise HTTPException(404, "This entry isn't waiting for your confirmation.")
    await _after_confirm(w, kept)
    rows = ledger.summarize(db.list_events(worker_id))
    return {"kept": kept, "merged": kept["id"] != event_id, "totals": ledger.totals(rows)}


class DisputeIn(BaseModel):
    reason: str | None = Field(default=None, max_length=200)


@router.post("/workers/{worker_id}/entries/{event_id}/dispute")
def worker_dispute_entry(worker_id: str, event_id: int, body: DisputeIn):
    _worker(worker_id)
    e = orgs.dispute_entry(worker_id, event_id, body.reason)
    if not e:
        raise HTTPException(404, "This entry isn't waiting for your confirmation.")
    return e
