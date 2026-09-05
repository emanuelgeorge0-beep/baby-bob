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
// Geprueft wird mit OPTIONS: das ist der einzige Aufruf, der garantiert nichts
// ausloest — kein Mailversand, kein Anthropic-/ElevenLabs-/Stripe-Aufruf, keine
// DB-Schreibung. Er beweist genau eine Sache, dafuer sicher: die Funktion kommt
// hoch und antwortet. Ob die Handler-LOGIK stimmt, sagt er NICHT — dafuer sind
// die test_*.mjs da.
//
// Gruen = Status < 500 und kein x-vercel-error. Rot = die Funktion ist gefallen.
// Exit-Code 1, sobald eine rot ist.
//
// Flags:
//   --cron     nimmt api/bob-learn.js mit dazu (siehe UEBERSPRUNGEN unten)
//   --nur=a,b  prueft nur diese Endpunkte
//
// .mjs → import.meta ist hier eindeutig erlaubt. In lib/*.js und api/*.js NICHT:
// die haben keine package.json ueber sich und werden von Vercel als CommonJS
// geladen, wo import.meta die ganze Datei killt.
import fs from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const args = process.argv.slice(2);
const BASIS = (args.find((a) => !a.startsWith('--')) || 'https://baby-bob.vercel.app').replace(/\/+$/, '');
const MIT_CRON = args.includes('--cron');
const NUR = (args.find((a) => a.startsWith('--nur=')) || '').slice(6).split(',').filter(Boolean);

// Endpunkte, die kein normales "antwortet mit JSON" erfuellen — mit Grund,
// damit niemand sie fuer einen Regressionsfehler haelt.
// Leer, und das soll so bleiben: escrow_stripe stand hier, weil ein Hilfsmodul
// ohne default export in api/ lag und Vercel daraus eine Funktion baute, die
// bei jedem Aufruf 500 warf. Es ist nach lib/escrow_stripe.js umgezogen. Ein
// Eintrag hier verdeckt einen Fehler nur — der richtige Weg ist fast immer,
// die Datei dorthin zu legen, wo sie hingehoert.
const SONDERFALL = {};
const UEBERSPRUNGEN = {
  // Cron-Endpunkt ohne Methoden-Guard: ein OPTIONS wuerde den Lernlauf wirklich
  // starten, wenn CRON_SECRET nicht gesetzt ist. Nur auf ausdrueckliche Ansage.
  'bob-learn': 'Cron-Endpunkt ohne Methoden-Guard — ein Probe-Aufruf wuerde den Lernlauf starten (--cron erzwingt)',
};

const endpunkte = fs.readdirSync(new URL('api/', ROOT))
  .filter((f) => f.endsWith('.js'))
  .map((f) => f.slice(0, -3))
  .sort();

const ziel = endpunkte.filter((n) => (NUR.length ? NUR.includes(n) : true))
  .filter((n) => MIT_CRON || !UEBERSPRUNGEN[n]);

async function probe(name) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASIS}/api/${name}`, { method: 'OPTIONS', signal: AbortSignal.timeout(20000) });
    return {
      name,
      status: r.status,
      typ: (r.headers.get('content-type') || '—').split(';')[0],
      vercelFehler: r.headers.get('x-vercel-error') || '',
      // Fingerabdruck unseres Handlers: jeder setzt Access-Control-Allow-Origin,
      // BEVOR er irgendetwas anderes tut. Ist der Header da, hat unser Code
      // geantwortet — und nicht ein Proxy, eine Fehlerseite oder eine fremde
      // Domain, die auf denselben Pfad zufaellig 405 sagt.
      unser: !!r.headers.get('access-control-allow-origin'),
      ms: Date.now() - t0,
    };
  } catch (err) {
    return { name, status: 0, typ: '—', vercelFehler: err.name === 'TimeoutError' ? 'TIMEOUT' : String(err.message).slice(0, 60), ms: Date.now() - t0 };
  }
}

console.log(`\nSmoke-Test gegen ${BASIS} — ${ziel.length} Endpunkte, Methode OPTIONS\n`);

const zeilen = [];
for (const name of ziel) zeilen.push(await probe(name));

let rot = 0; let bekannt = 0;
for (const z of zeilen) {
  // 404 zaehlt als gefallen: die Datei liegt in api/, also MUSS es die Route im
  // Deploy geben. Fehlt sie, ist der Build daran vorbeigelaufen.
  // Und ohne unseren CORS-Fingerabdruck (oder wenigstens JSON) hat nicht unser
  // Handler geantwortet — ein blosses "irgendwas kam zurueck" reicht nicht.
  const gefallen = z.status === 0 || z.status >= 500 || z.status === 404
    || !!z.vercelFehler || !(z.unser || z.typ.includes('json'));
  const s = SONDERFALL[z.name];
  let marke; let anmerkung = '';
  if (s && s.erwartet === 'absturz' && gefallen) {
    marke = '≡'; anmerkung = s.grund; bekannt++;
  } else if (gefallen) {
    marke = '✗'; rot++;
    if (z.vercelFehler) anmerkung = z.vercelFehler;
    else if (z.status === 0) anmerkung = 'keine Antwort';
    else if (z.status === 404) anmerkung = 'Route im Deploy nicht vorhanden';
    else if (!z.unser && !z.typ.includes('json')) anmerkung = 'Antwort kam nicht von unserem Handler (kein CORS-Header, kein JSON)';
    else anmerkung = 'Absturz';
  } else { marke = '✓'; }
  console.log(
    `  ${marke} ${z.name.padEnd(18)} ${String(z.status || '—').padStart(3)}  ${z.typ.padEnd(26)} ${String(z.ms).padStart(5)}ms`
    + (anmerkung ? `  ${anmerkung}` : ''),
  );
}

for (const [name, grund] of Object.entries(UEBERSPRUNGEN)) {
  const imBlick = endpunkte.includes(name) && (NUR.length ? NUR.includes(name) : true);
  if (!MIT_CRON && imBlick) console.log(`  – ${name.padEnd(18)}  uebersprungen: ${grund}`);
}

console.log('');
if (rot) {
  console.log(`✗ ${rot} Funktion(en) gefallen — im Vercel-Runtime-Log nachsehen: Deployments → neuestes → Runtime Logs.`);
} else {
  console.log(`✓ Alle ${zeilen.length - bekannt} gepruefte Funktionen antworten${bekannt ? ` (${bekannt} bekannter Sonderfall, siehe ≡)` : ''}.`);
}
process.exit(rot ? 1 : 0);
