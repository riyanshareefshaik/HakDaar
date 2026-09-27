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

    # Relative paths are resolved against backend/ so the DB lands in a predictable place.
    database_path: Path = BACKEND_DIR / os.getenv("DATABASE_PATH", "hakdaar.db")

    cors_origins: list[str] = [
        o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()
    ]


settings = Settings()
