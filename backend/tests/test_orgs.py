"""Organizations: employer companies and worker-support groups (see app/orgs.py for the rules)."""
import pytest

from app.llm import ExtractedEvent
from test_chat_flow import FakeMemory, admin, client, fake, say  # noqa: F401  (fixtures)


def worker(client, name, phone):
    return client.post("/auth/register", json={
        "name": name, "phone": phone, "pin": "1234", "pin_confirm": "1234", "language": "en",
        "recovery_question": 1, "recovery_answer": "hyderabad", "accept_terms": True}).json()["id"]


_n = iter(range(1000, 9999))


def gstin(state="36"):
    """A well-formed GSTIN (valid check character) for tests."""
    from app.validators import gstin_check_char
    first = f"{state}AABCR{next(_n):04d}K1Z"
    return first + gstin_check_char(first)


def reg_body(name, kind, phone, **over):
    base = ({"category": "construction", "reg_type": "gstin", "reg_number": gstin(), "area": "Kukatpally"}
            if kind == "employer" else {"category": "ngo", "reg_type": "darpan", "reg_number": f"TS/2019/{next(_n):07d}"})
    return {"org_name": name, "kind": kind, "email": f"{phone}@example.org", "city": "Hyderabad", "pincode": "500072",
            "phone": phone, "pin": "5678", "pin_confirm": "5678", "accept_terms": True, **base, **over}


def org(client, name, kind, phone):
    r = client.post("/org/register", json=reg_body(name, kind, phone))
    assert r.status_code == 201, r.text
    t = client.post("/org/login", json={"phone": phone, "pin": "5678"}).json()["token"]
    return {"Authorization": f"Bearer {t}"}


def totals(client, w):
    return client.get(f"/workers/{w}/ledger").json()["totals"]


