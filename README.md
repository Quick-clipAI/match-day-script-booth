# Creator Booth

**v1.7.0**

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

### Setup: profiles table (required for onboarding survey + personalization)

v1.4.0 adds a personalization survey and Profile settings backed by a new Supabase table. Run this once in your Supabase project's SQL Editor:

```sql
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  surname text default '',
  other_names text default '',
  nickname text default '',
  referral_source text default '',
  referral_other text default '',
  use_case text default '',
  favorite_club text default '',
  notes text default '',
  script_preferences text default '',
  onboarded boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "Users manage own profile" on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Until this table exists, profile/onboarding features fail silently (no onboarding prompt, greeting falls back to email prefix) rather than breaking sign-in — but run this before shipping v1.4.0 so personalization actually works.

### Setup: feedback column (required for persisted thumbs up/down)

v1.7.0 makes the thumbs up/down buttons actually persist instead of being local-only UI. Run this once in your Supabase project's SQL Editor:

```sql
alter table messages add column if not exists feedback text;
```

Until this column exists, tapping thumbs up/down still gives visual feedback but the save silently fails (caught and ignored, same fail-open pattern as the rest of this app) — so it's safe to deploy before running this, just won't actually persist until you do.

### A note on image storage (v1.7.0)

Attached images are now compressed client-side (max 1024px, JPEG ~70% quality) and saved as base64 directly in the `messages.media` jsonb column — not Supabase Storage. This is the simpler option and fine for personal/moderate use, but it counts against Supabase's free-tier **database** size limit (500MB), not the separate Storage limit (1GB), and base64 is ~33% larger than the raw bytes. If image use grows heavy, migrating to Supabase Storage (storing a URL instead of the bytes) would be the next step — flagging now so it's a deliberate choice later, not a surprise.

### Changelog

- **v1.7.1** — Backend groundwork for the Android app (see the new `app/` folder):
  - Every frontend call to `/api/gemini`, `/api/groq`, and `/api/football/...` now goes through an absolute `API_ORIGIN` (`https://creator-boot.vercel.app`) constant instead of a same-origin relative path. Behaves identically on the website (still same-origin, no functional change) but is what makes the app work at all — the app bundles this same file locally at a different origin (`https://localhost`), and a relative `/api/...` path there would have resolved against the app's own local origin and failed outright.
  - Added CORS headers (`Access-Control-Allow-Origin: *` + `OPTIONS` preflight handling) to `api/gemini.js`, `api/groq.js`, and `api/football/[...path].js`, since the app now calls them cross-origin. No change in behavior for same-origin website calls.
- **v1.7.0** — Decided against a native app for now (see chat discussion — Capacitor wrapper is real future work, not this pass) and built the three flagged ideas instead:
  1. **Images now persist in chat history.** Attached images are compressed client-side (max 1024px, JPEG ~70%) before both sending to the AI and saving — see the "note on image storage" section above for the storage tradeoff (DB jsonb column, not Supabase Storage). Reloading a chat now shows the actual photo again instead of nothing. Regenerating the last reply after a reload also now correctly re-sends the original image(s) — previously it silently dropped them even when they were the last live message in a session. Editing a message's text no longer wipes its attached images (was a real bug introduced by this change — replace-saves overwrite `content` and `media` together, so the fix now re-reads the existing images from the DOM before saving an edit).
  2. **Thumbs up/down now actually persist** to a new `feedback` column on `messages` (SQL above) via a `msgFeedbackRef` map from DOM element → storage row, set right after each message saves. Tapping an already-active thumb clears it rather than getting stuck on. Reloading a chat restores whichever thumb was previously pressed on the last message.
  3. **Favorite-club narrative lean for scripts.** When writing a video script (not a neutral factual answer) about a match involving the person's favorite club, the model may narrate with a light sympathetic lean — more emphasis on their good moments, a charitable read on an ambiguous call — the way a fan channel naturally would. Explicitly scoped to framing/word-choice only: every score, stat, and fact must stay accurate regardless of lean, and neutral factual questions ("who won") get a neutral answer with no lean at all.
