# HakDaar demo video

A 2-minute explainer made with [Remotion](https://www.remotion.dev). A script clicks through the
real website and records the screen. Remotion adds an intro, a caption for every step, how it works,
and the links.

## Make the video (on your Mac)

Before you start:
- HakDaar must be live: the backend is running and https://hakdaar.vercel.app works.
- Record in a quiet moment. The replies are the real AI, so each message takes a few seconds.

```bash
cd ~/HakDaar && git checkout main && git pull
cd video
npm install
npx playwright install chromium     # one time: the browser the recorder uses
npm run record                      # records https://hakdaar.vercel.app (about 2–3 minutes)
npm run render                      # makes out/HakDaar-demo.mp4
```

The recorder creates two fresh test accounts (random phone numbers). It then plays through:
- signing up and logging in;
- a promise, days worked, a short payment, and "how much am I owed?";
- the ledger, the memory panel and light mode;
- a second worker who gets the anonymous warning about the same employer.

## Change the words

Every caption, the problem slide and the links are in `src/script.js`. To preview while editing, run
`npm run studio`.

## Files

| File | What it is |
|---|---|
| `record.mjs` | Opens the site, clicks through the demo, saves `public/recording.webm` and `src/segments.json` |
| `src/script.js` | Captions for each step and the speed each step plays at |
| `src/Demo.jsx` | The video layout: intro, problem, steps, how it works, links |

A video recorded from any other address (e.g. a local copy with a test server) is stamped
"PREVIEW · test server", so a test recording can't be mistaken for the real thing.
