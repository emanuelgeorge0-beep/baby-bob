// scripts/test_wochenbericht_pdf.mjs — Berichtserzeugung: Nummer, PDF, Snapshot.
// Schreibt in gs_wochenberichte und RÄUMT HINTERHER AUF (die Probezeilen werden
// gelöscht). gs_tagesrapporte wird ausschliesslich gelesen.
//   node --env-file=.env.local scripts/test_wochenbericht_pdf.mjs
//   PDF_TEST_OUT=/tmp node --env-file=.env.local scripts/test_wochenbericht_pdf.mjs
import fs from 'node:fs';
import {
  sammleWochendaten, berichtNummer, buildWochenberichtPdf, erzeugeBericht, ladeLogo, fotoCaption,
} from '../lib/wochenbericht.js';

const P_LIVE = '64c695d5-0ef7-4864-9951-ed7163a92791';
const OUT = process.env.PDF_TEST_OUT || null;
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };
const aufraeumen = [];

// PDF-Grundstruktur (dieselbe Prüfung wie scripts/test_pdf.mjs, kurz gefasst).
function pdfOk(buf, name) {
  const s = buf.toString('latin1');
  ok(s.startsWith('%PDF-1.4') && s.endsWith('%%EOF'), `${name}: Rahmen`);
  const sx = s.lastIndexOf('startxref');
  const xs = parseInt(s.slice(sx + 9).trim(), 10);
  ok(s.slice(xs, xs + 4) === 'xref', `${name}: startxref zeigt auf xref`);
  const m = s.slice(xs).match(/^xref\n0 (\d+)\n/);
  const body = s.slice(xs + m[0].length + 20);
  let bad = 0;
  for (let i = 0; i < parseInt(m[1], 10) - 1; i++) {
    const off = parseInt(body.slice(i * 20, i * 20 + 10), 10);
    if (s.slice(off, off + `${i + 1} 0 obj`.length) !== `${i + 1} 0 obj`) bad++;
  }
  ok(bad === 0, `${name}: xref byte-genau (${bad} falsch)`);
  ok(!s.includes('?) Tj'), `${name}: keine unlesbaren Zeichen`);
  const pg = s.match(/\/Count (\d+)>>/);
  return pg ? parseInt(pg[1], 10) : 0;
}

console.log('── Berichtsnummer ───────────────────────────────────────');
ok(berichtNummer({ kuerzel: 'NIE', jahr: 2026, woche: 31 }) === 'WB-NIE-2026-31', 'mit Kürzel');
ok(berichtNummer({ kuerzel: null, nummer: 'P-2026-3470', jahr: 2026, woche: 31 }) === 'WB-P-2026-3470-2026-31', 'Fallback Projektnummer');
ok(berichtNummer({ jahr: 2026, woche: 31 }) === 'WB-GSO-2026-31', 'Fallback GSO');
ok(berichtNummer({ kuerzel: 'nie', jahr: 2026, woche: 5 }) === 'WB-NIE-2026-05', 'KW zweistellig, Kürzel gross');
ok(berichtNummer({ kuerzel: 'Bau Ost / 2', jahr: 2026, woche: 9 }) === 'WB-BAU-OST-2-2026-09', 'Sonderzeichen normalisiert');
ok(berichtNummer({ kuerzel: '///', jahr: 2026, woche: 9 }) === 'WB-GSO-2026-09', 'nur Sonderzeichen → GSO');
ok(berichtNummer({ kuerzel: 'X'.repeat(50), jahr: 2026, woche: 9 }).length <= 32, 'Länge begrenzt');
// Determinismus: dieselbe Woche muss immer dieselbe Nummer ergeben (kein Zähler).
ok(berichtNummer({ kuerzel: 'NIE', jahr: 2026, woche: 31 }) === berichtNummer({ kuerzel: 'NIE', jahr: 2026, woche: 31 }), 'deterministisch, kein Zähler');

console.log('\n── Logo ─────────────────────────────────────────────────');
const logo = await ladeLogo();
ok(Buffer.isBuffer(logo) && logo.length > 1000, `Logo geladen (${logo ? logo.length : 0} Bytes)`);

