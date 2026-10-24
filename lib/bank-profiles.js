// lib/bank-profiles.js  Player profiles from the Transfermarkt dataset, and the "may have left" check against our own squads.
// Our own squad data is always the current truth. This file never changes it: it only produces FLAGS for a person to confirm.
const isoDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** People's names: lower-case, no accents or punctuation. (Unlike club names, nothing is dropped: "Al", "Sa" are real.) */
export function personNorm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/đ/g, 'd').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, ' ').trim();
}
const clubNorm = s => personNorm(s).split(' ').filter(t => !['fc', 'afc', 'cf', 'sc', 'ac', 'as', 'ss', 'ssc', 'us', 'rc', 'rcd', 'cd', 'ud', 'sd', 'sv', 'vfl', 'vfb', 'fsv', 'tsg', 'fk', 'ca'].includes(t) && !/^\d{1,4}$/.test(t)).join(' ');

/** Same club? exact, alias, or one name's words all inside the other (min 5 letters), like the match sync uses. */
export function sameClub(a, b, aliasMap = new Map()) {
  const x = clubNorm(a), y = clubNorm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const ax = aliasMap.get(x), ay = aliasMap.get(y);
  if ((ax && clubNorm(ax) === y) || (ay && clubNorm(ay) === x)) return true;
  const tx = x.split(' '), ty = y.split(' ');
  const sub = (s, l) => s.length > 0 && s.every(t => l.includes(t));
  return (sub(tx, ty) || sub(ty, tx)) && Math.min(x.length, y.length) >= 5;
}

const num = v => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : NaN));

/** Checks a list of incoming profiles. Returns { rows, problems, warnings }. Rows are ready for bank_player_profiles. */
export function normalizeProfiles(list, source) {
  const problems = [], warnings = [], rows = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((p, i) => {
    const who = `Profile ${i + 1}${p && p.name ? ' (' + p.name + ')' : ''}`;
    if (!p || typeof p !== 'object') return problems.push(`${who}: not an object.`);
    const name = String(p.name || '').trim();
    if (!name) return problems.push(`${who}: no name.`);
    const id = String(p.id || (p.tm != null ? 'tm' + p.tm : '')).trim();
    if (!id) return problems.push(`${who}: no id.`);
    if (p.dob != null && !isoDate(p.dob)) return problems.push(`${who}: dob must be YYYY-MM-DD.`);
    for (const k of ['mv', 'mvPeak', 'caps', 'intGoals', 'h']) if (p[k] != null && Number.isNaN(num(p[k]))) return problems.push(`${who}: ${k} must be a number.`);
    if (p.contract != null && !isoDate(p.contract)) return problems.push(`${who}: contract must be YYYY-MM-DD.`);
    for (const k of ['tr', 'val', 'st']) if (p[k] != null && !Array.isArray(p[k])) return problems.push(`${who}: ${k} must be a list.`);
    if (seen.has(id)) warnings.push(`${name}: listed more than once; the later copy wins.`); seen.add(id);
    const { id: _i, name: _n, dob: _d, league: _l, club: _c, tmClub: _t, active: _a, ...rest } = p;
    rows.push({ id, tm_id: p.tm != null ? Number(p.tm) : null, name, norm: personNorm(name), dob: p.dob || null, league: p.league || null, club: p.club || null, tm_club: p.tmClub || null, active: p.active !== false, data: rest, source: source || null });
  });
  return { rows: [...new Map(rows.map(r => [r.id, r])).values()], problems, warnings };
}

const yearOf = d => (d ? Number(String(d).slice(0, 4)) : null);

/**
 * bankPlayers: rows of bank_players. profiles: rows of bank_player_profiles. aliasMap: norm alias -> canonical club.
 * Returns flags [{ key, player_id, name, bank_club, league, kind, tm_club, detail }]. Kinds:
 *   'left'     Transfermarkt lists a move AWAY from our club, and the player is now listed at another club.
 *   'mismatch' Transfermarkt has him at another club and never mentions ours: one of the two sources is wrong (or he came back after the snapshot).
 * Players on loan from the club in our data, retired players, and older seasons are skipped.
 */
export function computeFlags(bankPlayers, profiles, aliasMap = new Map()) {
  const top = new Map();                                            // latest season per league
  for (const p of bankPlayers) if (!top.has(p.league) || p.season > top.get(p.league)) top.set(p.league, p.season);
  const byNorm = new Map(), byDob = new Map();
  for (const pr of profiles) { (byNorm.get(pr.norm) || byNorm.set(pr.norm, []).get(pr.norm)).push(pr); if (pr.dob) (byDob.get(pr.dob) || byDob.set(pr.dob, []).get(pr.dob)).push(pr); }
  const find = bp => {
    const n = personNorm(bp.name), dob = bp.dob ? String(bp.dob).slice(0, 10) : null;
    const c = byNorm.get(n) || [];
    if (dob) { const hit = c.filter(x => x.dob === dob); if (hit.length === 1) return hit[0];
      const t = n.split(' '); const cand = (byDob.get(dob) || []).filter(x => { const u = x.norm.split(' '); return t.every(k => u.includes(k)) || u.every(k => t.includes(k)); }); return cand.length === 1 ? cand[0] : null; }
    return c.length === 1 ? c[0] : null;                            // no birth date in our data: only a unique name counts
  };
  const flags = [];
  for (const bp of bankPlayers) {
    if (bp.season !== top.get(bp.league) || bp.club_status === 'retired') continue;
    const pr = find(bp); if (!pr) continue;
    const d = pr.data || {};
    const tmNow = pr.tm_club || null;
    if (!tmNow || sameClub(tmNow, bp.club, aliasMap) || (pr.club && sameClub(pr.club, bp.club, aliasMap))) continue;
    if (bp.on_loan && bp.loan_from && sameClub(tmNow, bp.loan_from, aliasMap)) continue;   // on loan: the parent club is the one TM shows
    const tr = Array.isArray(d.tr) ? d.tr : [];
    const away = tr.filter(t => t[1] && sameClub(t[1], bp.club, aliasMap) && t[2] && !sameClub(t[2], bp.club, aliasMap)).sort((a, b) => String(b[0]).localeCompare(String(a[0])))[0];
    const toOurs = tr.filter(t => t[2] && sameClub(t[2], bp.club, aliasMap)).sort((a, b) => String(b[0]).localeCompare(String(a[0])))[0];
    const kind = away && (!toOurs || String(away[0]) >= String(toOurs[0])) ? 'left' : 'mismatch';
    flags.push({ key: `${kind}|${pr.id}|${bp.id}`, player_id: bp.id, name: bp.name, bank_club: bp.club, league: bp.league, kind, tm_club: tmNow,
      detail: { tm_id: pr.tm_id, move_date: away ? away[0] : null, move_to: away ? away[2] : null, fee: away ? away[3] : null, last_in: toOurs ? toOurs[0] : null, tm_snapshot: '2026-07-06', market_value: d.mv != null ? d.mv : null, bank_season: bp.season, on_loan: !!bp.on_loan } });
  }
  return flags.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'left' ? -1 : 1) || String(b.detail.move_date || '').localeCompare(String(a.detail.move_date || '')) || a.name.localeCompare(b.name));
}

export { yearOf };
