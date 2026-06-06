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
    const isBauplan = mode === 'bauplan';
    const imageOnly = !!(imageBase64 && !description && !category && !isGS && !isBauplan);

    // ── 1. Wissensdatenbank ──
    let wissen = '';
    wissen = (isGS || isBauplan)
      ? await fetchGSKnowledge(description, category)
      : await fetchBOBKnowledge(description, category, imageOnly);

    // ── 2. System Prompt wählen ──
    const systemPrompt = isBauplan ? buildBauplanPrompt(wissen) : isGS ? buildGSPrompt(wissen) : buildBOBPrompt(wissen);

    // ── 3. User Content aufbauen ──
    const userContent = [];
    if (imageBase64) {
      const mediaType = imageBase64.startsWith('/9j/') ? 'image/jpeg'
        : imageBase64.startsWith('iVBOR') ? 'image/png'
        : imageBase64.startsWith('R0lGO') ? 'image/gif'
        : imageBase64.startsWith('UklGR') ? 'image/webp'
        : 'image/jpeg';
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: imageBase64 },
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
        model: 'claude-sonnet-4-6',
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
    // Graceful degradation: BOB always returns a usable result screen.
    // (GS mode has its own client-side fallback, so let it see the error.)
    const isGSerr = (req.body && req.body.mode) === 'gs';
    if (isGSerr) return res.status(500).json({ error: err.message });
    return res.status(200).json({
      titel: 'Analyse momentan nicht möglich',
      desc: 'BOB konnte das nicht analysieren. Bitte beschreibe dein Problem kurz in Worten oder versuche ein anderes, gut beleuchtetes Foto.',
      kategorie: 'Unbekannt',
      dringlichkeit: 'Mittel',
      kosten: 'CHF --',
      zeitraum: 'Nach Analyse',
      fachmann: 'Noch nicht bestimmbar',
      fachmann_emoji: '🔍',
      tipps: ['Beschreibe dein Problem in Textform', 'Mache ein klares Foto bei guter Beleuchtung', 'Mehr Details = bessere Empfehlung'],
      erkannt_als: 'Analyse fehlgeschlagen – bitte erneut versuchen',
    });
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
async function fetchBOBKnowledge(description, category, imageOnly = false) {
  const keywords = extractKeywords(description, category);
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  // Bild ohne Text: visuelle Trigger für alle Kategorien parallel laden (kein Extra-API-Call)
  if (imageOnly) {
    const visualCats = [
      'Sanit%C3%A4r','Heizung','Elektro','Schreiner','Auto',
      'Beauty','Garten','Geb%C3%A4ude','Dach','Ger%C3%A4te','Maler'
    ];
    const orFilter = visualCats.map(c => `kategorie.eq.${c}`).join(',');
    const [visualRes, diagRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/bob_knowledge?or=(${orFilter})&quelle=eq.BOB%20Wissensdatenbank%20Visual&limit=15&select=titel,inhalt,kategorie,unterkategorie,tags`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/bob_knowledge?or=(${orFilter})&limit=6&select=titel,inhalt,kategorie,unterkategorie,tags`, { headers }),
    ]);
    const allRows = [];
    if (visualRes.ok) { const r = await visualRes.json(); if (Array.isArray(r)) allRows.push(...r); }
    if (diagRes.ok)   { const r = await diagRes.json();   if (Array.isArray(r)) allRows.push(...r); }
    return formatKnowledge(allRows);
  }

  const allRows = [];

  // Diagnose-Basis immer laden (Fachmann-Übersicht als Ankerpunkt)
  const baseRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bob_knowledge?kategorie=eq.Diagnose&limit=5&select=titel,inhalt,kategorie,unterkategorie,tags`,
    { headers }
  );
  if (!baseRes.ok) throw new Error(`Supabase Diagnose-Query fehlgeschlagen: ${baseRes.status}`);
  const baseRows = await baseRes.json();
  if (Array.isArray(baseRows)) allRows.push(...baseRows);

  // Kategorie-gezielte Suche
  if (category) {
    const encCat = encodeURIComponent(category);
    const catRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bob_knowledge?kategorie=ilike.*${encCat}*&limit=8&select=titel,inhalt,kategorie,unterkategorie,tags`,
      { headers }
    );
    if (catRes.ok) {
      const rows = await catRes.json();
      if (Array.isArray(rows)) allRows.push(...rows);
    }
  }

  // Keyword-Suche parallel (max 5 Keywords gleichzeitig)
  const kwFetches = keywords.slice(0, 5).map(kw => {
    const encoded = encodeURIComponent(kw);
    const url = `${SUPABASE_URL}/rest/v1/bob_knowledge?or=(inhalt.ilike.*${encoded}*,titel.ilike.*${encoded}*,kategorie.ilike.*${encoded}*,unterkategorie.ilike.*${encoded}*)&limit=5&select=titel,inhalt,kategorie,unterkategorie,tags`;
    return fetch(url, { headers }).then(r => r.ok ? r.json() : []).catch(() => []);
  });
  const kwResults = await Promise.all(kwFetches);
  kwResults.forEach(rows => { if (Array.isArray(rows)) allRows.push(...rows); });

  // Fallback: breite Querung
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

