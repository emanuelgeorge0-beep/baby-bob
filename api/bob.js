// api/bob.js – Baby BOB Serverless Function
// Vercel Serverless Function – API Key sicher hier, nie im Browser

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { description, imageBase64, category } = req.body || {};

    let wissen = '';
    try {
      const searchTerm = buildSearchTerm(description, category);
      const supaRes = await fetch(
        `${SUPABASE_URL}/rest/v1/bob_knowledge?inhalt=ilike.*${encodeURIComponent(searchTerm)}*&limit=8&select=titel,inhalt,kategorie,unterkategorie,tags`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      if (supaRes.ok) {
        const rows = await supaRes.json();
        if (rows && rows.length > 0) {
          wissen = rows.map(r =>
            `[${r.kategorie} / ${r.unterkategorie}] ${r.titel}: ${r.inhalt}`
          ).join('\n\n');
        }
      }
    } catch (e) {}

    const systemPrompt = buildSystemPrompt(wissen);

    const userContent = [];
    if (imageBase64) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
      });
    }

    const userText = [
      description ? `Problembeschreibung: ${description}` : '',
      category    ? `Kategorie-Hinweis: ${category}` : '',
    ].filter(Boolean).join('\n');

    userContent.push({ type: 'text', text: userText || 'Analysiere das Problem.' });

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!claudeRes.ok) throw new Error('Claude API: ' + claudeRes.status);

    const claudeData = await claudeRes.json();
    const raw = claudeData.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const result = safeParseJSON(raw);
    if (!result) throw new Error('JSON Parse Error');

    return res.status(200).json(result);

  } catch (err) {
    console.error('BOB API Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

function buildSearchTerm(description, category) {
  const text = [description || '', category || ''].join(' ').toLowerCase();
  const keywords = [
    'sanitär','heizung','elektro','fliesen','boden','wand','dach','fenster',
    'garten','pool','klimaanlage','wärmepumpe','boiler','heizkörper',
    'wasserhahn','abfluss','verstopft','tropft','rohrbruch',
    'friseur','nägel','massage','tattoo','barber',
    'auto','reifen','bremsen','motor',
    'tisch','schrank','möbel','schreiner',
    'mauer','estrich','keller',
  ];
  for (const kw of keywords) {
    if (text.includes(kw)) return kw;
  }
  return text.split(' ').filter(w => w.length > 4)[0] || 'problem';
}

function buildSystemPrompt(wissen) {
  return `Du bist Baby BOB – ein smarter KI-Assistent der Probleme erkennt und den richtigen Fachmann empfiehlt.

DEINE AUFGABE:
1. Analysiere das Foto und/oder die Beschreibung
2. Erkenne WAS es ist (Gegenstand, Anlage, Situation)
3. Erkenne das PROBLEM oder den Bedarf
4. Empfehle den richtigen Fachmann
5. Nenne Kosten in CHF und Dringlichkeit

WICHTIGE REGELN:
- Erkenne auch alltägliche Objekte: Tisch → Schreiner, Couch → Polsterer, Klimaanlage → Kältetechniker
- Sei präzise aber ehrlich: "Ich erkenne X, vermutlich Y Problem"
- Nenne IMMER einen Fachmann und Preisrahmen CHF
- KEINE verbindlichen Diagnosen – immer "könnte sein" / "vermutlich"
- Auf Deutsch antworten

${wissen ? `WISSENSDATENBANK:\n${wissen}` : ''}

ANTWORTE NUR MIT DIESEM JSON (kein Text davor/danach, keine Backticks):
{
  "titel": "Kurzer Titel was erkannt wurde (max 40 Zeichen)",
  "desc": "2-3 Sätze: was erkannt, was das Problem sein könnte, was zu tun ist",
  "kategorie": "Kategorie z.B. Sanitär / Beauty / Heizung / Möbel / Auto",
  "dringlichkeit": "Sofort / Hoch / Mittel / Niedrig",
  "kosten": "CHF XX–YY",
  "zeitraum": "z.B. Heute / 1-2 Tage / Diese Woche / Nach Termin",
  "fachmann": "Berufsbezeichnung z.B. Sanitärinstallateur",
  "fachmann_emoji": "passendes Emoji z.B. 🔧",
  "tipps": ["Tipp 1", "Tipp 2", "Tipp 3"],
  "erkannt_als": "Was genau erkannt wurde"
}`;
}

function safeParseJSON(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) {}
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch (e) {}
  try {
    const clean = raw
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .replace(/[\u201C\u201D]/g, '"')
      .trim();
    const m2 = clean.match(/\{[\s\S]*\}/);
    if (m2) return JSON.parse(m2[0]);
  } catch (e) {}
  return null;
}
