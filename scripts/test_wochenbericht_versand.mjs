// scripts/test_wochenbericht_versand.mjs — Versand + Protokoll.
// Der Mailversand wird ATTRAPPIERT (sendMail wird hereingereicht) — es geht
// keine echte Mail raus. Schreibt nach gs_wochenberichte (Jahr 2098) und räumt
// hinterher auf. gs_tagesrapporte wird nur gelesen.
//   node --env-file=.env.local scripts/test_wochenbericht_versand.mjs
import { versendeBericht, empfaengerFuer } from '../lib/wochenbericht.js';
import { wochenberichtEmailHtml } from '../lib/mail.js';

const P_LIVE = '64c695d5-0ef7-4864-9951-ed7163a92791';
const JAHR = 2098;
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };
const gesendet = [];
const attrappe = async (m) => { gesendet.push(m); return { ok: true, id: 'test-' + gesendet.length }; };
const attrappeFehler = async (m) => { gesendet.push(m); return { ok: false, error: 'Resend meldet 422' }; };
const hole = async (id) => (await (await fetch(`${U}/rest/v1/gs_wochenberichte?id=eq.${id}&select=*`, { headers: H })).json())[0];

console.log('── Empfängerauflösung ───────────────────────────────────');
ok(empfaengerFuer({ angefragt: ['a@b.ch'], kopfRow: { empfaenger: ['k@b.ch'] }, daten: {} }).herkunft === 'angefragt', 'angefragt schlägt alles');
ok(empfaengerFuer({ kopfRow: { empfaenger: ['k@b.ch'] }, daten: {} }).herkunft === 'berichtskopf', 'dann Berichtskopf');
ok(empfaengerFuer({ kopfRow: {}, daten: { kopf: { ansprech_email: 'p@b.ch' } } }).herkunft === 'projekt-ansprechperson', 'dann Projekt-Ansprechperson');
ok(empfaengerFuer({ kopfRow: {}, daten: {} }).liste.length === 0, 'ohne alles: leer, KEIN Büro-Fallback');
ok(empfaengerFuer({ angefragt: 'a@b.ch, kaputt, c@d.ch' }).liste.join() === 'a@b.ch,c@d.ch', 'String wird zerlegt, Müll fliegt raus');
ok(empfaengerFuer({ angefragt: ['a@b.ch', 'a@b.ch'] }).liste.length === 1, 'Duplikate entfernt');
ok(empfaengerFuer({ angefragt: ['@nix', 'a@b'] }).liste.length === 0, 'ungültige Adressen verworfen');

console.log('\n── Versand ohne Empfänger → Fehler, kein Statuswechsel ──');
const r0 = await versendeBericht({ projektId: P_LIVE, jahr: JAHR, woche: 10, sendMail: attrappe, mailHtml: wochenberichtEmailHtml });
ok(r0.ok === false && /Empfängeradresse/.test(r0.error || ''), 'klarer Fehler statt stillem Versand');
ok(gesendet.length === 0, 'keine Mail abgesetzt');
const row0 = await hole(r0.bericht.id);
ok(row0.status === 'entwurf' && !row0.versendet_am, 'Kopf bleibt Entwurf');

console.log('\n── Versand mit Empfänger ────────────────────────────────');
const r1 = await versendeBericht({
  projektId: P_LIVE, jahr: JAHR, woche: 11, empfaenger: ['bauleiter@example.invalid'],
  sendMail: attrappe, mailHtml: wochenberichtEmailHtml,
});
ok(r1.ok === true && r1.versendet === true, 'Versand meldet Erfolg');
ok(gesendet.length === 1, 'genau eine Mail');
const m = gesendet[0];
ok(m.to.join() === 'bauleiter@example.invalid', 'Empfänger korrekt');
ok(/Wochenbericht KW 11\/2098/.test(m.subject), `Betreff nennt KW (ist: ${m.subject})`);
ok(/WB-P-2026-3470-2098-11/.test(m.subject), 'Betreff nennt die Berichtsnummer');
ok(m.attachments.length === 1 && /\.pdf$/.test(m.attachments[0].filename), 'PDF im Anhang');
const anhang = Buffer.from(m.attachments[0].content, 'base64');
ok(anhang.slice(0, 8).toString() === '%PDF-1.4', 'Anhang ist ein gültiges PDF');
ok(anhang.length > 10000, `Anhang hat Substanz (${anhang.length} Bytes)`);
ok(/WOCHENBERICHT/.test(m.html) && /KW 11/.test(m.html), 'Mailtext nennt den Bericht');
ok(/Techniker/.test(m.html), 'Mailtext zeigt die Kennzahlen');

