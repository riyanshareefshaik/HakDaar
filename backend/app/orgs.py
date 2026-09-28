"""Organizations: employer companies and worker-support groups, their logins, and linked workers.

Rules that keep the data honest and free of duplicates:
- A worker is linked to an organization only after they accept its invite.
- Entries an employer records are 'pending' until the worker confirms them; only confirmed entries
  count in the ledger. A disputed entry never counts.
- Confirming an employer entry that matches one the worker already made keeps ONE entry: the
  worker's, marked as verified by the employer. The employer's copy is kept as 'merged' for the record.
- When the worker mentions a payment or work that matches a pending employer entry, that entry is
  confirmed instead of a second one being created (see find_pending_match, used by chat).
"""
import uuid
from datetime import date, datetime

from . import db

EMPLOYER_ROLES = ("owner", "manager", "supervisor")
SUPPORT_ROLES = ("owner", "caseworker")
# Days apart two entries can be and still be the same payment / work.
MATCH_WINDOW_DAYS = 3


def roles_for(kind: str) -> tuple[str, ...]:
    return EMPLOYER_ROLES if kind == "employer" else SUPPORT_ROLES


def _id(prefix: str, name: str) -> str:
    slug = "".join(c for c in name.lower() if c.isalnum())[:12] or prefix
    return f"{slug}-{uuid.uuid4().hex[:6]}"


# ---------------------------------------------------------------- organizations & members

def find_employer_org(name: str) -> dict | None:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM organizations WHERE kind = 'employer' AND lower(name) = lower(?)",
                           (name.strip(),)).fetchone()
        return dict(row) if row else None


ORG_DETAILS = ("category", "reg_type", "reg_number", "email", "area", "city", "pincode")


def find_by_registration(reg_type: str, reg_number: str) -> dict | None:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM organizations WHERE reg_type = ? AND reg_number = ?",
                           (reg_type, reg_number)).fetchone()
        return dict(row) if row else None


def find_by_email(email: str) -> dict | None:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM organizations WHERE lower(email) = lower(?)", (email,)).fetchone()
        return dict(row) if row else None


def create_org(name: str, kind: str, phone: str, pin: str, details: dict) -> tuple[dict, dict]:
    """The organization and its owner login (the owner is the organization itself; no personal name)."""
    org = {"id": _id("org", name), "name": name.strip(), "kind": kind, "verified": 0, "created_at": db.now_iso(),
           **{k: details.get(k) for k in ORG_DETAILS}}
    member = {"id": _id("member", name), "org_id": org["id"], "name": org["name"], "phone": phone,
              "role": "owner", "created_at": db.now_iso()}
    with db.connect() as conn:
        cols = ["id", "name", "kind", "verified", "created_at", *ORG_DETAILS]
        conn.execute(f"INSERT INTO organizations ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                     [org[c] for c in cols])
        conn.execute("INSERT INTO org_members (id, org_id, name, phone, pin_hash, role, created_at) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?)",
                     (member["id"], org["id"], member["name"], phone, db.hash_pin(pin), "owner", member["created_at"]))
    return org, member


def get_org(org_id: str) -> dict | None:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM organizations WHERE id = ?", (org_id,)).fetchone()
        return dict(row) if row else None


def member_by_phone(phone: str) -> dict | None:
    """Includes pin_hash; only for the login check."""
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM org_members WHERE phone = ?", (phone,)).fetchone()
        return dict(row) if row else None


def get_member(member_id: str) -> dict | None:
    with db.connect() as conn:
        row = conn.execute("SELECT id, org_id, name, phone, role, created_at FROM org_members WHERE id = ?",
                           (member_id,)).fetchone()
        return dict(row) if row else None


def list_members(org_id: str) -> list[dict]:
    with db.connect() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT id, org_id, name, phone, role, created_at FROM org_members WHERE org_id = ? ORDER BY created_at",
            (org_id,))]


