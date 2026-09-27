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

    async def reflect(self, bank_id, query, context=None):
        self._check()
        return f"{len(self.banks.get(bank_id, []))} reports found."

    async def delete_bank(self, bank_id):
        self._check()
        return self.banks.pop(bank_id, None) is not None


@pytest.fixture
def fake(monkeypatch):
    fm = FakeMemory()
    for name in ["ensure_bank", "retain", "retain_batch", "recall", "reflect", "delete_bank"]:
        monkeypatch.setattr(memory, name, getattr(fm, name))
    fm.next_events = []
    fm.replies = []

    async def extract(message, known):
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


def test_seed_ledgers_and_reputation(client, fake):
    r = client.post("/demo/seed").json()
    assert r["warnings"] == []
    workers = {w["name"]: w for w in r["workers"]}
    assert set(workers) == {"Ravi", "Lakshmi", "Imran"}

    ravi = client.get(f"/workers/{workers['Ravi']['id']}/ledger").json()
    suresh = ravi["employers"][0]
    assert (suresh["rate_per_day"], suresh["days_worked"], suresh["amount_paid"], suresh["amount_owed"]) == (700, 6, 3000, 1200)

    imran = client.get(f"/workers/{workers['Imran']['id']}/ledger").json()
    assert imran["employers"][0]["amount_owed"] == 0 and imran["employers"][0]["status"] == "settled"

    # Ravi sees Lakshmi's (anonymous) report, not his own.
    alerts = client.get(f"/workers/{workers['Ravi']['id']}/alerts").json()
    rep = [a for a in alerts if a["type"] == "employer_reputation"]
    assert rep and rep[0]["count"] == 1 and "Lakshmi" not in rep[0]["message"]
    assert any(a["type"] == "underpayment" and a["amount_owed"] == 1200 for a in alerts)

    stats = client.get("/employers/suresh/reputation").json()
    assert stats["employer_name"] == "Suresh Constructions"
    assert stats["stats"]["workers_reporting_problems"] == 2
    assert "Lakshmi" not in " ".join(fake.banks["employer-reputation"])
    assert len(fake.banks[f"worker-{workers['Ravi']['id']}"]) == 3


def test_chat_new_worker_full_flow(client, fake):
    client.post("/demo/seed")
    w = client.post("/workers", json={"name": "Sita", "language": "te"}).json()

    fake.next_events = [ExtractedEvent(type="promise", employer_name="suresh", amount=700)]
    r = client.post("/chat", json={"worker_id": w["id"], "message": "Suresh promised 700 a day"}).json()
    assert r["extracted_events"][0]["employer_name"] == "Suresh Constructions"  # matched existing name
    assert any(a["type"] == "employer_reputation" and a["count"] == 2 for a in r["alerts"])

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
    assert r["recalled_memories"]  # worker memories + reputation memories came back

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
    seeded = client.post("/demo/seed").json()
    assert len(seeded["workers"]) == 3 and seeded["warnings"]


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
    client.post("/demo/seed")
    assert client.get("/workers/ravi/ledger").json()["employers"][0]["amount_owed"] == 1200
    fake.next_events = [ExtractedEvent(type="work_day", days=2)]
    r = client.post("/chat", json={"worker_id": "Ravi", "message": "2 more days"}).json()
    assert r["ledger"][0]["amount_owed"] == 2600
