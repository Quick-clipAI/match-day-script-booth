// /api/sync-status.js
// Polls Sync.so for the status of a job created by /api/sync-generate.js and
// returns a normalized shape so the frontend doesn't need to know Sync.so's
// exact field names or status vocabulary.
//
// Sync.so's documented statuses are: PENDING, PROCESSING, COMPLETED, FAILED, REJECTED.
// Its "Get Generation" endpoint is GET https://api.sync.so/v2/generation/{id}.
// The finished video's URL comes back as `outputUrl` (confirmed from the official
// TypeScript SDK's `generation.outputUrl`; the Python SDK exposes the same field
// as `output_url` — same underlying REST field, just language-idiomatic casing on
// each SDK's side). If Sync.so ever renames this field, update OUTPUT_URL_KEYS below.
//
// Request: GET /api/sync-status?jobId=... (or POST { jobId })
// Response: { status: 'processing'|'done'|'failed', videoUrl?, error?, raw }

const OUTPUT_URL_KEYS = ['outputUrl', 'output_url'];

export default async function handler(req, res) {
  var jobId = (req.method === 'GET' ? req.query.jobId : (req.body && req.body.jobId));
  if (!jobId) return res.status(400).json({ error: 'jobId is required.' });

  var key = process.env.SYNC_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server is missing SYNC_API_KEY.' });

  try {
    var upstream = await fetch('https://api.sync.so/v2/generation/' + encodeURIComponent(jobId), {
      headers: { 'x-api-key': key }
    });

    if (upstream.status === 429) {
      // Surfaced as-is so the frontend's orchestration loop can back off ~10s and retry.
      return res.status(429).json({ error: 'Rate limited by Sync.so.' });
    }

    var data = await upstream.json().catch(function () { return {}; });

    if (!upstream.ok) {
      var msg = (data && (data.message || (data.error && data.error.message))) || ('Sync.so error ' + upstream.status);
      return res.status(upstream.status).json({ error: msg, raw: data });
    }

    var rawStatus = (data.status || '').toUpperCase();
    var normalized = 'processing';
    if (rawStatus === 'COMPLETED') normalized = 'done';
    else if (rawStatus === 'FAILED' || rawStatus === 'REJECTED') normalized = 'failed';

    var videoUrl = null;
    for (var i = 0; i < OUTPUT_URL_KEYS.length; i++) {
      if (data[OUTPUT_URL_KEYS[i]]) { videoUrl = data[OUTPUT_URL_KEYS[i]]; break; }
    }

    return res.status(200).json({
      status: normalized,
      rawStatus: rawStatus,
      videoUrl: normalized === 'done' ? videoUrl : null,
      error: normalized === 'failed' ? (data.errorMessage || data.error || 'Generation failed or was rejected by Sync.so.') : null,
      raw: data
    });
  } catch (err) {
    return res.status(502).json({ error: 'Could not reach Sync.so: ' + (err && err.message) });
  }
}
