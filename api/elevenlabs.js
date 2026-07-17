// /api/elevenlabs.js
// Server-side proxy for ElevenLabs' text-to-speech endpoint. Used as the primary
// voiceover engine when configured; the app falls back to Edge TTS / Puter.js /
// the browser's built-in voice automatically if this isn't set up or its
// (10k-characters/month free tier) quota runs out.
// Keys live in Vercel environment variables, never in the browser.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voiceId) {
    // Deliberately a distinct message from a real ElevenLabs error, so the
    // frontend can tell "not configured" apart from "quota hit" if it ever needs to.
    return res.status(500).json({ error: 'Server is missing ELEVENLABS_API_KEY and/or ELEVENLABS_VOICE_ID.' });
  }

  const text = (req.body && req.body.text) || '';
  if (!text.trim()) {
    return res.status(400).json({ error: 'No text provided.' });
  }

  // Pronunciation dictionary (for player names, "semi-final", etc.) is optional —
  // create one in the ElevenLabs dashboard, then set both env vars to attach it.
  const dictId = process.env.ELEVENLABS_DICTIONARY_ID;
  const dictVersionId = process.env.ELEVENLABS_DICTIONARY_VERSION_ID;

  const body = {
    text,
    model_id: 'eleven_flash_v2_5',
    // Tuned for a calm, consistent commentator tone rather than a swingy,
    // over-exaggerated one: stability high-ish, style exaggeration near zero.
    voice_settings: { stability: 0.68, similarity_boost: 0.75, style: 0.05, use_speaker_boost: true }
  };
  if (dictId && dictVersionId) {
    body.pronunciation_dictionary_locators = [{ pronunciation_dictionary_id: dictId, version_id: dictVersionId }];
  }

  try {
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': key, 'Accept': 'audio/mpeg' },
      body: JSON.stringify(body)
    });

    if (!upstream.ok) {
      const errData = await upstream.json().catch(() => ({}));
      const msg = (errData && errData.detail && (errData.detail.message || errData.detail)) || `ElevenLabs error ${upstream.status}`;
      return res.status(upstream.status).json({ error: msg });
    }

    const arrayBuf = await upstream.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    return res.status(200).send(Buffer.from(arrayBuf));
  } catch (err) {
    return res.status(502).json({ error: 'Could not reach ElevenLabs: ' + (err && err.message) });
  }
}
