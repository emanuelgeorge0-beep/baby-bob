// scripts/test_pdf.mjs — Strukturprüfung des PDF-Motors (lib/pdf.js).
//   node scripts/test_pdf.mjs            → nur prüfen
//   PDF_TEST_OUT=/tmp node scripts/test_pdf.mjs → zusätzlich Muster-PDFs schreiben
import fs from 'node:fs';
import {
  buildPdf, buildRapportPdf, buildMaterialPdf, buildBlockadePdf,
  buildBlockadenReportPdf, buildRechnungPdf, jpegInfo, textWidth, wrapText, clipText,
} from '../lib/pdf.js';

const OUT = process.env.PDF_TEST_OUT || null;
let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };

// ── PDF-Struktur validieren ────────────────────────────────────────────────
function validate(buf, name) {
  const s = buf.toString('latin1');
  ok(s.startsWith('%PDF-1.4'), `${name}: Header`);
  ok(s.endsWith('%%EOF'), `${name}: EOF`);

  const sx = s.lastIndexOf('startxref');
  ok(sx > 0, `${name}: startxref vorhanden`);
  const xrefStart = parseInt(s.slice(sx + 9).trim(), 10);
  ok(s.slice(xrefStart, xrefStart + 4) === 'xref', `${name}: startxref zeigt auf 'xref' (ist: ${JSON.stringify(s.slice(xrefStart, xrefStart + 8))})`);

  const m = s.slice(xrefStart).match(/^xref\n0 (\d+)\n/);
  ok(!!m, `${name}: xref-Kopf parsebar`);
  if (!m) return null;
  const count = parseInt(m[1], 10);
  // Erster Eintrag ist der Frei-Eintrag (0000000000 65535 f) → 20 Bytes überspringen.
  const body = s.slice(xrefStart + m[0].length + 20);
  const entries = [];
  for (let i = 0; i < count - 1; i++) {
    const e = body.slice(i * 20, i * 20 + 20);
    entries.push(parseInt(e.slice(0, 10), 10));
  }
  ok(entries.length === count - 1, `${name}: ${count - 1} Einträge`);
  // Jeder Offset muss byte-genau auf "<n> 0 obj" zeigen.
  let bad = 0;
  entries.forEach((off, i) => {
    const expect = `${i + 1} 0 obj`;
    if (s.slice(off, off + expect.length) !== expect) {
      bad++;
      if (bad <= 2) console.log(`      Objekt ${i + 1}: Offset ${off} → ${JSON.stringify(s.slice(off, off + 20))}, erwartet ${JSON.stringify(expect)}`);
    }
  });
  ok(bad === 0, `${name}: alle ${entries.length} xref-Offsets byte-genau (${bad} falsch)`);

  const pagesObj = s.match(/\/Type\/Pages\/Kids\[([^\]]*)\]\/Count (\d+)/);
  ok(!!pagesObj, `${name}: Pages-Objekt`);
  const nPages = pagesObj ? parseInt(pagesObj[2], 10) : 0;
  const kidCount = pagesObj ? (pagesObj[1].match(/\d+ 0 R/g) || []).length : 0;
  ok(nPages === kidCount, `${name}: Count ${nPages} == Kids ${kidCount}`);
  ok((s.match(/\/Type\/Page[^s]/g) || []).length === nPages, `${name}: ${nPages} Page-Objekte`);

  // Jeder /Length muss zur tatsächlichen Streamlänge passen.
  let lenBad = 0;
  const re = /<<\/Length (\d+)>>\nstream\n/g;
  let mm;
  while ((mm = re.exec(s))) {
    const declared = parseInt(mm[1], 10);
    const start = mm.index + mm[0].length;
    const end = s.indexOf('\nendstream', start);
    if (end - start !== declared) { lenBad++; console.log(`      /Length ${declared} != ${end - start}`); }
  }
  ok(lenBad === 0, `${name}: Content-Stream /Length korrekt`);

  return { nPages, size: buf.length };
}

console.log('── 1. jpegInfo ──────────────────────────────────────────');
const logo = fs.readFileSync(new URL('../lib/logo-gs.jpg', import.meta.url));
const info = jpegInfo(logo);
console.log('  Logo:', JSON.stringify(info));
ok(info && info.width === 723 && info.height === 395, 'Logo 723x395 erkannt');
ok(info && info.components === 3, 'Logo 3 Komponenten → DeviceRGB');
ok(info && !info.progressive, 'Logo ist baseline (nicht progressiv)');
ok(jpegInfo(Buffer.from('nicht jpeg')) === null, 'Nicht-JPEG → null');
ok(jpegInfo(fs.readFileSync(new URL('../lib/logo-gs.png', import.meta.url))) === null, 'PNG → null (kein SOI)');

