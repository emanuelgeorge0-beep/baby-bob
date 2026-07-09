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
let ROLES, ENTS, PROFIL, PROJEKTE, STORAGE;
function resetState() {
  ROLES = new Map();      // userId → role
  ENTS = new Map();       // `${pid} ${key}` → enabled
  PROFIL = new Map();     // partner_user_id → row
  PROJEKTE = [];          // gs_projekte rows
  STORAGE = new Map();    // path → { buf, contentType, created_at }
  _uc = 0;
}
function setPartner(id, feats) {
  ROLES.set(id, 'gs_partner');
  for (const f of feats) ENTS.set(id + ' ' + f, true);
}

// ── PostgREST-Query zerlegen: eq-Filter + select ──
function parseQ(qs) {
  const filt = {}; let select = '*';
  for (const part of (qs || '').split('&')) {
    if (!part) continue;
    const [k, v] = part.split('=');
    if (k === 'select') { select = decodeURIComponent(v); continue; }
    if (k === 'order' || k === 'limit') continue;
    if (v && v.startsWith('eq.')) filt[k] = decodeURIComponent(v.slice(3));
  }
  return { filt, select };
}
function match(row, filt) {
  for (const k of Object.keys(filt)) if (String(row[k] ?? '') !== String(filt[k])) return false;
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
    const { filt } = parseQ(qs);
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
}

const RUNS = 5;
for (let i = 1; i <= RUNS; i++) await suite(i);
console.log(`\n${RUNS}× durchlaufen · PASS=${PASS} FAIL=${FAIL}`);
if (FAIL) { console.log('FEHLGESCHLAGEN:'); [...new Set(FAILS)].forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log('✓ Alle Assertions grün (Gating, Branding, Sub-Lifecycle, Datentrennung, Master).');
