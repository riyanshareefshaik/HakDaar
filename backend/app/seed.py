"""Demo data for the hackathon video.

Ravi (Telugu)    Suresh Constructions promised ₹700/day, 6 days worked, paid ₹3,000 -> owed ₹1,200
Lakshmi (Hindi)  Suresh Constructions paid her late and short -> goes into employer-reputation
Imran (English)  Green Homes paid fully and on time -> positive example
"""
import logging
from datetime import datetime, time, timedelta, timezone

from . import chat, db, ledger, memory

log = logging.getLogger("hakdaar.seed")

IST = timezone(timedelta(hours=5, minutes=30))

# Each turn: (days_ago, user_message, assistant_reply, events)
DEMO = [
    {
        "name": "Ravi", "language": "te", "phone": None,
        "turns": [
            (9, "సురేష్ కన్స్ట్రక్షన్స్ లో కొత్త పని దొరికింది. రోజుకు ₹700 ఇస్తామని సురేష్ గారు చెప్పారు.",
             "చాలా మంచి వార్త రవి! సురేష్ కన్స్ట్రక్షన్స్ రోజుకు ₹700 ఇస్తామని చెప్పారని నేను గుర్తుపెట్టుకున్నాను.",
             [{"type": "promise", "employer_name": "Suresh Constructions", "amount": 700,
               "notes": "Verbal promise at Kondapur site"}]),
            (3, "ఈ వారం సురేష్ కన్స్ట్రక్షన్స్ దగ్గర 6 రోజులు పని చేశాను.",
             "6 రోజుల పని నమోదు చేశాను. రోజుకు ₹700 చొప్పున మీకు ₹4,200 రావాలి.",
             [{"type": "work_day", "employer_name": "Suresh Constructions", "days": 6}]),
            (1, "ఈ రోజు సురేష్ గారు ₹3,000 మాత్రమే ఇచ్చారు. మిగతాది తర్వాత ఇస్తానన్నారు.",
             "₹3,000 అందినట్లు నమోదు చేశాను. ఇంకా ₹1,200 రావాలి. తేదీలు, మొత్తం చెప్పి మర్యాదగా అడగండి.",
             [{"type": "payment", "employer_name": "Suresh Constructions", "amount": 3000,
               "notes": "Said he will pay the rest later"}]),
        ],
    },
    {
        "name": "Lakshmi", "language": "hi", "phone": None,
        "turns": [
            (45, "सुरेश कंस्ट्रक्शन्स ने रोज़ ₹650 देने का वादा किया है। मियापुर साइट पर काम शुरू किया।",
             "बढ़िया लक्ष्मी जी! मैंने याद रख लिया कि सुरेश कंस्ट्रक्शन्स ने रोज़ ₹650 का वादा किया है।",
             [{"type": "promise", "employer_name": "Suresh Constructions", "amount": 650,
               "notes": "Miyapur site"}]),
            (35, "मैंने सुरेश कंस्ट्रक्शन्स के लिए 10 दिन काम किया।",
             "10 दिन का काम लिख लिया। ₹650 रोज़ के हिसाब से ₹6,500 बनते हैं।",
             [{"type": "work_day", "employer_name": "Suresh Constructions", "days": 10}]),
            (14, "तीन हफ्ते इंतज़ार के बाद सिर्फ़ ₹5,000 मिले। बाकी पैसे के लिए बोले बाद में आना।",
             "₹5,000 मिलने की बात लिख ली। अभी भी ₹1,500 बाकी हैं। पैसे देर से और कम मिले, यह ठीक नहीं है।",
             [{"type": "payment", "employer_name": "Suresh Constructions", "amount": 5000,
               "notes": "Paid three weeks late and short"}]),
        ],
        "late_payment": {"employer": "Suresh Constructions",
                         "summary": "A worker reported that Suresh Constructions paid wages about three weeks "
                                    "late, and only part of the amount, telling the worker to come back later."},
    },
    {
        "name": "Imran", "language": "en", "phone": None,
        "turns": [
            (20, "Green Homes hired me as a helper at their Gachibowli site. They promised ₹800 per day.",
             "Good news, Imran! I've noted that Green Homes promised ₹800 per day.",
             [{"type": "promise", "employer_name": "Green Homes", "amount": 800, "notes": "Gachibowli site"}]),
            (14, "I worked 5 days for Green Homes this week.",
             "Noted 5 days of work for Green Homes. At ₹800 a day that is ₹4,000.",
             [{"type": "work_day", "employer_name": "Green Homes", "days": 5}]),
            (13, "Green Homes paid me ₹4,000 today, the full amount, right on time.",
             "Wonderful! Green Homes paid the full ₹4,000 on time. Nothing is owed.",
             [{"type": "payment", "employer_name": "Green Homes", "amount": 4000, "notes": "Paid on time"}]),
        ],
    },
]


