// api/blockaden.js – Blockaden-Modul (First-Class-Objekt, gekoppelt ans Step-Framework).
//
// Monteur meldet eine Blockade (Sprache/Text + Foto) → KI-Auto-Zuordnung (Step/Zone/
// Urgency/Rolle) → Sofort-Benachrichtigung (E-Mail via Resend + In-App-Push) an Owner/
// Bauleiter-Büro → betroffener Step erscheint 🔴 im Status-Dashboard → Bauleiter-Büro
// gibt frei → Step entsperrt. Wochenreport „Was hat uns diese Woche verzögert?".
//
// Multi-Firma: Bauleiter-Büro/Projekt-Owner sehen ALLE Blockaden ihrer Projekte;
// beteiligte Firmen nur die von ihnen gemeldeten/ihnen zugewiesenen. Keine Preise anderer.
//
// Alle DB-Zugriffe laufen über den Service-Key (wie gs_nachrichten); die Rollen-Filterung
// erzwingt diese API in der Anwendungsschicht (RLS ist Defense-in-Depth, siehe SQL).
import { sendResendEmail, blockadeEmailHtml, blockadenReportEmailHtml, GS_OFFICE_EMAIL } from '../lib/mail.js';
import { buildBlockadePdf, buildBlockadenReportPdf } from '../lib/pdf.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const BLOCKADE_FROM = 'George Solutions <info@george-solutions.ch>';

const URGENCIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const ROLLEN = ['planung', 'material', 'extern', 'gebaeudetechnik'];
const STATUSES = ['offen', 'in_bearbeitung', 'freigegeben', 'eskaliert'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  // GET = Cron-Aufruf (Vercel) → Eskalations-Check (kein User-Token, nur Service-Key).
  if (req.method === 'GET') {
    try { const r = await runEscalationCheck(); return res.status(200).json({ ok: true, ...r }); }
    catch (err) { console.error('Blockaden escalation cron error:', err.message); return res.status(200).json({ ok: false, error: err.message }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const body = req.body || {};

  // classify braucht keinen Login (reine KI-Hilfe, keine Daten). Alles andere: Token nötig.
  if (body.action === 'classify') {
    try { return await classify(res, body); }
    catch (err) { console.error('Blockaden classify error:', err.message); return res.status(200).json({ error: err.message, suggestion: null }); }
  }

  if (!token) return res.status(401).json({ error: 'Nicht authentifiziert' });
  const user = await getUser(token);
  if (!user) return res.status(401).json({ error: 'Ungültiger Token' });
  const role = await getRole(user.id);

  try {
    switch (body.action) {
      case 'create':    return await create(res, user, role, body);
      case 'list':      return await list(res, user, role, body);
      case 'get':       return await getOne(res, user, role, body);
      case 'update':    return await update(res, user, role, body);
      case 'freigeben': return await freigeben(res, user, role, body);
      case 'delete':    return await remove(res, user, role, body);
      case 'eskalieren':return await eskalieren(res, user, role, body);
      case 'report':    return await report(res, user, role, body);
      case 'speak_text':return await speakText(res, user, role, body);
      case 'check_escalations': {
        if (role !== 'gs_admin' && role !== 'master') return res.status(403).json({ error: 'Nur Admin' });
        const r = await runEscalationCheck(); return res.status(200).json({ ok: true, ...r });
      }
      default: return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Blockaden Error:', err.message);
    if (/PGRST205|not find the table/i.test(err.message)) return res.status(503).json({ error: 'gs_blockaden nicht migriert', notMigrated: true });
    return res.status(500).json({ error: err.message });
  }
}

// ── ISO-Kalenderwoche + Jahr ──────────────────────────────────
function isoWeekYear(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((t - ys) / 86400000) + 1) / 7);
  return { woche: week, jahr: t.getUTCFullYear() };
}

// ── KI-Auto-Zuordnung (Vorschlag; Nutzer bestätigt/korrigiert) ──
async function classify(res, body) {
  const text = String(body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text erforderlich' });
  // Kontext (falls das Frontend die Projekt-Hierarchie kennt) verbessert die Zuordnung.
  const ctx = [];
  if (body.projekt_name) ctx.push(`Projekt: ${body.projekt_name}`);
  if (Array.isArray(body.steps) && body.steps.length) ctx.push(`Bekannte Steps: ${body.steps.slice(0, 40).join(', ')}`);
  if (Array.isArray(body.zonen) && body.zonen.length) ctx.push(`Bekannte Zonen: ${body.zonen.slice(0, 40).join(', ')}`);

  if (!ANTHROPIC_KEY) {
    // Ohne KI: heuristischer Fallback, damit der Flow nie blockiert.
    return res.status(200).json({ suggestion: heuristicClassify(text), fallback: true });
  }
  const system = `Du bist der HKLS-Bauassistent von George Solutions. Ein Monteur meldet eine BLOCKADE auf der Baustelle (etwas hält einen Arbeitsschritt/Step auf). Ordne die Meldung zu.
${ctx.length ? '\nKontext:\n' + ctx.join('\n') : ''}

Gib AUSSCHLIESSLICH ein JSON-Objekt zurück (keine Erklärung):
{
  "haus": "Haus/Gebäude falls genannt, sonst leer",
  "einheit": "Wohnung/Einheit falls genannt, sonst leer",
  "zone": "Zone/Bereich/Raum falls genannt (z.B. Bad OG, Steigzone), sonst leer",
  "step_ref": "Kurzbezeichnung des blockierten Arbeitsschritts (z.B. 'Steigleitung Montage', 'Verputz Bad'), immer ausfüllen",
  "urgency": "LOW | MEDIUM | HIGH | CRITICAL (CRITICAL nur bei Baustopp/Sicherheit/Wasser)",
  "blockiert_von_rolle": "planung | material | extern | gebaeudetechnik (wer muss es lösen)",
  "beschreibung": "die Blockade in 1-2 klaren Sätzen, NICHTS erfinden, nur umformulieren"
}
Regeln: fehlendes Material → "material"; fehlende Pläne/Freigaben/Masse → "planung"; Vorleistung anderer Gewerke (Elektro, Gips, Boden) → "extern"; Heizung/Lüftung/Klima/Sanitär-Technik-Konflikt → "gebaeudetechnik".`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 500, system, messages: [{ role: 'user', content: `Blockaden-Meldung des Monteurs:\n"""${text}"""` }] }),
  });
  if (!r.ok) return res.status(200).json({ suggestion: heuristicClassify(text), fallback: true, upstream_status: r.status });
  const data = await r.json();
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = safeParseJSON(raw) || {};
  const s = normalizeSuggestion(parsed, text);
  return res.status(200).json({ suggestion: s });
}

