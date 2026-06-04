// scripts/test_dashboard.mjs
// Automated tests for /api/dashboard (gs_admin master overview).
//   node scripts/test_dashboard.mjs [baseUrl]
//
// Tests all role paths: no token (401), techniker (403), gs_admin (200).
// To get an admin token without Emanuel's password, it temporarily elevates
// the techniker test account to gs_admin, then reverts in a finally block.

import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'https://baby-bob.vercel.app';

let SUPABASE_URL, SUPABASE_KEY;
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m?.[1] === 'SUPABASE_URL') SUPABASE_URL = m[2].trim();
  if (m?.[1] === 'SUPABASE_KEY') SUPABASE_KEY = m[2].trim();
}
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const TEST = { email: 'techniker.test@georgesolutions.ch', password: 'TestTech2026!' };
const TEST_UID = '730172f2-c8a9-4cc4-90f7-98a96d283b48';

let pass = 0, fail = 0;
const ok = (n) => { console.log(`  ✓ ${n}`); pass++; };
const no = (n, d) => { console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); fail++; };

async function login() {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: SB, body: JSON.stringify(TEST),
  });
  const d = await r.json();
  return d.access_token;
}
async function setRole(role) {
  await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${TEST_UID}`, {
    method: 'PATCH', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify({ role }),
  });
}
async function dash(token) {
  const r = await fetch(`${BASE}/api/dashboard`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  let body; try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body };
}
async function count(table) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, { headers: { ...SB, Prefer: 'count=exact' } });
  return Number((r.headers.get('content-range') || '0/0').split('/')[1]) || 0;
}

console.log(`Testing /api/dashboard @ ${BASE}\n`);

try {
  // 1. No token → 401
  const anon = await dash(null);
  anon.status === 401 ? ok('no token → 401') : no('no token → 401', 'got ' + anon.status);

  // 2. Garbage token → 401
  const bad = await dash('garbage.token.value');
  bad.status === 401 ? ok('invalid token → 401') : no('invalid token → 401', 'got ' + bad.status);

  // 3. techniker role → 403
  await setRole('techniker');
  const techTok = await login();
  techTok ? ok('techniker login ok') : no('techniker login ok');
  const asTech = await dash(techTok);
  asTech.status === 403 ? ok('techniker → 403') : no('techniker → 403', 'got ' + asTech.status);

  // 4. gs_admin role → 200 (elevate the same test account)
  await setRole('gs_admin');
  const adminTok = await login();
  const asAdmin = await dash(adminTok);
  asAdmin.status === 200 ? ok('gs_admin → 200') : no('gs_admin → 200', 'got ' + asAdmin.status);

  const d = asAdmin.body || {};
  // 5. Structure
  ['S1', 'S2', 'S3', 'S4'].forEach((s) => (d.sources?.[s] ? ok(`source ${s} present`) : no(`source ${s} present`)));
  Array.isArray(d.leads) ? ok('flat leads array present') : no('flat leads array present');
  d.totals?.by_status && typeof d.totals.all === 'number' ? ok('totals present') : no('totals present');

  // 6. Counts match Supabase directly
  const [c1, c2] = [await count('anfragen'), await count('gs_anfragen')];
  d.sources?.S1?.count === c1 ? ok(`S1 count matches DB (${c1})`) : no('S1 count matches DB', `${d.sources?.S1?.count} vs ${c1}`);
  d.sources?.S2?.count === c2 ? ok(`S2 count matches DB (${c2})`) : no('S2 count matches DB', `${d.sources?.S2?.count} vs ${c2}`);
  d.totals?.all === c1 + c2 ? ok(`total = S1+S2 (${c1 + c2})`) : no('total = S1+S2', `${d.totals?.all}`);

  // 7. Each lead has required fields
  const lead = d.leads?.[0];
  if (lead) {
    ['id', 'source', 'date', 'status', 'title'].forEach((k) => (k in lead ? ok(`lead.${k} present`) : no(`lead.${k} present`)));
  } else no('at least one lead present');

  // 8. Sorted by date desc
  const dates = (d.leads || []).map((l) => new Date(l.date || 0).getTime());
  dates.every((v, i) => i === 0 || dates[i - 1] >= v) ? ok('leads sorted by date desc') : no('leads sorted by date desc');
} finally {
  // Always revert the test account back to techniker.
  await setRole('techniker');
  console.log('\n  (reverted test account → techniker)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
