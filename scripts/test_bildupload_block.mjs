// scripts/test_bildupload_block.mjs — der Bildupload-Block muss in beiden
// Oberflächen WORTGLEICH stehen.
//
//   node scripts/test_bildupload_block.mjs
//
// Warum das ein Test ist und kein gemeinsames Modul:
// vercel.json gibt jeder Root-JS-Datei ein Jahr `Cache-Control: immutable`,
// und cockpit-sw.js legt statische Dateien zusätzlich cache-first ab. Eine
// gemeinsame bildupload.js wäre in jedem Browser eingefroren und im Cockpit
// hinter dem Service-Worker-Cache — jede Korrektur bräuchte einen neuen
// Dateinamen UND einen Cache-Bump. app.html und gs-intern.html sind dagegen
// no-store bzw. network-first.
//
// Der Preis dafür sind zwei Kopien. Damit sie nicht auseinanderlaufen, prüft
// dieser Test sie Zeichen für Zeichen. Er ist die Gegenleistung für die
// Doppelung — ohne ihn wäre sie fahrlässig.

import { readFileSync } from 'node:fs';

const START = '==BILDUPLOAD-V1-START==';
const ENDE = '==BILDUPLOAD-V1-ENDE==';
const DATEIEN = ['app.html', 'gs-intern.html'];

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

function bloeckeAus(datei) {
  const txt = readFileSync(new URL('../' + datei, import.meta.url), 'utf8');
  const starts = [...txt.matchAll(new RegExp(START, 'g'))].map((m) => m.index);
  const enden = [...txt.matchAll(new RegExp(ENDE, 'g'))].map((m) => m.index);
  return { txt, starts, enden };
}

console.log('\n══ BILDUPLOAD-BLOCK ══\n');

const bloecke = {};
for (const d of DATEIEN) {
  const { txt, starts, enden } = bloeckeAus(d);
  ok(starts.length === 1, `${d}: genau EIN Startmarker (${starts.length})`);
  ok(enden.length === 1, `${d}: genau EIN Endmarker (${enden.length})`);
  if (starts.length !== 1 || enden.length !== 1) continue;
  ok(starts[0] < enden[0], `${d}: Start steht vor Ende`);
  // Vom Blockanfang (die Zeile mit dem Startmarker beginnt mit "/*") bis
  // einschliesslich des Endmarker-Kommentars.
  const von = txt.lastIndexOf('/*', starts[0]);
  const bis = txt.indexOf('*/', enden[0]) + 2;
  bloecke[d] = txt.slice(von, bis);
  ok(bloecke[d].length > 1500, `${d}: der Block hat Inhalt (${bloecke[d].length} Zeichen)`);
}

if (Object.keys(bloecke).length === DATEIEN.length) {
  const [a, b] = DATEIEN.map((d) => bloecke[d]);
  const gleich = a === b;
  ok(gleich, `beide Blöcke sind zeichengleich (${a.length} / ${b.length} Zeichen)`);
  if (!gleich) {
    // Erste abweichende Zeile nennen — sonst sucht man von Hand.
    const za = a.split('\n'), zb = b.split('\n');
    for (let i = 0; i < Math.max(za.length, zb.length); i++) {
      if (za[i] !== zb[i]) {
        console.log(`\n  Erste Abweichung in Zeile ${i + 1} des Blocks:`);
        console.log(`    ${DATEIEN[0]}: ${JSON.stringify(za[i])}`);
        console.log(`    ${DATEIEN[1]}: ${JSON.stringify(zb[i])}`);
        break;
      }
    }
  }

  // Die drei Namen, an denen die Aufrufer hängen. Wer sie umbenennt, muss es
  // in beiden Dateien tun — und in allen fünf Aufrufstellen.
  for (const name of ['bildIstBild', 'bildVorschauImmer', 'bildOriginalHochladen']) {
    ok(a.includes(`function ${name}(`), `der Block definiert ${name}()`);
  }
  // Die Grenze muss zu api/cockpit.js passen.
  ok(/BILD_MAX_BYTES=25\*1024\*1024/.test(a.replace(/\s/g, '')),
    'BILD_MAX_BYTES steht auf 25 MB (wie FOTO_MAX_BYTES im Server)');
  const server = readFileSync(new URL('../api/cockpit.js', import.meta.url), 'utf8');
  ok(/const FOTO_MAX_BYTES = 25 \* 1024 \* 1024;/.test(server),
    'und der Server hält dieselbe Zahl');
}

// Der alte, verkleinernde Weg darf NICHT mehr der normale sein.
{
  const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const cockpit = readFileSync(new URL('../gs-intern.html', import.meta.url), 'utf8');
  // Fünf Aufrufstellen: pmDoUpload, subDoUpload, tcMediaUpload,
  // tcRowMediaUpload (app.html) und pmUploadFiles (gs-intern.html).
  const n = (app.match(/bildOriginalHochladen\(/g) || []).length - 1;   // minus Definition
  ok(n === 4, `app.html ruft den Direktweg an 4 Stellen (${n})`);
  const m = (cockpit.match(/bildOriginalHochladen\(/g) || []).length - 1;
  ok(m === 1, `gs-intern.html ruft ihn an 1 Stelle (${m})`);
  ok(!/bildVorschau\(/.test(app) && !/bildVorschau\(/.test(cockpit),
    'die alte bildVorschau() ist überall ersetzt');
}

console.log(`\n${'═'.repeat(60)}`);
console.log(fail ? `❌ ${fail} Prüfung(en) fehlgeschlagen, ${pass} grün` : `✅ alle ${pass} Prüfungen grün`);
process.exit(fail ? 1 : 0);
