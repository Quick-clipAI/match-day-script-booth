// Career profiles: one record per PERSON (not per squad/season). Every section is optional.
// Pure functions only (no network), so they can be tested without a database.
import { isIsoDate } from './bank-core.js';

export const KNOWN_STATS = [
  'appearances', 'starts', 'minutes', 'goals', 'assists', 'penalties_scored', 'penalties_taken',
  'shots', 'shots_on_target', 'key_passes', 'big_chances_created',
  'dribbles_attempted', 'dribbles_successful',
  'passes_attempted', 'passes_completed', 'crosses_attempted', 'crosses_completed',
  'touches', 'touches_in_opposition_box', 'tackles', 'interceptions', 'clearances',
  'yellow_cards', 'red_cards', 'clean_sheets', 'goals_conceded', 'saves', 'trophies',
];
const KNOWN = new Set(KNOWN_STATS);
// [bigger, smaller]: the second can never exceed the first.
const PAIRS = [['appearances', 'starts'], ['shots', 'shots_on_target'], ['dribbles_attempted', 'dribbles_successful'],
  ['passes_attempted', 'passes_completed'], ['crosses_attempted', 'crosses_completed'], ['penalties_taken', 'penalties_scored']];

export const LEVELS = ['senior', 'Olympic', 'U23', 'U21', 'U20', 'U19', 'U18', 'U17', 'U16'];
export const TSTATUS = ['registered', 'withdrew_injured'];
const TNAMES = ['FIFA World Cup', 'UEFA European Championship', 'Copa América', 'Africa Cup of Nations', 'AFC Asian Cup', 'CONCACAF Gold Cup', 'Olympic Games'];
const TALIAS = { 'world cup': 'FIFA World Cup', 'euros': 'UEFA European Championship', 'euro': 'UEFA European Championship', 'european championship': 'UEFA European Championship', 'copa america': 'Copa América', 'afcon': 'Africa Cup of Nations', 'asian cup': 'AFC Asian Cup', 'gold cup': 'CONCACAF Gold Cup', 'olympics': 'Olympic Games' };
const _pn0 = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const TOURNAMENTS = Object.fromEntries([...TNAMES.map(n => [_pn0(n), n]), ...Object.entries(TALIAS)]);
export const personNorm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const careerId = (name, dob) => personNorm(name) + '|' + (dob || '');
const isLooseDate = s => typeof s === 'string' && (/^\d{4}$/.test(s) || /^\d{4}-(0[1-9]|1[0-2])$/.test(s) || isIsoDate(s));
const txt = (v, n) => { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, n) : null; };
const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Read a stats object. Returns { stats, problems, warnings }. Numbers only; blanks/null are skipped. */
function readStats(src, label, problems, warnings) {
  const stats = {};
  for (const [k, v] of Object.entries(src || {})) {
    if (v == null || v === '') continue;
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(k)) { problems.push(`${label}: "${k}" is not a valid stat name (use lowercase letters, digits and _).`); continue; }
    const n = typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v;
    if (!isNum(n) || n < 0) { problems.push(`${label}: ${k} must be a number of 0 or more (got ${JSON.stringify(v)}).`); continue; }
    if (!KNOWN.has(k)) warnings.push(`${label}: "${k}" is not a standard stat name. It is kept exactly as typed; check for a typo.`);
    stats[k] = n;
  }
  for (const [big, small] of PAIRS) if (stats[big] != null && stats[small] != null && stats[small] > stats[big]) problems.push(`${label}: ${small} (${stats[small]}) is larger than ${big} (${stats[big]}).`);
  return stats;
}

