// scripts/verify_live_medien_service.mjs
// LIVE-Verifikation Feature B (Medien) + C (Service) gegen echte Supabase.
// Legt temporäre Testdaten an (Präfix "ZZVERIFY"), erzeugt echte Techniker-/Partner-JWTs,
// treibt den ECHTEN api/cockpit.js-Handler, prüft die Enforcement-Kette und RÄUMT ALLES WEG.
//   node --env-file=.env.local scripts/verify_live_medien_service.mjs
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY;
if (!URL || !KEY) { console.error('SUPABASE_URL/KEY fehlen (--env-file=.env.local?)'); process.exit(1); }
const SB = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const TS = Date.now();
const B64 = Buffer.from('ZZVERIFY-bytes').toString('base64');

async function rest(method, path, body, prefer) {
  const h = { ...SB }; if (prefer) h.Prefer = prefer;
  const r = await fetch(`${URL}/rest/v1/${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${txt.slice(0, 200)}`);
  try { return JSON.parse(txt); } catch { return null; }
}
async function adminCreateUser(email, meta = {}) {
  const r = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST', headers: SB,
    body: JSON.stringify({ email, password: `Zz!${TS}xy`, email_confirm: true, user_metadata: meta }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`create user ${email} → ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.id;
}
async function signIn(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: `Zz!${TS}xy` }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`signin ${email} → ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}
async function delStorage(path) {
  await fetch(`${URL}/storage/v1/object/projektdateien/${path}`, { method: 'DELETE', headers: SB }).catch(() => {});
}

// Handler laden (env ist via --env-file bereits gesetzt).
const { default: handler } = await import('../api/cockpit.js');
async function call(token, action, body = {}) {
  const req = { method: 'POST', body: { token, action, ...body } };
  let _s = 0, _j = null;
  const res = { setHeader() {}, status(c) { _s = c; return this; }, json(o) { _j = o; return this; }, end() { return this; } };
  await handler(req, res);
  return { status: _s, json: _j };
}

let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name, extra ? JSON.stringify(extra) : ''); } }
const is403 = (r) => r.status === 403;
const isOk = (r) => r.status === 200 && r.json && !r.json.error;

const created = { users: [], techRows: [], projekte: [], service: [], entl: [], storage: [] };

