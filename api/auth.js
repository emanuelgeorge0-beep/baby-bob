// api/auth.js – Authentication & Role Management
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;

const SB_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action, email, password, token } = req.body || {};
    switch (action) {
      case 'magic_link': return await sendMagicLink(res, email);
      case 'login':      return await loginWithPassword(res, email, password);
      case 'verify':     return await verifyToken(res, token);
      default:           return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Auth Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function sendMagicLink(res, email) {
  if (!email) return res.status(400).json({ error: 'E-Mail fehlt' });
  const r = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: SB_HEADERS,
    body: JSON.stringify({ email, create_user: false }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    // create_user:false → Supabase returns error if user doesn't exist (no auto-signup)
    const msg = err.msg || err.message || err.error_description || '';
    if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('signup')) {
      return res.status(404).json({ error: 'Kein Konto mit dieser E-Mail gefunden.' });
    }
    return res.status(400).json({ error: msg || 'Magic Link fehlgeschlagen' });
  }
  return res.status(200).json({ ok: true });
}

async function loginWithPassword(res, email, password) {
  if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: SB_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    return res.status(401).json({ error: err.error_description || err.msg || 'Login fehlgeschlagen' });
  }
  const data = await r.json();
  const role = await getUserRole(data.user?.id);
  const techName = role === 'techniker' ? await getTechName(data.user?.id) : null;
  return res.status(200).json({
    access_token: data.access_token,
    user: { id: data.user?.id, email: data.user?.email },
    role,
    tech_name: techName,
  });
}

async function verifyToken(res, token) {
  if (!token) return res.status(401).json({ error: 'Token fehlt' });
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!r.ok) return res.status(401).json({ error: 'Ungültiger oder abgelaufener Token' });
  const user = await r.json();
  const role = await getUserRole(user.id);
  const techName = role === 'techniker' ? await getTechName(user.id) : null;
  return res.status(200).json({
    user: { id: user.id, email: user.email },
    role,
    tech_name: techName,
  });
}

async function getUserRole(userId) {
  if (!userId) return 'bob_user';
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&select=role&limit=1`,
    { headers: SB_HEADERS }
  );
  if (!r.ok) return 'bob_user';
  const rows = await r.json();
  return rows[0]?.role || 'bob_user';
}

async function getTechName(userId) {
  if (!userId) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/gs_techniker?user_id=eq.${userId}&select=name&limit=1`,
    { headers: SB_HEADERS }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.name || null;
}
