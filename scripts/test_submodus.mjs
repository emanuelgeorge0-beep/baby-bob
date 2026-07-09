// scripts/test_submodus.mjs
// INTEGRATIONSTEST Sub-/Akkordmodus + Partner-Branding – lauffähig OHNE DB/Netz.
//
// Fährt den ECHTEN api/cockpit.js-Handler durch einen In-Memory-Mock von
// Supabase (Auth /auth/v1/user, PostgREST /rest/v1/*, Storage /storage/v1/*).
// Beweist: Entitlement-Gating je Feature, Firmenprofil-Upsert + Logo, Sub-
// Lifecycle (Entwurf → Anfrage → Schreibschutz), Datei-Upload, Datentrennung.
//
// Lauf:  node scripts/test_submodus.mjs

process.env.SUPABASE_URL = 'http://mock';
process.env.SUPABASE_KEY = 'mock-service-key';
const BASE = process.env.SUPABASE_URL;
const MASTER_UID = 'ee46a716-7017-4045-9f67-fe06d05171e7';

// ── deterministischer UUID-Generator (passt zu UUID_RE in cockpit.js) ──
let _uc = 0;
function mkid() {
  const h = (n, len) => n.toString(16).padStart(len, '0').slice(-len);
  _uc++;
  return `${h(_uc, 8)}-0000-4000-8000-${h(_uc, 12)}`;
}

// ── In-Memory-Zustand (pro Testlauf frisch via resetState) ──
let ROLES, ENTS, PROFIL, PROJEKTE, STORAGE, BAUAB, STEPS, ESCROW, ANGEBOTE, AUFTRAG, KSET, KPOS;
function resetState() {
  ROLES = new Map();      // userId → role
  ENTS = new Map();       // `${pid} ${key}` → enabled
  PROFIL = new Map();     // partner_user_id → row
  PROJEKTE = [];          // gs_projekte rows
  STORAGE = new Map();    // path → { buf, contentType, created_at }
  BAUAB = [];             // gs_bauabschnitte
  STEPS = [];             // gs_steps
  ESCROW = [];            // gs_escrow
  ANGEBOTE = [];          // gs_angebote
  AUFTRAG = [];           // gs_auftragsbestaetigung
  KSET = null;            // gs_kalk_settings (Singleton)
  KPOS = [];              // gs_kalk_positionen
  _uc = 0;
}
function setPartner(id, feats) {
  ROLES.set(id, 'gs_partner');
  for (const f of feats) ENTS.set(id + ' ' + f, true);
}

// ── PostgREST-Query zerlegen: eq-Filter + select ──
function parseQ(qs) {
  const filt = {}; const neq = {}; let select = '*';
  for (const part of (qs || '').split('&')) {
    if (!part) continue;
    const [k, v] = part.split('=');
    if (k === 'select') { select = decodeURIComponent(v); continue; }
    if (k === 'order' || k === 'limit') continue;
    if (v && v.startsWith('eq.')) filt[k] = decodeURIComponent(v.slice(3));
    else if (v && v.startsWith('neq.')) neq[k] = decodeURIComponent(v.slice(4));
  }
  return { filt, neq, select };
}
function match(row, filt, neq) {
  for (const k of Object.keys(filt)) if (String(row[k] ?? '') !== String(filt[k])) return false;
  for (const k of Object.keys(neq || {})) if (String(row[k] ?? '') === String(neq[k])) return false;
  return true;
}
const ok = (json) => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) });
const fail = (status, msg) => ({ ok: false, status, json: async () => ({ message: msg }), text: async () => msg });

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const method = (opts.method || 'GET').toUpperCase();
  const p = u.pathname;

  // ── Auth: Token „tok:<uid>" → { id } ──
  if (p === '/auth/v1/user') {
    const auth = (opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || '';
    const tok = auth.replace(/^Bearer\s+/, '');
    if (!tok.startsWith('tok:')) return fail(401, 'bad token');
    return ok({ id: tok.slice(4), email: tok.slice(4) + '@x' });
  }

  // ── Storage ──
  if (p.startsWith('/storage/v1/object/sign/')) {
    const rest = p.slice('/storage/v1/object/sign/'.length); // bucket/path...
    return ok({ signedURL: '/object/sign/' + rest + '?token=sig' });
  }
  if (p.startsWith('/storage/v1/object/list/')) {
    const body = JSON.parse(opts.body || '{}');
    const prefix = body.prefix || '';
    const out = [];
    for (const [key, meta] of STORAGE) {
      if (!key.startsWith(prefix)) continue;
      const rem = key.slice(prefix.length);
      if (rem.includes('/')) continue; // Unterordner → überspringen (id null)
      out.push({ name: rem, id: 'id-' + rem, created_at: meta.created_at, metadata: { size: meta.buf.length, mimetype: meta.contentType } });
    }
    return ok(out);
  }
  if (p.startsWith('/storage/v1/object/')) {
    const rest = p.slice('/storage/v1/object/'.length); // bucket/path
    const slash = rest.indexOf('/');
    const path = rest.slice(slash + 1);
    if (method === 'DELETE') { STORAGE.delete(path); return ok({}); }
    if (method === 'POST') {
      STORAGE.set(path, { buf: opts.body || Buffer.from(''), contentType: (opts.headers && opts.headers['Content-Type']) || '', created_at: '2026-07-09T00:00:0' + (STORAGE.size % 10) + 'Z' });
      return ok({ Key: path });
    }
    return fail(404, 'no');
  }

  // ── PostgREST ──
  if (p.startsWith('/rest/v1/')) {
    const table = p.slice('/rest/v1/'.length);
    const qs = u.search.slice(1);
    const { filt, neq } = parseQ(qs);
    const body = opts.body ? JSON.parse(opts.body) : null;

    if (table === 'user_roles') {
      const uid = filt.user_id;
      const role = ROLES.get(uid) || (uid === MASTER_UID ? 'master' : null);
      return ok(role ? [{ role }] : []);
    }
    if (table === 'gs_partner_entitlements') {
      const pid = filt.partner_user_id;
      const rows = [];
      for (const [k, en] of ENTS) { const [rpid, rkey] = k.split(' '); if (rpid === pid) rows.push({ feature_key: rkey, enabled: en }); }
      return ok(rows);
    }
    if (table.startsWith('gs_partner_profil')) {
      if (method === 'GET') { const pid = filt.partner_user_id; const r = PROFIL.get(pid); return ok(r ? [r] : []); }
      if (method === 'POST') { // Upsert on_conflict=partner_user_id, merge-duplicates
        const pid = body.partner_user_id; const cur = PROFIL.get(pid) || { partner_user_id: pid };
        const merged = { ...cur, ...body }; PROFIL.set(pid, merged); return ok([merged]);
      }
    }
    if (table.startsWith('gs_projekte')) {
      if (method === 'GET') { return ok(PROJEKTE.filter((r) => match(r, filt))); }
      if (method === 'POST') { const row = { id: mkid(), created_at: '2026-07-09T00:00:00Z', ...body }; PROJEKTE.push(row); return ok([row]); }
      if (method === 'PATCH') { const hits = PROJEKTE.filter((r) => match(r, filt)); hits.forEach((r) => Object.assign(r, body)); return ok(hits); }
    }
    if (table.startsWith('gs_bauabschnitte')) {
      if (method === 'GET') return ok(BAUAB.filter((r) => match(r, filt)));
      if (method === 'POST') { const row = { id: mkid(), status: 'geplant', ...body }; BAUAB.push(row); return ok([row]); }
      if (method === 'PATCH') { const hits = BAUAB.filter((r) => match(r, filt)); hits.forEach((r) => Object.assign(r, body)); return ok(hits); }
    }
    if (table.startsWith('gs_steps')) {
      if (method === 'GET') return ok(STEPS.filter((r) => match(r, filt)));
      if (method === 'POST') { const rows = (Array.isArray(body) ? body : [body]).map((x) => ({ id: mkid(), ...x })); STEPS.push(...rows); return ok(rows); }
      if (method === 'PATCH') { const hits = STEPS.filter((r) => match(r, filt)); hits.forEach((r) => Object.assign(r, body)); return ok(hits); }
      if (method === 'DELETE') { const rest = STEPS.filter((r) => !match(r, filt)); STEPS.length = 0; STEPS.push(...rest); return ok([]); }
    }
    if (table.startsWith('gs_escrow')) {
      if (method === 'GET') return ok([]); // in.()-Filter → im Test irrelevant (kein Escrow-Geld)
      if (method === 'POST') { return ok([]); }
    }
    if (table.startsWith('gs_kalk_settings')) {
      if (method === 'GET') return ok(KSET ? [KSET] : []);
      if (method === 'POST') { KSET = { id: mkid(), ...body }; return ok([KSET]); }
      if (method === 'PATCH') { if (!KSET) KSET = { id: mkid() }; Object.assign(KSET, body); return ok([KSET]); }
    }
    if (table.startsWith('gs_kalk_positionen')) {
      if (method === 'GET') { const ids = (qs.match(/bauabschnitt_id=in\.\(([^)]*)\)/) || [])[1]; const set = ids ? ids.split(',') : null; return ok(KPOS.filter((r) => !set || set.includes(r.bauabschnitt_id))); }
      if (method === 'POST') { const ex = KPOS.find((r) => r.bauabschnitt_id === body.bauabschnitt_id); if (ex) Object.assign(ex, body); else KPOS.push({ ...body }); return ok([]); }
    }
    if (table.startsWith('gs_angebote')) {
      if (method === 'GET') {
        let rows = ANGEBOTE.filter((r) => match(r, filt, neq));
        rows = rows.sort((a, b) => (b.version || 0) - (a.version || 0));
        if (/limit=1/.test(qs)) rows = rows.slice(0, 1);
        return ok(rows);
      }
      if (method === 'POST') { const row = { id: mkid(), created_at: '2026-07-09T00:00:00Z', ...body }; ANGEBOTE.push(row); return ok([row]); }
      if (method === 'PATCH') { const hits = ANGEBOTE.filter((r) => match(r, filt)); hits.forEach((r) => Object.assign(r, body)); return ok(hits); }
    }
    if (table.startsWith('gs_auftragsbestaetigung')) {
      if (method === 'GET') { let rows = AUFTRAG.filter((r) => match(r, filt)); if (/limit=1/.test(qs)) rows = rows.slice(0, 1); return ok(rows); }
      if (method === 'POST') { const row = { id: mkid(), bestaetigt_am: '2026-07-09T12:00:00Z', ...body }; AUFTRAG.push(row); return ok([row]); }
    }
    // Unbekannte Tabellen (gs_kunden, gs_blockaden, …) → leer / echo
    if (method === 'GET') return ok([]);
    if (method === 'POST') return ok([body]);
    if (method === 'PATCH') return ok([]);
  }
  return fail(404, 'unmocked ' + p);
};

