# Creator Booth

**v1.5.0**

A football-only AI chat app for fans and creators: match and player analysis, research with sources, match-day scripts and club banter, backed by Gemini's live Google Search, our own checked **data bank** (fixtures, results, tables, facts) and real match/coach data (API-Football), not just whatever the model remembers from training. Runs as a website and as an Android app (see the `creator-booth-app` project).

## Vercel settings (Project → Settings → Environment Variables, then redeploy)

- `GEMINI_API_KEY` — your Gemini key (free tier, no card)
- `GEMINI_MODEL` — comma-separated, in priority order. **Recommended and now the default: `gemini-2.5-flash,gemini-2.5-flash-lite`.** Gemini 2.5 is used because Google Search grounding is free on it (500 searches/day shared); Gemini 3.x search needs a paid account. If a model is gone, busy or out of quota, the next one answers.
- `GROQ_API_KEY` — backup AI only (plain `openai/gpt-oss-120b`, no search) plus small helper tasks (`openai/gpt-oss-20b`). Groq's search models (`groq/compound*`) were retired and are no longer used.
- `API_SPORTS_KEY` — API-Football key (no spaces or quotes). Free plan: 100 requests/day, today ±1 day only.
- `SUPABASE_URL` — `https://krmjvfemsufduqdofuqy.supabase.co` (same project as the app's database)
- `SUPABASE_SERVICE_KEY` — Supabase → Project Settings → API Keys → the **secret** / `service_role` key. Server only; never put it in the website. Used by the data bank.
- `ADMIN_KEY` — a long password you invent. It opens `/admin.html`.
- `CRON_SECRET` — another long random string. Vercel sends it to the daily update so nobody else can trigger it.

## Data bank (v1.3.6)

Our own database of results so answers come from checked data, not the model's memory. Leagues covered: Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Saudi Pro League, UEFA Champions League, Europa League, Conference League, and Inter Miami (any competition). Seasons are named by the year they start (2025 = 2025/26).

**One-time setup**
1. Supabase → SQL Editor → New query → paste the contents of `bank.sql` (kept outside this repo; already run for this project) → Run. The tables are private: the public key in the website cannot read or change them.
2. Add the five env vars above in Vercel and redeploy.
3. Open `https://creator-boot.vercel.app/admin.html`, enter `ADMIN_KEY`.
4. Import tab → **Load from openfootball** → pick a season and the leagues → Preview → Save. Do the current and previous seasons first. (The file names for leagues other than the Premier League are not verified; if one fails it says so and nothing else is affected. Then paste JSON instead.)
5. Gaps tab: type any missing results.

**How it stays current**
- Every day at 05:00 UTC (`vercel.json` cron → `/api/cron-sync`): API-Football for yesterday/today/tomorrow (fills results, kick-off times, postponements), then the openfootball file for the current season. Overview shows a red banner if the last run failed and an amber one if it is over 36 hours old. "Run the daily update now" is on the Log tab.
- Free API-Football only serves today ±1 day, so a result missing for longer than that has to come from openfootball or you.
- Rules: a stored final score is never silently overwritten. If another source disagrees it is flagged as a **conflict** for you to decide; anything you saved by hand is marked **verified** and kept. A club name nobody recognises goes to the **Inbox** instead of creating a duplicate club.

**Admin tabs** — Overview (completeness per league and season, gaps, conflicts, sync health) · Gaps (type scores or mark postponed) · Import (paste JSON with a preview of what changes, or load from openfootball; "Copy format" gives you text to paste to ChatGPT/Gemini so it returns JSON in our shape) · Matches (filter, edit, delete, see the computed table) · Clubs (merge two spellings) · Inbox · Facts (hand-checked facts such as honours; shown to the AI only when a question contains one of their keywords) · Log.

**How the chat uses it** — `GET /api/bank?q=…&today=…` works out which leagues, clubs and seasons the question is about and returns a block starting `=== VERIFIED DATA BANK ===` with the table, champion, recent results, next fixtures or head-to-head. It states how complete the season is (`COMPLETE`, or "N of 380 stored" plus which results are missing) so the AI says "not stored yet" instead of guessing. If the bank is down or empty the chat works as before.

**Known limits** — Tables are computed from results: Serie A and the Saudi league tie-break rules are not verified (flagged in code), UEFA competitions show results/finals only, no tables. Only the leagues above exist; other competitions are ignored on import. Hobby-plan cron frequency was not verified against Vercel's docs; daily is the lowest limit I know of.

## Versioning

**Version numbers count like an odometer.** Each release raises the LAST number by one. When the last number
would pass 9, it goes back to 0 and the MIDDLE number goes up by one; when the middle number would pass 9, it
goes back to 0 and the FIRST number goes up by one. So: 1.3.3 → 1.3.4 → 1.3.5 → 1.3.1 … 1.9.9 → **2.0.0**.
(An earlier version of this note said 1.2.9 → 1.2.10; the owner's rule is the odometer rule above.) One release =
one increment, no matter how many changes it contains. The Android app project (`package.json` + the app README)
uses the same number.

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

### Setup: feedback table (required for Settings → Send feedback, v1.2.3)

Run this once in Supabase → SQL Editor. Until you do, the feedback form shows "Couldn't send it just now".

```sql
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  category text check (category in ('bug','idea','confusing','praise')),
  message text not null check (char_length(message) between 5 and 2000),
  contact text check (contact is null or char_length(contact) <= 200),
  app_version text,
  platform text,
  viewport text
);
alter table feedback enable row level security;
create policy "Anyone can send feedback" on feedback
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
-- Deliberately no SELECT policy: nobody can read feedback through the app.
-- You read it in Supabase → Table Editor → feedback.
```

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

- **v1.3.6** — **Gemini 2.5 + data bank.** Gemini 2.5 Flash / Flash-Lite are the primary models (free Google Search grounding); a model that is gone, busy or out of quota hands over to the next. Groq live research (`groq/compound*`) is **removed** — it was retired by Groq. If Gemini's search is refused, the answer is written without search and the orange note says why ("Gemini search limit reached for now"). Groq is now only a plain backup (`gpt-oss-120b`, no tools); with an attached image and Gemini down the app says so honestly instead of guessing. New: data bank (`/api/bank`, `/api/cron-sync`, `/api/admin`, `admin.html`, `supabase/bank.sql`) — see "Data bank". `/api/groq` now only accepts `openai/gpt-oss-120b` and `openai/gpt-oss-20b` and caps request size. The "denial" guard no longer blocks an answer that used verified data. The Verified badge no longer says "API-Football". Tests: bank 36, API handlers 21, chat flow 20, update flow 28, unit 10.

- **v1.3.5** — The orange "no live web search" note now ends with the reason the research step failed, e.g. `[research: too slow]` or the Groq error text, so a failure can be diagnosed from a screenshot. No other change.

- **v1.3.4** — Update notice in the Android app, and a better-researched, more honest chat. (Website code is shared with the app, so the update code is inert in a browser tab.)
  1. **Update notice (app only).** The app reads `version.json` from the GitHub release and, when a newer version exists, opens an "Update available" sheet with **Update now** (downloads the web files and restarts). If that fails, or the release needs a fresh install, the sheet shows **Download update** (the APK, via `/download` on this site). Before this, the notice only appeared after a silent background download had already succeeded, so any failure meant no notice at all.
  2. **Settings → App updates** (app only) shows the installed version, the newest published version, the last check time and the exact error if a check failed, plus a "Check now" tap. "Not now" snoozes that version for 12 hours.
  3. **Research depth no longer depends on the Short/Deep toggle.** Debates, awards, rumours, theories and "why did X lose" questions (`isDebatedTopic`) always use the multi-search model (`groq/compound`). Short now only controls how long the answer is, and may use about 200 words on a debated topic. Plain questions in Short still use the fast model, and if it fails the stronger one is tried (never more than about 40 s of trying).
  4. **No more confident "correcting" without evidence.** If no live search happened (Gemini's own or the research step) and the answer reads like a denial ("slight confusion", "never happened", "famously won..."), it is not shown. The person gets the normal retry message instead. The no-search notes now also forbid calling the person confused or mistaken.
  5. The date note no longer tells the model to use a search tool it may not have; it says to use the web research when provided, otherwise to say it cannot confirm.
  6. Settings groups round the last *visible* row (a hidden row used to leave the group with square corners).
  7. This README was stale (it still said v1.2.4). Releases v1.2.5 to v1.3.3 are described in the Android app project's README, which shares this code.

- **v1.2.4** — About the author filled in (About page → "About the author"): name, short bio, a round avatar made from the pPrince logo, and a link to the freeCodeCamp Responsive Web Design certificate. Personal email and phone number are deliberately NOT shown on the public page. Edit the `ABOUT_AUTHOR` object in `index.html` to change any of it; leave `bio` empty to hide the section again. Inside the app, links open in the phone's browser.
- **v1.2.3** — Everything since v1.2.2, in one release. (An earlier build of this work was labelled v1.3.0; the correct number is v1.2.3 because only the last number is bumped.)
  1. **Offline start.** Chat list and the latest chat show straight from the phone's saved copy (about 0.2s in testing); the 12 most recent chats are saved while online so they open offline. The welcome form never appears offline; it only shows after the server confirms a new user.
  2. **Sidebar account name.** Nickname, then first name, then surname; the email only when the profile is empty. The name sits in a box that ends in "…" when long, and the Google profile photo is used when available, with the initial as fallback.
  3. **Small and zoomed phones.** Home cards stay clear of the input box (checked at 360x640, 360x800, 553x1270); the send button fits narrow screens.
  4. **Theme.** Settings → Appearance cycles System / Light / Dark (System is the default). **Dark is now true black (#000)** so it matches the phone's status bar; the Android status bar colour follows the theme.
  5. **Typing reveal** no longer scrolls the page while text appears; a "Jump to latest" button shows if the text runs below the screen.
  6. **Thinking animation:** the star rolls once, then the ball comes out of its centre.
  7. **Reply length pill:** Short (about 60-150 words, default) or Deep (about 400-800 words).
  8. **No more blank chats.** "New chat" is just a blank screen until the first message is sent; the chat is saved then. Old empty "New chat" entries (older than 2 minutes, zero messages) are cleaned up once per sign-in. Guest chats too.
  9. **About Creator Booth page** (Settings → About): what it is, the problem, how it helps, how it differs from a general chatbot, and (website only) a Website-vs-App comparison. It contains only claims that are true of the code. The "About the author" block is controlled by `ABOUT_AUTHOR` in `index.html` (hidden while `bio` is empty).
  10. **Send feedback page** (Settings → Send feedback): star rating, optional category, message, optional reply email. Works signed in or as a guest. Needs the `feedback` table above. Terms and Privacy updated to say what is stored.
  11. **"Get the app" popup** on the website for Android browsers (after about 9s, never over sign-in, and hidden for 14 days once dismissed). Its button goes to `/download`, a redirect defined in `vercel.json`, so the GitHub address isn't printed on the page. Also available from Settings → Get the Android app. Not shown inside the app.
  12. Removed the dead Voice and Help & FAQ rows from Settings (the FAQ now lives on the About page); Terms and Privacy rows open those pages.
- **v1.2.2** — New logo everywhere; version label reset to v1.2.2 (entries below used a higher internal numbering and are kept for history).
  1. The asterisk-and-ball logo replaces the old three-bar mark on the home screen, sign-in and welcome screens, sidebar, reply footer, and the "Thinking…" loader (which now pulses the logo). Terms and Privacy pages carry it too.
  2. The site finally has a favicon (`favicon.svg`, `favicon.ico`), an iOS home-screen icon (`apple-touch-icon.png`), and a link-preview image (`icon-512.png`).
  3. Logo orange is `#FF6A1A` (CSS variable `--brand`); the interface accent colour is unchanged.
- **v2.2.0** — Desktop layout. Phones are pixel-identical to v2.1.0.
  1. From 900px wide: wider reading column (800px), larger text, bigger home screen and centered composer.
  2. From 1100px wide: the chat list is a permanent left sidebar (no hamburger, no dimming overlay).
  3. Short windows (under 750px tall) get a compact home screen so nothing overlaps.
- **v2.1.0** — Groundwork for the Android app; the website itself behaves the same.
  1. **Google + email sign-in can return to the app.** Inside the app, Google opens in the phone's real browser (Google blocks sign-in inside embedded WebViews) and comes back through a `com.creatorbooth.app://login-callback` link; email sign-in links use the same return link. On the website nothing changes. **Supabase → Authentication → URL Configuration → Redirect URLs must also contain `com.creatorbooth.app://**`.**
  2. **In-app updates.** The app checks GitHub for a newer web build, downloads it quietly, and offers a one-tap restart. Inactive on the website.
  3. Everything above is gated behind `NATIVE` in `index.html`; the build script in the app project injects the pieces it needs. The placeholder `'__GITHUB_REPO__'` is replaced at app-build time and is harmless on the website.
- **v2.0.0** — Two decisions actually built this time, not just discussed:
  1. **Football-only, for real.** The other 5 modes (Story, Secret Web Tools, Hidden AI/Prompting Guides, Conspiracy/History, AI News Roundup) are gone — `MODES` is now a single football entry, the mode-picker dropdown is removed entirely (the pill is now a static badge, nothing left to pick), and the header now carries a permanent "FOOTBALL AI" tag under the Creator Booth name. The football system prompt itself was rewritten to explicitly cover **two registers** instead of being a narrow video-scriptwriter prompt: an OFFICIAL register (research, analysis, scripts — accurate, respects verified data) and a BANTER register (jokes, hot takes, rivalry roasts — only when actually asked for, grounded in real well-known context, never a fabricated specific incident stated as fact). Added a 5th Home quick-start card, **Banter**, styled distinctly (dashed border) from the 4 "official" cards to make that duality visible rather than hidden behind a system-prompt detail. A caught-by-testing bug from this pass: the removed mode-switcher was calling a function immediately at page-load that read a `let`-declared variable before its declaration had run (a temporal dead zone crash) — would have broken the entire app on load; found by actually loading the page in a real browser, not by reading the diff.
  2. **Supabase done properly — a real local cache, not a replacement.** Signed-in users' chats/messages now mirror into IndexedDB (not `localStorage` — realistically hundreds of MB+ of quota instead of ~5-10MB, available identically on the website and inside the Android app) every time they're fetched from or written to Supabase. `refreshChatList()` and `openChat()` try Supabase first; if that fails (offline, or Supabase unreachable), they fall back to the local cache instead of showing nothing or throwing — verified in a real headless-Chrome test where the fake backend was made to genuinely throw when offline, confirming the fallback path (not just lucky mock behavior) returns the correct chat list and message content. Supabase remains the only source of truth; this is purely a read cache, so signing in on a second phone still works exactly as before. **Scoped per account on purpose:** the entire cache is wiped the moment a different user signs in on the same device (verified: after switching from one test account to another, the first account's cached chats are completely gone, never visible to the second) — directly addresses the "someone logs in on another person's phone" concern, by never trying to filter a shared cache and instead just not sharing it at all. Also wired into chat delete and account delete, so removed chats don't linger in the cache indefinitely. Found and fixed two real gaps while building this: `refreshChatList`/`openChat` had no error handling around their Supabase calls at all before this (a network failure there would have thrown uncaught), and `createChat` now fails with a clear toast instead of an uncaught exception when attempted while offline.
- **v1.9.0** — An audit pass plus three concrete fixes from the offline-experience discussion:
  - **Audit findings.** Ran a real dependency check (which functions are actually called anywhere) plus Chrome's CSS coverage tool across multiple app states. Confirmed dead code, removed: `addChips()` and its `.chips`/`.chip` CSS — leftover from the old numbered-chip feature that was removed from the UI a while back, but the function itself was never deleted; `summarizeFixtureList()` — an orphaned helper, never wired to anything; `api/google-tts.js` and `api/elevenlabs.js` — unused backend routes from before the chat-UI rebuild, already flagged as dead in this README but never actually deleted until now. **Not removed, flagged as a decision for you instead:** 5 of the 6 chat modes (Story, Secret Web Tools, Hidden AI/Prompting Guides, Conspiracy/History, AI News Roundup) have had zero feature investment for a long time — no quickstart card, no onboarding tie-in, no verified-data badge, nothing — while Football has gotten every enhancement. That's not a bug, but it is a product question worth deciding on purpose: keep maintaining all 6 as general-purpose modes, or lean fully into football and simplify/remove the rest. (The CSS coverage run also flagged ~178 "unused" selectors, but almost all of those are hover/active/modal/error states a quick synthetic script doesn't trigger — not a reliable dead-code signal, so nothing was removed on that basis alone.)
  - **Offline sends now detected honestly and retried automatically.** Sending while offline no longer shows a generic "couldn't save" warning — it shows "You're offline — this will send automatically once you're back online," and actually does exactly that the moment the connection returns (via the browser's `online` event), with no button to press. Applies to both the AI reply and the message-save step. Found and fixed a related gap while building this: the signed-in (Supabase) save path had no `try/catch` around its network calls, so a genuine network failure there could throw unhandled and hang silently with no warning and no queued retry at all — guest/local saves were already resilient to this since localStorage doesn't care about network.
  - **Suggested-question chips now explain themselves.** They previously appeared as unlabeled buttons with no context for why they were there. Each set now gets a short, naturally-varied lead-in generated by the model itself (e.g. "If you want, I can also:", "A few directions I could take this:") instead of the same static caption every time.
  - **On local/offline chat storage — deliberately not built this round, see chat for the full reasoning:** the "only cache accounts in Supabase, keep chats local" framing conflates two separate things — offline access and Supabase storage cost — and solving the actual ask (read chats with no signal, without breaking multi-device login) means a proper local *cache* of the cloud data (IndexedDB, not localStorage — much larger quota, available on both the website and the app), namespaced per signed-in user so a second person on the same device never sees the first person's chats, with Supabase staying the source of truth rather than being replaced. That's a real subsystem, not a quick patch — flagged for a deliberate go/no-go rather than built alongside a cleanup pass whose whole point was reducing scope.
- **v1.8.0** — Four real regressions from v1.7.x, all root-caused and fixed — see the chat for how each was actually verified (a headless-Chrome test with a mocked backend, inspecting the real network requests and DOM, not just reading the code):
  1. **The AI never actually had memory.** Every message was sent as a standalone request — no prior turns included, ever, since the very first version of the chat pipeline. `buildHistoryContents()` now reconstructs the earlier turns from the thread itself (works correctly for a fresh send, a regenerate, an edit, or a chat reloaded from history) and includes them in the request, with an explicit instruction telling the model to treat follow-ups like "what of France and Mbappé" as continuations of the topic rather than standalone questions. History is capped (~16 turns / ~14k characters) so a very long chat doesn't blow up the request.
  2. **"Everything goes blank until you scroll up."** Root cause: the scroll spacer added in v1.6.0 sat at the end of the thread, but every new message was being appended with plain `.appendChild()`, which — since the spacer was already the last child — pushed each new message in *after* it, behind a few hundred pixels of blank space. Fixed by routing every message insertion through one `appendToThread()` helper that always inserts before the spacer, so the spacer stays a trailing buffer instead of a wall in the middle of the conversation.
  3. **Copy/thumbs only showing on the last message.** Root cause: reloading a chat only ever wired action buttons onto the single last assistant message — every older reply in history rendered with no buttons at all, and this got worse once v1.7.0 made thumbs actually persist, since there was no working button to press. Every reply now gets its own action row on reload, each correctly paired with the user message that actually preceded it (not the chat's last one).
  4. **Long-press showed Chrome's own selection/search popup instead of an app menu.** Never actually built — v1.6.0's action-row redesign added buttons but no long-press handling. Built now: touch-and-hold a message for a custom menu (Select text / Copy, plus Regenerate + thumbs on the last reply, or Edit on your last message) instead of the browser's native text-selection toolbar. "Select text" opens a sheet where normal text selection still works, since it's disabled on the bubbles themselves to make room for the long-press gesture. Desktop mouse users are unaffected.
  - **Also fixed while diagnosing the above:** replies now render actual structure — paragraphs, bullet/numbered lists, and **bold** — instead of a wall of text with stray asterisks (the prompt was explicitly telling the model to avoid all formatting, a leftover from when only spoken-script mode existed); a failed or missing reply now shows a "Try again" button instead of a dead end; save failures (network hiccup mid-send) show a small warning instead of silently vanishing on reload; and the old single global "last message" pointer — which could end up aimed at the wrong row after a reload or a failed insert — was replaced with a per-message reference, so regenerate/edit/feedback always act on the exact message they were pressed on.
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
api/groq.js                   proxies Groq chat completions (plain backup only; two allowed models)
api/download.js               /download: newest APK (Supabase copy first, GitHub fallback)
api/bank.js                   public read: verified-data block for a question
api/admin.js                  admin actions (needs ADMIN_KEY)
api/cron-sync.js              daily update (Vercel cron, needs CRON_SECRET)
lib/                          bank logic: bank-core, bank-sync, bank-context, bank-store, sync-run, apisports
(SQL files are run in Supabase and not stored in this repo)
admin.html                    the admin page (website only; not bundled in the Android app)
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


## v1.5.0 — match screen (tap a fixture card)

Tapping the fixture card under a chat answer opens a full-screen match screen with Facts, Lineup, Table, Stats and (for the European cups) Play-offs. It reads our own data bank through `/api/match`; it never calls the football API itself.

- **Facts**: competition, round, date, kick-off (shown in the phone's time zone), venue, referee, goals and cards on a timeline, substitutions, highest-rated player.
- **Lineup**: both starting XIs on a pitch from the API's formation grid, ratings, goals, cards, minutes, substitutes, coach.
- **Table**: league table computed from the stored results, both teams highlighted, with qualification and relegation colours and a legend. Champions League, Europa League and Conference League use the league-phase table: 1-8 Qualified, 9-24 Play-offs, 25+ Eliminated. The usual domestic places are in `ZONES` in `lib/match-view.js` (one place to edit). Extra European places depend on UEFA rankings and cup winners, so check them each season.
- **Stats**: team statistics as bars (possession first).
- **Play-offs**: knockout rounds with two-leg ties and aggregate. Empty until the knockout matches are stored.
- Any tab with nothing to show says "No data available" and why. The table is always shown for league and league-phase competitions.

**Where line-ups and stats come from.** When the due-match check fills a result it also records API-Football's fixture id. The same 20-minute run (`/api/cron-sync?mode=due`) then fetches `fixtures?id=` once per finished match: 1 API credit, saved in `bank_match_details`, free for every later view. At most 3 per run, only for matches finished in the last 3 days, and an API error pauses detail fetching for an hour so it cannot use up the 100 daily requests. Matches before this release, and matches the 05:00 daily sync filled first, have no details and show "No data available".

**Setup (once):** run `7-match-details.sql` in Supabase (already applied to the project). No new environment variables. No new APK needed.

Tests: `tests/matchview.test.mjs` (13).

## v1.4.7 — results are checked after each match, not once a day

- **Due-match check.** A stored match is "due" about 110 minutes after its kick-off (if the kick-off time is stored) or after 22:30 UTC on its date (if not). For due matches the site asks API-Football for that date (one request covers the whole day; at most 2 per run, a date is not asked again for 25 minutes) and fills the score. A match still being played keeps its real kick-off so the next check is exact; postponed or cancelled matches are marked as such.
- **Any competition in the bank**, including national-team games, cups and friendlies: it matches on team names, so no competition list has to be kept up to date.
- **Two triggers:** a free GitHub schedule (`.github/workflows/due-sync.yml`, every 20 minutes, calls `/api/cron-sync?mode=due`) and every chat question (`/api/bank`, 4-second limit). Nothing due means no API request. The daily Vercel sync stays as it was.
- The `?mode=due` address needs no key: it only reads stored matches and cannot spend more than the limits above. No SQL, no new env vars or secrets.
- Log entries of kind `sync-due` appear on the admin Log tab.

## v1.4.6 — player import no longer duplicates accented names

- Importing a squad now replaces older copies of the same player that were stored with a different spelling (for example "Victor Lindelof" and "Victor Lindelöf", same club and season) instead of adding a second row. The preview says how many will be replaced.
- The player JSON has the Saudi and Racing club names matched to the bank's spellings.
- Admin page version label now follows the app version.

## v1.4.5 — fixture card under chat answers

- When an answer is about one or two clubs, a card appears under it: competition and round, both clubs, the score (or kick-off date and time) and "Full time" / "Upcoming". Two clubs: their next meeting this season, else the latest. One club: its next fixture (latest result when results were asked for).
- Only matches stored in the data bank are shown. The card is saved with the message, so it is still there when the chat is reopened.
- **No club crests**: clubs get a text badge (PSG, BAR, MCI…) with a colour from the name. Crests can be added later in one place (`clubBadgeHtml`) without touching anything else.
- `/api/bank` now also returns `cards`. No SQL, no new env vars.

## v1.4.4 — phone notification when a script is ready

- When a background script finishes, the server sends a push notification through Firebase Cloud Messaging (free). It works with the app closed; tapping it opens the chat with the script.
- Needs: Vercel env var `FIREBASE_SERVICE_ACCOUNT` (the whole service-account JSON), and **`6-device-tokens.sql`** run once in Supabase (paste the contents).
- New endpoint `api/device-token.js` links a phone to the signed-in person (also removed on sign-out). Code: `lib/push.js` (no dependencies; signs the Google token with Node's crypto).
- Needs the **new APK** (v1.4.4 app repo build). Older app files keep working but get no push; they still show the in-app notice.
- If nothing is configured, the notifier is skipped silently and the script still lands in the chat.

## v1.4.3 — Script Studio: plan first, then write in the background

- A script request now gets a **short plan first** (angle, structure, what will be checked) with a **Start writing** button. Type a change and the plan is rewritten; nothing long is written until Start is pressed.
- Signed-in people: Start sends the job to `/api/script-job` (up to 300 s, runs server-side). The chat says "I'm on it", you can leave, and the finished script is saved into the chat. The app shows a notice when it is ready (and when you next open it). A failure saves a visible message with a Regenerate hint.
- Guests / offline / server unavailable: the script is written in the open chat as before.
- **Run `5-script-jobs.sql`** once in the Supabase SQL Editor (paste the contents).
- `vercel.json` now sets 300 s only for `api/script-job.js` (60 s for the others). On Vercel Hobby, 300 s needs **Fluid compute** (Settings → Functions) on older projects.
- Push notification with the app closed comes in the next release (needs Firebase and a new APK).

## v1.4.2 — squads with age, status and head coaches

- **Squad import accepts what a research sheet really contains.** Per club group: `league`, `season`, `club`, `as_of` (date the list is true), `coach {name, nationality}` and `players` with `name`, `shirt`, `dob`, `age`, `position`, `nationality`, `club_status` ("Active" or "Retired (2026)") and `national_status` ("Active", "Retired (2022)" or "Not capped"). "NOT FOUND", blanks, N/A and "-" are stored as empty, never as text. A player with an age but no date of birth keeps the age and the `as_of` date it was true on.
- **Checks:** league key, season, as_of not in the future, shirt 0-999, ISO dates, age 14-60, statuses, positions. Warnings (not blockers): age that disagrees with the date of birth, implausible ages, duplicate shirt numbers in a club, a player listed in two clubs, players with no birth info, no coach.
- **Club names are matched to the bank's spelling** ("Man City FC" becomes "Manchester City") when the league already has matches stored; otherwise the name is kept as written with a warning.
- **Loans and national-team levels:** club status accepts Active / Permanent / On Loan (from club) / Retired (year); national status accepts Active (senior), Youth International, Former international, Former youth international, Retired (year), Not capped / Uncapped. Loans store `on_loan` and `loan_from`.
- **Chats are listed by last use.** A chat moves to the top when you send, edit or regenerate in it, so the app opens the chat you used last. Needs `4-chats-last-used.sql` (adds `chats.updated_at`); until it is run, the order still works on the device you use but is not shared between devices.
- **Loading logo is orange** (the brand colour) instead of white while the app starts.
- **Coach, squad and form now reach the chat.** For any club named in a question, the data bank block now carries the head coach (from the squads you imported), the registered squad (names, shirt numbers, loans), the club's record and current run in the stored matches, and its league finishes in completed stored seasons (so "back-to-back champions" can be stated from data). If a club has no coach on file the block says so and forbids naming one from memory. The older API-Football coach lookup now runs when the bank has no coach, and only trusts a coach whose spell at the club is still open (it used to take the first name in the list, which can be a former manager). Fixes the "Xavi's Barcelona" mistake. Only competitions you have stored are counted: the chat cannot state a Champions League run that is not in the bank.
- **Mode chips instead of editable starter text.** Tapping Match Analysis, Player Analysis, Football Research, Script Studio or Banter puts a locked chip (e.g. "Write a script") in the composer. You type only the topic; the chip is added when you send. Tap the chip's ✕ (or Backspace in an empty box) to remove it in one go.
- Tests: `node tests/context.test.mjs`.
- **Admin, Players tab:** new example, per-club summary (players, retired, no birth info, coach), search, and Players / Delete buttons per club squad. New actions `deleteClubSquad`; `players` now returns per-club totals.
- **Reliability:** the Supabase helper retries a transient 401 "JWT issued at future" (and 5xx on reads).
- **Database:** run `3-squads-status-coaches.sql` once in Supabase -> SQL Editor (after `1-competitions-and-players.sql`). It is NOT inside the zip. Paste its contents, not the file name.
- Tests: `node tests/squad.test.mjs`, `node tests/retry.test.mjs`, plus the older career and matcher tests.

## v1.4.1 — nations, clubs and tournaments in career profiles

- **Nationality travels with the player.** `nationality` is the country he represents at senior level (or is eligible for if uncapped); `other_nationalities` lists any other citizenships. A national team is built later by grouping on this, so players are never entered twice.
- **`tournaments`: registered squads only.** Each entry is `tournament`, `year`, `nation`, `status` (`registered` or `withdrew_injured`) and optional `stats`. Allowed tournaments: FIFA World Cup, UEFA European Championship, Copa América, Africa Cup of Nations, AFC Asian Cup, CONCACAF Gold Cup, Olympic Games (common short names such as "World Cup" or "Euros" are accepted). A player who was not in the final squad simply has no entry, so each tournament's squad can be rebuilt from the profiles.
- **`totals` now means club career only.** National-team figures live in the new **`international`** list: one row per nation and level (`senior`, `Olympic`, `U23` … `U16`), so a player who switched nations has one row for each.
- **`by_club`:** one row per spell at a club (`from`, `to`, and that spell's stats). Dates alone are fine; stats are optional. The rows can never add up to more than `totals`.
- **Seasons:** an "All competitions" row can no longer be mixed with per-competition rows for the same club and season (it would be counted twice).
- **Awards** take `kind`: `individual` or `team`.
- Merging: tournaments, clubs and national-team rows are matched by their own keys and added to; any value that would be replaced is listed in the preview. The `as_of` rule is unchanged and covers club, season and national-team stats alike.
- **Research prompts** for Deep Research (one per league plus Inter Miami) are kept outside the repo. Their example JSON is checked against this importer.
- No SQL change (profiles are stored as JSON). Only `admin.html`, `lib/bank-career.js`, `tests/career.test.mjs`, `README.md` and `package.json` changed.

## v1.4.0 — career profiles

- **Players tab → Career profiles.** One profile per player with any of: career `totals`, per-season stats (`seasons`), `awards`, `market_values` (each with a date) and `transfers`. Every section is optional; only `name` is required, plus `as_of` whenever totals or seasons are given.
- **`as_of` is the guard.** It is the date the figures are correct up to. Matches recorded in the bank count from that date on, so recorded matches and imported career figures are never added together. A newer import replaces older stats; an import dated *older* than what is stored leaves the stored totals and seasons alone (awards, transfers and values are still added).
- **Importing again adds, it does not wipe.** Values that already exist are replaced only when you give a new one, and the preview lists every one it would replace ("totals.goals: 50 → 55"). Same file loading and chunking as squads (several files, parts under 1 MB).
- **Checks before saving:** stat values must be plain numbers ≥ 0; successful can't exceed attempted (dribbles, passes, crosses, shots on target, penalties); seasons can't add up to more than the career total; no future `as_of`; money must be a plain number with a date; duplicate season rows are refused. A stat name that isn't a standard one is kept but warned about (catches `assits`).
- **Matching players:** by normalised name plus date of birth. Without a dob a profile matches a unique stored name; two stored players with the same name need a dob. Adding a dob later to a profile saved without one updates that profile rather than creating a second.
- **Copy prompt for ChatGPT / Gemini** button gives a ready prompt that returns JSON in this format, told not to guess.
- **Needs a database change first:** run `2-career-profiles.sql` once in Supabase (creates the private `bank_career` table). Until then the card shows a "not ready" notice and nothing else on the page breaks.
- **Not wired into the chat yet.** Neither squads nor career profiles are read by the AI; they are stored and reviewable only. That is the next step.
- Tests: `node tests/career.test.mjs`.

## v1.3.9 — import JSON from a file

- **Players tab:** new **Choose JSON file(s)…** button. Pick one file or several at once (for example one per club). The file is read in the browser, split into parts of under 1 MB and sent one part at a time, so the clipboard limit and the server's ~4.5 MB request limit no longer matter. A progress label shows "Checking 2/3…" or "Saving 2/3…".
- Preview first, then Save, as before. Problems in the file are now listed on the page (before, a bad file only showed "Server answered 400"). A repeated player inside the import is flagged. Pasted text is ignored while files are loaded; **Clear files** goes back to pasting. A file that is not valid JSON, or was cut off, is rejected with nothing loaded.
- If a later part fails during Save, the earlier parts are already saved; saving again is safe (same players overwrite themselves).
- **Import tab (results):** new **Choose JSON file…** button that loads the file into the box, then Preview as usual. Files over 4 MB are refused with a message.
- Known limit: the repeated-shirt and two-clubs warnings are checked per part against what is already stored, not across parts of the same file. The in-file repeated-player check covers the whole file.
- **Version tag on the admin page** (header, next to the date), from `ADMIN_VERSION` in `admin.html`. Bump it with `package.json` on every release.
- **APK file name carries the version.** `/download` now saves the file as `creator-booth-v<version>.apk` (read from the published `version.json`), so downloads are recognisable. The browser still adds `(1)`, `(2)` if you download the same version twice; delete old copies. Once the app is on v1.3.8 or later, updates arrive inside the app and the APK is not needed again. If the Supabase copy is missing, GitHub is used and keeps the plain name `creator-booth.apk`.
- Changed: `admin.html`, `api/download.js`, `README.md`, `package.json`. No SQL, no environment variables, no app update.

## v1.3.8 — faster app updates, installable admin

- **App updates no longer depend on GitHub's download speed.** Each app build also uploads `bundle.zip`, `version.json` and the APK to a public Supabase Storage bucket named `app-updates` (the same host the app already uses for chats and sign-in). The app checks both Supabase and GitHub, takes the newest version, downloads from that host and automatically tries the other if it fails. The update is the web files only (expected to be well under 1 MB; not measured here because the real build needs the app repo's CI), not the 5 MB app file.
- **If an update still fails the sheet now says why:** it shows a connection test for each host (status code and seconds), so a screenshot tells us whether the phone, GitHub or Supabase is the problem.
- **`/download`** (the APK link) now goes to the Supabase copy when it exists (`api/download.js`), otherwise GitHub as before.
- **Admin is installable.** Open `/admin.html` in Chrome on the phone → ⋮ → Install app (or tap **Install app** in the page header). It gets its own "ADMIN" icon. It caches nothing, so it is always the newest admin page; deploying the website IS the admin update. `admin.webmanifest`, `admin-sw.js`, `admin-*.png`.
- The app files needed from the website are only `index.html` (unchanged flow: copy it into the app repo's `www/`). `admin.html` is never part of the app.
- **One-time setup** (see the app README): create the bucket `app-updates` (public) in Supabase and add two GitHub secrets to the APP repo, `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Without them the build still works and updates come from GitHub as before.
- A phone on an older app version (v1.3.4 or earlier) still uses the old GitHub path, so it needs one APK install to get the new updater.
- Tests: update flow 35, chat flow 20, bank 36, API handlers 27, players 4, unit 10.

## v1.3.7 — players, more competitions, two fixes

- **Players tab** (admin): paste a squad as JSON, one club per group, e.g. `{"league":"EPL","season":2026,"club":"Arsenal","players":[{"name":"…","shirt":7,"dob":"2000-01-31","position":"Forward","nationality":"England"}]}` (or an array of groups). Preview warns about a repeated shirt number in a club/season and about the same player at two clubs. Date of birth is stored; age is calculated when shown. Do not import unverified players.
- **New competition keys** for manual import: `CLUBFRIENDLY`, `NATIONFRIENDLY`, `WORLD_CUP`, `EURO`, `AFCON`, `COPA_AMERICA`, `WC_QUALIFIERS`, `EURO_QUALIFIERS`, `AFCON_QUALIFIERS`. They are competition categories; no results are included.
- **Needs a database change first.** Run `1-competitions-and-players.sql` once in Supabase (paste its contents into SQL Editor). It widens the allowed competition list and creates the private `bank_players` table. The SQL is kept out of this repo on purpose.
- Fix: the Supabase store now really saves/loads players (before, only the test store could).
- Fix: club-spelling aliases that name several spellings (Union SG etc.) crashed the chat's bank lookup; they no longer do.
- Ligue 1 matcher fix (Paris FC vs Paris Saint-Germain) is included: `node tests/matcher.test.mjs`.
- Not changed: `index.html` (still v1.3.6), so the Android app needs no update.
