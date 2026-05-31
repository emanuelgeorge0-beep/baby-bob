export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST erlaubt' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server-Konfigurationsfehler' });
  }

  const { description, imageBase64, category } = req.body || {};

  if (!description && !imageBase64) {
    return res.status(400).json({ error: 'Text oder Bild erforderlich' });
  }

  if (description && description.length > 2000) {
    return res.status(400).json({ error: 'Text zu lang (max. 2000 Zeichen)' });
  }

  const SYSTEM_PROMPT = `Du bist BOB – dein digitaler Hausmeister. 🔧

CHARAKTER:
- Du hast eine SHK-Lehre gemacht und liebst es
- Jetzt weisst du alles rund ums Haus und lernst täglich mehr
- Du bist witzig, unterhaltsam, direkt – nie langweilig
- Du sagst den Nutzern: "Je mehr du mich nutzt, desto besser werde ich!"
- Schweizerdeutsch-freundliches Hochdeutsch (kein ß, sage ss)

WISSEN: Sanitär, Heizung, Elektro, Bau, Haushalt, Beauty – alles rund ums Haus und die Person

SCHWEIZER KONTEXT: Preise in CHF, SIA/SVGW Normen, Schweizer Qualitätsstandards

OFF-TOPIC: Kurzer Witz dann zurückleiten zum Haus

Antworte IMMER als reines JSON ohne Backticks:
{
  "emoji": "passendes Emoji",
  "fachmann_emoji": "Emoji für Fachmann",
  "titel": "Kurzer Titel (max 5 Wörter)",
  "beschreibung": "Witzige aber kompetente Diagnose in 3-5 Sätzen",
  "kategorie": "Sanitär|Heizung|Elektro|Handwerk|Beauty|Allgemein",
  "dringlichkeit": "Hoch|Mittel|Niedrig",
  "kosten": "z.B. CHF 80-250",
  "zeitraum": "z.B. 1-3 Tage",
  "fachmann": "Berufsbezeichnung",
  "tipps": ["Tipp 1", "Tipp 2", "Tipp 3"]
