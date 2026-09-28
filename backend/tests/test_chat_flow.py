"""End-to-end API flow with Groq and Hindsight mocked out."""
import pytest
from fastapi.testclient import TestClient

from app import llm, memory
from app.llm import ExtractedEvent
from app.main import app


class FakeMemory:
    def __init__(self):
        self.banks: dict[str, list[str]] = {}
        self.down = False

    def _check(self):
        if self.down:
            raise memory.MemoryUnavailable("Cannot reach Hindsight (test)")

    async def ensure_bank(self, bank_id):
        pass

    async def retain(self, bank_id, content, **kw):
        self._check()
        self.banks.setdefault(bank_id, []).append(content)

    async def retain_batch(self, bank_id, items):
        self._check()
        self.banks.setdefault(bank_id, []).extend(i["content"] for i in items)

    async def recall(self, bank_id, query, limit=8):
        self._check()
        return [{"id": str(i), "text": t, "type": "world", "date": None, "bank": bank_id}
                for i, t in enumerate(self.banks.get(bank_id, [])[:limit])]

    async def list_learned(self, bank_id, limit=30):
        self._check()
        items = [{"id": str(i), "text": t, "type": "world", "date": None, "bank": bank_id}
                 for i, t in enumerate(self.banks.get(bank_id, []))]
        return {"total": len(items), "items": items[::-1][:limit]}

    async def reflect(self, bank_id, query, context=None):
        self._check()
        return f"{len(self.banks.get(bank_id, []))} reports found."

    async def delete_bank(self, bank_id):
        self._check()
        return self.banks.pop(bank_id, None) is not None


@pytest.fixture
def fake(monkeypatch):
    fm = FakeMemory()
    for name in ["ensure_bank", "retain", "retain_batch", "recall", "reflect", "delete_bank", "list_learned"]:
        monkeypatch.setattr(memory, name, getattr(fm, name))
    fm.next_events = []
    fm.replies = []

    async def extract(message, known, history=None):
        fm.last_history = history
        return fm.next_events

    async def reply(**kw):
        fm.replies.append(kw)
        return "reply"

    monkeypatch.setattr(llm, "extract_events", extract)
    monkeypatch.setattr(llm, "write_reply", reply)
    return fm


@pytest.fixture
def client(fake):
    with TestClient(app) as c:
        yield c


def say(client, fake, worker_id, *events, message="msg"):
    fake.next_events = list(events)
    r = client.post("/chat", json={"worker_id": worker_id, "message": message})
    assert r.status_code == 200, r.text
    return r.json()


def test_learning_across_workers_from_real_chats(client, fake):
    """No seed data: the reputation warning is learned from Lakshmi's chats and shown to Ravi."""
    lakshmi = client.post("/workers", json={"name": "Lakshmi", "language": "hi"}).json()["id"]
    say(client, fake, lakshmi, ExtractedEvent(type="promise", employer_name="Suresh Constructions", amount=650))
    say(client, fake, lakshmi, ExtractedEvent(type="work_day", days=10))
    r = say(client, fake, lakshmi, ExtractedEvent(type="payment", amount=5000, is_late=True))
    assert r["ledger"][0]["amount_owed"] == 1500
    rep_bank = " ".join(fake.banks["employer-reputation"])
    assert "short payment" in rep_bank and "late" in rep_bank and "Lakshmi" not in rep_bank

    ravi = client.post("/workers", json={"name": "Ravi", "language": "te"}).json()["id"]
    r = say(client, fake, ravi, ExtractedEvent(type="promise", employer_name="suresh", amount=700))
    assert r["extracted_events"][0]["employer_name"] == "Suresh Constructions"
    rep = [a for a in r["alerts"] if a["type"] == "employer_reputation"]
    assert rep and rep[0]["count"] == 1 and "short or late" in rep[0]["message"]

    say(client, fake, ravi, ExtractedEvent(type="work_day", days=6))
    r = say(client, fake, ravi, ExtractedEvent(type="payment", amount=3000))
    assert r["ledger"][0]["amount_owed"] == 1200
    assert any(a["type"] == "underpayment" and a["amount_owed"] == 1200 for a in r["alerts"])

    stats = client.get("/employers/suresh/reputation").json()["stats"]
    assert stats["workers_reporting_problems"] == 2 and stats["late_payment"] == 1

    # Ravi gets paid the rest -> his report flips from short to paid_ok (no double counting).
    say(client, fake, ravi, ExtractedEvent(type="payment", pays_full_balance=True))
    stats = client.get("/employers/suresh/reputation").json()["stats"]
    assert stats["workers_reporting_problems"] == 1 and stats["paid_ok"] == 1

    mem = client.get(f"/workers/{ravi}/memories").json()
    assert mem["total_learned"] == 4 and len(mem["learned"]) == 4


