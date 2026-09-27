"""Exact wage arithmetic. The LLM never does maths; everything here is plain Python.

    earned = promised daily rate x days worked  +  agreed fixed amounts (bonus / lump sum for work done)
    owed   = earned - paid          (never negative; extra payment is shown as 'advance')
"""
from decimal import ROUND_HALF_UP, Decimal


def _rupees(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def summarize(events: list[dict]) -> list[dict]:
    """Group a worker's events by employer and compute exact totals."""
    by_employer: dict[str, dict] = {}
    for e in events:  # events are in insertion order, so the last promise wins
        row = by_employer.setdefault(e["employer_name"], {
            "employer_name": e["employer_name"],
            "rate_per_day": None,
            "days_worked": Decimal(0),
            "amount_paid": Decimal(0),
            "fixed_amount": Decimal(0),
            "payments": 0,
            "last_activity": None,
        })
        if e["type"] == "promise" and e.get("amount") is not None:
            if e.get("basis") == "fixed":
                row["fixed_amount"] += Decimal(e["amount"])
            else:
                row["rate_per_day"] = Decimal(e["amount"])
        elif e["type"] == "work_day":
            row["days_worked"] += Decimal(str(e.get("days") or 0))
        elif e["type"] == "payment" and e.get("amount") is not None:
            row["amount_paid"] += Decimal(e["amount"])
            row["payments"] += 1
        row["last_activity"] = e.get("date") or e.get("created_at")

    result = []
    for row in by_employer.values():
        rate, days, paid, fixed = row["rate_per_day"], row["days_worked"], row["amount_paid"], row["fixed_amount"]
        if rate is None and (days > 0 or fixed == 0):
            # Days worked (or nothing agreed at all) but no daily rate known: can't compute honestly.
            earned = owed = advance = None
            status = "unknown_rate"
        else:
            earned_d = (rate or Decimal(0)) * days + fixed
            earned = _rupees(earned_d)
            owed = _rupees(max(earned_d - paid, Decimal(0)))
            advance = _rupees(max(paid - earned_d, Decimal(0)))
            status = "owed" if owed > 0 else ("advance" if advance > 0 else "settled")
        result.append({
            "employer_name": row["employer_name"],
            "rate_per_day": _rupees(rate) if rate is not None else None,
            # keep half days, drop the trailing .0 for whole days
            "days_worked": float(days) if days % 1 else int(days),
            "amount_earned": earned,
            "amount_paid": _rupees(paid),
            "amount_owed": owed,
            "fixed_amount": _rupees(fixed),
            "advance": advance,
            "payments": row["payments"],
            "status": status,
            "last_activity": row["last_activity"],
        })
    # Most money owed first, so the problem is always at the top of the UI.
    result.sort(key=lambda r: (r["amount_owed"] or 0), reverse=True)
    return result


def totals(ledger: list[dict]) -> dict:
    return {
        "amount_earned": sum(r["amount_earned"] or 0 for r in ledger),
        "amount_paid": sum(r["amount_paid"] for r in ledger),
        "amount_owed": sum(r["amount_owed"] or 0 for r in ledger),
    }


def format_inr(amount: int | None) -> str:
    """Indian digit grouping: 125000 -> '₹1,25,000'."""
    if amount is None:
        return "unknown"
    s = str(abs(int(amount)))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        s = ",".join(groups) + "," + tail
    return ("-" if amount < 0 else "") + "₹" + s
