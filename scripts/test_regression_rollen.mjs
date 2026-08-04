// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION — Aufrufketten und Rollen-Gating (Rapport Feinschliff II)
// ═══════════════════════════════════════════════════════════════════════════
// Statische Prüfung ohne Netz und ohne DB. Sie fängt genau die Fehlerklasse,
// die bei Umbauten an diesen sehr grossen Dateien real auftritt und die man im
// Browser erst bemerkt, wenn jemand den Knopf drückt:
//
//   1. onclick="foo(...)" ruft eine Funktion, die es nicht (mehr) gibt
//   2. Der Client ruft eine Action, die der Dispatcher nicht kennt
//   3. Eine Action ist im Dispatcher, aber in keiner Rollen-Liste → für
//      Partner/Techniker unerreichbar bzw. versehentlich freigegeben
//   4. Rollen-Gating hat sich unbemerkt verschoben (Techniker sieht Master-Zeug)
//
// Lauf:  node scripts/test_regression_rollen.mjs
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const app = readFileSync('app.html', 'utf8');
const intern = readFileSync('gs-intern.html', 'utf8');
const cockpit = readFileSync('api/cockpit.js', 'utf8');

let ok = 0, fail = 0;
const fehler = [];
function pruef(bed, was) { if (bed) ok++; else { fail++; fehler.push(was); } }

// ── Hilfen ────────────────────────────────────────────────────────────────
function definierteFunktionen(src) {
  const s = new Set();
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) s.add(m[1]);
  // auch  var foo = function(){}  /  const foo = (…) =>
  for (const m of src.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function\b|\()/g)) s.add(m[1]);
  return s;
}
function inlineAufrufe(src) {
  const s = new Set();
  // on*="…"  und  on*='…'
  for (const m of src.matchAll(/\son[a-z]+\s*=\s*(["'])([\s\S]*?)\1/g)) {
    // String-Literale im Handler zuerst entfernen. Sonst gilt jedes Wort vor
    // einer Klammer INNERHALB eines Textes als Funktionsaufruf — z.B.
    //   onclick="toast('Einsatzvertrag-PDF folgt (Platzhalter)')"
    // hätte sonst eine Funktion "folgt" gemeldet, die es zu Recht nicht gibt.
    const rumpf = m[2]
      .replace(/\\'(?:[^'\\]|\\.)*?\\'/g, "''")   // \'…\' (in JS-Strings erzeugtes HTML)
      .replace(/'[^']*'/g, "''")
      .replace(/&quot;[^&]*&quot;/g, '""');
    // Führendes [^.\w$] schliesst METHODENaufrufe aus: this.closest(…),
    // e.preventDefault(…), JSON.stringify(…) sind keine globalen Funktionen und
    // haben in dieser Prüfung nichts verloren.
    for (const c of rumpf.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) s.add(c[2]);
  }
  return s;
}
// Eingebaute/Browser-Namen, die in inline-Handlern legitim vorkommen.
const BUILTIN = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
  'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date', 'parseInt', 'parseFloat',
  'alert', 'confirm', 'prompt', 'setTimeout', 'setInterval', 'encodeURIComponent', 'decodeURIComponent',
  'RegExp', 'Error', 'isNaN', 'window', 'document', 'console']);

// ── 1./2. app.html — Techniker-App ────────────────────────────────────────
const appDef = definierteFunktionen(app);
for (const name of inlineAufrufe(app)) {
  if (BUILTIN.has(name)) continue;
  pruef(appDef.has(name), `app.html: onclick ruft "${name}(", aber die Funktion ist nirgends definiert`);
}

// ── gs-intern.html — Master-Cockpit ───────────────────────────────────────
const internDef = definierteFunktionen(intern);
for (const name of inlineAufrufe(intern)) {
  if (BUILTIN.has(name)) continue;
  pruef(internDef.has(name), `gs-intern.html: onclick ruft "${name}(", aber die Funktion ist nirgends definiert`);
}

// ── 3. Actions: Client ruft → Dispatcher kennt ────────────────────────────
const dispatcherActions = new Set(
  [...cockpit.matchAll(/case\s+'([a-z0-9_]+)'\s*:/g)].map((m) => m[1]),
);
function clientActions(src, fnNamen) {
  const s = new Set();
  for (const fn of fnNamen) {
    const re = new RegExp(`\\b${fn}\\(\\s*'([a-z0-9_]+)'`, 'g');
    for (const m of src.matchAll(re)) s.add(m[1]);
  }
  return s;
}
const appActions = clientActions(app, ['techApi']);
const internActions = clientActions(intern, ['api']);

for (const a of appActions) pruef(dispatcherActions.has(a), `app.html ruft Action "${a}", die api/cockpit.js nicht kennt`);
for (const a of internActions) pruef(dispatcherActions.has(a), `gs-intern.html ruft Action "${a}", die api/cockpit.js nicht kennt`);

// ── 4. Rollen-Gating ──────────────────────────────────────────────────────
function listeAusQuelle(name) {
  const m = cockpit.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!m) return null;
  return new Set([...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]));
}
const PM = listeAusQuelle('PM_ACTIONS');
const TECH = listeAusQuelle('TECHNIKER_ACTIONS');
pruef(!!PM, 'PM_ACTIONS nicht auffindbar');
pruef(!!TECH, 'TECHNIKER_ACTIONS nicht auffindbar');

// 4a. Alles, was die Techniker-App ruft, muss der Techniker auch dürfen.
if (TECH) {
  for (const a of appActions) {
    pruef(TECH.has(a), `Techniker-App ruft "${a}", aber die Action steht nicht in TECHNIKER_ACTIONS → 403`);
  }
}