def test_undo_entry_recomputes_ledger(client, fake):
    w = client.post("/workers", json={"name": "Imran", "language": "en"}).json()["id"]
    say(client, fake, w, ExtractedEvent(type="promise", employer_name="Green Homes", amount=800))
    r = say(client, fake, w, ExtractedEvent(type="work_day", days=5))
    wrong = say(client, fake, w, ExtractedEvent(type="work_day", days=50))  # misheard
    wrong_id = wrong["extracted_events"][0]["id"]
    assert wrong["ledger"][0]["amount_owed"] == 44000

    msgs = client.get(f"/workers/{w}/messages").json()
    assert msgs[-2]["events"][0]["id"] == wrong_id  # entries are attached to the message

    r = client.delete(f"/workers/{w}/events/{wrong_id}").json()
    row = r["ledger"]["employers"][0]
    assert row["amount_owed"] == 4000 and len(row["entries"]) == 2
    assert "Correction" in fake.banks[f"worker-{w}"][-1]
    assert client.delete(f"/workers/{w}/events/{wrong_id}").status_code == 404


def test_delete_worker_and_reset(client, fake):
    w = client.post("/workers", json={"name": "Anil", "language": "en"}).json()["id"]
    say(client, fake, w, ExtractedEvent(type="promise", employer_name="X Builders", amount=500))
    assert client.delete(f"/workers/{w}").json()["deleted"] == w
    assert f"worker-{w}" not in fake.banks
    assert client.get("/workers").json() == []
    client.post("/workers", json={"name": "B", "language": "en"})
    assert client.post("/reset").status_code == 200
    assert client.get("/workers").json() == []


def test_chat_new_worker_full_flow(client, fake):
    w = client.post("/workers", json={"name": "Sita", "language": "te"}).json()

    fake.next_events = [ExtractedEvent(type="promise", employer_name="Suresh Constructions", amount=700)]
    r = client.post("/chat", json={"worker_id": w["id"], "message": "Suresh promised 700 a day"}).json()
    assert r["extracted_events"][0]["employer_name"] == "Suresh Constructions"

    # No employer named -> falls back to the last employer; 'total' days resolved in Python.
    fake.next_events = [ExtractedEvent(type="work_day", days=4)]
    client.post("/chat", json={"worker_id": w["id"], "message": "worked 4 days"})
    fake.next_events = [ExtractedEvent(type="work_day", days=5, is_total=True)]
    r = client.post("/chat", json={"worker_id": w["id"], "message": "5 days total now"}).json()
    assert r["extracted_events"][0]["days"] == 1

    fake.next_events = [ExtractedEvent(type="payment", employer_name="Suresh Constructions", amount=2000)]
    r = client.post("/chat", json={"worker_id": w["id"], "message": "got 2000"}).json()
    under = [a for a in r["alerts"] if a["type"] == "underpayment"]
    assert under[0]["amount_owed"] == 1500  # 5 x 700 - 2000
    assert "owed ₹1,500" in fake.replies[-1]["ledger_text"]
    assert r["recalled_memories"]

    fake.next_events = [ExtractedEvent(type="payment", pays_full_balance=True)]
    r = client.post("/chat", json={"worker_id": w["id"], "message": "he paid the rest"}).json()
    assert r["extracted_events"][0]["amount"] == 1500
    assert r["ledger"][0]["amount_owed"] == 0

    msgs = client.get(f"/workers/{w['id']}/messages").json()
    assert len(msgs) == 10


def test_hindsight_down_degrades_gracefully(client, fake):
    w = client.post("/workers", json={"name": "Anil", "language": "hi"}).json()
    fake.down = True
    fake.next_events = [ExtractedEvent(type="promise", employer_name="Green Homes", amount=800)]
    r = client.post("/chat", json={"worker_id": w["id"], "message": "Green Homes 800 per day"})
    assert r.status_code == 200
    assert r.json()["warnings"] and "Memory is offline" in r.json()["warnings"][0]
    m = client.get(f"/workers/{w['id']}/memories")
    assert m.status_code == 503 and "Hindsight" in m.json()["detail"]


