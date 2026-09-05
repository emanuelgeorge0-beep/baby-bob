// scripts/test_smoke_wache.mjs — Die API-Wache gegengeprueft, offline.
//
//   node scripts/test_smoke_wache.mjs
//
// Stellt einen Attrappen-Server hin, der sich wie das Deploy verhaelt, und
// laesst api/smoke_wache.js einmal dagegen laufen — mit injiziertem
// Mailversand, damit keine Mail den Rechner verlaesst.
//
// Geprueft wird die eine Frage, an der alles haengt: meldet sich die Wache
// GENAU dann, wenn etwas kaputt ist, und sonst nie?
import http from 'node:http';
import { lauf } from '../api/smoke_wache.js';
import { ENDPUNKTE, UEBERSPRUNGEN } from '../lib/smoke.js';

let fehler = 0;
const pruefe = (was, bedingung, detail = '') => {
  console.log(`  ${bedingung ? '✓' : '✗'} ${was}${detail ? `  ${detail}` : ''}`);
  if (!bedingung) fehler++;
};

// Attrappen-Deploy: antwortet fuer jeden Endpunkt so, wie unsere Handler es
// tun (200 + Access-Control-Allow-Origin). `kaputt` faellt aus der Rolle.
function starteAttrappe(kaputt = []) {
  const beruehrt = [];
  const server = http.createServer((req, res) => {
    const name = req.url.replace(/^\/api\//, '');
    beruehrt.push(name);
    if (kaputt.includes(name)) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('FUNCTION_INVOCATION_FAILED'); return; }
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
    res.end();
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    basis: `http://127.0.0.1:${server.address().port}`,
    beruehrt,
    stop: () => new Promise((z) => server.close(z)),
  })));
}

// Mail-Attrappe: faengt den Versand ab, statt ihn zu machen.
function attrappenPost() {
  const kasten = [];
  return { kasten, sendMail: async (m) => { kasten.push(m); return { ok: true, id: 'attrappe' }; } };
}

console.log('\nAPI-Wache (api/smoke_wache.js)\n');

// ── 1 · Alles gruen ⇒ keine Mail ───────────────────────────────────────────
{
  const d = await starteAttrappe();
  const post = attrappenPost();
  const r = await lauf({ basis: d.basis, sendMail: post.sendMail, empfaenger: 'wache@example.test' });
  await d.stop();
  pruefe('gruener Lauf meldet ok', r.ok === true, `geprueft=${r.geprueft}`);
  pruefe('gruener Lauf verschickt KEINE Mail', post.kasten.length === 0, `Postfach=${post.kasten.length}`);
  pruefe('gruener Lauf nennt den Grund', r.grund === 'alles gruen');
}

// ── 2 · Ein roter Endpunkt ⇒ genau eine Mail, die ihn nennt ────────────────
{
  const d = await starteAttrappe(['cockpit']);
  const post = attrappenPost();
  const r = await lauf({ basis: d.basis, sendMail: post.sendMail, empfaenger: 'wache@example.test' });
  await d.stop();
  pruefe('roter Lauf meldet nicht ok', r.ok === false);
  pruefe('roter Lauf nennt genau den kaputten Endpunkt', r.rot.length === 1 && r.rot[0].name === 'cockpit', JSON.stringify(r.rot));
  pruefe('genau EINE Mail', post.kasten.length === 1);
  const m = post.kasten[0] || {};
  pruefe('Betreff nennt den Endpunkt', String(m.subject || '').includes('/api/cockpit'), m.subject);
  pruefe('Empfaenger aus der Konfiguration', Array.isArray(m.to) && m.to[0] === 'wache@example.test');
  pruefe('Mail ist hell (weisser Grund, schwarze Schrift)', /background:#fff/.test(m.html || '') && /color:#111/.test(m.html || ''));
  pruefe('Mail nennt die Ursache', /kein CORS-Header|FUNCTION_INVOCATION|Absturz/.test(m.html || ''));
  pruefe('gemeldet=true', r.gemeldet === true);
}

// ── 3 · Zwei rote ⇒ eine Sammelmail, nicht zwei ────────────────────────────
{
  const d = await starteAttrappe(['cockpit', 'weather']);
  const post = attrappenPost();
  const r = await lauf({ basis: d.basis, sendMail: post.sendMail, empfaenger: 'a@example.test, b@example.test' });
  await d.stop();
  pruefe('zwei rote ⇒ trotzdem nur eine Mail', post.kasten.length === 1, `Postfach=${post.kasten.length}`);
  pruefe('Betreff zaehlt sie', /2 von \d+/.test(String((post.kasten[0] || {}).subject || '')), (post.kasten[0] || {}).subject);
  pruefe('Komma-Liste wird zu zwei Empfaengern', ((post.kasten[0] || {}).to || []).length === 2);
  pruefe('beide stehen im Ergebnis', r.rot.length === 2);
}

// ── 4 · bob-learn wird nie angefasst und loest nie eine Mail aus ───────────
{
  const d = await starteAttrappe(Object.keys(UEBERSPRUNGEN));
  const post = attrappenPost();
  const r = await lauf({ basis: d.basis, sendMail: post.sendMail, empfaenger: 'wache@example.test' });
  await d.stop();
  pruefe('uebersprungene Endpunkte werden nicht aufgerufen',
    !d.beruehrt.some((n) => UEBERSPRUNGEN[n]), d.beruehrt.filter((n) => UEBERSPRUNGEN[n]).join(','));
  pruefe('uebersprungene Endpunkte loesen keine Mail aus', post.kasten.length === 0 && r.ok === true);
  pruefe('sie stehen aber im Ergebnis als ausgelassen', r.ausgelassen.includes('bob-learn'), JSON.stringify(r.ausgelassen));
}

// ── 5 · Ohne Empfaenger wird nichts verschickt (kein Mailziel im Code) ─────
{
  const d = await starteAttrappe(['cockpit']);
  const post = attrappenPost();
  const vorher = process.env.SMOKE_MAIL_TO;
  delete process.env.SMOKE_MAIL_TO;
  const r = await lauf({ basis: d.basis, sendMail: post.sendMail });
  if (vorher !== undefined) process.env.SMOKE_MAIL_TO = vorher;
  await d.stop();
  pruefe('ohne SMOKE_MAIL_TO kein Versand', post.kasten.length === 0);
  pruefe('und der Grund steht im Ergebnis', r.grund === 'SMOKE_MAIL_TO nicht gesetzt', r.grund);
}

// ── 6 · Der Endpunkt prueft sich selbst mit ────────────────────────────────
{
  const d = await starteAttrappe();
  const post = attrappenPost();
  await lauf({ basis: d.basis, sendMail: post.sendMail, empfaenger: 'wache@example.test' });
  await d.stop();
  pruefe('smoke_wache steht in der Liste', ENDPUNKTE.includes('smoke_wache'));
  pruefe('und wird mitgeprueft', d.beruehrt.includes('smoke_wache'));
}

console.log(`\n${fehler ? `✗ ${fehler} Pruefung(en) fehlgeschlagen` : '✓ Alle Pruefungen bestanden'}\n`);
process.exit(fehler ? 1 : 0);
