// lib/bank-squad.js
// Checks and normalises one club group of a squad import:
//   { league, season, club, as_of, coach:{name,nationality}, players:[{name, shirt, dob, age, position, nationality,
//                                                                       club_status, national_status, ...}] }
// Pure functions: no database, so they can be tested on their own.
import { LEAGUES, norm, isIsoDate, matchKnownClub } from './bank-core.js';

const NF = v => v == null || /^\s*(not found|n\/?a|unknown|-|–|—|null)?\s*$/i.test(String(v));   // "NOT FOUND" and blanks mean "no value"
const POS = { goalkeeper: 'Goalkeeper', keeper: 'Goalkeeper', gk: 'Goalkeeper', defender: 'Defender', df: 'Defender', midfielder: 'Midfielder', mf: 'Midfielder', forward: 'Forward', fw: 'Forward', attacker: 'Forward', striker: 'Forward' };

/** Club:     "Active" | "Permanent" | "On Loan" | "On Loan (from X)" | "Retired" | "Retired (2026)"
 *  National:  "Active" | "Senior International" | "Youth International" | "Former international" | "Former youth international"
 *             | "Retired (year)" | "Not capped" | "Uncapped"
 *  ->  { status, year, loan, loan_from } or { problem } */
export function parseStatus(raw, kind) {
  if (NF(raw)) return {};
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  const year = (s.match(/\b(19|20)\d{2}\b/) || [])[0];
  if (/^retired\b/.test(s)) return { status: 'retired', year: year ? Number(year) : null };
  if (kind === 'club') {
    if (/^(active|permanent)\b/.test(s)) return { status: 'active' };
    const m = s.match(/^on loan(?:\s*(?:from|\()\s*(.+?)\)?)?$/);
    if (m) { const f = m[1] ? String(raw).trim().replace(/^on loan\s*\(?\s*(?:from\s+)?/i, '').replace(/\)$/, '').trim() : null; return { status: 'active', loan: true, loan_from: f || null }; }
    return { problem: `status “${raw}” is not one of Active, Permanent, On Loan (from club), Retired (year)` };
  }
  if (/^former youth\b/.test(s)) return { status: 'former_youth' };
  if (/^former\b/.test(s)) return { status: 'former' };
  if (/^(not capped|never capped|uncapped)\b/.test(s)) return { status: 'not_capped' };
  if (/^youth\b/.test(s)) return { status: 'youth' };
  if (/^(active|senior)\b/.test(s)) return { status: 'active' };
  return { problem: `status “${raw}” is not one of Active, Youth International, Former international, Retired (year), Not capped` };
}

export function ageOn(dob, onISO) {
  const d = new Date(dob + 'T00:00:00Z'), t = new Date(onISO + 'T00:00:00Z');
  let a = t.getUTCFullYear() - d.getUTCFullYear();
  const m = t.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && t.getUTCDate() < d.getUTCDate())) a--;
  return a;
}

/**
 * ctx: { today, known: Map(league -> Map(normName -> display)), aliasMap: Map(normAlias -> display) }
 * returns { rows, coach, problems, warnings, notes }
 */
