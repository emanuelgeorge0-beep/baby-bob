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
  'pm_datei_upload', 'pm_datei_list', 'pm_datei_del',
  'pm_export_material', 'pm_export_rapporte', 'pm_export_rechnungen',
  'pm_datenblatt_save',
]);

// Zugriffskontext bestimmen:
//   • Master/Admin  → { isMaster:true,  partnerId:null }  (sieht ALLE Projekte)
//   • Partner + PM  → { isMaster:false, partnerId:uid  }  (nur EIGENE Projekte,
//                       nur wenn Feature 'projektmanagement' freigeschaltet ist)
//   • sonst         → null  (→ 403)
async function resolveAccess(token, action) {
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const user = await r.json().catch(() => null);
  if (!user || !user.id) return null;
  let role = null;
  try {
    const rows = await sbGet(`user_roles?user_id=eq.${user.id}&select=role&limit=1`);
    role = rows?.[0]?.role || null;
  } catch (_) { return null; }
  // Master: exakt die Master-UUID mit Master/Admin-Rolle (unverändert streng).
  if (user.id === MASTER_UID && (role === 'master' || role === 'gs_admin')) {
    return { isMaster: true, partnerId: null, userId: user.id };
  }
  // Partner: NUR PM-Actions und NUR mit Entitlement 'projektmanagement'.
  if (role === 'gs_partner' && PM_ACTIONS.has(action)) {
    if (await isEntitled(user.id, 'projektmanagement')) {
      return { isMaster: false, partnerId: user.id, userId: user.id };
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

  const { token, action } = req.body || {};
  const access = await resolveAccess(token, action);
  if (!access) return res.status(403).json({ error: 'Kein Zugriff' }); // generisch, kein Leak
  const scope = { partnerId: access.partnerId }; // Master: null → sieht alles

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
      case 'pm_datei_list':    return res.status(200).json(await pmDateiList(req.body.projekt_id, scope));
      case 'pm_datei_del':     return res.status(200).json(await pmDateiDel(req.body, scope));
      case 'pm_export_material':   return res.status(200).json(await exportMaterial(req.body.projekt_id, scope));
      case 'pm_export_rapporte':   return res.status(200).json(await exportRapporte(req.body.projekt_id, scope));
      case 'pm_export_rechnungen': return res.status(200).json(await exportRechnungen(req.body.projekt_id, scope));
      case 'pm_datenblatt_save':   return res.status(200).json(await savePmDatenblatt(req.body, scope));
      // ── Zahlungssystem (Escrow-Engine) — Master-only (nicht in PM_ACTIONS) ──
      case 'zs_profile':       return res.status(200).json(await zsProfile());
      case 'zs_projekt':       return res.status(200).json(await zsProjekt(req.body.projekt_id));
      case 'zs_abschnitt_save':return res.status(200).json(await zsAbschnittSave(req.body, access));
      case 'zs_abschnitt_del': return res.status(200).json(await zsAbschnittDel(req.body.id));
      case 'zs_step_action':   return res.status(200).json(await zsStepAction(req.body, access));
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
    const pr = await sbGet('gs_projekte?select=status');
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
    const pr = await sbGet('gs_projekte?select=id,name,projektnummer,status&order=created_at.desc');
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
  try { projekte = await sbGet('gs_projekte?select=id,status,bereich,stundensatz'); } catch (_) {}
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
    sbGet('gs_projekte?select=status').catch(() => []),
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
    sbGet('gs_projekte?select=id,name,projektnummer,standort,status,kunde_id&order=created_at.desc').catch(() => []),
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
    sbGet(`gs_projekte?select=*&order=created_at.desc${projFilter}`).catch(() => []),
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
  if (!projekt) return { error: 'Projekt nicht gefunden' };
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
async function savePmProjekt(b, scope) {
  // Bearbeiten: Partner darf nur EIGENE Projekte ändern.
  if (b.id) await requireOwnedProjekt(b.id, scope);
  const patch = {};
  // Neuanlage durch Partner → Besitz wird server-seitig erzwungen (nie clientseitig).
  if (!b.id && scope && scope.partnerId) patch.partner_user_id = scope.partnerId;
  if (b.name !== undefined) patch.name = String(b.name || '').trim().slice(0, 120);
  if (b.projektnummer !== undefined) patch.projektnummer = String(b.projektnummer || '').trim().slice(0, 60) || null;
  if (b.standort !== undefined) patch.standort = String(b.standort || '').trim().slice(0, 160) || null;
  if (b.bereich !== undefined) patch.bereich = String(b.bereich || '').trim().slice(0, 80) || null;
  if (b.status !== undefined) patch.status = String(b.status || '').trim().slice(0, 40) || 'aktiv';
  if (b.kunde_id !== undefined) patch.kunde_id = b.kunde_id ? uuid(b.kunde_id) : null;
  if (b.stundensatz !== undefined) patch.stundensatz = (b.stundensatz === '' || b.stundensatz == null) ? null : num(b.stundensatz);
  for (const f of PM_PROJ_EXTRA) {
    if (b[f] !== undefined) patch[f] = String(b[f] || '').trim().slice(0, 200) || null;
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
  if (b.id) {
    // Bestehenden Kunden nur ändern, wenn er dem Partner gehört (Besitz via eigener
    // partner_user_id, nicht über ein Projekt).
    if (scope && scope.partnerId) {
      const rows = await sbGet(`gs_kunden?id=eq.${uuid(b.id)}&select=partner_user_id&limit=1`).catch(() => []);
      const owner = rows && rows[0] ? (rows[0].partner_user_id ?? null) : undefined;
      if (owner !== scope.partnerId) throw new Forbidden();
    }
    const id = uuid(b.id);
    const r = await sbWrite('PATCH', `gs_kunden?id=eq.${id}`, patch);
    return { ok: true, kunde: Array.isArray(r) ? r[0] : r };
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
    throw e;
  }
  return { ok: true, kunde: Array.isArray(r) ? r[0] : r };
}

async function getPmTechniker() {
  // Nur echte Techniker (typ='techniker' bzw. Legacy ohne typ) – wie die öffentliche Karte.
  const raw = await sbGet('gs_techniker?select=*&order=name.asc').catch(() => []);
  const techniker = (Array.isArray(raw) ? raw : [])
    .filter((t) => !t.typ || t.typ === 'techniker')
    .map((t) => ({ id: t.id, ...pmTechCard(t) }));
  return { techniker };
}

async function assignTech(b, scope) {
  await requireOwnedProjekt(b.projekt_id, scope);
  const row = {
    projekt_id: uuid(b.projekt_id),
    techniker_id: uuid(b.techniker_id),
    taetigkeit: b.taetigkeit ? String(b.taetigkeit).slice(0, 120) : null,
  };
  if (b.stundensatz != null && b.stundensatz !== '') row.stundensatz = num(b.stundensatz);
  try {
    const r = await sbWrite('POST', 'gs_projekt_techniker', row);
    return { ok: true, row: Array.isArray(r) ? r[0] : r };
  } catch (e) {
    if (isNoTable(e)) return { notMigrated: true };
    // stundensatz-Spalte fehlt noch → ohne Tarif zuweisen (kein 500).
    if ('stundensatz' in row && /column|does not exist|PGRST204/i.test((e && e.message) || '')) {
      const { stundensatz, ...base } = row;
      try { const r = await sbWrite('POST', 'gs_projekt_techniker', base); return { ok: true, row: Array.isArray(r) ? r[0] : r, tarifNotMigrated: true }; }
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
  const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).filter(Boolean).map(uuid);
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
// Drei Kategorien (Unterordner je Projekt). Unbekannt/leer → 'dateien'.
const PM_KATEGORIEN = ['bilder', 'plaene', 'dateien'];
function pmKategorie(v) { const k = String(v || '').toLowerCase(); return PM_KATEGORIEN.includes(k) ? k : 'dateien'; }
async function pmDateiUpload(b, scope) {
  const projektId = uuid(b.projekt_id);
  await requireOwnedProjekt(projektId, scope); // VOR dem Storage-Write (kein Leak)
  const buf = sbDecodeB64(b.data);
  if (!buf) throw new Error('Datei (base64) erforderlich');
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
  return { ok: true, datei: { name: sbDisplayName(path.split('/').pop()), path, kategorie: kat, contentType, size: buf.length, url } };
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
  return all;
}

async function pmDateiDel(b, scope) {
  const projektId = uuid(b.projekt_id);
  await requireOwnedProjekt(projektId, scope);
  const path = String(b.path || '');
  if (!path.startsWith(`${projektId}/`)) throw new Error('Ungültiger Pfad');
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${PM_DATEI_BUCKET}/${path}`, { method: 'DELETE', headers: SB });
  if (!r.ok) return { error: 'Löschen fehlgeschlagen' };
  return { ok: true };
}

// ── PDF-Export pro Abschnitt (wiederverwendet lib/pdf.buildPdf) ────────────
// Liefert das PDF als base64 zurück; das Cockpit macht daraus einen Download.
function pdfResult(buf, filename) {
  return { ok: true, filename, pdf_base64: Buffer.from(buf).toString('base64') };
}
function chf(n) { return 'CHF ' + Number(n || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function projektHead(projektId) {
  const pr = await sbGet(`gs_projekte?id=eq.${projektId}&select=name,projektnummer,standort&limit=1`).catch(() => []);
  return (pr && pr[0]) || {};
}

async function exportMaterial(projektId, scope) {
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
  return pdfResult(buildPdf({ title: 'George Solutions', blocks }), `Materialliste_${(p.projektnummer || 'projekt')}.pdf`);
}

async function exportRapporte(projektId, scope) {
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
  return pdfResult(buildPdf({ title: 'George Solutions', blocks }), `Arbeitsrapporte_${(p.projektnummer || 'projekt')}.pdf`);
}

async function exportRechnungen(projektId, scope) {
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
  return pdfResult(buildPdf({ title: 'George Solutions', blocks }), `Rechnungen_${(p.projektnummer || 'projekt')}.pdf`);
}

// Storage-Helfer (Muster aus api/projectflow.js).
async function sbSignUrl(bucket, path, expiresIn = 3600) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, { method: 'POST', headers: SB, body: JSON.stringify({ expiresIn }) });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return d.signedURL ? SUPABASE_URL + '/storage/v1' + d.signedURL : null;
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
  return { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', dwg: 'application/acad', dxf: 'image/vnd.dxf' }[e] || 'application/octet-stream';
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
function zsBuildSpecs(profil, einheitAnzahl, vert) {
  const units = Math.max(1, einheitAnzahl | 0);
  const rb = num(vert.rueckbehalt) || 0;
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
    for (let i = 1; i <= units; i++) specs.push({ typ: 'zahlung', art: 'fortschritt', fortschritt: true, bezeichnung: `Fortschritt Einheit ${i}/${units}` });
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
async function zsGenerateChain(abschnitt) {
  const profil = abschnitt.split_profil || 'stueck_15_70_15';
  const vert = await zsVerteilung(profil);
  const specs = zsBuildSpecs(profil, abschnitt.einheit_anzahl, vert);
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
