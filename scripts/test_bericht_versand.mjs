// scripts/test_bericht_versand.mjs — Empfaenger-Vorbelegung + Versandweg.
//
// Prueft die beiden Dinge, die diese Runde gebaut hat:
//   B1  empfaengerFuer kennt fuenf Stufen; die Adresse des Bauleiters wird auch
//       dann gefunden, wenn sie NUR im Partnerprofil steht (der Live-Fall).
//   B3  Materialliste, Arbeitsrapporte und Rechnungs-History lassen sich
//       versenden — dasselbe PDF wie der Download, per Mail.
//
// Der Mailversand wird ATTRAPPIERT: Teil C reicht sendMail herein, Teil D
// startet den Dev-Server mit MAIL_ATTRAPPE=1. Es geht KEINE echte Mail raus.
//
// Geschrieben und wieder entfernt: gs_wochenberichte (Jahr 2097).
// Nur gelesen: gs_projekte, gs_kunden, gs_partner_profil, gs_tagesrapporte,
// gs_material, gs_rechnungen. gs_tagesrapporte wird NIE geschrieben.
//
//   node --env-file=.env.local scripts/test_bericht_versand.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { empfaengerFuer, EMPFAENGER_HERKUNFT_TEXT, sammleWochendaten, versendeBericht } from '../lib/wochenbericht.js';
import { wochenberichtEmailHtml, exportEmailHtml } from '../lib/mail.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.BV_TEST_PORT || 4402);
const BASE = `http://127.0.0.1:${PORT}`;
const MASTER_MAIL = process.env.BV_TEST_MAIL || 'emanuelgeorge0@gmail.com';

// P_NIE — der Live-Fall: kein ansprech_email, Kunde ohne E-Mail, Adresse steht
// NUR in gs_partner_profil. Genau daran scheiterte die Vorbelegung bisher.
const P_NIE = 'bdf1ca38-90b9-46f1-948f-b59c04a9f7ec';   // VIL, Partner NIEVERGELT + PARTNER AG
const P_RAP = '64c695d5-0ef7-4864-9951-ed7163a92791';   // NIE, 21 Tageszeilen, Partner ohne Profil
const JAHR = 2097;                                      // Probejahr, wird am Ende geloescht

const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fsLies = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const hole = async (id) => (await (await fetch(`${U}/rest/v1/gs_wochenberichte?id=eq.${id}&select=*`, { headers: H })).json())[0];

