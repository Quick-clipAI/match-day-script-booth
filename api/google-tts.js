// /api/google-tts.js
// Server-side proxy for Google Cloud's Text-to-Speech API. Used as the backup
// voiceover engine when ElevenLabs isn't configured or its free quota is used up.
// Requires a Google Cloud project with billing enabled and the Text-to-Speech
// API turned on (console.cloud.google.com/billing — a separate, older system
// from the AI Studio "Set up billing" flow, so it isn't affected by that flow's
// current OR_BACR2_44 bug). Stays free within 1M characters/month for
// Neural2/WaveNet voices. The key lives in a Vercel environment variable.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Server is missing GOOGLE_TTS_API_KEY.' });
  }

  const { text, languageCode, voiceName, speakingRate } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'No text provided.' });
  }

  const body = {
    input: { text },
    voice: {
      languageCode: languageCode || 'en-GB',
      name: voiceName || 'en-GB-Neural2-B'
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: Math.min(2, Math.max(0.5, Number(speakingRate) || 1))
    }
  };

  try {
    const upstream = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const msg = (data && data.error && data.error.message) || `Google TTS error ${upstream.status}`;
      return res.status(upstream.status).json({ error: msg });
    }
    if (!data.audioContent) {
      return res.status(502).json({ error: 'Google TTS returned no audio content.' });
    }
    return res.status(200).json({ audioContent: data.audioContent });
  } catch (err) {
    return res.status(502).json({ error: 'Could not reach Google Cloud TTS: ' + (err && err.message) });
  }
}
