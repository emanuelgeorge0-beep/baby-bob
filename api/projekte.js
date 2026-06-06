// api/projekte.js – Projektmanagement (admin CRUD + assignment, role-filtered reads)
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
    const adminOnly = ['create', 'update', 'assign', 'technicians', 'partners'];
    if (adminOnly.includes(action) && role !== 'gs_admin') return res.status(403).json({ error: 'Nur für Administratoren' });

    switch (action) {
      case 'list':        return await list(res, user, role);
      case 'get':         return await getOne(res, user, role, req.body);
      case 'create':      return await create(res, req.body);
      case 'update':      return await update(res, req.body);
      case 'assign':      return await assign(res, req.body);
      case 'technicians': return await technicians(res);
      case 'partners':    return await partners(res);
      default:            return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Projekte Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function list(res, user, role) {
  let url;
  if (role === 'gs_admin') {
    url = `${SUPABASE_URL}/rest/v1/gs_projekte?select=*,gs_projekt_techniker(techniker_user_id)&order=created_at.desc`;
  } else if (role === 'gs_partner') {
    url = `${SUPABASE_URL}/rest/v1/gs_projekte?partner_user_id=eq.${user.id}&select=*,gs_projekt_techniker(techniker_user_id)&order=created_at.desc`;
  } else if (role === 'techniker') {
    // Projects the techniker is assigned to.
    const a = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekt_techniker?techniker_user_id=eq.${user.id}&select=projekt_id`, { headers: SB }));
    const ids = (Array.isArray(a) ? a : []).map((x) => x.projekt_id);
    if (!ids.length) return res.status(200).json({ projekte: [] });
    url = `${SUPABASE_URL}/rest/v1/gs_projekte?id=in.(${ids.join(',')})&select=*,gs_projekt_techniker(techniker_user_id)&order=created_at.desc`;
  } else {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const rows = await sbJson(await fetch(url, { headers: SB }));
  return res.status(200).json({ projekte: await withTechNames(Array.isArray(rows) ? rows : []) });
}

async function getOne(res, user, role, body) {
  const { id } = body || {};
  if (!id) return res.status(400).json({ error: 'id erforderlich' });
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?id=eq.${id}&select=*,gs_projekt_techniker(techniker_user_id)`, { headers: SB }));
  const p = (Array.isArray(rows) ? rows : [])[0];
  if (!p) return res.status(404).json({ error: 'Projekt nicht gefunden' });
  // Access check
  if (role === 'gs_partner' && p.partner_user_id !== user.id) return res.status(403).json({ error: 'Keine Berechtigung' });
  if (role === 'techniker') {
    const assigned = (p.gs_projekt_techniker || []).some((t) => t.techniker_user_id === user.id);
    if (!assigned) return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const [withNames] = await withTechNames([p]);
  return res.status(200).json({ projekt: withNames });
}

async function create(res, body) {
  const { name, standort, bereich, tarif, stundensatz, kunde_id, partner_user_id } = body || {};
  if (!name) return res.status(400).json({ error: 'Projektname erforderlich' });
  let { projektnummer } = body || {};
  if (!projektnummer) projektnummer = await nextProjektnummer();
  const payload = { name, projektnummer, standort: standort || null, bereich: bereich || null, tarif: tarif || null,
    stundensatz: stundensatz != null ? Number(stundensatz) : null, kunde_id: kunde_id || null, partner_user_id: partner_user_id || null };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte`, { method: 'POST', headers: { ...SB, Prefer: 'return=representation' }, body: JSON.stringify(payload) });
  const rows = await sbJson(r);
  if (!r.ok) {
    if (/duplicate|unique/i.test(JSON.stringify(rows))) return res.status(409).json({ error: 'Projektnummer existiert bereits' });
    return res.status(400).json({ error: rows?.message || 'Projekt konnte nicht erstellt werden' });
  }
  if (Array.isArray(body.techniker_user_ids)) await replaceAssignments(rows[0].id, body.techniker_user_ids);
  return res.status(200).json({ ok: true, projekt: rows[0] });
}

async function update(res, body) {
  const { id } = body || {};
  if (!id) return res.status(400).json({ error: 'id erforderlich' });
  const fields = {};
  ['name', 'standort', 'bereich', 'tarif', 'status', 'kunde_id', 'partner_user_id', 'notiz'].forEach((k) => { if (k in body) fields[k] = body[k]; });
  if ('stundensatz' in body) fields.stundensatz = body.stundensatz != null ? Number(body.stundensatz) : null;
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Keine Felder zum Aktualisieren' });

  const patch = async (f) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?id=eq.${id}`, { method: 'PATCH', headers: { ...SB, Prefer: 'return=representation' }, body: JSON.stringify(f) });
    return { ok: r.ok, rows: await sbJson(r), text: r.ok ? '' : JSON.stringify(await sbJson(r).catch(() => '')) };
  };
  let r = await patch(fields);
  // If the notiz column isn't migrated yet, save the rest without it.
  if (!r.ok && 'notiz' in fields) { const { notiz, ...rest } = fields; if (Object.keys(rest).length) r = await patch(rest); }
  if (!r.ok || !r.rows?.[0]) return res.status(400).json({ error: 'Aktualisierung fehlgeschlagen' });
  return res.status(200).json({ ok: true, projekt: r.rows[0] });
}