// Ausgangsstand von gs_material — am Ende wird dagegen verglichen.
const MAT_VORHER = (await fetch(`${U}/rest/v1/gs_material?select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } }))
  .headers.get('content-range');

// ═══════════════════════════════════════════════════════════════════════════
// A. Empfaenger-Kette (rein, ohne DB)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── A. Empfängerkette: fünf Stufen in fester Reihenfolge ──');
const alle = {
  angefragt: ['a@b.ch'],
  kopfRow: { empfaenger: ['k@b.ch'] },
  daten: { kopf: { ansprech_email: 'p@b.ch', kunde_email: 'kd@b.ch', partner_email: 'pp@b.ch' } },
};
ok(empfaengerFuer(alle).herkunft === 'angefragt', 'angefragt schlägt alles');
ok(empfaengerFuer({ ...alle, angefragt: null }).herkunft === 'berichtskopf', 'dann Berichtskopf');
ok(empfaengerFuer({ ...alle, angefragt: null, kopfRow: null }).herkunft === 'projekt-ansprechperson', 'dann Projekt-Ansprechperson');
ok(empfaengerFuer({ angefragt: null, kopfRow: null, daten: { kopf: { kunde_email: 'kd@b.ch', partner_email: 'pp@b.ch' } } }).herkunft === 'kunde', 'dann Kundenstamm');
ok(empfaengerFuer({ angefragt: null, kopfRow: null, daten: { kopf: { partner_email: 'pp@b.ch' } } }).herkunft === 'partner-profil', 'zuletzt Partnerprofil');

console.log('\n── A2. Negativfälle: kein stiller Versand ──');
ok(empfaengerFuer({ kopfRow: {}, daten: {} }).liste.length === 0, 'ohne alles: leer, KEIN Büro-Fallback');
ok(empfaengerFuer({ kopfRow: {}, daten: {} }).herkunft === null, 'ohne alles: keine Herkunft');
ok(empfaengerFuer({ angefragt: null, kopfRow: null, daten: { kopf: { partner_email: 'kaputt' } } }).liste.length === 0, 'ungültige Partner-Adresse zählt nicht als Treffer');

console.log('\n── A2b. Getippter Unsinn fällt NICHT auf die hinterlegte Adresse durch ──');
const tipp = empfaengerFuer({ angefragt: 'haag@nievergelt', kopfRow: { empfaenger: ['k@b.ch'] }, daten: { kopf: { partner_email: 'pp@b.ch' } } });
ok(tipp.liste.length === 0, 'Tippfehler ergibt keine Empfänger');
ok(tipp.ungueltig === true, 'Tippfehler wird als ungültig gemeldet');
ok(tipp.herkunft === null, 'keine Herkunft vorgetäuscht');
ok(empfaengerFuer({ angefragt: '   ', kopfRow: null, daten: { kopf: { partner_email: 'pp@b.ch' } } }).herkunft === 'partner-profil', 'leere Eingabe zählt als "nichts eingetippt" und fällt weiter zurück');
ok(empfaengerFuer({ angefragt: ['a@b.ch', 'kaputt'], kopfRow: null, daten: {} }).liste.join() === 'a@b.ch', 'teilweise gültige Eingabe behält die gültigen Adressen');
ok(empfaengerFuer({ angefragt: 'a@b.ch, kaputt, c@d.ch' }).liste.join() === 'a@b.ch,c@d.ch', 'String wird zerlegt, Müll fliegt raus');
ok(empfaengerFuer({ angefragt: ['a@b.ch', 'a@b.ch'] }).liste.length === 1, 'Duplikate entfernt');
ok(empfaengerFuer({ angefragt: ['@nix', 'a@b'] }).liste.length === 0, 'ungültige Adressen verworfen');
// Eine leere Stufe darf nicht abbrechen, sondern muss weiterfallen.
ok(empfaengerFuer({ angefragt: [], kopfRow: { empfaenger: [] }, daten: { kopf: { ansprech_email: null, kunde_email: null, partner_email: 'pp@b.ch' } } }).herkunft === 'partner-profil', 'leere Stufen werden übersprungen, nicht abgebrochen');

console.log('\n── A3. Herkunft ist für den Master lesbar ──');
for (const k of ['angefragt', 'berichtskopf', 'projekt-ansprechperson', 'kunde', 'partner-profil']) {
  ok(typeof EMPFAENGER_HERKUNFT_TEXT[k] === 'string' && EMPFAENGER_HERKUNFT_TEXT[k].length > 3, `Klartext für "${k}"`);
}

// ═══════════════════════════════════════════════════════════════════════════
// B. Der Live-Fall Nievergelt (nur lesend)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── B. Nievergelt: Adresse steht NUR im Partnerprofil ──');
const dNie = await sammleWochendaten({ quelle: 'projekt', projektId: P_NIE, jahr: 2026, woche: 30 });
ok(dNie.kopf.ansprech_email === null, 'Projekt hat kein ansprech_email (Ausgangslage)');
ok(!dNie.kopf.kunde_email, 'Kunde hat keine E-Mail (Ausgangslage)');
ok(dNie.kopf.partner_email === 'haag@nievergelt-partner.ch', `Partnerprofil liefert die Adresse (ist: ${dNie.kopf.partner_email})`);
const vorNie = empfaengerFuer({ angefragt: null, kopfRow: null, daten: dNie });
ok(vorNie.liste.join() === 'haag@nievergelt-partner.ch', 'Vorschlag = Thomas Haag');
ok(vorNie.herkunft === 'partner-profil', 'Herkunft wird ehrlich benannt');

const dRap = await sammleWochendaten({ quelle: 'projekt', projektId: P_RAP, jahr: 2026, woche: 34 });
ok(dRap.kopf.partner_email === null || dRap.kopf.partner_email === undefined, 'Partner ohne Profil → kein erfundener Vorschlag');
ok(empfaengerFuer({ angefragt: null, kopfRow: null, daten: dRap }).liste.length === 0, 'ohne jede Adresse bleibt der Vorschlag leer');

// ═══════════════════════════════════════════════════════════════════════════
// C. Wochenbericht versenden (Attrappe)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── C. Wochenbericht: Erfolg schreibt, Fehlschlag nicht ──');
const gesendet = [];
const attrappe = async (m) => { gesendet.push(m); return { ok: true, id: 'test-' + gesendet.length }; };
const attrappeFehler = async (m) => { gesendet.push(m); return { ok: false, error: 'Resend meldet 422' }; };

const rOhne = await versendeBericht({ projektId: P_RAP, jahr: JAHR, woche: 10, sendMail: attrappe, mailHtml: wochenberichtEmailHtml });
ok(rOhne.ok === false && /Empfängeradresse/.test(rOhne.error || ''), 'ohne Adresse: klarer Fehler statt stillem Versand');
ok(gesendet.length === 0, 'keine Mail abgesetzt');
ok((await hole(rOhne.bericht.id)).status === 'entwurf', 'Kopf bleibt Entwurf');

const rOk = await versendeBericht({
  projektId: P_RAP, jahr: JAHR, woche: 11, empfaenger: ['bauleiter@example.invalid'],
  sendMail: attrappe, mailHtml: wochenberichtEmailHtml,
});
ok(rOk.ok === true && rOk.versendet === true, 'Versand meldet Erfolg');
ok(gesendet.length === 1, 'genau eine Mail');
const anhang = Buffer.from(gesendet[0].attachments[0].content, 'base64');
ok(anhang.slice(0, 8).toString() === '%PDF-1.4', 'Anhang ist ein gültiges PDF');
ok(anhang.length > 10000, `Anhang hat Substanz (${anhang.length} Bytes)`);
const rowOk = await hole(rOk.bericht.id);
ok(rowOk.status === 'versendet', 'Status versendet');
ok(Array.isArray(rowOk.versand_protokoll) && rowOk.versand_protokoll.some((e) => e.ok === true), 'Protokolleintrag ok:true');

const rFehl = await versendeBericht({
  projektId: P_RAP, jahr: JAHR, woche: 12, empfaenger: ['x@example.invalid'],
  sendMail: attrappeFehler, mailHtml: wochenberichtEmailHtml,
});
ok(rFehl.ok === false && /422/.test(rFehl.error || ''), 'Fehler wird durchgereicht');
const rowFehl = await hole(rFehl.bericht.id);
ok(rowFehl.status !== 'versendet', 'Fehlschlag lässt den Status auf Entwurf');
if (Array.isArray(rowFehl.versand_protokoll)) {
  ok(rowFehl.versand_protokoll.every((e) => e.ok === false), 'Fehlversuch steht als Fehlversuch im Protokoll');
}

// ═══════════════════════════════════════════════════════════════════════════
// D. Die drei Projekt-Exporte über den echten Handler
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── D. Dev-Server mit Mail-Attrappe ──');
const srv = spawn(process.execPath, ['--env-file=.env.local', 'scripts/devserver.mjs'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), MAIL_ATTRAPPE: '1', RESEND_API_KEY: 'attrappe-lokal' },
});
const srvLog = [];
srv.stdout.on('data', (d) => srvLog.push(String(d)));
srv.stderr.on('data', (d) => srvLog.push(String(d)));
const beenden = () => { try { srv.kill('SIGTERM'); } catch (_) {} };
process.on('exit', beenden);

let hoch = false;
for (let i = 0; i < 100 && !hoch; i++) {
  try { hoch = (await fetch(`${BASE}/gs-intern-7k2x`)).ok; } catch (_) { await sleep(100); }
}
ok(hoch, 'Dev-Server läuft auf 127.0.0.1');

if (hoch) {
  // Master-Token: generate_link verschickt KEINE Mail, es erzeugt nur den Link.
  const link = await (await fetch(`${U}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: MASTER_MAIL }),
  })).json();
  const weiter = await fetch(`${U}/auth/v1/verify?type=magiclink&token=${link.hashed_token}&redirect_to=${BASE}/gs-intern.html`,
    { redirect: 'manual', headers: { apikey: K } });
  const treffer = (weiter.headers.get('location') || '').match(/access_token=([^&]+)/);
  const TOKEN = treffer ? decodeURIComponent(treffer[1]) : null;
  ok(!!TOKEN, 'Master-Token geholt (nur im Speicher)');

  // api/cockpit.js liest den Token aus dem BODY, nicht aus dem Authorization-Header.
  const cock = async (action, body) => (await (await fetch(`${BASE}/api/cockpit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token: TOKEN, mode: 'master', ...body }),
  })).json());

  if (TOKEN) {
    console.log('\n── D1. Download-Antwort unverändert (Regression) ──');
    const arten = [
      ['pm_export_material', 'material', 'Materialliste'],
      ['pm_export_rapporte', 'rapporte', 'Arbeitsrapporte'],
      ['pm_export_rechnungen', 'rechnungen', 'Rechnungen'],
    ];
    for (const [action, kind, teil] of arten) {
      const d = await cock(action, { projekt_id: P_NIE });
      ok(d.ok === true, `${action}: ok`);
      ok(typeof d.filename === 'string' && d.filename.includes(teil), `${action}: Dateiname nennt "${teil}"`);
      ok(typeof d.pdf_base64 === 'string' && d.pdf_base64.length > 100, `${action}: pdf_base64 vorhanden`);
      const buf = Buffer.from(d.pdf_base64 || '', 'base64');
      ok(buf.slice(0, 8).toString() === '%PDF-1.4', `${action}: gültiges PDF`);
      // B1 auch hier: die Prüf-Ansicht bekommt den Vorschlag mitgeliefert.
      ok((d.empfaenger_vorschlag || []).join() === 'haag@nievergelt-partner.ch', `${action}: Empfänger vorbelegt`);
      ok(d.empfaenger_herkunft === 'partner-profil', `${action}: Herkunft partner-profil`);
      ok(typeof d.empfaenger_herkunft_text === 'string', `${action}: Herkunft im Klartext`);
    }

    console.log('\n── D2. Versand der drei Exporte ──');
    for (const [, kind, teil] of arten) {
      const d = await cock('pm_export_versenden', { kind, projekt_id: P_NIE, empfaenger: 'export@example.invalid' });
      ok(d.ok === true && d.versendet === true, `${kind}: Versand meldet Erfolg`);
      ok((d.empfaenger || []).join() === 'export@example.invalid', `${kind}: Empfänger korrekt`);
      ok(d.empfaenger_herkunft === 'angefragt', `${kind}: angefragte Adresse schlägt den Vorschlag`);
      ok(typeof d.filename === 'string' && d.filename.includes(teil), `${kind}: Dateiname im Ergebnis`);
    }
    const abgefangen = srvLog.join('').match(/\[mail-attrappe\] abgefangen/g) || [];
    ok(abgefangen.length === 3, `genau drei Mails abgefangen (${abgefangen.length}) — keine ist rausgegangen`);
    ok(/export@example\.invalid/.test(srvLog.join('')), 'Attrappe sah den Testempfänger');
    ok(!/haag@nievergelt-partner\.ch/.test(srvLog.join('')), 'keine Mail an die echte Partneradresse');

    console.log('\n── D3. Versand-Negativfälle ──');
    const dLeer = await cock('pm_export_versenden', { kind: 'material', projekt_id: P_RAP, empfaenger: '' });
    ok(dLeer.ok === false && /Empfängeradresse/.test(dLeer.error || ''), 'ohne auflösbare Adresse: Fehler statt Versand');
    const dArt = await cock('pm_export_versenden', { kind: 'gibtsnicht', projekt_id: P_NIE, empfaenger: 'a@b.ch' });
    ok(dArt.ok === false && /Export-Art/.test(dArt.error || ''), 'unbekannte Export-Art wird abgewiesen');
    // Der gefaehrlichste Fall: getippter Unsinn darf NICHT still auf die
    // hinterlegte Partneradresse durchfallen. Sonst geht die Mail an jemand
    // anderen als gemeint und meldet trotzdem Erfolg.
    const dKaputt = await cock('pm_export_versenden', { kind: 'material', projekt_id: P_NIE, empfaenger: 'haag@nievergelt' });
    ok(dKaputt.ok === false, 'Tippfehler gilt nicht als Versand');
    ok(/gültige E-Mail/.test(dKaputt.error || ''), 'Fehlermeldung benennt den Tippfehler');
    ok(!(dKaputt.empfaenger || []).length, 'kein stiller Rückfall auf die Partneradresse');
    const nachher = (srvLog.join('').match(/\[mail-attrappe\] abgefangen/g) || []).length;
    ok(nachher === 3, `Negativfälle haben keine Mail ausgelöst (weiterhin ${nachher})`);
  }
}
beenden();

// ═══════════════════════════════════════════════════════════════════════════
// E. Kein Versandweg umgeht die Pruef-Ansicht (Regel aus Runde 8a)
// ═══════════════════════════════════════════════════════════════════════════
// Am Quelltext geprueft, weil es eine Struktur-Aussage ist: es darf keinen
// zweiten, stillen Pfad zum Versand geben.
console.log('\n── E. Ein Versandweg, und der führt durch die Prüf-Ansicht ──');
const cockpitSrc = fsLies('gs-intern.html');
const appSrc = fsLies('app.html');
const versandAufrufe = (cockpitSrc.match(/pm_export_versenden/g) || []).length;
ok(versandAufrufe === 1, `pm_export_versenden nur an EINER Stelle im Cockpit (${versandAufrufe})`);
ok(/function pxSend\(\)/.test(cockpitSrc), 'der Versand liegt in pxSend');
// pxSend wird ausschliesslich in pxSheet verdrahtet, und pxSheet laeuft erst,
// nachdem das PDF erzeugt und als Blob geoeffnet wurde.
const pxSendRefs = (cockpitSrc.match(/pxSend/g) || []).length;
ok(pxSendRefs === 2, `pxSend nur einmal verdrahtet plus Definition (${pxSendRefs} Vorkommen)`);
ok(/onclick=pxSend/.test(cockpitSrc), 'einziger Ausloeser ist der Knopf in der Prüf-Ansicht');
ok(cockpitSrc.indexOf('pxSheet()') > cockpitSrc.indexOf('_pxUrl=URL.createObjectURL'), 'die Prüf-Ansicht öffnet erst nach dem Blob');
ok(!/pm_export_versenden/.test(appSrc), 'app.html kennt keinen Versand — der Partner behält seinen Download');

// Serverseitig: die Action steht bewusst NICHT in PM_ACTIONS (Master-Sache).
const cockpitApi = fsLies('api/cockpit.js');
const pmBlock = cockpitApi.slice(cockpitApi.indexOf('const PM_ACTIONS'), cockpitApi.indexOf('const PARTNER_FEATURE_ACTIONS'));
ok(!/pm_export_versenden/.test(pmBlock), 'pm_export_versenden steht nicht in PM_ACTIONS → Master-only');
ok(/'pm_export_material'/.test(pmBlock), 'die drei Downloads bleiben für den Partner freigegeben');

// ═══════════════════════════════════════════════════════════════════════════
// Aufräumen
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── Aufräumen ──');
const H_STORAGE = { apikey: K, Authorization: `Bearer ${K}` };
const probe = await (await fetch(`${U}/rest/v1/gs_wochenberichte?jahr=eq.${JAHR}&select=id,pdf_path`, { headers: H })).json();
for (const r of probe) {
  // DELETE im Storage OHNE Content-Type: mit 'application/json' lehnt Supabase
  // ein bodyloses DELETE mit 400 ab und die Datei bliebe liegen.
  if (r.pdf_path) await fetch(`${U}/storage/v1/object/projektdateien/${r.pdf_path}`, { method: 'DELETE', headers: H_STORAGE });
  await fetch(`${U}/rest/v1/gs_wochenberichte?id=eq.${r.id}`, { method: 'DELETE', headers: H });
}
const rest = await (await fetch(`${U}/rest/v1/gs_wochenberichte?jahr=eq.${JAHR}&select=id`, { headers: H })).json();
ok(rest.length === 0, `Probezeilen entfernt (${rest.length} übrig)`);
// Der Bestand darf sich durch den Test nicht veraendert haben. Material ist in
// dieser Runde ausdruecklich nicht Thema — es muss unberuehrt bleiben.
const matNach = (await fetch(`${U}/rest/v1/gs_material?select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } }))
  .headers.get('content-range');
ok(matNach === MAT_VORHER, `gs_material unveraendert (${MAT_VORHER} → ${matNach})`);

console.log(`\n${fail === 0 ? '✓ ALLE' : '✗ ' + fail + ' FEHLER ·'} ${pass} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
