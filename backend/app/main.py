"""HakDaar API — FastAPI entrypoint."""
import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .health import check_groq, check_hindsight

app = FastAPI(
    title="HakDaar API",
    description="AI rights companion for migrant and daily-wage workers. Memory by Hindsight.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"name": "HakDaar", "tagline": "Your work. Your wages. Remembered.", "docs": "/docs"}


@app.get("/health")
async def health():
    """Checks Hindsight and Groq in parallel. Always returns 200 so the UI can show details."""
    hindsight, groq = await asyncio.gather(check_hindsight(), check_groq())
    return {
        "status": "ok" if hindsight["ok"] and groq["ok"] else "degraded",
        "hindsight": hindsight,
        "groq": groq,
    }
