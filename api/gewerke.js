// api/gewerke.js – Universelles GEWERKE-STEP-FRAMEWORK
// Hierarchie: Projekt (gs_projekte) → Haus → Einheit → Step → Status.
// Templates sind hart hinterlegt; beim Setup werden Steps je Einheit & Gewerk
// automatisch erzeugt. Sequenzieller Pflicht-Workflow (Vorgänger + Foto-Gate).
// Service-Key → RLS wird umgangen; Zugriff wird hier im Code durchgesetzt.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

// ═══ GEWERKE-TEMPLATES (hart hinterlegt) ═══════════════════════════════════
// foto: Foto-Gate (Nachweis vor Abschluss). editierbar: Sequenz anpassbar.
// pflicht_vorgaenger_nr wird beim Erzeugen gesetzt (= nr-1, erster = null).
const TEMPLATES = {
  sanitaer: {
    key: 'sanitaer', label: 'Sanitär', icon: '🚿', editierbar: false,
    steps: [
      { nr: 1,  titel: 'Einlegearbeiten (Leitungen in Beton vor Betonage)', zone: 'Rohbau',        foto: true  },
      { nr: 2,  titel: 'Wasserzonen + Zirkulation (Kalt-, Warmwasser, Zirkulation)', zone: 'Rohinstallation', foto: false },
      { nr: 3,  titel: 'Ablaufzonen (WC, Waschmaschine, Dusche, Waschtisch)', zone: 'Rohinstallation', foto: false },
      { nr: 4,  titel: 'Druckprobe (Wasserzonen + Ablaufzonen)', zone: 'Dichtheit',    foto: true  },
      { nr: 5,  titel: 'Isolierung', zone: 'Ausbau',        foto: true  },
      { nr: 6,  titel: 'Gießrahmen-Installation (WC, Waschtisch, Dusche, Waschmaschine)', zone: 'Ausbau', foto: false },
      { nr: 7,  titel: 'Gießrahmen-Anschlüsse (Wasser + Abläufe verbinden)', zone: 'Ausbau', foto: false },
      { nr: 8,  titel: 'Finale Druckprobe (komplette Wohnung mit Gießrahmen)', zone: 'Dichtheit', foto: true },
      { nr: 9,  titel: 'Finale Spülung + Abnahme (Abläufe spülen, Ventile prüfen, Wände schließen)', zone: 'Abnahme', foto: true },
      { nr: 10, titel: 'Apparaten-/Fertigmontage (WC, Armaturen, Möbel, Spiegelschrank, Haltegriffe, Betätigungsplatten, Eckventile, Waschmaschinenventil)', zone: 'Fertigmontage', foto: true },
    ],
  },
  heizung: {
    key: 'heizung', label: 'Heizung', icon: '🔥', editierbar: false,
    steps: [
      { nr: 1, titel: 'Einlegearbeiten (falls Bodenleitungen vor Betonage)', zone: 'Rohbau', foto: true },
      { nr: 2, titel: 'Heizungszonen Vorlauf + Rücklauf', zone: 'Rohinstallation', foto: false },
      { nr: 3, titel: 'Druckprobe / Abdrücken / Pressen', zone: 'Dichtheit', foto: true },
      { nr: 4, titel: 'Isolierung', zone: 'Ausbau', foto: true },
      { nr: 5, titel: 'Fußbodenheizungs-Verteiler anschließen', zone: 'Ausbau', foto: false },
      { nr: 6, titel: 'Trittschalldämmung verlegen', zone: 'Ausbau', foto: false },
      { nr: 7, titel: 'Fußbodenheizung installieren', zone: 'Ausbau', foto: false },
      { nr: 8, titel: 'Fußbodenheizung abdrücken', zone: 'Dichtheit', foto: true },
      { nr: 9, titel: 'Heizungszentrale erstellen (Wärmeerzeuger, Anbindung, Inbetriebnahme)', zone: 'Inbetriebnahme', foto: false },
    ],
  },
  splitklima: {
    key: 'splitklima', label: 'Splitklima', icon: '❄️', editierbar: true,
    steps: [
      { nr: 1, titel: 'Außengerät + Innengeräte montieren', zone: 'Montage', foto: false },
      { nr: 2, titel: 'Durchbrüche Innen↔Außen vorbereiten', zone: 'Montage', foto: false },
      { nr: 3, titel: 'Kälteleitungen verlegen (Saugleitung + Flüssigkeitsleitung)', zone: 'Installation', foto: false },
      { nr: 4, titel: 'Elektro: Stromkabel, Netzwerkkabel, Steuer-/Kommunikationskabel', zone: 'Installation', foto: false },
      { nr: 5, titel: 'Kondensat: Kondenswasserleitung (+ Kondenspumpe bei langer Strecke, + Klimasiphon)', zone: 'Installation', foto: false },
      { nr: 6, titel: 'Vakuumieren', zone: 'Inbetriebnahme', foto: true },
      { nr: 7, titel: 'Kältemittel öffnen / Anlage füllen', zone: 'Inbetriebnahme', foto: false },
      { nr: 8, titel: 'Inbetriebnahme', zone: 'Inbetriebnahme', foto: true },
    ],
  },
  industriekaelte: {
    key: 'industriekaelte', label: 'Industriekälte', icon: '🏭', editierbar: true,
    steps: [
      { nr: 1, titel: 'Kältemaschine (unten) aufstellen', zone: 'Aufstellung', foto: false },
      { nr: 2, titel: 'Chiller / Rückkühler (Dach) aufstellen', zone: 'Aufstellung', foto: false },
      { nr: 3, titel: 'Verrohrung Kältemaschine ↔ Verbraucher', zone: 'Installation', foto: false },
      { nr: 4, titel: 'Kältespeicher anbinden (optional)', zone: 'Installation', foto: false },
      { nr: 5, titel: 'Chiller-Anbindung (Wärmeabfuhr übers Dach, Rücklauf ~20°C zur Maschine)', zone: 'Installation', foto: false },
      { nr: 6, titel: 'Dämmung / Isolierung', zone: 'Ausbau', foto: true },
      { nr: 7, titel: 'Druckprobe / Dichtheitsprüfung', zone: 'Dichtheit', foto: true },
      { nr: 8, titel: 'Befüllung / Inbetriebnahme', zone: 'Inbetriebnahme', foto: false },
    ],
  },
};