console.log('\n── PDF aus Live-Daten, KW31/2026 ────────────────────────');
const d31 = await sammleWochendaten({ projektId: P_LIVE, jahr: 2026, woche: 31 });
const pdf31 = buildWochenberichtPdf(d31, { logo, fotos: [], berichtNr: 'WB-P-2026-3470-2026-31' });
const seiten = pdfOk(pdf31, 'KW31');
console.log(`  ${pdf31.length} Bytes · ${seiten} Seite(n)`);
const s31 = pdf31.toString('latin1');
ok(s31.includes('Wochenbericht'), 'Titel im Dokument');
ok(s31.includes('WB-P-2026-3470-2026-31'), 'Berichtsnummer im Dokument');
ok(s31.includes('Tagesverlauf'), 'Tagesverlauf-Abschnitt');
ok(s31.includes('Aufwand je Techniker'), 'Aufwand-je-Techniker-Abschnitt');
// Der interne Bearbeitungsstand des Wochenrapports gehört nicht ins Kundendokument.
ok(!/[Ee]ntwurf/.test(s31), 'kein interner Status ("entwurf") im Kunden-PDF');
ok(!s31.includes('Einreichstatus'), 'kein Einreichstatus-Abschnitt im Kunden-PDF');
ok(s31.includes('/Filter/DCTDecode'), 'Logo als JPEG eingebettet (Regel 6)');
ok(s31.includes('0.788 0.663 0.380 RG'), 'goldene Trennlinie #C9A961 (Regel 6)');
// Regel 6: helles Dokument. Keine dunkle Flächenfüllung.
ok(!/0(\.0+)? 0(\.0+)? 0(\.0+)? rg\s+[\d.]+ [\d.]+ [\d.]+ [\d.]+ re f/.test(s31), 'keine schwarze Flächenfüllung');
ok(!s31.includes('0.039 0.039 0.043'), 'kein Command-Center-Schwarz #0A0A0B');

console.log('\n── Material bedingt ─────────────────────────────────────');
ok(d31.material_vorhanden === false, 'live kein Material erfasst');
ok(!s31.includes('(Material) Tj'), 'kein Material-Abschnitt ohne Positionen — keine leere Überschrift');
const mitMat = JSON.parse(JSON.stringify(d31));
mitMat.material = [{ bezeichnung: 'Ventil DN15', menge: 3, datum: '2026-07-28', techniker: 'Emanuel George' }];
mitMat.material_vorhanden = true;
ok(buildWochenberichtPdf(mitMat, { logo, fotos: [] }).toString('latin1').includes('Ventil DN15'), 'mit Positionen erscheint der Abschnitt');

console.log('\n── Fotos: Kennzeichnung im Kopf + Deckelung bei 6 ───────');
ok(s31.includes('keine Fotos vor'), 'fehlende Fotos werden im Kopf gekennzeichnet');
const mitFotos = JSON.parse(JSON.stringify(d31));
mitFotos.fotos = Array.from({ length: 9 }, (_, i) => ({ id: 'f' + i, path: 'x/' + i + '.jpg', datum: '2026-07-28', ort: 'Bad OG' }));
mitFotos.fotos_vorhanden = true;
const bilder = Array.from({ length: 6 }, () => ({ buf: logo, caption: 'Probe' }));
const pf = buildWochenberichtPdf(mitFotos, { logo, fotos: bilder, berichtNr: 'WB-TEST-2026-31' });
pdfOk(pf, 'Fotoseite');
const sf = pf.toString('latin1');
ok(sf.includes('9 erfasst, 6 in diesem Bericht'), 'Kopf nennt erfasst vs. abgebildet');
ok(sf.includes('Weitere 3 Foto'), 'Rest als Verweis');
ok(sf.includes('gs-intern.html'), 'Verweis auf das Cockpit');
ok((sf.match(/\/Subtype\/Image/g) || []).length === 1, 'identische Bilder werden dedupliziert');
ok(fotoCaption({ datum: '2026-07-28', ort: 'Bad OG' }) === '28.07.2026 · Bad OG', 'Bildunterschrift');

console.log('\n── Leere Woche ──────────────────────────────────────────');
const leer = await sammleWochendaten({ projektId: P_LIVE, jahr: 2026, woche: 2 });
const pl = buildWochenberichtPdf(leer, { logo, fotos: [] });
pdfOk(pl, 'leere Woche');
ok(pl.toString('latin1').includes('nichts gebucht'), 'leere Woche sagt es im Dokument');

