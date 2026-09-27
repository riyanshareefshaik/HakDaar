"""Groq (OpenAI-compatible) calls: structured event extraction and the final reply.

The LLM only *reads* and *writes words*. It never computes totals: extraction
returns raw facts, and the reply prompt is handed pre-computed numbers.
"""
import json
import logging
from datetime import date

from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI
from pydantic import BaseModel, Field, ValidationError, field_validator

from .config import settings

log = logging.getLogger("hakdaar.llm")

LANGUAGES = {
    "en": "English",
    "te": "Telugu (use Telugu script, తెలుగు)",
    "hi": "Hindi (use Devanagari script, हिंदी)",
}


class LLMUnavailable(Exception):
    """Raised with a user-presentable message when Groq can't be used."""


_client: AsyncOpenAI | None = None


def client() -> AsyncOpenAI:
    global _client
    if not settings.groq_api_key:
        raise LLMUnavailable("GROQ_API_KEY is not set. Add it to .env and restart the backend.")
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.groq_api_key, base_url=settings.groq_base_url,
                              timeout=30.0, max_retries=1)
    return _client


async def _chat(messages: list[dict], *, json_mode: bool, temperature: float, max_tokens: int) -> str:
    kwargs = {"response_format": {"type": "json_object"}} if json_mode else {}
    try:
        resp = await client().chat.completions.create(
            model=settings.groq_model, messages=messages, temperature=temperature,
            max_tokens=max_tokens, **kwargs,
        )
    except APIStatusError as e:
        if e.status_code == 401:
            raise LLMUnavailable("Groq rejected the API key. Check GROQ_API_KEY in .env.") from e
        if e.status_code == 429:
            raise LLMUnavailable("Groq rate limit reached. Please wait a few seconds and try again.") from e
        raise LLMUnavailable(f"Groq returned an error ({e.status_code}). Please try again.") from e
    except (APIConnectionError, APITimeoutError) as e:
        raise LLMUnavailable("Cannot reach Groq right now. Check your internet connection.") from e
    return resp.choices[0].message.content or ""


# ---------------------------------------------------------------- extraction

class ExtractedEvent(BaseModel):
    type: str = Field(pattern="^(promise|work_day|payment|other)$")
    employer_name: str | None = None
    amount: float | None = None
    days: float | None = None
    date: str | None = None
    notes: str | None = None
    # Extra hints that let Python (not the LLM) do the arithmetic:
    is_total: bool = False           # "I have worked 8 days in total" / "he has paid 5000 in all"
    pays_full_balance: bool = False  # "he paid me everything he owed"
    is_late: bool = False            # payment came later than promised

    @field_validator("amount", "days", mode="before")
    @classmethod
    def _numberish(cls, v):
        # Accept "₹3,000" or "3000 rupees" in case the model returns a string.
        if isinstance(v, str):
            digits = "".join(c for c in v if c.isdigit() or c == ".")
            return float(digits) if digits else None
        return v


EXTRACTION_PROMPT = """You extract wage facts from a daily-wage worker's chat message. Today is {today}.
The worker may write in English, Telugu, Hindi, or a mix (including romanised Telugu/Hindi).

Return ONLY JSON: {{"events": [ ... ]}}. Each event:
{{"type": "promise" | "work_day" | "payment" | "other",
  "employer_name": string or null,
  "amount": number or null,
  "days": number or null,
  "date": "YYYY-MM-DD" or null,
  "notes": short English note or null,
  "is_total": boolean,
  "pays_full_balance": boolean,
  "is_late": boolean}}

Rules:
- promise: employer promised a DAILY rate. amount = rupees per day. If a weekly/monthly/lump-sum amount is promised, put it in notes and set type "other".
- work_day: the worker worked. days = number of days worked mentioned in THIS message (default 1 for "I worked today"). Half day = 0.5.
  If the worker states a running TOTAL ("I have worked 8 days so far"), set is_total true and days = that total.
- payment: the worker received money. amount = rupees received in THIS message.
  If they state a running total received ("he has paid me 5000 in all"), set is_total true.
  If they say they were paid everything owed / the full balance without a number, set amount null and pays_full_balance true.
  If they say the payment came late / after a delay / after many days or weeks of waiting, set is_late true.
- other: anything else relevant (complaints, delays, threats, questions). One "other" event is enough; do not create events for greetings.
- NEVER calculate anything. Copy numbers exactly as the worker said them. Convert words like "teen hazaar"/"మూడు వేలు" to 3000.
- employer_name: reuse the exact spelling from KNOWN EMPLOYERS when it is clearly the same employer (e.g. "Suresh" -> "Suresh Constructions").
  If the worker doesn't name the employer, use null.
- Resolve relative dates ("yesterday", "last Monday") against today. Unknown date -> null.
- A question like "how much does Suresh owe me?" is NOT a payment or work_day. Return an "other" event or an empty list.

KNOWN EMPLOYERS for this worker: {employers}
"""