const STATUS = ['offen', 'in_arbeit', 'abgeschlossen', 'blockiert'];
const STATUS_SYMBOL = { offen: '⏳', in_arbeit: '🟡', abgeschlossen: '✅', blockiert: '🔴' };
const STATUS_LABEL = { offen: 'offen', in_arbeit: 'in Arbeit', abgeschlossen: 'abgeschlossen', blockiert: 'blockiert' };

// Steps einer Einheit für ein Gewerk erzeugen (reine Funktion, testbar).
function buildStepsForTemplate(gewerkKey) {
  const tpl = TEMPLATES[gewerkKey];
  if (!tpl) return null;
  return tpl.steps.map((s) => ({
    gewerk: tpl.key,
    reihenfolge_nr: s.nr,
    titel: s.titel,
    zone: s.zone || null,
    foto_gate: !!s.foto,
    pflicht_vorgaenger_nr: s.nr > 1 ? s.nr - 1 : null,
    status: 'offen',
    prozent_fertig: 0,
  }));
}

// Status-Übergang prüfen (reine Funktion, testbar).
// steps: alle Steps derselben (einheit,gewerk)-Spur. Gibt {ok, error} zurück.
function validateStatusChange(step, newStatus, spurSteps, hasFoto) {
  if (!STATUS.includes(newStatus)) return { ok: false, error: `Ungültiger Status: ${newStatus}` };
  // Vorgänger-Gate: Start (in_arbeit/abgeschlossen) nur wenn Pflicht-Vorgänger abgeschlossen.
  if ((newStatus === 'in_arbeit' || newStatus === 'abgeschlossen') && step.pflicht_vorgaenger_nr) {
    const vg = spurSteps.find((s) => s.reihenfolge_nr === step.pflicht_vorgaenger_nr);
    if (vg && vg.status !== 'abgeschlossen') {
      return { ok: false, error: `Pflicht-Vorgänger "${vg.titel}" (Schritt ${vg.reihenfolge_nr}) muss zuerst abgeschlossen sein.` };
    }
  }
  // Foto-Gate: Abschluss nur mit Foto-Nachweis.
  if (newStatus === 'abgeschlossen' && step.foto_gate && !hasFoto) {
    return { ok: false, error: 'Foto-Gate: Für den Abschluss dieses Schritts ist ein Foto-Nachweis erforderlich.' };
  }
  return { ok: true };
}