def _when(days_ago: int, hour: int) -> datetime:
    d = datetime.now(IST).date() - timedelta(days=days_ago)
    return datetime.combine(d, time(hour, 0), tzinfo=IST)


async def reset() -> dict:
    """Wipe SQLite and every HakDaar Hindsight bank we know about."""
    bank_ids = [memory.worker_bank(w["id"]) for w in db.list_workers()] + [memory.REPUTATION_BANK]
    db.reset_db()
    deleted, errors = 0, []
    for b in bank_ids:
        try:
            deleted += await memory.delete_bank(b)
        except memory.MemoryUnavailable as e:
            errors.append(str(e))
            break
    return {"banks_deleted": deleted, "warnings": errors}


async def seed() -> dict:
    result = await reset()
    warnings = list(result["warnings"])
    worker_items: dict[str, list[dict]] = {}
    reputation_items: list[dict] = []

    for spec in DEMO:
        w = db.create_worker(spec["name"], spec["language"], spec["phone"])
        items = []
        for days_ago, user_msg, reply, events in spec["turns"]:
            ts = _when(days_ago, 18)
            mid = db.add_message(w["id"], "user", user_msg, created_at=ts.isoformat())
            db.add_message(w["id"], "assistant", reply, created_at=(ts + timedelta(seconds=5)).isoformat())
            stored = [db.add_event(w["id"], {**e, "date": ts.date().isoformat()}, message_id=mid,
                                   created_at=ts.isoformat()) for e in events]
            facts = "\n".join(f"- {chat.event_to_memory(e)}" for e in stored)
            items.append({
                "content": f"{w['name']} said: {user_msg}\nRecorded facts:\n{facts}",
                "context": "chat message from worker",
                "timestamp": ts,
                "metadata": {"worker_id": w["id"], "kind": "chat"},
            })

            # Reports are written exactly like a live payment message would write them.
            paid = {e["employer_name"] for e in stored if e["type"] == "payment"}
            if paid:
                current = ledger.summarize(db.list_events(w["id"]))
                for employer, kind, summary in chat.record_reputation(w["id"], current, paid):
                    reputation_items.append({"content": summary, "context": f"anonymous wage report ({kind})",
                                             "timestamp": ts, "metadata": {"employer": employer, "kind": kind}})

        late = spec.get("late_payment")
        if late:
            ts = _when(14, 19)
            db.add_employer_report(late["employer"], w["id"], "late_payment", 0, late["summary"],
                                   created_at=ts.isoformat())
            reputation_items.append({"content": late["summary"], "context": "anonymous wage report (late_payment)",
                                     "timestamp": ts, "metadata": {"employer": late["employer"],
                                                                   "kind": "late_payment"}})
        worker_items[w["id"]] = items

    # Hindsight: retain the seeded history so memory exists before the demo starts.
    retained = 0
    try:
        await memory.ensure_bank(memory.REPUTATION_BANK)
        await memory.retain_batch(memory.REPUTATION_BANK, reputation_items)
        retained += len(reputation_items)
        for wid, items in worker_items.items():
            await memory.ensure_bank(memory.worker_bank(wid))
            await memory.retain_batch(memory.worker_bank(wid), items)
            retained += len(items)
    except memory.MemoryUnavailable as e:
        warnings.append(f"SQLite demo data loaded, but Hindsight memory was not seeded: {e}")

    return {
        "workers": db.list_workers(),
        "memories_queued": retained,
        "note": "Hindsight processes memories in the background; give it ~30-60s before demoing recall.",
        "warnings": warnings,
    }