def test_groq_down_returns_503_and_stores_nothing(client, fake, monkeypatch):
    w = client.post("/workers", json={"name": "Anil", "language": "en"}).json()

    async def boom(*a, **k):
        raise llm.LLMUnavailable("Cannot reach Groq right now.")
    monkeypatch.setattr(llm, "extract_events", boom)
    r = client.post("/chat", json={"worker_id": w["id"], "message": "hi"})
    assert r.status_code == 503 and r.json()["service"] == "groq"
    assert client.get(f"/workers/{w['id']}/messages").json() == []


def test_unknown_worker_404(client):
    assert client.get("/workers/nope/ledger").status_code == 404
    assert client.post("/workers", json={"name": "X", "language": "fr"}).status_code == 422


def test_worker_lookup_by_name(client, fake):
    client.post("/workers", json={"name": "Ravi", "language": "te"})
    say(client, fake, "Ravi", ExtractedEvent(type="promise", employer_name="S", amount=700))
    r = say(client, fake, "ravi", ExtractedEvent(type="work_day", days=2))
    assert r["ledger"][0]["amount_owed"] == 1400
    assert client.get("/workers/ravi/ledger").json()["employers"][0]["amount_owed"] == 1400


def test_change_language(client, fake):
    w = client.post("/workers", json={"name": "Anil", "language": "en"}).json()
    assert client.patch(f"/workers/{w['id']}", json={"language": "te"}).json()["language"] == "te"


REG = {"name": "Ravi", "phone": "+91 98765 43210", "pin": "1234", "pin_confirm": "1234", "language": "te",
       "recovery_question": 3, "recovery_answer": " Suresh  Constructions ", "accept_terms": True}


def test_register_login(client, fake):
    r = client.post("/auth/register", json=REG)
    assert r.status_code == 201 and "pin_hash" not in r.json() and "recovery_hash" not in r.json()
    assert r.json()["phone"] == "9876543210"
    assert client.post("/auth/register", json={**REG, "name": "X"}).status_code == 409
    assert client.post("/auth/login", json={"phone": "98765 43210", "pin": "1234"}).json()["name"] == "Ravi"
    assert client.post("/auth/login", json={"phone": "9876543210", "pin": "9999"}).status_code == 401
    assert client.post("/auth/login", json={"phone": "9876543210", "pin": "12a4"}).status_code == 422
    assert all("pin_hash" not in w for w in client.get("/workers").json())


def test_register_validation(client, fake):
    other = {**REG, "phone": "9111111111"}
    assert "match" in client.post("/auth/register", json={**other, "pin_confirm": "4321"}).json()["detail"]
    assert "Terms" in client.post("/auth/register", json={**other, "accept_terms": False}).json()["detail"]
    assert client.post("/auth/register", json={**other, "recovery_answer": None}).status_code == 422
    assert client.post("/auth/register", json={**other, "phone": "12345"}).status_code == 422


def test_forgot_pin_with_security_question(client, fake):
    client.post("/auth/register", json=REG)
    assert client.post("/auth/recovery-question", json={"phone": "9876543210"}).json() == {"question": 3}
    assert client.post("/auth/recovery-question", json={"phone": "9000000000"}).status_code == 404
    bad = client.post("/auth/reset-pin", json={"phone": "9876543210", "answer": "metro", "new_pin": "5555"})
    assert bad.status_code == 401
    ok = client.post("/auth/reset-pin", json={"phone": "9876543210", "answer": "suresh constructions", "new_pin": "5555"})
    assert ok.json() == {"ok": True}
    assert client.post("/auth/login", json={"phone": "9876543210", "pin": "5555"}).status_code == 200
    assert client.post("/auth/login", json={"phone": "9876543210", "pin": "1234"}).status_code == 401
    for _ in range(5):
        client.post("/auth/reset-pin", json={"phone": "9876543210", "answer": "nope", "new_pin": "1111"})
    assert client.post("/auth/reset-pin", json={"phone": "9876543210", "answer": "suresh constructions",
                                                 "new_pin": "1111"}).status_code == 429


