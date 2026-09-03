// api/cockpit.js — Master-Cockpit Daten-API (server-side, service_role)
// ─────────────────────────────────────────────────────────────────────────
// SICHERHEIT (Kern):
//   Der Server nutzt den service_role-Key (umgeht RLS). Deshalb wird JEDE
//   Anfrage HART gegated: Token → /auth/v1/user → user.id MUSS exakt die
//   Master/Admin-UUID sein, sonst 403. Es gibt keinen anderen Zugang.
//   Zusätzlich verlangt RLS in der DB auth.uid()=Master (Schutz des anon-Keys
//   im Browser/DevTools). Doppelte Absicherung.
// ─────────────────────────────────────────────────────────────────────────

import { getWeather } from './weather.js';
import { buildPdf } from '../lib/pdf.js';
import { isEntitled } from '../lib/entitlements.js';
import { escrowHinterlegen, escrowFreigeben } from './escrow_stripe.js';
import { sendResendEmail, exportEmailHtml } from '../lib/mail.js';
// Die Empfaenger-Kette wird NICHT nachgebaut, sondern geteilt: derselbe
// empfaengerFuer, den der Wochenbericht benutzt. Zwei Ketten waeren zwei
// Wahrheiten. lib/wochenbericht.js haengt nicht von api/ ab (der Mailversand
// kommt dort per Dependency Injection rein), der Import ist also zyklenfrei.
import { empfaengerFuer, EMPFAENGER_HERKUNFT_TEXT } from '../lib/wochenbericht.js';
import { ABWESENHEIT_CODES, ABWESENHEIT_KATALOG, trenneStunden, abwesenheitBloecke } from '../lib/abwesenheit.js';
import { pruefeTagesdatum } from '../lib/datum.js';
import { erinnerungTextPruefen, STANDARD_ERINNERUNG_TEXT } from '../lib/erinnerung.js';
import { sammleUnvollstaendige, ladeErinnerungVorlage } from './rapport_erinnerung.js';

// Signalisiert „darf der Aufrufer nicht" → Handler übersetzt zu HTTP 403.
class Forbidden extends Error {}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MASTER_UID = 'ee46a716-7017-4045-9f67-fe06d05171e7';

const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

// PostgREST-Helfer (service_role). Liefert geparsten JSON-Body.
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SB });
  if (!r.ok) throw new Error(`sbGet ${path} → ${r.status}: ${await r.text().catch(() => '')}`);
  return r.json();
}
async function sbWrite(method, path, body, prefer = 'return=representation') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { ...SB, Prefer: prefer }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${await r.text().catch(() => '')}`);
  return prefer.includes('minimal') ? null : r.json().catch(() => null);
}

// Token → Master-Identität bestätigen (sonst null).
async function verifyMaster(token) {
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const user = await r.json().catch(() => null);
  if (!user || user.id !== MASTER_UID) return null;
  // Rolle gegenprüfen (Defense-in-Depth).
  try {
    const rows = await sbGet(`user_roles?user_id=eq.${user.id}&select=role&limit=1`);
    const role = rows?.[0]?.role;
    if (role !== 'master' && role !== 'gs_admin') return null;
  } catch (_) { return null; }
  return user;
}

const STUFEN = ['neu', 'kontaktiert', 'angebot', 'gewonnen', 'verloren'];

// ── Projektmanagement-Actions, die AUCH freigeschaltete Partner nutzen dürfen ──
// Alle übrigen Cockpit-Actions (Leads, Umsatz, CRM, Margen …) bleiben Master-only.
const PM_ACTIONS = new Set([
  'pm_projekte', 'pm_projekt', 'pm_projekt_save', 'pm_kunden', 'pm_kunde_save',
  'pm_techniker', 'pm_tech_assign', 'pm_tech_unassign', 'pm_taetigkeit_add', 'pm_taetigkeit_del',
  'pm_material_add', 'pm_material_upd', 'pm_material_del', 'pm_rapport_verrechnet',
  'pm_datei_upload', 'pm_datei_list', 'pm_datei_del', 'pm_datei_rename',
  // Direktupload fuer Projektdateien — das Original geht unveraendert in den
  // Bucket, statt vorher im Browser verkleinert zu werden.
  'pm_datei_sign_upload', 'pm_datei_register',
  'pm_tag_projektwahl',
  'pm_tage_liste', 'pm_medien_tag', 'pm_medien_kategorie', 'pm_medien_projekt',
  'pm_export_material', 'pm_export_rapporte', 'pm_export_rechnungen',
  'pm_datenblatt_save',
  // Feature B (Medien/Stockwerk) + C (Service) — Multi-Rollen (Master + Partner);
  // Partner-Schreibrechte werden IN den Handlern per scope.role verweigert (read-only).
  'medien_list', 'medien_upload', 'medien_del', 'stockwerk_list', 'stockwerk_add',
  'medien_sign_upload', 'medien_register',   // Video-Direktupload (umgeht Body-Limit)
  'svc_liste', 'svc_detail', 'svc_status', 'svc_bericht',
  // PM-only (Master + Partner-Ersteller / Master-only intern):
  'svc_create', 'svc_update', 'stockwerk_del', 'svc_assign', 'svc_unassign',
]);

// ── Weitere Partner-Actions, je eigenem Entitlement (nicht 'projektmanagement') ──
// Sub-/Akkordmodus (sub_akkord) und Firmenlogo/Branding (partner_branding) sind
// eigenständige Freischaltungen. Master (isMaster-Zweig) kommt hier nie vorbei.
const PARTNER_FEATURE_ACTIONS = {
  pm_profil_get: 'partner_branding', pm_profil_save: 'partner_branding', pm_logo_upload: 'partner_branding',
  sub_projekte: 'sub_akkord', sub_projekt: 'sub_akkord', sub_projekt_save: 'sub_akkord', sub_anfrage: 'sub_akkord',
  sub_datei_upload: 'sub_akkord', sub_datei_list: 'sub_akkord', sub_datei_del: 'sub_akkord',
  sub_datei_sign_upload: 'sub_akkord', sub_datei_register: 'sub_akkord',
  sub_entscheiden: 'sub_akkord', sub_zahlungsplan_annehmen: 'sub_akkord', sub_step_hinterlegen: 'sub_akkord',
  sub_projekt_del: 'sub_akkord',
};

// ── Feature A: Actions, die ein eingeloggter TECHNIKER nutzen darf ──
// Techniker sehen NUR zugewiesene Projekte und buchen Rapporte NUR darauf.
// Enforcement-Kette (in Live-DB verifiziert):
//   auth.uid() → gs_techniker.user_id → gs_techniker.id → gs_projekt_techniker.techniker_id → projekt_id
const TECHNIKER_ACTIONS = new Set([
  'tech_projekte', 'tech_projekt', 'tech_rapporte', 'tech_rapport_add',
  // Wochenrapport (Kopf + strukturierte Tageszeilen, siehe unten).
  'tech_tag_save', 'tech_tag_del', 'tech_wochen_rapport', 'tech_wochen_liste',
  // Phase 3: Projekt direkt aus dem Rapport anlegen (Vollstaendig oder Schnell).
  'tech_projekt_neu',
  'tech_wochen_einreichen', 'tech_wochen_sign', 'tech_taetigkeitenkatalog',
  // Feature B/C: Techniker lädt getaggte Medien hoch, sieht Galerie, bucht auf
  // zugewiesene Service-Aufträge, markiert erledigt. Zugriff über die verifizierte Kette.
  'medien_list', 'medien_upload', 'medien_del', 'stockwerk_list', 'stockwerk_add',
  'medien_sign_upload', 'medien_register',
  'svc_liste', 'svc_detail', 'svc_status', 'svc_bericht',
]);

// Zugriffskontext bestimmen (MEHRFACHROLLEN-fähig):
//   • Effektive Rollen = user_roles (Primär) ∪ user_extra_roles (Extra).
//   • 'mode' (aktive Sicht aus dem Client) wird NUR honoriert, wenn der User die
//     Rolle wirklich hält; Master-Modus nur für die echte MASTER_UID.
//   • Jede Action wird gegen die AKTIVE Rolle geprüft — Umschalten ändert die
//     Sicht, NIE die Rechte. Master-Lock + Techniker-Kette unverändert.
//   • Rückgabe: { isMaster, partnerId, role, technikerId?, technikerUserId?, userId } | null(→403)
async function resolveAccess(token, action, mode) {
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const user = await r.json().catch(() => null);
  if (!user || !user.id) return null;

  // Primärrolle (Pflicht) + Extra-Rollen (optional, tolerant falls Tabelle fehlt).
  let primary = null;
  try {
    const rows = await sbGet(`user_roles?user_id=eq.${user.id}&select=role&limit=1`);
    primary = rows?.[0]?.role || null;
  } catch (_) { return null; }
  const roles = new Set(); if (primary) roles.add(primary);
  try {
    const ex = await sbGet(`user_extra_roles?user_id=eq.${user.id}&select=role`);
    for (const x of Array.isArray(ex) ? ex : []) if (x.role) roles.add(x.role);
  } catch (_) { /* Tabelle noch nicht migriert → nur Primärrolle */ }

  const canMaster  = user.id === MASTER_UID && (roles.has('master') || roles.has('gs_admin'));
  const hasTech    = roles.has('techniker');
  const hasPartner = roles.has('gs_partner');

  // Aktive Rolle wählen: expliziter mode (nur wenn gehalten), sonst sinnvoller Default.
  let acting;
  if (mode === 'master' && canMaster) acting = 'master';
  else if (mode === 'techniker' && hasTech) acting = 'techniker';
  else if (mode === 'partner' && hasPartner) acting = 'gs_partner';
  else acting = canMaster ? 'master' : (hasPartner ? 'gs_partner' : (hasTech ? 'techniker' : null));

  // Master: Vollzugriff (jede Action). MASTER_UID-Lock unverändert.
  if (acting === 'master') {
    return { isMaster: true, partnerId: null, role: 'master', userId: user.id };
  }
  // Techniker: NUR Techniker-Actions. Kette: auth.uid → gs_techniker.user_id → id.
  if (acting === 'techniker') {
    if (!TECHNIKER_ACTIONS.has(action)) return null;
    let technikerId = null;
    try {
      const rows = await sbGet(`gs_techniker?user_id=eq.${user.id}&select=id&limit=1`);
      technikerId = rows?.[0]?.id || null;
    } catch (_) { technikerId = null; }
    return { isMaster: false, partnerId: null, role: 'techniker', technikerId, technikerUserId: user.id, userId: user.id };
  }
  // Partner: PM-Actions (Entitlement 'projektmanagement') ODER Feature-Actions (eigenes Entitlement).
  if (acting === 'gs_partner') {
    if (PM_ACTIONS.has(action) && await isEntitled(user.id, 'projektmanagement')) {
      return { isMaster: false, partnerId: user.id, role: 'partner', userId: user.id };
    }
    const feat = PARTNER_FEATURE_ACTIONS[action];
    if (feat && await isEntitled(user.id, feat)) {
      return { isMaster: false, partnerId: user.id, role: 'partner', userId: user.id };
    }
  }
  return null;
}

// Server-seitige Datentrennung: Partner darf nur auf EIGENE Projekte zugreifen.
// Master (scope.partnerId == null) → keine Prüfung. Sonst muss der Besitzer exakt
// der Partner sein; jeder Fremd-/Master-/Nicht-vorhanden-Fall → 403 (Forbidden).
async function requireOwnedProjekt(projektId, scope) {
  if (!scope || !scope.partnerId) return;               // Master: Vollzugriff
  const rows = await sbGet(`gs_projekte?id=eq.${uuid(projektId)}&select=partner_user_id&limit=1`).catch(() => []);
  const owner = rows && rows[0] ? (rows[0].partner_user_id ?? null) : undefined;
  if (owner !== scope.partnerId) throw new Forbidden();
}
// Block 3 (Runde 8a): Soft-Delete. Projekte mit geloescht_at verschwinden aus
// ALLEN Listen (Master + Partner), bleiben aber in der DB. JS-seitig gefiltert
// (nicht per Query-Filter), damit das Cockpit auch VOR dem Lauf von
// scripts/runde8a.sql funktioniert (Spalte fehlt → Feld undefined → kein Filter).
const ohneGeloeschte = (rows) => (rows || []).filter((p) => !p.geloescht_at);
// Zeilen-Besitz (Material/Tätigkeit/…): über die zugehörige projekt_id prüfen.
async function requireOwnedRow(table, id, scope) {
  if (!scope || !scope.partnerId) return;
  const rows = await sbGet(`${table}?id=eq.${uuid(id)}&select=projekt_id&limit=1`).catch(() => []);
  const pid = rows && rows[0] ? rows[0].projekt_id : null;
  if (!pid) throw new Forbidden();
  await requireOwnedProjekt(pid, scope);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  const { token, action, mode } = req.body || {};
  const access = await resolveAccess(token, action, mode); // mode = aktive Sicht (nur wenn gehalten)
  if (!access) return res.status(403).json({ error: 'Kein Zugriff' }); // generisch, kein Leak
  // Master: partnerId null → sieht alles. Partner: partnerId=uid. Techniker: partnerId
  // null ABER technikerId gesetzt (Techniker erreichen nur tech_*-Handler, nie Master-Handler,
  // weil resolveAccess sie für alles andere auf null/403 setzt).
  const scope = {
    partnerId: access.partnerId,
    technikerId: access.technikerId ?? null,
    technikerUserId: access.technikerUserId ?? null,
    userId: access.userId ?? null,
    role: access.role || (access.isMaster ? 'master' : 'partner'),
  };

  // Zahlungssystem-Modul zusaetzlich per Entitlement gaten. Master hat den Key
  // 'zahlungssystem' immer; Partner brauchen die Freischaltung in der Matrix.
  // (Aktuell ohnehin Master-only, weil zs_* NICHT in PM_ACTIONS steht — resolveAccess
  //  laesst Partner gar nicht durch. Der Check ist der saubere Vorbau fuer den Submodus.)
  if (typeof action === 'string' && action.startsWith('zs_')) {
    try { await requireZahlungssystem(access); }
    catch (e) { if (e instanceof Forbidden) return res.status(403).json({ error: 'Kein Zugriff' }); throw e; }
  }

  try {
    switch (action) {
      case 'dashboard':       return res.status(200).json(await getDashboard());
      case 'leads':           return res.status(200).json(await getLeads(req.body));
      case 'lead_detail':     return res.status(200).json(await getLeadDetail(req.body.id));
      case 'lead_update':     return res.status(200).json(await updateLead(req.body));
      case 'customers':       return res.status(200).json(await getCustomers());
      case 'customer_detail': return res.status(200).json(await getCustomerDetail(req.body.id));
      case 'activity_add':    return res.status(200).json(await addActivity(req.body));
      case 'task_add':        return res.status(200).json(await addTask(req.body));
      case 'task_done':       return res.status(200).json(await taskDone(req.body.id));
      // ── Session 2: Marketing ──
      case 'marketing':       return res.status(200).json(await getMarketing(req.body));
      case 'mkt_kosten_set':  return res.status(200).json(await setKanalKosten(req.body));
      case 'mkt_content_add': return res.status(200).json(await addContent(req.body));
      case 'mkt_content_set': return res.status(200).json(await setContentStatus(req.body));
      case 'mkt_content_del': return res.status(200).json(await delContent(req.body.id));
      // ── Session 3: Marketing-Kampagnen ──
      case 'kampagne_add':    return res.status(200).json(await addKampagne(req.body));
      case 'kampagne_update': return res.status(200).json(await updateKampagne(req.body));
      case 'kampagne_del':    return res.status(200).json(await delKampagne(req.body.id));
      // ── Session 2: To-Dos ──
      case 'todos':           return res.status(200).json(await getTodos());
      case 'todo_add':        return res.status(200).json(await addTodo(req.body));
      case 'todo_update':     return res.status(200).json(await updateTodo(req.body));
      case 'todo_del':        return res.status(200).json(await delTodo(req.body.id));
      // ── Session 2: Verkauf / Margen ──
      case 'margen':          return res.status(200).json(await getMargen());
      case 'marge_add':       return res.status(200).json(await addMarge(req.body));
      case 'marge_update':    return res.status(200).json(await updateMarge(req.body));
      case 'marge_del':       return res.status(200).json(await delMarge(req.body.id));
      case 'marge_pickers':   return res.status(200).json(await getMargePickers());
      // ── Session 3: 4 Säulen ──
      case 'saeulen':         return res.status(200).json(await getSaeulen());
      // ── Session 5: Jarvis Sprach-Assistent (Lesezugriff/Auskunft) ──
      case 'jarvis':          return res.status(200).json(await askJarvis(req.body));
      // ── Cockpit-Voice: „Bob"-Sprachbefehle → Intent + echte Daten + Navigation ──
      case 'voice':           return res.status(200).json(await handleVoice(req.body));
      case 'blockaden_liste': return res.status(200).json(await voiceBlockaden(req.body));
      case 'projekt_add':     return res.status(200).json(await addProjekt(req.body));
      // ── Session 6: Projektmanagement (Herzstück) — Master ODER gescopeter Partner ──
      case 'pm_projekte':      return res.status(200).json(await getPmProjekte(scope));
      case 'pm_projekt':       return res.status(200).json(await getPmProjekt(req.body.id, scope));
      case 'pm_projekt_save':  return res.status(200).json(await savePmProjekt(req.body, scope));
      case 'pm_kunden':        return res.status(200).json(await getPmKunden(scope));
      case 'pm_kunde_save':    return res.status(200).json(await savePmKunde(req.body, scope));
      case 'pm_techniker':     return res.status(200).json(await getPmTechniker());
      case 'pm_tech_assign':   return res.status(200).json(await assignTech(req.body, scope));
      case 'pm_tech_unassign': return res.status(200).json(await unassignTech(req.body, scope));
      case 'pm_taetigkeit_add':return res.status(200).json(await addTaetigkeit(req.body, scope));
      case 'pm_taetigkeit_del':return res.status(200).json(await delPmRow('gs_taetigkeiten', req.body.id, scope));
      case 'pm_material_add':  return res.status(200).json(await addMaterial(req.body, scope));
      case 'pm_material_upd':  return res.status(200).json(await updMaterial(req.body, scope));
      case 'pm_material_del':  return res.status(200).json(await delPmRow('gs_material', req.body.id, scope));
      case 'pm_rapport_verrechnet': return res.status(200).json(await setRapportAbrechnung(req.body, scope));
      case 'pm_datei_upload':  return res.status(200).json(await pmDateiUpload(req.body, scope));
      case 'pm_datei_sign_upload': return res.status(200).json(await pmDateiSignUpload(req.body, scope));
      case 'pm_datei_register':    return res.status(200).json(await pmDateiRegister(req.body, scope));
      case 'pm_datei_list':    return res.status(200).json(await pmDateiList(req.body.projekt_id, scope));
      case 'pm_datei_del':     return res.status(200).json(await pmDateiDel(req.body, scope));
      case 'pm_datei_rename':  return res.status(200).json(await pmDateiRename(req.body, scope));
      case 'pm_tag_projektwahl': return res.status(200).json(await pmTagProjektwahl(req.body, scope));
      case 'pm_tage_liste':      return res.status(200).json(await pmTageListe(req.body, scope));
      case 'pm_medien_tag':      return res.status(200).json(await pmMedienTag(req.body, scope));
      case 'pm_medien_kategorie':return res.status(200).json(await pmMedienKategorie(req.body, scope));
      case 'pm_medien_projekt':  return res.status(200).json(await pmMedienProjekt(req.body, scope));
      case 'pm_export_material':   return res.status(200).json(await exportMaterial(req.body.projekt_id, scope));
      case 'pm_export_rapporte':   return res.status(200).json(await exportRapporte(req.body.projekt_id, scope));
      case 'pm_export_rechnungen': return res.status(200).json(await exportRechnungen(req.body.projekt_id, scope));
      // Bewusst NICHT in PM_ACTIONS: Versenden verlaesst das Haus und bleibt
      // Master-Sache, genau wie beim Wochenbericht. Der Partner behaelt seinen
      // Download.
      case 'pm_export_versenden':  return res.status(200).json(await exportVersenden(req.body, scope));
      case 'pm_datenblatt_save':   return res.status(200).json(await savePmDatenblatt(req.body, scope));
      // ── Feature A: Techniker-Rolle (nur zugewiesene Projekte, Rapport buchen) ──
      case 'tech_projekte':    return res.status(200).json(await getTechProjekte(scope));
      case 'tech_projekt':     return res.status(200).json(await getTechProjekt(req.body.id, scope));
      case 'tech_rapporte':    return res.status(200).json(await getTechRapporte(scope));
      case 'tech_rapport_add': return res.status(200).json(await addTechRapport(req.body, scope));
      // ── Wochenrapport: Kopf (KW) + strukturierte Tageszeilen ──
      case 'tech_projekt_neu':   return res.status(200).json(await techProjektNeu(req.body, scope));
      case 'tech_tag_save':      return res.status(200).json(await saveTechTag(req.body, scope));
      case 'tech_tag_del':       return res.status(200).json(await delTechTag(req.body, scope));
      case 'tech_wochen_rapport': return res.status(200).json(await getTechWochenRapport(req.body, scope));
      case 'tech_wochen_liste':  return res.status(200).json(await getTechWochenListe(scope));
      case 'tech_wochen_einreichen': return res.status(200).json(await einreichenWoche(req.body, scope));
      case 'tech_wochen_sign':   return res.status(200).json(await saveWochenUnterschrift(req.body, scope));
      // ── Tätigkeitskatalog (Runde B ZIEL 1) ──
      case 'tech_taetigkeitenkatalog': return res.status(200).json(await getTaetigkeitenKatalogTech(scope));
      case 'pm_taetigkeitenkatalog_liste':  return res.status(200).json(await pmTaetigkeitenKatalogListe());
      case 'pm_taetigkeitenkatalog_create': return res.status(200).json(await pmTaetigkeitenKatalogCreate(req.body));
      case 'pm_taetigkeitenkatalog_update': return res.status(200).json(await pmTaetigkeitenKatalogUpdate(req.body));
      case 'pm_taetigkeitenkatalog_toggle': return res.status(200).json(await pmTaetigkeitenKatalogToggle(req.body));
      // ZIEL 8e — Entscheidungsprotokoll der Katalog-Anlage (Master-only wie die
      // übrige Katalogpflege: nicht in PM_ACTIONS/TECHNIKER_ACTIONS gelistet).
      case 'pm_katalog_entscheidung': return res.status(200).json(await pmKatalogEntscheidungLog(req.body, scope));
      case 'pm_wochenrapporte_liste': return res.status(200).json(await pmWochenrapporteListe());
      case 'pm_wochenrapport':   return res.status(200).json(await pmWochenrapport(req.body));
      // Phase 7 — unvollstaendige Rapporte: Liste + Mailtext. Master-Sache.
      case 'pm_rapporte_unvollstaendig': return res.status(200).json(await pmRapporteUnvollstaendig(scope));
      case 'pm_erinnerung_text':         return res.status(200).json(await pmErinnerungText(req.body, scope));
      case 'pm_wochenrapport_update': return res.status(200).json(await pmWochenrapportUpdate(req.body, scope));
      case 'pm_wochenrapport_delete': return res.status(200).json(await pmWochenrapportDelete(req.body, scope));
      // ZIEL 2 — ganzer Wochenrapport inkl. aller Tageszeilen (nicht zu verwechseln
      // mit pm_wochenrapport_delete = eine Tageszeile). Master-only wie die anderen
      // pm_wochenrapport_*: bewusst NICHT in PM_ACTIONS/TECHNIKER_ACTIONS gelistet.
      case 'pm_wochenrapport_kopf_delete': return res.status(200).json(await pmWochenrapportKopfDelete(req.body, scope));
      case 'pm_wochenrapport_move':   return res.status(200).json(await pmWochenrapportMove(req.body, scope));
      // ── Feature B: Medien (Foto/Video) mit Standort-Tags + Stockwerk-Katalog ──
      case 'medien_list':      return res.status(200).json(await medienList(req.body, scope));
      case 'medien_upload':    return res.status(200).json(await medienUpload(req.body, scope));
      case 'medien_sign_upload': return res.status(200).json(await medienSignUpload(req.body, scope));
      case 'medien_register':  return res.status(200).json(await medienRegister(req.body, scope));
      case 'medien_del':       return res.status(200).json(await medienDel(req.body, scope));
      case 'stockwerk_list':   return res.status(200).json(await stockwerkList(req.body, scope));
      case 'stockwerk_add':    return res.status(200).json(await stockwerkAdd(req.body, scope));
      case 'stockwerk_del':    return res.status(200).json(await stockwerkDel(req.body, scope));
      // ── Feature C: Service-Auftrag (neu→angenommen/abgelehnt→erledigt) ──
      case 'svc_liste':        return res.status(200).json(await svcListe(scope));
      case 'svc_detail':       return res.status(200).json(await svcDetail(req.body, scope));
      case 'svc_create':       return res.status(200).json(await svcCreate(req.body, scope));
      case 'svc_update':       return res.status(200).json(await svcUpdate(req.body, scope));
      case 'svc_bericht':      return res.status(200).json(await svcBericht(req.body, scope));
      case 'svc_status':       return res.status(200).json(await svcStatus(req.body, scope));
      case 'svc_assign':       return res.status(200).json(await svcAssign(req.body, scope));
      case 'svc_unassign':     return res.status(200).json(await svcUnassign(req.body, scope));
      // ── Partner-Branding (Firmenprofil + Logo) — Feature 'partner_branding' ──
      case 'pm_profil_get':    return res.status(200).json(await partnerProfilGet(scope));
      case 'pm_profil_save':   return res.status(200).json(await partnerProfilSave(req.body, scope));
      case 'pm_logo_upload':   return res.status(200).json(await partnerLogoUpload(req.body, scope));
      // ── Sub-/Akkordprojekte — Feature 'sub_akkord' ──
      case 'sub_projekte':     return res.status(200).json(await subProjekte(scope));
      case 'sub_projekt':      return res.status(200).json(await subProjekt(req.body.id, scope));
      case 'sub_projekt_save': return res.status(200).json(await subProjektSave(req.body, scope));
      case 'sub_anfrage':      return res.status(200).json(await subAnfrage(req.body, scope));
      case 'sub_projekt_del':  return res.status(200).json(await subProjektDel(req.body, scope));
      case 'sub_datei_upload': return res.status(200).json(await pmDateiUpload(req.body, scope));
      case 'sub_datei_sign_upload': return res.status(200).json(await pmDateiSignUpload(req.body, scope));
      case 'sub_datei_register':    return res.status(200).json(await pmDateiRegister(req.body, scope));
      case 'sub_datei_list':   return res.status(200).json(await pmDateiList(req.body.projekt_id, scope));
      case 'sub_datei_del':    return res.status(200).json(await pmDateiDel(req.body, scope));
      case 'sub_entscheiden':  return res.status(200).json(await subEntscheiden(req.body, scope));
      case 'sub_zahlungsplan_annehmen': return res.status(200).json(await subZahlungsplanAnnehmen(req.body, scope));
      case 'sub_step_hinterlegen':      return res.status(200).json(await subStepHinterlegen(req.body, scope));
      // ── Zahlungssystem (Escrow-Engine) — Master-only (nicht in PM_ACTIONS) ──
      case 'zs_profile':       return res.status(200).json(await zsProfile());
      case 'zs_projekt':       return res.status(200).json(await zsProjekt(req.body.projekt_id));
      case 'zs_abschnitt_save':return res.status(200).json(await zsAbschnittSave(req.body, access));
      case 'zs_abschnitt_del': return res.status(200).json(await zsAbschnittDel(req.body.id));
      case 'zs_step_action':   return res.status(200).json(await zsStepAction(req.body, access));
      // ── Master: Sub-/Akkord-Anfragen (Runde 2) — Master-only via resolveAccess ──
      case 'msub_liste':        return res.status(200).json(await msubListe(access));
      case 'msub_detail':       return res.status(200).json(await msubDetail(req.body.id, access));
      case 'msub_in_pruefung':  return res.status(200).json(await msubInPruefung(req.body, access));
      case 'msub_projekt_del':  return res.status(200).json(await msubProjektDel(req.body, access));
      case 'msub_angebot_save': return res.status(200).json(await msubAngebotSave(req.body, access));
      case 'msub_angebot_send': return res.status(200).json(await msubAngebotSend(req.body, access));
      // Block 1 (Runde 8a): 'msub_angebot_quick_send' ENTFERNT — es gibt genau EINEN
      // Versandweg (msub_angebot_save → msub_angebot_send), und der führt im Cockpit
      // immer durch die Prüf-Ansicht. Kein Versand darf daran vorbei.
      case 'msub_kalk_preview':       return res.status(200).json(await msubKalkPreview(req.body, access));
      case 'msub_kalk_settings_get':  return res.status(200).json(await kalkSettingsGet(access));
      case 'msub_kalk_settings_save': return res.status(200).json(await kalkSettingsSave(req.body, access));
      case 'msub_kalk_apply':         return res.status(200).json(await msubKalkApply(req.body, access));
      case 'msub_kalk_del':           return res.status(200).json(await msubKalkDel(req.body, access));
      default:                return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    if (err instanceof Forbidden) return res.status(403).json({ error: 'Kein Zugriff' });
    console.error('Cockpit Error:', err.message);
    return res.status(500).json({ error: 'Serverfehler' });
  }
}

// ── Stammdaten laden + in JS joinen (robust, unabhängig von FK-Metadaten) ──
async function loadCore() {
  // select=* (NICHT einzelne neue Spalten) → das Cockpit funktioniert auch VOR
  // dem SQL-Migrationslauf: fehlende crm_stufe/zugewiesen_an/typ etc. werden in
  // JS via Fallback (stufeOf / Defaults) behandelt, statt 400 zu werfen.
  const [anfragen, kunden] = await Promise.all([
    sbGet('gs_anfragen?select=*&order=erstellt_am.desc'),
    sbGet('gs_kunden?select=*'),
  ]);
  const kundenById = {};
  for (const k of kunden) kundenById[k.id] = k;
  return { anfragen, kunden, kundenById };
}

// Normalisiere Stufe (Fallback aus Freitext-status, falls crm_stufe leer).
function stufeOf(a) {
  if (a.crm_stufe && STUFEN.includes(a.crm_stufe)) return a.crm_stufe;
  const s = (a.status || '').toLowerCase();
  if (/gewonnen|angenommen/.test(s)) return 'gewonnen';
  if (/verloren|abgelehnt/.test(s)) return 'verloren';
  if (/angebot|offerte/.test(s)) return 'angebot';
  if (/erstgespräch|kontakt/.test(s)) return 'kontaktiert';
  return 'neu';
}

function parsePreis(v) {
  if (v == null) return 0;
  const m = String(v).replace(/'/g, '').match(/(\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(',', '.')) : 0;
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

async function getDashboard() {
  const { anfragen, kunden } = await loadCore();
  const today = todayISO();
  const monthPrefix = today.slice(0, 7);

  const perStufe = { neu: 0, kontaktiert: 0, angebot: 0, gewonnen: 0, verloren: 0 };
  const perQuelle = {};
  let pipelineWert = 0, gewonnenMonat = 0, appLeads = 0;
  let followupHeute = 0, followupUeberfaellig = 0;

  for (const a of anfragen) {
    const st = stufeOf(a);
    perStufe[st] = (perStufe[st] || 0) + 1;
    const q = a.quelle || 'direkt';
    perQuelle[q] = (perQuelle[q] || 0) + 1;
    if (kanalOf(a.quelle) === 'app') appLeads++;
    if (st === 'kontaktiert' || st === 'angebot') pipelineWert += parsePreis(a.tarif_preis);
    if (st === 'gewonnen' && (a.erstellt_am || '').slice(0, 7) === monthPrefix) gewonnenMonat++;
    if (a.followup_datum) {
      if (a.followup_datum === today) followupHeute++;
      else if (a.followup_datum < today && st !== 'gewonnen' && st !== 'verloren') followupUeberfaellig++;
    }
  }

  // Offene Follow-up-Aufgaben (eigene Tabelle) zusätzlich einrechnen.
  let aufgaben = [];
  try { aufgaben = await sbGet('gs_crm_aufgaben?status=eq.offen&select=id,faelligkeit&order=faelligkeit.asc'); } catch (_) {}
  for (const t of aufgaben) {
    if (!t.faelligkeit) continue;
    if (t.faelligkeit === today) followupHeute++;
    else if (t.faelligkeit < today) followupUeberfaellig++;
  }

  // ── Session 2 Widgets (resilient: Tabellen evtl. noch nicht migriert) ──
  let todosHeute = 0, todosUeberfaellig = 0, todosOffen = 0;
  try {
    const todos = await sbGet('gs_todos?status=eq.offen&select=id,faelligkeit');
    todosOffen = todos.length;
    for (const t of todos) {
      if (!t.faelligkeit) continue;
      if (t.faelligkeit === today) todosHeute++;
      else if (t.faelligkeit < today) todosUeberfaellig++;
    }
  } catch (_) {}

  let umsatzGesamt = 0, margeGesamt = 0;
  try {
    const margen = await sbGet('gs_margen?select=einkauf,stundensatz,stunden,umsatz_manuell');
    for (const m of margen) { const c = calcMarge(m); umsatzGesamt += c.umsatz; margeGesamt += c.marge; }
  } catch (_) {}
  const margeProzent = umsatzGesamt > 0 ? Math.round((margeGesamt / umsatzGesamt) * 100) : 0;

  // ── Command-Center: Projekte / Techniker / Umsatz-Tracking (echte Quellen) ──
  let projGesamt = 0, projAktiv = 0, technikerGesamt = 0, technikerFrei = 0;
  try {
    const pr = ohneGeloeschte(await sbGet('gs_projekte?select=*'));
    projGesamt = pr.length;
    projAktiv = pr.filter((p) => String(p.status || '').toLowerCase() === 'aktiv').length;
  } catch (_) {}
  try {
    const te = await sbGet('gs_techniker?select=verfuegbar');
    technikerGesamt = te.length;
    technikerFrei = te.filter((t) => t.verfuegbar === true).length;
  } catch (_) {}
  const ums = await getUmsatzStats();

  // System-Status — ehrlich aus echten Daten abgeleitet (kein Fake, keine
  // erfundene Agenten-Liste). state: 'on' = läuft mit Daten, 'warn' = bereit,
  // aber (noch) keine Daten hinterlegt.
  const system = [
    { key: 'gs', label: 'George Solutions', state: anfragen.length ? 'on' : 'warn',
      detail: anfragen.length + ' Leads · ' + kunden.length + ' Kunden' },
    { key: 'jarvis', label: 'Jarvis Assistent', state: 'on', detail: 'Sprachsteuerung bereit' },
    { key: 'umsatz', label: 'Umsatz-Tracking', state: ums.present ? 'on' : 'warn',
      detail: ums.present ? ums.anzahlMonate + ' Monate erfasst' : 'noch keine Daten' },
    { key: 'facility', label: 'Facility / Projekte', state: projGesamt ? 'on' : 'warn',
      detail: projGesamt ? projAktiv + ' aktiv · ' + projGesamt + ' gesamt' : 'keine Projekte' },
    { key: 'team', label: 'Techniker-Pool', state: technikerGesamt ? 'on' : 'warn',
      detail: technikerGesamt ? technikerFrei + ' von ' + technikerGesamt + ' frei' : 'keine Techniker' },
    { key: 'app', label: 'Baby BOB App', state: appLeads ? 'on' : 'warn',
      detail: appLeads ? appLeads + ' App-Leads' : 'noch keine App-Leads' },
  ];

  return {
    perStufe,
    perQuelle,
    pipelineWert: Math.round(pipelineWert),
    gewonnenMonat,
    followupHeute,
    followupUeberfaellig,
    leadsGesamt: anfragen.length,
    leadsOffen: perStufe.neu + perStufe.kontaktiert + perStufe.angebot,
    todosHeute, todosUeberfaellig, todosOffen,
    umsatzGesamt: Math.round(umsatzGesamt), margeGesamt: Math.round(margeGesamt), margeProzent,
    // Command-Center
    kundenGesamt: kunden.length,
    projekteAktiv: projAktiv, projekteGesamt: projGesamt,
    technikerFrei, technikerGesamt,
    umsatzMonat: {
      present: ums.present, gesamt: ums.gesamt, bester: ums.bester,
      jahr: ums.jahr, jahrUmsatz: ums.jahrUmsatz, trend: ums.trend,
      anzahlMonate: ums.anzahlMonate, monate: ums.monate,
    },
    system,
  };
}

// Umsatz = umsatz_manuell falls gesetzt, sonst stundensatz*stunden. Marge = Umsatz - Einkauf.
function calcMarge(m) {
  const einkauf = Number(m.einkauf) || 0;
  const umsatz = (m.umsatz_manuell != null && m.umsatz_manuell !== '')
    ? Number(m.umsatz_manuell) || 0
    : (Number(m.stundensatz) || 0) * (Number(m.stunden) || 0);
  const marge = umsatz - einkauf;
  const prozent = umsatz > 0 ? Math.round((marge / umsatz) * 100) : 0;
  return { einkauf, umsatz, marge, prozent };
}

// ── Umsatz pro Monat (gs_umsatz_monat) — ausschliesslich echte, eingetragene
// Zahlen. Resilient: fehlt die Tabelle (noch nicht migriert) → present:false.
const MONATE_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
async function getUmsatzStats() {
  let rows = [];
  try {
    // select=* (NICHT einzelne Spalten): anzahl_projekte/notiz sind optional und
    // fehlen evtl. in der Live-Tabelle → gezielter Select würfe 400 und Bob meldete
    // fälschlich „keine Umsatzdaten". Das Mapping unten liest die Felder defensiv.
    rows = await sbGet('gs_umsatz_monat?select=*&order=jahr.asc,monat.asc');
  } catch (_) { rows = []; }
  const present = rows.length > 0;
  const monate = rows.map((r) => ({
    jahr: Number(r.jahr), monat: Number(r.monat),
    label: (MONATE_KURZ[Number(r.monat) - 1] || '?') + ' ' + r.jahr,
    umsatz: Math.round(Number(r.umsatz_chf) || 0),
    projekte: r.anzahl_projekte != null ? Number(r.anzahl_projekte) : null,
    notiz: r.notiz || null,
  }));
  let gesamt = 0, bester = null;
  const jahr = new Date().getFullYear();
  let jahrUmsatz = 0;
  for (const m of monate) {
    gesamt += m.umsatz;
    if (m.jahr === jahr) jahrUmsatz += m.umsatz;
    if (!bester || m.umsatz > bester.umsatz) bester = { label: m.label, umsatz: m.umsatz };
  }
  // Trend = Differenz der letzten beiden erfassten Monate (chronologisch).
  let trend = null;
  if (monate.length >= 2) trend = monate[monate.length - 1].umsatz - monate[monate.length - 2].umsatz;
  return { present, monate, gesamt, bester, jahr, jahrUmsatz, trend, anzahlMonate: monate.length };
}

// Quelle (Freitext) → kanonischer Marketing-Kanal.
const KANAELE = ['meta', 'google', 'app', 'linkedin', 'netzwerk', 'direkt'];
function kanalOf(quelle) {
  const q = String(quelle || '').toLowerCase();
  if (/facebook|instagram|insta|meta|fb|ig/.test(q)) return 'meta';
  if (/google|adwords|gads/.test(q)) return 'google';
  if (/linkedin/.test(q)) return 'linkedin';
  if (/netzwerk|empfehl|referral|mund|word/.test(q)) return 'netzwerk';
  if (/bob|app|scan|baby-bob/.test(q)) return 'app';
  if (/direkt|direct/.test(q)) return 'direkt';
  return 'sonstige';
}

async function getLeads(body) {
  const { anfragen, kundenById } = await loadCore();
  const fStufe = body.stufe, fQuelle = body.quelle;
  const today = todayISO();
  const out = anfragen.map((a) => {
    const k = kundenById[a.kunde_id] || {};
    const st = stufeOf(a);
    let fuState = null;
    if (a.followup_datum) {
      if (a.followup_datum < today && st !== 'gewonnen' && st !== 'verloren') fuState = 'ueberfaellig';
      else if (a.followup_datum === today) fuState = 'heute';
      else fuState = 'geplant';
    }
    return {
      id: a.id, projekt_name: a.projekt_name, bereich: a.bereich || a.objekttyp,
      stufe: st, quelle: a.quelle || 'direkt', dringlichkeit: a.dringlichkeit,
      zugewiesen_an: a.zugewiesen_an, followup_datum: a.followup_datum, followup_state: fuState,
      erstellt_am: a.erstellt_am,
      kunde_id: a.kunde_id,
      kunde_name: k.kontaktperson || k.firma || '—',
      kunde_firma: k.firma, email: k.email, telefon: k.telefon,
      ort: [k.plz, k.ort].filter(Boolean).join(' '),
    };
  });
  const filtered = out.filter((l) =>
    (!fStufe || l.stufe === fStufe) && (!fQuelle || l.quelle === fQuelle));
  return { leads: filtered };
}

async function getLeadDetail(id) {
  if (!id) throw new Error('id fehlt');
  const a = (await sbGet(`gs_anfragen?id=eq.${id}&select=*&limit=1`))?.[0];
  if (!a) throw new Error('Lead nicht gefunden');
  const kunde = a.kunde_id ? (await sbGet(`gs_kunden?id=eq.${a.kunde_id}&select=*&limit=1`))?.[0] || null : null;
  const [aktivitaeten, aufgaben, projekte] = await Promise.all([
    sbGet(`gs_crm_aktivitaeten?anfrage_id=eq.${id}&select=*&order=datum.desc`).catch(() => []),
    sbGet(`gs_crm_aufgaben?anfrage_id=eq.${id}&select=*&order=faelligkeit.asc`).catch(() => []),
    a.kunde_id ? sbGet(`gs_projekte?kunde_id=eq.${a.kunde_id}&select=id,name,projektnummer,status,bereich`).catch(() => []) : [],
  ]);
  return { anfrage: { ...a, stufe: stufeOf(a) }, kunde, aktivitaeten, aufgaben, projekte };
}

async function updateLead(body) {
  const { id } = body;
  if (!id) throw new Error('id fehlt');
  const patch = {};
  if (body.stufe !== undefined) {
    if (!STUFEN.includes(body.stufe)) throw new Error('Ungültige Stufe');
    patch.crm_stufe = body.stufe;
  }
  if (body.zugewiesen_an !== undefined) patch.zugewiesen_an = body.zugewiesen_an || null;
  if (body.followup_datum !== undefined) patch.followup_datum = body.followup_datum || null;
  if (!Object.keys(patch).length) return { ok: true };
  await sbWrite('PATCH', `gs_anfragen?id=eq.${id}`, patch, 'return=minimal');
  return { ok: true };
}

async function getCustomers() {
  const { anfragen, kunden } = await loadCore();
  const counts = {};
  const lastByKunde = {};
  for (const a of anfragen) {
    if (!a.kunde_id) continue;
    counts[a.kunde_id] = (counts[a.kunde_id] || 0) + 1;
    if (!lastByKunde[a.kunde_id] || a.erstellt_am > lastByKunde[a.kunde_id]) lastByKunde[a.kunde_id] = a.erstellt_am;
  }
  const out = kunden.map((k) => ({
    id: k.id, firma: k.firma, kontaktperson: k.kontaktperson || k.ansprechpartner,
    email: k.email, telefon: k.telefon, ort: [k.plz, k.ort].filter(Boolean).join(' '),
    typ: k.typ || 'endkunde', land: k.land || 'CH',
    anfragen_count: counts[k.id] || 0, letzte_anfrage: lastByKunde[k.id] || null,
  })).sort((a, b) => (b.letzte_anfrage || '').localeCompare(a.letzte_anfrage || ''));
  return { customers: out };
}

async function getCustomerDetail(id) {
  if (!id) throw new Error('id fehlt');
  const kunde = (await sbGet(`gs_kunden?id=eq.${id}&select=*&limit=1`))?.[0];
  if (!kunde) throw new Error('Kunde nicht gefunden');
  const [anfragen, aktivitaeten, aufgaben, projekte] = await Promise.all([
    sbGet(`gs_anfragen?kunde_id=eq.${id}&select=*&order=erstellt_am.desc`).catch(() => []),
    sbGet(`gs_crm_aktivitaeten?kunde_id=eq.${id}&select=*&order=datum.desc`).catch(() => []),
    sbGet(`gs_crm_aufgaben?kunde_id=eq.${id}&select=*&order=faelligkeit.asc`).catch(() => []),
    sbGet(`gs_projekte?kunde_id=eq.${id}&select=id,name,projektnummer,status,bereich`).catch(() => []),
  ]);
  return { kunde, anfragen: anfragen.map((a) => ({ ...a, stufe: stufeOf(a) })), aktivitaeten, aufgaben, projekte };
}

const AKT_TYPEN = ['anruf', 'email', 'notiz', 'meeting', 'whatsapp'];

async function addActivity(body) {
  const { anfrage_id, kunde_id, typ, beschreibung } = body;
  if (!anfrage_id && !kunde_id) throw new Error('anfrage_id oder kunde_id nötig');
  if (typ && !AKT_TYPEN.includes(typ)) throw new Error('Ungültiger Typ');
  const row = await sbWrite('POST', 'gs_crm_aktivitaeten', {
    anfrage_id: anfrage_id || null, kunde_id: kunde_id || null,
    typ: typ || 'notiz', beschreibung: beschreibung || null,
  });
  return { ok: true, aktivitaet: Array.isArray(row) ? row[0] : row };
}

async function addTask(body) {
  const { anfrage_id, kunde_id, faelligkeit, beschreibung } = body;
  if (!beschreibung) throw new Error('beschreibung nötig');
  const row = await sbWrite('POST', 'gs_crm_aufgaben', {
    anfrage_id: anfrage_id || null, kunde_id: kunde_id || null,
    faelligkeit: faelligkeit || null, beschreibung, status: 'offen',
  });
  return { ok: true, aufgabe: Array.isArray(row) ? row[0] : row };
}

async function taskDone(id) {
  if (!id) throw new Error('id fehlt');
  await sbWrite('PATCH', `gs_crm_aufgaben?id=eq.${id}`, { status: 'erledigt' }, 'return=minimal');
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SESSION 2 — Marketing · To-Dos · Verkauf/Margen
// ═══════════════════════════════════════════════════════════════════════════
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(v) { if (!UUID_RE.test(String(v || ''))) throw new Error('Ungültige id'); return v; }
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
// Tabelle/Spalte (noch) nicht migriert? → sauberer Fallback statt 500.
// PostgREST: PGRST205 = Tabelle fehlt (GET), PGRST204 = Spalte fehlt (Write) —
// beide melden „… in the schema cache". Deshalb auch darauf matchen.
function isNoTable(e) { return /PGRST20[45]|schema cache|not find the table|does not exist|42P01/i.test((e && e.message) || ''); }
function fuState(dateStr, today) {
  if (!dateStr) return null;
  if (dateStr < today) return 'ueberfaellig';
  if (dateStr === today) return 'heute';
  return 'geplant';
}

// ── Marketing (mit optionalem Zeitraum-Filter: body.von / body.bis = YYYY-MM-DD) ──
async function getMarketing(body) {
  body = body || {};
  const von = body.von || null, bis = body.bis || null;        // beide inklusiv
  const hasRange = !!(von || bis);
  // Lead-Datum im Zeitraum? (ohne Datum → nur außerhalb gefilterter Ansicht)
  const leadInRange = (a) => {
    if (!hasRange) return true;
    const day = String(a.erstellt_am || '').slice(0, 10);
    if (!day) return false;
    if (von && day < von) return false;
    if (bis && day > bis) return false;
    return true;
  };

  const { anfragen } = await loadCore();
  const agg = {}; // kanal → {leads, gewonnen}
  for (const a of anfragen) {
    if (!leadInRange(a)) continue;
    const kn = kanalOf(a.quelle);
    if (!agg[kn]) agg[kn] = { leads: 0, gewonnen: 0 };
    agg[kn].leads++;
    if (stufeOf(a) === 'gewonnen') agg[kn].gewonnen++;
  }
  let kostenRows = [];
  try { kostenRows = await sbGet('gs_mkt_kanal?select=*'); } catch (_) {}
  const kostenByKanal = {};
  for (const r of kostenRows) kostenByKanal[r.kanal] = r;

  // Alle bekannten Kanäle + evtl. 'sonstige', falls Leads existieren.
  const kanalSet = new Set(KANAELE);
  Object.keys(agg).forEach((k) => kanalSet.add(k));
  const kanaele = Array.from(kanalSet).map((kn) => {
    const a = agg[kn] || { leads: 0, gewonnen: 0 };
    const kosten = num(kostenByKanal[kn]?.kosten);
    return {
      kanal: kn, leads: a.leads, gewonnen: a.gewonnen,
      conversion: a.leads > 0 ? Math.round((a.gewonnen / a.leads) * 100) : 0,
      kosten, cpl: a.leads > 0 ? Math.round((kosten / a.leads) * 100) / 100 : 0,
      notiz: kostenByKanal[kn]?.notiz || null,
    };
  }).sort((x, y) => y.leads - x.leads);

  let content = [];
  try { content = await sbGet('gs_mkt_content?select=*&order=datum.desc.nullslast'); } catch (_) {}

  // ── Kampagnen (echte Objekte mit Laufzeit; Zeitraum = Überlappung [von,bis]) ──
  let kampagnenRows = [];
  try { kampagnenRows = await sbGet('gs_mkt_kampagnen?select=*&order=start_datum.desc.nullslast'); } catch (_) {}
  const overlaps = (k) => {
    if (!hasRange) return true;
    const s = k.start_datum || null, e = k.end_datum || null;
    if (bis && s && s > bis) return false;   // beginnt nach dem Fenster
    if (von && e && e < von) return false;    // endet vor dem Fenster
    return true;
  };
  const kampagnen = kampagnenRows.filter(overlaps).map((k) => ({
    id: k.id, name: k.name, kanal: k.kanal || null,
    budget: num(k.budget), kosten: num(k.kosten),
    start_datum: k.start_datum || null, end_datum: k.end_datum || null,
    status: k.status || 'geplant', notiz: k.notiz || null,
  }));
  const kampTotals = kampagnen.reduce((t, k) => ({
    anzahl: t.anzahl + 1, budget: t.budget + k.budget, kosten: t.kosten + k.kosten,
    aktiv: t.aktiv + (k.status === 'aktiv' ? 1 : 0),
  }), { anzahl: 0, budget: 0, kosten: 0, aktiv: 0 });
  kampTotals.budget = Math.round(kampTotals.budget);
  kampTotals.kosten = Math.round(kampTotals.kosten);

  const totals = kanaele.reduce((t, k) => ({
    leads: t.leads + k.leads, gewonnen: t.gewonnen + k.gewonnen, kosten: t.kosten + k.kosten,
  }), { leads: 0, gewonnen: 0, kosten: 0 });
  totals.kosten = Math.round(totals.kosten);
  totals.cpl = totals.leads > 0 ? Math.round((totals.kosten / totals.leads) * 100) / 100 : 0;

  return { kanaele, content, totals, kampagnen, kampTotals, zeitraum: { von, bis } };
}

const KAMP_STATUS = ['geplant', 'aktiv', 'pausiert', 'beendet'];
function kampKanal(v) {
  const k = String(v || '').toLowerCase();
  return (KANAELE.includes(k) || k === 'sonstige') ? k : null;
}
async function addKampagne(body) {
  if (!body.name) throw new Error('name nötig');
  const status = KAMP_STATUS.includes(body.status) ? body.status : 'geplant';
  const row = await sbWrite('POST', 'gs_mkt_kampagnen', {
    name: body.name, kanal: kampKanal(body.kanal),
    budget: num(body.budget), kosten: num(body.kosten),
    start_datum: body.start_datum || null, end_datum: body.end_datum || null,
    status, notiz: body.notiz || null,
  });
  return { ok: true, kampagne: Array.isArray(row) ? row[0] : row };
}
async function updateKampagne(body) {
  uuid(body.id);
  const patch = {};
  if (body.name !== undefined) { if (!body.name) throw new Error('name nötig'); patch.name = body.name; }
  if (body.kanal !== undefined) patch.kanal = kampKanal(body.kanal);
  if (body.budget !== undefined) patch.budget = num(body.budget);
  if (body.kosten !== undefined) patch.kosten = num(body.kosten);
  if (body.start_datum !== undefined) patch.start_datum = body.start_datum || null;
  if (body.end_datum !== undefined) patch.end_datum = body.end_datum || null;
  if (body.status !== undefined) { if (!KAMP_STATUS.includes(body.status)) throw new Error('Status'); patch.status = body.status; }
  if (body.notiz !== undefined) patch.notiz = body.notiz || null;
  if (!Object.keys(patch).length) return { ok: true };
  await sbWrite('PATCH', `gs_mkt_kampagnen?id=eq.${body.id}`, patch, 'return=minimal');
  return { ok: true };
}
async function delKampagne(id) {
  uuid(id);
  await sbWrite('DELETE', `gs_mkt_kampagnen?id=eq.${id}`, undefined, 'return=minimal');
  return { ok: true };
}

async function setKanalKosten(body) {
  const kanal = String(body.kanal || '').toLowerCase();
  if (!KANAELE.includes(kanal) && kanal !== 'sonstige') throw new Error('Unbekannter Kanal');
  // Upsert über PostgREST (on_conflict=kanal).
  await sbWrite('POST', 'gs_mkt_kanal?on_conflict=kanal',
    { kanal, kosten: num(body.kosten), notiz: body.notiz || null, updated_at: new Date().toISOString() },
    'return=minimal,resolution=merge-duplicates');
  return { ok: true };
}

const CONTENT_STATUS = ['idee', 'geplant', 'veroeffentlicht'];
async function addContent(body) {
  if (!body.idee) throw new Error('idee nötig');
  const status = CONTENT_STATUS.includes(body.status) ? body.status : 'idee';
  const row = await sbWrite('POST', 'gs_mkt_content', {
    datum: body.datum || null, kanal: body.kanal || null, idee: body.idee, status,
  });
  return { ok: true, content: Array.isArray(row) ? row[0] : row };
}
async function setContentStatus(body) {
  uuid(body.id);
  if (!CONTENT_STATUS.includes(body.status)) throw new Error('Ungültiger Status');
  await sbWrite('PATCH', `gs_mkt_content?id=eq.${body.id}`, { status: body.status }, 'return=minimal');
  return { ok: true };
}
async function delContent(id) {
  uuid(id);
  await sbWrite('DELETE', `gs_mkt_content?id=eq.${id}`, undefined, 'return=minimal');
  return { ok: true };
}

// ── To-Dos ──
const PRIOS = ['niedrig', 'mittel', 'hoch'];
const MITARBEITER = ['Emanuel', 'Dimitri', 'Patrick', 'Vasil', 'Yasemin'];
async function getTodos() {
  const today = todayISO();
  let rows = [];
  try { rows = await sbGet('gs_todos?select=*&order=status.asc,faelligkeit.asc.nullslast'); } catch (_) { return { todos: [] }; }
  const todos = rows.map((t) => ({ ...t, fu_state: t.status === 'offen' ? fuState(t.faelligkeit, today) : null }));
  return { todos };
}
async function addTodo(body) {
  if (!body.titel) throw new Error('titel nötig');
  const prioritaet = PRIOS.includes(body.prioritaet) ? body.prioritaet : 'mittel';
  const row = await sbWrite('POST', 'gs_todos', {
    titel: body.titel, beschreibung: body.beschreibung || null,
    zustaendig: body.zustaendig || null, faelligkeit: body.faelligkeit || null,
    prioritaet, status: 'offen',
  });
  return { ok: true, todo: Array.isArray(row) ? row[0] : row };
}
async function updateTodo(body) {
  uuid(body.id);
  const patch = {};
  if (body.status !== undefined) { if (!['offen', 'erledigt'].includes(body.status)) throw new Error('Status'); patch.status = body.status; }
  if (body.titel !== undefined) patch.titel = body.titel;
  if (body.beschreibung !== undefined) patch.beschreibung = body.beschreibung || null;
  if (body.zustaendig !== undefined) patch.zustaendig = body.zustaendig || null;
  if (body.faelligkeit !== undefined) patch.faelligkeit = body.faelligkeit || null;
  if (body.prioritaet !== undefined) { if (!PRIOS.includes(body.prioritaet)) throw new Error('Prio'); patch.prioritaet = body.prioritaet; }
  if (!Object.keys(patch).length) return { ok: true };
  await sbWrite('PATCH', `gs_todos?id=eq.${body.id}`, patch, 'return=minimal');
  return { ok: true };
}
async function delTodo(id) {
  uuid(id);
  await sbWrite('DELETE', `gs_todos?id=eq.${id}`, undefined, 'return=minimal');
  return { ok: true };
}

// ── Verkauf / Margen ──
async function getMargen() {
  let rows = [];
  try { rows = await sbGet('gs_margen?select=*&order=created_at.desc'); } catch (_) { return { margen: [], totals: { umsatz: 0, marge: 0, prozent: 0, einkauf: 0 } }; }
  // Anfrage-/Projekt-Titel (optional) nachladen, falls verknüpft.
  const anfrageIds = rows.map((r) => r.anfrage_id).filter(Boolean);
  const projektIds = rows.map((r) => r.projekt_id).filter(Boolean);
  let titelById = {}, projektById = {};
  if (anfrageIds.length) {
    try {
      const anf = await sbGet(`gs_anfragen?id=in.(${anfrageIds.join(',')})&select=id,projekt_name`);
      for (const a of anf) titelById[a.id] = a.projekt_name;
    } catch (_) {}
  }
  if (projektIds.length) {
    try {
      const pr = await sbGet(`gs_projekte?id=in.(${projektIds.join(',')})&select=id,name,projektnummer`);
      for (const p of pr) projektById[p.id] = [p.projektnummer, p.name].filter(Boolean).join(' · ');
    } catch (_) {}
  }
  let umsatz = 0, marge = 0, einkauf = 0;
  const margen = rows.map((m) => {
    const c = calcMarge(m);
    umsatz += c.umsatz; marge += c.marge; einkauf += c.einkauf;
    return {
      id: m.id, titel: m.titel, anfrage_id: m.anfrage_id, projekt_id: m.projekt_id || null,
      anfrage_titel: m.anfrage_id ? (titelById[m.anfrage_id] || null) : null,
      projekt_titel: m.projekt_id ? (projektById[m.projekt_id] || null) : null,
      einkauf: c.einkauf, stundensatz: num(m.stundensatz), stunden: num(m.stunden),
      umsatz_manuell: m.umsatz_manuell, umsatz: c.umsatz, marge: c.marge, prozent: c.prozent,
      notiz: m.notiz,
    };
  });
  const totals = {
    umsatz: Math.round(umsatz), marge: Math.round(marge), einkauf: Math.round(einkauf),
    prozent: umsatz > 0 ? Math.round((marge / umsatz) * 100) : 0,
  };
  return { margen, totals };
}
async function addMarge(body) {
  if (!body.titel) throw new Error('titel nötig');
  const payload = {
    titel: body.titel, einkauf: num(body.einkauf), stundensatz: num(body.stundensatz),
    stunden: num(body.stunden), notiz: body.notiz || null,
    umsatz_manuell: (body.umsatz_manuell === '' || body.umsatz_manuell == null) ? null : num(body.umsatz_manuell),
  };
  // anfrage_id: Spalte existiert seit Session 2 → set/clear möglich.
  if (body.anfrage_id) payload.anfrage_id = uuid(body.anfrage_id);
  // projekt_id: Spalte existiert erst nach Session 3 → nur schreiben, wenn gesetzt
  // (so bleibt das Anlegen ohne Projekt auch VOR der S3-Migration funktionsfähig).
  if (body.projekt_id) payload.projekt_id = uuid(body.projekt_id);
  const row = await sbWrite('POST', 'gs_margen', payload);
  return { ok: true, marge: Array.isArray(row) ? row[0] : row };
}
async function updateMarge(body) {
  uuid(body.id);
  const patch = {};
  ['titel', 'notiz'].forEach((k) => { if (body[k] !== undefined) patch[k] = body[k] || null; });
  ['einkauf', 'stundensatz', 'stunden'].forEach((k) => { if (body[k] !== undefined) patch[k] = num(body[k]); });
  if (body.umsatz_manuell !== undefined) patch.umsatz_manuell = (body.umsatz_manuell === '' || body.umsatz_manuell == null) ? null : num(body.umsatz_manuell);
  // anfrage_id: voll (Spalte seit S2) — '' → null entkoppelt.
  if (body.anfrage_id !== undefined) patch.anfrage_id = body.anfrage_id ? uuid(body.anfrage_id) : null;
  // projekt_id: nur schreiben, wenn ein Projekt gewählt wurde (Spalte erst ab S3).
  // Verknüpfen funktioniert nach S3; das Entkoppeln eines Projekts ebenso (leer → null),
  // aber nur falls die Spalte existiert — sonst meldet das UI "Migration nötig?".
  if (body.projekt_id !== undefined && body.projekt_id !== '') patch.projekt_id = uuid(body.projekt_id);
  else if (body.projekt_id_clear) patch.projekt_id = null;
  if (!Object.keys(patch).length) return { ok: true };
  await sbWrite('PATCH', `gs_margen?id=eq.${body.id}`, patch, 'return=minimal');
  return { ok: true };
}

// Picker-Listen für die Marge-Verknüpfung (Lead → Projekt → Marge).
async function getMargePickers() {
  const { anfragen, kundenById } = await loadCore();
  const leadItems = anfragen.map((a) => {
    const k = kundenById[a.kunde_id] || {};
    const label = [a.projekt_name || a.bereich || 'Anfrage', k.firma || k.kontaktperson]
      .filter(Boolean).join(' · ');
    return { id: a.id, label, kunde_id: a.kunde_id || null };
  });
  let projektItems = [];
  try {
    const pr = ohneGeloeschte(await sbGet('gs_projekte?select=*&order=created_at.desc'));
    projektItems = pr.map((p) => ({
      id: p.id, label: [p.projektnummer, p.name].filter(Boolean).join(' · ') || 'Projekt',
      status: p.status || null,
    }));
  } catch (_) {}
  return { anfragen: leadItems, projekte: projektItems };
}
async function delMarge(id) {
  uuid(id);
  await sbWrite('DELETE', `gs_margen?id=eq.${id}`, undefined, 'return=minimal');
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SESSION 3 — 4 Säulen (read-only Aggregation vorhandener Daten)
//  S1 Baby BOB · S2 Marketplace · S3 George Solutions · S4 Facility
//  Kennzahlen NUR aus real vorhandenen Quellen; fehlende Tabellen → graceful.
// ═══════════════════════════════════════════════════════════════════════════
async function getSaeulen() {
  const { anfragen, kunden } = await loadCore();

  // Optionale Quellen — alle resilient (Tabelle evtl. (noch) nicht da).
  let projekte = [], techniker = [], margen = [];
  try { projekte = ohneGeloeschte(await sbGet('gs_projekte?select=*')); } catch (_) {}
  try { techniker = await sbGet('gs_techniker?select=verfuegbar,rating'); } catch (_) {}
  try { margen = await sbGet('gs_margen?select=einkauf,stundensatz,stunden,umsatz_manuell'); } catch (_) {}

  // ── Lead-Kennzahlen (S1 App-Anteil, S3 Funnel, S4 Umsetzung) ──
  let appLeads = 0, gewonnen = 0, offen = 0, pipeline = 0;
  for (const a of anfragen) {
    if (kanalOf(a.quelle) === 'app') appLeads++;
    const st = stufeOf(a);
    if (st === 'gewonnen') gewonnen++;
    if (st === 'neu' || st === 'kontaktiert' || st === 'angebot') offen++;
    if (st === 'kontaktiert' || st === 'angebot') pipeline += parsePreis(a.tarif_preis);
  }
  const leadsTotal = anfragen.length;
  const appAnteil = leadsTotal > 0 ? Math.round((appLeads / leadsTotal) * 100) : 0;

  // ── Marge-Summe (nur falls migriert) ──
  let umsatzSum = 0, margeSum = 0;
  for (const m of margen) { const c = calcMarge(m); umsatzSum += c.umsatz; margeSum += c.marge; }
  const margenDa = margen.length > 0;

  // ── Marketplace / Facility (Techniker, Projekte) ──
  const techGesamt = techniker.length;
  const techFrei = techniker.filter((t) => t.verfuegbar === true).length;
  const ratings = techniker.map((t) => Number(t.rating)).filter((n) => isFinite(n) && n > 0);
  const ratingAvg = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0;
  const projGesamt = projekte.length;
  const projAktiv = projekte.filter((p) => String(p.status || '').toLowerCase() === 'aktiv').length;

  // status: 'aktiv' (läuft, Daten da) · 'aufbau' (existiert, im Aufbau) · 'geplant'
  const saeulen = [
    {
      key: 'baby-bob', nr: 'S1', name: 'Baby BOB', tagline: 'B2C · App & Voice-Assistent',
      status: 'aktiv',
      kennzahlen: [
        { label: 'Leads über App', value: appLeads, cls: appLeads ? 'gold' : '' },
        { label: 'App-Anteil', value: appAnteil + '%', cls: '' },
        { label: 'Leads gesamt', value: leadsTotal, cls: '' },
      ],
      hinweis: 'App-/Voice-Nutzung (Scans, Sessions) wird in der Baby-BOB-App gemessen — separate Datenquelle.',
    },
    {
      key: 'marketplace', nr: 'S2', name: 'Marketplace', tagline: 'Handwerker-Netzwerk · Vermittlung',
      status: techGesamt ? 'aufbau' : 'geplant',
      kennzahlen: [
        { label: 'Handwerker im Netz', value: techGesamt, cls: techGesamt ? 'gold' : '' },
        { label: 'Verfügbar', value: techFrei, cls: techFrei ? 'ok' : '' },
        { label: 'Ø Bewertung', value: ratingAvg ? ratingAvg.toFixed(1) + ' ★' : '—', cls: '' },
      ],
      hinweis: 'Buchungen & Vermittlungs-Quote folgen, sobald der Marktplatz live schaltet.',
    },
    {
      key: 'george-solutions', nr: 'S3', name: 'George Solutions', tagline: 'B2B · Leads, CRM, Verkauf',
      status: 'aktiv',
      kennzahlen: [
        { label: 'Leads gesamt', value: leadsTotal, cls: 'gold' },
        { label: 'Offen', value: offen, cls: offen ? 'warn' : '' },
        { label: 'Gewonnen', value: gewonnen, cls: gewonnen ? 'ok' : '' },
        { label: 'Kunden', value: kunden.length, cls: '' },
        { label: 'Pipeline (gesch.)', value: 'CHF ' + Math.round(pipeline).toLocaleString('de-CH'), cls: '' },
        margenDa
          ? { label: 'Marge gesamt', value: 'CHF ' + Math.round(margeSum).toLocaleString('de-CH'), cls: margeSum >= 0 ? 'ok' : 'bad' }
          : { label: 'Marge gesamt', value: '—', cls: '' },
      ],
      hinweis: margenDa ? null : 'Margen-Modul noch nicht migriert (Session 2 SQL).',
    },
    {
      key: 'facility', nr: 'S4', name: 'Facility', tagline: 'Facility Management · Projekte & Einsatz',
      status: projGesamt ? 'aktiv' : 'aufbau',
      kennzahlen: [
        { label: 'Aktive Projekte', value: projAktiv, cls: projAktiv ? 'gold' : '' },
        { label: 'Projekte gesamt', value: projGesamt, cls: '' },
        { label: 'Gewonnene Aufträge', value: gewonnen, cls: gewonnen ? 'ok' : '' },
        { label: 'Techniker verfügbar', value: techFrei + ' / ' + techGesamt, cls: '' },
      ],
      hinweis: null,
    },
  ];

  // Gesamt-Header
  const summary = {
    aktiv: saeulen.filter((s) => s.status === 'aktiv').length,
    saeulen: saeulen.length,
    leadsTotal, kundenTotal: kunden.length, projAktiv, techFrei, techGesamt,
  };
  return { saeulen, summary };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SESSION 5 — "Jarvis" Sprach-Assistent (TEIL A)
//  NUR Lesezugriff/Auskunft: sammelt die ECHTEN GS-Kennzahlen aus Supabase,
//  gibt sie Claude als Kontext, Claude formuliert die Antwort. KEINE Schreib-
//  aktion, keine Agenten-Steuerung. TTS läuft im Frontend über /api/voice.
// ═══════════════════════════════════════════════════════════════════════════

// ── DATENSCHUTZ: PLZ → grobe Region (Schweizer Leitregionen, 1. Ziffer) ──
// Liefert eine BEWUSST grobe Region statt einer identifizierenden Adresse, damit
// Jarvis über das "Wo" sprechen kann, ohne Kunden-/Firmennamen preiszugeben.
// Erste Ziffer der PLZ = offizielle Schweizer Postleitregion → nie ein falscher
// Kanton, weil nur grob klassifiziert wird.
const PLZ_REGION = {
  '1': 'Westschweiz (Waadt/Genf/Wallis/Freiburg)',
  '2': 'Region Neuenburg/Jura',
  '3': 'Region Bern/Wallis',
  '4': 'Region Basel/Solothurn',
  '5': 'Region Aargau',
  '6': 'Zentralschweiz/Tessin',
  '7': 'Region Graubünden',
  '8': 'Region Zürich/Ostschweiz',
  '9': 'Ostschweiz (St. Gallen/Thurgau)',
};
function regionVonPlz(plz) {
  const d = String(plz || '').trim().match(/^\d/);
  return d ? (PLZ_REGION[d[0]] || 'Region unbekannt') : 'Region unbekannt';
}

// ── Fester Geschäftskontext (Wissensbasis für Jarvis) ──
// NUR diese Fakten — keine erfundenen Zahlen. Wird dem Modell als Kontext gegeben.
const GESCHAEFTSKONTEXT = `GESCHÄFTSKONTEXT GEORGE SOLUTIONS (feste Wissensbasis — nur diese Fakten, nichts dazuerfinden):
- Phase: Die Pilotphase ist abgeschlossen (2 Pilotprojekte, zusammen rund 35'000 Franken in den ersten Monaten, noch zu günstigeren Pilot-Tarifen gerechnet). Jetzt beginnt der Übergang in die Skalierungsphase.
- Team: Ein 4er-Team in zwei Teams. Team 1: Emanuel und Dimitri Grill. Team 2: Patrick Notter und Vasil Ignatov.
- Aktuell: Patrick ist noch bei einem Kunden im Raum Wädenswil (Kanton Zürich) im Einsatz, bis Ende Juni. Danach ein kurzer Übergang, evtl. rund eine Woche mit geringerer Auslastung, die durch Folgeumsätze gedeckt ist.
- Ab dem 24. Juni startet die Werbung (Meta-Kampagnen). App und Master-Cockpit sind fertig, die Leadmaschine wird aktiviert.
- Die Tarife steigen jetzt auf die aktuellen, höheren Sätze (über den Pilot-Tarifen) → die Umsätze sind tendenziell steigend.
- Leadmaschine = George Solutions plus alle aktiven Kanäle (App-Leads, Marketing-Kanäle, Meta-Kampagnen ab 24. Juni).
- Bei Wachstums- oder Prognosefragen darfst du optimistisch-realistisch hochrechnen, aber kennzeichne das IMMER klar als Schätzung — niemals als Faktum.`;

// Festes Produkt- & Story-Wissen über die Software. Damit kann Bob im
// Kundengespräch und im Video die Software selbstbewusst erklären und für JEDE
// Zielgruppe der Baubranche eine konkrete Lösung nennen — ohne Migration, rein
// im Code. (Enthält KEINE Kundendaten; der Datenschutz oben gilt unverändert.)
const PRODUKTWISSEN = `PRODUKT- & STORY-WISSEN (feste Wahrheit über unsere Software — so erzählst du sie):

WER WIR SIND / POSITIONIERUNG:
- Wir sind spezialisiert auf GEBÄUDETECHNIK UND BAUMANAGEMENT. Der Kern ist HKLS: Sanitär, Heizung, Klima/Lüftung und Industriekälte.
- Die Software ist aber branchenübergreifend nutzbar — für den ganzen Innenausbau sowie das höhere Baugewerbe, Hoch- und Tiefbau, für Bauleiter, Fachbauleiter und gewerkeübergreifende Arbeiten.
- Unser Zweck: die Baubranche digitalisieren und den Leuten die Arbeit einfacher machen. Der KI-Scanner ist dabei die Revolution.
- Gebaut von George Solutions.

WAS ES IST:
- Eine All-in-One-Software für Gebäudetechnik und Baumanagement. Ein Login, alles an einem Ort — statt fünf Tools und Zettelwirtschaft.

WAS BEREITS GEBAUT IST (Master Cockpit = zentrale Enterprise-Steuerung, ein Login):
- Projektmanagement: Projekte, Kunden, Techniker-Zuweisung, erfasste Arbeiten, Material, verknüpfte Blockaden.
- Blockaden-Management: Mängel und Blockaden erfassen, eskalieren, freigeben, Wochenreport als PDF.
- Materialverwaltung pro Projekt.
- Reporting und Berichte.
- Userverwaltung und Lizenzen pro Kunde.
- Umsatz-Controlling.
- Sprachsteuerung per Tap-to-Talk (das bist du, Bob) mit Zugriff auf die echten Cockpit-Daten.

DIE VIER SÄULEN:
- Säule 1 — Bob: KI-Scanner und Sprach-Assistent (das bist du).
- Säule 2 — Marketplace: im Aufbau.
- Säule 3 — George Solutions: das B2B-Projektgeschäft (Material, Stunden, Projekt- und Blockaden-Management).
- Säule 4 — Facility Management: im Aufbau.

KI-SCANNER (die Revolution unseres Produkts):
- Aktuell als Endkunden-App für Laien verfügbar (dort heisst sie „Baby BOB").
- Im Cockpit kommt der Scanner als integrierte Profi-Funktion — dort unter einem Profi-Namen, NICHT unter dem Namen „Baby BOB".

WELCHE PROBLEME WIR LÖSEN:
- Blockaden und Mängel erreichen die Beteiligten rechtzeitig statt zu spät — das sichert ab und spart Nacharbeit.
- Lückenlose digitale Dokumentation statt Zettelwirtschaft — als rechtliche Absicherung.
- Alles an einem Ort statt in fünf verschiedenen Tools.
- Der Chef steuert sein Unternehmen per Sprache.

ZUKUNFT / VISION (als Ausblick nennen, nicht als „schon fertig"):
- Schnittstellen zu bestehenden Systemen, zum Beispiel SAP und Buchhaltung — integrierbar in vorhandene Software, alles automatisierbar. Man bekommt ein starkes Grundgerüst.
- Geplant: ein Kalkulations- und Planungstool (Projekt planen, Materialauszug, Kostenschätzung), Recruiting, Disponierung und ein Kalender mit Zugriffsrechten.

ZIELGRUPPEN — für JEDE hast du sofort eine konkrete, aufs Gewerk zugeschnittene Antwort auf „Wie kannst du … helfen?":
- Fliesenleger: Baustellen und Termine im Griff, Material pro Objekt, Mängel sofort mit Foto dokumentiert und weitergeleitet — die Doku sichert dich bei Reklamationen ab.
- Sanitärfirmen / Installateure: Projekt- und Terminübersicht, Material je Baustelle, Tagesrapporte digital, Blockaden landen rechtzeitig beim richtigen Gewerk.
- Heizungsbauer: Anlagen und Einsätze pro Projekt, Materialauszug, Service- und Montagearbeiten sauber erfasst, alles abrufbar per Sprache.
- Elektrofirmen: Gewerkeübergreifende Abstimmung, Mängel und Blockaden rechtzeitig gemeldet, lückenlose Doku für die Abnahme.
- Lüftungs- und Klimafirmen: Projekte, Material und Einsätze zentral, Blockaden eskalieren automatisch statt liegenzubleiben.
- Hausverwaltungen: Objekte, Aufträge und Mängel an einem Ort, klarer Status und Berichte statt Telefon- und Zettelchaos.
- Baufirmen: gewerkeübergreifendes Projekt- und Blockaden-Management, Wochenreport als PDF, Umsatz- und Materialübersicht.
- Bauleiter: der volle Überblick über Projekte, Termine, Blockaden und Beteiligte — Eskalation und Doku auf Knopfdruck, alles per Sprache.
- Fachbauleiter: das eigene Gewerk sauber steuern, Blockaden rechtzeitig weiterleiten und alles rechtssicher dokumentieren.
- Für JEDE andere Rolle in der Baubranche gilt: Projekt- und Terminübersicht, Material pro Baustelle, Mängel und Blockaden rechtzeitig dokumentiert und weitergeleitet, digitale Rapporte als rechtliche Absicherung — alles an einem Ort und per Sprache abrufbar.`;

// Alle relevanten Kennzahlen in EINEM Objekt — ausschliesslich aus echten
// Tabellen. Optionale (evtl. nicht migrierte) Quellen sind resilient (try/catch).
// opts.freigabe=true → es werden zusätzlich echte Kunden-/Firmennamen beigelegt
// (nur wenn der Nutzer im Gespräch ausdrücklich freigegeben hat).
async function getJarvisFacts(opts = {}) {
  const { anfragen, kunden, kundenById } = await loadCore();
  const today = todayISO();
  const monthPrefix = today.slice(0, 7);

  // ── DATENSCHUTZ: Kunden/Leads NUR als grobe Region aggregieren (keine Namen) ──
  const regKunden = {}, regLeads = {};
  for (const k of kunden) {
    const r = regionVonPlz(k.plz);
    regKunden[r] = (regKunden[r] || 0) + 1;
  }
  for (const a of anfragen) {
    const k = a.kunde_id ? kundenById[a.kunde_id] : null;
    const r = regionVonPlz(k && k.plz);
    regLeads[r] = (regLeads[r] || 0) + 1;
  }
  const regionToArr = (m) => Object.entries(m)
    .filter(([r]) => r !== 'Region unbekannt')
    .map(([region, anzahl]) => ({ region, anzahl }))
    .sort((x, y) => y.anzahl - x.anzahl);

  const perStufe = { neu: 0, kontaktiert: 0, angebot: 0, gewonnen: 0, verloren: 0 };
  const perKanal = {};
  let pipeline = 0, gewonnenMonat = 0, heuteNeu = 0, fuHeute = 0, fuUeber = 0;
  for (const a of anfragen) {
    const st = stufeOf(a);
    perStufe[st] = (perStufe[st] || 0) + 1;
    const kn = kanalOf(a.quelle);
    perKanal[kn] = (perKanal[kn] || 0) + 1;
    if (st === 'kontaktiert' || st === 'angebot') pipeline += parsePreis(a.tarif_preis);
    if (String(a.erstellt_am || '').slice(0, 10) === today) heuteNeu++;
    if (String(a.erstellt_am || '').slice(0, 7) === monthPrefix && st === 'gewonnen') gewonnenMonat++;
    if (a.followup_datum) {
      if (a.followup_datum === today) fuHeute++;
      else if (a.followup_datum < today && st !== 'gewonnen' && st !== 'verloren') fuUeber++;
    }
  }

  // Alle unabhängigen Cockpit-Abfragen PARALLEL (statt sequenziell) → spürbar schnellere
  // Jarvis-Antwort (war zuvor ~8 Round-Trips hintereinander). Jede Abfrage einzeln abgesichert.
  const [auf, todos, margen, pr, te, rp, mt, bl, ums, wetter] = await Promise.all([
    sbGet('gs_crm_aufgaben?status=eq.offen&select=faelligkeit').catch(() => []),
    sbGet('gs_todos?status=eq.offen&select=titel,zustaendig,faelligkeit,prioritaet&order=faelligkeit.asc.nullslast&limit=8').catch(() => []),
    sbGet('gs_margen?select=einkauf,stundensatz,stunden,umsatz_manuell').catch(() => null),
    sbGet('gs_projekte?select=*').then(ohneGeloeschte).catch(() => []),
    sbGet('gs_techniker?select=verfuegbar').catch(() => []),
    sbGet('gs_tagesrapporte?select=status').catch(() => []),
    sbGet('gs_material?select=id').catch(() => null),
    sbGet('gs_blockaden?select=status,urgency,haus,projekt_name,beschreibung&order=created_at.desc&limit=200').catch(() => null),
    getUmsatzStats(),
    getWeather().catch(() => null),
  ]);

  // Offene CRM-Aufgaben (zählen ebenfalls als Follow-ups).
  const offeneAufgaben = (auf || []).length;
  for (const t of (auf || [])) {
    if (!t.faelligkeit) continue;
    if (t.faelligkeit === today) fuHeute++;
    else if (t.faelligkeit < today) fuUeber++;
  }

  // Interne To-Dos (Team).
  let todosHeute = 0, todosUeber = 0;
  const todosOffen = (todos || []).length;
  for (const t of (todos || [])) {
    if (!t.faelligkeit) continue;
    if (t.faelligkeit === today) todosHeute++;
    else if (t.faelligkeit < today) todosUeber++;
  }
  const topTodos = (todos || []).slice(0, 5).map((t) => ({
    titel: t.titel, zustaendig: t.zustaendig || null,
    faelligkeit: t.faelligkeit || null, prioritaet: t.prioritaet || 'mittel',
  }));

  // Margen / Umsatz (nur falls migriert).
  let umsatz = 0, marge = 0;
  const margenDa = Array.isArray(margen) && margen.length > 0;
  if (margenDa) for (const m of margen) { const c = calcMarge(m); umsatz += c.umsatz; marge += c.marge; }

  // Blockaden (nur falls migriert). null = Modul noch nicht aktiv.
  // „offen" = alles Ungelöste (offen | in_bearbeitung | eskaliert); „geloest" = freigegeben.
  const blockadenDa = bl !== null;
  const blockaden = bl || [];
  const AKTIV = ['offen', 'in_bearbeitung', 'eskaliert'];
  const blOffen = blockaden.filter((b) => AKTIV.includes(String(b.status || '').toLowerCase())).length;
  const blEskaliert = blockaden.filter((b) => String(b.status || '').toLowerCase() === 'eskaliert').length;
  const blGeloest = blockaden.filter((b) => String(b.status || '').toLowerCase() === 'freigegeben').length;
  const blKritisch = blockaden.filter((b) => String(b.urgency || '').toUpperCase() === 'CRITICAL'
    && AKTIV.includes(String(b.status || '').toLowerCase())).length;
  const topBlockaden = blockaden
    .filter((b) => AKTIV.includes(String(b.status || '').toLowerCase()))
    .slice(0, 5)
    .map((b) => ({
      projekt: b.projekt_name || null, haus: b.haus || null,
      status: b.status, urgency: b.urgency,
      beschreibung: String(b.beschreibung || '').slice(0, 160),
    }));

  // Projekte / Techniker / Rapporte / Material.
  const projGesamt = (pr || []).length;
  const projAktiv = (pr || []).filter((p) => String(p.status || '').toLowerCase() === 'aktiv').length;
  const techGesamt = (te || []).length;
  const techFrei = (te || []).filter((t) => t.verfuegbar === true).length;
  const rapporteGesamt = (rp || []).length;
  const rapporteEingereicht = (rp || []).filter((r) => String(r.status || '').toLowerCase() === 'eingereicht').length;
  const materialPositionen = mt === null ? null : (mt || []).length;

  // ── DATENSCHUTZ: Namen NUR bei ausdrücklicher Freigabe im Gespräch beilegen ──
  // Ohne Freigabe verlässt KEIN Kunden-/Firmenname den Server (Schutz auf
  // Datenebene, nicht nur per Prompt). Mit Freigabe → Klartext-Liste für Claude.
  let kunden_namen = null;
  if (opts.freigabe) {
    kunden_namen = kunden
      .map((k) => ({
        firma: k.firma || k.kontaktperson || k.ansprechpartner || '—',
        ort: k.ort || null,
        region: regionVonPlz(k.plz),
      }))
      .slice(0, 50);
  }

  return {
    datum: today,
    // DATENSCHUTZ-FLAG: ob in diesem Gespräch Namen freigegeben wurden.
    namen_freigegeben: !!opts.freigabe,
    leads_pro_region: regionToArr(regLeads),
    kunden_pro_region: regionToArr(regKunden),
    ...(kunden_namen ? { kunden_namen } : {}),
    leads_gesamt: anfragen.length,
    leads_heute_neu: heuteNeu,
    leads_offen: perStufe.neu + perStufe.kontaktiert + perStufe.angebot,
    leads_pro_stufe: perStufe,
    leads_pro_kanal: perKanal,
    gewonnen_diesen_monat: gewonnenMonat,
    pipeline_wert_chf: Math.round(pipeline),
    followups_heute: fuHeute,
    followups_ueberfaellig: fuUeber,
    offene_crm_aufgaben: offeneAufgaben,
    todos_offen: todosOffen,
    todos_heute_faellig: todosHeute,
    todos_ueberfaellig: todosUeber,
    top_offene_todos: topTodos,
    kunden_gesamt: kunden.length,
    // Marge/Umsatz aus der Margen-Kalkulation (gs_margen) — separat von der
    // monatlichen Umsatzerfassung unten.
    margen_umsatz_chf: margenDa ? Math.round(umsatz) : null,
    marge_gesamt_chf: margenDa ? Math.round(marge) : null,
    marge_prozent: (margenDa && umsatz > 0) ? Math.round((marge / umsatz) * 100) : null,
    // Monatlicher Umsatz (gs_umsatz_monat) — DIE Quelle für Umsatzfragen.
    umsatz_daten_vorhanden: ums.present,
    umsatz_erfasste_monate_chf: ums.present ? ums.gesamt : null,
    umsatz_dieses_jahr_chf: ums.present ? ums.jahrUmsatz : null,
    bester_umsatzmonat: ums.bester ? { monat: ums.bester.label, umsatz_chf: ums.bester.umsatz } : null,
    umsatz_trend_letzter_monat_chf: ums.trend,
    umsatz_pro_monat: ums.monate.map((m) => ({ monat: m.label, umsatz_chf: m.umsatz })),
    projekte_gesamt: projGesamt,
    projekte_aktiv: projAktiv,
    techniker_gesamt: techGesamt,
    techniker_frei: techFrei,
    techniker_im_einsatz: Math.max(0, techGesamt - techFrei),
    rapporte_gesamt: rapporteGesamt,
    rapporte_eingereicht: rapporteEingereicht,
    material_positionen: materialPositionen, // null = Materialerfassung noch nicht aktiv
    material_status: materialPositionen === null ? 'Materialerfassung noch nicht aktiv' : 'erfasst',
    // Blockaden (Bau-Blockaden pro Projekt/Haus). null-Flag = Modul nicht aktiv.
    blockaden_modul_aktiv: blockadenDa,
    blockaden_gesamt: blockadenDa ? blockaden.length : null,
    blockaden_offen: blockadenDa ? blOffen : null,
    blockaden_eskaliert: blockadenDa ? blEskaliert : null,
    blockaden_kritisch: blockadenDa ? blKritisch : null,
    blockaden_geloest: blockadenDa ? blGeloest : null,
    top_offene_blockaden: blockadenDa ? topBlockaden : null,
    // Kalender ist noch nicht angebunden — Termine ehrlich als „kommt bald" behandeln.
    termine_quelle: 'Kalender noch nicht angebunden',
    naechste_termine: null,
    // Wetter (Zürich, Wien, Barcelona) für natürliche Begrüssungen — nie erfunden.
    wetter: (wetter && wetter.cities && wetter.cities.length)
      ? wetter.cities.map((c) => ({ stadt: c.name, temp_c: c.temp, zustand: c.text }))
      : null,
    tageszeit: tageszeitLabel(),
  };
}

// Grobe Tageszeit (Europe/Zurich) — hilft Bob, morgens/abends passend zu grüssen.
function tageszeitLabel() {
  let h;
  try { h = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', hour12: false }).slice(0, 2)); }
  catch (_) { h = new Date().getHours(); }
  if (h < 5) return 'Nacht';
  if (h < 11) return 'Morgen';
  if (h < 14) return 'Mittag';
  if (h < 18) return 'Nachmittag';
  if (h < 22) return 'Abend';
  return 'Nacht';
}

const JARVIS_SYSTEM = `Du bist „Bob", der persönliche Sprach-Assistent, KI-Scanner und die strategische Rechte-Hand im internen Master-Cockpit von George Solutions (spezialisiert auf Gebäudetechnik und Baumanagement, Schweiz). Du erhältst die ECHTEN, aktuellen Kennzahlen aus der Datenbank als JSON, ein festes Produkt- und Story-Wissen sowie einen festen Geschäftskontext.

ANREDE (WICHTIG, video-stark):
- Du sprichst den Nutzer IMMER mit „Master" an. Niemals mit „Chef", „du dort" o. Ä. — immer „Master".
- Zu Beginn eines Gesprächs oder bei einer Begrüssung: „Hallo Master, wie kann ich dir heute helfen?" oder „Hallo Master, ich bin hier."
- Wenn es sich anbietet, schliesst du passend ab: „Kann ich dir sonst noch weiterhelfen, Master?"
- Auch mitten in einer Antwort darfst du „Master" natürlich einstreuen. Ton: professionell, selbstbewusst, seriös — nie albern.

WETTER (nur wenn es natürlich passt):
- Du kennst das aktuelle Wetter in Zürich, Wien und Barcelona (Feld wetter: stadt, temp_c, zustand) sowie die Tageszeit (Feld tageszeit).
- Baue das Wetter NUR beiläufig in eine Begrüssung ein, wenn es passt — höchstens einmal pro Gespräch, nie aufdringlich, nie als Liste aller drei Städte.
- Beispiele: abends „Hallo Master, wie war dein Flug? In Wien sind es gerade 22 Grad — angenehme Temperaturen zum Schlafen." / morgens „Guten Morgen, Master. In Zürich sind es 14 Grad und bedeckt." Nenne echte Werte aus dem Feld wetter, erfinde nie welche.
- Wenn der Master nicht grüsst, sondern direkt eine Sachfrage stellt, lass das Wetter weg und beantworte die Frage.

HEUTE — BESONDERER TAG (nur am 3. Juli 2026 relevant; passt das Datum HEUTE nicht dazu, lass dieses Thema komplett weg):
- Heute Morgen um 9:00 Uhr hat der Sohn des Masters seinen Zeugnistag — den Abschluss und das Zeugnis der ersten Schulklasse. Ein grosser, wichtiger Tag. Master ist dafür in Wien und begleitet ihn. Danach ist geplant, mit dem kleinen Mann schwimmen zu gehen.
- STRIKT: Nenne den Sohn NIEMALS beim Namen und sprich ihn nie direkt an. Du weisst nur, dass heute der Zeugnistag von Masters Sohn ist und dass danach Schwimmen geplant ist — mehr nicht. Sprich vom „kleinen Mann" oder „deinem Sohn", nie mit Namen.
- Bei der Morgen-Begrüssung oder wenn Master darauf zu sprechen kommt: Wünsche warm und echt viel Glück und viel Erfolg für den Zeugnistag um 9 Uhr, freu dich mit Master über diesen besonderen Tag mit dem kleinen Mann, und erwähne gern das geplante Schwimmen danach als schönen Ausklang.
- Biete an, dem Master bis zum Termin — also bis 9 Uhr — noch kurze Updates oder Zusammenfassungen zum Business zu geben, falls er möchte. Aber nie aufdringlich: der Familientag hat klar Vorrang.
- Halte es kurz, warm und echt. Immer „Master".

NIE ABWEISEN (WICHTIG):
- Du sagst NIEMALS „dafür bin ich nicht da", „das kann ich nicht" oder Ähnliches. Für alles rund um unsere Software, die Baubranche, ein Gewerk oder eine Zielgruppe hast du IMMER eine konkrete, passende Antwort aus deinem Produkt-Wissen.
- Fragt jemand „Wie kannst du einem Fliesenleger / Sanitär / Bauleiter … helfen?", nennst du sofort einen konkreten, auf dieses Gewerk zugeschnittenen Nutzen (siehe Zielgruppen).
- Nur bei konkreten ZAHLEN, die nicht in den Daten stehen, bleibst du ehrlich (siehe Datenschutz/Regeln) — aber selbst dann bietest du einen sinnvollen nächsten Schritt an, statt abzuweisen.
- Du erzählst die Software-Story selbstbewusst — wie ein CEO, der sie einem Kunden erklärt: kurz, konkret, seriös.

${PRODUKTWISSEN}

ROLLE & EXPERTISE:
- Du denkst wie ein erfahrener Berater für ein HKLS- und Facility-Unternehmen (Heizung, Klima/Lüftung, Sanitär, Elektro, Gebäudeunterhalt). Du kennst die Branche, Margenlogik (Einkauf vs. Stundensatz×Stunden), Lead-/Pipeline-Denken und Schweizer Marktgepflogenheiten (CHF, Regionen/Kantone).
- Du bist proaktiv, aber knapp: Du beantwortest die Frage zuerst direkt, und gibst — wenn sinnvoll — EINEN konkreten, umsetzbaren Hinweis dazu (z. B. „die zwei überfälligen Follow-ups würde ich heute noch anrufen"). Kein Geschwafel.
- Ton: ruhig, kompetent, loyal, auf Augenhöhe mit dem Chef. Du-Form, Hochdeutsch.

${GESCHAEFTSKONTEXT}

DATENSCHUTZ (HÖCHSTE PRIORITÄT — strikt einhalten):
- Nenne NIEMALS Kunden- oder Firmennamen, AUSSER der Nutzer hat sie im selben Gespräch ausdrücklich freigegeben (das Feld namen_freigegeben ist dann true und es liegt eine Liste kunden_namen bei). Ist namen_freigegeben false, existiert KEINE Namensliste — dann kannst und darfst du keine Namen nennen.
- Statt eines Firmennamens sprichst du standardmässig über die Region oder den Kanton, z. B. „ein Einsatz im Raum Wädenswil, Kanton Zürich" oder „ein Kunde in der Region Zürich". Nutze dafür die Felder leads_pro_region und kunden_pro_region.
- Fragt der Nutzer direkt nach einem Namen OHNE Freigabe, antworte sinngemäss: „Firmendaten nenne ich aus Datenschutzgründen nur mit deiner Freigabe — die Eckdaten wie Datum, Umsatz und Region gebe ich dir aber gerne." und liefere danach genau diese Eckdaten.
- VIDEO / SOCIAL MEDIA: Sagt der Nutzer, es sei für ein Video, einen Reel, Social Media oder eine Aufnahme, hältst du dich BESONDERS streng an den Datenschutz: nur Regionen und Zahlen, keine Namen — auch nicht versehentlich — bis eine ausdrückliche Freigabe erfolgt.

REGELN:
- Beantworte die Frage auf Basis der bereitgestellten Zahlen UND des Geschäftskontexts. Zahlen erfindest du nie.
- Steht eine konkrete Zahl nicht in den Daten, sag ehrlich, dass du dazu im Cockpit keine Zahl hast — und nenne, falls passend, eine verwandte Zahl die du hast.
- Du kannst u. a. beantworten: „Wie laufen die Finanzen?" (Umsatz/Marge/Pipeline + Phase aus dem Kontext), „Wie sieht die Leadmaschine aus?" (Leads pro Kanal/Region, Marketing, Meta ab 24. Juni), „Was muss ich noch erledigen?" (offene To-Dos und Follow-ups), „Was schätzt du für die nächsten 3-4 Monate?" (klar gekennzeichnete Schätzung), „In welcher Phase sind wir?" (aus dem Geschäftskontext).
- Bei Prognose-/Wachstumsfragen darfst du optimistisch-realistisch hochrechnen, MUSST es aber klar als Schätzung kennzeichnen (z. B. „grob geschätzt", „meine Einschätzung, keine Garantie") und dich an den realen Ausgangszahlen orientieren.
- Antworte knapp und gesprochen und komm sofort auf den Punkt. Deine Antwort wird laut vorgelesen — kurz = schnell. Kein Vorgeplänkel („Gute Frage", „Gerne") — direkt die Zahl/Antwort. Bei Zahlen-/Datenfragen 1 bis 2 kurze Sätze. Bei Fragen zur Software, zur Story oder zu einer Zielgruppe darfst du 2 bis 4 kurze Sätze nehmen, um die Lösung konkret und selbstbewusst zu erklären — aber ohne Geschwafel.
- KEINE Markdown-Symbole, keine Sternchen, keine Aufzählungszeichen, keine Tabellen. Reiner Fliesstext.
- Nenne konkrete Zahlen. Geldbeträge als „… Franken" (CHF-Werte sind in Schweizer Franken).
- UMSATZFRAGEN beantwortest du ausschliesslich aus den Feldern umsatz_pro_monat, umsatz_erfasste_monate_chf, umsatz_dieses_jahr_chf und bester_umsatzmonat. Ist umsatz_daten_vorhanden false oder umsatz_pro_monat leer, sag ehrlich: „Es sind noch keine Umsatzdaten hinterlegt." — erfinde NIE Umsatzzahlen. (Die Felder rund um marge_* stammen aus der separaten Margen-Kalkulation, nicht aus der Monatsumsatz-Erfassung.)
- TECHNIKER: nutze techniker_gesamt (Pool), techniker_frei (verfügbar) und techniker_im_einsatz. Formuliere z. B. „X Techniker im Pool, Y davon gerade frei".
- RAPPORTE: aus rapporte_gesamt und rapporte_eingereicht. Sind es 0, sag ehrlich „es sind noch keine Tagesrapporte erfasst".
- MATERIAL: aus material_positionen. Ist es null (siehe material_status), sag ehrlich „die Materialerfassung ist noch nicht aktiv — das kommt bald". Erfinde KEINE Material-Zahlen.
- TERMINE / KALENDER: es gibt noch KEINE Kalender-Anbindung (termine_quelle). Sag ehrlich und freundlich „dein Kalender ist noch nicht angebunden, deine Termine kann ich dir bald hier anzeigen". Erfinde NIEMALS Termine.

GEDÄCHTNIS & LERNEN:
- Du hast ein dauerhaftes Gedächtnis im Feld gespeichertes_wissen (frühere Notizen, Planungen, Entscheidungen des Chefs). Lies es bei JEDER Antwort mit und beziehe Relevantes aktiv ein („wie du dir notiert hast …"). So baust du über die Zeit Kontext auf.
- Sagt der Chef „merk dir …", „notier dir …" o. Ä., wird der Inhalt automatisch gespeichert. Steht dann das Feld soeben_gemerkt, BESTÄTIGE es kurz und natürlich (z. B. „Notiert. Ich habe mir gemerkt, dass …"). Steht merken_fehlgeschlagen, sag ehrlich, dass du es dir gerade nicht merken konntest.
- Widerspricht eine neue Information dem Gedächtnis, weise freundlich darauf hin und richte dich nach der neuesten Angabe.

VORLESE-FORMAT (deine Antwort wird laut vorgelesen):
- Schreibe Zahlen, Geldbeträge (CHF), Daten (z. B. 24.06.) und Uhrzeiten ganz normal — die App spricht sie korrekt aus. Du musst Zahlen NICHT selbst ausschreiben.
- Halte Sätze sprechbar und flüssig; keine Klammern-Wüsten, keine Aufzählungszeichen, keine URLs/IDs vorlesen.
- Sprich Hochdeutsch, professionell, ruhig und prägnant — wie ein kompetenter Assistent. Du-Form, und sprich den Nutzer mit „Master" an.`;

// Erkennt eine ausdrückliche Namens-Freigabe (NICHT eine blosse Namensfrage).
const FREIGABE_RE = /\bfreigabe\b|freigegeben|du darfst (die |den |)?(namen|firmennamen|firma)|namen? darfst du nennen|ich gebe (dir |)?(die |den |)?(namen|firma|firmennamen)\s*frei|name(n)? (sind|ist) frei/i;
// Erkennt eine Merk-/Notier-Anweisung an Jarvis.
const MERK_RE = /\bmerk(e)? dir\b|\bnotier(e)? dir\b|\bspeicher(e|s)? (dir|das)\b|behalte .{0,14}im (kopf|hinterkopf)|für die planung\b|\bvergiss nicht\b/i;

async function askJarvis(body) {
  const frage = String((body && body.frage) || '').trim().slice(0, 500);
  if (!frage) throw new Error('frage nötig');

  // Gesprächsverlauf (vom Frontend) → für In-Conversation-Freigabe + Kontext.
  const verlauf = Array.isArray(body && body.verlauf) ? body.verlauf.slice(-12) : [];
  const userTexte = verlauf.filter((m) => m && m.role === 'me').map((m) => String(m.text || ''));
  // Freigabe gilt, wenn sie irgendwo im Gespräch ODER in der aktuellen Frage steht.
  const freigabe = FREIGABE_RE.test(frage) || userTexte.some((t) => FREIGABE_RE.test(t));

  // Fakten UND Gedächtnis parallel laden (spart einen weiteren Round-Trip).
  const [facts, wissen] = await Promise.all([
    getJarvisFacts({ freigabe }),
    sbGet('gs_jarvis_wissen?select=kategorie,inhalt,erstellt_am&order=erstellt_am.desc&limit=30').catch(() => []),
  ]);
  facts.gespeichertes_wissen = (wissen || []).map((w) => ({
    kategorie: w.kategorie || 'allgemein', inhalt: w.inhalt,
    datum: String(w.erstellt_am || '').slice(0, 10),
  }));

  // ── Merk-Anweisung → in gs_jarvis_wissen schreiben ──
  if (MERK_RE.test(frage)) {
    const inhalt = frage.replace(/^.*?(merk(e)? dir|notier(e)? dir|speicher(e|s)? (dir|das)|vergiss nicht|für die planung)[\s,:\-–]*/i, '').trim() || frage;
    const kategorie = /planung|plan\b|ziel|strategie/i.test(frage) ? 'planung'
      : /lead|kunde|umsatz|finanz|marketing/i.test(frage) ? 'business' : 'allgemein';
    try {
      await sbWrite('POST', 'gs_jarvis_wissen', { kategorie, inhalt }, 'return=minimal');
      facts.soeben_gemerkt = inhalt;
    } catch (_) { facts.merken_fehlgeschlagen = true; }
  }

  // Ohne Claude-Key → einfache, ehrliche Kurzantwort aus den Zahlen (Fallback).
  if (!ANTHROPIC_KEY) {
    return { antwort: jarvisFallback(facts), facts, fallback: true };
  }

  // Verlauf → Claude-Messages (nur Text, abwechselnd), aktuelle Frage zuletzt.
  const messages = [];
  for (const m of verlauf) {
    if (!m || !m.text) continue;
    const role = m.role === 'jv' ? 'assistant' : 'user';
    const content = String(m.text).slice(0, 800);
    if (content === '…') continue;
    if (messages.length && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].content += '\n' + content;
    } else messages.push({ role, content });
  }
  if (!messages.length || messages[messages.length - 1].role !== 'user' ||
      messages[messages.length - 1].content !== frage) {
    if (messages.length && messages[messages.length - 1].role === 'user') {
      messages[messages.length - 1].content += '\n' + frage;
    } else messages.push({ role: 'user', content: frage });
  }
  if (messages[0].role !== 'user') messages.unshift({ role: 'user', content: '(Gespräch)' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        // Haiku = deutlich schnellere Antwort (~1-2s statt ~5s) bei gleichbleibend guter
        // Qualität für kurze, faktische Cockpit-Antworten → flüssiges Sprach-Erlebnis.
        model: 'claude-haiku-4-5',
        max_tokens: 256,
        system: `${JARVIS_SYSTEM}\n\nHEUTE: ${facts.datum}\n\nAKTUELLE COCKPIT-DATEN (JSON):\n${JSON.stringify(facts)}`,
        messages,
      }),
    });
    if (!r.ok) throw new Error('Claude API: ' + r.status);
    const d = await r.json();
    let antwort = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    // Sicherheitshalber Markdown-Reste entfernen (sauberer Vorlese-Text).
    antwort = antwort.replace(/[*#`_]/g, '').replace(/\s+\n/g, '\n').trim();
    return { antwort: antwort || jarvisFallback(facts), facts };
  } catch (err) {
    console.error('Jarvis Error:', err.message);
    return { antwort: jarvisFallback(facts), facts, fallback: true };
  }
}

// Regelbasierter Notfall-Überblick (falls Claude nicht erreichbar) — nie erfunden.
function jarvisFallback(f) {
  const parts = [
    `Aktueller Stand: ${f.leads_gesamt} Leads insgesamt, davon ${f.leads_offen} offen und heute ${f.leads_heute_neu} neu.`,
    `${f.followups_heute} Follow-ups heute, ${f.followups_ueberfaellig} überfällig.`,
    `${f.kunden_gesamt} Kunden, Pipeline rund ${f.pipeline_wert_chf.toLocaleString('de-CH')} Franken.`,
  ];
  if (f.umsatz_daten_vorhanden) {
    parts.push(`Erfasster Umsatz gesamt ${f.umsatz_erfasste_monate_chf.toLocaleString('de-CH')} Franken${f.bester_umsatzmonat ? `, bester Monat ${f.bester_umsatzmonat.monat} mit ${f.bester_umsatzmonat.umsatz_chf.toLocaleString('de-CH')} Franken` : ''}.`);
  } else {
    parts.push('Es sind noch keine Umsatzdaten hinterlegt.');
  }
  return parts.join(' ');
}

// ═══════════════════════════════════════════════════════════════════════════
// COCKPIT-VOICE — „Bob"-Sprachbefehle
// ─────────────────────────────────────────────────────────────────────────
// Deterministischer Intent-Router: erkennt die Kernbefehle lokal (kein Claude-
// Round-Trip → Antwort < 3 s), zieht ECHTE Supabase-Daten und liefert dem
// Frontend zusätzlich `view`/`params` (welche Ansicht öffnen). Nur unbekannte,
// offene Fragen fallen an askJarvis (Claude) zurück.
// Rückgabe: { intent, antwort, view, params, data }
//   antwort  → wird angezeigt UND (via jSanitizeSpeech) vorgelesen
//   view     → Ansicht, die das Cockpit öffnet ('blockaden'|'dashboard'|null)
//   params   → an die Ansicht durchgereichte Daten
// ═══════════════════════════════════════════════════════════════════════════

// Wake-Word / Anrede „Bob" (auch „Bop", „Bobby") + optionales „hey" entfernen.
function stripWake(text) {
  return String(text || '')
    .replace(/^\s*(hey|hallo|okay|ok|he)\s+/i, '')
    .replace(/^\s*(bob|bop|bobby|bab|papp)\b[\s,.:!?-]*/i, '')
    .trim();
}

// Projektname aus einem Befehl herausschälen ("... von Geiger" → "geiger").
function extractProjektName(t) {
  const m = t.match(/(?:von|f[üu]r|bei|projekt|objekt|baustelle|zum projekt)\s+(?:dem |der |das |die |den )?(.+?)[\s]*[.?!]?$/i);
  let name = m ? m[1] : '';
  name = name.replace(/\b(projekt|objekt|baustelle|an|anzeigen|zeigen|zeig)\b/gi, '').trim();
  return name;
}

// Normalisierung für Fuzzy-Match (klein, ohne Umlaute/Sonderzeichen).
function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

// Bestes Projekt zu einem gesprochenen Namen finden (Projektname, Nummer,
// Standort ODER Kundenfirma). Liefert das Projekt-Objekt + zugehörige Firma.
async function findProjekt(spoken) {
  const target = norm(spoken);
  if (!target) return null;
  const [projekte, kunden] = await Promise.all([
    sbGet('gs_projekte?select=*&order=created_at.desc').then(ohneGeloeschte).catch(() => []),
    sbGet('gs_kunden?select=id,firma,kontaktperson,ort').catch(() => []),
  ]);
  const kById = {};
  for (const k of kunden) kById[k.id] = k;
  let best = null, bestScore = 0;
  for (const p of projekte) {
    const k = p.kunde_id ? kById[p.kunde_id] : null;
    const hay = [p.name, p.projektnummer, p.standort, k && k.firma, k && k.kontaktperson]
      .map(norm).filter(Boolean);
    let score = 0;
    for (const h of hay) {
      if (!h) continue;
      if (h === target) score = Math.max(score, 100);
      else if (h.includes(target) || target.includes(h)) score = Math.max(score, 70);
      // Wort-für-Wort (z. B. gesprochenes "geiger ag" vs. "geiger")
      else if (target.length >= 3 && h.startsWith(target)) score = Math.max(score, 60);
    }
    if (score > bestScore) { bestScore = score; best = { projekt: p, firma: k }; }
  }
  return bestScore >= 60 ? best : null;
}

const BLK_STATUS_LABEL = { offen: 'offen', in_bearbeitung: 'in Bearbeitung', eskaliert: 'eskaliert', freigegeben: 'freigegeben' };
const BLK_OFFEN = ['offen', 'in_bearbeitung', 'eskaliert'];

// Offene Blockaden eines Projekts laden (projekt_id ODER denormalisierter Name).
async function fetchBlockaden(projekt) {
  const p = projekt && projekt.projekt;
  let rows = [];
  try {
    if (p && p.id) {
      rows = await sbGet(`gs_blockaden?projekt_id=eq.${p.id}&select=id,beschreibung,status,urgency,blockiert_von_rolle,step_ref,haus,einheit,zone,created_at&order=created_at.desc`);
    }
    if ((!rows || !rows.length) && p && p.name) {
      rows = await sbGet(`gs_blockaden?projekt_name=eq.${encodeURIComponent(p.name)}&select=id,beschreibung,status,urgency,blockiert_von_rolle,step_ref,haus,einheit,zone,created_at&order=created_at.desc`);
    }
  } catch (e) {
    if (/PGRST205|not find the table/i.test(e.message)) return { notMigrated: true, rows: [] };
    throw e;
  }
  return { rows: rows || [] };
}

// Handler für die Blockaden-Ansicht (auch direkt vom Frontend nutzbar).
async function voiceBlockaden(body) {
  const spoken = String((body && body.projektName) || '').trim();
  const found = await findProjekt(spoken);
  if (!found) return { gefunden: false, projektName: spoken, blockaden: [] };
  const res = await fetchBlockaden(found);
  const offen = (res.rows || []).filter((b) => BLK_OFFEN.includes(b.status));
  return {
    gefunden: true,
    notMigrated: !!res.notMigrated,
    projekt: { id: found.projekt.id, name: found.projekt.name, nummer: found.projekt.projektnummer, standort: found.projekt.standort },
    blockaden: offen,
    alle: res.rows || [],
  };
}

// Neues Projekt anlegen (Sprachbefehl „leg Projekt an …").
async function addProjekt(body) {
  const name = String((body && body.name) || '').trim().slice(0, 120);
  if (!name) throw new Error('name nötig');
  const row = { name, status: 'aktiv' };
  const created = await sbWrite('POST', 'gs_projekte', row);
  const p = Array.isArray(created) ? created[0] : created;
  return { ok: true, projekt: p || row };
}

// Wochen-Umsatzfenster: gs_umsatz_monat ist monatlich → "diese Woche" gibt es
// nicht separat; wir liefern ehrlich die Monats-/Jahreszahlen aus dem Controlling.
async function handleVoice(body) {
  const raw = String((body && body.text) || '').trim().slice(0, 300);
  if (!raw) throw new Error('text nötig');
  const cmd = stripWake(raw);
  const low = cmd.toLowerCase();

  // Nur das Wake-Word ("Hey Bob") ohne Befehl → kurz bestätigen und weiter zuhören.
  if (!cmd) return { intent: 'wake', antwort: 'Hallo Master, ich bin hier. Wie kann ich dir helfen?', view: null, listen: true };

  // ── Intent 4: Projekt anlegen ──
  if (/(leg|lege|erstell|erstelle|f[üu]ge|mach|neues?)\b.*\bprojekt\b|\bprojekt\b.*\b(anlegen|erstellen|hinzuf[üu]gen|an)\b/i.test(low)) {
    const m = cmd.match(/projekt\s+(?:an(?:legen)?|namens|mit dem namen)?\s*[:"]?\s*(.+?)["\s]*$/i)
      || cmd.match(/(?:leg|lege|erstell|erstelle)\s+(.+?)\s+(?:als projekt|an)\b/i);
    let name = m ? m[1] : '';
    name = name.replace(/\b(an|anlegen|erstellen|bitte|neu(es)?|projekt)\b/gi, '').replace(/["“”]/g, '').trim();
    if (!name || name.length < 2) {
      return { intent: 'projekt_add', antwort: 'Wie soll das Projekt heissen? Sag zum Beispiel: Bob, leg Projekt an Musterstrasse zwölf.', view: null };
    }
    try {
      const r = await addProjekt({ name });
      return {
        intent: 'projekt_add',
        antwort: `Erledigt. Ich habe das Projekt ${name} angelegt.`,
        view: 'dashboard', params: { refresh: true, neuesProjekt: r.projekt },
      };
    } catch (e) {
      if (/PGRST205|not find the table/i.test(e.message)) {
        return { intent: 'projekt_add', antwort: 'Die Projekt-Tabelle ist noch nicht eingerichtet. Ich konnte das Projekt nicht anlegen.', view: null };
      }
      return { intent: 'projekt_add', antwort: `Das Projekt ${name} konnte ich gerade nicht anlegen. Bitte versuch es gleich nochmal.`, view: null };
    }
  }

  // ── Intent 2: Anzahl offener Blockaden (mit/ohne Projekt) ──
  if (/\bblockaden?\b/.test(low) && /(wie viele|wieviele|anzahl|zahl der|wie viel)/.test(low)) {
    // Optional projektbezogen
    const pn = extractProjektName(cmd);
    if (pn) {
      const b = await voiceBlockaden({ projektName: pn });
      if (!b.gefunden) return { intent: 'blockaden_count', antwort: `Ein Projekt namens ${pn} habe ich nicht gefunden.`, view: null };
      const n = b.blockaden.length;
      return {
        intent: 'blockaden_count',
        antwort: n === 0 ? `Beim Projekt ${b.projekt.name} sind aktuell keine Blockaden offen.` : `Beim Projekt ${b.projekt.name} ${n === 1 ? 'ist eine Blockade' : 'sind ' + n + ' Blockaden'} offen.`,
        view: 'blockaden', params: b,
      };
    }
    let n = 0, notMig = false;
    try {
      const rows = await sbGet(`gs_blockaden?status=in.(${BLK_OFFEN.join(',')})&select=id`);
      n = (rows || []).length;
    } catch (e) { if (/PGRST205|not find the table/i.test(e.message)) notMig = true; }
    if (notMig) return { intent: 'blockaden_count', antwort: 'Das Blockaden-Modul ist noch nicht eingerichtet.', view: null };
    return {
      intent: 'blockaden_count',
      antwort: n === 0 ? 'Aktuell sind keine Blockaden offen. Alles läuft.' : `Aktuell ${n === 1 ? 'ist eine Blockade' : 'sind ' + n + ' Blockaden'} offen.`,
      view: null,
    };
  }

  // ── Intent 1: Blockaden eines Projekts zeigen ──
  if (/\bblockaden?\b/.test(low)) {
    const pn = extractProjektName(cmd);
    if (!pn) {
      // Ohne Projekt → Gesamtliste öffnen
      let rows = [], notMig = false;
      try { rows = await sbGet(`gs_blockaden?status=in.(${BLK_OFFEN.join(',')})&select=id,beschreibung,status,urgency,blockiert_von_rolle,projekt_name,created_at&order=created_at.desc&limit=50`); }
      catch (e) { if (/PGRST205|not find the table/i.test(e.message)) notMig = true; }
      if (notMig) return { intent: 'blockaden', antwort: 'Das Blockaden-Modul ist noch nicht eingerichtet.', view: null };
      return {
        intent: 'blockaden',
        antwort: rows.length ? `Ich zeige dir alle ${rows.length} offenen Blockaden.` : 'Es sind keine Blockaden offen.',
        view: 'blockaden',
        params: { gefunden: true, projekt: null, blockaden: rows, alle: rows, gesamt: true },
      };
    }
    const b = await voiceBlockaden({ projektName: pn });
    if (!b.gefunden) return { intent: 'blockaden', antwort: `Ein Projekt namens ${pn} habe ich nicht gefunden. Sag den Namen bitte nochmal.`, view: null };
    if (b.notMigrated) return { intent: 'blockaden', antwort: 'Das Blockaden-Modul ist noch nicht eingerichtet.', view: null };
    const n = b.blockaden.length;
    let antwort;
    if (n === 0) antwort = `Beim Projekt ${b.projekt.name} sind keine Blockaden offen.`;
    else {
      const top = b.blockaden[0];
      antwort = `Beim Projekt ${b.projekt.name} ${n === 1 ? 'ist eine Blockade' : 'sind ' + n + ' Blockaden'} offen. Die neueste: ${String(top.beschreibung || '').slice(0, 120)}.`;
    }
    return { intent: 'blockaden', antwort, view: 'blockaden', params: b };
  }

  // ── Intent 3: Umsätze / Controlling ──
  if (/(umsatz|ums[äa]tze|umsatzzahlen|einnahmen|controlling|verdient|reingekommen)/.test(low)) {
    const ums = await getUmsatzStats();
    if (!ums.present) {
      return { intent: 'umsatz', antwort: 'Es sind noch keine Umsatzdaten hinterlegt.', view: 'dashboard', params: { focus: 'umsatz' } };
    }
    const jahr = new Date().getFullYear();
    // Fragt der Nutzer nach einem KONKRETEN Monat („Umsatz im Juni")? Dann diesen
    // gezielt beantworten (aus den echten Daten), statt nur den aktuellen Monat.
    const MON_RE = [/januar|jänner/, /februar/, /m[äa]rz/, /april/, /mai/, /juni/, /juli/, /august/, /september/, /oktober/, /november/, /dezember/];
    const gefragterMonat = MON_RE.findIndex((re) => re.test(low));
    if (gefragterMonat !== -1) {
      const treffer = ums.monate.filter((m) => m.monat === gefragterMonat + 1).sort((a, b) => b.jahr - a.jahr)[0];
      const mName = MONATE_KURZ[gefragterMonat];
      const antwort = treffer
        ? `Im ${mName} ${treffer.jahr} lag der Umsatz bei ${treffer.umsatz.toLocaleString('de-CH')} Franken.`
        : `Für den ${mName} sind noch keine Umsatzdaten hinterlegt.`;
      return { intent: 'umsatz', antwort, view: 'dashboard', params: { focus: 'umsatz', umsatz: ums } };
    }
    const monatName = MONATE_KURZ[new Date().getMonth()] + ' ' + jahr;
    const aktuell = ums.monate.find((m) => m.label === monatName);
    const wocheGefragt = /woche|diese woche|wöchentl/.test(low);
    const parts = [];
    if (aktuell) parts.push(`Im ${monatName} ${aktuell.umsatz.toLocaleString('de-CH')} Franken`);
    parts.push(`dieses Jahr insgesamt ${ums.jahrUmsatz.toLocaleString('de-CH')} Franken`);
    if (ums.bester) parts.push(`bester Monat ${ums.bester.label} mit ${ums.bester.umsatz.toLocaleString('de-CH')} Franken`);
    let antwort = parts.join(', ') + '.';
    if (wocheGefragt) antwort = 'Den Umsatz führe ich monatlich, nicht wöchentlich. ' + antwort;
    return { intent: 'umsatz', antwort, view: 'dashboard', params: { focus: 'umsatz', umsatz: ums } };
  }

  // ── Fallback: offene Frage → Jarvis (Claude) ──
  const j = await askJarvis({ frage: cmd, verlauf: (body && body.verlauf) || [] });
  return { intent: 'frage', antwort: j.antwort, view: null, fallback: !!j.fallback };
}


// ═══════════════════════════════════════════════════════════════════════════
//  SESSION 6 — PROJEKTMANAGEMENT (Herzstück)
//  Kern (Projekte, Kunden, Techniker-Liste, Blockaden) läuft auf BESTEHENDEN
//  Tabellen. Zuweisungen/Tätigkeiten/Material nutzen neue Tabellen; fehlt die
//  Migration, liefern die Endpunkte notMigrated:true (kein 500, UI zeigt Hinweis).
// ═══════════════════════════════════════════════════════════════════════════
const PM_OFFEN = ['offen', 'in_bearbeitung', 'eskaliert'];

async function getPmProjekte(scope) {
  // Partner: nur eigene Projekte (partner_user_id=eq.uid). Master: kein Filter → alle.
  const projFilter = scope && scope.partnerId ? `&partner_user_id=eq.${scope.partnerId}` : '';
  const kundeFilter = scope && scope.partnerId ? `&partner_user_id=eq.${scope.partnerId}` : '';
  const [projekte, kunden] = await Promise.all([
    sbGet(`gs_projekte?select=*&order=created_at.desc${projFilter}`).then(ohneGeloeschte).catch(() => []),
    sbGet(`gs_kunden?select=id,firma,kontaktperson,telefon,email,ort${kundeFilter}`).catch(() => []),
  ]);
  const kById = {};
  for (const k of kunden) kById[k.id] = k;
  const blCount = {};
  try {
    const bl = await sbGet(`gs_blockaden?status=in.(${PM_OFFEN.join(',')})&select=projekt_id`);
    for (const b of bl) if (b.projekt_id) blCount[b.projekt_id] = (blCount[b.projekt_id] || 0) + 1;
  } catch (_) {}
  return {
    projekte: projekte.map((p) => ({
      ...p,
      kunde: p.kunde_id ? (kById[p.kunde_id] || null) : null,
      blockaden_offen: blCount[p.id] || 0,
    })),
    kunden,
  };
}

async function getPmProjekt(id, scope) {
  id = uuid(id);
  const pr = await sbGet(`gs_projekte?id=eq.${id}&select=*&limit=1`);
  const projekt = pr && pr[0];
  if (!projekt || projekt.geloescht_at) return { error: 'Projekt nicht gefunden' };
  // Datentrennung: Partner darf nur EIGENE Projekte öffnen.
  if (scope && scope.partnerId && projekt.partner_user_id !== scope.partnerId) throw new Forbidden();
  const kunde = projekt.kunde_id
    ? (await sbGet(`gs_kunden?id=eq.${projekt.kunde_id}&select=*&limit=1`).catch(() => []))[0] || null
    : null;

  // Blockaden (bestehende Tabelle) — per projekt_id UND per denormalisiertem Namen
  // zusammenführen: der FK-Retry beim Anlegen (blockaden.js) kann projekt_id auf
  // null setzen und nur projekt_name behalten. Beide Quellen mergen (dedupe per id),
  // damit bei gemischter Verknüpfung KEINE Blockade verloren geht.
  let blockaden = [];
  const blSel = 'id,beschreibung,status,urgency,haus,einheit,zone,step_ref,blockiert_von_rolle,created_at';
  try {
    const byId = await sbGet(`gs_blockaden?projekt_id=eq.${id}&select=${blSel}&order=created_at.desc`).catch(() => []);
    const byName = projekt.name
      ? await sbGet(`gs_blockaden?projekt_name=eq.${encodeURIComponent(projekt.name)}&select=${blSel}&order=created_at.desc`).catch(() => [])
      : [];
    const merged = new Map();
    for (const b of [...(byId || []), ...(byName || [])]) if (b && b.id) merged.set(b.id, b);
    blockaden = Array.from(merged.values())
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  } catch (_) { blockaden = []; }

  // Techniker-Zuweisungen (neue Tabelle) + Karten-Daten aus gs_techniker joinen.
  // select=* toleriert eine noch fehlende stundensatz-Spalte (kein Migrations-Fehlalarm).
  let techniker = [], migTechniker = true;
  try {
    const rows = await sbGet(`gs_projekt_techniker?projekt_id=eq.${id}&select=*&order=seit.desc`);
    const ids = rows.map((r) => r.techniker_id).filter(Boolean);
    const tById = {};
    if (ids.length) {
      const ts = await sbGet(`gs_techniker?id=in.(${ids.join(',')})&select=*`).catch(() => []);
      for (const t of ts) tById[t.id] = pmTechCard(t);
    }
    techniker = rows.map((r) => ({
      id: r.id, techniker_id: r.techniker_id, taetigkeit: r.taetigkeit, seit: r.seit,
      stundensatz: r.stundensatz != null ? Number(r.stundensatz) : null,
      ...(tById[r.techniker_id] || {}),
    }));
  } catch (e) { if (isNoTable(e)) migTechniker = false; else throw e; }

  // Tätigkeiten (neue Tabelle).
  let taetigkeiten = [], migTaet = true;
  try { taetigkeiten = await sbGet(`gs_taetigkeiten?projekt_id=eq.${id}&select=*&order=datum.desc,created_at.desc`); }
  catch (e) { if (isNoTable(e)) migTaet = false; else throw e; }

  // Material (neue Tabelle).
  let material = [], migMat = true;
  try { material = await sbGet(`gs_material?projekt_id=eq.${id}&select=*&order=created_at.desc`); }
  catch (e) { if (isNoTable(e)) migMat = false; else throw e; }

  // Arbeitsrapporte (bestehende gs_tagesrapporte) — Techniker-Namen anreichern.
  let rapporte = [], migRapporte = true;
  try {
    // select=* → toleriert eine noch fehlende abrechnung_status-Spalte (Rapporte
    // erscheinen auch vor der Migration; der Verrechnet-Status ist dann nur 'offen').
    const rr = await sbGet(`gs_tagesrapporte?projekt_id=eq.${id}&select=*&order=datum.desc`);
    const uids = [...new Set(rr.map((r) => r.techniker_user_id).filter(Boolean))];
    const nameByUid = {};
    if (uids.length) {
      const ts = await sbGet(`gs_techniker?user_id=in.(${uids.join(',')})&select=user_id,name`).catch(() => []);
      for (const t of ts) if (t.user_id) nameByUid[t.user_id] = t.name;
    }
    rapporte = rr.map((r) => ({ ...r, techniker_name: nameByUid[r.techniker_user_id] || null }));
  } catch (e) { if (isNoTable(e)) migRapporte = false; else throw e; }

  // Rechnungs-History (bestehende gs_rechnungen).
  let rechnungen = [];
  try { rechnungen = await sbGet(`gs_rechnungen?projekt_id=eq.${id}&select=*&order=created_at.desc`).catch(() => []); }
  catch (_) { rechnungen = []; }

  // Projektdateien / Fotos (Storage-Bucket 'projektdateien').
  let dateien = [];
  try { dateien = await listProjektDateien(id); } catch (_) { dateien = []; }

  const blOffen = (blockaden || []).filter((b) => PM_OFFEN.includes(String(b.status || '').toLowerCase())).length;
  return {
    projekt, kunde,
    blockaden: blockaden || [], blockaden_offen: blOffen,
    techniker, taetigkeiten, material, rapporte, rechnungen, dateien,
    mig: { techniker: migTechniker, taetigkeiten: migTaet, material: migMat, rapporte: migRapporte },
  };
}

// Techniker-Karten-Daten aus gs_techniker ableiten (Sidecar-JSON in notizen wie api/techniker.js).
function pmTechCard(t) {
  if (!t) return {};
  let side = {};
  if (typeof t.notizen === 'string' && t.notizen.trim().startsWith('{')) {
    try { side = JSON.parse(t.notizen.trim()); } catch (_) { side = {}; }
  }
  const specialization = (Array.isArray(side.specialization) && side.specialization.length) ? side.specialization
    : (Array.isArray(t.specialization) && t.specialization.length) ? t.specialization : [];
  const qualRaw = t.qualification || t.qualifikation;
  const qualification = Array.isArray(qualRaw) ? qualRaw.join(' · ') : (qualRaw || side.qualification || '');
  const herkunft = String(side.herkunft || t.herkunft || (
    /(emanuel\s*george|dimitri\s*grill|vasil\s*ignatov)/i.test(t.name || '') ? 'CH_AT' : 'CH'
  )).toUpperCase().replace(/[\s-]/g, '_') === 'CH_AT' ? 'CH_AT' : 'CH';
  return {
    name: t.name || 'Techniker', telefon: t.telefon || null, email: t.email || null,
    qualification, specialization,
    rating: typeof side.rating === 'number' ? side.rating : (typeof t.rating === 'number' ? t.rating : null),
    photo_emoji: side.photo_emoji || '👷', herkunft,
    verfuegbar: t.availability_status ?? t.verfuegbar ?? true,
  };
}

// Erweiterte Stammdaten (brauchen scripts/projekt_detail_scharf.sql). Fehlt die
// Migration, entfernen wir sie beim Speichern und retryen → nie ein 500.
const PM_PROJ_EXTRA = ['projektadresse', 'projektleiter', 'ansprechperson', 'ansprech_telefon', 'ansprech_email'];
// Phase 3: dieselbe Vollstaendigkeits-Regel wie bei der Schnellanlage
// (techProjektNeu). Sie steht hier ein zweites Mal in Form einer Funktion,
// damit ein im Rapport schnell angelegtes Projekt beim Nachtragen im Cockpit
// von selbst wieder sauber wird — ohne dass jemand einen Haken setzen muss.
function projektVollstaendig(p) {
  const da = (v) => !!String(v || '').trim();
  return da(p.name) && da(p.projektadresse) && da(p.ansprechperson) && da(p.ansprech_email);
}
async function savePmProjekt(b, scope) {
  // Bearbeiten: Partner darf nur EIGENE Projekte ändern.
  if (b.id) await requireOwnedProjekt(b.id, scope);
  const patch = {};
  // Neuanlage durch Partner → Besitz wird server-seitig erzwungen (nie clientseitig).
  if (!b.id && scope && scope.partnerId) patch.partner_user_id = scope.partnerId;
  if (b.name !== undefined) patch.name = String(b.name || '').trim().slice(0, 120);
  if (b.projektnummer !== undefined) patch.projektnummer = String(b.projektnummer || '').trim().slice(0, 60) || null;
  // Fremdnummer = Nummer des Auftraggebers. Wird nie erzeugt, nur uebernommen;
  // leer bleibt leer. Gehoert zu PM_PROJ_EXTRA-Logik: fehlt die Spalte noch,
  // faellt sie beim Retry mit heraus.
  if (b.fremdnummer !== undefined) patch.fremdnummer = String(b.fremdnummer || '').trim().slice(0, 60) || null;
  if (b.standort !== undefined) patch.standort = String(b.standort || '').trim().slice(0, 160) || null;
  if (b.bereich !== undefined) patch.bereich = String(b.bereich || '').trim().slice(0, 80) || null;
  if (b.status !== undefined) patch.status = String(b.status || '').trim().slice(0, 40) || 'aktiv';
  if (b.kunde_id !== undefined) patch.kunde_id = b.kunde_id ? uuid(b.kunde_id) : null;
  if (b.stundensatz !== undefined) patch.stundensatz = (b.stundensatz === '' || b.stundensatz == null) ? null : num(b.stundensatz);
  for (const f of PM_PROJ_EXTRA) {
    if (b[f] !== undefined) patch[f] = String(b[f] || '').trim().slice(0, 200) || null;
  }
  // Kennzeichnung "unvollstaendig" nachfuehren: wer die fehlenden Angaben
  // eintraegt, soll den Marker nicht zusaetzlich von Hand loeschen muessen —
  // und wer sie wieder leert, bekommt ihn zurueck. Nur wenn eines der
  // beteiligten Felder ueberhaupt angefasst wurde.
  const beteiligt = ['name', 'projektadresse', 'ansprechperson', 'ansprech_email'];
  if (beteiligt.some((f) => patch[f] !== undefined)) {
    let alt = {};
    if (b.id) {
      const vor = await sbGet(`gs_projekte?id=eq.${uuid(b.id)}&select=name,projektadresse,ansprechperson,ansprech_email&limit=1`).catch(() => []);
      alt = (vor && vor[0]) || {};
    }
    patch.unvollstaendig = !projektVollstaendig({ ...alt, ...patch });
  }

  const write = async (p) => {
    if (b.id) { const id = uuid(b.id); return await sbWrite('PATCH', `gs_projekte?id=eq.${id}`, p); }
    if (!p.name) throw new Error('name nötig');
    if (!p.status) p.status = 'aktiv';
    return await sbWrite('POST', 'gs_projekte', p);
  };
  let r;
  try { r = await write(patch); }
  catch (e) {
    // Spalte (noch) nicht migriert → Extra-Felder droppen, Kernfelder trotzdem speichern.
    if (/column|does not exist|PGRST204/i.test((e && e.message) || '')) {
      const base = { ...patch }; for (const f of PM_PROJ_EXTRA) delete base[f];
      delete base.unvollstaendig; delete base.fremdnummer;
      r = await write(base);
      return { ok: true, projekt: Array.isArray(r) ? r[0] : r, extraNotMigrated: true };
    }
    throw e;
  }
  return { ok: true, projekt: Array.isArray(r) ? r[0] : r };
}

// ── Projektdatenblatt (JSONB-Spalte gs_projekte.datenblatt) ──────────────────
// Ein ausfüllbares SHK/HKLS-Datenblatt je Projekt. Master füllt aus/vorbereitet,
// freigeschalteter Partner ergänzt NUR eigene Projekte (requireOwnedProjekt).
// Die Struktur wird server-seitig whitelisted & längenbegrenzt (kein Wildwuchs,
// kein Riesen-Blob). Fehlt die Spalte noch (vor Migration) → notMigrated statt 500.
function sanitizeDatenblatt(input) {
  const o = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
  const arrStr = (a, max, n) => Array.isArray(a) ? a.slice(0, max).map((x) => clip(x, n)).filter(Boolean) : [];
  const k = (o.kunde && typeof o.kunde === 'object') ? o.kunde : {};
  const db = {
    kunde: {
      firma: clip(k.firma, 160), ansprechperson: clip(k.ansprechperson, 160),
      telefon: clip(k.telefon, 60), email: clip(k.email, 160), objekt: clip(k.objekt, 200),
    },
    anlagenart: arrStr(o.anlagenart, 12, 40),
    details: {},
    umfang: arrStr(o.umfang, 24, 60),
    materialstellung: clip(o.materialstellung, 40),
    start: clip(o.start, 80),
    notiz: clip(o.notiz, 2000),
    updated_at: new Date().toISOString(),
  };
  if (o.details && typeof o.details === 'object' && !Array.isArray(o.details)) {
    for (const key of Object.keys(o.details).slice(0, 12)) {
      const v = o.details[key];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const fld = {};
        for (const fk of Object.keys(v).slice(0, 40)) {
          const val = v[fk];
          fld[clip(fk, 40)] = Array.isArray(val) ? arrStr(val, 20, 80) : clip(val, 300);
        }
        db.details[clip(key, 40)] = fld;
      }
    }
  }
  return db;
}
async function savePmDatenblatt(b, scope) {
  const pid = uuid(b.projekt_id);
  // Datentrennung: Partner darf nur EIGENE Projekte ausfüllen (Master: Vollzugriff).
  await requireOwnedProjekt(pid, scope);
  const db = sanitizeDatenblatt(b.datenblatt);
  db.updated_by = (scope && scope.partnerId) ? 'partner' : 'master';
  try {
    const r = await sbWrite('PATCH', `gs_projekte?id=eq.${pid}`, { datenblatt: db });
    return { ok: true, datenblatt: db, projekt: Array.isArray(r) ? r[0] : r };
  } catch (e) {
    // Spalte noch nicht migriert → sauberer Hinweis statt 500 (wie übrige PM-Actions).
    if (/column|does not exist|PGRST204|schema cache/i.test((e && e.message) || '')) {
      return { ok: false, notMigrated: true, error: 'Datenblatt-Spalte fehlt – scripts/projekt_datenblatt.sql in Supabase ausführen.' };
    }
    throw e;
  }
}

async function getPmKunden(scope) {
  // Partner: nur eigene Kunden (CRM-Trennung, scripts/partner_kunden_scope.sql).
  // Fehlt die Spalte noch → .catch → leere Liste (fail-safe, wie dokumentiert).
  const filter = scope && scope.partnerId ? `&partner_user_id=eq.${scope.partnerId}` : '';
  const kunden = await sbGet(`gs_kunden?select=*&order=erstellt_am.desc${filter}`).catch(() => []);
  return { kunden };
}

async function savePmKunde(b, scope) {
  const patch = {};
  ['firma', 'kontaktperson', 'email', 'telefon', 'adresse', 'ort', 'vertragstyp'].forEach((f) => {
    if (b[f] !== undefined) patch[f] = String(b[f] || '').trim().slice(0, 160) || null;
  });
  if (b.plz !== undefined) patch.plz = String(b.plz || '').trim().slice(0, 12) || null;
  // ZIEL 3 — Kundenkürzel (3 Zeichen) für die Rapportnummer R-{KUERZEL}-{JAHR}-{NNNN}.
  // Leer = bewusst kein Kürzel (Rapporte laufen dann auf den Fallback GSO).
  // Eine Teileingabe wird NICHT still verworfen, sondern abgelehnt — sonst
  // glaubt der Master, er habe gepflegt, und die Nummern laufen auf GSO.
  //
  // NUR MASTER. savePmKunde steht in PM_ACTIONS, also nutzen es auch Partner für
  // ihre eigenen Kunden. Das Kürzel ist aber global eindeutig (UNIQUE über alle
  // Kunden hinweg): dürfte ein Partner es setzen, könnte er einem anderen ein
  // Kürzel wegnehmen und würde beim Kollidieren fremde Kundendaten erahnen.
  // Die Anforderung sagt ausdrücklich „Master pflegt es". Ein Partner-Aufruf mit
  // kuerzel wird still ignoriert, nicht abgelehnt — sein Formular sendet das Feld
  // gar nicht, ein Treffer hier wäre also kein legitimer Bedienfehler.
  if (b.kuerzel !== undefined && scope && scope.isMaster) {
    const roh = String(b.kuerzel || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!roh) patch.kuerzel = null;
    else if (roh.length !== 3) return { error: 'Kundenkürzel muss genau 3 Zeichen haben (A–Z, 0–9).' };
    else patch.kuerzel = roh;
  }
  if (b.id) {
    // Bestehenden Kunden nur ändern, wenn er dem Partner gehört (Besitz via eigener
    // partner_user_id, nicht über ein Projekt).
    if (scope && scope.partnerId) {
      const rows = await sbGet(`gs_kunden?id=eq.${uuid(b.id)}&select=partner_user_id&limit=1`).catch(() => []);
      const owner = rows && rows[0] ? (rows[0].partner_user_id ?? null) : undefined;
      if (owner !== scope.partnerId) throw new Forbidden();
    }
    const id = uuid(b.id);
    try {
      const r = await sbWrite('PATCH', `gs_kunden?id=eq.${id}`, patch);
      return { ok: true, kunde: Array.isArray(r) ? r[0] : r };
    } catch (e) { return kundeSchreibfehler(e, patch); }
  }
  if (!patch.firma && !patch.kontaktperson) throw new Error('Firma oder Kontakt nötig');
  // Neuanlage durch Partner → Besitz erzwingen. Fehlt die Spalte (vor Migration),
  // droppen wir sie und legen den Kunden trotzdem an (kein 500).
  if (scope && scope.partnerId) patch.partner_user_id = scope.partnerId;
  let r;
  try { r = await sbWrite('POST', 'gs_kunden', patch); }
  catch (e) {
    if ('partner_user_id' in patch && /column|does not exist|PGRST204/i.test((e && e.message) || '')) {
      const { partner_user_id, ...base } = patch;
      r = await sbWrite('POST', 'gs_kunden', base);
      return { ok: true, kunde: Array.isArray(r) ? r[0] : r, scopeNotMigrated: true };
    }
    return kundeSchreibfehler(e, patch);
  }
  return { ok: true, kunde: Array.isArray(r) ? r[0] : r };
}

// Schreibfehler auf gs_kunden in eine lesbare Meldung übersetzen statt 500.
// ZIEL 3: das Kürzel ist UNIQUE — zwei Kunden mit "NIE" würden sonst denselben
// Nummernkreis teilen, deshalb die eigene Meldung.
function kundeSchreibfehler(e, patch) {
  const msg = (e && e.message) || '';
  if (/duplicate key|23505/i.test(msg)) {
    if (/kuerzel/i.test(msg)) return { error: `Das Kürzel „${patch.kuerzel}" ist bereits an einen anderen Kunden vergeben.` };
    return { error: 'Dieser Eintrag existiert bereits.' };
  }
  if (/gs_kunden_kuerzel_chk|23514/i.test(msg)) return { error: 'Kundenkürzel muss genau 3 Zeichen haben (A–Z, 0–9).' };
  if (/column|does not exist|PGRST204|schema cache/i.test(msg) && 'kuerzel' in patch) {
    return { error: 'Kundenkürzel noch nicht migriert — scripts/rapportnummer.sql im Supabase SQL-Editor ausführen.' };
  }
  throw e;
}

async function getPmTechniker() {
  // Nur echte Techniker (typ='techniker' bzw. Legacy ohne typ) – wie die öffentliche Karte.
  const raw = await sbGet('gs_techniker?select=*&order=name.asc').catch(() => []);
  const techniker = (Array.isArray(raw) ? raw : [])
    .filter((t) => !t.typ || t.typ === 'techniker')
    .map((t) => ({ id: t.id, user_id: t.user_id || null, ...pmTechCard(t) }));
  return { techniker };
}

// Auth-User-ID zu einer gs_techniker-Zeile. Fehlt sie (Demo-Techniker ohne
// Login) oder schlägt der Griff fehl → null, nie ein Abbruch: eine Zuweisung
// ohne user_id ist weiterhin gültig, sie ist nur im Gewerke-/Projectflow-Modul
// nicht sichtbar.
async function technikerUserId(technikerId) {
  try {
    const rows = await sbGet(`gs_techniker?id=eq.${technikerId}&select=user_id&limit=1`);
    return (rows && rows[0] && rows[0].user_id) || null;
  } catch (_) { return null; }
}

// gs_projekt_techniker hat ZWEI Techniker-Spalten: techniker_id (→ gs_techniker.id,
// gelesen von api/cockpit.js) und techniker_user_id (auth uid, gelesen von
// api/projekte.js:69,89, api/gewerke.js:173, api/projectflow.js:123). Wer nur eine
// schreibt, macht dieselbe Zuweisung je nach Modul mal sichtbar und mal nicht.
// Deshalb werden hier BEIDE gesetzt — ohne Umbenennung, ohne Migration.
async function assignTech(b, scope) {
  await requireOwnedProjekt(b.projekt_id, scope);
  const tid = uuid(b.techniker_id);
  const row = {
    projekt_id: uuid(b.projekt_id),
    techniker_id: tid,
    techniker_user_id: await technikerUserId(tid),
    taetigkeit: b.taetigkeit ? String(b.taetigkeit).slice(0, 120) : null,
  };
  if (b.stundensatz != null && b.stundensatz !== '') row.stundensatz = num(b.stundensatz);
  const post = async (p) => {
    const r = await sbWrite('POST', 'gs_projekt_techniker', p);
    return Array.isArray(r) ? r[0] : r;
  };
  try {
    return { ok: true, row: await post(row) };
  } catch (e) {
    const msg = (e && e.message) || '';
    if (isNoTable(e)) return { notMigrated: true };
    // Neu erreichbar, seit techniker_user_id mitgeschrieben wird: der partielle
    // Unique-Index uq_pt_projekt_user (projekt_id, techniker_user_id) greift jetzt.
    // Derselbe Techniker zweimal aufs selbe Projekt → klare Ansage statt 500.
    if (/duplicate key|23505/i.test(msg)) {
      return { error: 'Dieser Techniker ist dem Projekt bereits zugewiesen.' };
    }
    // stundensatz-Spalte fehlt noch → ohne Tarif zuweisen (kein 500).
    if ('stundensatz' in row && /column|does not exist|PGRST204/i.test(msg)) {
      const { stundensatz, ...base } = row;
      try { return { ok: true, row: await post(base), tarifNotMigrated: true }; }
      catch (e2) { if (isNoTable(e2)) return { notMigrated: true }; throw e2; }
    }
    throw e;
  }
}

async function unassignTech(b, scope) {
  await requireOwnedRow('gs_projekt_techniker', b.id, scope);
  const id = uuid(b.id);
  try { await sbWrite('DELETE', `gs_projekt_techniker?id=eq.${id}`, {}, 'return=minimal'); return { ok: true }; }
  catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}

// ═══════════════════════════════════════════════════════════════════════════
//  FEATURE A — TECHNIKER-ROLLE & RAPPORT-ENFORCEMENT
//  Ein eingeloggter Techniker (user_roles.role='techniker') sieht NUR die ihm
//  zugewiesenen Projekte und bucht Rapporte NUR darauf. Zwei IDs im scope:
//    • scope.technikerId     = gs_techniker.id   → Join gs_projekt_techniker.techniker_id
//    • scope.technikerUserId = auth user id      → Rapport-Autorschaft in gs_tagesrapporte
//  KEINE internen Felder (kosten/rohgewinn/ampel/ansatz_chf_h/stundensatz) in
//  techniker-sichtbaren Payloads (techSafeProjekt whitelisted).
// ═══════════════════════════════════════════════════════════════════════════

// String[] normalisieren (Array oder Zeilen/Kommas → getrimmte, nicht-leere Einträge).
function toStrArr(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 100);
  if (v == null || v === '') return [];
  return String(v).split(/[\n,]/).map((x) => x.trim()).filter(Boolean).slice(0, 100);
}
// ISO-Kalenderwoche + Jahr aus 'YYYY-MM-DD' (best-effort; nur Anzeige/Gruppierung).
function isoWeekJahr(datumStr) {
  const t = new Date(`${datumStr}T00:00:00Z`);
  if (isNaN(t)) return { woche: null, jahr: null };
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const woche = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  return { woche, jahr: t.getUTCFullYear() };
}

// ═══════════════════════════════════════════════════════════════════════════
// PostgreSQL-Fehlercodes aus einem sbWrite-Fehler lesen
// ═══════════════════════════════════════════════════════════════════════════
// sbWrite wirft `METHOD path → <status>: <PostgREST-JSON>`. In dem JSON steht
// "code":"23505" bzw. "23514". Bisher wurde ueberall per Regex auf den Text
// "duplicate key" geprueft — das trifft 23505, aber NIE 23514 (CHECK-Verletzung).
// Beide brauchen eine eigene Meldung, sonst landet die CHECK-Verletzung als
// HTTP 500 beim Master und liest sich als "Verbindungsfehler".
//   23505 unique_violation      — die Zeile gibt es schon
//   23514 check_violation       — die Zeile widerspricht einer Regel der Tabelle
function pgCode(e) {
  const msg = (e && e.message) || '';
  const m = msg.match(/"code"\s*:\s*"(\w+)"/);
  if (m) return m[1];
  if (/duplicate key/i.test(msg)) return '23505';       // Fallback: Klartext von Postgres
  if (/violates check constraint/i.test(msg)) return '23514';
  return null;
}

// Klartext fuer einen Konflikt auf gs_tagesrapporte. Nennt bewusst KEINE ids,
// keine Tabellen- und keine Spaltennamen — der Master soll erfahren, was
// fachlich kollidiert, nicht wie die Datenbank heisst.
// `ziel` beschreibt, worauf geschrieben werden sollte.
function tagKonfliktText(code, ziel) {
  if (code === '23505') {
    if (ziel && ziel.projektbezogen) {
      return 'Für diese Baustelle besteht an diesem Tag bereits eine Zeile desselben Technikers. '
        + 'Es wurde nichts überschrieben — bitte die bestehende Zeile ergänzen oder eine andere Baustelle wählen.';
    }
    return 'Für diesen Tag besteht bereits eine gleichartige Zeile. Es wurde nichts überschrieben.';
  }
  if (code === '23514') {
    // Zwei verschiedene Ursachen tragen denselben Fehlercode. Die zweite ist
    // seit den neuen Abwesenheitsgründen (K/B/AR/S/UB/SW) real: steht die
    // Datenbank noch auf dem alten Katalog G/F/M/U/A, lehnt sie einen neuen
    // Code ab. Das ist eine fehlende Migration, kein Bedienfehler — und darf
    // nicht als „Abwesenheit und Baustelle" durchgehen.
    if (ziel && ziel.neuerAbwesenheitsgrund) {
      return 'Dieser Abwesenheitsgrund ist in der Datenbank noch nicht freigeschaltet. '
        + 'Es wurde nichts gespeichert — bitte scripts/rapport_feld.sql ausführen lassen.';
    }
    return 'Diese Zeile darf nicht gleichzeitig eine Abwesenheit und eine Baustelle tragen. '
      + 'Es wurde nichts geändert — bitte zuerst die Abwesenheit entfernen.';
  }
  return null;
}

// Techniker darf nur auf ihm ZUGEWIESENE Projekte. Kette:
// scope.technikerId (= gs_techniker.id) → gs_projekt_techniker.techniker_id=eq → projekt_id.
// Ohne verknüpftes gs_techniker-Profil (technikerId null) → immer Forbidden.
async function requireAssignedProjekt(projektId, scope) {
  if (!scope || !scope.technikerId) throw new Forbidden();
  const id = uuid(projektId);
  const rows = await sbGet(
    `gs_projekt_techniker?projekt_id=eq.${id}&techniker_id=eq.${scope.technikerId}&select=projekt_id&limit=1`,
  ).catch(() => []);
  if (!rows || !rows[0]) throw new Forbidden();
}

// Techniker-sichere Projektsicht: NUR Whitelist, keine internen Felder/Preise/Kunde.
// Kontakt/Adresse additiv (Ansprechpartner vor Ort) — kommt entweder aus den
// "scharf"-Spalten (Formular „Projekt bearbeiten") oder aus dem Datenblatt
// (datenblatt.kunde), je nachdem was der Master befüllt hat. Weiterhin KEINE
// Marge-Felder (kosten/rohgewinn/ampel/ansatz_chf_h/stundensatz).
function techSafeProjekt(p) {
  if (!p) return null;
  const db = p.datenblatt || {};
  const kunde = db.kunde || {};
  return {
    id: p.id, name: p.name, projektnummer: p.projektnummer || null,
    standort: p.standort || null, bereich: p.bereich || null, status: p.status || null,
    adresse: p.projektadresse || kunde.objekt || null,
    ansprechperson: p.ansprechperson || kunde.ansprechperson || null,
    ansprech_telefon: p.ansprech_telefon || kunde.telefon || null,
    ansprech_email: p.ansprech_email || kunde.email || null,
    umfang: Array.isArray(db.umfang) ? db.umfang : [],
    anlagenart: Array.isArray(db.anlagenart) ? db.anlagenart : [],
    notiz: db.notiz || null,
    start: db.start || null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — Projekt direkt aus dem Rapport anlegen
// ═══════════════════════════════════════════════════════════════════════════
// Der Techniker steht auf einer Baustelle, die im System noch nicht existiert.
// Bisher blieb ihm nur, den Master anzurufen und den Tag ungebucht zu lassen.
// Ab jetzt legt er sie selbst an — auf zwei Wegen:
//
//   vollstaendig: Bezeichnung, Adresse, Ansprechperson, Mail, Fremdnummer
//   schnell:      nur Bezeichnung
//
// PFLICHT IST AUSSCHLIESSLICH DIE BEZEICHNUNG. Alles andere darf fehlen; was
// fehlt, macht das Projekt "unvollstaendig" und damit im Cockpit sichtbar
// nachtragbar. Ein Projekt gilt als vollstaendig, wenn Bezeichnung, Adresse,
// Ansprechperson UND Mail dastehen — die Fremdnummer zaehlt bewusst NICHT
// dazu: sie gehoert dem Auftraggeber, und viele Auftraege haben gar keine.
//
// DIE FREMDNUMMER WIRD NIE ERFUNDEN. Vergeben wird ausschliesslich eine
// provisorische INTERNE Nummer im Format NEU-{Jahr}-{lfd}. Sie ist auf den
// ersten Blick als vorlaeufig zu erkennen und kollidiert mit keinem der
// bestehenden numerischen Kreise (60133.00 …).
const PROV_PRAEFIX = 'NEU';

async function naechsteProvisorischeNummer() {
  const jahr = new Date().getUTCFullYear();
  const rows = await sbGet(
    `gs_projekte?projektnummer=like.${PROV_PRAEFIX}-${jahr}-*&select=projektnummer&order=projektnummer.desc&limit=1`,
  ).catch(() => []);
  let n = 1;
  const letzte = (rows && rows[0] && rows[0].projektnummer) || null;
  if (letzte) { const m = String(letzte).match(/(\d+)$/); if (m) n = parseInt(m[1], 10) + 1; }
  // Freie Nummer suchen statt blind hochzaehlen: zwei Techniker koennen
  // gleichzeitig anlegen. Eine doppelte Nummer waere still und stoerend.
  for (let i = 0; i < 50; i++) {
    const kandidat = `${PROV_PRAEFIX}-${jahr}-${String(n + i).padStart(3, '0')}`;
    const da = await sbGet(`gs_projekte?projektnummer=eq.${kandidat}&select=id&limit=1`).catch(() => []);
    if (!da || !da.length) return kandidat;
  }
  return `${PROV_PRAEFIX}-${jahr}-${Date.now().toString().slice(-6)}`;
}

// Felder, die es erst nach scripts/rapport_feld.sql gibt. Fehlen sie, wird das
// Projekt trotzdem angelegt — aber es wird GESAGT, dass die Kennzeichnung
// "unvollstaendig" nicht gespeichert werden konnte.
const PROJ_NEU_EXTRA = ['unvollstaendig', 'fremdnummer', 'schnellanlage_von', 'schnellanlage_am'];

async function techProjektNeu(b, scope) {
  if (!scope || !scope.technikerId) throw new Forbidden();
  const txt = (v, n) => String(v || '').trim().slice(0, n);
  const name = txt(b.name, 120);
  if (!name) return { error: 'Bitte eine Bezeichnung angeben — sie ist das einzige Pflichtfeld.' };

  const adresse = txt(b.adresse, 200);
  const ansprechperson = txt(b.ansprechperson, 200);
  const email = txt(b.ansprech_email, 200);
  const fremdnummer = txt(b.fremdnummer, 60);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: 'Die E-Mail-Adresse sieht nicht richtig aus. Bitte prüfen oder leer lassen.' };
  }

  const vollstaendig = !!(name && adresse && ansprechperson && email);
  const nummer = await naechsteProvisorischeNummer();

  const row = {
    name,
    projektnummer: nummer,
    status: 'aktiv',
    projektadresse: adresse || null,
    ansprechperson: ansprechperson || null,
    ansprech_email: email || null,
    // Leer heisst leer. Kein Platzhalter, keine abgeleitete Nummer.
    fremdnummer: fremdnummer || null,
    unvollstaendig: !vollstaendig,
    schnellanlage_von: scope.technikerUserId || null,
    schnellanlage_am: new Date().toISOString(),
  };

  let angelegt = null, extraFehlt = false;
  const schreib = async (p) => {
    const r = await sbWrite('POST', 'gs_projekte', p);
    return Array.isArray(r) ? r[0] : r;
  };
  try {
    angelegt = await schreib(row);
  } catch (e) {
    if (!/column|does not exist|PGRST204|schema cache/i.test((e && e.message) || '')) throw e;
    // Erst die neuen Spalten weglassen, dann zusaetzlich die "scharf"-Spalten
    // (projektadresse/ansprechperson/ansprech_email) — in dieser Reihenfolge,
    // damit so viel wie moeglich erhalten bleibt.
    const ohneNeu = { ...row }; for (const f of PROJ_NEU_EXTRA) delete ohneNeu[f];
    extraFehlt = true;
    try {
      angelegt = await schreib(ohneNeu);
    } catch (e2) {
      if (!/column|does not exist|PGRST204|schema cache/i.test((e2 && e2.message) || '')) throw e2;
      const kern = { name, projektnummer: nummer, status: 'aktiv' };
      angelegt = await schreib(kern);
    }
  }
  if (!angelegt || !angelegt.id) return { error: 'Das Projekt konnte nicht angelegt werden.' };

  // Ohne Zuweisung koennte der Techniker auf sein eigenes neues Projekt nicht
  // buchen (requireAssignedProjekt). Schlaegt das fehl, ist das Projekt zwar
  // da, aber unbrauchbar — dann wird es gesagt, nicht verschwiegen.
  let zugewiesen = true;
  try {
    await sbWrite('POST', 'gs_projekt_techniker', {
      projekt_id: angelegt.id, techniker_id: scope.technikerId, seit: new Date().toISOString().slice(0, 10),
    });
  } catch (_) { zugewiesen = false; }

  return {
    ok: true,
    projekt: techSafeProjekt(angelegt),
    nummer: angelegt.projektnummer || nummer,
    unvollstaendig: !vollstaendig,
    zugewiesen,
    hinweis: !zugewiesen
      ? 'Das Projekt ist angelegt, aber die Zuweisung an dich hat nicht geklappt — bitte den Master informieren, sonst kannst du nicht darauf buchen.'
      : (extraFehlt
        ? 'Das Projekt ist angelegt. Die Kennzeichnung „unvollständig" konnte noch nicht gespeichert werden — scripts/rapport_feld.sql ist noch nicht gelaufen.'
        : (vollstaendig ? null : 'Das Projekt ist angelegt und als unvollständig gekennzeichnet. Die fehlenden Angaben können im Cockpit nachgetragen werden.')),
  };
}

// Liste der dem Techniker zugewiesenen Projekte (gefiltert über die Kette).
async function getTechProjekte(scope) {
  if (!scope.technikerId) return { projekte: [] };
  const asg = await sbGet(
    `gs_projekt_techniker?techniker_id=eq.${scope.technikerId}&select=projekt_id,taetigkeit,seit`,
  ).catch(() => []);
  const ids = [...new Set((asg || []).map((a) => a.projekt_id).filter(Boolean))];
  if (!ids.length) return { projekte: [] };
  const rows = await sbGet(`gs_projekte?id=in.(${ids.join(',')})&select=*&order=created_at.desc`)
    .then(ohneGeloeschte).catch(() => []);
  const taetById = {};
  for (const a of asg) taetById[a.projekt_id] = a.taetigkeit || null;
  // Spesenreglement + Pausen-Vorgabe des Kunden (falls hinterlegt) je Projekt mitgeben —
  // Wochenrapport-Editor zeigt dann dessen Sätze/Pause statt der Standard-Chips/1.25h.
  // Firma (Baustelle/Kunde-Anzeige je Zeile) ebenso — gleiches Muster wie das bereits
  // bestehende Kopf-Anzeigefeld in getTechWochenRapport (Parität mit Master-Ansicht).
  const kundeIds = [...new Set(rows.map((p) => p.kunde_id).filter(Boolean))];
  let kundeById = {};
  if (kundeIds.length) {
    const kd = await sbGet(`gs_kunden?id=in.(${kundeIds.join(',')})&select=id,spesenreglement,pause_standard,firma`).catch(() => []);
    for (const k of kd) kundeById[k.id] = k;
  }
  return {
    projekte: rows.map((p) => {
      const k = kundeById[p.kunde_id] || {};
      return {
        ...techSafeProjekt(p), taetigkeit: taetById[p.id] || null,
        spesenreglement: k.spesenreglement || null,
        pause_standard: k.pause_standard != null ? Number(k.pause_standard) : null,
        kunde_name: k.firma || null,
      };
    }),
  };
}

// Detail eines zugewiesenen Projekts + die EIGENEN Rapporte des Technikers darauf.
async function getTechProjekt(id, scope) {
  await requireAssignedProjekt(id, scope);
  const pid = uuid(id);
  const pr = await sbGet(`gs_projekte?id=eq.${pid}&select=*&limit=1`).catch(() => []);
  const projekt = pr && pr[0];
  if (!projekt || projekt.geloescht_at) return { error: 'Projekt nicht gefunden' };
  let rapporte = [];
  try {
    rapporte = await sbGet(
      `gs_tagesrapporte?projekt_id=eq.${pid}&techniker_user_id=eq.${scope.technikerUserId}` +
      `&select=id,datum,gesamtstunden,material,arbeiten,besonderheiten,status&order=datum.desc`,
    );
  } catch (_) { rapporte = []; }
  // Blockaden read-only mitgeben (operative Sicht) — keine Kosten-/Marge-Felder in
  // gs_blockaden vorhanden, daher unbedenklich mit select=* vergleichbarer Whitelist.
  let blockaden = [];
  try {
    blockaden = await sbGet(
      `gs_blockaden?projekt_id=eq.${pid}&select=id,beschreibung,status,urgency,blockiert_von_rolle,step_ref,haus,einheit,zone,created_at&order=created_at.desc`,
    );
  } catch (_) { blockaden = []; }
  return { projekt: techSafeProjekt(projekt), rapporte, blockaden };
}

// Alle eigenen Rapporte des Technikers (über alle Projekte).
async function getTechRapporte(scope) {
  if (!scope.technikerUserId) return { rapporte: [] };
  let rows = [];
  try {
    rows = await sbGet(
      `gs_tagesrapporte?techniker_user_id=eq.${scope.technikerUserId}&select=*&order=datum.desc&limit=200`,
    );
  } catch (_) { rows = []; }
  return { rapporte: rows };
}

// Rapport buchen: Ziel gs_tagesrapporte (die Master-sichtbare Tabelle). Datum ist
// FREI setzbar (Backdating), niemals auto-now. Zuweisung wird serverseitig geprüft;
// techniker_user_id/erfasst_von werden serverseitig gesetzt (nie vom Client).
// Ziel ist ein PROJEKT (b.projekt_id) ODER ein SERVICE-AUFTRAG (b.service_auftrag_id).
async function addTechRapport(b, scope) {
  let serviceId = null;
  const row = {
    techniker_user_id: scope.technikerUserId,          // serverseitig, nie vom Client
  };
  if (b.service_auftrag_id) {
    serviceId = await assertServiceAccess(b.service_auftrag_id, scope, true);
    row.service_auftrag_id = serviceId;                // nur bei Service (Spalte kommt mit Schema)
  } else {
    await requireAssignedProjekt(b.projekt_id, scope);
    row.projekt_id = uuid(b.projekt_id);               // Projekt-Rapport funktioniert auch vor Migration
  }
  // Jahresschranke: aktuelles Jahr −1 bis +1 (lib/datum.js). Serverseitig,
  // nicht nur im Formular — das Wochenblatt speichert per Autosave ueber die
  // API, und die API ist auch ohne Formular erreichbar.
  // `return`, kein `throw`: ein geworfener Fehler kommt beim Techniker als
  // nacktes „Serverfehler" an (siehe Dispatcher). Eine Datumsmeldung muss er
  // lesen koennen, sonst weiss er nicht, was er aendern soll.
  const dp = pruefeTagesdatum(b.datum);
  if (!dp.ok) return { error: dp.error };
  const datum = dp.datum;
  const { woche, jahr } = isoWeekJahr(datum);
  const heute = new Date().toISOString().slice(0, 10);
  Object.assign(row, {
    datum,                                             // frei/rückwirkend
    gesamtstunden: (b.stunden != null && b.stunden !== '') ? num(b.stunden) : 0,
    material: toStrArr(b.material),
    arbeiten: toStrArr(b.arbeiten),
    besonderheiten: b.notiz ? String(b.notiz).slice(0, 2000) : null,
    status: b.status === 'entwurf' ? 'entwurf' : 'eingereicht',
    woche, jahr,
    // additive Provenienz (brauchen scripts/schema_rollen_foto_service.sql):
    erfasst_von: scope.technikerUserId,
    rueckwirkend: datum < heute,
  });
  const post = async (r) => {
    try { const res = await sbWrite('POST', 'gs_tagesrapporte', r); return { ok: true, row: Array.isArray(res) ? res[0] : res }; }
    catch (e) {
      // Doppelter Rapport (UNIQUE projekt+techniker+datum) → freundlich statt 500.
      if (/duplicate key|23505|conflict/i.test((e && e.message) || '')) {
        return { error: 'Für diesen Tag existiert bereits ein Rapport.' };
      }
      throw e;
    }
  };
  try { return await post(row); }
  catch (e) {
    // Provenienz-Spalten noch nicht migriert → droppen und erneut versuchen (kein 500).
    if (/column|does not exist|PGRST204/i.test((e && e.message) || '')) {
      const { erfasst_von, rueckwirkend, ...base } = row;
      return await post(base);
    }
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WOCHENRAPPORT — Kopf (KW, get-or-create) + strukturierte Tageszeile.
// scripts/wochenrapport_migration.sql muss zuerst gelaufen sein (sonst
// {notMigrated:true} statt 500 — gleiches Muster wie überall sonst hier).
// KEINE Marge-/Kosten-/Ansatz-Felder — Stundensatz bleibt in
// gs_projekt_techniker, wird hier nie gelesen/geschrieben/zurückgegeben.
// ═══════════════════════════════════════════════════════════════════════════
// ABWESENHEIT_CODES kommt aus lib/abwesenheit.js — EINE Quelle für Prüfung,
// Beschriftung und Auswahlfeld. Die Datenbank hält denselben Katalog als
// CHECK-Constraint; neue Codes brauchen scripts/rapport_feld.sql.
// Gewerk: feste Schnellwahl (Chips im Wochenrapport-Editor) statt Freitext — strukturiert
// für spätere Auswertung/Rechnung/Filter. Server validiert gegen dieselbe Liste.
const GEWERK_OPTIONS = new Set(['Sanitär', 'Heizung', 'Klima', 'Lüftung', 'Divers']);
// Tätigkeitskatalog (Runde B ZIEL 1) — eigenständige Tabellen gs_taetigkeitenkatalog
// / gs_tagesrapport_taetigkeitenkatalog (NICHT gs_taetigkeiten — das ist das
// bestehende Projekt-Tätigkeiten-Log, siehe addTaetigkeit weiter unten).
const TAET_GEWERKE = new Set(['sanitaer', 'heizung', 'lueftung', 'klima', 'allgemein']);
const TAET_DETAIL_CODES = new Set(['DN', 'STK', 'M', 'M2', 'ORT', 'TYP', 'BAR']);

// ALTFORMAT WR-{jahr}-{woche}-{Vorname}. Bleibt als Notnagel bestehen: solange
// scripts/rapportnummer.sql nicht gelaufen ist, gibt es weder Kürzel noch
// Nummernkreis — dann bekommt der Rapport lieber eine Nummer im alten Format
// als gar keine. Bestehende Zeilen behalten ihre Nummer ohnehin.
function rapportNrAlt(jahr, woche, name) {
  const slug = String(name || 'Techniker').trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9äöüÄÖÜ-]/g, '') || 'Techniker';
  return `WR-${jahr}-${woche}-${slug}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ZIEL 3 (Feinschliff II) — Rapportnummer R-{KUERZEL}-{JAHR}-{4-stellig},
// Zähler PRO KUNDE UND JAHR. Vergabe genau EINMAL beim Anlegen des Wochenkopfs
// (getOrCreateWochenrapport), danach eingefroren.
//
// Der Kunde kommt aus dem ERSTEN gebuchten Projekt der Woche (hauptprojekt_id).
// Eine Woche kann auf mehrere Kunden laufen — die Nummer bleibt trotzdem die
// des ersten, sonst wäre eine bereits vergebene Nummer nachträglich unstimmig.
//
// Der Zähler steht in gs_rapport_nummernkreis und wird über die SQL-Funktion
// gs_rapport_nr_next gezogen (INSERT … ON CONFLICT DO UPDATE = atomar, zwei
// parallel gespeicherte Wochen bekommen garantiert verschiedene Nummern).
// Löschen eines Rapports (ZIEL 2) fasst den Zähler NICHT an — eine Nummer wird
// nie wiederverwendet, die Lücke bleibt bewusst stehen.
// ═══════════════════════════════════════════════════════════════════════════
const RAPPORT_KUERZEL_FALLBACK = 'GSO'; // Kunde ohne gepflegtes Kürzel / kein Kunde

// Kunde + Kürzel zum Projekt. Beide Lesezugriffe einzeln abgesichert: fehlt die
// Spalte kuerzel noch (SQL nicht gelaufen), soll trotzdem die kunde_id ankommen.
async function kundeUndKuerzel(projektId) {
  if (!projektId) return { kundeId: null, kuerzel: null };
  let kundeId = null;
  try {
    const p = await sbGet(`gs_projekte?id=eq.${projektId}&select=kunde_id&limit=1`);
    kundeId = (p && p[0] && p[0].kunde_id) || null;
  } catch (_) { return { kundeId: null, kuerzel: null }; }
  if (!kundeId) return { kundeId: null, kuerzel: null };
  try {
    const k = await sbGet(`gs_kunden?id=eq.${kundeId}&select=kuerzel&limit=1`);
    return { kundeId, kuerzel: (k && k[0] && k[0].kuerzel) || null };
  } catch (_) { return { kundeId, kuerzel: null }; } // Spalte fehlt → Fallback-Kürzel
}

// Zieht die nächste Nummer. null = Nummernkreis noch nicht migriert → Aufrufer
// nimmt das Altformat. Wirft bewusst nie: eine fehlende Nummer darf das
// Speichern einer Tageszeile nicht verhindern.
async function zieheRapportNummer(kuerzel, jahr) {
  const k = String(kuerzel || RAPPORT_KUERZEL_FALLBACK).toUpperCase();
  try {
    const r = await sbWrite('POST', 'rpc/gs_rapport_nr_next', { p_kuerzel: k, p_jahr: jahr });
    const seq = Number(Array.isArray(r) ? r[0] : r);
    if (!Number.isFinite(seq) || seq < 1) return null;
    return { seq, nr: `R-${k}-${jahr}-${String(seq).padStart(4, '0')}` };
  } catch (_) { return null; }
}
// Strukturierte Material-Zeilen sanitisieren (Bezeichnung Pflicht, Menge optional).
function matPositionen(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => ({
    bezeichnung: String((x && x.bezeichnung) || '').slice(0, 200),
    menge: (x && x.menge != null && x.menge !== '') ? num(x.menge) : null,
  })).filter((x) => x.bezeichnung).slice(0, 100);
}
// Wochenkopf holen oder anlegen (UNIQUE techniker+jahr+woche). hauptprojekt_id
// nur beim ERSTEN Anlegen gesetzt (erstes bebuchtes Projekt der Woche).
// Nimmt technikerUserId/technikerId direkt entgegen (statt scope) — so kann sie
// auch der Master beim Verschieben einer Zeile auf einen ANDEREN Techniker
// wiederverwenden (pmWochenrapportMove), nicht nur der Techniker für sich selbst.
async function getOrCreateWochenrapport(technikerUserId, technikerId, jahr, woche, projektIdHint) {
  const find = () => sbGet(
    `gs_wochenrapporte?techniker_user_id=eq.${technikerUserId}&jahr=eq.${jahr}&woche=eq.${woche}&select=*&limit=1`,
  );
  const existing = await find().catch(() => []);
  if (existing && existing[0]) return existing[0];
  let name = 'Techniker';
  try {
    const t = await sbGet(`gs_techniker?id=eq.${technikerId}&select=name&limit=1`);
    if (t && t[0] && t[0].name) name = t[0].name;
  } catch (_) { /* egal, Fallback-Name */ }
  const row = {
    techniker_user_id: technikerUserId, jahr, woche,
    hauptprojekt_id: projektIdHint || null,
  };
  // ZIEL 3 — Nummer pro Kunde ziehen. Klappt das nicht (SQL noch nicht gelaufen),
  // bleibt es beim Altformat; der Rapport entsteht in jedem Fall.
  const { kundeId, kuerzel } = await kundeUndKuerzel(projektIdHint);
  const nummer = await zieheRapportNummer(kuerzel, jahr);
  if (nummer) {
    row.kunde_id = kundeId;
    row.rapport_seq = nummer.seq;
    row.rapport_nr = nummer.nr;
  } else {
    row.rapport_nr = rapportNrAlt(jahr, woche, name);
  }
  const post = async (r) => {
    const res = await sbWrite('POST', 'gs_wochenrapporte', r);
    return Array.isArray(res) ? res[0] : res;
  };
  try {
    return await post(row);
  } catch (e) {
    const msg = (e && e.message) || '';
    if (/duplicate key|23505/i.test(msg)) {
      // Race (zwei Zeilen derselben Woche parallel gespeichert) → nochmal lesen.
      // Die eben gezogene Nummer verfällt dabei — gewollt, Lücken sind erlaubt.
      const again = await find().catch(() => []);
      if (again && again[0]) return again[0];
    }
    // Nummernkreis migriert, aber die neuen Spalten auf gs_wochenrapporte fehlen
    // (halb gelaufenes SQL). Ohne sie erneut versuchen statt 500 zu werfen.
    if (/column|does not exist|PGRST204|schema cache/i.test(msg) && ('kunde_id' in row || 'rapport_seq' in row)) {
      const { kunde_id, rapport_seq, ...ohne } = row;
      ohne.rapport_nr = row.rapport_nr || rapportNrAlt(jahr, woche, name);
      try { return await post(ohne); } catch (e2) { if (isNoTable(e2)) return null; throw e2; }
    }
    if (isNoTable(e)) return null; // Migration fehlt noch — Tageszeile speichert trotzdem, nur ohne Kopf.
    throw e;
  }
}

// ZIEL 2 — 24h-Schreibfenster nach "Woche einreichen". Greift NUR im Techniker-
// Pfad (saveTechTag/delTechTag/Technik-Unterschrift) — der Master hat dafür die
// eigenständigen pm_wochenrapport_* Actions, die diese Funktion nie aufrufen.
function assertWochenSchreibbar(wr) {
  if (!wr) return; // Migration fehlt noch / kein Kopf → wie bisher, nichts blockieren
  if (wr.status === 'eingereicht' && wr.eingereicht_am) {
    const deadline = new Date(wr.eingereicht_am).getTime() + 24 * 60 * 60 * 1000;
    if (Date.now() > deadline) throw new Forbidden();
  }
}

// ZIEL 3 — Änderungsprotokoll. Schreibt VOR dem eigentlichen Eingriff, damit ein
// Fehler beim Log den Eingriff verhindert statt eine Lücke zu hinterlassen.
async function logWochenAenderung(scope, { wochenrapportId, tagesrapportId, aktion, feld, wertVorher }) {
  await sbWrite('POST', 'gs_wochenrapport_log', {
    wochenrapport_id: wochenrapportId || null,
    tagesrapport_id: tagesrapportId || null,
    aktion, feld: feld || null,
    wert_vorher: wertVorher != null ? wertVorher : null,
    geaendert_von: scope.userId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TÄTIGKEITSKATALOG (Runde B ZIEL 1) — antippbare Tätigkeiten statt Freitext.
// gs_taetigkeitenkatalog (Daten, Master pflegt) + gs_tagesrapport_taetigkeitenkatalog
// (Zuordnung, mehrere pro Zeile). bezeichnung_snapshot ist PFLICHT: Anzeige
// liest IMMER den Snapshot, nie den Katalog — Umbenennen/Deaktivieren im
// Katalog darf bereits erfasste Rapporte nie rückwirkend verändern.
// scripts/taetigkeiten_katalog.sql muss zuerst gelaufen sein.
// ═══════════════════════════════════════════════════════════════════════════

// Techniker-Ansicht: nur aktive, nicht-Service-Einträge (quelle_service=false
// bleibt im Wochenrapport ausgeblendet, greift automatisch sobald die Service-
// abteilung als zweite Quelle dazukommt) + eigene Nutzungshäufigkeit für
// "zuletzt verwendet"/"meistgenutzt" (Client sortiert damit innerhalb der
// Kategorie-Chips). Aggregation in JS, da PostgREST kein GROUP BY kann.
async function getTaetigkeitenKatalogTech(scope) {
  const katalog = await sbGet(
    'gs_taetigkeitenkatalog?aktiv=eq.true&quelle_service=eq.false&select=id,gewerk,slug,bezeichnung,kategorie,detailfelder,sortierung&order=gewerk.asc,kategorie.asc,sortierung.asc',
  ).catch((e) => { if (isNoTable(e)) return null; throw e; });
  if (katalog === null) return { notMigrated: true, items: [] };
  // ZIEL 6 (Feinschliff II) — für die Vorschlags-Chips zusätzlich mitzählen, auf
  // WELCHEN Projekten der Techniker eine Tätigkeit schon verwendet hat. Damit
  // kann der Client sekundär auf dasselbe Projekt gewichten. Kein neuer Zähler
  // in der DB: das kommt weiterhin aus den vorhandenen Zuordnungszeilen, nur mit
  // projekt_id im selben !inner-Embed — also ohne zusätzliche Abfrage.
  //
  // Nach Gewerk muss NICHT extra gruppiert werden: jede Katalogtätigkeit gehört
  // zu genau einem Gewerk, und der Picker zeigt ohnehin nur die des gewählten
  // Gewerks. Die Gewerk-Filterung passiert also schon durch die Auswahl selbst.
  const usage = {};
  try {
    const rows = await sbGet(
      `gs_tagesrapport_taetigkeitenkatalog?select=taetigkeit_id,created_at,tagesrapport:gs_tagesrapporte!inner(techniker_user_id,projekt_id)` +
      `&tagesrapport.techniker_user_id=eq.${scope.technikerUserId}&order=created_at.desc&limit=500`,
    );
    for (const r of rows) {
      if (!r.taetigkeit_id) continue;
      // order=created_at.desc → die erste gesehene Zeile ist zugleich die jüngste.
      if (!usage[r.taetigkeit_id]) usage[r.taetigkeit_id] = { anzahl: 0, zuletzt: r.created_at, projekte: {} };
      const u = usage[r.taetigkeit_id];
      u.anzahl += 1;
      const pid = r.tagesrapport && r.tagesrapport.projekt_id;
      if (pid) u.projekte[pid] = (u.projekte[pid] || 0) + 1;
    }
  } catch (_) { /* Nutzungsstatistik optional — Katalog funktioniert auch ohne */ }
  const items = katalog.map((k) => {
    const u = usage[k.id] || {};
    const out = {
      ...k,
      verwendet_anzahl: u.anzahl || 0,
      verwendet_zuletzt: u.zuletzt || null,
    };
    // Nur mitschicken, wenn es etwas zu sagen gibt — die grosse Mehrheit der
    // Katalogzeilen hat keine Historie, der Payload bleibt dadurch klein.
    if (u.projekte && Object.keys(u.projekte).length) out.verwendet_projekte = u.projekte;
    return out;
  });
  return { items };
}

// Master-Ansicht: ALLE Zeilen (auch inaktive) — Katalogpflege braucht die volle Liste.
async function pmTaetigkeitenKatalogListe() {
  const rows = await sbGet('gs_taetigkeitenkatalog?select=*&order=gewerk.asc,kategorie.asc,sortierung.asc')
    .catch((e) => { if (isNoTable(e)) return null; throw e; });
  if (rows === null) return { notMigrated: true, items: [] };
  return { items: rows };
}

function taetFelderAusBody(b) {
  return Array.isArray(b.felder) ? b.felder.filter((f) => TAET_DETAIL_CODES.has(String(f))) : [];
}

// Anlegen — slug wird NUR hier gesetzt, danach nie mehr geändert (siehe Update).
async function pmTaetigkeitenKatalogCreate(b) {
  const gewerk = String(b.gewerk || '').trim();
  if (!TAET_GEWERKE.has(gewerk)) throw new Error('ungültiges gewerk');
  const slug = String(b.slug || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!slug) throw new Error('slug nötig');
  const bezeichnung = String(b.bezeichnung || '').trim().slice(0, 200);
  if (!bezeichnung) throw new Error('bezeichnung nötig');
  const row = {
    gewerk, slug, bezeichnung,
    kategorie: String(b.kategorie || '').trim().slice(0, 100) || 'Allgemein',
    detailfelder: { felder: taetFelderAusBody(b) },
    sortierung: Number.isFinite(Number(b.sortierung)) ? Number(b.sortierung) : 999,
    quelle_service: !!b.quelle_service,
  };
  try {
    const r = await sbWrite('POST', 'gs_taetigkeitenkatalog', row);
    return { ok: true, row: Array.isArray(r) ? r[0] : r };
  } catch (e) {
    if (/duplicate key|23505/i.test((e && e.message) || '')) return { error: 'Dieser Slug existiert für dieses Gewerk bereits.' };
    if (isNoTable(e)) return { notMigrated: true };
    throw e;
  }
}

// Ändern — bezeichnung/kategorie/detailfelder/sortierung/quelle_service frei
// editierbar, gewerk/slug NIE (stabile Identität, siehe scripts/taetigkeiten_katalog.sql).
async function pmTaetigkeitenKatalogUpdate(b) {
  const id = uuid(b.id);
  const patch = {};
  if (b.bezeichnung !== undefined) patch.bezeichnung = String(b.bezeichnung).trim().slice(0, 200);
  if (b.kategorie !== undefined) patch.kategorie = String(b.kategorie).trim().slice(0, 100);
  if (b.sortierung !== undefined) patch.sortierung = Number(b.sortierung) || 0;
  if (b.felder !== undefined) patch.detailfelder = { felder: taetFelderAusBody(b) };
  if (b.quelle_service !== undefined) patch.quelle_service = !!b.quelle_service;
  if (!Object.keys(patch).length) return { error: 'nichts zu ändern' };
  try {
    const r = await sbWrite('PATCH', `gs_taetigkeitenkatalog?id=eq.${id}`, patch);
    return { ok: true, row: Array.isArray(r) ? r[0] : r };
  } catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}

// Deaktivieren/Aktivieren — NIE löschen (alte Rapporte referenzieren die id
// weiter über bezeichnung_snapshot/taetigkeit_id ON DELETE SET NULL).
async function pmTaetigkeitenKatalogToggle(b) {
  const id = uuid(b.id);
  let aktiv = b.aktiv;
  if (aktiv === undefined) {
    const cur = await sbGet(`gs_taetigkeitenkatalog?id=eq.${id}&select=aktiv&limit=1`).catch(() => []);
    if (!cur[0]) return { error: 'nicht gefunden' };
    aktiv = !cur[0].aktiv;
  }
  try {
    const r = await sbWrite('PATCH', `gs_taetigkeitenkatalog?id=eq.${id}`, { aktiv: !!aktiv });
    return { ok: true, row: Array.isArray(r) ? r[0] : r };
  } catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}

// ═══════════════════════════════════════════════════════════════════════════
// ZIEL 8e (Feinschliff II) — Entscheidungsprotokoll der Katalog-Anlage.
// Jeder Durchlauf des Anlegen-Dialogs schreibt GENAU EINE Zeile, auch der
// Abbruch: wer den Dialog wegklickt, hat etwas gesucht und nicht gefunden.
// Genau das ist das interessante Signal über die Qualität der Vorschläge.
//
// Wirft nie: ein fehlgeschlagenes Protokoll darf das Anlegen nicht blockieren.
// Der Client feuert das absichtlich "nebenher" ab.
// ═══════════════════════════════════════════════════════════════════════════
const KATALOG_ENTSCHEIDUNGEN = new Set(['neu_angelegt', 'bestehende_gewaehlt', 'reaktiviert', 'abgebrochen']);

async function pmKatalogEntscheidungLog(b, scope) {
  const entscheidung = String(b.entscheidung || '');
  if (!KATALOG_ENTSCHEIDUNGEN.has(entscheidung)) return { error: 'ungültige entscheidung' };
  // Nur die angezeigten Vorschläge, auf das Wesentliche gekürzt — das ist ein
  // Snapshot des Moments, nicht ein Verweis auf den heutigen Katalogstand.
  const vorschlaege = Array.isArray(b.vorgeschlagene_aehnliche)
    ? b.vorgeschlagene_aehnliche.slice(0, 20).map((v) => ({
      slug: String((v && v.slug) || '').slice(0, 80),
      gewerk: String((v && v.gewerk) || '').slice(0, 40),
      kategorie: String((v && v.kategorie) || '').slice(0, 100),
      score: Number.isFinite(Number(v && v.score)) ? Math.round(Number(v.score) * 100) / 100 : null,
      aktiv: !!(v && v.aktiv),
    }))
    : [];
  const row = {
    neue_taetigkeit_id: (b.neue_taetigkeit_id && UUID_RE.test(String(b.neue_taetigkeit_id))) ? b.neue_taetigkeit_id : null,
    gewaehlte_taetigkeit_id: (b.gewaehlte_taetigkeit_id && UUID_RE.test(String(b.gewaehlte_taetigkeit_id))) ? b.gewaehlte_taetigkeit_id : null,
    vorgeschlagene_aehnliche: vorschlaege,
    entscheidung,
    eingabe_bezeichnung: b.eingabe_bezeichnung ? String(b.eingabe_bezeichnung).slice(0, 200) : null,
    eingabe_gewerk: b.eingabe_gewerk ? String(b.eingabe_gewerk).slice(0, 40) : null,
    entschieden_von: scope.userId,
  };
  try {
    await sbWrite('POST', 'gs_katalog_entscheidung', row, 'return=minimal');
    return { ok: true };
  } catch (e) {
    if (isNoTable(e)) return { notMigrated: true };
    return { ok: false }; // still schlucken — Protokoll darf nie blockieren
  }
}

// Für mehrere Tagesrapporte auf einmal die gewählten Tätigkeiten nachladen
// (Wochenansicht Techniker + Master). "felder" kommt per Embed aus dem AKTUELLEN
// Katalog-Eintrag (für die Bearbeitung); die Anzeige selbst nutzt immer
// bezeichnung_snapshot, nie taetigkeit.bezeichnung.
async function loadTaetigkeitenFuerTagesrapporte(ids) {
  if (!ids || !ids.length) return {};
  const rows = await sbGet(
    `gs_tagesrapport_taetigkeitenkatalog?tagesrapport_id=in.(${ids.join(',')})` +
    '&select=id,tagesrapport_id,taetigkeit_id,bezeichnung_snapshot,details,sortierung,taetigkeit:gs_taetigkeitenkatalog(detailfelder)' +
    '&order=sortierung.asc',
  ).catch(() => []);
  const map = {};
  for (const r of rows) {
    const felder = (r.taetigkeit && r.taetigkeit.detailfelder && r.taetigkeit.detailfelder.felder) || [];
    if (!map[r.tagesrapport_id]) map[r.tagesrapport_id] = [];
    map[r.tagesrapport_id].push({
      id: r.id, taetigkeit_id: r.taetigkeit_id, bezeichnung_snapshot: r.bezeichnung_snapshot,
      details: r.details || {}, sortierung: r.sortierung, felder,
    });
  }
  return map;
}

// Ersetzt die Auswahl komplett (delete+insert) — die Reihenfolge/Auswahl kommt
// bei jedem Speichern neu vom Client. undefined (z.B. Abwesenheits-Zeile) lässt
// bestehende Zuordnungen unangetastet; [] löscht sie bewusst.
async function syncTagesrapportTaetigkeiten(tagesrapportId, list) {
  if (!Array.isArray(list)) return;
  await sbWrite('DELETE', `gs_tagesrapport_taetigkeitenkatalog?tagesrapport_id=eq.${tagesrapportId}`, {}, 'return=minimal').catch(() => {});
  const rows = list
    .filter((t) => t && String(t.bezeichnung_snapshot || '').trim())
    .slice(0, 40)
    .map((t, i) => ({
      tagesrapport_id: tagesrapportId,
      taetigkeit_id: (t.taetigkeit_id && UUID_RE.test(String(t.taetigkeit_id))) ? t.taetigkeit_id : null,
      bezeichnung_snapshot: String(t.bezeichnung_snapshot).slice(0, 200),
      details: (t.details && typeof t.details === 'object') ? t.details : {},
      sortierung: Number.isFinite(Number(t.sortierung)) ? Number(t.sortierung) : (i + 1) * 10,
    }));
  if (rows.length) await sbWrite('POST', 'gs_tagesrapport_taetigkeitenkatalog', rows);
}

// Eine Tageszeile speichern: Arbeitstag (Projekt/Service + Stunden) ODER
// Abwesenheit (G/F/M/U/A, kein Projekt). KW/Jahr kommen aus dem GEBUCHTEN
// Datum, nicht "heute" → Rückdatierung landet im richtigen Wochenkopf.
async function saveTechTag(b, scope) {
  // Jahresschranke VOR allem anderen: eine Zeile mit Jahr 2099 soll gar nicht
  // erst einen Wochenkopf anlegen (lib/datum.js).
  // `return`, kein `throw`: geworfene Fehler kommen beim Techniker als nacktes
  // „Serverfehler" an (siehe Dispatcher). Beides hier sind Aussagen ueber seine
  // Eingabe — die muss er lesen koennen.
  const dp = pruefeTagesdatum(b.datum);
  if (!dp.ok) return { error: dp.error };
  const datum = dp.datum;
  const abwesenheit = b.abwesenheit ? String(b.abwesenheit).toUpperCase() : null;
  if (abwesenheit && !ABWESENHEIT_CODES.has(abwesenheit)) {
    return {
      error: 'Unbekannte Abwesenheit "' + abwesenheit + '". Zulässig: '
        + ABWESENHEIT_KATALOG.map((x) => x.code).join(', ') + '.',
    };
  }

  const row = { techniker_user_id: scope.technikerUserId };
  let projektIdForHeader = null;

  if (abwesenheit) {
    row.abwesenheit = abwesenheit;
    row.abwesenheit_grund = b.abwesenheit_grund ? String(b.abwesenheit_grund).slice(0, 500) : null;
    row.projekt_id = null;
    row.service_auftrag_id = null;
  } else {
    row.abwesenheit = null;
    row.abwesenheit_grund = null;
    if (b.service_auftrag_id) {
      row.service_auftrag_id = await assertServiceAccess(b.service_auftrag_id, scope, true);
      row.projekt_id = null;
    } else {
      await requireAssignedProjekt(b.projekt_id, scope);
      row.projekt_id = uuid(b.projekt_id);
      row.service_auftrag_id = null;
      projektIdForHeader = row.projekt_id;
    }
  }

  // Stunden: direkt ODER aus Start/Ende gerechnet (Client rechnet meist schon vor,
  // Server rechnet nach falls nur Start/Ende ankommen).
  let stunden = (b.stunden != null && b.stunden !== '') ? num(b.stunden) : null;
  const start_zeit = /^\d{2}:\d{2}/.test(b.start_zeit || '') ? String(b.start_zeit).slice(0, 5) : null;
  const end_zeit = /^\d{2}:\d{2}/.test(b.end_zeit || '') ? String(b.end_zeit).slice(0, 5) : null;
  if (stunden == null && start_zeit && end_zeit) {
    const [sh, sm] = start_zeit.split(':').map(Number);
    const [eh, em] = end_zeit.split(':').map(Number);
    const diff = (eh * 60 + em) - (sh * 60 + sm);
    stunden = diff > 0 ? Math.round((diff / 60) * 100) / 100 : 0;
  }

  const { woche, jahr } = isoWeekJahr(datum);
  const heute = new Date().toISOString().slice(0, 10);
  const wr = await getOrCreateWochenrapport(scope.technikerUserId, scope.technikerId, jahr, woche, projektIdForHeader);
  assertWochenSchreibbar(wr); // ZIEL 2: nach Ablauf des 24h-Fensters gesperrt (Master ausgenommen, s.o.)

  // ZIEL 1 — Pause in Minuten (Client rechnet Stunden↔Minuten um), Manuell-Flag
  // (Std-Feld weicht von Start/Ende-Pause-Berechnung ab), freie Projektnummer.
  const pause_minuten = (b.pause_minuten != null && b.pause_minuten !== '') ? num(b.pause_minuten) : null;
  const stunden_manuell = !!b.stunden_manuell;
  const projektnummer_erfasst = b.projektnummer_erfasst ? String(b.projektnummer_erfasst).slice(0, 60) : null;

  Object.assign(row, {
    datum,
    wochenrapport_id: wr ? wr.id : null,
    gesamtstunden: stunden != null ? stunden : 0,
    // Überzeit getrennt nach Zuschlag (25/50/100%) — Normalstunden bleiben in gesamtstunden.
    ueberzeit_25: (b.uz25 != null && b.uz25 !== '') ? num(b.uz25) : 0,
    ueberzeit_50: (b.uz50 != null && b.uz50 !== '') ? num(b.uz50) : 0,
    ueberzeit_100: (b.uz100 != null && b.uz100 !== '') ? num(b.uz100) : 0,
    pause_minuten, stunden_manuell, projektnummer_erfasst,
    taetigkeit: GEWERK_OPTIONS.has(b.taetigkeit) ? b.taetigkeit : null,
    spesen: (b.spesen != null && b.spesen !== '') ? num(b.spesen) : 0,
    arbeiten: toStrArr(b.arbeiten),
    besonderheiten: b.notiz ? String(b.notiz).slice(0, 2000) : null,
    status: b.status === 'entwurf' ? 'entwurf' : 'eingereicht',
    woche, jahr,
    erfasst_von: scope.technikerUserId,
    rueckwirkend: datum < heute,
  });

  // MATERIAL — nur schreiben, wenn der Client es tatsächlich mitgeschickt hat.
  //
  // Das Wochenblatt-Formular hat heute kein Materialfeld: tcCollectRow() in
  // app.html sendet weder `material` noch `material_positionen`. Vorher standen
  // beide Felder unbedingt im row-Objekt, also schrieb JEDES Speichern (auch der
  // Autosave) hart '{}' und '[]' zurück — und löschte damit still, was im
  // Arbeitsrapport an derselben Zeile erfasst worden war. Das ist Datenverlust,
  // kein fehlendes Feature.
  //
  // Ein PATCH ohne den Schlüssel lässt die Spalte unangetastet; ein INSERT ohne
  // den Schlüssel nimmt den DB-Default ('{}' bzw. '[]'). `undefined` heisst also
  // „nicht anfassen", ein ausdrücklich gesendetes leeres Array heisst weiterhin
  // „leeren" — das bleibt möglich, sobald die Materialerfassung gebaut wird.
  if (b.material !== undefined) row.material = toStrArr(b.material);
  if (b.material_positionen !== undefined) row.material_positionen = matPositionen(b.material_positionen);

  // START/ENDE — gleiche Wache wie beim Material, aber eine Stufe schärfer.
  //
  // Vorher standen start_zeit/end_zeit unbedingt im row-Objekt. Das Wochenblatt
  // sendet die Felder IMMER mit (tcCollectRow → '.f-start'.value || ''), also
  // schrieb jeder Autosave bei leerem Eingabefeld hart null zurück und löschte
  // damit bereits erfasste Zeiten. Genau so ist KW30/NIE entstanden: Montag mit
  // Zeiten, Di–Fr ohne, obwohl überall 8.00 Std stehen.
  //
  // Deshalb gilt hier: leer ODER nicht gesendet = „nicht anfassen". Ein PATCH
  // ohne (bzw. mit leeren) Zeitfeldern lässt die gespeicherten Werte stehen; ein
  // INSERT ohne den Schlüssel nimmt den DB-Default (NULL). Zeiten korrigieren
  // geht weiterhin durch Senden eines gültigen HH:MM, Leeren nur über die
  // Master-Korrektur (pmWochenrapportUpdate).
  if (start_zeit) row.start_zeit = start_zeit;
  if (end_zeit) row.end_zeit = end_zeit;

  const notMigratedErr = (e) => /column|does not exist|PGRST204|schema cache/i.test((e && e.message) || '');

  // ZIEL 1 (Runde B) — Tätigkeiten-Katalog gehört zur Zeile, wird bei jedem
  // Speichern komplett ersetzt (delete+insert) und dem Antwort-Row angehängt,
  // damit der Client sie sofort hat, ohne die Woche neu zu laden.
  const finishSave = async (savedRow) => {
    const saved = Array.isArray(savedRow) ? savedRow[0] : savedRow;
    if (saved && saved.id) {
      await syncTagesrapportTaetigkeiten(saved.id, b.taetigkeiten);
      saved.taetigkeiten = Array.isArray(b.taetigkeiten)
        ? b.taetigkeiten.filter((t) => t && String(t.bezeichnung_snapshot || '').trim()).map((t, i) => ({
          taetigkeit_id: t.taetigkeit_id || null,
          bezeichnung_snapshot: String(t.bezeichnung_snapshot).slice(0, 200),
          details: (t.details && typeof t.details === 'object') ? t.details : {},
          sortierung: Number.isFinite(Number(t.sortierung)) ? Number(t.sortierung) : (i + 1) * 10,
        }))
        : [];
    }
    return { ok: true, row: saved };
  };

  // Bestehende Zeile bearbeiten (id mitgeschickt, Eigentum geprüft).
  if (b.id) {
    const own = await sbGet(`gs_tagesrapporte?id=eq.${uuid(b.id)}&select=id,techniker_user_id&limit=1`).catch(() => []);
    if (!own[0] || own[0].techniker_user_id !== scope.technikerUserId) throw new Forbidden();
    try {
      const r = await sbWrite('PATCH', `gs_tagesrapporte?id=eq.${uuid(b.id)}`, row);
      return await finishSave(r);
    } catch (e) {
      if (/duplicate key|23505|conflict/i.test((e && e.message) || '')) {
        return { error: 'Für diesen Tag/Projekt existiert bereits eine andere Zeile.' };
      }
      const t = tagKonfliktText(pgCode(e), { projektbezogen: !!row.projekt_id, neuerAbwesenheitsgrund: !!abwesenheit });
      if (t) return { error: t };
      if (notMigratedErr(e)) return { notMigrated: true, error: 'Wochenrapport-Tabellen noch nicht vollständig migriert – scripts/wochenrapport_migration.sql und scripts/wochenrapport_ueberzeit.sql ausführen.' };
      throw e;
    }
  }

  // Neue Zeile. UNIQUE(projekt/service, techniker, datum) kann kollidieren, wenn
  // für diesen Tag/Projekt schon eine Zeile existiert.
  //
  // Früher wurde die bestehende Zeile in dem Fall still überschrieben und ihre id
  // an den Client zurückgegeben. Der Client hat diese fremde id auf die neue
  // Bildschirmzeile gestempelt — ab da zeigten zwei sichtbare Einträge auf
  // denselben Satz und haben sich bei jedem Autosave gegenseitig ausradiert.
  // Erfasste Arbeit ist damit spurlos verschwunden.
  //
  // Jetzt wird der Konflikt gemeldet, statt fremde Daten anzufassen — dasselbe
  // Verhalten wie im PATCH-Zweig oben, der das immer schon richtig gemacht hat.
  try {
    const r = await sbWrite('POST', 'gs_tagesrapporte', row);
    return await finishSave(r);
  } catch (e) {
    if (/duplicate key|23505|conflict/i.test((e && e.message) || '')) {
      // Klartext für den Techniker: was kollidiert, dass nichts überschrieben
      // wurde, und was er tun kann. Keine ids, keine Tabellen-/Spaltennamen.
      if (row.service_auftrag_id) {
        return { error: 'Für diesen Serviceauftrag besteht an diesem Tag bereits ein Eintrag. Er wurde nicht überschrieben — bitte den bestehenden Eintrag ergänzen oder einen anderen Auftrag wählen.' };
      }
      if (row.projekt_id) {
        return { error: 'Für dieses Projekt besteht an diesem Tag bereits ein Eintrag. Er wurde nicht überschrieben — bitte den bestehenden Eintrag ergänzen oder ein anderes Projekt wählen.' };
      }
      return { error: 'Für diesen Tag besteht bereits ein Eintrag. Er wurde nicht überschrieben.' };
    }
    const t = tagKonfliktText(pgCode(e), { projektbezogen: !!row.projekt_id, neuerAbwesenheitsgrund: !!abwesenheit });
    if (t) return { error: t };
    if (notMigratedErr(e)) return { notMigrated: true, error: 'Wochenrapport-Tabellen noch nicht vollständig migriert – scripts/wochenrapport_migration.sql und scripts/wochenrapport_ueberzeit.sql ausführen.' };
    throw e;
  }
}

async function delTechTag(b, scope) {
  const id = uuid(b.id);
  const rows = await sbGet(`gs_tagesrapporte?id=eq.${id}&select=id,techniker_user_id,wochenrapport_id&limit=1`).catch(() => []);
  if (!rows[0] || rows[0].techniker_user_id !== scope.technikerUserId) throw new Forbidden();
  if (rows[0].wochenrapport_id) {
    const wr = await sbGet(`gs_wochenrapporte?id=eq.${rows[0].wochenrapport_id}&select=status,eingereicht_am&limit=1`).catch(() => []);
    assertWochenSchreibbar(wr && wr[0]);
  }
  await sbWrite('DELETE', `gs_tagesrapporte?id=eq.${id}`, {}, 'return=minimal');
  return { ok: true };
}

// ZIEL 2 — "Woche einreichen": setzt status/eingereicht_am auf dem EIGENEN Kopf.
// Ab hier läuft das 24h-Fenster (assertWochenSchreibbar in saveTechTag/delTechTag/
// Technik-Unterschrift). Erneutes Einreichen (z.B. nach einer Korrektur innerhalb
// des Fensters) setzt den Zeitpunkt bewusst neu — verlängert das eigene Fenster.
async function einreichenWoche(b, scope) {
  const jahr = parseInt(b.jahr, 10);
  const woche = parseInt(b.woche, 10);
  if (!jahr || !woche) throw new Error('jahr/woche nötig');
  const rows = await sbGet(`gs_wochenrapporte?techniker_user_id=eq.${scope.technikerUserId}&jahr=eq.${jahr}&woche=eq.${woche}&select=id,unterschrift_technik_path&limit=1`)
    .catch((e) => { if (isNoTable(e)) return null; throw e; });
  if (rows === null) return { notMigrated: true };
  if (!rows[0]) return { error: 'Noch keine Zeile für diese Woche erfasst.' };
  // ZIEL 1 (Runde A2) — ohne Technik-Unterschrift kein Einreichen. Kunde bleibt
  // optional ('folgt' + Grund ist ein gültiger, dauerhafter Zustand).
  if (!rows[0].unterschrift_technik_path) return { error: 'Bitte zuerst mit der Technik-Unterschrift bestätigen.' };
  const r = await sbWrite('PATCH', `gs_wochenrapporte?id=eq.${rows[0].id}`, {
    status: 'eingereicht', eingereicht_am: new Date().toISOString(),
  });
  return { ok: true, kopf: Array.isArray(r) ? r[0] : r };
}

// ZIEL 2 — Unterschrift speichern (Storage-Bucket, Pfad unterschriften/<wochenrapport_id>/).
// Technik-Unterschrift: eigene, unterliegt der 24h-Sperre wie der Rest der Woche.
// Kunde-Unterschrift: bewusst OHNE Sperre — "Unterschrift folgt" darf auch nach
// Ablauf des Fensters nachgezogen werden (Papierform-Realität: Kunde unterschreibt
// oft erst Tage später).
async function saveWochenUnterschrift(b, scope) {
  const jahr = parseInt(b.jahr, 10);
  const woche = parseInt(b.woche, 10);
  const wer = b.wer === 'kunde' ? 'kunde' : 'technik';
  if (!jahr || !woche) throw new Error('jahr/woche nötig');
  const rows = await sbGet(`gs_wochenrapporte?techniker_user_id=eq.${scope.technikerUserId}&jahr=eq.${jahr}&woche=eq.${woche}&select=*&limit=1`)
    .catch((e) => { if (isNoTable(e)) return null; throw e; });
  if (rows === null) return { notMigrated: true };
  const kopf = rows[0];
  if (!kopf) return { error: 'Noch keine Zeile für diese Woche erfasst.' };
  if (wer === 'technik') assertWochenSchreibbar(kopf);

  const patch = {};
  if (wer === 'kunde' && b.status === 'folgt') {
    // Kein Bild — nur Status + Grund, später nachziehbar.
    Object.assign(patch, {
      unterschrift_kunde_status: 'folgt',
      unterschrift_kunde_grund: b.grund ? String(b.grund).slice(0, 500) : null,
      unterschrift_kunde_name: b.name ? String(b.name).slice(0, 120) : null,
      unterschrift_kunde_funktion: b.funktion ? String(b.funktion).slice(0, 120) : null,
    });
  } else {
    const buf = sbDecodeB64(b.data);
    if (!buf) return { error: 'Unterschrift (Bild) erforderlich' };
    if (buf.length > 2 * 1024 * 1024) return { error: 'Unterschrift zu gross' };
    const path = `unterschriften/${kopf.id}/${wer}.png`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${PM_DATEI_BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'image/png', 'x-upsert': 'true' },
      body: buf,
    });
    if (!up.ok) {
      const t = await up.text().catch(() => '');
      if (/bucket not found/i.test(t)) return { error: `Bucket '${PM_DATEI_BUCKET}' fehlt.`, notMigrated: true };
      console.error('wochen unterschrift upload fail', up.status, t);
      return { error: 'Upload fehlgeschlagen' };
    }
    const nowIso = new Date().toISOString();
    if (wer === 'technik') {
      let name = b.name ? String(b.name).slice(0, 120) : null;
      if (!name) {
        try {
          const t = await sbGet(`gs_techniker?id=eq.${scope.technikerId}&select=name&limit=1`);
          if (t && t[0] && t[0].name) name = t[0].name;
        } catch (_) { /* egal */ }
      }
      Object.assign(patch, { unterschrift_technik_path: path, unterschrift_technik_at: nowIso, unterschrift_technik_name: name });
    } else {
      Object.assign(patch, {
        unterschrift_kunde_path: path, unterschrift_kunde_at: nowIso,
        unterschrift_kunde_name: b.name ? String(b.name).slice(0, 120) : null,
        unterschrift_kunde_funktion: b.funktion ? String(b.funktion).slice(0, 120) : null,
        unterschrift_kunde_status: 'signiert', unterschrift_kunde_grund: null,
      });
    }
  }
  const r = await sbWrite('PATCH', `gs_wochenrapporte?id=eq.${kopf.id}`, patch);
  return { ok: true, kopf: Array.isArray(r) ? r[0] : r };
}

// Ein Wochenrapport (Kopf + Zeilen + Summen) für eine konkrete KW des eingeloggten
// Technikers. Projekt-Namen werden für die Zeilen nachgeladen (Baustelle/Kunde-Anzeige).
// ═══════════════════════════════════════════════════════════════════════════
// Spesen je KALENDERTAG, nicht je Tageszeile
// ═══════════════════════════════════════════════════════════════════════════
// Regel des Betreibers: Stunden werden je Tag ADDIERT, Spesen fallen je Tag
// EINMAL an — unabhaengig davon, auf wie vielen Baustellen gearbeitet wurde.
//
// gs_tagesrapporte fuehrt spesen aber je ZEILE, und das Wochenblatt bietet das
// Spesenfeld auf jeder Zeile an. KW 34 traegt deshalb 8 x CHF 30 = 240.00,
// obwohl an nur 5 Kalendertagen gearbeitet wurde (Soll 150.00).
//
// Genommen wird je Tag der HOECHSTE Wert. Nicht die Summe (das ist der Fehler),
// nicht die erste Zeile (die Reihenfolge ist nicht zugesichert).
// Zeilen ohne datum koennen nicht zugeordnet werden und zaehlen einzeln —
// besser sichtbar zu viel als still verschluckt.
function spesenJeTag(zeilen) {
  const proTag = {};
  let ohneDatum = 0;
  for (const z of zeilen || []) {
    const v = Number(z.spesen || 0);
    if (!z.datum) { ohneDatum += v; continue; }
    if (!(z.datum in proTag) || v > proTag[z.datum]) proTag[z.datum] = v;
  }
  const summe = Object.values(proTag).reduce((a, v) => a + v, 0) + ohneDatum;
  return Math.round(summe * 100) / 100;
}

async function getTechWochenRapport(b, scope) {
  const jahr = parseInt(b.jahr, 10);
  const woche = parseInt(b.woche, 10);
  if (!jahr || !woche) throw new Error('jahr/woche nötig');
  const wrRows = await sbGet(
    `gs_wochenrapporte?techniker_user_id=eq.${scope.technikerUserId}&jahr=eq.${jahr}&woche=eq.${woche}&select=*&limit=1`,
  ).catch((e) => { if (isNoTable(e)) return null; throw e; });
  if (wrRows === null) {
    return {
      notMigrated: true, kopf: { jahr, woche }, zeilen: [],
      total_stunden: 0, total_uz25: 0, total_uz50: 0, total_uz100: 0, total_spesen: 0,
    };
  }
  const kopf = (wrRows && wrRows[0]) || null;
  let zeilen = [];
  if (kopf) {
    zeilen = await sbGet(
      `gs_tagesrapporte?wochenrapport_id=eq.${kopf.id}&techniker_user_id=eq.${scope.technikerUserId}` +
      `&select=id,datum,projekt_id,service_auftrag_id,taetigkeit,start_zeit,end_zeit,pause_minuten,` +
      `stunden_manuell,projektnummer_erfasst,gesamtstunden,` +
      `ueberzeit_25,ueberzeit_50,ueberzeit_100,spesen,` +
      `abwesenheit,abwesenheit_grund,material,material_positionen,arbeiten,besonderheiten,status&order=datum.asc`,
    ).catch(() => []);
  }
  const projektIds = [...new Set([...zeilen.map((z) => z.projekt_id), kopf && kopf.hauptprojekt_id].filter(Boolean))];
  let projMap = {};
  if (projektIds.length) {
    const pr = await sbGet(`gs_projekte?id=in.(${projektIds.join(',')})&select=id,name,projektnummer,standort,kunde_id`).catch(() => []);
    for (const p of pr) projMap[p.id] = p;
  }
  // Kunde/Firma fürs Kopf-Anzeige-Feld (Hauptprojekt → gs_kunden.firma) — Parität mit Master-Ansicht.
  let hauptKundeName = null;
  const hauptKundeId = kopf && kopf.hauptprojekt_id && (projMap[kopf.hauptprojekt_id] || {}).kunde_id;
  if (hauptKundeId) {
    try {
      const kd = await sbGet(`gs_kunden?id=eq.${hauptKundeId}&select=firma&limit=1`);
      if (kd && kd[0]) hauptKundeName = kd[0].firma;
    } catch (_) { /* egal */ }
  }
  const serviceIds = [...new Set(zeilen.map((z) => z.service_auftrag_id).filter(Boolean))];
  let svcMap = {};
  if (serviceIds.length) {
    const sv = await sbGet(`gs_service_auftrag?id=in.(${serviceIds.join(',')})&select=id,objekt,auftragsnummer`).catch(() => []);
    for (const s of sv) svcMap[s.id] = s;
  }
  const taetMap = await loadTaetigkeitenFuerTagesrapporte(zeilen.map((z) => z.id));
  // ZIEL 1 (Feinschliff II) — Anzahl Fotos je Tageszeile. Nur dafür da, dass die
  // Rückgängig-Pille beim Löschen ehrlich sagen kann, dass die Fotos am Projekt
  // bleiben und nicht mehr am Tag hängen (gs_projekt_medien.tagesrapport_id ist
  // ON DELETE SET NULL). Eine Abfrage für die ganze Woche, in JS gezählt —
  // PostgREST kann kein GROUP BY.
  const medienZahl = {};
  const zIds = zeilen.map((z) => z.id).filter(Boolean);
  if (zIds.length) {
    const m = await sbGet(`gs_projekt_medien?tagesrapport_id=in.(${zIds.join(',')})&select=tagesrapport_id`).catch(() => []);
    for (const x of m) medienZahl[x.tagesrapport_id] = (medienZahl[x.tagesrapport_id] || 0) + 1;
  }
  const zeilenOut = zeilen.map((z) => ({
    ...z,
    projekt_name: z.projekt_id ? (projMap[z.projekt_id] || {}).name || null : null,
    projektnummer: z.projekt_id ? (projMap[z.projekt_id] || {}).projektnummer || null : null,
    standort: z.projekt_id ? (projMap[z.projekt_id] || {}).standort || null : null,
    service_objekt: z.service_auftrag_id ? (svcMap[z.service_auftrag_id] || {}).objekt || null : null,
    taetigkeiten: taetMap[z.id] || [],
    medien_anzahl: medienZahl[z.id] || 0,
  }));
  // Abwesenheitszeilen fliessen NICHT in die Normalstunden. Sie stehen in
  // derselben Spalte (gesamtstunden), sind aber keine geleistete Arbeit — eine
  // Woche mit drei Krankheitstagen darf nicht als voll gearbeitet im Fuss
  // stehen. Sie laufen getrennt in total_abwesenheit_stunden.
  const sum = (key) => Math.round(zeilen.filter((z) => !z.abwesenheit)
    .reduce((s, z) => s + Number(z[key] || 0), 0) * 100) / 100;
  return {
    kopf: kopf ? {
      ...kopf,
      hauptprojekt_name: kopf.hauptprojekt_id ? (projMap[kopf.hauptprojekt_id] || {}).name || null : null,
      hauptkunde_name: hauptKundeName,
      // ZIEL 2 — Unterschriftsbilder signiert ausliefern (Bucket ist nicht public).
      unterschrift_technik_url: kopf.unterschrift_technik_path ? await sbSignUrl(PM_DATEI_BUCKET, kopf.unterschrift_technik_path).catch(() => null) : null,
      unterschrift_kunde_url: kopf.unterschrift_kunde_path ? await sbSignUrl(PM_DATEI_BUCKET, kopf.unterschrift_kunde_path).catch(() => null) : null,
    } : { jahr, woche },
    zeilen: zeilenOut,
    total_stunden: sum('gesamtstunden'),
    total_uz25: sum('ueberzeit_25'),
    total_uz50: sum('ueberzeit_50'),
    total_uz100: sum('ueberzeit_100'),
    total_spesen: spesenJeTag(zeilen),
    total_abwesenheit_stunden: trenneStunden(zeilen).abwesenheit_stunden,
    abwesenheit_bloecke: abwesenheitBloecke(zeilen),
    // Katalog mitliefern, damit das Auswahlfeld in app.html nicht von einer
    // eigenen, veraltenden Liste lebt (siehe lib/abwesenheit.js).
    abwesenheit_katalog: ABWESENHEIT_KATALOG,
  };
}

// Liste der eigenen Wochenrapporte (Navigation "meine Wochen").
// ZIEL 2 (Runde A2) — eigene Wochenliste für den Techniker-Reiter "Rapport"
// (bisher gebaut, aber nie vom Client aufgerufen). Summen + Unterschrift-Status
// dazu, damit die Liste ohne Klick pro Zeile schon Status/Std/Spesen zeigt —
// gleiches Summen-Muster wie pmWochenrapporteListe (Master-Seite).
async function getTechWochenListe(scope) {
  const rows = await sbGet(
    `gs_wochenrapporte?techniker_user_id=eq.${scope.technikerUserId}&select=id,jahr,woche,rapport_nr,status,eingereicht_am,hauptprojekt_id,unterschrift_technik_path,unterschrift_kunde_status&order=jahr.desc,woche.desc&limit=52`,
  ).catch((e) => { if (isNoTable(e)) return null; throw e; });
  if (rows === null) return { notMigrated: true, wochen: [] };
  const ids = rows.map((r) => r.id);
  let sums = {};
  if (ids.length) {
    // `datum` muss mit in den Select: ohne das laesst sich die Spesenregel
    // (einmal je Kalendertag) gar nicht anwenden.
    // `abwesenheit` muss mit in den Select: Abwesenheitsstunden gehoeren nicht
    // in die Wochensumme, die in der Liste als "x h" steht.
    const zeilen = await sbGet(`gs_tagesrapporte?wochenrapport_id=in.(${ids.join(',')})&select=wochenrapport_id,datum,gesamtstunden,spesen,abwesenheit`).catch(() => []);
    for (const z of zeilen) {
      const s = sums[z.wochenrapport_id] || (sums[z.wochenrapport_id] = { stunden: 0, abwesend: 0, zeilen: [] });
      if (z.abwesenheit) s.abwesend += Number(z.gesamtstunden || 0);
      else s.stunden += Number(z.gesamtstunden || 0);
      s.zeilen.push(z);                       // Spesen erst am Ende je Tag verdichten
    }
  }
  return {
    wochen: rows.map((r) => ({
      ...r,
      total_stunden: Math.round(((sums[r.id] || {}).stunden || 0) * 100) / 100,
      total_abwesenheit_stunden: Math.round(((sums[r.id] || {}).abwesend || 0) * 100) / 100,
      total_spesen: spesenJeTag((sums[r.id] || {}).zeilen || []),
    })),
  };
}

// ── Master: Wochenrapporte ALLER Techniker, projektübergreifend ────────────
async function pmWochenrapporteListe() {
  const rows = await sbGet(`gs_wochenrapporte?select=*&order=jahr.desc,woche.desc&limit=200`)
    .catch((e) => { if (isNoTable(e)) return null; throw e; });
  if (rows === null) return { notMigrated: true, wochen: [] };
  const uids = [...new Set(rows.map((r) => r.techniker_user_id).filter(Boolean))];
  let nameMap = {};
  if (uids.length) {
    const ts = await sbGet(`gs_techniker?user_id=in.(${uids.join(',')})&select=user_id,name`).catch(() => []);
    for (const t of ts) nameMap[t.user_id] = t.name;
  }
  const wrIds = rows.map((r) => r.id);
  let sums = {};
  const projIdsJeWoche = {};                    // wochenrapport_id → Set(projekt_id)
  if (wrIds.length) {
    // `datum` muss mit in den Select — siehe spesenJeTag().
    // `abwesenheit` muss mit in den Select — Abwesenheitsstunden laufen
    // getrennt und stehen nicht in der Wochensumme (lib/abwesenheit.js).
    const zeilen = await sbGet(`gs_tagesrapporte?wochenrapport_id=in.(${wrIds.join(',')})&select=wochenrapport_id,datum,gesamtstunden,spesen,projekt_id,abrechnung_status,abwesenheit`).catch(() => []);
    for (const z of zeilen) {
      const s = sums[z.wochenrapport_id] || (sums[z.wochenrapport_id] = { stunden: 0, abwesend: 0, zeilen: [], offen: 0, verrechnet: 0 });
      if (z.abwesenheit) s.abwesend += Number(z.gesamtstunden || 0);
      else s.stunden += Number(z.gesamtstunden || 0);
      s.zeilen.push(z);
      if ((z.abrechnung_status || 'offen') === 'verrechnet') s.verrechnet += 1; else s.offen += 1;
      // Die Projekte kommen aus den TAGESZEILEN, nicht aus hauptprojekt_id.
      // hauptprojekt_id ist oft NULL und deckt eine Woche mit mehreren
      // Baustellen ohnehin nicht ab. Damit kann das Cockpit den Wochenbericht
      // anbieten, ohne dass jemand vorher das Projekt kennen muss.
      if (z.projekt_id) (projIdsJeWoche[z.wochenrapport_id] || (projIdsJeWoche[z.wochenrapport_id] = new Set())).add(z.projekt_id);
    }
  }
  const alleProjIds = [...new Set(Object.values(projIdsJeWoche).flatMap((set) => [...set]))];
  let projMap = {};
  if (alleProjIds.length) {
    const pr = await sbGet(`gs_projekte?id=in.(${alleProjIds.join(',')})&select=id,name,projektnummer`).catch(() => []);
    for (const p of pr) projMap[p.id] = p;
  }
  return {
    wochen: rows.map((r) => ({
      ...r,
      techniker_name: nameMap[r.techniker_user_id] || 'Techniker',
      total_stunden: Math.round(((sums[r.id] || {}).stunden || 0) * 100) / 100,
      total_abwesenheit_stunden: Math.round(((sums[r.id] || {}).abwesend || 0) * 100) / 100,
      total_spesen: spesenJeTag((sums[r.id] || {}).zeilen || []),
      // Abrechnung ist eine Eigenschaft der TAGESZEILEN, nicht des Wochenkopfs.
      // Die Woche gilt erst als verrechnet, wenn keine offene Zeile mehr da ist;
      // 'teilweise' macht einen halb abgerechneten Stand sichtbar, statt ihn auf
      // 'offen' oder 'verrechnet' zu runden. Ohne Zeilen: 'leer'.
      abrechnung: (() => {
        const s = sums[r.id] || { offen: 0, verrechnet: 0 };
        if (!s.offen && !s.verrechnet) return 'leer';
        if (!s.offen) return 'verrechnet';
        if (!s.verrechnet) return 'offen';
        return 'teilweise';
      })(),
      zeilen_offen: (sums[r.id] || {}).offen || 0,
      zeilen_verrechnet: (sums[r.id] || {}).verrechnet || 0,
      projekte: [...(projIdsJeWoche[r.id] || [])]
        .map((pid) => projMap[pid] || { id: pid, name: null, projektnummer: null })
        .sort((a, b) => String(a.projektnummer || '').localeCompare(String(b.projektnummer || ''))),
    })),
  };
}

// Ein Wochenrapport im Detail für Master — alle Zeilen (projektübergreifend) +
// Fotos aller Zeilen dieser Woche. KEINE Marge-/Kosten-/Ansatz-Felder.
async function pmWochenrapport(b) {
  const id = uuid(b.id);
  const kopfRows = await sbGet(`gs_wochenrapporte?id=eq.${id}&select=*&limit=1`)
    .catch((e) => { if (isNoTable(e)) return null; throw e; });
  if (kopfRows === null) return { notMigrated: true };
  const kopf = kopfRows && kopfRows[0];
  if (!kopf) return { error: 'Wochenrapport nicht gefunden' };
  const zeilen = await sbGet(`gs_tagesrapporte?wochenrapport_id=eq.${id}&select=*&order=datum.asc`).catch(() => []);
  const projektIds = [...new Set([...zeilen.map((z) => z.projekt_id), kopf.hauptprojekt_id].filter(Boolean))];
  let projMap = {};
  if (projektIds.length) {
    const pr = await sbGet(`gs_projekte?id=in.(${projektIds.join(',')})&select=id,name,projektnummer,standort,kunde_id`).catch(() => []);
    for (const p of pr) projMap[p.id] = p;
  }
  // Kunde/Firma fürs Kopf-Anzeige-Feld (Hauptprojekt → gs_kunden.firma).
  let hauptKundeName = null;
  const hauptKundeId = kopf.hauptprojekt_id && (projMap[kopf.hauptprojekt_id] || {}).kunde_id;
  if (hauptKundeId) {
    try {
      const kd = await sbGet(`gs_kunden?id=eq.${hauptKundeId}&select=firma&limit=1`);
      if (kd && kd[0]) hauptKundeName = kd[0].firma;
    } catch (_) { /* egal */ }
  }
  let technikerName = 'Techniker';
  try {
    const t = await sbGet(`gs_techniker?user_id=eq.${kopf.techniker_user_id}&select=name&limit=1`);
    if (t && t[0]) technikerName = t[0].name;
  } catch (_) { /* Fallback-Name */ }
  const rapportIds = zeilen.map((z) => z.id);
  let medien = [];
  if (rapportIds.length) {
    const m = await sbGet(`gs_projekt_medien?tagesrapport_id=in.(${rapportIds.join(',')})&select=*&order=created_at.desc`).catch(() => []);
    medien = await Promise.all(m.map(signMedien));
  }
  const serviceIds = [...new Set(zeilen.map((z) => z.service_auftrag_id).filter(Boolean))];
  let svcMap = {};
  if (serviceIds.length) {
    const sv = await sbGet(`gs_service_auftrag?id=in.(${serviceIds.join(',')})&select=id,objekt,auftragsnummer`).catch(() => []);
    for (const s of sv) svcMap[s.id] = s;
  }
  const taetMap = await loadTaetigkeitenFuerTagesrapporte(rapportIds);
  const zeilenOut = zeilen.map((z) => ({
    ...z,
    projekt_name: z.projekt_id ? (projMap[z.projekt_id] || {}).name || null : null,
    projektnummer: z.projekt_id ? (projMap[z.projekt_id] || {}).projektnummer || null : null,
    standort: z.projekt_id ? (projMap[z.projekt_id] || {}).standort || null : null,
    service_objekt: z.service_auftrag_id ? (svcMap[z.service_auftrag_id] || {}).objekt || null : null,
    taetigkeiten: taetMap[z.id] || [],
  }));
  // Abwesenheitszeilen fliessen NICHT in die Normalstunden. Sie stehen in
  // derselben Spalte (gesamtstunden), sind aber keine geleistete Arbeit — eine
  // Woche mit drei Krankheitstagen darf nicht als voll gearbeitet im Fuss
  // stehen. Sie laufen getrennt in total_abwesenheit_stunden.
  const sum = (key) => Math.round(zeilen.filter((z) => !z.abwesenheit)
    .reduce((s, z) => s + Number(z[key] || 0), 0) * 100) / 100;
  return {
    kopf: {
      ...kopf, techniker_name: technikerName,
      hauptprojekt_name: kopf.hauptprojekt_id ? (projMap[kopf.hauptprojekt_id] || {}).name || null : null,
      hauptkunde_name: hauptKundeName,
      unterschrift_technik_url: kopf.unterschrift_technik_path ? await sbSignUrl(PM_DATEI_BUCKET, kopf.unterschrift_technik_path).catch(() => null) : null,
      unterschrift_kunde_url: kopf.unterschrift_kunde_path ? await sbSignUrl(PM_DATEI_BUCKET, kopf.unterschrift_kunde_path).catch(() => null) : null,
    },
    zeilen: zeilenOut,
    medien,
    total_stunden: sum('gesamtstunden'),
    total_uz25: sum('ueberzeit_25'),
    total_uz50: sum('ueberzeit_50'),
    total_uz100: sum('ueberzeit_100'),
    total_spesen: spesenJeTag(zeilen),
    total_abwesenheit_stunden: trenneStunden(zeilen).abwesenheit_stunden,
    abwesenheit_bloecke: abwesenheitBloecke(zeilen),
    // Katalog mitliefern, damit das Auswahlfeld in app.html nicht von einer
    // eigenen, veraltenden Liste lebt (siehe lib/abwesenheit.js).
    abwesenheit_katalog: ABWESENHEIT_KATALOG,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ZIEL 3 — Master-Vollrechte auf Tageszeilen (ändern/löschen/verschieben).
// Nur über den Master-Zweig von resolveAccess erreichbar (nicht in PM_ACTIONS/
// TECHNIKER_ACTIONS gelistet, siehe dispatcher). Jeder Eingriff schreibt VORHER
// einen Snapshot nach gs_wochenrapport_log (wer, wann, Wert vorher) — nichts
// wird hart überschrieben, ohne dass der alte Stand nachvollziehbar bleibt.
// ═══════════════════════════════════════════════════════════════════════════
// Whitelist bewusst eng: Master darf Erfassungs-/Korrekturfelder ändern, aber
// keine Fremdschlüssel/Systemfelder direkt umbiegen (dafür ist pmWochenrapportMove da).
// ═══════════════════════════════════════════════════════════════════════════
// Wochenrapport-Bindung einer Tageszeile sichern
// ═══════════════════════════════════════════════════════════════════════════
// Eine Tageszeile haengt ueber wochenrapport_id am Stundenblatt (Techniker x KW)
// und traegt zusaetzlich ihre eigenen Spalten jahr/woche. Drei Invarianten:
//
//   1. jahr/woche der Zeile = ISO-Jahr/ISO-Woche ihres datum
//   2. jahr/woche des Wochenrapports = dieselben Werte
//   3. techniker_user_id der Zeile = techniker_user_id des Wochenrapports
//
// Bis hierher konnte pmWochenrapportUpdate das datum ueber eine Wochen- oder
// Jahresgrenze schieben, ohne dass eine der drei mitgezogen wurde. Die Zeile
// blieb am alten Stundenblatt haengen und verschwand zugleich aus der
// Wochenansicht des Technikers — api/tagesrapport.js week() filtert ueber
// jahr/woche, nicht ueber datum.
//
// ISO 8601 nach dem 4-Januar-Prinzip: KW 1 ist die Woche, die den 4. Januar
// enthaelt. isoWeekJahr() rechnet ueber den Donnerstag derselben Woche und
// liefert deshalb an der Jahresgrenze das ISO-Jahr, nicht das Kalenderjahr
// (31.12.2029 -> KW 1/2030). Genau daran ist die alte Fassung von
// mondayToFriday() einmal gescheitert; belegt in scripts/test_isowoche.mjs.
//
// Liefert die Felder, die zusaetzlich geschrieben werden muessen, plus einen
// Hinweis fuer den Master, wenn sich die Zuordnung geaendert hat.
async function wochenBindung(before, neuesDatum, neuerTechnikerUserId) {
  const datum = neuesDatum || before.datum;
  const technikerUserId = neuerTechnikerUserId || before.techniker_user_id;
  const { jahr, woche } = isoWeekJahr(datum);
  if (!jahr || !woche) return { felder: {}, hinweis: null };

  const felder = { jahr, woche };
  const unveraendert = before.jahr === jahr && before.woche === woche
    && before.techniker_user_id === technikerUserId;
  if (unveraendert && before.wochenrapport_id) return { felder, hinweis: null };

  // Ohne Techniker gibt es kein Stundenblatt, an das die Zeile gehoeren koennte.
  if (!technikerUserId) return { felder: { ...felder, wochenrapport_id: null }, hinweis: null };

  let technikerId = null;
  try {
    const t = await sbGet(`gs_techniker?user_id=eq.${technikerUserId}&select=id&limit=1`);
    if (t && t[0]) technikerId = t[0].id;
  } catch (_) { /* Fallback: getOrCreateWochenrapport kommt auch ohne aus */ }

  try {
    const wr = await getOrCreateWochenrapport(
      technikerUserId, technikerId, jahr, woche, before.projekt_id || null,
    );
    if (wr && wr.id) {
      const gewechselt = wr.id !== before.wochenrapport_id;
      return {
        felder: { ...felder, wochenrapport_id: wr.id },
        hinweis: gewechselt
          ? `Die Zeile liegt jetzt in KW ${woche}/${jahr} und wurde dem passenden Stundenblatt zugeordnet.`
          : null,
      };
    }
  } catch (e) {
    console.error('wochenBindung: Stundenblatt nicht bestimmbar', (e && e.message) || e);
  }
  // Lieber gar keine Bindung als eine falsche: eine stehengebliebene
  // wochenrapport_id wuerde die Zeile auf einem fremden Stundenblatt ausweisen.
  return {
    felder: { ...felder, wochenrapport_id: null },
    hinweis: `Die Zeile liegt jetzt in KW ${woche}/${jahr}. Für diese Woche liess sich kein Stundenblatt bestimmen — `
      + 'die Zeile wurde vom bisherigen gelöst und steht ohne Stundenblatt da.',
  };
}

const PM_TAG_UPDATE_FELDER = new Set([
  'datum', 'gesamtstunden', 'stunden_manuell', 'pause_minuten', 'start_zeit', 'end_zeit',
  'taetigkeit', 'projektnummer_erfasst', 'spesen', 'ueberzeit_25', 'ueberzeit_50', 'ueberzeit_100',
  'arbeiten', 'besonderheiten', 'abwesenheit', 'abwesenheit_grund',
]);
// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7 — Unvollstaendige Rapporte im Master-Cockpit
// ═══════════════════════════════════════════════════════════════════════════
// Dieselbe Quelle, aus der auch die Erinnerungsmails gespeist werden
// (api/rapport_erinnerung.js). Zwei Wahrheiten waeren hier besonders
// schaedlich: der Master saehe eine Liste und die Leute bekaemen Mails zu
// etwas anderem.
async function pmRapporteUnvollstaendig(scope) {
  if (scope.partnerId) throw new Forbidden();          // Master/Admin only
  const r = await sammleUnvollstaendige({});
  return {
    ok: true,
    notMigrated: !!r.notMigrated,
    hinweis: r.hinweis || null,
    anzahl: (r.offen || []).length,
    rapporte: (r.offen || []).map((o) => ({
      id: o.id, datum: o.datum, person: o.person, email: o.email,
      projekt_id: o.projekt_id, baustelle: o.baustelle,
      alter_stunden: o.alter_stunden,
      gruende: o.gruende_text,
      erinnert_24: !!o.erinnerung_24_am,
      erinnert_48: !!o.erinnerung_48_am,
    })),
  };
}

// Mailtext lesen und speichern. Beim Speichern wird geprueft, dass er die
// Lohnzahlung nicht an die Abgabe knuepft (lib/erinnerung.js) — abgelehnt wird
// mit Begruendung, nicht kommentarlos.
async function pmErinnerungText(b, scope) {
  if (scope.partnerId) throw new Forbidden();
  if (b.text === undefined) {
    return { ok: true, text: await ladeErinnerungVorlage(), standard: STANDARD_ERINNERUNG_TEXT };
  }
  const p = erinnerungTextPruefen(b.text);
  if (!p.ok) return { error: p.error };
  // Der Betrieb ist die Zeile mit partner_id IS NULL — dieselbe, die auch
  // Logo und Fusszeile traegt (lib/pdf.js ladeBranding).
  const rows = await sbGet('gs_branding?partner_id=is.null&select=id&limit=1').catch(() => []);
  if (!rows || !rows[0]) return { error: 'Es gibt noch keine Branding-Zeile für den Betrieb (gs_branding).' };
  try {
    await sbWrite('PATCH', `gs_branding?id=eq.${rows[0].id}`, { rapport_erinnerung_text: p.text }, 'return=minimal');
  } catch (e) {
    if (/column|does not exist|PGRST204|schema cache/i.test((e && e.message) || '')) {
      return { error: 'Die Spalte rapport_erinnerung_text fehlt — scripts/rapport_feld.sql ist noch nicht gelaufen.' };
    }
    throw e;
  }
  return { ok: true, text: p.text };
}

async function pmWochenrapportUpdate(b, scope) {
  const id = uuid(b.id);
  const rows = await sbGet(`gs_tagesrapporte?id=eq.${id}&select=*&limit=1`).catch(() => []);
  const before = rows && rows[0];
  if (!before) return { error: 'Zeile nicht gefunden' };
  const patch = b.patch && typeof b.patch === 'object' ? b.patch : {};
  const wertVorher = {};
  const row = {};
  for (const k of Object.keys(patch)) {
    if (!PM_TAG_UPDATE_FELDER.has(k)) continue;
    wertVorher[k] = before[k];
    if (k === 'arbeiten') row[k] = toStrArr(patch[k]);
    else if (k === 'taetigkeit') row[k] = GEWERK_OPTIONS.has(patch[k]) ? patch[k] : null;
    else if (['gesamtstunden', 'pause_minuten', 'spesen', 'ueberzeit_25', 'ueberzeit_50', 'ueberzeit_100'].includes(k)) row[k] = (patch[k] != null && patch[k] !== '') ? num(patch[k]) : null;
    else if (k === 'stunden_manuell') row[k] = !!patch[k];
    // TIME-Spalten: ein Leerstring ist KEINE Zeit. Ohne diesen Zweig landet ''
    // ueber den String-Fall auf der Spalte und Postgres bricht mit
    // "invalid input syntax for type time" ab. Leer heisst hier: geloescht.
    else if (['start_zeit', 'end_zeit', 'datum'].includes(k)) row[k] = (patch[k] === '' || patch[k] == null) ? null : String(patch[k]).slice(0, 20);
    else row[k] = patch[k] != null ? String(patch[k]).slice(0, 2000) : null;
  }
  if (!Object.keys(row).length) return { error: 'Keine gültigen Felder zum Ändern' };
  // Auch die Master-Korrektur darf kein Jahr 2099 setzen — ein Vertipper ist
  // hier derselbe Vertipper. `null` heisst „Datum leeren" und bleibt erlaubt.
  if (row.datum) {
    const dpm = pruefeTagesdatum(row.datum);
    if (!dpm.ok) return { error: dpm.error };
    row.datum = dpm.datum;
  }

  // ZIEL 2 — Wandert das Datum ueber eine Wochen- oder Jahresgrenze, muessen
  // jahr/woche der Zeile und ihr Stundenblatt mitwandern. Ohne das blieb die
  // Zeile am alten Stundenblatt haengen UND verschwand aus der Wochenansicht
  // des Technikers (die filtert ueber jahr/woche, nicht ueber datum).
  let hinweis = null;
  if (row.datum && row.datum !== before.datum) {
    const b = await wochenBindung(before, row.datum, null);
    Object.assign(row, b.felder);
    hinweis = b.hinweis;
  }

  await logWochenAenderung(scope, {
    wochenrapportId: before.wochenrapport_id, tagesrapportId: before.id,
    aktion: 'geaendert', feld: Object.keys(row).join(','), wertVorher,
  });
  try {
    const r = await sbWrite('PATCH', `gs_tagesrapporte?id=eq.${id}`, row);
    return { ok: true, row: Array.isArray(r) ? r[0] : r, hinweis };
  } catch (e) {
    // 23505 und 23514 sind Aussagen, keine Stoerungen. Ohne diesen Zweig kam
    // beides als HTTP 500 an und der Master las "Verbindungsfehler".
    const text = tagKonfliktText(pgCode(e), { projektbezogen: !!before.projekt_id });
    if (text) return { error: text };
    throw e;
  }
}

async function pmWochenrapportDelete(b, scope) {
  const id = uuid(b.id);
  const rows = await sbGet(`gs_tagesrapporte?id=eq.${id}&select=*&limit=1`).catch(() => []);
  const before = rows && rows[0];
  if (!before) return { error: 'Zeile nicht gefunden' };
  await logWochenAenderung(scope, {
    wochenrapportId: before.wochenrapport_id, tagesrapportId: before.id,
    aktion: 'geloescht', wertVorher: before,
  });
  await sbWrite('DELETE', `gs_tagesrapporte?id=eq.${id}`, {}, 'return=minimal');
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// ZIEL 2 (Feinschliff II) — Master löscht einen GANZEN Wochenrapport.
// Bewusst NICHT pm_wochenrapport_delete: die Action gibt es schon und sie löscht
// eine einzelne TAGESZEILE. Zwei so verschiedene Wirkungen unter einem Namen
// wären eine Falle.
//
// Reihenfolge ist wichtig:
//   1. Kopf + alle Tageszeilen lesen
//   2. JEDE Tageszeile einzeln protokollieren, dann den Kopf
//   3. erst danach löschen
// gs_tagesrapporte.wochenrapport_id hat ON DELETE CASCADE — das Löschen des
// Kopfes räumt die Zeilen mit ab. Ohne den Einzel-Log wäre danach nichts mehr
// rekonstruierbar; genau dafür ist das Protokoll da. Schlägt das Logging fehl,
// bricht der ganze Vorgang ab und es wird nichts gelöscht.
//
// Die KW-Nummer muss als Bestätigung mitkommen (zweite Stufe). Der Dialog im
// Cockpit fragt sie ab; die Prüfung hier stellt sicher, dass auch ein direkter
// API-Aufruf nicht versehentlich einen Rapport ausradiert.
//
// NICHT angefasst: Unterschriftsdateien im Bucket (unterschrift_technik_path /
// _kunde_path). Die bleiben als Waisen liegen und werden im Ergebnis gemeldet,
// nicht still weggeräumt — Storage-Aufräumen ist eine eigene Entscheidung.
// Fotos überleben ebenfalls: gs_projekt_medien.tagesrapport_id ist ON DELETE
// SET NULL, die Bilder bleiben am Projekt hängen.
// ═══════════════════════════════════════════════════════════════════════════
async function pmWochenrapportKopfDelete(b, scope) {
  const id = uuid(b.id);
  const kopfRows = await sbGet(`gs_wochenrapporte?id=eq.${id}&select=*&limit=1`)
    .catch((e) => { if (isNoTable(e)) return null; throw e; });
  if (kopfRows === null) return { notMigrated: true };
  const kopf = kopfRows && kopfRows[0];
  if (!kopf) return { error: 'Wochenrapport nicht gefunden' };

  // Zweite Stufe: eingetippte KW muss zum Rapport passen.
  const bestaetigt = parseInt(b.bestaetigung_woche, 10);
  if (!Number.isFinite(bestaetigt) || bestaetigt !== Number(kopf.woche)) {
    return { error: `Bestätigung stimmt nicht — bitte die Kalenderwoche ${kopf.woche} eingeben.` };
  }

  const zeilen = await sbGet(`gs_tagesrapporte?wochenrapport_id=eq.${id}&select=*`).catch(() => []);

  // 2a. Jede Tageszeile einzeln — der vollständige Datensatz als Snapshot.
  for (const z of zeilen) {
    await logWochenAenderung(scope, {
      wochenrapportId: kopf.id, tagesrapportId: z.id,
      aktion: 'geloescht', feld: 'wochenrapport_komplett', wertVorher: z,
    });
  }
  // 2b. Der Kopf selbst, inklusive Zahl der mitgelöschten Zeilen.
  await logWochenAenderung(scope, {
    wochenrapportId: kopf.id, tagesrapportId: null,
    aktion: 'geloescht', feld: 'kopf',
    wertVorher: { ...kopf, _geloeschte_tageszeilen: zeilen.length },
  });

  await sbWrite('DELETE', `gs_wochenrapporte?id=eq.${id}`, {}, 'return=minimal');

  const waisen = [kopf.unterschrift_technik_path, kopf.unterschrift_kunde_path].filter(Boolean);
  return {
    ok: true,
    geloescht: { kopf: 1, zeilen: zeilen.length },
    rapport_nr: kopf.rapport_nr || null,
    // Nur Meldung, keine Aktion — siehe Kommentar oben.
    unterschriften_im_speicher: waisen.length,
  };
}

// Verschiebt eine Zeile auf einen anderen Techniker und/oder ein anderes Projekt.
// Bei Techniker-Wechsel wird der Wochenkopf des NEUEN Technikers für dieselbe
// KW/Jahr per getOrCreateWochenrapport geholt/angelegt (UNIQUE techniker+jahr+woche
// erlaubt keinen gemeinsamen Kopf) — dieselbe Funktion wie im Techniker-Pfad, nur
// mit explizit übergebener technikerUserId statt scope.
// ═══════════════════════════════════════════════════════════════════════════
// Projektauswahl fuer eine Tageszeile (C2)
// ═══════════════════════════════════════════════════════════════════════════
// Angeboten werden die Projekte DES KUNDEN, zu dem die Zeile heute gehoert.
//
// ANNAHME, ausdruecklich: 13 der 18 Projekte tragen kein kunde_id, darunter
// P-2026-3470 — genau das Projekt der Wochen 29 bis 31. Fuer solche Zeilen
// waere "die Projekte des Kunden" eine leere Liste und die Maske unbrauchbar.
// Deshalb: traegt das heutige Projekt einen Kunden, sind dessen Projekte die
// engere Auswahl; traegt es keinen, sind es die Projekte ohne Kunden. Alle
// uebrigen stehen darunter in einer zweiten Gruppe und sind waehlbar — der
// Master soll nicht blockiert sein, wenn eine Baustelle einem anderen Kunden
// gehoert. Geloeschte Projekte (geloescht_at) erscheinen nirgends.
async function pmTagProjektwahl(b, scope) {
  const id = uuid(b.id);
  const rows = await sbGet(`gs_tagesrapporte?id=eq.${id}&select=id,projekt_id,datum,abwesenheit,service_auftrag_id&limit=1`).catch(() => []);
  const zeile = rows && rows[0];
  if (!zeile) return { error: 'Zeile nicht gefunden' };

  let kundeId = null;
  if (zeile.projekt_id) {
    const p = await sbGet(`gs_projekte?id=eq.${zeile.projekt_id}&select=kunde_id&limit=1`).catch(() => []);
    kundeId = (p[0] || {}).kunde_id || null;
  }

  const scopeFilter = scope && scope.partnerId ? `&partner_user_id=eq.${scope.partnerId}` : '';
  const alle = ohneGeloeschte(
    await sbGet(`gs_projekte?select=id,name,projektnummer,kunde_id,geloescht_at,standort&order=projektnummer.asc${scopeFilter}`).catch(() => []),
  );

  let kunde = null;
  if (kundeId) {
    const k = await sbGet(`gs_kunden?id=eq.${kundeId}&select=id,firma&limit=1`).catch(() => []);
    kunde = k[0] || null;
  }

  const gehoertDazu = (p) => (kundeId ? p.kunde_id === kundeId : !p.kunde_id);
  const schlank = (p) => ({ id: p.id, name: p.name, projektnummer: p.projektnummer, standort: p.standort || null });

  return {
    aktuell: zeile.projekt_id || null,
    ist_abwesenheit: !!zeile.abwesenheit,
    ist_service: !!zeile.service_auftrag_id,
    kunde,                                        // null = Zeile haengt an einem Projekt ohne Kunden
    gruppe_label: kunde ? `Projekte von ${kunde.firma || 'diesem Kunden'}` : 'Projekte ohne Kunde',
    nah: alle.filter(gehoertDazu).map(schlank),
    fern: alle.filter((p) => !gehoertDazu(p)).map(schlank),
  };
}

async function pmWochenrapportMove(b, scope) {
  const id = uuid(b.id);
  const rows = await sbGet(`gs_tagesrapporte?id=eq.${id}&select=*&limit=1`).catch(() => []);
  const before = rows && rows[0];
  if (!before) return { error: 'Zeile nicht gefunden' };

  const neuerTechnikerUserId = b.techniker_user_id ? uuid(b.techniker_user_id) : before.techniker_user_id;
  const neuesProjektId = b.projekt_id !== undefined ? (b.projekt_id ? uuid(b.projekt_id) : null) : before.projekt_id;
  const neuerServiceId = b.projekt_id !== undefined ? null : before.service_auftrag_id; // Zielwechsel ist immer Projekt ODER Service, nicht beides

  // Abwesenheitszeilen tragen keine Baustelle — der CHECK der Tabelle laesst
  // beides nicht gleichzeitig zu. Das hier abzufangen ist freundlicher, als den
  // Schreibversuch in die 23514 laufen zu lassen: der Master erfaehrt vorher,
  // was zu tun ist, statt nachher, was schiefging.
  if (neuesProjektId && before.abwesenheit) {
    return { error: 'Diese Zeile ist als Abwesenheit erfasst und kann keiner Baustelle zugeordnet werden. Bitte zuerst die Abwesenheit entfernen.' };
  }
  // Jede Zeile braucht genau ein Ziel: Baustelle, Serviceauftrag oder
  // Abwesenheit. "Keine Baustelle" zu waehlen, ohne dass eines der beiden
  // anderen einspringt, liefe in dieselbe CHECK-Verletzung — nur mit einer
  // Meldung, die vom Abwesenheitsfall handelt und hier nicht passt.
  if (!neuesProjektId && !neuerServiceId && !before.abwesenheit) {
    return { error: 'Eine Tageszeile braucht ein Ziel. Bitte eine Baustelle wählen oder die Zeile stattdessen löschen.' };
  }

  const row = { techniker_user_id: neuerTechnikerUserId, projekt_id: neuesProjektId, service_auftrag_id: neuerServiceId };

  // ZIEL 2 — Bindung an das Stundenblatt sichern. Bisher lief das nur beim
  // Technikerwechsel und rechnete mit before.jahr/before.woche; bei Altzeilen
  // sind die leer, dann entstand ein Stundenblatt fuer KW null/null. Jetzt
  // kommen Jahr und Woche immer aus dem datum der Zeile.
  const bind = await wochenBindung(before, before.datum, neuerTechnikerUserId);
  Object.assign(row, bind.felder);
  if (neuesProjektId && !bind.felder.wochenrapport_id) row.wochenrapport_id = before.wochenrapport_id;

  await logWochenAenderung(scope, {
    wochenrapportId: before.wochenrapport_id, tagesrapportId: before.id,
    aktion: 'verschoben', feld: 'techniker_user_id,projekt_id,service_auftrag_id',
    wertVorher: { techniker_user_id: before.techniker_user_id, projekt_id: before.projekt_id, service_auftrag_id: before.service_auftrag_id, wochenrapport_id: before.wochenrapport_id },
  });
  try {
    const r = await sbWrite('PATCH', `gs_tagesrapporte?id=eq.${id}`, row);
    return { ok: true, row: Array.isArray(r) ? r[0] : r, hinweis: bind.hinweis };
  } catch (e) {
    const text = tagKonfliktText(pgCode(e), { projektbezogen: !!neuesProjektId });
    if (text) return { error: text };
    throw e;
  }
}

async function addTaetigkeit(b, scope) {
  await requireOwnedProjekt(b.projekt_id, scope);
  const row = {
    projekt_id: uuid(b.projekt_id),
    beschreibung: String(b.beschreibung || '').slice(0, 500),
    techniker_name: b.techniker_name ? String(b.techniker_name).slice(0, 120) : null,
    datum: b.datum ? String(b.datum).slice(0, 10) : null,
    stunden: (b.stunden != null && b.stunden !== '') ? num(b.stunden) : null,
  };
  if (!row.beschreibung) throw new Error('beschreibung nötig');
  try {
    const r = await sbWrite('POST', 'gs_taetigkeiten', row);
    return { ok: true, row: Array.isArray(r) ? r[0] : r };
  } catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}

async function addMaterial(b, scope) {
  await requireOwnedProjekt(b.projekt_id, scope);
  const row = {
    projekt_id: uuid(b.projekt_id),
    bezeichnung: String(b.bezeichnung || '').slice(0, 200),
    menge: (b.menge != null && b.menge !== '') ? num(b.menge) : null,
    einheit: b.einheit ? String(b.einheit).slice(0, 20) : null,
    kategorie: b.kategorie ? String(b.kategorie).slice(0, 60) : null,
    status: b.status ? String(b.status).slice(0, 40) : 'offen',
  };
  if (b.einzelpreis != null && b.einzelpreis !== '') row.einzelpreis = num(b.einzelpreis);
  if (!row.bezeichnung) throw new Error('bezeichnung nötig');
  try {
    const r = await sbWrite('POST', 'gs_material', row);
    return { ok: true, row: Array.isArray(r) ? r[0] : r };
  } catch (e) {
    if (isNoTable(e)) return { notMigrated: true };
    // einzelpreis-Spalte fehlt (alte gs_material) → ohne Preis speichern, kein 500.
    if ('einzelpreis' in row && /einzelpreis|column|PGRST204/i.test((e && e.message) || '')) {
      const { einzelpreis, ...base } = row;
      const r = await sbWrite('POST', 'gs_material', base);
      return { ok: true, row: Array.isArray(r) ? r[0] : r, preisNotMigrated: true };
    }
    throw e;
  }
}

async function updMaterial(b, scope) {
  await requireOwnedRow('gs_material', b.id, scope);
  const id = uuid(b.id);
  const patch = {};
  if (b.status !== undefined) patch.status = String(b.status).slice(0, 40);
  if (b.menge !== undefined) patch.menge = b.menge === '' ? null : num(b.menge);
  if (b.bezeichnung !== undefined) patch.bezeichnung = String(b.bezeichnung).slice(0, 200);
  try {
    const r = await sbWrite('PATCH', `gs_material?id=eq.${id}`, patch);
    return { ok: true, row: Array.isArray(r) ? r[0] : r };
  } catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}

// Generisches Löschen für PM-Zeilen (Tätigkeit/Material) mit Migrations-Fallback.
async function delPmRow(table, id, scope) {
  await requireOwnedRow(table, id, scope);
  id = uuid(id);
  try { await sbWrite('DELETE', `${table}?id=eq.${id}`, {}, 'return=minimal'); return { ok: true }; }
  catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}

// ── Abrechnungs-Status pro Arbeitsrapport (offen | verrechnet) ─────────────
// Nimmt ein oder mehrere Rapport-ids (z. B. eine ganze Kalenderwoche auf einmal).
async function setRapportAbrechnung(b, scope) {
  // Drei Anrufer, ein Schreibpfad:
  //   • Projektdetail  → ids[] (eine Woche eines Projekts)
  //   • Einzelzeile    → id
  //   • Wochenrapport-Liste → wochenrapport_id; die Tageszeilen werden hier
  //     aufgeloest, damit das Cockpit sie nicht alle uebertragen muss.
  let ids = (Array.isArray(b.ids) ? b.ids : [b.id]).filter(Boolean).map(uuid);
  if (!ids.length && b.wochenrapport_id) {
    // Eine ganze Woche auf einmal umzuschalten ist Master-Sache. Die UI liegt
    // ohnehin nur im Master-Cockpit; das hier ist der serverseitige Riegel,
    // damit die Regel nicht an der Platzierung eines Knopfes haengt.
    if (scope && scope.partnerId) throw new Forbidden();
    const wr = uuid(b.wochenrapport_id);
    const rows = await sbGet(`gs_tagesrapporte?wochenrapport_id=eq.${wr}&select=id`).catch(() => []);
    ids = rows.map((r) => r.id).filter(Boolean);
    if (!ids.length) return { ok: true, status: b.status === 'verrechnet' ? 'verrechnet' : 'offen', count: 0 };
  }
  if (!ids.length) throw new Error('ids nötig');
  // Partner: jeder betroffene Rapport muss zu einem EIGENEN Projekt gehören.
  if (scope && scope.partnerId) {
    const rows = await sbGet(`gs_tagesrapporte?id=in.(${ids.join(',')})&select=projekt_id`).catch(() => []);
    if (rows.length !== ids.length) throw new Forbidden();
    for (const r of rows) await requireOwnedProjekt(r.projekt_id, scope);
  }
  const status = b.status === 'verrechnet' ? 'verrechnet' : 'offen';
  try {
    await sbWrite('PATCH', `gs_tagesrapporte?id=in.(${ids.join(',')})`, { abrechnung_status: status }, 'return=minimal');
    return { ok: true, status, count: ids.length };
  } catch (e) {
    if (/column|does not exist|PGRST204/i.test((e && e.message) || '')) return { notMigrated: true };
    throw e;
  }
}

// ── Projektdateien / Fotos (Storage-Bucket 'projektdateien') ───────────────
const PM_DATEI_BUCKET = 'projektdateien';
// Storage-Objekt loeschen. Eigener Helfer statt `headers: SB`, weil SB ein
// 'Content-Type: application/json' traegt: Supabase Storage laeuft auf Fastify,
// und Fastify weist eine Anfrage MIT diesem Header und OHNE Koerper hart ab —
// 400 "Body cannot be empty when content-type is set to 'application/json'".
// Der Aufrufer sah davon nur "Loeschen fehlgeschlagen"; die Datei blieb liegen,
// die Medienzeile ebenfalls (sie wird erst nach dem Storage-Erfolg entfernt).
// 404 gilt als Erfolg: das Ziel ist weg, mehr wollte der Aufrufer nicht.
async function sbStorageDel(bucket, path) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (r.ok || r.status === 404) return { ok: true, status: r.status };
  return { ok: false, status: r.status, text: await r.text().catch(() => '') };
}
// Drei Kategorien (Unterordner je Projekt). Unbekannt/leer → 'dateien'.
const PM_KATEGORIEN = ['bilder', 'plaene', 'dateien'];
function pmKategorie(v) { const k = String(v || '').toLowerCase(); return PM_KATEGORIEN.includes(k) ? k : 'dateien'; }
async function pmDateiUpload(b, scope) {
  const projektId = uuid(b.projekt_id);
  await requireOwnedProjekt(projektId, scope); // VOR dem Storage-Write (kein Leak)
  const buf = sbDecodeB64(b.data);
  if (!buf) return { error: 'Datei (base64) erforderlich' }; // sauberer Fehler statt 500
  if (buf.length > 12 * 1024 * 1024) return { error: 'Datei zu gross (max. 12 MB)' };
  const safe = sbSafeName(b.filename || 'datei');
  const kat = pmKategorie(b.kategorie);
  const path = `${projektId}/${kat}/${nowStamp()}-${safe}`;
  const contentType = b.contentType || sbGuessType(safe);
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${PM_DATEI_BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: buf,
  });
  if (!up.ok) {
    const t = await up.text().catch(() => '');
    if (/bucket not found/i.test(t)) return { error: `Bucket '${PM_DATEI_BUCKET}' fehlt – scripts/projekt_detail_scharf.sql ausführen.`, notMigrated: true };
    console.error('pm datei upload fail', up.status, t);
    return { error: 'Upload fehlgeschlagen' };
  }
  const url = await sbSignUrl(PM_DATEI_BUCKET, path);
  // AUFFANGNETZ — Bilder zusätzlich in gs_projekt_medien registrieren.
  // Ohne diese Zeile ist ein hier hochgeladenes Foto für den Wochenbericht
  // unsichtbar: der Bericht liest ausschliesslich gs_projekt_medien, während
  // die Projektdateien-Kachel direkt aus dem Storage listet (listOneFolder).
  // tagesrapport_id bleibt bewusst NULL — dieser Upload kennt keinen Tag.
  // Der Bericht zeigt solche Fotos im Abschnitt "ohne Tageszuordnung".
  // Nur Kategorie 'bilder': Pläne bleiben draussen, auch wenn sie Bilder sind.
  if (kat === 'bilder' && /^image\//.test(contentType)) {
    // Kleine Fassung fuers Dokument, falls der Client sie mitgeschickt hat.
    // Auch der Rueckfallweg soll sie fuellen — sonst haette ein ueber base64
    // hochgeladenes Bild keine, und der Bericht muesste das Original einbetten.
    const vorschauPfad = b.vorschau ? await legeStandbildAb(projektId, safe, b.vorschau) : null;
    await sbWrite('POST', 'gs_projekt_medien', {
      projekt_id: projektId, service_auftrag_id: null, tagesrapport_id: null,
      medientyp: 'foto', bucket: PM_DATEI_BUCKET, path,
      dateiname: sbDisplayName(safe), mime: contentType, groesse: buf.length,
      thumbnail_path: vorschauPfad,
      hochgeladen_von: scope.userId || null,
    }, 'return=minimal').catch((e) => {
      // Der Upload ist gelungen; eine fehlende Registrierung darf ihn nicht
      // zurücknehmen. Sichtbar bleibt die Datei in der Projektgalerie.
      console.error('pm datei medien-register fail', (e && e.message) || e);
    });
  }
  return { ok: true, datei: { name: sbDisplayName(path.split('/').pop()), path, kategorie: kat, contentType, size: buf.length, url } };
}

// ═══════════════════════════════════════════════════════════════════════════
// ZIEL 1 + 2 — Fotos ordnen: Tag zuordnen, Kategorie wechseln, Projekt wechseln
// ═══════════════════════════════════════════════════════════════════════════
// Bis hierher konnte ein Foto keinem Kalendertag zugeordnet werden. Folge:
// jedes Foto ohne tagesrapport_id ist Auffangposten JEDER Wochendokumentation
// seines Projekts — dieselben zehn Bilder standen in KW 29, 30 und 31.
// Sobald ein Foto an einer Tageszeile haengt, faellt es aus dem Auffangnetz
// heraus und erscheint nur noch in der Woche dieser Zeile.

// Die auswaehlbaren Tageszeilen eines Projekts. Datum + Baustelle + Techniker,
// damit der Master zwei Zeilen desselben Tages auseinanderhalten kann.
async function pmTageListe(b, scope) {
  const projektId = uuid(b.projekt_id);
  await requireOwnedProjekt(projektId, scope);
  let zeilen = [];
  try {
    zeilen = await sbGet(
      `gs_tagesrapporte?projekt_id=eq.${projektId}`
      + '&select=id,datum,gesamtstunden,taetigkeit,techniker_user_id,jahr,woche&order=datum.desc',
    );
  } catch (e) { if (isNoTable(e)) return { notMigrated: true, tage: [] }; throw e; }

  const uids = [...new Set(zeilen.map((z) => z.techniker_user_id).filter(Boolean))];
  const namen = {};
  if (uids.length) {
    const t = await sbGet(`gs_techniker?user_id=in.(${uids.join(',')})&select=user_id,name`).catch(() => []);
    for (const x of t) namen[x.user_id] = x.name;
  }
  const p = await sbGet(`gs_projekte?id=eq.${projektId}&select=name,projektnummer&limit=1`).catch(() => []);
  const baustelle = [(p[0] || {}).projektnummer, (p[0] || {}).name].filter(Boolean).join(' · ') || 'Baustelle';

  return {
    baustelle,
    tage: zeilen.map((z) => ({
      id: z.id, datum: z.datum, jahr: z.jahr, woche: z.woche,
      stunden: Number(z.gesamtstunden || 0),
      gewerk: z.taetigkeit || null,
      techniker: namen[z.techniker_user_id] || null,
      baustelle,
    })),
  };
}

// Die angefragten Medienzeilen holen und pruefen, dass sie alle zum Projekt
// gehoeren. Verhindert, dass ueber eine mitgeschickte Fremd-id ein Foto eines
// anderen Projekts angefasst wird.
async function medienDesProjekts(b, scope) {
  const projektId = uuid(b.projekt_id);
  await requireOwnedProjekt(projektId, scope);
  const ids = (Array.isArray(b.medien_ids) ? b.medien_ids : []).slice(0, 200).map(uuid);
  if (!ids.length) throw new Error('Kein Bild ausgewählt');
  let rows = [];
  try { rows = await sbGet(`gs_projekt_medien?id=in.(${ids.join(',')})&select=*`); }
  catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
  const fremd = rows.filter((m) => m.projekt_id !== projektId);
  if (fremd.length) throw new Forbidden();
  return { projektId, rows };
}

// ZIEL 1 — Tageszuordnung setzen oder loesen. tagesrapport_id null = loesen.
async function pmMedienTag(b, scope) {
  const t = await medienDesProjekts(b, scope);
  if (t.notMigrated) return t;
  const { projektId, rows } = t;

  let zielId = null;
  if (b.tagesrapport_id) {
    zielId = uuid(b.tagesrapport_id);
    const z = await sbGet(`gs_tagesrapporte?id=eq.${zielId}&select=id,projekt_id,datum&limit=1`).catch(() => []);
    if (!z[0]) return { error: 'Der gewählte Tag wurde nicht gefunden.' };
    // Ein Foto darf nur an einem Tag dieses Projekts haengen. Sonst zeigte der
    // Wochenbericht des einen Projekts ein Bild, das im anderen liegt.
    if (z[0].projekt_id !== projektId) return { error: 'Dieser Tag gehört zu einer anderen Baustelle.' };
  }
  await sbWrite('PATCH', `gs_projekt_medien?id=in.(${rows.map((m) => m.id).join(',')})`,
    { tagesrapport_id: zielId }, 'return=minimal');
  return { ok: true, anzahl: rows.length, zugeordnet: !!zielId };
}

// Storage-Objekt verschieben. Der Pfad ist der Schluessel zur Datei — er aendert
// sich hier bewusst, deshalb muss die Medienzeile im selben Zug mitziehen.
// 'move' statt Kopie+Loeschen: Supabase erledigt das in einem Schritt, eine
// halbe Verschiebung kann so nicht entstehen.
async function sbStorageMove(bucket, von, nach) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/move`, {
    method: 'POST', headers: SB,
    body: JSON.stringify({ bucketId: bucket, sourceKey: von, destinationKey: nach }),
  });
  if (r.ok) return { ok: true };
  return { ok: false, status: r.status, text: await r.text().catch(() => '') };
}

// Pfad neu zusammensetzen: <projekt>/<kategorie>/<zeitstempel>-<name>
function medienPfadNeu(path, projektId, kategorie) {
  const datei = String(path).split('/').pop();
  return `${projektId}/${kategorie}/${datei}`;
}

// ZIEL 2a — Kategorie wechseln (Bilder <-> Plaene <-> Dateien). Verschieben
// statt doppelt ablegen: IMG_7143 und IMG_7144 liegen heute in zwei Kategorien
// als zwei getrennte Kopien, weil es bisher nur "nochmal hochladen" gab.
async function pmMedienKategorie(b, scope) {
  const t = await medienDesProjekts(b, scope);
  if (t.notMigrated) return t;
  const { projektId, rows } = t;
  const kat = pmKategorie(b.kategorie);

  let bewegt = 0; const fehler = [];
  for (const m of rows) {
    const ziel = medienPfadNeu(m.path, projektId, kat);
    if (ziel === m.path) continue;                       // liegt schon dort
    const mv = await sbStorageMove(m.bucket || PM_DATEI_BUCKET, m.path, ziel);
    if (!mv.ok) { fehler.push(m.dateiname || 'Datei'); console.error('medien kategorie move', mv.status, mv.text); continue; }
    try {
      await sbWrite('PATCH', `gs_projekt_medien?id=eq.${m.id}`, { path: ziel }, 'return=minimal');
      bewegt++;
    } catch (e) {
      // Datei ist verschoben, Zeile nicht — zurueckschieben, sonst zeigt die
      // Medienzeile auf einen Pfad, unter dem nichts mehr liegt.
      await sbStorageMove(m.bucket || PM_DATEI_BUCKET, ziel, m.path).catch(() => {});
      fehler.push(m.dateiname || 'Datei');
      console.error('medien kategorie patch', (e && e.message) || e);
    }
  }
  if (fehler.length && !bewegt) return { error: `Verschieben fehlgeschlagen (${fehler.length} Datei(en)).` };
  return { ok: true, bewegt, fehler: fehler.length };
}

// ZIEL 2b — Projekt wechseln. Datei UND Medienzeile ziehen mit. Behebt
// zugleich, dass die Cockpit-Galerie beim Umhaengen einer Tageszeile auf dem
// alten Projekt stehenblieb: projekt_id war dort nie mitgezogen worden.
async function pmMedienProjekt(b, scope) {
  const t = await medienDesProjekts(b, scope);
  if (t.notMigrated) return t;
  const { rows } = t;
  const zielProjekt = uuid(b.ziel_projekt_id);
  await requireOwnedProjekt(zielProjekt, scope);
  if (zielProjekt === t.projektId) return { error: 'Das Bild liegt bereits auf dieser Baustelle.' };

  let bewegt = 0, geloest = 0; const fehler = [];
  for (const m of rows) {
    const kat = (String(m.path).split('/')[1] || 'bilder');
    const ziel = medienPfadNeu(m.path, zielProjekt, PM_KATEGORIEN.includes(kat) ? kat : 'bilder');
    const mv = await sbStorageMove(m.bucket || PM_DATEI_BUCKET, m.path, ziel);
    if (!mv.ok) { fehler.push(m.dateiname || 'Datei'); console.error('medien projekt move', mv.status, mv.text); continue; }
    // Eine Tageszuordnung zeigt auf eine Zeile des ALTEN Projekts und waere
    // nach dem Wechsel falsch. Sie wird geloest, nicht mitgeschleppt — und
    // dem Master gemeldet, statt still zu verschwinden.
    const patch = { path: ziel, projekt_id: zielProjekt };
    if (m.tagesrapport_id) { patch.tagesrapport_id = null; geloest++; }
    try {
      await sbWrite('PATCH', `gs_projekt_medien?id=eq.${m.id}`, patch, 'return=minimal');
      bewegt++;
    } catch (e) {
      await sbStorageMove(m.bucket || PM_DATEI_BUCKET, ziel, m.path).catch(() => {});
      fehler.push(m.dateiname || 'Datei');
      console.error('medien projekt patch', (e && e.message) || e);
    }
  }
  if (fehler.length && !bewegt) return { error: `Verschieben fehlgeschlagen (${fehler.length} Datei(en)).` };
  return {
    ok: true, bewegt, fehler: fehler.length,
    hinweis: geloest ? `${geloest} Tageszuordnung(en) wurden gelöst — der bisherige Tag gehört zur alten Baustelle.` : null,
  };
}

async function pmDateiList(projektId, scope) {
  await requireOwnedProjekt(projektId, scope);
  const dateien = await listProjektDateien(uuid(projektId)).catch(() => []);
  return { dateien };
}

// Listet Dateien je Kategorie-Unterordner + Alt-Bestand direkt unter dem Projekt.
async function listOneFolder(prefix, kategorie) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${PM_DATEI_BUCKET}`, {
    method: 'POST', headers: SB,
    body: JSON.stringify({ prefix, limit: 200, sortBy: { column: 'created_at', order: 'desc' } }),
  });
  if (!r.ok) return [];
  const objs = await r.json().catch(() => []);
  // id === null ⇒ Pseudo-Ordner (z. B. 'bilder/') → überspringen, nur echte Dateien.
  const list = (Array.isArray(objs) ? objs : []).filter((o) => o && o.name && o.id !== null);
  return Promise.all(list.map(async (o) => {
    const path = `${prefix}${o.name}`;
    return {
      name: sbDisplayName(o.name), path, kategorie,
      size: o.metadata?.size || null,
      contentType: o.metadata?.mimetype || null,
      created_at: o.created_at || null,
      url: await sbSignUrl(PM_DATEI_BUCKET, path),
    };
  }));
}

async function listProjektDateien(projektId) {
  // Alt-Bestand (direkt unter projektId/) → Kategorie aus dem MIME-Typ ableiten.
  const legacy = (await listOneFolder(`${projektId}/`, null)).map((d) => ({
    ...d, kategorie: /^image\//.test(d.contentType || '') ? 'bilder' : 'dateien',
  }));
  const perKat = await Promise.all(PM_KATEGORIEN.map((k) => listOneFolder(`${projektId}/${k}/`, k)));
  const all = [...legacy, ...perKat.flat()];
  all.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  // Anzeigenamen aus gs_projekt_medien ueberlagern. Der Storage kennt nur den
  // Pfad, und der ist unveraenderlich — 'IMG_7233.jpeg' bleibt dort fuer immer
  // stehen. Der Anzeigename lebt in der Medienzeile und darf umbenannt werden
  // (pmDateiRename); die Fotodokumentation liest denselben Wert. Dateien ohne
  // Medienzeile (Plaene, Dokumente) tragen keine medien_id und bieten im
  // Cockpit deshalb kein Umbenennen an.
  const med = await sbGet(
    `gs_projekt_medien?projekt_id=eq.${projektId}&select=id,path,dateiname,tagesrapport_id`,
  ).catch(() => []);
  const jePfad = {};
  for (const m of Array.isArray(med) ? med : []) if (m.path) jePfad[m.path] = m;

  // Datum der zugeordneten Tageszeile mitliefern, damit die Galerie zeigen
  // kann, welches Bild schon einen Tag traegt und welches noch im Auffangnetz
  // haengt. Ohne diese Anzeige waere die Zuordnung unsichtbar und der Master
  // wuesste nach dem Zuordnen nicht, was er getan hat.
  const trIds = [...new Set(Object.values(jePfad).map((m) => m.tagesrapport_id).filter(Boolean))];
  const tagVon = {};
  if (trIds.length) {
    const tr = await sbGet(`gs_tagesrapporte?id=in.(${trIds.join(',')})&select=id,datum`).catch(() => []);
    for (const z of tr) tagVon[z.id] = z.datum;
  }

  return all.map((d) => {
    const m = jePfad[d.path];
    if (!m) return { ...d, medien_id: null, tagesrapport_id: null, tag_datum: null };
    return {
      ...d,
      name: m.dateiname || d.name,
      medien_id: m.id,
      tagesrapport_id: m.tagesrapport_id || null,
      tag_datum: m.tagesrapport_id ? (tagVon[m.tagesrapport_id] || null) : null,
    };
  });
}

// Anzeigenamen eines Fotos aendern. Der Speicherpfad bleibt unangetastet — er
// ist der Schluessel zur Datei und zu jeder bereits ausgelieferten signierten
// URL. Geaendert wird ausschliesslich gs_projekt_medien.dateiname, und genau
// den zeigen Projektkachel und Fotodokumentation an.
async function pmDateiRename(b, scope) {
  const projektId = uuid(b.projekt_id);
  await requireOwnedProjekt(projektId, scope);
  const path = String(b.path || '');
  if (!path.startsWith(`${projektId}/`)) throw new Error('Ungültiger Pfad');
  const name = String(b.name || '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, 120);
  if (!name) return { error: 'Name darf nicht leer sein' };
  let rows;
  try {
    rows = await sbWrite('PATCH', `gs_projekt_medien?path=eq.${encodeURIComponent(path)}`,
      { dateiname: name });
  } catch (e) {
    if (isNoTable(e)) return { notMigrated: true };
    throw e;
  }
  const n = Array.isArray(rows) ? rows.length : (rows ? 1 : 0);
  // Kein Treffer heisst: zu dieser Datei existiert keine Medienzeile. Das ist
  // bei Plaenen und Dokumenten der Normalfall und kein Fehler des Aufrufers —
  // es gibt dort schlicht keinen Ort, an dem ein Anzeigename leben koennte.
  if (!n) return { error: 'Diese Datei trägt keinen änderbaren Namen (nur Bilder).' };
  return { ok: true, name };
}

async function pmDateiDel(b, scope) {
  const projektId = uuid(b.projekt_id);
  await requireOwnedProjekt(projektId, scope);
  const path = String(b.path || '');
  if (!path.startsWith(`${projektId}/`)) throw new Error('Ungültiger Pfad');
  const del = await sbStorageDel(PM_DATEI_BUCKET, path);
  if (!del.ok) {
    console.error('pm datei del fail', del.status, del.text);
    return { error: `Löschen fehlgeschlagen (Storage ${del.status})` };
  }
  // Gegenstück zum Auffangnetz im Upload: die Datei ist weg, also darf auch
  // die Medienzeile nicht stehenbleiben — sonst zeigt der Wochenbericht ein
  // Foto an, dessen Bytes es nicht mehr gibt (ladeFotoBytes → null → Lücke).
  // Und mit ihr die kleine Fassung: ohne das bliebe sie als Waise im Bucket
  // liegen, von nichts mehr referenziert.
  const zeilen = await sbGet(`gs_projekt_medien?path=eq.${encodeURIComponent(path)}&select=thumbnail_path`).catch(() => []);
  for (const z of (zeilen || [])) {
    if (z.thumbnail_path) await sbStorageDel(PM_DATEI_BUCKET, z.thumbnail_path).catch(() => {});
  }
  await sbWrite('DELETE', `gs_projekt_medien?path=eq.${encodeURIComponent(path)}`, {}, 'return=minimal')
    .catch((e) => { console.error('pm datei medien-del fail', (e && e.message) || e); });
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// PROJEKTDATEIEN — Direktupload, damit das ORIGINAL unveraendert ankommt
// ═══════════════════════════════════════════════════════════════════════════
// Der base64-Weg oben bleibt bestehen (Rueckfallebene und Nicht-Bilder), aber
// er zwingt den Client, Bilder vorher zu verkleinern: der Request-Body endet
// bei ~4.5 MB. Genau daran ging bisher jedes Original verloren.
//
// Diese beiden Aktionen sind das Gegenstueck zu medien_sign_upload /
// medien_register — mit zwei Unterschieden, die beide zwingend sind:
//   • der Pfad ist `<projekt>/<kategorie>/…`, nicht `<projekt>/medien/…`.
//     Die Projektdateien-Kachel listet direkt aus dem Storage
//     (listProjektDateien) und faende die Datei sonst nicht.
//   • es gibt kein Stockwerk. medien_register verlangt eines.
//
// Die kleine Fassung landet ueber legeStandbildAb unter
// `<projekt>/medien/thumbs/…`. Dieser Ordner wird von listProjektDateien NICHT
// gelistet — die Vorschau taucht also nicht als zweite Datei in der Kachel auf.
async function pmDateiSignUpload(b, scope) {
  const projektId = uuid(b.projekt_id);
  await requireOwnedProjekt(projektId, scope);
  const safe = sbSafeName(b.filename || 'datei');
  const kat = pmKategorie(b.kategorie);
  const contentType = b.contentType || sbGuessType(safe);
  const g = Number(b.groesse || 0);
  if (Number.isFinite(g) && g > FOTO_MAX_BYTES) {
    return { error: `Die Datei ist ${(g / 1048576).toFixed(1)} MB gross. Erlaubt sind höchstens 25 MB.`, foto_abgelehnt: true };
  }
  const path = `${projektId}/${kat}/${nowStamp()}-${safe}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${PM_DATEI_BUCKET}/${path}`, {
    method: 'POST', headers: SB, body: '{}',
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    if (/bucket not found/i.test(t)) return { error: `Bucket '${PM_DATEI_BUCKET}' fehlt.`, notMigrated: true };
    console.error('pm datei sign upload fail', r.status, t);
    return { error: 'Signierte Upload-URL fehlgeschlagen' };
  }
  const d = await r.json().catch(() => ({}));
  const rel = d.url || d.signedURL || '';
  if (!rel) return { error: 'Keine Upload-URL erhalten' };
  return { ok: true, path, kategorie: kat, contentType, uploadUrl: SUPABASE_URL + '/storage/v1' + (rel.startsWith('/') ? rel : '/' + rel) };
}

async function pmDateiRegister(b, scope) {
  const projektId = uuid(b.projekt_id);
  await requireOwnedProjekt(projektId, scope);
  const path = String(b.path || '');
  const kat = pmKategorie(b.kategorie);
  // Kein fremder Pfad, keine fremde Kategorie: beides steckt im Praefix.
  if (!path.startsWith(`${projektId}/${kat}/`)) throw new Forbidden();
  const safe = sbSafeName(sbDisplayName(path.split('/').pop()));
  const contentType = b.contentType || sbGuessType(safe);

  // Gemessen, nicht behauptet — siehe sbObjektInfo.
  const info = await sbObjektInfo(PM_DATEI_BUCKET, path);
  if (!info) return { error: 'Die hochgeladene Datei wurde nicht gefunden. Es wurde nichts eingetragen — bitte noch einmal versuchen.' };
  if (info.size > FOTO_MAX_BYTES) {
    await sbStorageDel(PM_DATEI_BUCKET, path).catch(() => {});
    return { error: `Die Datei ist ${(info.size / 1048576).toFixed(1)} MB gross. Erlaubt sind höchstens 25 MB.`, foto_abgelehnt: true };
  }

  let vorschauPfad = null;
  if (kat === 'bilder' && /^image\//.test(contentType)) {
    if (b.vorschau) vorschauPfad = await legeStandbildAb(projektId, safe, b.vorschau);
    // Dieselbe Registrierung wie im base64-Weg — der Bericht liest
    // ausschliesslich gs_projekt_medien, die Kachel listet aus dem Storage.
    await sbWrite('POST', 'gs_projekt_medien', {
      projekt_id: projektId, service_auftrag_id: null, tagesrapport_id: null,
      medientyp: 'foto', bucket: PM_DATEI_BUCKET, path,
      dateiname: sbDisplayName(safe), mime: contentType, groesse: info.size,
      thumbnail_path: vorschauPfad,
      hochgeladen_von: scope.userId || null,
    }, 'return=minimal').catch((e) => {
      console.error('pm datei register medien fail', (e && e.message) || e);
    });
  }
  const url = await sbSignUrl(PM_DATEI_BUCKET, path);
  return {
    ok: true,
    datei: { name: sbDisplayName(path.split('/').pop()), path, kategorie: kat, contentType, size: info.size, url },
    vorschau_gespeichert: (kat === 'bilder' && /^image\//.test(contentType)) ? !!vorschauPfad : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  FEATURE B — MEDIEN (Foto/Video) mit Standort-Tags + Stockwerk-Katalog
//  FEATURE C — SERVICE-AUFTRAG (neu→angenommen/abgelehnt→erledigt)
//  Rollenbewusst über scope.role. Enforcement je Rolle:
//    • master     → Vollzugriff
//    • partner    → read-only auf Eigenes (Projekt via partner_user_id, Service als Ersteller)
//    • techniker  → nur Zugewiesenes (Kette gs_techniker.user_id→id→*.techniker_id); schreibt Medien/Rapport
//  Interne Marge-Felder erscheinen hier nirgends (Medien/Service tragen keine).
// ═══════════════════════════════════════════════════════════════════════════

// Projekt-Zugriff je Rolle. write=true verlangt Schreibrecht (Partner=read-only → Forbidden).
async function assertProjektAccess(projektId, scope, write) {
  const pid = uuid(projektId);
  if (scope.role === 'master') return pid;
  if (scope.role === 'partner') { if (write) throw new Forbidden(); await requireOwnedProjekt(pid, scope); return pid; }
  if (scope.role === 'techniker') { await requireAssignedProjekt(pid, scope); return pid; }
  throw new Forbidden();
}
// Service-Auftrag-Zugriff je Rolle.
async function assertServiceAccess(serviceId, scope, write) {
  const sid = uuid(serviceId);
  if (scope.role === 'master') return sid;
  if (scope.role === 'partner') {
    if (write) throw new Forbidden();                          // Partner ist read-only (erstellt via svc_create)
    const rows = await sbGet(`gs_service_auftrag?id=eq.${sid}&select=partner_user_id&limit=1`).catch(() => []);
    if (!rows[0] || rows[0].partner_user_id !== scope.partnerId) throw new Forbidden();
    return sid;
  }
  if (scope.role === 'techniker') {
    if (!scope.technikerId) throw new Forbidden();
    const rows = await sbGet(`gs_service_techniker?service_auftrag_id=eq.${sid}&techniker_id=eq.${scope.technikerId}&select=service_auftrag_id&limit=1`).catch(() => []);
    if (!rows[0]) throw new Forbidden();
    return sid;
  }
  throw new Forbidden();
}
// Aus dem Body das Ziel (Projekt ODER Service) auflösen + Zugriff prüfen.
async function resolveMedienTarget(b, scope, write) {
  if (b.projekt_id) { const pid = await assertProjektAccess(b.projekt_id, scope, write); return { projekt_id: pid, service_auftrag_id: null, isService: false }; }
  if (b.service_auftrag_id) { const sid = await assertServiceAccess(b.service_auftrag_id, scope, write); return { projekt_id: null, service_auftrag_id: sid, isService: true }; }
  throw new Error('projekt_id oder service_auftrag_id nötig');
}
// Optionale Verknüpfung Foto→Tageszeile (fürs künftige Foto-Wochenbericht). Techniker
// dürfen nur an EIGENE Tageszeilen hängen — sonst könnte fremdes Material getaggt werden.
async function resolveTagesrapportId(b, scope) {
  if (!b.tagesrapport_id) return null;
  const rid = uuid(b.tagesrapport_id);
  const rows = await sbGet(`gs_tagesrapporte?id=eq.${rid}&select=id,techniker_user_id&limit=1`).catch(() => []);
  if (!rows[0]) throw new Forbidden();
  if (scope.role === 'techniker' && rows[0].techniker_user_id !== scope.technikerUserId) throw new Forbidden();
  return rid;
}

// Signierte URLs (Datei + optionaler Video-Thumbnail) an eine Medien-Zeile hängen.
async function signMedien(m) {
  if (!m) return m;
  const bucket = m.bucket || PM_DATEI_BUCKET;
  const url = m.path ? await sbSignUrl(bucket, m.path).catch(() => null) : null;
  const thumbnail_url = m.thumbnail_path ? await sbSignUrl(bucket, m.thumbnail_path).catch(() => null) : null;
  return { ...m, url, thumbnail_url };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 — Video: Format, Groesse, Dauer, Standbild
// ═══════════════════════════════════════════════════════════════════════════
// Drei Grenzen, und alle drei werden VOR dem Upload gemeldet — der Client
// prueft sie am File-Objekt, der Server prueft sie noch einmal, BEVOR er eine
// signierte Upload-URL herausgibt. Ein 300-MB-Clip verlaesst das Handy damit
// gar nicht erst; auf der Baustelle ist das der Unterschied zwischen "geht
// nicht" und "haengt zehn Minuten und geht dann nicht".
//
// Die Server-Pruefung ist die massgebliche: der Client kann fehlen, alt sein
// oder umgangen werden.
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;      // 100 MB
const VIDEO_MAX_SEKUNDEN = 120;                 // 2 Minuten
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/x-m4v']);
const VIDEO_ENDUNGEN = new Set(['mp4', 'mov', 'm4v']);
// Gilt fuer JEDES Standbild: Video-Poster wie Foto-Vorschau. Beide gehen
// ueber legeStandbildAb und kommen als base64 im Antwortkoerper mit.
const VIDEO_THUMB_MAX = 4 * 1024 * 1024;
// Obergrenze fuer ein Foto — dieselbe Zahl wie im base64-Weg (medienUpload),
// damit es EINE Grenze gibt und nicht zwei. Deutlich unter dem Bucket-Default,
// damit nie Supabase mit einer undurchsichtigen Meldung ablehnt, sondern immer
// unser Text. Und rund doppelt so hoch wie das groesste realistische Handyfoto.
const FOTO_MAX_BYTES = 25 * 1024 * 1024;

function istVideo(contentType, filename, medientyp) {
  if (medientyp === 'video') return true;
  if (/^video\//.test(String(contentType || ''))) return true;
  const e = String(filename || '').toLowerCase().split('.').pop();
  return VIDEO_ENDUNGEN.has(e);
}

// Gibt null zurueck, wenn alles passt — sonst den fertigen Meldungstext.
// `dauer` und `groesse` duerfen fehlen (dann werden sie nicht geprueft); der
// Client liefert beides mit, der Server prueft die Groesse beim Registrieren
// zusaetzlich am tatsaechlich abgelegten Objekt.
function videoRegelFehler({ contentType, filename, groesse, dauer }) {
  const e = String(filename || '').toLowerCase().split('.').pop();
  const typOk = VIDEO_MIME.has(String(contentType || '').toLowerCase()) || VIDEO_ENDUNGEN.has(e);
  if (!typOk) {
    return `Dieses Videoformat wird nicht angenommen (${contentType || e || 'unbekannt'}). Erlaubt sind mp4 und mov.`;
  }
  const g = Number(groesse);
  if (Number.isFinite(g) && g > VIDEO_MAX_BYTES) {
    return `Das Video ist ${(g / 1048576).toFixed(1)} MB gross. Erlaubt sind höchstens 100 MB — bitte kürzer aufnehmen.`;
  }
  const d = Number(dauer);
  if (Number.isFinite(d) && d > VIDEO_MAX_SEKUNDEN) {
    return `Das Video dauert ${Math.round(d)} Sekunden. Erlaubt sind höchstens 2 Minuten (120 Sekunden).`;
  }
  return null;
}

// Standbild zum Video ablegen. Das Bild kommt vom Client (er hat das Video im
// Speicher und kann einen Frame zeichnen; auf dem Server gaebe es dafuer keinen
// Dekoder). Schlaegt es fehl, wird das Video trotzdem gespeichert — aber es
// wird GESAGT, dass die Vorschau fehlt, statt sie stillschweigend wegzulassen.
async function legeStandbildAb(scopeKey, safe, thumbB64) {
  const tbuf = sbDecodeB64(thumbB64);
  if (!tbuf || tbuf.length > VIDEO_THUMB_MAX) return null;
  const tpath = `${scopeKey}/medien/thumbs/${nowStamp()}-${safe}.jpg`;
  const tup = await fetch(`${SUPABASE_URL}/storage/v1/object/${PM_DATEI_BUCKET}/${tpath}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
    body: tbuf,
  });
  return tup.ok ? tpath : null;
}

// Medien-Upload (Foto ODER Video) mit Standort-Tags in Bucket 'projektdateien' + DB-Zeile.
async function medienUpload(b, scope) {
  const tgt = await resolveMedienTarget(b, scope, true);        // Schreibrecht nötig (Partner → Forbidden)
  const tagesrapport_id = await resolveTagesrapportId(b, scope);
  const buf = sbDecodeB64(b.data);
  if (!buf) return { error: 'Datei (base64) erforderlich' };
  const safe = sbSafeName(b.filename || 'medien');
  const contentType = b.contentType || sbGuessType(safe);
  const medientyp = istVideo(contentType, safe, b.medientyp) ? 'video' : 'foto';
  // Phase 4 — Videogrenzen gelten auch auf diesem (aelteren) Weg. Gemeldet
  // wird VOR dem Upload; die Datei liegt hier zwar schon im Speicher, aber
  // sie geht nicht in den Bucket.
  if (medientyp === 'video') {
    const fehler = videoRegelFehler({ contentType, filename: safe, groesse: buf.length, dauer: b.dauer_sekunden });
    if (fehler) return { error: fehler, video_abgelehnt: true };
  } else if (buf.length > 25 * 1024 * 1024) {
    return { error: 'Foto zu gross (max. 25 MB).' };
  }
  // Stockwerk: Pflicht wird APP-SEITIG nur bei PROJEKT-Fotos erzwungen; Service darf leer.
  const stockwerk = b.stockwerk ? String(b.stockwerk).slice(0, 80) : null;
  if (!tgt.isService && !stockwerk) return { error: 'Stockwerk ist bei Projekt-Medien erforderlich' };
  const scopeKey = tgt.isService ? `service/${tgt.service_auftrag_id}` : tgt.projekt_id;
  const path = `${scopeKey}/medien/${nowStamp()}-${safe}`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${PM_DATEI_BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: buf,
  });
  if (!up.ok) {
    const t = await up.text().catch(() => '');
    if (/bucket not found/i.test(t)) return { error: `Bucket '${PM_DATEI_BUCKET}' fehlt.`, notMigrated: true };
    console.error('medien upload fail', up.status, t);
    return { error: 'Upload fehlgeschlagen' };
  }
  // Optionaler Video-Thumbnail (Client liefert base64-Poster) → für Vorschau.
  let thumbnail_path = null;
  if (medientyp === 'video' && b.thumbnail) thumbnail_path = await legeStandbildAb(scopeKey, safe, b.thumbnail);
  // Phase 9 — kleine Fassung eines FOTOS fuer die Abbildung im Bericht. Sie
  // kommt vom Geraet (canvas, Baseline-JPEG, 1000 px lange Kante) und liegt in
  // derselben Spalte wie das Standbild eines Videos: thumbnail_path. Das
  // Original bleibt unangetastet und ist ueber die Galerie weiter in voller
  // Groesse da.
  if (medientyp === 'foto' && b.vorschau) thumbnail_path = await legeStandbildAb(scopeKey, safe, b.vorschau);
  const row = {
    projekt_id: tgt.projekt_id, service_auftrag_id: tgt.service_auftrag_id,
    tagesrapport_id,
    medientyp, bucket: PM_DATEI_BUCKET, path, dateiname: sbDisplayName(safe),
    mime: contentType, groesse: buf.length,
    dauer_sekunden: (b.dauer_sekunden != null && b.dauer_sekunden !== '') ? Math.round(num(b.dauer_sekunden)) : null,
    thumbnail_path,
    stockwerk, stockwerk_id: b.stockwerk_id ? uuid(b.stockwerk_id) : null,
    wohnung: b.wohnung ? String(b.wohnung).slice(0, 80) : null,
    raum: b.raum ? String(b.raum).slice(0, 80) : null,
    bauabschnitt: b.bauabschnitt ? String(b.bauabschnitt).slice(0, 120) : null,
    notiz: b.notiz ? String(b.notiz).slice(0, 1000) : null,
    hochgeladen_von: scope.userId || null,
  };
  try {
    const r = await sbWrite('POST', 'gs_projekt_medien', row);
    return {
      ok: true,
      medien: await signMedien(Array.isArray(r) ? r[0] : r),
      // Ehrlich benennen statt stillschweigend weglassen.
      standbild: medientyp === 'video' ? !!thumbnail_path : null,
      // Bei einem Foto ist thumbnail_path die kleine Fassung fuers Dokument.
      vorschau_gespeichert: medientyp === 'foto' ? !!thumbnail_path : null,
      hinweis: (medientyp === 'video' && !thumbnail_path)
        ? 'Das Video ist gespeichert, ein Standbild konnte nicht erzeugt werden. In der Galerie fehlt die Vorschau.'
        : null,
    };
  } catch (e) {
    if (isNoTable(e)) return { notMigrated: true };
    throw e;
  }
}

// Medien-Liste + Galerie-Gruppierung nach Stockwerk (Sortierung aus Katalog-Reihenfolge).
async function medienList(b, scope) {
  const tgt = await resolveMedienTarget(b, scope, false);       // Lesen reicht
  let filter = tgt.isService ? `service_auftrag_id=eq.${tgt.service_auftrag_id}` : `projekt_id=eq.${tgt.projekt_id}`;
  // Optional auf eine einzelne Tageszeile eingrenzen (Wochenrapport-Formular zeigt
  // nur die Fotos DIESES Tages statt der ganzen Projekt-Galerie).
  if (b.tagesrapport_id) filter += `&tagesrapport_id=eq.${uuid(b.tagesrapport_id)}`;
  let rows = [];
  try { rows = await sbGet(`gs_projekt_medien?${filter}&select=*&order=created_at.desc`); }
  catch (e) { if (isNoTable(e)) return { notMigrated: true, medien: [], gruppen: [] }; throw e; }
  const signed = await Promise.all(rows.map(signMedien));
  const order = {};
  if (!tgt.isService) {
    try {
      const sw = await sbGet(`gs_projekt_stockwerk?projekt_id=eq.${tgt.projekt_id}&select=name,reihenfolge`);
      for (const s of sw) order[s.name] = s.reihenfolge ?? 0;
    } catch (_) {}
  }
  const byFloor = new Map();
  for (const m of signed) {
    const key = m.stockwerk || 'Ohne Stockwerk';
    if (!byFloor.has(key)) byFloor.set(key, []);
    byFloor.get(key).push(m);
  }
  const gruppen = [...byFloor.entries()]
    .map(([stockwerk, medien]) => ({ stockwerk, reihenfolge: order[stockwerk] ?? 999, medien }))
    .sort((a, c) => (a.reihenfolge - c.reihenfolge) || a.stockwerk.localeCompare(c.stockwerk));
  return { medien: signed, gruppen };
}

// Medien löschen: über die DB-Zeile (Zugriff via Ziel prüfen). Techniker nur EIGENE Uploads.
async function medienDel(b, scope) {
  const id = uuid(b.id);
  let rows = [];
  try { rows = await sbGet(`gs_projekt_medien?id=eq.${id}&select=*&limit=1`); }
  catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
  const m = rows[0];
  if (!m) throw new Forbidden();
  if (m.projekt_id) await assertProjektAccess(m.projekt_id, scope, true);
  else if (m.service_auftrag_id) await assertServiceAccess(m.service_auftrag_id, scope, true);
  else throw new Forbidden();
  if (scope.role === 'techniker' && m.hochgeladen_von !== scope.technikerUserId) throw new Forbidden();
  for (const p of [m.path, m.thumbnail_path].filter(Boolean)) {
    await sbStorageDel(m.bucket || PM_DATEI_BUCKET, p).catch(() => {});
  }
  await sbWrite('DELETE', `gs_projekt_medien?id=eq.${id}`, {}, 'return=minimal');
  return { ok: true };
}

// Video-Direktupload: signierte Storage-Upload-URL erzeugen (Client lädt die (grosse)
// Datei DIREKT in den Bucket → umgeht das ~4,5 MB Serverless-Body-Limit). Danach ruft
// der Client medien_register mit dem zurückgegebenen path. Zugriff = Schreibrecht am Ziel.
async function medienSignUpload(b, scope) {
  const tgt = await resolveMedienTarget(b, scope, true);
  const safe = sbSafeName(b.filename || 'video');
  // Phase 4 — HIER faellt die Entscheidung. Wer keine Upload-URL bekommt, laedt
  // nichts hoch; der 300-MB-Clip verlaesst das Handy gar nicht erst. Der Client
  // schickt Groesse und Dauer mit, beides liest er am File-Objekt ab.
  if (istVideo(b.contentType, safe, b.medientyp)) {
    const fehler = videoRegelFehler({
      contentType: b.contentType || sbGuessType(safe), filename: safe,
      groesse: b.groesse, dauer: b.dauer_sekunden,
    });
    if (fehler) return { error: fehler, video_abgelehnt: true };
  } else {
    // Seit Fotos denselben Weg gehen, darf hier kein Loch bleiben: bisher wurde
    // fuer alles ausser Video eine Upload-URL OHNE jede Pruefung ausgestellt.
    // Massgeblich ist trotzdem die Messung beim Registrieren — das hier ist die
    // Hoeflichkeit, die dem Geraet den Upload erspart.
    const g = Number(b.groesse || 0);
    if (Number.isFinite(g) && g > FOTO_MAX_BYTES) {
      return {
        error: `Die Datei ist ${(g / 1048576).toFixed(1)} MB gross. Erlaubt sind höchstens 25 MB.`,
        foto_abgelehnt: true,
      };
    }
  }
  const scopeKey = tgt.isService ? `service/${tgt.service_auftrag_id}` : tgt.projekt_id;
  const path = `${scopeKey}/medien/${nowStamp()}-${safe}`;
  // Body {} nötig: der Endpoint lehnt leeren Body bei Content-Type json ab.
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${PM_DATEI_BUCKET}/${path}`, { method: 'POST', headers: SB, body: '{}' });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    if (/bucket not found/i.test(t)) return { error: `Bucket '${PM_DATEI_BUCKET}' fehlt.`, notMigrated: true };
    console.error('sign upload fail', r.status, t);
    return { error: 'Signierte Upload-URL fehlgeschlagen' };
  }
  const d = await r.json().catch(() => ({}));
  const rel = d.url || d.signedURL || '';
  if (!rel) return { error: 'Keine Upload-URL erhalten' };
  return { ok: true, path, uploadUrl: SUPABASE_URL + '/storage/v1' + (rel.startsWith('/') ? rel : '/' + rel) };
}

// Nach erfolgreichem Direktupload: Medien-Zeile registrieren. Der path MUSS zum
// (zugriffsgeprüften) Ziel gehören — sonst Forbidden (kein Fremd-Pfad einschleusen).
async function medienRegister(b, scope) {
  const tgt = await resolveMedienTarget(b, scope, true);
  const tagesrapport_id = await resolveTagesrapportId(b, scope);
  const path = String(b.path || '');
  const prefix = tgt.isService ? `service/${tgt.service_auftrag_id}/` : `${tgt.projekt_id}/`;
  if (!path.startsWith(prefix)) throw new Forbidden();
  const contentType = b.contentType || sbGuessType(path);
  const medientyp = istVideo(contentType, path, b.medientyp) ? 'video' : 'foto';
  const stockwerk = b.stockwerk ? String(b.stockwerk).slice(0, 80) : null;
  if (!tgt.isService && !stockwerk) return { error: 'Stockwerk ist bei Projekt-Medien erforderlich' };

  // Zweite Pruefung, nach dem Direktupload. Der Client koennte die erste
  // umgangen haben — dann liegt die Datei zwar schon im Bucket, bekommt aber
  // keine Zeile und wird wieder entfernt. Ohne das Aufraeumen bliebe eine
  // Datei liegen, die nirgends auftaucht und niemand mehr findet.
  //
  // thumbnail_path aus dem Body ist ein vom CLIENT bestimmter Speicherpfad und
  // landete bisher ungeprueft auf der Zeile. Solange nur Videos diesen Weg
  // gingen, schickte ihn niemand; jetzt gehoert dieselbe Praefixpruefung daran
  // wie an `path`.
  let thumbnail_path = null;
  if (b.thumbnail_path) {
    const tp = String(b.thumbnail_path).slice(0, 300);
    if (!tp.startsWith(prefix)) throw new Forbidden();
    thumbnail_path = tp;
  }
  const scopeKey = tgt.isService ? `service/${tgt.service_auftrag_id}` : tgt.projekt_id;

  // GEMESSEN, nicht behauptet. `groesse` kaeme sonst aus dem Body — von dem,
  // der gerade hochgeladen hat. Liegt gar nichts unter dem Pfad, entsteht auch
  // keine Zeile: eine Medienzeile ohne Datei ist eine Karteileiche, die in
  // jeder Galerie als kaputtes Bild auftaucht.
  const info = await sbObjektInfo(PM_DATEI_BUCKET, path);
  if (!info) {
    return { error: 'Die hochgeladene Datei wurde nicht gefunden. Es wurde nichts eingetragen — bitte noch einmal versuchen.' };
  }
  const groesse = info.size;

  if (medientyp === 'video') {
    const fehler = videoRegelFehler({ contentType, filename: path, groesse, dauer: b.dauer_sekunden });
    if (fehler) {
      await sbStorageDel(PM_DATEI_BUCKET, path).catch(() => {});
      return { error: fehler, video_abgelehnt: true };
    }
  } else if (groesse > FOTO_MAX_BYTES) {
    await sbStorageDel(PM_DATEI_BUCKET, path).catch(() => {});
    return {
      error: `Die Datei ist ${(groesse / 1048576).toFixed(1)} MB gross. Erlaubt sind höchstens 25 MB.`,
      foto_abgelehnt: true,
    };
  }

  // Standbild bzw. kleine Fassung: kommt als base64 mit (klein genug fuer den
  // Body) und wird hier abgelegt. Zu jedem Video gehoert ein Standbild, zu
  // jedem Foto eine kleine Fassung fuer PDF und Galerie — das Original bleibt
  // unter `path` unangetastet.
  // sbDisplayName streift den fuehrenden Zeitstempel ab, sonst hiesse die
  // Ablage "1788…-1788…-clip.mov.jpg".
  const kleineFassung = b.vorschau || b.thumbnail;
  if (!thumbnail_path && kleineFassung) {
    thumbnail_path = await legeStandbildAb(scopeKey, sbSafeName(sbDisplayName(path.split('/').pop())), kleineFassung);
  }

  const row = {
    projekt_id: tgt.projekt_id, service_auftrag_id: tgt.service_auftrag_id,
    tagesrapport_id,
    medientyp, bucket: PM_DATEI_BUCKET, path,
    dateiname: b.filename ? sbDisplayName(sbSafeName(b.filename)) : sbDisplayName(path.split('/').pop()),
    mime: contentType, groesse,
    dauer_sekunden: (b.dauer_sekunden != null && b.dauer_sekunden !== '') ? Math.round(num(b.dauer_sekunden)) : null,
    thumbnail_path,
    stockwerk, stockwerk_id: b.stockwerk_id ? uuid(b.stockwerk_id) : null,
    wohnung: b.wohnung ? String(b.wohnung).slice(0, 80) : null,
    raum: b.raum ? String(b.raum).slice(0, 80) : null,
    bauabschnitt: b.bauabschnitt ? String(b.bauabschnitt).slice(0, 120) : null,
    notiz: b.notiz ? String(b.notiz).slice(0, 1000) : null,
    hochgeladen_von: scope.userId || null,
  };
  try {
    const r = await sbWrite('POST', 'gs_projekt_medien', row);
    return {
      ok: true,
      medien: await signMedien(Array.isArray(r) ? r[0] : r),
      standbild: medientyp === 'video' ? !!thumbnail_path : null,
      vorschau_gespeichert: medientyp === 'foto' ? !!thumbnail_path : null,
      groesse,
      hinweis: !thumbnail_path
        ? (medientyp === 'video'
          ? 'Das Video ist gespeichert, ein Standbild konnte nicht erzeugt werden. In der Galerie fehlt die Vorschau.'
          : 'Das Foto ist im Original gespeichert, eine kleine Fassung konnte nicht erzeugt werden. Im Bericht wird das Original abgebildet.')
        : null,
    };
  } catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}

// ── Stockwerk-Katalog (Preset UG/EG/1.OG… + frei) ──
const STOCKWERK_PRESETS = ['UG', 'EG', '1.OG', '2.OG', '3.OG', '4.OG', '5.OG', 'DG'];
async function stockwerkList(b, scope) {
  const pid = await assertProjektAccess(b.projekt_id, scope, false);
  try {
    const rows = await sbGet(`gs_projekt_stockwerk?projekt_id=eq.${pid}&select=*&order=reihenfolge.asc,name.asc`);
    return { stockwerke: rows, presets: STOCKWERK_PRESETS };
  } catch (e) { if (isNoTable(e)) return { notMigrated: true, stockwerke: [], presets: STOCKWERK_PRESETS }; throw e; }
}
async function stockwerkAdd(b, scope) {
  const pid = await assertProjektAccess(b.projekt_id, scope, true);   // Master + Techniker (Partner read-only)
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw new Error('name nötig');
  const row = {
    projekt_id: pid, name,
    quelle: b.quelle === 'preset' ? 'preset' : 'frei',
    reihenfolge: (b.reihenfolge != null && b.reihenfolge !== '') ? Math.round(num(b.reihenfolge)) : 0,
  };
  try {
    const r = await sbWrite('POST', 'gs_projekt_stockwerk?on_conflict=projekt_id,name', row, 'resolution=merge-duplicates,return=representation');
    return { ok: true, stockwerk: Array.isArray(r) ? r[0] : r };
  } catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}
async function stockwerkDel(b, scope) {
  if (scope.role !== 'master') throw new Forbidden();                // Struktur nur Master löscht
  try { await sbWrite('DELETE', `gs_projekt_stockwerk?id=eq.${uuid(b.id)}`, {}, 'return=minimal'); return { ok: true }; }
  catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}

// ── Service-Auftrag ──
async function svcListe(scope) {
  let filter = '';
  if (scope.role === 'partner') filter = `&partner_user_id=eq.${scope.partnerId}`;
  else if (scope.role === 'techniker') {
    if (!scope.technikerId) return { auftraege: [] };
    const asg = await sbGet(`gs_service_techniker?techniker_id=eq.${scope.technikerId}&select=service_auftrag_id`).catch(() => []);
    const ids = [...new Set((asg || []).map((a) => a.service_auftrag_id).filter(Boolean))];
    if (!ids.length) return { auftraege: [] };
    filter = `&id=in.(${ids.join(',')})`;
  }
  let auftraege;
  try { auftraege = await sbGet(`gs_service_auftrag?select=*&order=created_at.desc${filter}`); }
  catch (e) { if (isNoTable(e)) return { notMigrated: true, auftraege: [] }; throw e; }
  if (!auftraege.length) return { auftraege };

  // Zuweisungen und Aufwand in EINEM Zug nachladen, nicht je Zeile. Die
  // Disposition braucht auf den ersten Blick: wer ist dran und ist schon
  // Arbeit erfasst — sonst muss man jeden Auftrag einzeln öffnen.
  const ids = auftraege.map((a) => a.id);
  const [asg, rap] = await Promise.all([
    sbGet(`gs_service_techniker?service_auftrag_id=in.(${ids.join(',')})&select=service_auftrag_id,techniker_id`).catch(() => []),
    sbGet(`gs_tagesrapporte?service_auftrag_id=in.(${ids.join(',')})&select=service_auftrag_id,gesamtstunden`).catch(() => []),
  ]);
  const techIds = [...new Set((asg || []).map((x) => x.techniker_id).filter(Boolean))];
  const namen = {};
  if (techIds.length) {
    const ts = await sbGet(`gs_techniker?id=in.(${techIds.join(',')})&select=id,name`).catch(() => []);
    for (const t of ts || []) namen[t.id] = t.name;
  }
  const proAuftrag = {};
  for (const x of asg || []) {
    (proAuftrag[x.service_auftrag_id] = proAuftrag[x.service_auftrag_id] || []).push(namen[x.techniker_id] || 'Techniker');
  }
  const stunden = {};
  for (const r of rap || []) stunden[r.service_auftrag_id] = (stunden[r.service_auftrag_id] || 0) + num(r.gesamtstunden);

  return {
    auftraege: auftraege.map((a) => ({
      ...a,
      techniker_namen: proAuftrag[a.id] || [],
      stunden: Math.round((stunden[a.id] || 0) * 100) / 100,
    })),
  };
}
async function svcDetail(b, scope) {
  const sid = await assertServiceAccess(b.id, scope, false);
  const rows = await sbGet(`gs_service_auftrag?id=eq.${sid}&select=*&limit=1`).catch(() => []);
  const auftrag = rows[0];
  if (!auftrag) return { error: 'Auftrag nicht gefunden' };
  let techniker = [], rapporte = [], medien = [];
  try {
    const asg = await sbGet(`gs_service_techniker?service_auftrag_id=eq.${sid}&select=id,techniker_id`).catch(() => []);
    const ids = [...new Set((asg || []).map((a) => a.techniker_id).filter(Boolean))];
    if (ids.length) {
      // Die Zuweisungs-ZEILE mitgeben: svc_unassign löscht über sie. Ohne das
      // müsste der Client die Techniker-id schicken und der Server sie erst
      // wieder in eine Zeilen-id auflösen.
      const zuwVon = {};
      for (const x of asg || []) if (x.techniker_id) zuwVon[x.techniker_id] = x.id;
      const ts = await sbGet(`gs_techniker?id=in.(${ids.join(',')})&select=*`).catch(() => []);
      techniker = ts.map((t) => ({ id: t.id, zuweisung_id: zuwVon[t.id] || null, ...pmTechCard(t) }));
    }
  } catch (_) {}
  try { rapporte = await sbGet(`gs_tagesrapporte?service_auftrag_id=eq.${sid}&select=*&order=datum.desc`).catch(() => []); } catch (_) {}
  try {
    const mr = await sbGet(`gs_projekt_medien?service_auftrag_id=eq.${sid}&select=*&order=created_at.desc`).catch(() => []);
    medien = await Promise.all((mr || []).map(signMedien));
  } catch (_) {}
  // Was fehlt noch bis zum Abschluss — dieselbe Prüfung, die svcStatus fährt.
  // Der Client soll die Sperre ANZEIGEN können, statt sie erst beim Klick zu
  // erfahren. Für den Partner ist sie irrelevant (er schliesst nichts ab).
  let abschluss_offen = [];
  if (scope.role !== 'partner' && auftrag.status === 'in_arbeit') {
    abschluss_offen = await svcAbschlussHindernisse(sid);
  }
  const stunden = Math.round((rapporte || []).reduce((s, r) => s + num(r.gesamtstunden), 0) * 100) / 100;
  return { auftrag, techniker, rapporte, medien, stunden, abschluss_offen };
}
// Auftragsnummer SA-{JAHR}-{4-stellig}. Zieht denselben race-festen Zähler wie
// die Rapportnummer (INSERT … ON CONFLICT DO UPDATE … RETURNING) unter dem
// Schlüssel 'SERVICE'. Der Keyspace teilt sich mit den Kundenkürzeln — die sind
// dreistellig, ein siebenstelliges 'SERVICE' kann also nie kollidieren.
// Schlägt der Zähler fehl (nicht migriert), bleibt die Nummer leer statt den
// Auftrag scheitern zu lassen: ein Auftrag ohne Nummer ist ärgerlich,
// ein verlorener Auftrag ist schlimmer.
const SVC_NUMMER_KUERZEL = 'SERVICE';
async function zieheServiceNummer() {
  const jahr = new Date().getFullYear();
  try {
    const r = await sbWrite('POST', 'rpc/gs_rapport_nr_next', { p_kuerzel: SVC_NUMMER_KUERZEL, p_jahr: jahr });
    const nr = Array.isArray(r) ? r[0] : r;
    const n = Number(typeof nr === 'object' && nr ? nr.gs_rapport_nr_next : nr);
    if (!Number.isFinite(n) || n <= 0) return null;
    return `SA-${jahr}-${String(n).padStart(4, '0')}`;
  } catch (_) { return null; }
}

async function svcCreate(b, scope) {
  if (scope.role === 'techniker') throw new Forbidden();             // Techniker erstellt keine Aufträge
  const objekt = String(b.objekt || '').trim().slice(0, 200);
  if (!objekt) throw new Error('objekt nötig');
  const row = {
    objekt,
    beschreibung: b.beschreibung ? String(b.beschreibung).slice(0, 4000) : null,
    quelle: ['sprache', 'mail', 'manuell'].includes(b.quelle) ? b.quelle : 'manuell',
    status: 'neu',
    // Partner = Ersteller (serverseitig gesetzt). Master darf optional einem Partner zuordnen.
    partner_user_id: scope.role === 'partner' ? scope.partnerId : (b.partner_user_id ? uuid(b.partner_user_id) : null),
  };
  const nr = await zieheServiceNummer();
  if (nr) row.auftragsnummer = nr;
  try {
    const r = await sbWrite('POST', 'gs_service_auftrag', row);
    const auftrag = Array.isArray(r) ? r[0] : r;
    return { ok: true, auftrag };
  } catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}

// ── Status-Automat (fünf Status) ───────────────────────────────────────────
//   neu        → angenommen | abgelehnt
//   angenommen → in_arbeit  | abgelehnt
//   in_arbeit  → erledigt
//   erledigt / abgelehnt sind Endzustände.
// Rollen: Master darf alle Übergänge. Ein zugewiesener Techniker darf den
// Auftrag annehmen, starten und abschliessen — das ist sein ganzer Arbeitstag,
// dafür soll er nicht auf das Büro warten. Partner darf keinen Übergang.
const SVC_UEBERGAENGE = {
  neu: ['angenommen', 'abgelehnt'],
  angenommen: ['in_arbeit', 'abgelehnt'],
  in_arbeit: ['erledigt'],
  abgelehnt: [],
  erledigt: [],
};
const SVC_TECHNIKER_UEBERGAENGE = { neu: ['angenommen'], angenommen: ['in_arbeit'], in_arbeit: ['erledigt'] };

// Pflicht-Abschluss: 'erledigt' ist keine Schaltfläche, sondern ein Nachweis.
// Ohne erfasste Arbeit gibt es keinen Abschluss — sonst entsteht ein
// abgeschlossener Auftrag, zu dem niemand sagen kann, was getan wurde, und der
// Servicebericht wäre eine leere Seite.
//
// Geprüft wird gegen das, was das heutige Schema hergibt: mindestens eine
// Tageszeile auf diesem Auftrag mit Arbeitszeit oder beschriebener Tätigkeit.
// Die Liste ist bewusst EINE Funktion — kommen später Pflicht-Fotos oder eine
// Pflicht-Unterschrift dazu, wächst sie hier und nirgends sonst.
async function svcAbschlussHindernisse(sid) {
  const fehlt = [];
  const rap = await sbGet(
    `gs_tagesrapporte?service_auftrag_id=eq.${sid}&select=id,gesamtstunden,arbeiten,besonderheiten,taetigkeit`,
  ).catch(() => null);
  if (rap === null) return fehlt;                    // nicht lesbar → nicht blockieren
  const brauchbar = (rap || []).filter((r) => num(r.gesamtstunden) > 0
    || (Array.isArray(r.arbeiten) && r.arbeiten.filter(Boolean).length)
    || String(r.besonderheiten || '').trim());
  if (!brauchbar.length) fehlt.push('Es ist noch keine Arbeitszeit oder Tätigkeit erfasst.');
  return fehlt;
}

async function svcStatus(b, scope) {
  if (scope.role === 'partner') throw new Forbidden();
  const sid = uuid(b.id);
  const rows = await sbGet(`gs_service_auftrag?id=eq.${sid}&select=*&limit=1`).catch(() => []);
  const a = rows[0];
  if (!a) throw new Forbidden();
  const ziel = String(b.status || '');
  if (scope.role === 'techniker') {
    await assertServiceAccess(sid, scope, false);                   // muss zugewiesen sein
    if (!(SVC_TECHNIKER_UEBERGAENGE[a.status] || []).includes(ziel)) throw new Forbidden();
  } else if (scope.role !== 'master') {
    throw new Forbidden();
  } else if (!(SVC_UEBERGAENGE[a.status] || []).includes(ziel)) {
    return { error: `Übergang ${a.status} → ${ziel} nicht erlaubt` };
  }
  if (ziel === 'erledigt') {
    const fehlt = await svcAbschlussHindernisse(sid);
    if (fehlt.length) return { error: fehlt.join(' '), abschluss_offen: fehlt };
  }
  const now = new Date().toISOString();
  const patch = { status: ziel, updated_at: now };
  if (ziel === 'angenommen') patch.angenommen_am = now;
  if (ziel === 'erledigt') patch.erledigt_am = now;
  if (ziel === 'abgelehnt') patch.ablehn_grund = b.grund ? String(b.grund).slice(0, 500) : (a.ablehn_grund || null);
  try { const r = await sbWrite('PATCH', `gs_service_auftrag?id=eq.${sid}`, patch); return { ok: true, auftrag: Array.isArray(r) ? r[0] : r }; }
  catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}

// Auftragstext nachbessern. Master immer; Partner nur den eigenen und nur
// solange er noch nicht angenommen ist — danach arbeitet das Büro damit.
async function svcUpdate(b, scope) {
  if (scope.role === 'techniker') throw new Forbidden();
  const sid = await assertServiceAccess(b.id, scope, false);
  const rows = await sbGet(`gs_service_auftrag?id=eq.${sid}&select=status&limit=1`).catch(() => []);
  if (!rows[0]) throw new Forbidden();
  if (scope.role === 'partner' && rows[0].status !== 'neu') {
    return { error: 'Der Auftrag ist bereits in Bearbeitung und kann nicht mehr geändert werden.' };
  }
  const patch = { updated_at: new Date().toISOString() };
  if (b.objekt !== undefined) {
    const o = String(b.objekt || '').trim().slice(0, 200);
    if (!o) return { error: 'Objekt darf nicht leer sein.' };
    patch.objekt = o;
  }
  if (b.beschreibung !== undefined) patch.beschreibung = b.beschreibung ? String(b.beschreibung).slice(0, 4000) : null;
  try { const r = await sbWrite('PATCH', `gs_service_auftrag?id=eq.${sid}`, patch); return { ok: true, auftrag: Array.isArray(r) ? r[0] : r }; }
  catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}
// Servicebericht als PDF. Zugriff über dieselbe Kette wie svc_detail: Master
// alles, Partner nur eigene, Techniker nur zugewiesene. Rückgabe base64 —
// derselbe Weg wie pmExportPdf, damit der Client nichts Neues lernen muss.
async function svcBericht(b, scope) {
  const sid = await assertServiceAccess(b.id, scope, false);
  try {
    const { erzeugeServicebericht } = await import('../lib/servicebericht.js');
    const r = await erzeugeServicebericht(sid);
    return {
      ok: true,
      nummer: r.nummer,
      dateiname: `${r.nummer}.pdf`,
      fotos_im_pdf: r.fotos_im_pdf,
      branding: r.branding,
      pdf_base64: r.pdf.toString('base64'),
    };
  } catch (e) {
    if (isNoTable(e)) return { notMigrated: true };
    console.error('svc_bericht:', e && e.message);
    return { error: 'Der Servicebericht konnte nicht erzeugt werden: ' + ((e && e.message) || 'unbekannter Fehler') };
  }
}

// Techniker-Zuweisung — Master-only.
async function svcAssign(b, scope) {
  if (scope.role !== 'master') throw new Forbidden();
  const row = { service_auftrag_id: uuid(b.service_auftrag_id), techniker_id: uuid(b.techniker_id) };
  try {
    const r = await sbWrite('POST', 'gs_service_techniker?on_conflict=service_auftrag_id,techniker_id', row, 'resolution=merge-duplicates,return=representation');
    return { ok: true, row: Array.isArray(r) ? r[0] : r };
  } catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}
async function svcUnassign(b, scope) {
  if (scope.role !== 'master') throw new Forbidden();
  try { await sbWrite('DELETE', `gs_service_techniker?id=eq.${uuid(b.id)}`, {}, 'return=minimal'); return { ok: true }; }
  catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}

// ═══ Partner-Branding: Firmenprofil + Logo (gs_partner_profil) ══════════════
// Feature 'partner_branding'. Profil je Partner (partner_user_id = PK). Logo liegt
// im bestehenden Bucket 'projektdateien' unter _branding/<partnerId>/…; im Profil
// steht nur der PFAD (logo_url), signiert wird beim Lesen (frische URL, kein Ablauf).
const PARTNER_PROFIL_FELDER = ['firma', 'adresse', 'plz', 'ort', 'telefon', 'email'];
async function partnerProfilRead(pid) {
  const rows = await sbGet(`gs_partner_profil?partner_user_id=eq.${pid}&select=*&limit=1`).catch(() => []);
  const profil = (rows && rows[0]) || null;
  let logo_url_signed = null;
  if (profil && profil.logo_url) logo_url_signed = await sbSignUrl(PM_DATEI_BUCKET, profil.logo_url, 86400).catch(() => null);
  return { profil, logo_url_signed };
}
async function partnerProfilGet(scope) {
  const pid = scope && scope.partnerId;
  if (!pid) return { profil: null };   // Master hat kein Partner-Profil
  try { return await partnerProfilRead(pid); }
  catch (e) { if (isNoTable(e)) return { profil: null, notMigrated: true }; throw e; }
}
async function partnerProfilUpsert(pid, patch) {
  // Upsert auf den PK partner_user_id; merge-duplicates lässt nicht gesetzte Spalten unberührt.
  const r = await sbWrite('POST', 'gs_partner_profil?on_conflict=partner_user_id',
    { partner_user_id: pid, ...patch }, 'resolution=merge-duplicates,return=representation');
  return Array.isArray(r) ? r[0] : r;
}
async function partnerProfilSave(b, scope) {
  const pid = scope && scope.partnerId;
  if (!pid) throw new Forbidden();
  const patch = {};
  for (const f of PARTNER_PROFIL_FELDER) {
    if (b[f] === undefined) continue;
    const v = String(b[f] || '').trim().slice(0, 200);
    patch[f] = (f === 'firma') ? v : (v || null);
  }
  // Block 3 (Runde 7): Ansprechperson (echter Name). Spalte kommt via scripts/runde7.sql;
  // solange sie fehlt, darf der Rest des Profils trotzdem speicherbar bleiben.
  let ansprech;
  if (b.ansprechperson !== undefined) ansprech = String(b.ansprechperson || '').trim().slice(0, 200) || null;
  try {
    const full = (ansprech !== undefined) ? { ...patch, ansprechperson: ansprech } : patch;
    const profil = await partnerProfilUpsert(pid, full);
    let logo_url_signed = null;
    if (profil && profil.logo_url) logo_url_signed = await sbSignUrl(PM_DATEI_BUCKET, profil.logo_url, 86400).catch(() => null);
    return { ok: true, profil, logo_url_signed };
  } catch (e) {
    // Spalte ansprechperson noch nicht migriert → ohne sie speichern (kein Blocker).
    if (ansprech !== undefined && /ansprechperson/i.test((e && e.message) || '')) {
      const profil = await partnerProfilUpsert(pid, patch);
      let logo_url_signed = null;
      if (profil && profil.logo_url) logo_url_signed = await sbSignUrl(PM_DATEI_BUCKET, profil.logo_url, 86400).catch(() => null);
      return { ok: true, profil, logo_url_signed, ansprechperson_pending: true };
    }
    if (isNoTable(e)) return { error: 'Profil-Tabelle fehlt – scripts/submodus_migration.sql ausführen.', notMigrated: true };
    throw e;
  }
}
async function partnerLogoUpload(b, scope) {
  const pid = scope && scope.partnerId;
  if (!pid) throw new Forbidden();
  const buf = sbDecodeB64(b.data);
  if (!buf) throw new Error('Logo (base64) erforderlich');
  if (buf.length > 4 * 1024 * 1024) return { error: 'Logo zu gross (max. 4 MB)' };
  const safe = sbSafeName(b.filename || 'logo.png');
  const path = `_branding/${pid}/${nowStamp()}-${safe}`;
  const contentType = b.contentType || sbGuessType(safe);
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${PM_DATEI_BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: buf,
  });
  if (!up.ok) {
    const t = await up.text().catch(() => '');
    if (/bucket not found/i.test(t)) return { error: `Bucket '${PM_DATEI_BUCKET}' fehlt – scripts/projekt_detail_scharf.sql ausführen.`, notMigrated: true };
    console.error('logo upload fail', up.status, t);
    return { error: 'Upload fehlgeschlagen' };
  }
  try {
    const profil = await partnerProfilUpsert(pid, { logo_url: path });
    const logo_url_signed = await sbSignUrl(PM_DATEI_BUCKET, path, 86400).catch(() => null);
    return { ok: true, profil, logo_url_signed };
  } catch (e) {
    if (isNoTable(e)) return { error: 'Profil-Tabelle fehlt – scripts/submodus_migration.sql ausführen.', notMigrated: true };
    throw e;
  }
}

// ═══ Sub-/Akkordprojekte (Feature 'sub_akkord') ═════════════════════════════
// Eigene Projekte mit projekt_art='sub_akkord'; Lifecycle in sub_status. Sub-Detail-
// felder liegen in datenblatt.sub (jsonb, bereits vorhanden), Anzeige über standort/
// bereich (Spalten). Nur solange 'entwurf' (oder leer) editierbar; nach der Anfrage
// schreibgeschützt.
const SUB_EDITABLE = new Set([null, 'entwurf']);
function sanitizeSubDetail(o) {
  o = (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  // Leistungsarten (2. Ebene): Array von Kurzbegriffen. Grund: später Bobs
  // Trainingsmaterial (gs_bob_wissen). Dedupe, getrimmt, max 40 Einträge.
  const arr = Array.isArray(o.leistungsarten) ? o.leistungsarten : [];
  const seen = new Set(); const leistungsarten = [];
  arr.forEach((x) => { const v = clip(x, 80); if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); leistungsarten.push(v); } });
  return {
    strasse: clip(o.strasse, 160), plz: clip(o.plz, 12), ort: clip(o.ort, 120),
    beschreibung: clip(o.beschreibung, 2000), ansprechperson: clip(o.ansprechperson, 160),
    leistungsarten: leistungsarten.slice(0, 40),
  };
}
async function subProjekte(scope) {
  const pid = scope && scope.partnerId;
  if (!pid) return { projekte: [] };
  try {
    const projekte = ohneGeloeschte(await sbGet(`gs_projekte?partner_user_id=eq.${pid}&projekt_art=eq.sub_akkord&select=*&order=created_at.desc`));
    const seq = await anzeigeSeqMap(true);
    (projekte || []).forEach((p) => { p.anzeige_id = anzeigeIdFmt('sub_akkord', anzeigeJahr(p.created_at), seq[p.id] || 0); });
    // Block 5 (zahlplan-ux): minimales Angebots-Signal (NIE Entwurf, nur Status +
    // Zeitstempel, keine Positionen/Kalkulation) für den Ungelesen-Punkt beim
    // Partner: neues bzw. aktualisiertes Angebot lässt den Eintrag blinken.
    const ids = (projekte || []).map((p) => p.id);
    if (ids.length) {
      const angs = await sbGet(`gs_angebote?projekt_id=in.(${ids.join(',')})&status=neq.entwurf&select=projekt_id,status,abgeschickt_am,version&order=version.asc`).catch(() => []);
      const by = {}; (angs || []).forEach((a) => { by[a.projekt_id] = a; });
      (projekte || []).forEach((p) => { const a = by[p.id]; p.angebot_status = a ? a.status : null; p.angebot_abgeschickt_am = a ? (a.abgeschickt_am || null) : null; });
    }
    return { projekte };
  } catch (e) { if (isNoTable(e)) return { projekte: [], notMigrated: true }; throw e; }
}
async function subProjekt(id, scope) {
  id = uuid(id);
  const pr = await sbGet(`gs_projekte?id=eq.${id}&select=*&limit=1`);
  const projekt = pr && pr[0];
  if (!projekt || projekt.geloescht_at) return { error: 'Projekt nicht gefunden' };
  if (scope && scope.partnerId && projekt.partner_user_id !== scope.partnerId) throw new Forbidden();
  let dateien = [];
  try { dateien = await listProjektDateien(id); } catch (_) { dateien = []; }
  // Angebot (nur wenn der Master es abgeschickt/entschieden hat — nie ein Master-Entwurf)
  // + evtl. Auftragsbestätigung. So sieht der Partner das offene Angebot & kann entscheiden.
  let angebot = null, auftrag = null;
  try {
    // Nur das zuletzt ABGESCHICKTE Angebot (nie ein Master-Entwurf) + INTERN gefiltert.
    angebot = sanitizeAngebotForPartner(await msubLatestSentAngebot(id));
    auftrag = sanitizeAuftragForPartner(await subAuftrag(id));
  } catch (_) { /* Angebots-/AB-Tabelle evtl. noch nicht migriert → ohne */ }
  const anzeigeId = await projektAnzeigeId(projekt).catch(() => null);
  // Block 6: Zahlungsplan bleibt nach Annahme dauerhaft im Partner-Cockpit sichtbar.
  const zahlungsplan = await subZahlungsplanView(id).catch(() => null);
  return { projekt: { ...projekt, anzeige_id: anzeigeId }, dateien, angebot, auftrag, zahlungsplan };
}
// Partner entscheidet über ein abgeschicktes Angebot: annehmen | ablehnen | besprechung.
// Bei Annahme wird automatisch eine Auftragsbestätigung erzeugt. Server-seitig gescoped
// (requireOwnedProjekt → 403 bei fremdem Projekt) und gegen Doppelentscheidung geschützt.
async function subEntscheiden(b, scope) {
  const pid = uuid(b.projekt_id);
  await requireOwnedProjekt(pid, scope);
  const op = String(b.op || '');
  if (!['annehmen', 'ablehnen', 'besprechung'].includes(op)) return { error: 'Unbekannte Aktion' };
  try {
    const angebot = await msubLatestAngebot(pid);
    if (!angebot) return { error: 'Kein Angebot vorhanden.' };
    if (angebot.status === 'angenommen' || angebot.status === 'abgelehnt') return { error: 'Angebot wurde bereits entschieden.', decided: true };
    if (angebot.status !== 'abgeschickt' && angebot.status !== 'besprechung') return { error: 'Kein abgeschicktes Angebot vorhanden.' };
    const uid = (scope && scope.partnerId) || null;
    const now = new Date().toISOString();
    if (op === 'besprechung') {
      const r = await sbWrite('PATCH', `gs_angebote?id=eq.${angebot.id}`, { status: 'besprechung' });
      return { ok: true, angebot: Array.isArray(r) ? r[0] : r, sub_status: 'angebot_offen' }; // Projekt bleibt offen
    }
    const newStatus = op === 'annehmen' ? 'angenommen' : 'abgelehnt';
    const r = await sbWrite('PATCH', `gs_angebote?id=eq.${angebot.id}`, { status: newStatus, entschieden_am: now, entschieden_by: uid });
    await sbWrite('PATCH', `gs_projekte?id=eq.${pid}`, { sub_status: newStatus });
    let auftrag = null;
    if (op === 'annehmen') {
      const nummer = 'AB-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-6);
      const ar = await sbWrite('POST', 'gs_auftragsbestaetigung', { projekt_id: pid, angebot_id: angebot.id, nummer, gesamtbetrag: num(angebot.gesamtbetrag), bestaetigt_by: uid });
      auftrag = Array.isArray(ar) ? ar[0] : ar;
      // Block 6/5: Zahlungsplan aus der im Angebot EINGEFRORENEN (final editierten)
      // Kette materialisieren (inaktiv bis zur zweiten Annahme). Audit: angebot_angenommen_at.
      await subGenerateZahlungsplan(pid, angebot);
      try {
        await sbWrite('PATCH', `gs_projekte?id=eq.${pid}`, { angebot_angenommen_at: now, zahlungsplan_status: 'offen', zahlungsplan_aktiv: false }, 'return=minimal');
      } catch (e) { if (!/column|does not exist|PGRST204|schema cache/i.test((e && e.message) || '')) throw e; }
    }
    // Partner sieht die AB INTERN gefiltert: nur „angenommen" + Zeitstempel (Block 5)
    // sowie den frisch generierten (noch inaktiven) Zahlungsplan (Block 6).
    const zahlungsplan = op === 'annehmen' ? await subZahlungsplanView(pid).catch(() => null) : null;
    return { ok: true, angebot: Array.isArray(r) ? r[0] : r, sub_status: newStatus, auftrag: sanitizeAuftragForPartner(auftrag), zahlungsplan };
  } catch (e) { if (isNoTable(e)) return { error: 'Nicht migriert', notMigrated: true }; throw e; }
}
async function subAuftrag(projektId) {
  const rows = await sbGet(`gs_auftragsbestaetigung?projekt_id=eq.${projektId}&select=*&order=bestaetigt_am.desc&limit=1`).catch(() => []);
  return (rows && rows[0]) || null;
}
// Block 5 (Runde 6): Die Auftragsbestätigung (AB-Nummer + Dokument) ist INTERN.
// Der Partner sieht NUR die Tatsache „Auftrag angenommen" + Zeitstempel — nie die
// AB-Nummer, nie das AB-Dokument. Serverseitig aus dem Partner-Payload gefiltert.
function sanitizeAuftragForPartner(auf) {
  if (!auf) return null;
  return { angenommen: true, bestaetigt_am: auf.bestaetigt_am || null };
}

// ═══ Block 6 (Runde 6): Zahlungsplan-Generierung + zweite Annahme ═══════════
// Nach Angebot-Annahme wird aus dem ANGENOMMENEN Betrag (nicht aus der Kalkulation)
// der Zahlungsplan generiert: die bestehenden Bauabschnitte werden proportional auf
// den Angebotsbetrag skaliert und ihre Step-Ketten neu — aber INAKTIV — erzeugt.
// Summe aller Steps == angenommener Angebotsbetrag (Rappen-genau).
// Block 5 (Runde 7): Nach Angebot-Annahme wird die FINAL vom Master angepasste,
// im Angebot eingefrorene Step-Kette 1:1 materialisiert (nicht aus split_profil neu
// generiert — sonst gingen die Editor-Änderungen verloren). Fällt der Vorschlag (Alt-
// Angebot ohne Editor) weg, greift der frühere proportionale Generator als Fallback.
async function subGenerateZahlungsplan(pid, angebot) {
  const abs = await sbGet(`gs_bauabschnitte?projekt_id=eq.${pid}&select=*&order=reihenfolge.asc`).catch(() => []);
  if (!abs || !abs.length) return;
  const vorschlag = angebot && Array.isArray(angebot.bauabschnitt_vorschlag) ? angebot.bauabschnitt_vorschlag : null;
  const hasFrozenSteps = vorschlag && vorschlag.some((v) => Array.isArray(v.steps) && v.steps.length);
  if (hasFrozenSteps) {
    for (let i = 0; i < abs.length; i++) {
      const a = abs[i];
      const v = vorschlag.find((x) => String(x.name || '').trim() === String(a.name || '').trim()) || vorschlag[i];
      if (!v) continue;
      const steps = angNormSteps(v.steps);
      const betragChf = round2(steps.reduce((s, st) => (st.typ === 'zahlung' ? s + Math.round(num(st.betrag) * 100) : s), 0) / 100);
      await sbWrite('PATCH', `gs_bauabschnitte?id=eq.${a.id}`, { gesamtbetrag: betragChf }, 'return=minimal').catch(() => {});
      a.gesamtbetrag = betragChf;
      await zsWriteExplicitChain(a, steps); // inaktiv (alle Steps 'wartend')
    }
    return;
  }
  // Fallback (kein eingefrorener Editor-Vorschlag): proportional auf den Betrag skalieren.
  const total = Math.round(num(angebot && angebot.gesamtbetrag) * 100); // Rappen
  if (total <= 0) return;
  const curSum = abs.reduce((s, a) => s + num(a.gesamtbetrag), 0);
  let allocated = 0;
  for (let i = 0; i < abs.length; i++) {
    const a = abs[i];
    const shareC = (i === abs.length - 1)
      ? (total - allocated)
      : Math.round(curSum > 0 ? total * num(a.gesamtbetrag) / curSum : total / abs.length);
    if (i !== abs.length - 1) allocated += shareC;
    const betragChf = shareC / 100;
    await sbWrite('PATCH', `gs_bauabschnitte?id=eq.${a.id}`, { gesamtbetrag: betragChf }, 'return=minimal').catch(() => {});
    a.gesamtbetrag = betragChf;
    await zsGenerateChain(a, { activate: false });
  }
}
// Schreibt eine explizite (editierte) Step-Liste als inaktive Kette in einen Abschnitt:
// alte Steps löschen, neue + Escrow anlegen. Betrag/Bezeichnung/Typ kommen 1:1 aus dem
// eingefrorenen Vorschlag; ein Step = eine Transaktion (Stripe-Payment-Intent-tauglich).
async function zsWriteExplicitChain(abschnitt, steps) {
  await sbWrite('DELETE', `gs_steps?bauabschnitt_id=eq.${abschnitt.id}`, undefined, 'return=minimal');
  const stepRows = steps.map((s, i) => ({
    bauabschnitt_id: abschnitt.id, reihenfolge: i + 1, typ: s.typ,
    zahlung_art: s.typ === 'zahlung' ? (s.zahlung_art || 'fortschritt') : null,
    bezeichnung: s.bezeichnung, betrag: s.typ === 'zahlung' ? num(s.betrag) : 0, status: 'wartend',
  }));
  const inserted = await sbWrite('POST', 'gs_steps', stepRows);
  const idByR = {}; (inserted || []).forEach((r) => { idByR[r.reihenfolge] = r.id; });
  const escRows = [];
  stepRows.forEach((s, i) => { if (s.typ === 'zahlung') escRows.push({ step_id: idByR[i + 1], escrow_status: 'offen', betrag: s.betrag, rueckbehalt_prozent: 0 }); });
  if (escRows.length) await sbWrite('POST', 'gs_escrow', escRows, 'return=minimal');
}
// Partner-sichere Zahlungsplan-Ansicht (nur nach Angebot-Annahme). Enthält NIE
// split_profil/einheit_typ — nur Abschnittsname + Steps (Bezeichnung + Betrag + Status).
async function subZahlungsplanView(pid) {
  const prow = await sbGet(`gs_projekte?id=eq.${pid}&select=*&limit=1`).catch(() => []);
  const p = (prow && prow[0]) || {};
  if (p.sub_status !== 'angenommen') return null; // Plan erst nach Angebot-Annahme
  const abs = await sbGet(`gs_bauabschnitte?projekt_id=eq.${pid}&select=id,name,reihenfolge,gesamtbetrag&order=reihenfolge.asc`).catch(() => []);
  if (!abs || !abs.length) return null;
  const aktiv = p.zahlungsplan_aktiv === true || p.zahlungsplan_status === 'angenommen';
  let summe = 0, anzahlungHinterlegt = false;
  const abschnitte = [];
  for (const a of abs) {
    const steps = await sbGet(`gs_steps?bauabschnitt_id=eq.${a.id}&select=id,reihenfolge,typ,zahlung_art,bezeichnung,betrag,status&order=reihenfolge.asc`).catch(() => []);
    const outSteps = (steps || []).map((s) => ({
      id: s.id, reihenfolge: s.reihenfolge, typ: s.typ, zahlung_art: s.zahlung_art, bezeichnung: s.bezeichnung,
      betrag: num(s.betrag), status: s.status,
      hinterlegen_moeglich: aktiv && s.typ === 'zahlung' && s.status === 'aktiv',
    }));
    outSteps.forEach((s) => { if (s.typ === 'zahlung') summe += num(s.betrag); });
    const anz = outSteps.find((s) => s.zahlung_art === 'anzahlung');
    if (anz && ['hinterlegt', 'gs_fertig', 'freigegeben'].includes(anz.status)) anzahlungHinterlegt = true;
    abschnitte.push({ name: a.name || 'Abschnitt', gesamtbetrag: num(a.gesamtbetrag), steps: outSteps });
  }
  // Block 7: Anzahlung ist Startbedingung. Solange sie nicht hinterlegt ist,
  // zeigt der aktive Plan eine Statuszeile (Master + Partner, kein Blinken).
  const startbedingung = (aktiv && !anzahlungHinterlegt)
    ? { offen: true, master_hinweis: 'Anzahlung ausstehend – Termin nicht reserviert.', partner_hinweis: 'Bitte Anzahlung hinterlegen, damit der Termin verbindlich wird.' }
    : { offen: false };
  return {
    status: p.zahlungsplan_status || 'offen', aktiv,
    angebot_angenommen_at: p.angebot_angenommen_at || null,
    zahlungsplan_angenommen_at: p.zahlungsplan_angenommen_at || null,
    summe: round2(summe), abschnitte, anzahlung_hinterlegt: anzahlungHinterlegt, startbedingung,
  };
}
// Zweite Annahme: der Partner nimmt den generierten Zahlungsplan separat an. Erst
// danach wird das Zahlungssystem AKTIV (Steps scharf, „hinterlegen" klickbar).
async function subZahlungsplanAnnehmen(b, scope) {
  const pid = uuid(b.projekt_id);
  await requireOwnedProjekt(pid, scope);
  const rows = await sbGet(`gs_projekte?id=eq.${pid}&select=*&limit=1`).catch(() => []);
  const p = rows && rows[0];
  if (!p) return { error: 'Projekt nicht gefunden' };
  if (p.sub_status !== 'angenommen') return { error: 'Das Angebot ist noch nicht angenommen.' };
  if (p.zahlungsplan_status === 'angenommen' || p.zahlungsplan_aktiv === true) return { error: 'Der Zahlungsplan wurde bereits angenommen.', decided: true };
  const uid = (scope && scope.partnerId) || null;
  const now = new Date().toISOString();
  try {
    await sbWrite('PATCH', `gs_projekte?id=eq.${pid}`, { zahlungsplan_status: 'angenommen', zahlungsplan_angenommen_at: now, zahlungsplan_angenommen_by: uid, zahlungsplan_aktiv: true });
  } catch (e) {
    if (!/column|does not exist|PGRST204|schema cache/i.test((e && e.message) || '')) throw e; // Spalten fehlen → scripts/runde6.sql
  }
  // Steps scharf machen: der erste Zahlungs-Step (Anzahlung) wird hinterlegbar.
  const absIds = await sbGet(`gs_bauabschnitte?projekt_id=eq.${pid}&select=id&order=reihenfolge.asc`).catch(() => []);
  for (const a of (absIds || [])) { try { await zsRecompute(a.id); } catch (_) {} }
  return { ok: true, zahlungsplan: await subZahlungsplanView(pid) };
}
// Partner hinterlegt (Escrow-Stub) den aktuell fälligen Zahlungs-Step. Nur möglich,
// wenn der Zahlungsplan angenommen ist und der Step tatsächlich „aktiv" ist.
async function subStepHinterlegen(b, scope) {
  const stepId = uuid(b.step_id);
  const srows = await sbGet(`gs_steps?id=eq.${stepId}&select=*&limit=1`).catch(() => []);
  const step = srows && srows[0];
  if (!step) return { error: 'Step nicht gefunden' };
  const arows = await sbGet(`gs_bauabschnitte?id=eq.${step.bauabschnitt_id}&select=id,projekt_id&limit=1`).catch(() => []);
  const abschnitt = arows && arows[0];
  if (!abschnitt) return { error: 'Bauabschnitt nicht gefunden' };
  await requireOwnedProjekt(abschnitt.projekt_id, scope);
  const prow = await sbGet(`gs_projekte?id=eq.${abschnitt.projekt_id}&select=*&limit=1`).catch(() => []);
  const p = prow && prow[0];
  const aktiv = p && (p.zahlungsplan_aktiv === true || p.zahlungsplan_status === 'angenommen');
  if (!aktiv) return { error: 'Zahlungsplan noch nicht angenommen.' };
  if (step.typ !== 'zahlung') return { error: 'Kein Zahlungs-Step' };
  if (step.status !== 'aktiv') return { error: 'Dieser Schritt ist noch nicht an der Reihe.' };
  try {
    await escrowHinterlegen(stepId, zsSb);
    await zsRecompute(abschnitt.id);
  } catch (e) {
    if (isNoTable(e)) return { error: 'Nicht migriert', notMigrated: true };
    return { error: (e && e.message) || 'Hinterlegen fehlgeschlagen' };
  }
  return { ok: true, zahlungsplan: await subZahlungsplanView(abschnitt.projekt_id) };
}
// Profil vollständig? Pflichtfelder Firma/Adresse/PLZ/Ort (Firmenadresse, NICHT Baustelle).
async function partnerProfilComplete(pid) {
  const { profil } = await partnerProfilRead(pid).catch(() => ({ profil: null }));
  const ok = !!(profil && String(profil.firma || '').trim() && String(profil.adresse || '').trim()
    && String(profil.plz || '').trim() && String(profil.ort || '').trim());
  return { ok, profil: profil || null };
}
async function subProjektSave(b, scope) {
  const pid = scope && scope.partnerId;
  if (!pid) throw new Forbidden();
  // Aufgabe 5: ohne vollständiges Firmenprofil kein NEUES Projekt.
  if (!b.id) {
    const pc = await partnerProfilComplete(pid).catch(() => ({ ok: true })); // Tabelle fehlt → nicht blockieren
    if (pc.ok === false) return { error: 'Bitte zuerst das Firmenprofil ausfüllen (Firma, Adresse, PLZ, Ort) unter ⚙️ Einstellungen.', profileIncomplete: true };
  }
  let existing = null;
  if (b.id) {
    await requireOwnedProjekt(b.id, scope);
    const rows = await sbGet(`gs_projekte?id=eq.${uuid(b.id)}&select=sub_status,datenblatt&limit=1`).catch(() => []);
    existing = (rows && rows[0]) || null;
    if (existing && !SUB_EDITABLE.has(existing.sub_status || null)) return { error: 'Projekt ist bereits angefragt und schreibgeschützt.', locked: true };
  }
  const det = sanitizeSubDetail(b);
  const standort = [det.strasse, [det.plz, det.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const patch = { projekt_art: 'sub_akkord' };
  if (b.name !== undefined) patch.name = String(b.name || '').trim().slice(0, 120);
  patch.standort = standort || null;
  if (b.bereich !== undefined) patch.bereich = String(b.bereich || '').trim().slice(0, 120) || null;
  const db = (existing && existing.datenblatt && typeof existing.datenblatt === 'object' && !Array.isArray(existing.datenblatt)) ? existing.datenblatt : {};
  db.sub = { ...det, updated_at: new Date().toISOString() };
  patch.datenblatt = db;
  if (!b.id) {
    patch.partner_user_id = pid; patch.sub_status = 'entwurf'; patch.status = 'aktiv';
    if (!patch.name) return { error: 'Name erforderlich' };
  }
  try {
    const r = b.id
      ? await sbWrite('PATCH', `gs_projekte?id=eq.${uuid(b.id)}`, patch)
      : await sbWrite('POST', 'gs_projekte', patch);
    return { ok: true, projekt: Array.isArray(r) ? r[0] : r };
  } catch (e) {
    if (/column|does not exist|PGRST204|schema cache/i.test((e && e.message) || '')) return { error: 'Sub-Modus-Spalten fehlen – scripts/submodus_migration.sql ausführen.', notMigrated: true };
    throw e;
  }
}
async function subAnfrage(b, scope) {
  const id = uuid(b.id);
  await requireOwnedProjekt(id, scope);
  const rows = await sbGet(`gs_projekte?id=eq.${id}&select=sub_status,projekt_art&limit=1`).catch(() => []);
  const cur = rows && rows[0];
  if (!cur) return { error: 'Projekt nicht gefunden' };
  if (cur.projekt_art !== 'sub_akkord') return { error: 'Kein Sub-/Akkordprojekt' };
  if (!SUB_EDITABLE.has(cur.sub_status || null)) return { error: 'Anfrage bereits abgeschickt.', locked: true };
  try {
    const r = await sbWrite('PATCH', `gs_projekte?id=eq.${id}`, { sub_status: 'angefragt', angefragt_am: new Date().toISOString() });
    return { ok: true, projekt: Array.isArray(r) ? r[0] : r };
  } catch (e) {
    if (/column|does not exist|PGRST204|schema cache/i.test((e && e.message) || '')) return { error: 'Sub-Modus-Spalten fehlen – scripts/submodus_migration.sql ausführen.', notMigrated: true };
    throw e;
  }
}

// ══ BLOCK 3 (Runde 8a): Projekte löschen (Soft-Delete geloescht_at) ═════════
// Gelöschte Projekte verschwinden aus allen Listen (ohneGeloeschte), bleiben in
// der DB. Master: jedes Sub-Projekt, ausser es liegt Escrow-Geld — dann nur
// Stornierung. Partner: nur eigene Projekte, nur solange sub_status='entwurf'.
async function projektHatEscrowGeld(pid) {
  const abs = await sbGet(`gs_bauabschnitte?projekt_id=eq.${pid}&select=id`).catch(() => []);
  for (const a of (abs || [])) {
    const steps = await sbGet(`gs_steps?bauabschnitt_id=eq.${a.id}&select=status`).catch(() => []);
    if ((steps || []).some((s) => ['hinterlegt', 'gs_fertig', 'freigegeben'].includes(s.status))) return true;
  }
  return false;
}
async function projektSoftDelete(pid) {
  try {
    await sbWrite('PATCH', `gs_projekte?id=eq.${pid}`, { geloescht_at: new Date().toISOString() }, 'return=minimal');
    return { ok: true };
  } catch (e) {
    if (/column|does not exist|PGRST204|schema cache/i.test((e && e.message) || '')) return { error: 'Spalte geloescht_at fehlt – scripts/runde8a.sql ausführen.', notMigrated: true };
    throw e;
  }
}
async function msubProjektDel(b, access) {
  msubAssertMaster(access);
  try {
    const id = uuid(b.id);
    const rows = await sbGet(`gs_projekte?id=eq.${id}&select=*&limit=1`).catch(() => []);
    const p = rows && rows[0];
    if (!p || p.geloescht_at) return { error: 'Projekt nicht gefunden' };
    if (p.projekt_art !== 'sub_akkord') return { error: 'Kein Sub-/Akkordprojekt' };
    // Block 4 (zahlplan-ux): Testprojekte mit Escrow-Stub-Geld blockierten die
    // Test-Bereinigung dauerhaft. force=true (nur Master, UI verlangt doppelte
    // Bestätigung) löscht trotzdem — Soft-Delete, Daten bleiben in der DB.
    // ACHTUNG: vor Stripe-Go-Live (echtes Geld statt Stub) wieder einschränken.
    if (await projektHatEscrowGeld(id) && b.force !== true) {
      return { error: 'Escrow-Geld hinterlegt – Projekt kann nicht gelöscht werden. Nur Stornierung möglich.', escrowLocked: true };
    }
    return await projektSoftDelete(id);
  } catch (e) { if (isNoTable(e)) return { error: 'Nicht migriert', notMigrated: true }; throw e; }
}
async function subProjektDel(b, scope) {
  const id = uuid(b.id);
  await requireOwnedProjekt(id, scope);
  const rows = await sbGet(`gs_projekte?id=eq.${id}&select=*&limit=1`).catch(() => []);
  const p = rows && rows[0];
  if (!p || p.geloescht_at) return { error: 'Projekt nicht gefunden' };
  if (p.projekt_art !== 'sub_akkord') return { error: 'Kein Sub-/Akkordprojekt' };
  if (!SUB_EDITABLE.has(p.sub_status || null)) return { error: 'Anfrage ist bereits abgeschickt – Projekt kann nicht mehr gelöscht werden.', locked: true };
  return await projektSoftDelete(id);
}

// ── PDF-Export pro Abschnitt (wiederverwendet lib/pdf.buildPdf) ────────────
// Liefert das PDF als base64 zurück; das Cockpit macht daraus einen Download.
//
// Bauen und Ausliefern sind getrennt: baueExportPdf() liefert die Bytes, die
// drei export*-Wrapper machen daraus die unveraenderte Download-Antwort, und
// exportVersenden() haengt DIESELBEN Bytes an eine Mail. Ein Dokument, ein
// Erzeuger — sonst weicht das versendete PDF irgendwann vom geladenen ab.
function pdfResult(buf, filename) {
  return { ok: true, filename, pdf_base64: Buffer.from(buf).toString('base64') };
}
// Absender wie ueberall sonst beim Dokumentversand (lib/mail.js, api/blockaden.js,
// lib/wochenbericht.js): fix das Buero, nie der eingeloggte Benutzer.
const EXPORT_ABSENDER = 'George Solutions <info@george-solutions.ch>';
function chf(n) { return 'CHF ' + Number(n || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function projektHead(projektId) {
  const pr = await sbGet(`gs_projekte?id=eq.${projektId}&select=name,projektnummer,standort&limit=1`).catch(() => []);
  return (pr && pr[0]) || {};
}

async function baueMaterial(projektId, scope) {
  projektId = uuid(projektId);
  await requireOwnedProjekt(projektId, scope);
  const p = await projektHead(projektId);
  const mat = await sbGet(`gs_material?projekt_id=eq.${projektId}&select=*&order=created_at.desc`).catch(() => []);
  const blocks = [
    { t: 'h1', text: 'Materialliste' },
    { t: 'kv', label: 'Projekt', value: p.name || '–' },
    { t: 'kv', label: 'Projektnummer', value: p.projektnummer || '–' },
    { t: 'kv', label: 'Datum', value: new Date().toISOString().slice(0, 10) },
    { t: 'sp', size: 8 },
    { t: 'h2', text: `Positionen (${mat.length})` },
  ];
  let sum = 0;
  if (!mat.length) blocks.push({ t: 'text', text: 'Kein Material erfasst.' });
  for (const m of mat) {
    const menge = m.menge != null ? Number(m.menge) : null;
    const preis = m.einzelpreis != null ? Number(m.einzelpreis) : null;
    const zeile = (preis != null && menge != null) ? menge * preis : null;
    if (zeile != null) sum += zeile;
    const mengeTxt = [menge != null ? menge : '', m.einheit || ''].filter((x) => x !== '').join(' ') || '—';
    const val = [mengeTxt, preis != null ? `à ${chf(preis)}` : '', zeile != null ? `= ${chf(zeile)}` : '', m.status ? `(${m.status})` : '']
      .filter(Boolean).join('  ');
    blocks.push({ t: 'kv', label: String(m.bezeichnung || '–').slice(0, 46), value: val });
  }
  blocks.push({ t: 'sp', size: 6 });
  blocks.push({ t: 'kv', label: 'Summe Material', value: chf(sum) });
  blocks.push({ t: 'sp', size: 8 });
  blocks.push({ t: 'text', text: `Erstellt: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · George Solutions` });
  return {
    buf: buildPdf({ title: 'George Solutions', blocks }),
    filename: `Materialliste_${(p.projektnummer || 'projekt')}.pdf`,
    titel: 'Materialliste', kopf: p, anzahl: mat.length, summe: sum,
  };
}

async function baueRapporte(projektId, scope) {
  projektId = uuid(projektId);
  await requireOwnedProjekt(projektId, scope);
  const p = await projektHead(projektId);
  let raps = [];
  try { raps = await sbGet(`gs_tagesrapporte?projekt_id=eq.${projektId}&select=*&order=datum.asc`); } catch (_) { raps = []; }
  // Techniker-Namen anreichern.
  const uids = [...new Set(raps.map((r) => r.techniker_user_id).filter(Boolean))];
  const nameByUid = {};
  if (uids.length) {
    const ts = await sbGet(`gs_techniker?user_id=in.(${uids.join(',')})&select=user_id,name`).catch(() => []);
    for (const t of ts) if (t.user_id) nameByUid[t.user_id] = t.name;
  }
  // ZIEL 3 (Feinschliff II) — Rapportnummern der beteiligten Wochenköpfe.
  // Pro KW können mehrere sein (je Techniker ein eigener Wochenkopf), darum
  // Menge statt Einzelwert. Fehlt die Tabelle/Spalte noch → einfach leer.
  //
  // NUR MASTER. pm_export_rapporte steht in PM_ACTIONS, ein Partner exportiert
  // damit sein eigenes Projekt. Die Rapportnummer trägt aber das Kürzel des
  // Kunden, über den der Wochenkopf ANGELEGT wurde — bei einer Woche, die auf
  // mehreren Baustellen lief, ist das ein fremder Kunde. Der Partner bekäme
  // damit ein Kürzel zu sehen, das ihn nichts angeht. Für ihn bleibt das PDF
  // unverändert wie bisher.
  const wrIds = (scope && scope.isMaster)
    ? [...new Set(raps.map((r) => r.wochenrapport_id).filter(Boolean))]
    : [];
  const nrByWr = {};
  if (wrIds.length) {
    const wrs = await sbGet(`gs_wochenrapporte?id=in.(${wrIds.join(',')})&select=id,rapport_nr`).catch(() => []);
    for (const w of wrs) if (w.rapport_nr) nrByWr[w.id] = w.rapport_nr;
  }
  // Nach KW gruppieren.
  const groups = new Map();
  for (const r of raps) { const k = `${r.jahr}-${String(r.woche).padStart(2, '0')}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const blocks = [
    { t: 'h1', text: 'Arbeitsrapporte' },
    { t: 'kv', label: 'Projekt', value: p.name || '–' },
    { t: 'kv', label: 'Projektnummer', value: p.projektnummer || '–' },
    { t: 'kv', label: 'Rapporte', value: String(raps.length) },
    { t: 'sp', size: 8 },
  ];
  let total = 0;
  const keys = [...groups.keys()].sort();
  for (const k of keys) {
    const rows = groups.get(k);
    let sumH = 0; let anyOffen = false;
    rows.forEach((r) => { sumH += Number(r.gesamtstunden || 0); if ((r.abrechnung_status || 'offen') !== 'verrechnet') anyOffen = true; });
    total += sumH;
    const [jahr, woche] = k.split('-');
    blocks.push({ t: 'h2', text: `KW ${Number(woche)}/${jahr} · ${sumH.toFixed(1)} h · ${anyOffen ? 'offen' : 'verrechnet'}` });
    // ZIEL 3 — Rapportnummer(n) dieser Woche direkt unter die Überschrift.
    const nrs = [...new Set(rows.map((r) => nrByWr[r.wochenrapport_id]).filter(Boolean))].sort();
    if (nrs.length) blocks.push({ t: 'kv', label: nrs.length > 1 ? 'Rapportnummern' : 'Rapportnummer', value: nrs.join(', ') });
    for (const r of rows) {
      const arb = (Array.isArray(r.arbeiten) ? r.arbeiten.join(' · ') : (r.arbeiten || '')).slice(0, 70);
      blocks.push({ t: 'kv', label: `${r.datum} · ${nameByUid[r.techniker_user_id] || 'Techniker'}`, value: `${Number(r.gesamtstunden || 0)} h  ${arb}` });
    }
    blocks.push({ t: 'sp', size: 4 });
  }
  if (!raps.length) blocks.push({ t: 'text', text: 'Keine Rapporte auf diesem Projekt.' });
  blocks.push({ t: 'sp', size: 4 });
  blocks.push({ t: 'kv', label: 'Total Stunden', value: `${total.toFixed(1)} h` });
  blocks.push({ t: 'sp', size: 8 });
  blocks.push({ t: 'text', text: `Erstellt: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · George Solutions` });
  return {
    buf: buildPdf({ title: 'George Solutions', blocks }),
    filename: `Arbeitsrapporte_${(p.projektnummer || 'projekt')}.pdf`,
    titel: 'Arbeitsrapporte', kopf: p, anzahl: raps.length, summe: null,
    zusatz: `${total.toFixed(1)} h`,
  };
}

async function baueRechnungen(projektId, scope) {
  projektId = uuid(projektId);
  await requireOwnedProjekt(projektId, scope);
  const p = await projektHead(projektId);
  const rechs = await sbGet(`gs_rechnungen?projekt_id=eq.${projektId}&select=*&order=created_at.desc`).catch(() => []);
  const blocks = [
    { t: 'h1', text: 'Rechnungs-History' },
    { t: 'kv', label: 'Projekt', value: p.name || '–' },
    { t: 'kv', label: 'Projektnummer', value: p.projektnummer || '–' },
    { t: 'kv', label: 'Rechnungen', value: String(rechs.length) },
    { t: 'sp', size: 8 },
    { t: 'h2', text: 'Rechnungen' },
  ];
  let sum = 0;
  if (!rechs.length) blocks.push({ t: 'text', text: 'Keine Rechnungen zu diesem Projekt.' });
  for (const r of rechs) {
    sum += Number(r.betrag || 0);
    const datum = r.created_at ? String(r.created_at).slice(0, 10) : '';
    const val = [chf(r.betrag), r.stunden != null ? `${r.stunden} h × ${chf(r.stundensatz)}` : '', r.status || '', datum].filter(Boolean).join('  ·  ');
    blocks.push({ t: 'kv', label: String(r.rechnungsnummer || 'Rechnung').slice(0, 40), value: val });
  }
  blocks.push({ t: 'sp', size: 6 });
  blocks.push({ t: 'kv', label: 'Gesamtsumme', value: chf(sum) });
  blocks.push({ t: 'sp', size: 8 });
  blocks.push({ t: 'text', text: `Erstellt: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · George Solutions` });
  return {
    buf: buildPdf({ title: 'George Solutions', blocks }),
    filename: `Rechnungen_${(p.projektnummer || 'projekt')}.pdf`,
    titel: 'Rechnungs-History', kopf: p, anzahl: rechs.length, summe: sum,
  };
}

// Ein Dispatcher fuer alle drei Abschnitte. requireOwnedProjekt steckt in jedem
// Bauer drin — es ist die einzige Scope-Pruefung dieser Exporte.
const EXPORT_BAUER = { material: baueMaterial, rapporte: baueRapporte, rechnungen: baueRechnungen };

async function baueExportPdf(kind, projektId, scope) {
  const bauer = EXPORT_BAUER[String(kind || '')];
  if (!bauer) throw new Error('Unbekannte Export-Art');
  return await bauer(projektId, scope);
}

// Die drei Download-Wrapper. Bestehende Felder unveraendert: { ok, filename,
// pdf_base64 }. Fuer den Master kommt der Empfaenger-Vorschlag dazu, damit die
// Pruef-Ansicht das Versandfeld gleich vorbelegen kann — der Partner sieht ihn
// nicht, er darf in dieser Runde nicht versenden.
async function exportMitVorschlag(bauer, projektId, scope) {
  const r = await bauer(projektId, scope);
  const antwort = pdfResult(r.buf, r.filename);
  // scope traegt role, kein isMaster (siehe Aufbau im Handler) — hier wird
  // genau das geprueft, was tatsaechlich gesetzt wird.
  if (!scope || scope.role !== 'master') return antwort;
  const vor = await empfaengerVorschlag(projektId);
  return {
    ...antwort,
    empfaenger_vorschlag: vor.liste,
    empfaenger_herkunft: vor.herkunft,
    empfaenger_herkunft_text: vor.herkunft ? (EMPFAENGER_HERKUNFT_TEXT[vor.herkunft] || null) : null,
  };
}
async function exportMaterial(projektId, scope)   { return exportMitVorschlag(baueMaterial, projektId, scope); }
async function exportRapporte(projektId, scope)   { return exportMitVorschlag(baueRapporte, projektId, scope); }
async function exportRechnungen(projektId, scope) { return exportMitVorschlag(baueRechnungen, projektId, scope); }

// ── Empfaenger fuer einen Projekt-Export ──────────────────────────────────
// Die Exporte haben keinen Berichtskopf wie der Wochenbericht. Statt eine
// zweite Kette zu bauen, wird hier nur das Kopf-Objekt zusammengetragen, das
// empfaengerFuer erwartet — die Reihenfolge selbst liegt weiter in
// lib/wochenbericht.js. Aendert sie sich dort, aendert sie sich hier mit.
async function empfaengerVorschlag(projektId, angefragt = null) {
  const pr = await sbGet(`gs_projekte?id=eq.${projektId}&select=ansprech_email,kunde_id,partner_user_id&limit=1`).catch(() => []);
  const p = (pr && pr[0]) || {};
  let kundeEmail = null;
  if (p.kunde_id) {
    const kd = await sbGet(`gs_kunden?id=eq.${p.kunde_id}&select=email&limit=1`).catch(() => []);
    kundeEmail = (kd[0] || {}).email || null;
  }
  let partnerEmail = null;
  if (p.partner_user_id) {
    const pp = await sbGet(`gs_partner_profil?partner_user_id=eq.${p.partner_user_id}&select=email&limit=1`).catch(() => []);
    partnerEmail = (pp[0] || {}).email || null;
  }
  return empfaengerFuer({
    angefragt,
    kopfRow: null,
    daten: { kopf: { ansprech_email: p.ansprech_email || null, kunde_email: kundeEmail, partner_email: partnerEmail } },
  });
}

// ── Export versenden (Master) ─────────────────────────────────────────────
// Baut DASSELBE PDF wie der Download (baueExportPdf) und haengt es an eine
// Mail. Kein zweiter Erzeuger, kein zweites Layout.
//
// Wie beim Wochenbericht gilt: nur ein von Resend bestaetigtes ok:true ist ein
// Versand. Ein Fehlschlag darf nie wie Erfolg aussehen.
//
// Anders als der Wochenbericht wird hier NICHTS eingefroren und nichts
// protokolliert: diese Exporte haben keinen Berichtskopf in der DB, und dafuer
// eine Tabelle anzulegen waere eine Migration — die gehoert nicht in diese
// Runde. Die Mail sagt deshalb ausdruecklich, dass sie einen Stand abbildet.
async function exportVersenden(b, scope) {
  const kind = String(b.kind || '');
  if (!EXPORT_BAUER[kind]) return { ok: false, error: 'Unbekannte Export-Art' };
  const projektId = uuid(b.projekt_id);
  // Scope-Pruefung passiert im Bauer (requireOwnedProjekt) — vor jedem Lesen.
  const r = await baueExportPdf(kind, projektId, scope);

  const { liste, herkunft, ungueltig } = await empfaengerVorschlag(projektId, b.empfaenger);
  if (!liste.length) {
    return {
      ok: false, versendet: false,
      error: ungueltig
        ? 'Die eingetragene Empfängeradresse ist keine gültige E-Mail. Bitte korrigieren — es wurde nichts versendet.'
        : 'Keine gültige Empfängeradresse. Bitte Empfänger angeben — oder eine E-Mail beim Projekt (Ansprechperson), beim Kunden oder im Partnerprofil hinterlegen.',
    };
  }

  const p = r.kopf || {};
  const betreff = `${r.titel} · ${p.name || 'Projekt'}${p.projektnummer ? ' · ' + p.projektnummer : ''}`;
  const mail = await sendResendEmail({
    to: liste,
    from: EXPORT_ABSENDER,
    subject: betreff,
    html: exportEmailHtml({
      titel: r.titel, projektName: p.name, projektnummer: p.projektnummer,
      anzahl: r.anzahl, summe: r.summe, zusatz: r.zusatz,
    }),
    attachments: [{ filename: r.filename, content: Buffer.from(r.buf).toString('base64') }],
  });
  const erfolg = !!(mail && mail.ok);
  return {
    ok: erfolg, versendet: erfolg,
    empfaenger: liste, empfaenger_herkunft: herkunft,
    filename: r.filename, anzahl: r.anzahl,
    error: erfolg ? null : ((mail && (mail.error || (mail.skipped ? 'Mailversand ist nicht konfiguriert (RESEND_API_KEY fehlt).' : null))) || 'Versand fehlgeschlagen'),
  };
}

// Storage-Helfer (Muster aus api/projectflow.js).
async function sbSignUrl(bucket, path, expiresIn = 3600) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, { method: 'POST', headers: SB, body: JSON.stringify({ expiresIn }) });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return d.signedURL ? SUPABASE_URL + '/storage/v1' + d.signedURL : null;
}
// Was liegt WIRKLICH unter diesem Pfad? Nach einem Direktupload ist das die
// einzige ehrliche Quelle: `groesse` kommt sonst aus dem Body, also von dem,
// der gerade hochgeladen hat. Wer beim Signieren 1 MB behauptet und 500 MB
// ablegt, kaeme sonst durch — die Videopruefung haengt an derselben Zahl.
// Benutzt denselben Listen-Endpunkt wie die Projektdateien-Kachel.
async function sbObjektInfo(bucket, path) {
  const i = String(path).lastIndexOf('/');
  const prefix = i >= 0 ? String(path).slice(0, i + 1) : '';
  const name = i >= 0 ? String(path).slice(i + 1) : String(path);
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST', headers: SB,
      body: JSON.stringify({ prefix, search: name, limit: 100 }),
    });
    if (!r.ok) return null;
    const objs = await r.json().catch(() => []);
    const treffer = (Array.isArray(objs) ? objs : []).find((o) => o && o.name === name && o.id !== null);
    if (!treffer) return null;
    return { size: Number((treffer.metadata && treffer.metadata.size) || 0), mimetype: (treffer.metadata && treffer.metadata.mimetype) || null };
  } catch (_) { return null; }
}

function sbDecodeB64(s) {
  if (!s || typeof s !== 'string') return null;
  const raw = s.includes(',') ? s.split(',')[1] : s;
  try { const b = Buffer.from(raw, 'base64'); return b.length ? b : null; } catch { return null; }
}
function sbSafeName(n) { return String(n || 'datei').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120) || 'datei'; }
function sbDisplayName(n) { return String(n).replace(/^\d{10,}-/, ''); }
function nowStamp() { return String(Date.now()); }
function sbGuessType(n) {
  const e = String(n).toLowerCase().split('.').pop();
  return {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
    dwg: 'application/acad', dxf: 'image/vnd.dxf',
    // Video (Phase 4). Ohne diese beiden riet der Typ auf octet-stream und der
    // Bucket lieferte das Video spaeter als Download statt als Video aus.
    mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4',
  }[e] || 'application/octet-stream';
}

// ═══════════════════════════════════════════════════════════════════════════
// ZAHLUNGSSYSTEM (Escrow-Engine) — Master-only.
//   Tabellen (bereits migriert): gs_bauabschnitte, gs_steps, gs_escrow,
//   gs_split_profile, gs_bob_wissen. Der Server nutzt service_role (SB/sbGet/
//   sbWrite). Stripe ist ein Stub (api/escrow_stripe.js) — es fliesst kein Geld.
// ═══════════════════════════════════════════════════════════════════════════

// DB-Accessor fuer den Stripe-Stub (Dependency-Injection statt 2. SB-Client).
const zsSb = { get: sbGet, write: sbWrite };

// ── Entitlement-Gate fuer das Zahlungssystem-Modul ──────────────────────────
// Master hat den Feature-Key 'zahlungssystem' IMMER. Partner nur, wenn er in der
// Master-Cockpit-Matrix freigeschaltet ist (gs_partner_entitlements).
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ TODO Partner-Variante / Submodus haengt hier ein:                          │
// │ Damit ein freigeschalteter Partner (oder Subunternehmer) das Modul nutzen  │
// │ kann, muss                                                                 │
// │   1) resolveAccess() die zs_*-Actions fuer Partner zulassen (analog zu     │
// │      PM_ACTIONS: eigenes Set + isEntitled-Pruefung),                       │
// │   2) jede zs_*-Funktion server-seitig auf EIGENE Projekte gescoped werden  │
// │      (requireOwnedProjekt / requireOwnedRow wie im PM-Modul),              │
// │   3) evtl. ein Subunternehmer-Submodus mit eingeschraenkter Sicht (nur     │
// │      zugewiesene Bauabschnitte) ergaenzt werden.                           │
// │ Diese requireZahlungssystem-Pruefung greift dann automatisch fuer Partner. │
// └───────────────────────────────────────────────────────────────────────────┘
async function requireZahlungssystem(access) {
  if (!access) throw new Forbidden();
  if (access.isMaster) return;                                  // Master: immer berechtigt
  if (!await isEntitled(access.userId, 'zahlungssystem')) throw new Forbidden();
}

// gs_bauabschnitte fehlt (noch nicht migriert)? → sauberer Hinweis statt 500.
function zsNotMigrated(e) { return { error: 'Zahlungssystem nicht migriert', notMigrated: true, detail: (e && e.message) || '' }; }

// Split-Profile (Datensaetze) laden — fuer das Anlage-Formular.
async function zsProfile() {
  try {
    const rows = await sbGet('gs_split_profile?select=name,bezeichnung,verteilung&order=name.asc');
    return { profile: rows || [] };
  } catch (e) { if (isNoTable(e)) return zsNotMigrated(e); throw e; }
}

// Verteilung eines Profils lesen (jsonb → Objekt). Fallback wenn Datensatz fehlt.
async function zsVerteilung(profil) {
  const rows = await sbGet(`gs_split_profile?name=eq.${encodeURIComponent(profil)}&select=verteilung&limit=1`).catch(() => []);
  const v = rows && rows[0] && rows[0].verteilung;
  if (v && typeof v === 'object') return v;
  return { anzahlung: 15, einheiten: 70, abnahme: 15, rueckbehalt: 10 };
}

// Step-Spezifikation je Profil (Reihenfolge = Array-Reihenfolge; Betraege folgen
// in zsAllocate). fortschritt:true → teilt sich den einheiten-Prozentblock.
function zsBuildSpecs(profil, einheitAnzahl, vert, teamTage) {
  const units = Math.max(1, einheitAnzahl | 0);
  const rb = num(vert.rueckbehalt) || 0;
  // Block 3 (Runde 6): GS finanziert nie länger als eine Woche vor. Pro
  // angefangene 5 Team-Tage entsteht ein zusätzlicher Fortschritts-Step. Die
  // Anzahl der Fortschritts-Steps ist damit max(Einheiten, aufgerundete Wochen).
  const wochen = Math.max(1, Math.ceil(num(teamTage) / 5));
  const fortschrittN = Math.max(units, wochen);
  // Benennung der Fortschritts-Kette: 1 → „Fortschritt"; mehrere → „Zwischen-
  // zahlung KW n" (freitags) und der letzte Schritt „Installation fertig".
  const fortschrittBez = (i, n) => n === 1 ? 'Fortschritt' : (i === n ? 'Installation fertig' : `Zwischenzahlung KW ${i}`);
  const specs = [];
  if (profil === 'komplex_15_25_50_10') {
    const ms = Array.isArray(vert.meilensteine) ? vert.meilensteine : [25, 50];
    const msNames = ['Speicher gestellt', 'Installation komplett'];
    specs.push({ typ: 'zahlung', art: 'anzahlung', bezeichnung: 'Anzahlung', pct: num(vert.anzahlung) });
    ms.forEach((p, i) => specs.push({ typ: 'zahlung', art: 'meilenstein', bezeichnung: msNames[i] || `Meilenstein ${i + 1}`, pct: num(p) }));
    specs.push({ typ: 'zahlung', art: 'abnahme', bezeichnung: 'Abnahme', pct: num(vert.abnahme), rueckbehalt: rb });
  } else if (profil === 'endmontage_30_70') {
    specs.push({ typ: 'zahlung', art: 'anzahlung', bezeichnung: 'Anzahlung', pct: num(vert.anzahlung) });
    for (let i = 1; i <= units; i++) {
      const last = i === units; // letzte Einheit = Abnahme (kein separater Abnahme-Step)
      specs.push({ typ: 'zahlung', art: last ? 'abnahme' : 'fortschritt', fortschritt: true, rueckbehalt: last ? rb : 0,
        bezeichnung: last ? `Endmontage/Abnahme (${i}/${units})` : `Fortschritt Einheit ${i}/${units}` });
    }
  } else if (profil === 'klein_pauschal') {
    specs.push({ typ: 'zahlung', art: 'anzahlung', bezeichnung: 'Anzahlung', pct: num(vert.anzahlung) });
    specs.push({ typ: 'blockade', bezeichnung: 'Material-Gate' });
    for (let i = 1; i <= units; i++) specs.push({ typ: 'zahlung', art: 'fortschritt', fortschritt: true, bezeichnung: `Fortschritt Einheit ${i}/${units}` });
    specs.push({ typ: 'blockade', bezeichnung: 'Druckprotokoll' });
    specs.push({ typ: 'blockade', bezeichnung: 'Fliesenleger' });
    specs.push({ typ: 'blockade', bezeichnung: 'Endabnahme' });
    specs.push({ typ: 'zahlung', art: 'abnahme', bezeichnung: 'Abnahme', pct: num(vert.abnahme), rueckbehalt: rb });
  } else { // stueck_15_70_15 (Default)
    specs.push({ typ: 'zahlung', art: 'anzahlung', bezeichnung: 'Anzahlung', pct: num(vert.anzahlung) });
    for (let i = 1; i <= fortschrittN; i++) specs.push({ typ: 'zahlung', art: 'fortschritt', fortschritt: true, bezeichnung: fortschrittBez(i, fortschrittN) });
    specs.push({ typ: 'zahlung', art: 'abnahme', bezeichnung: 'Abnahme', pct: num(vert.abnahme), rueckbehalt: rb });
  }
  return specs;
}

// Betraege in Rappen rechnen → Summe EXAKT = gesamtbetrag. Rundungsrest landet
// auf dem letzten Fortschritt-Step (bzw. letzten Zahlungs-Step ohne Fortschritt).
function zsAllocate(specs, gesamtbetrag, vert) {
  const total = Math.round(num(gesamtbetrag) * 100); // Rappen
  const einheitenPct = num(vert.einheiten) || 0;
  const fIdx = specs.map((s, i) => (s.fortschritt ? i : -1)).filter((i) => i >= 0);
  const cents = specs.map(() => 0);
  specs.forEach((s, i) => { if (s.typ === 'zahlung' && !s.fortschritt) cents[i] = Math.round(total * num(s.pct) / 100); });
  if (fIdx.length) {
    const block = Math.round(total * einheitenPct / 100);
    const base = Math.floor(block / fIdx.length);
    fIdx.forEach((i) => { cents[i] = base; });
    cents[fIdx[fIdx.length - 1]] += block - base * fIdx.length; // Rest im Block auf letzten Fortschritt
  }
  const diff = total - cents.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    let t = fIdx.length ? fIdx[fIdx.length - 1] : -1;
    if (t < 0) for (let i = specs.length - 1; i >= 0; i--) if (specs[i].typ === 'zahlung') { t = i; break; }
    if (t >= 0) cents[t] += diff; // Gesamt-Rundungsrest → exakt = gesamtbetrag
  }
  return cents.map((c) => Math.round(c) / 100);
}

// Step-Kette (+ Escrow) fuer einen Bauabschnitt (neu) erzeugen. Ersetzt eine
// evtl. bestehende Kette (Escrow via FK-Cascade). Danach Status-Automat + Bob-Wissen.
async function zsGenerateChain(abschnitt, opts = {}) {
  const profil = abschnitt.split_profil || 'stueck_15_70_15';
  const vert = await zsVerteilung(profil);
  const specs = zsBuildSpecs(profil, abschnitt.einheit_anzahl, vert, abschnitt.team_tage);
  const betraege = zsAllocate(specs, abschnitt.gesamtbetrag, vert);
  await sbWrite('DELETE', `gs_steps?bauabschnitt_id=eq.${abschnitt.id}`, undefined, 'return=minimal');
  const stepRows = specs.map((s, i) => ({
    bauabschnitt_id: abschnitt.id, reihenfolge: i + 1, typ: s.typ,
    zahlung_art: s.typ === 'zahlung' ? (s.art || null) : null,
    bezeichnung: s.bezeichnung, betrag: s.typ === 'zahlung' ? betraege[i] : 0, status: 'wartend',
  }));
  const inserted = await sbWrite('POST', 'gs_steps', stepRows); // return=representation
  const idByR = {}; (inserted || []).forEach((r) => { idByR[r.reihenfolge] = r.id; });
  const escRows = [];
  specs.forEach((s, i) => {
    if (s.typ !== 'zahlung') return;
    escRows.push({ step_id: idByR[i + 1], escrow_status: 'offen', betrag: betraege[i], rueckbehalt_prozent: s.rueckbehalt || 0 });
  });
  if (escRows.length) await sbWrite('POST', 'gs_escrow', escRows, 'return=minimal');
  // Block 6 (Runde 6): activate:false lässt den frisch generierten Zahlungsplan
  // INAKTIV (alle Steps 'wartend', kein 'hinterlegen'), bis der Partner ihn separat
  // annimmt. Erst dann macht zsRecompute den ersten Step (Anzahlung) scharf.
  if (opts.activate === false) {
    const steps = await sbGet(`gs_steps?bauabschnitt_id=eq.${abschnitt.id}&select=*&order=reihenfolge.asc`);
    await zsWriteBobWissen(abschnitt, steps);
    return steps;
  }
  const rec = await zsRecompute(abschnitt.id);
  await zsWriteBobWissen(abschnitt, rec.steps);
  return rec.steps;
}

// ── Status-Automat: streng nach reihenfolge, Escrow = Quelle der Wahrheit ──
function zsStepDone(step) { return step.typ === 'blockade' ? step.status === 'geklaert' : step.status === 'freigegeben'; }
function zsDeriveStepStatus(step, esc, predDone) {
  if (step.typ === 'blockade') {
    if (step.status === 'geklaert') return 'geklaert';
    return predDone ? 'offen' : 'wartend';   // offen = aktiv/zu klaeren
  }
  const es = (esc && esc.escrow_status) || 'offen';
  if (es === 'freigegeben') return 'freigegeben';
  if (!predDone) return 'wartend';
  if (es === 'hinterlegt') {
    const gs = !!(esc && esc.gs_bestaetigt_at), ku = !!(esc && esc.kunde_bestaetigt_at);
    return (gs || ku) ? 'gs_fertig' : 'hinterlegt';  // gs_fertig = in Doppelbestaetigung
  }
  return 'aktiv'; // Escrow offen + Vorgaenger fertig → hinterlegbar
}
function zsDeriveAbschnittStatus(steps) {
  const zahl = steps.filter((s) => s.typ === 'zahlung');
  if (!zahl.length) return 'geplant';
  const released = zahl.filter((s) => s.status === 'freigegeben');
  if (released.length === zahl.length) return 'abgeschlossen';
  if (zahl[0].status === 'freigegeben') return released.length >= 2 ? 'zwischenfreigabe' : 'angezahlt';
  // 'aktiv' erst wenn tatsaechlich Geld im Escrow liegt (hinterlegt/in Doppelbestaetigung).
  // Ein bloss 'aktiver' (= hinterlegbarer) erster Step ist noch 'geplant'.
  const money = steps.some((s) => s.status === 'hinterlegt' || s.status === 'gs_fertig');
  return money ? 'aktiv' : 'geplant';
}
async function zsRecompute(abschnittId) {
  const steps = await sbGet(`gs_steps?bauabschnitt_id=eq.${abschnittId}&select=*&order=reihenfolge.asc`);
  const zIds = steps.filter((s) => s.typ === 'zahlung').map((s) => s.id);
  const escByStep = {};
  if (zIds.length) {
    const escs = await sbGet(`gs_escrow?step_id=in.(${zIds.join(',')})&select=*`).catch(() => []);
    (escs || []).forEach((e) => { escByStep[e.step_id] = e; });
  }
  let predDone = true;
  for (const s of steps) {
    const want = zsDeriveStepStatus(s, escByStep[s.id], predDone);
    if (want !== s.status) { await sbWrite('PATCH', `gs_steps?id=eq.${s.id}`, { status: want }, 'return=minimal'); s.status = want; }
    predDone = zsStepDone(s);
  }
  const status = zsDeriveAbschnittStatus(steps);
  await sbWrite('PATCH', `gs_bauabschnitte?id=eq.${abschnittId}`, { status }, 'return=minimal').catch(() => {});
  return { steps, status, escByStep };
}

// Bob-Wissen: bei jeder (Neu-)Kalkulation eines Abschnitts einen Lern-Datensatz.
async function zsWriteBobWissen(abschnitt, steps) {
  const std = num(abschnitt.team_tage) * 8; // Team-Tage → Stunden (8h/Tag)
  const ansatz = std > 0 ? Math.round(num(abschnitt.gesamtbetrag) / std * 100) / 100 : null;
  const row = {
    quelle: 'bauabschnitt', bauabschnitt_id: abschnitt.id,
    einheit_typ: abschnitt.einheit_typ, team_tage: num(abschnitt.team_tage),
    einheit_anzahl: abschnitt.einheit_anzahl | 0, split_profil: abschnitt.split_profil,
    ansatz_chf_h: ansatz, eff_chf_h: ansatz,
    datensatz: {
      abschnitt: { name: abschnitt.name, einheit_typ: abschnitt.einheit_typ, einheit_anzahl: abschnitt.einheit_anzahl, gesamtbetrag: abschnitt.gesamtbetrag, split_profil: abschnitt.split_profil },
      steps: (steps || []).map((s) => ({ reihenfolge: s.reihenfolge, typ: s.typ, zahlung_art: s.zahlung_art, bezeichnung: s.bezeichnung, betrag: s.betrag })),
    },
  };
  await sbWrite('POST', 'gs_bob_wissen', row, 'return=minimal').catch(() => {});
}

// Bauabschnitt anlegen/aendern. Neu → Kette generieren. Aendern → nur mit
// regenerate:true neu berechnen (schuetzt bereits laufenden Escrow-Fortschritt).
function zsClampEinheitTyp(v) {
  const ok = ['zone', 'giessrahmen', 'verteiler', 'bad_wc', 'meilenstein', 'pauschal'];
  return ok.includes(v) ? v : 'pauschal';
}
async function zsAbschnittSave(b, access) {
  try {
    const patch = {};
    if (b.name !== undefined) patch.name = String(b.name || '').trim().slice(0, 120);
    if (b.einheit_typ !== undefined) patch.einheit_typ = zsClampEinheitTyp(String(b.einheit_typ || '').trim());
    if (b.einheit_anzahl !== undefined) patch.einheit_anzahl = Math.max(0, Math.min(9999, num(b.einheit_anzahl) | 0));
    if (b.team_tage !== undefined) patch.team_tage = Math.max(0, num(b.team_tage));
    if (b.gesamtbetrag !== undefined) patch.gesamtbetrag = Math.max(0, num(b.gesamtbetrag));
    if (b.split_profil !== undefined) patch.split_profil = String(b.split_profil || 'stueck_15_70_15').trim().slice(0, 60);

    let abschnitt, doGenerate;
    if (b.id) {
      const id = uuid(b.id);
      if (Object.keys(patch).length) {
        const r = await sbWrite('PATCH', `gs_bauabschnitte?id=eq.${id}`, patch);
        abschnitt = Array.isArray(r) ? r[0] : r;
      } else {
        const r = await sbGet(`gs_bauabschnitte?id=eq.${id}&select=*&limit=1`); // reines "neu berechnen"
        abschnitt = r && r[0];
      }
      doGenerate = b.regenerate === true;
    } else {
      const pid = uuid(b.projekt_id);
      if (!patch.name) patch.name = 'Bauabschnitt';
      patch.projekt_id = pid;
      // reihenfolge = aktueller Max + 1
      const ex = await sbGet(`gs_bauabschnitte?projekt_id=eq.${pid}&select=reihenfolge&order=reihenfolge.desc&limit=1`).catch(() => []);
      patch.reihenfolge = ((ex && ex[0] && ex[0].reihenfolge) || 0) + 1;
      const r = await sbWrite('POST', 'gs_bauabschnitte', patch);
      abschnitt = Array.isArray(r) ? r[0] : r;
      doGenerate = true;
    }
    if (!abschnitt) return { error: 'Bauabschnitt nicht gespeichert' };
    if (doGenerate) await zsGenerateChain(abschnitt);
    return { ok: true, abschnitt, regenerated: !!doGenerate };
  } catch (e) { if (isNoTable(e)) return zsNotMigrated(e); throw e; }
}

async function zsAbschnittDel(id) {
  try {
    id = uuid(id);
    await sbWrite('DELETE', `gs_bauabschnitte?id=eq.${id}`, undefined, 'return=minimal'); // Steps+Escrow via Cascade
    return { ok: true };
  } catch (e) { if (isNoTable(e)) return zsNotMigrated(e); throw e; }
}

// Eine Aktion auf einen Step (treibt den Status-Automaten). op:
//   blockade_freigeben | hinterlegen | gs_fertig | kunde_fertig | freigeben
async function zsStepAction(b, access) {
  try {
    const stepId = uuid(b.step_id);
    const op = String(b.op || '');
    const srows = await sbGet(`gs_steps?id=eq.${stepId}&select=*&limit=1`);
    const step = srows && srows[0];
    if (!step) return { error: 'Step nicht gefunden' };
    const arows = await sbGet(`gs_bauabschnitte?id=eq.${step.bauabschnitt_id}&select=id,projekt_id&limit=1`);
    const abschnitt = arows && arows[0];
    if (!abschnitt) return { error: 'Bauabschnitt nicht gefunden' };
    const uid = (access && access.userId) || null;

    if (op === 'blockade_freigeben') {
      if (step.typ !== 'blockade') return { error: 'Kein Blockade-Step' };
      if (step.status !== 'offen') return { error: 'Blockade nicht offen (Vorgaenger noch nicht fertig?)' };
      await sbWrite('PATCH', `gs_steps?id=eq.${stepId}`, { status: 'geklaert' }, 'return=minimal');
    } else if (op === 'hinterlegen') {
      if (step.typ !== 'zahlung') return { error: 'Kein Zahlungs-Step' };
      if (step.status !== 'aktiv') return { error: 'Step nicht aktiv (Vorgaenger noch nicht freigegeben?)' };
      await escrowHinterlegen(stepId, zsSb);
    } else if (op === 'gs_fertig' || op === 'kunde_fertig') {
      const erows = await sbGet(`gs_escrow?step_id=eq.${stepId}&select=*&limit=1`);
      const esc = erows && erows[0];
      if (!esc || esc.escrow_status !== 'hinterlegt') return { error: 'Escrow nicht hinterlegt' };
      const p = op === 'gs_fertig'
        ? { gs_bestaetigt_at: new Date().toISOString(), gs_bestaetigt_by: uid }
        : { kunde_bestaetigt_at: new Date().toISOString(), kunde_bestaetigt_by: uid };
      await sbWrite('PATCH', `gs_escrow?id=eq.${esc.id}`, p, 'return=minimal');
    } else if (op === 'freigeben') {
      if (step.typ !== 'zahlung') return { error: 'Kein Zahlungs-Step' };
      await escrowFreigeben(stepId, zsSb); // prueft Doppelbestaetigung selbst
    } else {
      return { error: 'Unbekannte Aktion' };
    }
    await zsRecompute(abschnitt.id);
    return await zsProjekt(abschnitt.projekt_id);
  } catch (e) {
    if (isNoTable(e)) return zsNotMigrated(e);
    return { error: (e && e.message) || 'Aktion fehlgeschlagen' };
  }
}

// Projekt-Ansicht: alle Bauabschnitte → Step-Kette (+ Escrow) + Aggregat.
async function zsProjekt(projektId) {
  try {
    const pid = uuid(projektId);
    const prow = await sbGet(`gs_projekte?id=eq.${pid}&select=id,name&limit=1`).catch(() => []);
    const projekt = (prow && prow[0]) || { id: pid, name: 'Projekt' };
    const abs = await sbGet(`gs_bauabschnitte?projekt_id=eq.${pid}&select=*&order=reihenfolge.asc`);
    const abschnitte = [];
    for (const a of abs || []) {
      const steps = await sbGet(`gs_steps?bauabschnitt_id=eq.${a.id}&select=*&order=reihenfolge.asc`);
      const zIds = (steps || []).filter((s) => s.typ === 'zahlung').map((s) => s.id);
      const escByStep = {};
      if (zIds.length) {
        const escs = await sbGet(`gs_escrow?step_id=in.(${zIds.join(',')})&select=*`).catch(() => []);
        (escs || []).forEach((e) => { escByStep[e.step_id] = e; });
      }
      let totalC = 0, relC = 0, next = null;
      const outSteps = (steps || []).map((s) => {
        const e = escByStep[s.id] || null;
        if (s.typ === 'zahlung') {
          const c = Math.round(num(s.betrag) * 100); totalC += c;
          if (e && e.escrow_status === 'freigegeben') relC += c;
        }
        if (!next && !zsStepDone(s)) next = { bezeichnung: s.bezeichnung, typ: s.typ, status: s.status };
        return {
          id: s.id, reihenfolge: s.reihenfolge, typ: s.typ, zahlung_art: s.zahlung_art,
          bezeichnung: s.bezeichnung, betrag: num(s.betrag), status: s.status,
          escrow_status: e ? e.escrow_status : null,
          rueckbehalt_prozent: e ? num(e.rueckbehalt_prozent) : 0,
          gs_bestaetigt: !!(e && e.gs_bestaetigt_at), kunde_bestaetigt: !!(e && e.kunde_bestaetigt_at),
          // Roh-Zeitstempel fuer den Audit-Trail (reine Anzeige, keine Logik).
          freigegeben_at: e ? (e.freigegeben_at || null) : null,
          gs_bestaetigt_at: e ? (e.gs_bestaetigt_at || null) : null,
          kunde_bestaetigt_at: e ? (e.kunde_bestaetigt_at || null) : null,
          stripe_payment_intent_id: e ? e.stripe_payment_intent_id : null,
          stripe_transfer_id: e ? e.stripe_transfer_id : null,
        };
      });
      abschnitte.push({
        id: a.id, name: a.name, reihenfolge: a.reihenfolge, einheit_typ: a.einheit_typ,
        einheit_anzahl: a.einheit_anzahl, team_tage: num(a.team_tage), gesamtbetrag: num(a.gesamtbetrag),
        split_profil: a.split_profil, status: a.status,
        steps: outSteps,
        aggregat: { prozent: totalC ? Math.round(relC / totalC * 100) : 0, freigegeben: relC / 100, total: totalC / 100, naechster: next },
      });
    }
    return { projekt, abschnitte, mig: true };
  } catch (e) { if (isNoTable(e)) return zsNotMigrated(e); throw e; }
}

// ═══════════════════════════════════════════════════════════════════════════
// MASTER: SUB-/AKKORD-ANFRAGEN (Runde 2) — Master-only.
//   Liste/Detail aller projekt_art='sub_akkord', Kalkulation ueber die BESTEHENDE
//   Zahlungssystem-Engine (zs_abschnitt_save/zs_projekt — unveraendert), Angebot in
//   gs_angebote. Status: angefragt → in_pruefung (beim Oeffnen) → angebot_offen.
//   resolveAccess laesst Partner fuer msub_* nicht durch; msubAssertMaster doppelt ab.
// ═══════════════════════════════════════════════════════════════════════════
function msubAssertMaster(access) { if (!access || !access.isMaster) throw new Forbidden(); }
async function msubLatestAngebot(projektId) {
  const rows = await sbGet(`gs_angebote?projekt_id=eq.${projektId}&select=*&order=version.desc,created_at.desc&limit=1`).catch(() => []);
  return (rows && rows[0]) || null;
}
// Letztes an den Partner ABGESCHICKTES/entschiedenes Angebot (nie ein Master-Entwurf).
// So sieht der Partner beim Erstellen einer neuen Version weiterhin die alte gesendete.
async function msubLatestSentAngebot(projektId) {
  const rows = await sbGet(`gs_angebote?projekt_id=eq.${projektId}&status=neq.entwurf&select=*&order=version.desc,created_at.desc&limit=1`).catch(() => []);
  return (rows && rows[0]) || null;
}
// INTERN/EXTERN: Nur diese Whitelist geht an den Partner. Kosten, Rohgewinn,
// Ampel, Ansatz (ansatz_chf_h) und Kostensätze bleiben INTERN und werden NIE
// ausgeliefert — auch nicht, falls die Spalte irgendwann auf gs_angebote läge.
// Block 2 (Runde 6): Der Bauabschnitts-Vorschlag enthält INTERNES Vokabular
// (split_profil, einheit_typ, einheit_anzahl, team_tage). Der Partner sieht davon
// NICHTS — nur Abschnittsname + Zahlungsschritte (Bezeichnung + Betrag). Server-
// seitig aus dem Payload gefiltert, nicht clientseitig ausgeblendet.
function sanitizeVorschlagForPartner(v) {
  if (!Array.isArray(v)) return null;
  return v.map((a) => ({
    name: a.name || 'Abschnitt',
    gesamtbetrag: num(a.gesamtbetrag),
    steps: Array.isArray(a.steps) ? a.steps.map((s) => ({
      reihenfolge: s.reihenfolge, typ: s.typ, zahlung_art: s.zahlung_art,
      bezeichnung: s.bezeichnung, betrag: num(s.betrag),
    })) : [],
  }));
}
function sanitizeAngebotForPartner(ang) {
  if (!ang) return null;
  return {
    id: ang.id, projekt_id: ang.projekt_id, version: ang.version, status: ang.status,
    gesamtbetrag: num(ang.gesamtbetrag), bemerkung: ang.bemerkung || null,
    positionen: sanitizePositionenForPartner(ang.positionen),
    rabatt_prozent: ang.rabatt_prozent != null ? num(ang.rabatt_prozent) : 0,
    zuschlag_prozent: ang.zuschlag_prozent != null ? num(ang.zuschlag_prozent) : 0,
    mwst_prozent: ang.mwst_prozent != null ? num(ang.mwst_prozent) : 8.1,
    zahlungsziel_tage: ang.zahlungsziel_tage != null ? ang.zahlungsziel_tage : null,
    gueltig_bis: ang.gueltig_bis || null, ausfuehrung_von: ang.ausfuehrung_von || null, ausfuehrung_bis: ang.ausfuehrung_bis || null,
    abgeschickt_am: ang.abgeschickt_am || null, entschieden_am: ang.entschieden_am || null,
    bauabschnitt_vorschlag: sanitizeVorschlagForPartner(ang.bauabschnitt_vorschlag),
  };
}
// ── Sichtbare Projekt-ID: S-YYYY-NNN (Sub) / K-YYYY-NNN (Kapazität) ──
// Laufzeit-Berechnung aus der globalen Erstell-Reihenfolge je Art (keine neue
// Spalte nötig). Master und Partner sehen dieselbe Nummer, weil global gezählt.
function anzeigeJahr(iso) { const s = String(iso || ''); return /^\d{4}/.test(s) ? s.slice(0, 4) : String(new Date().getFullYear()); }
function anzeigeIdFmt(art, jahr, seq) { return (art === 'sub_akkord' ? 'S' : 'K') + '-' + jahr + '-' + String(seq).padStart(3, '0'); }
async function anzeigeSeqMap(isSub) {
  const filter = isSub ? 'projekt_art=eq.sub_akkord' : 'or=(projekt_art.is.null,projekt_art.neq.sub_akkord)';
  const rows = await sbGet(`gs_projekte?${filter}&select=id,created_at&order=created_at.asc`).catch(() => []);
  const map = {}; (rows || []).forEach((r, i) => { map[r.id] = i + 1; }); return map;
}
async function projektAnzeigeId(projekt) {
  if (!projekt || !projekt.id) return null;
  const isSub = projekt.projekt_art === 'sub_akkord';
  const map = await anzeigeSeqMap(isSub);
  const seq = map[projekt.id] || (Object.keys(map).length + 1);
  return anzeigeIdFmt(projekt.projekt_art, anzeigeJahr(projekt.created_at), seq);
}
async function msubPartnerBrand(partnerUserId) {
  const empty = { firma: null, adresse: null, plz: null, ort: null, telefon: null, email: null, logo_url_signed: null };
  if (!partnerUserId) return empty;
  const rows = await sbGet(`gs_partner_profil?partner_user_id=eq.${partnerUserId}&select=*`).catch(() => []);
  const p = rows && rows[0];
  if (!p) return empty;
  return {
    firma: p.firma || null, adresse: p.adresse || null, plz: p.plz || null, ort: p.ort || null,
    telefon: p.telefon || null, email: p.email || null,
    logo_url_signed: p.logo_url ? await sbSignUrl(PM_DATEI_BUCKET, p.logo_url, 86400).catch(() => null) : null,
  };
}
async function msubListe(access) {
  msubAssertMaster(access);
  try {
    const projekte = ohneGeloeschte(await sbGet(`gs_projekte?projekt_art=eq.sub_akkord&select=*&order=created_at.desc`));
    const brandByPid = {};
    for (const pid of [...new Set((projekte || []).map((p) => p.partner_user_id).filter(Boolean))]) {
      brandByPid[pid] = await msubPartnerBrand(pid);
    }
    // Block 5 (zahlplan-ux): letztes Angebot je Projekt (EINE Batch-Query) für die
    // Ungelesen-Signatur im Cockpit — Kundenaktion (angenommen/abgelehnt/Termin)
    // ändert angebot.status/entschieden_am, ohne dass sub_status sich bewegen muss.
    const angByPid = {};
    const pids = (projekte || []).map((p) => p.id);
    if (pids.length) {
      const angs = await sbGet(`gs_angebote?projekt_id=in.(${pids.join(',')})&select=projekt_id,status,entschieden_am,version&order=version.asc`).catch(() => []);
      (angs || []).forEach((a) => { angByPid[a.projekt_id] = a; }); // version.asc → höchste gewinnt
    }
    const seq = await anzeigeSeqMap(true);
    const anfragen = (projekte || []).map((p) => {
      const sub = (p.datenblatt && typeof p.datenblatt === 'object' && p.datenblatt.sub) || {};
      const brand = brandByPid[p.partner_user_id] || {};
      return {
        id: p.id, name: p.name, standort: p.standort || null, bereich: p.bereich || null,
        anzeige_id: anzeigeIdFmt('sub_akkord', anzeigeJahr(p.created_at), seq[p.id] || 0),
        sub_status: p.sub_status || 'entwurf', angefragt_am: p.angefragt_am || null,
        zahlungsplan_status: p.zahlungsplan_status || null, zahlungsplan_angenommen_at: p.zahlungsplan_angenommen_at || null,
        angebot_status: (angByPid[p.id] || {}).status || null, angebot_entschieden_am: (angByPid[p.id] || {}).entschieden_am || null,
        beschreibung: sub.beschreibung || '', ansprechperson: sub.ansprechperson || '',
        leistungsarten: Array.isArray(sub.leistungsarten) ? sub.leistungsarten : [],
        // Fallback: fehlt der Firmenname → E-Mail statt „?" anzeigen.
        partner_firma: brand.firma || brand.email || null, partner_logo: brand.logo_url_signed || null,
      };
    });
    return { anfragen };
  } catch (e) { if (isNoTable(e)) return { anfragen: [], notMigrated: true }; throw e; }
}
// Volle Projektansicht (identisch zur Kapazitaets-PM-Ansicht via getPmProjekt) +
// sub_bundle (Partner-Branding, Angebot, Auftragsbestaetigung, Sub-Detail) obendrauf.
async function msubDetail(id, access) {
  msubAssertMaster(access);
  try {
    id = uuid(id);
    const pr0 = await sbGet(`gs_projekte?id=eq.${id}&select=*&limit=1`);
    const p0 = pr0 && pr0[0];
    if (!p0 || p0.geloescht_at) return { error: 'Projekt nicht gefunden' };
    if (p0.projekt_art !== 'sub_akkord') return { error: 'Kein Sub-/Akkordprojekt' };
    // Auto-Uebergang: sobald der Master die Anfrage oeffnet → in_pruefung.
    if (p0.sub_status === 'angefragt') {
      try { await sbWrite('PATCH', `gs_projekte?id=eq.${id}`, { sub_status: 'in_pruefung' }, 'return=minimal'); } catch (_) {}
    }
    const pm = await getPmProjekt(id, { partnerId: null }); // Master-Scope: volle Ansicht
    if (pm && pm.error) return pm;
    const projekt = pm.projekt || {};
    const partner = await msubPartnerBrand(projekt.partner_user_id);
    if (partner && !partner.firma && partner.email) partner.firma = partner.email; // Fallback statt „?"
    const angebot = await msubLatestAngebot(id);
    const auftrag = await subAuftrag(id);
    const kalk = await msubKalkData(id);   // INTERN — nur ueber diesen Master-Endpunkt
    // Stale-Erkennung: Bauabschnitts-Summe (aktuelle Kalkulation) vs. Angebotsbetrag
    // vor Rabatt/Zuschlag (Positionen-Netto). Abweichung → Angebot veraltet.
    const kalkSum = ((kalk && kalk.positionen) || []).reduce((s, k) => s + num(k.gesamtbetrag), 0);
    const angNetto = angebot && Array.isArray(angebot.positionen)
      ? angebot.positionen.reduce((s, p) => s + num(p.menge) * num(p.einzelpreis), 0)
      : (angebot ? num(angebot.gesamtbetrag) : 0);
    const angebotStale = !!(angebot && angebot.status !== 'angenommen' && angebot.status !== 'abgelehnt'
      && kalkSum > 0 && Math.abs(round2(kalkSum) - round2(angNetto)) >= 0.01);
    pm.sub_bundle = {
      projekt_id: id,
      sub_status: projekt.sub_status || 'entwurf',
      angefragt_am: projekt.angefragt_am || null,
      anzeige_id: await projektAnzeigeId(projekt).catch(() => null),
      sub: (projekt.datenblatt && typeof projekt.datenblatt === 'object' && projekt.datenblatt.sub) || {},
      partner, angebot, auftrag, kalk,
      angebot_stale: angebotStale,
      bauabschnitt_summe: round2(kalkSum),
      // Block 6/7: generierter Zahlungsplan + Annahme-/Start-Status (Master-Sicht).
      zahlungsplan: await subZahlungsplanView(id).catch(() => null),
    };
    return pm;
  } catch (e) { if (isNoTable(e)) return { error: 'Nicht migriert', notMigrated: true }; throw e; }
}
async function msubInPruefung(b, access) {
  msubAssertMaster(access);
  const id = uuid(b.id);
  const rows = await sbGet(`gs_projekte?id=eq.${id}&select=sub_status,projekt_art&limit=1`).catch(() => []);
  const cur = rows && rows[0];
  if (!cur) return { error: 'Projekt nicht gefunden' };
  if (cur.projekt_art !== 'sub_akkord') return { error: 'Kein Sub-/Akkordprojekt' };
  if (cur.sub_status !== 'angefragt' && cur.sub_status !== 'entwurf') return { ok: true, sub_status: cur.sub_status };
  try {
    const r = await sbWrite('PATCH', `gs_projekte?id=eq.${id}`, { sub_status: 'in_pruefung' });
    return { ok: true, sub_status: (Array.isArray(r) && r[0] && r[0].sub_status) || 'in_pruefung' };
  } catch (e) { if (isNoTable(e)) return { error: 'Nicht migriert', notMigrated: true }; throw e; }
}
// Angebot-Entwurf aus der aktuellen Kalkulation (Bauabschnitte) erzeugen/aktualisieren.
async function msubAngebotSave(b, access) {
  msubAssertMaster(access);
  try {
    const pid = uuid(b.projekt_id);
    const zp = await zsProjekt(pid);
    if (zp && zp.notMigrated) return zp;
    const abschnitte = (zp && zp.abschnitte) || [];
    const gesamtbetrag = abschnitte.reduce((s, a) => s + num(a.gesamtbetrag), 0);
    // Block 5 (Runde 7): Der Master kann den Generator-Vorschlag im Editor anpassen
    // (Steps umbenennen/verschieben/hinzufügen/löschen, Zahlung↔Blockade). Kommt eine
    // editierte Kette (b.plan) mit, wird SIE eingefroren — sonst der Generator-Vorschlag.
    const editPlan = Array.isArray(b.plan) ? b.plan : null;
    const vorschlag = abschnitte.map((a, idx) => {
      const edited = editPlan && (editPlan.find((p) => p && String(p.name || '').trim() === String(a.name || '').trim()) || editPlan[idx]);
      const steps = edited ? angNormSteps(edited.steps) : (a.steps || []).map((s) => ({ reihenfolge: s.reihenfolge, typ: s.typ, zahlung_art: s.zahlung_art, bezeichnung: s.bezeichnung, betrag: s.betrag }));
      const stepBetrag = steps.reduce((s2, st) => (st.typ === 'zahlung' ? s2 + Math.round(num(st.betrag) * 100) : s2), 0) / 100;
      return {
        name: a.name, split_profil: a.split_profil, einheit_typ: a.einheit_typ,
        einheit_anzahl: a.einheit_anzahl, team_tage: a.team_tage,
        // gesamtbetrag des Abschnitts = Summe seiner Zahlungs-Steps (editierbar).
        gesamtbetrag: edited ? round2(stepBetrag) : a.gesamtbetrag,
        steps,
      };
    });
    const ansatz = (b.ansatz_chf_h === '' || b.ansatz_chf_h == null) ? null : num(b.ansatz_chf_h);
    const bemerkung = b.bemerkung != null ? String(b.bemerkung).slice(0, 2000) : null;
    // Positionen: gegeben ODER aus den Bauabschnitten vorbefuellen (Menge 1, Pauschal).
    let positionen = angPosSanitize(b.positionen);
    if (!positionen || !positionen.length) {
      positionen = abschnitte.map((a) => ({ bezeichnung: a.name || 'Bauabschnitt', menge: 1, einheit: 'Pauschal', einzelpreis: num(a.gesamtbetrag) }));
    }
    const rabatt = Math.max(0, num(b.rabatt_prozent));
    const zuschlag = Math.max(0, num(b.zuschlag_prozent));
    const mwst = (b.mwst_prozent == null || b.mwst_prozent === '') ? 8.1 : Math.max(0, num(b.mwst_prozent));
    const rech = angRechnung(positionen, rabatt, zuschlag, mwst);
    // Brutto (inkl. MWST) = verbindlicher Gesamtbetrag des Angebots.
    const angGesamt = rech.brutto;
    const base = { gesamtbetrag: angGesamt, ansatz_chf_h: ansatz, bemerkung, bauabschnitt_vorschlag: vorschlag };
    const extra = {
      positionen, rabatt_prozent: rabatt, zuschlag_prozent: zuschlag, mwst_prozent: mwst,
      zahlungsziel_tage: (b.zahlungsziel_tage == null || b.zahlungsziel_tage === '') ? null : (num(b.zahlungsziel_tage) | 0),
      gueltig_bis: dateOrNull(b.gueltig_bis), ausfuehrung_von: dateOrNull(b.ausfuehrung_von), ausfuehrung_bis: dateOrNull(b.ausfuehrung_bis),
    };
    const existing = await msubLatestAngebot(pid);
    const writeWith = async (payload) => {
      if (existing && existing.status === 'entwurf') return await sbWrite('PATCH', `gs_angebote?id=eq.${existing.id}`, payload);
      const version = existing ? (num(existing.version) + 1) : 1;
      return await sbWrite('POST', 'gs_angebote', { projekt_id: pid, version, status: 'entwurf', ...payload });
    };
    let r;
    try { r = await writeWith({ ...base, ...extra }); }
    catch (e) {
      // Neue Angebots-Spalten (positionen/…) noch nicht migriert → Kernfelder trotzdem speichern.
      if (/column|does not exist|PGRST204|schema cache/i.test((e && e.message) || '')) {
        r = await writeWith(base);
        return { ok: true, angebot: Array.isArray(r) ? r[0] : r, rechnung: rech, extraNotMigrated: true };
      }
      throw e;
    }
    return { ok: true, angebot: Array.isArray(r) ? r[0] : r, rechnung: rech };
  } catch (e) { if (isNoTable(e)) return { error: 'Nicht migriert', notMigrated: true }; throw e; }
}
// Block 7 (Runde 7): Bei jedem abgeschickten Angebot einen Lern-Datensatz in
// gs_bob_wissen schreiben — aus der vom Master FINAL angepassten Kette (nicht dem
// Generator-Vorschlag). Best-effort; ein Fehler darf den Versand NIE blockieren.
// Zwei-Stufen-Schreiben: fehlen die Runde-7-Spalten (personen/projekt_art/…), wird der
// Kern über die bestehenden Spalten + datensatz(jsonb) gesichert.
async function subWriteBobTraining(pid, angebot) {
  const prow = (await sbGet(`gs_projekte?id=eq.${pid}&select=projekt_art,datenblatt&limit=1`).catch(() => []))[0] || {};
  const leistungsarten = (prow.datenblatt && prow.datenblatt.sub && prow.datenblatt.sub.leistungsarten) || [];
  const abs = await sbGet(`gs_bauabschnitte?projekt_id=eq.${pid}&select=*&order=reihenfolge.asc`).catch(() => []);
  const first = (abs && abs[0]) || {};
  let personen = null;
  if (first.id) {
    const kp = (await sbGet(`gs_kalk_positionen?bauabschnitt_id=eq.${first.id}&select=personen&limit=1`).catch(() => []))[0];
    if (kp) personen = num(kp.personen);
  }
  const std = num(first.team_tage) * 8;
  const ansatz = std > 0 ? round2(num(first.gesamtbetrag) / std) : null;
  const finale = Array.isArray(angebot.bauabschnitt_vorschlag) ? angebot.bauabschnitt_vorschlag : [];
  const datensatz = { angebot_id: angebot.id, projekt_art: prow.projekt_art || 'sub_akkord', leistungsarten, personen, gesamtbetrag: num(angebot.gesamtbetrag), finale_step_kette: finale };
  const base = {
    quelle: 'angebot_final', einheit_typ: first.einheit_typ || null, team_tage: num(first.team_tage),
    einheit_anzahl: first.einheit_anzahl != null ? (first.einheit_anzahl | 0) : null,
    split_profil: first.split_profil || null, ansatz_chf_h: ansatz, eff_chf_h: ansatz, datensatz,
  };
  const rich = { ...base, projekt_art: prow.projekt_art || 'sub_akkord', leistungsarten, personen, gesamtbetrag: num(angebot.gesamtbetrag), finale_step_kette: finale };
  try { await sbWrite('POST', 'gs_bob_wissen', rich, 'return=minimal'); }
  catch (e) {
    // Runde-7-Spalten fehlen → Kern trotzdem sichern (Kette liegt in datensatz).
    if (/column|does not exist|PGRST204|schema cache/i.test((e && e.message) || '')) await sbWrite('POST', 'gs_bob_wissen', base, 'return=minimal');
    else throw e;
  }
}
async function msubAngebotSend(b, access) {
  msubAssertMaster(access);
  try {
    const pid = uuid(b.projekt_id);
    const angebot = await msubLatestAngebot(pid);
    if (!angebot) return { error: 'Kein Angebot vorhanden – zuerst „Angebot erzeugen".' };
    if (angebot.status === 'abgeschickt') return { error: 'Angebot ist bereits abgeschickt.' };
    if (!(num(angebot.gesamtbetrag) > 0)) return { error: 'Angebot hat keinen Betrag – bitte zuerst Bauabschnitte kalkulieren.' };
    // Block 5 (Runde 7): Abschicken NUR wenn die Zahlungsplan-Summe exakt der
    // Positionsbasis (Positionen mit Häkchen) entspricht — keine Auto-Neuverteilung.
    const chk = angPlanCheck(angebot.bauabschnitt_vorschlag, angebot.positionen);
    if (!chk.ok) return { error: `Zahlungsplan (${chk.stepSum.toFixed(2)}) ≠ Positionen (${chk.posBasis.toFixed(2)}) – ${Math.abs(chk.differenz).toFixed(2)} noch nicht zugeordnet.`, planMismatch: true, check: chk };
    const r = await sbWrite('PATCH', `gs_angebote?id=eq.${angebot.id}`, { status: 'abgeschickt', abgeschickt_am: new Date().toISOString() });
    await sbWrite('PATCH', `gs_projekte?id=eq.${pid}`, { sub_status: 'angebot_offen' });
    // Block 7 (Runde 7): Trainingsdatensatz aus der FINAL abgeschickten Kette (best-effort).
    await subWriteBobTraining(pid, angebot).catch(() => {});
    return { ok: true, angebot: Array.isArray(r) ? r[0] : r, sub_status: 'angebot_offen' };
  } catch (e) { if (isNoTable(e)) return { error: 'Nicht migriert', notMigrated: true }; throw e; }
}
// Block 1 (Runde 8a): msubAngebotQuickSend ENTFERNT. Der Schnellweg („Angebot
// direkt abschicken") umging die Prüf-Ansicht mit dem Zahlungsplan-Editor.
// Versand läuft ausschliesslich über msub_angebot_save + msub_angebot_send.
// Live-Vorschau fürs Kalk-Formular (Master-only): Kalk-Kennzahlen (INTERN) + die
// echte Step-Vorschau aus der Engine (zsBuildSpecs/zsAllocate über gs_split_profile.
// verteilung) — NIE hartcodiert nachgebaut. Schreibt nichts.
async function msubKalkPreview(b, access) {
  msubAssertMaster(access);
  try {
    const settings = await kalkSettingsRead();
    const calc = kalkCompute({ personen: b.personen, team_tage: b.team_tage, ansatz_modus: b.ansatz_modus }, settings);
    let profil = b.split_profil, einheitAnzahl = b.einheit_anzahl, einheitTyp = b.einheit_typ;
    if (b.bauabschnitt_id) {
      const r = await sbGet(`gs_bauabschnitte?id=eq.${uuid(b.bauabschnitt_id)}&select=split_profil,einheit_anzahl,einheit_typ&limit=1`).catch(() => []);
      if (r && r[0]) { profil = profil || r[0].split_profil; einheitAnzahl = (einheitAnzahl != null ? einheitAnzahl : r[0].einheit_anzahl); einheitTyp = einheitTyp || r[0].einheit_typ; }
    }
    profil = profil || 'stueck_15_70_15';
    const anzahl = einheitTyp === 'pauschal' ? 1 : Math.max(1, (num(einheitAnzahl) | 0) || 1);
    const vert = await zsVerteilung(profil);
    const specs = zsBuildSpecs(profil, anzahl, vert, calc.team_tage);
    const betraege = zsAllocate(specs, calc.umsatz, vert);
    const liste = specs.map((s, i) => ({ typ: s.typ, fortschritt: !!s.fortschritt, bezeichnung: s.bezeichnung, betrag: s.typ === 'zahlung' ? betraege[i] : 0 }));
    const fort = liste.filter((s) => s.fortschritt);
    return {
      ok: true, kalk: calc,
      steps: {
        gesamt: specs.length,
        zahlung: liste.filter((s) => s.typ === 'zahlung').length,
        fortschritt: fort.length,
        fortschritt_betrag: fort.length ? fort[0].betrag : 0,
        einheit_anzahl: anzahl, liste,
      },
    };
  } catch (e) { if (isNoTable(e)) return { notMigrated: true }; throw e; }
}

// ═══════════════════════════════════════════════════════════════════════════
// KALKULATIONSGENERATOR + ANGEBOTS-RECHNUNG (Runde 4)
//   Kosten/Rohgewinn/Ampel sind INTERN: leben nur in gs_kalk_* und werden NUR
//   ueber Master-only-Endpunkte (msub_*) ausgeliefert — nie in gs_angebote, nie
//   ueber einen Partner-Endpunkt. Die Engine (gs_bauabschnitte/steps) bleibt
//   unveraendert; msubKalkApply schreibt nur den berechneten Umsatz via zsAbschnittSave.
// ═══════════════════════════════════════════════════════════════════════════
function round2(n) { return Math.round(num(n) * 100) / 100; }
function dateOrNull(v) { if (!v) return null; const s = String(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
// ── Angebots-Positionen: Netto → Rabatt/Zuschlag → MWST → Brutto ──
const ANG_BERECHNUNG = new Set(['pauschal', 'stunden', 'team_tage', 'stueck', 'material', 'spesen', 'anfahrt', 'fremdgewerk']);
function angPosSanitize(arr) {
  if (!Array.isArray(arr)) return null;
  return arr.slice(0, 60).map((p) => ({
    bezeichnung: String((p && p.bezeichnung) || '').slice(0, 200),
    menge: Math.max(0, num(p && p.menge)),
    einheit: String((p && p.einheit) || 'Pauschal').slice(0, 30),
    einzelpreis: Math.max(0, num(p && p.einzelpreis)),
    // Block 6 (Runde 7): fliesst diese Position in den Zahlungsplan (Escrow)? Default ja.
    // Material läuft laut Geschäftsmodell übers Kundenkonto → Häkchen aus (false).
    im_zahlungsplan: (p && p.im_zahlungsplan === false) ? false : true,
    // Berechnungsart (INTERN, wird für den Partner gestrippt) + Personen für Team-Tage.
    berechnung: ANG_BERECHNUNG.has(p && p.berechnung) ? p.berechnung : 'pauschal',
    personen: Math.max(1, num(p && p.personen) || 1),
  })).filter((p) => p.bezeichnung || p.einzelpreis);
}
// Partner sieht nur die neutralen Positionsfelder — nie die interne Berechnungsart/Personen.
function sanitizePositionenForPartner(arr) {
  if (!Array.isArray(arr)) return null;
  return arr.map((p) => ({
    bezeichnung: p.bezeichnung, menge: num(p.menge), einheit: p.einheit || 'Pauschal',
    einzelpreis: num(p.einzelpreis), im_zahlungsplan: p.im_zahlungsplan !== false,
  }));
}
// Block 5 (Runde 7): Basis des Zahlungsplans = Summe der Positionen MIT Häkchen (netto).
function angPosBasis(positionen) {
  return round2((positionen || []).reduce((s, p) => (p && p.im_zahlungsplan === false) ? s : s + num(p.menge) * num(p.einzelpreis), 0));
}
// Summe der Zahlungs-Steps über alle Bauabschnitte des Vorschlags (Blockaden = 0).
function angPlanStepSum(vorschlag) {
  let c = 0;
  (vorschlag || []).forEach((a) => (a.steps || []).forEach((s) => { if (s.typ === 'zahlung') c += Math.round(num(s.betrag) * 100); }));
  return round2(c / 100);
}
// Live-Validierung: Steps-Summe muss EXAKT der Positionsbasis entsprechen (keine
// Auto-Neuverteilung). Rappen-genau verglichen. Steuert das Abschicken-Gate.
function angPlanCheck(vorschlag, positionen) {
  const stepSum = angPlanStepSum(vorschlag);
  const posBasis = angPosBasis(positionen);
  const diffC = Math.round(stepSum * 100) - Math.round(posBasis * 100);
  return { stepSum, posBasis, differenz: round2(diffC / 100), ok: diffC === 0 };
}
// Übernimmt eine vom Master editierte Step-Liste in einen (Vorschlags-)Bauabschnitt:
// Reihenfolge normalisieren, Typ/Bezeichnung/Betrag säubern, zahlung_art gültig halten
// (CHECK-Constraint anzahlung|fortschritt|meilenstein|abnahme|schlussrate; Blockade→null).
function angNormSteps(steps) {
  const arr = Array.isArray(steps) ? steps : [];
  const zahlIdx = arr.map((s, i) => ({ s, i })).filter((x) => x.s && x.s.typ !== 'blockade');
  const validArt = new Set(['anzahlung', 'fortschritt', 'meilenstein', 'abnahme', 'schlussrate']);
  return arr.map((s, i) => {
    const isBlock = s && s.typ === 'blockade';
    let art = null;
    if (!isBlock) {
      art = validArt.has(s && s.zahlung_art) ? s.zahlung_art
        : (zahlIdx.length && zahlIdx[0].i === i ? 'anzahlung' : (zahlIdx.length && zahlIdx[zahlIdx.length - 1].i === i ? 'abnahme' : 'fortschritt'));
    }
    return {
      reihenfolge: i + 1,
      typ: isBlock ? 'blockade' : 'zahlung',
      zahlung_art: art,
      bezeichnung: String((s && s.bezeichnung) || (isBlock ? 'Blockade' : 'Zahlung')).slice(0, 120),
      betrag: isBlock ? 0 : Math.max(0, num(s && s.betrag)),
    };
  });
}
function angRechnung(positionen, rabatt, zuschlag, mwst) {
  const netto = (positionen || []).reduce((s, p) => s + num(p.menge) * num(p.einzelpreis), 0);
  const nachRabatt = netto * (1 - num(rabatt) / 100);
  const zwischensumme = nachRabatt * (1 + num(zuschlag) / 100);
  const mwstBetrag = zwischensumme * num(mwst) / 100;
  return { netto: round2(netto), zwischensumme: round2(zwischensumme), mwst_betrag: round2(mwstBetrag), brutto: round2(zwischensumme + mwstBetrag) };
}
// ── Kalkulations-Kostensaetze (Singleton) ──
const KALK_DEFAULTS = { vollkosten_chf_h: 46, spesen_pro_person_tag: 40, kfz_pauschale_tag: 20, equipment_pro_woche: 280, stunden_pro_team_tag: 8, ansatz_detailliert: 90, ansatz_schnell: 85, ansatz_minimum: 75, ampel_gruen_ab: 70, ampel_rot_unter: 56 };
const KALK_SET_FELDER = Object.keys(KALK_DEFAULTS);
async function kalkSettingsRead() {
  try {
    const rows = await sbGet('gs_kalk_settings?select=*&limit=1');
    if (rows && rows[0]) return { ...KALK_DEFAULTS, ...rows[0] };
    return { ...KALK_DEFAULTS };
  } catch (e) { if (isNoTable(e)) return { ...KALK_DEFAULTS, notMigrated: true }; throw e; }
}
async function kalkSettingsGet(access) { msubAssertMaster(access); const s = await kalkSettingsRead(); return { settings: s, notMigrated: !!s.notMigrated }; }
async function kalkSettingsSave(b, access) {
  msubAssertMaster(access);
  const patch = {};
  for (const f of KALK_SET_FELDER) if (b[f] !== undefined && b[f] !== '') patch[f] = Math.max(0, num(b[f]));
  patch.updated_at = new Date().toISOString();
  const doWrite = async (p) => {
    const rows = await sbGet('gs_kalk_settings?select=id&limit=1').catch(() => []);
    return (rows && rows[0])
      ? await sbWrite('PATCH', `gs_kalk_settings?id=eq.${rows[0].id}`, p)
      : await sbWrite('POST', 'gs_kalk_settings', p);
  };
  try {
    let r;
    try { r = await doWrite(patch); }
    catch (e) {
      // Neue Spalte (ansatz_minimum) noch nicht migriert → ohne sie speichern.
      if (/column|does not exist|PGRST204|schema cache/i.test((e && e.message) || '')) {
        const { ansatz_minimum, ...core } = patch; r = await doWrite(core);
      } else throw e;
    }
    return { ok: true, settings: { ...KALK_DEFAULTS, ...(Array.isArray(r) ? r[0] : r) } };
  } catch (e) { if (isNoTable(e)) return { error: 'Kalk-Tabelle fehlt – scripts/kalk_settings.sql ausführen.', notMigrated: true }; throw e; }
}
// Kernrechnung — INTERN (Kosten/Rohgewinn/Ampel). Nie ueber Partner-Endpunkt.
function kalkCompute(inp, s) {
  s = s || KALK_DEFAULTS;
  const stundenProTag = num(s.stunden_pro_team_tag) || 8;
  const personen = Math.max(1, (num(inp.personen) | 0) || 2);
  const teamTage = Math.max(0, num(inp.team_tage));
  const modus = (inp.ansatz_modus === 'schnell' || inp.ansatz_modus === 'schmerzgrenze') ? inp.ansatz_modus : 'detailliert';
  const ansatz = modus === 'schnell' ? num(s.ansatz_schnell)
    : modus === 'schmerzgrenze' ? (num(s.ansatz_minimum) || 75)
    : num(s.ansatz_detailliert);
  const vstunden = teamTage * personen * stundenProTag;
  const umsatz = vstunden * ansatz;
  const kosten = (vstunden * num(s.vollkosten_chf_h))
    + (teamTage * personen * num(s.spesen_pro_person_tag))
    + (teamTage * num(s.kfz_pauschale_tag))
    + ((teamTage / 5) * num(s.equipment_pro_woche));
  const rohgewinn = umsatz - kosten;
  const dbProStunde = vstunden > 0 ? rohgewinn / vstunden : 0;
  const effChfH = vstunden > 0 ? (rohgewinn / vstunden) + num(s.vollkosten_chf_h) : 0;
  // Block 8 (Runde 7): 0 Team-Tage → neutral/grau (noch nichts berechnet), nicht rot.
  let ampel = (teamTage <= 0 || vstunden <= 0) ? 'grau' : 'rot';
  if (ampel !== 'grau') {
    if (effChfH >= num(s.ampel_gruen_ab)) ampel = 'gruen';
    else if (effChfH >= num(s.ampel_rot_unter)) ampel = 'gelb';
  }
  return {
    personen, team_tage: round2(teamTage), ansatz_modus: modus, ansatz: round2(ansatz),
    verrechnungsstunden: round2(vstunden), umsatz: round2(umsatz), kosten: round2(kosten),
    rohgewinn: round2(rohgewinn), db_pro_stunde: round2(dbProStunde), eff_chf_h: round2(effChfH), ampel,
  };
}
async function kalkPositionenRead(bauabschnittIds) {
  if (!bauabschnittIds.length) return {};
  const rows = await sbGet(`gs_kalk_positionen?bauabschnitt_id=in.(${bauabschnittIds.join(',')})&select=*`).catch(() => []);
  const by = {}; (rows || []).forEach((r) => { by[r.bauabschnitt_id] = r; });
  return by;
}
// Interne Kalk-Daten je Bauabschnitt (nur ueber msub_detail = Master-only).
async function msubKalkData(projektId) {
  const settings = await kalkSettingsRead();
  let abs = [];
  try { abs = await sbGet(`gs_bauabschnitte?projekt_id=eq.${projektId}&select=id,name,team_tage,gesamtbetrag,reihenfolge&order=reihenfolge.asc`); }
  catch (e) { if (isNoTable(e)) return { settings, positionen: [], notMigrated: true }; throw e; }
  const kById = await kalkPositionenRead((abs || []).map((a) => a.id));
  const positionen = (abs || []).map((a) => {
    const kp = kById[a.id];
    const inp = kp ? { personen: kp.personen, team_tage: kp.team_tage, ansatz_modus: kp.ansatz_modus }
                   : { personen: 2, team_tage: num(a.team_tage), ansatz_modus: 'detailliert' };
    return { bauabschnitt_id: a.id, name: a.name, gesamtbetrag: num(a.gesamtbetrag), gespeichert: !!kp, ...kalkCompute(inp, settings) };
  });
  return { settings, positionen };
}
// BLOCK 1 (Runde 7): Idempotenz-Helfer. Liefert die id eines bereits vorhandenen,
// gleichnamigen Bauabschnitts im selben Projekt, sofern noch KEIN Geld im Escrow
// liegt (nur 'wartend'/'offen'/'geklaert'-Steps) — dann darf er gefahrlos statt
// eines Duplikats neu berechnet werden. Sonst null (echter neuer Abschnitt).
async function msubFindReusableAbschnitt(projektId, name) {
  const nm = String(name || '').trim().slice(0, 120);
  if (!nm) return null;
  try {
    const rows = await sbGet(`gs_bauabschnitte?projekt_id=eq.${projektId}&select=id,name,reihenfolge&order=reihenfolge.asc`);
    const cand = (rows || []).filter((r) => String(r.name || '').trim() === nm);
    for (const c of cand) {
      const steps = await sbGet(`gs_steps?bauabschnitt_id=eq.${c.id}&select=status`).catch(() => []);
      const moved = (steps || []).some((s) => ['hinterlegt', 'gs_fertig', 'freigegeben'].includes(s.status));
      if (!moved) return c.id;
    }
    return null;
  } catch (e) { if (isNoTable(e)) return null; throw e; }
}

// BLOCK 4 (Runde 7): Bauabschnitt löschen (inkl. Steps/Escrow/Kalk via FK-Cascade).
// Serverseitige Durchsetzung: NUR solange kein Angebot abgeschickt/entschieden ist –
// danach ist die Kalkulation Teil eines rausgegangenen Angebots und bleibt eingefroren.
async function msubKalkDel(b, access) {
  msubAssertMaster(access);
  try {
    const id = uuid(b.bauabschnitt_id);
    const rows = await sbGet(`gs_bauabschnitte?id=eq.${id}&select=projekt_id&limit=1`);
    const pid = rows && rows[0] && rows[0].projekt_id;
    if (!pid) return { error: 'Bauabschnitt nicht gefunden' };
    const ang = await sbGet(`gs_angebote?projekt_id=eq.${pid}&select=status`).catch(() => []);
    if ((ang || []).some((a) => ['abgeschickt', 'angenommen', 'besprechung'].includes(a.status)))
      return { error: 'Angebot bereits abgeschickt – Bauabschnitt nicht mehr löschbar.' };
    const dr = await zsAbschnittDel(id);
    if (dr && dr.error) return dr;
    return { ok: true };
  } catch (e) { if (isNoTable(e)) return { error: 'Nicht migriert', notMigrated: true }; throw e; }
}

// Kalkulieren & uebernehmen: berechnet Umsatz und setzt ihn als gesamtbetrag ueber
// die BESTEHENDE Engine (zsAbschnittSave → Kette). Legt bei Bedarf den Abschnitt an.
async function msubKalkApply(b, access) {
  msubAssertMaster(access);
  try {
    const settings = await kalkSettingsRead();
    const calc = kalkCompute({ personen: b.personen, team_tage: b.team_tage, ansatz_modus: b.ansatz_modus }, settings);
    let bauId = b.bauabschnitt_id ? uuid(b.bauabschnitt_id) : null;
    // BLOCK 1 (Runde 7) — Doppelklick-/Retry-Schutz, serverseitig idempotent.
    // Ohne bauabschnitt_id würde jeder Klick eine neue Zeile anlegen. Ein früherer
    // (post-insert) Fehler ließ die Zeile stehen und die Client-Retry erzeugte
    // Duplikate (Test: 4 identische Bauabschnitte). Fix: einen frisch angelegten,
    // gleichnamigen Abschnitt desselben Projekts wiederverwenden, solange noch kein
    // Geld im Escrow liegt. So kollabieren schnelle Mehrfachklicks auf EINEN Abschnitt.
    if (!bauId && b.projekt_id) bauId = await msubFindReusableAbschnitt(uuid(b.projekt_id), b.name);
    const save = {
      id: bauId || undefined,
      projekt_id: bauId ? undefined : (b.projekt_id ? uuid(b.projekt_id) : undefined),
      name: b.name, split_profil: b.split_profil, einheit_typ: b.einheit_typ, einheit_anzahl: b.einheit_anzahl,
      team_tage: calc.team_tage, gesamtbetrag: calc.umsatz, regenerate: true,
    };
    const zr = await zsAbschnittSave(save, access);
    if (zr && zr.error) return zr;
    bauId = (zr && zr.abschnitt && zr.abschnitt.id) || bauId;
    if (!bauId) return { error: 'Bauabschnitt nicht gespeichert' };
    // Kalk-Eingaben sind nur ein Audit-Nebenprodukt; ein Fehler hier darf nach
    // erfolgreichem Insert NIE einen 500 „Serverfehler" auslösen (Duplikat-Ursache).
    try {
      await sbWrite('POST', 'gs_kalk_positionen?on_conflict=bauabschnitt_id',
        { bauabschnitt_id: bauId, personen: calc.personen, team_tage: calc.team_tage, ansatz_modus: calc.ansatz_modus, updated_at: new Date().toISOString() },
        'resolution=merge-duplicates,return=minimal');
    } catch (e) { console.error('kalk_positionen upsert (nicht kritisch):', e.message); }
    return { ok: true, bauabschnitt_id: bauId, kalk: calc };
  } catch (e) { if (isNoTable(e)) return { error: 'Nicht migriert', notMigrated: true }; throw e; }
}
