// api/admin.js – gs_admin user management (create / list / reset password / activate)
//
// Security model (no plaintext passwords, no DDL):
//   • Passwords are hashed in Supabase Auth.
//   • Per-user status + profile live in auth user_metadata.
//   • Temp password is returned ONCE in the create/reset response (admin shows
//     it to the user, then sends manually). Never logged, never stored as text.

import { sendResendEmail, materialEmailHtml, rapportEmailHtml, technikerInviteHtml, MATERIAL_FROM, GS_OFFICE_EMAIL } from '../lib/mail.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
// Öffentliche App-Basis-URL (für Einladungs-/Zugangslink). Muss in Supabase Auth →
// Redirect URLs allowlisted sein. Überschreibbar via Env GS_APP_URL.
const APP_URL = (process.env.GS_APP_URL || 'https://baby-bob.vercel.app').replace(/\/$/, '');

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
      case 'create_user':    return await createUser(res, req.body, me.id);
      case 'add_role':       return await addRole(res, req.body, me.id);
      case 'reset_password': return await resetPassword(res, req.body);
      case 'set_active':     return await setActive(res, req.body);
      case 'archive':        return await listArchive(res);
      case 'resend':         return await resendArchive(res, req.body);
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
      last_sign_in_at: u.last_sign_in_at || null,   // letzter Login (aus Supabase Auth)
      created_at: u.created_at || null,
    };
  });
  // Newest first
  out.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  return res.status(200).json({ users: out });
}

async function createUser(res, body, creatorId) {
  const { name, email, firma, role } = body || {};
  const qualifikation = body?.qualifikation ? String(body.qualifikation).slice(0, 200) : null;
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
    // Mail existiert schon → NICHT hart blocken: bestehenden Account melden, damit
    // die UI anbietet, ihm eine ZUSÄTZLICHE Rolle zu geben (Mehrfachrollen).
    if (/registered|exists|already/i.test(JSON.stringify(created))) {
      const ex = await findUserByEmail(email);
      if (ex) return res.status(200).json({ exists: true, user: { id: ex.id, email: ex.email }, current_roles: await getUserRoles(ex.id), role_requested: role });
      return res.status(409).json({ error: 'E-Mail ist bereits registriert' });
    }
    const msg = created?.msg || created?.message || created?.error_description || 'Benutzer konnte nicht erstellt werden';
    return res.status(400).json({ error: msg });
  }

  // Role mapping – KRITISCH: ohne diese Zeile liest der Login role='bob_user'
  // und routet in den BOB-Scanner statt in die Partner-/Techniker-Ansicht.
  // Darum verifiziert schreiben (Fallback ohne on_conflict) und bei Fehlschlag
  // den gerade erstellten Auth-User wieder entfernen (kein rollenloser Waisen-User).
  const roleOk = await ensureRole(created.id, role);
  if (!roleOk) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: SB }).catch(() => {});
    return res.status(500).json({ error: "Rolle konnte nicht gesetzt werden – bitte scripts/setup_auth.sql (Tabelle user_roles) in Supabase ausführen und erneut versuchen." });
  }

  // Techniker: gs_techniker-Profil anlegen/verknüpfen (sonst nicht im Pool zuweisbar).
  let technikerLinked = false;
  if (role === 'techniker') {
    technikerLinked = await linkTechnikerProfile(created.id, { name, email, qualifikation, creatorId });
  }

  // Einladung: branded Magic-/Recovery-Link zum Passwort-Setzen (Fallback: Temp-Passwort).
  let mailSent = false;
  const setLink = await generateInviteLink(email);
  try {
    const html = technikerInviteHtml({ name, setLink, tempPassword, loginUrl: `${APP_URL}/login` });
    const subject = role === 'techniker' ? '👷 Dein George Solutions Techniker-Zugang' : '🔑 Dein George Solutions Zugang';
    const mr = await sendResendEmail({ to: email, subject, html });
    mailSent = !!(mr && mr.ok);
  } catch (e) { console.error('invite mail fail', e.message); }

  return res.status(200).json({
    ok: true,
    user: { id: created.id, email, name, firma: firma || null, role },
    temp_password: tempPassword, // Fallback, einmalig angezeigt
    mail_sent: mailSent,
    techniker_linked: technikerLinked,
  });
}

