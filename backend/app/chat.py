"""The /chat pipeline:

  message -> LLM extracts facts -> Python stores events + computes ledger
          -> alerts + anonymised employer reports (exact numbers)
          -> retain to Hindsight, recall from worker bank + employer-reputation
          -> LLM writes a short reply using the exact numbers
"""
import asyncio
import difflib
import logging
from datetime import date, datetime, timezone

from . import db, ledger, llm, memory, orgs

log = logging.getLogger("hakdaar.chat")


# ---------------------------------------------------------------- employer names

def _norm(name: str) -> str:
    return " ".join(name.lower().replace(".", " ").split())


def canonical_employer(name: str | None, known: list[str]) -> str | None:
    """Map 'suresh', 'Suresh garu', 'SURESH CONSTRUCTIONS' onto an existing employer name so the
    ledger doesn't split one employer into several rows."""
    if not name or not name.strip():
        return None
    name = name.strip()
    n = _norm(name)
    for k in known:
        if _norm(k) == n:
            return k
    for k in known:
        kn = _norm(k)
        # 'suresh' vs 'suresh constructions' -> same employer. A bare first name only matches on
        # the first word, so 'Green Homes' and 'Green Valley' stay separate.
        if n in kn or kn in n or (len(n.split()) == 1 and n == kn.split()[0]):
            return k
    close = difflib.get_close_matches(n, [_norm(k) for k in known], n=1, cutoff=0.8)
    if close:
        return next(k for k in known if _norm(k) == close[0])
    return name.title() if name.islower() else name


# ---------------------------------------------------------------- events -> ledger rows

# Facts are never thrown away just because the worker hasn't named the employer yet ("5 days",
# "he gave 2000"). They are booked under this placeholder and moved to the real employer as soon
# as the worker names one (see claim_unnamed).
UNNAMED = "Employer (name not given)"


def employer_from_history(history: list[dict] | None, candidates: list[str]) -> str | None:
    """The employer most recently mentioned in the conversation, if it's one we already know."""
    for m in reversed(history or []):
        text = _norm(m.get("content") or "")
        for k in candidates:
            if k != UNNAMED and (_norm(k) in text or _norm(k).split()[0] in text.split()):
                return k
    return None


def claim_unnamed(worker_id: str, stored: list[dict]) -> str | None:
    """Once the worker names an employer, move facts booked under the placeholder to that employer."""
    named = next((e["employer_name"] for e in stored if e["employer_name"] != UNNAMED), None)
    if not named or UNNAMED not in db.employer_names_for_worker(worker_id):
        return None
    db.rename_employer(worker_id, UNNAMED, named)
    return named

def to_ledger_events(extracted: list[llm.ExtractedEvent], worker_id: str,
                     history: list[dict] | None = None) -> tuple[list[dict], list[dict]]:
    """Turn raw extracted facts into rows to store. Returns (rows_to_store, other_notes).

    'is_total' and 'pays_full_balance' are resolved here in Python against the current ledger.
    """
    known = db.employer_names_for_worker(worker_id)
    # Worker-wide employers + employers other workers mentioned, to help spelling match.
    candidates = [n for n in known + [n for n in db.all_employer_names() if n not in known] if n != UNNAMED]
    stored_events = db.list_events(worker_id)
    last_employer = known[0] if known else employer_from_history(history, candidates)

    rows, others = [], []
    for ev in extracted:
        # Recompute each time so two facts in one message ("worked 2 days, got 1000")
        # resolve against up-to-date numbers.
        current = {r["employer_name"]: r for r in ledger.summarize(stored_events + rows)}
        employer = canonical_employer(ev.employer_name, candidates) or last_employer
        if ev.type == "other":
            others.append({"employer_name": employer, "date": ev.date or date.today().isoformat(),
                           "type": "other", "notes": ev.notes, "amount": ev.amount, "days": ev.days})
            continue
        if employer is None or employer == UNNAMED:
            # Book it anyway so the numbers are right; the reply asks who the employer is.
            employer = UNNAMED
            others.append({"type": "other", "needs_employer": True})
        base = {"employer_name": employer, "date": ev.date or date.today().isoformat(), "notes": ev.notes}

        cur = current.get(employer, {})
        if ev.type == "promise":
            if ev.amount is None or ev.amount <= 0:
                others.append({**base, "type": "other", "notes": ev.notes or "promise without a rate"})
                continue
            rows.append({**base, "type": "promise", "amount": round(ev.amount), "days": None, "basis": ev.basis})

        elif ev.type == "work_day":
            days = ev.days if ev.days is not None else 1
            if ev.is_total:
                days = days - float(cur.get("days_worked") or 0)  # only the new days
            if days <= 0:
                continue
            rows.append({**base, "type": "work_day", "amount": None, "days": days})

        elif ev.type == "payment":
            amount = ev.amount
            if ev.pays_full_balance and amount is None:
                amount = cur.get("amount_owed")  # exact figure from the ledger
            elif ev.is_total and amount is not None:
                amount = amount - (cur.get("amount_paid") or 0)
            if amount is None or amount <= 0:
                others.append({**base, "type": "other", "notes": ev.notes or "payment amount unclear"})
                continue
            rows.append({**base, "type": "payment", "amount": round(amount), "days": None, "late": ev.is_late})

        if rows and rows[-1]["employer_name"]:
            last_employer = rows[-1]["employer_name"]
    return rows, others