function normalizeSuggestion(p, text) {
  const urgency = URGENCIES.includes(String(p.urgency).toUpperCase()) ? String(p.urgency).toUpperCase() : 'MEDIUM';
  const rolle = ROLLEN.includes(String(p.blockiert_von_rolle)) ? String(p.blockiert_von_rolle) : 'extern';
  return {
    haus: String(p.haus || '').trim(),
    einheit: String(p.einheit || '').trim(),
    zone: String(p.zone || '').trim(),
    step_ref: String(p.step_ref || '').trim() || 'Nicht zugeordnet',
    urgency,
    blockiert_von_rolle: rolle,
    beschreibung: String(p.beschreibung || text).trim(),
  };
}

// Heuristik ohne KI (Notnagel) – erkennt Rolle/Urgency grob an Schlüsselwörtern.
function heuristicClassify(text) {
  const t = text.toLowerCase();
  let rolle = 'extern';
  if (/material|fehlt|liefer|bestell|nachschub|rohr|fitting/.test(t)) rolle = 'material';
  else if (/plan|freigabe|mass|masse|zeichnung|statik|architekt/.test(t)) rolle = 'planung';
  else if (/heizung|lüftung|luftung|klima|sanitär|sanitar|technik/.test(t)) rolle = 'gebaeudetechnik';
  let urgency = 'MEDIUM';
  if (/wasser|stopp|gefahr|sicherheit|akut|sofort|dringend|kritisch/.test(t)) urgency = 'CRITICAL';
  else if (/schnell|heute|wichtig|blockiert/.test(t)) urgency = 'HIGH';
  return { haus: '', einheit: '', zone: '', step_ref: 'Nicht zugeordnet', urgency, blockiert_von_rolle: rolle, beschreibung: text };
}

