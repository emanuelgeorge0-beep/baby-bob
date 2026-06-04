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

    // ── 1. Visuelle Voranalyse bei Bild ohne Text ──
    let visualKeywords = [];
    let visualCategory = category || '';
    if (imageBase64 && !description && !category && !isGS) {
      const vk = await extractImageKeywords(imageBase64);
      visualKeywords = vk.keywords || [];
      visualCategory = vk.kategorie || '';
    }

    // ── 2. Wissensdatenbank ──
    let wissen = '';
    wissen = isGS
      ? await fetchGSKnowledge(description, category)
      : await fetchBOBKnowledge(description, visualCategory, visualKeywords);

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
async function fetchBOBKnowledge(description, category, extraKeywords = []) {
  const keywords = [...new Set([...extractKeywords(description, category), ...extraKeywords.map(k => k.toLowerCase())])];
  const allRows = [];
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  // Diagnose-Basis immer laden (Fachmann-Übersicht als Ankerpunkt für Bildscans)
  const baseRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bob_knowledge?kategorie=eq.Diagnose&limit=5&select=titel,inhalt,kategorie,unterkategorie,tags`,
    { headers }
  );
  if (!baseRes.ok) throw new Error(`Supabase Diagnose-Query fehlgeschlagen: ${baseRes.status}`);
  const baseRows = await baseRes.json();
  if (Array.isArray(baseRows)) allRows.push(...baseRows);

  // Kategorie-gezielte Suche wenn visuelle Kategorie bekannt
  if (category) {
    const encCat = encodeURIComponent(category);
    const catRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bob_knowledge?kategorie.ilike=*${encCat}*&limit=8&select=titel,inhalt,kategorie,unterkategorie,tags`,
      { headers }
    );
    if (catRes.ok) {
      const rows = await catRes.json();
      if (Array.isArray(rows)) allRows.push(...rows);
    }
  }

  // Keyword-Suche über alle Kategorien
  for (const kw of keywords.slice(0, 8)) {
    const encoded = encodeURIComponent(kw);
    const url = `${SUPABASE_URL}/rest/v1/bob_knowledge?or=(inhalt.ilike.*${encoded}*,titel.ilike.*${encoded}*,kategorie.ilike.*${encoded}*,unterkategorie.ilike.*${encoded}*,tags.cs.{${encoded}})&limit=5&select=titel,inhalt,kategorie,unterkategorie,tags`;
    const supaRes = await fetch(url, { headers });
    if (!supaRes.ok) {
      console.error(`Supabase Keyword-Query für "${kw}" fehlgeschlagen: ${supaRes.status}`);
      continue;
    }
    const rows = await supaRes.json();
    if (Array.isArray(rows)) allRows.push(...rows);
  }

  // Wenn Keyword-Suche wenig brachte: breite Querung aller B2C-Kategorien
  if (allRows.length < 5) {
    const b2cCats = [
      'Sanit%C3%A4r','Elektro','Heizung','Beauty','Garten','Gewerke',
      'Fliesen','Notfall','Auto','Reinigung','Fenster','Geb%C3%A4ude',
      'Maler','Schreiner','Dach','K%C3%BCche','Keller','Solar',
      'Ger%C3%A4te','IT','Umzug'
    ];
    const orFilter = b2cCats.map(c => `kategorie.eq.${c}`).join(',');
    const broadRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bob_knowledge?or=(${orFilter})&limit=12&select=titel,inhalt,kategorie,unterkategorie,tags`,
      { headers }
    );
    if (broadRes.ok) {
      const rows = await broadRes.json();
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
  if (category) keywords.add(category.toLowerCase().replace(/[^a-zäöüß0-9]/g, ''));

  if (description) {
    const text = description.toLowerCase();
    // Nur alphanumerische + deutsche Zeichen, keine Sonderzeichen die PostgREST-Syntax brechen
    text.split(/\s+/)
      .map(w => w.replace(/[^a-zäöüß0-9]/g, ''))
      .filter(w => w.length > 3)
      .forEach(w => keywords.add(w));

    const fachbegriffe = [
      'sanitär','heizung','elektro','fliesen','boden','wand','dach',
      'fenster','garten','pool','klima','wärmepumpe','boiler','heizkörper',
      'wasserhahn','abfluss','verstopft','tropft','rohrbruch','leck',
      'strom','schalter','steckdose','sicherung','kabel','lampe','licht',
      'friseur','nagel','massage','tattoo','barber','kosmetik','wimper',
      'auto','reifen','bremsen','motor','getriebe','werkstatt',
      'tisch','schrank','möbel','schreiner','stuhl','bett','parkett',
      'mauer','estrich','keller','riss','feuchtigkeit','schimmel',
      'solar','photovoltaik','panel','ziegel',
      'notfall','brand','rauch','gas',
      'lüftung','komfortlüftung','kwl','split','vrf','kälte',
      'fussbodenheizung','radiatoren','pellets','fernwärme','thermosolar',
      'terrasse','balkon','bad','badezimmer','maler','küche','reinigung',
      'schlüssel','ausgesperrt','umzug','umziehen','garage','carport',
      'solar','photovoltaik','wechselrichter','waschmaschine','tumbler',
      'trockner','computer','laptop','wlan','internet','drucker','schimmel',
      'pool','schwimmbad','tiefkühler','kaffeemaschine','smart','geschirrspüler',
    ];
    fachbegriffe.forEach(f => { if (text.includes(f)) keywords.add(f); });
  }

  if (keywords.size === 0) keywords.add('problem');
  return Array.from(keywords).slice(0, 6);
}

// ── Visuelle Voranalyse: Bild → Kategorie + Keywords ──
async function extractImageKeywords(imageBase64) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: `Analysiere das Bild und erkenne was darauf zu sehen ist.
Antworte NUR mit diesem JSON (kein Text davor/danach):
{"kategorie":"z.B. Sanitär/Heizung/Elektro/Auto/Möbel/Beauty/Garten/Gebäude/Geräte/Dach/Reinigung","keywords":["keyword1","keyword2","keyword3","keyword4","keyword5"]}

Kategorie-Mapping:
- Wasserhahn, Armatur, Rohr, WC, Dusche, Badezimmer, Waschbecken → Sanitär
- Heizkörper, Radiator, Thermostat, Kessel, Heizung, Boiler → Heizung
- Steckdose, Schalter, Kabel, Sicherungskasten, Lampe, Leitung → Elektro
- Tisch, Stuhl, Schrank, Bett, Regal, Holzmöbel → Möbel (Kategorie: Schreiner)
- Reifen, Lenkrad, Motor, Motorraum, Fahrzeug, Felge → Auto
- Haar, Frisur, Nägel, Hand, Wimper, Make-up → Beauty
- Rasen, Pflanze, Baum, Blumen, Garten, Hecke → Garten
- Wand, Riss, Schimmel, Fassade, Putz, Mauerwerk → Gebäude
- Dach, Ziegel, Pfanne, Dachrinne, Firstziegel → Dach
- Waschmaschine, Geschirrspüler, Kühlschrank, Herd → Geräte
- Schmutz, Fleck, Dreck, Fenster putzen → Reinigung

Keywords = konkrete Objekte was du siehst (deutsch, lowercase).`,
        messages: [{
          role: 'user',
          content: [{
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
          }, {
            type: 'text',
            text: 'Was ist auf diesem Bild? Welche Kategorie und Keywords?',
          }],
        }],
      }),
    });
    if (!res.ok) return { kategorie: '', keywords: [] };
    const data = await res.json();
    const raw = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    const parsed = safeParseJSON(raw);
    return parsed || { kategorie: '', keywords: [] };
  } catch (e) {
    console.error('Visual pre-analysis error:', e.message);
    return { kategorie: '', keywords: [] };
  }
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
1. Analysiere das Foto GENAU – beschreibe Farben, Formen, Materialien, Objekte
2. Erkenne WAS es ist (Rohr, Armatur, Heizkörper, Steckdose, Reifen usw.)
3. Erkenne das PROBLEM oder den BEDARF
4. Empfehle den richtigen Fachmann
5. Nenne Kosten in CHF und Dringlichkeit

VISUELLE ERKENNUNGSREGELN – SANITÄR:
- Silberne/chrom Armatur, Wasserhahn, Griff, Ausfluss → Sanitärinstallateur
- Rundrohr, Kupferrohr, Kunststoffrohr, T-Stück, Verbindung → Sanitärinstallateur
- Weisses ovales Keramikbecken, Spülkasten, WC-Sitz → Sanitärinstallateur
- Duschkabine, Glasscheibe, Duschkopf, Duschhebel, Regendusche → Sanitärinstallateur
- Waschbecken, Badewanne, Abfluss, Siphon → Sanitärinstallateur

VISUELLE ERKENNUNGSREGELN – HEIZUNG:
- Weisses Metallgitter mit Rippen, wandmontiert, Heizkörper, Radiator → Heizungsmonteur
- Drehknopf mit Zahlen 1-5, Thermostatventil, weisser Kunststoffkopf an Rohr → Heizungsmonteur
- Grosses weisses/graues Gerät an Wand, Rohranschlüsse, Display, Gaskessel, Heizkessel → Heizungsmonteur
- Boiler, Warmwasserspeicher, runder Behälter → Heizungsmonteur
- Wärmepumpe, Aussengerät mit Ventilator → Heizungsmonteur

VISUELLE ERKENNUNGSREGELN – ELEKTRO:
- Weisses Rechteck mit zwei runden Löchern, Steckdose, Wandmontage → Elektriker
- Weisser quadratischer Wippschalter, Lichtschalter → Elektriker
- Flexible Leitung, Kabelisolierung, Stecker, Elektroleitung → Elektriker
- Sicherungskasten, Verteiler, Leitungsschutzschalter → Elektriker
- Glühbirne, LED, defekte Lampe, Leuchtmittel → Elektriker

VISUELLE ERKENNUNGSREGELN – MÖBEL:
- Holztischplatte, vier Beine, Esstisch, Schreibtisch → Schreiner
- Stuhl, Sitzfläche, Rückenlehne, Polster, Holzbeine → Schreiner / Polsterer
- Schranktüren, Griffe, Schubladen, Kleiderschrank, Regal → Schreiner
- Parkett, Holzboden, Dielen, Laminat → Bodenleger / Schreiner

VISUELLE ERKENNUNGSREGELN – AUTO:
- Schwarzes Gummiprofil, Reifenprofil, Felge, Reifen → Autopneu-Service / Garage
- Rundes Lenkrad, Speichen, Lederbezug, Airbag → Autoelektriker / Garage
- Motorraum, Metallteile, Schläuche, Motorblock, Ölmessstab → Automechaniker / Garage
- Kratzer, Delle, Lackschaden, Karosserie → Carrossier

WEITERE ERKENNUNGSREGELN:
- Hände mit Nägeln, Maniküre → Nagelstudio
- Haar, Frisur, Haarfarbe → Friseur
- Wand mit Riss, Abblättern, Feuchtigkeit → Maler / Maurer
- Schwarze Flecken, Schimmel an Wand → Bausanierer / Maler
- Badezimmer, Fliesen, Fliesenspiegel → Fliesenleger
- Rasen, Pflanze, Strauch, Garten → Gärtner
- Solarmodul, PV-Panel auf Dach → Solarinstallateur
- Computer, Laptop, Router, WLAN → IT-Techniker
- Schloss, Zylinder, Tür → Schlüsseldienst

WICHTIGE REGELN:
- Bei Fotos: Beschreibe KONKRET was du siehst im Feld "erkannt_als" (Farbe, Form, Material)
- Sei präzise: "Ich erkenne [konkretes Objekt], vermutlich [Problem/Bedarf]"
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
