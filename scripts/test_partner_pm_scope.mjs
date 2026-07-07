// scripts/test_partner_pm_scope.mjs
// OFFLINE-Integrationstest der Partner-Datentrennung im Projektmanagement.
// Fährt den ECHTEN Handler api/cockpit.js gegen ein gemocktes Supabase (fetch-Stub).
// Beweist: Partner sieht NUR eigene Projekte, kann NICHT auf fremde/Master-Projekte
// zugreifen (403), neue Projekte gehören ihm, Datei-Kategorien landen im Pfad,
// Kunden werden pro Partner gefiltert. Master sieht alles. Kein Netz/DB nötig.
//
// Aufruf:  node scripts/test_partner_pm_scope.mjs

const MASTER_UID = 'ee46a716-7017-4045-9f67-fe06d05171e7';
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // Partner A (entitled)
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // Partner B (entitled)
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; // Partner C (NICHT entitled)

const P1 = '11111111-1111-1111-1111-111111111111'; // gehört A
const P2 = '22222222-2222-2222-2222-222222222222'; // gehört B
const P3 = '33333333-3333-3333-3333-333333333333'; // Master (partner_user_id null)
const MATROW_B = '22220000-0000-0000-0000-0000000000b2'; // gs_material-Zeile in P2

const USERS = { tokMaster: MASTER_UID, tokA: A, tokB: B, tokC: C };
const ROLE = { [MASTER_UID]: 'master', [A]: 'gs_partner', [B]: 'gs_partner', [C]: 'gs_partner' };
const ENTITLED = { [A]: true, [B]: true, [C]: false };
const PROJ_OWNER = { [P1]: A, [P2]: B, [P3]: null };

// Alle Supabase-Requests, die der Handler absetzt (für Assertions).
let calls = [];