// ── Blockade anlegen (+ Sofort-Benachrichtigung) ──────────────
async function create(res, user, role, body) {
  const beschreibung = String(body.beschreibung || '').trim();
  if (!beschreibung) return res.status(400).json({ error: 'Beschreibung erforderlich' });

  const now = new Date();
  const { woche, jahr } = isoWeekYear(now);
  const urgency = URGENCIES.includes(String(body.urgency).toUpperCase()) ? String(body.urgency).toUpperCase() : 'MEDIUM';
  const rolle = ROLLEN.includes(String(body.blockiert_von_rolle)) ? String(body.blockiert_von_rolle) : 'extern';
  const fotos = Array.isArray(body.fotos) ? body.fotos.filter((x) => typeof x === 'string' && x.length).slice(0, 6) : [];
  const videos = Array.isArray(body.videos) ? body.videos.filter((x) => typeof x === 'string' && x.length).slice(0, 3) : [];

  const row = {
    projekt_id: body.projekt_id || null,
    projekt_name: body.projekt_name ? String(body.projekt_name).slice(0, 200) : null,
    haus: body.haus ? String(body.haus).slice(0, 120) : null,
    einheit: body.einheit ? String(body.einheit).slice(0, 120) : null,
    zone: body.zone ? String(body.zone).slice(0, 120) : null,
    step_ref: body.step_ref ? String(body.step_ref).slice(0, 200) : null,
    beschreibung,
    fotos, videos,
    reporter_id: user.id,
    reporter_name: body.reporter_name ? String(body.reporter_name).slice(0, 120) : (user.email || null),
    reporter_firma: body.reporter_firma ? String(body.reporter_firma).slice(0, 160) : null,
    blockiert_von_rolle: rolle,
    urgency,
    status: 'offen',
    owner_email: isEmail(body.owner_email) ? body.owner_email.trim() : null,
    owner_firma: body.owner_firma ? String(body.owner_firma).slice(0, 160) : null,
    eskalation_stunden: Number.isFinite(+body.eskalation_stunden) ? Math.max(0, Math.min(240, +body.eskalation_stunden)) : 24,
    woche, jahr,
  };

  // FK-Eigenheit (wie gs_nachrichten): projekt_id kann fremdes Schema referenzieren → bei
  // FK-Fehler ohne projekt_id erneut versuchen, damit die Meldung NIE verloren geht.
  let inserted = await insert(row);
  if (inserted.fkError) inserted = await insert({ ...row, projekt_id: null });
  if (inserted.notMigrated) return res.status(503).json({ error: 'gs_blockaden nicht migriert', notMigrated: true });
  if (!inserted.row) return res.status(500).json({ error: 'Blockade konnte nicht gespeichert werden' });

  const blockade = inserted.row;

  // Sofort-Benachrichtigung: E-Mail an Owner/Bauleiter-Büro (+ PDF) & In-App-Push.
  const recipient = row.owner_email || await resolvePartnerEmail(row.projekt_id) || GS_OFFICE_EMAIL;
  const mail = await notifyBlockade(blockade, recipient, false);
  await inAppNotify(blockade, 'neu');

  return res.status(200).json({ ok: true, blockade, mail_sent: !!(mail && mail.ok), mail_to: recipient, notified: true });
}