def test_fixed_bonus_counts_in_ledger(client, fake):
    w = client.post("/workers", json={"name": "Mathew", "language": "en"}).json()["id"]
    r = say(client, fake, w, ExtractedEvent(type="promise", employer_name="Metro Builders", amount=2000, basis="fixed"))
    row = r["ledger"][0]
    assert (row["amount_earned"], row["amount_owed"], row["status"]) == (2000, 2000, "owed")
    say(client, fake, w, ExtractedEvent(type="promise", amount=600))
    say(client, fake, w, ExtractedEvent(type="work_day", days=5))
    r = say(client, fake, w, ExtractedEvent(type="payment", amount=3000))
    row = r["ledger"][0]
    assert (row["rate_per_day"], row["fixed_amount"], row["amount_earned"], row["amount_owed"]) == (600, 2000, 5000, 2000)
    assert "+ ₹2,000 fixed" in [a for a in r["alerts"] if a["type"] == "underpayment"][0]["message"]


def test_fixed_total_for_days_and_context_passed(client, fake):
    w = client.post("/workers", json={"name": "Parker", "language": "en"}).json()["id"]
    say(client, fake, w, ExtractedEvent(type="work_day", employer_name="Riyan", days=5), message="I worked 5 days for Riyan")
    r = say(client, fake, w, ExtractedEvent(type="promise", amount=50000, basis="fixed"), message="50000INR")
    row = r["ledger"][0]
    assert (row["employer_name"], row["amount_earned"], row["amount_owed"], row["status"]) == ("Riyan", 50000, 50000, "owed")
    # extraction saw the earlier turns, so a bare "50000INR" can be understood
    assert any("5 days" in m["content"] for m in fake.last_history)


def test_transcribe(client, fake, monkeypatch):
    seen = {}

    async def fake_transcribe(data, filename, language):
        seen.update(size=len(data), filename=filename, language=language)
        return "ఈ రోజు పని చేశాను"
    monkeypatch.setattr(llm, "transcribe", fake_transcribe)
    r = client.post("/transcribe", files={"audio": ("speech.webm", b"\x1a\x45fake", "audio/webm")}, data={"language": "te"})
    assert r.status_code == 200 and r.json()["text"] == "ఈ రోజు పని చేశాను"
    assert seen == {"size": 6, "filename": "speech.webm", "language": "te"}
    assert client.post("/transcribe", files={"audio": ("a.webm", b"", "audio/webm")}).status_code == 400


def test_welcome_and_nudges(client, fake, monkeypatch):
    w = client.post("/workers", json={"name": "Ravi", "language": "te"}).json()["id"]
    first = client.get(f"/workers/{w}/welcome").json()
    assert first["has_history"] is False and first["greeting"] is None and first["nudges"] == []

    say(client, fake, w, ExtractedEvent(type="work_day", employer_name="Kiran Builders", days=2))
    assert client.get(f"/workers/{w}/nudges").json()[0]["type"] == "missing_rate"
    say(client, fake, w, ExtractedEvent(type="promise", amount=700))
    say(client, fake, w, ExtractedEvent(type="work_day", days=4))
    say(client, fake, w, ExtractedEvent(type="payment", amount=3000, notes="said he will pay the rest later"))

    prompts = []

    async def fake_complete(prompt, max_tokens=300, temperature=0.5):
        prompts.append(prompt)
        return "Welcome back Ravi!"
    monkeypatch.setattr(llm, "complete", fake_complete)
    r = client.get(f"/workers/{w}/welcome").json()
    n = r["nudges"][0]
    assert (n["type"], n["employer_name"], n["amount_owed"], n["promised_later"]) == ("owed", "Kiran Builders", 1200, True)
    assert r["greeting"] == "Welcome back Ravi!" and "owes ₹1,200" in prompts[0] and "Telugu" in prompts[0]