async function assign(res, body) {
  const { projekt_id, techniker_user_ids } = body || {};
  if (!projekt_id || !Array.isArray(techniker_user_ids)) return res.status(400).json({ error: 'projekt_id und techniker_user_ids erforderlich' });
  await replaceAssignments(projekt_id, techniker_user_ids);
  return res.status(200).json({ ok: true, assigned: techniker_user_ids.length });
}

async function technicians(res) {
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?user_id=not.is.null&select=user_id,name&order=name`, { headers: SB }));
  return res.status(200).json({ technicians: (Array.isArray(rows) ? rows : []).map((t) => ({ user_id: t.user_id, name: t.name })) });
}

async function partners(res) {
  const roleRows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/user_roles?role=eq.gs_partner&select=user_id`, { headers: SB }));
  const ids = (Array.isArray(roleRows) ? roleRows : []).map((r) => r.user_id);
  const list = await sbJson(await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: SB }));
  const users = Array.isArray(list) ? list : list.users || [];
  const out = users.filter((u) => ids.includes(u.id)).map((u) => ({ user_id: u.id, name: u.user_metadata?.name || u.email, firma: u.user_metadata?.firma || null }));
  return res.status(200).json({ partners: out });
}

// ── helpers ──
async function replaceAssignments(projektId, userIds) {
  await fetch(`${SUPABASE_URL}/rest/v1/gs_projekt_techniker?projekt_id=eq.${projektId}`, { method: 'DELETE', headers: SB });
  const clean = [...new Set(userIds.filter(Boolean))];
  if (!clean.length) return;
  await fetch(`${SUPABASE_URL}/rest/v1/gs_projekt_techniker`, { method: 'POST', headers: { ...SB, Prefer: 'return=minimal' },
    body: JSON.stringify(clean.map((uid) => ({ projekt_id: projektId, techniker_user_id: uid }))) });
}

async function withTechNames(projekte) {
  const ids = [...new Set(projekte.flatMap((p) => (p.gs_projekt_techniker || []).map((t) => t.techniker_user_id)))];
  let nameMap = {};
  if (ids.length) {
    const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?user_id=in.(${ids.join(',')})&select=user_id,name`, { headers: SB }));
    for (const r of Array.isArray(rows) ? rows : []) nameMap[r.user_id] = r.name;
  }
  return projekte.map((p) => ({
    ...p,
    techniker: (p.gs_projekt_techniker || []).map((t) => ({ user_id: t.techniker_user_id, name: nameMap[t.techniker_user_id] || 'Techniker' })),
    gs_projekt_techniker: undefined,
  }));
}

async function nextProjektnummer() {
  const year = new Date().getFullYear();
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?projektnummer=like.P-${year}-*&select=projektnummer&order=projektnummer.desc&limit=1`, { headers: SB }));
  let n = 1;
  const last = (Array.isArray(rows) ? rows : [])[0]?.projektnummer;
  if (last) { const m = last.match(/(\d+)$/); if (m) n = parseInt(m[1], 10) + 1; }
  return `P-${year}-${String(n).padStart(4, '0')}`;
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