# ---------------------------------------------------------------- alerts & reputation

# How many different workers must report a problem before HakDaar calls it a warning.
# A single report could be a mistake or a fake account, so on its own it is shown as unverified.
WARN_AFTER_REPORTS = 2


def reputation_alert(employer: str, worker_id: str) -> dict | None:
    if employer == UNNAMED:
        return None
    stats = db.employer_report_stats(employer, exclude_worker_id=worker_id)
    n = stats["workers_reporting_problems"]
    if n == 0:
        return None
    what = []
    if stats["short_payment"]:
        what.append("short")
    if stats["late_payment"]:
        what.append("late")
    kind = " or ".join(what) if what else "unfair"
    if n >= WARN_AFTER_REPORTS:
        severity = "warning"
        message = f"{n} other workers reported {kind} payment from {employer}."
    else:
        severity = "caution"
        message = (f"1 other worker reported {kind} payment from {employer}. This is a single, unverified "
                   f"report, so check with others before deciding.")
    ok = stats["paid_ok"]
    if ok:
        # Show the other side too, so an employer isn't judged on complaints alone.
        message += f" {ok} worker{'s' if ok != 1 else ''} said they were paid in full."
    reply = orgs.latest_verified_reply(employer)
    return {
        "type": "employer_reputation",
        "employer_reply": reply["text"] if reply else None,
        "severity": severity,
        "employer_name": employer,
        "count": n,
        "paid_ok": ok,
        "message": message,
    }


def build_alerts(worker_id: str, current_ledger: list[dict], focus: set[str]) -> list[dict]:
    """Underpayment alerts for employers touched this turn (or all, if none were), plus
    reputation warnings for every employer this worker deals with."""
    alerts = []
    for row in current_ledger:
        if (not focus or row["employer_name"] in focus) and (row["amount_owed"] or 0) > 0:
            alerts.append({
                "type": "underpayment",
                "severity": "danger",
                "employer_name": row["employer_name"],
                "amount_owed": row["amount_owed"],
                "message": (f"{row['employer_name']} owes you {ledger.format_inr(row['amount_owed'])} "
                            f"(earned {ledger.format_inr(row['amount_earned'])}"
                            + (f" = {row['days_worked']} days x {ledger.format_inr(row['rate_per_day'])}"
                               if row["rate_per_day"] is not None and row["days_worked"] else "")
                            + (f" + {ledger.format_inr(row['fixed_amount'])} fixed" if row.get("fixed_amount") else "")
                            + f", paid {ledger.format_inr(row['amount_paid'])})."),
            })
    for row in current_ledger:
        a = reputation_alert(row["employer_name"], worker_id)
        if a:
            alerts.append(a)
    return alerts


