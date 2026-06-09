// api/nachrichten.js – in-app messages / notifications (Task 7)
// Techniker → Projektleiter (materialliste/rapport), inbox, unread badge.
// Materialliste wird zusätzlich per E-Mail (Resend) an den Projektleiter geschickt.
import { sendResendEmail, materialEmailHtml } from '../lib/mail.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
// Materiallisten-Mail: Absender IMMER fix info@george-solutions.ch (nicht der eingeloggte Techniker).
const MATERIAL_FROM = 'George Solutions <info@george-solutions.ch>';
// Fallback-Empfänger (GS-Büro), falls keine gültige Projektleiter-Adresse mitkommt.
const MATERIAL_OFFICE = 'info@george-solutions.ch';

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
  const trace = [];
  const T = (step, info) => { const line = info === undefined ? step : step + ' ' + JSON.stringify(info); trace.push(line); console.log('[MATERIAL-MAIL]', line); };

  // (A) Eingehender Body – sofort am Anfang.
  const empfEmailRaw = body.empfaenger_email;
  const empfTelRaw = body.empfaenger_tel;
  T('handler-in', { typ: body.typ, empfaenger_email: empfEmailRaw, empfaenger_tel: empfTelRaw, projekt_name: body.projekt_name, has_inhalt: !!body.inhalt, von: user.email });

  // typ is CHECK-constrained on the table; coerce to an allowed value.
  const typ = ['materialliste', 'rapport', 'nachricht'].includes(body.typ) ? body.typ : 'nachricht';
  const projekt_id = body.projekt_id || null;
  let an_id = body.an_id || null;
  // Best-effort recipient resolution from a GS project (read-only).
  if (!an_id && projekt_id) {
    const p = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?id=eq.${projekt_id}&select=partner_user_id&limit=1`, { headers: SB }));
    an_id = (Array.isArray(p) ? p : [])[0]?.partner_user_id || null;
  }
  // Empfänger-Infos in inhalt persistieren → Archiv-"Erneut senden" ist self-contained.
  const inhaltStored = {
    ...(body.inhalt || {}),
    ...(body.empfaenger_email ? { empfaenger_email: (body.empfaenger_email || '').trim() } : {}),
    ...(body.empfaenger_tel ? { empfaenger_tel: (body.empfaenger_tel || '').trim() } : {}),
    ...(body.projekt_name ? { projekt_name: body.projekt_name } : {}),
  };
  const base = { von_id: user.id, an_id, typ, inhalt: inhaltStored, status: 'ungelesen' };

  // (B) Vor der Validierung.
  const empfEmail = (empfEmailRaw || '').trim();
  T('vor-validierung', { typ, empfaenger_email: empfEmail });

  // Block 3: Eine Materialliste löst IMMER eine Mail aus (Hauptkanal). Fehlt/ungültig die
  // Empfängeradresse (z.B. veralteter Frontend-Cache), geht sie als Fallback ans GS-Büro,
  // damit die Liste NIE still verloren geht. Absender bleibt fix info@george-solutions.ch.
  const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim());
  const mailRequested = typ === 'materialliste';
  const recipient = isEmail(empfEmail) ? empfEmail : MATERIAL_OFFICE;
  const fallbackUsed = mailRequested && !isEmail(empfEmail);
  // (C) Nach der Validierung.
  T('nach-validierung', { mailRequested, recipient, fallbackUsed });

  let mailResult = null;
  if (mailRequested) {
    T('vor-sendMaterialEmail', { to: recipient, fallbackUsed });
    mailResult = await sendMaterialEmail(user, body, recipient, fallbackUsed, T);
    T('nach-sendMaterialEmail', mailResult);
  }

  // projekt_id FK may reference gs_anfragen (Emanuel's schema), so a gs_projekte
  // id would violate it — retry without projekt_id on FK error. (Best-effort In-App-Kopie.)
  let r = await insertNachricht({ ...base, projekt_id });
  if (r.fkError) r = await insertNachricht(base);

  // Bei der Materialliste richtet sich der Erfolg nach der E-Mail (Inbox-Kopie ist optional).
  if (mailRequested) {
    if (mailResult && mailResult.ok) {
      T('return 200 mail_sent=true', { id: mailResult.id });
      return res.status(200).json({ ok: true, mail_sent: true, resend_id: mailResult.id || null, nachricht: r.row || null, _debug: trace });
    }
    T('return 502 mail_failed', mailResult);
    return res.status(502).json({ error: 'E-Mail an Projektleiter konnte nicht gesendet werden', mail_sent: false, mail_error: (mailResult && mailResult.error) || null, _debug: trace });
  }

  if (!r.row) {
    if (r.notMigrated) { T('return 503 not-migrated'); return res.status(503).json({ error: 'gs_nachrichten nicht migriert', _debug: trace }); }
    T('return 500 insert-failed');
    return res.status(500).json({ error: 'Nachricht konnte nicht gesendet werden', _debug: trace });
  }
  T('return 200 inapp-only (kein Mailversand angefordert)');
  return res.status(200).json({ ok: true, nachricht: r.row, _debug: trace });
}

// Materialliste per Resend an den Projektleiter. Absender fix info@george-solutions.ch;
// reply_to = Techniker-Mail (Punycode-sicher via Helper; ungültig → reply_to entfällt, Mail geht trotzdem).
async function sendMaterialEmail(user, body, recipient, fallbackUsed = false, T = () => {}) {
  const inhalt = body.inhalt || {};
  const positionen = Array.isArray(inhalt.positionen) ? inhalt.positionen : [];
  const projektName = (body.projekt_name || inhalt.projekt_name || 'Projekt').toString();
  const vonName = (inhalt.von_name || user.email || 'Techniker').toString();
  const html = materialEmailHtml({
    projektName, vonName,
    positionen,
    notiz: inhalt.notiz || '',
    tel: body.empfaenger_tel || '',
    fallbackUsed,
  });

  // Optionales Foto als Anhang (data-URL → base64 ohne Prefix).
  let attachments;
  const foto = inhalt.foto;
  if (typeof foto === 'string' && foto.indexOf('base64,') > -1) {
    attachments = [{ filename: 'material-foto.jpg', content: foto.split('base64,')[1] }];
  }

  const to = recipient || MATERIAL_OFFICE;
  T('sendMaterialEmail vor resend', { to, from: MATERIAL_FROM, reply_to: user.email || null, positionen: positionen.length, foto: !!attachments, fallbackUsed });
  const result = await sendResendEmail({
    to,
    from: MATERIAL_FROM,
    subject: `📦 Materialliste – ${projektName}${fallbackUsed ? ' (ohne Empfänger)' : ''}`,
    html,
    replyTo: user.email || null,
    attachments,
  });
  T('sendMaterialEmail nach resend', result);
  return result;
}

async function insertNachricht(row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_nachrichten`, { method: 'POST', headers: { ...SB, Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (r.ok) return { row: (await sbJson(r))?.[0] };
  const t = await r.text().catch(() => '');
  if (/23503|foreign key/i.test(t)) return { fkError: true };
  if (/PGRST205|not find the table/i.test(t)) return { notMigrated: true };
  console.error('nachricht insert error', r.status, t);
  return {};
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