console.log('\n── Zustand nach dem Versand ─────────────────────────────');
const row1 = await hole(r1.bericht.id);
ok(row1.status === 'versendet', 'Status versendet');
ok(!!row1.versendet_am, 'versendet_am gesetzt');
ok((row1.empfaenger || []).join() === 'bauleiter@example.invalid', 'Empfänger gespeichert');
ok(!!row1.daten && !!row1.daten.kopf, 'Snapshot eingefroren');
ok(!!row1.pdf_path, `PDF im Storage abgelegt (${row1.pdf_path})`);
if (Array.isArray(row1.versand_protokoll)) {
  ok(row1.versand_protokoll.length === 1, 'ein Protokolleintrag');
  ok(row1.versand_protokoll[0].ok === true && row1.versand_protokoll[0].an.length === 1, 'Eintrag vollständig');
  console.log('  Protokoll:', JSON.stringify(row1.versand_protokoll[0]).slice(0, 130) + '…');
} else {
  console.log('  ⚠ versand_protokoll fehlt — scripts/wochenbericht_versand.sql noch nicht ausgeführt.');
  ok(r1.protokoll_hinweis && /versand_protokoll/.test(r1.protokoll_hinweis), 'fehlende Spalte wird gemeldet, Versand läuft trotzdem');
}

console.log('\n── Zweiter Versand: Historie, Snapshot bleibt ───────────');
const r2 = await versendeBericht({
  projektId: P_LIVE, jahr: JAHR, woche: 11, empfaenger: ['kunde@example.invalid'],
  sendMail: attrappe, mailHtml: wochenberichtEmailHtml,
});
ok(r2.ok === true && r2.aus_snapshot === true, 'zweiter Versand rendert den eingefrorenen Stand');
const row2 = await hole(r1.bericht.id);
ok((row2.empfaenger || []).join() === 'kunde@example.invalid', 'letzter Empfänger überschreibt');
if (Array.isArray(row2.versand_protokoll)) {
  ok(row2.versand_protokoll.length === 2, `beide Versande protokolliert (sind ${row2.versand_protokoll.length})`);
  ok(row2.versand_protokoll[0].an[0] === 'bauleiter@example.invalid', 'erster Empfänger geht NICHT verloren');
}
ok(JSON.stringify(row2.daten.kopf) === JSON.stringify(row1.daten.kopf), 'Snapshot unverändert');

console.log('\n── Mailfehler: kein falscher Erfolg ─────────────────────');
const r3 = await versendeBericht({
  projektId: P_LIVE, jahr: JAHR, woche: 12, empfaenger: ['x@example.invalid'],
  sendMail: attrappeFehler, mailHtml: wochenberichtEmailHtml,
});
ok(r3.ok === false && /422/.test(r3.error || ''), 'Fehler wird durchgereicht');
const row3 = await hole(r3.bericht.id);
ok(row3.status !== 'versendet', 'Status bleibt Entwurf — nichts kam beim Bauleiter an');
if (Array.isArray(row3.versand_protokoll)) {
  ok(row3.versand_protokoll.length === 1 && row3.versand_protokoll[0].ok === false, 'Fehlversuch steht im Protokoll');
}

// ── Aufräumen ──────────────────────────────────────────────────────────────
// Storage-DELETE OHNE Content-Type: Supabase lehnt ein bodyloses DELETE mit
// 'application/json' mit 400 ab ("Body cannot be empty") — der Aufruf sähe
// erfolgreich aus und die Testdatei bliebe im Bucket liegen.
const H_STORAGE = { apikey: K, Authorization: `Bearer ${K}` };
const alle = await (await fetch(`${U}/rest/v1/gs_wochenberichte?jahr=eq.${JAHR}&select=id,pdf_path`, { headers: H })).json();
for (const r of alle) {
  if (r.pdf_path) {
    const d = await fetch(`${U}/storage/v1/object/projektdateien/${r.pdf_path}`, { method: 'DELETE', headers: H_STORAGE });
    ok(d.ok, `Storage-Datei entfernt: ${r.pdf_path} (HTTP ${d.status})`);
  }
  await fetch(`${U}/rest/v1/gs_wochenberichte?id=eq.${r.id}`, { method: 'DELETE', headers: H });
}
const rest = await (await fetch(`${U}/rest/v1/gs_wochenberichte?jahr=eq.${JAHR}&select=id`, { headers: H })).json();
ok(rest.length === 0, `Probezeilen entfernt (${rest.length} übrig)`);
// Der Bucket muss nach dem Test genauso leer sein wie vorher.
const uebrig = await (await fetch(`${U}/storage/v1/object/list/projektdateien`, {
  method: 'POST', headers: H, body: JSON.stringify({ prefix: `wochenberichte/${P_LIVE}`, limit: 100 }),
})).json();
const testreste = (Array.isArray(uebrig) ? uebrig : []).filter((x) => x.name && x.name.includes(`-${JAHR}-`));
ok(testreste.length === 0, `keine Test-PDFs im Storage zurückgelassen (${testreste.length} gefunden)`);

console.log(`\n${fail === 0 ? '✓ ALLE' : '✗ ' + fail + ' FEHLER ·'} ${pass} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
