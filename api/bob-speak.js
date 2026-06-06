// api/bob-speak.js – ElevenLabs TTS for BOB's voice (JARVIS-like).
// POST {text} → returns audio/mpeg. Frontend falls back to SpeechSynthesis
// if this returns non-200 (missing key, rate limit, etc.).

const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = 'nPczCjzI2devNBz1zQrb';
const MODEL = 'eleven_multilingual_v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // No key → tell the client to use its SpeechSynthesis fallback.
  if (!ELEVEN_KEY) return res.status(503).json({ error: 'TTS not configured', fallback: true });

  const text = (req.body && req.body.text ? String(req.body.text) : '').trim();
  if (!text) return res.status(400).json({ error: 'text erforderlich' });

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: text.slice(0, 2000),
        model_id: MODEL,
        // Warm, confident, deliberate (JARVIS-like).
        voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('ElevenLabs error:', r.status, t.slice(0, 300));
      // Surface upstream status + sanitized detail (no secrets) for diagnosis.
      let detail = t.slice(0, 240);
      try { const j = JSON.parse(t); detail = j.detail?.message || j.detail?.status || j.detail || j.message || detail; } catch {}
      return res.status(502).json({ error: 'TTS failed', fallback: true, upstream_status: r.status, detail });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('bob-speak error:', err.message);
    return res.status(502).json({ error: err.message, fallback: true });
  }
}
