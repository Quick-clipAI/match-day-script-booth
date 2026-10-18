// /download  ->  the newest APK. Prefers Supabase Storage (fast on the phone), falls back to the GitHub release.
// vercel.json rewrites /download to this function.
const SB = (process.env.SUPABASE_URL || 'https://krmjvfemsufduqdofuqy.supabase.co').replace(/\/+$/, '');
const GH = 'https://github.com/Quick-clipAI/creator-booth-app/releases/download/latest/creator-booth.apk';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const sbUrl = SB + '/storage/v1/object/public/app-updates/creator-booth.apk';
  let target = GH;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(sbUrl, { method: 'HEAD', signal: ctl.signal }); clearTimeout(t);
    if (r.ok) target = sbUrl + '?download=creator-booth.apk';
  } catch (e) { /* Supabase copy not available: use GitHub */ }
  res.statusCode = 302; res.setHeader('Location', target); res.end();
}
