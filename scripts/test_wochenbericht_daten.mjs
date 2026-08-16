// scripts/test_wochenbericht_daten.mjs — Datensammel-Schicht gegen die LIVE-DB.
// Rein lesend. Kein INSERT, kein UPDATE, kein DELETE.
//   node --env-file=.env.local scripts/test_wochenbericht_daten.mjs
import { sammleWochendaten, isoWochenBereich, isoWocheVonDatum } from '../lib/wochenbericht.js';

const P_LIVE = '64c695d5-0ef7-4864-9951-ed7163a92791';  // Langstrasse 149, KW29–31/2026
const P_ALT = '3336e6f1-6d1b-4bc9-8221-44d528333a84';   // die zwei Altzeilen ohne woche/jahr

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };

console.log('── ISO-Wochenbereich ────────────────────────────────────');
// 2026-01-01 ist ein Donnerstag → KW1 läuft Mo 2025-12-29 .. So 2026-01-04.
ok(isoWochenBereich(2026, 1).von === '2025-12-29', `KW1/2026 Montag = 2025-12-29 (ist ${isoWochenBereich(2026, 1).von})`);
ok(isoWochenBereich(2026, 1).bis === '2026-01-04', 'KW1/2026 Sonntag = 2026-01-04');
ok(isoWochenBereich(2026, 31).von === '2026-07-27', `KW31/2026 Montag = 2026-07-27 (ist ${isoWochenBereich(2026, 31).von})`);
ok(isoWochenBereich(2026, 31).bis === '2026-08-02', 'KW31/2026 Sonntag = 2026-08-02');
// Rundreise: jedes Datum im Bereich muss zurück auf dieselbe KW zeigen.
let rt = 0;
for (let w = 1; w <= 53; w++) {
  const { von, bis } = isoWochenBereich(2026, w);
  for (const d of [von, bis]) {
    const back = isoWocheVonDatum(d);
    if (back.woche !== w) rt++;
  }
}
ok(rt === 0, `Rundreise KW→Datum→KW für alle 53 Wochen (${rt} Abweichungen)`);

console.log('\n── Live: Projekt mit Daten, KW31/2026 ───────────────────');
const d31 = await sammleWochendaten({ projektId: P_LIVE, jahr: 2026, woche: 31 });
console.log(`  Kopf: ${d31.kopf.titel} · Nr ${d31.kopf.nummer} · Kürzel ${d31.kopf.kuerzel || '(leer)'}`);
console.log(`  Bereich: ${d31.kopf.von} .. ${d31.kopf.bis}`);
console.log(`  Tage: ${d31.tage.length} · Zeilen: ${d31.summen.zeilen} · Stunden: ${d31.summen.stunden}`);
ok(d31.kopf.nummer === 'P-2026-3470', 'Projektnummer aus der DB');
ok(d31.kopf.von === '2026-07-27' && d31.kopf.bis === '2026-08-02', 'Datumsbereich korrekt');
ok(d31.tage.length === 7, `7 Tage gebucht (ist ${d31.tage.length})`);
// Nicht mehr gegen eine feste Zahl prüfen: die Live-Stunden ändern sich, sobald
// jemand eine Zeile korrigiert (nach der Bereinigung vom 16.08. sind es 42statt 40).
// Geprüft wird, was die Schicht wirklich leisten muss — dass die Summe zu den
// Tagen passt und nicht irgendwo doppelt oder gar nicht gezählt wird.
const summeAusTagen = Math.round(d31.tage.reduce((a, t) => a + t.stunden, 0) * 100) / 100;
ok(d31.summen.stunden === summeAusTagen, `Wochensumme = Summe der Tage (${d31.summen.stunden} vs ${summeAusTagen})`);
ok(d31.summen.stunden > 0, `Stunden erfasst (ist ${d31.summen.stunden})`);
ok(d31.tage.every((t) => t.datum >= d31.kopf.von && t.datum <= d31.kopf.bis), 'kein Tag ausserhalb des Bereichs');
ok(d31.tage.every((t, i, a) => i === 0 || a[i - 1].datum < t.datum), 'chronologisch sortiert');
ok(d31.tage[0].wochentag === 'Montag', `erster Tag ist Montag (ist ${d31.tage[0].wochentag})`);
ok(d31.tage.every((t) => t.zeilen.length > 0), 'jeder Tag hat mindestens eine Technikerzeile');
ok(d31.tage.every((t) => t.zeilen.every((z) => z.techniker && !z.techniker.startsWith('Unbekannt'))), 'Techniker namentlich aufgelöst');
ok(d31.kopf.quelle === 'projekt' && d31.kopf.ziel_id === P_LIVE, 'Kopf trägt quelle + ziel_id');
// Neutrales Vokabular — Voraussetzung dafür, dass Service später nichts am PDF ändert
ok(!('projekt_name' in d31.kopf) && !('projektnummer' in d31.kopf), 'Kopf-Vokabular ist quellenneutral (kein projekt_*)');

console.log('\n── Live: Einreichstatus, gemischt ───────────────────────');
for (const e of d31.einreichstatus) console.log(`  ${e.techniker}: ${e.status}${e.grund ? ' — ' + e.grund : ''}`);
ok(d31.einreichstatus.length > 0, 'Einreichstatus nicht leer');
ok(d31.einreichstatus.some((e) => e.status === 'eingereicht'), 'KW31 ist eingereicht (Wochenkopf)');
ok(d31.einreichstatus.every((e) => ['eingereicht', 'entwurf', 'unbekannt', 'nichts erfasst'].includes(e.status)), 'nur bekannte Statuswerte');
ok(d31.einreichstatus.every((e) => e.status !== 'unbekannt' || e.grund), 'jedes "unbekannt" nennt einen Grund');

