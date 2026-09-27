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