def test_greeting_with_invented_numbers_is_dropped(client, fake, monkeypatch):
    from app import nudges as nudges_mod
    assert nudges_mod.greeting_is_grounded("Suresh still owes you ₹1,200, 5 days now", [{"amount_owed": 1200, "days_since": 5}])
    assert not nudges_mod.greeting_is_grounded("You got the ₹5,555 payment yesterday", [{"amount_owed": 1200, "days_since": 5}])
    assert not nudges_mod.greeting_is_grounded("payment for 5 days of work", [])
    assert nudges_mod.greeting_is_grounded("Welcome back Parker! How is work going?", [])

    w = client.post("/workers", json={"name": "Parker", "language": "en"}).json()["id"]
    say(client, fake, w, ExtractedEvent(type="other", notes="hello"))

    async def lying(prompt, max_tokens=300, temperature=0.5):
        return "Welcome back, Parker! You got the ₹5,555 payment yesterday, right?"
    monkeypatch.setattr(llm, "complete", lying)
    assert client.get(f"/workers/{w}/welcome").json()["greeting"] is None


def test_extraction_tolerates_nulls_and_odd_names():
    from app.llm import ExtractedEvent, _clean_event, _parse_events_json
    items = _parse_events_json('{"events": [{"type": "Work_Day", "employer_name": "Rakesh", "days": 5, "is_total": null, '
                               '"basis": null, "is_late": null, "pays_full_balance": null, "date": null}]}')
    ev = ExtractedEvent.model_validate(_clean_event(items[0]))
    assert (ev.type, ev.employer_name, ev.days, ev.is_total, ev.basis) == ("work_day", "Rakesh", 5, False, "day")
    assert _parse_events_json("not json") is None


def test_reply_that_does_its_own_maths_is_rewritten(client, fake, monkeypatch):
    w = client.post("/workers", json={"name": "Santosh", "language": "en"}).json()["id"]
    say(client, fake, w, ExtractedEvent(type="work_day", employer_name="Rakesh", days=5), message="5 days for Rakesh")
    drafts = ["You worked 5 days at ₹10,000 each. That means ₹50,000 is still owed.",
              "What daily rate did Rakesh promise you?"]
    corrections = []

    async def reply(**kw):
        corrections.append(kw.get("correction"))
        return drafts[len(corrections) - 1]
    monkeypatch.setattr(llm, "write_reply", reply)
    r = say(client, fake, w, message="10000")
    assert "50,000" not in r["reply"] and corrections[1] and "50000" in corrections[1]

    async def stubborn(**kw):
        return "That means ₹70,000 is still owed."
    monkeypatch.setattr(llm, "write_reply", stubborn)
    r = say(client, fake, w, message="how much is owed?")
    assert "70,000" not in r["reply"]


def test_facts_without_employer_name_still_count(client, fake):
    """'5 days' before any employer is named used to be dropped, so Earned/Paid/Owed stayed at ₹0."""
    w = client.post("/workers", json={"name": "Santosh", "language": "en"}).json()["id"]
    r = say(client, fake, w, ExtractedEvent(type="work_day", days=5), message="I worked 5 days")
    assert r["ledger"][0]["employer_name"] == "Employer (name not given)"
    assert "ask them the employer's name" in fake.replies[-1]["noted_text"]
    r = say(client, fake, w, ExtractedEvent(type="promise", amount=1000), message="1000 per day")
    assert r["ledger"][0]["amount_earned"] == 5000
    # Naming the employer moves the earlier facts over; nothing is double counted.
    r = say(client, fake, w, ExtractedEvent(type="payment", employer_name="Rakesh", amount=2000),
            message="Rakesh gave me 2000")
    assert [row["employer_name"] for row in r["ledger"]] == ["Rakesh"]
    totals = client.get(f"/workers/{w}/ledger").json()["totals"]
    assert totals == {"amount_earned": 5000, "amount_paid": 2000, "amount_owed": 3000, "amount_advance": 0}
    # The placeholder never becomes a shared "employer" with a reputation.
    assert client.get("/employers/Employer (name not given)/reputation").json()["stats"]["workers_reporting_problems"] == 0


def test_employer_inferred_from_conversation(client, fake):
    """'5 days' right after talking about a known employer is booked to that employer."""
    other = client.post("/workers", json={"name": "Ravi", "language": "en"}).json()["id"]
    say(client, fake, other, ExtractedEvent(type="promise", employer_name="Rakesh Builders", amount=700))
    w = client.post("/workers", json={"name": "Santosh", "language": "en"}).json()["id"]
    say(client, fake, w, message="I work for Rakesh")
    r = say(client, fake, w, ExtractedEvent(type="work_day", days=5), message="5 days")
    assert r["ledger"][0]["employer_name"] == "Rakesh Builders"