function res(body, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}
function qparam(url, key) {
  const m = url.match(new RegExp('[?&]' + key + '=([^&]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function eqVal(url, col) {
  // matcht  col=eq.<wert>
  const m = url.match(new RegExp('[?&]' + col + '=eq\\.([^&]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

// ── fetch-Stub: routet nach URL/Methode und protokolliert jeden Call. ──
globalThis.fetch = async (url, opts = {}) => {
  const method = (opts.method || 'GET').toUpperCase();
  calls.push({ url, method, headers: opts.headers || {}, body: opts.body });

  // Auth: Token → User
  if (url.includes('/auth/v1/user')) {
    const auth = (opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || '';
    const tok = auth.replace('Bearer ', '').trim();
    const id = USERS[tok];
    return id ? res({ id, email: tok + '@test' }) : res({ error: 'bad' }, false, 401);
  }
  // Rollen
  if (url.includes('/rest/v1/user_roles')) {
    const id = eqVal(url, 'user_id');
    const role = ROLE[id];
    return res(role ? [{ role }] : []);
  }
  // Entitlements
  if (url.includes('/rest/v1/gs_partner_entitlements')) {
    const id = eqVal(url, 'partner_user_id');
    return res(ENTITLED[id] ? [{ feature_key: 'projektmanagement', enabled: true }] : []);
  }
  // Projekte
  if (url.includes('/rest/v1/gs_projekte')) {
    if (method === 'POST') { // neues Projekt anlegen → echo mit id
      let payload = {}; try { payload = JSON.parse(opts.body); } catch {}
      return res([{ id: 'new00000-0000-0000-0000-000000000000', ...payload }]);
    }
    if (method === 'PATCH') { return res([{ id: eqVal(url, 'id') }]); }
    const idIn = eqVal(url, 'id');
    if (idIn) { // Detail/Ownership-Lookup einer bestimmten id
      const owner = PROJ_OWNER[idIn];
      return res([{ id: idIn, name: 'Projekt ' + idIn.slice(0, 4), status: 'aktiv', partner_user_id: owner }]);
    }
    // Liste (evtl. gefiltert)
    const scope = eqVal(url, 'partner_user_id');
    const all = Object.keys(PROJ_OWNER).map((pid) => ({ id: pid, name: 'P', status: 'aktiv', partner_user_id: PROJ_OWNER[pid] }));
    return res(scope ? all.filter((p) => p.partner_user_id === scope) : all);
  }
  // Material-Zeile (Ownership via projekt_id)
  if (url.includes('/rest/v1/gs_material')) {
    if (method === 'GET' && eqVal(url, 'id') === MATROW_B) return res([{ id: MATROW_B, projekt_id: P2 }]);
    if (method === 'GET' && eqVal(url, 'id')) return res([]);
    if (method === 'POST') return res([{ id: 'mnew' }]);
    if (method === 'DELETE') return res(null);
    return res([]);
  }
  // Kunden
  if (url.includes('/rest/v1/gs_kunden')) {
    if (method === 'POST') { let p = {}; try { p = JSON.parse(opts.body); } catch {} return res([{ id: 'knew', ...p }]); }
    return res([]); // leere Liste genügt für die Filter-Assertion
  }
  // Storage: list / sign / upload / delete
  if (url.includes('/storage/v1/object/list/')) return res([]);
  if (url.includes('/storage/v1/object/sign/')) return res({ signedURL: '/signed/x' });
  if (url.includes('/storage/v1/object/')) return res({ Key: 'ok' }); // upload/delete
  // Sonstige Tabellen (blockaden, techniker, taetigkeiten, tagesrapporte, rechnungen …)
  return res([]);
};

// Fake Express res
function mkRes() {
  return {
    _status: 0, _json: null, _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
    end() { return this; },
  };
}

process.env.SUPABASE_URL = 'http://sb.test';
process.env.SUPABASE_KEY = 'service-key';

const { default: handler } = await import('../api/cockpit.js');

async function call(token, action, extra = {}) {
  calls = [];
  const req = { method: 'POST', headers: {}, body: { token, action, ...extra } };
  const r = mkRes();
  await handler(req, r);
  return { status: r._status, body: r._json, calls };
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

async function suite(run) {
  // 1. Ungültiger Token → 403
  let r = await call('bad', 'pm_projekte');
  ok('bad token → 403', r.status === 403, 'status=' + r.status);

  // 2. Master sieht alle Projekte (kein partner_user_id-Filter)
  r = await call('tokMaster', 'pm_projekte');
  const masterProjQ = r.calls.find((c) => c.url.includes('/rest/v1/gs_projekte') && c.method === 'GET' && !c.url.includes('id=eq'));
  ok('master pm_projekte 200', r.status === 200, 'status=' + r.status);
  ok('master query ohne partner-filter', masterProjQ && !masterProjQ.url.includes('partner_user_id=eq'), masterProjQ && masterProjQ.url);
  ok('master bekommt alle 3 Projekte', r.body && r.body.projekte && r.body.projekte.length === 3, 'n=' + (r.body && r.body.projekte && r.body.projekte.length));

  // 3. Partner A sieht NUR eigene (Filter partner_user_id=eq.A, nur P1)
  r = await call('tokA', 'pm_projekte');
  const aProjQ = r.calls.find((c) => c.url.includes('/rest/v1/gs_projekte') && c.method === 'GET' && c.url.includes('partner_user_id=eq'));
  ok('partner A pm_projekte 200', r.status === 200, 'status=' + r.status);
  ok('partner A query hat partner_user_id=eq.A', aProjQ && eqVal(aProjQ.url, 'partner_user_id') === A, aProjQ && aProjQ.url);
  ok('partner A bekommt nur eigene Projekte', r.body && r.body.projekte && r.body.projekte.length === 1 && r.body.projekte[0].id === P1,
    'n=' + (r.body && r.body.projekte && r.body.projekte.length));

  // 4. Partner A öffnet eigenes Projekt → 200
  r = await call('tokA', 'pm_projekt', { id: P1 });
  ok('partner A öffnet eigenes Projekt → 200', r.status === 200, 'status=' + r.status);

  // 5. Partner A öffnet FREMDES (B) Projekt → 403
  r = await call('tokA', 'pm_projekt', { id: P2 });
  ok('partner A öffnet Projekt von B → 403', r.status === 403, 'status=' + r.status);

  // 6. Partner A öffnet Master-Projekt → 403
  r = await call('tokA', 'pm_projekt', { id: P3 });
  ok('partner A öffnet Master-Projekt → 403', r.status === 403, 'status=' + r.status);

  // 7. Master öffnet B-Projekt → 200 (sieht alles)
  r = await call('tokMaster', 'pm_projekt', { id: P2 });
  ok('master öffnet fremdes Projekt → 200', r.status === 200, 'status=' + r.status);

  // 8. Partner C (nicht freigeschaltet) → 403
  r = await call('tokC', 'pm_projekte');
  ok('partner ohne Entitlement → 403', r.status === 403, 'status=' + r.status);

  // 9. Partner A ruft Nicht-PM-Action (leads) → 403
  r = await call('tokA', 'leads');
  ok('partner A → non-PM action (leads) 403', r.status === 403, 'status=' + r.status);

  // 10. Partner A legt neues Projekt an → partner_user_id = A erzwungen
  r = await call('tokA', 'pm_projekt_save', { name: 'Neu A' });
  const postProj = r.calls.find((c) => c.url.includes('/rest/v1/gs_projekte') && c.method === 'POST');
  let posted = {}; try { posted = JSON.parse(postProj.body); } catch {}
  ok('partner A neues Projekt → 200', r.status === 200, 'status=' + r.status);
  ok('neues Projekt bekommt partner_user_id=A', posted.partner_user_id === A, 'pid=' + posted.partner_user_id);

  // 11. Partner A darf B's Projekt nicht bearbeiten → 403
  r = await call('tokA', 'pm_projekt_save', { id: P2, name: 'hijack' });
  ok('partner A editiert B-Projekt → 403', r.status === 403, 'status=' + r.status);

  // 12. Datei-Upload eigenes Projekt: Kategorie im Pfad, Upload ok
  r = await call('tokA', 'pm_datei_upload', { projekt_id: P1, kategorie: 'bilder', filename: 'foto.jpg', contentType: 'image/jpeg', data: 'data:image/jpeg;base64,' + Buffer.from('x').toString('base64') });
  const up = r.calls.find((c) => c.url.includes('/storage/v1/object/projektdateien/') && c.method === 'POST');
  ok('partner A upload eigenes Projekt → 200', r.status === 200, 'status=' + r.status);
  ok('upload-pfad enthält /bilder/', up && up.url.includes('/' + P1 + '/bilder/'), up && up.url);

  // 13. Datei-Upload auf FREMDES Projekt → 403 (kein Storage-Call)
  r = await call('tokA', 'pm_datei_upload', { projekt_id: P2, kategorie: 'bilder', filename: 'x.jpg', data: 'data:,' + Buffer.from('x').toString('base64') });
  const upB = r.calls.find((c) => c.url.includes('/storage/v1/object/projektdateien/') && c.method === 'POST');
  ok('partner A upload auf B-Projekt → 403', r.status === 403, 'status=' + r.status);
  ok('kein Storage-Write bei fremdem Projekt', !upB, upB && upB.url);

  // 14. Material löschen einer Zeile aus B's Projekt → 403 (Row-Ownership)
  r = await call('tokA', 'pm_material_del', { id: MATROW_B });
  ok('partner A löscht Material von B → 403', r.status === 403, 'status=' + r.status);

  // 15. Material hinzufügen zu fremdem Projekt → 403
  r = await call('tokA', 'pm_material_add', { projekt_id: P2, bezeichnung: 'Rohr' });
  ok('partner A Material-add fremdes Projekt → 403', r.status === 403, 'status=' + r.status);

  // 16. Kundenliste des Partners filtert partner_user_id=eq.A
  r = await call('tokA', 'pm_kunden');
  const kQ = r.calls.find((c) => c.url.includes('/rest/v1/gs_kunden') && c.method === 'GET');
  ok('partner A pm_kunden 200', r.status === 200, 'status=' + r.status);
  ok('kunden-query hat partner_user_id=eq.A', kQ && eqVal(kQ.url, 'partner_user_id') === A, kQ && kQ.url);

  // 17. Master pm_kunden ohne Partner-Filter
  r = await call('tokMaster', 'pm_kunden');
  const kQm = r.calls.find((c) => c.url.includes('/rest/v1/gs_kunden') && c.method === 'GET');
  ok('master kunden ohne partner-filter', kQm && !kQm.url.includes('partner_user_id=eq'), kQm && kQm.url);

  // 18. Techniker einem FREMDEN Projekt zuweisen → 403
  r = await call('tokA', 'pm_tech_assign', { projekt_id: P2, techniker_id: MASTER_UID });
  ok('partner A Techniker-Zuweisung fremdes Projekt → 403', r.status === 403, 'status=' + r.status);

  // 19. PDF-Export EIGENES Projekt → 200 (echtes PDF), FREMDES → 403
  r = await call('tokA', 'pm_export_material', { projekt_id: P1 });
  ok('partner A Material-Export eigenes Projekt → 200', r.status === 200, 'status=' + r.status);
  ok('Material-Export liefert pdf_base64', !!(r.body && r.body.pdf_base64), 'keys=' + (r.body && Object.keys(r.body).join(',')));
  r = await call('tokA', 'pm_export_material', { projekt_id: P2 });
  ok('partner A Material-Export fremdes Projekt → 403', r.status === 403, 'status=' + r.status);
  r = await call('tokMaster', 'pm_export_material', { projekt_id: P2 });
  ok('master Material-Export beliebiges Projekt → 200', r.status === 200, 'status=' + r.status);

  // 20. Datei löschen auf FREMDEM Projekt → 403 und KEIN Storage-DELETE
  r = await call('tokA', 'pm_datei_del', { projekt_id: P2, path: P2 + '/bilder/x.jpg' });
  const delB = r.calls.find((c) => c.url.includes('/storage/v1/object/projektdateien/') && c.method === 'DELETE');
  ok('partner A Datei-Del fremdes Projekt → 403', r.status === 403, 'status=' + r.status);
  ok('kein Storage-DELETE bei fremdem Projekt', !delB, delB && delB.url);

  // 21. Rapport-Abrechnung auf fremdem/unzugänglichem Projekt → 403
  r = await call('tokA', 'pm_rapport_verrechnet', { id: '44440000-0000-0000-0000-0000000000f4', status: 'verrechnet' });
  ok('partner A Rapport-Abrechnung ohne Zugriff → 403', r.status === 403, 'status=' + r.status);

  // 22. Datei-Liste eines FREMDEN Projekts → 403
  r = await call('tokA', 'pm_datei_list', { projekt_id: P2 });
  ok('partner A Datei-Liste fremdes Projekt → 403', r.status === 403, 'status=' + r.status);
}

console.log('Partner-PM Datentrennung — Offline-Integrationstest\n');
const RUNS = 5;
for (let i = 1; i <= RUNS; i++) {
  const before = fail;
  await suite(i);
  console.log(`Durchlauf ${i}/${RUNS}: ${fail === before ? 'OK' : (fail - before) + ' Fehler'}`);
}
console.log(`\nErgebnis: ${pass} bestanden, ${fail} fehlgeschlagen (über ${RUNS} Durchläufe)`);
process.exit(fail ? 1 : 0);