def add_member(org_id: str, name: str, phone: str, pin: str, role: str) -> dict:
    m = {"id": _id("member", name), "org_id": org_id, "name": name.strip(), "phone": phone, "role": role,
         "created_at": db.now_iso()}
    with db.connect() as conn:
        conn.execute("INSERT INTO org_members (id, org_id, name, phone, pin_hash, role, created_at) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?)",
                     (m["id"], org_id, m["name"], phone, db.hash_pin(pin), role, m["created_at"]))
    return m


def remove_member(org_id: str, member_id: str) -> bool:
    with db.connect() as conn:
        return conn.execute("DELETE FROM org_members WHERE id = ? AND org_id = ?", (member_id, org_id)).rowcount > 0


def set_verified(org_id: str, verified: bool) -> bool:
    with db.connect() as conn:
        return conn.execute("UPDATE organizations SET verified = ? WHERE id = ?",
                            (1 if verified else 0, org_id)).rowcount > 0


def delete_org(org_id: str) -> bool:
    """Removes the organization, its logins, links, notes and replies, and any entries still waiting
    for a worker's OK. Entries workers already confirmed stay in their ledgers."""
    with db.connect() as conn:
        conn.execute("DELETE FROM events WHERE org_id = ? AND status = 'pending'", (org_id,))
        for table in ("org_replies", "org_notes", "org_links", "org_members"):
            conn.execute(f"DELETE FROM {table} WHERE org_id = ?", (org_id,))
        return conn.execute("DELETE FROM organizations WHERE id = ?", (org_id,)).rowcount > 0


def list_orgs() -> list[dict]:
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("""
            SELECT o.*,
                   (SELECT COUNT(*) FROM org_members m WHERE m.org_id = o.id) AS members,
                   (SELECT COUNT(*) FROM org_links l WHERE l.org_id = o.id AND l.status = 'active') AS workers,
                   (SELECT phone FROM org_members m WHERE m.org_id = o.id AND m.role = 'owner' LIMIT 1) AS owner_phone
            FROM organizations o ORDER BY o.created_at DESC""")]


# ---------------------------------------------------------------- links (invites)

def get_link(link_id: int) -> dict | None:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM org_links WHERE id = ?", (link_id,)).fetchone()
        return dict(row) if row else None


def link_for(org_id: str, worker_id: str) -> dict | None:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM org_links WHERE org_id = ? AND worker_id = ?", (org_id, worker_id)).fetchone()
        return dict(row) if row else None


def invite(org_id: str, worker_id: str, member_id: str) -> dict:
    """Create an invite, or renew a declined/removed one. An active link stays as it is."""
    existing = link_for(org_id, worker_id)
    with db.connect() as conn:
        if existing is None:
            conn.execute("INSERT INTO org_links (org_id, worker_id, status, invited_by, created_at) "
                         "VALUES (?, ?, 'invited', ?, ?)", (org_id, worker_id, member_id, db.now_iso()))
        elif existing["status"] in ("declined", "removed"):
            conn.execute("UPDATE org_links SET status = 'invited', invited_by = ?, created_at = ?, responded_at = NULL "
                         "WHERE id = ?", (member_id, db.now_iso(), existing["id"]))
    return link_for(org_id, worker_id)


def set_link_status(link_id: int, status: str) -> None:
    with db.connect() as conn:
        conn.execute("UPDATE org_links SET status = ?, responded_at = ? WHERE id = ?", (status, db.now_iso(), link_id))


def set_case_status(org_id: str, worker_id: str, status: str) -> None:
    with db.connect() as conn:
        conn.execute("UPDATE org_links SET case_status = ? WHERE org_id = ? AND worker_id = ?", (status, org_id, worker_id))


def worker_links(worker_id: str, statuses: tuple[str, ...] = ("invited", "active")) -> list[dict]:
    marks = ",".join("?" * len(statuses))
    with db.connect() as conn:
        return [dict(r) for r in conn.execute(f"""
            SELECT l.id, l.status, l.created_at, o.id AS org_id, o.name AS org_name, o.kind, o.verified
            FROM org_links l JOIN organizations o ON o.id = l.org_id
            WHERE l.worker_id = ? AND l.status IN ({marks}) ORDER BY l.created_at DESC""",
            (worker_id, *statuses))]