// Fortschritt eines Hauses = abgeschlossene Steps / Gesamt-Steps über alle Einheiten.
function computeProgress(steps) {
  const total = steps.length;
  const done = steps.filter((s) => s.status === 'abgeschlossen').length;
  const inArbeit = steps.filter((s) => s.status === 'in_arbeit').length;
  const blockiert = steps.filter((s) => s.status === 'blockiert').length;
  const offen = steps.filter((s) => s.status === 'offen').length;
  return { total, done, in_arbeit: inArbeit, blockiert, offen, prozent: total ? Math.round((done / total) * 100) : 0 };
}

// ═══ HANDLER ═══════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  const { action } = req.body || {};
  // templates braucht keine Auth (öffentliche Referenzdaten fürs Setup-UI).
  if (action === 'templates') return res.status(200).json({ templates: publicTemplates() });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim() || (req.body && req.body.token) || '';
  if (!token) return res.status(401).json({ error: 'Nicht authentifiziert' });
  const user = await getUser(token);
  if (!user) return res.status(401).json({ error: 'Ungültiger oder abgelaufener Token' });
  const role = await getRole(user.id);
  const isAdmin = role === 'gs_admin' || role === 'master';

  try {
    switch (action) {
      case 'projekte':      return await listProjekte(res, user, role, isAdmin);
      case 'tree':          return await tree(res, req.body, user, role, isAdmin);
      case 'setup':         return await setup(res, req.body, user, role, isAdmin);
      case 'haus_add':      return await hausAdd(res, req.body, user, role, isAdmin);
      case 'einheit_add':   return await einheitAdd(res, req.body, user, role, isAdmin);
      case 'step_update':   return await stepUpdate(res, req.body, user, role, isAdmin);
      case 'haus_delete':   return await hausDelete(res, req.body, user, role, isAdmin);
      case 'statusbericht': return await statusbericht(res, req.body, user, role, isAdmin);
      default:              return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Gewerke Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

function publicTemplates() {
  return Object.values(TEMPLATES).map((t) => ({
    key: t.key, label: t.label, icon: t.icon, editierbar: t.editierbar,
    steps: t.steps.map((s) => ({ nr: s.nr, titel: s.titel, zone: s.zone, foto_gate: !!s.foto })),
  }));
}

// ── Zugriff: darf der User dieses Projekt sehen/bearbeiten? ──
async function projektIdsForUser(user, role, isAdmin) {
  if (isAdmin) return null; // null = alle
  if (role === 'gs_partner') {
    const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?partner_user_id=eq.${user.id}&select=id`, { headers: SB }));
    return (Array.isArray(rows) ? rows : []).map((r) => r.id);
  }
  if (role === 'techniker') {
    const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekt_techniker?techniker_user_id=eq.${user.id}&select=projekt_id`, { headers: SB }));
    return (Array.isArray(rows) ? rows : []).map((r) => r.projekt_id);
  }
  return [];
}
function canRead(ids, projektId) { return ids === null || ids.includes(projektId); }
// Schreiben (Setup, Step-Status): Admin/Master + zugewiesene Techniker (Bauleiter). Partner nur lesen.
function canWrite(role, isAdmin, ids, projektId) {
  if (isAdmin) return true;
  if (role === 'techniker') return ids.includes(projektId);
  return false;
}

async function listProjekte(res, user, role, isAdmin) {
  const ids = await projektIdsForUser(user, role, isAdmin);
  let url = `${SUPABASE_URL}/rest/v1/gs_projekte?select=id,name,projektnummer,standort,status&order=created_at.desc`;
  if (ids !== null) { if (!ids.length) return res.status(200).json({ projekte: [] }); url += `&id=in.(${ids.join(',')})`; }
  const rows = await sbJson(await fetch(url, { headers: SB }));
  return res.status(200).json({ projekte: Array.isArray(rows) ? rows : [] });
}

