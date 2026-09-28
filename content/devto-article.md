---
title: "Employers count on workers forgetting, so I used Hindsight"
published: false
description: "Daily-wage workers lose money to forgotten verbal promises. I gave them an agent with Hindsight memory, and a ledger the model can't touch."
tags: ai, llm, python, agents
cover_image: https://raw.githubusercontent.com/riyanshareefshaik/HakDaar/main/docs/article-images/architecture.png
---

A mason in Hyderabad is promised ₹800 a day. Six days later he's handed ₹3,000 and told "the rest later".
There's no contract, no payslip and no record, just his word against the contractor's. By the time he
brings it up, he can't say exactly which day was agreed or how much was paid. Nobody has lied outright.
Everybody has just *forgotten*, and forgetting is cheaper for the person holding the money.

I built HakDaar (Hindi for "the one who is entitled") to take that advantage away. It's a chat app where
daily-wage and migrant workers tell an agent, in Telugu, Hindi or English, by text or voice, what was
promised, what they worked and what they were paid. The agent remembers all of it, keeps an exact ledger,
and says what is still owed. The most interesting part to build was not the chat. It was deciding **what
the agent should remember, where, and what it must never be allowed to calculate.**

## What it does and how it hangs together

A worker types or says something like:

> "Rakesh promised me 800 rupees per day for the building work."
> "I worked 6 days for him."
> "He paid me only 3000 and said the rest later."

The app shows **Earned ₹4,800 · Paid ₹3,000 · Owed ₹1,800** and replies in the worker's language. When they
come back a week later, the agent opens with *"Last time, Rakesh still owed you ₹1,800. Did he pay?"*