def test_short_answers_read_when_ai_finds_nothing(client, fake, monkeypatch):
    """The Santosh chat: HakDaar asks for the daily rate, the worker answers just '10000'."""
    w = client.post("/workers", json={"name": "Santosh", "language": "en"}).json()["id"]
    say(client, fake, w, ExtractedEvent(type="work_day", employer_name="Rakesh", days=5), message="I worked 5 days for Rakesh")
    monkeypatch.setattr("app.chat.db.list_messages", lambda wid, limit=6, **k: [
        {"role": "user", "content": "I worked 5 days for Rakesh"},
        {"role": "assistant", "content": "What daily rate did Rakesh promise for each day?"}])
    r = say(client, fake, w, message="10000")  # the AI returned no events
    row = r["ledger"][0]
    assert (row["employer_name"], row["rate_per_day"], row["amount_owed"]) == ("Rakesh", 10000, 50000)


def test_streamed_chat_sends_ledger_before_the_reply(client, fake):
    """The wallet must update as soon as facts are saved, not after the reply is written."""
    import json
    w = client.post("/workers", json={"name": "Santosh", "language": "en"}).json()["id"]
    say(client, fake, w, ExtractedEvent(type="promise", employer_name="Rakesh", amount=10000))
    fake.next_events = [ExtractedEvent(type="work_day", days=5)]
    r = client.post("/chat?stream=true", json={"worker_id": w, "message": "5 days"})
    assert r.status_code == 200
    parts = [json.loads(line) for line in r.text.splitlines()]
    assert [p["stage"] for p in parts] == ["recorded", "done"]
    assert parts[0]["ledger"]["totals"] == {"amount_earned": 50000, "amount_paid": 0, "amount_owed": 50000, "amount_advance": 0}
    assert parts[0]["extracted_events"][0]["days"] == 5 and parts[1]["reply"] == "reply"


def test_streamed_chat_error_before_saving_is_a_normal_error(client, fake, monkeypatch):
    async def down(*a, **k):
        raise llm.LLMUnavailable("Groq is down (test)")
    monkeypatch.setattr(llm, "extract_events", down)
    w = client.post("/workers", json={"name": "Santosh", "language": "en"}).json()["id"]
    r = client.post("/chat?stream=true", json={"worker_id": w, "message": "5 days"})
    assert r.status_code == 503 and client.get(f"/workers/{w}/messages").json() == []


def test_public_mode_only_the_signed_in_worker_sees_their_data(client, fake, monkeypatch):
    from app.config import settings
    reg = {"name": "Santosh", "phone": "9876543210", "pin": "1234", "pin_confirm": "1234", "language": "en",
           "recovery_question": 1, "recovery_answer": "hyderabad", "accept_terms": True}
    w = client.post("/auth/register", json=reg).json()["id"]
    other = client.post("/auth/register", json={**reg, "name": "Ravi", "phone": "9123456780"}).json()["id"]
    monkeypatch.setattr(settings, "public_mode", True)

    assert client.get("/workers").status_code == 404
    assert client.post("/reset").status_code == 404
    assert client.get(f"/workers/{w}/ledger").status_code == 401
    token = client.post("/auth/login", json={"phone": "9876543210", "pin": "1234"}).json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    assert client.get(f"/workers/{w}/ledger", headers=h).status_code == 200
    assert client.get(f"/workers/{other}/messages", headers=h).status_code == 403
    assert client.delete(f"/workers/{other}", headers=h).status_code == 403
    assert client.post("/chat", json={"worker_id": other, "message": "hi"}, headers=h).status_code == 403
    forged = {"Authorization": f"Bearer {other}.{token.rsplit('.', 1)[1]}"}
    assert client.get(f"/workers/{other}/ledger", headers=forged).status_code == 401
    fake.next_events = [ExtractedEvent(type="work_day", employer_name="Rakesh", days=2)]
    assert client.post("/chat", json={"worker_id": w, "message": "2 days"}, headers=h).status_code == 200


