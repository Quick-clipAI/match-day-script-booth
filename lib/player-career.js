// lib/player-career.js — fetch a player's transfer history ONLY when somebody opens him (free plan: 100 requests/day).
import { movesFromApi, playerTrophies } from './player-trophies.js';

const REFRESH_DAYS = 60;

/** -> { status: 'ready'|'queued'|'none'|'off', data?: {clubs,total,note}, calls } */
export async function playerTrophyStatus(store, pid, { getTransfers, name = '', now = Date.now(), dailyCap = 25, reserve = 15 } = {}) {
  const id = Number(pid); if (!id) return { status: 'none', calls: 0 };
  const rows = await store.listPlayerCareer([id]).catch(() => []); const have = rows[0];
  const fresh = have && have.ok && now - Date.parse(have.fetched_at || 0) < REFRESH_DAYS * 86400000;
  let calls = 0;
  if (!fresh) {
    if (!getTransfers) return have && have.ok ? build(store, have) : { status: 'off', calls };
    const today = new Date(now).toISOString().slice(0, 10);
    const logs = await store.recentLogs(300).catch(() => []);
    const used = logs.filter(l => l.kind === 'player-career' && String(l.at || '').slice(0, 10) === today).reduce((n, l) => n + (Number(l.detail && l.detail.calls) || 0), 0);
    const lastLeft = (logs.find(l => l.detail && l.detail.left != null && String(l.at || '').slice(0, 10) === today) || { detail: {} }).detail.left;
    if (used >= dailyCap || (lastLeft != null && lastLeft <= reserve)) return have && have.ok ? build(store, have) : { status: 'queued', calls };
    let left = null;
    try {
      const j = await getTransfers(id); calls = 1; left = j.__left != null ? j.__left : null;
      const moves = movesFromApi(j);
      const errs = j && j.errors && (Array.isArray(j.errors) ? j.errors.length : Object.keys(j.errors).length);
      if (errs) { await store.addLog({ kind: 'player-career', ok: false, summary: 'Player career refused by the API', detail: { calls, left, id } }); return have && have.ok ? build(store, have) : { status: 'queued', calls }; }
      await store.upsertPlayerCareer([{ api_id: id, name, moves, ok: true, fetched_at: new Date(now).toISOString() }]);
      await store.addLog({ kind: 'player-career', ok: true, summary: `Career fetched for ${name || id}: ${moves.length} move(s)`, detail: { calls, left, id } });
      return build(store, { moves });
    } catch (e) {
      await store.addLog({ kind: 'player-career', ok: false, summary: 'Player career failed: ' + String(e.message || e).slice(0, 200), detail: { calls: calls || 1, id } });
      return have && have.ok ? build(store, have) : { status: 'queued', calls: calls || 1 };
    }
  }
  return build(store, have);
}

async function build(store, have) {
  const rows = await store.listClubTrophies();
  const data = playerTrophies(have.moves || [], rows);
  return { status: data.clubs.length ? 'ready' : 'none', data: { ...data, note: 'Counted by the seasons he was at each club (from his transfers), not by games played. Club trophies only: no national-team trophies or personal awards yet.' }, calls: 0 };
}
