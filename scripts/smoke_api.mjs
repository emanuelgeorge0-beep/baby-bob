// scripts/smoke_api.mjs — Ist nach dem Deploy noch jede API-Funktion am Leben?
//
//   node scripts/smoke_api.mjs https://baby-bob.vercel.app
//
// Warum es das gibt: /api/wochenbericht war tagelang tot, weil die Funktion
// schon beim LADEN abstuerzte (import.meta.url in lib/wochenbericht.js). Vercel
// antwortet in dem Fall mit 500 text/plain statt mit JSON — im Cockpit kam das
// als nichtssagendes "Verbindungsfehler." an, und die Ursache stand nur im
// Runtime-Log. Dieses Skript macht denselben Befund in zehn Sekunden sichtbar.
//
// Die Pruefung selbst steht in lib/smoke.js und wird von api/smoke_wache.js
// (taeglicher Cron, Mail nur bei Rot) genauso benutzt. Hier drin steht nur
// noch, was NUR am Rechner geht: die Ausgabe im Terminal und der Abgleich der
// Endpunkt-Liste mit dem echten Inhalt von api/.
//
// Gruen = Status < 500, kein x-vercel-error, Antwort von unserem Handler.
// Exit-Code 1, sobald eine rot ist.
//
// Flags:
//   --cron     nimmt api/bob-learn.js mit dazu (siehe UEBERSPRUNGEN in lib/smoke.js)
//   --nur=a,b  prueft nur diese Endpunkte
//
// .mjs → import.meta ist hier eindeutig erlaubt. In lib/*.js und api/*.js NICHT:
// die haben keine package.json ueber sich und werden von Vercel als CommonJS
// geladen, wo import.meta die ganze Datei killt.
import fs from 'node:fs';
import { ENDPUNKTE, laufSmoke } from '../lib/smoke.js';

const ROOT = new URL('../', import.meta.url);
const args = process.argv.slice(2);
const BASIS = (args.find((a) => !a.startsWith('--')) || 'https://baby-bob.vercel.app').replace(/\/+$/, '');
const MIT_CRON = args.includes('--cron');
const NUR = (args.find((a) => a.startsWith('--nur=')) || '').slice(6).split(',').filter(Boolean);

// ── Abgleich der Liste ──────────────────────────────────────────────────────
// lib/smoke.js fuehrt die Endpunkte als feste Liste, weil im Serverless-Bundle
// kein api/-Verzeichnis liegt. Damit die Liste nicht veraltet, wird sie hier
// bei jedem Lauf gegen die Platte geprueft. Eine neue Datei in api/, die
// niemand eingetragen hat, waere sonst nie ueberwacht.
const aufPlatte = fs.readdirSync(new URL('api/', ROOT)).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
const fehlt = aufPlatte.filter((n) => !ENDPUNKTE.includes(n));
const zuviel = ENDPUNKTE.filter((n) => !aufPlatte.includes(n));
let abweichung = 0;
if (fehlt.length || zuviel.length) {
  abweichung = fehlt.length + zuviel.length;
  console.log('\n✗ Die Liste in lib/smoke.js stimmt nicht mit api/ ueberein:');
  for (const n of fehlt) console.log(`    api/${n}.js liegt da, steht aber nicht in ENDPUNKTE — der Cron uebersieht ihn.`);
  for (const n of zuviel) console.log(`    ${n} steht in ENDPUNKTE, aber api/${n}.js gibt es nicht mehr.`);
}

// ── Der Lauf ────────────────────────────────────────────────────────────────
console.log(`\nSmoke-Test gegen ${BASIS} — Methode OPTIONS\n`);
const { zeilen, rot, bekannt, ausgelassen } = await laufSmoke({ basis: BASIS, nur: NUR, mitCron: MIT_CRON });

for (const z of zeilen) {
  console.log(
    `  ${z.marke} ${z.name.padEnd(18)} ${String(z.status || '—').padStart(3)}  ${z.typ.padEnd(26)} ${String(z.ms).padStart(5)}ms`
    + (z.anmerkung ? `  ${z.anmerkung}` : ''),
  );
}
for (const a of ausgelassen) console.log(`  – ${a.name.padEnd(18)}  uebersprungen: ${a.grund}`);

console.log('');
if (rot.length) {
  console.log(`✗ ${rot.length} Funktion(en) gefallen — im Vercel-Runtime-Log nachsehen: Deployments → neuestes → Runtime Logs.`);
} else {
  console.log(`✓ Alle ${zeilen.length - bekannt} gepruefte Funktionen antworten${bekannt ? ` (${bekannt} bekannter Sonderfall, siehe ≡)` : ''}.`);
}
if (abweichung) console.log(`✗ Ausserdem: ${abweichung} Abweichung(en) zwischen lib/smoke.js und api/ (siehe oben).`);
process.exit(rot.length || abweichung ? 1 : 0);