def test_employer_organization_end_to_end(client, fake, admin):
    ravi = worker(client, "Ravi", "9123456780")
    say(client, fake, ravi, ExtractedEvent(type="promise", employer_name="Rakesh", amount=800))
    say(client, fake, ravi, ExtractedEvent(type="work_day", days=5))
    say(client, fake, ravi, ExtractedEvent(type="payment", amount=2000))

    boss = org(client, "Rakesh Builders", "employer", "9800000001")
    assert client.post("/org/register", json=reg_body("rakesh builders", "employer", "9800000009")).status_code == 409

    # Team: owner adds a supervisor; supervisors can record but not invite
    assert client.post("/org/members", headers=boss, json={"name": "Sup", "phone": "9800000002", "pin": "2222",
                                                           "role": "supervisor"}).status_code == 201
    sup = {"Authorization": "Bearer " + client.post("/org/login", json={"phone": "9800000002", "pin": "2222"}).json()["token"]}
    assert client.post("/org/invites", headers=sup, json={"phone": "9123456780"}).status_code == 403
    assert client.post("/org/members", headers=sup, json={"name": "X", "phone": "9800000003", "pin": "3333",
                                                          "role": "manager"}).status_code == 403

    # Invite -> worker accepts, saying their "Rakesh" is this company: entries merge, no second row
    assert client.post("/org/invites", headers=boss, json={"phone": "9123456780"}).json()["status"] == "invited"
    mine = client.get(f"/workers/{ravi}/organizations").json()
    inv = mine["invites"][0]
    assert inv["org_name"] == "Rakesh Builders" and inv["suggested_alias"] == "Rakesh" and inv["verified"] is False
    r = client.post(f"/workers/{ravi}/invites/{inv['id']}", json={"accept": True, "employer_alias": "Rakesh"}).json()
    assert r == {"status": "active", "merged_entries": 3}
    rows = client.get(f"/workers/{ravi}/ledger").json()["employers"]
    assert [x["employer_name"] for x in rows] == ["Rakesh Builders"] and rows[0]["amount_owed"] == 2000

    dues = client.get("/org/dues", headers=boss).json()
    assert dues["totals"]["owed"] == 2000 and dues["workers"][0]["days_worked"] == 5

    # Employer records a payment: it waits for Ravi, and doesn't count yet. No double-recording.
    e = client.post(f"/org/workers/{ravi}/entries", headers=sup, json={"type": "payment", "amount": 1500}).json()
    assert e["status"] == "pending"
    assert client.post(f"/org/workers/{ravi}/entries", headers=boss, json={"type": "payment", "amount": 1500}).status_code == 409
    assert totals(client, ravi)["amount_paid"] == 2000
    assert client.get("/org/dues", headers=boss).json()["totals"]["pending"] == 1

    c = client.post(f"/workers/{ravi}/entries/{e['id']}/confirm").json()
    assert c["merged"] is False and c["totals"]["amount_paid"] == 3500 and c["totals"]["amount_owed"] == 500

    # Ravi already noted a payment; the employer records the same one -> confirming keeps ONE entry
    say(client, fake, ravi, ExtractedEvent(type="payment", employer_name="Rakesh Builders", amount=300))
    e2 = client.post(f"/org/workers/{ravi}/entries", headers=boss, json={"type": "payment", "amount": 300}).json()
    c2 = client.post(f"/workers/{ravi}/entries/{e2['id']}/confirm").json()
    assert c2["merged"] is True and c2["kept"]["verified_org"] and c2["totals"]["amount_paid"] == 3800

    # Employer records 2 days; Ravi then says it in chat -> theirs is confirmed, no copy made
    client.post(f"/org/workers/{ravi}/entries", headers=boss, json={"type": "work_day", "days": 2})
    r = say(client, fake, ravi, ExtractedEvent(type="work_day", employer_name="Rakesh Builders", days=2))
    assert r["extracted_events"][0]["source"] == "employer" and r["extracted_events"][0]["status"] == "confirmed"
    assert client.get(f"/workers/{ravi}/organizations").json()["pending"] == []
    assert client.get(f"/workers/{ravi}/ledger").json()["employers"][0]["days_worked"] == 7

    # Disputed entries never count
    e3 = client.post(f"/org/workers/{ravi}/entries", headers=boss, json={"type": "payment", "amount": 5000}).json()
    d = client.post(f"/workers/{ravi}/entries/{e3['id']}/dispute", json={"reason": "I never got this"}).json()
    assert d["status"] == "disputed" and totals(client, ravi)["amount_paid"] == 3800
    assert client.get("/org/dues", headers=boss).json()["totals"]["disputed"] == 1

    # Undo of a confirmed employer entry puts it back to 'waiting', it isn't lost
    client.delete(f"/workers/{ravi}/events/{e['id']}")
    assert [p["id"] for p in client.get(f"/workers/{ravi}/organizations").json()["pending"]] == [e["id"]]

    # Replies to reports only once HakDaar verifies the organization
    assert client.post("/org/reputation/reply", headers=boss, json={"text": "We pay every Saturday."}).status_code == 403
    oid = client.get("/org/me", headers=boss).json()["org"]["id"]
    assert client.post(f"/admin/orgs/{oid}/verify", headers=admin, json={"verified": True}).status_code == 200
    assert client.post("/org/reputation/reply", headers=boss, json={"text": "We pay every Saturday."}).status_code == 201
    assert client.get("/employers/Rakesh Builders/reputation").json()["employer_reply"]["text"] == "We pay every Saturday."
    rep = client.get("/org/reputation", headers=boss).json()
    assert rep["verified"] is True and "worker_id" not in str(rep["stats"])

    # Leaving: the employer can't record anything more for Ravi
    link = client.get(f"/workers/{ravi}/organizations").json()["joined"][0]
    assert client.delete(f"/workers/{ravi}/organizations/{link['id']}").json() == {"status": "removed"}
    assert client.post(f"/org/workers/{ravi}/entries", headers=boss, json={"type": "payment", "amount": 1}).status_code == 404


def test_support_organization_cases(client, fake):
    lak = worker(client, "Lakshmi", "9123456781")
    say(client, fake, lak, ExtractedEvent(type="promise", employer_name="Suresh", amount=600))
    say(client, fake, lak, ExtractedEvent(type="work_day", days=10))
    ngo = org(client, "Hyderabad Workers Forum", "support", "9800000011")
    client.post("/org/members", headers=ngo, json={"name": "Case", "phone": "9800000012", "pin": "4444", "role": "caseworker"})
    assert client.post("/org/members", headers=ngo, json={"name": "M", "phone": "9800000013", "pin": "4444",
                                                          "role": "manager"}).status_code == 422
    assert client.get("/org/dues", headers=ngo).status_code == 403            # employer-only screen
    assert client.get("/org/cases", headers=ngo).json() == []                 # nothing before consent
    client.post("/org/invites", headers=ngo, json={"phone": "9123456781"})
    inv = client.get(f"/workers/{lak}/organizations").json()["invites"][0]
    client.post(f"/workers/{lak}/invites/{inv['id']}", json={"accept": True})
    cases = client.get("/org/cases", headers=ngo).json()
    assert cases[0]["owed"] == 6000 and cases[0]["employers_owing"] == ["Suresh"] and cases[0]["case_status"] == "open"
    client.post(f"/org/cases/{lak}/notes", headers=ngo, json={"text": "Called Suresh, promised Friday."})
    client.patch(f"/org/cases/{lak}", headers=ngo, json={"status": "resolved"})
    case = client.get(f"/org/cases/{lak}", headers=ngo).json()
    assert case["case_status"] == "resolved" and case["notes"][0]["text"].startswith("Called") and case["totals"]["amount_owed"] == 6000


