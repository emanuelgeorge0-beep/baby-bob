// scripts/test_medien_service.mjs
// Enforcement-Test für Feature B (Medien/Stockwerk) + C (Service-Auftrag).
// Treibt den ECHTEN api/cockpit.js-Handler mit gemocktem global.fetch — kein Live-DB.
// Prüft die Rollen-Matrix (master/partner/techniker) über die verifizierte Kette.
//   node scripts/test_medien_service.mjs
process.env.SUPABASE_URL = 'http://mock.local';
process.env.SUPABASE_KEY = 'service-key';

const MASTER_UID = 'ee46a716-7017-4045-9f67-fe06d05171e7';

// Gültige UUIDs für alle Fixture-Entitäten (uuid() im Handler validiert streng).
const U = {
  partA:     '11111111-1111-4111-8111-111111111111',
  partB:     '22222222-2222-4222-8222-222222222222',
  tech1auth: '33333333-3333-4333-8333-333333333333',
  tech1row:  '44444444-4444-4444-8444-444444444444',
  projA:     '55555555-5555-4555-8555-555555555555',
  projB:     '66666666-6666-4666-8666-666666666666',
  svcA:      '77777777-7777-4777-8777-777777777777',
  svcB:      '88888888-8888-4888-8888-888888888888',
  sw1:       '99999999-9999-4999-8999-999999999999',
  mastertech:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',   // gs_techniker.id des Master (Multirole)
};

// ── Fixtures ──────────────────────────────────────────────────────────────
// Master ist ZUSÄTZLICH Techniker (Multirole) → user_extra_roles + gs_techniker-Zeile.
const USERS = {
  'tok-master': { id: MASTER_UID, role: 'master', technikerRow: U.mastertech, extra: ['techniker'] },
  'tok-partA':  { id: U.partA,    role: 'gs_partner' },
  'tok-tech1':  { id: U.tech1auth,role: 'techniker', technikerRow: U.tech1row },
};
const PROJ = {
  [U.projA]: { partner_user_id: U.partA, techs: [U.tech1row, U.mastertech] }, // tech1 + Master-als-Techniker
  [U.projB]: { partner_user_id: U.partB, techs: [] },                          // fremd, niemand zugewiesen
};
const SVC = {
  [U.svcA]: { id: U.svcA, partner_user_id: U.partA, status: 'angenommen', techs: [U.tech1row], objekt: 'Haus A', quelle: 'manuell' },
  [U.svcB]: { id: U.svcB, partner_user_id: U.partB, status: 'neu',        techs: [],           objekt: 'Haus B', quelle: 'manuell' },
};

