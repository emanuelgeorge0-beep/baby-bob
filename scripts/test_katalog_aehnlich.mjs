// ═══════════════════════════════════════════════════════════════════════════
// KATALOG-ÄHNLICHKEIT — Duplikatschutz (Rapport Feinschliff II, ZIEL 8a/8b)
// ═══════════════════════════════════════════════════════════════════════════
// Prüft die Normalisierung und das Ähnlichkeitsmass, mit dem der Master beim
// Anlegen einer Tätigkeit gewarnt wird. Zwei Fehlerrichtungen zählen:
//   • zu streng  → Dubletten rutschen durch, der Katalog wuchert
//   • zu locker  → jede Neuanlage wird angemeckert, die Warnung wird ignoriert
// Deshalb wird BEIDES geprüft: Paare, die anschlagen MÜSSEN, und Paare, die
// NICHT anschlagen dürfen.
//
// Lauf:  node scripts/test_katalog_aehnlich.mjs
// ═══════════════════════════════════════════════════════════════════════════

// ── 1:1 aus gs-intern.html ────────────────────────────────────────────────
const KT_ENDUNGEN = [
  /ierungen$/, /ierung$/, /ierten$/, /ieren$/, /iert$/,
  /ungen$/, /ung$/, /agen$/, /age$/,
  /en$/, /er$/, /es$/, /em$/, /e$/, /t$/, /n$/, /s$/,
];
function ktUmlaute(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}
function ktStamm(wort) {
  if (wort.length <= 4) return wort;
  for (let i = 0; i < KT_ENDUNGEN.length; i++) {
    const m = KT_ENDUNGEN[i];
    if (m.test(wort)) {
      const kurz = wort.replace(m, '');
      if (kurz.length >= 3) return kurz;
    }
  }
  return wort;
}
function ktNorm(s) {
  return ktUmlaute(s).split(/[^a-z0-9]+/).filter(Boolean).map(ktStamm).join('');
}
function ktLev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = [], cur = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}
function ktAehnlichkeit(a, b) {
  const x = ktNorm(a), y = ktNorm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const lang = Math.max(x.length, y.length);
  let score = 1 - (ktLev(x, y) / lang);
  if (x.indexOf(y) >= 0 || y.indexOf(x) >= 0) score = Math.max(score, 0.82);
  return score;
}

const WARN = 0.72;   // Schwelle der Speicher-Warnung (ZIEL 8b)
const LIVE = 0.55;   // Schwelle der Live-Suche (ZIEL 8a)

let ok = 0, fail = 0;
const fehler = [];
function pruef(bed, was) { if (bed) ok++; else { fail++; fehler.push(was); } }

// ── A. Normalisierung: diese Paare müssen IDENTISCH normalisieren ──────────
// Genau der in der Anforderung genannte Fall montiert/montieren/Montage.
const gleich = [
  ['Waschtisch montiert', 'Waschtisch montieren'],
  ['Waschtisch montiert', 'Waschtisch Montage'],
  ['Waschtisch montieren', 'waschtisch-montage'],
  ['Leitung verlegt', 'Leitungen verlegen'],
  ['Rohr isoliert', 'Rohre isolieren'],
  ['Heizkörper montiert', 'Heizkoerper Montage'],
  ['Spülkasten  eingebaut', 'Spülkasten-eingebaut'],
  ['Druckprüfung', 'Druckprüfungen'],
];
for (const [a, b] of gleich) {
  pruef(ktNorm(a) === ktNorm(b), `normalisiert ungleich: "${a}" → ${ktNorm(a)} | "${b}" → ${ktNorm(b)}`);
  pruef(ktAehnlichkeit(a, b) === 1, `Score < 1 bei "${a}" / "${b}" (${ktAehnlichkeit(a, b).toFixed(2)})`);
}

