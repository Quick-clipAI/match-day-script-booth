// lib/crests.js  — API-Football team ids for club names, so the app can show club crests.
// Names differ between competitions ("Leipzig" in the Europa League, "RB Leipzig" in the Bundesliga), so a name is looked up
// 1) exactly, 2) through bank_aliases, 3) by its distinctive words (club-form words like FC, AC, RB, 1899 are ignored).
// A name only gets a crest when exactly one club fits; otherwise it gets none (the app then shows its letter badge).

const GENERIC = new Set(['fc', 'cf', 'ac', 'as', 'sc', 'afc', 'ssc', 'us', 'vfb', 'vfl', 'tsg', 'fsv', 'sv', 'rb', 'club', 'de', 'calcio', 'football', 'fk', 'sk', 'bk', 'if', 'cd', 'ud', 'rc', 'rcd', 'ca', 'ss', 'cs', '1899', '1907', '1909', '1913', '1901', '1910', '04', '05', '07', '09', '29', '96']);
export const crestKey = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).filter(t => !GENERIC.has(t)).join(' ');
const plain = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** names: club names as written in a competition. Returns { name: apiTeamId } for the names that could be matched. */
export async function crestIds(store, names) {
  const out = {}; const want = [...new Set((names || []).filter(Boolean))]; if (!want.length) return out;
  let rows = [], aliases = [];
  try { rows = store.listTeamIds ? await store.listTeamIds() : []; } catch (e) { rows = []; }
  try { aliases = store.listAliases ? await store.listAliases() : []; } catch (e) { aliases = []; }
  const ids = rows.filter(r => r && r.club && r.api_team_id);
  const exact = new Map(ids.map(r => [r.club, r.api_team_id]));
  const byPlain = new Map(); ids.forEach(r => { byPlain.set(plain(r.club), r.api_team_id); if (r.api_name) byPlain.set(plain(r.api_name), r.api_team_id); });
  const aliasMap = new Map(aliases.map(a => [plain(a.alias), a.canonical]));
  const byKey = new Map();                       // distinctive words -> set of ids (ambiguous when more than one)
  ids.forEach(r => [r.club, r.api_name].forEach(n => { const k = crestKey(n); if (!k) return; if (!byKey.has(k)) byKey.set(k, new Set()); byKey.get(k).add(r.api_team_id); }));
  for (const n of want) {
    let id = exact.get(n) || byPlain.get(plain(n));
    if (!id) { const c = aliasMap.get(plain(n)); if (c) id = exact.get(c) || byPlain.get(plain(c)); }
    if (!id) { const set = byKey.get(crestKey(n)); if (set && set.size === 1) id = [...set][0]; }
    if (id) out[n] = id;
  }
  return out;
}
