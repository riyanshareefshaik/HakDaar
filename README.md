# HakDaar 🛡️

**Your work. Your wages. Remembered.**

HakDaar is an AI rights companion for migrant and daily-wage workers in Hyderabad. Construction workers
and helpers often lose wages because employers break verbal promises. With HakDaar, a worker simply
chats (in **English, తెలుగు or हिंदी**, typed or spoken) about their work. HakDaar:

- **remembers** what each employer promised, the days worked and the payments received, across sessions;
- **calculates exactly** what is owed and flags underpayment with a clear red alert;
- **learns across workers**: if an employer has underpaid other workers before, it warns the next worker,
  without ever revealing who reported it.

Memory is powered by **[Hindsight](https://github.com/vectorize-io/hindsight) by Vectorize**. Built for **HackwithHyderabad 3.0**.

> _HakDaar is not legal advice. For help, contact your local labour office._

---

## Quick start

**Prerequisites:** Docker Desktop (running), Python 3.11+, Node.js 20.19+ (or 22+), and a [Groq API key](https://console.groq.com/keys).

```bash
git clone https://github.com/riyanshareefshaik/HakDaar.git && cd HakDaar
cp .env.example .env              # then put your GROQ_API_KEY in .env

./scripts/start-hindsight.sh      # 1. memory server (first run downloads a large image, be patient)
./scripts/start-backend.sh        # 2. API on http://localhost:8000   (new terminal)
./scripts/start-frontend.sh       # 3. app on http://localhost:5173   (new terminal)
```

Open **http://localhost:5173**, choose a language, **create an account** (name, phone number and a 4-digit
PIN) and start chatting. HakDaar starts **empty**: there is no fake or seeded data, and everything it knows is
learned from real conversations.

> Login is deliberately simple (phone + PIN, hashed with PBKDF2) so any phone user can manage it. It is
> hackathon-grade identification, not production authentication: the API itself has no sessions or tokens.

| Service | URL |
|---|---|
| HakDaar app | http://localhost:5173 |
| HakDaar API docs (Swagger) | http://localhost:8000/docs |
| Health check | http://localhost:8000/health |
| Hindsight API | http://localhost:8888 |
| Hindsight UI (inspect memory banks) | http://localhost:9999 |

<details>
<summary>Manual commands (Windows or no bash)</summary>

```bash
# Hindsight (replace YOUR_KEY)
docker run -d --pull missing --name hindsight --restart unless-stopped --shm-size=1g \
  -p 8888:8888 -p 9999:9999 \
  -e HINDSIGHT_API_LLM_PROVIDER=groq \
  -e HINDSIGHT_API_LLM_API_KEY=YOUR_KEY \
  -e HINDSIGHT_API_LLM_MODEL=openai/gpt-oss-20b \
  -e HINDSIGHT_API_LLM_GROQ_SERVICE_TIER=on_demand \
  -e HINDSIGHT_API_WORKER_ID=hakdaar-local \
  -v hindsight-data:/home/hindsight/.pg0 \
  ghcr.io/vectorize-io/hindsight:latest

# Backend
cd backend
python -m venv .venv && .venv\Scripts\activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm install && npm run dev
```
</details>

---

## Built for workers who can't read easily
- **Ravi's story:** a 5-step picture story (with read-aloud) opens on first visit and from the ▶ button.
- **HakDaar speaks first:** on login a *welcome-back* message is written from Hindsight memory plus exact
  **follow-up nudges** ("Suresh Constructions still owes you ₹1,200 · 5 days since the last update. Did they pay?")
  with big **✅ Yes, paid / ❌ Not yet** answers.
- **No typing needed:** big colour-coded picture buttons open a keypad (amounts), a +/− stepper (days) and employer
  chips. The sheet writes a plain sentence in the worker's language and sends it like any chat message.
- **Voice both ways:** a big WhatsApp-style mic (Groq Whisper), and replies read aloud automatically
  (speaker toggle), with amounts spoken as words in English, Hindi or Telugu.

## Walkthrough (2 minutes, all live, no seeded data)

1. **Lakshmi** creates an account (हिंदी) and chats: *"सुरेश कंस्ट्रक्शन्स ने रोज़ ₹650 का वादा किया"* → *"10 दिन काम किया"* →
   *"3 हफ्ते बाद सिर्फ़ ₹5,000 मिले"*. Her ledger shows **₹1,500 owed**, and an anonymised *short + late
   payment* report goes into the shared `employer-reputation` memory.
2. Log out (account menu, top right). **Ravi** creates an account (తెలుగు) and says *"సురేష్ గారు రోజుకు ₹700 ఇస్తామన్నారు"* ("Suresh promised ₹700 a day"). HakDaar
   immediately warns him: **"1 other worker reported short or late payment from Suresh Constructions"**.
   It learned this from Lakshmi, without revealing her name.
3. Ravi: *"6 రోజులు పని చేశాను"* ("I worked 6 days") → *"₹3,000 ఇచ్చారు"* ("They paid ₹3,000"). The red banner
   shows **₹1,200 owed**; the wallet tiles count up to Earned ₹4,200 / Paid ₹3,000 / Owed ₹1,200.
4. After each message the reply shows *"Learning…"* and then **"Learned N new facts"**. Tap it (or the
   account menu → **Memories**) to see the new facts highlighted, and *Used in last reply* to see exactly
   what Hindsight recalled. **Employer alerts** live in the same account panel.
5. Bonuses count too: *"they promised a ₹2,000 bonus for the extra hours I worked"* is added to **Earned**.
   Open **How is this calculated?** under the ledger for the plain-language formula.
6. A number misheard? Tap **↶ Undo** on the "Noted" chip (or in *Show entries*). The ledger recomputes and a
   correction is retained into memory.
7. Tap **Listen** on any reply to hear it read aloud, and **"What have workers reported?"** for a Hindsight
   `reflect()` summary of the employer.
8. Log out and back in, or restart everything: all of it is still remembered.

---

## Architecture

```mermaid
flowchart LR
    U["👷 Worker<br/>(text or voice, EN/TE/HI)"] --> FE["React + Vite UI<br/>chat · ledger · memories · alerts"]
    FE -->|POST /chat| API["FastAPI backend"]

    subgraph Backend
        API --> EX["1 · Extract facts<br/>Groq LLM → strict JSON<br/>promise / work_day / payment"]
        EX --> DB[("SQLite<br/>workers · events · reports")]
        DB --> LED["2 · Exact ledger in Python<br/>rate × days − paid = owed"]
        LED --> AL["3 · Alerts<br/>underpayment · employer reputation"]
        AL --> REP["4 · Reply<br/>Groq LLM writes words,<br/>numbers come from the ledger"]
    end

    API <-->|"retain · recall"| WB[("Hindsight<br/>worker-{id} bank<br/>(private)")]
    AL -->|"retain anonymised report"| RB[("Hindsight<br/>employer-reputation bank<br/>(shared)")]
    RB -->|"recall · reflect"| API
    REP --> FE
```

### What happens on each message
1. **Extract.** Groq turns the message into strict JSON events
   `{type, employer_name, amount, days, date, notes}`. The prompt forbids any arithmetic. Phrases like
   "8 days in total" or "he paid the rest" are flagged (`is_total`, `pays_full_balance`), and **Python**
   resolves them against the ledger.
2. **Store and compute.** Events go to SQLite. `ledger.py` computes each employer's
   **earned = daily rate × days + agreed fixed amounts (bonus / lump sum)**, **paid**, and
   **owed = earned − paid**, with `Decimal`. **The LLM never does maths**, so every rupee shown is exact and auditable.
   Employer names are normalised ("suresh" → "Suresh Constructions") so one employer never splits into two rows.
3. **Alerts and learning.** If money is owed, an underpayment alert is raised. After any payment, an
   **anonymised** report ("A worker reported a short payment from X…", or "…paid late") is written to SQLite
   (for exact counts) **and** retained into the shared Hindsight bank. One current report per worker and
   employer, so a later full payment replaces an earlier "short" report instead of double counting.
4. **Remember and recall.** The message and its facts are `retain`ed into the worker's own bank. HakDaar
   `recall`s from the worker's bank and from `employer-reputation` in parallel.
5. **Reply.** Groq writes a short, kind reply in the worker's language using the recalled memories plus
   the exact ledger figures.

### How Hindsight is used

| Operation | Where | Why |
|---|---|---|
| `retain` | every chat turn → `worker-{id}` | Long-term personal memory: promises, dates, worries, context |
| `retain` | after a payment → `employer-reputation` | Cross-worker learning, anonymised (no names ever stored) |
| `retain` | after an undo → `worker-{id}` | A correction note so memory stays consistent with the ledger |
| `recall` | login → `worker-{id}` | The welcome-back greeting mentions what the worker told HakDaar last time |
| `recall` | every chat turn, both banks | Context for the reply, shown live in *Memories → Used in last reply* |
| `list_memories` | `GET /workers/{id}/memories` | *Memories → All learned*: every fact Hindsight has extracted, newest first. The UI polls it after each message to show learning live |
| `reflect` | `GET /employers/{name}/reputation` | A reasoned summary of an employer's payment record |
| `create_bank` | new worker | Sets each bank's *retain mission* so Hindsight extracts wage-relevant facts |
| `delete_bank` | remove worker / `POST /reset` | Deletes a worker's private memory |

**Bank design:** one private bank per worker (`worker-{worker_id}`), strictly isolated, plus one shared
`employer-reputation` bank. Worker ids are random (`ravi-3f9a1c`) and never reused, so a reset can never
leak one worker's memory into another's.

**Why both SQLite and Hindsight?** Hindsight holds the *meaning*: what was said, when, and patterns across
workers. SQLite holds the *numbers*. Money needs exact arithmetic, and memory needs understanding.

### Voice
- **Speak:** the browser records audio (MediaRecorder, works in Chrome, Safari, Edge and Firefox) and sends it to
  `POST /transcribe`, where **Groq Whisper** (`whisper-large-v3-turbo`) turns Telugu, Hindi or English speech into
  text. The text lands in the input box so the worker can check it before sending.
- **Listen:** replies are read aloud with the best installed voice for the language. Amounts are converted first
  (`₹1,25,000` → "one lakh twenty five thousand rupees" / "125000 रुपये"), because Indian digit grouping confuses
  speech engines.

### Failure handling
- **Groq down:** `/chat` returns a clear 503 *before* storing anything, so a retry never double-counts.
  If Groq fails after the facts are saved, a plain fallback reply is sent instead.
- **Hindsight down:** chat still works (the ledger is in SQLite). The reply carries a
  "Memory is offline" warning and the UI shows an amber banner.
- **Backend down:** the UI shows a friendly screen with the exact command to start it.

---

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Checks that Hindsight and Groq are reachable |
| POST | `/auth/register` | Create an account `{name, phone, pin (4 digits), language}` |
| POST | `/auth/login` | `{phone, pin}` → worker |
| GET / POST | `/workers` | List workers / create `{name, language: en\|te\|hi, phone?}` |
| GET | `/workers/{id}` | One worker (used to restore a login session) |
| PATCH | `/workers/{id}` | Change reply language `{language}` |
| POST | `/chat` | `{worker_id, message}` → `{reply, extracted_events, alerts, recalled_memories, ledger, warnings}` |
| DELETE | `/workers/{id}` | Remove a worker, their ledger, chats and private memory bank |
| GET | `/workers/{id}/messages` | Chat history (each message carries the ledger entries it produced) |
| GET | `/workers/{id}/events` | Every ledger entry |
| DELETE | `/workers/{id}/events/{event_id}` | Undo a wrong entry → recomputed ledger + correction retained |
| POST | `/transcribe` | Voice input: multipart `audio` + `language` → `{text}` (Groq Whisper) |
| GET | `/workers/{id}/welcome` | Welcome-back greeting (LLM + Hindsight recall) + follow-up nudges |
| GET | `/workers/{id}/nudges` | Follow-up nudges only (exact, from the ledger: money owed + days since, missing rate) |
| GET | `/workers/{id}/ledger` | Per employer: rate promised, days worked, earned, paid, **owed** |
| GET | `/workers/{id}/memories` | Hindsight recall + everything learned (`learned`, `total_learned`) |
| GET | `/workers/{id}/alerts` | Current underpayment and reputation alerts |
| GET | `/employers/{name}/reputation` | Exact report counts plus Hindsight `reflect()` summary |
| POST | `/reset` | Wipe SQLite and all HakDaar memory banks (fresh start) |

`{id}` also accepts a unique worker name (e.g. `/workers/ravi/ledger`), which is handy in Swagger.

## Project structure

```
backend/
  app/main.py      FastAPI routes + error handling
  app/chat.py      the /chat pipeline: extract → ledger → alerts → memory → reply
  app/llm.py       Groq calls: strict-JSON extraction and the reply prompt
  app/ledger.py    exact wage arithmetic (Decimal), ₹ formatting
  app/memory.py    Hindsight wrapper: banks, retain / recall / reflect
  app/db.py        SQLite schema and queries
  tests/           ledger + end-to-end API tests (Groq and Hindsight mocked)
frontend/
  src/App.jsx                      session, layout (chat + ledger on desktop, tabs on mobile), live-learning polling
  src/components/Login.jsx         log in / create account: language, phone, 4-digit PIN
  src/components/Header.jsx        logo, language menu, account button
  src/components/ChatPanel.jsx     chat, voice input, read-aloud, quick actions, undo chips, underpayment banner
  src/components/LedgerPanel.jsx   wage ledger (entries + undo), "How is this calculated?", memory + alert cards
  src/components/AccountDrawer.jsx profile, Memories (learned / used in last reply), Employer alerts, log out
  src/i18n.js                   English / Telugu / Hindi UI strings
scripts/            start-hindsight.sh, start-backend.sh, start-frontend.sh
```

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `GROQ_API_KEY` | — | Required. Used by the backend and passed to Hindsight |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Model for extraction and replies (falls back automatically to one your account has; `/health` lists them) |
| `HINDSIGHT_URL` | `http://localhost:8888` | Hindsight API |
| `HINDSIGHT_LLM_MODEL` | `openai/gpt-oss-20b` | Model Hindsight uses internally |
| `DATABASE_PATH` | `hakdaar.db` | SQLite file (relative to `backend/`) |

## Tests

```bash
cd backend && source .venv/bin/activate && pip install -r requirements-dev.txt && python -m pytest -q
```
The tests mock Groq and Hindsight, so they need neither.

## Troubleshooting
- **Docker "Pulling fs layer" seems stuck:** the Hindsight image is several GB; let it finish.
  `docker pull ghcr.io/vectorize-io/hindsight:latest` shows progress bars.
- **"Learning…" but no new facts appear:** Hindsight extracts facts in the background with its own LLM
  calls. Check `docker logs hindsight` for Groq errors (e.g. rate limits).
- **Groq 429 (rate limit):** wait a few seconds; the free tier has per-minute limits.
- **Mic says "blocked":** click the lock icon in the browser address bar and allow the microphone.
- **Listen says there is no Telugu/Hindi voice:** add one in your OS speech settings (Mac: System Settings →
  Accessibility → Spoken Content → System voice → Manage Voices). HakDaar won't read Telugu with an English voice.

## License
MIT
