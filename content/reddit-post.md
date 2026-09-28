# Reddit link post

**Subreddit:** r/LLMDevs (best fit: technical audience). Other allowed options: r/AIMemory, r/aiagents, r/SideProject.

**Post type:** Link

**Title:**
My wage agent told a worker he was owed ₹50,000 when the answer was ₹0, so I split Hindsight memory from the ledger

**URL:** your Dev.to article link

---

## First comment (post it yourself right after submitting)

Author here. Quick context: HakDaar is a chat app for daily-wage workers in India, who usually work on verbal
promises with no payslips. They tell the agent (Telugu, Hindi or English, text or voice) what was promised,
worked and paid, and it keeps track of what's still owed.

The main design choice: Hindsight agent memory holds the story (who promised what, excuses, past visits),
and a SQLite ledger owns every rupee. The model never calculates; any amount in a reply that isn't in the
ledger forces a rewrite.

Other things in the write-up: recall and retain running in parallel, a shared anonymous employer-reputation
bank summarized with reflect, and needing 2+ separate reports before anything counts as a warning.

Code: https://github.com/riyanshareefshaik/HakDaar

Happy to answer questions, and I'd like to hear how others keep LLMs away from the arithmetic.