KOSTEN-LOGIK SCHWEIZ (für realistische Preise):
- Stundenansätze CH: Sanitär/Heizung CHF 90–130/h, Elektro CHF 95–130/h, Maler CHF 75–110/h, Schreiner CHF 90–120/h, Garten CHF 60–110/h. + Anfahrt CHF 60–120, + MwSt 8.1%.
- "kosten" = realistische Gesamtspanne für den typischen Einsatz (Arbeit + Anfahrt). "material_kosten" = grobe Materialkosten separat (CH-Preise), z.B. "CHF 20–60 (Kartusche)".
- Kleinreparatur 0.5–1.5h, mittlere Arbeit 2–4h, grössere Sache realistisch höher.

NOTFALL-ERKENNUNG:
- "notfall": true bei akuter Gefahr/Schaden: Wasserrohrbruch, Gasgeruch, Stromausfall mit Brandgeruch, Heizungsausfall im Winter, überlaufendes Wasser, Stromschlag-Risiko. Sonst false.
- Bei notfall=true: dringlichkeit "Sofort" und im ersten Tipp konkrete Sofortmassnahme (Haupthahn/Strom abstellen).

SAISON: Heute ist ${new Date().toLocaleDateString('de-CH', { month: 'long' })} (Monat ${new Date().getMonth() + 1}). Gib in "saison_tipp" einen passenden saisonalen Hinweis (Winter→Heizung/Frost, Frühling→Garten/Lüftung-Filter, Sommer→Klima, Herbst→Heizung-Service/Dach-Check). Kurz, 1 Satz.

GEORGE SOLUTIONS: "gs_passend": true wenn das Problem im SHK-Bereich liegt (Heizung, Sanitär, Lüftung, Klima) – dann kann George Solutions das direkt lösen. Sonst false.

${wissen ? `WISSENSDATENBANK (nutze diese Infos für präzise Antworten):\n${wissen}` : 'Keine Datenbankeinträge gefunden – antworte aus deinem Allgemeinwissen.'}

ANTWORTE NUR MIT DIESEM JSON (kein Text davor/danach, keine Backticks):
{
  "titel": "Kurzer Titel was erkannt wurde (max 40 Zeichen)",
  "desc": "2-3 Sätze: was konkret erkannt, was das Problem/Bedarf sein könnte, was zu tun ist",
  "kategorie": "Kategorie z.B. Sanitär / Beauty / Heizung / Möbel / Auto",
  "dringlichkeit": "Sofort / Hoch / Mittel / Niedrig",
  "kosten": "CHF XX–YY",
  "material_kosten": "grobe Materialkosten CH, z.B. CHF 20–60",
  "zeitraum": "z.B. Heute / 1-2 Tage / Diese Woche / Nach Termin",
  "fachmann": "Berufsbezeichnung z.B. Sanitärinstallateur",
  "fachmann_emoji": "passendes Emoji z.B. 🔧",
  "notfall": false,
  "gs_passend": false,
  "saison_tipp": "kurzer saisonaler Hinweis",
  "tipps": ["Tipp 1", "Tipp 2", "Tipp 3"],
  "erkannt_als": "Was genau auf dem Foto / in der Beschreibung erkannt wurde – konkret!"
}`;
}

// Item 8: Bauplan-/Blueprint-Analyse — BOB als digitaler Polier.
function buildBauplanPrompt(wissen) {
  return `Du bist BOB im BAUPLAN-MODUS – ein digitaler Polier/HKLS-Planer. Der Nutzer lädt einen Bauplan / Grundriss / Schema-Plan hoch.

DEINE AUFGABE:
1. Erkenne den Plantyp (Grundriss, Heizungs-/Sanitärschema, Lüftungsplan, Elektroplan, Schnitt).
2. Lies sichtbare Elemente: Räume, Leitungsführung, Masse/Bemassung (mm/cm/m), Symbole (Heizkörper, Ventile, Steckdosen, Lüftungsauslässe), Dimensionsangaben (DN, Querschnitte).
3. Gib konkrete fachliche Hinweise mit Normbezug Schweiz (SIA 384 Heizung, SIA 385 Trinkwarmwasser, SIA 382 Lüftung, NIN Elektro, SVGW Sanitär). Beispiel: "Laut Plan sollte die Heizungsleitung hier DN25 sein" oder "Der Abstand entspricht ~..."
4. Sei ehrlich, wenn der Plan unleserlich/unvollständig ist. KEINE erfundenen exakten Masse – nur was im Plan erkennbar oder fachlich plausibel ist.

${wissen ? `FACHWISSEN:\n${wissen}\n` : ''}
ANTWORTE NUR MIT DIESEM JSON (kein Text davor/danach, keine Backticks):
{
  "titel": "Plantyp / was erkannt (max 40 Zeichen)",
  "desc": "2-4 Sätze: erkannter Plantyp, wichtigste Elemente, fachliche Einschätzung mit Normbezug",
  "kategorie": "Bauplan",
  "dringlichkeit": "Niedrig",
  "kosten": "n/a",
  "material_kosten": "n/a",
  "zeitraum": "n/a",
  "fachmann": "z.B. HKLS-Planer / Bauleiter",
  "fachmann_emoji": "📐",
  "notfall": false,
  "gs_passend": true,
  "saison_tipp": "",
  "tipps": ["konkreter Fachhinweis 1 mit Normbezug", "Hinweis 2 (Masse/Dimension)", "Hinweis 3"],
  "erkannt_als": "Konkret erkannte Plan-Elemente: Räume, Leitungen, Masse, Symbole"
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