async def extract_events(message: str, known_employers: list[str]) -> list[ExtractedEvent]:
    prompt = EXTRACTION_PROMPT.format(
        today=date.today().isoformat(),
        employers=", ".join(known_employers) if known_employers else "(none yet)",
    )
    raw = await _chat(
        [{"role": "system", "content": prompt}, {"role": "user", "content": message}],
        json_mode=True, temperature=0.0, max_tokens=800,
    )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("Extraction returned invalid JSON: %r", raw[:300])
        return []
    events = []
    for item in data.get("events", []) if isinstance(data, dict) else []:
        try:
            events.append(ExtractedEvent.model_validate(item))
        except ValidationError as e:
            log.warning("Dropping invalid event %r: %s", item, e)
    return events


# ---------------------------------------------------------------- reply

REPLY_PROMPT = """You are HakDaar, a kind, trustworthy friend who helps daily-wage and migrant workers in Hyderabad
keep track of their wages. You are talking to {name}.

Reply ONLY in {language}. Use very simple words, short sentences, like talking to a friend with little schooling.
Keep it under 80 words. Be warm and respectful. No markdown tables, no headings.

STRICT RULES ABOUT NUMBERS:
- Only use rupee amounts and day counts that appear in LEDGER or ALERTS below. Never add, subtract or multiply yourself.
- If the worker asks how much is owed, read the "owed" figure from LEDGER exactly.
- If a rate is unknown, kindly ask what daily rate was promised.

WHAT TO DO:
- Confirm what you noted from their message (from NOTED THIS TURN) in one short line.
- If money is owed, say the exact amount clearly and suggest one practical, gentle next step
  (ask the employer politely with the dates and amount, keep a record, or contact the local labour office if they refuse).
- If ALERTS mention other workers' reports about an employer, warn gently without naming any other worker.
- Use MEMORIES to show you remember earlier conversations (e.g. what was promised and when), but trust LEDGER for numbers.
- This is not legal advice; never threaten anyone.

LEDGER (exact, computed by the app):
{ledger}

NOTED THIS TURN:
{noted}

ALERTS:
{alerts}

MEMORIES about this worker (from past conversations):
{memories}

WHAT OTHER WORKERS HAVE REPORTED about these employers (anonymous):
{reputation}
"""


async def write_reply(*, worker_name: str, language: str, message: str, history: list[dict],
                      ledger_text: str, noted_text: str, alerts_text: str,
                      memories_text: str, reputation_text: str) -> str:
    system = REPLY_PROMPT.format(
        name=worker_name, language=LANGUAGES.get(language, "English"),
        ledger=ledger_text, noted=noted_text, alerts=alerts_text,
        memories=memories_text, reputation=reputation_text,
    )
    msgs = [{"role": "system", "content": system}]
    # A few recent turns keep the conversation natural; long-term context comes from Hindsight.
    for m in history[-6:]:
        msgs.append({"role": m["role"], "content": m["content"]})
    msgs.append({"role": "user", "content": message})
    return (await _chat(msgs, json_mode=False, temperature=0.4, max_tokens=400)).strip()