// Vollständiger Baum eines Projekts inkl. berechnetem Fortschritt pro Haus.
async function tree(res, body, user, role, isAdmin) {
  const projektId = body?.projekt_id;
  if (!projektId) return res.status(400).json({ error: 'projekt_id erforderlich' });
  const ids = await projektIdsForUser(user, role, isAdmin);
  if (!canRead(ids, projektId)) return res.status(403).json({ error: 'Keine Berechtigung' });

  const projRows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?id=eq.${projektId}&select=id,name,projektnummer,standort`, { headers: SB }));
  const projekt = (Array.isArray(projRows) ? projRows : [])[0];
  if (!projekt) return res.status(404).json({ error: 'Projekt nicht gefunden' });

  const haeuser = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_haus?projekt_id=eq.${projektId}&select=*&order=reihenfolge,created_at`, { headers: SB }));
  const hArr = Array.isArray(haeuser) ? haeuser : [];
  if (!hArr.length) return res.status(200).json({ projekt, haeuser: [] });

  const hausIds = hArr.map((h) => h.id);
  const einheiten = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_einheit?haus_id=in.(${hausIds.join(',')})&select=*&order=reihenfolge,created_at`, { headers: SB }));
  const eArr = Array.isArray(einheiten) ? einheiten : [];
  const einheitIds = eArr.map((e) => e.id);
  let sArr = [];
  if (einheitIds.length) {
    const steps = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_step?einheit_id=in.(${einheitIds.join(',')})&select=*&order=gewerk,reihenfolge_nr`, { headers: SB }));
    sArr = Array.isArray(steps) ? steps : [];
  }

  const stepsByEinheit = groupBy(sArr, 'einheit_id');
  const einheitByHaus = groupBy(eArr, 'haus_id');
  const out = hArr.map((h) => {
    const units = (einheitByHaus[h.id] || []).map((e) => {
      const st = stepsByEinheit[e.id] || [];
      const gewerke = [...new Set(st.map((s) => s.gewerk))].map((g) => ({
        key: g, label: TEMPLATES[g]?.label || g, icon: TEMPLATES[g]?.icon || '🔧',
        steps: st.filter((s) => s.gewerk === g).sort((a, b) => a.reihenfolge_nr - b.reihenfolge_nr),
        progress: computeProgress(st.filter((s) => s.gewerk === g)),
      }));
      return { ...e, gewerke, progress: computeProgress(st) };
    });
    const allSteps = units.flatMap((u) => (u.gewerke || []).flatMap((g) => g.steps));
    return { ...h, einheiten: units, progress: computeProgress(allSteps) };
  });
  return res.status(200).json({ projekt, haeuser: out });
}

