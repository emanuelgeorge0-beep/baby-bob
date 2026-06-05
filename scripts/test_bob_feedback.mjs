// scripts/test_bob_feedback.mjs — Task 7 endpoint test.
//   node scripts/test_bob_feedback.mjs [baseUrl]
// Validates input handling + graceful behavior. After the migration runs,
// valid calls return saved:true and rows are verifiable in Supabase.

import { readFileSync } from 'node:fs';
const BASE = process.argv[2] || 'https://baby-bob.vercel.app';
let SUPABASE_URL, SUPABASE_KEY;
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m?.[1] === 'SUPABASE_URL') SUPABASE_URL = m[2].trim();
    if (m?.[1] === 'SUPABASE_KEY') SUPABASE_KEY = m[2].trim();
  }
} catch {}

let pass = 0, fail = 0;
const is = (n, c, d) => (c ? (console.log('  ✓ ' + n), pass++) : (console.log('  ✗ ' + n + (d ? ' — ' + d : '')), fail++));
const post = async (b) => { const r = await fetch(`${BASE}/api/bob-feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null) }; };

console.log(`BOB feedback @ ${BASE}\n`);

// validation
is('bad action → 400', (await post({ action: 'zzz' })).status === 400);
is('bad user_feedback → 400', (await post({ action: 'feedback', user_feedback: 'maybe' })).status === 400);
is('unbekannt without korrektur → 400', (await post({ action: 'unbekannt' })).status === 400);
is('GET → 405', (await (await fetch(`${BASE}/api/bob-feedback`)).status) === 405 ? true : (await fetch(`${BASE}/api/bob-feedback`)).status === 405);

// valid feedback (correct / wrong / corrected)
for (const fb of ['correct', 'wrong', 'corrected']) {
  const r = await post({ action: 'feedback', user_feedback: fb, bild_hash: 'test_' + fb, bob_antwort: 'Test Diagnose', kategorie: 'Sanitär', user_korrektur: fb === 'correct' ? null : 'Eigentlich Heizung' });
  is(`feedback ${fb} → 200 ok`, r.status === 200 && r.body?.ok === true, JSON.stringify(r.body));
}
// valid unbekannt
const u = await post({ action: 'unbekannt', bild_hash: 'test_unb', bob_antwort: '?', user_korrektur: 'Entkalkungsanlage', kategorie_vorschlag: 'Sanitär' });
is('unbekannt valid → 200 ok', u.status === 200 && u.body?.ok === true, JSON.stringify(u.body));

// Detect migration state + verify DB rows if tables exist.
const migrated = u.body?.saved === true;
console.log(`\n  migration applied: ${migrated ? 'YES' : 'NO (rows dropped gracefully)'}`);
if (migrated && SUPABASE_URL) {
  const SBH = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const scans = await (await fetch(`${SUPABASE_URL}/rest/v1/bob_scans?bild_hash=like.test_*&select=id,user_feedback`, { headers: SBH })).json();
  is('bob_scans rows present', Array.isArray(scans) && scans.length >= 3, `${scans?.length}`);
  const unb = await (await fetch(`${SUPABASE_URL}/rest/v1/bob_unbekannt?bild_hash=eq.test_unb&select=id`, { headers: SBH })).json();
  is('bob_unbekannt row present', Array.isArray(unb) && unb.length >= 1);
  // cleanup test rows
  await fetch(`${SUPABASE_URL}/rest/v1/bob_scans?bild_hash=like.test_*`, { method: 'DELETE', headers: SBH });
  await fetch(`${SUPABASE_URL}/rest/v1/bob_unbekannt?bild_hash=eq.test_unb`, { method: 'DELETE', headers: SBH });
  console.log('  (cleaned up test rows)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
