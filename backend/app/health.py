"""Reachability checks for the two external dependencies: Hindsight and Groq."""
import httpx

from .config import settings

TIMEOUT = httpx.Timeout(5.0)


async def check_hindsight() -> dict:
    """Hindsight exposes GET /health; we also fetch /version to show the server version."""
    url = settings.hindsight_url
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(f"{url}/health")
            r.raise_for_status()
            version = None
            try:
                v = await client.get(f"{url}/version")
                if v.is_success:
                    version = v.json().get("api_version")
            except (httpx.HTTPError, ValueError):
                pass  # version is nice-to-have only
        return {"ok": True, "url": url, "version": version}
    except httpx.ConnectError:
        return {"ok": False, "url": url,
                "error": "Cannot connect to Hindsight. Is the Docker container running? (see README)"}
    except httpx.HTTPError as e:
        return {"ok": False, "url": url, "error": f"Hindsight health check failed: {e}"}


async def check_groq() -> dict:
    """List Groq models (cheap, no tokens used) and confirm the configured model exists."""
    model = settings.groq_model
    if not settings.groq_api_key:
        return {"ok": False, "model": model, "error": "GROQ_API_KEY is not set in .env"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{settings.groq_base_url}/models",
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            )
        if r.status_code == 401:
            return {"ok": False, "model": model, "error": "Groq rejected the API key (401)"}
        r.raise_for_status()
        ids = {m["id"] for m in r.json().get("data", [])}
        if model not in ids:
            return {"ok": False, "model": model,
                    "error": f"Model '{model}' not available on Groq. Change GROQ_MODEL in .env."}
        return {"ok": True, "model": model}
    except httpx.HTTPError as e:
        return {"ok": False, "model": model, "error": f"Cannot reach Groq: {e}"}
