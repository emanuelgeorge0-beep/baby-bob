// api/rapport.js – Techniker Weekly Rapport Submission
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Nicht authentifiziert' });

  // Verify token + get user
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Ungültiger Token' });
  const user = await userRes.json();

  // Verify role = techniker or gs_admin
  const roleRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${user.id}&select=role&limit=1`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const roleRows = roleRes.ok ? await roleRes.json() : [];
  const role = roleRows[0]?.role || 'bob_user';
  if (role !== 'techniker' && role !== 'gs_admin') {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }

  if (req.method === 'GET') {
    return await getRapporte(res, user.id);
  }

  if (req.method === 'POST') {
    return await submitRapporte(res, user.id, req.body);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function getTechnikerId(userId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/gs_techniker?user_id=eq.${userId}&select=id&limit=1`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.id || null;
}

async function getRapporte(res, userId) {
  const techId = await getTechnikerId(userId);
  if (!techId) return res.status(404).json({ error: 'Techniker nicht gefunden' });

  // Last 4 weeks of rapporte
  const since = new Date();
  since.setDate(since.getDate() - 28);
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/techniker_rapporte?techniker_id=eq.${techId}&datum=gte.${since.toISOString().slice(0,10)}&order=datum.desc&select=*`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  if (!r.ok) return res.status(500).json({ error: 'Daten konnten nicht geladen werden' });
  return res.status(200).json(await r.json());
}

async function submitRapporte(res, userId, body) {
  const { tage } = body || {};
  if (!Array.isArray(tage) || tage.length === 0) {
    return res.status(400).json({ error: 'Keine Tage übermittelt' });
  }

  const techId = await getTechnikerId(userId);
  if (!techId) return res.status(404).json({ error: 'Techniker nicht gefunden' });

  const payload = tage
    .filter(t => t.datum && t.stunden >= 0)
    .map(t => ({
      techniker_id: techId,
      user_id: userId,
      datum: t.datum,
      stunden: parseFloat(t.stunden) || 0,
      aktivitaeten: Array.isArray(t.aktivitaeten) ? t.aktivitaeten : [],
      materialien: Array.isArray(t.materialien) ? t.materialien : [],
      notiz: t.notiz || null,
      woche: getWeekNumber(new Date(t.datum)),
      jahr: new Date(t.datum).getFullYear(),
    }));

  if (payload.length === 0) return res.status(400).json({ error: 'Keine gültigen Tage' });

  const r = await fetch(`${SUPABASE_URL}/rest/v1/techniker_rapporte`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const err = await r.text();
    return res.status(500).json({ error: 'Speichern fehlgeschlagen: ' + err.slice(0, 100) });
  }

  return res.status(200).json({ ok: true, saved: payload.length });
}

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}