def anonymised_report(row: dict, kind: str) -> str:
    terms = []
    if row["rate_per_day"] is not None:
        terms.append(f"{ledger.format_inr(row['rate_per_day'])}/day for {row['days_worked']} days")
    if row.get("fixed_amount"):
        terms.append(f"a fixed {ledger.format_inr(row['fixed_amount'])}")
    agreed = " plus ".join(terms) or "an agreed amount"
    if kind == "paid_ok":
        return (f"A worker reported that {row['employer_name']} paid fully: agreed {agreed} "
                f"(earned {ledger.format_inr(row['amount_earned'])}) and paid {ledger.format_inr(row['amount_paid'])}.")
    return (f"A worker reported a short payment from {row['employer_name']}: agreed {agreed} "
            f"(earned {ledger.format_inr(row['amount_earned'])}), but was paid only "
            f"{ledger.format_inr(row['amount_paid'])}. Short by {ledger.format_inr(row['amount_owed'])}.")


def rebuild_reputation(worker_id: str, employer: str, current_ledger: list[dict]) -> None:
    """After an entry is undone, recompute this worker's (exact) reports for that employer."""
    late = db.has_report(employer, worker_id, "late_payment")
    late_summary = None
    if late:
        with db.connect() as conn:
            late_summary = conn.execute(
                "SELECT summary FROM employer_reports WHERE employer_name = ? AND worker_id = ? AND kind = 'late_payment'",
                (employer, worker_id)).fetchone()[0]
    db.delete_reports(employer, worker_id)
    row = next((r for r in current_ledger if r["employer_name"] == employer), None)
    if row and row["payments"] > 0:
        record_reputation(worker_id, current_ledger, {employer})
        if late_summary:
            db.add_employer_report(employer, worker_id, "late_payment", 0, late_summary)


def record_reputation(worker_id: str, current_ledger: list[dict], paid_employers: set[str]) -> list[tuple[str, str, dict]]:
    """After a payment, write an anonymised report to SQLite (exact counts) and return what should
    also be retained into the shared Hindsight bank."""
    to_retain = []
    for row in current_ledger:
        if row["employer_name"] not in paid_employers or row["status"] == "unknown_rate" or row["employer_name"] == UNNAMED:
            continue
        kind = "short_payment" if (row["amount_owed"] or 0) > 0 else "paid_ok"
        summary = anonymised_report(row, kind)
        # One current report per worker/employer keeps counts honest: a later full payment
        # replaces an earlier 'short' report, and repeats don't inflate the numbers.
        with db.connect() as conn:
            conn.execute("DELETE FROM employer_reports WHERE employer_name = ? AND worker_id = ? "
                         "AND kind IN ('short_payment', 'paid_ok')", (row["employer_name"], worker_id))
        db.add_employer_report(row["employer_name"], worker_id, kind, row["amount_owed"] or 0, summary)
        to_retain.append((row["employer_name"], kind, summary))
    return to_retain


# ---------------------------------------------------------------- prompt text helpers

def ledger_text(current_ledger: list[dict]) -> str:
    if not current_ledger:
        return "(no employers recorded yet)"
    lines = []
    for r in current_ledger:
        if r["status"] == "unknown_rate":
            lines.append(f"- {r['employer_name']}: daily rate NOT KNOWN yet, days worked {r['days_worked']}, "
                         f"paid {ledger.format_inr(r['amount_paid'])}")
            continue
        rate = f"promised {ledger.format_inr(r['rate_per_day'])}/day, " if r["rate_per_day"] is not None else ""
        fixed = f"fixed/bonus {ledger.format_inr(r['fixed_amount'])}, " if r.get("fixed_amount") else ""
        line = (f"- {r['employer_name']}: {rate}{fixed}"
                f"days worked {r['days_worked']}, earned {ledger.format_inr(r['amount_earned'])}, "
                f"paid {ledger.format_inr(r['amount_paid'])}, owed {ledger.format_inr(r['amount_owed'])}")
        if r["advance"]:
            line += (f". PAID EXTRA: {r['employer_name']} has paid {ledger.format_inr(r['advance'])} MORE than the "
                     f"worker earned")
        lines.append(line)
    return "\n".join(lines)


