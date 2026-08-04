// ═══════════════════════════════════════════════════════════════════════════
// ISO-KALENDERWOCHE — Beweis, dass Hin- und Rückrechnung zueinander invers
// sind (Rapport Feinschliff II, ZIEL 4).
// ═══════════════════════════════════════════════════════════════════════════
// Hintergrund: die alte tcISOWeekMonday rechnete "1. Januar + (KW-1)*7, dann
// auf Montag zurück". Korrekt nur, wenn der 1.1. auf Mo–Do fällt. Fällt er auf
// Fr/Sa/So, lag das Ergebnis eine Woche zu früh — eine Tageszeile wäre im
// falschen Wochenrapport und damit in der falschen Abrechnung gelandet.
//
// Prüft jeden einzelnen Tag von 2026-01-01 bis 2030-12-31 (1826 Tage):
//   1. tcISOWeekOfDate(tag) → (jahr, woche)
//   2. tcISOWeekMonday(jahr, woche) muss der Montag GENAU dieser Woche sein
//   3. tcWeekDates(jahr, woche) muss den Tag enthalten
//   4. Gegenprobe gegen eine unabhängige Referenzimplementierung
//   5. 53-Wochen-Jahre korrekt erkannt (2026 ist eines!)
//
// Lauf:  node scripts/test_isowoche.mjs
// Kein Netz, keine DB, keine Env — reine Rechnung.
// ═══════════════════════════════════════════════════════════════════════════

// ── Die zu prüfenden Funktionen: 1:1 aus app.html kopiert ──────────────────
function tcISOWeekOfDate(d) {
  d = new Date(Date.UTC(d.getUTCFullYear ? d.getUTCFullYear() : d.getFullYear(), d.getUTCMonth ? d.getUTCMonth() : d.getMonth(), d.getUTCDate ? d.getUTCDate() : d.getDate()));
  var day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  var woche = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { jahr: d.getUTCFullYear(), woche: woche };
}
function tcISOWeekMonday(jahr, woche) {
  var jan4 = new Date(Date.UTC(jahr, 0, 4));
  var dow = jan4.getUTCDay() || 7;
  var mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() + 1 - dow);
  mon.setUTCDate(mon.getUTCDate() + (woche - 1) * 7);
  return mon;
}
function tcISOWeeksInYear(jahr) {
  return tcISOWeekOfDate(new Date(Date.UTC(jahr, 11, 28))).woche;
}
function tcWeekDates(jahr, woche) {
  var mon = tcISOWeekMonday(jahr, woche), out = [];
  for (var i = 0; i < 7; i++) { var d = new Date(mon); d.setUTCDate(d.getUTCDate() + i); out.push(d.toISOString().slice(0, 10)); }
  return out;
}

// ── Die ALTE, fehlerhafte Fassung — nur um zu zeigen, dass der Test greift ──
function tcISOWeekMondayALT(jahr, woche) {
  var simple = new Date(Date.UTC(jahr, 0, 1 + (woche - 1) * 7));
  var dow = simple.getUTCDay() || 7;
  simple.setUTCDate(simple.getUTCDate() + 1 - dow);
  return simple;
}

// ── Unabhängige Referenz: Montag der Woche eines Datums, rein über Wochentag ─
function montagVon(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 1 - dow);
  return d.toISOString().slice(0, 10);
}

let ok = 0, fail = 0;
const fehler = [];
function pruef(bed, was) { if (bed) ok++; else { fail++; if (fehler.length < 25) fehler.push(was); } }

// ── 1–4. Jeder Tag 2026-01-01 … 2030-12-31 ────────────────────────────────
const start = Date.UTC(2026, 0, 1), ende = Date.UTC(2030, 11, 31);
let tage = 0;
for (let t = start; t <= ende; t += 86400000) {
  const d = new Date(t);
  const iso = d.toISOString().slice(0, 10);
  tage++;

  const { jahr, woche } = tcISOWeekOfDate(d);

  // (2) Rückrechnung trifft den Montag genau dieser Woche
  const mon = tcISOWeekMonday(jahr, woche).toISOString().slice(0, 10);
  pruef(mon === montagVon(iso), `${iso}: KW${woche}/${jahr} → Montag ${mon}, erwartet ${montagVon(iso)}`);

  // (3) tcWeekDates enthält den Tag und ist 7 aufeinanderfolgende Tage
  const dates = tcWeekDates(jahr, woche);
  pruef(dates.includes(iso), `${iso}: nicht in tcWeekDates(${jahr},${woche}) = ${dates[0]}…${dates[6]}`);
  pruef(dates.length === 7 && dates[0] === mon, `${iso}: tcWeekDates startet nicht am Montag`);

  // (4) Rundreise: Montag der Woche muss wieder dieselbe KW liefern
  const rueck = tcISOWeekOfDate(new Date(mon + 'T00:00:00Z'));
  pruef(rueck.jahr === jahr && rueck.woche === woche, `${iso}: Rundreise KW${woche}/${jahr} → KW${rueck.woche}/${rueck.jahr}`);
}

