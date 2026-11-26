// lib/seo-pages.js — public, plain-HTML pages that Google can read: a table + results + fixtures page for each domestic league,
// and a page for each club (head coach, position, results, fixtures, squad). All from our own data bank, all server-rendered,
// so a search engine sees the real numbers without running the app. Served by /api/bank?mode=page (vercel.json rewrites /football/<slug>).
import { LEAGUES, DOMESTIC_KEYS as ALL_DOMESTIC, computeTable, currentSeason, seasonLabel, fmtDate } from './bank-core.js';
import { dateUnknown, roundLabel } from './bank-context.js';

// MLS is left out on purpose: its official standings are two conference tables, and one combined table under the name "MLS table" would mislead
const DOMESTIC_KEYS = ALL_DOMESTIC.filter(k => k !== 'MLS');
export const SITE = 'https://creator-booth.vercel.app';
export const NAME = 'Creator Booth';
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slugify = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const leagueSlug = key => slugify(LEAGUES[key].short) + '-table';
const leagueOfSlug = slug => DOMESTIC_KEYS.find(k => leagueSlug(k) === slug) || null;
const nth = n => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };

const CSS = `:root{--bg:#fff;--fg:#1b1a18;--dim:#6b665d;--line:#e4e0d8;--card:#f7f5f0;--acc:#c24e1c}@media(prefers-color-scheme:dark){:root{--bg:#0c0c0b;--fg:#f2ede4;--dim:#a29c91;--line:#2b2a28;--card:#151514;--acc:#ff8a4a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main,header,footer{max-width:760px;margin:0 auto;padding:0 16px}header{padding-top:14px;padding-bottom:6px;display:flex;justify-content:space-between;align-items:center}header a{color:var(--fg);text-decoration:none;font-weight:700;letter-spacing:.02em}header a span{color:var(--acc)}
h1{font-size:26px;line-height:1.2;margin:14px 0 6px}h2{font-size:19px;margin:28px 0 10px}p{margin:8px 0}.dim{color:var(--dim);font-size:14px}a{color:var(--acc)}
.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%;min-width:480px;font-size:14.5px}th,td{padding:8px 9px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}th{font-size:12px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em;background:var(--card)}
td:nth-child(2),th:nth-child(2){text-align:left;white-space:normal;width:100%}tr:last-child td{border-bottom:0}td.pts{font-weight:700}
ul.list{list-style:none;padding:0;margin:0;border:1px solid var(--line);border-radius:12px}ul.list li{padding:10px 12px;border-bottom:1px solid var(--line)}ul.list li:last-child{border-bottom:0}.sc{font-weight:700}
.cta{display:block;margin:26px 0;padding:14px 16px;border-radius:14px;background:var(--card);border:1px solid var(--line);text-decoration:none;color:var(--fg)}.cta b{color:var(--acc)}
.chips{display:flex;flex-wrap:wrap;gap:8px;padding:0;list-style:none;margin:8px 0}.chips a{display:block;padding:7px 12px;border:1px solid var(--line);border-radius:999px;text-decoration:none;font-size:14.5px}
footer{padding-top:22px;padding-bottom:40px;border-top:1px solid var(--line);margin-top:30px}`;

function shell({ title, description, path, body, crumbs, noindex }) {
  const url = SITE + path;
  const ld = crumbs ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: SITE + c[1] })) })}</script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(url)}">${noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index,follow,max-snippet:-1">'}
<meta property="og:type" content="website"><meta property="og:site_name" content="${NAME}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}"><meta name="theme-color" content="#0c0c0b">${ld}<style>${CSS}</style></head><body>
<header><a href="/">Creator <span>Booth</span></a><a href="/football" class="dim">Football tables &amp; results</a></header><main>${body}</main>
<footer class="dim">${NAME} — a free football AI assistant. Figures come from our own checked data bank and are updated daily; where we have not stored something we say so. <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></footer></body></html>`;
}

const when = m => dateUnknown(m) ? roundLabel(m.round) + ' (date not announced yet)' : fmtDate(m.date) + (m.time ? ' ' + m.time : '');
const matchLi = m => {
  const fin = m.status === 'finished' && Number.isInteger(m.hg) && Number.isInteger(m.ag);
  return `<li><span class="dim">${esc(when(m))}</span><br>${esc(m.home)} <span class="sc">${fin ? m.hg + '–' + m.ag : 'v'}</span> ${esc(m.away)}</li>`;
};
const rowTr = (r, linkable) => `<tr><td>${r.rank}</td><td>${linkable.has(r.team) ? `<a href="/football/${slugify(r.team)}">${esc(r.team)}</a>` : esc(r.team)}</td><td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td><td>${r.GF}</td><td>${r.GA}</td><td>${r.GD > 0 ? '+' + r.GD : r.GD}</td><td class="pts">${r.Pts}</td></tr>`;
const tableHtml = (table, linkable) => `<div class="wrap"><table><thead><tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>${table.map(r => rowTr(r, linkable)).join('')}</tbody></table></div>`;

async function leagueData(key, today, store, cache) {
  const ck = 'seo|' + key; const hit = cache[ck]; if (hit && Date.now() - hit.at < 300000) return hit.v;
  const cfg = LEAGUES[key], season = currentSeason(cfg, today);
  const matches = (await store.listMatches({ league: key, season }).catch(() => [])).map(m => ({ ...m, league: key, season }));
  const t = computeTable(matches, cfg);
  const v = { cfg, season, matches, table: t.rows, tieUndecided: t.tieUndecided, played: t.playedMatches, total: t.expected || t.totalMatches, label: seasonLabel(cfg, season) };
  cache[ck] = { at: Date.now(), v }; return v;
}
const byDate = (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));

async function leaguePage(key, today, store, cache) {
  const d = await leagueData(key, today, store, cache);
  if (!d.table.length) return null;
  const cfg = d.cfg, linkable = new Set(d.table.map(r => r.team));
  const fin = d.matches.filter(m => m.status === 'finished' && Number.isInteger(m.hg)).sort((a, b) => byDate(b, a)).slice(0, 10);
  const next = d.matches.filter(m => m.status === 'scheduled' && m.date >= today).sort(byDate).slice(0, 10);
  const top = d.table[0], last = fin[0];
  const title = `${cfg.short} Table ${d.label} — Standings, Results & Fixtures | ${NAME}`;
  const desc = `${cfg.short} ${d.label} table after ${d.played} of ${d.total} matches: ${top.team} lead with ${top.Pts} points (P${top.P} W${top.W} D${top.D} L${top.L}). Latest results, next fixtures and club pages. Updated ${fmtDate(today)}.`;
  const body = `<h1>${esc(cfg.short)} table ${esc(d.label)}</h1>