def org_links(org_id: str) -> list[dict]:
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("""
            SELECT l.id, l.status, l.case_status, l.created_at, l.responded_at,
                   w.id AS worker_id, w.name AS worker_name, w.phone AS worker_phone
            FROM org_links l JOIN workers w ON w.id = l.worker_id
            WHERE l.org_id = ? AND l.status IN ('invited', 'active') ORDER BY w.name""", (org_id,))]


def merge_employer_name(worker_id: str, alias: str, org_name: str) -> int:
    """The worker says their 'Rakesh' is this organization: move those entries (and their report,
    without doubling it) onto the organization's name, so the ledger has one row for it."""
    if not alias or alias == org_name:
        return 0
    with db.connect() as conn:
        n = conn.execute("UPDATE events SET employer_name = ? WHERE worker_id = ? AND employer_name = ?",
                         (org_name, worker_id, alias)).rowcount
        for r in conn.execute("SELECT id, kind FROM employer_reports WHERE worker_id = ? AND employer_name = ?",
                              (worker_id, alias)).fetchall():
            dup = conn.execute("SELECT 1 FROM employer_reports WHERE worker_id = ? AND lower(employer_name) = lower(?) "
                               "AND kind = ?", (worker_id, org_name, r["kind"])).fetchone()
            if dup:
                conn.execute("DELETE FROM employer_reports WHERE id = ?", (r["id"],))
            else:
                conn.execute("UPDATE employer_reports SET employer_name = ? WHERE id = ?", (org_name, r["id"]))
    return n


# ---------------------------------------------------------------- employer entries

def _day(e: dict) -> date | None:
    """When it happened: the entry's date, else the day it was recorded."""
    for v in (e.get("date"), (e.get("created_at") or "")[:10]):
        if not v:
            continue
        try:
            return datetime.strptime(v, "%Y-%m-%d").date()
        except ValueError:
            continue
    return None


def same_fact(a: dict, b: dict) -> bool:
    """Same employer, same kind, same amount or days, within a few days of each other."""
    if a["type"] != b["type"] or a["employer_name"].lower() != b["employer_name"].lower():
        return False
    if a["type"] == "payment" and a.get("amount") != b.get("amount"):
        return False
    if a["type"] == "work_day" and float(a.get("days") or 0) != float(b.get("days") or 0):
        return False
    da, dbb = _day(a), _day(b)
    return da is None or dbb is None or abs((da - dbb).days) <= MATCH_WINDOW_DAYS


def record_entry(org: dict, member: dict, worker_id: str, entry: dict) -> dict:
    return db.add_event(worker_id, {
        "type": entry["type"], "employer_name": org["name"], "amount": entry.get("amount"),
        "days": entry.get("days"), "date": entry.get("date") or date.today().isoformat(),
        "notes": entry.get("note"), "source": "employer", "status": "pending",
        "org_id": org["id"], "recorded_by": member["id"],
    })


def entries_for_worker(worker_id: str, statuses: tuple[str, ...]) -> list[dict]:
    marks = ",".join("?" * len(statuses))
    with db.connect() as conn:
        return [dict(r) for r in conn.execute(f"""
            SELECT e.*, o.name AS org_name, o.verified AS org_verified
            FROM events e LEFT JOIN organizations o ON o.id = e.org_id
            WHERE e.worker_id = ? AND e.source = 'employer' AND e.status IN ({marks}) ORDER BY e.id""",
            (worker_id, *statuses))]


def find_pending_match(worker_id: str, fact: dict) -> dict | None:
    for e in entries_for_worker(worker_id, ("pending",)):
        if same_fact(e, fact):
            return e
    return None


