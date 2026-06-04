// scripts/test_onboarding.mjs
// End-to-end tests for the onboarding flow (api/admin, api/account, api/auth).
//   node scripts/test_onboarding.mjs [baseUrl]
//
// Acts as gs_admin by temporarily elevating the techniker test account, creates
// throwaway partner + techniker users, drives the full lifecycle, asserts edge
// cases, then deletes the throwaways and reverts the test account.

import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'https://baby-bob.vercel.app';
let SUPABASE_URL, SUPABASE_KEY;
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m?.[1] === 'SUPABASE_URL') SUPABASE_URL = m[2].trim();
  if (m?.[1] === 'SUPABASE_KEY') SUPABASE_KEY = m[2].trim();
}
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const ADMIN = { email: 'techniker.test@georgesolutions.ch', password: 'TestTech2026!' };
const ADMIN_UID = '730172f2-c8a9-4cc4-90f7-98a96d283b48';
const stamp = Date.now();
const partnerEmail = `t.partner.${stamp}@demo.georgesolutions.ch`;
const techEmail = `t.tech.${stamp}@demo.georgesolutions.ch`;

let pass = 0, fail = 0;
const ok = (n) => { console.log(`  ✓ ${n}`); pass++; };
const no = (n, d) => { console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); fail++; };
const eq = (n, a, b) => (a === b ? ok(n) : no(n, `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`));

const login = async (email, password) =>
  (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: SB, body: JSON.stringify({ email, password }) })).json();
const authApi = async (action, body) =>
  fetch(`${BASE}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) }).then((r) => r.json());
const adminApi = async (token, body) => {
  const r = await fetch(`${BASE}/api/admin`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const accountApi = async (token, body) => {
  const r = await fetch(`${BASE}/api/account`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const setRole = (role) => fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${ADMIN_UID}`, { method: 'PATCH', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify({ role }) });
