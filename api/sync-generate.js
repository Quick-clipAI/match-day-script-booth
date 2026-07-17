// /api/sync-generate.js
// Submits ONE audio chunk + the static presenter photo to Sync.so's /v2/generate
// and returns the job id immediately — it does NOT wait for the render to finish.
// The frontend polls /api/sync-status.js for completion. This keeps every call to
// this function short (well under the 60s maxDuration) and is what lets the
// orchestration stay sequential and rate-limit-safe (see index.html Video Lab tab).
//
// Env var required: SYNC_API_KEY (from sync.so dashboard -> API Keys). Never hardcode.
//
// SYNC.SO API QUIRK / ASSUMPTION (flagged clearly, see handoff report point 5):
// Sync.so's documented "Create Generation with Files" variant of POST /v2/generate
// accepts direct multipart file uploads (max 20MB/file) instead of public URLs,
// which is exactly what we need since our photo + chunk audio only exist as
// in-memory bytes with nowhere public to host them. Sync.so's own docs describe
// this variant only in terms of a "video file" part and an "audio file" part —
// there is no separately documented "image file" part, even though the general
// (URL-based) endpoint explicitly supports type:"image" inputs alongside type:"video".
// We send the still photo through the `video` file field, since that's the only
// documented visual-input slot for direct file upload, and Sync.so's models are
// built to accept a single still frame there. If Sync.so's API rejects this (e.g.
// with an "unsupported input" or format error), the fix is almost certainly to
// switch to the URL-based /v2/generate call with `input:[{type:"image",...}]`,
// which requires giving the photo a public URL first (e.g. upload it once to any
// object storage/CDN when the user sets up Video Lab, then just pass that URL here
// forever, since the photo is static and reused every time anyway).
//
// Request body from frontend: { photoBase64, photoMimeType, audioBase64, audioMimeType,
//                                model?, outputFileName? }
// Response: { jobId, status, raw }

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

function b64ToBuffer(b64) {
  var clean = b64.indexOf('base64,') !== -1 ? b64.slice(b64.indexOf('base64,') + 7) : b64;
  return Buffer.from(clean, 'base64');
}

function extFromMime(mime) {
  if (!mime) return 'bin';
  if (mime.indexOf('png') !== -1) return 'png';
  if (mime.indexOf('jpeg') !== -1 || mime.indexOf('jpg') !== -1) return 'jpg';
  if (mime.indexOf('webp') !== -1) return 'webp';
  if (mime.indexOf('wav') !== -1) return 'wav';
  if (mime.indexOf('ogg') !== -1) return 'ogg';
  return 'mp3';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var key = process.env.SYNC_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server is missing SYNC_API_KEY.' });

  var body = req.body || {};
  var photoBase64 = body.photoBase64;
  var audioBase64 = body.audioBase64;
  if (!photoBase64 || !audioBase64) {
    return res.status(400).json({ error: 'Both photoBase64 and audioBase64 are required.' });
  }

  var model = body.model || 'lipsync-2';
  var outputFileName = (body.outputFileName || ('videolab-' + Date.now())).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 255);

  try {
    var form = new FormData();
    form.append('model', model);
    form.append('options', JSON.stringify({ sync_mode: 'cut_off' }));
    form.append('output_file_name', outputFileName);

    var photoBuf = b64ToBuffer(photoBase64);
    var audioBuf = b64ToBuffer(audioBase64);
    form.append('video', new Blob([photoBuf], { type: body.photoMimeType || 'image/jpeg' }), 'presenter.' + extFromMime(body.photoMimeType));
    form.append('audio', new Blob([audioBuf], { type: body.audioMimeType || 'audio/mpeg' }), 'chunk.' + extFromMime(body.audioMimeType));

    var upstream = await fetch('https://api.sync.so/v2/generate', {
      method: 'POST',
      headers: { 'x-api-key': key },
      body: form
    });

    var data = await upstream.json().catch(function () { return {}; });

    if (!upstream.ok) {
      var msg = (data && (data.message || (data.error && data.error.message))) || ('Sync.so error ' + upstream.status);
      return res.status(upstream.status).json({ error: msg, raw: data });
    }

    return res.status(200).json({ jobId: data.id, status: data.status, raw: data });
  } catch (err) {
    return res.status(502).json({ error: 'Could not reach Sync.so: ' + (err && err.message) });
  }
}
