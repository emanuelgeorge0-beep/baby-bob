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
    const { action, email, password, token, redirect_to } = req.body || {};
    switch (action) {
      case 'magic_link':     return await sendMagicLink(res, email, redirect_to);
      case 'login':          return await loginWithPassword(res, email, password);
      case 'reset_password': return await sendPasswordReset(res, email, redirect_to);
      case 'verify':         return await verifyToken(res, token);
      case 'refresh':        return await refreshSession(res, req.body?.refresh_token);
      default:               return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Auth Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// Nur eigene, bekannte Ziel-Pfade als Redirect zulassen (kein Open-Redirect).
// Supabase erzwingt zusätzlich seine eigene Redirect-URL-Allowlist.
function safeRedirectQuery(redirectTo) {
  if (!redirectTo) return '';
  const ALLOWED_PATHS = ['/gs-intern-7k2x', '/gewerke'];
  try {
    const u = new URL(redirectTo);
    if (ALLOWED_PATHS.includes(u.pathname) && (u.protocol === 'https:' || u.protocol === 'http:')) {
      // Query (z. B. ?demo=1) mitnehmen, damit der Nutzer im gleichen Kontext landet.
      return `?redirect_to=${encodeURIComponent(u.origin + u.pathname + (u.search || ''))}`;
    }
  } catch { /* ungültige URL → ignorieren */ }
  return '';
}

async function sendMagicLink(res, email, redirectTo) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Bitte gültige E-Mail eingeben' });
  }
  // create_user:true → OTP works for ANY email (creates the user if new).
  // No whitelist/restriction. NOTE: deliverability + rate limits are a
  // Supabase Auth setting (custom SMTP required for production volume).
  const r = await fetch(`${SUPABASE_URL}/auth/v1/otp${safeRedirectQuery(redirectTo)}`, {
    method: 'POST',
    headers: SB_HEADERS,
    body: JSON.stringify({ email, create_user: true }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    const msg = err.msg || err.message || err.error_description || '';
    if (/rate limit/i.test(msg)) return res.status(429).json({ error: 'E-Mail-Limit erreicht – bitte kurz warten ODER mit Passwort anmelden.' });
    return res.status(400).json({ error: msg || 'Magic Link fehlgeschlagen' });
  }
  return res.status(200).json({ ok: true });
}

// Passwort-Reset/-Setzen: schickt eine Recovery-Mail (Supabase). Partner/Techniker können
// sich so selbst ein Passwort setzen. Antwort immer ok (kein User-Enumeration-Leak).
async function sendPasswordReset(res, email, redirectTo) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Bitte gültige E-Mail eingeben' });
  }
  const r = await fetch(`${SUPABASE_URL}/auth/v1/recover${safeRedirectQuery(redirectTo)}`, {
    method: 'POST',
    headers: SB_HEADERS,
    body: JSON.stringify({ email }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    const msg = err.msg || err.message || err.error_description || '';
    if (/rate limit/i.test(msg)) return res.status(429).json({ error: 'E-Mail-Limit erreicht – bitte kurz warten und erneut versuchen.' });
    // Bei sonstigen Fehlern trotzdem neutral bestätigen (kein Enumeration-Leak).
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
    const raw = err.error_description || err.msg || err.error || '';
    // Alle Fehlerfelder zusammenfassen (GoTrue nutzt je nach Version error_code/code).
    const sig = `${raw} ${err.error_code || ''} ${err.code || ''}`.toLowerCase();

    // Deaktivierter Account (setActive → ban_duration): sauber & klar abweisen.
    if (/banned|deactiv/.test(sig)) {
      return res.status(403).json({ error: 'Dieser Account ist deaktiviert. Bitte wende dich an George Solutions.', deactivated: true });
    }
    // E-Mail noch nicht bestätigt (Randfall – Admin-Accounts sind bestätigt).
    if (/not confirmed|email_not_confirmed/.test(sig)) {
      return res.status(401).json({ error: 'E-Mail ist noch nicht bestätigt. Bitte nutze den Magic Link aus deiner E-Mail.' });
    }
    // Falsches Passwort ODER unbekannte E-Mail: GoTrue fasst beides bewusst zusammen
    // (kein User-Enumeration-Leak) → freundlich, mit Hinweis auf Magic Link / Passwort neu.
    if (/invalid login credentials|invalid_grant|invalid credentials/.test(sig)) {
      return res.status(401).json({ error: "E-Mail oder Passwort ist nicht korrekt. Noch kein Passwort gesetzt? Nutze den Magic Link oder 'Passwort vergessen'.", no_password: true });
    }
    return res.status(401).json({ error: 'Anmeldung fehlgeschlagen – bitte erneut versuchen.' });
  }
  const data = await r.json();
  const role = await getUserRole(data.user?.id);
  const roles = await getEffectiveRoles(data.user?.id, role);
  const techName = roles.includes('techniker') ? await getTechName(data.user?.id) : null;
  const m = data.user?.user_metadata || {};
  return res.status(200).json({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    user: { id: data.user?.id, email: data.user?.email },
    role,          // Primärrolle (Default-Ansicht)
    roles,         // alle gehaltenen Rollen (für Rollen-Umschalter)
    tech_name: techName,
    must_change_password: !!m.must_change_password,
    profile_complete: !!m.profile_complete,
  });
}

// Token refresh — keeps logged-in sessions robust past the 1h access-token expiry.
async function refreshSession(res, refreshToken) {
  if (!refreshToken) return res.status(400).json({ error: 'refresh_token fehlt' });
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: SB_HEADERS, body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!r.ok) return res.status(401).json({ error: 'Sitzung abgelaufen' });
  const data = await r.json();
  const role = await getUserRole(data.user?.id);
  return res.status(200).json({ access_token: data.access_token, refresh_token: data.refresh_token, role, user: { id: data.user?.id, email: data.user?.email } });
}

async function verifyToken(res, token) {
  if (!token) return res.status(401).json({ error: 'Token fehlt' });
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!r.ok) return res.status(401).json({ error: 'Ungültiger oder abgelaufener Token' });
  const user = await r.json();
  const role = await getUserRole(user.id);
  const roles = await getEffectiveRoles(user.id, role);
  const techName = roles.includes('techniker') ? await getTechName(user.id) : null;
  const m = user.user_metadata || {};
  return res.status(200).json({
    user: { id: user.id, email: user.email },
    role,          // Primärrolle (Default-Ansicht)
    roles,         // alle gehaltenen Rollen (für Rollen-Umschalter)
    tech_name: techName,
    must_change_password: !!m.must_change_password,
    profile_complete: !!m.profile_complete,
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

// Effektive Rollen = Primärrolle (user_roles) ∪ Extra-Rollen (user_extra_roles).
// Primärrolle steht IMMER an erster Stelle (= Default-Ansicht nach Login).
// Tolerant, falls user_extra_roles noch nicht migriert ist.
async function getEffectiveRoles(userId, primary) {
  const roles = [];
  const prim = primary || (await getUserRole(userId));
  if (prim) roles.push(prim);
  if (userId) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/user_extra_roles?user_id=eq.${userId}&select=role`, { headers: SB_HEADERS });
      if (r.ok) { const rows = await r.json(); for (const x of Array.isArray(rows) ? rows : []) if (x.role && !roles.includes(x.role)) roles.push(x.role); }
    } catch (_) {}
  }
  return roles;
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
