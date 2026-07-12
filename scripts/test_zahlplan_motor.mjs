// Testet den %-Verteilungsmotor (Block 3, zahlplan-ux) direkt aus gs-intern.html.
// Extrahiert plPosBasis/plStepSum/plRecalc aus dem Inline-Script und prüft die
// Invarianten: ganze Franken für freie Steps, Summe exakt == Netto-Positionsbasis,
// Gates zählen nie, alles-fixiert => keine Umverteilung.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'gs-intern.html'), 'utf8');

function extract(name) {
  const i = html.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`Funktion ${name} nicht gefunden`);
  let depth = 0, j = html.indexOf('{', i);
  for (let k = j; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}' && --depth === 0) return html.slice(i, k + 1);
  }
  throw new Error(`Funktion ${name} unvollständig`);
}

const src = ['plPosBasis', 'plStepSum', 'plRecalc'].map(extract).join('\n');
const ctx = { _pl: null };
const run = new Function('_ctx', `let _pl;
${src}
return function(state){ _pl=state; _ctx._pl=state; plRecalc(); return { stepSum: plStepSum(), posBasis: plPosBasis() }; };`)(ctx);

let fails = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { fails++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
const S = (typ, betrag, fix) => ({ typ, betrag, fix: !!fix });
const state = (posBasisChf, steps) => ({
  positionen: [{ menge: 1, einzelpreis: posBasisChf, im_zahlungsplan: true }],
  abschnitte: [{ name: 'A', steps }],
});

// 1) 3 freie Steps, 10'000: ganze Franken + Rest auf letzten, Summe exakt
let st = state(10000, [S('zahlung', 0), S('zahlung', 0), S('zahlung', 0)]);
let r = run(st);
check('3 freie / 10000: Summe exakt', r.stepSum === r.posBasis, `steps=${r.stepSum} pos=${r.posBasis}`);
check('3 freie / 10000: 3333+3333+3334', st.abschnitte[0].steps.map(s => s.betrag).join(',') === '3333,3333,3334');

// 2) Rappen-Basis 10'000.50: freie ganze Franken, letzter trägt Rappen
st = state(10000.5, [S('zahlung', 0), S('zahlung', 0), S('zahlung', 0)]);
r = run(st);
check('Rappen-Basis: Summe exakt', r.stepSum === r.posBasis);
check('Rappen-Basis: erste ganzzahlig', Number.isInteger(st.abschnitte[0].steps[0].betrag) && Number.isInteger(st.abschnitte[0].steps[1].betrag));

// 3) Fixierte bleiben, freie teilen Rest; Gate zählt nie
st = state(10000, [S('zahlung', 1500, true), S('blockade', 0), S('zahlung', 0), S('zahlung', 0)]);
r = run(st);
check('fix 1500 bleibt', st.abschnitte[0].steps[0].betrag === 1500);
check('Gate bleibt 0', st.abschnitte[0].steps[1].betrag === 0);
check('freie teilen 8500: 4250+4250', st.abschnitte[0].steps[2].betrag === 4250 && st.abschnitte[0].steps[3].betrag === 4250);
check('Summe exakt mit fix+gate', r.stepSum === r.posBasis);

// 4) Alle fixiert & Summe ≠ Basis: NICHT umverteilen
st = state(10000, [S('zahlung', 1000, true), S('zahlung', 2000, true)]);
r = run(st);
check('alle fixiert: keine Umverteilung', st.abschnitte[0].steps[0].betrag === 1000 && st.abschnitte[0].steps[1].betrag === 2000);
check('alle fixiert: Differenz sichtbar (3000 vs 10000)', r.stepSum === 300000 && r.posBasis === 1000000);

// 5) Überbucht (fix > Basis): freie fallen auf 0, nichts negativ
st = state(1000, [S('zahlung', 1500, true), S('zahlung', 0), S('zahlung', 0)]);
r = run(st);
check('überbucht: freie >= 0', st.abschnitte[0].steps[1].betrag >= 0 && st.abschnitte[0].steps[2].betrag >= 0);

// 6) Position ohne Plan-Häkchen zählt nicht zur Basis
st = state(10000, [S('zahlung', 0)]);
st.positionen.push({ menge: 1, einzelpreis: 5000, im_zahlungsplan: false });
r = run(st);
check('Plan-Häkchen aus: Basis bleibt 10000', r.posBasis === 1000000 && st.abschnitte[0].steps[0].betrag === 10000);

console.log(fails ? `\n${fails} FEHLER` : '\nALLE MOTOR-TESTS PASS');
process.exit(fails ? 1 : 0);
