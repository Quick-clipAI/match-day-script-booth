# Match Day Script Booth — Vercel version

Same app as before (draft scripts, research chat, live match search, voiceover),
but the Gemini and API-Football calls now go through a
small backend (`/api/gemini`, `/api/football/*`)
instead of straight from the browser. That fixes two things the GitHub Pages
version couldn't:

- **Your API keys are no longer typed into the site or stored in the visitor's
  browser.** They live only in Vercel's environment variables.
- **CORS is no longer a gamble.** Same-origin calls to your own `/api` routes
  never hit a CORS wall, regardless of what the upstream provider allows.

## What changed from the old version

| Before | Now |
|---|---|
| Browser called `generativelanguage.googleapis.com` directly, using a key typed into Settings | Browser calls `/api/gemini`, which calls Google using `GEMINI_API_KEY` from Vercel |
| Browser called `api-football-v1.p.rapidapi.com` directly, using a key typed into Settings | Browser calls `/api/football/...`, which calls API-Football directly (`v3.football.api-sports.io`) using `API_SPORTS_KEY` from Vercel — no RapidAPI involved |
| Match search only pulled the score (via football-data.org, 12 leagues) | Match search and "📡 Live Matches Today" now pull full hard data — score, scorers, cards, subs, team stats, formations — straight from API-Football, across whatever competitions your plan covers. football-data.org has been removed (its Vercel route kept 404ing and everything it did, API-Football already covers). |
| Settings panel had two password fields | Settings panel just has a "Check server APIs" status button |
| Voiceover (Edge Read Aloud / Puter.js / browser fallback) | **Unchanged** — still runs entirely in the browser, no key needed |

I also fixed the bug where the voiceover sometimes read section headers out
loud (e.g. "The hook, 0:00") — the old cleanup only removed `[0:00 - THE HOOK]`
when it sat alone on its own line; it now strips it wherever it appears.

## Deploy steps

1. **Push this folder to a GitHub repo** (or keep using your existing
   `Prime-eFootball-League/Video` repo — just replace its contents with this
   folder).
2. **Go to [vercel.com](https://vercel.com) → New Project → Import** that repo.
   No build settings needed — Vercel auto-detects the `api/` folder as
   serverless functions and serves `index.html` as-is.
3. **Add your keys** before or right after the first deploy: Project →
   Settings → Environment Variables →
   - `GEMINI_API_KEY` = your key from aistudio.google.com/apikey
   - `API_SPORTS_KEY` = your free key from dashboard.api-football.com (Account → My Access)
   Then **redeploy** (Deployments tab → ⋯ → Redeploy) so the functions pick
   up the new variables — Vercel doesn't hot-reload env vars into an
   existing deployment.
4. Open the deployed URL, click the ⚙ settings icon, press **"Check server
   APIs"** — it should say the server is configured and show your daily
   football-API quota.

## Local testing (optional)

```bash
npm i -g vercel
vercel dev
```

This runs the same `api/` functions locally on `http://localhost:3000`. Put
your keys in a local `.env` file (see `.env.example`) — `vercel dev` loads it
automatically. Don't commit `.env`.

## Files

```
index.html                    the app (unchanged UI/UX, updated fetch calls)
api/gemini.js                 proxies Gemini generateContent
api/football/[...path].js     proxies any API-Football endpoint, e.g.
                               /api/football/status, /api/football/fixtures?live=all
vercel.json                   function config
.env.example                  template for required env vars
```

## Extending live scores later

`api/football/[...path].js` is a catch-all — any API-Football endpoint works
by hitting `/api/football/<endpoint>?<query>` from the frontend, no new
backend code needed. For a scoreboard that updates without the visitor
re-clicking a button, add polling (`setInterval` re-fetching
`/api/football/fixtures?live=all` every 30–60s) — the function already sends
a short edge cache header (`s-maxage=15`) so rapid repeat calls don't burn
through your RapidAPI quota as fast.