// Setup: Haus + Einheiten + Steps (je gewähltem Gewerk) automatisch erzeugen.
// body: { projekt_id, haus_name, einheiten:[names] | anzahl_einheiten, gewerke:[keys] }
async function setup(res, body, user, role, isAdmin) {
  const { projekt_id, haus_name } = body || {};
  if (!projekt_id || !haus_name) return res.status(400).json({ error: 'projekt_id und haus_name erforderlich' });
  const gewerke = (Array.isArray(body.gewerke) ? body.gewerke : []).filter((g) => TEMPLATES[g]);
  if (!gewerke.length) return res.status(400).json({ error: 'Mindestens ein gültiges Gewerk wählen' });

  const ids = await projektIdsForUser(user, role, isAdmin);
  if (!canWrite(role, isAdmin, ids || [], projekt_id)) return res.status(403).json({ error: 'Keine Berechtigung' });

  let einheitNames = [];
  if (Array.isArray(body.einheiten) && body.einheiten.length) {
    einheitNames = body.einheiten.map((x) => String(x).trim()).filter(Boolean);
  } else if (body.anzahl_einheiten) {
    const n = Math.min(Math.max(parseInt(body.anzahl_einheiten, 10) || 0, 1), 200);
    einheitNames = Array.from({ length: n }, (_, i) => `Wohnung ${i + 1}`);
  }
  if (!einheitNames.length) return res.status(400).json({ error: 'Mindestens eine Einheit erforderlich' });

  // Haus anlegen (Reihenfolge = bisherige Anzahl).
  const existing = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_haus?projekt_id=eq.${projekt_id}&select=id`, { headers: SB }));
  const reihenfolge = (Array.isArray(existing) ? existing : []).length;
  const hausRows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_haus`, {
    method: 'POST', headers: { ...SB, Prefer: 'return=representation' },
    body: JSON.stringify({ projekt_id, name: String(haus_name).trim(), reihenfolge }),
  }));
  const haus = (Array.isArray(hausRows) ? hausRows : [])[0];
  if (!haus) return res.status(400).json({ error: 'Haus konnte nicht erstellt werden (Migration ausgeführt?)' });

  // Einheiten + Steps.
  const einheitPayload = einheitNames.map((name, i) => ({ haus_id: haus.id, name, reihenfolge: i }));
  const einheitRows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_einheit`, {
    method: 'POST', headers: { ...SB, Prefer: 'return=representation' }, body: JSON.stringify(einheitPayload),
  }));
  const units = Array.isArray(einheitRows) ? einheitRows : [];

  const stepPayload = [];
  for (const e of units) {
    for (const g of gewerke) {
      for (const s of buildStepsForTemplate(g)) stepPayload.push({ einheit_id: e.id, ...s });
    }
  }
  if (stepPayload.length) {
    // In Blöcken einfügen (Vercel-Body-/URL-Limits schonen).
    for (let i = 0; i < stepPayload.length; i += 500) {
      await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_step`, {
        method: 'POST', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(stepPayload.slice(i, i + 500)),
      });
    }
  }
  return res.status(200).json({ ok: true, haus, einheiten: units.length, steps: stepPayload.length, gewerke });
}

async function hausAdd(res, body, user, role, isAdmin) {
  // Alias zu setup ohne Steps-Zwang wäre möglich; hier nur Haus + Einheiten ohne Gewerk.
  return setup(res, body, user, role, isAdmin);
}