def noted_text(stored: list[dict], others: list[dict]) -> str:
    lines = []
    for e in stored:
        if e["type"] == "promise" and e.get("basis") == "fixed":
            lines.append(f"- {e['employer_name']} agreed a fixed {ledger.format_inr(e['amount'])} for work done")
        elif e["type"] == "promise":
            lines.append(f"- {e['employer_name']} promised {ledger.format_inr(e['amount'])}/day")
        elif e["type"] == "work_day":
            lines.append(f"- worked {e['days']:g} day(s) for {e['employer_name']}")
        elif e["type"] == "payment":
            lines.append(f"- received {ledger.format_inr(e['amount'])} from {e['employer_name']}")
    for o in others:
        if o.get("needs_employer"):
            lines.append("- the worker did not say which employer this is for; it is saved for now, so ask them the employer's name")
        elif o.get("notes"):
            lines.append(f"- note: {o['notes']}")
    return "\n".join(lines) or "(nothing new to record)"


def memories_text(mems: list[dict]) -> str:
    return "\n".join(f"- {m['text']}" for m in mems) or "(none yet)"


def event_to_memory(e: dict) -> str:
    if e["type"] == "promise" and e.get("basis") == "fixed":
        return f"{e['employer_name']} agreed to pay a fixed amount of {ledger.format_inr(e['amount'])} for work done."
    if e["type"] == "promise":
        return f"{e['employer_name']} promised a daily wage of {ledger.format_inr(e['amount'])} per day."
    if e["type"] == "work_day":
        return f"Worked {e['days']:g} day(s) for {e['employer_name']}."
    if e["type"] == "payment":
        return f"Received a payment of {ledger.format_inr(e['amount'])} from {e['employer_name']}."
    return e.get("notes") or ""


def numbers_in(text: str) -> set[int]:
    """'₹1,200 for 6 days' -> {1200, 6}"""
    import re
    return {int(n.replace(",", "")) for n in re.findall(r"\d[\d,]*", text or "") if n.replace(",", "").isdigit()}


def invented_amounts(reply: str, *sources: str) -> set[int]:
    """Money-sized numbers (>= 100) in the reply that appear nowhere in what we gave the model.
    Those are the model doing its own maths, e.g. '5 days x ₹10,000 = ₹50,000' when the ledger
    has no rate recorded, which is exactly what must never reach a worker."""
    allowed = set()
    for src in sources:
        allowed |= numbers_in(src)
    return {n for n in numbers_in(reply) if n >= 100 and n not in allowed}


NO_MATHS = ("Your previous draft stated rupee amounts that are not in LEDGER, NOTED THIS TURN or ALERTS "
            "({amounts}). Do not calculate anything. Rewrite the reply using only amounts that appear there. "
            "If an amount is not in LEDGER, do not state it: ask the worker for the missing detail instead.")


EXTRA_NOTE = {
    "en": "Note: {emp} has paid you {amt} more than you have earned so far. It may be an advance for future work, "
          "or a mistake, so please check with them.",
    "te": "గమనిక: {emp} మీరు ఇప్పటివరకు సంపాదించిన దానికంటే {amt} ఎక్కువ ఇచ్చారు. ఇది ముందు పనికి అడ్వాన్స్ "
          "కావచ్చు, లేదా పొరపాటు కావచ్చు. ఒకసారి వారితో మాట్లాడండి.",
    "hi": "ध्यान दें: {emp} ने आपकी अब तक की कमाई से {amt} ज़्यादा दिए हैं। यह आगे के काम का एडवांस हो सकता है, "
          "या गलती, इसलिए एक बार उनसे बात कर लें।",
}


def extra_payment_notes(reply: str, current_ledger: list[dict], focus: set[str], language: str) -> str:
    """If an employer has paid more than was earned and the reply didn't say so, say it ourselves,
    with the exact figure from the ledger, so an overpayment is never silently called 'fully paid'."""
    notes = []
    said = numbers_in(reply)
    for r in current_ledger:
        if not (r.get("advance") or 0) > 0 or r["advance"] in said:
            continue
        # Facts about this employer this turn, or a money reply to a question ("how much am I owed?").
        # A plain "hello" reply gets no note.
        about_it = r["employer_name"] in focus if focus else (said or r["employer_name"].lower() in reply.lower())
        if about_it:
            notes.append(EXTRA_NOTE.get(language, EXTRA_NOTE["en"]).format(
                emp=r["employer_name"], amt=ledger.format_inr(r["advance"])))
    return " ".join([reply, *notes]) if notes else reply


