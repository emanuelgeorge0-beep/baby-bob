// api/bob-chat.js – BOB conversational follow-up (Final item 4 + Schweizerdeutsch item 10)
// Multi-turn chat after a B2C diagnosis. Keeps the last ~5 exchanges as context.
// Default tone: friendly Swiss-flavored German (CH-DE). Other langs → standard.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const LANG_NAME = { de: 'Deutsch', en: 'English', fr: 'Français', es: 'Español', it: 'Italiano', pt: 'Português', tr: 'Türkçe', sq: 'Shqip', sr: 'Srpski/Hrvatski' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Claude not configured' });

  try {
    const { messages, context, lang } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages erforderlich' });

    // Keep only the last 6 messages (≈5 exchanges) and normalise.
    const history = messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    if (!history.length || history[0].role !== 'user') history.unshift({ role: 'user', content: 'Hallo' });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 700, system: buildSystem(context, lang), messages: history }),
    });
    if (!r.ok) throw new Error('Claude API: ' + r.status);
    const d = await r.json();
    const reply = d.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return res.status(200).json({ reply: reply || 'Sorry, da ha ich grad nüt verstande. Chasch das nomal säge?' });
  } catch (err) {
    console.error('BOB-Chat Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

function buildSystem(context, lang) {
  const ctx = context
    ? `\n\nKONTEXT (BOBs vorherigi Diagnose): ${typeof context === 'string' ? context : JSON.stringify(context)}. Beziäh dich druf, wenn passend.`
    : '';

  // Swiss-flavored German for the default (de). Other languages → standard.
  if (!lang || lang === 'de' || lang === 'ch') {
    return `Du bisch BOB, en fründliche, kompetente Schwiizer Handwerks-Experte. Du hilfsch Privatpersone bi Handwerker-Probleme (Sanitär, Heizig, Elektro, Fliese, Maler, Dach, Garte, usw.).

TON: Fründlich, locker, schwiizerisch gfärbts Hochdütsch (CH-DE). Bruuch typischi Usdrück wie "Grüezi", "Merci vilmal", "Alles guet?", "lueg emal", und säg "Ich ha das gfunde..." statt "Ich habe gefunden...". ABER kei volle Dialekt (nid extrem Züri/Bärn/Basler) – eifach sympathisch schwiizerisch. Immer Du-Form.

INHALT: Churz und praktisch. Gib konkreti Tipps, näme CHF-Priise wenn sinnvoll, und säg ehrlich wenn me en Profi bruucht. Bi Sicherheits-Sache (Gas, Strom fest verdrahtet, Wasserleitig i de Wand) immer uf Fachmaa verwiise.${ctx}`;
  }

  const name = LANG_NAME[lang] || 'the user\'s language';
  return `You are BOB, a friendly and competent Swiss handyman expert helping private individuals with home/trade problems (plumbing, heating, electrical, tiling, painting, roofing, garden, etc.).
Reply in ${name}. Tone: warm, friendly, informal. Keep it short and practical, give concrete tips, mention CHF prices when useful, and be honest when a professional is needed (especially for gas, fixed electrical wiring, in-wall water pipes — always refer to a pro).${ctx}`;
}