<p class="dim">${d.played} of ${d.total} matches played${last ? ' · latest result ' + esc(fmtDate(last.date)) : ''} · checked ${esc(fmtDate(today))}</p>
<p><b>${esc(top.team)}</b> are top of the ${esc(cfg.short)} with ${top.Pts} points from ${top.P} matches${d.table[1] ? `, ${top.Pts - d.table[1].Pts === 0 ? 'level on points with' : top.Pts - d.table[1].Pts + ' ahead of'} ${esc(d.table[1].team)}` : ''}.</p>
${tableHtml(d.table, linkable)}
<p class="dim">P played · W won · D drawn · L lost · GF goals for · GA goals against · GD goal difference · Pts points. ${d.tieUndecided ? 'Clubs level on every measure are shown in a fixed order until a result separates them.' : ''}</p>
<h2>Latest results</h2><ul class="list">${fin.map(matchLi).join('') || '<li class="dim">No finished matches stored yet.</li>'}</ul>
<h2>Next fixtures</h2><ul class="list">${next.map(matchLi).join('') || '<li class="dim">No upcoming fixtures stored.</li>'}</ul>
<a class="cta" href="/"><b>Ask ${NAME} about the ${esc(cfg.short)}</b><br><span class="dim">Match analysis, player scouting and scripts, using these checked numbers. Free.</span></a>
<h2>Other competitions</h2><ul class="chips">${DOMESTIC_KEYS.filter(k => k !== key).map(k => `<li><a href="/football/${leagueSlug(k)}">${esc(LEAGUES[k].short)} table</a></li>`).join('')}</ul>`;
  return { title, desc, body, crumbs: [[NAME, '/'], ['Football tables & results', '/football'], [cfg.short + ' table', '/football/' + leagueSlug(key)]] };
}

async function findClub(slug, today, store, cache) {
  for (const key of DOMESTIC_KEYS) {
    const d = await leagueData(key, today, store, cache);
    const row = d.table.find(r => slugify(r.team) === slug);
    if (row) return { key, d, row };
  }
  return null;
}

async function clubPage(slug, today, store, cache) {
  const f = await findClub(slug, today, store, cache);
  if (!f) return null;
  const { key, d, row } = f, club = row.team, cfg = d.cfg;
  const mine = d.matches.filter(m => m.home === club || m.away === club);
  const fin = mine.filter(m => m.status === 'finished' && Number.isInteger(m.hg)).sort((a, b) => byDate(b, a)).slice(0, 8);
  const next = mine.filter(m => m.status === 'scheduled' && m.date >= today).sort(byDate).slice(0, 6);
  const [coachRows, playerRows] = await Promise.all([store.listCoaches({ league: key }).catch(() => []), store.listPlayers({ league: key, club }).catch(() => [])]);
  const coach = coachRows.filter(c => c.club === club).sort((a, b) => Number(b.season) - Number(a.season))[0] || null;
  const season = Math.max(0, ...playerRows.map(p => Number(p.season) || 0));
  const squad = playerRows.filter(p => Number(p.season) === season && p.club_status !== 'retired' && p.name);
  const POS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
  const sq = POS.map(pos => [pos, squad.filter(p => (p.position || '') === pos).sort((a, b) => (Number(a.shirt) || 99) - (Number(b.shirt) || 99))]).filter(x => x[1].length);
  const title = `${club} ${coach ? 'Head Coach, ' : ''}Results, Fixtures & Squad ${d.label} | ${NAME}`;
  const desc = `${club}: ${nth(row.rank)} in the ${cfg.short} (${row.Pts} points from ${row.P} matches)${coach ? `, head coach ${coach.name}` : ''}. Latest results, next fixtures${squad.length ? ' and squad' : ''}. Updated ${fmtDate(today)}.`;
  const body = `<h1>${esc(club)} — ${esc(d.label)}</h1>
