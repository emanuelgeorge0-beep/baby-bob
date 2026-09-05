// Stop-Hook — das Tor am Ende einer Runde.
//
// Eine Runde gilt erst als fertig, wenn scripts/smoke_api.mjs sagt, dass jede
// API-Funktion noch hochkommt. Das ist kein Zierrat: /api/wochenbericht war
// tagelang tot, weil die Funktion schon beim LADEN abstuerzte, und im Cockpit
// kam das nur als "Verbindungsfehler." an. Wer eine Runde meldet, ohne das
// geprueft zu haben, meldet moeglicherweise ein totes Deployment als fertig.
//
// Schema (geprueft gegen Claude Code 2.1.261):
//   Eingang : { stop_hook_active, session_id, cwd, hook_event_name: "Stop" }
//   Ausgang : { "decision": "block", "reason": "…" } haelt die Runde an und
//             gibt dem Modell den Grund. (Fuer Stop ist "decision" der richtige
//             Weg — permissionDecision gibt es nur bei PreToolUse.)
//
// ── Wie die bekannten Ausnahmen umgesetzt sind ────────────────────────────────
// Nicht dadurch, dass der Hook "gib dich mit Exit-Code 1 zufrieden" sagt — dann
// waere jeder NEUE Fehler ebenfalls verziehen und das Tor waere Deko. Statt-
// dessen liest der Hook die Ausgabe zeilenweise, sammelt die NAMEN aller roten
// Funktionen und zieht davon die namentlich eingetragene Ausnahmeliste ab. Was
// uebrig bleibt, blockiert. Faellt morgen zusaetzlich api/rechnung, steht
// "rechnung" nicht auf der Liste und das Tor geht zu — obwohl
// rapport_erinnerung weiterhin rot ist.
//
// Die Liste ist absichtlich namentlich und mit Datum: eine Ausnahme ohne Grund
// und ohne Ablauf wird zur Dauerausnahme.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = process.env.CLAUDE_PROJECT_DIR || resolve(HIER, '..', '..');

// Namentliche Ausnahmen. Nur was hier steht, darf rot sein.
const BEKANNT = {
  rapport_erinnerung: 'am 05.09.2026 im Code behoben (CORS-Header wie api/blockaden.js), '
    + 'live aber erst nach dem naechsten Deploy gruen. Sobald das Tor meldet, dass '
    + 'die Funktion wieder gruen ist: diesen Eintrag ersatzlos loeschen.',
  smoke_wache: 'neu am 05.09.2026 auf feat/fixrunde-server. Die Route gibt es live '
    + 'erst nach dem Deploy, bis dahin ist 404 richtig und kein Ausfall. Sobald das '
    + 'Tor meldet, dass die Funktion gruen ist: diesen Eintrag ersatzlos loeschen.',
  'bob-learn': 'wird von smoke_api.mjs ohne --cron uebersprungen: ein Probe-Aufruf '
    + 'wuerde den Lernlauf wirklich starten. Steht hier mit drin, damit ein '
    + 'Lauf mit --cron nicht faelschlich das Tor schliesst.',
};

let roh = '';
for await (const stueck of process.stdin) roh += stueck;
let e = {};
try { e = JSON.parse(roh || '{}'); } catch { /* leeres Ereignis, weiterlaufen */ }

// Schutz gegen die Endlosschleife: hat das Tor schon einmal blockiert und das
// Modell versucht erneut zu beenden, laesst es durch. Der Befund steht dann
// bereits im Gespraech — mehr kann ein Hook nicht ausrichten.
if (e.stop_hook_active) process.exit(0);

function block(grund) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: grund }));
  process.exit(0);
}

let ausgabe = '';
try {
  ausgabe = execFileSync('node', ['scripts/smoke_api.mjs'], {
    cwd: WURZEL, encoding: 'utf8', timeout: 110000, stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  ausgabe = `${err.stdout || ''}${err.stderr || ''}`;
  if (!ausgabe.trim()) {
    block('RUNDE NICHT FERTIG: scripts/smoke_api.mjs liess sich nicht ausfuehren '
      + `(${err.message}). Ohne diesen Lauf ist nicht bewiesen, dass die API noch steht. `
      + 'Erst zum Laufen bringen, dann fertig melden.');
  }
}

// "  ✗ name  …" — zwei Zeichen eingerueckt. Die Zusammenfassungszeile
// "✗ 1 Funktion(en) gefallen" steht am Zeilenanfang und wird so nicht mitgezaehlt.
const rot = [...ausgabe.matchAll(/^ {2}✗ (\S+)/gm)].map((m) => m[1]);
const gruen = [...ausgabe.matchAll(/^ {2}✓ (\S+)/gm)].map((m) => m[1]);

const neu = rot.filter((n) => !(n in BEKANNT));
const verschwunden = Object.keys(BEKANNT).filter((n) => gruen.includes(n));

// Alles rot heisst fast immer: kein Netz oder das Deployment ist ganz weg.
// Das ist ein Befund, kein Grund durchzuwinken — aber die Meldung soll sagen,
// wo man zuerst nachsieht, statt 28 Funktionen einzeln aufzuzaehlen.
if (gruen.length === 0 && rot.length > 3) {
  block(`RUNDE NICHT FERTIG: im Smoke-Test ist KEINE Funktion gruen (${rot.length} rot). `
    + 'Das ist normalerweise kein Code-Fehler, sondern kein Netz oder ein kaputtes '
    + 'Deployment. Erst "node scripts/smoke_api.mjs" von Hand pruefen, dann erneut melden.\n\n'
    + ausgabe);
}

if (neu.length) {
  block(`RUNDE NICHT FERTIG — ${neu.length} NEUE(R) Ausfall im Smoke-Test: ${neu.join(', ')}.\n\n`
    + 'Diese Funktion(en) stehen nicht auf der Ausnahmeliste in .claude/hooks/rundentor.mjs, '
    + 'sind also seit dieser Runde kaputt. Bekannt und erlaubt sind nur: '
    + `${Object.keys(BEKANNT).join(', ')}.\n\n`
    + 'Nicht als fertig melden. Ursache suchen: Vercel → Deployments → neuestes → Runtime Logs. '
    + 'Haeufigste Ursache ist ein Absturz beim LADEN des Moduls (import.meta in lib/*.js oder '
    + 'api/*.js — dort verboten, siehe CLAUDE.md).\n\n'
    + ausgabe);
}

// Nichts Neues kaputt. Ausgabe trotzdem zeigen, damit der Lauf sichtbar ist.
const hinweis = verschwunden.length
  ? `\nHinweis: ${verschwunden.join(', ')} ist wieder gruen — Eintrag aus BEKANNT in `
    + '.claude/hooks/rundentor.mjs entfernen, sonst deckt die Ausnahme irgendwann einen echten Fehler.'
  : '';

process.stdout.write(JSON.stringify({
  systemMessage: `Rundentor: Smoke-Test bestanden (${gruen.length} gruen, `
    + `${rot.length} bekannte Ausnahme(n): ${rot.join(', ') || '—'}).${hinweis}`,
  suppressOutput: false,
}));
process.exit(0);
