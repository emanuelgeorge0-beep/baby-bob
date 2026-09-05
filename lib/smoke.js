// lib/smoke.js — Der Smoke-Test als Bibliothek: einmal geschrieben, zweimal benutzt.
//
// Benutzt von
//   scripts/smoke_api.mjs  — Lauf von Hand am Rechner, Ausgabe im Terminal
//   api/smoke_wache.js     — taeglicher Cron, Mail NUR wenn etwas rot ist
//
// Geprueft wird mit OPTIONS: der einzige Aufruf, der garantiert nichts
// ausloest — kein Mailversand, kein Anthropic-/ElevenLabs-/Stripe-Aufruf,
// keine DB-Schreibung. Er beweist genau eine Sache, dafuer sicher: die
// Funktion kommt hoch und antwortet. Ob die Handler-LOGIK stimmt, sagt er
// NICHT — dafuer sind die scripts/test_*.mjs da.
//
// KEIN import.meta, KEIN node:fs. Diese Datei laeuft auch in der Serverless-
// Funktion, wo es weder das Repo-Verzeichnis noch ein package.json gibt.

// ═══════════════════════════════════════════════════════════════════════════
// Die Liste der Endpunkte — von Hand gepflegt, mit Absicht.
// ═══════════════════════════════════════════════════════════════════════════
// Im Serverless-Bundle liegt api/ nicht auf der Platte, ein readdir gibt es
// dort also nicht. Damit die Liste trotzdem nie veraltet, vergleicht
// scripts/smoke_api.mjs sie bei jedem Lauf mit dem echten Inhalt von api/ und
// meldet jede Abweichung als Fehler. Neue Datei in api/ ⇒ hier eintragen.
export const ENDPUNKTE = [
  'account',
  'admin',
  'auth',
  'blockaden',
  'bob',
  'bob-chat',
  'bob-feedback',
  'bob-learn',
  'bob-speak',
  'checkout',
  'cockpit',
  'config',
  'dashboard',
  'entitlements',
  'gewerke',
  'gs',
  'nachrichten',
  'projectflow',
  'projekte',
  'rapport',
  'rapport_erinnerung',
  'rechnung',
  'smoke_wache',
  'stripe-checkout',
  'tagesrapport',
  'techniker',
  'videolink',
  'voice',
  'weather',
  'wochenbericht',
];

// Nicht angefasst, ausser man verlangt es ausdruecklich (--cron / mitCron).
// Diese Endpunkte loesen bei einem Probe-Aufruf echte Arbeit aus.
// Ein uebersprungener Endpunkt ist NIE rot und loest also auch nie eine Mail aus.
export const UEBERSPRUNGEN = {
  'bob-learn': 'Cron-Endpunkt ohne Methoden-Guard — ein Probe-Aufruf wuerde den Lernlauf starten (--cron erzwingt)',
};

// Endpunkte, die kein normales "antwortet mit JSON" erfuellen — mit Grund,
// damit niemand sie fuer einen Regressionsfehler haelt. Ein Eintrag hier ist
// still: er faerbt nicht rot und loest keine Mail aus.
// Leer, und das soll so bleiben: escrow_stripe stand hier, weil ein Hilfsmodul
// ohne default export in api/ lag und Vercel daraus eine Funktion baute, die
// bei jedem Aufruf 500 warf. Es ist nach lib/escrow_stripe.js umgezogen. Ein
// Eintrag hier verdeckt einen Fehler nur — der richtige Weg ist fast immer,
// die Datei dorthin zu legen, wo sie hingehoert.
export const SONDERFALL = {};