async function insert(row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_blockaden`, { method: 'POST', headers: { ...SB, Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (r.ok) return { row: (await sbJson(r))?.[0] };
  const t = await r.text().catch(() => '');
  if (/23503|foreign key/i.test(t)) return { fkError: true };
  if (/PGRST205|not find the table/i.test(t)) return { notMigrated: true };
  console.error('blockade insert error', r.status, t);
  return {};
}

// E-Mail-Benachrichtigung (Resend) + Blockade-PDF. Best-effort (wirft nicht).
async function notifyBlockade(blockade, recipient, statusChange) {
  try {
    const html = blockadeEmailHtml({ blockade, statusChange });
    const attachments = [];
    try {
      const pdf = buildBlockadePdf(blockade);
      attachments.push({ filename: `Blockade-${(blockade.step_ref || 'meldung')}.pdf`.replace(/[^\w.\-]+/g, '_'), content: Buffer.from(pdf).toString('base64') });
    } catch (e) { /* Mail geht trotzdem ohne PDF */ }
    // Erstes Foto als Anhang (Data-URL → base64), falls vorhanden.
    const foto = (blockade.fotos || [])[0];
    if (typeof foto === 'string' && foto.indexOf('base64,') > -1) {
      attachments.push({ filename: 'blockade-foto.jpg', content: foto.split('base64,')[1] });
    }
    const u = blockade.urgency || 'MEDIUM';
    return await sendResendEmail({
      to: recipient,
      from: BLOCKADE_FROM,
      subject: `🚧 ${u === 'CRITICAL' ? '[KRITISCH] ' : ''}Blockade${statusChange ? ' aktualisiert' : ''} – ${blockade.projekt_name || 'Projekt'} / ${blockade.step_ref || 'Step'}`,
      html,
      attachments,
    });
  } catch (e) { console.error('notifyBlockade error', e.message); return { ok: false, error: e.message }; }
}

// In-App-Push-Surrogat: Eintrag in gs_nachrichten → lässt die Inbox-Badge des Owners aufleuchten.
async function inAppNotify(blockade, kind) {
  try {
    const an_id = blockade.owner_id || await resolvePartnerUserId(blockade.projekt_id);
    if (!an_id) return; // kein interner Empfänger → nur E-Mail
    const inhalt = {
      blockade_id: blockade.id, urgency: blockade.urgency, step_ref: blockade.step_ref,
      projekt_name: blockade.projekt_name, beschreibung: (blockade.beschreibung || '').slice(0, 300),
      kind, kategorie: 'blockade',
    };
    await fetch(`${SUPABASE_URL}/rest/v1/gs_nachrichten`, {
      method: 'POST', headers: SB,
      body: JSON.stringify({ von_id: blockade.reporter_id || null, an_id, typ: 'nachricht', inhalt, status: 'ungelesen' }),
    });
  } catch (e) { /* best-effort */ }
}

// ── Liste (rollen-/firmen-gefiltert) ──────────────────────────
async function list(res, user, role, body) {
  const isAdmin = role === 'gs_admin' || role === 'master';
  const filterQ = [];
  if (body.status && STATUSES.includes(body.status)) filterQ.push(`status=eq.${body.status}`);
  if (body.urgency && URGENCIES.includes(String(body.urgency).toUpperCase())) filterQ.push(`urgency=eq.${String(body.urgency).toUpperCase()}`);
  if (body.projekt_id) filterQ.push(`projekt_id=eq.${body.projekt_id}`);
  if (body.offen_only) filterQ.push(`status=neq.freigegeben`);
  if (body.kw && body.jahr) { filterQ.push(`woche=eq.${+body.kw}`); filterQ.push(`jahr=eq.${+body.jahr}`); }

  let rows = [];
  if (isAdmin) {
    rows = await sbSelect(`${filterQ.join('&')}${filterQ.length ? '&' : ''}order=created_at.desc&limit=500`);
  } else {
    // Projekte mit Vollzugriff (Owner/Partner oder Bauleiter-Büro) → alle Blockaden dort.
    const fullIds = await fullAccessProjectIds(user.id);
    const merged = new Map();
    // (a) eigene: gemeldet ODER zugewiesen.
    const ownQ = `or=(reporter_id.eq.${user.id},owner_id.eq.${user.id})`;
    (await sbSelect(`${ownQ}&order=created_at.desc&limit=500`)).forEach((r) => merged.set(r.id, r));
    // (b) Projekte mit Vollzugriff.
    if (fullIds.length) {
      const inList = fullIds.map((id) => `"${id}"`).join(',');
      (await sbSelect(`projekt_id=in.(${inList})&order=created_at.desc&limit=500`)).forEach((r) => merged.set(r.id, r));
    }
    rows = Array.from(merged.values());
    // Client-seitige Filter anwenden (weil (a)+(b) getrennt geladen wurden).
    if (body.status && STATUSES.includes(body.status)) rows = rows.filter((r) => r.status === body.status);
    if (body.urgency) rows = rows.filter((r) => r.urgency === String(body.urgency).toUpperCase());
    if (body.projekt_id) rows = rows.filter((r) => r.projekt_id === body.projekt_id);
    if (body.offen_only) rows = rows.filter((r) => r.status !== 'freigegeben');
    if (body.kw && body.jahr) rows = rows.filter((r) => r.woche === +body.kw && r.jahr === +body.jahr);
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  const masked = body.demo ? rows.map(maskDemo) : rows;
  // Nach Dringlichkeit sortiert (CRITICAL zuerst), created_at als Tiebreaker. Medien-Daten
  // (Foto/Video-Base64) NICHT in der Liste mitschicken (schwer) → nur Zähler; Details via get.
  const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const out = masked.slice()
    .sort((a, b) => (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9) || String(b.created_at).localeCompare(String(a.created_at)))
    .map(lite);
  return res.status(200).json({ blockaden: out, count: out.length, can_freigeben: isAdmin || role === 'gs_partner' });
}

async function getOne(res, user, role, body) {
  if (!body.id) return res.status(400).json({ error: 'id erforderlich' });
  const rows = await sbSelect(`id=eq.${body.id}&limit=1`);
  const b = rows[0];
  if (!b) return res.status(404).json({ error: 'Blockade nicht gefunden' });
  if (!(await canView(user, role, b))) return res.status(403).json({ error: 'Kein Zugriff' });
  return res.status(200).json({ blockade: body.demo ? maskDemo(b) : b });
}

// ── Update (Status/Bearbeitung/Notiz) ─────────────────────────
async function update(res, user, role, body) {
  if (!body.id) return res.status(400).json({ error: 'id erforderlich' });
  const rows = await sbSelect(`id=eq.${body.id}&limit=1`);
  const b = rows[0];
  if (!b) return res.status(404).json({ error: 'Blockade nicht gefunden' });
  if (!(await canEdit(user, role, b))) return res.status(403).json({ error: 'Keine Berechtigung' });

  const patch = {};
  if (body.status && STATUSES.includes(body.status)) patch.status = body.status;
  if (typeof body.resolution === 'string') patch.resolution = body.resolution.slice(0, 2000);
  if (body.urgency && URGENCIES.includes(String(body.urgency).toUpperCase())) patch.urgency = String(body.urgency).toUpperCase();
  if (body.blockiert_von_rolle && ROLLEN.includes(body.blockiert_von_rolle)) patch.blockiert_von_rolle = body.blockiert_von_rolle;
  if (typeof body.owner_email === 'string' && isEmail(body.owner_email)) patch.owner_email = body.owner_email.trim();
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Keine Änderung' });

  const updated = await patchRow(body.id, patch);
  if (!updated) return res.status(500).json({ error: 'Update fehlgeschlagen' });
  // Bei Statuswechsel den Owner/Empfänger informieren (best-effort).
  if (patch.status && patch.status !== b.status) {
    const recipient = updated.owner_email || await resolvePartnerEmail(updated.projekt_id) || GS_OFFICE_EMAIL;
    await notifyBlockade(updated, recipient, true);
  }
  return res.status(200).json({ ok: true, blockade: updated });
}

// ── Freigeben (Bauleiter-Büro / Owner / Admin) → Step entsperrt ──
async function freigeben(res, user, role, body) {
  if (!body.id) return res.status(400).json({ error: 'id erforderlich' });
  const rows = await sbSelect(`id=eq.${body.id}&limit=1`);
  const b = rows[0];
  if (!b) return res.status(404).json({ error: 'Blockade nicht gefunden' });
  if (!(await canFreigeben(user, role, b))) return res.status(403).json({ error: 'Nur Bauleiter-Büro / Owner / Admin dürfen freigeben' });

  const patch = {
    status: 'freigegeben',
    freigegeben_am: new Date().toISOString(),
    resolution: typeof body.resolution === 'string' && body.resolution.trim() ? body.resolution.slice(0, 2000) : (b.resolution || 'Freigegeben'),
    eskaliert: false,
  };
  const updated = await patchRow(body.id, patch);
  if (!updated) return res.status(500).json({ error: 'Freigabe fehlgeschlagen' });
  // Melder informieren, dass sein Step wieder starten kann.
  const recipient = b.owner_email || await resolveReporterEmail(b.reporter_id) || GS_OFFICE_EMAIL;
  await notifyBlockade(updated, recipient, true);
  return res.status(200).json({ ok: true, blockade: updated, step_entsperrt: true });
}

// Löschen (Melder/Owner/Admin) – u.a. für self-cleaning E2E-Tests.
async function remove(res, user, role, body) {
  if (!body.id) return res.status(400).json({ error: 'id erforderlich' });
  const rows = await sbSelect(`id=eq.${body.id}&limit=1`);
  const b = rows[0];
  if (!b) return res.status(200).json({ ok: true, deleted: 0 });
  const isAdmin = role === 'gs_admin' || role === 'master';
  if (!isAdmin && b.reporter_id !== user.id && b.owner_id !== user.id) return res.status(403).json({ error: 'Keine Berechtigung' });
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_blockaden?id=eq.${body.id}`, { method: 'DELETE', headers: SB });
  if (!r.ok) return res.status(500).json({ error: 'Löschen fehlgeschlagen' });
  return res.status(200).json({ ok: true, deleted: 1 });
}

