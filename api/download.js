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
    if (r.ok) {
      // Name the saved file after the app version (creator-booth-v1.3.9.apk) so each version is recognisable.
      let name = 'creator-booth.apk';
      try {
        const c2 = new AbortController(); const t2 = setTimeout(() => c2.abort(), 3000);
        const v = await fetch(SB + '/storage/v1/object/public/app-updates/version.json', { signal: c2.signal }); clearTimeout(t2);
        const j = v.ok ? await v.json() : null; const ver = j && (j.web || j.version);
        if (ver && /^\d+\.\d+\.\d+$/.test(String(ver))) name = 'creator-booth-v' + ver + '.apk';
      } catch (e) { /* keep the plain name */ }
      target = sbUrl + '?download=' + encodeURIComponent(name);
    }
  } catch (e) { /* Supabase copy not available: use GitHub */ }
  res.statusCode = 302; res.setHeader('Location', target); res.end();
}