try {
  // ── SETUP ──
  console.log('\n── Setup (Live-Testdaten anlegen) ──');
  const techEmail = `zzverify_tech_${TS}@example.invalid`;
  const partEmail = `zzverify_part_${TS}@example.invalid`;
  const techAuth = await adminCreateUser(techEmail, { firma: 'ZZVERIFY' });
  const partAuth = await adminCreateUser(partEmail, { firma: 'ZZVERIFY Partner' });
  created.users.push(techAuth, partAuth);
  await rest('POST', 'user_roles', { user_id: techAuth, role: 'techniker' });
  await rest('POST', 'user_roles', { user_id: partAuth, role: 'gs_partner' });
  const techRow = (await rest('POST', 'gs_techniker', { name: 'ZZVERIFY Monteur', user_id: techAuth }, 'return=representation'))[0];
  created.techRows.push(techRow.id);
  // Partner-Entitlement projektmanagement (sonst blockt resolveAccess den Partner).
  try { await rest('POST', 'gs_partner_entitlements?on_conflict=partner_user_id,feature_key', { partner_user_id: partAuth, feature_key: 'projektmanagement', enabled: true }, 'resolution=merge-duplicates'); created.entl.push([partAuth, 'projektmanagement']); }
  catch (e) { console.log('  (Entitlement-Insert:', e.message.slice(0, 80), '— fail-open greift ggf.)'); }
  const projA = (await rest('POST', 'gs_projekte', { name: 'ZZVERIFY ProjA', partner_user_id: partAuth, status: 'aktiv' }, 'return=representation'))[0];
  const projB = (await rest('POST', 'gs_projekte', { name: 'ZZVERIFY ProjB', partner_user_id: null, status: 'aktiv' }, 'return=representation'))[0];
  created.projekte.push(projA.id, projB.id);
  // Techniker NUR ProjA zuweisen (ProjB bleibt fremd).
  await rest('POST', 'gs_projekt_techniker', { projekt_id: projA.id, techniker_id: techRow.id, taetigkeit: 'Monteur' });
  console.log(`  techAuth=${techAuth.slice(0, 8)} techRow=${techRow.id.slice(0, 8)} projA=${projA.id.slice(0, 8)} projB=${projB.id.slice(0, 8)}`);

  const techTok = await signIn(techEmail);
  const partTok = await signIn(partEmail);
  console.log('  ✓ Echte JWTs erzeugt (Techniker + Partner)');

  // ── ENFORCEMENT-KETTE ──
  console.log('\n── Enforcement-Kette (Techniker) ──');
  const tp = await call(techTok, 'tech_projekte');
  const ids = (tp.json?.projekte || []).map((p) => p.id);
  check('tech_projekte listet zugewiesenes ProjA', ids.includes(projA.id), ids);
  check('tech_projekte listet Fremd-ProjB NICHT', !ids.includes(projB.id), ids);
  check('tech_projekt(ProjA) → ok', isOk(await call(techTok, 'tech_projekt', { id: projA.id })));
  check('tech_projekt(ProjB, fremd) → 403', is403(await call(techTok, 'tech_projekt', { id: projB.id })));
  const tpA = await call(techTok, 'tech_projekt', { id: projA.id });
  check('techSafeProjekt liefert KEIN stundensatz/kosten', tpA.json?.projekt && !('stundensatz' in tpA.json.projekt) && !('kosten' in tpA.json.projekt));

  // ── FEATURE B: Medien (Foto + Video) ──
  console.log('\n── Feature B: Medien-Upload ──');
  const fotoR = await call(techTok, 'medien_upload', { projekt_id: projA.id, data: B64, filename: 'zz.jpg', contentType: 'image/jpeg', stockwerk: 'EG', raum: 'Bad', bauabschnitt: 'Rohinstallation' });
  check('Foto-Upload (ProjA, Stockwerk EG) → ok', isOk(fotoR), fotoR.json);
  if (fotoR.json?.medien) { check('  medientyp = foto', fotoR.json.medien.medientyp === 'foto'); check('  signierte url vorhanden', !!fotoR.json.medien.url); if (fotoR.json.medien.path) created.storage.push(fotoR.json.medien.path); }
  const vidR = await call(techTok, 'medien_upload', { service_auftrag_id: null, projekt_id: projA.id, data: B64, filename: 'zz.mp4', contentType: 'video/mp4', medientyp: 'video', dauer_sekunden: 12, thumbnail: B64, stockwerk: '1.OG' });
  check('Video-Upload (ProjA, Stockwerk 1.OG) → ok', isOk(vidR), vidR.json);
  if (vidR.json?.medien) {
    check('  medientyp = video', vidR.json.medien.medientyp === 'video');
    check('  dauer_sekunden = 12', vidR.json.medien.dauer_sekunden === 12);
    check('  thumbnail_url (Vorschau) vorhanden', !!vidR.json.medien.thumbnail_url);
    if (vidR.json.medien.path) created.storage.push(vidR.json.medien.path);
    if (vidR.json.medien.thumbnail_path) created.storage.push(vidR.json.medien.thumbnail_path);
  }
  const noSw = await call(techTok, 'medien_upload', { projekt_id: projA.id, data: B64, filename: 'x.jpg' });
  check('Foto-Upload OHNE Stockwerk (Projekt) → Fehler', noSw.json?.error?.includes('Stockwerk'), noSw.json);
  check('Medien-Upload Fremd-ProjB → 403', is403(await call(techTok, 'medien_upload', { projekt_id: projB.id, data: B64, filename: 'x.jpg', stockwerk: 'EG' })));
  check('Partner-Upload (read-only) → 403', is403(await call(partTok, 'medien_upload', { projekt_id: projA.id, data: B64, filename: 'x.jpg', stockwerk: 'EG' })));

  console.log('\n── Feature B: Galerie-Gruppierung nach Stockwerk ──');
  const gal = await call(techTok, 'medien_list', { projekt_id: projA.id });
  const floors = (gal.json?.gruppen || []).map((g) => g.stockwerk);
  check('Galerie gruppiert → EG + 1.OG vorhanden', floors.includes('EG') && floors.includes('1.OG'), floors);
  check('Partner liest eigene Galerie (ProjA) → ok', isOk(await call(partTok, 'medien_list', { projekt_id: projA.id })));
  check('Partner liest Fremd-Galerie (ProjB) → 403', is403(await call(partTok, 'medien_list', { projekt_id: projB.id })));

  // ── FEATURE C: Service-Auftrag-Flow ──
  console.log('\n── Feature C: Service-Auftrag-Flow ──');
  const svcC = await call(partTok, 'svc_create', { objekt: 'ZZVERIFY Objekt', beschreibung: 'Heizung tropft', quelle: 'sprache' });
  check('Partner erstellt Service-Auftrag → ok', isOk(svcC), svcC.json);
  const svcId = svcC.json?.auftrag?.id;
  if (svcId) created.service.push(svcId);
  check('  quelle = sprache gespeichert', svcC.json?.auftrag?.quelle === 'sprache');
  check('  status = neu', svcC.json?.auftrag?.status === 'neu');
  check('Techniker erstellt Auftrag → 403', is403(await call(techTok, 'svc_create', { objekt: 'x' })));

  // Master-Aktionen simulieren wir per Service-Key (MASTER_UID-JWT haben wir nicht):
  // Techniker zuweisen + Status auf 'angenommen' (= Master hat angenommen).
  if (svcId) {
    await rest('POST', 'gs_service_techniker', { service_auftrag_id: svcId, techniker_id: techRow.id });
    await rest('PATCH', `gs_service_auftrag?id=eq.${svcId}`, { status: 'angenommen' });
    const sl = await call(techTok, 'svc_liste');
    check('Techniker sieht zugewiesenen Auftrag in svc_liste', (sl.json?.auftraege || []).some((a) => a.id === svcId));
    check('Techniker svc_detail (zugewiesen) → ok', isOk(await call(techTok, 'svc_detail', { id: svcId })));
    check('Partner svc_status → 403 (keine Statusrechte)', is403(await call(partTok, 'svc_status', { id: svcId, status: 'erledigt' })));
    const done = await call(techTok, 'svc_status', { id: svcId, status: 'erledigt' });
    check('Techniker angenommen→erledigt → ok', isOk(done), done.json);
    check('  erledigt_am gesetzt', !!done.json?.auftrag?.erledigt_am);
    // Zweiter, NICHT zugewiesener Auftrag → Fremdzugriff.
    const svcB = (await rest('POST', 'gs_service_auftrag', { objekt: 'ZZVERIFY Fremd', partner_user_id: null, status: 'neu' }, 'return=representation'))[0];
    created.service.push(svcB.id);
    check('Techniker svc_detail (fremd) → 403', is403(await call(techTok, 'svc_detail', { id: svcB.id })));
    check('Techniker Medien-Upload auf fremden Service → 403', is403(await call(techTok, 'medien_upload', { service_auftrag_id: svcB.id, data: B64, filename: 'x.jpg' })));
  }
} catch (e) {
  console.error('\n💥 Setup/Run-Fehler:', e.message);
  fail++;
} finally {
  // ── CLEANUP (immer) ──
  console.log('\n── Cleanup (alle Testreste entfernen) ──');
  for (const p of created.storage) await delStorage(p);
  for (const s of created.service) await rest('DELETE', `gs_service_auftrag?id=eq.${s}`, null, 'return=minimal').catch(() => {});
  for (const p of created.projekte) await rest('DELETE', `gs_projekte?id=eq.${p}`, null, 'return=minimal').catch(() => {});
  for (const t of created.techRows) await rest('DELETE', `gs_techniker?id=eq.${t}`, null, 'return=minimal').catch(() => {});
  for (const [pid, fk] of created.entl) await rest('DELETE', `gs_partner_entitlements?partner_user_id=eq.${pid}&feature_key=eq.${fk}`, null, 'return=minimal').catch(() => {});
  for (const u of created.users) await fetch(`${URL}/auth/v1/admin/users/${u}`, { method: 'DELETE', headers: SB }).catch(() => {});
  console.log('  ✓ Cleanup fertig');
  console.log(`\n${fail ? '❌' : '✅'} Ergebnis: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}
