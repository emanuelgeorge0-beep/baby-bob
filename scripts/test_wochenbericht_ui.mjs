// scripts/test_wochenbericht_ui.mjs — Oberflaechentest des Wochenbericht-Moduls.
//
// Laedt die ECHTE gs-intern.html in jsdom, meldet sich mit einem ECHTEN
// Supabase-Token an und klickt den Ablauf durch: Modul oeffnen, Projekt und KW
// waehlen, Bericht erzeugen, PDF ansehen/herunterladen, versenden, Liste pruefen.
//
// LAEUFT NUR LOKAL. Startet scripts/devserver.mjs auf 127.0.0.1 selbst und
// beendet ihn wieder. Der Master-Token wird zur Laufzeit ueber die Admin-API
// geholt, bleibt NUR IM SPEICHER und wird am Ende serverseitig widerrufen — er
// landet in keiner Datei. Es geht KEINE Mail raus: der Dev-Server faengt
// api.resend.com ab (MAIL_ATTRAPPE), die Empfaenger sind .invalid-Adressen.
// Erzeugte Berichtskoepfe werden am Ende geloescht und nachgezaehlt.
//
// Braucht jsdom. Fehlt es, ueberspringt sich der Test selbst — das Repo hat
// bewusst keine node_modules:
//   npm install --prefix /tmp/wb-harness jsdom
//   NODE_PATH=/tmp/wb-harness/node_modules node --env-file=.env.local scripts/test_wochenbericht_ui.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.UI_TEST_PORT || 4399);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJEKT = process.env.UI_TEST_PROJEKT || '64c695d5-0ef7-4864-9951-ed7163a92791';
const MASTER_MAIL = process.env.UI_TEST_MAIL || 'emanuelgeorge0@gmail.com';
const OUT = process.env.PDF_TEST_OUT || null;
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_KEY;

// jsdom kann irgendwo liegen — das Repo hat keine node_modules. NODE_PATH hilft
// bei ESM nicht, deshalb ein ausdruecklicher Pfad ueber JSDOM_DIR.
let JSDOM, VirtualConsole;
const kandidaten = ['jsdom'];
if (process.env.JSDOM_DIR) kandidaten.push(pathToFileURL(path.join(process.env.JSDOM_DIR, 'node_modules', 'jsdom', 'lib', 'api.js')).href);
for (const kand of kandidaten) {
  try { ({ JSDOM, VirtualConsole } = await import(kand)); break; } catch (_) { /* naechster */ }
}
if (!JSDOM) {
  console.log('jsdom nicht gefunden — Oberflaechentest uebersprungen.');
  console.log('  npm install --prefix /tmp/wb-harness jsdom');
  console.log('  JSDOM_DIR=/tmp/wb-harness node --env-file=.env.local scripts/test_wochenbericht_ui.mjs');
  process.exit(0);
}

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  x ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function bis(fn, was, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (_) {} await sleep(60); }
  ok(false, `Zeitueberschreitung: ${was}`);
  return false;
}

// ── Dev-Server starten (127.0.0.1, mit Mail-Attrappe) ─────────────────────
const srv = spawn(process.execPath, ['--env-file=.env.local', 'scripts/devserver.mjs'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), MAIL_ATTRAPPE: '1', RESEND_API_KEY: 'attrappe-lokal', ...(OUT ? { MAIL_OUT: OUT } : {}) },
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
ok(hoch, 'Dev-Server laeuft auf 127.0.0.1');
if (!hoch) { console.log(srvLog.join('')); beenden(); process.exit(1); }

// ── Master-Token: nur im Speicher, am Ende widerrufen ─────────────────────
// generate_link verschickt KEINE Mail, es erzeugt nur den Link; einmal einloesen
// gibt einen echten access_token. Kein Passwort, keine Passwortaenderung.
const SBH = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };
const link = await (await fetch(`${U}/auth/v1/admin/generate_link`, {
  method: 'POST', headers: SBH, body: JSON.stringify({ type: 'magiclink', email: MASTER_MAIL }),
})).json();
const weiter = await fetch(`${U}/auth/v1/verify?type=magiclink&token=${link.hashed_token}&redirect_to=${BASE}/gs-intern.html`,
  { redirect: 'manual', headers: { apikey: K } });