const ok  = (body) => ({ ok: true,  status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const notOk = (status = 404, body = 'not found') => ({ ok: false, status, json: async () => ({}), text: async () => body });
function qparam(url, key) { const m = url.match(new RegExp(`${key}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; }

global.fetch = async (url, opts = {}) => {
  const method = (opts.method || 'GET').toUpperCase();

  if (url.endsWith('/auth/v1/user')) {
    const auth = (opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || '';
    const u = USERS[auth.replace(/^Bearer\s+/, '')];
    return u ? ok({ id: u.id }) : notOk(401, 'unauthorized');
  }
  if (url.includes('user_roles?')) {
    const uid = qparam(url, 'user_id');
    const u = Object.values(USERS).find((x) => x.id === uid);
    return ok(u ? [{ role: u.role }] : []);
  }
  if (url.includes('user_extra_roles?') && url.includes('user_id=eq.')) {
    const uid = qparam(url, 'user_id');
    const u = Object.values(USERS).find((x) => x.id === uid);
    return ok((u && u.extra) ? u.extra.map((role) => ({ role })) : []);
  }
  if (url.includes('gs_techniker?') && url.includes('user_id=eq.')) {
    const uid = qparam(url, 'user_id');
    const u = Object.values(USERS).find((x) => x.id === uid);
    return ok(u && u.technikerRow ? [{ id: u.technikerRow }] : []);
  }
  if (url.includes('gs_techniker?') && url.includes('id=in.')) return ok([]);
  if (url.includes('gs_partner_entitlements')) return notOk(404);   // fail-open ⇒ Partner berechtigt
  if (url.includes('gs_projekte?') && url.includes('select=partner_user_id')) {
    const p = PROJ[qparam(url, 'id')];
    return ok(p ? [{ partner_user_id: p.partner_user_id }] : []);
  }
  if (url.includes('gs_projekt_techniker?') && url.includes('projekt_id=eq.') && url.includes('techniker_id=eq.')) {
    const p = PROJ[qparam(url, 'projekt_id')]; const tid = qparam(url, 'techniker_id');
    return ok(p && p.techs.includes(tid) ? [{ projekt_id: qparam(url, 'projekt_id') }] : []);
  }
  if (url.includes('gs_projekt_techniker?') && url.includes('techniker_id=eq.')) {
    const tid = qparam(url, 'techniker_id');
    const ids = Object.entries(PROJ).filter(([, p]) => p.techs.includes(tid)).map(([id]) => id);
    return ok(ids.map((id) => ({ projekt_id: id, taetigkeit: null, seit: null })));
  }
  if (url.includes('gs_service_auftrag?') && url.includes('select=partner_user_id')) {
    const s = SVC[qparam(url, 'id')];
    return ok(s ? [{ partner_user_id: s.partner_user_id }] : []);
  }
  if (url.includes('gs_service_auftrag?') && method === 'GET') {
    const sid = qparam(url, 'id');
    if (sid) return ok(SVC[sid] ? [SVC[sid]] : []);
    return ok(Object.values(SVC));
  }
  if (url.includes('gs_service_techniker?') && url.includes('service_auftrag_id=eq.') && url.includes('techniker_id=eq.')) {
    const s = SVC[qparam(url, 'service_auftrag_id')]; const tid = qparam(url, 'techniker_id');
    return ok(s && s.techs.includes(tid) ? [{ service_auftrag_id: s.id }] : []);
  }
  if (url.includes('gs_service_techniker?') && url.includes('techniker_id=eq.')) {
    const tid = qparam(url, 'techniker_id');
    return ok(Object.values(SVC).filter((s) => s.techs.includes(tid)).map((s) => ({ service_auftrag_id: s.id })));
  }
  if (url.includes('gs_service_techniker?') && url.includes('service_auftrag_id=eq.')) return ok([]);
  if (url.includes('gs_projekt_medien?') && method === 'GET') return ok([]);
  if (url.includes('gs_projekt_stockwerk?') && method === 'GET') return ok([]);
  if (url.includes('/storage/v1/object/upload/sign/')) return ok({ url: '/object/upload/sign/projektdateien/x?token=abc' });
  if (url.includes('/storage/v1/object/sign/')) return ok({ signedURL: '/signed/x' });
  if (url.includes('/storage/v1/object/')) return ok({ Key: 'x' });
  if (method === 'POST' || method === 'PATCH') {
    let body = {}; try { body = JSON.parse(opts.body || '{}'); } catch {}
    return ok([{ id: 'newid', ...(Array.isArray(body) ? body[0] : body) }]);
  }
  if (method === 'DELETE') return ok(null);
  return notOk(404, `unmocked: ${method} ${url}`);
};

const { default: handler } = await import('../api/cockpit.js');

async function call(token, action, body = {}) {
  const req = { method: 'POST', body: { token, action, ...body } };
  let _status = 0, _json = null;
  const res = { setHeader() {}, status(c) { _status = c; return this; }, json(o) { _json = o; return this; }, end() { return this; } };
  await handler(req, res);
  return { status: _status, json: _json };
}

let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.log('  ✗ FAIL:', name); } }
const is403 = (r) => r.status === 403;
const isOk  = (r) => r.status === 200 && r.json && !r.json.error;
const isErr = (r, frag) => r.status === 200 && r.json && typeof r.json.error === 'string' && r.json.error.includes(frag);

async function suite() {
  // Feature B — Medien/Stockwerk
  check('master listet Medien (projA)',             isOk(await call('tok-master', 'medien_list', { projekt_id: U.projA })));
  check('partner listet eigene Medien (projA)',     isOk(await call('tok-partA', 'medien_list', { projekt_id: U.projA })));
  check('partner listet FREMDE Medien → 403',       is403(await call('tok-partA', 'medien_list', { projekt_id: U.projB })));
  check('partner Upload → 403 (read-only)',         is403(await call('tok-partA', 'medien_upload', { projekt_id: U.projA, data: 'QUJD', filename: 'a.jpg', stockwerk: 'EG' })));
  check('techniker listet zugew. Medien (projA)',   isOk(await call('tok-tech1', 'medien_list', { projekt_id: U.projA })));
  check('techniker listet FREMDE Medien → 403',     is403(await call('tok-tech1', 'medien_list', { projekt_id: U.projB })));
  check('techniker Upload zugew. + Stockwerk → ok', isOk(await call('tok-tech1', 'medien_upload', { projekt_id: U.projA, data: 'QUJD', filename: 'a.jpg', stockwerk: 'EG' })));
  check('techniker Upload OHNE Stockwerk → Fehler', isErr(await call('tok-tech1', 'medien_upload', { projekt_id: U.projA, data: 'QUJD', filename: 'a.jpg' }), 'Stockwerk'));
  check('techniker Upload FREMD → 403',             is403(await call('tok-tech1', 'medien_upload', { projekt_id: U.projB, data: 'QUJD', filename: 'a.jpg', stockwerk: 'EG' })));
  // Video-Direktupload (sign + register)
  const sign = await call('tok-tech1', 'medien_sign_upload', { projekt_id: U.projA, filename: 'v.mp4' });
  check('techniker sign_upload (zugew.) → uploadUrl', isOk(sign) && !!sign.json.uploadUrl, sign.json);
  check('techniker sign_upload FREMD → 403',        is403(await call('tok-tech1', 'medien_sign_upload', { projekt_id: U.projB, filename: 'v.mp4' })));
  check('partner sign_upload → 403 (read-only)',    is403(await call('tok-partA', 'medien_sign_upload', { projekt_id: U.projA, filename: 'v.mp4' })));
  check('techniker register (korrekter path) → ok', isOk(await call('tok-tech1', 'medien_register', { projekt_id: U.projA, path: `${U.projA}/medien/1-v.mp4`, contentType: 'video/mp4', stockwerk: 'EG', dauer_sekunden: 20 })));
  check('techniker register FREMD-path → 403',      is403(await call('tok-tech1', 'medien_register', { projekt_id: U.projA, path: `${U.projB}/medien/1-v.mp4`, contentType: 'video/mp4', stockwerk: 'EG' })));
  check('techniker Video-Upload (Service, ohne SW) → ok', isOk(await call('tok-tech1', 'medien_upload', { service_auftrag_id: U.svcA, data: 'QUJD', filename: 'v.mp4', contentType: 'video/mp4', medientyp: 'video' })));
  check('stockwerk_del nur Master (techniker→403)', is403(await call('tok-tech1', 'stockwerk_del', { id: U.sw1 })));

  // Feature C — Service-Auftrag
  check('partner erstellt Service-Auftrag → ok',    isOk(await call('tok-partA', 'svc_create', { objekt: 'Neu', beschreibung: 'x', quelle: 'sprache' })));
  check('techniker erstellt Auftrag → 403',         is403(await call('tok-tech1', 'svc_create', { objekt: 'Neu' })));
  check('partner Statuswechsel → 403',              is403(await call('tok-partA', 'svc_status', { id: U.svcA, status: 'erledigt' })));
  check('techniker zugew. angenommen→erledigt → ok',isOk(await call('tok-tech1', 'svc_status', { id: U.svcA, status: 'erledigt' })));
  check('techniker FREMD Statuswechsel → 403',      is403(await call('tok-tech1', 'svc_status', { id: U.svcB, status: 'erledigt' })));
  check('master neu→angenommen (svcB) → ok',        isOk(await call('tok-master', 'svc_status', { id: U.svcB, status: 'angenommen' })));
  check('master neu→erledigt (ungültig) → Fehler',  isErr(await call('tok-master', 'svc_status', { id: U.svcB, status: 'erledigt' }), 'nicht erlaubt'));
  check('svc_assign nicht-Master → 403',            is403(await call('tok-partA', 'svc_assign', { service_auftrag_id: U.svcA, techniker_id: U.tech1row })));
  check('svc_assign Master → ok',                   isOk(await call('tok-master', 'svc_assign', { service_auftrag_id: U.svcA, techniker_id: U.tech1row })));
  check('techniker listet zugew. Aufträge → ok',    isOk(await call('tok-tech1', 'svc_liste')));
  check('partner sieht eigene Aufträge → ok',       isOk(await call('tok-partA', 'svc_liste')));

  // ── MULTIROLE (Master = auch Techniker) ──
  // Master in TECHNIKER-Modus: wird als Techniker gescoped (nur zugewiesene Projekte).
  check('master mode=techniker: tech_projekte → ok',        isOk(await call('tok-master', 'tech_projekte', { mode: 'techniker' })));
  check('master mode=techniker: fremdes Projekt → 403',     is403(await call('tok-master', 'tech_projekt', { id: U.projB, mode: 'techniker' })));
  check('master mode=techniker: Master-Action svc_assign → 403', is403(await call('tok-master', 'svc_assign', { service_auftrag_id: U.svcA, techniker_id: U.tech1row, mode: 'techniker' })));
  // Master in MASTER-Modus (und ohne mode): voller Zugriff.
  check('master mode=master: svc_assign → ok',              isOk(await call('tok-master', 'svc_assign', { service_auftrag_id: U.svcA, techniker_id: U.tech1row, mode: 'master' })));
  check('master OHNE mode: svc_assign → ok (Default Master)', isOk(await call('tok-master', 'svc_assign', { service_auftrag_id: U.svcA, techniker_id: U.tech1row })));
  // SICHERHEIT: Techniker behauptet mode=master → NICHT honoriert, keine Eskalation.
  check('techniker mode=master: svc_assign → 403 (keine Eskalation)', is403(await call('tok-tech1', 'svc_assign', { service_auftrag_id: U.svcA, techniker_id: U.tech1row, mode: 'master' })));
  check('techniker mode=master: tech_projekte bleibt Techniker-Scope → ok', isOk(await call('tok-tech1', 'tech_projekte', { mode: 'master' })));
  // Partner behauptet mode=techniker → nicht gehalten → Partner-Default, Upload bleibt 403.
  check('partner mode=techniker: Upload → 403 (read-only bleibt)', is403(await call('tok-partA', 'medien_upload', { projekt_id: U.projA, data: 'QUJD', filename: 'a.jpg', stockwerk: 'EG', mode: 'techniker' })));
}

for (let i = 1; i <= 5; i++) {
  pass = 0; fail = 0;
  await suite();
  console.log(`Durchlauf ${i}: ${pass} pass, ${fail} fail`);
  if (fail) { console.error('❌ Enforcement-Test FEHLGESCHLAGEN'); process.exit(1); }
}
console.log('✅ Alle Enforcement-Checks bestanden (5×).');
