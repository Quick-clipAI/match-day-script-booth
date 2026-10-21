// lib/bank-context.js
// Turns a chat question into a short block of verified facts from the data bank (or nothing).
// Deterministic: no AI is used to decide what to look up, so it costs no model quota.

import { LEAGUES, LEAGUE_KEYS, DOMESTIC_KEYS, norm, SEED_ALIASES, computeTable, coverageOf, fmtDate, seasonLabel, currentSeason } from './bank-core.js';

const lite = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SKIP_SINGLE = new Set(['nice', 'lens', 'real', 'city', 'united', 'town', 'club', 'sporting']);   // everyday words, not clubs on their own

const RX = {
  table: /\b(table|standings?|position|points|top (two|three|four|five|six|2|3|4|5|6)|relegat\w*|title race|league leaders?|leaders?|who is top|who s top|who s first|who is first|who is leading|who s leading|ranked)\b/,
  champion: /\b(champions?|title winners?|won the (league|title)|who won|winners?|lifted|crowned|trophy)\b/,
  fixtures: /\b(fixtures?|schedule|next (match|game|fixture|opponent)|plays? next|playing next|upcoming|coming up|when (do|does|will|is|are)|who (do|does|are|will) \w+ play)\b/,
  results: /\b(results?|scores?|score|beat|beaten|lost to|last (match|game|result)|latest (match|game|result)|recent|form|how did|won against|drew)\b/,
  h2h: /\b(head to head|h2h|vs|versus|against)\b/
};
const LAST_SEASON = /\b(last season|previous season|last year s season|last campaign|previous campaign)\b/;

/** Index of clubs and the spellings people use for them. Rebuilt by the caller at most once a minute. */
export function buildClubIndex(clubRows, aliasRows) {
  const byDisplay = new Map();                 // display -> { display, leagues:Set }
  clubRows.forEach(c => {
    if (!byDisplay.has(c.club)) byDisplay.set(c.club, { display: c.club, leagues: new Map() });
    const e = byDisplay.get(c.club);
    e.leagues.set(c.league, Math.max(e.leagues.get(c.league) || 0, c.last_season));
  });
  const phrases = new Map();                   // normalised phrase -> Set(display)
  const add = (p, d) => { if (!p || p.length < 3) return; if (!phrases.has(p)) phrases.set(p, new Set()); phrases.get(p).add(d); };
  for (const d of byDisplay.keys()) add(norm(d), d);
  (aliasRows || []).forEach(a => { if (byDisplay.has(a.canonical)) add(a.alias, a.canonical); });
  for (const [alias, targets] of Object.entries(SEED_ALIASES)) {
    for (const target of [].concat(targets || []).filter(Boolean)) {   // a seed may name one spelling or a list of them
      const tt = target.split(' ');
      for (const d of byDisplay.keys()) {
        const dt = norm(d).split(' ');
        if (tt.every(t => dt.includes(t))) add(alias, d);
      }
    }
  }
  return { byDisplay, phrases };
}

function findClubs(qn, index) {
  const found = [];
  for (const [phrase, set] of index.phrases) {
    if (!phrase.includes(' ') && SKIP_SINGLE.has(phrase)) continue;
    const needle = ' ' + phrase + ' ';
    let at = qn.indexOf(needle);
    while (at !== -1) { found.push({ phrase, start: at, end: at + needle.length, displays: [...set] }); at = qn.indexOf(needle, at + 1); }
  }
  found.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const taken = [], out = [];
  for (const f of found) {
    if (taken.some(t => f.start < t.end - 1 && f.end - 1 > t.start)) continue;
    taken.push(f);
    out.push(f);
  }
  out.sort((a, b) => a.start - b.start);
  const names = [];
  out.forEach(f => f.displays.forEach(d => { if (!names.includes(d)) names.push(d); }));
  return names;
}

function findLeagues(ql) {
  const out = [];
  for (const k of LEAGUE_KEYS) {
    if (LEAGUES[k].words.some(w => ql.includes(' ' + lite(w) + ' '))) out.push(k);
  }
  // "saudi pro league" also contains "pro league"; "premier league" alone must not pull in the Saudi league
  return out;
}

