// /api/search?q=...&topic=news|general&range=day|week|month|year&trusted=1&n=5
// Web search for football questions, powered by Tavily (free plan: 1,000 credits a month, 1 credit per
// basic search). Returns only titles, links and short snippets, never whole articles.
//
// Set TAVILY_API_KEY in Vercel (Settings -> Environment Variables), then redeploy.

const TRUSTED_SITES = [
  'bbc.com', 'bbc.co.uk', 'soccernet.ng', 'skysports.com', 'theguardian.com', 'espn.com', 'uefa.com', 'fifa.com',
  'premierleague.com', 'transfermarkt.com', 'goal.com', 'reuters.com', 'apnews.com', 'theathletic.com'
];
const RANGE_DAYS = { day: 1, week: 7, month: 30, year: 365 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const key = String(process.env.TAVILY_API_KEY || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!key) {
    return res.status(500).json({ error: 'TAVILY_API_KEY is not set. Create a free key at tavily.com, add it in Vercel -> Settings -> Environment Variables, then redeploy.' });
  }

  let params = new URLSearchParams();
  try { params = new URL(String(req.url || ''), 'http://localhost').searchParams; } catch (e) { /* use req.query below */ }
  const q = (k) => params.get(k) || (req.query && req.query[k] != null ? String(Array.isArray(req.query[k]) ? req.query[k][0] : req.query[k]) : '');

  const query = q('q').trim();
  if (query.length < 3 || query.length > 200) return res.status(400).json({ error: 'Give a search question between 3 and 200 characters (?q=...).' });
  const topic = q('topic') === 'news' ? 'news' : 'general';
  const range = Object.prototype.hasOwnProperty.call(RANGE_DAYS, q('range')) ? q('range') : '';
  const n = Math.min(8, Math.max(1, parseInt(q('n'), 10) || 5));
  const trusted = q('trusted') === '1';

  const body = { query, search_depth: 'basic', max_results: n, topic, include_answer: false, include_raw_content: false, include_usage: true };
  if (range) { if (topic === 'news') body.days = RANGE_DAYS[range]; else body.time_range = range; }
  if (trusted) body.include_domains = TRUSTED_SITES;

  let r, data;
  try {
    r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
    data = await r.json().catch(() => null);
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach Tavily: ' + (e && e.message ? e.message : e) });
  }

  if (!r.ok) {
    const detail = data && (data.detail && (data.detail.error || data.detail) || data.error || data.message);
    const reason = r.status === 401 || r.status === 403 ? 'Tavily rejected the API key.'
      : r.status === 429 ? 'Tavily says too many requests right now. Try again in a moment.'
      : r.status === 432 || r.status === 433 ? 'Your Tavily plan limit has been reached for this month.'
      : 'Tavily returned an error (HTTP ' + r.status + ').';
    return res.status(r.status === 401 || r.status === 403 ? 401 : r.status === 429 ? 429 : 502).json({ error: reason, detail: typeof detail === 'string' ? detail : null });
  }

  const results = (data && Array.isArray(data.results) ? data.results : []).map((x) => {
    let site = '';
    try { site = new URL(x.url).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ }
    const text = String(x.content || '').replace(/\s+/g, ' ').trim();
    return {
      title: String(x.title || site || 'Untitled').slice(0, 200),
      url: String(x.url || ''),
      site,
      snippet: text.length > 400 ? text.slice(0, 397) + '...' : text,
      publishedDate: x.published_date || null,
      score: typeof x.score === 'number' ? Math.round(x.score * 100) / 100 : null
    };
  }).filter((x) => /^https?:\/\//.test(x.url));

  return res.status(200).json({
    query, topic, range: range || null, trustedSitesOnly: trusted,
    creditsUsed: data && data.usage && typeof data.usage.credits === 'number' ? data.usage.credits : 1,
    results
  });
}