- **v1.6.0** — A big batch from one review session:
  1. **Investigated the "stray n" glitch** reported at the bottom-left corner — found nothing in source (no stray text node, no NaN-producing calculation) that would explain it, and it showed up identically on an old v1.4.0 screenshot, before any of this session's layout changes. Best guess: Vercel's own "Toolbar" widget, which auto-injects on your deployment for any browser signed into your Vercel account — not part of this app's code at all. Test in an Incognito tab (signed out of Vercel) to confirm.
  2. **Responsive layout** — capped and centered the content column above ~720px viewport width (desktop/tablet browsers), so it no longer stretches edge-to-edge on a PC. Below that breakpoint (phones, including narrow ~360dp ones), nothing changed.
  3. **Header icon pill** — the top-right action icons (export/new chat/options/delete) now sit inside a small rounded pill background, matching the grouped-icon treatment you pointed out.
  4. **Sources redesigned** — collapsed by default into a small favicon-stack + "Sources · N" toggle; tapping it expands the full card list inline, instead of always dumping full cards into every reply.
  5. **Football research scope fix** — football mode's prompt now explicitly says not to limit "what happened" questions to one league and not to conclude "no football happened" just because e.g. the Premier League has no fixture that day — international windows (World Cup/AFCON qualifiers, Nations League, friendlies) and other competitions are accounted for.
  6. **Suggested follow-up questions** — substantive replies now end with 2-4 tappable follow-up prompts (parsed out of the model's own response via a `===SUGGESTIONS===` marker, never shown as raw text); tapping one sends it immediately, same as the ChatGPT pattern that prompted this.
  7. **Playful club banter** — when a favorite club is set in the profile (from the onboarding survey) and the person explicitly asks for a joke/banter, the model can lean into good-natured rival-club ribbing grounded in real, well-known struggles (trophy droughts, bad form) — never invented specific incidents, never unprompted.
  8. **Scroll anchoring** — sending a message now scrolls it to just below the top of the screen instead of jamming it at the very bottom edge, leaving room for the reply to fill in below; long replies still naturally follow to the bottom as they grow.
  9. **Custom icons** — all 6 mode icons and the 4 Home quick-start card icons are now custom line-SVGs matching the app's existing icon style, replacing the emoji placeholders.
  10. **Real chat titles** — a chat now shows "Generating title…" (styled distinctly) instead of the first 40 characters of your message, then gets a short AI-generated title (e.g. "Man City manager check") once the first reply actually lands — one lightweight extra Gemini call per new chat, only once.
  - **Also fixed while in this code:** suggestion-chip taps could theoretically fire a second generation while one was already running — added a proper `isGenerating` guard rather than leaving that unprotected.
- **v1.5.0** — Built the two lowest-risk pieces of the football-first redesign discussion (see README history / chat for the full reasoning on what was deferred and why):
  1. **Home quick-start cards** — 4 small cards (Match Analysis, Player Analysis, Football Research, Script Studio) under the greeting on an empty chat. They don't open new screens — each just switches to football mode and pre-fills the composer with a starter phrase, so the person finishes typing and sends as normal. Kept small and Claude-like on purpose, not dashboard tiles.
  2. **Verified / Research split** — football replies that actually found live API-Football data now show a small, muted-green "Verified football data" badge listing exactly which facts were confirmed (score, scorers, cards, match stats, current coach, etc.) — never a generic "verified" stamp, always the specific fields that were real for that reply. Source chips were upgraded into proper cards (favicon, title, domain, "→" link) under a "Web research · N sources" label. Deliberately did **not** add a fabricated "Used for: X" line per source — grounding metadata doesn't tell us which source contributed which fact, and guessing would undermine the whole point of a "verified" section.
  - **Explicitly not built this round** (flagged as bigger, separate work): full Match Analysis / Player Analysis screens with timelines, tactics, and formations — the current API-Football free tier only reliably covers *today's* fixtures, not historical match search or formation data, so those screens would mostly show "no data available." Numeric "AI Assessment" player rating bars (9.1 Vision, etc.) were also deliberately skipped — they'd contradict the app's own "never invent a stat" principle. A persistent bottom tab bar was skipped too — it's a layout-architecture change (composer/keyboard interaction, view structure), not a styling one.
- **v1.4.1** — Fixed the onboarding trigger: it only fired for accounts that already had a `profiles` row with `onboarded: false`, so every account that existed *before* v1.4.0 (which has no `profiles` row at all) was silently skipped and never asked. Now it fires whenever there's no profile row yet, not just when there's an unfinished one — every pre-existing account gets asked exactly once, next time they sign in.
- **v1.4.0** — Three things:
  1. **Onboarding survey + personalization.** Right after a genuinely new sign-in (Google or email — never for guests, and never twice), a full-screen survey asks for surname (required), other names, nickname, how you heard about us (chip select + "Other, specify"), what you plan to use Creator Booth for, favorite club, and any other notes — all editable later in Settings → Profile, all optional except surname, "Skip for now" always available. Stored in the new `profiles` table (SQL above), synced across devices for signed-in users; guests get the same form saved to local storage instead. The chat greeting now prefers nickname → other names → surname → email prefix, in that order, instead of always using the email prefix. Terms and Privacy rewritten to disclose this data collection plainly (Section 4/2 respectively) — personalization only, never sold, deletable anytime.
  2. **Centered composer on a new chat** — on an empty chat, the input box lifts off the bottom edge and centers itself with the greeting (fixed position, capped width, more shadow) instead of sitting pinned to the screen edge. Reverts to the normal full-width bottom bar the moment a message is sent.
  3. **Word-by-word reply reveal** — freshly generated replies now type out word by word instead of appearing all at once, with a blinking cursor while typing; sources and action buttons fade in once typing finishes. **This is a client-side typewriter effect, not real token streaming** — the full response still has to finish generating before typing starts, so it doesn't reduce time-to-first-word. True streaming (Gemini's `:streamGenerateContent`) is possible but is a real backend change that complicates the Gemini→Groq automatic fallback and the timing of grounding source links — worth doing later if the typewriter effect isn't enough on its own.