def test_overpayment_is_always_mentioned(client, fake):
    """Paid ₹1,800 for ₹1,000 of work: the wallet and the reply must both say ₹800 extra."""
    w = client.post("/workers", json={"name": "Uday", "language": "en"}).json()["id"]
    say(client, fake, w, ExtractedEvent(type="promise", employer_name="Rakesh", amount=200))
    say(client, fake, w, ExtractedEvent(type="work_day", days=5))
    r = say(client, fake, w, ExtractedEvent(type="payment", amount=1800), message="he gave me 1800")
    assert "PAID EXTRA" in fake.replies[-1]["ledger_text"] and "₹800" in fake.replies[-1]["ledger_text"]
    assert "₹800 more than you have earned" in r["reply"]            # the fake AI said nothing about it
    totals = client.get(f"/workers/{w}/ledger").json()["totals"]
    assert totals == {"amount_earned": 1000, "amount_paid": 1800, "amount_owed": 0, "amount_advance": 800}

    fake.next_events = []
    r = client.post("/chat", json={"worker_id": w, "message": "hello"}).json()
    assert r["reply"] == "reply"                                      # no nagging on small talk


def test_overpayment_note_in_workers_language(client, fake, monkeypatch):
    w = client.post("/workers", json={"name": "Uday", "language": "te"}).json()["id"]
    say(client, fake, w, ExtractedEvent(type="promise", employer_name="Rakesh", amount=200))
    say(client, fake, w, ExtractedEvent(type="work_day", days=5))

    async def says_amounts(**kw):
        return "మీకు ₹1,000 అందింది."
    monkeypatch.setattr(llm, "write_reply", says_amounts)
    r = say(client, fake, w, ExtractedEvent(type="payment", amount=1800))
    assert "₹800 ఎక్కువ" in r["reply"]


def test_vercel_deployment_addresses_are_allowed(client):
    """A friend opening a Vercel deployment link must not see 'offline' because of CORS."""
    def preflight(origin):
        return client.options("/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET",
                                                   "Access-Control-Request-Headers": "authorization"})
    for ok in ["https://hakdaar.vercel.app", "https://hakdaar-abc123-riyans-projects.vercel.app",
               "https://hakdaar-git-main-riyans-projects.vercel.app"]:
        r = preflight(ok)
        assert r.status_code == 200 and r.headers.get("access-control-allow-origin") == ok, ok
    for bad in ["https://evil.example.com", "https://hakdaar.vercel.app.evil.com", "http://hakdaar.vercel.app"]:
        assert preflight(bad).headers.get("access-control-allow-origin") is None, bad


def _short_paid_worker(client, fake, name, employer="Rakesh Builders"):
    w = client.post("/workers", json={"name": name, "language": "en"}).json()["id"]
    say(client, fake, w, ExtractedEvent(type="promise", employer_name=employer, amount=800))
    say(client, fake, w, ExtractedEvent(type="work_day", days=5))
    say(client, fake, w, ExtractedEvent(type="payment", amount=1000))
    return w


def test_one_report_is_unverified_two_is_a_warning(client, fake):
    """A single (possibly fake) account can't brand an employer; the other side is shown too."""
    _short_paid_worker(client, fake, "A")
    new = client.post("/workers", json={"name": "New", "language": "en"}).json()["id"]
    r = say(client, fake, new, ExtractedEvent(type="promise", employer_name="Rakesh Builders", amount=700))
    rep = [a for a in r["alerts"] if a["type"] == "employer_reputation"][0]
    assert rep["severity"] == "caution" and "single, unverified report" in rep["message"]

    _short_paid_worker(client, fake, "B")
    ok = client.post("/workers", json={"name": "C", "language": "en"}).json()["id"]
    say(client, fake, ok, ExtractedEvent(type="promise", employer_name="Rakesh Builders", amount=800))
    say(client, fake, ok, ExtractedEvent(type="work_day", days=2))
    say(client, fake, ok, ExtractedEvent(type="payment", amount=1600))
    rep = [a for a in client.get(f"/workers/{new}/alerts").json() if a["type"] == "employer_reputation"][0]
    assert rep["severity"] == "warning" and rep["count"] == 2
    assert "2 other workers reported short payment" in rep["message"]
    assert "1 worker said they were paid in full" in rep["message"]


def test_signups_are_limited_per_network_in_public_mode(client, fake, monkeypatch):
    from app import main as main_mod
    from app.config import settings
    monkeypatch.setattr(settings, "public_mode", True)
    monkeypatch.setattr(main_mod, "_signups", {})
    reg = {"name": "X", "pin": "1234", "pin_confirm": "1234", "language": "en",
           "recovery_question": 1, "recovery_answer": "hyderabad", "accept_terms": True}
    codes = [client.post("/auth/register", json={**reg, "phone": f"98000000{i:02d}"}).status_code for i in range(7)]
    assert codes == [201] * 5 + [429, 429]


