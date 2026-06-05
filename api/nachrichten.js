// api/nachrichten.js – in-app messages / notifications (Task 7)
// Techniker → Projektleiter (materialliste/rapport), inbox, unread badge.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Nicht authentifiziert' });
  const user = await getUser(token);
  if (!user) return res.status(401).json({ error: 'Ungültiger Token' });
  const role = await getRole(user.id);

  try {
    const { action } = req.body || {};
    switch (action) {
      case 'send':         return await send(res, user, role, req.body);
      case 'inbox':        return await inbox(res, user, role, req.body);
      case 'unread_count': return await unreadCount(res, user);
      case 'set_status':   return await setStatus(res, user, req.body);
      default:             return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Nachrichten Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function send(res, user, role, body) {
  const { projekt_id, typ, inhalt } = body || {};
  let an_id = body.an_id || null;
  // If no explicit recipient, route to the project's owning partner.
  if (!an_id && projekt_id) {
    const p = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?id=eq.${projekt_id}&select=partner_user_id&limit=1`, { headers: SB }));
    an_id = (Array.isArray(p) ? p : [])[0]?.partner_user_id || null;
  }
  const row = { von_id: user.id, an_id, projekt_id: projekt_id || null, typ: typ || 'nachricht', inhalt: inhalt || {}, status: 'ungelesen' };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_nachrichten`, { method: 'POST', headers: { ...SB, Prefer: 'return=representation' }, body: JSON.stringify(row) });
  const saved = (await sbJson(r))?.[0];
  if (!r.ok || !saved) {
    const t = await r.text().catch(() => '');
    if (/PGRST205|not find the table/i.test(t + JSON.stringify(saved || ''))) return res.status(503).json({ error: 'gs_nachrichten nicht migriert' });
    return res.status(500).json({ error: 'Nachricht konnte nicht gesendet werden' });
  }
  return res.status(200).json({ ok: true, nachricht: saved });
}

async function inbox(res, user, role, body) {
  // Messages addressed to me (or, for admin, everything). Optional projekt filter.
  let f = role === 'gs_admin' && body.all ? '' : `an_id=eq.${user.id}&`;
  if (body.projekt_id) f += `projekt_id=eq.${body.projekt_id}&`;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_nachrichten?${f}select=*&order=created_at.desc&limit=100`, { headers: SB });
  if (!r.ok) return res.status(200).json({ nachrichten: [] });
  const rows = await sbJson(r);
  return res.status(200).json({ nachrichten: Array.isArray(rows) ? rows : [] });
}

async function unreadCount(res, user) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_nachrichten?an_id=eq.${user.id}&status=eq.ungelesen&select=id`, { headers: { ...SB, Prefer: 'count=exact' } });
  if (!r.ok) return res.status(200).json({ unread: 0 });
  const cr = r.headers.get('content-range') || '0/0';
  return res.status(200).json({ unread: Number(cr.split('/')[1]) || 0 });
}

async function setStatus(res, user, body) {
  const { id, status } = body || {};
  if (!id || !['gelesen', 'bestaetigt', 'ungelesen'].includes(status)) return res.status(400).json({ error: 'id + gültiger status erforderlich' });
  // Only the recipient can change status.
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_nachrichten?id=eq.${id}&an_id=eq.${user.id}`, { method: 'PATCH', headers: { ...SB, Prefer: 'return=representation' }, body: JSON.stringify({ status }) });
  const rows = await sbJson(r);
  if (!r.ok || !rows?.[0]) return res.status(404).json({ error: 'Nachricht nicht gefunden' });
  return res.status(200).json({ ok: true, nachricht: rows[0] });
}

async function getUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}
async function getRole(userId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&select=role&limit=1`, { headers: SB });
  if (!r.ok) return null;
  return (await r.json())[0]?.role || null;
}
async function sbJson(r) { try { return await r.json(); } catch { return null; } }