const treffer = (weiter.headers.get('location') || '').match(/access_token=([^&]+)/);
const TOKEN = treffer ? decodeURIComponent(treffer[1]) : null;
ok(!!TOKEN, 'Master-Token geholt (nur im Speicher, keine Datei)');
if (!TOKEN) { beenden(); process.exit(1); }

const vc = new VirtualConsole();
const jsFehler = [];
vc.on('jsdomError', (e) => jsFehler.push(e.message));
vc.on('error', (...a) => jsFehler.push(a.join(' ')));

const html = await (await fetch(`${BASE}/gs-intern-7k2x`)).text();
const dom = new JSDOM(html, {
  url: `${BASE}/gs-intern-7k2x`,
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(win) {
    win.fetch = (u, o) => fetch(String(u).startsWith('http') ? u : BASE + u, o);
    win.localStorage.setItem('bob_auth_token', TOKEN);
    win.scrollTo = () => {};
    win.URL.createObjectURL = (b) => { win.__blob = b; return 'blob:local/' + Math.random().toString(36).slice(2); };
    win.URL.revokeObjectURL = () => {};
    // Service-Worker gibt es hier nicht — Registrierung still weglassen.
    Object.defineProperty(win.navigator, 'serviceWorker', { value: { register: () => Promise.resolve({}), ready: Promise.resolve({}) }, configurable: true });
  },
});
const win = dom.window, doc = win.document;
const $ = (id) => doc.getElementById(id);
const txt = () => ($('view') ? $('view').textContent : '');

console.log('── Login mit echtem Token ───────────────────────────────');
await bis(() => $('app') && !$('app').classList.contains('hidden'), 'Cockpit erscheint');
ok($('app') && !$('app').classList.contains('hidden'), 'eingeloggt, Cockpit sichtbar');
ok($('login') && $('login').classList.contains('hidden'), 'Login-Maske verborgen');

// Erst das Dashboard fertig malen lassen: renderDashboard() hat nach dem Login
// noch eine Anfrage offen und schreibt deren Ergebnis unbesehen in #view — wer
// vorher wegnavigiert, dem wird die neue Ansicht ueberschrieben. Das ist
// bestehendes Verhalten des Cockpits, kein Verhalten dieses Moduls.
await bis(() => /Leads gesamt|Pipeline|Umsatz/.test(txt()), 'Dashboard fertig geladen');

console.log('\n── Modul öffnen ─────────────────────────────────────────');
win.go('mehr');
await bis(() => /Module/.test(txt()), 'Modulliste');
const kachel = [...doc.querySelectorAll('[data-go]')].find((e) => e.getAttribute('data-go') === 'wochenberichte');
ok(!!kachel, 'Wochenbericht-Kachel in der Modulliste');
ok(/Projekt × KW für den Bauleiter/.test(kachel ? kachel.textContent : ''), 'Kachel beschreibt das Modul');
kachel.click();
await bis(() => $('wb-projekt'), 'Auswahlfelder');

console.log('\n── Auswahl Projekt + KW ─────────────────────────────────');
const psel = $('wb-projekt'), ksel = $('wb-kw');
ok(psel && psel.options.length > 0, `${psel ? psel.options.length : 0} Projekte im Auswahlfeld`);
ok(ksel && ksel.options.length === 16, `16 Kalenderwochen zur Wahl (sind ${ksel ? ksel.options.length : 0})`);
ok(/KW \d+ \/ \d{4} · \d{2}\.\d{2}\.–\d{2}\.\d{2}\./.test(ksel.options[0].textContent), `KW-Label zeigt den Zeitraum: "${ksel.options[0].textContent}"`);
const projOpt = [...psel.options].find((o) => o.value === PROJEKT);
ok(!!projOpt, 'P-2026-3470 wählbar');
ok(/P-2026-3470/.test(projOpt.textContent), 'Projektnummer im Label');
psel.value = PROJEKT;
// KW31/2026 ist nicht in den letzten 16 Wochen ab heute — Option ergänzen, so
// wie sie der Nutzer im echten Zeitfenster vorfände.
if (![...ksel.options].some((o) => o.value === '2026-31')) {
  const o = doc.createElement('option'); o.value = '2026-31'; o.textContent = 'KW 31 / 2026'; ksel.appendChild(o);
}
ksel.value = '2026-31';

