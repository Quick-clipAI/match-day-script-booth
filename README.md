# Creator Booth

**v1.0.0**

A mobile-first chat app that drafts short-form video scripts across 6 content
modes, backed by live web search and (for football) real match data — not
just whatever the model remembers from training.

## Versioning

**This README must be updated on every change, in the same commit/patch as
the code.** Not just the version number — the relevant sections above too
(features, known gaps, deploy steps) if they changed. A README that
describes an old version is worse than no README, because it actively
misleads whoever reads it next.

On every update:
1. Bump `APP_VERSION` in `index.html` (single source of truth — it drives
   both the header tag and the Settings screen automatically).
2. Bump `"version"` in `package.json` to match.
3. Add a line to the changelog below.
4. Update whichever sections of this README are now stale.

### Changelog

- **v1.0.0** — Merged the prototype chat UI into the production repo.
  6 content modes, Gemini + Google Search grounding, Groq automatic
  fallback (text + vision), best-effort football fixture context,
  Google/email auth via Supabase, incognito chats, image attachments
  (up to 4/message), message actions (copy/regenerate/share), Terms &
  Privacy pages, visible version tag. Voiceover, project/workspace
  management, and the old football tool-calling loop were not carried
  over — see "What this version doesn't do yet" below.


This is a rebuild of an earlier project (previously "Match Day Script Booth").
The backend proxy pattern carried over; the frontend was replaced with a new
chat-style UI, and the feature set was intentionally slimmed down in the
process — see **What this version doesn't do yet** below before assuming
parity with the old app.

## What it does

- **6 content modes** (Football, Story, Secret Web Tools, Hidden AI/Prompting
  Guides, Conspiracy/History, AI News Roundup) — pick one from the pill above
  the composer. Each mode is just a different system prompt; adding a 7th
  mode is a few lines in `MODES` in `index.html`, no architecture changes.
- **Gemini with live Google Search grounding** on every request — responses
  come with real source links, not just the model's training data.
