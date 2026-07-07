// scripts/test_entitlements_live.mjs
// LIVE-Test der Feature-Freischaltung gegen die echte Supabase-DB (Service-Key).
// Prüft die KOMPLETTE Kette in BEIDE Richtungen, mehrfach, für mehrere Keys:
//   Master schreibt (setEntitlement-Upsert) → Partner liest (getEnabledFeatures).
//   AN  → Feature im Lese-Set enthalten.
//   AUS → Feature NICHT enthalten.
// So wird bewiesen, dass eine Master-Freischaltung sofort in der DB steht und der
// Partner-Lesepfad sie frisch sieht (kein Cache).
//
// Voraussetzung: SUPABASE_URL + SUPABASE_KEY (Service-Key) als Env ODER in .env.local.
// Aufruf:  node scripts/test_entitlements_live.mjs [partner-email]
//   Default-Partner: emanuelgeorge0+geiger@gmail.com
//
// SICHER: räumt am Ende auf (setzt die getesteten Keys auf ihren Ausgangszustand
// zurück). Testet NUR den angegebenen Partner-Account.

import { readFileSync } from 'node:fs';

// .env.local best-effort laden (nur fehlende Keys ergänzen; kein Override).
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* keine .env.local → Env muss gesetzt sein */ }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const EMAIL = process.argv[2] || 'emanuelgeorge0+geiger@gmail.com';
const KEYS = ['disposition', 'material', 'controlling'];   // mehrere Keys
const ROUNDS = 5;                                           // mehrfach

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('✗ SUPABASE_URL / SUPABASE_KEY fehlen (Env oder .env.local).');
  process.exit(2);
}
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '✓' : '✗ FAIL') + ' ' + m); };

// ── Lesepfad 1:1 wie lib/entitlements.getEnabledFeatures ──
async function readEnabled(partnerId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_partner_entitlements?partner_user_id=eq.${partnerId}&select=feature_key,enabled`, { headers: SB });
  if (!r.ok) throw new Error('read ' + r.status + ' ' + (await r.text().catch(() => '')));
  const rows = await r.json();
  const set = new Set();
  for (const row of rows) if (row.enabled) set.add(row.feature_key);
  return set;
}

// ── Schreibpfad 1:1 wie api/entitlements.setEntitlement (Upsert) ──
async function writeEntitlement(partnerId, key, enabled) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_partner_entitlements?on_conflict=partner_user_id,feature_key`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ partner_user_id: partnerId, feature_key: key, enabled, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error('write ' + r.status + ' ' + (await r.text().catch(() => '')));
}

// Partner-user_id per E-Mail (Auth Admin API).
async function findPartnerId(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: SB });
  if (!r.ok) throw new Error('admin/users ' + r.status);
  const data = await r.json();
  const users = Array.isArray(data) ? data : data.users || [];
  const u = users.find((x) => (x.email || '').toLowerCase() === email.toLowerCase());
  return u ? u.id : null;
}

async function roleOf(userId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&select=role&limit=1`, { headers: SB });
  if (!r.ok) return null;
  return (await r.json())[0]?.role || null;
}

const run = async () => {
  console.log(`\n▶ Live-Entitlement-Test · Partner: ${EMAIL}\n`);
  const pid = await findPartnerId(EMAIL);
  ok(!!pid, `Partner-Account gefunden (user_id=${pid || '—'})`);
  if (!pid) { console.log('\nAbbruch: Account existiert nicht.'); process.exit(1); }
  const role = await roleOf(pid);
  ok(role === 'gs_partner', `Rolle ist gs_partner (ist: ${role})`);

  // Ausgangszustand sichern (für Cleanup).
  const before = await readEnabled(pid);
  console.log(`  Ausgangszustand freigeschaltet: [${[...before].join(', ') || '—'}]\n`);

  for (let round = 1; round <= ROUNDS; round++) {
    for (const key of KEYS) {
      // AN
      await writeEntitlement(pid, key, true);
      let set = await readEnabled(pid);
      ok(set.has(key), `R${round} ${key}: Master AN → Partner sieht Modul`);
      // AUS
      await writeEntitlement(pid, key, false);
      set = await readEnabled(pid);
      ok(!set.has(key), `R${round} ${key}: Master AUS → Partner gesperrt`);
    }
  }

  // Cleanup: Ausgangszustand wiederherstellen.
  for (const key of KEYS) await writeEntitlement(pid, key, before.has(key));
  const after = await readEnabled(pid);
  ok(KEYS.every((k) => after.has(k) === before.has(k)), 'Cleanup: Ausgangszustand wiederhergestellt');

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('✗ Fehler:', e.message); process.exit(1); });
