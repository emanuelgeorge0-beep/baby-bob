// api/projectflow.js – Dünner Storage-Endpunkt für den Projekt-Workflow (Feature projectflow).
// Bewusst minimal: NUR was kein bestehender Endpunkt abdeckt – Plan-Upload nach Bucket 'plans'
// und Techniker-Stammdaten inkl. E-Mail (für die Bestell-Mail). Alles andere (Projekte, Rapport,
// Bestell-Mail, Sprachmemo) läuft über die bestehenden Endpunkte /api/projekte, /api/tagesrapport,
// /api/nachrichten, /api/voice. Muster 1:1 aus api/tagesrapport.js + api/projekte.js übernommen.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const PLANS_BUCKET = 'plans';

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
  if (!['gs_admin', 'gs_partner', 'techniker'].includes(role)) return res.status(403).json({ error: 'Keine Berechtigung' });

  try {
    const { action } = req.body || {};
    switch (action) {
      case 'technicians': return await technicians(res);
      case 'plan_upload': return await planUpload(res, user, role, req.body);
      case 'plan_list':   return await planList(res, user, role, req.body);
      case 'plan_delete': return await planDelete(res, user, role, req.body);
      default:            return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Projectflow Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// Techniker-Stammdaten inkl. E-Mail/Telefon – für Mehrfachauswahl + Bestell-Mail-Empfänger.
async function technicians(res) {
  const rows = await sbJson(await fetch(
    `${SUPABASE_URL}/rest/v1/gs_techniker?user_id=not.is.null&select=user_id,name,email,telefon&order=name`,
    { headers: SB }
  ));
  const list = (Array.isArray(rows) ? rows : []).map((t) => ({
    user_id: t.user_id, name: t.name, email: t.email || null, telefon: t.telefon || null,
  }));
  return res.status(200).json({ technicians: list });
}

async function planUpload(res, user, role, body) {
  const { projekt_id, filename } = body || {};
  if (!projekt_id) return res.status(400).json({ error: 'projekt_id erforderlich' });
  if (!(await hasProjectAccess(user, role, projekt_id))) return res.status(403).json({ error: 'Kein Zugriff auf dieses Projekt' });
  const buf = decodeB64(body.data);
  if (!buf) return res.status(400).json({ error: 'Datei (base64) erforderlich' });
  if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Datei zu gross (max. 8 MB)' });

  const safe = safeName(filename || 'plan');
  const path = `${projekt_id}/${Date.now()}-${safe}`;
  const contentType = body.contentType || guessType(safe);
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${PLANS_BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: buf,
  });
  if (!up.ok) {
    const t = await up.text().catch(() => '');
    if (/bucket not found/i.test(t)) return res.status(503).json({ error: `Storage-Bucket '${PLANS_BUCKET}' fehlt – scripts/projectflow.sql ausführen.` });
    console.error('plan upload fail', up.status, t);
    return res.status(500).json({ error: 'Upload fehlgeschlagen' });
  }
  const url = await signUrl(PLANS_BUCKET, path);
  return res.status(200).json({ ok: true, plan: { name: safe, path, contentType, size: buf.length, url } });
}

async function planList(res, user, role, body) {
  const { projekt_id } = body || {};
  if (!projekt_id) return res.status(400).json({ error: 'projekt_id erforderlich' });
  if (!(await hasProjectAccess(user, role, projekt_id))) return res.status(403).json({ error: 'Kein Zugriff auf dieses Projekt' });
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${PLANS_BUCKET}`, {
    method: 'POST', headers: SB,
    body: JSON.stringify({ prefix: `${projekt_id}/`, limit: 200, sortBy: { column: 'created_at', order: 'desc' } }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    if (/bucket not found/i.test(t)) return res.status(200).json({ plans: [] }); // Bucket noch nicht angelegt → leere Liste
    return res.status(200).json({ plans: [] });
  }
  const objs = await sbJson(r);
  const list = (Array.isArray(objs) ? objs : []).filter((o) => o && o.name && o.id !== null);
  const plans = await Promise.all(list.map(async (o) => {
    const path = `${projekt_id}/${o.name}`;
    return {
      name: displayName(o.name),
      path,
      size: o.metadata?.size || null,
      contentType: o.metadata?.mimetype || null,
      created_at: o.created_at || null,
      url: await signUrl(PLANS_BUCKET, path),
    };
  }));
  return res.status(200).json({ plans });
}

async function planDelete(res, user, role, body) {
  const { projekt_id, path } = body || {};
  if (!projekt_id || !path) return res.status(400).json({ error: 'projekt_id + path erforderlich' });
  if (!String(path).startsWith(`${projekt_id}/`)) return res.status(400).json({ error: 'Ungültiger Pfad' });
  if (!(await hasProjectAccess(user, role, projekt_id))) return res.status(403).json({ error: 'Kein Zugriff auf dieses Projekt' });
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${PLANS_BUCKET}/${path}`, { method: 'DELETE', headers: SB });
  if (!r.ok) return res.status(500).json({ error: 'Löschen fehlgeschlagen' });
  return res.status(200).json({ ok: true });
}

// ── access & helpers (Muster aus api/projekte.js) ──
async function hasProjectAccess(user, role, projektId) {
  if (role === 'gs_admin') return true;
  const rows = await sbJson(await fetch(
    `${SUPABASE_URL}/rest/v1/gs_projekte?id=eq.${projektId}&select=partner_user_id,gs_projekt_techniker(techniker_user_id)`,
    { headers: SB }
  ));
  const p = (Array.isArray(rows) ? rows : [])[0];
  if (!p) return false;
  if (role === 'gs_partner') return p.partner_user_id === user.id;
  if (role === 'techniker') return (p.gs_projekt_techniker || []).some((t) => t.techniker_user_id === user.id);
  return false;
}

async function signUrl(bucket, path, expiresIn = 3600) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, { method: 'POST', headers: SB, body: JSON.stringify({ expiresIn }) });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return d.signedURL ? SUPABASE_URL + '/storage/v1' + d.signedURL : null;
}
function decodeB64(s) {
  if (!s || typeof s !== 'string') return null;
  const raw = s.includes(',') ? s.split(',')[1] : s;
  try { const b = Buffer.from(raw, 'base64'); return b.length ? b : null; } catch { return null; }
}
function safeName(n) { return String(n || 'plan').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120) || 'plan'; }
function displayName(n) { return String(n).replace(/^\d{10,}-/, ''); } // führenden Timestamp-Prefix ausblenden
function guessType(n) {
  const e = String(n).toLowerCase().split('.').pop();
  return { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', dwg: 'application/acad', dxf: 'image/vnd.dxf' }[e] || 'application/octet-stream';
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