- **Automatic Groq fallback** if Gemini's quota runs out mid-conversation, so
  the chat doesn't just die. Groq has no web-search tool, so a
  Groq-sourced answer is flagged in the UI (no grounding, and it's from the
  model's training data — treat it with more caution).
- **Best-effort live football context**: for Football mode, the app checks
  today's fixtures via API-Football for a team name match, and if it finds
  one, feeds Gemini real score/scorer/card/stat data as ground truth it can't
  contradict. This is a simple one-shot lookup, not a tool-calling loop (see
  below).
- **Image attachments**: the **+** button lets you attach up to 4 photos per
  message, sent to Gemini as native multimodal input. Attachments reset after
  each send — you can attach fresh images on your next message in the same
  chat, it's not a once-per-chat limit. If Gemini's down and an image is
  attached, the Groq fallback switches to a vision-capable model
  (`meta-llama/llama-4-scout-17b-16e-instruct`) instead of the usual
  text-only one.
- **Auth**: Google OAuth or email magic link via Supabase, with a full-screen
  sign-in take-over and a dedicated "check your email" confirmation screen.
  Guests can use the app fully — chats just save to `localStorage` instead of
  the account.
- **Incognito chats**: a dedicated ghost-mode landing screen, never
  persisted, with its own header controls (new chat / delete, both
  confirmation-gated so you don't lose a conversation by accident).
- **Per-chat management**: rename/delete from a header menu once a normal
  chat has messages.
- **Message actions**: copy, regenerate, and share (Web Share API where
  supported, clipboard fallback otherwise) under every assistant reply.
- **Terms & Privacy pages** (`/terms.html`, `/privacy.html`) — short,
  accurate placeholders, not full legal documents.

## What this version doesn't do yet

Carried over from the old app's README/code review, for anyone expecting
parity — these were cut or simplified during the rebuild, not forgotten:

| Feature | Status |
|---|---|
| Voiceover / TTS (ElevenLabs, Google Cloud TTS) | **Removed.** Deferred intentionally; no voice UI in this version at all. |
| Projects / saved workspaces (`createProject`, `saveWorkspace`, etc.) | **Not carried over.** Current app only has chats — no separate "project" concept. |
| Football tool-calling loop (`toolGetMatchFacts`, `toolGetHeadToHead`, live function-calling) | **Simplified.** Replaced with a single one-shot fixture lookup for *today's* matches only. No head-to-head, no multi-turn tool use. |
| Chat images persisted to history | **Not yet.** An attached image is used for that one request only; reloading a chat shows a text placeholder, not the image. |
| Custom email sender (vs. default "Supabase Auth") | **Not set up.** Requires a domain + SMTP provider (Resend, etc.) — see in-app disclaimer instead. |

If you want any of these back, the architecture (see below) is set up to
make that additive rather than a rewrite.

## Architecture

Everything lives in one `index.html` (~55KB) plus a handful of serverless
proxies under `api/`. It's intentionally still a single file at this size —
see the "splitting it up" note below for when that stops being true.

- **`callAI()`** centralizes all model calls: tries Gemini first (with
  whatever `tools`/`system_instruction` were requested, including search
  grounding), falls back to Groq on any failure. `geminiToolsToOpenAI()` /
  `geminiContentsToOpenAIMessages()` / `openAIResponseToGeminiShape()` handle
  the format translation between the two APIs, including image content.
- **`MODES`** is a flat array of `{id, icon, label, system}` — the entire
  "personality" surface of the app. No per-mode branching anywhere else in
  the pipeline.
- **`gatherFootballContext()`** does the one-shot API-Football lookup;
  `runPipeline()` is the single request/response flow every mode goes
  through.
- Supabase handles auth + chat/message storage for signed-in users;
  signed-out users get the same UI backed by `localStorage`.

### If this grows past a few more modes

At some point — a "Movie Creator" mode, a "Gaming" mode, real tool-calling
coming back — this stops being comfortable as one file. The natural split,
whenever that's warranted:

```
js/
  chat.js       runPipeline, callAI, MODES
  football.js   gatherFootballContext + any tool-calling that comes back
  auth.js       Supabase auth screens
  ui.js         drawer, settings, modals, header state machine
  storage.js    chats/messages persistence (Supabase + localStorage)
```

Not needed yet at this size — noted here so it's a deliberate choice later,
not a surprise.

## Deploy steps

1. **Push this folder to a GitHub repo**, or replace the contents of an
   existing one.
2. **Go to [vercel.com](https://vercel.com) → New Project → Import** that
   repo. No build settings needed — Vercel auto-detects `api/` as
   serverless functions and serves `index.html` as-is.
3. **Add your keys**: Project → Settings → Environment Variables →
   - `GEMINI_API_KEY` — from aistudio.google.com/apikey
   - `API_SPORTS_KEY` — free key from dashboard.api-football.com (Account → My Access)
   - `GROQ_API_KEY` — (optional) free key from console.groq.com/keys, no card
     required. Automatic backup when Gemini's quota runs out. The chat still
     works without it, it just has no fallback.

   Then **redeploy** (Deployments tab → ⋯ → Redeploy) — Vercel doesn't
   hot-reload env vars into an existing deployment.
4. **Configure Supabase auth redirect URLs** (separate from Vercel): in your
   Supabase project → Authentication → URL Configuration, set **Site URL**
   to your deployed domain (e.g. `https://creator-boot.vercel.app`) and add
   it to **Redirect URLs** as `https://your-domain/**`. If this is still set
   to `localhost`, both Google and email sign-in will redirect to a dead
   `localhost` URL after auth — this bit us once already.
5. Open the deployed URL and click through: sign-in (both methods), each
   mode, a football request, an image attach, and incognito — before
   trusting it's fully working. None of this has had a real end-to-end test
   pass yet as of v1.0.0.

## Local testing (optional)

```bash
npm i -g vercel
vercel dev
```

Runs the same `api/` functions locally on `http://localhost:3000`. Put your
keys in a local `.env` file — `vercel dev` loads it automatically. Don't
commit `.env`. Note: if you test locally, your Supabase redirect URL config
needs `http://localhost:3000` in it *too* (in addition to, not instead of,
your production domain) or auth will break in one environment or the other.

## Files

```
index.html                    the app — chat UI, all client-side logic
terms.html                    Terms of Service (short placeholder)
privacy.html                  Privacy Policy (short placeholder)
api/gemini.js                 proxies Gemini generateContent (grounding + vision + system_instruction passthrough)
api/groq.js                   proxies Groq chat completions (text + vision fallback)
api/football/[...path].js     proxies any API-Football endpoint, e.g.
                               /api/football/fixtures?date=2026-07-27
api/google-tts.js             unused by the current frontend — leftover from the old voiceover pipeline
api/elevenlabs.js             unused by the current frontend — leftover from the old voiceover pipeline
vercel.json                   function config
package.json                  name/version/description only — no build step
```

`api/google-tts.js` and `api/elevenlabs.js` are dead code from the pre-rebuild
version — safe to delete if you're not planning to bring voiceover back, kept
for now since removing voiceover was a UI decision, not evidence the backend
routes are broken.
