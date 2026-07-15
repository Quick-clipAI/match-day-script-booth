// /api/football/[...path].js
// Server-side proxy for API-Football (via RapidAPI).
// Solves two problems at once:
//   1. CORS — API-Football's docs don't promise browser CORS headers on most
//      endpoints, but a same-origin call to our own /api route never hits CORS.
//   2. Key exposure — the RapidAPI key stays in a Vercel env var (RAPIDAPI_KEY),
//      never sent to or stored in the browser.
//
// Usage from the frontend:
//   /api/football/status                -> https://api-football-v1.p.rapidapi.com/v3/status
//   /api/football/fixtures?live=all     -> https://api-football-v1.p.rapidapi.com/v3/fixtures?live=all
// Any path/query after /api/football/ is forwarded through untouched.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    return res.status(500).json({
      error: 'Server is missing RAPIDAPI_KEY. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.'
    });
  }

  const { path = [] } = req.query;
  const upstreamPath = Array.isArray(path) ? path.join('/') : String(path);

  // Rebuild the query string, dropping the catch-all "path" param Vercel injects.
  const params = new URLSearchParams(req.query);
  params.delete('path');
  const qs = params.toString();

  const url = `https://api-football-v1.p.rapidapi.com/v3/${upstreamPath}${qs ? '?' + qs : ''}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        'x-rapidapi-key': key,
        'x-rapidapi-host': 'api-football-v1.p.rapidapi.com'
      }
    });
    const data = await upstream.json().catch(() => ({}));
    // Cache lightweight, fast-changing data briefly at the edge to save on quota.
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'Could not reach API-Football: ' + (err && err.message) });
  }
}
