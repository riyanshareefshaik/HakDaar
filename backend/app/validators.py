"""Format checks for Indian business and organization IDs used at organization sign-up.

These confirm an ID is well-formed (and, for GSTIN, that its built-in check character is right).
They do not prove the ID belongs to the person signing up; the admin verifies that before an
organization is marked verified.
"""
import re

_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
# GST state codes: 01-38, plus 97 (other territory) and 99 (centre jurisdiction).
_GST_STATES = {f"{i:02d}" for i in range(1, 39)} | {"97", "99"}

PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
# 4th PAN character = holder type (P person, C company, F firm, H HUF, A AOP, T trust, B BOI,
# L local authority, J artificial juridical person, G government).
PAN_HOLDER = set("PCFHATBLJG")
GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
UDYAM_RE = re.compile(r"^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$")      # e.g. UDYAM-TS-02-0012345
DARPAN_RE = re.compile(r"^[A-Z]{2}/[0-9]{4}/[0-9]{7}$")           # NGO Darpan ID, e.g. TS/2019/0123456
OTHER_REG_RE = re.compile(r"^[A-Z0-9][A-Z0-9/\-. ]{2,39}$")        # union / office / legal-aid numbers
PINCODE_RE = re.compile(r"^[1-9][0-9]{5}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")


def normalize_id(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").upper())


def gstin_check_char(first14: str) -> str:
    total = 0
    for i, c in enumerate(first14):
        v = _CHARS.index(c) * (1 if i % 2 == 0 else 2)
        total += v // 36 + v % 36
    return _CHARS[(36 - total % 36) % 36]


def pan_error(pan: str) -> str | None:
    if not PAN_RE.match(pan):
        return "A PAN has 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCPE1234F)."
    if pan[3] not in PAN_HOLDER:
        return "This PAN's 4th letter isn't a valid holder type."
    return None


def gstin_error(g: str) -> str | None:
    if not GSTIN_RE.match(g):
        return "A GSTIN has 15 characters, e.g. 36ABCDE1234F1Z5 (state code, PAN, entity number, Z, check)."
    if g[:2] not in _GST_STATES:
        return "The first two digits of the GSTIN must be a valid state code (Telangana is 36)."
    if pan_error(g[2:12]):
        return "Characters 3 to 12 of the GSTIN must be a valid PAN."
    if gstin_check_char(g[:14]) != g[14]:
        return "This GSTIN's last character doesn't match. Please check it for typing mistakes."
    return None


def business_id_error(kind: str, value: str) -> str | None:
    if kind == "gstin":
        return gstin_error(value)
    if kind == "udyam":
        return None if UDYAM_RE.match(value) else "A Udyam number looks like UDYAM-TS-02-0012345."
    if kind == "pan":
        return pan_error(value)
    return "Choose GSTIN, Udyam or PAN."


def support_reg_error(category: str, value: str) -> str | None:
    if category == "ngo":
        return None if DARPAN_RE.match(value) else "An NGO Darpan ID looks like TS/2019/0123456."
    return None if OTHER_REG_RE.match(value) else "Enter the registration number (3 to 40 letters, digits, / or -)."


def pincode_error(pin: str) -> str | None:
    return None if PINCODE_RE.match(pin) else "A PIN code has 6 digits and doesn't start with 0."


def email_error(email: str) -> str | None:
    return None if EMAIL_RE.match(email) and len(email) <= 120 else "Enter a valid email address."