// ── B. Muss die Speicher-Warnung auslösen (echte Beinahe-Dubletten) ────────
const warnen = [
  ['Waschtisch montiert', 'Waschtisch demontiert'],
  ['Waschtisch montiert', 'Waschtische montiert'],
  ['Kaltwasserleitung verlegt', 'Kaltwasserleitungen verlegen'],
  ['Radiator angeschlossen', 'Radiatoren anschliessen'],
  ['Steigzone montiert', 'Steigzonen Montage'],
  ['Bodenheizung verlegt', 'Bodenheizung verlegen'],
];
for (const [a, b] of warnen) {
  const s = ktAehnlichkeit(a, b);
  pruef(s >= WARN, `sollte warnen (≥${WARN}): "${a}" / "${b}" → ${s.toFixed(2)}`);
}

// ── C. Darf NICHT warnen (fachlich verschiedene Tätigkeiten) ──────────────
const nichtWarnen = [
  ['Waschtisch montiert', 'Heizkessel gereinigt'],
  ['Kaltwasserleitung verlegt', 'Lüftungskanal isoliert'],
  ['Druckprüfung durchgeführt', 'Radiator angeschlossen'],
  ['Spülkasten eingebaut', 'Bodenheizung verlegt'],
  ['Steigzone montiert', 'Filter gewechselt'],
];
for (const [a, b] of nichtWarnen) {
  const s = ktAehnlichkeit(a, b);
  pruef(s < WARN, `darf nicht warnen (<${WARN}): "${a}" / "${b}" → ${s.toFixed(2)}`);
}

// ── D. Live-Suche ab 3 Zeichen findet den passenden Eintrag ────────────────
// Die Suche nutzt zusätzlich einen reinen Teilstring-Treffer; hier wird das
// Ähnlichkeitsmass allein geprüft, also die schwierigere Hälfte.
const liveTreffer = [
  ['Waschtisch mont', 'Waschtisch montiert'],
  ['Kaltwasserleitung', 'Kaltwasserleitung verlegt'],
  ['Radiator', 'Radiatoren angeschlossen'],
];
for (const [q, ziel] of liveTreffer) {
  const s = ktAehnlichkeit(q, ziel);
  pruef(s >= LIVE, `Live-Suche sollte finden (≥${LIVE}): "${q}" → "${ziel}" = ${s.toFixed(2)}`);
}

// ── E. Symmetrie und Wertebereich ─────────────────────────────────────────
const alle = [...gleich, ...warnen, ...nichtWarnen, ...liveTreffer];
for (const [a, b] of alle) {
  const s1 = ktAehnlichkeit(a, b), s2 = ktAehnlichkeit(b, a);
  pruef(Math.abs(s1 - s2) < 1e-9, `unsymmetrisch: "${a}" / "${b}" → ${s1.toFixed(3)} vs ${s2.toFixed(3)}`);
  pruef(s1 >= 0 && s1 <= 1, `ausserhalb 0..1: "${a}" / "${b}" → ${s1}`);
}
// Leere/unsinnige Eingaben dürfen nicht werfen.
for (const [a, b] of [['', 'Waschtisch'], ['   ', '---'], ['x', 'y']]) {
  const s = ktAehnlichkeit(a, b);
  pruef(Number.isFinite(s) && s >= 0 && s <= 1, `Randfall liefert ${s} bei "${a}"/"${b}"`);
}

// ── Ausgabe ───────────────────────────────────────────────────────────────
console.log('Katalog-Ähnlichkeit — Duplikatschutz');
console.log('─'.repeat(58));
console.log(`Warn-Schwelle ${WARN} · Live-Schwelle ${LIVE}`);
console.log(`Prüfungen: ${ok + fail}`);
console.log('─'.repeat(58));
if (fail) {
  console.log(`✗ ${fail} FEHLER:`);
  fehler.forEach((f) => console.log('   · ' + f));
} else {
  console.log(`✓ alle ${ok} Prüfungen bestanden`);
}
// Abstandsprobe: wie weit liegen "muss warnen" und "darf nicht" auseinander?
const minWarn = Math.min(...warnen.map(([a, b]) => ktAehnlichkeit(a, b)));
const maxRuhig = Math.max(...nichtWarnen.map(([a, b]) => ktAehnlichkeit(a, b)));
console.log(`\nAbstand: schwächste Warnung ${minWarn.toFixed(2)} · stärkster Nicht-Treffer ${maxRuhig.toFixed(2)}` +
  `  → Puffer ${(minWarn - maxRuhig).toFixed(2)}`);
process.exit(fail ? 1 : 0);