- **v1.3.0** — Four things:
  1. **Loading indicator redesign** — the blinking orange dot is gone;
     the "thinking" state now shows three bars of the brand mark pulsing
     tall/short on a stagger, matching the logo instead of a generic dot.
  2. **Edit last message** — the single most-recent user message now has
     an edit (pencil) icon. Tapping it swaps the bubble for a textarea with
     a notice that saving will regenerate the response below it. Saving
     updates the message in place (storage + DOM) and regenerates the
     following assistant reply against the edited text; if that
     regeneration fails, the previous response is restored with a brief
     notice, same fallback behavior as plain regenerate.
  3. **Football club/coach verification** — football mode now runs a
     small deterministic pipeline before generating: a tool-free Gemini
     call extracts up to 3 club names mentioned in the request, each is
     looked up against API-Football's `teams` + `coachs` endpoints for
     its actual current manager, and the result is injected as a
     `=== VERIFIED CLUB/COACH DATA ===` block the model is told to treat
     as ground truth over its own memory — this is what actually catches
     cases like "Maresca manages Man City" (it doesn't; Guardiola does).
     **Why not a real tool-calling loop:** combining Gemini's built-in
     `google_search` grounding with custom function declarations in one
     request is a Gemini 3-only preview feature — this app runs on
     `gemini-2.5-flash`, so the model can't be handed a "look up the
     coach" tool to call itself. This is a fixed extract → verify →
     inject pipeline instead, not the model deciding when to check.
     **Known limitation:** only catches club/coach facts, only for up to
     3 clubs per request, and only when API-Football's team-name search
     resolves a match — anything else still relies on Gemini's own
     search grounding (and the v1.2.2 date/time nudge) as before.
  4. Football mode's system prompt updated to reference the new verified
     block alongside the existing match-data one.
- **v1.2.2** — Every request now gets the visitor's current date/time
  injected into the system prompt, plus an explicit instruction to verify
  role/roster-type facts (managers, staff, club affiliations) via search
  rather than trusting memorized training data. **Known limitation:**
  Gemini's `google_search` tool has no API setting to force a search on
  every request (that existed for older Gemini 1.5 models via
  `dynamicRetrievalConfig`, removed for the tool used here) — this is a
  prompt-level nudge that improves the odds, not a guarantee. If stale
  facts keep slipping through, the real fix is a deterministic pre-search
  step (like `gatherFootballContext` already does for fixtures) feeding
  verified results in as required context — bigger lift, needs its own
  search API key, not yet built.
- **v1.2.1** — Regenerate now snapshots the previous response before
  clearing the message; if the regeneration attempt fails (both Gemini
  and Groq down), the old response is restored with a brief "couldn't
  regenerate" notice instead of being permanently lost behind an error
  box. Closes the tradeoff noted in v1.2.0.
- **v1.2.0** — Redesigned message actions to match a "reference layout":
  every assistant reply gets copy + thumbs up/down; only the current last
  reply also gets regenerate, plus a brand-mark/disclaimer footer row.
  Regenerate now actually replaces the message in place (same DOM element,
  same DB row updated via `saveMessage(..., {replace:true})`) instead of
  appending a second reply below the old one. Thumbs up/down are local-only
  UI feedback for now — no backend collects them yet. Per-message Share was
  removed (the header-level "Export chat" feature covers that need).
- **v1.1.1** — Added a GitHub Actions keep-alive workflow
  (`.github/workflows/supabase-keepalive.yml`) that pings Supabase every
  3 days so the free-tier project doesn't auto-pause after 7 days of
  inactivity. No app code changed.
- **v1.1.0** — Export chat as a "Speaker:- text" transcript, either copied
  to clipboard or downloaded as a PDF (jsPDF, lazy-loaded). Available from
  a header icon in both normal and incognito chats.
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
- **Message actions**: copy + thumbs up/down under every assistant reply;
  the current last reply also gets regenerate (replaces that message in
  place — doesn't stack a second reply below it) plus a brand/disclaimer
  footer.
- **Export chat**: header icon (available in incognito too, not just normal
  chats) exports the full transcript as `Speaker:- text` turns, either
  copied to clipboard or downloaded as a PDF. PDF generation uses jsPDF,
  lazy-loaded from a CDN only when Download is actually clicked.
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

## Keep Supabase from auto-pausing

Supabase pauses free-tier projects after **7 days with no database
activity** — the project goes offline (`DNS_PROBE_FINISHED_NXDOMAIN` when
you hit its URL directly) until manually restored from the dashboard. This
happened once already, after a 2-month pause between working sessions.
Restoring is free and keeps all data, but it's an avoidable interruption —
the project resolves this the same day it happens, but only if someone
notices and restores it.

`.github/workflows/supabase-keepalive.yml` runs a real `SELECT` against the
`chats` table every 3 days (safe margin under the 7-day limit), so the
project never goes quiet long enough to trigger a pause. It needs no setup
— it's already wired to this project's URL/anon key (same ones hardcoded in
`index.html`; the anon key is public by design, so there's no security
reason to hide it as a GitHub secret here too). Confirm it's running: repo
→ **Actions** tab → "Supabase Keep-Alive" should show green runs every 3
days. You can also trigger it manually from there (**Run workflow** button)
to test it immediately.

If the project ever does get paused again anyway (workflow got disabled, a
run failed silently, etc.) — restoring from the dashboard is safe up to
**90 days** paused; past that, the "Restore" button is disabled entirely and
you'd need to download the backup and create a fresh project instead. Don't
let it sit paused for months on the assumption it's fine.

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
