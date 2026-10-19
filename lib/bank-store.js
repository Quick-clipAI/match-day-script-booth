// lib/bank-store.js
// Two interchangeable stores with the same methods:
//   createMemoryStore()  used by tests
//   createSupabaseStore  talks to Supabase's REST interface with the server-only key.
// Only the server (never the browser) touches the bank tables.

import { norm } from './bank-core.js';

const MATCH_COLS = ['id', 'league', 'comp_name', 'season', 'round', 'date', 'time', 'kickoff', 'home', 'away', 'hg', 'ag', 'ht_h', 'ht_a', 'status', 'note', 'source', 'verified', 'conflict'];
export function cleanMatch(m) {
  const o = {};
  MATCH_COLS.forEach(c => { o[c] = m[c] === undefined ? null : m[c]; });
  o.verified = !!o.verified;
  return o;
}

function summarize(rows, todayISO) {
  const g = new Map();
  for (const m of rows) {
    const k = m.league + '|' + m.season;
    if (!g.has(k)) g.set(k, { league: m.league, season: m.season, total: 0, finished: 0, scheduled: 0, gaps: 0, postponed: 0, conflicts: 0, verified: 0, last_result: null, first_date: null, last_date: null });
    const s = g.get(k);
    s.total++;
    if (m.status === 'finished') { s.finished++; if (!s.last_result || m.date > s.last_result) s.last_result = m.date; }
    if (m.status === 'scheduled') { s.scheduled++; if (m.date < todayISO) s.gaps++; }
    if (m.status === 'postponed') s.postponed++;
    if (m.conflict) s.conflicts++;
    if (m.verified) s.verified++;
    if (!s.first_date || m.date < s.first_date) s.first_date = m.date;
    if (!s.last_date || m.date > s.last_date) s.last_date = m.date;
  }
  return [...g.values()].sort((a, b) => a.league.localeCompare(b.league) || b.season - a.season);
}
function clubsOf(rows) {
  const g = new Map();
  for (const m of rows) for (const c of [m.home, m.away]) {
    const k = m.league + '|' + c;
    if (!g.has(k)) g.set(k, { league: m.league, club: c, last_season: m.season, matches: 0 });
    const x = g.get(k); x.matches++; if (m.season > x.last_season) x.last_season = m.season;
  }
  return [...g.values()];
}

// ------------------------------------------------------------------ memory

export function createMemoryStore() {
  const matches = new Map(), aliases = new Map(), facts = new Map(), inbox = new Map(), players = new Map(), career = new Map();
  let logs = [], seq = 1;
  return {
    kind: 'memory',
    async listPlayers(f = {}) { let out = [...players.values()]; if (f.league) out = out.filter(p => p.league === f.league); if (f.season != null) out = out.filter(p => p.season === Number(f.season)); if (f.club) out = out.filter(p => norm(p.club) === norm(f.club)); return out.sort((a,b) => a.club.localeCompare(b.club) || a.name.localeCompare(b.name)); },
    async upsertPlayers(rows) { rows.forEach(p => players.set(p.id, { ...p })); return rows.length; },
    async deletePlayers(ids) { ids.forEach(id => players.delete(id)); return ids.length; },
    async listCareer() { return [...career.values()].map(r => ({ ...r, data: JSON.parse(JSON.stringify(r.data)) })).sort((a, b) => a.name.localeCompare(b.name)); },
    async upsertCareer(rows) { rows.forEach(r => career.set(r.id, JSON.parse(JSON.stringify(r)))); return rows.length; },
    async deleteCareer(ids) { ids.forEach(id => career.delete(id)); return ids.length; },
    async listMatches(f = {}) {
      let out = [...matches.values()];
      if (f.league) out = out.filter(m => m.league === f.league);
      if (f.season != null) out = out.filter(m => m.season === Number(f.season));
      if (f.club) { const c = norm(f.club); out = out.filter(m => norm(m.home) === c || norm(m.away) === c); }
      if (f.status) out = out.filter(m => m.status === f.status);
      if (f.fromDate) out = out.filter(m => m.date >= f.fromDate);
      if (f.toDate) out = out.filter(m => m.date <= f.toDate);
      out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || '') < (b.time || '') ? -1 : (a.time || '') > (b.time || '') ? 1 : a.id < b.id ? -1 : 1));
      return out.slice(0, f.limit || 100000).map(x => ({ ...x }));
    },
    async upsertMatches(rows) { rows.forEach(r => matches.set(r.id, cleanMatch(r))); return rows.length; },
    async deleteMatches(ids) { ids.forEach(i => matches.delete(i)); return ids.length; },
    async summary(todayISO) { return summarize([...matches.values()], todayISO); },
    async clubIndex() { return clubsOf([...matches.values()]); },
    async listAliases() { return [...aliases.values()]; },
    async upsertAliases(rows) { rows.forEach(r => aliases.set(r.alias, { alias: r.alias, canonical: r.canonical })); },
    async listFacts() { return [...facts.values()]; },
    async upsertFact(f) { const id = f.id || seq++; facts.set(id, { ...f, id }); return id; },
    async deleteFact(id) { facts.delete(id); },
    async addLog(e) { logs.unshift({ id: seq++, at: new Date().toISOString(), ...e }); logs = logs.slice(0, 200); },
    async recentLogs(n = 30) { return logs.slice(0, n); },
    async pruneLogs(days = 90) { const cut = Date.now() - days * 864e5; const before = logs.length; logs = logs.filter(l => new Date(l.at).getTime() >= cut); return before - logs.length; },
    async inboxList() { return [...inbox.values()].filter(x => !x.resolved); },
    async inboxAdd(items) { items.forEach(i => { if (!inbox.has(i.key)) inbox.set(i.key, { id: seq++, at: new Date().toISOString(), resolved: false, ...i }); }); },
    async inboxResolve(keys) { keys.forEach(k => { const x = inbox.get(k); if (x) x.resolved = true; }); }
  };
}

