// scripts/test-material-mail.mjs — Schritt 4: Materialliste per E-Mail (Resend), End-to-End.
//
// Beweist, dass aus der Projekt-/Materialansicht eine Materialliste mit korrektem Inhalt
// per E-Mail (Resend, Absender info@george-solutions.ch) rausgeht — inkl. PDF-Anhang.
//
// Läuft gegen PRODUCTION (dort ist RESEND_API_KEY gesetzt). Empfänger ist die Resend-
// Simulationsadresse `delivered@resend.dev`: akzeptiert + „zugestellt", aber KEINE echte
// Mail an reale Postfächer → beliebig oft (auch 20x) wiederholbar, ohne jemanden zu spammen.
//
// Aufruf:  node scripts/test-material-mail.mjs            (→ https://baby-bob.vercel.app)
//          node scripts/test-material-mail.mjs <BASE_URL> [DURCHLÄUFE]
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'https://baby-bob.vercel.app';
const RUNS = Number(process.argv[3] || 5);
const RECIPIENT = 'delivered@resend.dev'; // Resend-Test-Sink (keine echte Zustellung)

let SUPABASE_URL, SUPABASE_KEY;
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m?.[1] === 'SUPABASE_URL') SUPABASE_URL = m[2].trim();
  if (m?.[1] === 'SUPABASE_KEY') SUPABASE_KEY = m[2].trim();
}
const SBH = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const ACC = { email: 'techniker.test@georgesolutions.ch', password: 'TestTech2026!' };

let pass = 0, fail = 0;
const is = (n, c, d) => (c ? (console.log('  ✓ ' + n), pass++) : (console.log('  ✗ ' + n + (d ? ' — ' + d : '')), fail++));
const login = async (e, p) => (await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: SBH, body: JSON.stringify({ email: e, password: p }) })).json());
const api = async (ep, body, tok) => {
  const r = await fetch(`${BASE}/api/${ep}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

console.log(`Materialliste-Mail @ ${BASE} — ${RUNS} Durchläufe an ${RECIPIENT}\n`);

const tok = (await login(ACC.email, ACC.password)).access_token;
is('login techniker.test', !!tok);

if (tok) {
  for (let i = 1; i <= RUNS; i++) {
    console.log(`Durchlauf ${i}/${RUNS}:`);
    const positionen = [
      { position: 'Kupferrohr 18mm', menge: '12', einheit: 'm' },
      { position: 'Umwälzpumpe Grundfos', menge: '1', einheit: 'Stk' },
      { position: `Dichtungsset (Lauf ${i})`, menge: '3', einheit: 'Set' },
    ];
    const send = await api('nachrichten', {
      action: 'send', typ: 'materialliste',
      empfaenger_email: RECIPIENT, projekt_name: 'E2E Materialtest',
      inhalt: { positionen, notiz: 'Bitte bis Freitag bestellen', von_name: 'George Solutions', projekt_name: 'E2E Materialtest', projektnummer: 'P-TEST-0001' },
    }, tok);
    const trace = (send.body && send.body._debug) || [];
    is(`[${i}] HTTP 200`, send.status === 200, 'status ' + send.status + ' ' + JSON.stringify(send.body).slice(0, 200));
    is(`[${i}] mail_sent=true`, !!(send.body && send.body.mail_sent), JSON.stringify(send.body && send.body.mail_error));
    is(`[${i}] resend_id vorhanden`, !!(send.body && send.body.resend_id), String(send.body && send.body.resend_id));
    is(`[${i}] korrekter Material-Inhalt (3 Positionen im Versand)`, trace.some((l) => l.includes('"positionen":3')), JSON.stringify(trace).slice(0, 200));
    is(`[${i}] PDF-Anhang erzeugt`, trace.some((l) => l.startsWith('pdf-attached')), JSON.stringify(trace).slice(0, 200));
    console.log('');
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