const { default: handler } = await import('../api/cockpit.js');

// ── Testtreiber ──
function makeRes() {
  const res = { _s: 0, _j: null,
    setHeader() {}, status(c) { this._s = c; return this; }, json(o) { this._j = o; return this; }, end() { return this; } };
  return res;
}
async function call(token, body) {
  const res = makeRes();
  await handler({ method: 'POST', body: { token, ...body } }, res);
  return { status: res._s, d: res._j };
}

let PASS = 0, FAIL = 0; const FAILS = [];
function assert(cond, name) { if (cond) PASS++; else { FAIL++; FAILS.push(name); } }
// Rekursiver Key-Scan: prüft, ob irgendwo im Payload (Objekte/Arrays) ein Key vorkommt.
function deepHasKey(o, key) {
  if (Array.isArray(o)) return o.some((x) => deepHasKey(x, key));
  if (o && typeof o === 'object') return Object.keys(o).some((k) => k === key || deepHasKey(o[k], key));
  return false;
}

async function suite(iter) {
  resetState();
  // Partner-Accounts mit unterschiedlichen Freischaltungen
  const P_NONE = mkid(), P_BRAND = mkid(), P_SUB = mkid(), P_PM = mkid(), P_ALL = mkid(), P_SUB2 = mkid();
  setPartner(P_NONE, []);
  setPartner(P_BRAND, ['partner_branding']);
  setPartner(P_SUB, ['sub_akkord']);
  setPartner(P_PM, ['projektmanagement']);
  setPartner(P_ALL, ['partner_branding', 'sub_akkord', 'projektmanagement']);
  setPartner(P_SUB2, ['sub_akkord']);
  const tok = (id) => 'tok:' + id;

  // ── 1) Gating ──
  assert((await call(tok(P_NONE), { action: 'pm_profil_get' })).status === 403, 'P_NONE pm_profil_get→403');
  assert((await call(tok(P_BRAND), { action: 'pm_profil_get' })).status === 200, 'P_BRAND pm_profil_get→200');
  assert((await call(tok(P_BRAND), { action: 'sub_projekte' })).status === 403, 'P_BRAND sub_projekte→403');
  assert((await call(tok(P_SUB), { action: 'sub_projekte' })).status === 200, 'P_SUB sub_projekte→200');
  assert((await call(tok(P_SUB), { action: 'pm_profil_get' })).status === 403, 'P_SUB pm_profil_get→403');
  assert((await call(tok(P_PM), { action: 'pm_projekte' })).status === 200, 'P_PM pm_projekte→200');
  assert((await call(tok(P_PM), { action: 'sub_projekt_save', name: 'X' })).status === 403, 'P_PM sub_save→403');
  assert((await call('tok:someone', { action: 'sub_projekte' })).status === 403, 'unknown role→403');

  // ── 2) Branding: Profil-Upsert + Logo, merge lässt firma stehen ──
  let r = await call(tok(P_BRAND), { action: 'pm_profil_save', firma: 'Muster AG', ort: 'Zürich', telefon: '044 000 00 00' });
  assert(r.d && r.d.ok && r.d.profil.firma === 'Muster AG' && r.d.profil.ort === 'Zürich', 'profil_save firma+ort');
  r = await call(tok(P_BRAND), { action: 'pm_profil_get' });
  assert(r.d && r.d.profil && r.d.profil.firma === 'Muster AG', 'profil_get persistiert');
  const b64 = 'data:image/png;base64,' + Buffer.from('PNGDATA').toString('base64');
  r = await call(tok(P_BRAND), { action: 'pm_logo_upload', filename: 'logo.png', contentType: 'image/png', data: b64 });
  assert(r.d && r.d.ok && /^_branding\//.test(r.d.profil.logo_url) && r.d.logo_url_signed, 'logo_upload → pfad + signed');
  r = await call(tok(P_BRAND), { action: 'pm_profil_get' });
  assert(r.d && r.d.profil.firma === 'Muster AG' && r.d.logo_url_signed, 'logo-upsert löscht firma NICHT + signed url');

  // ── 3) Sub-Lifecycle (P_ALL) ──
  // Runde 5: vollständiges Firmenprofil (Firma/Adresse/PLZ/Ort) ist Pflicht vor
  // dem ersten Projekt. P_ALL bekommt es hier.
  await call(tok(P_ALL), { action: 'pm_profil_save', firma: 'Sub GmbH', adresse: 'Werkstr 5', plz: '8005', ort: 'Zürich' });
  r = await call(tok(P_ALL), { action: 'sub_projekt_save', name: 'Neubau Seefeld', strasse: 'Bahnhofstr 1', plz: '8001', ort: 'Zürich', ansprechperson: 'Fr. Meier', beschreibung: 'Rohbau Sanitär', bereich: 'Sanitär, Heizung' });
  assert(r.d && r.d.ok, 'sub_save create ok');
  const sp = r.d.projekt;
  assert(sp.projekt_art === 'sub_akkord' && sp.sub_status === 'entwurf', 'sub create: art+status');
  assert(sp.standort === 'Bahnhofstr 1, 8001 Zürich', 'sub standort kombiniert');
  assert(sp.datenblatt && sp.datenblatt.sub && sp.datenblatt.sub.beschreibung === 'Rohbau Sanitär', 'sub datenblatt.sub gefüllt');

  // Kapazitäts-Projekt direkt einschleusen → darf NICHT in sub_projekte auftauchen
  PROJEKTE.push({ id: mkid(), partner_user_id: P_ALL, name: 'Kap-Projekt', projekt_art: 'kapazitaet', status: 'aktiv', created_at: '2026-07-01T00:00:00Z' });
  r = await call(tok(P_ALL), { action: 'sub_projekte' });
  assert(r.d && r.d.projekte.length === 1 && r.d.projekte[0].id === sp.id, 'sub_projekte nur sub_akkord (kein Kap)');

  // Editieren solange Entwurf (datenblatt.sub bleibt erhalten)
  r = await call(tok(P_ALL), { action: 'sub_projekt_save', id: sp.id, name: 'Neubau Seefeld 2', beschreibung: 'Rohbau Sanitär' });
  assert(r.d && r.d.ok && r.d.projekt.name === 'Neubau Seefeld 2', 'sub edit im Entwurf ok');

  // Datei-Upload (reuse) + Detail listet sie
  r = await call(tok(P_ALL), { action: 'sub_datei_upload', projekt_id: sp.id, kategorie: 'plaene', filename: 'plan.pdf', contentType: 'application/pdf', data: 'data:application/pdf;base64,' + Buffer.from('PDF').toString('base64') });
  assert(r.d && r.d.ok, 'sub_datei_upload ok');
  r = await call(tok(P_ALL), { action: 'sub_projekt', id: sp.id });
  assert(r.d && (r.d.dateien || []).some((f) => f.kategorie === 'plaene' && /plan\.pdf/.test(f.name)), 'sub detail listet plan.pdf');

  // Anfrage abschicken → angefragt + angefragt_am
  r = await call(tok(P_ALL), { action: 'sub_anfrage', id: sp.id });
  assert(r.d && r.d.ok && r.d.projekt.sub_status === 'angefragt' && r.d.projekt.angefragt_am, 'sub_anfrage setzt status+datum');

  // Danach schreibgeschützt
  r = await call(tok(P_ALL), { action: 'sub_projekt_save', id: sp.id, name: 'Hack' });
  assert(r.d && r.d.locked && !r.d.ok, 'nach Anfrage: save gesperrt');
  r = await call(tok(P_ALL), { action: 'sub_anfrage', id: sp.id });
  assert(r.d && r.d.locked, 'nach Anfrage: erneute Anfrage gesperrt');

  // ── 4) Datentrennung: fremder Partner (auch mit sub_akkord) → 403 ──
  assert((await call(tok(P_SUB2), { action: 'sub_projekt', id: sp.id })).status === 403, 'Fremdzugriff sub_projekt→403');
  assert((await call(tok(P_SUB2), { action: 'sub_projekt_save', id: sp.id, name: 'Klau' })).status === 403, 'Fremd-save→403');
  assert((await call(tok(P_SUB2), { action: 'sub_datei_upload', projekt_id: sp.id, filename: 'x', data: 'data:,' + Buffer.from('x').toString('base64') })).status === 403, 'Fremd-upload→403');

  // ── 5) Master unberührt ──
  ROLES.set(MASTER_UID, 'master');
  assert((await call(tok(MASTER_UID), { action: 'pm_projekte' })).status === 200, 'Master pm_projekte→200');
  const mp = await call(tok(MASTER_UID), { action: 'pm_profil_get' });
  assert(mp.status === 200 && mp.d.profil === null, 'Master pm_profil_get→leeres Profil');

  // ── 6) Master: Sub-Anfragen (Runde 2) ──
  // Partner-Firma fuer die Anzeige setzen.
  await call(tok(P_ALL), { action: 'pm_profil_save', firma: 'Sub GmbH' });
  // Gating: Partner darf msub_* NICHT.
  assert((await call(tok(P_ALL), { action: 'msub_liste' })).status === 403, 'Partner msub_liste→403');
  assert((await call(tok(P_ALL), { action: 'msub_angebot_save', projekt_id: sp.id })).status === 403, 'Partner msub_angebot_save→403');

  // Liste zeigt das Sub-Projekt mit Partner-Firma; sp ist aktuell 'angefragt'.
  r = await call(tok(MASTER_UID), { action: 'msub_liste' });
  const row = r.d && (r.d.anfragen || []).find((x) => x.id === sp.id);
  assert(row && row.partner_firma === 'Sub GmbH' && row.sub_status === 'angefragt', 'msub_liste zeigt sub mit firma+status');

  // Detail öffnen → Auto-Übergang angefragt → in_pruefung, Partner+Dateien dabei.
  r = await call(tok(MASTER_UID), { action: 'msub_detail', id: sp.id });
  assert(r.d && r.d.projekt.sub_status === 'in_pruefung', 'msub_detail: auto angefragt→in_pruefung');
  assert(r.d && r.d.sub_bundle && r.d.sub_bundle.partner.firma === 'Sub GmbH', 'msub_detail: partner-firma');
  assert(r.d && (r.d.dateien || []).some((f) => /plan\.pdf/.test(f.name)), 'msub_detail: dateien (volle PM-Ansicht)');
  assert(r.d && r.d.sub_bundle.sub.beschreibung === 'Rohbau Sanitär', 'msub_detail: sub-beschreibung');
  assert(PROJEKTE.find((p) => p.id === sp.id).sub_status === 'in_pruefung', 'in_pruefung in DB persistiert');

  // Kalkulation: einen Bauabschnitt „vorhanden" machen (wie nach zs_abschnitt_save).
  const baId = mkid(), stId = mkid();
  BAUAB.push({ id: baId, projekt_id: sp.id, name: 'Rohbau', reihenfolge: 1, einheit_typ: 'zone', einheit_anzahl: 3, team_tage: 5, gesamtbetrag: 30000, split_profil: 'stueck_15_70_15', status: 'geplant' });
  STEPS.push({ id: stId, bauabschnitt_id: baId, reihenfolge: 1, typ: 'zahlung', zahlung_art: 'anzahlung', bezeichnung: 'Anzahlung', betrag: 4500, status: 'wartend' });

  // Angebot erzeugen: gesamtbetrag = Summe der Bauabschnitte, vorschlag als Snapshot.
  r = await call(tok(MASTER_UID), { action: 'msub_angebot_save', projekt_id: sp.id, ansatz_chf_h: 62, bemerkung: 'Pilot' });
  assert(r.d && r.d.ok && r.d.rechnung.netto === 30000 && r.d.angebot.gesamtbetrag === 32430 && r.d.angebot.status === 'entwurf', 'msub_angebot_save: brutto+entwurf');
  assert(r.d && Array.isArray(r.d.angebot.bauabschnitt_vorschlag) && r.d.angebot.bauabschnitt_vorschlag.length === 1, 'angebot: vorschlag-snapshot');
  assert(r.d && r.d.angebot.ansatz_chf_h === 62 && r.d.angebot.bemerkung === 'Pilot', 'angebot: ansatz+bemerkung');

  // Erneut speichern → aktualisiert denselben Entwurf (kein zweiter Datensatz).
  r = await call(tok(MASTER_UID), { action: 'msub_angebot_save', projekt_id: sp.id, ansatz_chf_h: 65, bemerkung: 'Pilot v2' });
  assert(ANGEBOTE.filter((a) => a.projekt_id === sp.id).length === 1 && r.d.angebot.ansatz_chf_h === 65, 'angebot_save aktualisiert entwurf');

  // Abschicken → status abgeschickt + projekt sub_status angebot_offen.
  r = await call(tok(MASTER_UID), { action: 'msub_angebot_send', projekt_id: sp.id });
  assert(r.d && r.d.ok && r.d.angebot.status === 'abgeschickt' && r.d.angebot.abgeschickt_am, 'angebot_send: abgeschickt+datum');
  assert(PROJEKTE.find((p) => p.id === sp.id).sub_status === 'angebot_offen', 'projekt sub_status → angebot_offen');
  // Zweites Abschicken → abgelehnt (schon abgeschickt).
  r = await call(tok(MASTER_UID), { action: 'msub_angebot_send', projekt_id: sp.id });
  assert(r.d && r.d.error && !r.d.ok, 'angebot_send erneut → Fehler');

  // Angebot ohne Kalkulation → send verweigert (anderes Projekt ohne Bauabschnitte).
  const sp2 = (await call(tok(P_ALL), { action: 'sub_projekt_save', name: 'Leer', bereich: '' })).d.projekt;
  await call(tok(MASTER_UID), { action: 'msub_angebot_save', projekt_id: sp2.id });
  r = await call(tok(MASTER_UID), { action: 'msub_angebot_send', projekt_id: sp2.id });
  assert(r.d && r.d.error && /Betrag|Bauabschnitte/.test(r.d.error), 'send ohne kalkulation → Fehler');

  // ── 7) Partner entscheidet über das Angebot (Runde 3) ──
  // sp: sub_status='angebot_offen', Angebot 'abgeschickt' (aus Abschnitt 6).
  // Gating: fremder Partner → 403.
  assert((await call(tok(P_SUB2), { action: 'sub_entscheiden', projekt_id: sp.id, op: 'annehmen' })).status === 403, 'Fremd-Entscheidung→403');
  // Annahme ohne abgeschicktes Angebot (sp2 hat nur einen Entwurf) → Fehler.
  r = await call(tok(P_ALL), { action: 'sub_entscheiden', projekt_id: sp2.id, op: 'annehmen' });
  assert(r.d && r.d.error && /abgeschicktes Angebot/.test(r.d.error), 'annehmen ohne abgeschicktes Angebot → Fehler');
  // Partner-Detail zeigt KEINEN Master-Entwurf (sp2) als Angebot.
  r = await call(tok(P_ALL), { action: 'sub_projekt', id: sp2.id });
  assert(r.d && r.d.angebot === null, 'Partner sieht Master-Entwurf NICHT');

  // Besprechung anfragen → Angebot 'besprechung', Projekt bleibt angebot_offen.
  r = await call(tok(P_ALL), { action: 'sub_entscheiden', projekt_id: sp.id, op: 'besprechung' });
  assert(r.d && r.d.ok && r.d.angebot.status === 'besprechung', 'besprechung → status besprechung');
  assert(PROJEKTE.find((p) => p.id === sp.id).sub_status === 'angebot_offen', 'besprechung: projekt bleibt angebot_offen');

  // Annehmen → Angebot angenommen + Zeitstempel, Projekt angenommen, Auftragsbestätigung.
  r = await call(tok(P_ALL), { action: 'sub_entscheiden', projekt_id: sp.id, op: 'annehmen' });
  assert(r.d && r.d.ok && r.d.angebot.status === 'angenommen' && r.d.angebot.entschieden_am && r.d.angebot.entschieden_by, 'annehmen: status+audit');
  assert(PROJEKTE.find((p) => p.id === sp.id).sub_status === 'angenommen', 'projekt sub_status → angenommen');
  // Block 5 (Runde 6): Partner-Antwort auf annehmen zeigt AB INTERN gefiltert.
  assert(r.d && r.d.auftrag && r.d.auftrag.angenommen === true && r.d.auftrag.bestaetigt_am && !('nummer' in r.d.auftrag) && !('gesamtbetrag' in r.d.auftrag), 'annehmen: partner-auftrag ohne AB-Nummer/Betrag');
  // Die AB existiert (mit Nummer) in der DB — nur für den Master.
  assert(AUFTRAG.find((a) => a.projekt_id === sp.id && /^AB-\d{4}-\d{6}$/.test(a.nummer) && a.gesamtbetrag === 32430), 'AB in DB erzeugt (nr+brutto — intern)');

  // Doppelte Entscheidung → Fehler.
  r = await call(tok(P_ALL), { action: 'sub_entscheiden', projekt_id: sp.id, op: 'ablehnen' });
  assert(r.d && r.d.error && /bereits entschieden/.test(r.d.error), 'doppelte Entscheidung → Fehler');

  // Partner-Detail zeigt jetzt Angebot (angenommen) + „Auftrag angenommen" (ohne AB-Nummer).
  r = await call(tok(P_ALL), { action: 'sub_projekt', id: sp.id });
  assert(r.d && r.d.angebot && r.d.angebot.status === 'angenommen' && r.d.auftrag && r.d.auftrag.angenommen === true && r.d.auftrag.bestaetigt_am && !('nummer' in r.d.auftrag), 'Partner sieht angenommenes Angebot + Auftrag angenommen (ohne AB-Nummer)');

  // Master-Detail: volle PM-Ansicht (Arrays) + sub_bundle mit AB + Entscheidung.
  r = await call(tok(MASTER_UID), { action: 'msub_detail', id: sp.id });
  assert(r.d && r.d.projekt && Array.isArray(r.d.techniker) && Array.isArray(r.d.dateien), 'msub_detail: volle PM-Ansicht');
  assert(r.d && r.d.sub_bundle && r.d.sub_bundle.sub_status === 'angenommen' && r.d.sub_bundle.partner.firma === 'Sub GmbH', 'sub_bundle: status+partner');
  assert(r.d && r.d.sub_bundle.auftrag && r.d.sub_bundle.auftrag.nummer && r.d.sub_bundle.angebot.status === 'angenommen', 'sub_bundle: AB + angenommenes angebot');

  // ── 8) Kalkulationsgenerator + Angebot mit Positionen (Runde 4) ──
  // Gating: Partner darf Kalk-Actions NICHT.
  assert((await call(tok(P_ALL), { action: 'msub_kalk_settings_get' })).status === 403, 'Partner kalk_settings_get→403');
  assert((await call(tok(P_ALL), { action: 'msub_kalk_apply', projekt_id: sp.id })).status === 403, 'Partner kalk_apply→403');
  // Settings-Defaults.
  r = await call(tok(MASTER_UID), { action: 'msub_kalk_settings_get' });
  assert(r.d && Number(r.d.settings.vollkosten_chf_h) === 46 && Number(r.d.settings.ansatz_detailliert) === 90, 'kalk_settings defaults');

  // Frisches Sub-Projekt kalkulieren.
  const sp3 = (await call(tok(P_ALL), { action: 'sub_projekt_save', name: 'Kalk-Test' })).d.projekt;
  r = await call(tok(MASTER_UID), { action: 'msub_kalk_apply', projekt_id: sp3.id, name: 'Rohbau', split_profil: 'stueck_15_70_15', einheit_typ: 'zone', einheit_anzahl: 3, personen: 2, team_tage: 5, ansatz_modus: 'detailliert' });
  assert(r.d && r.d.ok && r.d.kalk.verrechnungsstunden === 80 && r.d.kalk.umsatz === 7200, 'kalk: vstunden+umsatz');
  assert(r.d && r.d.kalk.kosten === 4460 && r.d.kalk.rohgewinn === 2740, 'kalk: kosten+rohgewinn');
  assert(r.d && r.d.kalk.db_pro_stunde === 34.25 && r.d.kalk.eff_chf_h === 80.25 && r.d.kalk.ampel === 'gruen', 'kalk: db/h + eff + ampel grün');
  const baId3 = r.d.bauabschnitt_id;
  assert(BAUAB.find((a) => a.id === baId3).gesamtbetrag === 7200, 'kalk: umsatz → gesamtbetrag');
  assert(KPOS.find((k) => k.bauabschnitt_id === baId3).personen === 2, 'kalk: eingaben gespeichert');

  // Interne Kalk-Daten im Master-Detail (nur hier).
  r = await call(tok(MASTER_UID), { action: 'msub_detail', id: sp3.id });
  const kp = r.d && r.d.sub_bundle.kalk.positionen[0];
  assert(kp && kp.umsatz === 7200 && kp.kosten === 4460 && kp.ampel === 'gruen' && kp.gespeichert === true, 'sub_bundle.kalk breakdown');

  // Ansatz „schnell" → geringerer Umsatz, Engine-gesamtbetrag folgt.
  r = await call(tok(MASTER_UID), { action: 'msub_kalk_apply', bauabschnitt_id: baId3, personen: 2, team_tage: 5, ansatz_modus: 'schnell' });
  assert(r.d && r.d.kalk.umsatz === 6800 && r.d.kalk.ansatz === 85, 'kalk schnell: umsatz 6800');
  assert(BAUAB.find((a) => a.id === baId3).gesamtbetrag === 6800, 'kalk schnell → gesamtbetrag 6800');

  // Angebot: Positionen aus Bauabschnitten vorbefüllt, Brutto = netto × 1.081.
  r = await call(tok(MASTER_UID), { action: 'msub_angebot_save', projekt_id: sp3.id });
  assert(r.d && r.d.ok && r.d.angebot.positionen.length === 1 && r.d.angebot.positionen[0].einzelpreis === 6800, 'angebot: positionen vorbefüllt');
  assert(r.d && r.d.angebot.gesamtbetrag === 7350.8 && r.d.rechnung.netto === 6800 && r.d.angebot.mwst_prozent === 8.1, 'angebot: brutto+mwst');

  // Freie Position + Rabatt + Konditionen.
  r = await call(tok(MASTER_UID), { action: 'msub_angebot_save', projekt_id: sp3.id, positionen: [{ bezeichnung: 'Material', menge: 2, einheit: 'Stk', einzelpreis: 100 }], rabatt_prozent: 10, mwst_prozent: 8.1, zahlungsziel_tage: 30, gueltig_bis: '2026-08-31' });
  assert(r.d && r.d.rechnung.netto === 200 && r.d.rechnung.brutto === 194.58, 'angebot: rabatt+mwst rechnung');
  assert(r.d && r.d.angebot.rabatt_prozent === 10 && r.d.angebot.zahlungsziel_tage === 30 && r.d.angebot.gueltig_bis === '2026-08-31', 'angebot: konditionen gespeichert');

  // KRITISCH — INTERN/EXTERN: Partner sieht Angebot, aber NIE Kosten/Rohgewinn/Ampel/Kalk.
  await call(tok(MASTER_UID), { action: 'msub_angebot_send', projekt_id: sp3.id });
  r = await call(tok(P_ALL), { action: 'sub_projekt', id: sp3.id });
  const pa = r.d && r.d.angebot;
  assert(pa && Array.isArray(pa.positionen), 'partner: sieht positionen');
  assert(pa && !('kosten' in pa) && !('rohgewinn' in pa) && !('ampel' in pa) && !('personen' in pa), 'partner: KEINE kosten/rohgewinn/ampel im angebot');
  assert(r.d && r.d.sub_bundle === undefined && r.d.kalk === undefined, 'partner: KEIN sub_bundle/kalk');

  // Settings speichern (ganz am Ende, damit obige Kalk-Werte stabil bleiben).
  r = await call(tok(MASTER_UID), { action: 'msub_kalk_settings_save', vollkosten_chf_h: 48, ansatz_detailliert: 95 });
  assert(r.d && r.d.ok && Number(r.d.settings.vollkosten_chf_h) === 48 && Number(r.d.settings.ansatz_detailliert) === 95, 'kalk_settings speichern');

  // ══ 9) RUNDE 5 – Blocker-Fixes ══════════════════════════════════════════
  // (4) Ansatz „Schmerzgrenze" (75) — eff-Basis unabhängig von Vollkosten.
  //     Gegenprobe: 80 h × 75 = 6000, eff 65.25 → gelb.
  r = await call(tok(MASTER_UID), { action: 'msub_kalk_apply', bauabschnitt_id: baId3, personen: 2, team_tage: 5, ansatz_modus: 'schmerzgrenze' });
  assert(r.d && r.d.kalk.ansatz === 75 && r.d.kalk.umsatz === 6000, '(4) schmerzgrenze: ansatz 75 / umsatz 6000');
  assert(r.d && r.d.kalk.eff_chf_h === 65.25 && r.d.kalk.ampel === 'gelb', '(4) schmerzgrenze: eff 65.25 → gelb');
  assert(BAUAB.find((a) => a.id === baId3).gesamtbetrag === 6000, '(4) schmerzgrenze → gesamtbetrag 6000');

  // (1) Stale-Erkennung: Bauabschnitt (6000) ≠ Angebots-Netto (200 aus §8) → veraltet.
  r = await call(tok(MASTER_UID), { action: 'msub_detail', id: sp3.id });
  assert(r.d && r.d.sub_bundle.angebot_stale === true && r.d.sub_bundle.bauabschnitt_summe === 6000, '(1) stale: angebot veraltet erkannt');

  // (Abschluss) Angebotsbetrag == Summe der Bauabschnitte (vor Rabatt/Zuschlag).
  //  Positionen automatisch aus Bauabschnitten → netto == 6000. Neue Version (vorher abgeschickt).
  r = await call(tok(MASTER_UID), { action: 'msub_angebot_save', projekt_id: sp3.id });
  assert(r.d && r.d.ok && r.d.rechnung.netto === 6000, '(abschluss) angebotsbetrag == summe bauabschnitte');
  assert(ANGEBOTE.filter((a) => a.projekt_id === sp3.id).length === 2, '(1) abgeschicktes angebot → NEUE version (nie still geändert)');
  r = await call(tok(MASTER_UID), { action: 'msub_detail', id: sp3.id });
  assert(r.d && r.d.sub_bundle.angebot_stale === false, '(1) nach neu-übernehmen: nicht mehr veraltet');

  // (2) Live-Step-Vorschau via Engine (nicht hartcodiert): 3 Einheiten (stück) → 5 Zahlungsschritte, 3 Fortschritt.
  r = await call(tok(MASTER_UID), { action: 'msub_kalk_preview', personen: 2, team_tage: 6, ansatz_modus: 'detailliert', split_profil: 'stueck_15_70_15', einheit_typ: 'zone', einheit_anzahl: 3 });
  assert(r.d && r.d.steps && r.d.steps.zahlung === 5 && r.d.steps.fortschritt === 3, '(2) kalk_preview: 5 zahlungsschritte, 3 fortschritt');
  assert(r.d && r.d.kalk && r.d.kalk.verrechnungsstunden === 96, '(2) kalk_preview: 6 T × 2 P × 8 h = 96 h');
  // Pauschal → Anzahl 1 erzwungen. Ab Runde 6 kommt die Wochen-Regel dazu:
  // 6 Team-Tage → 2 Wochen → 2 Fortschritte (Anzahlung + 2 + Abnahme = 4 Zahlungsschritte).
  r = await call(tok(MASTER_UID), { action: 'msub_kalk_preview', personen: 2, team_tage: 6, ansatz_modus: 'detailliert', split_profil: 'stueck_15_70_15', einheit_typ: 'pauschal', einheit_anzahl: 9 });
  assert(r.d && r.d.steps.einheit_anzahl === 1 && r.d.steps.zahlung === 4 && r.d.steps.fortschritt === 2, '(2) pauschal: anzahl→1, Wochen-Regel 6T→2 Fortschritte');
  assert((await call(tok(P_ALL), { action: 'msub_kalk_preview', personen: 2, team_tage: 1 })).status === 403, '(2) partner kalk_preview → 403');

  // (1) Quick-Send: Angebot aus Bauabschnitten + direkt abschicken (ohne Editor).
  const spQ = (await call(tok(P_ALL), { action: 'sub_projekt_save', name: 'Quick' })).d.projekt;
  await call(tok(MASTER_UID), { action: 'msub_kalk_apply', projekt_id: spQ.id, name: 'A', split_profil: 'stueck_15_70_15', einheit_typ: 'pauschal', einheit_anzahl: 1, personen: 2, team_tage: 5, ansatz_modus: 'detailliert' });
  r = await call(tok(MASTER_UID), { action: 'msub_angebot_quick_send', projekt_id: spQ.id });
  assert(r.d && r.d.ok && r.d.angebot.status === 'abgeschickt' && r.d.sub_status === 'angebot_offen', '(1) quick_send: abgeschickt + angebot_offen');
  assert(PROJEKTE.find((p) => p.id === spQ.id).sub_status === 'angebot_offen', '(1) quick_send: projekt-status persistiert');
  r = await call(tok(P_ALL), { action: 'sub_projekt', id: spQ.id });
  assert(r.d && r.d.angebot && Array.isArray(r.d.angebot.positionen) && r.d.angebot.positionen.length === 1, '(1) quick_send: positionen auto aus bauabschnitten');

  // (Abschluss/EISERN) Partner-Angebot-Payload enthält KEINE INTERN-Felder.
  const pq = r.d.angebot;
  assert(pq && !('ansatz_chf_h' in pq) && !('vollkosten_chf_h' in pq) && !('kosten' in pq) && !('rohgewinn' in pq) && !('ampel' in pq), '(eisern) partner-angebot ohne kosten/rohgewinn/ampel/ansatz_chf_h/vollkosten_chf_h');

  // (5) Profil-Pflicht: Partner OHNE vollständiges Profil kann kein Projekt anlegen.
  r = await call(tok(P_SUB), { action: 'sub_projekt_save', name: 'Ohne Profil' });
  assert(r.d && r.d.profileIncomplete && !r.d.ok, '(5) profil unvollständig → kein neues projekt');
  // Vollständiges Profil → geht.
  await call(tok(P_SUB), { action: 'pm_profil_save', firma: 'S AG', adresse: 'Weg 1', plz: '8000', ort: 'Bern' });
  // pm_profil_save braucht partner_branding — P_SUB hat es nicht → 403. Direkt in Map setzen.
  PROFIL.set(P_SUB, { partner_user_id: P_SUB, firma: 'S AG', adresse: 'Weg 1', plz: '8000', ort: 'Bern' });
  r = await call(tok(P_SUB), { action: 'sub_projekt_save', name: 'Mit Profil' });
  assert(r.d && r.d.ok && r.d.projekt, '(5) mit vollständigem profil → projekt angelegt');

  // (6) Leistungsarten als Array in datenblatt.sub.
  r = await call(tok(P_ALL), { action: 'sub_projekt_save', name: 'Leistung', leistungsarten: ['Badsanierung', 'Wärmepumpe', 'Badsanierung', 'Sonderwunsch XY'] });
  const la = r.d && r.d.projekt.datenblatt.sub.leistungsarten;
  assert(Array.isArray(la) && la.length === 3 && la[0] === 'Badsanierung' && la.indexOf('Sonderwunsch XY') > -1, '(6) leistungsarten array (dedupe)');

  // (7) Sichtbare Projekt-ID S-YYYY-NNN (Master-Liste, Partner-Liste, Detail).
  r = await call(tok(MASTER_UID), { action: 'msub_liste' });
  assert(r.d && (r.d.anfragen || []).every((a) => /^S-\d{4}-\d{3}$/.test(a.anzeige_id)), '(7) master-liste: anzeige_id S-YYYY-NNN');
  r = await call(tok(P_ALL), { action: 'sub_projekte' });
  assert(r.d && (r.d.projekte || []).every((p) => /^S-\d{4}-\d{3}$/.test(p.anzeige_id)), '(7) partner-liste: anzeige_id S-YYYY-NNN');
  r = await call(tok(P_ALL), { action: 'sub_projekt', id: sp.id });
  assert(r.d && /^S-\d{4}-\d{3}$/.test(r.d.projekt.anzeige_id), '(7) partner-detail: anzeige_id');
  r = await call(tok(MASTER_UID), { action: 'msub_detail', id: sp.id });
  assert(r.d && /^S-\d{4}-\d{3}$/.test(r.d.sub_bundle.anzeige_id), '(7) master-detail: anzeige_id');

  // ══ 10) RUNDE 6 – Zahlungsplan-Kette ════════════════════════════════════
  // Settings zurück auf Default-Ansatz 90 (in §8 auf 95 gesetzt) für die Gegenproben.
  await call(tok(MASTER_UID), { action: 'msub_kalk_settings_save', ansatz_detailliert: 90, vollkosten_chf_h: 46 });

  // ── BLOCK 1: pro Projekt genau EIN aktives Angebot (kein Doppel-Angebot) ──
  const spB1 = (await call(tok(P_ALL), { action: 'sub_projekt_save', name: 'R6-Block1' })).d.projekt;
  await call(tok(MASTER_UID), { action: 'msub_kalk_apply', projekt_id: spB1.id, name: 'A', split_profil: 'stueck_15_70_15', einheit_typ: 'pauschal', einheit_anzahl: 1, personen: 2, team_tage: 5, ansatz_modus: 'detailliert' });
  // Erster Klick: Schnellweg schickt ab.
  r = await call(tok(MASTER_UID), { action: 'msub_angebot_quick_send', projekt_id: spB1.id });
  assert(r.d && r.d.ok && r.d.angebot.status === 'abgeschickt', '(B1) 1. quick_send → abgeschickt');
  // Zweiter Klick: verweigert, weil bereits ein aktives Angebot existiert.
  r = await call(tok(MASTER_UID), { action: 'msub_angebot_quick_send', projekt_id: spB1.id });
  assert(r.d && r.d.error && r.d.hasActive && !r.d.ok, '(B1) 2. quick_send → verweigert (hasActive)');
  assert(ANGEBOTE.filter((a) => a.projekt_id === spB1.id).length === 1, '(B1) zwei Klicks → nie zwei Angebote');
  // Auch bei bestehendem Entwurf ist quick_send gesperrt.
  const spB1b = (await call(tok(P_ALL), { action: 'sub_projekt_save', name: 'R6-Block1b' })).d.projekt;
  await call(tok(MASTER_UID), { action: 'msub_kalk_apply', projekt_id: spB1b.id, name: 'A', split_profil: 'stueck_15_70_15', einheit_typ: 'pauschal', einheit_anzahl: 1, personen: 2, team_tage: 5, ansatz_modus: 'detailliert' });
  await call(tok(MASTER_UID), { action: 'msub_angebot_save', projekt_id: spB1b.id }); // Entwurf
  r = await call(tok(MASTER_UID), { action: 'msub_angebot_quick_send', projekt_id: spB1b.id });
  assert(r.d && r.d.error && r.d.hasActive, '(B1) quick_send bei bestehendem Entwurf → verweigert');
  assert(ANGEBOTE.filter((a) => a.projekt_id === spB1b.id).length === 1 && ANGEBOTE.find((a) => a.projekt_id === spB1b.id).status === 'entwurf', '(B1) Entwurf bleibt unverändert (kein 2. Angebot)');

  // ── BLOCK 2: interne Bezeichner NICHT in der Partner-Ansicht ──
  // spQ (aus §9) hat ein abgeschicktes Angebot mit bauabschnitt_vorschlag.
  r = await call(tok(P_ALL), { action: 'sub_projekt', id: spQ.id });
  const pAng = r.d && r.d.angebot;
  assert(pAng && Array.isArray(pAng.bauabschnitt_vorschlag) && pAng.bauabschnitt_vorschlag.length >= 1, '(B2) partner: vorschlag vorhanden');
  const vf = pAng.bauabschnitt_vorschlag[0];
  assert(vf && !('split_profil' in vf) && !('einheit_typ' in vf) && !('einheit_anzahl' in vf) && !('team_tage' in vf), '(B2) vorschlag OHNE split_profil/einheit_typ/einheit_anzahl/team_tage');
  assert(vf && Array.isArray(vf.steps) && vf.steps.length && vf.steps.every((s) => 'bezeichnung' in s && 'betrag' in s), '(B2) vorschlag: nur Schrittbezeichnung + Betrag');
  // (c) NEU/EISERN: Partner-Payload nirgends split_profil / einheit_typ.
  assert(!deepHasKey(r.d, 'split_profil') && !deepHasKey(r.d, 'einheit_typ'), '(c) partner-payload OHNE split_profil/einheit_typ');

  // ── BLOCK 3: Zwischensteps aus Team-Tagen (Wochen-Regel) ──
  // Gegenprobe: 7 T × 2 P, Ansatz 90, Profil stueck_15_70_15, 1 Einheit
  //   → Umsatz 10'080, Anzahlung 1'512, zwei Fortschritte à 3'528, Abnahme 1'512.
  r = await call(tok(MASTER_UID), { action: 'msub_kalk_preview', personen: 2, team_tage: 7, ansatz_modus: 'detailliert', split_profil: 'stueck_15_70_15', einheit_typ: 'zone', einheit_anzahl: 1 });
  assert(r.d && r.d.kalk.umsatz === 10080, '(B3) 7T×2P×8h×90 = Umsatz 10080');
  assert(r.d && r.d.steps.fortschritt === 2 && r.d.steps.zahlung === 4, '(B3) 7 Team-Tage → 2 Fortschritte (ceil(7/5))');
  const l3 = r.d.steps.liste;
  assert(l3[0].bezeichnung === 'Anzahlung' && l3[0].betrag === 1512, '(B3) Anzahlung 1512');
  assert(l3[1].betrag === 3528 && l3[2].betrag === 3528, '(B3) zwei Fortschritte à 3528');
  assert(l3[3].bezeichnung === 'Abnahme' && l3[3].betrag === 1512, '(B3) Abnahme 1512');
  assert(l3[1].bezeichnung === 'Zwischenzahlung KW 1' && l3[2].bezeichnung === 'Installation fertig', '(B3) Benennung Zwischenzahlung/Installation fertig');
  assert(l3.reduce((s, x) => s + (x.typ === 'zahlung' ? x.betrag : 0), 0) === 10080, '(B3) Summe Steps == Umsatz 10080');
  // 5 Team-Tage → genau 1 Fortschritt „Fortschritt".
  r = await call(tok(MASTER_UID), { action: 'msub_kalk_preview', personen: 2, team_tage: 5, ansatz_modus: 'detailliert', split_profil: 'stueck_15_70_15', einheit_typ: 'zone', einheit_anzahl: 1 });
  assert(r.d && r.d.steps.fortschritt === 1 && r.d.steps.liste[1].bezeichnung === 'Fortschritt', '(B3) 5 Team-Tage → 1 Fortschritt');
  // 12 Team-Tage → 3 Fortschritte (2× Zwischenzahlung + Installation fertig).
  r = await call(tok(MASTER_UID), { action: 'msub_kalk_preview', personen: 2, team_tage: 12, ansatz_modus: 'detailliert', split_profil: 'stueck_15_70_15', einheit_typ: 'zone', einheit_anzahl: 1 });
  assert(r.d && r.d.steps.fortschritt === 3, '(B3) 12 Team-Tage → 3 Fortschritte');
  const fb = r.d.steps.liste.filter((s) => s.fortschritt).map((s) => s.bezeichnung);
  assert(fb[0] === 'Zwischenzahlung KW 1' && fb[1] === 'Zwischenzahlung KW 2' && fb[2] === 'Installation fertig', '(B3) 12T Benennung: 2× Zwischenzahlung + Installation fertig');

  // ── BLOCK 4: Prüf-Ansicht braucht Positionen | Zahlungsplan | Konditionen ──
  // spB1b hat einen Entwurf (Positionen auto aus Bauabschnitten + vorschlag/steps).
  r = await call(tok(MASTER_UID), { action: 'msub_detail', id: spB1b.id });
  const b4 = r.d && r.d.sub_bundle && r.d.sub_bundle.angebot;
  assert(b4 && Array.isArray(b4.positionen) && b4.positionen.length >= 1, '(B4) Prüf: Positionen vorhanden');
  assert(b4 && Array.isArray(b4.bauabschnitt_vorschlag) && b4.bauabschnitt_vorschlag[0].steps.some((s) => s.typ === 'zahlung' && s.betrag > 0), '(B4) Prüf: Zahlungsplan (Steps mit Betrag)');
  assert(b4 && b4.mwst_prozent != null, '(B4) Prüf: Konditionen (MWST) vorhanden');

  // ── BLOCK 5: Auftragsbestätigung ist INTERN ──
  // Master sieht die volle AB (Nummer + Zeitstempel).
  r = await call(tok(MASTER_UID), { action: 'msub_detail', id: sp.id });
  assert(r.d && r.d.sub_bundle.auftrag && /^AB-\d{4}-\d{6}$/.test(r.d.sub_bundle.auftrag.nummer) && r.d.sub_bundle.auftrag.bestaetigt_am, '(B5) Master sieht AB-Nummer + Zeitstempel');
  // Partner sieht NUR „Auftrag angenommen" + Zeitstempel.
  r = await call(tok(P_ALL), { action: 'sub_projekt', id: sp.id });
  assert(r.d && r.d.auftrag && r.d.auftrag.angenommen === true && r.d.auftrag.bestaetigt_am, '(B5) Partner: Auftrag angenommen + Zeitstempel');
  assert(r.d && !('nummer' in r.d.auftrag), '(B5) Partner-Auftrag OHNE AB-Nummer');
  // (c) NEU/EISERN: Partner-Payload nirgends ab_nummer / nummer.
  assert(!deepHasKey(r.d, 'nummer') && !deepHasKey(r.d, 'ab_nummer'), '(c) partner-payload OHNE ab_nummer');

  // ── BLOCK 6: Zahlungsplan-Generierung + zweite Annahme ──
  const r2 = (x) => Math.round(x * 100) / 100;
  const spB6 = (await call(tok(P_ALL), { action: 'sub_projekt_save', name: 'R6-Block6' })).d.projekt;
  await call(tok(MASTER_UID), { action: 'msub_kalk_apply', projekt_id: spB6.id, name: 'Rohbau', split_profil: 'stueck_15_70_15', einheit_typ: 'zone', einheit_anzahl: 1, personen: 2, team_tage: 7, ansatz_modus: 'detailliert' });
  const qs = await call(tok(MASTER_UID), { action: 'msub_angebot_quick_send', projekt_id: spB6.id });
  const acceptBetrag = qs.d.angebot.gesamtbetrag; // brutto = angenommener Betrag
  assert(acceptBetrag === r2(10080 * 1.081), '(B6) Angebot brutto = 10080 × 1.081');
  // 1. Annahme (Angebot): Zahlungsplan wird generiert, aber INAKTIV.
  r = await call(tok(P_ALL), { action: 'sub_entscheiden', projekt_id: spB6.id, op: 'annehmen' });
  assert(r.d && r.d.ok && r.d.zahlungsplan && r.d.zahlungsplan.status === 'offen' && r.d.zahlungsplan.aktiv === false, '(B6) nach Angebot-Annahme: Zahlungsplan offen + inaktiv');
  assert(r.d.zahlungsplan.abschnitte.every((a) => a.steps.every((s) => s.status === 'wartend' && !s.hinterlegen_moeglich)), '(B6) Plan inaktiv: alle Steps wartend, kein hinterlegen');
  // Summe aller generierten Steps == angenommener Angebotsbetrag.
  const b6ids = BAUAB.filter((a) => a.projekt_id === spB6.id).map((a) => a.id);
  const stepSum = r2(STEPS.filter((s) => b6ids.includes(s.bauabschnitt_id) && s.typ === 'zahlung').reduce((x, s) => x + Number(s.betrag || 0), 0));
  assert(stepSum === acceptBetrag, '(B6) Summe aller Steps == Angebotsbetrag');
  assert(r2(r.d.zahlungsplan.summe) === acceptBetrag, '(B6) Zahlungsplan.summe == Angebotsbetrag');
  // Audit-Trail: angebot_angenommen_at gesetzt, zahlungsplan noch offen.
  let prow = PROJEKTE.find((p) => p.id === spB6.id);
  assert(prow.angebot_angenommen_at && prow.zahlungsplan_status === 'offen' && prow.zahlungsplan_aktiv === false, '(B6) audit: angebot_angenommen_at gesetzt, plan offen');
  // Gating der 2. Annahme.
  assert((await call(tok(P_SUB2), { action: 'sub_zahlungsplan_annehmen', projekt_id: spB6.id })).status === 403, '(B6) fremd: zahlungsplan_annehmen → 403');
  // 2. Annahme (Zahlungsplan) → Zahlungssystem AKTIV, erster Step scharf.
  r = await call(tok(P_ALL), { action: 'sub_zahlungsplan_annehmen', projekt_id: spB6.id });
  assert(r.d && r.d.ok && r.d.zahlungsplan.status === 'angenommen' && r.d.zahlungsplan.aktiv === true, '(B6) 2. Annahme: Zahlungsplan aktiv');
  const firstStep = r.d.zahlungsplan.abschnitte[0].steps[0];
  assert(firstStep.zahlung_art === 'anzahlung' && firstStep.status === 'aktiv' && firstStep.hinterlegen_moeglich === true, '(B6) Anzahlung scharf + hinterlegen klickbar');
  // Zwei getrennte Zustimmungen im Audit-Trail.
  prow = PROJEKTE.find((p) => p.id === spB6.id);
  assert(prow.angebot_angenommen_at && prow.zahlungsplan_angenommen_at && prow.zahlungsplan_angenommen_by, '(B6) audit: angebot_angenommen_at + zahlungsplan_angenommen_at + by');
  // Doppelte 2. Annahme → Fehler.
  r = await call(tok(P_ALL), { action: 'sub_zahlungsplan_annehmen', projekt_id: spB6.id });
  assert(r.d && r.d.error && r.d.decided, '(B6) doppelte Zahlungsplan-Annahme → Fehler');
  // Plan bleibt dauerhaft im Partner-Cockpit sichtbar.
  r = await call(tok(P_ALL), { action: 'sub_projekt', id: spB6.id });
  assert(r.d && r.d.zahlungsplan && r.d.zahlungsplan.status === 'angenommen' && r.d.zahlungsplan.abschnitte.length, '(B6) Zahlungsplan dauerhaft im Partner-Cockpit');
  // (d) NEU/EISERN: Summe aller Steps == angenommener Angebotsbetrag.
  assert(stepSum === acceptBetrag, '(d) Summe aller Steps == angenommener Angebotsbetrag');
  // (c): auch der Zahlungsplan enthält kein split_profil/einheit_typ.
  assert(!deepHasKey(r.d.zahlungsplan, 'split_profil') && !deepHasKey(r.d.zahlungsplan, 'einheit_typ'), '(c) Zahlungsplan ohne split_profil/einheit_typ');
  // sub_step_hinterlegen: fremd → 403.
  assert((await call(tok(P_SUB2), { action: 'sub_step_hinterlegen', step_id: firstStep.id })).status === 403, '(B6) fremd: step_hinterlegen → 403');

  // ── BLOCK 7: Anzahlung ist Startbedingung (Statuszeile, kein Blinken) ──
  // Plan aktiv, Anzahlung noch nicht hinterlegt → Startbedingung offen.
  r = await call(tok(MASTER_UID), { action: 'msub_detail', id: spB6.id });
  const mzp = r.d && r.d.sub_bundle && r.d.sub_bundle.zahlungsplan;
  assert(mzp && mzp.startbedingung && mzp.startbedingung.offen === true, '(B7) Master: Startbedingung offen (Anzahlung ausstehend)');
  assert(mzp && /Anzahlung ausstehend/.test(mzp.startbedingung.master_hinweis) && /Termin nicht reserviert/.test(mzp.startbedingung.master_hinweis), '(B7) Master-Hinweis: „Anzahlung ausstehend – Termin nicht reserviert."');
  r = await call(tok(P_ALL), { action: 'sub_projekt', id: spB6.id });
  const pzp = r.d && r.d.zahlungsplan;
  assert(pzp && pzp.startbedingung.offen === true && /Anzahlung hinterlegen/.test(pzp.startbedingung.partner_hinweis) && /verbindlich/.test(pzp.startbedingung.partner_hinweis), '(B7) Partner-Hinweis: „Bitte Anzahlung hinterlegen, damit der Termin verbindlich wird."');
  assert(pzp && pzp.anzahlung_hinterlegt === false, '(B7) Anzahlung noch nicht hinterlegt');

  // ── ABSCHLUSS: Pflicht-Assertions am voll angereicherten Partner-Payload ──
  // (a) keine internen Kalk-/Kostenfelder; (c) kein internes Engine-Vokabular.
  ['kosten', 'rohgewinn', 'ampel', 'ansatz_chf_h', 'vollkosten_chf_h'].forEach((k) =>
    assert(!deepHasKey(r.d, k), '(a) partner-payload (mit Zahlungsplan) OHNE ' + k));
  ['split_profil', 'einheit_typ', 'nummer', 'ab_nummer'].forEach((k) =>
    assert(!deepHasKey(r.d, k), '(c) partner-payload (mit Zahlungsplan) OHNE ' + k));
}

const RUNS = 5;
for (let i = 1; i <= RUNS; i++) await suite(i);
console.log(`\n${RUNS}× durchlaufen · PASS=${PASS} FAIL=${FAIL}`);
if (FAIL) { console.log('FEHLGESCHLAGEN:'); [...new Set(FAILS)].forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log('✓ Alle Assertions grün (Gating, Branding, Sub-Lifecycle, Datentrennung, Master).');
