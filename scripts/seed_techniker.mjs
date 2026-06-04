// scripts/seed_techniker.mjs
// Seeds a test Techniker auth account + role, and 3 demo technicians.
// Idempotent: safe to run repeatedly. Reads SUPABASE_URL / SUPABASE_KEY
// from .env.local (or the process env).
//
//   node scripts/seed_techniker.mjs
//
// Profile fields not yet present as real columns (specialization, rating,
// years_experience, photo) are stored as a JSON sidecar in `notizen`.
// api/techniker.js reads them transparently. After running
// scripts/techniker_profile_migration.sql they migrate into real columns.

import { readFileSync } from 'node:fs';

// ── env ──
let { SUPABASE_URL, SUPABASE_KEY } = process.env;
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (m[1] === 'SUPABASE_URL' && !SUPABASE_URL) SUPABASE_URL = m[2].trim();
    if (m[1] === 'SUPABASE_KEY' && !SUPABASE_KEY) SUPABASE_KEY = m[2].trim();
  }
} catch {}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_KEY');
  process.exit(1);
}

const H = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const TEST_TECH = {
  email: 'techniker.test@georgesolutions.ch',
  password: 'TestTech2026!',
};

const DEMO = [
  {
    name: 'Marco Schneider',
    verfuegbar: true,
    email: TEST_TECH.email, // linked to the test auth account (by email)
    telefon: '+41 79 100 10 10',
    sidecar: { photo_emoji: '👨‍🔧', qualification: 'Eidg. dipl. Heizungsmeister', specialization: ['Heizung', 'Sanitär'], rating: 4.9, years_experience: 14, location: 'Zürich' },
  },
  {
    name: 'Luca Bianchi',
    verfuegbar: true,
    email: 'luca.bianchi@demo.georgesolutions.ch',
    telefon: '+41 79 200 20 20',
    sidecar: { photo_emoji: '🔧', qualification: 'Sanitärinstallateur EFZ', specialization: ['Sanitär', 'Klima'], rating: 4.7, years_experience: 9, location: 'Winterthur' },
  },
  {
    name: 'Andreas Keller',
    verfuegbar: true,
    email: 'andreas.keller@demo.georgesolutions.ch',
    telefon: '+41 79 300 30 30',
    sidecar: { photo_emoji: '❄️', qualification: 'Lüftungsanlagenbauer · SWKI-zertifiziert', specialization: ['Lüftung', 'Klima'], rating: 4.8, years_experience: 11, location: 'Zug' },
  },
];

async function j(r) { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }

// ── 1. Test techniker auth account ──
async function ensureTestUser() {
  let res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ email: TEST_TECH.email, password: TEST_TECH.password, email_confirm: true }),
  });
  let body = await j(res);
  if (res.ok && body.id) {
    console.log(`✓ Created auth user ${TEST_TECH.email} → ${body.id}`);
    return body.id;
  }
  // Already exists → look it up.
  const list = await j(await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?per_page=200`,
    { headers: H }
  ));
  const users = Array.isArray(list) ? list : list.users || [];
  const found = users.find((u) => (u.email || '').toLowerCase() === TEST_TECH.email);
  if (found) {
    console.log(`✓ Auth user already exists ${TEST_TECH.email} → ${found.id}`);
    return found.id;
  }
  console.error('✗ Could not create or find test user:', body);
  return null;
}

// ── 2. Role = techniker ──
async function ensureRole(userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_roles?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ user_id: userId, role: 'techniker' }),
  });
  const body = await j(res);
  if (res.ok) { console.log(`✓ Role techniker assigned to ${userId}`); return true; }
  console.error('✗ Role assignment failed:', res.status, body);
  return false;
}

// ── 3. Demo technicians (idempotent) ──
async function seedTechniker() {
  for (const d of DEMO) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/gs_techniker?name=eq.${encodeURIComponent(d.name)}`,
      { method: 'DELETE', headers: H }
    );
  }
  const payload = DEMO.map((d) => ({
    name: d.name,
    verfuegbar: d.verfuegbar,
    email: d.email,
    telefon: d.telefon,
    notizen: JSON.stringify(d.sidecar),
  }));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker`, {
    method: 'POST',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  const body = await j(res);
  if (res.ok) {
    console.log(`✓ Inserted ${body.length} demo technicians:`);
    for (const t of body) console.log(`   • ${t.name} (${t.id})`);
    return true;
  }
  console.error('✗ Demo insert failed:', res.status, body);
  return false;
}

const userId = await ensureTestUser();
if (userId) await ensureRole(userId);
await seedTechniker();
console.log('\nDone.');
