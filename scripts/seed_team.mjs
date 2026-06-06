// scripts/seed_team.mjs — Task 8: pre-create the 4 real techniker accounts.
// Creates auth users (temp passwords), assigns techniker role, links the
// existing gs_techniker profile rows by email + user_id. Idempotent.
//   node scripts/seed_team.mjs
import { readFileSync } from 'node:fs';
let { SUPABASE_URL, SUPABASE_KEY } = process.env;
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m?.[1] === 'SUPABASE_URL' && !SUPABASE_URL) SUPABASE_URL = m[2].trim();
    if (m?.[1] === 'SUPABASE_KEY' && !SUPABASE_KEY) SUPABASE_KEY = m[2].trim();
  }
} catch {}
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

// Dimitri = the existing test login; the others get fresh accounts.
const TEAM = [
  { name: 'Patrick Notter', email: 'patrick.notter@georgesolutions.ch', tarif: 41.5 },
  { name: 'Vasil Ignatov', email: 'vasil.ignatov@georgesolutions.ch', tarif: 40.0 },
  { name: 'Dimitri Grill', email: 'techniker.test@georgesolutions.ch', tarif: 38.0 },
  { name: 'Emanuel George', email: 'emanuel.george@georgesolutions.ch', tarif: 43.76 },
];
function tempPw() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz', d = '23456789', all = a + d;
  let s = a[Math.floor(Math.random() * a.length)] + d[Math.floor(Math.random() * d.length)];
  for (let i = 0; i < 6; i++) s += all[Math.floor(Math.random() * all.length)];
  return s.split('').sort(() => Math.random() - 0.5).join('');
}
async function j(r) { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function findUser(email) {
  const list = await j(await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: H }));
  const users = Array.isArray(list) ? list : list.users || [];
  return users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
}

for (const t of TEAM) {
  let uid, tmp = null;
  let existing = await findUser(t.email);
  if (existing) { uid = existing.id; console.log(`• ${t.name}: account exists (${uid})`); }
  else {
    tmp = tempPw();
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email: t.email, password: tmp, email_confirm: true, user_metadata: { name: t.name, tarif: t.tarif, must_change_password: true, profile_complete: false } }) });
    const b = await j(res); uid = b.id;
    console.log(uid ? `✓ ${t.name}: created (${uid}) — temp PW: ${tmp}` : `✗ ${t.name}: ${JSON.stringify(b)}`);
  }
  if (!uid) continue;
  // techniker role
  await fetch(`${SUPABASE_URL}/rest/v1/user_roles?on_conflict=user_id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: uid, role: 'techniker' }) });
  // link gs_techniker row by name → set email + user_id (so it's assignable)
  await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?name=eq.${encodeURIComponent(t.name)}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ email: t.email, user_id: uid }) });
}
console.log('\nDone. (Temp passwords shown above for newly created accounts — send via WhatsApp/Email.)');