def confirm_entry(worker_id: str, event_id: int) -> dict | None:
    """Worker confirms an employer's entry. Returns the entry that now counts (never two)."""
    e = db.get_event(worker_id, event_id)
    if not e or e["source"] != "employer" or e["status"] not in ("pending", "disputed"):
        return None
    with db.connect() as conn:
        dups = conn.execute("""SELECT * FROM events WHERE worker_id = ? AND source = 'worker' AND status = 'confirmed'
                               AND verified_org IS NULL AND type = ? ORDER BY id DESC""",
                            (worker_id, e["type"])).fetchall()
        dup = next((dict(d) for d in dups if same_fact(dict(d), e)), None)
        if dup:
            conn.execute("UPDATE events SET status = 'merged', merged_into = ? WHERE id = ?", (dup["id"], e["id"]))
            conn.execute("UPDATE events SET verified_org = ? WHERE id = ?", (e["org_id"], dup["id"]))
            kept = dup["id"]
        else:
            conn.execute("UPDATE events SET status = 'confirmed', dispute_reason = NULL WHERE id = ?", (e["id"],))
            kept = e["id"]
        return dict(conn.execute("SELECT * FROM events WHERE id = ?", (kept,)).fetchone())


def dispute_entry(worker_id: str, event_id: int, reason: str | None) -> dict | None:
    e = db.get_event(worker_id, event_id)
    if not e or e["source"] != "employer" or e["status"] != "pending":
        return None
    with db.connect() as conn:
        conn.execute("UPDATE events SET status = 'disputed', dispute_reason = ? WHERE id = ?",
                     ((reason or "").strip()[:200] or None, event_id))
    return db.get_event(worker_id, event_id)


def undo_entry(worker_id: str, event: dict) -> None:
    """Undo keeps the employer's side: its entry goes back to 'pending' instead of disappearing, and
    an employer entry merged into the worker's own entry becomes pending again when that is removed."""
    with db.connect() as conn:
        if event["source"] == "employer":
            conn.execute("UPDATE events SET status = 'pending' WHERE id = ?", (event["id"],))
            return
        conn.execute("UPDATE events SET status = 'pending', merged_into = NULL WHERE merged_into = ?", (event["id"],))
        conn.execute("DELETE FROM events WHERE id = ? AND worker_id = ?", (event["id"], worker_id))


def org_entry_counts(org_id: str, worker_id: str) -> dict:
    with db.connect() as conn:
        rows = conn.execute("SELECT status, COUNT(*) AS n FROM events WHERE org_id = ? AND worker_id = ? GROUP BY status",
                            (org_id, worker_id)).fetchall()
        return {r["status"]: r["n"] for r in rows}


# ---------------------------------------------------------------- notes & replies

def add_note(org_id: str, worker_id: str, member_id: str, text: str) -> dict:
    with db.connect() as conn:
        cur = conn.execute("INSERT INTO org_notes (org_id, worker_id, member_id, text, created_at) VALUES (?, ?, ?, ?, ?)",
                           (org_id, worker_id, member_id, text.strip(), db.now_iso()))
        return dict(conn.execute("SELECT * FROM org_notes WHERE id = ?", (cur.lastrowid,)).fetchone())


def list_notes(org_id: str, worker_id: str) -> list[dict]:
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("""
            SELECT n.*, m.name AS member_name FROM org_notes n LEFT JOIN org_members m ON m.id = n.member_id
            WHERE n.org_id = ? AND n.worker_id = ? ORDER BY n.id DESC""", (org_id, worker_id))]


def add_reply(org: dict, text: str) -> dict:
    with db.connect() as conn:
        cur = conn.execute("INSERT INTO org_replies (org_id, employer_name, text, created_at) VALUES (?, ?, ?, ?)",
                           (org["id"], org["name"], text.strip(), db.now_iso()))
        return dict(conn.execute("SELECT * FROM org_replies WHERE id = ?", (cur.lastrowid,)).fetchone())


def list_replies(org_id: str) -> list[dict]:
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM org_replies WHERE org_id = ? ORDER BY id DESC", (org_id,))]


def latest_verified_reply(employer_name: str) -> dict | None:
    """The newest reply from a VERIFIED organization with this name (so nobody can pose as the employer)."""
    with db.connect() as conn:
        row = conn.execute("""SELECT r.text, r.created_at, o.name AS org_name FROM org_replies r
                              JOIN organizations o ON o.id = r.org_id
                              WHERE o.verified = 1 AND lower(r.employer_name) = lower(?)
                              ORDER BY r.id DESC LIMIT 1""", (employer_name,)).fetchone()
        return dict(row) if row else None