// ── 5. Wochenzahl je Jahr (52 oder 53) ────────────────────────────────────
// Ein ISO-Jahr hat 53 Wochen, wenn der 1.1. ein Donnerstag ist ODER
// (Schaltjahr UND 1.1. ein Mittwoch). Referenz unabhängig nachgerechnet.
function erwarteteWochen(j) {
  const jan1 = new Date(Date.UTC(j, 0, 1)).getUTCDay() || 7;
  const schalt = (j % 4 === 0 && j % 100 !== 0) || j % 400 === 0;
  return (jan1 === 4 || (schalt && jan1 === 3)) ? 53 : 52;
}
const wochenTab = {};
for (let j = 2026; j <= 2030; j++) {
  const soll = erwarteteWochen(j), ist = tcISOWeeksInYear(j);
  wochenTab[j] = ist;
  pruef(ist === soll, `Jahr ${j}: tcISOWeeksInYear=${ist}, erwartet ${soll}`);
}

// ── 6. Die konkreten Fälle aus der Diagnose ───────────────────────────────
const faelle = [
  ['2026-08-04', 2026, 32, 'heute (Diagnose-Datum)'],
  ['2026-08-10', 2026, 33, 'KW33-Montag — der geprüfte Testverlauf'],
  ['2026-08-14', 2026, 33, 'KW33-Freitag'],
  ['2026-12-28', 2026, 53, '2026 IST ein 53-Wochen-Jahr'],
  ['2027-01-03', 2026, 53, 'Sonntag gehört noch zu KW53/2026'],
  ['2027-01-04', 2027, 1, 'KW1/2027 beginnt erst hier'],
  ['2028-01-01', 2027, 52, 'Neujahr gehört zum Vorjahr'],
  ['2030-12-30', 2031, 1, 'Jahresende gehört schon zu KW1/2031'],
];
for (const [iso, ej, ew, note] of faelle) {
  const r = tcISOWeekOfDate(new Date(iso + 'T00:00:00Z'));
  pruef(r.jahr === ej && r.woche === ew, `${iso} (${note}): KW${r.woche}/${r.jahr}, erwartet KW${ew}/${ej}`);
}

// ── 7. Beweis, dass der Test die ALTE Fassung wirklich gefangen hätte ──────
let altFehler = 0;
for (let t = start; t <= ende; t += 86400000) {
  const d = new Date(t), iso = d.toISOString().slice(0, 10);
  const { jahr, woche } = tcISOWeekOfDate(d);
  if (tcISOWeekMondayALT(jahr, woche).toISOString().slice(0, 10) !== montagVon(iso)) altFehler++;
}

// ── Ausgabe ───────────────────────────────────────────────────────────────
console.log('ISO-Kalenderwoche — Hin-/Rückrechnung');
console.log('─'.repeat(58));
console.log(`Geprüfte Tage 2026-01-01 … 2030-12-31 : ${tage}`);
console.log(`Einzelprüfungen                       : ${ok + fail}`);
console.log(`Wochen je Jahr                        : ` +
  Object.entries(wochenTab).map(([j, w]) => `${j}=${w}`).join('  '));
console.log('─'.repeat(58));
if (fail) {
  console.log(`✗ ${fail} FEHLER (erste ${Math.min(fehler.length, 25)}):`);
  fehler.forEach((f) => console.log('   · ' + f));
} else {
  console.log(`✓ alle ${ok} Prüfungen bestanden`);
}
console.log(`\nKontrollprobe alte Fassung: ${altFehler} von ${tage} Tagen falsch ` +
  `(${altFehler ? 'Test greift nachweislich' : 'WARNUNG: Test würde den alten Bug NICHT fangen'})`);
process.exit(fail ? 1 : 0);
