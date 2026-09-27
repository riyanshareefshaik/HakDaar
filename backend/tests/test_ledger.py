from app import ledger


def ev(type, employer="Suresh Constructions", amount=None, days=None):
    return {"type": type, "employer_name": employer, "amount": amount, "days": days}


def test_ravi_demo_numbers():
    rows = ledger.summarize([ev("promise", amount=700), ev("work_day", days=6), ev("payment", amount=3000)])
    r = rows[0]
    assert (r["rate_per_day"], r["days_worked"], r["amount_earned"], r["amount_paid"], r["amount_owed"]) == \
        (700, 6, 4200, 3000, 1200)
    assert r["status"] == "owed"


def test_latest_promise_wins_and_half_days():
    rows = ledger.summarize([ev("promise", amount=600), ev("promise", amount=650),
                             ev("work_day", days=2.5), ev("payment", amount=1000)])
    assert rows[0]["rate_per_day"] == 650
    assert rows[0]["days_worked"] == 2.5
    assert rows[0]["amount_earned"] == 1625
    assert rows[0]["amount_owed"] == 625


def test_unknown_rate_and_advance():
    rows = {r["employer_name"]: r for r in ledger.summarize([
        ev("work_day", employer="A", days=3),
        ev("promise", employer="B", amount=500), ev("work_day", employer="B", days=1), ev("payment", employer="B", amount=800),
    ])}
    assert rows["A"]["status"] == "unknown_rate" and rows["A"]["amount_owed"] is None
    assert rows["B"]["status"] == "advance" and rows["B"]["amount_owed"] == 0 and rows["B"]["advance"] == 300


def test_format_inr():
    assert ledger.format_inr(1200) == "₹1,200"
    assert ledger.format_inr(125000) == "₹1,25,000"
    assert ledger.format_inr(10000000) == "₹1,00,00,000"
    assert ledger.format_inr(None) == "unknown"
