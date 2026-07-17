// /api/split-audio.js
// Splits a voiceover audio file into ~20-25s chunks for the Video Lab tab, cutting
// only at detected silence (never mid-word) so each chunk is safe to hand to
// Sync.so individually. Pure signal processing (ffmpeg's silencedetect filter) —
// no AI/LLM model involved.
//
// Two modes, same endpoint:
//   1. Auto mode (default): server runs silencedetect and picks split points itself.
//   2. Manual mode: pass `manualSplits: [12.4, 34.0, ...]` (seconds, interior cut
//      points only — not 0 or the final duration) to re-slice using exact points
//      the user dragged in the frontend waveform, instead of the auto-detected ones.
//
// Body: { audioBase64: string (raw base64 or data: URI), mimeType?: string,
//          manualSplits?: number[] }
// Response: { duration, chunks: [{ index, startTime, endTime, audioBase64, mimeType }] }
//
// NOTE ON VERCEL + ffmpeg-static:
// The binary shipped by ffmpeg-static sometimes loses its executable bit once it
// travels through Vercel's build bundler (@vercel/nft), and @vercel/nft doesn't
// always trace the binary automatically since it's referenced via a plain fs path
// rather than a require(). Two mitigations are applied here:
//   - vercel.json explicitly lists node_modules/ffmpeg-static/** under
//     functions.includeFiles so the binary is guaranteed to ship in the bundle.
//   - We defensively chmod +x it on cold start (see ensureExecutable() below).
// If deploys still 500 with "spawn ENOENT" or "EACCES", that's this exact issue —
// see the "ffmpeg-static on Vercel" note in the handoff report.

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

const TARGET_SECONDS = 22.5;   // midpoint of the requested 20-25s window
const MIN_SECONDS = 20;
const MAX_SECONDS = 25;
const SEARCH_SLACK = 6;        // how far past MAX_SECONDS we'll look for a silence gap
                                 // before giving up and hard-cutting at the target
const MIN_TAIL_SECONDS = 8;     // a trailing remainder shorter than this gets merged
                                 // into the previous chunk instead of becoming its own tiny chunk
const SILENCE_NOISE_DB = '-30dB';
const SILENCE_MIN_DUR = 0.35;   // seconds of continuous quiet to count as a "pause"

function ensureExecutable() {
  try {
    const st = fs.statSync(ffmpegPath);
    if ((st.mode & 0o111) === 0) fs.chmodSync(ffmpegPath, 0o755);
  } catch (e) {
    // If this fails, the run() call below will throw a clearer error momentarily.
  }
}

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      // ffmpeg writes progress/info to stderr even on success, so we always return
      // stderr and only reject on a genuine non-zero exit that isn't from `-f null -`.
      if (err && err.code && err.code !== 0) return reject(new Error(stderr || err.message));
      resolve({ stdout, stderr });
    });
  });
}

function parseDurationSeconds(stderrText) {
  var m = stderrText.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

function parseSilenceGaps(stderrText) {
  var gaps = [];
  var starts = [...stderrText.matchAll(/silence_start:\s*([\d.]+)/g)].map(function (m) { return parseFloat(m[1]); });
  var ends = [...stderrText.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)]
    .map(function (m) { return { end: parseFloat(m[1]), duration: parseFloat(m[2]) }; });
  // Pair them up in order; a trailing silence_start with no matching silence_end
  // (silence runs to EOF) is dropped since a cut point there is moot.
  for (var i = 0; i < Math.min(starts.length, ends.length); i++) {
    gaps.push({ start: starts[i], end: ends[i].end });
  }
  return gaps;
}