async function eskalieren(res, user, role, body) {
  if (!body.id) return res.status(400).json({ error: 'id erforderlich' });
  const rows = await sbSelect(`id=eq.${body.id}&limit=1`);
  const b = rows[0];
  if (!b) return res.status(404).json({ error: 'Blockade nicht gefunden' });
  if (!(await canFreigeben(user, role, b))) return res.status(403).json({ error: 'Keine Berechtigung' });
  const updated = await patchRow(body.id, { status: 'eskaliert', eskaliert: true, eskaliert_am: new Date().toISOString() });
  if (!updated) return res.status(500).json({ error: 'Eskalation fehlgeschlagen' });
  const recipient = updated.owner_email || await resolvePartnerEmail(updated.projekt_id) || GS_OFFICE_EMAIL;
  await notifyBlockade(updated, recipient, true);
  return res.status(200).json({ ok: true, blockade: updated });
}

// ── Eskalations-Timer: offene Blockaden ohne Aktion > X Std → eskaliert + Mail ──
async function runEscalationCheck() {
  const rows = await sbSelect(`status=in.(offen,in_bearbeitung)&eskaliert=is.false&order=created_at.asc&limit=500`).catch(() => []);
  const now = Date.now();
  let escalated = 0;
  for (const b of rows) {
    const hrs = Number.isFinite(+b.eskalation_stunden) ? +b.eskalation_stunden : 24;
    if (hrs <= 0) continue;
    const age = (now - new Date(b.created_at).getTime()) / 3600000;
    if (age < hrs) continue;
    const updated = await patchRow(b.id, { status: 'eskaliert', eskaliert: true, eskaliert_am: new Date().toISOString() });
    if (updated) {
      escalated++;
      const recipient = updated.owner_email || await resolvePartnerEmail(updated.projekt_id) || GS_OFFICE_EMAIL;
      await notifyBlockade(updated, recipient, true);
    }
  }
  return { escalated, checked: rows.length };
}