// ═══════════════════════════════════════════════════════════════════════════
// Ein Endpunkt, eine Probe
// ═══════════════════════════════════════════════════════════════════════════
export async function probe(basis, name, { timeoutMs = 20000 } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${basis}/api/${name}`, { method: 'OPTIONS', signal: AbortSignal.timeout(timeoutMs) });
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
    return {
      name,
      status: 0,
      typ: '—',
      vercelFehler: err.name === 'TimeoutError' ? 'TIMEOUT' : String(err.message).slice(0, 60),
      unser: false,
      ms: Date.now() - t0,
    };
  }
}

// Urteil ueber eine Probe. 404 zaehlt als gefallen: die Datei liegt in api/,
// also MUSS es die Route im Deploy geben. Fehlt sie, ist der Build daran
// vorbeigelaufen. Und ohne unseren CORS-Fingerabdruck (oder wenigstens JSON)
// hat nicht unser Handler geantwortet — ein blosses "irgendwas kam zurueck"
// reicht nicht.
export function bewerte(z) {
  const gefallen = z.status === 0 || z.status >= 500 || z.status === 404
    || !!z.vercelFehler || !(z.unser || z.typ.includes('json'));
  const s = SONDERFALL[z.name];
  if (s && s.erwartet === 'absturz' && gefallen) return { marke: '≡', rot: false, bekannt: true, anmerkung: s.grund };
  if (!gefallen) return { marke: '✓', rot: false, bekannt: false, anmerkung: '' };
  let anmerkung = 'Absturz';
  if (z.vercelFehler) anmerkung = z.vercelFehler;
  else if (z.status === 0) anmerkung = 'keine Antwort';
  else if (z.status === 404) anmerkung = 'Route im Deploy nicht vorhanden';
  else if (!z.unser && !z.typ.includes('json')) anmerkung = 'Antwort kam nicht von unserem Handler (kein CORS-Header, kein JSON)';
  return { marke: '✗', rot: true, bekannt: false, anmerkung };
}

// ═══════════════════════════════════════════════════════════════════════════
// Der ganze Lauf
// ═══════════════════════════════════════════════════════════════════════════
// `gleichzeitig` haelt den Cron innerhalb des Serverless-Zeitfensters: 30
// Endpunkte nacheinander waeren im schlechten Fall ueber 10 Sekunden.
export async function laufSmoke({ basis, nur = [], mitCron = false, timeoutMs = 20000, gleichzeitig = 6 } = {}) {
  const b = String(basis || '').replace(/\/+$/, '');
  const ziel = ENDPUNKTE
    .filter((n) => (nur.length ? nur.includes(n) : true))
    .filter((n) => mitCron || !UEBERSPRUNGEN[n]);

  const zeilen = [];
  for (let i = 0; i < ziel.length; i += gleichzeitig) {
    const teil = await Promise.all(ziel.slice(i, i + gleichzeitig).map((n) => probe(b, n, { timeoutMs })));
    for (const z of teil) zeilen.push({ ...z, ...bewerte(z) });
  }
  zeilen.sort((a, x) => a.name.localeCompare(x.name));

  const ausgelassen = Object.keys(UEBERSPRUNGEN)
    .filter((n) => ENDPUNKTE.includes(n) && (nur.length ? nur.includes(n) : true))
    .filter(() => !mitCron)
    .map((n) => ({ name: n, grund: UEBERSPRUNGEN[n] }));

  return {
    basis: b,
    zeilen,
    rot: zeilen.filter((z) => z.rot),
    bekannt: zeilen.filter((z) => z.bekannt).length,
    ausgelassen,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Meldung fuer die Mail
// ═══════════════════════════════════════════════════════════════════════════
// Bewusst schlicht und hell: das ist eine Warnung an uns selbst, kein
// Kundendokument. Weisser Grund, schwarze Schrift, keine Marke, kein Logo.
export function berichtHtml({ basis, zeilen, rot, ausgelassen = [] }) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const zeile = (z) => `<tr>`
    + `<td style="padding:4px 10px 4px 0;font-weight:${z.rot ? '600' : '400'}">${esc(z.marke)} ${esc(z.name)}</td>`
    + `<td style="padding:4px 10px 4px 0">${esc(z.status || '—')}</td>`
    + `<td style="padding:4px 10px 4px 0">${esc(z.ms)} ms</td>`
    + `<td style="padding:4px 0">${esc(z.anmerkung)}</td>`
    + `</tr>`;
  return '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#111;background:#fff">'
    + `<p style="margin:0 0 10px"><strong>${rot.length} von ${zeilen.length} API-Funktionen antworten nicht.</strong></p>`
    + `<p style="margin:0 0 14px">Geprueft: ${esc(basis)} · Methode OPTIONS · ${new Date().toISOString()}</p>`
    + '<table style="border-collapse:collapse;font-size:13px">'
    + rot.map(zeile).join('')
    + '</table>'
    + '<p style="margin:14px 0 10px">Vollstaendiger Lauf:</p>'
    + '<table style="border-collapse:collapse;font-size:13px;color:#555">'
    + zeilen.filter((z) => !z.rot).map(zeile).join('')
    + '</table>'
    + (ausgelassen.length
      ? `<p style="margin:14px 0 0;color:#555">Nicht geprueft: ${ausgelassen.map((a) => esc(a.name)).join(', ')} — ${esc(ausgelassen[0].grund)}</p>`
      : '')
    + '<p style="margin:14px 0 0">Nachsehen: Vercel → Deployments → neuestes → Runtime Logs.</p>'
    + '</div>';
}
