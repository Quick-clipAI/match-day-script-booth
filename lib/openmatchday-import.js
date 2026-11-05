// lib/openmatchday-import.js — turns the recovered CSV (openmatchday: team stats per match, from OpenLigaDB / fixture downloads)
// into match details. It holds team stats and half-time scores only: no players, line-ups, ratings or goal scorers.
// A row is trusted only when its score equals our stored score. Details from any other source are never overwritten.

/** Minimal CSV reader (quotes, commas and newlines inside quotes, BOM). -> array of objects */
export function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, ''); const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.trim());
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] == null ? '' : r[i]).trim()])));
}

const nn = v => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/** one CSV row + our stored match -> detail object, or null when the row is unusable / the score disagrees */
export function convertRow(r, m, nowISO = new Date().toISOString()) {
  if (!m || m.hg == null || m.ag == null) return null;
  if (nn(r.openmatchday_ft_home) !== m.hg || nn(r.openmatchday_ft_away) !== m.ag) return null;
  const stats = [];
  const add = (label, h, a) => { if (h != null && a != null) stats.push({ label, home: h, away: a }); };
  add('Total Shots', nn(r.openmatchday_home_shots), nn(r.openmatchday_away_shots));
  add('Shots on Goal', nn(r.openmatchday_home_target), nn(r.openmatchday_away_target));
  add('Corner Kicks', nn(r.openmatchday_home_corners), nn(r.openmatchday_away_corners));
  add('Fouls', nn(r.openmatchday_home_fouls), nn(r.openmatchday_away_fouls));
  add('Yellow Cards', nn(r.openmatchday_home_yellow), nn(r.openmatchday_away_yellow));
  add('Red Cards', nn(r.openmatchday_home_red), nn(r.openmatchday_away_red));
  if (!stats.length) return null;
  const hh = nn(r.openmatchday_ht_home), ha = nn(r.openmatchday_ht_away);
  const gm = String(r.openmatchday_goal_minutes || '').split(',').map(x => x.trim()).filter(Boolean);
  return { v: 1, source: 'openmatchday', fetchedAt: nowISO, venue: null, attendance: null, referee: null, events: [], lineups: {}, stats, best: null,
    halftime: hh != null && ha != null ? { home: hh, away: ha } : null,
    goalMinutes: gm.length === m.hg + m.ag ? gm.map(Number) : null };      // kept only when it lists every goal (side and scorer are unknown)
}

/** rows -> saves details. Returns a summary. */
export async function importOpenMatchday(store, rows, { now = Date.now() } = {}) {
  const out = { rows: rows.length, saved: 0, kept: 0, unknownId: 0, scoreDiffers: 0, halftimeSet: 0 };
  for (const r of rows) {
    const id = r.match_id; if (!id) { out.unknownId++; continue; }
    const lg = id.split('|')[0], season = Number(id.split('|')[1]);
    const ms = await store.listMatches({ league: lg, season }).catch(() => []); const m = ms.find(x => x.id === id);
    if (!m || m.status !== 'finished') { out.unknownId++; continue; }
    const d = convertRow(r, m, new Date(now).toISOString());
    if (!d) { out.scoreDiffers++; continue; }
    const old = await store.getDetail(id).catch(() => null);
    if (old && old.data && !old.data.unavailable && old.data.source !== 'openmatchday') { out.kept++; continue; }
    await store.saveManualDetail(id, d); out.saved++;
  }
  out.summary = `Recovered-stats import: ${out.saved} saved, ${out.kept} kept as they were, ${out.scoreDiffers} skipped (score differs or no stats), ${out.unknownId} not found`;
  await store.addLog({ kind: 'openmatchday-import', ok: true, summary: out.summary, detail: { saved: out.saved, kept: out.kept, scoreDiffers: out.scoreDiffers, unknownId: out.unknownId } });
  return out;
}
