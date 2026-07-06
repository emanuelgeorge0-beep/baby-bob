// scripts/test_entitlements.mjs – Logik-Test der Feature-Freischaltung (offline).
// Mockt fetch → prüft Fail-open (Tabelle fehlt), Opt-in (Zeilen vorhanden) und
// Katalog-Integrität. KEIN Supabase/Netzwerk nötig.  Lauf: node scripts/test_entitlements.mjs
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://x';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'k';

let mode;
globalThis.fetch = async () => {
  if (mode === 'missing') return { ok: false, status: 404, json: async () => ({ message: 'Could not find the table' }) };
  if (mode === 'rows')    return { ok: true, json: async () => ([{ feature_key: 'blockaden', enabled: true }, { feature_key: 'material', enabled: false }, { feature_key: 'reporting', enabled: true }]) };
  if (mode === 'empty')   return { ok: true, json: async () => ([]) };
  return { ok: false, status: 500, json: async () => ({}) };
};

const { getEnabledFeatures, isEntitled, FEATURE_KEYS, FEATURES } = await import('../lib/entitlements.js');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '✓' : '✗ FAIL') + ' ' + m); };

// ── Katalog-Integrität ──
ok(FEATURE_KEYS.length === 16, '16 Feature-Keys im Katalog');
ok(new Set(FEATURE_KEYS).size === FEATURE_KEYS.length, 'keine doppelten Keys');
ok(FEATURES.every((f) => f.key && f.label), 'jeder Key hat ein Label');
ok(!FEATURE_KEYS.includes('reports'), "alter Key 'reports' entfernt (→ reporting)");
['reporting', 'rapport', 'bob_assist_projekt', 'controlling', 'disposition'].forEach((k) =>
  ok(FEATURE_KEYS.includes(k), `Key vorhanden: ${k}`));

// ── Fail-open: Tabelle fehlt → ALLE frei, nichts crasht ──
mode = 'missing';
let r = await getEnabledFeatures('u1');
ok(r.tableMissing === true, 'missing → tableMissing=true');
ok(r.features.size === FEATURE_KEYS.length, 'missing → ALLE Features frei (fail-open)');
ok(await isEntitled('u1', 'blockaden') === true, 'missing → isEntitled=true');

// ── Opt-in: Zeilen vorhanden → nur enabled=true zählt ──
mode = 'rows';
r = await getEnabledFeatures('u2');
ok(r.tableMissing === false, 'rows → tableMissing=false');
ok(r.features.has('blockaden') && r.features.has('reporting'), 'rows → enabled Keys enthalten');
ok(!r.features.has('material'), 'rows → enabled=false NICHT enthalten');
ok(await isEntitled('u2', 'material') === false, 'rows → gesperrtes Feature=false');

// ── Leer: neuer Partner ohne Zeilen → nichts frei (opt-in) ──
mode = 'empty';
r = await getEnabledFeatures('u3');
ok(r.features.size === 0, 'empty → nichts frei (Opt-in)');
ok(await isEntitled('u3', 'projektmanagement') === false, 'empty → neuer Partner gesperrt');

// ── Rollen-Invariante: leere userId → kein Zugriff, kein Crash ──
r = await getEnabledFeatures(null);
ok(r.features.size === 0, 'kein userId → leeres Set (kein Crash)');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
