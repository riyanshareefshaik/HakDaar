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


def worker_from(request: Request) -> str | None:
    """The worker id a valid token belongs to, or None."""
    header = request.headers.get("authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    worker_id, _, sig = token.rpartition(".")
    if worker_id and hmac.compare_digest(issue(worker_id), token):
        return worker_id
    return None


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