def fallback_reply(stored: list[dict], alerts: list[dict]) -> str:
    parts = ["I saved your message."]
    parts += [event_to_memory(e) for e in stored]
    parts += [a["message"] for a in alerts]
    return " ".join(parts)


# ---------------------------------------------------------------- safety net for short answers

_NUM = r"(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:/-|rs|rupees?|rupaye|రూపాయలు)?"
_DAYS = r"(\d+(?:\.\d+)?)\s*(?:days?|din|dino|దినాలు|రోజులు|రోజు|दिन)"


def quick_facts(message: str, history: list[dict]) -> list[llm.ExtractedEvent]:
    """If the AI found nothing in a short reply like '10000' or '5 days', read it in Python using
    the question HakDaar just asked. Only exact forms are accepted; anything else is left alone."""
    import re
    text = message.strip().lower()
    m = re.fullmatch(_DAYS, text)
    if m:
        return [llm.ExtractedEvent(type="work_day", days=float(m.group(1)))]
    m = re.fullmatch(_NUM, text)
    if not m:
        return []
    value = float(m.group(1).replace(",", ""))
    asked = next((h["content"].lower() for h in reversed(history) if h["role"] == "assistant"), "")
    if re.search(r"rate|per day|daily|each day|a day|promise|wage", asked):
        return [llm.ExtractedEvent(type="promise", amount=value)]
    if re.search(r"how many days|days did you|days have you", asked):
        return [llm.ExtractedEvent(type="work_day", days=value)]
    if re.search(r"paid|payment|receive|give you|gave you", asked):
        return [llm.ExtractedEvent(type="payment", amount=value)]
    return []


# ---------------------------------------------------------------- main entrypoint