// gs_techniker-Zeile für den neuen Auth-User anlegen ODER eine bestehende (per E-Mail)
// mit user_id verknüpfen. Tolerant gegenüber noch fehlender erstellt_von_user_id-Spalte
// (scripts/techniker_erstellt_von.sql) → Feld wird dann weggelassen, kein 500.
async function linkTechnikerProfile(userId, { name, email, qualifikation, creatorId }) {
  const base = { user_id: userId, name, email, qualifikation: qualifikation || null };
  const withCreator = { ...base, erstellt_von_user_id: creatorId || null };
  try {
    const existing = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?email=eq.${encodeURIComponent(email)}&select=id,user_id&limit=1`, { headers: SB }));
    const row = Array.isArray(existing) ? existing[0] : null;
    const write = async (payload, method, path) => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(payload) });
      if (!r.ok && /column|erstellt_von|PGRST204|does not exist/i.test(await r.text().catch(() => ''))) {
        const noCreator = method === 'PATCH' ? base : { ...base };
        const r2 = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(noCreator) });
        return r2.ok;
      }
      return r.ok;
    };
    if (row) return await write({ ...withCreator, id: undefined }, 'PATCH', `gs_techniker?id=eq.${row.id}`);
    return await write(withCreator, 'POST', 'gs_techniker');
  } catch (e) { console.error('linkTechnikerProfile fail', e.message); return false; }
}

// Auth-User anhand E-Mail finden (case-insensitiv). Kleiner Bestand → Liste reicht.
async function findUserByEmail(email) {
  const list = await sbJson(await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: SB }));
  const users = Array.isArray(list) ? list : (list.users || []);
  const lc = String(email || '').toLowerCase();
  return users.find((u) => String(u.email || '').toLowerCase() === lc) || null;
}

// Effektive Rollen (Primär + Extra), tolerant falls user_extra_roles fehlt.
async function getUserRoles(userId) {
  const roles = [];
  const prim = await getRole(userId); if (prim) roles.push(prim);
  const ex = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/user_extra_roles?user_id=eq.${userId}&select=role`, { headers: SB }));
  for (const x of Array.isArray(ex) ? ex : []) if (x.role && !roles.includes(x.role)) roles.push(x.role);
  return roles;
}

// Zusätzliche Rolle an einen bestehenden Account geben (Mehrfachrollen). Kein neuer
// Login/Passwort — der Account existiert. Bei 'techniker' zusätzlich gs_techniker-Profil.
async function addRole(res, body, creatorId) {
  let { user_id, email, role } = body || {};
  if (!['gs_partner', 'techniker', 'gs_admin'].includes(role)) return res.status(400).json({ error: 'Ungültige Rolle' });
  if (!user_id && email) { const u = await findUserByEmail(email); user_id = u && u.id; }
  if (!user_id) return res.status(404).json({ error: 'Kein Account mit dieser E-Mail' });

  const r = await fetch(`${SUPABASE_URL}/rest/v1/user_extra_roles?on_conflict=user_id,role`, {
    method: 'POST', headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id, role }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    if (/does not exist|42P01|PGRST20|schema cache/i.test(t)) return res.status(500).json({ error: 'Bitte scripts/user_extra_roles.sql in Supabase ausführen.', notMigrated: true });
    return res.status(500).json({ error: 'Rolle konnte nicht hinzugefügt werden' });
  }

  let technikerLinked = false;
  if (role === 'techniker') {
    const u = await sbJson(await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, { headers: SB }));
    const nm = (u.user_metadata && u.user_metadata.name) || u.email || 'Techniker';
    technikerLinked = await linkTechnikerProfile(user_id, { name: nm, email: u.email, qualifikation: body.qualifikation || null, creatorId });
  }
  return res.status(200).json({ ok: true, user_id, role_added: role, roles: await getUserRoles(user_id), techniker_linked: technikerLinked });
}

// Supabase-Aktionslink erzeugen (Recovery = Passwort setzen). Landet nach Klick auf
// APP_URL/login mit Session im Hash → app.html-Onboarding (must_change_password).
// Gibt null zurück, wenn der Endpoint nicht verfügbar ist (dann greift der Temp-PW-Fallback).
async function generateInviteLink(email) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST', headers: SB,
      body: JSON.stringify({ type: 'recovery', email, redirect_to: `${APP_URL}/login` }),
    });
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    return d.action_link || d.properties?.action_link || null;
  } catch { return null; }
}

