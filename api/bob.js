// ╔══════════════════════════════════════════════════════════╗
// ║  Baby BOB – Serverless API Proxy                        ║
// ║  Schützt den Anthropic API Key vor dem Browser          ║
// ╚══════════════════════════════════════════════════════════╝

export default async function handler(req, res) {
  // ── 1. CORS – erlaubt Anfragen vom eigenen Frontend ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight-Anfrage (Browser sendet OPTIONS zuerst)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── 2. Nur POST erlaubt ──
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST erlaubt' });
  }

  // ── 3. API Key aus Vercel Umgebungsvariable ──
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY fehlt in Umgebungsvariablen');
    return res.status(500).json({ error: 'Server-Konfigurationsfehler' });
  }

  // ── 4. Eingabe validieren ──
  const { description, imageBase64, category } = req.body || {};

  // Mindestens Text ODER Bild muss vorhanden sein
  if (!description && !imageBase64) {
    return res.status(400).json({ error: 'Text oder Bild erforderlich' });
  }

  // Text-Länge begrenzen (Schutz vor Missbrauch)
  if (description && description.length > 2000) {
    return res.status(400).json({ error: 'Text zu lang (max. 2000 Zeichen)' });
  }

  // ── 5. BOBs System Prompt ──
  // ── AKTION: Anfrage in Supabase speichern ──
  if (req.body && req.body.action === 'save_request') {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase nicht konfiguriert' });
    }
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/anfragen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(req.body.data)
      });
      if (!response.ok) {
        const err = await response.text();
        console.error('Supabase Fehler:', err);
        return res.status(500).json({ error: 'Speichern fehlgeschlagen' });
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Supabase Verbindungsfehler' });
    }
  }

 `Du bist BOB – dein digitaler Hausmeister. 🔧

CHARAKTER:
- Du hast eine SHK-Lehre (Sanitär, Heizung, Klima) gemacht und liebst es
- Jetzt weisst du alles rund ums Haus – und lernst täglich mehr dazu
- Du bist witzig, unterhaltsam, direkt – nie langweilig, immer sympathisch
- Du sagst den Nutzern gerne: "Je mehr du mich nutzt, desto besser werde ich!"
- Du sprichst Schweizerdeutsch-freundliches Hochdeutsch (kein "ß", sage "ss")

DEIN WISSEN:
Sanitär/SHK: Wasserrohrbruch, Leckagen, Armaturen, WC, Dusche, Badewanne, Boiler, Rohrreinigung, PEX-Leitungen, Geberit-Spülkästen, Druckprüfungen, DN56/DN110/DN125 Abwasserrohre, Wärmepumpen, Heizkörper, Fussbodenheizung
Elektro: Sicherungen, Steckdosen, Beleuchtung, Verteilkästen
Bau/Renovation: Maler, Schreiner, Fliesenleger, Bodenleger, Dachdecker, Glaser, Schlüsseldienst
Haushalt: Reinigung, Umzug, Garten, Winterdienst
Beauty: Friseur, Barber, Nagelstudio, Massage, Kosmetik, Wimpern, Tattoo, Piercing

SCHWEIZER KONTEXT:
- Preise immer in CHF
- SIA/SVGW Normen berücksichtigen
- Schweizer Qualitätsstandards erwähnen wenn relevant

OFF-TOPIC-REGEL:
Wenn jemand etwas fragt das nichts mit Haus, Wohnung oder Beauty zu tun hat, machst du einen kurzen witzigen Kommentar und leitest zurück. Beispiel: "Haha, Astrophysik liegt leider ausserhalb meiner Lehrzeit. Aber sag mir – tropft bei dir irgendwo etwas?" 😄

ANTWORT-FORMAT:
Antworte IMMER als reines JSON-Objekt. Keine Backticks, keine Erklärungen davor oder danach.

JSON-Struktur:
{
  "emoji": "passendes Emoji für Problem",
  "fachmann_emoji": "passendes Emoji für Fachmann",
  "titel": "Kurzer Titel was erkannt wurde (max 5 Wörter)",
  "beschreibung": "BOBs witzige aber kompetente Diagnose in 3-5 Sätzen. Erkläre das Problem, was es verursacht und was der nächste Schritt ist. Sei persönlich und humorvoll.",
  "kategorie": "Sanitär|Heizung|Elektro|Handwerk|Beauty|Allgemein",
  "dringlichkeit": "Hoch|Mittel|Niedrig",
  "kosten": "z.B. CHF 80-250",
  "zeitraum": "z.B. 1-3 Tage|Sofort|Nach Termin",
  "fachmann": "Berufsbezeichnung des Fachmanns",
  "tipps": ["Tipp 1", "Tipp 2", "Tipp 3"]
}`;

  // ── 6. Nachricht für Claude bauen ──
  // Unterstützt Text, Bild oder beides kombiniert
  let userContent = [];

  if (imageBase64) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: imageBase64
      }
    });
  }

  // Text-Teil zusammenbauen
  let textParts = [];
  if (category) textParts.push(`Kategorie: ${category}`);
  if (description) textParts.push(`Problem: ${description}`);
  if (imageBase64 && !description) textParts.push('Bitte analysiere dieses Foto und erkenne das Problem.');
  if (imageBase64 && description) textParts.push('Analysiere das Foto zusammen mit der Beschreibung.');

  userContent.push({
    type: 'text',
    text: textParts.join('\n') || 'Analysiere mein Problem.'
  });

  // ── 7. Anthropic API aufrufen ──
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: userContent }
        ]
      })
    });

    // HTTP-Fehler von Anthropic abfangen
    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API Fehler:', response.status, errText);
      return res.status(502).json({ error: 'KI-Dienst momentan nicht verfügbar' });
    }

    const data = await response.json();

    // Antwort-Text extrahieren
    const rawText = (data.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    // JSON sauber parsen (mehrere Fallbacks)
    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch (_) {}
    if (!parsed) {
      try {
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch (_) {}
    }
    if (!parsed) {
      try {
        const clean = rawText
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .replace(/[\u201C\u201D]/g, '"')
          .trim();
        const match2 = clean.match(/\{[\s\S]*\}/);
        if (match2) parsed = JSON.parse(match2[0]);
      } catch (_) {}
    }

    if (!parsed) {
      console.error('JSON-Parse fehlgeschlagen. Rohantwort:', rawText);
      return res.status(500).json({ error: 'Antwort konnte nicht verarbeitet werden' });
    }

    // Pflichtfelder sicherstellen (Fallbacks falls KI Feld weglässt)
    const result = {
      emoji: parsed.emoji || '🔧',
      fachmann_emoji: parsed.fachmann_emoji || parsed.emoji || '👷',
      titel: parsed.titel || 'Problem erkannt',
      beschreibung: parsed.beschreibung || 'BOB hat dein Problem analysiert.',
      kategorie: parsed.kategorie || 'Allgemein',
      dringlichkeit: ['Hoch', 'Mittel', 'Niedrig'].includes(parsed.dringlichkeit) ? parsed.dringlichkeit : 'Mittel',
      kosten: parsed.kosten || 'CHF 80-300',
      zeitraum: parsed.zeitraum || '1-3 Tage',
      fachmann: parsed.fachmann || 'Fachmann',
      tipps: Array.isArray(parsed.tipps) ? parsed.tipps.slice(0, 4) : ['Fachmann kontaktieren']
    };

    return res.status(200).json(result);

  } catch (err) {
    console.error('Unerwarteter Fehler:', err);
    return res.status(500).json({ error: 'Interner Serverfehler' });
  }
}
