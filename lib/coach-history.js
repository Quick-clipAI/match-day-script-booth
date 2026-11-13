// lib/coach-history.js — a club's coaches over time (table bank_coach_spells). A coach row in bank_coaches only says who is in charge NOW;
// when the source shows a different name, this closes the old coach's spell and opens the new one, so nobody is ever erased.
// The exact leaving date and reason are not known to the source: an automatic close says so, and the admin can set the real values.
import { norm } from './bank-core.js';

export const spellId = (league, club, name) => `${league}|${String(club).toLowerCase()}|${norm(name)}`;

/** Called with the stored coach row (or null) and the name the source shows now. -> { closed, opened } (both optional). */
export async function noteCoachChange(store, { league, club, oldName, newName, newApi = null, nationality = null, today, endedOn = null, startedOn = null, teamApiId = null, prev = null, origin = null }) {
  if (!store.listCoachSpells || !newName || !oldName || norm(oldName) === norm(newName)) return null;
  const spells = await store.listCoachSpells({ club }).catch(() => []);
  const byId = new Map(spells.map(s => [s.id, s]));
  const out = {}, rows = [];
  const oldId = spellId(league, club, oldName), old = byId.get(oldId);
  if (!old) rows.push({ id: oldId, league, club, name: oldName, role: 'head', team_api_id: teamApiId, ended_on: endedOn || today, end_reason: `Left: change noticed on ${today}, exact date and reason not recorded yet`, source: 'auto' }), out.closed = oldName;
  else if (!old.ended_on) rows.push({ ...old, ended_on: endedOn || today, end_reason: old.end_reason || `Left: change noticed on ${today}, exact date and reason not recorded yet`, source: old.source || 'auto' }), out.closed = oldName;
  const newId = spellId(league, club, newName), cur = byId.get(newId);
  if (!cur) rows.push({ id: newId, league, club, name: newName, nationality, api_id: newApi || null, role: 'head', team_api_id: teamApiId, started_on: startedOn, ended_on: null, end_reason: null, prev_team: prev ? prev.team || null : null, prev_team_api_id: prev ? prev.teamId || null : null, prev_ended_on: prev ? prev.end || null : null, origin, source: `auto: first seen ${today}` }), out.opened = newName;
  else if (cur.ended_on) rows.push({ ...cur, ended_on: null, end_reason: null }), out.opened = newName;      // a coach who returns
  if (rows.length) await store.upsertCoachSpells(rows);
  return out;
}

/** The coach screen's view: who is in charge (or just left), and the earlier coaches, newest first. */
export function coachView(spells, current) {
  const list = (spells || []).slice().sort((a, b) => String(b.ended_on || '9999').localeCompare(String(a.ended_on || '9999')));
  const mine = current && list.find(s => norm(s.name) === norm(current.name));
  const left = mine && mine.ended_on && !list.some(s => !s.ended_on && norm(s.name) !== norm(current.name))
    ? { date: mine.ended_on, reason: mine.end_reason || null } : null;
  const previous = list.filter(s => s.ended_on && !(current && norm(s.name) === norm(current.name) && !left)).map(s => ({ name: s.name, nationality: s.nationality || null, pid: s.api_id || null, from: s.started_on || null, to: s.ended_on, reason: s.end_reason || null }));
  const joined = mine && !mine.ended_on ? { date: mine.started_on || null, from: mine.prev_team || null, origin: mine.origin || null } : null;
  return { left, joined, previous: left ? previous.filter(p => norm(p.name) !== norm(current.name)) : previous };
}