/** Validate one incoming profile. Returns { profile, problems, warnings } (profile is null when there are problems). */
export function normalizeProfile(raw, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const problems = [], warnings = [];
  const x = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const name = txt(x.name, 120);
  if (!name) return { profile: null, problems: ['missing name.'], warnings };
  const L = name;
  let dob = null;
  if (x.dob) { dob = String(x.dob).slice(0, 10); if (!isIsoDate(dob)) { problems.push(`${L}: dob must be YYYY-MM-DD.`); dob = null; } }
  else warnings.push(`${L}: no dob, so players with the same name cannot be told apart. Add dob when you can.`);
  const nationality = txt(x.nationality, 80);
  const source = txt(x.source, 300);
  const futureLimit = new Date(Date.parse(today + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);

  const p = { name, dob, nationality, other_nationalities: [], source, as_of: null, totals: {}, by_club: [], seasons: [], international: [], tournaments: [], awards: [], market_values: [], transfers: [] };
  if (x.other_nationalities != null) { if (!Array.isArray(x.other_nationalities)) problems.push(`${L}: other_nationalities must be a list like ["Nigeria"].`); else p.other_nationalities = [...new Set(x.other_nationalities.map(n => txt(n, 80)).filter(Boolean))]; }

  const anyStats = arr => Array.isArray(arr) && arr.some(e => e && typeof e === 'object' && Object.entries(e).some(([k, v]) => !['club', 'nation', 'level', 'from', 'to', 'season', 'competition', 'note', 'stats'].includes(k) && v != null && v !== '') || (e && e.stats && Object.keys(e.stats).length));
  const hasStats = (x.totals && Object.keys(x.totals).length) || (Array.isArray(x.seasons) && x.seasons.length) || anyStats(x.by_club) || anyStats(x.international);
  if (x.as_of != null && x.as_of !== '') { if (!isIsoDate(String(x.as_of))) problems.push(`${L}: as_of must be YYYY-MM-DD.`); else if (String(x.as_of) > futureLimit) problems.push(`${L}: as_of ${x.as_of} is in the future.`); else p.as_of = String(x.as_of); }
  else if (hasStats) problems.push(`${L}: as_of is required when totals or seasons are given. It is the date the figures are correct up to.`);

  if (x.totals != null) { if (typeof x.totals !== 'object' || Array.isArray(x.totals)) problems.push(`${L}: totals must be an object like {"goals": 10}.`); else p.totals = readStats(x.totals, `${L} totals`, problems, warnings); }

  if (x.seasons != null) {
    if (!Array.isArray(x.seasons)) problems.push(`${L}: seasons must be a list.`);
    else {
      const seen = new Set();
      x.seasons.forEach((s, i) => {
        const lab = `${L} season ${i + 1}`;
        if (!s || typeof s !== 'object') { problems.push(`${lab}: must be an object.`); return; }
        const season = Number(s.season);
        if (!Number.isInteger(season) || season < 1930 || season > 2200) { problems.push(`${lab}: season must be the starting year, e.g. 2024 for 2024/25.`); return; }
        const club = txt(s.club, 120); if (!club) { problems.push(`${lab} (${season}): missing club.`); return; }
        const competition = txt(s.competition, 60);
        const flat = {}; for (const [k, v] of Object.entries(s)) if (!['season', 'club', 'competition', 'stats', 'note'].includes(k)) flat[k] = v;
        const stats = readStats({ ...flat, ...(s.stats && typeof s.stats === 'object' ? s.stats : {}) }, `${L} ${season}/${String(season + 1).slice(-2)} ${club}`, problems, warnings);
        const key = `${season}|${personNorm(club)}|${personNorm(competition)}`;
        if (seen.has(key)) { problems.push(`${lab}: ${season}/${String(season + 1).slice(-2)} ${club}${competition ? ' ' + competition : ''} is listed twice. Combine them, or give each a competition.`); return; }
        seen.add(key);
        p.seasons.push({ season, club, competition, stats });
      });
      for (const s2 of p.seasons) if (personNorm(s2.competition) === 'all competitions' && p.seasons.some(o => o !== s2 && o.season === s2.season && personNorm(o.club) === personNorm(s2.club) && personNorm(o.competition) !== 'all competitions')) { problems.push(`${L}: ${s2.season}/${String(s2.season + 1).slice(-2)} ${s2.club} has an "All competitions" row and competition rows. Use one or the other so nothing is counted twice.`); break; }
      // A career total can never be smaller than the seasons you listed (the list may be partial, the total may not).
      for (const k of Object.keys(p.totals)) {
        const sum = p.seasons.reduce((a, s) => a + (s.stats[k] || 0), 0);
        if (sum > p.totals[k]) problems.push(`${L}: seasons add up to ${sum} ${k}, which is more than the career total ${p.totals[k]}.`);
      }
    }
  }

  // ---- by_club: one entry per spell at a club (club-only stats for that spell)
  if (x.by_club != null) {
    if (!Array.isArray(x.by_club)) problems.push(`${L}: by_club must be a list.`);
    else {
      x.by_club.forEach((c, i) => {
        const lab = `${L} club spell ${i + 1}`;
        if (!c || typeof c !== 'object') { problems.push(`${lab}: must be an object.`); return; }
        const club = txt(c.club, 120); if (!club) { problems.push(`${lab}: missing club.`); return; }
        const from = c.from == null || c.from === '' ? null : String(c.from), to = c.to == null || c.to === '' ? null : String(c.to);
        if (from && !isLooseDate(from)) { problems.push(`${lab} (${club}): from must be YYYY-MM-DD, YYYY-MM or YYYY.`); return; }
        if (to && !isLooseDate(to)) { problems.push(`${lab} (${club}): to must be YYYY-MM-DD, YYYY-MM or YYYY, or left out if he is still there.`); return; }
        if (from && to && from > to) { problems.push(`${lab} (${club}): from ${from} is after to ${to}.`); return; }
        const flat = {}; for (const [k, v] of Object.entries(c)) if (!['club', 'from', 'to', 'stats', 'note'].includes(k)) flat[k] = v;
        const stats = readStats({ ...flat, ...(c.stats && typeof c.stats === 'object' ? c.stats : {}) }, `${L} ${club}${from ? ' ' + from : ''}`, problems, warnings);
        p.by_club.push({ club, from, to, stats });
      });
      for (const k of Object.keys(p.totals)) {
        const sum = p.by_club.reduce((a, c) => a + (c.stats[k] || 0), 0);
        if (sum > p.totals[k]) problems.push(`${L}: clubs add up to ${sum} ${k}, which is more than the club career total ${p.totals[k]}.`);
      }
    }
  }

  // ---- international: one entry per nation per level (club stats stay out of here)
  if (x.international != null) {
    if (!Array.isArray(x.international)) problems.push(`${L}: international must be a list.`);
    else {
      const seen = new Set();
      x.international.forEach((n, i) => {
        const lab = `${L} national team ${i + 1}`;
        if (!n || typeof n !== 'object') { problems.push(`${lab}: must be an object.`); return; }
        const nation = txt(n.nation, 80); if (!nation) { problems.push(`${lab}: missing nation.`); return; }
        const level = txt(n.level, 12) || 'senior';
        if (!LEVELS.includes(level)) { problems.push(`${lab} (${nation}): level must be one of ${LEVELS.join(', ')}.`); return; }
        const from = n.from == null || n.from === '' ? null : String(n.from), to = n.to == null || n.to === '' ? null : String(n.to);
        if ((from && !isLooseDate(from)) || (to && !isLooseDate(to))) { problems.push(`${lab} (${nation}): from/to must be YYYY-MM-DD, YYYY-MM or YYYY.`); return; }
        const flat = {}; for (const [k, v] of Object.entries(n)) if (!['nation', 'level', 'from', 'to', 'stats', 'note'].includes(k)) flat[k] = v;
        const stats = readStats({ ...flat, ...(n.stats && typeof n.stats === 'object' ? n.stats : {}) }, `${L} ${nation} ${level}`, problems, warnings);
        const key = personNorm(nation) + '|' + level;
        if (seen.has(key)) { problems.push(`${lab}: ${nation} ${level} is listed twice. Combine them.`); return; }
        seen.add(key);
        p.international.push({ nation, level, from, to, stats });
      });
    }
  }

  // ---- tournaments: ONLY tournaments where he was registered in the final squad
  if (x.tournaments != null) {
    if (!Array.isArray(x.tournaments)) problems.push(`${L}: tournaments must be a list.`);
    else {
      const seen = new Set();
      x.tournaments.forEach((t, i) => {
        const lab = `${L} tournament ${i + 1}`;
        if (!t || typeof t !== 'object') { problems.push(`${lab}: must be an object.`); return; }
        const rawName = txt(t.tournament, 80); if (!rawName) { problems.push(`${lab}: missing tournament name.`); return; }
        const tournament = TOURNAMENTS[personNorm(rawName)];
        if (!tournament) { problems.push(`${lab}: "${rawName}" is not a known tournament. Use one of: ${Object.values(TOURNAMENTS).filter((v, i, a) => a.indexOf(v) === i).join(', ')}.`); return; }
        const year = Number(t.year); if (!Number.isInteger(year) || year < 1930 || year > Number(today.slice(0, 4)) + 1) { problems.push(`${lab} (${tournament}): year must be the year the tournament started.`); return; }
        const nation = txt(t.nation, 80); if (!nation) { problems.push(`${lab} (${tournament} ${year}): missing nation.`); return; }
        const status = txt(t.status, 20) || 'registered';
        if (!TSTATUS.includes(status)) { problems.push(`${lab} (${tournament} ${year}): status must be one of ${TSTATUS.join(', ')}.`); return; }
        const key = `${tournament}|${year}`;
        if (seen.has(key)) { problems.push(`${lab}: ${tournament} ${year} is listed twice.`); return; }
        seen.add(key);
        const stats = readStats(t.stats && typeof t.stats === 'object' ? t.stats : {}, `${L} ${tournament} ${year}`, problems, warnings);
        p.tournaments.push({ tournament, year, nation, status, stats, note: txt(t.note, 200) });
      });
    }
  }

  if (x.awards != null) {
    if (!Array.isArray(x.awards)) problems.push(`${L}: awards must be a list.`);
    else x.awards.forEach((a, i) => {
      const obj = typeof a === 'string' ? { name: a } : a;
      const nm = txt(obj && obj.name, 160); if (!nm) { problems.push(`${L} award ${i + 1}: missing name.`); return; }
      let season = null; if (obj.season != null && obj.season !== '') { season = Number(obj.season); if (!Number.isInteger(season) || season < 1930 || season > 2200) { problems.push(`${L} award "${nm}": season must be the starting year.`); return; } }
      const kind = txt(obj.kind, 12) || null; if (kind && !['individual', 'team'].includes(kind)) { problems.push(`${L} award "${nm}": kind must be "individual" or "team".`); return; }
      p.awards.push({ name: nm, season, kind, note: txt(obj.note, 200) });
    });
  }

  const mvIn = x.market_values != null ? x.market_values : (x.market_value != null ? (Array.isArray(x.market_value) ? x.market_value : [x.market_value]) : []);
  if (!Array.isArray(mvIn)) problems.push(`${L}: market_values must be a list.`);
  else mvIn.forEach((m, i) => {
    const lab = `${L} market value ${i + 1}`;
    if (!m || typeof m !== 'object') { problems.push(`${lab}: must be an object like {"amount": 80000000, "date": "2026-06-01"}.`); return; }
    const amount = typeof m.amount === 'string' && /^\d+(\.\d+)?$/.test(m.amount.trim()) ? Number(m.amount) : m.amount;
    if (!isNum(amount) || amount < 0) { problems.push(`${lab}: amount must be a plain number in full (80000000, not "80m").`); return; }
    if (!isIsoDate(String(m.date || ''))) { problems.push(`${lab}: date must be YYYY-MM-DD. A value without a date can't be trusted later.`); return; }
    const currency = (txt(m.currency, 3) || 'EUR').toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) { problems.push(`${lab}: currency must be a 3-letter code like EUR.`); return; }
    p.market_values.push({ date: String(m.date), amount, currency, source: txt(m.source, 120) });
  });

  if (x.transfers != null) {
    if (!Array.isArray(x.transfers)) problems.push(`${L}: transfers must be a list.`);
    else x.transfers.forEach((t, i) => {
      const lab = `${L} transfer ${i + 1}`;
      if (!t || typeof t !== 'object') { problems.push(`${lab}: must be an object.`); return; }
      const date = String(t.date == null ? '' : t.date);
      if (!isLooseDate(date)) { problems.push(`${lab}: date must be YYYY-MM-DD (or YYYY-MM or YYYY if that is all you know).`); return; }
      const from = txt(t.from, 120), to = txt(t.to, 120); if (!from && !to) { problems.push(`${lab}: needs a from or a to club.`); return; }
      let fee = null; if (t.fee != null && t.fee !== '') { fee = typeof t.fee === 'string' && /^\d+(\.\d+)?$/.test(t.fee.trim()) ? Number(t.fee) : t.fee; if (!isNum(fee) || fee < 0) { problems.push(`${lab}: fee must be a plain number in full, or left out if undisclosed.`); return; } }
      const currency = (txt(t.currency, 3) || 'EUR').toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) { problems.push(`${lab}: currency must be a 3-letter code like EUR.`); return; }
      p.transfers.push({ date, from, to, fee, currency, type: txt(t.type, 30), note: txt(t.note, 200) });
    });
  }

  if (!p.as_of && !p.awards.length && !p.market_values.length && !p.transfers.length) warnings.push(`${L}: nothing to store (no stats, awards, market value or transfers).`);
  if (!source) warnings.push(`${L}: no source given. Add one so a wrong figure can be traced.`);
  return { profile: problems.length ? null : p, problems, warnings };
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Merge `inc` into `old` (old may be null). Returns { merged, changes, notes }.
 *  Changes lists only values that already existed and now differ, so a silent overwrite is always visible. */