async function deleteUserByEmail(email) {
  const list = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: SB })).json();
  const users = Array.isArray(list) ? list : list.users || [];
  const u = users.find((x) => (x.email || '').toLowerCase() === email.toLowerCase());
  if (u) {
    await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${u.id}`, { method: 'DELETE', headers: SB });
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: SB });
  }
}

console.log(`Onboarding E2E @ ${BASE}\n`);
let partnerId, techId;

try {
  await deleteUserByEmail(partnerEmail);
  await deleteUserByEmail(techEmail);
  await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?email=eq.${encodeURIComponent(techEmail)}`, { method: 'DELETE', headers: SB });

  // ── Admin auth ──
  await setRole('gs_admin');
  const adminTok = (await login(ADMIN.email, ADMIN.password)).access_token;
  adminTok ? ok('admin login') : no('admin login');

  // ── Guards ──
  eq('admin: no token → 401', (await adminApi('', { action: 'list_users' })).status, 401);

  console.log('\n— gs_partner lifecycle —');
  // 1. create
  let r = await adminApi(adminTok, { action: 'create_user', name: 'Test Partner', email: partnerEmail, firma: 'Test AG', role: 'gs_partner' });
  eq('create partner → 200', r.status, 200);
  const partnerTemp = r.body?.temp_password;
  partnerId = r.body?.user?.id;
  partnerTemp?.length === 8 ? ok('temp password is 8 chars') : no('temp password is 8 chars', partnerTemp);

  // 2. edge: duplicate email
  eq('duplicate email → 409', (await adminApi(adminTok, { action: 'create_user', name: 'Dup', email: partnerEmail, role: 'gs_partner' })).status, 409);
  // 3. edge: bad role / bad email
  eq('invalid role → 400', (await adminApi(adminTok, { action: 'create_user', name: 'X', email: `x.${stamp}@demo.gs.ch`, role: 'gs_admin' })).status, 400);
  eq('invalid email → 400', (await adminApi(adminTok, { action: 'create_user', name: 'X', email: 'notanemail', role: 'techniker' })).status, 400);

  // 4. first login with temp password
  const pLogin = await authApi('login', { email: partnerEmail, password: partnerTemp });
  eq('partner first login must_change_password', pLogin.must_change_password, true);
  eq('partner first login profile_complete=false', pLogin.profile_complete, false);
  eq('partner role', pLogin.role, 'gs_partner');
  const pTok1 = pLogin.access_token;

  // 5. non-admin guard: partner token on admin endpoint → 403
  eq('partner on admin endpoint → 403', (await adminApi(pTok1, { action: 'list_users' })).status, 403);

  // 6. weak password rejected
  eq('weak password → 400', (await accountApi(pTok1, { action: 'change_password', new_password: 'short' })).status, 400);
  // 7. change password (valid)
  eq('change password → 200', (await accountApi(pTok1, { action: 'change_password', new_password: 'NewPartnerPw1' })).status, 200);
  // 8. old temp no longer works
  (await login(partnerEmail, partnerTemp)).access_token ? no('old temp password rejected') : ok('old temp password rejected');
  // 9. new password works, flag cleared
  const pLogin2 = await login(partnerEmail, 'NewPartnerPw1');
  const pTok2 = pLogin2.access_token;
  const pMe = (await accountApi(pTok2, { action: 'me' })).body;
  eq('after change must_change_password=false', pMe.must_change_password, false);

  // 10. profile: missing fields rejected
  eq('partner profile missing → 400', (await accountApi(pTok2, { action: 'complete_profile', profile: { vorname: 'A' } })).status, 400);
  eq('partner profile bad position → 400', (await accountApi(pTok2, { action: 'complete_profile', profile: { vorname: 'A', nachname: 'B', telefon: '079', firma: 'F', position: 'King' } })).status, 400);
  // 11. profile complete
  eq('partner profile complete → 200', (await accountApi(pTok2, { action: 'complete_profile', profile: { vorname: 'Anna', nachname: 'Muster', telefon: '0791112233', firma: 'Test AG', position: 'Projektleiter' } })).status, 200);
  const pMe2 = (await accountApi(pTok2, { action: 'me' })).body;
  eq('partner profile_complete=true', pMe2.profile_complete, true);
  eq('partner position saved', pMe2.profile.position, 'Projektleiter');

  console.log('\n— techniker lifecycle —');
  // Pre-seed a gs_techniker row to verify profile sync.
  await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker`, { method: 'POST', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify({ name: 'Temp', email: techEmail, verfuegbar: true }) });

  r = await adminApi(adminTok, { action: 'create_user', name: 'Test Tech', email: techEmail, firma: null, role: 'techniker' });
  eq('create techniker → 200', r.status, 200);
  const techTemp = r.body?.temp_password;
  techId = r.body?.user?.id;
  const tLogin = await authApi('login', { email: techEmail, password: techTemp });
  eq('techniker first login must_change', tLogin.must_change_password, true);
  eq('techniker role', tLogin.role, 'techniker');
  const tTok1 = tLogin.access_token;
  eq('techniker change password → 200', (await accountApi(tTok1, { action: 'change_password', new_password: 'NewTechPw1234' })).status, 200);
  const tTok2 = (await login(techEmail, 'NewTechPw1234')).access_token;
  // techniker profile edge: bad qualifikation / empty spez
  eq('tech bad qualifikation → 400', (await accountApi(tTok2, { action: 'complete_profile', profile: { vorname: 'T', nachname: 'K', telefon: '079', qualifikation: 'Wizard', spezialisierung: ['Heizung'] } })).status, 400);
  eq('tech empty spezialisierung → 400', (await accountApi(tTok2, { action: 'complete_profile', profile: { vorname: 'T', nachname: 'K', telefon: '079', qualifikation: 'Meister', spezialisierung: [] } })).status, 400);
  eq('tech profile complete → 200', (await accountApi(tTok2, { action: 'complete_profile', profile: { vorname: 'Tobias', nachname: 'Kern', telefon: '0794445566', qualifikation: 'Meister', spezialisierung: ['Heizung', 'Sanitär'] } })).status, 200);
  // sync into gs_techniker
  const synced = await (await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?email=eq.${encodeURIComponent(techEmail)}&select=name,notizen`, { headers: SB })).json();
  synced?.[0]?.name === 'Tobias Kern' ? ok('gs_techniker synced (name)') : no('gs_techniker synced (name)', JSON.stringify(synced?.[0]));
  (synced?.[0]?.notizen || '').includes('Heizung') ? ok('gs_techniker synced (specialization)') : no('gs_techniker synced (specialization)');

  console.log('\n— admin reset / deactivate / list —');
  // reset password
  r = await adminApi(adminTok, { action: 'reset_password', user_id: partnerId });
  const reTemp = r.body?.temp_password;
  reTemp?.length === 8 ? ok('reset returns new temp') : no('reset returns new temp');
  const pLogin3 = await authApi('login', { email: partnerEmail, password: reTemp });
  eq('after reset must_change_password=true', pLogin3.must_change_password, true);
  // deactivate
  eq('deactivate → 200', (await adminApi(adminTok, { action: 'set_active', user_id: partnerId, active: false })).status, 200);
  (await login(partnerEmail, reTemp)).access_token ? no('deactivated user cannot log in') : ok('deactivated user cannot log in');
  // reactivate
  eq('reactivate → 200', (await adminApi(adminTok, { action: 'set_active', user_id: partnerId, active: true })).status, 200);
  (await login(partnerEmail, reTemp)).access_token ? ok('reactivated user can log in') : no('reactivated user can log in');
  // list_users
  const list = (await adminApi(adminTok, { action: 'list_users' })).body;
  const pRow = list?.users?.find((u) => u.email === partnerEmail);
  const tRow = list?.users?.find((u) => u.email === techEmail);
  pRow ? ok('list includes partner') : no('list includes partner');
  eq('list partner role', pRow?.role, 'gs_partner');
  eq('list partner firma', pRow?.firma, 'Test AG');
  eq('list techniker status active', tRow?.status, 'active');
} catch (e) {
  no('unexpected exception', e.message);
} finally {
  await deleteUserByEmail(partnerEmail);
  await deleteUserByEmail(techEmail);
  await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?email=eq.${encodeURIComponent(techEmail)}`, { method: 'DELETE', headers: SB });
  await setRole('techniker');
  console.log('\n  (cleaned up test users + reverted admin account → techniker)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