@pytest.fixture
def admin(client, monkeypatch):
    """An admin account from settings (a made-up number, like the real one it lives only in env)."""
    from app import main as main_mod
    from app.config import settings
    monkeypatch.setattr(settings, "admin_phone", "9000000009")
    monkeypatch.setattr(settings, "admin_name", "Admin")
    monkeypatch.setattr(settings, "admin_pin", "4321")
    monkeypatch.setattr(main_mod, "_login_failures", {})
    main_mod.ensure_admin()
    r = client.post("/auth/login", json={"phone": "9000000009", "pin": "4321"}).json()
    assert r["is_admin"] is True
    return {"Authorization": f"Bearer {r['token']}"}


def test_admin_dashboard_is_admin_only(client, fake, admin):
    reg = {"name": "Ravi", "phone": "9123456780", "pin": "1234", "pin_confirm": "1234", "language": "en",
           "recovery_question": 1, "recovery_answer": "hyderabad", "accept_terms": True}
    ravi = client.post("/auth/register", json=reg).json()["id"]
    ravi_login = client.post("/auth/login", json={"phone": "9123456780", "pin": "1234"}).json()
    assert ravi_login["is_admin"] is False
    for path in ["/admin/overview", "/admin/workers", "/admin/reports"]:
        assert client.get(path).status_code == 401
        assert client.get(path, headers={"Authorization": f"Bearer {ravi_login['token']}"}).status_code == 403
    assert client.post("/admin/reset", headers={"Authorization": f"Bearer {ravi_login['token']}"}).status_code == 403

    # Overview, workers and reports
    _short_paid_worker(client, fake, "Fake Reporter")
    ov = client.get("/admin/overview", headers=admin).json()
    assert ov["workers"] == 3 and ov["reports_short"] == 1 and ov["total_owed"] == 3000
    workers = client.get("/admin/workers", headers=admin).json()
    assert {w["name"] for w in workers} == {"Admin", "Ravi", "Fake Reporter"}
    reports = client.get("/admin/reports", headers=admin).json()
    assert reports[0]["employer_name"] == "Rakesh Builders" and reports[0]["worker_name"] == "Fake Reporter"

    # Remove a false report, then a fake account
    assert client.delete(f"/admin/reports/{reports[0]['id']}", headers=admin).json()["deleted"] == reports[0]["id"]
    assert client.get("/employers/Rakesh Builders/reputation").json()["stats"]["workers_reporting_problems"] == 0
    assert client.delete(f"/admin/workers/{ravi}", headers=admin).json()["deleted"] == ravi
    admin_id = next(w["id"] for w in workers if w["is_admin"])
    assert client.delete(f"/admin/workers/{admin_id}", headers=admin).status_code == 400

    # Delete everything: the admin account comes back from settings
    assert client.post("/admin/reset", headers=admin).status_code == 200
    again = client.post("/auth/login", json={"phone": "9000000009", "pin": "4321"}).json()
    assert again["is_admin"] and [w["name"] for w in client.get(
        "/admin/workers", headers={"Authorization": f"Bearer {again['token']}"}).json()] == ["Admin"]


def test_admin_number_is_reserved_and_pin_only_set_on_server(client, admin):
    reg = {"name": "Someone", "phone": "9000000009", "pin": "1111", "pin_confirm": "1111", "language": "en",
           "recovery_question": 1, "recovery_answer": "x" * 3, "accept_terms": True}
    assert client.post("/auth/register", json=reg).status_code == 409
    assert client.post("/auth/recovery-question", json={"phone": "9000000009"}).status_code == 409
    assert client.post("/auth/reset-pin", json={"phone": "9000000009", "answer": "x", "new_pin": "0000"}).status_code == 409


def test_wrong_pin_guesses_are_limited(client, admin):
    codes = [client.post("/auth/login", json={"phone": "9000000009", "pin": f"{i:04d}"}).status_code
             for i in range(6)]
    assert codes == [401] * 5 + [429]
    # even the right PIN waits out the lock
    assert client.post("/auth/login", json={"phone": "9000000009", "pin": "4321"}).status_code == 429
