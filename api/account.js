// api/account.js – Authenticated user self-service: status, password change, profile
//
// Updates are applied server-side with the service key after verifying the
// caller's bearer token, so security flags (must_change_password) can't be
// forged by the client.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

const PARTNER_ROLLEN = ['CEO', 'Projektleiter', 'Bauleiter', 'Einkauf', 'Sonstiges'];
const TECH_QUALIFIKATION = ['Meister', 'Gesellenbrief AF', 'Monteur', 'Bauleiter'];
const TECH_SPEZIALISIERUNG = ['Sanitär', 'Heizung', 'Lüftung', 'Klima'];

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

  try {
    const { action } = req.body || {};
    switch (action) {
      case 'me':               return await me(res, user);
      case 'change_password':  return await changePassword(res, user, req.body);
      case 'complete_profile': return await completeProfile(res, user, req.body);
      case 'update_settings':  return await updateSettings(res, user, req.body);
      default:                 return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Account Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// Post-onboarding settings edit (Partner Einstellungen, Techniker IBAN, etc.)
async function updateSettings(res, user, body) {
  const allowed = ['firma', 'telefon', 'rechnungsadresse', 'iban', 'vorname', 'nachname', 'position', 'photo_url'];
  const meta = { ...(user.user_metadata || {}) };
  let changed = 0;
  for (const k of allowed) {
    if (k in (body || {})) { meta[k] = body[k]; changed++; }
  }
  if (meta.vorname || meta.nachname) meta.name = `${meta.vorname || ''} ${meta.nachname || ''}`.trim();
  if (!changed) return res.status(400).json({ error: 'Keine Felder' });
  const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT', headers: SB, body: JSON.stringify({ user_metadata: meta }),
  });
  if (!upd.ok) return res.status(500).json({ error: 'Speichern fehlgeschlagen' });
  return res.status(200).json({ ok: true, profile: profileView(meta) });
}

async function me(res, user) {
  const role = await getRole(user.id);
  const m = user.user_metadata || {};
  return res.status(200).json({
    user: { id: user.id, email: user.email },
    role,
    must_change_password: !!m.must_change_password,
    profile_complete: !!m.profile_complete,
    profile: profileView(m),
  });
}

async function changePassword(res, user, body) {
  const { new_password } = body || {};
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben' });
  }
  const m = user.user_metadata || {};
  const log = Array.isArray(m.password_changes) ? m.password_changes.slice(-9) : [];
  log.push(new Date().toISOString());

  const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers: SB,
    body: JSON.stringify({
      password: new_password,
      user_metadata: { ...m, must_change_password: false, last_password_change: new Date().toISOString(), password_changes: log },
    }),
  });
  if (!upd.ok) {
    const e = await upd.text();
    // Supabase rejects re-using the same password ("New password should be different…")
    if (/different|same/i.test(e)) return res.status(400).json({ error: 'Neues Passwort muss sich vom alten unterscheiden' });
    return res.status(500).json({ error: 'Passwortänderung fehlgeschlagen' });
  }
  return res.status(200).json({ ok: true, must_change_password: false });
}

async function completeProfile(res, user, body) {
  const role = await getRole(user.id);
  const p = body?.profile || {};
  const errs = [];
  if (!p.vorname) errs.push('Vorname');
  if (!p.nachname) errs.push('Nachname');
  if (!p.telefon) errs.push('Telefon');

  const meta = { ...(user.user_metadata || {}) };
  meta.vorname = p.vorname;
  meta.nachname = p.nachname;
  meta.name = `${p.vorname} ${p.nachname}`.trim();
  meta.telefon = p.telefon;

  if (role === 'gs_partner') {
    if (!p.firma) errs.push('Firma');
    if (!PARTNER_ROLLEN.includes(p.position)) errs.push('Rolle');
    meta.firma = p.firma;
    meta.position = p.position;
  } else if (role === 'techniker') {
    if (!TECH_QUALIFIKATION.includes(p.qualifikation)) errs.push('Qualifikation');
    const spez = Array.isArray(p.spezialisierung) ? p.spezialisierung.filter((s) => TECH_SPEZIALISIERUNG.includes(s)) : [];
    if (!spez.length) errs.push('Spezialisierung');
    meta.qualifikation = p.qualifikation;
    meta.spezialisierung = spez;
    if (p.iban) meta.iban = p.iban;
  } else {
    return res.status(403).json({ error: 'Profil nur für gs_partner oder techniker' });
  }

  if (errs.length) return res.status(400).json({ error: 'Pflichtfelder fehlen: ' + errs.join(', ') });

  meta.profile_complete = true;
  const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers: SB,
    body: JSON.stringify({ user_metadata: meta }),
  });
  if (!upd.ok) return res.status(500).json({ error: 'Profil konnte nicht gespeichert werden' });

  // Best-effort: sync techniker profile into gs_techniker (matched by email) so
  // the showcase + future rapport linkage reflect real data. Uses existing
  // columns only; rich fields go into the notizen JSON sidecar.
  if (role === 'techniker') {
    try {
      const side = JSON.stringify({
        qualification: meta.qualifikation,
        specialization: meta.spezialisierung,
        photo_emoji: '👷',
      });
      await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?email=eq.${encodeURIComponent(user.email)}`, {
        method: 'PATCH',
        headers: { ...SB, Prefer: 'return=minimal' },
        body: JSON.stringify({ name: meta.name, verfuegbar: true, notizen: side }),
      });
    } catch {}
  }

  return res.status(200).json({ ok: true, profile_complete: true, role });
}

function profileView(m) {
  return {
    vorname: m.vorname || null, nachname: m.nachname || null, name: m.name || null,
    firma: m.firma || null, position: m.position || null, telefon: m.telefon || null,
    qualifikation: m.qualifikation || null, spezialisierung: m.spezialisierung || [],
    iban: m.iban || null, rechnungsadresse: m.rechnungsadresse || null, photo_url: m.photo_url || null,
  };
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

export { PARTNER_ROLLEN, TECH_QUALIFIKATION, TECH_SPEZIALISIERUNG };
