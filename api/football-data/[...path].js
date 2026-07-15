// /api/football-data/[...path].js
// Server-side proxy for football-data.org (v4).
// Same pattern as /api/football — key stays server-side in FOOTBALL_DATA_API_KEY,
// same-origin call avoids CORS, and free-tier requests get a tiny edge cache.
//
// Usage from the frontend:
//   /api/football-data/matches?dateFrom=2026-07-15&dateTo=2026-07-15
//     -> https://api.football-data.org/v4/matches?dateFrom=...&dateTo=...
//   /api/football-data/competitions
//     -> https://api.football-data.org/v4/competitions
// Any path/query after /api/football-data/ is forwarded through untouched.
//
// Free tier covers 12 competitions (PL, PD, BL1, SA, FL1, CL, DED, PPL, ELC, EC, WC, BSA)
// at 10 requests/minute — the cache below helps stay under that during a live show.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: 'Server is missing FOOTBALL_DATA_API_KEY. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.'
    });
  }

  const { path = [] } = req.query;
  const upstreamPath = Array.isArray(path) ? path.join('/') : String(path);

  const params = new URLSearchParams(req.query);
  params.delete('path');
  const qs = params.toString();

  const url = `https://api.football-data.org/v4/${upstreamPath}${qs ? '?' + qs : ''}`;

  try {
    const upstream = await fetch(url, {
      headers: { 'X-Auth-Token': key }
    });
    const data = await upstream.json().catch(() => ({}));

    // football-data.org returns these on every response — pass them through so the
    // frontend can show "X requests left this minute" without a second round trip.
    var remaining = upstream.headers.get('x-requests-available-minute');
    if (remaining != null) res.setHeader('X-Requests-Available-Minute', remaining);

    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'Could not reach football-data.org: ' + (err && err.message) });
  }
}
