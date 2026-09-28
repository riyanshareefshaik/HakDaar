# HakDaar demo video: script (about 3 minutes)

Record at 1080p (QuickTime → New Screen Recording, or OBS). Zoom the browser to 125% and your editor font
to 18+. Close notifications. Have ready in tabs:
1. https://hakdaar.vercel.app/app, logged out
2. VS Code with `backend/app/chat.py` and `backend/app/memory.py` open
3. Any plain chatbot, in a new chat (for the "without memory" moment)

Before recording, make sure the backend is running and the site says Online (My account → Connections).

---

## 1. Intro (0:00–0:30)

**On screen:** your face (webcam) or the HakDaar landing page (https://hakdaar.vercel.app).

**Say:**
"Hi, I'm Riyan. I built HakDaar, an app that gives daily-wage workers a memory.
In India, a lot of construction and daily work runs on verbal promises: 'eight hundred a day, start today.'
A week later the worker gets three thousand and 'the rest later', and there's no record.
HakDaar remembers every promise, day and payment, keeps an exact ledger, and it's built on Hindsight
agent memory."

---

## 2. The problem: an agent without memory (0:30–1:00)

**On screen:** the plain chatbot tab, new chat. Type: *"Did Rakesh pay me what he owes?"*

**Say:**
"Here's the problem with most agents. New session, and it has no idea who Rakesh is, what he promised, or
what I was paid. For a worker, that's the whole story gone.
And if you just dump old chats into a model, it's worse: I once had a reply say 'you're owed fifty
thousand' when nothing had been agreed at all. The model did the maths itself, on facts nobody confirmed."

---

## 3. Live demo (1:00–2:30)

**On screen:** hakdaar.vercel.app/app. Create an account (name *Ravi*), log in.

**Type, one at a time:**
1. *"Rakesh promised me 800 rupees per day for the building work."*
2. *"I worked 6 days for him."*
3. *"He paid me only 3000 and said the rest later."*

**Say while it runs:**
"I'm just talking to it, and I could use Telugu, Hindi or voice.
Watch the top: Earned, Paid, Owed update the moment each fact is saved. That's ₹4,800 earned, ₹3,000 paid,
₹1,800 owed. These numbers come from a SQL ledger in Python, never from the model."

**On screen:** point at "Learning from your message…" under the reply, then open **My account → Memories**.

**Say:**
"This little 'learning' line is Hindsight's **retain**. Every turn goes into this worker's own memory bank,
and Hindsight extracts the facts in the background. Here's what it has learned so far.
And 'Used in last reply' shows what **recall** pulled back before the agent answered."

**On screen:** switch to VS Code, `backend/app/chat.py`, and scroll to the `asyncio.gather(memory.recall(...), ..., _retain_all())` part.

**Say:**
"In code it's one step: recall from the worker's bank and the shared employer-reputation bank, and
retain the new turn, all in parallel. Recall runs first, so the agent never remembers the message it's
answering. If Hindsight is down, the wages are still saved."

**On screen:** back to the app. Log out, then log back in as Ravi.

**Say (the before/after moment):**
"Now the before and after. I log out and come back, and instead of 'who is Rakesh?' the agent opens with:
'Last time you told me Rakesh still owed you ₹1,800. Did he pay?' That's recall across sessions."

**On screen (optional, 20 sec):** create a second account (*Lakshmi*), type *"Rakesh offered me work at 700 per day"*, then open **My account → Employer alerts** and tap **What have workers reported?**

**Say:**
"Second worker, same employer. She sees an anonymous report from a shared memory bank, summarized by
Hindsight's **reflect**. One report is marked unverified; it only becomes a warning when two different
workers report the same thing. No names, ever."

---

## 4. Takeaway (2:30–3:00)

**On screen:** the architecture diagram (`docs/article-images/architecture.png`) or your face.

**Say:**
"What surprised me: the biggest win wasn't giving the agent more memory, it was deciding what memory is
**not** for. Hindsight holds the story: who promised what, when, and what excuse was given. A ledger
holds the money. Keep those apart and you get an agent that's personal *and* never wrong about a rupee.
The code's on GitHub. Thanks for watching."

---

## 5 YouTube titles

1. My AI agent remembers the wages employers hope workers forget
2. I gave daily-wage workers a memory with Hindsight
3. Why my agent is never allowed to do the maths
4. Agent memory that remembers who still owes you money
5. Hindsight remembers the promise, Python counts the rupees

---

## Thumbnail prompt (for Nano Banana; attach a photo of yourself)

Generate a viral YouTube thumbnail, 16:9. Left side: the attached photo of me, looking at the camera with a
confident, slightly surprised expression. Right side: a dark phone screen showing a wage ledger with big text
"OWED ₹1,800" in red and a small green "Hindsight memory" tag. Background: a blurred construction site at
dusk. Bold white headline across the top: "IT REMEMBERED." Small subtitle: "AI agent memory for daily-wage
workers". High contrast, clean, no clutter, no extra logos.
