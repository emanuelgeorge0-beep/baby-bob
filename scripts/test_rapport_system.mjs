// scripts/test_rapport_system.mjs
// Comprehensive E2E for projekte + tagesrapport + rechnung + PDF.
//   node scripts/test_rapport_system.mjs [baseUrl] [targetAssertions]
//
// Uses the single techniker test account; flips its user_roles row between
// gs_admin / techniker / gs_partner (the API reads role live per call) to
// exercise every role path. Reverts to techniker in finally. Loops the full
// lifecycle until >= target assertions (default 500), cleaning up each cycle.

import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'https://baby-bob.vercel.app';
const TARGET = Number(process.argv[3] || 500);

let SUPABASE_URL, SUPABASE_KEY;
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m?.[1] === 'SUPABASE_URL') SUPABASE_URL = m[2].trim();
  if (m?.[1] === 'SUPABASE_KEY') SUPABASE_KEY = m[2].trim();
}
const SBH = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const ACC = { email: 'techniker.test@georgesolutions.ch', password: 'TestTech2026!' };
const UID = '730172f2-c8a9-4cc4-90f7-98a96d283b48';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let pass = 0, fail = 0; const fails = [];
const ok = (n) => { pass++; };
const no = (n, d) => { fail++; fails.push(n + (d ? ' — ' + d : '')); };
const is = (n, c, d) => (c ? ok(n) : no(n, d));

let TOKEN;
const login = async () => (await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: SBH, body: JSON.stringify(ACC) })).json()).access_token;
const setRole = (role) => fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${UID}`, { method: 'PATCH', headers: { ...SBH, Prefer: 'return=minimal' }, body: JSON.stringify({ role }) });
async function call(ep, body, token = TOKEN) {
  const r = await fetch(`${BASE}/api/${ep}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const delRow = (t, q) => fetch(`${SUPABASE_URL}/rest/v1/${t}?${q}`, { method: 'DELETE', headers: SBH });
const delObj = (bucket, path) => fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, { method: 'DELETE', headers: SBH }).catch(() => {});

const TIMES = [['08:00', '16:30', 8.5], ['07:00', '12:00', 5], ['09:15', '17:45', 8.5], ['06:30', '15:00', 8.5], ['10:00', '14:15', 4.25], ['13:00', '18:30', 5.5], ['07:30', '16:00', 8.5]];

async function guards() {
  // no-token → 401
  for (const ep of ['projekte', 'tagesrapport', 'rechnung']) is(`${ep} no-token 401`, (await call(ep, { action: 'list' }, null)).status === 401);
  // invalid action → 400 (authed as admin)
  await setRole('gs_admin');
  for (const ep of ['projekte', 'tagesrapport', 'rechnung']) is(`${ep} bad action 400`, (await call(ep, { action: 'zzz' })).status === 400);
  // input validation
  is('projekte create no name 400', (await call('projekte', { action: 'create' })).status === 400);
  is('projekte assign missing 400', (await call('projekte', { action: 'assign', projekt_id: 'x' })).status === 400);
  is('tagesrapport save no projekt 400', (await call('tagesrapport', { action: 'save', datum: '2026-06-04' })).status === 400);
  is('tagesrapport save no datum 400', (await call('tagesrapport', { action: 'save', projekt_id: '00000000-0000-0000-0000-000000000000' })).status === 400);
  is('rechnung set_status invalid 400', (await call('rechnung', { action: 'set_status', id: 'x', status: 'nope' })).status === 400);
  is('tagesrapport get missing 400', (await call('tagesrapport', { action: 'get' })).status === 400);
  is('tagesrapport get random 404', (await call('tagesrapport', { action: 'get', id: '00000000-0000-0000-0000-000000000000' })).status === 404);
  // role guards
  await setRole('techniker');
  is('techniker projekte create 403', (await call('projekte', { action: 'create', name: 'x' })).status === 403);
  is('techniker status_overview 403', (await call('tagesrapport', { action: 'status_overview' })).status === 403);
  await setRole('gs_partner');
  is('partner projekte list ok', (await call('projekte', { action: 'list' })).status === 200);
  is('partner projekte create 403', (await call('projekte', { action: 'create', name: 'x' })).status === 403);
  is('partner rechnung list ok', (await call('rechnung', { action: 'list' })).status === 200);
}

