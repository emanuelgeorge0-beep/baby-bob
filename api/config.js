// api/config.js – Öffentliche, nicht-geheime Laufzeit-Config fürs Frontend.
// Hinweis: Es wird KEINE Telefonnummer mehr ausgeliefert (GS_PHONE-Env wird nicht
// mehr gelesen). Kontakt läuft ausschliesslich über info@george-solutions.ch
// bzw. das Anfrageformular (telefonisches Erstgespräch).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (req.method === 'OPTIONS') return res.status(200).end();
  return res.status(200).json({ contact_email: 'info@george-solutions.ch' });
}
