// Offline-Logiktest Projektdatenblatt (kein DB-Zugriff).
// Prüft: server-seitigen Sanitizer, Vollständigkeits-/Touched-Logik, Config-
// Parität Master↔Partner, Backend-Routing/Gating (pm_datenblatt_save in
// PM_ACTIONS + Switch + requireOwnedProjekt-Scoping). node scripts/test_datenblatt.mjs
import fs from 'fs';

const ROOT = new URL('..', import.meta.url).pathname;
const cockpit = fs.readFileSync(ROOT + 'api/cockpit.js', 'utf8');
const appHtml = fs.readFileSync(ROOT + 'app.html', 'utf8');
const intern = fs.readFileSync(ROOT + 'gs-intern.html', 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };

// ── 1. Echten Sanitizer aus cockpit.js extrahieren & ausführen ──
function extractFn(src, name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('fn not found: ' + name);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return src.slice(start, end);
}
const sanitize = eval('(' + extractFn(cockpit, 'sanitizeDatenblatt') + ')');

function testSanitize() {
  // Unbekannte Keys droppen, bekannte behalten, updated_at gesetzt.
  const dirty = {
    kunde: { firma: 'ACME AG', ansprechperson: 'Herr X', telefon: '079', email: 'a@b.ch', objekt: 'Bahnhofstr 1', hack: 'x' },
    anlagenart: ['fernwaerme', 'heizung'],
    details: { fernwaerme: { art: 'Neubau', anschluss: 'indirekt', speicher: ['Pufferspeicher', 'Warmwasserspeicher'], plan: 'ja' }, evil: 'nope' },
    umfang: ['Zentrale', 'Verteilung'],
    materialstellung: 'wir', start: 'KW 32', notiz: 'Testnotiz',
    boeser_key: 'weg',
  };
  const c = sanitize(dirty);
  ok(c.kunde.firma === 'ACME AG', 'firma erhalten');
  ok(c.kunde.hack === undefined, 'unbekannter kunde-key gedroppt');
  ok(c.boeser_key === undefined, 'unbekannter top-key gedroppt');
  ok(Array.isArray(c.anlagenart) && c.anlagenart.length === 2, 'anlagenart erhalten');
  ok(c.details.fernwaerme.art === 'Neubau', 'detail single erhalten');
  ok(Array.isArray(c.details.fernwaerme.speicher) && c.details.fernwaerme.speicher.length === 2, 'detail multi array erhalten');
  ok(c.details.evil === undefined, 'detail-nichtobjekt (string) gedroppt');
  ok(c.materialstellung === 'wir', 'materialstellung erhalten');
  ok(typeof c.updated_at === 'string' && c.updated_at.length > 10, 'updated_at gesetzt');

  // Längen-/Anzahl-Caps.
  const big = sanitize({
    kunde: { firma: 'x'.repeat(500) },
    anlagenart: Array.from({ length: 50 }, (_, i) => 'a' + i),
    umfang: Array.from({ length: 50 }, (_, i) => 'u' + i),
    notiz: 'n'.repeat(5000),
    details: { heizung: { waermeerzeuger: Array.from({ length: 50 }, (_, i) => 'w' + i) } },
  });
  ok(big.kunde.firma.length === 160, 'firma auf 160 gekappt');
  ok(big.anlagenart.length === 12, 'anlagenart auf 12 gekappt');
  ok(big.umfang.length === 24, 'umfang auf 24 gekappt');
  ok(big.notiz.length === 2000, 'notiz auf 2000 gekappt');
  ok(big.details.heizung.waermeerzeuger.length === 20, 'detail-array auf 20 gekappt');

  // Robust gegen Müll-Input.
  const empty = sanitize(null);
  ok(empty.kunde && empty.anlagenart.length === 0 && empty.umfang.length === 0, 'null-input → leeres valides Datenblatt');
  ok(sanitize('string').anlagenart.length === 0, 'string-input → leer');
  ok(sanitize([1, 2]).anlagenart.length === 0, 'array-input → leer');
}