<p><b>${esc(club)}</b> are ${nth(row.rank)} of ${d.table.length} in the <a href="/football/${leagueSlug(key)}">${esc(cfg.short)} table</a> with ${row.Pts} points from ${row.P} matches (${row.W} won, ${row.D} drawn, ${row.L} lost, goals ${row.GF}–${row.GA}).</p>
${coach ? `<p><b>Head coach:</b> ${esc(coach.name)}${coach.nationality ? ' (' + esc(coach.nationality) + ')' : ''}. <span class="dim">From our data bank, as of ${esc(fmtDate(String(coach.as_of || '').slice(0, 10) || today))}.</span></p>` : ''}
<h2>Latest ${esc(club)} results</h2><ul class="list">${fin.map(matchLi).join('') || '<li class="dim">No finished league matches stored yet.</li>'}</ul>
<h2>${esc(club)} next fixtures</h2><ul class="list">${next.map(matchLi).join('') || '<li class="dim">No upcoming league fixtures stored.</li>'}</ul>
<p class="dim">League matches only on this page. Cup and European matches are covered in the app.</p>
${sq.length ? `<h2>${esc(club)} squad</h2>${sq.map(([pos, ps]) => `<p><b>${pos}s:</b> ${ps.map(p => esc(p.name) + (p.shirt ? ' #' + esc(p.shirt) : '')).join(', ')}</p>`).join('')}<p class="dim">Registered squad as stored for ${season}/${String(season + 1).slice(-2)}.</p>` : ''}
<a class="cta" href="/"><b>Ask ${NAME} about ${esc(club)}</b><br><span class="dim">Match analysis, scouting and scripts with checked data. Free.</span></a>
<h2>${esc(cfg.short)}</h2><ul class="chips"><li><a href="/football/${leagueSlug(key)}">${esc(cfg.short)} table</a></li></ul>`;
  return { title, desc, body, crumbs: [[NAME, '/'], ['Football tables & results', '/football'], [cfg.short + ' table', '/football/' + leagueSlug(key)], [club, '/football/' + slug]] };
}

async function indexPage(today, store, cache) {
  const parts = [];
  for (const key of DOMESTIC_KEYS) {
    const d = await leagueData(key, today, store, cache); if (!d.table.length) continue;
    parts.push(`<h2><a href="/football/${leagueSlug(key)}">${esc(d.cfg.short)} table ${esc(d.label)}</a></h2><ul class="chips">${d.table.map(r => `<li><a href="/football/${slugify(r.team)}">${esc(r.team)}</a></li>`).join('')}</ul>`);
  }
  if (!parts.length) return null;
  return { title: `Football Tables, Results & Fixtures — Premier League, La Liga, Serie A, Bundesliga | ${NAME}`, desc: `League tables, latest results, fixtures, head coaches and squads for the Premier League, La Liga, Serie A, Bundesliga, Ligue 1 and Saudi Pro League. Checked data, updated daily.`, body: `<h1>Football tables, results &amp; fixtures</h1><p class="dim">Updated ${esc(fmtDate(today))}. Pick a league or a club.</p>${parts.join('')}<a class="cta" href="/"><b>Ask ${NAME}</b><br><span class="dim">Free football AI: match analysis, scouting and scripts.</span></a>`, crumbs: [[NAME, '/'], ['Football tables & results', '/football']] };
}

/** { status, html } for /football[/slug] */
export async function renderPage(slug, today, store, cache = {}) {
  slug = String(slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
  const key = leagueOfSlug(slug);
  const page = !slug ? await indexPage(today, store, cache) : key ? await leaguePage(key, today, store, cache) : await clubPage(slug, today, store, cache);
  if (!page) return { status: 404, html: shell({ title: 'Page not found | ' + NAME, description: 'This page is not in our data bank.', path: '/football' + (slug ? '/' + slug : ''), noindex: true, body: '<h1>Not found</h1><p>We do not have this page. <a href="/football">Browse football tables and results</a>.</p>' }) };
  return { status: 200, html: shell({ title: page.title, description: page.desc, path: '/football' + (slug ? '/' + slug : ''), body: page.body, crumbs: page.crumbs }) };
}

/** sitemap.xml: home, the legal pages, the football index, every league page and every club page */
export async function renderSitemap(today, store, cache = {}) {
  const urls = [['/', '1.0'], ['/football', '0.9'], ['/privacy.html', '0.3'], ['/terms.html', '0.3']];
  for (const key of DOMESTIC_KEYS) {
    const d = await leagueData(key, today, store, cache); if (!d.table.length) continue;
    urls.push(['/football/' + leagueSlug(key), '0.9']);
    d.table.forEach(r => urls.push(['/football/' + slugify(r.team), '0.6']));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([p, pr]) => `  <url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod><priority>${pr}</priority></url>`).join('\n')}\n</urlset>\n`;
}