export function mergeProfile(old, inc) {
  const changes = [], notes = [];
  const who = inc.name;
  const fresh = p => ({ ...p, other_nationalities: [...(p.other_nationalities || [])], totals: { ...(p.totals || {}) }, by_club: p.by_club || [], seasons: p.seasons || [], international: p.international || [], tournaments: p.tournaments || [], awards: p.awards || [], market_values: p.market_values || [], transfers: p.transfers || [] });
  if (!old) return { merged: fresh(inc), changes, notes };
  const o = fresh(old);
  const m = { ...o, name: old.name || inc.name, dob: inc.dob || old.dob || null, nationality: inc.nationality || old.nationality || null,
    other_nationalities: [...new Set([...o.other_nationalities, ...(inc.other_nationalities || [])])], source: inc.source || old.source || null,
    by_club: o.by_club.map(c => ({ ...c, stats: { ...c.stats } })), seasons: o.seasons.map(s => ({ ...s, stats: { ...s.stats } })), international: o.international.map(n => ({ ...n, stats: { ...n.stats } })),
    tournaments: o.tournaments.map(t => ({ ...t, stats: { ...t.stats } })), awards: [...o.awards], market_values: [...o.market_values], transfers: [...o.transfers] };
  if (inc.nationality && old.nationality && personNorm(inc.nationality) !== personNorm(old.nationality)) changes.push(`${who} nationality: ${old.nationality} → ${inc.nationality}`);
  if (inc.source && old.source && inc.source !== old.source) notes.push(`${who}: source changed from "${old.source}" to "${inc.source}".`);

  const incStats = Object.keys(inc.totals || {}).length || (inc.seasons || []).length || (inc.by_club || []).some(c => Object.keys(c.stats).length) || (inc.international || []).some(n => Object.keys(n.stats).length);
  const incomingNewer = inc.as_of && (!old.as_of || inc.as_of >= old.as_of);
  if (inc.as_of && !incomingNewer && incStats) notes.push(`${who}: stats dated ${inc.as_of} are older than the stored ${old.as_of}, so the stored totals, clubs, seasons and national-team figures were not touched.`);
  const mergeStats = (dst, src, label) => { for (const [k, v] of Object.entries(src || {})) { if (dst[k] != null && dst[k] !== v) changes.push(`${who} ${label}${label.endsWith('.') ? '' : ' '}${k}: ${dst[k]} → ${v}`); dst[k] = v; } };
  const upsertBy = (arr, item, keyFn, label, extra) => { const k = keyFn(item); const at = arr.findIndex(e => keyFn(e) === k); if (at < 0) { arr.push({ ...item, stats: { ...item.stats } }); return; } mergeStats(arr[at].stats, item.stats, label); for (const f of extra) if (item[f] != null && item[f] !== arr[at][f]) { if (arr[at][f] != null) changes.push(`${who} ${label} ${f}: ${arr[at][f]} → ${item[f]}`); arr[at][f] = item[f]; } };
  if (incomingNewer) {
    m.as_of = inc.as_of;
    mergeStats(m.totals, inc.totals, 'totals.');
    for (const c of inc.by_club || []) upsertBy(m.by_club, c, e => personNorm(e.club) + '|' + (e.from || ''), `club ${c.club}`, ['to']);
    for (const s of inc.seasons || []) upsertBy(m.seasons, s, e => `${e.season}|${personNorm(e.club)}|${personNorm(e.competition)}`, `${s.season}/${String(s.season + 1).slice(-2)} ${s.club}`, []);
    for (const n of inc.international || []) upsertBy(m.international, n, e => personNorm(e.nation) + '|' + e.level, `${n.nation} ${n.level}`, ['to']);
    m.by_club.sort((a, b) => String(a.from || '').localeCompare(String(b.from || '')));
    m.seasons.sort((a, b) => a.season - b.season || a.club.localeCompare(b.club));
  }
  for (const t of inc.tournaments || []) {
    const k = e => e.tournament + '|' + e.year; const at = m.tournaments.findIndex(e => k(e) === k(t));
    if (at < 0) m.tournaments.push({ ...t, stats: { ...t.stats } });
    else { if (m.tournaments[at].nation !== t.nation) changes.push(`${who} ${t.tournament} ${t.year} nation: ${m.tournaments[at].nation} → ${t.nation}`); if (m.tournaments[at].status !== t.status) changes.push(`${who} ${t.tournament} ${t.year} status: ${m.tournaments[at].status} → ${t.status}`); m.tournaments[at].nation = t.nation; m.tournaments[at].status = t.status; mergeStats(m.tournaments[at].stats, t.stats, `${t.tournament} ${t.year}`); }
  }
  m.tournaments.sort((a, b) => a.year - b.year || a.tournament.localeCompare(b.tournament));
  for (const a of inc.awards || []) { if (!m.awards.some(e => personNorm(e.name) === personNorm(a.name) && e.season === a.season)) m.awards.push(a); }
  for (const v of inc.market_values || []) { const at = m.market_values.findIndex(e => e.date === v.date); if (at >= 0) { if (!eq(m.market_values[at], v)) changes.push(`${who} market value ${v.date}: ${m.market_values[at].amount} → ${v.amount}`); m.market_values[at] = v; } else m.market_values.push(v); }
  m.market_values.sort((a, b) => a.date.localeCompare(b.date));
  for (const t of inc.transfers || []) { const k = e => `${e.date}|${personNorm(e.from)}|${personNorm(e.to)}`; const at = m.transfers.findIndex(e => k(e) === k(t)); if (at >= 0) { if (!eq(m.transfers[at], t)) changes.push(`${who} transfer ${t.date}: details changed`); m.transfers[at] = t; } else m.transfers.push(t); }
  m.transfers.sort((a, b) => a.date.localeCompare(b.date));
  return { merged: m, changes, notes };
}

