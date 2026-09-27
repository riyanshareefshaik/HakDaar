# HakDaar 🛡️

**Your work. Your wages. Remembered.**

HakDaar is an AI rights companion for migrant and daily-wage workers in Hyderabad. A worker chats
(English / తెలుగు / हिंदी) about their work; HakDaar remembers what each employer promised, days
worked and payments received, and flags when something doesn't add up. Memory is powered by
[Hindsight](https://github.com/vectorize-io/hindsight) by Vectorize.

> Built for HackwithHyderabad 3.0. _HakDaar is not legal advice. For help, contact your local labour office._

## Quick start

### 1. Configure secrets
```bash
cp .env.example .env
# edit .env and set GROQ_API_KEY
```
`.env` is git-ignored — never commit it.

### 2. Start Hindsight (Docker)
```bash
./scripts/start-hindsight.sh
```
This runs:
```bash
docker run -d --pull missing --name hindsight --restart unless-stopped --shm-size=1g \
  -p 8888:8888 -p 9999:9999 \
  -e HINDSIGHT_API_LLM_PROVIDER=groq \
  -e HINDSIGHT_API_LLM_API_KEY="$GROQ_API_KEY" \
  -e HINDSIGHT_API_LLM_MODEL=openai/gpt-oss-20b \
  -e HINDSIGHT_API_LLM_GROQ_SERVICE_TIER=on_demand \
  -e HINDSIGHT_API_WORKER_ID=hakdaar-local \
  -v hindsight-data:/home/hindsight/.pg0 \
  ghcr.io/vectorize-io/hindsight:latest
```
- Hindsight API: http://localhost:8888
- Hindsight UI: http://localhost:9999

First start takes a minute (it downloads embedding models). Watch with `docker logs -f hindsight`.

### 3. Start the backend
```bash
cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Check dependencies: http://localhost:8000/health · API docs: http://localhost:8000/docs

### 4. Load the demo data
```bash
curl -X POST localhost:8000/demo/seed
```
Then wait ~30–60 s while Hindsight processes the memories in the background.

### Run the tests
```bash
cd backend && pip install -r requirements-dev.txt && python -m pytest -q
```
The tests mock Groq and Hindsight, so they need neither.

## API
| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Checks that Hindsight and Groq are reachable |
| GET / POST | `/workers` | List workers / create `{name, language: en\|te\|hi, phone?}` |
| POST | `/chat` | `{worker_id, message}` → `{reply, extracted_events, alerts, recalled_memories, ledger, warnings}` |
| GET | `/workers/{id}/messages` | Chat history |
| GET | `/workers/{id}/ledger` | Per-employer rate, days, earned, paid, **owed** (exact, computed in Python) |
| GET | `/workers/{id}/memories` | What Hindsight recalls about this worker |
| GET | `/workers/{id}/alerts` | Current underpayment and employer-reputation alerts |
| GET | `/employers/{name}/reputation` | Exact report counts plus Hindsight `reflect()` over `employer-reputation` |
| POST | `/demo/seed` · `/demo/reset` | Load the demo story / wipe SQLite and HakDaar's memory banks |

_(Architecture and frontend docs are added in later phases.)_
