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


# Tried in order if the configured GROQ_MODEL isn't available on this Groq account.
FALLBACK_MODELS = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b",
                   "meta-llama/llama-4-maverick-17b-128e-instruct", "llama-3.1-8b-instant"]
_active_model: str | None = None


# Model ids that are not chat/text-generation models.
_NON_CHAT = ("whisper", "tts", "guard", "embed", "orpheus", "playai", "distil")


def chat_models(ids) -> list[str]:
    return sorted(i for i in ids if not any(x in i.lower() for x in _NON_CHAT))


def choose_model(available: set[str], exclude: str | None = None) -> str | None:
    """Best chat model this Groq account actually has: known-good list first, then any chat model."""
    for m in FALLBACK_MODELS:
        if m in available and m != exclude:
            return m
    return next((m for m in chat_models(available) if m != exclude), None)


async def _pick_fallback_model(bad: str) -> str | None:
    try:
        available = {m.id async for m in client().models.list()}
    except Exception:  # noqa: BLE001 - any failure here just means "no fallback"
        return None
    return choose_model(available, exclude=bad)


def _groq_error_text(e: APIStatusError) -> str:
    body = e.body if isinstance(e.body, dict) else {}
    err = body.get("error", body)
    return (err.get("message") if isinstance(err, dict) else None) or str(e.message)


def _model_params(model: str, max_tokens: int) -> dict:
    """Reasoning models spend tokens 'thinking' before answering; keep that short and hidden."""
    m = model.lower()
    if "gpt-oss" in m:
        return {"max_tokens": max_tokens * 4, "extra_body": {"reasoning_effort": "low"}}
    if "qwen3" in m or "deepseek-r1" in m:
        return {"max_tokens": max_tokens * 4, "extra_body": {"reasoning_format": "hidden"}}
    return {"max_tokens": max_tokens}


def _strip_thinking(text: str) -> str:
    if "</think>" in text:
        text = text.split("</think>", 1)[1]
    return text.strip()


async def _chat(messages: list[dict], *, json_mode: bool, temperature: float, max_tokens: int) -> str:
    global _active_model
    kwargs = {"response_format": {"type": "json_object"}} if json_mode else {}
    model = _active_model or settings.groq_model
    for attempt in range(2):
        try:
            resp = await client().chat.completions.create(
                model=model, messages=messages, temperature=temperature, **_model_params(model, max_tokens), **kwargs,
            )
            return _strip_thinking(resp.choices[0].message.content or "")
        except APIStatusError as e:
            detail = _groq_error_text(e)
            log.warning("Groq error %s for model %s: %s", e.status_code, model, detail)
            if e.status_code == 404 and attempt == 0:
                # Model not found / decommissioned: switch to one this account can use and retry once.
                fallback = await _pick_fallback_model(model)
                if fallback:
                    log.warning("GROQ_MODEL '%s' unavailable; using '%s' instead. Update GROQ_MODEL in .env.",
                                model, fallback)
                    _active_model = model = fallback
                    continue
                raise LLMUnavailable(f"Groq model '{model}' is not available. Set GROQ_MODEL in .env "
                                     f"(e.g. llama-3.3-70b-versatile). Groq said: {detail}") from e
            if e.status_code == 401:
                raise LLMUnavailable("Groq rejected the API key. Check GROQ_API_KEY in .env.") from e
            if e.status_code == 429:
                raise LLMUnavailable("Groq rate limit reached. Please wait a few seconds and try again.") from e
            raise LLMUnavailable(f"Groq error ({e.status_code}): {detail}") from e
        except (APIConnectionError, APITimeoutError) as e:
            raise LLMUnavailable("Cannot reach Groq right now. Check your internet connection.") from e
    raise LLMUnavailable("Groq request failed.")


# ---------------------------------------------------------------- speech to text

WHISPER_MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"]
_whisper_model: str | None = None


