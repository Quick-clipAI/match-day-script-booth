// /api/zip-videos.js
// Downloads each rendered Sync.so video chunk and streams them back as a single
// ZIP archive, so the user can merge manually in their own editor if they'd
// rather not use the automatic /api/merge-video path. No ffmpeg involved here —
// this is a pure passthrough-and-zip, so it doesn't need the ffmpeg-static
// includeFiles/chmod treatment that split-audio.js and merge-video.js need.
//
// Request body: { videoUrls: string[] }  (ordered, chunk 0 first — same shape
// merge-video.js already uses)
// Response: application/zip on success (streamed, never buffered in full —
// archiver pipes directly to res), JSON { error } on failure.

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import archiver from 'archiver';

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } } // just a list of URLs, stays tiny
};

function sanitizeFileName(name) {
  if (!name || typeof name !== 'string') return null;
  var clean = name.replace(/[/\\:*?"<>|]/g, '').trim().slice(0, 150);
  if (!clean) return null;
  return /\.zip$/i.test(clean) ? clean : clean + '.zip';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var videoUrls = (req.body && req.body.videoUrls) || [];
  if (!Array.isArray(videoUrls) || videoUrls.length === 0) {
    return res.status(400).json({ error: 'videoUrls (non-empty array, in order) is required.' });
  }

  var fileName = sanitizeFileName(req.body && req.body.fileName) || 'match-day-video-clips.zip';

  var workDir = path.join(os.tmpdir(), 'vlab-zip-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(workDir, { recursive: true });

  try {
    // Download each chunk to disk first (same fetch-and-buffer-one-file-at-a-time
    // approach merge-video.js already uses — fine here since each chunk is small).
    var localPaths = [];
    for (var i = 0; i < videoUrls.length; i++) {
      var resp = await fetch(videoUrls[i]);
      if (!resp.ok) throw new Error('Could not download rendered chunk ' + i + ' (HTTP ' + resp.status + ').');
      var buf = Buffer.from(await resp.arrayBuffer());
      var p = path.join(workDir, 'part-' + i + '.mp4');
      fs.writeFileSync(p, buf);
      localPaths.push(p);
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fileName.replace(/"/g, "'") + '"');

    var archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', function (e) { res.destroy(e); });
    archive.on('end', function () {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
    });
    res.on('close', function () {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
    });

    // Pipe directly to res — archiver streams entries as they're added, it
    // never builds the full archive in memory first.
    archive.pipe(res);

    localPaths.forEach(function (p, idx) {
      // 1-indexed: more natural for a non-technical user reassembling clips in order.
      archive.file(p, { name: 'video' + (idx + 1) + '.mp4' });
    });

    await archive.finalize();
  } catch (err) {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Zipping failed: ' + (err && err.message) });
    }
    res.destroy(err);
  }
}