console.log('\n── 2. Textmessung ───────────────────────────────────────');
// AFM-Sollwert: H722 + e556 + l222 + l222 + o556 = 2278/1000 * 10pt = 22.78pt
ok(Math.abs(textWidth('Hello', 10, false) - 22.78) < 0.001, `Helvetica "Hello"@10 = 22.78pt (ist ${textWidth('Hello', 10, false)})`);
// 'M' ist in beiden Schnitten 833 breit — für den Vergleich Buchstaben nehmen,
// die sich tatsächlich unterscheiden (b 556→611, c 500→556).
ok(textWidth('abc', 10, true) > textWidth('abc', 10, false), 'Bold breiter als Regular');
ok(textWidth('MMM', 10, true) === textWidth('MMM', 10, false), 'M in beiden Schnitten 833 (AFM-Kontrolle)');
ok(textWidth('Ärger', 10, false) > 0, 'Umlaut messbar');
const w = wrapText('Das ist ein ziemlich langer Satz der umbrechen muss weil er nicht passt', 100, 10, false);
ok(w.length > 1, `Umbruch greift (${w.length} Zeilen)`);
ok(w.every((l) => textWidth(l, 10, false) <= 100), 'keine Zeile breiter als das Limit');
const hard = wrapText('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 50, 10, false);
ok(hard.length > 1 && hard.every((l) => textWidth(l, 10, false) <= 50), 'überlanges Wort wird hart zerlegt');
ok(clipText('abcdefghijklmnop', 30, 10, false).endsWith('…'), 'clipText kürzt mit Ellipse');
ok(clipText('ab', 100, 10, false) === 'ab', 'clipText lässt Kurzes in Ruhe');

console.log('\n── 2b. WinAnsi-Zeichen (Bestandsbug: – wurde zu ?) ──────');
const zt = buildPdf({ blocks: [{ t: 'text', text: 'Strich – Gedanke — Punkte … Bullet • Haken ✓ Quotes “x” Mitte · Zürich' }] });
ok(!zt.toString('latin1').includes('?'), 'kein Fragezeichen mehr im Stream');
ok(zt.toString('latin1').includes('\\226'), 'Endash als WinAnsi \\226');
ok(zt.toString('latin1').includes('\\205'), 'Ellipse als WinAnsi \\205');
ok(zt.toString('latin1').includes('\\225'), 'Bullet als WinAnsi \\225');
ok(buildRapportPdf({ projekt_name: null }).toString('latin1').includes('\\226'), 'Tagesrapport-Platzhalter – druckt korrekt');
ok(textWidth('é', 10, false) === textWidth('e', 10, false), 'Akzent läuft wie Grundbuchstabe');
ok(textWidth('—', 10, false) === 10, 'Emdash = 1000/1000 em');
ok(textWidth('✓', 10, false) === 0, '✓ misst 0 (wird ersetzt)');
ok(textWidth('ß', 10, false) === 6.11, 'ß = 611');
ok(textWidth('中', 10, false) === textWidth('?', 10, false), 'unbekannte Schrift misst wie ihr Platzhalter');

console.log('\n── 3. Bestehende Dokumente (Regression) ─────────────────');
const rap = buildRapportPdf({ projekt_name: 'Villa Zürich', datum: '2026-08-03', gesamtstunden: 8, arbeiten: ['Montage'], material: ['Pumpe'], team: ['A'], foto_urls: [] });
const rv = validate(rap, 'Tagesrapport'); ok(rv && rv.nPages === 1, 'Tagesrapport bleibt einseitig');
const mat = buildMaterialPdf({ projektName: 'P', projektnummer: 'X', vonName: 'E', positionen: [{ position: 'Rohr', menge: 3, einheit: 'm' }] });
const mv = validate(mat, 'Materialliste'); ok(mv && mv.nPages === 1, 'Materialliste einseitig');
validate(buildBlockadePdf({ beschreibung: 'Rohr fehlt', urgency: 'HIGH' }), 'Blockade');
validate(buildRechnungPdf({ rechnungsnummer: 'R-1', stunden: 8, stundensatz: 70, betrag: 560 }), 'Rechnung');

console.log('\n── 4. Mehrseitigkeit ────────────────────────────────────');
const many = Array.from({ length: 40 }, (_, i) => ({
  urgency: 'HIGH', step_ref: 'Step ' + i, status: 'offen',
  beschreibung: 'Sehr ausführliche Beschreibung Nummer ' + i + ', die absichtlich lang ist damit sie über mehrere Zeilen umbricht und der Bericht mehrere Seiten braucht.',
}));
const blk = buildBlockadenReportPdf({ kw: 31, jahr: 2026, blockaden: many });
const bv = validate(blk, 'Blockadenreport 40x');
ok(bv && bv.nPages > 1, `Blockadenreport bricht um (${bv && bv.nPages} Seiten)`);
ok(blk.toString('latin1').includes('Seite 1 von ' + (bv && bv.nPages)), 'Fusszeile mit Seitenzahl');

console.log('\n── 5. Tabelle + Bilder + Logo ───────────────────────────');
const rows = Array.from({ length: 60 }, (_, i) => [
  `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
  'Emanuel George',
  'Sanitär',
  { text: '8.00', align: 'right' },
  'Brausetasse installiert bis in den dritten Stock, Steigleitung geprüft und abgedichtet',
]);
const doc = buildPdf({
  title: 'Wochenbericht',
  subtitle: 'KW 31/2026 · Langstrasse 149, 8004 Zürich',
  logo,
  footer: 'WB-GSO-2026-31',
  blocks: [
    { t: 'h2', text: 'Übersicht' },
    { t: 'kv', label: 'Projekt', value: 'Langstrasse 149 8004 Zürich Schweiz' },
    { t: 'rule', gold: true },
    {
      t: 'table',
      cols: [{ w: 60, label: 'Datum' }, { w: 90, label: 'Techniker' }, { w: 60, label: 'Gewerk' }, { w: 40, label: 'Std', align: 'right' }, { w: 200, label: 'Arbeiten' }],
      rows,
    },
    { t: 'h2', text: 'Fotos' },
    { t: 'imgrow', images: [logo, logo, logo, logo, logo], perRow: 3, captions: ['Bad OG', 'Steigzone', 'Küche', 'WC', 'Technik'] },
    { t: 'img', data: logo, maxH: 160 },
  ],
});
const dv = validate(doc, 'Wochenbericht-Muster');
ok(dv && dv.nPages >= 3, `Tabelle über mehrere Seiten (${dv && dv.nPages})`);
const ds = doc.toString('latin1');
ok(ds.includes('/Filter/DCTDecode'), 'JPEG als DCTDecode eingebettet');
ok((ds.match(/\/Subtype\/Image/g) || []).length === 1, 'Logo nur EINMAL eingebettet (dedupliziert)');
ok(ds.includes('/ColorSpace /DeviceRGB'), 'DeviceRGB gesetzt');
ok((ds.match(/\/Im0 Do/g) || []).length >= 3 + 6, 'Logo auf jeder Seite + in den Bildblöcken gezeichnet');
ok(ds.includes('0.788 0.663 0.380 RG'), 'goldene Linie #C9A961');
// Kopfzeile der Tabelle muss sich auf jeder Seite wiederholen
ok((ds.match(/\(Techniker\) Tj/g) || []).length >= dv.nPages - 1, 'Tabellenkopf wiederholt sich');

console.log('\n── 6. Randfälle ─────────────────────────────────────────');
validate(buildPdf({ blocks: [] }), 'leeres Dokument');
validate(buildPdf({ title: 'Nur Titel', blocks: [{ t: 'text', text: '' }] }), 'leerer Text');
validate(buildPdf({ logo, title: 'Nur Logo', blocks: [] }), 'nur Logo');
const kaputt = buildPdf({ blocks: [{ t: 'img', data: Buffer.from('kein jpeg hier drin') }] });
validate(kaputt, 'kaputtes Bild');
ok(kaputt.toString('latin1').includes('nicht darstellbar'), 'kaputtes Bild wird benannt statt verschluckt');
validate(buildPdf({ blocks: [{ t: 'table', cols: [{ w: 100, label: 'A' }], rows: [] }] }), 'Tabelle ohne Zeilen');
validate(buildPdf({ blocks: [{ t: 'text', text: 'Ümläüte äöü ÄÖÜ ß é è à ç € £ ° und ein 中文 Zeichen' }] }), 'Sonderzeichen');

if (OUT) {
  fs.writeFileSync(OUT + '/muster-wochenbericht.pdf', doc);
  fs.writeFileSync(OUT + '/muster-blockaden.pdf', blk);
  fs.writeFileSync(OUT + '/muster-rapport.pdf', rap);
  console.log('Muster geschrieben nach ' + OUT);
}

console.log(`\n${fail === 0 ? '✓ ALLE' : '✗ ' + fail + ' FEHLER ·'} ${pass} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
