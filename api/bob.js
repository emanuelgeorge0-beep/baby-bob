// api/bob.js – Baby BOB Serverless Function
// Vercel Serverless Function – API Keys sicher hier, nie im Browser

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
// Unterstützt beide Varianten: SUPABASE_KEY und SUPABASE_SERVICE_KEY
const SUPABASE_KEY  = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { description, imageBase64, category } = req.body || {};

    // ── 1. Wissensdatenbank: alles holen was relevant sein könnte ──
    let wissen = '';
    try {
      const keywords = extractKeywords(description, category);
      const allRows = [];

      for (const kw of keywords) {
        const encoded = encodeURIComponent(kw);
        const url = `${SUPABASE_URL}/rest/v1/bob_knowledge?or=(inhalt.ilike.*${encoded}*,titel.ilike.*${encoded}*,kategorie.ilike.*${encoded}*,unterkategorie.ilike.*${encoded}*)&limit=5&select=titel,inhalt,kategorie,unterkategorie,tags`;

        const supaRes = await fetch(url, {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        });

        if (supaRes.ok) {
          const rows = await supaRes.json();
          if (rows?.length > 0) allRows.push(...rows);
        }
      }

      // Duplikate entfernen via titel, max 15 Records
      const unique = Array.from(
        new Map(allRows.map(r => [r.titel, r])).values()
      ).slice(0, 15);

      if (unique.length > 0) {
        wissen = unique.map(r =>
          `[${r.kategorie} / ${r.unterkategorie}] ${r.titel}: ${r.inhalt}`
        ).join('\n\n');
      }
    } catch (e) {
      console.error('Supabase Error:', e.message);
    }

    // ── 2. Claude anfragen ──
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

    userContent.push({
      type: 'text',
      text: userText || 'Analysiere das Bild und erkenne was abgebildet ist und welcher Fachmann benötigt wird.',
    });

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
    if (!result) throw new Error('JSON Parse Error: ' + raw.substring(0, 200));

    return res.status(200).json(result);

  } catch (err) {
    console.error('BOB API Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── Keywords aus Text + Kategorie extrahieren ──
function extractKeywords(description, category) {
  const keywords = new Set();

  if (category) keywords.add(category.toLowerCase());

  if (description) {
    const text = description.toLowerCase();

    // Alle Wörter mit mehr als 3 Zeichen
    text.split(/\s+/).filter(w => w.length > 3).forEach(w => keywords.add(w));

    // Bekannte Fachbegriffe
    const fachbegriffe = [
      'sanitär','heizung','elektro','fliesen','boden','wand','dach',
      'fenster','garten','pool','klima','wärmepumpe','boiler','heizkörper',
      'wasserhahn','abfluss','verstopft','tropft','rohrbruch','leck',
      'strom','schalter','steckdose','sicherung','kabel',
      'friseur','nagel','massage','tattoo','barber','kosmetik','wimper',
      'auto','reifen','bremsen','motor','getriebe',
      'tisch','schrank','möbel','schreiner','stuhl','bett',
      'mauer','estrich','keller','riss','feuchtigkeit',
      'solar','photovoltaik','panel','ziegel',
      'notfall','brand','rauch','gas',
    ];
    fachbegriffe.forEach(f => { if (text.includes(f)) keywords.add(f); });
  }

  if (keywords.size === 0) keywords.add('problem');

  return Array.from(keywords).slice(0, 6);
}

function buildSystemPrompt(wissen) {
  return `Du bist Baby BOB – ein smarter KI-Assistent der Bilder und Probleme analysiert und den richtigen Fachmann empfiehlt.

DEINE AUFGABE:
1. Analysiere das Foto GENAU – was ist wirklich abgebildet?
2. Erkenne WAS es ist (Nagel, Rohr, Wand, Hand, Gerät, Person usw.)
3. Erkenne das PROBLEM oder den BEDARF
4. Empfehle den richtigen Fachmann
5. Nenne Kosten in CHF und Dringlichkeit

BEISPIELE FÜR BILDERKENNUNG:
- Hände mit Nägeln → Nagelstudio, Maniküre
- Haar / Frisur → Friseur
- Wasserhahn tropft → Sanitärinstallateur
- Steckdose / Kabel → Elektriker
- Heizung / Heizkörper → Heizungsmonteur
- Wand mit Riss → Maler / Maurer
- Badezimmer → Sanitär / Fliesenleger
- Garten / Rasen → Gärtner
- Tattoo / Piercing → Tattoo Studio
- Auto → Autowerkstatt
- Möbel / Tisch → Schreiner

WICHTIGE REGELN:
- Bei Fotos: Beschreibe KONKRET was du siehst im Feld "erkannt_als"
- Sei präzise: "Ich erkenne X, vermutlich Y Bedarf"
- Nenne IMMER einen Fachmann und Preisrahmen CHF
- KEINE verbindlichen Diagnosen – "könnte sein" / "vermutlich"
- Immer auf Deutsch antworten

${wissen ? `WISSENSDATENBANK (nutze diese Infos für präzise Antworten):\n${wissen}` : 'Keine Datenbankeinträge gefunden – antworte aus deinem Allgemeinwissen.'}

ANTWORTE NUR MIT DIESEM JSON (kein Text davor/danach, keine Backticks):
{
  "titel": "Kurzer Titel was erkannt wurde (max 40 Zeichen)",
  "desc": "2-3 Sätze: was konkret erkannt, was das Problem/Bedarf sein könnte, was zu tun ist",
  "kategorie": "Kategorie z.B. Sanitär / Beauty / Heizung / Möbel / Auto",
  "dringlichkeit": "Sofort / Hoch / Mittel / Niedrig",
  "kosten": "CHF XX–YY",
  "zeitraum": "z.B. Heute / 1-2 Tage / Diese Woche / Nach Termin",
  "fachmann": "Berufsbezeichnung z.B. Sanitärinstallateur",
  "fachmann_emoji": "passendes Emoji z.B. 🔧",
  "tipps": ["Tipp 1", "Tipp 2", "Tipp 3"],
  "erkannt_als": "Was genau auf dem Foto / in der Beschreibung erkannt wurde – konkret!"
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
