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
      case 'marketing':       return res.status(200).json(await getMarketing());
      case 'mkt_kosten_set':  return res.status(200).json(await setKanalKosten(req.body));
      case 'mkt_content_add': return res.status(200).json(await addContent(req.body));
      case 'mkt_content_set': return res.status(200).json(await setContentStatus(req.body));
      case 'mkt_content_del': return res.status(200).json(await delContent(req.body.id));
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
  const { anfragen } = await loadCore();
  const today = todayISO();
  const monthPrefix = today.slice(0, 7);

  const perStufe = { neu: 0, kontaktiert: 0, angebot: 0, gewonnen: 0, verloren: 0 };
  const perQuelle = {};
  let pipelineWert = 0, gewonnenMonat = 0;
  let followupHeute = 0, followupUeberfaellig = 0;

  for (const a of anfragen) {
    const st = stufeOf(a);
    perStufe[st] = (perStufe[st] || 0) + 1;
    const q = a.quelle || 'direkt';
    perQuelle[q] = (perQuelle[q] || 0) + 1;
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

// ── Marketing ──
async function getMarketing() {
  const { anfragen } = await loadCore();
  const agg = {}; // kanal → {leads, gewonnen}
  for (const a of anfragen) {
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

  const totals = kanaele.reduce((t, k) => ({
    leads: t.leads + k.leads, gewonnen: t.gewonnen + k.gewonnen, kosten: t.kosten + k.kosten,
  }), { leads: 0, gewonnen: 0, kosten: 0 });
  totals.kosten = Math.round(totals.kosten);
  totals.cpl = totals.leads > 0 ? Math.round((totals.kosten / totals.leads) * 100) / 100 : 0;

  return { kanaele, content, totals };
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
  // Anfrage-Titel (optional) nachladen, falls verknüpft.
  const ids = rows.map((r) => r.anfrage_id).filter(Boolean);
  let titelById = {};
  if (ids.length) {
    try {
      const anf = await sbGet(`gs_anfragen?id=in.(${ids.join(',')})&select=id,projekt_name`);
      for (const a of anf) titelById[a.id] = a.projekt_name;
    } catch (_) {}
  }
  let umsatz = 0, marge = 0, einkauf = 0;
  const margen = rows.map((m) => {
    const c = calcMarge(m);
    umsatz += c.umsatz; marge += c.marge; einkauf += c.einkauf;
    return {
      id: m.id, titel: m.titel, anfrage_id: m.anfrage_id,
      anfrage_titel: m.anfrage_id ? (titelById[m.anfrage_id] || null) : null,
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
  if (body.anfrage_id) payload.anfrage_id = uuid(body.anfrage_id);
  const row = await sbWrite('POST', 'gs_margen', payload);
  return { ok: true, marge: Array.isArray(row) ? row[0] : row };
}
async function updateMarge(body) {
  uuid(body.id);
  const patch = {};
  ['titel', 'notiz'].forEach((k) => { if (body[k] !== undefined) patch[k] = body[k] || null; });
  ['einkauf', 'stundensatz', 'stunden'].forEach((k) => { if (body[k] !== undefined) patch[k] = num(body[k]); });
  if (body.umsatz_manuell !== undefined) patch.umsatz_manuell = (body.umsatz_manuell === '' || body.umsatz_manuell == null) ? null : num(body.umsatz_manuell);
  if (!Object.keys(patch).length) return { ok: true };
  await sbWrite('PATCH', `gs_margen?id=eq.${body.id}`, patch, 'return=minimal');
  return { ok: true };
}
async function delMarge(id) {
  uuid(id);
  await sbWrite('DELETE', `gs_margen?id=eq.${id}`, undefined, 'return=minimal');
  return { ok: true };
}