function seasonsAsked(raw, ql) {
  const out = { explicit: [], bare: [], last: LAST_SEASON.test(ql) };
  const re = /\b((?:19|20)\d{2})\s*[\/\-–]\s*(\d{4}|\d{2})\b/g; let m;
  const used = [];
  while ((m = re.exec(raw))) { out.explicit.push(Number(m[1])); used.push([m.index, re.lastIndex]); }
  const re2 = /\b((?:19|20)\d{2})\b/g;
  while ((m = re2.exec(raw))) { if (!used.some(u => m.index >= u[0] && m.index < u[1])) out.bare.push(Number(m[1])); }
  out.explicit = [...new Set(out.explicit)].slice(0, 2); out.bare = [...new Set(out.bare)].slice(0, 2);
  return out;
}

const pad = (s, n) => String(s).length >= n ? String(s) : String(s) + ' '.repeat(n - String(s).length);
function tableLines(t, cfg, limit) {
  return t.rows.slice(0, limit || 99).map(r => `${r.rank}. ${r.team} — P${r.P} W${r.W} D${r.D} L${r.L} GF${r.GF} GA${r.GA} GD${r.GD >= 0 ? '+' : ''}${r.GD} Pts${r.Pts}`);
}
const scoreStr = m => `${m.home} ${m.hg}-${m.ag} ${m.away}`;
const when = m => fmtDate(m.date) + (m.time ? ' ' + m.time : '');

/** Main entry. store needs: clubIndex(), listAliases(), listMatches(), listFacts(). */

// ---- coaches, squads and season form (added in v1.4.2) ----
const CLUB_STOP = new Set(['fc', 'cf', 'sc', 'ac', 'as', 'bc', 'afc', 'cd', 'ud', 'rc', 'rcd', 'sv', 'vfb', 'tsg', 'fsv', 'sk', 'ssc', 'us', 'acf', 'ogc', 'aj', 'losc', 'club', 'calcio', 'saudi']);
const clubKey = s => norm(s).split(' ').filter(t => t && !CLUB_STOP.has(t)).join(' ');
const sameClub = (a, b) => { const x = clubKey(a), y = clubKey(b); return !!x && x === y; };
const POS_ORDER = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
function squadLine(club, players) {
  const by = {}; players.forEach(p => { const k = POS_ORDER.includes(p.position) ? p.position : 'Other'; (by[k] = by[k] || []).push(p); });
  const fmt = p => p.name + (p.shirt != null ? ' #' + p.shirt : '') + (p.on_loan ? ' (on loan' + (p.loan_from ? ' from ' + p.loan_from : '') + ')' : '');
  return [...POS_ORDER, 'Other'].filter(k => by[k]).map(k => `${k}s: ` + by[k].sort((a, b) => (a.shirt == null ? 999 : a.shirt) - (b.shirt == null ? 999 : b.shirt)).slice(0, 14).map(fmt).join(', ')).join('\n');
}
function resultFor(m, club) {      // 'W' | 'D' | 'L' | null for a finished match involving the club
  if (m.hg == null || m.ag == null) return null;
  const home = norm(m.home) === norm(club); const d = home ? m.hg - m.ag : m.ag - m.hg;
  return d > 0 ? 'W' : d < 0 ? 'L' : 'D';
}