// ------------------------------------------------------------------ supabase

/** url: https://xxxx.supabase.co   key: the server-only secret key (never the public anon key). */
export function createSupabaseStore({ url, key, fetchImpl }) {
  const f = fetchImpl || fetch;
  const base = String(url || '').replace(/\/+$/, '') + '/rest/v1';
  const jwt = /^eyJ/.test(key || '');
  const headers = (extra) => ({ apikey: key, ...(jwt ? { Authorization: 'Bearer ' + key } : {}), 'Content-Type': 'application/json', ...extra });
  const enc = encodeURIComponent;

  async function req(method, path, { body, prefer, range } = {}) {
    const h = headers({ ...(prefer ? { Prefer: prefer } : {}), ...(range ? { Range: range, 'Range-Unit': 'items' } : {}) });
    const res = await f(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
    if (!res.ok) {
      const msg = (data && (data.message || data.hint || data.error)) || text.slice(0, 200) || ('HTTP ' + res.status);
      const err = new Error('Supabase ' + res.status + ': ' + msg);
      err.status = res.status; err.detail = data;
      throw err;
    }
    return data;
  }
  async function getAll(path) {            // pages of 1000 rows
    const out = [];
    for (let from = 0; from < 100000; from += 1000) {
      const page = await req('GET', path, { range: `${from}-${from + 999}` });
      if (!Array.isArray(page)) break;
      out.push(...page);
      if (page.length < 1000) break;
    }
    return out;
  }
  const chunks = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

  return {
    kind: 'supabase',
    async listMatches(fl = {}) {
      const q = [];
      if (fl.league) q.push('league=eq.' + enc(fl.league));
      if (fl.season != null) q.push('season=eq.' + Number(fl.season));
      if (fl.status) q.push('status=eq.' + enc(fl.status));
      if (fl.fromDate) q.push('date=gte.' + enc(fl.fromDate));
      if (fl.toDate) q.push('date=lte.' + enc(fl.toDate));
      if (fl.club) { const c = String(fl.club).replace(/[(),"]/g, ' '); q.push('or=(' + enc(`home.eq."${c}",away.eq."${c}"`) + ')'); }
      q.push('order=date.asc,time.asc.nullsfirst,id.asc');
      const rows = await getAll('/bank_matches?select=*&' + q.join('&'));
      return fl.limit ? rows.slice(0, fl.limit) : rows;
    },
    async upsertMatches(rows) {
      for (const part of chunks(rows.map(cleanMatch), 400)) {
        await req('POST', '/bank_matches?on_conflict=id', { body: part, prefer: 'resolution=merge-duplicates,return=minimal' });
      }
      return rows.length;
    },
    async deleteMatches(ids) {
      for (const part of chunks(ids, 50)) await req('DELETE', '/bank_matches?id=in.(' + part.map(i => enc('"' + i.replace(/"/g, '') + '"')).join(',') + ')', { prefer: 'return=minimal' });
      return ids.length;
    },
    async summary() { return (await getAll('/bank_summary?select=*&order=league.asc,season.desc')); },
    async clubIndex() { return (await getAll('/bank_clubs?select=*')); },
    async listAliases() { return (await getAll('/bank_aliases?select=*')); },
    async upsertAliases(rows) { if (rows.length) await req('POST', '/bank_aliases?on_conflict=alias', { body: rows, prefer: 'resolution=merge-duplicates,return=minimal' }); },
    async listFacts() { return (await getAll('/bank_facts?select=*&order=id.asc')); },
    async upsertFact(fact) {
      const body = { title: fact.title, body: fact.body, tags: fact.tags || [], as_of: fact.as_of || null, source: fact.source || null };
      if (fact.id) { await req('PATCH', '/bank_facts?id=eq.' + Number(fact.id), { body: { ...body, updated_at: new Date().toISOString() }, prefer: 'return=minimal' }); return fact.id; }
      const r = await req('POST', '/bank_facts', { body, prefer: 'return=representation' });
      return r && r[0] && r[0].id;
    },
    async deleteFact(id) { await req('DELETE', '/bank_facts?id=eq.' + Number(id), { prefer: 'return=minimal' }); },
    async addLog(e) { await req('POST', '/bank_log', { body: { kind: e.kind, ok: e.ok !== false, summary: String(e.summary || '').slice(0, 500), detail: e.detail || null }, prefer: 'return=minimal' }); },
    async recentLogs(n = 30) { return await req('GET', '/bank_log?select=*&order=id.desc&limit=' + Number(n)); },
    async pruneLogs(days = 90) { const cut = new Date(Date.now() - days * 864e5).toISOString(); await req('DELETE', '/bank_log?at=lt.' + enc(cut), { prefer: 'return=minimal' }); return 0; },
    async listPlayers(fl = {}) {
      const q = [];
      if (fl.league) q.push('league=eq.' + enc(fl.league));
      if (fl.season != null) q.push('season=eq.' + Number(fl.season));
      if (fl.club) q.push('club=eq.' + enc(String(fl.club)));
      q.push('order=club.asc,name.asc');
      return await getAll('/bank_players?select=*&' + q.join('&'));
    },
    async upsertPlayers(rows) {
      for (const part of chunks(rows, 400)) await req('POST', '/bank_players?on_conflict=id', { body: part, prefer: 'resolution=merge-duplicates,return=minimal' });
      return rows.length;
    },
    async deletePlayers(ids) {
      for (const part of chunks(ids, 50)) await req('DELETE', '/bank_players?id=in.(' + part.map(i => enc('"' + i.replace(/"/g, '') + '"')).join(',') + ')', { prefer: 'return=minimal' });
      return ids.length;
    },
    async listCareer() { return await getAll('/bank_career?select=*&order=name.asc'); },
    async upsertCareer(rows) {
      for (const part of chunks(rows, 100)) await req('POST', '/bank_career?on_conflict=id', { body: part, prefer: 'resolution=merge-duplicates,return=minimal' });
      return rows.length;
    },
    async deleteCareer(ids) {
      for (const part of chunks(ids, 50)) await req('DELETE', '/bank_career?id=in.(' + part.map(i => enc('"' + i.replace(/"/g, '') + '"')).join(',') + ')', { prefer: 'return=minimal' });
      return ids.length;
    },
    async inboxList() { return (await getAll('/bank_inbox?select=*&resolved=eq.false&order=id.asc')); },
    async inboxAdd(items) {
      if (!items.length) return;
      await req('POST', '/bank_inbox?on_conflict=key', { body: items.map(i => ({ key: i.key, league: i.league, season: i.season, team: i.team, row: i.row, reason: i.reason, resolved: false })), prefer: 'resolution=ignore-duplicates,return=minimal' });
    },
    async inboxResolve(keys) {
      for (const part of chunks(keys, 50)) await req('PATCH', '/bank_inbox?key=in.(' + part.map(k => enc('"' + k.replace(/"/g, '') + '"')).join(',') + ')', { body: { resolved: true }, prefer: 'return=minimal' });
    }
  };
}

let sharedMemory = null;
export function storeFromEnv(env = process.env) {
  if (env.BANK_STORE === 'memory') return { store: sharedMemory || (sharedMemory = createMemoryStore()) };   // tests only
  const url = (env.SUPABASE_URL || '').trim();
  const key = (env.SUPABASE_SERVICE_KEY || '').trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!url || !key) return { error: 'The server is missing ' + [!url && 'SUPABASE_URL', !key && 'SUPABASE_SERVICE_KEY'].filter(Boolean).join(' and ') + '. Add it in Vercel → Settings → Environment Variables, then redeploy.' };
  return { store: createSupabaseStore({ url, key }) };
}
