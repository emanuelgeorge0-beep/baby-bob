// api/rechnung.js – Invoice read access (admin all; partner own projects)
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
    if (action === 'list') return await list(res, user, role, req.body);
    if (action === 'get') return await getOne(res, user, role, req.body);
    if (action === 'set_status') {
      if (role !== 'gs_admin') return res.status(403).json({ error: 'Nur für Administratoren' });
      const { id, status } = req.body || {};
      if (!id || !['erstellt', 'versendet', 'bezahlt'].includes(status)) return res.status(400).json({ error: 'id + gültiger status erforderlich' });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_rechnungen?id=eq.${id}`, { method: 'PATCH', headers: { ...SB, Prefer: 'return=representation' }, body: JSON.stringify({ status }) });
      const rows = await r.json().catch(() => null);
      if (!r.ok || !rows?.[0]) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
      return res.status(200).json({ ok: true, rechnung: rows[0] });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Rechnung Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function list(res, user, role, body) {
  let filter = '';
  if (role === 'gs_partner') {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?partner_user_id=eq.${user.id}&select=id`, { headers: SB });
    const ids = ((await pr.json().catch(() => [])) || []).map((x) => x.id);
    if (!ids.length) return res.status(200).json({ rechnungen: [] });
    filter = `projekt_id=in.(${ids.join(',')})&`;
  } else if (role !== 'gs_admin') return res.status(403).json({ error: 'Keine Berechtigung' });
  if (body.projekt_id) filter += `projekt_id=eq.${body.projekt_id}&`;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_rechnungen?${filter}select=*&order=created_at.desc`, { headers: SB });
  return res.status(200).json({ rechnungen: (await r.json().catch(() => [])) || [] });
}

async function getOne(res, user, role, body) {
  const { id } = body || {};
  if (!id) return res.status(400).json({ error: 'id erforderlich' });
  const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/gs_rechnungen?id=eq.${id}&select=*`, { headers: SB })).json().catch(() => []);
  const inv = (rows || [])[0];
  if (!inv) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
  if (role === 'gs_partner') {
    const pr = await (await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?id=eq.${inv.projekt_id}&select=partner_user_id`, { headers: SB })).json().catch(() => []);
    if ((pr || [])[0]?.partner_user_id !== user.id) return res.status(403).json({ error: 'Keine Berechtigung' });
  } else if (role !== 'gs_admin') return res.status(403).json({ error: 'Keine Berechtigung' });
  inv.pdf_signed = inv.pdf_url ? await signUrl('rapport-pdfs', inv.pdf_url) : null;
  return res.status(200).json({ rechnung: inv });
}

async function signUrl(bucket, path, expiresIn = 3600) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, { method: 'POST', headers: SB, body: JSON.stringify({ expiresIn }) });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return d.signedURL ? SUPABASE_URL + '/storage/v1' + d.signedURL : null;
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
