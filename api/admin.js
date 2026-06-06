// api/admin.js – gs_admin user management (create / list / reset password / activate)
//
// Security model (no plaintext passwords, no DDL):
//   • Passwords are hashed in Supabase Auth.
//   • Per-user status + profile live in auth user_metadata.
//   • Temp password is returned ONCE in the create/reset response (admin shows
//     it to the user, then sends manually). Never logged, never stored as text.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

const ROLES = ['gs_partner', 'techniker', 'gs_admin', 'bob_user'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  // ── Require gs_admin ──
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Nicht authentifiziert' });
  const me = await getUser(token);
  if (!me) return res.status(401).json({ error: 'Ungültiger Token' });
  if ((await getRole(me.id)) !== 'gs_admin') return res.status(403).json({ error: 'Nur für Administratoren' });

  try {
    const { action } = req.body || {};
    switch (action) {
      case 'list_users':     return await listUsers(res);
      case 'create_user':    return await createUser(res, req.body);
      case 'reset_password': return await resetPassword(res, req.body);
      case 'set_active':     return await setActive(res, req.body);
      default:               return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Admin Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── Actions ──

async function listUsers(res) {
  const list = await sbJson(await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: SB }));
  const users = Array.isArray(list) ? list : list.users || [];
  const roleRows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/user_roles?select=user_id,role`, { headers: SB }));
  const roleMap = {};
  for (const r of Array.isArray(roleRows) ? roleRows : []) roleMap[r.user_id] = r.role;

  const out = users.map((u) => {
    const m = u.user_metadata || {};
    const banned = u.banned_until && new Date(u.banned_until) > new Date();
    const active = !banned && m.active !== false;
    const status = !active ? 'deactivated' : m.must_change_password ? 'must_change_password' : 'active';
    return {
      id: u.id,
      email: u.email,
      name: m.name || [m.vorname, m.nachname].filter(Boolean).join(' ') || u.email,
      firma: m.firma || null,
      role: roleMap[u.id] || 'bob_user',
      status,
      active,
      must_change_password: !!m.must_change_password,
      profile_complete: !!m.profile_complete,
      last_password_change: m.last_password_change || null,
      created_at: u.created_at || null,
    };
  });
  // Newest first
  out.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  return res.status(200).json({ users: out });
}

async function createUser(res, body) {
  const { name, email, firma, role } = body || {};
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Gültige E-Mail erforderlich' });
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });
  if (role !== 'gs_partner' && role !== 'techniker') return res.status(400).json({ error: 'Rolle muss gs_partner oder techniker sein' });

  const tempPassword = genTempPassword();
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: SB,
    body: JSON.stringify({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        name,
        firma: firma || null,
        tarif: body.tarif != null ? Number(body.tarif) : null,
        must_change_password: true,
        profile_complete: false,
        active: true,
        created_at: new Date().toISOString(),
      },
    }),
  });
  const created = await sbJson(createRes);
  if (!createRes.ok || !created.id) {
    const msg = created?.msg || created?.message || created?.error_description || 'Benutzer konnte nicht erstellt werden';
    const code = /registered|exists|already/i.test(JSON.stringify(created)) ? 409 : 400;
    return res.status(code).json({ error: code === 409 ? 'E-Mail ist bereits registriert' : msg });
  }

  // Role mapping (idempotent upsert on user_id).
  await fetch(`${SUPABASE_URL}/rest/v1/user_roles?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: created.id, role }),
  });

  return res.status(200).json({
    ok: true,
    user: { id: created.id, email, name, firma: firma || null, role },
    temp_password: tempPassword, // shown ONCE
  });
}

async function resetPassword(res, body) {
  const { user_id } = body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id erforderlich' });
  const current = await sbJson(await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, { headers: SB }));
  if (!current?.id) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

  const tempPassword = genTempPassword();
  const meta = { ...(current.user_metadata || {}), must_change_password: true };
  const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
    method: 'PUT',
    headers: SB,
    body: JSON.stringify({ password: tempPassword, user_metadata: meta }),
  });
  if (!upd.ok) return res.status(500).json({ error: 'Passwort-Reset fehlgeschlagen' });
  return res.status(200).json({ ok: true, temp_password: tempPassword });
}

async function setActive(res, body) {
  const { user_id, active } = body || {};
  if (!user_id || typeof active !== 'boolean') return res.status(400).json({ error: 'user_id und active erforderlich' });
  const current = await sbJson(await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, { headers: SB }));
  if (!current?.id) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

  const meta = { ...(current.user_metadata || {}), active };
  const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
    method: 'PUT',
    headers: SB,
    // ban_duration actually blocks login; 'none' lifts it.
    body: JSON.stringify({ ban_duration: active ? 'none' : '876000h', user_metadata: meta }),
  });
  if (!upd.ok) return res.status(500).json({ error: 'Statusänderung fehlgeschlagen' });
  return res.status(200).json({ ok: true, active });
}

// ── Helpers ──

async function getUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}
async function getRole(userId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&select=role&limit=1`, { headers: SB });
  if (!r.ok) return null;
  return (await r.json())[0]?.role || null;
}
async function sbJson(r) { try { return await r.json(); } catch { return {}; } }

// 8-char temp password, unambiguous charset, guaranteed ≥1 letter + ≥1 digit.
function genTempPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = letters + digits;
  const pick = (set) => set[Math.floor(Math.random() * set.length)];
  let pw = pick(letters) + pick(digits);
  for (let i = 0; i < 6; i++) pw += pick(all);
  return pw.split('').sort(() => Math.random() - 0.5).join('');
}

export { ROLES };