console.log('\n── erzeugeBericht gegen die DB (räumt auf) ──────────────');
const JAHR_PROBE = 2099;  // weit weg von echten Daten
const r1 = await erzeugeBericht({ projektId: P_LIVE, jahr: JAHR_PROBE, woche: 31 });
aufraeumen.push(r1.bericht.id);
console.log(`  Kopf ${r1.bericht.id.slice(0, 8)} · Nr ${r1.bericht.bericht_nr} · ${r1.pdf.length} Bytes`);
ok(r1.bericht.bericht_nr === 'WB-P-2026-3470-2099-31', `Nummer aus Fallback-Kette (ist ${r1.bericht.bericht_nr})`);
ok(r1.bericht.status === 'entwurf', 'neuer Kopf ist Entwurf');
ok(r1.aus_snapshot === false, 'frisch eingesammelt, nicht aus Snapshot');
pdfOk(r1.pdf, 'erzeugeBericht');

// get-or-create: zweiter Aufruf legt KEINEN zweiten Kopf an
const r2 = await erzeugeBericht({ projektId: P_LIVE, jahr: JAHR_PROBE, woche: 31 });
ok(r2.bericht.id === r1.bericht.id, 'zweiter Aufruf liefert denselben Kopf');
const alle = await (await fetch(`${U}/rest/v1/gs_wochenberichte?projekt_id=eq.${P_LIVE}&jahr=eq.${JAHR_PROBE}&woche=eq.31&select=id`, { headers: H })).json();
ok(alle.length === 1, `genau ein Kopf in der DB (sind ${alle.length})`);

// Parallelität: fünf gleichzeitige Erzeugungen, der UNIQUE-Index muss halten
const par = await Promise.all(Array.from({ length: 5 }, () => erzeugeBericht({ projektId: P_LIVE, jahr: JAHR_PROBE, woche: 32 })));
par.forEach((x) => { if (!aufraeumen.includes(x.bericht.id)) aufraeumen.push(x.bericht.id); });
const ids = new Set(par.map((x) => x.bericht.id));
const nach = await (await fetch(`${U}/rest/v1/gs_wochenberichte?projekt_id=eq.${P_LIVE}&jahr=eq.${JAHR_PROBE}&woche=eq.32&select=id`, { headers: H })).json();
ok(ids.size === 1 && nach.length === 1, `5 parallele Erzeugungen → 1 Kopf (ids ${ids.size}, DB ${nach.length})`);

console.log('\n── Snapshot friert ein ──────────────────────────────────');
const r3 = await erzeugeBericht({ projektId: P_LIVE, jahr: JAHR_PROBE, woche: 33, einfrieren: true });
aufraeumen.push(r3.bericht.id);
let row = (await (await fetch(`${U}/rest/v1/gs_wochenberichte?id=eq.${r3.bericht.id}&select=daten,status`, { headers: H })).json())[0];
ok(row.daten && row.daten.kopf, 'daten-Snapshot geschrieben');
ok(row.status === 'entwurf', 'Einfrieren allein versendet noch nicht');
// Auf versendet setzen und den Snapshot verfälschen: der Bericht muss den
// eingefrorenen Stand rendern, nicht die Live-Daten.
const gefaelscht = JSON.parse(JSON.stringify(row.daten));
gefaelscht.kopf.titel = 'EINGEFRORENER TITEL';
await fetch(`${U}/rest/v1/gs_wochenberichte?id=eq.${r3.bericht.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'versendet', daten: gefaelscht }) });
const r4 = await erzeugeBericht({ projektId: P_LIVE, jahr: JAHR_PROBE, woche: 33 });
ok(r4.aus_snapshot === true, 'versendeter Bericht kommt aus dem Snapshot');
ok(r4.pdf.toString('latin1').includes('EINGEFROREN'), 'gerendert wird der eingefrorene Stand, nicht die Live-Daten');

if (OUT) {
  fs.writeFileSync(OUT + '/wb-live-kw31.pdf', pdf31);
  fs.writeFileSync(OUT + '/wb-fotos.pdf', pf);
  fs.writeFileSync(OUT + '/wb-leer.pdf', pl);
  console.log('  Muster geschrieben nach ' + OUT);
}

// ── Aufräumen ──────────────────────────────────────────────────────────────
for (const id of aufraeumen) await fetch(`${U}/rest/v1/gs_wochenberichte?id=eq.${id}`, { method: 'DELETE', headers: H });
const rest = await (await fetch(`${U}/rest/v1/gs_wochenberichte?jahr=eq.${JAHR_PROBE}&select=id`, { headers: H })).json();
ok(rest.length === 0, `alle Probezeilen entfernt (${rest.length} übrig)`);

console.log(`\n${fail === 0 ? '✓ ALLE' : '✗ ' + fail + ' FEHLER ·'} ${pass} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