// 4b. Master-only muss Master-only BLEIBEN. Diese Actions greifen tief in
//     fremde Rapporte bzw. in den Katalog — sie dürfen nie in einer der
//     Partner-/Techniker-Listen auftauchen.
const MASTER_ONLY = [
  'pm_wochenrapporte_liste', 'pm_wochenrapport', 'pm_wochenrapport_update',
  'pm_wochenrapport_delete', 'pm_wochenrapport_move',
  'pm_wochenrapport_kopf_delete',                        // ZIEL 2, neu
  'pm_taetigkeitenkatalog_liste', 'pm_taetigkeitenkatalog_create',
  'pm_taetigkeitenkatalog_update', 'pm_taetigkeitenkatalog_toggle',
  'pm_katalog_entscheidung',                             // ZIEL 8e, neu
];
for (const a of MASTER_ONLY) {
  pruef(dispatcherActions.has(a), `Master-Action "${a}" fehlt im Dispatcher`);
  if (PM) pruef(!PM.has(a), `"${a}" ist versehentlich in PM_ACTIONS → Partner käme dran`);
  if (TECH) pruef(!TECH.has(a), `"${a}" ist versehentlich in TECHNIKER_ACTIONS → Techniker käme dran`);
}

// 4c. Die neuen Actions dieser Runde müssen im Master-Cockpit auch verdrahtet sein.
for (const a of ['pm_wochenrapport_kopf_delete', 'pm_katalog_entscheidung']) {
  pruef(internActions.has(a), `Neue Action "${a}" wird von gs-intern.html nirgends aufgerufen`);
}

// ── 5. Diese Runde: Funktionen, die es geben MUSS ─────────────────────────
const MUSS_APP = [
  'tcISOWeekMonday', 'tcISOWeeksInYear',              // ZIEL 4
  'tcWheelHtml', 'tcWheelInit', 'tcWheelSettle', 'tcWheelTap', 'tcWheelHeute',
  'tcUndoShow', 'tcUndoRun', 'tcUndoHide', 'tcDayFixup', 'tcHtmlZuKnoten',  // ZIEL 1
  'tcHaptik', 'tcSignGlowUpdate',                     // ZIEL 7
  'tcTaetVorschlaegeHtml', 'tcRowProjektId',          // ZIEL 6
];
for (const f of MUSS_APP) pruef(appDef.has(f), `app.html: Funktion "${f}" fehlt`);

const MUSS_INTERN = [
  'wrKopfDelStart', 'wrKopfDelGo',                    // ZIEL 2
  'keKuerzelBeispiel', 'keKuerzelHint',               // ZIEL 3
  'ktNorm', 'ktLev', 'ktAehnlichkeit', 'ktAehnliche', 'ktSlugVorschlag',
  'ktZuBestehendem', 'ktLogEntscheidung', 'ktFelderUebernehmen',   // ZIEL 8
];
for (const f of MUSS_INTERN) pruef(internDef.has(f), `gs-intern.html: Funktion "${f}" fehlt`);

// ── 6. Eiserne Regeln ─────────────────────────────────────────────────────
const vercel = readFileSync('vercel.json', 'utf8');
pruef(/"outputDirectory"\s*:\s*"\."/.test(vercel), 'vercel.json: outputDirectory ist nicht mehr "."');
// "Bob" darf nicht umbenannt worden sein.
pruef(/\bBob\b/.test(cockpit) || /\bbob\b/.test(cockpit), 'api/cockpit.js: "Bob" kommt nicht mehr vor');
// Kein hartkodiertes Secret in den geänderten Dateien.
for (const [name, src] of [['api/cockpit.js', cockpit], ['api/tagesrapport.js', readFileSync('api/tagesrapport.js', 'utf8')]]) {
  pruef(!/eyJ[A-Za-z0-9_-]{20,}\./.test(src), `${name}: sieht nach einem eingebetteten JWT/Key aus`);
}

// ── 7. Höhe des Unterschriftfelds an BEIDEN Stellen gleich (ZIEL 5) ───────
const cssHoehe = (app.match(/\.tc-sign-pad\{[^}]*height:(\d+)px/) || [])[1];
const canvasHoehe = (app.match(/cv\.height=(\d+)/) || [])[1];
pruef(cssHoehe === canvasHoehe && cssHoehe === '240',
  `Unterschriftfeld: CSS ${cssHoehe}px vs. Canvas ${canvasHoehe}px — müssen beide 240 sein`);

// ── 8. Wheel-Zeilenhöhe: CSS --twh == JS TC_WHEEL_ROW_H (ZIEL 4) ─────────
const twh = (app.match(/--twh:(\d+)px/) || [])[1];
const rowH = (app.match(/TC_WHEEL_ROW_H=(\d+)/) || [])[1];
pruef(twh === rowH, `Wheel: CSS --twh ${twh} vs. JS TC_WHEEL_ROW_H ${rowH} — laufen auseinander`);

// ── Ausgabe ───────────────────────────────────────────────────────────────
console.log('Regression — Aufrufketten & Rollen-Gating');
console.log('─'.repeat(58));
console.log(`Actions im Dispatcher      : ${dispatcherActions.size}`);
console.log(`davon Techniker-App nutzt  : ${appActions.size}`);
console.log(`davon Master-Cockpit nutzt : ${internActions.size}`);
console.log(`Prüfungen                  : ${ok + fail}`);
console.log('─'.repeat(58));
if (fail) {
  console.log(`✗ ${fail} FEHLER:`);
  fehler.forEach((f) => console.log('   · ' + f));
} else {
  console.log(`✓ alle ${ok} Prüfungen bestanden`);
}
process.exit(fail ? 1 : 0);