// ── Wochenreport „Was hat uns diese Woche verzögert?" ─────────
async function report(res, user, role, body) {
  const now = new Date();
  const cur = isoWeekYear(now);
  const kw = Number.isFinite(+body.kw) ? +body.kw : cur.woche;
  const jahr = Number.isFinite(+body.jahr) ? +body.jahr : cur.jahr;

  // Sichtbarkeitsregeln wie list: Admin=alle, sonst eigene + Vollzugriffs-Projekte.
  const collected = await collectForUser(user, role, { kw, jahr, projekt_id: body.projekt_id });
  const blockaden = body.demo ? collected.map(maskDemo) : collected;
  const projektName = body.projekt_id ? (blockaden[0]?.projekt_name || null) : null;

  const wantPdf = body.pdf !== false;
  let pdf_base64 = null;
  if (wantPdf) {
    try { pdf_base64 = Buffer.from(buildBlockadenReportPdf({ kw, jahr, blockaden, projektName })).toString('base64'); }
    catch (e) { /* Report ohne PDF trotzdem liefern */ }
  }

  // Optional per E-Mail versenden (an angegebene Adresse oder GS-Büro).
  let mail_sent = false, mail_to = null;
  if (body.email) {
    const to = isEmail(body.email_to) ? body.email_to.trim() : (isEmail(user.email) ? user.email : GS_OFFICE_EMAIL);
    mail_to = to;
    const attachments = pdf_base64 ? [{ filename: `Blockaden-Report-KW${kw}-${jahr}.pdf`, content: pdf_base64 }] : [];
    const m = await sendResendEmail({
      to, from: BLOCKADE_FROM,
      subject: `🚧 Blockaden-Wochenreport KW ${kw}/${jahr}`,
      html: blockadenReportEmailHtml({ kw, jahr, blockaden, projektName }),
      attachments,
    });
    mail_sent = !!(m && m.ok);
  }

  const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sorted = blockaden.slice().sort((a, b) => (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9));
  return res.status(200).json({
    ok: true, kw, jahr, count: blockaden.length,
    offen: blockaden.filter((b) => b.status !== 'freigegeben').length,
    eskaliert: blockaden.filter((b) => b.eskaliert || b.status === 'eskaliert').length,
    blockaden: sorted.map(lite), pdf_base64, mail_sent, mail_to,
    speak_text: buildReportSpeakText(kw, jahr, sorted),
  });
}

// ── Vorlese-Text (fertiger Text → Frontend schickt ihn an /api/voice) ──
async function speakText(res, user, role, body) {
  if (body.kind === 'report') {
    const now = new Date();
    const cur = isoWeekYear(now);
    const kw = Number.isFinite(+body.kw) ? +body.kw : cur.woche;
    const jahr = Number.isFinite(+body.jahr) ? +body.jahr : cur.jahr;
    const collected = await collectForUser(user, role, { kw, jahr, projekt_id: body.projekt_id });
    const rows = body.demo ? collected.map(maskDemo) : collected;
    const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    rows.sort((a, b) => (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9));
    return res.status(200).json({ text: buildReportSpeakText(kw, jahr, rows) });
  }
  // Standard: aktueller Blockaden-Status (offene, nach Dringlichkeit).
  const collected = await collectForUser(user, role, { offen_only: true });
  const rows0 = body.demo ? collected.map(maskDemo) : collected;
  const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const rows = rows0.filter((b) => b.status !== 'freigegeben').sort((a, b) => (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9));
  return res.status(200).json({ text: buildStatusSpeakText(rows) });
}