console.log('\n── Bericht erzeugen (Vorschau) ──────────────────────────');
$('wb-go').click();
await bis(() => /Tagesverlauf/.test(txt()), 'Vorschau geladen');
const v = txt();
ok(/Langstrasse 149/.test(v), 'Projektname in der Vorschau');
ok(/KW 31\/2026/.test(v), 'Kalenderwoche');
ok(/40\.00 h/.test(v), 'Stundensumme 40.00 h');
ok(/Einreichstatus \(1\)/.test(v), 'Einreichstatus mit einem Techniker');
ok(/Emanuel George/.test(v), 'Technikername');
ok(/eingereicht/.test(v), 'Status eingereicht');
ok(/Tagesverlauf \(7\)/.test(v), 'sieben Tage');
ok(/Montag, 27\.07\.26/.test(v), 'erster Tag benannt');
ok(/keine Fotos vor/.test(v), 'fehlende Fotos werden benannt');
ok(!!$('wb-pdf') && !!$('wb-send-open'), 'Knöpfe für PDF und Versand da');

console.log('\n── PDF erzeugen und ansehen ─────────────────────────────');
$('wb-pdf').click();
await bis(() => $('wb-pdfbox') && /Ansehen/.test($('wb-pdfbox').textContent), 'PDF fertig');
const box = $('wb-pdfbox');
ok(/WB-P-2026-3470-2026-31/.test(box.textContent), 'Berichtsnummer angezeigt');
ok(/KB/.test(box.textContent), 'Dateigrösse angezeigt');
const ansehen = [...box.querySelectorAll('a')].find((a) => /Ansehen/.test(a.textContent));
const laden = [...box.querySelectorAll('a')].find((a) => /Herunterladen/.test(a.textContent));
ok(ansehen && ansehen.getAttribute('target') === '_blank', '„Ansehen" öffnet in neuem Tab');
ok(ansehen && /^blob:/.test(ansehen.getAttribute('href')), '„Ansehen" zeigt auf eine Blob-URL');
ok(laden && /\.pdf$/.test(laden.getAttribute('download') || ''), '„Herunterladen" mit PDF-Dateinamen');
// Der Blob muss ein echtes PDF sein, nicht nur ein Link.
const blobBytes = Buffer.from(await win.__blob.arrayBuffer());
ok(blobBytes.slice(0, 8).toString() === '%PDF-1.4', 'Blob ist ein gültiges PDF');
ok(blobBytes.length > 20000, `PDF hat Substanz (${blobBytes.length} Bytes)`);
if (OUT) fs.writeFileSync(path.join(OUT, 'ui-download.pdf'), blobBytes);

console.log('\n── Versandformular ──────────────────────────────────────');
$('wb-send-open').click();
await bis(() => $('wb-empf'), 'Versandformular');
ok(/eingefroren/.test($('wb-versand').textContent), 'Formular erklärt das Einfrieren');
ok($('wb-empf').value === '', 'Empfänger leer — beim Projekt ist keine Ansprechperson hinterlegt');
ok(/keine Ansprechperson/.test($('wb-versand').textContent), 'und genau das steht da');
// Leer absenden darf nicht senden
$('wb-send').click();
await sleep(300);
ok(!/Versendet an/.test($('wb-versand').textContent), 'leeres Feld sendet nicht');