// ── 2. Vollständigkeits-/Touched-Logik (aus app.html extrahiert) ──
function extractJsFn(src, name) {
  const re = new RegExp('function ' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('js fn not found: ' + name);
  const start = m.index;
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return src.slice(start, end);
}
const dbIsComplete = eval('(' + extractJsFn(appHtml, 'dbIsComplete') + ')');
const dbTouched = eval('(' + extractJsFn(appHtml, 'dbTouched') + ')');

function testCompleteness() {
  ok(dbIsComplete(null) === false, 'null nicht vollständig');
  ok(dbIsComplete({ kunde: {}, anlagenart: [], materialstellung: '' }) === false, 'leer nicht vollständig');
  ok(dbIsComplete({ kunde: { firma: 'A' }, anlagenart: ['heizung'], materialstellung: 'wir' }) === true, 'firma+anlage+material → vollständig');
  ok(dbIsComplete({ kunde: { firma: 'A' }, anlagenart: [], materialstellung: 'wir' }) === false, 'ohne anlage nicht vollständig');
  ok(dbIsComplete({ kunde: { firma: 'A' }, anlagenart: ['heizung'], materialstellung: '' }) === false, 'ohne material nicht vollständig');
  ok(dbTouched({ kunde: { firma: 'A' } }) === true, 'firma → touched');
  ok(dbTouched({ anlagenart: ['x'] }) === true, 'anlage → touched');
  ok(dbTouched({ kunde: {}, anlagenart: [], umfang: [] }) === false, 'leer → nicht touched');
  ok(dbTouched({}) === false, 'leeres objekt → nicht touched');
}

// ── 3. Config-Parität Master ↔ Partner ──
function grabConst(src, name) {
  const i = src.indexOf('var ' + name + '=');
  if (i < 0) throw new Error('const not found: ' + name);
  // bis zum passenden abschliessenden ; auf gleicher Klammertiefe
  let j = i + 4 + name.length + 1, depth = 0, end = -1;
  for (; j < src.length; j++) {
    const ch = src[j];
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ';' && depth === 0) { end = j; break; }
  }
  return src.slice(i, end).replace(/\s+/g, '');
}
function testParity() {
  for (const name of ['DB_ANLAGEN', 'DB_UMFANG', 'DB_MATSTELL', 'DB_DETAILS']) {
    const a = grabConst(appHtml, name), b = grabConst(intern, name);
    ok(a === b, 'Config ' + name + ' identisch Master↔Partner');
  }
  // Alle 7 geforderten Anlagen-Arten vorhanden.
  const need = ['sanitaer', 'heizung', 'fernwaerme', 'heizzentrale', 'kaelte', 'lueftung', 'wohnblock'];
  for (const n of need) ok(grabConst(appHtml, 'DB_ANLAGEN').includes("'" + n + "'"), 'Anlagen-Art ' + n + ' vorhanden');
  // Fernwärme-Detailfelder aus der Aufgabe.
  const fw = grabConst(appHtml, 'DB_DETAILS');
  for (const f of ['anschluss', 'uebergabe', 'speicher', 'bewohnt', 'plan']) ok(fw.includes("'" + f + "'"), 'Fernwärme-Feld ' + f + ' vorhanden');
}

// ── 4. Backend-Routing & Gating ──
function testWiring() {
  ok(/PM_ACTIONS[\s\S]*?'pm_datenblatt_save'/.test(cockpit), 'pm_datenblatt_save in PM_ACTIONS (Partner darf)');
  ok(cockpit.includes("case 'pm_datenblatt_save':"), 'Switch-Case vorhanden');
  const fn = extractFn(cockpit, 'savePmDatenblatt');
  ok(/requireOwnedProjekt\(pid,\s*scope\)/.test(fn), 'Datentrennung: requireOwnedProjekt vor Save');
  ok(/updated_by/.test(fn) && /partner/.test(fn) && /master/.test(fn), 'updated_by master/partner gesetzt');
  ok(/notMigrated/.test(fn), 'notMigrated-Fallback vor Migration');
  // Frontend ruft die Action beidseitig.
  ok(appHtml.includes("pmApi('pm_datenblatt_save'"), 'Partner ruft pm_datenblatt_save');
  ok(intern.includes("api('pm_datenblatt_save'"), 'Master ruft pm_datenblatt_save');
  // Read-Summary + Edit-Einstieg beidseitig.
  ok(appHtml.includes('pmDatenblattCard(') && appHtml.includes('function dbOpen'), 'Partner: Card + dbOpen');
  ok(intern.includes('dbSec=pmSec') && intern.includes('function openDatenblatt'), 'Master: Section + openDatenblatt');
  // SQL nur als Script vorhanden (nicht ausgeführt) — Spalte datenblatt.
  ok(fs.existsSync(ROOT + 'scripts/projekt_datenblatt.sql'), 'SQL-Script existiert');
  ok(/ADD COLUMN IF NOT EXISTS datenblatt jsonb/.test(fs.readFileSync(ROOT + 'scripts/projekt_datenblatt.sql', 'utf8')), 'SQL fügt datenblatt jsonb hinzu');
}

// 5 Durchläufe (Qualitätsregel: mehrfach, deterministisch grün).
for (let run = 1; run <= 5; run++) {
  testSanitize(); testCompleteness(); testParity(); testWiring();
}
console.log(`\nDatenblatt-Test: ${pass} Assertions grün, ${fail} rot (5 Durchläufe).`);
process.exit(fail ? 1 : 0);