function pickAutoSplitPoints(duration, gaps) {
  var points = [];
  var cursor = 0;
  // Keep cutting as long as what's left is bigger than one target-sized chunk.
  while (duration - cursor > MAX_SECONDS) {
    var idealTarget = cursor + TARGET_SECONDS;
    var windowLo = cursor + MIN_SECONDS;
    var windowHi = cursor + MAX_SECONDS;

    // Prefer a silence gap whose midpoint lands in [windowLo, windowHi]; if none,
    // widen the search by SEARCH_SLACK before falling back to a hard cut.
    var best = null, bestDist = Infinity;
    gaps.forEach(function (g) {
      var mid = (g.start + g.end) / 2;
      if (mid <= cursor) return; // already behind us
      if (mid >= windowLo - 1 && mid <= windowHi + SEARCH_SLACK) {
        var dist = Math.abs(mid - idealTarget);
        if (dist < bestDist) { bestDist = dist; best = mid; }
      }
    });

    var cut = best !== null ? best : idealTarget; // hard cut = last resort, no silence found nearby
    if (cut <= cursor + 1) break; // safety valve against infinite loop on tiny/degenerate audio

    // If cutting here would leave a trailing sliver too small to stand on its own,
    // stop instead and let that sliver ride along with the chunk we're currently
    // building (better one slightly-long final chunk than one tiny orphan chunk).
    if (duration - cut < MIN_TAIL_SECONDS) break;

    points.push(cut);
    cursor = cut;
  }
  return points;
}

function b64ToBuffer(b64) {
  var clean = b64.indexOf('base64,') !== -1 ? b64.slice(b64.indexOf('base64,') + 7) : b64;
  return Buffer.from(clean, 'base64');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var body = req.body || {};
  var audioBase64 = body.audioBase64;
  var mimeType = body.mimeType || 'audio/mpeg';
  var manualSplits = Array.isArray(body.manualSplits) ? body.manualSplits.slice().sort(function (a, b) { return a - b; }) : null;

  if (!audioBase64) return res.status(400).json({ error: 'No audioBase64 provided.' });

  ensureExecutable();

  var workDir = path.join(os.tmpdir(), 'vlab-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(workDir, { recursive: true });
  var ext = mimeType.indexOf('wav') !== -1 ? 'wav' : (mimeType.indexOf('ogg') !== -1 ? 'ogg' : 'mp3');
  var inputPath = path.join(workDir, 'input.' + ext);

  try {
    fs.writeFileSync(inputPath, b64ToBuffer(audioBase64));

    // Probe duration (and, in auto mode, silence gaps) in one pass.
    var probe = await run(['-i', inputPath, '-af', 'silencedetect=noise=' + SILENCE_NOISE_DB + ':d=' + SILENCE_MIN_DUR, '-f', 'null', '-']);
    var duration = parseDurationSeconds(probe.stderr);
    if (!duration) throw new Error('Could not read audio duration — the uploaded file may be corrupt or in an unsupported format.');

    var splitPoints;
    var usedManual = false;
    if (manualSplits && manualSplits.length) {
      splitPoints = manualSplits.filter(function (t) { return t > 0.1 && t < duration - 0.1; });
      usedManual = true;
    } else {
      var gaps = parseSilenceGaps(probe.stderr);
      splitPoints = pickAutoSplitPoints(duration, gaps);
    }

    var bounds = [0].concat(splitPoints, [duration]);
    var chunks = [];
    for (var i = 0; i < bounds.length - 1; i++) {
      var start = bounds[i], end = bounds[i + 1];
      var outPath = path.join(workDir, 'chunk-' + i + '.mp3');
      // -ss before -i on the *output* side of a re-encode wouldn't be accurate for
      // compressed input, so we seek+trim with accurate (post-input) -ss/-to and
      // re-encode to a clean mp3 — this guarantees a real cut at that exact sample
      // rather than snapping to the nearest keyframe/frame boundary.
      await run(['-i', inputPath, '-ss', String(start), '-to', String(end), '-acodec', 'libmp3lame', '-b:a', '128k', '-y', outPath]);
      var chunkBuf = fs.readFileSync(outPath);
      chunks.push({
        index: i,
        startTime: Math.round(start * 100) / 100,
        endTime: Math.round(end * 100) / 100,
        audioBase64: chunkBuf.toString('base64'),
        mimeType: 'audio/mpeg'
      });
    }

    return res.status(200).json({
      duration: Math.round(duration * 100) / 100,
      mode: usedManual ? 'manual' : 'auto',
      splitPoints: bounds.slice(1, -1),
      chunks: chunks
    });
  } catch (err) {
    return res.status(500).json({ error: 'Audio splitting failed: ' + (err && err.message) });
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
  }
}
