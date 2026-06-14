// api/cockpit.js — Master-Cockpit Daten-API (server-side, service_role)
// ─────────────────────────────────────────────────────────────────────────
// SICHERHEIT (Kern):
//   Der Server nutzt den service_role-Key (umgeht RLS). Deshalb wird JEDE
//   Anfrage HART gegated: Token → /auth/v1/user → user.id MUSS exakt die
//   Master/Admin-UUID sein, sonst 403. Es gibt keinen anderen Zugang.
//   Zusätzlich verlangt RLS in der DB auth.uid()=Master (Schutz des anon-Keys
//   im Browser/DevTools). Doppelte Absicherung.
// ─────────────────────────────────────────────────────────────────────────

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  const { token, action } = req.body || {};
  const master = await verifyMaster(token);
  if (!master) return res.status(403).json({ error: 'Kein Zugriff' }); // generisch, kein Leak

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
      default:                return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
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
    rows = await sbGet('gs_umsatz_monat?select=jahr,monat,umsatz_chf,anzahl_projekte,notiz&order=jahr.asc,monat.asc');
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

// Alle relevanten Kennzahlen in EINEM Objekt — ausschliesslich aus echten
// Tabellen. Optionale (evtl. nicht migrierte) Quellen sind resilient (try/catch).
async function getJarvisFacts() {
  const { anfragen, kunden } = await loadCore();
  const today = todayISO();
  const monthPrefix = today.slice(0, 7);

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

  // Offene CRM-Aufgaben (zählen ebenfalls als Follow-ups).
  let offeneAufgaben = 0;
  try {
    const auf = await sbGet('gs_crm_aufgaben?status=eq.offen&select=faelligkeit');
    offeneAufgaben = auf.length;
    for (const t of auf) {
      if (!t.faelligkeit) continue;
      if (t.faelligkeit === today) fuHeute++;
      else if (t.faelligkeit < today) fuUeber++;
    }
  } catch (_) {}

  // Interne To-Dos (Team).
  let todosOffen = 0, todosHeute = 0, todosUeber = 0, topTodos = [];
  try {
    const todos = await sbGet('gs_todos?status=eq.offen&select=titel,zustaendig,faelligkeit,prioritaet&order=faelligkeit.asc.nullslast&limit=8');
    todosOffen = todos.length;
    for (const t of todos) {
      if (!t.faelligkeit) continue;
      if (t.faelligkeit === today) todosHeute++;
      else if (t.faelligkeit < today) todosUeber++;
    }
    topTodos = todos.slice(0, 5).map((t) => ({
      titel: t.titel, zustaendig: t.zustaendig || null,
      faelligkeit: t.faelligkeit || null, prioritaet: t.prioritaet || 'mittel',
    }));
  } catch (_) {}

  // Margen / Umsatz (nur falls migriert).
  let umsatz = 0, marge = 0, margenDa = false;
  try {
    const margen = await sbGet('gs_margen?select=einkauf,stundensatz,stunden,umsatz_manuell');
    margenDa = margen.length > 0;
    for (const m of margen) { const c = calcMarge(m); umsatz += c.umsatz; marge += c.marge; }
  } catch (_) {}

  // Projekte / Techniker.
  let projGesamt = 0, projAktiv = 0, techGesamt = 0, techFrei = 0;
  try {
    const pr = await sbGet('gs_projekte?select=status');
    projGesamt = pr.length;
    projAktiv = pr.filter((p) => String(p.status || '').toLowerCase() === 'aktiv').length;
  } catch (_) {}
  try {
    const te = await sbGet('gs_techniker?select=verfuegbar');
    techGesamt = te.length;
    techFrei = te.filter((t) => t.verfuegbar === true).length;
  } catch (_) {}

  // Umsatz pro Monat (gs_umsatz_monat) — die einzige Quelle für Umsatzfragen.
  const ums = await getUmsatzStats();

  return {
    datum: today,
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
  };
}

const JARVIS_SYSTEM = `Du bist „Jarvis", der persönliche Sprach-Assistent im internen Master-Cockpit von George Solutions (B2B-Handwerks- und Facility-Firma, Schweiz). Der Geschäftsführer stellt dir Fragen zu seinem Betrieb. Du erhältst die ECHTEN, aktuellen Kennzahlen aus der Datenbank als JSON.

REGELN:
- Beantworte die Frage AUSSCHLIESSLICH auf Basis der bereitgestellten Zahlen. Erfinde nichts.
- Steht die Antwort nicht in den Daten, sag ehrlich, dass du dazu im Cockpit keine Zahl hast — und nenne, falls passend, eine verwandte Zahl die du hast.
- Antworte kurz und gesprochen, 1 bis 3 Sätze. Deine Antwort wird laut vorgelesen.
- KEINE Markdown-Symbole, keine Sternchen, keine Aufzählungszeichen, keine Tabellen. Reiner Fliesstext.
- Nenne konkrete Zahlen. Geldbeträge als „… Franken" (CHF-Werte sind in Schweizer Franken).
- UMSATZFRAGEN beantwortest du ausschliesslich aus den Feldern umsatz_pro_monat, umsatz_erfasste_monate_chf, umsatz_dieses_jahr_chf und bester_umsatzmonat. Ist umsatz_daten_vorhanden false oder umsatz_pro_monat leer, sag ehrlich: „Es sind noch keine Umsatzdaten hinterlegt." — erfinde NIE Umsatzzahlen. (Die Felder rund um marge_* stammen aus der separaten Margen-Kalkulation, nicht aus der Monatsumsatz-Erfassung.)
- Sprich Hochdeutsch, professionell, ruhig und prägnant — wie ein kompetenter Assistent. Du-Form.`;

async function askJarvis(body) {
  const frage = String((body && body.frage) || '').trim().slice(0, 500);
  if (!frage) throw new Error('frage nötig');
  const facts = await getJarvisFacts();

  // Ohne Claude-Key → einfache, ehrliche Kurzantwort aus den Zahlen (Fallback).
  if (!ANTHROPIC_KEY) {
    return { antwort: jarvisFallback(facts), facts, fallback: true };
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: `${JARVIS_SYSTEM}\n\nHEUTE: ${facts.datum}\n\nAKTUELLE COCKPIT-DATEN (JSON):\n${JSON.stringify(facts)}`,
        messages: [{ role: 'user', content: frage }],
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
