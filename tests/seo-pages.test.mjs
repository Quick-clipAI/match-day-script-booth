// node tests/seo-pages.test.mjs — public pages for search engines
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMemoryStore } from '../lib/bank-store.js';
import { importText } from '../lib/bank-sync.js';
import { normalizeSquad } from '../lib/bank-squad.js';
import { renderPage, renderSitemap, slugify, leagueSlug } from '../lib/seo-pages.js';
const TODAY = '2026-10-16';
const dir = new URL('./testdata/', import.meta.url);
const store = createMemoryStore();
for (const f of ['epl-2025-26.json', 'epl-2026-27.json']) await importText(store, { text: fs.readFileSync(new URL(f, dir), 'utf8'), dryRun: false, today: TODAY });
const a = normalizeSquad({ league: 'EPL', season: 2026, club: 'Arsenal', as_of: '2026-10-15', coach: { name: 'Mikel Arteta', nationality: 'Spain' }, players: [{ name: 'Bukayo Saka', shirt: 7, position: 'Forward' }] }, 0, { today: '2026-10-19' });
await store.upsertPlayers(a.rows); await store.upsertCoaches([a.coach]);
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };

await t('slugs', () => { assert.equal(slugify('Bayern München'), 'bayern-munchen'); assert.equal(leagueSlug('EPL'), 'premier-league-table'); assert.equal(slugify("Newcastle"), 'newcastle'); });
await t('league page has the real table, canonical and a description with numbers', async () => {
  const r = await renderPage('premier-league-table', TODAY, store, {});
  assert.equal(r.status, 200);
  assert.match(r.html, /<title>Premier League Table 2026\/27/);
  assert.match(r.html, /rel="canonical" href="https:\/\/creator-booth\.vercel\.app\/football\/premier-league-table"/);
  assert.match(r.html, /<table>/); assert.match(r.html, /Latest results/);
  assert.match(r.html, /name="description" content="Premier League 2026\/27 table after \d+ of 380 matches/);
});
await t('club page shows coach and links back to the league', async () => {
  const r = await renderPage('arsenal', TODAY, store, {});
  assert.equal(r.status, 200); assert.match(r.html, /Head coach:<\/b> Mikel Arteta/); assert.match(r.html, /Bukayo Saka #7/); assert.match(r.html, /href="\/football\/premier-league-table"/);
});
await t('unknown page is a 404 with noindex, and input is cleaned', async () => {
  const r = await renderPage('<script>alert(1)</script>', TODAY, store, {});
  assert.equal(r.status, 404); assert.match(r.html, /noindex/); assert.doesNotMatch(r.html, /<script>alert/);
});
await t('index and sitemap list every page', async () => {
  const idx = await renderPage('', TODAY, store, {}); assert.equal(idx.status, 200); assert.match(idx.html, /href="\/football\/arsenal"/);
  const sm = await renderSitemap(TODAY, store, {}); assert.match(sm, /<loc>https:\/\/creator-booth\.vercel\.app\/football\/premier-league-table<\/loc>/); assert.match(sm, /football\/arsenal</);
});
console.log(n + ' seo-pages tests ok');