export async function planContext(question, todayISO, store, opts = {}) {
  const raw = String(question || '').slice(0, 600);
  if (raw.trim().length < 3) return { text: '', labels: [], clubs: [], used: [] };
  const ql = ' ' + lite(raw) + ' ';
  const qn = ' ' + norm(raw) + ' ';

  let index = opts.cache && opts.cache.index && Date.now() - opts.cache.at < 60000 ? opts.cache.index : null;
  if (!index) {
    const [clubRows, aliasRows] = await Promise.all([store.clubIndex(), store.listAliases()]);
    index = buildClubIndex(clubRows, aliasRows);
    if (opts.cache) { opts.cache.index = index; opts.cache.at = Date.now(); }
  }

  const leaguesNamed = findLeagues(ql);
  const clubNames = findClubs(qn, index).slice(0, 3);
  const factsAll = await store.listFacts().catch(() => []);
  const facts = factsAll.filter(f => (f.tags || []).some(t => t && ql.includes(' ' + lite(t) + ' '))).slice(0, 4);

  if (!leaguesNamed.length && !clubNames.length && !facts.length) return { text: '', labels: [], clubs: [], used: [] };

  // ---- what kind of question
  const want = {
    table: RX.table.test(ql), champion: RX.champion.test(ql), fixtures: RX.fixtures.test(ql),
    results: RX.results.test(ql), h2h: RX.h2h.test(ql) && clubNames.length >= 2
  };
  const anyIntent = want.table || want.champion || want.fixtures || want.results || want.h2h;
  if (!anyIntent) { if (clubNames.length) want.snapshot = true; else if (leaguesNamed.length) want.table = true; }

  // ---- which leagues
  const clubLeagues = new Set();
  clubNames.forEach(c => { const e = index.byDisplay.get(c); if (e) e.leagues.forEach((_, lg) => clubLeagues.add(lg)); });
  let leagues = leaguesNamed.length ? [...leaguesNamed] : [...clubLeagues];
  if (leaguesNamed.length && clubLeagues.size && (want.snapshot || want.results || want.fixtures || want.h2h)) clubLeagues.forEach(l => { if (!leagues.includes(l)) leagues.push(l); });
  // a club question without a named competition: its domestic league first, European/other competitions for results & fixtures
  if (!leaguesNamed.length && clubNames.length && !(want.results || want.fixtures || want.snapshot || want.h2h)) leagues = leagues.filter(l => LEAGUES[l].type === 'league');
  leagues = leagues.slice(0, 4);

  const blocks = [], labels = [], used = [];
  const coaches = [], coachMissing = [], coachCache = new Map(), squadCache = new Map();
  const cacheM = new Map();
  const load = async (lg, season) => { const k = lg + '|' + season; if (!cacheM.has(k)) cacheM.set(k, await store.listMatches({ league: lg, season })); return cacheM.get(k); };
  const stored = await store.summary(todayISO).catch(() => []);
  const seasonsStored = lg => stored.filter(s => s.league === lg).map(s => s.season).sort((a, b) => b - a);

  for (const lg of leagues) {
    const cfg = LEAGUES[lg];
    const have = seasonsStored(lg);
    const cur = currentSeason(cfg, todayISO);
    const sa = seasonsAsked(raw, ql);
    let seasons = [], note = '';
    if (sa.explicit.length) seasons = sa.explicit;
    else if (sa.last) seasons = [cur - 1];
    else if (sa.bare.length && (want.champion || want.table)) {
      const y = sa.bare[0]; seasons = [y - 1, y].filter(s => s <= cur);
      note = `You wrote ${y}: that can mean the season that ended in ${y} (${seasonLabel(cfg, y - 1)}) or the one that started in it (${seasonLabel(cfg, y)}).`;
    } else seasons = [cur];
    seasons = [...new Set(seasons)].slice(0, 2);

    for (let si = 0; si < seasons.length; si++) {
      const season = seasons[si];
      const label = `${cfg.short} ${seasonLabel(cfg, season)}`;
      if (!have.includes(season)) { blocks.push(`NOT IN DATA BANK: ${label} is not stored. Do not guess it from memory; use web search or say you cannot confirm it.`); used.push(label + ' (missing)'); continue; }
      const ms = await load(lg, season);
      const cov = coverageOf(ms, cfg, todayISO);
      const covLine = cfg.teams
        ? (cov.complete ? `${label}: COMPLETE, all ${cov.expected} matches stored, last result ${fmtDate(cov.lastResult)}.`
          : `${label}: ${cov.finished} of ${cov.expected} matches have a stored result (last result ${cov.lastResult ? fmtDate(cov.lastResult) : 'none yet'}).`
            + (cov.gaps ? ` ${cov.gaps} matches that should already have been played have NO result stored yet (for example ${cov.gapList.slice(0, 2).map(m => `${m.home} v ${m.away} on ${fmtDate(m.date)}`).join('; ')}), so anything below is out of date by those matches.` : ''))
        : `${label}: ${cov.finished} results and ${cov.total - cov.finished} upcoming/other matches stored, last result ${cov.lastResult ? fmtDate(cov.lastResult) : 'none yet'}.` + (cov.gaps ? ` ${cov.gaps} matches already due have no stored result.` : '');
      const parts = [];
      if (note && si === 0) parts.push(note);
      parts.push(covLine);

      if (cfg.type === 'league') {
        const t = computeTable(ms, cfg);
        const fullTable = (want.table || want.snapshot === undefined && false) && si === 0;
        if (want.table && si === 0) {
          parts.push(`Table${cov.complete ? ' (final)' : ` (after ${t.playedMatches} of ${t.expected} matches)`}, computed from the stored results — order: points, then ${cfg.tiebreak === 'h2h' ? 'results between the level clubs, then goal difference, goals scored' : 'goal difference, then goals scored'}${cfg.tiebreakSure ? '' : ' (tie-break order not verified against the official rule)'}:`);
          parts.push(...tableLines(t, cfg));
          labels.push(`${label} table`); used.push(`${label} table`);
        }
        if (want.champion) {
          if (cov.complete) {
            const top = t.rows[0], bottom = t.rows.slice(-3).map(r => `${r.team} (${r.Pts})`).join(', ');
            parts.push(`${label} champions: ${top.team} with ${top.Pts} points. Runners-up: ${t.rows[1].team} (${t.rows[1].Pts}); third: ${t.rows[2].team} (${t.rows[2].Pts}). Bottom three: ${bottom}.${t.tieUndecided ? ' Note: two clubs are level on every tie-break we store; check the order with a search.' : ''}`);
          } else {
            const top = t.rows[0];
            parts.push(`${label} is NOT finished: ${top.team} lead with ${top.Pts} points after ${top.P} matches (${t.playedMatches} of ${t.expected} matches stored). There is no champion yet.`);
          }
          labels.push(`${label} champions`); used.push(`${label} champions`);
        }
        if (want.table || want.champion) { /* club lines below add the club's own row when a club was named */ }
      } else if (want.champion) {
        const fin = ms.filter(m => /\bfinal\b/i.test(m.round || '') && !/semi|quarter|1\/|round of|qualif/i.test(m.round || ''));
        if (fin.length) { parts.push(`${label} final: ${fin.map(m => `${scoreStr(m)}${m.status === 'finished' ? '' : ' (not played yet)'}${m.note ? ' (' + m.note + ')' : ''} on ${fmtDate(m.date)}`).join('; ')}`); labels.push(`${label} final`); used.push(`${label} final`); }
        else parts.push(`No final is stored for ${label}.`);
      }

      if (si === 0 && !want.table && !want.champion && !clubNames.length && (want.fixtures || want.results)) {
        const fin = ms.filter(m => m.status === 'finished').sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
        const up = ms.filter(m => m.status === 'scheduled' && m.date >= todayISO).slice(0, 8);
        if (want.results && fin.length) { parts.push('Latest stored results: ' + fin.map(m => `${fmtDate(m.date)} ${scoreStr(m)}`).join('; ')); labels.push(`${label} results`); used.push(`${label} results`); }
        if (want.fixtures && up.length) { parts.push('Next fixtures: ' + up.map(m => `${when(m)} ${m.home} v ${m.away}`).join('; ')); labels.push(`${label} fixtures`); used.push(`${label} fixtures`); }
      }
      blocks.push(parts.join('\n'));
    }
  }

  // ---- club views (all leagues the club appears in, for the season in play)
  for (const club of clubNames) {
    const e = index.byDisplay.get(club); if (!e) continue;
    const lgs = [...e.leagues.keys()].filter(l => leagues.includes(l) || LEAGUES[l].type === 'league' || want.results || want.fixtures || want.snapshot);
    const sa = seasonsAsked(raw, ql);
    const lines = [];
    let all = [];
    for (const lg of lgs) {
      const cfg = LEAGUES[lg]; const cur = currentSeason(cfg, todayISO);
      const season = sa.explicit.length ? sa.explicit[0] : (sa.last ? cur - 1 : cur);
      const have = seasonsStored(lg);
      if (!have.includes(season)) { if (sa.explicit.length || sa.last) lines.push(`${cfg.short} ${seasonLabel(cfg, season)} is not stored in the data bank.`); continue; }
      const ms = (await load(lg, season)).filter(m => norm(m.home) === norm(club) || norm(m.away) === norm(club));
      all.push(...ms.map(m => ({ ...m, _cfg: cfg })));
      if (cfg.type === 'league' && (want.snapshot || want.table || want.results)) {
        const t = computeTable(await load(lg, season), cfg);
        const row = t.rows.find(r => norm(r.team) === norm(club));
        if (row) lines.push(`${club} in the ${cfg.short} ${seasonLabel(cfg, season)} table: ${row.rank}${['th', 'st', 'nd', 'rd'][(row.rank % 100 > 10 && row.rank % 100 < 14) ? 0 : Math.min(row.rank % 10, 4) % 4] || 'th'} of ${t.teamCount} — P${row.P} W${row.W} D${row.D} L${row.L} GF${row.GF} GA${row.GA} Pts${row.Pts}${t.complete ? ' (final)' : ` (after ${t.playedMatches} of ${t.expected} matches in the league)`}.`);
      }
    }
    const fin = all.filter(m => m.status === 'finished').sort((a, b) => (a.date < b.date ? 1 : -1));
    const up = all.filter(m => m.status === 'scheduled' && m.date >= todayISO).sort((a, b) => (a.date < b.date ? -1 : 1));
    const pending = all.filter(m => m.status === 'scheduled' && m.date < todayISO).sort((a, b) => (a.date < b.date ? -1 : 1));
    if ((want.results || want.snapshot) && fin.length) lines.push(`${club} latest results (newest first): ` + fin.slice(0, 5).map(m => `${fmtDate(m.date)} ${scoreStr(m)} (${m._cfg.short})`).join('; '));
    if ((want.fixtures || want.snapshot) && up.length) lines.push(`${club} next fixtures: ` + up.slice(0, 4).map(m => `${when(m)} ${m.home} v ${m.away} (${m._cfg.short})`).join('; '));
    if (pending.length && (want.results || want.snapshot || want.fixtures || want.table)) lines.push(`Result NOT stored yet for: ` + pending.slice(0, 4).map(m => `${m.home} v ${m.away} (${fmtDate(m.date)})`).join('; ') + '. Do not guess these scores; say they are not in the data bank and check with search.');
    if (want.h2h && clubNames.length >= 2 && club === clubNames[0]) {
      const other = clubNames[1]; const h = [];
      for (const lg of [...e.leagues.keys()]) {
        for (const season of seasonsStored(lg).slice(0, 12)) {
          (await load(lg, season)).forEach(m => { if (m.status === 'finished' && ((norm(m.home) === norm(club) && norm(m.away) === norm(other)) || (norm(m.home) === norm(other) && norm(m.away) === norm(club)))) h.push({ ...m, _cfg: LEAGUES[lg] }); });
        }
      }
      h.sort((a, b) => (a.date < b.date ? 1 : -1));
      if (h.length) {
        let w1 = 0, w2 = 0, d = 0; h.forEach(m => { const cw = (norm(m.home) === norm(club) ? m.hg - m.ag : m.ag - m.hg); if (cw > 0) w1++; else if (cw < 0) w2++; else d++; });
        lines.push(`${club} v ${other} in the stored seasons (${h.length} matches): ${club} ${w1} wins, ${other} ${w2} wins, ${d} draws. Most recent: ` + h.slice(0, 5).map(m => `${fmtDate(m.date)} ${scoreStr(m)} (${m._cfg.short})`).join('; '));
      } else lines.push(`No ${club} v ${other} match is stored.`);
    }
    // ---- current run and season record (from the stored results, all stored competitions together)
    if (fin.length && (want.snapshot || want.results || want.h2h)) {
      const rs = fin.map(m => resultFor(m, club)).filter(Boolean);
      if (rs.length) {
        let w = 0; while (w < rs.length && rs[w] === 'W') w++;
        let u = 0; while (u < rs.length && rs[u] !== 'L') u++;
        const rec = { W: 0, D: 0, L: 0 }; rs.forEach(r => rec[r]++);
        lines.push(`${club} form in the stored matches this season (all competitions): ${rec.W} wins, ${rec.D} draws, ${rec.L} defeats from ${rs.length} matches. Current run: ${w >= 2 ? 'won the last ' + w + ' in a row' : u >= 3 ? 'unbeaten in the last ' + u : 'no winning or unbeaten run of note'}. Only matches stored in the bank are counted.`);
      }
    }
    // ---- league titles in the stored seasons (e.g. back-to-back champions)
    if (want.snapshot || want.h2h || want.champion) {
      for (const lg of lgs) {
        const cfg = LEAGUES[lg]; if (cfg.type !== 'league' || !cfg.teams) continue;
        const cur = currentSeason(cfg, todayISO); const won = [], finishes = [];
        for (const season of seasonsStored(lg).filter(x => x < cur).slice(0, 4)) {
          const msx = await load(lg, season); if (!coverageOf(msx, cfg, todayISO).complete) continue;
          const t = computeTable(msx, cfg); const row = t.rows.find(r => norm(r.team) === norm(club)); if (!row) continue;
          finishes.push(`${seasonLabel(cfg, season)}: ${row.rank}`); if (row.rank === 1) won.push(seasonLabel(cfg, season));
        }
        if (finishes.length) lines.push(`${club} ${cfg.short} finishes in completed stored seasons (newest first): ${finishes.join(', ')}.${won.length ? ` Champions in: ${won.join(', ')}.` : ' Not champions in those seasons.'}`);
      }
    }
    // ---- head coach and squad from the data bank
    {
      const lgKeys = [...e.leagues.keys()]; let coach = null, squad = [], squadSeason = null;
      for (const lg of lgKeys) {
        if (!coachCache.has(lg)) coachCache.set(lg, await store.listCoaches({ league: lg }).catch(() => []));
        const c = coachCache.get(lg).filter(x => sameClub(x.club, club)).sort((a, b) => b.season - a.season)[0];
        if (c && (!coach || c.season > coach.season)) coach = c;
        if (!squadCache.has(lg)) squadCache.set(lg, await store.listPlayers({ league: lg }).catch(() => []));
        const ps = squadCache.get(lg).filter(x => sameClub(x.club, club));
        if (ps.length) { const top = Math.max(...ps.map(x => x.season)); const cand = ps.filter(x => x.season === top && x.club_status !== 'retired'); if (!squadSeason || top > squadSeason) { squad = cand; squadSeason = top; } }
      }
      if (coach) { coaches.push({ club, name: coach.name }); lines.push(`${club} head coach (data bank, as of ${coach.as_of || 'date not given'}): ${coach.name}${coach.nationality ? ' (' + coach.nationality + ')' : ''}. Do not name any other head coach for ${club}.`); labels.push(`${club} head coach`); }
      else { coachMissing.push(club); lines.push(`${club} head coach: NOT IN THE DATA BANK. Do not name a head coach from memory (it may be out of date); check by web search or leave the coach out.`); }
      if (squad.length && (want.snapshot || want.h2h)) {
        lines.push(`${club} registered squad (data bank, season ${squadSeason}/${String(squadSeason + 1).slice(-2)}, ${squad.length} player(s) listed; a list of registered players, not a team sheet, and injuries/transfers after the date are not reflected):\n` + squadLine(club, squad));
        labels.push(`${club} squad`);
      }
    }
    if (lines.length) { blocks.push(lines.join('\n')); labels.push(`${club} fixtures & results`); used.push(`${club} view`); }
  }

  if (facts.length) {
    blocks.push(facts.map(f => `FACT: ${f.title} — ${f.body}${f.as_of ? ` (as of ${f.as_of}${f.source ? ', ' + f.source : ''})` : ''}`).join('\n'));
    labels.push('Checked facts'); used.push('facts');
  }

  if (!blocks.length) return { text: '', labels: [], clubs: clubNames, used: [], coaches, coachMissing };
  let body = blocks.join('\n\n');
  if (body.length > 9000) body = body.slice(0, 9000).replace(/\n[^\n]*$/, '') + '\n(…shortened)';
  const text = `=== VERIFIED DATA BANK (our own stored football results, checked ${todayISO}) ===\n${body}\n` +
    `How to use this block: treat these numbers as ground truth for exactly what each part covers. Every part says how complete it is. ` +
    `Where it says results are missing, or a season is not finished or not stored, say that plainly and use web search for the rest; never present an incomplete table as the final or current one. ` +
    `Kick-off times, where shown, are the listed local times. Head coach, squad and form lines come from our own stored data and override your memory. This data has no goal scorers, transfers or news.\n=== END DATA BANK ===`;
  return { text, labels: [...new Set(labels)], clubs: clubNames, used, coaches, coachMissing };
}
