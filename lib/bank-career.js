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

  const p = { name, dob, nationality, source, as_of: null, totals: {}, seasons: [], awards: [], market_values: [], transfers: [] };

  const hasStats = (x.totals && Object.keys(x.totals).length) || (Array.isArray(x.seasons) && x.seasons.length);
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
      // A career total can never be smaller than the seasons you listed (the list may be partial, the total may not).
      for (const k of Object.keys(p.totals)) {
        const sum = p.seasons.reduce((a, s) => a + (s.stats[k] || 0), 0);
        if (sum > p.totals[k]) problems.push(`${L}: seasons add up to ${sum} ${k}, which is more than the career total ${p.totals[k]}.`);
      }
    }
  }

  if (x.awards != null) {
    if (!Array.isArray(x.awards)) problems.push(`${L}: awards must be a list.`);
    else x.awards.forEach((a, i) => {
      const obj = typeof a === 'string' ? { name: a } : a;
      const nm = txt(obj && obj.name, 160); if (!nm) { problems.push(`${L} award ${i + 1}: missing name.`); return; }
      let season = null; if (obj.season != null && obj.season !== '') { season = Number(obj.season); if (!Number.isInteger(season) || season < 1930 || season > 2200) { problems.push(`${L} award "${nm}": season must be the starting year.`); return; } }
      p.awards.push({ name: nm, season, note: txt(obj.note, 200) });
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
  if (!old) return { merged: { ...inc, totals: { ...inc.totals } }, changes, notes };
  const m = { name: old.name || inc.name, dob: inc.dob || old.dob || null, nationality: inc.nationality || old.nationality || null, source: inc.source || old.source || null,
    as_of: old.as_of, totals: { ...(old.totals || {}) }, seasons: (old.seasons || []).map(s => ({ ...s, stats: { ...s.stats } })), awards: [...(old.awards || [])], market_values: [...(old.market_values || [])], transfers: [...(old.transfers || [])] };
  if (inc.source && old.source && inc.source !== old.source) notes.push(`${who}: source changed from "${old.source}" to "${inc.source}".`);

  const incomingNewer = inc.as_of && (!old.as_of || inc.as_of >= old.as_of);
  if (inc.as_of && !incomingNewer && (Object.keys(inc.totals).length || inc.seasons.length)) notes.push(`${who}: stats dated ${inc.as_of} are older than the stored ${old.as_of}, so the stored totals and seasons were not touched.`);
  if (incomingNewer) {
    m.as_of = inc.as_of;
    for (const [k, v] of Object.entries(inc.totals)) { if (m.totals[k] != null && m.totals[k] !== v) changes.push(`${who} totals.${k}: ${m.totals[k]} → ${v}`); m.totals[k] = v; }
    for (const s of inc.seasons) {
      const key = `${s.season}|${personNorm(s.club)}|${personNorm(s.competition)}`;
      const at = m.seasons.findIndex(o => `${o.season}|${personNorm(o.club)}|${personNorm(o.competition)}` === key);
      if (at < 0) { m.seasons.push({ ...s, stats: { ...s.stats } }); continue; }
      for (const [k, v] of Object.entries(s.stats)) { const o = m.seasons[at].stats[k]; if (o != null && o !== v) changes.push(`${who} ${s.season}/${String(s.season + 1).slice(-2)} ${s.club} ${k}: ${o} → ${v}`); m.seasons[at].stats[k] = v; }
    }
    m.seasons.sort((a, b) => a.season - b.season || a.club.localeCompare(b.club));
  }
  for (const a of inc.awards) { if (!m.awards.some(o => personNorm(o.name) === personNorm(a.name) && o.season === a.season)) m.awards.push(a); }
  for (const v of inc.market_values) { const at = m.market_values.findIndex(o => o.date === v.date); if (at >= 0) { if (!eq(m.market_values[at], v)) changes.push(`${who} market value ${v.date}: ${m.market_values[at].amount} → ${v.amount}`); m.market_values[at] = v; } else m.market_values.push(v); }
  m.market_values.sort((a, b) => a.date.localeCompare(b.date));
  for (const t of inc.transfers) { const k = o => `${o.date}|${personNorm(o.from)}|${personNorm(o.to)}`; const at = m.transfers.findIndex(o => k(o) === k(t)); if (at >= 0) { if (!eq(m.transfers[at], t)) changes.push(`${who} transfer ${t.date}: details changed`); m.transfers[at] = t; } else m.transfers.push(t); }
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
  if (p.as_of) bits.push('stats to ' + p.as_of);
  if (p.seasons && p.seasons.length) bits.push(p.seasons.length + ' season' + (p.seasons.length > 1 ? 's' : ''));
  if (p.awards && p.awards.length) bits.push(p.awards.length + ' award' + (p.awards.length > 1 ? 's' : ''));
  if (p.market_values && p.market_values.length) bits.push('value ' + p.market_values[p.market_values.length - 1].date);
  if (p.transfers && p.transfers.length) bits.push(p.transfers.length + ' transfer' + (p.transfers.length > 1 ? 's' : ''));
  return bits.join(' · ') || 'empty';
}