const URG_DE = { CRITICAL: 'kritisch', HIGH: 'hoch', MEDIUM: 'mittel', LOW: 'niedrig' };
function buildStatusSpeakText(rows) {
  if (!rows.length) return 'Aktuell gibt es keine offenen Blockaden. Alle Steps können laufen.';
  const crit = rows.filter((b) => b.urgency === 'CRITICAL').length;
  let t = `Es gibt ${sprichZahl(rows.length)} offene ${rows.length === 1 ? 'Blockade' : 'Blockaden'}`;
  t += crit ? `, davon ${sprichZahl(crit)} kritisch. ` : '. ';
  rows.slice(0, 6).forEach((b, i) => {
    const ort = [b.projekt_name, b.zone].filter(Boolean).join(', ');
    t += `${i + 1}. ${URG_DE[b.urgency] || 'mittel'}: ${b.step_ref || 'Ein Step'}${ort ? ' bei ' + ort : ''}. `;
  });
  if (rows.length > 6) t += `Und ${sprichZahl(rows.length - 6)} weitere.`;
  return t;
}
function buildReportSpeakText(kw, jahr, rows) {
  const offen = rows.filter((b) => b.status !== 'freigegeben').length;
  const esk = rows.filter((b) => b.eskaliert || b.status === 'eskaliert').length;
  if (!rows.length) return `Blockaden-Wochenreport, Kalenderwoche ${sprichZahl(kw)}. Keine Blockaden in dieser Woche. Reibungsloser Ablauf.`;
  let t = `Blockaden-Wochenreport, Kalenderwoche ${sprichZahl(kw)}. Insgesamt ${sprichZahl(rows.length)} ${rows.length === 1 ? 'Blockade' : 'Blockaden'}, davon ${sprichZahl(offen)} noch offen${esk ? ` und ${sprichZahl(esk)} eskaliert` : ''}. `;
  rows.slice(0, 6).forEach((b, i) => {
    t += `${i + 1}. ${URG_DE[b.urgency] || 'mittel'}: ${b.step_ref || 'Ein Step'}${b.projekt_name ? ' im Projekt ' + b.projekt_name : ''}, Status ${statusDe(b.status)}. `;
  });
  return t;
}
function statusDe(s) { return ({ offen: 'offen', in_bearbeitung: 'in Bearbeitung', freigegeben: 'freigegeben', eskaliert: 'eskaliert' })[s] || s; }
// Kleine Zahlen ausgeschrieben (bessere TTS-Aussprache), grosse als Ziffern.
function sprichZahl(n) {
  const w = ['null', 'eine', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'];
  return (n >= 0 && n <= 12) ? w[n] : String(n);
}

// ── Sichtbarkeit / Berechtigungen ─────────────────────────────
async function collectForUser(user, role, opts = {}) {
  const isAdmin = role === 'gs_admin' || role === 'master';
  let rows;
  if (isAdmin) {
    rows = await sbSelect(`order=created_at.desc&limit=1000`);
  } else {
    const fullIds = await fullAccessProjectIds(user.id);
    const merged = new Map();
    (await sbSelect(`or=(reporter_id.eq.${user.id},owner_id.eq.${user.id})&limit=1000`)).forEach((r) => merged.set(r.id, r));
    if (fullIds.length) {
      const inList = fullIds.map((id) => `"${id}"`).join(',');
      (await sbSelect(`projekt_id=in.(${inList})&limit=1000`)).forEach((r) => merged.set(r.id, r));
    }
    rows = Array.from(merged.values());
  }
  if (opts.projekt_id) rows = rows.filter((r) => r.projekt_id === opts.projekt_id);
  if (opts.offen_only) rows = rows.filter((r) => r.status !== 'freigegeben');
  if (opts.kw && opts.jahr) rows = rows.filter((r) => r.woche === +opts.kw && r.jahr === +opts.jahr);
  return rows;
}

// Projekte, in denen der User ALLE Blockaden sehen darf (Projekt-Owner/Partner ODER Bauleiter-Büro).
async function fullAccessProjectIds(userId) {
  const ids = new Set();
  try {
    const owned = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?partner_user_id=eq.${userId}&select=id`, { headers: SB }));
    (Array.isArray(owned) ? owned : []).forEach((p) => p.id && ids.add(p.id));
  } catch (e) {}
  try {
    const bl = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekt_beteiligte?user_id=eq.${userId}&rolle=eq.bauleiter_buero&select=projekt_id`, { headers: SB }));
    (Array.isArray(bl) ? bl : []).forEach((p) => p.projekt_id && ids.add(p.projekt_id));
  } catch (e) { /* Tabelle evtl. noch nicht migriert → ignorieren */ }
  return Array.from(ids);
}

