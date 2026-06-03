// api/bob.js – Baby BOB & George Solutions Serverless Function

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;

// GS-Modus: PostgREST OR-Filter für Heizung, Sanitär, Lüftung, Klima
const GS_CAT_FILTER = [
  'kategorie.ilike.*heizung*',
  'kategorie.ilike.*sanit%C3%A4r*',
  'kategorie.ilike.*sanitaer*',
  'kategorie.ilike.*l%C3%BCftung*',
  'kategorie.ilike.*lueftung*',
  'kategorie.ilike.*klima*',
].join(',');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { description, imageBase64, category, mode } = req.body || {};
    const isGS = mode === 'gs';

    // ── 1. Wissensdatenbank ──
    let wissen = '';
    try {
      wissen = isGS
        ? await fetchGSKnowledge(description, category)
        : await fetchBOBKnowledge(description, category);
    } catch (e) {
      console.error('Supabase Error:', e.message);
    }

    // ── 2. System Prompt wählen ──
    const systemPrompt = isGS ? buildGSPrompt(wissen) : buildBOBPrompt(wissen);

    // ── 3. User Content aufbauen ──
    const userContent = [];
    if (imageBase64) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
      });
    }

    const userText = [
      description ? (isGS ? `Projektbeschreibung: ${description}` : `Problembeschreibung: ${description}`) : '',
      category    ? `${isGS ? 'Bereich' : 'Kategorie'}: ${category}` : '',
    ].filter(Boolean).join('\n');

    userContent.push({
      type: 'text',
      text: userText || (isGS
        ? 'Erstelle eine professionelle SHK-Projekteinschätzung.'
        : 'Analysiere das Bild und erkenne was abgebildet ist und welcher Fachmann benötigt wird.'),
    });

    // ── 4. Claude anfragen ──
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: isGS ? 1200 : 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!claudeRes.ok) throw new Error('Claude API: ' + claudeRes.status);

    const claudeData = await claudeRes.json();
    const raw = claudeData.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const result = safeParseJSON(raw);
    if (!result) throw new Error('JSON Parse Error: ' + raw.substring(0, 200));

    return res.status(200).json(result);

  } catch (err) {
    console.error('BOB API Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── GS-Modus: Wissensdatenbank gefiltert nach Heizung/Sanitär/Lüftung/Klima ──
async function fetchGSKnowledge(description, category) {
  const allRows = [];
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  // Alle GS-Kategorien laden (breite Basis)
  const baseUrl = `${SUPABASE_URL}/rest/v1/bob_knowledge?or=(${GS_CAT_FILTER})&limit=20&select=titel,inhalt,kategorie,unterkategorie,tags`;
  const baseRes = await fetch(baseUrl, { headers });
  if (baseRes.ok) {
    const rows = await baseRes.json();
    if (Array.isArray(rows)) allRows.push(...rows);
  }

  // Keyword-Suche kombiniert mit GS-Kategorie-Filter (PostgREST AND-Syntax)
  if (description || category) {
    const keywords = extractKeywords(description, category).slice(0, 3);
    for (const kw of keywords) {
      const enc = encodeURIComponent(kw);
      const kwUrl = `${SUPABASE_URL}/rest/v1/bob_knowledge?and=(or(${GS_CAT_FILTER}),or(inhalt.ilike.*${enc}*,titel.ilike.*${enc}*))&limit=5&select=titel,inhalt,kategorie,unterkategorie,tags`;
      const r = await fetch(kwUrl, { headers });
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows)) allRows.push(...rows);
      }
    }
  }

  return formatKnowledge(allRows);
}

// ── BOB-Modus: Keyword-basierte Suche (alle Kategorien) ──
async function fetchBOBKnowledge(description, category) {
  const keywords = extractKeywords(description, category);
  const allRows = [];
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  for (const kw of keywords) {
    const encoded = encodeURIComponent(kw);
    const url = `${SUPABASE_URL}/rest/v1/bob_knowledge?or=(inhalt.ilike.*${encoded}*,titel.ilike.*${encoded}*,kategorie.ilike.*${encoded}*,unterkategorie.ilike.*${encoded}*)&limit=5&select=titel,inhalt,kategorie,unterkategorie,tags`;
    const supaRes = await fetch(url, { headers });
    if (supaRes.ok) {
      const rows = await supaRes.json();
      if (Array.isArray(rows)) allRows.push(...rows);
    }
  }

  return formatKnowledge(allRows);
}

