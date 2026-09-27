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
        hs_model = settings.hindsight_llm_model
        hs_note = None if hs_model in ids else (
            f"Hindsight's model '{hs_model}' is not on your Groq account, so memory can't learn. "
            f"Set HINDSIGHT_LLM_MODEL in .env to one of available_models and re-run ./scripts/start-hindsight.sh")
        if model in ids:
            out = {"ok": True, "model": model}
            if hs_note:
                out.update(hindsight_model_warning=hs_note, available_models=None)
                from .llm import chat_models
                out["available_models"] = chat_models(ids)
            return out
        # Not fatal: the backend automatically falls back to a model this account has.
        from .llm import chat_models, choose_model
        fallback = choose_model(ids)
        return {
            "ok": fallback is not None,
            "model": fallback or model,
            "configured_model": model,
            "warning": (f"GROQ_MODEL '{model}' is not available on your Groq account; using '{fallback}'. "
                        f"Set GROQ_MODEL={fallback} in .env to silence this.") if fallback else None,
            "error": None if fallback else f"Model '{model}' not available and no chat model found on Groq.",
            "available_models": chat_models(ids),
            "hindsight_model_warning": hs_note,
        }
    except httpx.HTTPError as e:
        return {"ok": False, "model": model, "error": f"Cannot reach Groq: {e}"}
