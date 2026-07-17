// /api/merge-video.js
// Takes the ordered list of Sync.so-rendered video chunk URLs, downloads them,
// concatenates with ffmpeg, and streams back the single merged video file
// (video/mp4) for direct download. Streamed rather than buffered into one
// res.send() call, since Vercel hard-caps every function's response body at
// 4.5MB regardless of maxDuration or any bodyParser config.
//
// Tries the fast path first: `-f concat -c copy` (stream copy, no re-encode —
// works when every chunk came from the same Sync.so model/settings and shares
// codec/resolution/fps, which is true here since it's always the same photo +
// model). Falls back to a full re-encode concat if stream copy fails for any
// reason (e.g. a chunk came back with a slightly different resolution).
//
// Request body: { videoUrls: string[] }  (ordered, chunk 0 first)
// Response: binary video/mp4 on success, JSON { error } on failure.

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } } // just a list of URLs, stays tiny
};

function sanitizeFileName(name) {
  if (!name || typeof name !== 'string') return null;
  var clean = name.replace(/[/\\:*?"<>|]/g, '').trim().slice(0, 150);
  if (!clean) return null;
  return /\.mp4$/i.test(clean) ? clean : clean + '.mp4';
}

function ensureExecutable() {
  try {
    var st = fs.statSync(ffmpegPath);
    if ((st.mode & 0o111) === 0) fs.chmodSync(ffmpegPath, 0o755);
  } catch (e) {}
}

function run(args) {
  return new Promise(function (resolve, reject) {
    execFile(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 256 }, function (err, stdout, stderr) {
      if (err && err.code && err.code !== 0) return reject(new Error(stderr || err.message));
      resolve({ stdout: stdout, stderr: stderr });
    });
  });
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

  var fileName = sanitizeFileName(req.body && req.body.fileName) || 'match-day-video.mp4';

  ensureExecutable();

  var workDir = path.join(os.tmpdir(), 'vlab-merge-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(workDir, { recursive: true });

  try {
    var localPaths = [];
    for (var i = 0; i < videoUrls.length; i++) {
      var resp = await fetch(videoUrls[i]);
      if (!resp.ok) throw new Error('Could not download rendered chunk ' + i + ' (HTTP ' + resp.status + ').');
      var buf = Buffer.from(await resp.arrayBuffer());
      var p = path.join(workDir, 'part-' + i + '.mp4');
      fs.writeFileSync(p, buf);
      localPaths.push(p);
    }

    var listFile = path.join(workDir, 'list.txt');
    fs.writeFileSync(listFile, localPaths.map(function (p) { return "file '" + p.replace(/'/g, "'\\''") + "'"; }).join('\n'));

    var outPath = path.join(workDir, 'final.mp4');

    try {
      // Fast path: no re-encode.
      await run(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-y', outPath]);
    } catch (copyErr) {
      // Fallback: re-encode concat, more forgiving of small mismatches between chunks.
      await run(['-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-c:a', 'aac', '-y', outPath]);
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fileName.replace(/"/g, "'") + '"');
    var stat = fs.statSync(outPath);
    res.setHeader('Content-Length', stat.size);
    var stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('error', function (e) { res.destroy(e); });
    // Clean up only after the stream finishes sending — deleting workDir
    // beforehand (e.g. in a `finally` here) would remove outPath mid-stream.
    stream.on('close', function () {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
    });
  } catch (err) {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
    return res.status(500).json({ error: 'Merging failed: ' + (err && err.message) });
  }
}