function formatKnowledge(allRows) {
  const unique = Array.from(
    new Map(allRows.map(r => [r.titel, r])).values()
  ).slice(0, 15);
  if (!unique.length) return '';
  return unique.map(r => `[${r.kategorie} / ${r.unterkategorie}] ${r.titel}: ${r.inhalt}`).join('\n\n');
}

// ── Keywords aus Text + Kategorie extrahieren ──
function extractKeywords(description, category) {
  const keywords = new Set();
  if (category) keywords.add(category.toLowerCase());

  if (description) {
    const text = description.toLowerCase();
    text.split(/\s+/).filter(w => w.length > 3).forEach(w => keywords.add(w));

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
      'lüftung','komfortlüftung','kwl','split','vrf','kälte',
      'fussbodenheizung','radiatoren','pellets','fernwärme','thermosolar',
    ];
    fachbegriffe.forEach(f => { if (text.includes(f)) keywords.add(f); });
  }

  if (keywords.size === 0) keywords.add('problem');
  return Array.from(keywords).slice(0, 6);
}

// ── GS System Prompt (B2B, SHK-Fachmann) ──
function buildGSPrompt(wissen) {
  return `Du bist der KI-Projektassistent von George Solutions – SHK-Spezialist (Sanitär, Heizung, Klima, Lüftung) aus Zürich, Schweiz.

KONTEXT: George Solutions bietet professionelle B2B-Dienstleistungen für Gebäudetechnik. Kunden sind Liegenschaftsverwaltungen, Bauunternehmen, Immobilieneigentümer und Facility Manager.

STUNDENTARIFE von George Solutions:
- Pilot: CHF 60-65/h (Kennenlernen, Erstprojekte bis ~16h)
- Single: CHF 68-70/h (Einzelprojekte, flexible Buchung)
- Monthly: CHF 67.90/h (Monatliches Kontingent, regelmässige Zusammenarbeit)
- Quarterly: CHF 66.50/h (Quartalsvertrag, mittelfristige Planung)
- Annual: CHF 65/h (Jahresvertrag, strategische Partnerschaft)

AUFGABE:
1. Analysiere das SHK-Projekt professionell und technisch präzise
2. Schätze Umfang und Stundenbedarf realistisch ein
3. Empfehle den passenden Tarif basierend auf Projektvolumen und Häufigkeit
4. Gib relevante Schweizer Normen (SIA, SWKI, EN) und technische Hinweise
5. Antworte immer auf Deutsch, B2B-professionell und präzise

BEREICHE: Heizung (Wärmepumpen, Heizkörper, Fussbodenheizung, Boiler, Pellets/Gas/Öl/Solar), Sanitär (Installation, Armaturen, Rohrleitungen, Badezimmer, Entwässerung), Lüftung (KWL, Komfortlüftung, Absaugungen, Wohnraumlüftung), Klima (Split-Anlagen, VRF-Systeme, Kältetechnik)

${wissen ? `WISSENSDATENBANK (GS-relevante Fachinfos – Heizung/Sanitär/Lüftung/Klima):\n${wissen}` : 'Antworte aus deinem SHK-Fachwissen.'}

ANTWORTE NUR MIT DIESEM JSON (kein Text davor/danach, keine Backticks):
{
  "projekt_typ": "Art des Projekts z.B. Heizungsrevision, Badinstallation, Klimaanlage",
  "bereich": "Heizung / Sanitär / Lüftung / Klima / Kombiniert",
  "beschreibung": "Professionelle Projekteinschätzung, 2-3 Sätze, technisch präzise",
  "umfang": "Klein (<16h) / Mittel (16-60h) / Gross (60-200h) / Komplex (>200h)",
  "geschaetzte_stunden": "z.B. 8-16h",
  "empfohlener_tarif": "Pilot / Single / Monthly / Quarterly / Annual",
  "tarif_begruendung": "1 Satz warum dieser Tarif sinnvoll ist",
  "prioritaet": "Normal / Dringend / Sehr dringend",
  "normen": "Relevante Normen z.B. SIA 180, SWKI 2015-01, SN EN 378",
  "naechste_schritte": ["Schritt 1", "Schritt 2", "Schritt 3"],
  "technische_hinweise": "Wichtige technische Details oder Besonderheiten für das Projekt"
}`;
}

// ── BOB System Prompt (B2C, Allround-Finder) ──
function buildBOBPrompt(wissen) {
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
      .replace(/[“”]/g, '"')
      .trim();
    const m2 = clean.match(/\{[\s\S]*\}/);
    if (m2) return JSON.parse(m2[0]);
  } catch (e) {}
  return null;
}
