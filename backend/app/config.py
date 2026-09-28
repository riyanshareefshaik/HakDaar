"""Central settings, loaded from the repo-root .env (or backend/.env)."""
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

# Prefer the repo-root .env; fall back to backend/.env. Real env vars win over both.
load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_DIR / ".env")


class Settings:
    groq_api_key: str = os.getenv("GROQ_API_KEY", "")
    groq_base_url: str = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
    groq_model: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

    hindsight_url: str = os.getenv("HINDSIGHT_URL", "http://localhost:8888").rstrip("/")
    # Only used by /health to check the model the Hindsight container was started with.
    hindsight_llm_model: str = os.getenv("HINDSIGHT_LLM_MODEL", "openai/gpt-oss-20b")

    # Relative paths are resolved against backend/ so the DB lands in a predictable place.
    database_path: Path = BACKEND_DIR / os.getenv("DATABASE_PATH", "hakdaar.db")

    cors_origins: list[str] = [
        o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()
    ]
    # Vercel also serves every deployment at its own address (hakdaar-abc123-team.vercel.app,
    # hakdaar-git-main-team.vercel.app). Accept those too, so a shared deployment link isn't "offline".
    # Sign-in uses a token, not cookies, so allowing these origins exposes no one's data.
    cors_origin_regex: str = os.getenv("CORS_ORIGIN_REGEX", r"https://hakdaar(-[a-z0-9-]+)?\.vercel\.app")

    # Hosted on the internet: every worker's data needs that worker's session token, and the
    # demo-only routes (list all workers, create without a PIN, wipe everything) are switched off.
    public_mode: bool = os.getenv("PUBLIC_MODE", "false").lower() in ("1", "true", "yes")
    # Signs session tokens. If unset, a random one is created next to the database and reused.
    session_secret: str = os.getenv("SESSION_SECRET", "")


settings = Settings()
