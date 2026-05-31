// api/bob.js – Baby BOB Serverless Function
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

    // ── 1. Wissensdatenbank: alles holen was relevant sein könnte ──
    let wissen = '';
    try {
      const keywords = extractKeywords(description, category);
      const allRows = [];

      // Für jedes Keyword eine eigene Abfrage
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

      // Duplikate entfernen via titel
      const unique = Array.from(
        new Map(allRows.map(r => [r.titel, r])).values()
      ).slice(0, 15); // max 15 Records an Claude

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

// ── Keywords aus Text + Kategorie extrahieren ──
function extractKeywords(description, category) {
  const keywords = new Set();

  // Kategorie direkt
  if (category) keywords.add(category.toLowerCase());

  if (description) {
    const text = description.toLowerCase();

    // Alle Wörter mit mehr als 3 Zeichen
    const words = text.split(/\s+/).filter(w => w.length > 3);
    words.forEach(w => keywords.add(w));

    // Bekannte Fachbegriffe explizit
    const fachbegriffe = [
      'sanitär','heizung','elektro','fliesen','boden','wand','dach',
      'fenster','garten','pool','klima','wärmepumpe','boiler','heizkörper',
      'wasserhahn','abfluss','verstopft','tropft','rohrbruch','leck',
      'strom','schalter','steckdose','sicherung','kabel',
      'friseur','nägel','massage','tattoo','barber','kosmetik',
      'auto','reifen','bremsen','motor','getriebe',
      'tisch','schrank','möbel','schreiner','stuhl','bett',
      'mauer','estrich','keller','riss','feuchtigkeit',
      'solar','photovoltaik','panel','dach','ziegel',
      'notfall','wasser','brand','rauch','gas',
    ];
    fachbegriffe.forEach(f => { if (text.includes(f)) keywords.add(f); });
  }

  // Mindestens 1 Keyword
  if (keywords.size === 0) keywords.add('problem');

  return Array.from(keywords).slice(0, 6); // max 6 Abfragen
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

${wissen ? `WISSENSDATENBANK (nutze diese Infos für präzise Antworten):\n${wissen}` : 'Keine Datenbankeinträge gefunden – antworte aus deinem Allgemeinwissen.'}

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
