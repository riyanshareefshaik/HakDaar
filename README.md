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
docker run -d --pull always --name hindsight --restart unless-stopped --shm-size=1g \
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

_(Full architecture, frontend and demo instructions are added in later phases.)_