// Einheit(en) zu bestehendem Haus hinzufügen inkl. Steps.
async function einheitAdd(res, body, user, role, isAdmin) {
  const { haus_id, name } = body || {};
  if (!haus_id || !name) return res.status(400).json({ error: 'haus_id und name erforderlich' });
  const gewerke = (Array.isArray(body.gewerke) ? body.gewerke : []).filter((g) => TEMPLATES[g]);
  const projektId = await projektIdForHaus(haus_id);
  if (!projektId) return res.status(404).json({ error: 'Haus nicht gefunden' });
  const ids = await projektIdsForUser(user, role, isAdmin);
  if (!canWrite(role, isAdmin, ids || [], projektId)) return res.status(403).json({ error: 'Keine Berechtigung' });

  const existing = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_einheit?haus_id=eq.${haus_id}&select=id`, { headers: SB }));
  const reihenfolge = (Array.isArray(existing) ? existing : []).length;
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_einheit`, {
    method: 'POST', headers: { ...SB, Prefer: 'return=representation' },
    body: JSON.stringify({ haus_id, name: String(name).trim(), reihenfolge }),
  }));
  const einheit = (Array.isArray(rows) ? rows : [])[0];
  if (!einheit) return res.status(400).json({ error: 'Einheit konnte nicht erstellt werden' });
  const stepPayload = [];
  for (const g of gewerke) for (const s of buildStepsForTemplate(g)) stepPayload.push({ einheit_id: einheit.id, ...s });
  if (stepPayload.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_step`, { method: 'POST', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(stepPayload) });
  }
  return res.status(200).json({ ok: true, einheit, steps: stepPayload.length });
}

// Step-Status/Details ändern – mit Vorgänger- + Foto-Gate.
async function stepUpdate(res, body, user, role, isAdmin) {
  const { step_id } = body || {};
  if (!step_id) return res.status(400).json({ error: 'step_id erforderlich' });
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_step?id=eq.${step_id}&select=*`, { headers: SB }));
  const step = (Array.isArray(rows) ? rows : [])[0];
  if (!step) return res.status(404).json({ error: 'Step nicht gefunden' });

  const projektId = await projektIdForEinheit(step.einheit_id);
  const ids = await projektIdsForUser(user, role, isAdmin);
  if (!canWrite(role, isAdmin, ids || [], projektId)) return res.status(403).json({ error: 'Keine Berechtigung' });

  const patch = {};
  ['notiz', 'unterschrift', 'foto_url', 'blockiert_grund', 'rapport_ref', 'material_ref'].forEach((k) => { if (k in body) patch[k] = body[k] || null; });
  if ('prozent_fertig' in body) patch.prozent_fertig = Math.min(Math.max(parseInt(body.prozent_fertig, 10) || 0, 0), 100);

  if (body.status && body.status !== step.status) {
    // Spur (dieselbe Einheit + Gewerk) laden fürs Vorgänger-Gate.
    const spur = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_step?einheit_id=eq.${step.einheit_id}&gewerk=eq.${step.gewerk}&select=id,reihenfolge_nr,titel,status`, { headers: SB }));
    const hasFoto = !!(body.foto_url || step.foto_url);
    const check = validateStatusChange(step, body.status, Array.isArray(spur) ? spur : [], hasFoto);
    if (!check.ok) return res.status(409).json({ error: check.error, gate: true });
    patch.status = body.status;
    if (body.status === 'in_arbeit' && !step.started_at) patch.started_at = new Date().toISOString();
    if (body.status === 'abgeschlossen') { patch.completed_at = new Date().toISOString(); if (!('prozent_fertig' in patch)) patch.prozent_fertig = 100; }
    if (body.status === 'offen') { patch.started_at = null; patch.completed_at = null; if (!('prozent_fertig' in patch)) patch.prozent_fertig = 0; }
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Keine Änderungen' });
  patch.updated_at = new Date().toISOString();
  patch.updated_by = user.id;

  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_step?id=eq.${step_id}`, { method: 'PATCH', headers: { ...SB, Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  const upd = await sbJson(r);
  if (!r.ok || !upd?.[0]) return res.status(400).json({ error: 'Aktualisierung fehlgeschlagen' });
  return res.status(200).json({ ok: true, step: upd[0] });
}

async function hausDelete(res, body, user, role, isAdmin) {
  const { haus_id } = body || {};
  if (!haus_id) return res.status(400).json({ error: 'haus_id erforderlich' });
  const projektId = await projektIdForHaus(haus_id);
  if (!projektId) return res.status(404).json({ error: 'Haus nicht gefunden' });
  const ids = await projektIdsForUser(user, role, isAdmin);
  if (!canWrite(role, isAdmin, ids || [], projektId)) return res.status(403).json({ error: 'Keine Berechtigung' });
  await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_haus?id=eq.${haus_id}`, { method: 'DELETE', headers: SB }); // CASCADE räumt Einheiten/Steps
  return res.status(200).json({ ok: true });
}

// ═══ STATUSBERICHT (Text + Daten für PDF & Vorlesen) ══════════════════════
// body: { projekt_id, haus_id?, zeitraum:'heute'|'kw'|'gesamt', kw?, jahr?, demo? }
async function statusbericht(res, body, user, role, isAdmin) {
  const projektId = body?.projekt_id;
  if (!projektId) return res.status(400).json({ error: 'projekt_id erforderlich' });
  const ids = await projektIdsForUser(user, role, isAdmin);
  if (!canRead(ids, projektId)) return res.status(403).json({ error: 'Keine Berechtigung' });

  const projRows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?id=eq.${projektId}&select=id,name,projektnummer,standort`, { headers: SB }));
  const projekt = (Array.isArray(projRows) ? projRows : [])[0];
  if (!projekt) return res.status(404).json({ error: 'Projekt nicht gefunden' });

  let hausFilter = '';
  if (body.haus_id) hausFilter = `&id=eq.${body.haus_id}`;
  const haeuser = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_haus?projekt_id=eq.${projektId}${hausFilter}&select=*&order=reihenfolge,created_at`, { headers: SB }));
  const hArr = Array.isArray(haeuser) ? haeuser : [];
  const hausIds = hArr.map((h) => h.id);
  let eArr = [], sArr = [];
  if (hausIds.length) {
    const einheiten = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_einheit?haus_id=in.(${hausIds.join(',')})&select=*`, { headers: SB }));
    eArr = Array.isArray(einheiten) ? einheiten : [];
    const einheitIds = eArr.map((e) => e.id);
    if (einheitIds.length) {
      const steps = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_step?einheit_id=in.(${einheitIds.join(',')})&select=*`, { headers: SB }));
      sArr = Array.isArray(steps) ? steps : [];
    }
  }

  const zeitraum = ['heute', 'kw', 'gesamt'].includes(body.zeitraum) ? body.zeitraum : 'gesamt';
  const range = resolveRange(zeitraum, body.kw, body.jahr);
  const report = buildStatusReport({ projekt, haeuser: hArr, einheiten: eArr, steps: sArr, zeitraum, range, demo: !!body.demo });
  return res.status(200).json(report);
}

// Zeitraum → {von, bis, label}. KW nach ISO-8601 (Mo–So).
function resolveRange(zeitraum, kw, jahr) {
  const now = new Date();
  const year = parseInt(jahr, 10) || now.getUTCFullYear();
  if (zeitraum === 'heute') {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const bis = new Date(d.getTime() + 86400000 - 1);
    return { von: d.toISOString(), bis: bis.toISOString(), label: `heute (${fmtDate(d)})` };
  }
  if (zeitraum === 'kw') {
    const week = parseInt(kw, 10) || isoWeek(now);
    const { von, bis } = isoWeekRange(year, week);
    return { von: von.toISOString(), bis: bis.toISOString(), label: `KW ${week}/${year} (${fmtDate(von)}–${fmtDate(bis)})`, kw: week, jahr: year };
  }
  return { von: null, bis: null, label: 'Gesamtstand' };
}

// Bericht bauen (reine Funktion, testbar): strukturierte Daten + Vorlese-Text.
function buildStatusReport({ projekt, haeuser, einheiten, steps, zeitraum, range, demo }) {
  const maskName = (n) => (demo ? maskCustomer(n) : n);
  const einheitByHaus = groupBy(einheiten, 'haus_id');
  const stepsByEinheit = groupBy(steps, 'einheit_id');

  // Aktivität im Zeitraum: Steps, deren completed_at/started_at/updated_at im Fenster liegt.
  const inRange = (iso) => { if (!range.von) return true; if (!iso) return false; return iso >= range.von && iso <= range.bis; };
  const fertigImZeitraum = steps.filter((s) => s.status === 'abgeschlossen' && (zeitraum === 'gesamt' || inRange(s.completed_at)));

  const haeuserData = haeuser.map((h) => {
    const units = einheitByHaus[h.id] || [];
    const hSteps = units.flatMap((e) => stepsByEinheit[e.id] || []);
    const p = computeProgress(hSteps);
    const offen = hSteps.filter((s) => s.status === 'offen');
    const inArbeit = hSteps.filter((s) => s.status === 'in_arbeit');
    const blockiert = hSteps.filter((s) => s.status === 'blockiert');
    // "heute dran" / nächste Schritte = niedrigste offene Step-Nr je Einheit&Gewerk, deren Vorgänger fertig.
    const naechste = naechsteSchritte(units, stepsByEinheit);
    return {
      id: h.id, name: h.name, progress: p,
      offen_count: offen.length, in_arbeit_count: inArbeit.length, blockiert_count: blockiert.length, done_count: p.done,
      blockiert: blockiert.map((s) => ({ titel: s.titel, grund: s.blockiert_grund || '', einheit: unitName(units, s.einheit_id) })),
      in_arbeit: inArbeit.map((s) => ({ titel: s.titel, einheit: unitName(units, s.einheit_id) })),
      naechste,
    };
  });

  const gesamt = computeProgress(steps);
  const text = renderReportText({ projekt: { ...projekt, name: maskName(projekt.name) }, zeitraum, range, gesamt, haeuserData, fertigImZeitraum: fertigImZeitraum.length, demo });
  return {
    projekt: { id: projekt.id, name: maskName(projekt.name), projektnummer: projekt.projektnummer, standort: demo ? maskCustomer(projekt.standort) : projekt.standort },
    zeitraum, range, gesamt, haeuser: haeuserData,
    fertig_im_zeitraum: fertigImZeitraum.map((s) => s.titel),
    text, generiert_am: new Date().toISOString(), demo: !!demo,
  };
}

function naechsteSchritte(units, stepsByEinheit) {
  const out = [];
  for (const e of units) {
    const st = (stepsByEinheit[e.id] || []);
    const byGewerk = groupBy(st, 'gewerk');
    for (const g of Object.keys(byGewerk)) {
      const spur = byGewerk[g].sort((a, b) => a.reihenfolge_nr - b.reihenfolge_nr);
      const next = spur.find((s) => s.status === 'offen' || s.status === 'in_arbeit');
      if (next) out.push({ einheit: e.name, gewerk: TEMPLATES[g]?.label || g, titel: next.titel, status: next.status });
    }
  }
  return out.slice(0, 12);
}

// Deutscher Fließtext für PDF + Vorlese-Funktion (🔊). Kurz, klar, Baustellen-tauglich.
function renderReportText({ projekt, zeitraum, range, gesamt, haeuserData, fertigImZeitraum, demo }) {
  const L = [];
  L.push(`Statusbericht ${projekt.name}${projekt.projektnummer ? ` (${projekt.projektnummer})` : ''}.`);
  L.push(`Zeitraum: ${range.label}.`);
  L.push(`Gesamtfortschritt: ${gesamt.prozent} Prozent – ${gesamt.done} von ${gesamt.total} Schritten abgeschlossen.`);
  if (zeitraum !== 'gesamt') L.push(`In diesem Zeitraum abgeschlossen: ${fertigImZeitraum} Schritte.`);
  const blockGesamt = haeuserData.reduce((a, h) => a + h.blockiert_count, 0);
  if (blockGesamt) L.push(`Achtung: ${blockGesamt} Schritt${blockGesamt === 1 ? '' : 'e'} blockiert.`);
  L.push('');
  for (const h of haeuserData) {
    L.push(`${h.name}: ${h.progress.prozent} Prozent fertig. ${h.done_count} abgeschlossen, ${h.in_arbeit_count} in Arbeit, ${h.offen_count} offen, ${h.blockiert_count} blockiert.`);
    if (h.blockiert.length) {
      for (const b of h.blockiert) L.push(`  Blockiert – ${b.einheit}: ${b.titel}${b.grund ? ` (${b.grund})` : ''}.`);
    }
    if (h.naechste.length) {
      const n = h.naechste.slice(0, 3).map((x) => `${x.einheit}: ${x.titel}`).join('; ');
      L.push(`  Nächste Schritte – ${n}.`);
    }
  }
  return L.join('\n').trim();
}

// ── Helpers ──
function unitName(units, einheitId) { return (units.find((e) => e.id === einheitId) || {}).name || ''; }
function maskCustomer(n) {
  if (!n) return n;
  return String(n).split(/\s+/).map((w) => (w.length <= 1 ? w : w[0] + '•'.repeat(Math.min(w.length - 1, 4)))).join(' ');
}
function groupBy(arr, key) { const m = {}; for (const x of arr || []) { (m[x[key]] = m[x[key]] || []).push(x); } return m; }
function fmtDate(d) { return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`; }
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}
function isoWeekRange(year, week) {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const day = simple.getUTCDay() || 7;
  const monday = new Date(simple); monday.setUTCDate(simple.getUTCDate() - day + 1);
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6); sunday.setUTCHours(23, 59, 59, 999);
  return { von: monday, bis: sunday };
}
async function projektIdForHaus(hausId) {
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_haus?id=eq.${hausId}&select=projekt_id`, { headers: SB }));
  return (Array.isArray(rows) ? rows : [])[0]?.projekt_id || null;
}
async function projektIdForEinheit(einheitId) {
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_gw_einheit?id=eq.${einheitId}&select=haus_id`, { headers: SB }));
  const hausId = (Array.isArray(rows) ? rows : [])[0]?.haus_id;
  return hausId ? projektIdForHaus(hausId) : null;
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

// Für Unit-Tests (Node): reine Funktionen exportieren.
export { TEMPLATES, buildStepsForTemplate, validateStatusChange, computeProgress, buildStatusReport, resolveRange, isoWeek, isoWeekRange, maskCustomer };
