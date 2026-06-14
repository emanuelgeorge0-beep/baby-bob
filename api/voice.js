// api/voice.js – BOB voice: TTS (ElevenLabs) + STT (ElevenLabs speech-to-text).
// Env: ELEVENLABS_API_KEY. Falls back are signaled to the client (fallback:true)
// so the frontend can use the browser SpeechSynthesis / SpeechRecognition.
//
//   POST {text}                 → audio/mpeg  (TTS, default)
//   POST {action:'stt', audio}  → {text}      (audio = base64, ElevenLabs scribe)

const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = 'nPczCjzI2devNBz1zQrb'; // Brian (verified working with this account/key)
const TTS_MODEL = 'eleven_multilingual_v2';
const STT_MODEL = 'scribe_v1';
// Bug 4: Sprachen, bei denen die Auto-Erkennung von multilingual_v2 mit der
// englisch/deutsch geprägten Stimme falsch lag (v.a. Spanisch). Für diese wird
// die Sprache via eleven_turbo_v2_5 + language_code hart erzwungen.
// DE/EN bleiben bewusst auf dem bewährten multilingual_v2 (keine Regression).
const FORCE_LANG_MODEL = 'eleven_turbo_v2_5';
const FORCE_LANGS = ['es', 'fr', 'it', 'pt', 'tr'];

// Normalisiert die vom Client gemeldete Sprache auf einen ISO-639-1-Code.
function normalizeLang(l) {
  const c = String(l || '').toLowerCase().slice(0, 2);
  if (c === 'ch') return 'de';
  return ['de', 'en', 'es', 'fr', 'it', 'pt', 'tr'].includes(c) ? c : '';
}

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
  const lang = normalizeLang(body.lang);
  const forceLang = lang && FORCE_LANGS.includes(lang);
  const payload = {
    text: text.slice(0, 2000),
    model_id: forceLang ? FORCE_LANG_MODEL : TTS_MODEL,
    voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
  };
  // language_code wird NUR von turbo/flash unterstützt – multilingual_v2 (DE/EN) würde 400 werfen.
  if (forceLang) payload.language_code = lang;
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(payload),
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
    const fd = new FormData();
    fd.append('model_id', STT_MODEL);
    fd.append('file', new Blob([buf], { type: body.mime || 'audio/webm' }), 'audio.webm');
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
