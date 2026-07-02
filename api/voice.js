// api/voice.js – BOB voice: TTS (ElevenLabs) + STT (ElevenLabs speech-to-text).
// Env: ELEVENLABS_API_KEY. Falls back are signaled to the client (fallback:true)
// so the frontend can use the browser SpeechSynthesis / SpeechRecognition.
//
//   POST {text}                 → audio/mpeg  (TTS, default)
//   POST {action:'stt', audio}  → {text}      (audio = base64, ElevenLabs scribe)

const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = 'nPczCjzI2devNBz1zQrb'; // Brian (verified working with this account/key)
const TTS_MODEL = 'eleven_multilingual_v2';
// Erlaubte TTS-Modelle (per Request wählbar). Flash/Turbo sind deutlich schneller
// (niedrige Latenz) bei guter Qualität → Jarvis nutzt Flash für flüssige Sprachausgabe.
const TTS_MODELS = { eleven_multilingual_v2: 1, eleven_turbo_v2_5: 1, eleven_flash_v2_5: 1 };
const STT_MODEL = 'scribe_v1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!ELEVEN_KEY) return res.status(503).json({ error: 'Voice not configured', fallback: true });

  const body = req.body || {};
  if (body.action === 'stt') return await stt(res, body);
  return await tts(res, body);
}

async function tts(res, body) {
  const text = (body.text ? String(body.text) : '').trim();
  if (!text) return res.status(400).json({ error: 'text erforderlich' });
  const model = TTS_MODELS[body.model_id] ? body.model_id : TTS_MODEL;
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: text.slice(0, 2000),
        model_id: model,
        voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      let detail = t.slice(0, 240);
      try { const j = JSON.parse(t); detail = j.detail?.message || j.detail?.status || j.detail || detail; } catch {}
      console.error('TTS error', r.status, detail);
      return res.status(502).json({ error: 'TTS failed', fallback: true, upstream_status: r.status, detail });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buf);
  } catch (err) {
    return res.status(502).json({ error: err.message, fallback: true });
  }
}

async function stt(res, body) {
  const b64 = body.audio ? String(body.audio).split(',').pop() : '';
  if (!b64) return res.status(400).json({ error: 'audio erforderlich' });
  try {
    const buf = Buffer.from(b64, 'base64');
    // iPhone/Safari nimmt audio/mp4 auf, Chrome/Android audio/webm. Dateiname MUSS
    // zur MIME-Art passen, sonst erkennt ElevenLabs „scribe" das Format nicht (leerer Text).
    const mime = String(body.mime || 'audio/webm').split(';')[0].trim();
    const EXT = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a' };
    const ext = EXT[mime] || 'webm';
    const fd = new FormData();
    fd.append('model_id', STT_MODEL);
    fd.append('language_code', 'de');
    fd.append('file', new Blob([buf], { type: mime }), `audio.${ext}`);
    const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST', headers: { 'xi-api-key': ELEVEN_KEY }, body: fd,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('STT error', r.status, t.slice(0, 200));
      return res.status(502).json({ error: 'STT failed', fallback: true, upstream_status: r.status });
    }
    const d = await r.json();
    return res.status(200).json({ text: d.text || '' });
  } catch (err) {
    return res.status(502).json({ error: err.message, fallback: true });
  }
}