async def transcribe(audio: bytes, filename: str, language: str | None) -> str:
    """Groq Whisper speech-to-text. Works in every browser (unlike the Web Speech API) and
    handles Telugu, Hindi and English."""
    global _whisper_model
    model = _whisper_model or WHISPER_MODELS[0]
    for attempt in range(2):
        try:
            resp = await client().audio.transcriptions.create(
                model=model, file=(filename, audio), language=language or None, temperature=0.0,
                response_format="json",
            )
            _whisper_model = model
            return (resp.text or "").strip()
        except APIStatusError as e:
            detail = _groq_error_text(e)
            log.warning("Groq transcription error %s for %s: %s", e.status_code, model, detail)
            if e.status_code == 404 and attempt == 0:
                model = next((m for m in WHISPER_MODELS if m != model), model)
                continue
            if e.status_code == 429:
                raise LLMUnavailable("Voice limit reached for now. Please wait a moment or type instead.") from e
            raise LLMUnavailable(f"Could not understand the recording ({e.status_code}): {detail}") from e
        except (APIConnectionError, APITimeoutError) as e:
            raise LLMUnavailable("Cannot reach Groq right now. Please type your message instead.") from e
    raise LLMUnavailable("Voice input is not available on this Groq account. Please type instead.")


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
    basis: str = Field(default="day", pattern="^(day|fixed)$")  # promise: daily rate or fixed amount

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
  "is_late": boolean,
  "basis": "day" | "fixed"}}

Rules:
- promise: employer promised money.
  basis "day": a DAILY rate; amount = rupees per day.
  basis "fixed": an agreed TOTAL for a job or period, or a bonus, for work the worker has done or is doing
  (e.g. "₹50,000 for the 5 days", "a 2000 bonus for the extra hours I worked"); amount = that total.
  Do NOT also convert a fixed total into a daily rate.
  A monthly salary, or money promised for work not started yet: type "other" with a note.
- Amounts are rupees. If the worker uses another currency, still copy the number and mention the currency in notes.
- work_day: the worker worked. days = number of days worked mentioned in THIS message (default 1 for "I worked today"). Half day = 0.5.
  If the worker states a running TOTAL ("I have worked 8 days so far"), set is_total true and days = that total.
- payment: the worker received money. amount = rupees received in THIS message.
  If they state a running total received ("he has paid me 5000 in all"), set is_total true.
  If they say they were paid everything owed / the full balance without a number, set amount null and pays_full_balance true.
  If they say the payment came late / after a delay / after many days or weeks of waiting, set is_late true.
- other: anything else relevant (complaints, delays, threats, questions). One "other" event is enough; do not create events for greetings.
- NEVER calculate anything. Copy numbers exactly as the worker said them. Convert words like "teen hazaar"/"మూడు వేలు" to 3000.
- employer_name: reuse the exact spelling from KNOWN EMPLOYERS when it is clearly the same employer (e.g. "Suresh" -> "Suresh Constructions").
  If the NEW MESSAGE doesn't name the employer but RECENT CONVERSATION makes clear who it is, use that name.
  Only if nobody is named anywhere, use null (the fact is still recorded).
- A bare number or short answer ("10000", "5 days", "yes 2000") is a real fact: use RECENT CONVERSATION to decide
  whether it is a rate, days worked or a payment. Never drop it just because it is short.
- Resolve relative dates ("yesterday", "last Monday") against today. Unknown date -> null.
- A question like "how much does Suresh owe me?" is NOT a payment or work_day. Return an "other" event or an empty list.