export function normalizeSquad(pack, idx, ctx) {
  const problems = [], warnings = [], notes = [];
  const p = pack || {};
  const label = `Group ${idx + 1}`;
  const league = String(p.league || ctx.league || '').trim();
  const season = Number(p.season ?? ctx.season);
  let club = String(p.club || '').trim();
  if (!league || !LEAGUES[league]) return { rows: [], coach: null, problems: [`${label}: unknown or missing league key (use EPL, LALIGA, SERIEA, BUNDESLIGA, LIGUE1, SPL or INTERMIAMI).`], warnings, notes };
  if (!Number.isInteger(season) || season < 1900 || season > 2200) return { rows: [], coach: null, problems: [`${label}: season must be the starting year, e.g. 2026.`], warnings, notes };
  if (!club) return { rows: [], coach: null, problems: [`${label}: missing club.`], warnings, notes };
  if (!Array.isArray(p.players)) return { rows: [], coach: null, problems: [`${label} (${club}): players must be an array.`], warnings, notes };

  // the club's name as the bank already spells it (so "Man City" and "Manchester City" do not become two clubs)
  const known = ctx.known && ctx.known.get(league);
  if (known && known.size) {
    const hit = matchKnownClub(club, known, ctx.aliasMap || new Map());
    if (hit) { if (hit !== club) notes.push(`${club} → ${hit}`); club = hit; }
    else warnings.push(`${club}: not a club the bank knows in ${LEAGUES[league].short} (spelling?). It was kept as written.`);
  }

  let asOf = ctx.today;
  if (p.as_of != null && p.as_of !== '') {
    if (!isIsoDate(String(p.as_of))) problems.push(`${club}: as_of must be a date like 2026-10-17.`);
    else if (String(p.as_of) > ctx.today) problems.push(`${club}: as_of is in the future.`);
    else asOf = String(p.as_of);
  }

  let coach = null;
  if (p.coach != null) {
    const c = typeof p.coach === 'string' ? { name: p.coach } : p.coach;
    if (c && !NF(c.name)) {
      coach = { id: `${league}|${season}|${club.toLowerCase()}`, league, season, club, name: String(c.name).trim().slice(0, 120), nationality: NF(c.nationality) ? null : String(c.nationality).trim().slice(0, 80), as_of: asOf, updated_at: new Date().toISOString() };
    }
  }

  const rows = []; let noBirthInfo = 0;
  p.players.forEach((x, i) => {
    x = x || {};
    const name = String(x.name || '').trim();
    if (NF(name)) { problems.push(`${club} player ${i + 1}: missing name.`); return; }
    const who = `${club} / ${name}`;
    let shirt = null;
    if (!NF(x.shirt)) { shirt = Number(x.shirt); if (!Number.isInteger(shirt) || shirt < 0 || shirt > 999) { problems.push(`${who}: shirt must be a whole number (or leave it out).`); return; } }
    let dob = null;
    if (!NF(x.dob)) { dob = String(x.dob).trim().slice(0, 10); if (!isIsoDate(dob)) { problems.push(`${who}: date of birth must look like 2001-09-05 (or leave it out).`); return; } if (dob > asOf) { problems.push(`${who}: date of birth is in the future.`); return; } }
    let age = null;
    if (!NF(x.age)) { age = Number(x.age); if (!Number.isInteger(age) || age < 14 || age > 60) { problems.push(`${who}: age must be a whole number between 14 and 60 (or leave it out).`); return; } }
    if (dob && age != null && Math.abs(ageOn(dob, asOf) - age) > 1) warnings.push(`${who}: age ${age} does not match date of birth ${dob} (that makes ${ageOn(dob, asOf)}).`);
    if (dob && age == null) { const a = ageOn(dob, asOf); if (a < 15 || a > 45) warnings.push(`${who}: date of birth ${dob} makes the player ${a}. Check it.`); }
    if (!dob && age == null) noBirthInfo++;

    const cs = parseStatus(x.club_status, 'club'); if (cs.problem) { problems.push(`${who}: club ${cs.problem}.`); return; }
    const ns = parseStatus(x.national_status, 'national'); if (ns.problem) { problems.push(`${who}: national team ${ns.problem}.`); return; }
    const cy = x.club_retired_year != null && x.club_retired_year !== '' ? Number(x.club_retired_year) : cs.year || null;
    const ny = x.national_retired_year != null && x.national_retired_year !== '' ? Number(x.national_retired_year) : ns.year || null;
    for (const [k, v] of [['club_retired_year', cy], ['national_retired_year', ny]]) if (v != null && (!Number.isInteger(v) || v < 1950 || v > 2100)) { problems.push(`${who}: ${k} must be a year.`); return; }

    let position = null;
    if (!NF(x.position)) {
      const raw = String(x.position).trim(); const mapped = POS[raw.toLowerCase()];
      if (mapped) position = mapped; else { position = raw.slice(0, 80); warnings.push(`${who}: position “${raw}” is not Goalkeeper, Defender, Midfielder or Forward. Kept as written.`); }
    }
    rows.push({
      id: `${league}|${season}|${club.toLowerCase()}|${name.toLowerCase()}`, league, season, club, name,
      shirt, dob, age, age_as_of: age != null ? asOf : null, position,
      nationality: NF(x.nationality) ? null : String(x.nationality).trim().slice(0, 80),
      club_status: cs.status || null, club_retired_year: cs.status === 'retired' ? cy : null, on_loan: cs.loan ? true : null, loan_from: cs.loan_from || null,
      national_status: ns.status || null, national_retired_year: ns.status === 'retired' ? ny : null,
      updated_at: new Date().toISOString()
    });
  });
  if (noBirthInfo) warnings.push(`${club}: ${noBirthInfo} player(s) have neither a date of birth nor an age.`);
  if (!coach && p.coach == null) warnings.push(`${club}: no coach given.`);
  return { rows, coach, problems, warnings, notes, noBirthInfo };
}
