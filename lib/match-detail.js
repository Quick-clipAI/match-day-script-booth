// lib/match-detail.js  — line-ups, statistics, events and player ratings for ONE finished match.
// One API-Football request (fixtures?id=) holds all four, so a match costs exactly 1 credit, fetched once and saved.
// Pure logic + a small fetch loop; no database or network code lives here (the store and getDetail are passed in).

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Shrinks API-Football's fixtures?id= answer to what the match screen shows. Returns null if the answer is empty/unusable. */
export function compactDetail(fx, nowISO = new Date().toISOString()) {
  if (!fx || !fx.teams || !fx.teams.home || !fx.teams.away) return null;
  const hid = fx.teams.home.id, aid = fx.teams.away.id;
  const sideOf = id => (id === hid ? 'home' : id === aid ? 'away' : null);

  // player stats keyed by player id
  const ps = new Map();
  (fx.players || []).forEach(t => (t.players || []).forEach(p => {
    const s = (p.statistics && p.statistics[0]) || {};
    ps.set(p.player && p.player.id, {
      rating: num(s.games && s.games.rating), min: num(s.games && s.games.minutes),
      g: num(s.goals && s.goals.total) || 0, a: num(s.goals && s.goals.assists) || 0,
      yc: num(s.cards && s.cards.yellow) || 0, rc: num(s.cards && s.cards.red) || 0,
      sv: num(s.goals && s.goals.saves) || 0
    });
  }));
  const person = (e) => {
    const p = e.player || {}; const x = ps.get(p.id) || {};
    return { id: p.id || null, n: num(p.number), name: p.name || '', pos: p.pos || '', grid: p.grid || null, ...x };
  };

  const lineups = {};
  (fx.lineups || []).forEach(l => {
    const side = sideOf(l.team && l.team.id); if (!side) return;
    lineups[side] = { formation: l.formation || null, coach: l.coach && l.coach.name ? l.coach.name : null, xi: (l.startXI || []).map(person), subs: (l.substitutes || []).map(person) };
  });

  const stats = [];
  const st = {};
  (fx.statistics || []).forEach(t => { const side = sideOf(t.team && t.team.id); if (side) st[side] = t.statistics || []; });
  if (st.home && st.away) {
    st.home.forEach(h => {
      const a = st.away.find(x => x.type === h.type);
      const v = x => (x == null ? 0 : x);
      stats.push({ label: h.type, home: v(h.value), away: v(a && a.value) });
    });
  }

  const events = (fx.events || []).map(e => {
    const type = String(e.type || '').toLowerCase();
    return { m: num(e.time && e.time.elapsed), x: num(e.time && e.time.extra), side: sideOf(e.team && e.team.id),
      type: type === 'goal' ? 'goal' : type === 'card' ? 'card' : type === 'subst' ? 'subst' : type === 'var' ? 'var' : type,
      detail: e.detail || '', player: (e.player && e.player.name) || '', other: (e.assist && e.assist.name) || '' };
  }).filter(e => e.side);

  let best = null;
  ['home', 'away'].forEach(side => { const l = lineups[side]; if (!l) return; [...l.xi, ...l.subs].forEach(p => { if (p.rating != null && (!best || p.rating > best.rating)) best = { name: p.name, rating: p.rating, side }; }); });

  const has = events.length || Object.keys(lineups).length || stats.length;
  if (!has) return { v: 1, unavailable: true, fetchedAt: nowISO };
  return { v: 1, fetchedAt: nowISO,
    venue: fx.fixture && fx.fixture.venue && fx.fixture.venue.name ? { name: fx.fixture.venue.name, city: fx.fixture.venue.city || null } : null,
    referee: (fx.fixture && fx.fixture.referee) || null, events, lineups, stats, best };
}

/** Fetches details for finished matches whose API fixture id we know but whose details we do not have yet.
 *  At most `max` requests per run (1 credit each). An API error leaves the match to be tried again on the next run. */
export async function syncDetails(store, { getDetail, now = Date.now(), max = 3 } = {}) {
  const pending = await store.pendingDetails(max, new Date(now - 3 * 864e5).toISOString());
  if (!pending.length) return { calls: 0, saved: 0, unavailable: 0, errors: [], summary: 'no match details waiting' };
  // an API error (daily limit, plan restriction...) must not be repeated every 20 minutes: wait an hour after one
  const recent = await store.recentLogs(25).catch(() => []);
  const bad = recent.find(l => l.kind === 'sync-details' && l.detail && l.detail.errored && now - Date.parse(l.detail.checkedAt || l.at) < 60 * 60000);
  if (bad) return { calls: 0, saved: 0, unavailable: 0, errors: [], summary: 'match details paused for an hour after an API error' };
  let calls = 0, saved = 0, unavailable = 0; const errors = [];
  for (const p of pending) {
    let json;
    try { json = await getDetail(p.api_fixture_id); calls++; } catch (e) { errors.push(`${p.api_fixture_id}: ${String(e && e.message || e).slice(0, 100)}`); break; }
    const errs = json && json.errors && !Array.isArray(json.errors) ? Object.values(json.errors) : [];
    if (errs.length) { errors.push(`${p.api_fixture_id}: ${errs.join('; ').slice(0, 100)}`); break; }   // stop at the first API error
    const fx = json && json.response && json.response[0];
    const data = fx ? compactDetail(fx, new Date(now).toISOString()) : { v: 1, unavailable: true, fetchedAt: new Date(now).toISOString() };
    if (!data) { errors.push(`${p.api_fixture_id}: unusable answer`); break; }
    await store.saveDetail(p.match_id, data);
    if (data.unavailable) unavailable++; else saved++;
  }
  const summary = `Match details: ${saved} saved, ${unavailable} without data, ${calls} API request(s)` + (errors.length ? ' — ' + errors.join(' | ') : '');
  if (calls || errors.length) await store.addLog({ kind: 'sync-details', ok: !errors.length || calls > 0, summary, detail: { saved, unavailable, calls, errored: errors.length > 0, checkedAt: new Date(now).toISOString() } });
  return { calls, saved, unavailable, errors, summary };
}