console.log('\n── Versenden ────────────────────────────────────────────');
$('wb-empf').value = 'bauleiter@example.invalid, zweiter@example.invalid';
$('wb-send').click();
await bis(() => /Versendet an|✗/.test(($('wb-send-out') || {}).textContent || ''), 'Versandergebnis');
const out = $('wb-send-out').textContent;
console.log('  Ergebnis:', out.replace(/\s+/g, ' ').slice(0, 150));
const resendFehlt = /RESEND_API_KEY/.test(out);
if (resendFehlt) {
  ok(/✗/.test(out), 'ohne RESEND_API_KEY meldet die UI ehrlich einen Fehlschlag');
} else {
  ok(/Versendet an/.test(out), 'Erfolgsmeldung');
  ok(/bauleiter@example\.invalid/.test(out), 'Empfänger genannt');
  ok(/eingefroren/.test(out), 'Einfrieren bestätigt');
}

console.log('\n── Bisherige Berichte ───────────────────────────────────');
// Nach erfolgreichem Versand frischt wbSend() die Liste selbst auf; sonst holt
// man sie ueber den Knopf im Auswahlblock.
if (!/Bisherige Berichte/.test(($('wb-liste') || {}).textContent || '')) $('wb-hist').click();
await bis(() => /Bisherige Berichte \(/.test(($('wb-liste') || {}).textContent || ''), 'Liste');
console.log('  Inhalt:', ($('wb-liste').textContent||'').replace(/\s+/g,' ').slice(0,170));
const liste = $('wb-liste').textContent;
ok(/KW 31 \/ 2026/.test(liste), 'der eben erzeugte Bericht steht in der Liste');
ok(/WB-P-2026-3470-2026-31/.test(liste), 'mit Berichtsnummer');

console.log('\n── Leere Woche ──────────────────────────────────────────');
if (![...ksel.options].some((o) => o.value === '2026-02')) {
  const o = doc.createElement('option'); o.value = '2026-02'; o.textContent = 'KW 2 / 2026'; ksel.appendChild(o);
}
$('wb-kw').value = '2026-02';
$('wb-go').click();
await bis(() => /nichts gebucht/.test(txt()), 'leere Woche');
ok(/nichts gebucht/.test(txt()), 'leere Woche wird als solche gezeigt, keine leere Seite');

console.log('\n── Keine JS-Fehler ──────────────────────────────────────');
if (jsFehler.length) console.log('  ' + jsFehler.slice(0, 3).join('\n  '));
ok(jsFehler.length === 0, `keine JavaScript-Fehler (${jsFehler.length})`);

// Erzeugte Berichtsköpfe wieder entfernen — der Test soll nichts hinterlassen.
const HH = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };
const HS = { apikey: K, Authorization: `Bearer ${K}` };
const rows = await (await fetch(`${U}/rest/v1/gs_wochenberichte?select=id,pdf_path`, { headers: HH })).json();
for (const r of rows) {
  if (r.pdf_path) await fetch(`${U}/storage/v1/object/projektdateien/${r.pdf_path}`, { method: 'DELETE', headers: HS });
  await fetch(`${U}/rest/v1/gs_wochenberichte?id=eq.${r.id}`, { method: 'DELETE', headers: HH });
}
const rest = await (await fetch(`${U}/rest/v1/gs_wochenberichte?select=id`, { headers: HH })).json();
ok(rest.length === 0, `aufgeräumt, gs_wochenberichte wieder leer (${rest.length})`);

dom.window.close();
// Sitzung serverseitig widerrufen — der Token soll den Test nicht ueberleben.
// scope=local, NICHT global: global wuerde alle Sitzungen des Masters beenden
// und ihn z.B. auf dem Handy aus dem Cockpit werfen. Hier stirbt nur die
// Sitzung, die dieser Test selbst erzeugt hat.
const abmelden = await fetch(`${U}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: K, Authorization: `Bearer ${TOKEN}` } });
ok(abmelden.status === 204 || abmelden.status === 200, `Master-Sitzung widerrufen (HTTP ${abmelden.status})`);
beenden();
console.log(`\n${fail === 0 ? '✓ ALLE' : '✗ ' + fail + ' FEHLER ·'} ${pass} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
