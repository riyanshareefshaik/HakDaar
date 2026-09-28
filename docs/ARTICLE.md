# HakDaar: giving daily-wage workers a memory their employer can't argue with

*Built for HackwithHyderabad 3.0 with Hindsight agent memory (by Vectorize), Groq and FastAPI.*

**Live app:** https://hakdaar.vercel.app · **Code:** https://github.com/riyanshareefshaik/HakDaar · **Demo video:** *(add your YouTube link)*

---

## The problem: wages disappear when nobody remembers

Walk past any construction site in Hyderabad at 8 am and you'll see the same deal being made a hundred
times: *"₹800 a day, start today."* No contract. No payslip. A week later the worker is handed ₹3,000 and
told "the rest later." A month later they've moved to another site, the supervisor has changed, and
nobody remembers what was promised.

This isn't rare. Daily-wage and migrant workers are paid on verbal promises. Many can't easily read or
write, or don't speak the local language. When a dispute comes up, the employer's word wins, because the
worker has no record.

**Hakdaar** (हक़दार) means *"the one who is entitled"*. The idea is simple: **give the worker a memory**,
one that remembers every promise, every day worked and every rupee paid, and can say exactly what is still
owed.

## What HakDaar does

A worker just talks to HakDaar, in **Telugu, Hindi or English**, by typing or with their voice:

> "Rakesh promised me 800 rupees per day for the building work."
> "I worked 6 days for him."
> "He paid me only 3000 and said the rest later."
> "How much am I still owed?"

HakDaar turns that into a **wage ledger**: **Earned ₹4,800 · Paid ₹3,000 · Owed ₹1,800**. The numbers
update the moment each fact is saved. The reply is in the worker's language and can be read aloud, with
amounts spoken properly ("one thousand eight hundred rupees", not "one-eight-zero-zero").

Then it keeps going:

- **It remembers across conversations.** Next time the worker opens the app: *"Last time Rakesh still owed
  you ₹1,800. Did he pay?"*
- **Workers protect each other, anonymously.** When a second worker mentions Rakesh, they see that another
  worker reported a short payment from him. Nobody's name is ever shown.
- **Employers and support groups can join.** An employer can record days and payments, but *nothing counts
  until the worker confirms it*. An NGO or union can follow up on cases, with the worker's consent.

## Why memory, and why Hindsight

A wage record isn't a document you search once. It's a story that builds up over weeks: a promise on
Monday, work on Tuesday, a short payment on Saturday, an excuse the next week. A plain chatbot forgets all
of it the moment the chat ends. Plain retrieval (RAG) over old messages finds text, but it doesn't
understand that *"he gave me 3000"* is a payment from *Rakesh*, made *last Saturday*.

**Hindsight** gives HakDaar the three things it needs:

| Hindsight | How HakDaar uses it |
|---|---|
| **retain** | After every message, the turn and the exact facts recorded are stored in the worker's own memory bank. Hindsight extracts the facts, entities (employers) and time in the background. |
| **recall** | Before replying, HakDaar recalls what matters for this message: earlier promises, dates and problems with the same employer. |
| **reflect** | For the shared **employer-reputation** bank, reflect turns many anonymous reports into a short, fair summary: "2 workers reported short payments; 1 was paid in full." |

I run Hindsight **self-hosted in Docker**, with Groq as its model, so all of a worker's memory stays on
infrastructure I control.

### Two kinds of memory banks

- **`worker-{id}`**: one private bank per worker. Only that worker's chats go in; only that worker's
  replies read from it.