// Schreibt die Rolle robust und bestätigt sie durch Rücklesen.
// 1) Upsert (schnell, wenn user_roles den UNIQUE(user_id)-Constraint hat).
// 2) Fallback ohne on_conflict: alte Zeile löschen + neu einfügen (funktioniert
//    auch, wenn der Constraint im Live-Schema fehlt – dann scheitert der Upsert-
//    Pfad mit 42P10). 3) Verifizieren, dass die Zeile mit der Rolle existiert.
async function ensureRole(userId, role) {
  const upsert = await fetch(`${SUPABASE_URL}/rest/v1/user_roles?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: userId, role }),
  }).catch(() => null);

  if (!upsert || !upsert.ok) {
    // Fallback: kein on_conflict → delete + plain insert.
    await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}`, { method: 'DELETE', headers: SB }).catch(() => {});
    await fetch(`${SUPABASE_URL}/rest/v1/user_roles`, {
      method: 'POST',
      headers: { ...SB, Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userId, role }),
    }).catch(() => {});
  }

  // Verifizieren.
  const check = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&select=role&limit=1`, { headers: SB }));
  return Array.isArray(check) && check[0]?.role === role;
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

// ── Archiv: alle Rapporte + Materiallisten (für nachträglichen Mailversand) ──
async function listArchive(res) {
  const [ml, rp, techs, projs] = await Promise.all([
    sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_nachrichten?typ=eq.materialliste&select=id,created_at,von_id,an_id,inhalt,status&order=created_at.desc&limit=300`, { headers: SB })),
    sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?select=id,datum,projekt_id,techniker_user_id,gesamtstunden,arbeiten,material,empfaenger,status,created_at&order=datum.desc&limit=300`, { headers: SB })),
    sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?select=user_id,name`, { headers: SB })),
    sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?select=id,projektnummer,name`, { headers: SB })),
  ]);
  const techName = {}; (Array.isArray(techs) ? techs : []).forEach((t) => { if (t.user_id) techName[t.user_id] = t.name; });
  const projMap = {}; (Array.isArray(projs) ? projs : []).forEach((p) => { projMap[p.id] = { nr: p.projektnummer, name: p.name }; });

  const items = [];
  (Array.isArray(ml) ? ml : []).forEach((m) => {
    const inh = m.inhalt || {};
    items.push({
      kind: 'materialliste', id: m.id, datum: (m.created_at || '').slice(0, 10),
      projektnr: inh.projekt_name || '–', ersteller: inh.von_name || '–', typ: 'Materialliste',
      empfaenger: inh.empfaenger_email || '(GS-Büro)', status: 'gesendet', ts: m.created_at || '',
    });
  });
  (Array.isArray(rp) ? rp : []).forEach((r) => {
    const pm = projMap[r.projekt_id] || {};
    items.push({
      kind: 'rapport', id: r.id, datum: r.datum || (r.created_at || '').slice(0, 10),
      projektnr: pm.nr || pm.name || '–', ersteller: techName[r.techniker_user_id] || '–', typ: 'Rapport',
      empfaenger: (Array.isArray(r.empfaenger) ? r.empfaenger.join(', ') : '') || '–',
      status: r.status === 'eingereicht' ? 'gesendet' : 'Entwurf', ts: (r.datum || r.created_at || '') + 'T00:00:00',
    });
  });
  items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  return res.status(200).json({ items });
}

// ── Archiv "Erneut senden": löst die Mail erneut aus (gleicher Resend-/Punycode-Pfad) ──
async function resendArchive(res, body) {
  const { kind, id } = body || {};
  if (!id || !kind) return res.status(400).json({ error: 'kind + id erforderlich' });

  if (kind === 'materialliste') {
    const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_nachrichten?id=eq.${id}&select=inhalt&limit=1`, { headers: SB }));
    const row = (Array.isArray(rows) ? rows : [])[0];
    if (!row) return res.status(404).json({ error: 'Materialliste nicht gefunden' });
    const inh = row.inhalt || {};
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(inh.empfaenger_email || '').trim());
    const to = valid ? inh.empfaenger_email.trim() : GS_OFFICE_EMAIL;
    const html = materialEmailHtml({
      projektName: inh.projekt_name || 'Projekt', vonName: inh.von_name || 'Techniker',
      positionen: inh.positionen || [], notiz: inh.notiz || '', tel: inh.empfaenger_tel || '', fallbackUsed: !valid,
    });
    const result = await sendResendEmail({ to, from: MATERIAL_FROM, subject: `📦 Materialliste – ${inh.projekt_name || 'Projekt'} (erneut gesendet)`, html });
    if (result && result.ok) return res.status(200).json({ ok: true, mail_sent: true, to, resend_id: result.id || null });
    return res.status(502).json({ error: 'Versand fehlgeschlagen', mail_error: (result && result.error) || null });
  }

  if (kind === 'rapport') {
    const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?id=eq.${id}&select=*&limit=1`, { headers: SB }));
    const r = (Array.isArray(rows) ? rows : [])[0];
    if (!r) return res.status(404).json({ error: 'Rapport nicht gefunden' });
    // Projektnr + Techniker-Name auflösen.
    const [projs, techs] = await Promise.all([
      r.projekt_id ? sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?id=eq.${r.projekt_id}&select=projektnummer,name&limit=1`, { headers: SB })) : [],
      sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?user_id=eq.${r.techniker_user_id}&select=name&limit=1`, { headers: SB })),
    ]);
    const pm = (Array.isArray(projs) ? projs : [])[0] || {};
    const vonName = ((Array.isArray(techs) ? techs : [])[0] || {}).name || 'Techniker';
    const html = rapportEmailHtml({
      projektNr: pm.projektnummer || pm.name || 'Projekt', vonName, datum: r.datum,
      stunden: r.gesamtstunden, arbeiten: r.arbeiten, material: r.material,
      besonderheiten: r.besonderheiten, empfaenger: r.empfaenger,
    });
    // Rapporte haben keine Empfänger-Mailadresse → ans GS-Büro (Recovery-Zweck).
    const result = await sendResendEmail({ to: GS_OFFICE_EMAIL, from: MATERIAL_FROM, subject: `📋 Tagesrapport – ${pm.projektnummer || pm.name || 'Projekt'} · ${r.datum || ''} (erneut gesendet)`, html });
    if (result && result.ok) return res.status(200).json({ ok: true, mail_sent: true, to: GS_OFFICE_EMAIL, resend_id: result.id || null });
    return res.status(502).json({ error: 'Versand fehlgeschlagen', mail_error: (result && result.error) || null });
  }

  return res.status(400).json({ error: 'Unbekannter kind' });
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