KNOWN EMPLOYERS for this worker: {employers}
"""


CONTEXT_BLOCK = """
RECENT CONVERSATION (context only, oldest first). Use it to understand short answers, e.g. if HakDaar asked
"how much did they promise?" and the NEW MESSAGE is "50000", that is a promise. Extract facts ONLY from the
NEW MESSAGE; never re-extract facts that were already stated in these earlier turns.
{turns}
"""


async def extract_events(message: str, known_employers: list[str],
                         history: list[dict] | None = None) -> list[ExtractedEvent]:
    prompt = EXTRACTION_PROMPT.format(
        today=date.today().isoformat(),
        employers=", ".join(known_employers) if known_employers else "(none yet)",
    )
    if history:
        turns = "\n".join(f"{'Worker' if m['role'] == 'user' else 'HakDaar'}: {m['content'][:400]}"
                          for m in history[-6:])
        prompt += CONTEXT_BLOCK.format(turns=turns)
    msgs = [{"role": "system", "content": prompt}, {"role": "user", "content": f"NEW MESSAGE: {message}"}]
    raw = await _chat(msgs, json_mode=True, temperature=0.0, max_tokens=800)
    items = _parse_events_json(raw)
    if items is None:
        # Some models return prose or an empty body in JSON mode; ask once more without it.
        log.warning("Extraction returned unusable JSON, retrying: %r", raw[:300])
        raw = await _chat(msgs + [{"role": "user", "content": "Reply with the JSON object only."}],
                          json_mode=False, temperature=0.0, max_tokens=800)
        items = _parse_events_json(raw)
        if items is None:
            log.warning("Extraction failed twice: %r", raw[:300])
            return []
    events = []
    for item in items:
        try:
            events.append(ExtractedEvent.model_validate(_clean_event(item)))
        except ValidationError as e:
            log.warning("Dropping invalid event %r: %s", item, e)
    return events


_TYPE_ALIASES = {
    "promise": "promise", "wage_promise": "promise", "rate": "promise", "daily_rate": "promise", "agreement": "promise",
    "work_day": "work_day", "workday": "work_day", "work_days": "work_day", "work": "work_day", "worked": "work_day",
    "days_worked": "work_day", "attendance": "work_day",
    "payment": "payment", "paid": "payment", "pay": "payment", "received": "payment", "wage_payment": "payment",
    "other": "other", "note": "other", "question": "other",
}


def _parse_events_json(raw: str) -> list | None:
    """Accept {"events": [...]}, a bare list, a single event object, or JSON wrapped in ``` fences.
    Returns None if nothing usable could be parsed."""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{") if "{" in text else 0:]
    for candidate in (text, text[text.find("{"): text.rfind("}") + 1] if "{" in text else ""):
        if not candidate:
            continue
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(data, list):
            return [d for d in data if isinstance(d, dict)]
        if isinstance(data, dict):
            for key in ("events", "facts", "items"):
                if isinstance(data.get(key), list):
                    return [d for d in data[key] if isinstance(d, dict)]
            if "type" in data:
                return [data]
            return []
    return None


def _clean_event(item: dict) -> dict:
    """Models often send null for fields that don't apply, or 'Work_Day' instead of 'work_day'.
    Treat null as 'not set' and normalise names, so a real fact is never thrown away."""
    item = {k: v for k, v in item.items() if v is not None and v != ""}
    t = str(item.get("type", "other")).strip().lower().replace(" ", "_").replace("-", "_")
    item["type"] = _TYPE_ALIASES.get(t, "other")
    basis = str(item.get("basis", "day")).strip().lower()
    item["basis"] = "fixed" if basis in ("fixed", "total", "lump_sum", "lumpsum", "bonus") else "day"
    for flag in ("is_total", "pays_full_balance", "is_late"):
        if flag in item and not isinstance(item[flag], bool):
            item[flag] = str(item[flag]).strip().lower() in ("true", "yes", "1")
    return item


# ---------------------------------------------------------------- reply

REPLY_PROMPT = """You are HakDaar, a kind, trustworthy friend who helps daily-wage and migrant workers in Hyderabad
keep track of their wages. You are talking to {name}.

Reply ONLY in {language}. Use very simple words, short sentences, like talking to a friend with little schooling.
Keep it under 80 words. Be warm and respectful. No markdown tables, no headings.

STRICT RULES ABOUT NUMBERS:
- Only use rupee amounts and day counts that appear in LEDGER or ALERTS below. Never add, subtract or multiply yourself.
- If the worker asks how much is owed, read the "owed" figure from LEDGER exactly.
- If LEDGER has no owed figure for an employer (nothing recorded, or rate not known), do NOT state any owed
  amount, even if the worker mentioned numbers earlier. Instead ask for the missing detail (employer name,
  promised rate or total, days worked, amount received) in one short question.
- If a rate is unknown, kindly ask what daily rate or total amount was promised.

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


async def complete(system_prompt: str, max_tokens: int = 300, temperature: float = 0.5) -> str:
    """One-shot text generation (used for the welcome-back greeting)."""
    return (await _chat([{"role": "system", "content": system_prompt}], json_mode=False,
                        temperature=temperature, max_tokens=max_tokens)).strip()


async def write_reply(*, worker_name: str, language: str, message: str, history: list[dict],
                      ledger_text: str, noted_text: str, alerts_text: str,
                      memories_text: str, reputation_text: str, correction: str | None = None) -> str:
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
    if correction:
        msgs.append({"role": "system", "content": correction})
    return (await _chat(msgs, json_mode=False, temperature=0.2 if correction else 0.4, max_tokens=400)).strip()