- **`employer-reputation`**: one shared bank of *anonymous* reports ("a worker reported a short payment of
  ₹1,800 from Rakesh Builders"). No names, no phone numbers.

Here's the core of the memory layer, using the Hindsight Python client:

```python
async def retain(bank_id, content, *, context, timestamp=None, metadata=None):
    # retain_async: Hindsight extracts facts in the background, so the chat stays fast.
    await client().aretain(bank_id=bank_id, content=content, context=context,
                           timestamp=timestamp, metadata=metadata, retain_async=True)

async def recall(bank_id, query, limit=8):
    resp = await client().arecall(bank_id=bank_id, query=query, budget="low", max_tokens=2048)
    return [{"text": r.text, "date": r.occurred_start or r.mentioned_at} for r in resp.results[:limit]]

async def reflect(bank_id, query):
    resp = await client().areflect(bank_id=bank_id, query=query, budget="low")
    return resp.text
```

Recall and retain run **in parallel** after each message, so memory never slows the reply down. If
Hindsight is offline, the wages are still recorded and the worker just sees "memory is offline".

## The rule that makes it trustworthy: the AI reads, Python counts

The worst thing a wage app can do is get the number wrong. So HakDaar has one hard rule: **the language
model never does maths.**

1. **Groq** (`gpt-oss-120b`) only *extracts* facts from the message as JSON: a promise of ₹800/day, 6 days
   worked, a payment of ₹3,000, and who the employer is.
2. **Python** stores those facts and computes the ledger with exact `Decimal` arithmetic:
   `earned = rate × days + fixed amounts`, `owed = earned − paid`.
3. The reply is written from those exact numbers. If the reply ever contains a rupee amount that isn't in
   the ledger, HakDaar asks the model to rewrite it, and if that fails, falls back to a plain reply built
   from the ledger.

```python
if rate is None and fixed == 0:
    earned = owed = None          # nothing agreed yet: don't guess, ask the worker
else:
    earned = rate * days + fixed
    owed = max(earned - paid, 0)
    advance = max(paid - earned, 0)   # paid more than earned: say so clearly
```

Real messages are messy, and handling that made the ledger right:

- **Short answers.** "10000" in reply to *"what daily rate did he promise?"* is read using the question
  HakDaar just asked.
- **No employer named yet.** "I worked 5 days" is kept under "Employer (name not given)" and moved to the
  right employer as soon as the worker names one.
- **Overpayments.** Being paid ₹1,800 for ₹1,000 of work shows as **"Paid extra ₹800"**, never as a silent
  "fully paid".

## Built for workers who can't read easily

Many of the people this is for don't type comfortably, so the design started from that:

- **Voice input:** tap *Speak*, talk, and Groq Whisper turns it into text in any of the three languages.
- **Read-aloud:** every reply has a *Listen* button. Numbers are converted to words in English, Hindi and
  Telugu using Indian numbering (lakh, thousand), because text-to-speech reads "₹1,25,000" badly.
- **No-typing buttons:** *New job*, *I worked*, *I got paid* open a big number pad.
- **Simple sign-in:** phone number + 4-digit PIN. PIN reset uses a security question, so there are no paid
  SMS OTPs.
- **Undo** on every entry, big buttons, dark and light mode, and an Android app.

## Trust, fairness and abuse

Warnings about employers are powerful, so they had to be fair:

- **One report is never a warning.** A single report shows as *"1 unverified report, check with others"*.
  It becomes a warning only when **2 or more different workers** report the same employer, and workers
  who were paid in full are shown too.
- Reports come from **ledger facts**, not free text, and each worker counts once per employer.
- Wrong-PIN guesses are limited, sign-ups per network are limited, and an **admin dashboard** can remove
  fake accounts or false reports.

## Employers and NGOs, without duplicate data

HakDaar also lets **employers** (contractors, builders, factories) and **support groups** (NGOs, unions,
labour offices) join, each with their own team logins. Organizations register with checked details:
employers with a GSTIN (including its check character), Udyam or PAN number; NGOs with their NGO Darpan ID.
The admin verifies an organization before it can publicly reply to reports.

The worker stays in control:

- An organization **invites** a worker by phone; the worker accepts or declines.
- What an employer records shows as **"waiting for your OK"** until the worker taps *Yes, correct*.
- **No fact is stored twice.** If the worker already noted "he paid me 1500" and the employer records the
  same payment, confirming it keeps one entry, marked *confirmed with employer*. If the worker says it in
  chat while the employer's entry is waiting, HakDaar confirms that entry instead of creating a copy.

## Architecture

- **Frontend:** React 19 + Vite + Tailwind, hosted on Vercel; an Android app wraps the same site.
- **Backend:** FastAPI + SQLite, running in Docker.
- **Memory:** Hindsight, self-hosted in Docker (retain / recall / reflect).
- **AI:** Groq: `gpt-oss-120b` for understanding and replies, `gpt-oss-20b` inside Hindsight, Whisper for
  voice.
- **Serving:** Caddy in front (HTTPS, streaming), with the chat **streamed in two parts**: the wallet
  updates as soon as the facts are saved, and the written reply follows.
- **Tests:** 43 backend tests, with Groq and Hindsight mocked, covering the ledger maths, the chat flow,
  duplicates, organizations and access control.

## What I learned

1. **Memory isn't a feature, it's the product.** For people without paperwork, a memory that remembers
   *who said what, when* is the evidence.
2. **Never let the model count.** Separating "understand" (AI) from "calculate" (code) is what made the
   numbers trustworthy, and a guard that rejects invented amounts caught real mistakes.
3. **Real messages are messy.** Nulls, missing names, bare numbers and overpayments each needed their own
   careful handling before the ledger felt right.
4. **Design for the hardest user first.** Voice, spoken numbers and big buttons made the app better for
   everyone.

## What's next

- Hosting the backend on an always-on server, and a custom domain.
- Phone number verification and employer site locations, to make reports even harder to abuse.
- Partnering with a labour NGO in Hyderabad to pilot it with real workers.
- A printable "wage claim slip" a worker can take to the labour office.

---

*HakDaar is not legal advice. It's a record that helps workers ask for what they're owed.*

**Try it:** https://hakdaar.vercel.app · **Code:** https://github.com/riyanshareefshaik/HakDaar