async function cycle(i) {
  const pnr = `T-${Date.now()}-${i}`;
  // Weekdays only (Mon–Fri) so they appear in the Mon–Fri week view.
  const base = new Date(Date.UTC(2026, 5, 1)); // Mon 2026-06-01
  base.setUTCDate(base.getUTCDate() + Math.floor(i / 5) * 7 + (i % 5));
  const datum = base.toISOString().slice(0, 10);
  const [von, bis, expH] = TIMES[i % TIMES.length];
  const withMedia = i % 4 === 0;
  let projektId, rapportId, invoiceId;
  try {
    // ── admin: create + assign ──
    await setRole('gs_admin');
    const c = await call('projekte', { action: 'create', name: 'Cycle ' + i, projektnummer: pnr, standort: 'Zürich', bereich: 'Heizung', tarif: 'Monthly', stundensatz: 67.9 });
    is('create 200', c.status === 200, JSON.stringify(c.body));
    projektId = c.body?.projekt?.id;
    is('create has id', !!projektId);
    is('create projektnummer', c.body?.projekt?.projektnummer === pnr);
    const techs = await call('projekte', { action: 'technicians' });
    is('technicians list', Array.isArray(techs.body?.technicians) && techs.body.technicians.some((t) => t.user_id === UID));
    is('assign 200', (await call('projekte', { action: 'assign', projekt_id: projektId, techniker_user_ids: [UID] })).status === 200);
    const g = await call('projekte', { action: 'get', id: projektId });
    is('get shows assignment', g.body?.projekt?.techniker?.some((t) => t.user_id === UID), JSON.stringify(g.body?.projekt?.techniker));
    is('update status', (await call('projekte', { action: 'update', id: projektId, status: 'aktiv' })).status === 200);

    // ── techniker: capture + submit ──
    await setRole('techniker');
    const t0 = await call('tagesrapport', { action: 'today', projekt_id: projektId, datum });
    is('today 200', t0.status === 200);
    is('today suggestions array', Array.isArray(t0.body?.suggestions));
    const draft = await call('tagesrapport', { action: 'save', projekt_id: projektId, datum, zeit_von: von, zeit_bis: bis, arbeiten: ['Montage', 'Wartung'], material: ['Pumpe'], team: ['Luca'], besonderheiten: 'Test ä ö ü', status: 'entwurf' });
    is('draft 200', draft.status === 200, JSON.stringify(draft.body));
    is('draft status entwurf', draft.body?.rapport?.status === 'entwurf');
    is('draft hours computed', Math.abs((draft.body?.rapport?.gesamtstunden || 0) - expH) < 0.2 || expH < 0.01);
    const t1 = await call('tagesrapport', { action: 'today', projekt_id: projektId, datum });
    is('today now has rapport', !!t1.body?.rapport);

    const subBody = { action: 'save', projekt_id: projektId, datum, zeit_von: von, zeit_bis: bis, arbeiten: ['Montage'], material: ['Pumpe'], status: 'eingereicht', empfaenger: ['emanuel@gs.ch'] };
    if (withMedia) { subBody.fotos = [PNG, PNG]; subBody.unterschrift = PNG; }
    const sub = await call('tagesrapport', subBody);
    is('submit 200', sub.status === 200, JSON.stringify(sub.body));
    rapportId = sub.body?.rapport?.id;
    is('submit status eingereicht', sub.body?.rapport?.status === 'eingereicht');
    is('submit pdf_url set', !!sub.body?.rapport?.pdf_url);
    if (withMedia) is('photos uploaded', (sub.body?.rapport?.foto_urls || []).length === 2, JSON.stringify(sub.body?.rapport?.foto_urls));
    // betrag must equal (server-rounded hours) × stundensatz
    const srvHours = sub.body?.rapport?.gesamtstunden;
    const expBetrag = Math.round(srvHours * 67.9 * 100) / 100;
    invoiceId = sub.body?.invoice?.id;
    is('invoice created', !!invoiceId);
    is('invoice betrag correct', Math.abs((sub.body?.invoice?.betrag || 0) - expBetrag) < 0.05, `${sub.body?.invoice?.betrag} vs ${expBetrag}`);
    const wk = await call('tagesrapport', { action: 'week', jahr: base.getUTCFullYear(), woche: weekOf(datum) });
    is('week 200', wk.status === 200);
    is('week has eingereicht day', (wk.body?.days || []).some((d) => d.datum === datum && d.status === 'eingereicht'), JSON.stringify(wk.body?.days));
    const lst = await call('tagesrapport', { action: 'list', projekt_id: projektId });
    is('list includes rapport', (lst.body?.rapporte || []).some((r) => r.id === rapportId));
    const got = await call('tagesrapport', { action: 'get', id: rapportId });
    is('get rapport pdf signed', !!got.body?.rapport?.pdf_signed);
    if (got.body?.rapport?.pdf_signed) {
      const pdf = await fetch(got.body.rapport.pdf_signed);
      const head = (await pdf.text()).slice(0, 5);
      is('rapport pdf valid %PDF', head === '%PDF-', head);
    }
    if (withMedia) is('signature signed url', !!got.body?.rapport?.unterschrift_signed);

    // ── admin verify invoice + overview ──
    await setRole('gs_admin');
    // Retry once for read-after-write consistency.
    let inList = false;
    for (let a = 0; a < 2 && !inList; a++) {
      const il = await call('rechnung', { action: 'list', projekt_id: projektId });
      inList = (il.body?.rechnungen || []).some((r) => r.id === invoiceId);
      if (!inList) await new Promise((r) => setTimeout(r, 700));
    }
    if (expH > 0.01) is('invoice in list', inList);
    if (invoiceId) {
      const ig = await call('rechnung', { action: 'get', id: invoiceId });
      is('invoice pdf signed', !!ig.body?.rechnung?.pdf_signed);
      if (ig.body?.rechnung?.pdf_signed) {
        const pdf = await fetch(ig.body.rechnung.pdf_signed);
        is('invoice pdf valid %PDF', (await pdf.text()).slice(0, 5) === '%PDF-');
      }
      is('invoice set_status', (await call('rechnung', { action: 'set_status', id: invoiceId, status: 'versendet' })).status === 200);
    }
    const so = await call('tagesrapport', { action: 'status_overview' });
    is('status_overview 200', so.status === 200);
    is('status_overview includes tech', (so.body?.techniker || []).some((t) => t.user_id === UID));

    // ── partner isolation ──
    await setRole('gs_partner');
    const pl = await call('projekte', { action: 'list' });
    is('partner sees no unowned project', !(pl.body?.projekte || []).some((p) => p.id === projektId));
  } finally {
    if (invoiceId) await delObj('rapport-pdfs', `${invoiceId}.pdf`);
    if (rapportId) { await delObj('rapport-pdfs', `${rapportId}.pdf`); await delObj('rapport-photos', `${rapportId}/foto-0.jpg`); await delObj('rapport-photos', `${rapportId}/foto-1.jpg`); await delObj('rapport-signatures', `${rapportId}/signature.png`); }
    if (projektId) {
      await delRow('gs_rechnungen', `projekt_id=eq.${projektId}`);
      await delRow('gs_tagesrapporte', `projekt_id=eq.${projektId}`);
      await delRow('gs_projekt_techniker', `projekt_id=eq.${projektId}`);
      await delRow('gs_projekte', `id=eq.${projektId}`);
    }
  }
}

function weekOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z'); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return Math.ceil((((d - ys) / 86400000) + 1) / 7);
}

console.log(`Rapport system E2E @ ${BASE} (target ${TARGET} assertions)\n`);
TOKEN = await login();
try {
  await guards();
  let i = 0;
  while (pass + fail < TARGET) { await cycle(i++); process.stdout.write(`\r  cycles: ${i}  assertions: ${pass + fail}  (✓${pass} ✗${fail})   `); }
  console.log('');
} catch (e) {
  no('FATAL', e.message + '\n' + e.stack);
} finally {
  await setRole('techniker');
}

console.log(`\n${pass} passed, ${fail} failed  (total ${pass + fail})`);
if (fails.length) { console.log('\nFailures:'); [...new Set(fails)].slice(0, 40).forEach((f) => console.log('  ✗ ' + f)); }
process.exit(fail ? 1 : 0);
