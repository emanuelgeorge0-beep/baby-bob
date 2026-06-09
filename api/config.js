// api/config.js – Öffentliche, nicht-geheime Laufzeit-Config fürs Frontend.
// Liefert die echte GS-Telefonnummer (Vercel-Env GS_PHONE) an die statische index.html,
// damit Telefon-CTAs + tel:-Links überall die echte Nummer zeigen (kein Build-Step nötig).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const raw = (process.env.GS_PHONE || '').trim();
  // Platzhalter nicht ausliefern – Frontend behält dann seinen eigenen Fallback.
  const phone = /\d/.test(raw) && !/x/i.test(raw) ? raw : '';
  return res.status(200).json({ phone });
}
