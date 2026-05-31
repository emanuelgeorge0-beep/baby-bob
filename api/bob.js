export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Nur POST erlaubt' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server-Konfigurationsfehler' });

  // ── SUPABASE: Anfrage speichern ──
  if (req.body && req.body.action === 'save_request') {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase nicht konfiguriert' });
    }
    try {
      const r = await fetch(supabaseUrl + '/rest/v1/anfragen', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': 'Bearer ' + supabaseKey,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(req.body.data)
      });
      if (!r.ok) {
        const err = await r.text();
        console.error('Supabase Fehler:', err);
        return res.status(500).json({ error: 'Speichern fehlgeschlagen', detail: err });
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Supabase Verbindungsfehler' });
    }
  }

  // ── INPUT VALIDIERUNG ──
  const { description, imageBase64, category } = req.body || {};
  if (!description && !imageBase64) return res.status(400).json({ error: 'Text oder Bild erforderlich' });
  if (description && description.length > 2000) return res.status(400).json({ error: 'Text zu lang' });

  // ── BOB SYSTEM PROMPT ──
  const SYSTEM_PROMPT = 'Du bist BOB - dein digitaler Hausmeister.\n\nCHARAKTER: Du hast eine SHK-Lehre gemacht, bist witzig und kompetent. Schweizerdeutsch-freundliches Hochdeutsch (kein ss statt Eszett).\n\nWISSEN: Sanitaer, Heizung, Elektro, Bau, Haushalt, Beauty - alles rund ums Haus.\n\nSCHWEIZER KONTEXT: Preise in CHF, SIA/SVGW Normen.\n\nAntworte IMMER als reines JSON ohne Backticks:\n{"emoji":"passendes Emoji","fachmann_emoji":"Emoji fuer Fachmann","titel":"Kurzer Titel","beschreibung":"3-5 Saetze witzige Diagnose","kategorie":"Sanitaer|Heizung|Elektro|Handwerk|Beauty|Allgemein","dringlichkeit":"Hoch|Mittel|Niedrig","kosten":"z.B. CHF 80-250","zeitraum":"z.B. 1-3 Tage","fachmann":"Berufsbezeichnung","tipps":["Tipp 1","Tipp 2","Tipp 3"]}';

  // ── NACHRICHT BAUEN ──
  let userContent = [];
  if (imageBase64) {
    userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } });
  }
  let textParts = [];
  if (category) textParts.push('Kategorie: ' + category);
  if (description) textParts.push('Problem: ' + description);
  if (imageBase64 && !description) textParts.push('Analysiere dieses Foto.');
  userContent.push({ type: 'text', text: textParts.join('\n') || 'Analysiere mein Problem.' });

  // ── ANTHROPIC API ──
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
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) return res.status(502).json({ error: 'KI-Dienst nicht verfuegbar' });

    const data = await response.json();
    const rawText = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch (_) {}
    if (!parsed) {
      try { const m = rawText.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch (_) {}
    }
    if (!parsed) {
      try {
        const clean = rawText.replace(/```json/gi,'').replace(/```/g,'').trim();
        const m2 = clean.match(/\{[\s\S]*\}/); if (m2) parsed = JSON.parse(m2[0]);
      } catch (_) {}
    }

    if (!parsed) return res.status(500).json({ error: 'Antwort konnte nicht verarbeitet werden' });

    return res.status(200).json({
      emoji: parsed.emoji || '🔧',
      fachmann_emoji: parsed.fachmann_emoji || parsed.emoji || '👷',
      titel: parsed.titel || 'Problem erkannt',
      beschreibung: parsed.beschreibung || 'BOB hat dein Problem analysiert.',
      kategorie: parsed.kategorie || 'Allgemein',
      dringlichkeit: ['Hoch','Mittel','Niedrig'].includes(parsed.dringlichkeit) ? parsed.dringlichkeit : 'Mittel',
      kosten: parsed.kosten || 'CHF 80-300',
      zeitraum: parsed.zeitraum || '1-3 Tage',
      fachmann: parsed.fachmann || 'Fachmann',
      tipps: Array.isArray(parsed.tipps) ? parsed.tipps.slice(0,4) : ['Fachmann kontaktieren']
    });

  } catch (err) {
    return res.status(500).json({ error: 'Interner Serverfehler' });
  }
}