console.log('\n── Live: KW30 — Status kommt aus dem Wochenkopf ─────────');
// Der Kern der Regel: gs_wochenrapporte.status ist die Wahrheit,
// gs_tagesrapporte.status (Altfeld) wird NICHT gelesen. Früher stand hier fest
// 'entwurf' — das war der damalige Live-Zustand, kein Verhalten. Jetzt wird der
// Wochenkopf selbst gelesen und verglichen; damit hält die Prüfung jeden Stand aus.
const d30 = await sammleWochendaten({ projektId: P_LIVE, jahr: 2026, woche: 30 });
const e30 = d30.einreichstatus.find((e) => e.hat_gebucht);
const kopfR = await fetch(`${process.env.SUPABASE_URL}/rest/v1/gs_wochenrapporte`
  + `?techniker_user_id=eq.${e30.techniker_user_id}&jahr=eq.2026&woche=eq.30&select=status&limit=1`,
{ headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` } });
const kopf30 = ((await kopfR.json()) || [])[0];
const erwartet = kopf30 ? (kopf30.status === 'eingereicht' ? 'eingereicht' : 'entwurf') : 'unbekannt';
console.log(`  ${e30.techniker}: ${e30.status} · Wochenkopf sagt ${kopf30 ? kopf30.status : '(keiner)'}`);
ok(e30.status === erwartet, `Status folgt dem Wochenkopf (ist ${e30.status}, erwartet ${erwartet})`);

console.log('\n── Live: Altzeilen ohne woche/jahr ──────────────────────');
// Abfrage über `datum`, nicht über woche/jahr — Zeilen mit woche IS NULL wären
// sonst unsichtbar. Der frühere Fixtursatz (2026-07-13/14) ist mit der
// Bereinigung vom 16.08. gelöscht worden. Die Prüfung läuft weiter, sobald es
// wieder solche Zeilen gibt; sie wird NICHT auf 0 umgeschrieben, denn dann
// stünde hier ein grüner Haken für eine Regel, die niemand mehr testet.
const dAlt = await sammleWochendaten({ projektId: P_ALT, jahr: 2026, woche: 29 });
console.log(`  Zeilen gefunden: ${dAlt.summen.zeilen} · Tage: ${dAlt.tage.map((t) => t.datum).join(', ')}`);
if (dAlt.summen.zeilen) {
  ok(dAlt.hinweise.some((h) => h.includes('vor dem Wochenblatt')), 'Altzeilen werden im Bericht benannt');
  ok(dAlt.einreichstatus.some((e) => e.status === 'unbekannt'), 'ohne Wochenkopf → unbekannt, nicht weggelassen');
} else {
  console.log('  ⚠ übersprungen: in der DB liegen keine Altzeilen mehr (Bereinigung 16.08.2026)');
}

console.log('\n── Live: leere Woche ────────────────────────────────────');
const leer = await sammleWochendaten({ projektId: P_LIVE, jahr: 2026, woche: 2 });
ok(leer.tage.length === 0 && leer.summen.stunden === 0, 'leere Woche liefert leere Struktur');
ok(leer.hinweise.some((h) => h.includes('nichts gebucht')), 'leere Woche wird benannt');
ok(leer.fotos_vorhanden === false && leer.material_vorhanden === false, 'Flags für Fotos/Material stehen auf false');
ok(Array.isArray(leer.einreichstatus), 'Einreichstatus auch leer wohlgeformt');

console.log('\n── Fotos / Material (live noch keine Daten) ─────────────');
console.log(`  Fotos: ${d31.fotos.length} · Material: ${d31.material.length}`);
ok(d31.fotos_vorhanden === (d31.fotos.length > 0), 'fotos_vorhanden stimmt mit der Liste überein');
ok(d31.material_vorhanden === (d31.material.length > 0), 'material_vorhanden stimmt mit der Liste überein');
ok(!d31.fotos.length ? d31.hinweise.some((h) => h.includes('keine Fotos')) : true, 'fehlende Fotos werden gekennzeichnet');

console.log('\n── Service: vorbereitet, ungebaut ───────────────────────');
const svc = await sammleWochendaten({ quelle: 'service', serviceAuftragId: 'c3d376a5-f232-4986-9708-ecb36c18cd07', jahr: 2026, woche: 31 });
ok(svc.tage.length === 0 && svc.fotos.length === 0, 'Service liefert leere Listen');
ok(svc.kopf.quelle === 'service', 'Service-Kopf trägt quelle=service');
ok(svc.hinweise.some((h) => h.includes('nicht gebaut')), 'Service wird ehrlich als ungebaut gemeldet');
ok(Object.keys(svc.kopf).join() === Object.keys(d31.kopf).join(), 'Service-Kopf hat dieselbe Form wie Projekt-Kopf');

console.log('\n── Fehlerfälle ──────────────────────────────────────────');
for (const [args, was] of [
  [{ projektId: P_LIVE, jahr: 2026, woche: 0 }, 'KW 0'],
  [{ projektId: P_LIVE, jahr: 2026, woche: 54 }, 'KW 54'],
  [{ projektId: P_LIVE, jahr: 1999, woche: 5 }, 'Jahr 1999'],
  [{ jahr: 2026, woche: 31 }, 'ohne projekt_id'],
]) {
  let warf = false;
  try { await sammleWochendaten(args); } catch (_) { warf = true; }
  ok(warf, `${was} wird abgelehnt`);
}
let nf = false;
try { await sammleWochendaten({ projektId: '00000000-0000-0000-0000-000000000000', jahr: 2026, woche: 31 }); } catch (_) { nf = true; }
ok(nf, 'unbekanntes Projekt wird abgelehnt');

console.log(`\n${fail === 0 ? '✓ ALLE' : '✗ ' + fail + ' FEHLER ·'} ${pass} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