def test_logins_are_kept_apart(client, fake, monkeypatch):
    from app import org_routes
    from app.config import settings
    monkeypatch.setattr(org_routes, "_login_failures", {})
    w = worker(client, "Imran", "9123456782")
    wtok = {"Authorization": "Bearer " + client.post("/auth/login", json={"phone": "9123456782", "pin": "1234"}).json()["token"]}
    boss = org(client, "Green Homes", "employer", "9800000021")
    assert client.get("/org/me", headers=wtok).status_code == 401             # a worker login isn't an org login
    monkeypatch.setattr(settings, "public_mode", True)
    assert client.get(f"/workers/{w}/ledger", headers=boss).status_code == 401   # an org login isn't a worker login
    assert client.get("/admin/overview", headers=boss).status_code == 401
    codes = [client.post("/org/login", json={"phone": "9800000021", "pin": f"{i:04d}"}).status_code for i in range(6)]
    assert codes[-1] == 429


def test_admin_can_list_and_remove_organizations(client, fake, admin):
    ravi = worker(client, "Ravi", "9123456783")
    boss = org(client, "Metro Builders", "employer", "9800000031")
    client.post("/org/invites", headers=boss, json={"phone": "9123456783"})
    inv = client.get(f"/workers/{ravi}/organizations").json()["invites"][0]
    client.post(f"/workers/{ravi}/invites/{inv['id']}", json={"accept": True})
    client.post(f"/org/workers/{ravi}/entries", headers=boss, json={"type": "payment", "amount": 700})
    listed = client.get("/admin/orgs", headers=admin).json()
    assert listed[0]["name"] == "Metro Builders" and listed[0]["workers"] == 1 and listed[0]["verified"] is False
    assert client.get("/admin/overview", headers=admin).json()["organizations"] == 1
    assert client.delete(f"/admin/orgs/{listed[0]['id']}", headers=admin).status_code == 200
    assert client.get(f"/workers/{ravi}/organizations").json()["pending"] == []   # unconfirmed entries go too
    assert client.get("/org/me", headers=boss).status_code == 401


def test_registration_details_are_checked_and_unique(client):
    from app.validators import gstin_error
    assert gstin_error("27AAPFU0939F1ZV") is None                        # the GST portal's sample GSTIN
    assert "last character" in gstin_error("27AAPFU0939F1ZW")             # one wrong character
    assert "state code" in gstin_error("40AAPFU0939F1ZV")

    def reg(**over):
        return client.post("/org/register", json=reg_body("Sai Enterprises", "employer", "9800000041", **over))
    assert "last character" in reg(reg_number="27AAPFU0939F1ZW").json()["detail"]
    assert "Udyam" in reg(reg_type="udyam", reg_number="UDYAM-TS-2-12345").json()["detail"]
    assert "PAN" in reg(reg_type="pan", reg_number="ABCD1234F").json()["detail"]
    assert reg(category="spaceship").status_code == 422
    assert reg(area="").status_code == 422
    assert "PIN code" in reg(pincode="012345").json()["detail"]
    assert "email" in reg(email="not-an-email").json()["detail"]
    assert "owner_name" not in reg_body("x", "employer", "1")                # no personal name needed
    ok = reg(reg_type="udyam", reg_number=" udyam-ts-02-0012345 ", email="Office@Sai.in")
    assert ok.status_code == 201, ok.text
    # the same ID or email can't register a second organization
    again = client.post("/org/register", json=reg_body("Sai Traders", "employer", "9800000042",
                                                        reg_type="udyam", reg_number="UDYAM-TS-02-0012345"))
    assert again.status_code == 409 and "registration number" in again.json()["detail"]
    email_again = client.post("/org/register", json=reg_body("Sai Traders", "employer", "9800000042", email="office@sai.in"))
    assert email_again.status_code == 409 and "email" in email_again.json()["detail"]

    # support groups: NGO Darpan format; other types take their own registration number
    ngo = lambda **o: client.post("/org/register", json=reg_body("Help Trust", "support", "9800000043", **o))
    assert "Darpan" in ngo(reg_number="12345").json()["detail"]
    union = ngo(category="union", reg_type="registration", reg_number="TU/HYD/1234")
    assert union.status_code == 201 and union.json()["member"]["name"] == "Help Trust"
    assert client.get("/org/options").json()["support"]["labour_office"] == "Government labour office"