async def handle_message(worker: dict, message: str, on_recorded=None) -> dict:
    """on_recorded(stored_and_notes, alerts) is awaited as soon as the facts are saved, before memory
    and the reply, so the app can update Earned / Paid / Owed while the reply is still being written."""
    worker_id = worker["id"]
    bank = memory.worker_bank(worker_id)
    warnings: list[str] = []

    history = db.list_messages(worker_id, limit=6)

    # 1. Extract structured facts. If Groq is down this raises LLMUnavailable -> 503 upstream,
    #    before we store anything, so a retry doesn't double-count.
    extracted = await llm.extract_events(message, db.employer_names_for_worker(worker_id), history=history)
    if not any(e.type != "other" for e in extracted):
        extra = quick_facts(message, history)
        if extra:
            log.warning("AI found no facts in %r; read it directly as %s", message[:80], [e.type for e in extra])
            extracted = extra
    log.info("Extracted %d fact(s) from %r: %s", len(extracted), message[:80],
             [e.model_dump(exclude_defaults=True) for e in extracted])
    rows, others = to_ledger_events(extracted, worker_id, history)

    # 2. Store message + events in SQLite and compute the exact ledger.
    msg_id = db.add_message(worker_id, "user", message)
    stored = []
    for r in rows:
        # "He paid me 2000" when the employer already recorded that payment: confirm theirs, don't add a copy.
        match = orgs.find_pending_match(worker_id, r) if r["type"] in ("work_day", "payment") else None
        if match:
            stored.append(orgs.confirm_entry(worker_id, match["id"]))
            others.append({"type": "other", "notes": f"this matches the entry {match['employer_name']} recorded, "
                                                    f"which is now confirmed"})
        else:
            stored.append(db.add_event(worker_id, r, message_id=msg_id))
    claimed = claim_unnamed(worker_id, stored)
    if claimed:
        others.append({"type": "other", "notes": f"earlier facts with no employer name were moved to {claimed}"})
    current_ledger = ledger.summarize(db.list_events(worker_id))

    touched = {e["employer_name"] for e in stored}
    paid = {e["employer_name"] for e in stored if e["type"] == "payment"}
    reports = record_reputation(worker_id, current_ledger, paid)
    for employer in {r["employer_name"] for r in rows if r.get("late")} - {UNNAMED}:
        summary = f"A worker reported that {employer} paid their wages late, after a delay."
        if not db.has_report(employer, worker_id, "late_payment"):
            db.add_employer_report(employer, worker_id, "late_payment", 0, summary)
        reports.append((employer, "late_payment", summary))
    alerts = build_alerts(worker_id, current_ledger, touched)
    if on_recorded:
        await on_recorded(stored + others, alerts)

    # 3. Memory: retain this turn, recall from the worker's bank + shared reputation bank.
    now = datetime.now(timezone.utc)
    facts = "\n".join(f"- {event_to_memory(e)}" for e in stored)
    turn_content = f"{worker['name']} said: {message}" + (f"\nRecorded facts:\n{facts}" if facts else "")

    employers_in_focus = list(touched) or [r["employer_name"] for r in current_ledger[:3]]
    recall_query = message if not employers_in_focus else f"{message}\n(employers: {', '.join(employers_in_focus)})"
    rep_query = (f"How do {', '.join(employers_in_focus)} pay their workers? Any short or late payments?"
                 if employers_in_focus else "")

    async def _retain_all():
        await memory.retain(bank, turn_content, context="chat message from worker", timestamp=now,
                            metadata={"worker_id": worker_id, "kind": "chat"})
        for employer, kind, summary in reports:
            await memory.retain(memory.REPUTATION_BANK, summary, context=f"anonymous wage report ({kind})",
                                timestamp=now, metadata={"employer": employer, "kind": kind})

    async def _recall_rep():
        return await memory.recall(memory.REPUTATION_BANK, rep_query, limit=4) if rep_query else []

    # recall first (so we don't see our own un-processed message), retain in parallel.
    results = await asyncio.gather(memory.recall(bank, recall_query), _recall_rep(), _retain_all(),
                                   return_exceptions=True)
    mems = results[0] if not isinstance(results[0], Exception) else []
    rep_mems = results[1] if not isinstance(results[1], Exception) else []
    for r in results:
        if isinstance(r, memory.MemoryUnavailable):
            warnings.append(f"Memory is offline: {r}")
            break
        if isinstance(r, Exception):
            log.exception("memory step failed", exc_info=r)
            warnings.append("Memory had a problem this turn; wages were still recorded.")
            break

    # 4. Reply in the worker's language using the exact numbers. The facts are already saved,
    #    so if Groq fails now we fall back to a plain reply instead of losing the turn.
    reply_args = dict(
        worker_name=worker["name"], language=worker["language"], message=message, history=history,
        ledger_text=ledger_text(current_ledger), noted_text=noted_text(stored, others),
        alerts_text="\n".join(f"- {a['message']}" for a in alerts) or "(none)",
        memories_text=memories_text(mems), reputation_text=memories_text(rep_mems),
    )
    # Numbers the reply may repeat: the exact ledger/alerts, and what the worker said themselves.
    grounded = [reply_args["ledger_text"], reply_args["noted_text"], reply_args["alerts_text"], message,
                *[m["content"] for m in history if m["role"] == "user"]]
    try:
        reply = await llm.write_reply(**reply_args)
        bad = invented_amounts(reply, *grounded)
        if bad:
            log.warning("Reply invented amounts %s; asking for a rewrite", sorted(bad))
            reply = await llm.write_reply(**reply_args, correction=NO_MATHS.format(amounts=", ".join(map(str, sorted(bad)))))
            if invented_amounts(reply, *grounded):
                log.warning("Rewrite still invented amounts; using the plain reply")
                reply = fallback_reply(stored, alerts)
    except llm.LLMUnavailable as e:
        warnings.append(str(e))
        reply = fallback_reply(stored, alerts)
    reply = extra_payment_notes(reply, current_ledger, touched, worker["language"])
    db.add_message(worker_id, "assistant", reply)

    return {
        "reply": reply,
        "extracted_events": stored + others,
        "alerts": alerts,
        "recalled_memories": mems + rep_mems,
        "ledger": current_ledger,
        "warnings": warnings,
    }