/** Find the stored profile an incoming one belongs to. Returns { match, ambiguous }. */
export function findStored(rows, inc) {
  const n = personNorm(inc.name);
  const cands = rows.filter(r => personNorm(r.name) === n && (!inc.dob || !r.dob || inc.dob === r.dob));
  if (cands.length <= 1) return { match: cands[0] || null, ambiguous: false };
  const exact = cands.filter(r => r.dob === inc.dob);
  if (inc.dob && exact.length === 1) return { match: exact[0], ambiguous: false };
  return { match: null, ambiguous: true };
}

/** A one-line description for the admin list. */
export function describe(p) {
  const bits = [];
  if (p.nationality) bits.push(p.nationality);
  if (p.as_of) bits.push('stats to ' + p.as_of);
  const n = (a, w) => a && a.length ? a.length + ' ' + w + (a.length > 1 ? 's' : '') : '';
  [n(p.by_club, 'club'), n(p.seasons, 'season'), n(p.international, 'national team'), n(p.tournaments, 'tournament'), n(p.awards, 'award'), n(p.transfers, 'transfer')].filter(Boolean).forEach(x => bits.push(x));
  if (p.market_values && p.market_values.length) bits.push('value ' + p.market_values[p.market_values.length - 1].date);
  return bits.join(' · ') || 'empty';
}
