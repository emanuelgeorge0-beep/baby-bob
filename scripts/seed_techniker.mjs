// scripts/seed_techniker.mjs
// Seeds the test Techniker auth account + role, and the 12 network technicians
// (4 real/available + 8 strategic/booked). Idempotent.
//   node scripts/seed_techniker.mjs
//
// Rich fields live in the `notizen` JSON sidecar. One profile (the real team
// member backed by the test login) carries user_id + email so it is assignable
// and the rapport tests keep working.

import { readFileSync } from 'node:fs';

let { SUPABASE_URL, SUPABASE_KEY } = process.env;
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m?.[1] === 'SUPABASE_URL' && !SUPABASE_URL) SUPABASE_URL = m[2].trim();
    if (m?.[1] === 'SUPABASE_KEY' && !SUPABASE_KEY) SUPABASE_KEY = m[2].trim();
  }
} catch {}
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing SUPABASE_URL / SUPABASE_KEY'); process.exit(1); }

const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const TEST = { email: 'techniker.test@georgesolutions.ch', password: 'TestTech2026!' };
const TEST_UID = '730172f2-c8a9-4cc4-90f7-98a96d283b48';

// 4 available (real team) + 8 booked (strategic). booked_until = ISO.
const TEAM = [
  { name: 'Emanuel George',     verfuegbar: true,  emoji: '👨‍💼', qual: 'Projektleiter', spez: ['Sanitär', 'Heizung'],            jahre: 15, ort: 'Zürich',        rating: 5.0 },
  { name: 'Patrick Notter',     verfuegbar: true,  emoji: '🔧',  qual: 'Sanitärinstallateur EFZ', spez: ['Sanitär', 'Lüftung'], jahre: 8,  ort: 'Zürich',        rating: 4.8 },
  { name: 'Vasil Ignatov',      verfuegbar: true,  emoji: '🔧',  qual: 'Sanitärinstallateur EFZ', spez: ['Sanitär', 'Klima'],   jahre: 7,  ort: 'Zürich',        rating: 4.8 },
  { name: 'Dimitri Grill',      verfuegbar: true,  emoji: '🔧',  qual: 'Monteur HKLS', spez: ['Heizung', 'Sanitär'],             jahre: 6,  ort: 'Zürich',        rating: 4.7, test: true },
  { name: 'Markus Weber',       verfuegbar: false, emoji: '🔥',  qual: 'Heizungsmeister eidg. dipl.', spez: ['Heizung', 'Sanitär'], jahre: 18, ort: 'Winterthur', rating: 4.9, booked_until: '2026-12-23' },
  { name: 'Thomas Brunner',     verfuegbar: false, emoji: '💨',  qual: 'Lüftungsanlagenbauer SWKI', spez: ['Lüftung', 'Klima'], jahre: 12, ort: 'Zug',          rating: 4.8, booked_until: '2026-11-30' },
  { name: 'Stefan Keller',      verfuegbar: false, emoji: '🔧',  qual: 'Sanitärinstallateur EFZ', spez: ['Sanitär'],            jahre: 9,  ort: 'Baden',         rating: 4.7, booked_until: '2027-06-01' },
  { name: 'René Müller',        verfuegbar: false, emoji: '🔥',  qual: 'Heizungsmonteur', spez: ['Heizung'],                    jahre: 11, ort: 'Schaffhausen',  rating: 4.6, booked_until: '2027-03-15' },
  { name: 'Daniel Huber',       verfuegbar: false, emoji: '❄️',  qual: 'Klimatechniker SWKI', spez: ['Klima', 'Lüftung'],       jahre: 14, ort: 'Aarau',         rating: 4.9, booked_until: '2027-02-28' },
  { name: 'Kevin Zimmermann',   verfuegbar: false, emoji: '🔧',  qual: 'Sanitärinstallateur', spez: ['Sanitär', 'Heizung'],     jahre: 7,  ort: 'Winterthur',    rating: 4.6, booked_until: '2027-01-31' },
  { name: 'Florian Marti',      verfuegbar: false, emoji: '💨',  qual: 'Lüftungsmeister', spez: ['Lüftung'],                    jahre: 16, ort: 'Basel',         rating: 4.8, booked_until: '2027-04-30' },
  { name: 'Patrick Schneider',  verfuegbar: false, emoji: '🔧',  qual: 'HKLS Allrounder', spez: ['Heizung', 'Sanitär', 'Lüftung', 'Klima'], jahre: 13, ort: 'Zürich', rating: 4.7, booked_until: '2027-05-31' },
];

async function j(r) { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }

async function ensureTestUser() {
  let res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email: TEST.email, password: TEST.password, email_confirm: true }) });
  let body = await j(res);
  if (res.ok && body.id) { console.log(`✓ Created auth user → ${body.id}`); return body.id; }
  const list = await j(await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: H }));
  const users = Array.isArray(list) ? list : list.users || [];
  const found = users.find((u) => (u.email || '').toLowerCase() === TEST.email);
  if (found) { console.log(`✓ Auth user exists → ${found.id}`); return found.id; }
  console.error('✗ Could not create/find test user:', body); return null;
}
async function ensureRole(userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_roles?on_conflict=user_id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: userId, role: 'techniker' }) });
  console.log(res.ok ? '✓ Role techniker ensured' : '✗ Role failed');
}

async function seed() {
  for (const t of TEAM) await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?name=eq.${encodeURIComponent(t.name)}`, { method: 'DELETE', headers: H });
  // also clear old demo names
  for (const n of ['Marco Schneider', 'Luca Bianchi', 'Andreas Keller']) await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?name=eq.${encodeURIComponent(n)}`, { method: 'DELETE', headers: H });

  const payload = TEAM.map((t) => {
    const sidecar = { photo_emoji: t.emoji, qualification: t.qual, specialization: t.spez, rating: t.rating, years_experience: t.jahre, location: t.ort };
    if (t.booked_until) sidecar.booked_until = t.booked_until;
    // Uniform keys across all rows (PostgREST bulk-insert requirement).
    return { name: t.name, verfuegbar: t.verfuegbar, notizen: JSON.stringify(sidecar),
      email: t.test ? TEST.email : null, user_id: t.test ? TEST_UID : null };
  });
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(payload) });
  const body = await j(r);
  if (r.ok) { console.log(`✓ Inserted ${body.length} technicians (${TEAM.filter((t) => t.verfuegbar).length} available, ${TEAM.filter((t) => !t.verfuegbar).length} booked)`); }
  else console.error('✗ Insert failed:', r.status, body);
}

const uid = await ensureTestUser();
if (uid) await ensureRole(uid);
await seed();
console.log('\nDone.');