![HakDaar wallet and wage ledger](https://raw.githubusercontent.com/riyanshareefshaik/HakDaar/main/docs/article-images/ledger.png)

The stack is deliberately boring:

- **React** frontend (plus a thin Android wrapper), **FastAPI** backend, **SQLite** for the ledger.
- **Groq** for language: `gpt-oss-120b` extracts facts and writes replies; Whisper handles voice.
- **[Hindsight agent memory](https://github.com/vectorize-io/hindsight)**, self-hosted in Docker, for
  everything the agent needs to *remember* rather than *count*.

![Where Hindsight sits in the stack](https://raw.githubusercontent.com/riyanshareefshaik/HakDaar/main/docs/article-images/architecture.png)

Every message goes through the same pipeline: extract facts → store them in the ledger → compute exact
totals → retain the turn in memory and recall what's relevant → write the reply from the exact numbers.

## The core decision: memory is not the ledger

My first instinct was to let the agent's memory *be* the record. Store everything, recall it, let the model
answer "how much am I owed?" That failed in the most dangerous way possible.

Early on, a worker told the agent about 5 days of work and, in a separate message, a rate of 10,000. The
ledger hadn't recorded the rate correctly (more on that below), but the model had both facts in its context
and confidently replied: *"You worked 5 days at ₹10,000 each. That means ₹50,000 is still owed."* The
ledger said ₹0. The model did multiplication it had no business doing, on facts nobody had confirmed.

That's when the architecture split into two stores with two different jobs:

1. **The ledger (SQLite) owns every rupee.** Structured events (promise, work_day, payment), summed with
   Python `Decimal`. Only this produces numbers.
2. **[Hindsight](https://hindsight.vectorize.io/) owns the story.** Who said what, when, what the employer
   promised, what excuse they gave, what happened last time. Context the agent needs to be useful and
   personal, but never the source of an amount.

The ledger math is small on purpose:

```python
if rate is None and fixed == 0:
    # Nothing agreed yet (no daily rate, no fixed total): can't compute honestly.
    earned = owed = advance = None
    status = "unknown_rate"
else:
    earned_d = (rate * days if rate is not None else Decimal(0)) + fixed
    earned = _rupees(earned_d)
    owed = _rupees(max(earned_d - paid, Decimal(0)))
    advance = _rupees(max(paid - earned_d, Decimal(0)))
    status = "owed" if owed > 0 else ("advance" if advance > 0 else "settled")
```

And the reply has a guard: any money-sized number in the model's answer that doesn't appear in the ledger,
the facts noted this turn, or the worker's own words, triggers a rewrite. If the rewrite still invents a
number, the agent falls back to a plain reply built from the ledger.

```python
def invented_amounts(reply: str, *sources: str) -> set[int]:
    """Money-sized numbers (>= 100) in the reply that appear nowhere in what we gave the model."""
    allowed = set()
    for src in sources:
        allowed |= numbers_in(src)
    return {n for n in numbers_in(reply) if n >= 100 and n not in allowed}
```

With that split, memory became something I could lean on heavily, because being wrong about a memory
changes the *tone* of a reply, never the *amount*.

## How Hindsight is wired in

Each worker gets a private memory bank (`worker-{id}`). There is also one shared bank, `employer-reputation`,
that holds only anonymous, fact-derived reports such as *"A worker reported a short payment of ₹1,800 from
Rakesh Builders."* No names, no phone numbers.

On every message, the agent **recalls** from both banks and **retains** the new turn, all concurrently:

```python
async def _retain_all():
    await memory.retain(bank, turn_content, context="chat message from worker", timestamp=now,
                        metadata={"worker_id": worker_id, "kind": "chat"})
    for employer, kind, summary in reports:
        await memory.retain(memory.REPUTATION_BANK, summary, context=f"anonymous wage report ({kind})",
                            timestamp=now, metadata={"employer": employer, "kind": kind})

# recall first (so we don't see our own un-processed message), retain in parallel.
results = await asyncio.gather(memory.recall(bank, recall_query), _recall_rep(), _retain_all(),
                               return_exceptions=True)
```

Three details made this work well in practice:

- **Retain is asynchronous.** I call `aretain` with `retain_async=True`, so Hindsight extracts facts,
  entities and time in the background and the chat never waits for it. The wallet updates as soon as the
  ledger is saved; memory catches up a moment later.
- **The recall query is enriched with the employers in focus.** A bare "he paid me 3000" becomes
  "he paid me 3000 (employers: Rakesh Builders)", which pulls back the right history.
- **Memory failures degrade, they don't break.** `return_exceptions=True` means if Hindsight is down, the
  wages are still recorded and the worker sees "memory is offline" instead of an error.

For the shared bank I use **reflect** rather than raw recall. When a worker taps *"What have workers
reported?"*, Hindsight reasons over every anonymous report about that employer and returns two or three
sentences. I explicitly ask it to state counts, mention anyone who was paid in full, and never call the
employer dishonest. [Agent memory](https://vectorize.io/what-is-agent-memory) that summarizes many people's
experiences needs to be fair by construction, not just accurate.

![The anonymous warning a second worker sees about the same employer](https://raw.githubusercontent.com/riyanshareefshaik/HakDaar/main/docs/article-images/warning.png)

## What it looks like, before and after

**Without memory** (what a stateless chat model does in a new session):

> **Worker:** Did Rakesh pay me what he owes?
> **Agent:** I don't have information about Rakesh or your payments. Could you tell me more?

**With Hindsight and the ledger** (a week later, same worker):

> **Agent:** Last time you told me Rakesh still owes you ₹1,800. Did he pay you?
> **Worker:** He gave 1000 today.
> **Agent:** Noted: ₹1,000 received from Rakesh Builders. He still owes you ₹800. Ask him politely for
> the rest, with the dates you worked.

And across workers: when a second worker says *"Rakesh has offered me work at 700 a day"*, they see
*"1 other worker reported short payment from Rakesh Builders. This is a single, unverified report, so check
with others before deciding."* It only becomes a real warning when two or more different workers report the
same employer. One angry (or fake) account can't brand anybody.

## The messy parts nobody warns you about

Real workers don't talk in clean JSON-shaped sentences, and most of my debugging time went here:

- **Bare answers.** HakDaar asks "What daily rate did Rakesh promise?" and the worker replies "10000". On
  its own, that message has no type and no employer. I now read short answers against the question the agent
  just asked: a bare number after a rate question is a promise.
- **Facts before names.** "I worked 5 days" often comes before the employer is mentioned. Instead of
  dropping it, the fact is kept under "Employer (name not given)" and moved onto the real employer the moment
  the worker names one.
- **Models returning nulls.** Fields like `"is_total": null` made strict validation silently drop real
  events, which is exactly how the ₹50,000 reply above happened. I now normalize model output before
  validating it.
- **Overpayment.** Being paid ₹1,800 for ₹1,000 of work used to read as "fully paid". Now the wallet says
  *Paid extra ₹800*, and the agent says it too.

## Lessons I'd reuse

1. **Split what an agent remembers from what it computes.** Hindsight is excellent at holding a messy,
   evolving story. A ledger is excellent at arithmetic. Don't ask either to do the other's job.
2. **Recall before you retain.** Running recall concurrently with retain, rather than after it, keeps the
   agent from "remembering" the message it is currently answering.
3. **Treat shared memory as a publishing decision.** The moment one user's memory can affect another's,
   you need anonymity, thresholds and a fair summarizer. `reflect` gave me the summarizer; the thresholds
   had to be my own code.
4. **Guard the output, not just the input.** Validating the model's JSON wasn't enough. Checking the final
   reply for numbers that exist nowhere in the ledger caught the failures that mattered most.
5. **Design for the least literate user first.** Voice input, amounts read aloud as words in Telugu and
   Hindi ("one thousand eight hundred rupees", not "one-eight-zero-zero"), and big buttons made the product
   better for everyone, not just the users I designed them for.

If you're building anything where a user's history *is* the evidence (wages, rent, loans, medical
follow-ups), give the agent a real memory. Start with the
[Hindsight documentation](https://hindsight.vectorize.io/) and the
[open-source Hindsight repository](https://github.com/vectorize-io/hindsight). Keep the numbers somewhere
the model can't touch.

HakDaar's code is on GitHub: [github.com/riyanshareefshaik/HakDaar](https://github.com/riyanshareefshaik/HakDaar).