"""Session tokens: 'worker_id.signature', signed with HMAC so they can't be forged or edited.

Login (phone + PIN) hands one out; every request for a worker's data must carry that worker's
token as 'Authorization: Bearer <token>'. Stateless: logging out just forgets the token.
"""
import hashlib
import hmac
import secrets

from fastapi import HTTPException, Request

from .config import settings

_secret: bytes | None = None


def _key() -> bytes:
    global _secret
    if _secret is None:
        if settings.session_secret:
            _secret = settings.session_secret.encode()
        else:
            path = settings.database_path.with_name(".session_secret")
            if not path.exists():
                path.write_text(secrets.token_hex(32))
                path.chmod(0o600)
            _secret = path.read_text().strip().encode()
    return _secret


def issue(worker_id: str) -> str:
    sig = hmac.new(_key(), worker_id.encode(), hashlib.sha256).hexdigest()[:40]
    return f"{worker_id}.{sig}"


def _subject(request: Request) -> str | None:
    """Whoever a valid token was issued to ('<worker id>' or 'm:<member id>'), or None."""
    header = request.headers.get("authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    subject, _, sig = token.rpartition(".")
    if subject and hmac.compare_digest(issue(subject), token):
        return subject
    return None


def worker_from(request: Request) -> str | None:
    """The worker id a valid worker token belongs to, or None (organization logins never count)."""
    who = _subject(request)
    return who if who and not who.startswith(MEMBER) else None


MEMBER = "m:"   # organization logins sign "m:<member id>", so they can never pass as a worker


def issue_member(member_id: str) -> str:
    return issue(MEMBER + member_id)


def member_from(request: Request) -> str | None:
    """The organization member id a valid token belongs to, or None."""
    who = _subject(request)
    return who[len(MEMBER):] if who and who.startswith(MEMBER) else None


def require(request: Request, worker_id: str) -> None:
    """In public mode, only the signed-in worker may read or change their own data."""
    if not settings.public_mode:
        return
    who = worker_from(request)
    if who is None:
        raise HTTPException(401, "Please log in again.")
    if who != worker_id:
        raise HTTPException(403, "This account belongs to someone else.")


def require_any(request: Request) -> None:
    if settings.public_mode and worker_from(request) is None:
        raise HTTPException(401, "Please log in again.")


def demo_only() -> None:
    if settings.public_mode:
        raise HTTPException(404, "Not found")
