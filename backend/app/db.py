"""SQLite storage: workers, chat messages, extracted wage events and employer reports.

Plain sqlite3 keeps the dependency list short. Every function opens its own
short-lived connection, which is safe with FastAPI's threadpool.
"""
import hashlib
import hmac
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS workers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    language    TEXT NOT NULL DEFAULT 'en',
    phone       TEXT,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id   TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

-- One row per extracted fact. The ledger is always recomputed from these rows.
CREATE TABLE IF NOT EXISTS events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id      TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    type           TEXT NOT NULL CHECK (type IN ('promise', 'work_day', 'payment')),
    employer_name  TEXT NOT NULL,
    amount         INTEGER,          -- rupees; daily rate for promise, amount for payment
    days           REAL,             -- work_day only (can be 0.5 for half days)
    date           TEXT,             -- ISO date the event happened (best effort)
    notes          TEXT,
    message_id     INTEGER REFERENCES messages(id),
    created_at     TEXT NOT NULL
);

-- Anonymised reports that feed the shared employer-reputation memory.
-- worker_id is kept only so we can count *distinct other* workers; it is never shown.
CREATE TABLE IF NOT EXISTS employer_reports (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    employer_name  TEXT NOT NULL,
    worker_id      TEXT NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('short_payment', 'late_payment', 'paid_ok')),
    amount_short   INTEGER NOT NULL DEFAULT 0,
    summary        TEXT NOT NULL,
    created_at     TEXT NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def connect():
    conn = sqlite3.connect(settings.database_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _add_column(conn, table: str, column: str, ddl: str) -> None:
    cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        # Lightweight migrations for databases created by earlier versions.
        _add_column(conn, "workers", "pin_hash", "pin_hash TEXT")
        # Free PIN recovery (no paid SMS OTP): a security question chosen at sign-up + hashed answer.
        _add_column(conn, "workers", "recovery_question", "recovery_question INTEGER")
        _add_column(conn, "workers", "recovery_hash", "recovery_hash TEXT")
        _add_column(conn, "workers", "terms_accepted_at", "terms_accepted_at TEXT")
        # 'day' = promised daily rate; 'fixed' = agreed lump sum / bonus for work already done.
        _add_column(conn, "events", "basis", "basis TEXT NOT NULL DEFAULT 'day'")


def reset_db() -> None:
    with connect() as conn:
        conn.executescript(
            "DELETE FROM employer_reports; DELETE FROM events; DELETE FROM messages; DELETE FROM workers;"
        )


# ---------- workers ----------

def new_worker_id(name: str) -> str:
    """Readable, never-reused id, e.g. 'ravi-3f9a1c'. Never reusing ids means a
    stale Hindsight bank can't leak into a new worker after a reset."""
    slug = "".join(c for c in name.lower() if c.isalnum())[:12] or "worker"
    return f"{slug}-{uuid.uuid4().hex[:6]}"


# Never return pin_hash from the API.
PUBLIC_COLS = "id, name, language, phone, created_at"


def hash_pin(pin: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(8)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 100_000).hex()
    return f"{salt}${digest}"


def check_pin(pin: str, stored: str | None) -> bool:
    if not stored or "$" not in stored:
        return False
    salt, _ = stored.split("$", 1)
    return hmac.compare_digest(hash_pin(pin, salt), stored)


def normalize_answer(answer: str) -> str:
    """'  Warangal ' == 'warangal': answers are compared case- and space-insensitively."""
    return " ".join(answer.lower().split())


def create_worker(name: str, language: str, phone: str | None = None, pin: str | None = None,
                  recovery_question: int | None = None, recovery_answer: str | None = None,
                  terms_accepted: bool = False) -> dict:
    wid = new_worker_id(name)
    with connect() as conn:
        conn.execute(
            """INSERT INTO workers (id, name, language, phone, pin_hash, recovery_question, recovery_hash,
                                    terms_accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (wid, name, language, phone, hash_pin(pin) if pin else None, recovery_question,
             hash_pin(normalize_answer(recovery_answer)) if recovery_answer else None,
             now_iso() if terms_accepted else None, now_iso()),
        )
    return get_worker(wid)


def set_pin(worker_id: str, pin: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE workers SET pin_hash = ? WHERE id = ?", (hash_pin(pin), worker_id))


def find_by_phone(phone: str) -> dict | None:
    """Includes pin_hash; only for the login check."""
    with connect() as conn:
        row = conn.execute("SELECT * FROM workers WHERE phone = ?", (phone,)).fetchone()
        return dict(row) if row else None


def list_workers() -> list[dict]:
    with connect() as conn:
        return [dict(r) for r in conn.execute(f"SELECT {PUBLIC_COLS} FROM workers ORDER BY rowid")]


def get_worker(worker_id: str) -> dict | None:
    """Look up by id; as a convenience for testing/demo, a unique name ('ravi') also works."""
    with connect() as conn:
        row = conn.execute(f"SELECT {PUBLIC_COLS} FROM workers WHERE id = ?", (worker_id,)).fetchone()
        if row:
            return dict(row)
        rows = conn.execute(f"SELECT {PUBLIC_COLS} FROM workers WHERE lower(name) = lower(?)",
                            (worker_id.strip(),)).fetchall()
        return dict(rows[0]) if len(rows) == 1 else None


def update_worker_language(worker_id: str, language: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE workers SET language = ? WHERE id = ?", (language, worker_id))


# ---------- messages ----------

def add_message(worker_id: str, role: str, content: str, created_at: str | None = None) -> int:
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO messages (worker_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (worker_id, role, content, created_at or now_iso()),
        )
        return cur.lastrowid


def list_messages(worker_id: str, limit: int = 100, with_events: bool = False) -> list[dict]:
    with connect() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM (SELECT * FROM messages WHERE worker_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id",
            (worker_id, limit),
        )]
        if with_events:
            # Attach the ledger entries each message produced, so the UI can show and undo them.
            by_msg: dict[int, list] = {}
            for e in conn.execute("SELECT * FROM events WHERE worker_id = ? AND message_id IS NOT NULL", (worker_id,)):
                by_msg.setdefault(e["message_id"], []).append(dict(e))
            for r in rows:
                r["events"] = by_msg.get(r["id"], [])
        return rows


# ---------- events ----------

def add_event(worker_id: str, event: dict, message_id: int | None = None,
              created_at: str | None = None) -> dict:
    with connect() as conn:
        cur = conn.execute(
            """INSERT INTO events (worker_id, type, employer_name, amount, days, date, notes, basis, message_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (worker_id, event["type"], event["employer_name"], event.get("amount"), event.get("days"),
             event.get("date"), event.get("notes"), event.get("basis") or "day", message_id, created_at or now_iso()),
        )
        row = conn.execute("SELECT * FROM events WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)


def list_events(worker_id: str) -> list[dict]:
    with connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM events WHERE worker_id = ? ORDER BY id", (worker_id,))]


def get_event(worker_id: str, event_id: int) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM events WHERE id = ? AND worker_id = ?", (event_id, worker_id)).fetchone()
        return dict(row) if row else None


def delete_event(worker_id: str, event_id: int) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM events WHERE id = ? AND worker_id = ?", (event_id, worker_id))


def delete_reports(employer_name: str, worker_id: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM employer_reports WHERE employer_name = ? AND worker_id = ?",
                     (employer_name, worker_id))


def delete_worker(worker_id: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM employer_reports WHERE worker_id = ?", (worker_id,))
        conn.execute("DELETE FROM events WHERE worker_id = ?", (worker_id,))
        conn.execute("DELETE FROM messages WHERE worker_id = ?", (worker_id,))
        conn.execute("DELETE FROM workers WHERE id = ?", (worker_id,))


def employer_names_for_worker(worker_id: str) -> list[str]:
    """Employers this worker has mentioned, most recently mentioned first."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT employer_name, MAX(id) AS last FROM events WHERE worker_id = ? GROUP BY employer_name ORDER BY last DESC",
            (worker_id,),
        )
        return [r["employer_name"] for r in rows]


def all_employer_names() -> list[str]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT employer_name FROM events UNION SELECT employer_name FROM employer_reports"
        )
        return [r["employer_name"] for r in rows]


# ---------- employer reports ----------

def add_employer_report(employer_name: str, worker_id: str, kind: str, amount_short: int,
                        summary: str, created_at: str | None = None) -> None:
    with connect() as conn:
        conn.execute(
            """INSERT INTO employer_reports (employer_name, worker_id, kind, amount_short, summary, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (employer_name, worker_id, kind, amount_short, summary, created_at or now_iso()),
        )


def has_report(employer_name: str, worker_id: str, kind: str) -> bool:
    with connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM employer_reports WHERE lower(employer_name) = lower(?) AND worker_id = ? AND kind = ?",
            (employer_name, worker_id, kind),
        ).fetchone()
        return row is not None


def employer_report_stats(employer_name: str, exclude_worker_id: str | None = None) -> dict:
    """Exact counts of distinct workers who reported problems / good payment."""
    with connect() as conn:
        params = [employer_name]
        exclude = ""
        if exclude_worker_id:
            exclude = "AND worker_id != ?"
            params.append(exclude_worker_id)
        rows = conn.execute(
            f"""SELECT kind, COUNT(DISTINCT worker_id) AS workers
                FROM employer_reports WHERE lower(employer_name) = lower(?) {exclude}
                GROUP BY kind""",
            params,
        ).fetchall()
        by_kind = {r["kind"]: r["workers"] for r in rows}
        bad = conn.execute(
            f"""SELECT COUNT(DISTINCT worker_id) FROM employer_reports
                WHERE lower(employer_name) = lower(?) {exclude} AND kind != 'paid_ok'""",
            params,
        ).fetchone()[0]
        return {
            "workers_reporting_problems": bad,
            "short_payment": by_kind.get("short_payment", 0),
            "late_payment": by_kind.get("late_payment", 0),
            "paid_ok": by_kind.get("paid_ok", 0),
        }