async function canView(user, role, b) {
  if (role === 'gs_admin' || role === 'master') return true;
  if (b.reporter_id === user.id || b.owner_id === user.id) return true;
  const full = await fullAccessProjectIds(user.id);
  return b.projekt_id && full.includes(b.projekt_id);
}
async function canEdit(user, role, b) {
  if (role === 'gs_admin' || role === 'master') return true;
  if (b.reporter_id === user.id || b.owner_id === user.id) return true;
  const full = await fullAccessProjectIds(user.id);
  return b.projekt_id && full.includes(b.projekt_id);
}
// Freigeben darf: Admin, Owner, oder Projekt-Owner/Bauleiter-Büro (Vollzugriff). NICHT der reine Melder.
async function canFreigeben(user, role, b) {
  if (role === 'gs_admin' || role === 'master') return true;
  if (b.owner_id === user.id) return true;
  const full = await fullAccessProjectIds(user.id);
  return b.projekt_id && full.includes(b.projekt_id);
}

// Liste/Report: schwere Medien-Base64 entfernen, nur Zähler behalten (Details via get).
function lite(b) {
  const { fotos, videos, ...rest } = b;
  return { ...rest, foto_count: Array.isArray(fotos) ? fotos.length : 0, video_count: Array.isArray(videos) ? videos.length : 0 };
}

// ── Demo-Maskierung: echte Kundendaten nie ungeschützt zeigen ──
function maskDemo(b) {
  const c = { ...b };
  c.reporter_name = maskName(b.reporter_name);
  c.owner_firma = b.owner_firma ? 'Firma ***' : b.owner_firma;
  c.reporter_firma = b.reporter_firma ? 'Firma ***' : b.reporter_firma;
  c.owner_email = b.owner_email ? maskEmail(b.owner_email) : b.owner_email;
  c.projekt_name = scrubKunden(b.projekt_name);
  c.beschreibung = scrubKunden(b.beschreibung);
  c.resolution = scrubKunden(b.resolution);
  return c;
}
function maskName(n) {
  if (!n) return n;
  const parts = String(n).trim().split(/\s+/);
  return parts.map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + '.' : p.charAt(0).toUpperCase() + '.')).join(' ');
}
function maskEmail(e) { const [l, d] = String(e).split('@'); return (l ? l.charAt(0) + '***' : '***') + '@' + (d || 'firma.ch'); }
// Bekannte echte Kundennamen in Freitext neutralisieren (Demo).
function scrubKunden(s) {
  if (!s) return s;
  return String(s)
    .replace(/geiger\s*ag/gi, 'Kunde A AG')
    .replace(/\bfierz\b/gi, 'F.')
    .replace(/\bgeiger\b/gi, 'Kunde A');
}

// ── DB / Auth Helpers ─────────────────────────────────────────
async function sbSelect(query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_blockaden?${query.includes('select=') ? '' : 'select=*&'}${query}`, { headers: SB });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    if (/PGRST205|not find the table/i.test(t)) throw new Error('PGRST205 gs_blockaden not migrated');
    console.error('sbSelect error', r.status, t.slice(0, 200));
    return [];
  }
  const j = await sbJson(r);
  return Array.isArray(j) ? j : [];
}
async function patchRow(id, patch) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_blockaden?id=eq.${id}`, { method: 'PATCH', headers: { ...SB, Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!r.ok) { console.error('patchRow error', r.status, await r.text().catch(() => '')); return null; }
  return (await sbJson(r))?.[0] || null;
}
async function resolvePartnerEmail(projektId) {
  if (!projektId) return null;
  try {
    const p = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?id=eq.${projektId}&select=partner_user_id&limit=1`, { headers: SB }));
    const uid = (Array.isArray(p) ? p : [])[0]?.partner_user_id;
    return uid ? await resolveUserEmail(uid) : null;
  } catch (e) { return null; }
}
async function resolvePartnerUserId(projektId) {
  if (!projektId) return null;
  try {
    const p = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?id=eq.${projektId}&select=partner_user_id&limit=1`, { headers: SB }));
    return (Array.isArray(p) ? p : [])[0]?.partner_user_id || null;
  } catch (e) { return null; }
}
async function resolveReporterEmail(reporterId) { return reporterId ? resolveUserEmail(reporterId) : null; }
async function resolveUserEmail(userId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return isEmail(u.email) ? u.email : null;
  } catch (e) { return null; }
}
async function getUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}
async function getRole(userId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&select=role&limit=1`, { headers: SB });
  if (!r.ok) return 'bob_user';
  return (await r.json())[0]?.role || 'bob_user';
}
async function sbJson(r) { try { return await r.json(); } catch { return null; } }
function isEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()); }
function safeParseJSON(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) {}
  try { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch (e) {}
  try {
    const clean = raw.replace(/```json/gi, '').replace(/```/g, '').replace(/[""]/g, '"').trim();
    const m2 = clean.match(/\{[\s\S]*\}/); if (m2) return JSON.parse(m2[0]);
  } catch (e) {}
  return null;
}
