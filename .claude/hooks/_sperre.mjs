// .claude/hooks/_sperre.mjs — gemeinsames Handwerkszeug der vier PreToolUse-Sperren.
//
// Warum es das gibt: die Regeln in CLAUDE.md waren beratend. Ein Agent, der sie
// nicht liest oder falsch auslegt, hat sie gebrochen und niemand hat es gemerkt.
// Ab hier entscheidet nicht mehr die gute Absicht, sondern dieser Code.
//
// Schema (geprueft gegen Claude Code 2.1.261, nicht geraten):
//   Eingang  : PreToolUse-Ereignis als JSON auf stdin
//              { tool_name, tool_input, cwd, session_id, hook_event_name }
//   Ausgang  : JSON auf stdout mit
//              hookSpecificOutput.hookEventName        = "PreToolUse"
//              hookSpecificOutput.permissionDecision   = "deny"
//              hookSpecificOutput.permissionDecisionReason = Klartext
//              Exit 0. (Exit 2 + stderr taete es auch, aber "deny" ist der
//              dokumentierte Weg und die Meldung landet sauber beim Modell.)
//
// .mjs → import.meta waere hier erlaubt. Wird trotzdem nicht gebraucht.
// In lib/*.js und api/*.js bleibt es verboten, siehe CLAUDE.md.

import { basename } from 'node:path';

/** Liest das PreToolUse-Ereignis von stdin. Kaputtes JSON = leeres Ereignis. */
export async function ereignis() {
  let roh = '';
  for await (const stueck of process.stdin) roh += stueck;
  try {
    return JSON.parse(roh || '{}');
  } catch {
    return {};
  }
}

/** Alle Dateipfade, die dieses Werkzeug anfassen will. */
export function pfade(e) {
  const t = e?.tool_input || {};
  const raus = [];
  for (const schluessel of ['file_path', 'filePath', 'path', 'notebook_path']) {
    if (typeof t[schluessel] === 'string' && t[schluessel]) raus.push(t[schluessel]);
  }
  return raus;
}

/** Der Bash-Befehl — leer, wenn es kein Bash-Aufruf ist. */
export function befehl(e) {
  if (e?.tool_name !== 'Bash') return '';
  const c = e?.tool_input?.command;
  return typeof c === 'string' ? c : '';
}

/**
 * Wirft den Rumpf jedes Heredocs weg, die einleitende Zeile bleibt.
 *
 * Ohne das las die SQL-Sperre den Inhalt von
 *   cat > scripts/neu.sql <<'EOF'
 *   CREATE TABLE x();
 *   EOF
 * als Befehl und blockierte genau den Weg, der erlaubt sein MUSS: der Agent
 * legt die .sql-Datei in scripts/ ab, Emanuel fuehrt sie aus. Ein Heredoc-Rumpf
 * ist Nutzlast, kein Kommando. Die einleitende Zeile bleibt drin, damit
 * `psql <<EOF` oder `cat > vercel.json <<EOF` weiterhin auffliegen.
 */
function ohneHeredocs(cmd) {
  const raus = [];
  let ende = null;
  for (const z of cmd.split('\n')) {
    if (ende !== null) {
      if (z.trim() === ende) ende = null;
      continue;
    }
    raus.push(z);
    const m = z.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (m) ende = m[2];
  }
  return raus.join('\n');
}

/**
 * Zerlegt eine Bash-Zeile in ihre einzelnen Kommandos.
 * Grob, aber fuer die Frage "welches Programm wird hier gestartet" genau genug:
 * an | && || ; und Zeilenumbruch trennen.
 */
export function abschnitte(cmd) {
  return ohneHeredocs(cmd)
    .split(/\|\||&&|[|;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Das erste echte Wort eines Abschnitts, ohne vorangestellte Zuweisungen
 * (PGPASSWORD=x psql …) und ohne Pfad (/usr/bin/psql → psql).
 */
export function programm(abschnitt) {
  const worte = abschnitt.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < worte.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(worte[i])) i++;
  const w = worte[i] || '';
  return basename(w.replace(/^["']|["']$/g, ''));
}

/** Argumente eines Abschnitts, nach dem Programmnamen. */
export function argumente(abschnitt) {
  const worte = abschnitt.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < worte.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(worte[i])) i++;
  return worte.slice(i + 1);
}

/**
 * Werkzeuge, die im Normalfall lesen. Nicht "koennen niemals schreiben" —
 * awk, sed, sort und find koennen es sehr wohl, aber nur ueber eine bestimmte
 * Option, und die prueft schreibtAuf() einzeln nach.
 */
export const LESEND = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ugrep',
  'jq', 'wc', 'ls', 'stat', 'file', 'diff', 'md5', 'md5sum', 'shasum', 'sha256sum',
  'awk', 'cut', 'sort', 'uniq', 'echo', 'printf', 'find', 'basename', 'dirname',
  'sed', 'git', 'od', 'xxd', 'nl', 'column',
]);

/** git-Unterbefehle, die nur lesen. Alles andere gilt als schreibend. */
export const GIT_LESEND = new Set([
  'show', 'diff', 'log', 'blame', 'cat-file', 'grep', 'status', 'ls-files',
  'ls-tree', 'rev-parse', 'describe', 'shortlog', 'whatchanged', 'annotate',
]);

/** Schreibt dieser Abschnitt per Umleitung in <ziel>? */
export function leitetUm(abschnitt, ziel) {
  return new RegExp(`>>?\\s*['"]?[^\\s'"|]*${ziel}`, 'i').test(abschnitt);
}

/**
 * Die einzige Stelle, an der "ist das ein Schreibzugriff auf <ziel>" entschieden
 * wird. Vorher stand die Frage in zwei Sperren doppelt und leicht verschieden
 * drin — mit dem Ergebnis, dass ein blankes /-i\b/ jedes `grep -i` fuer eine
 * In-Place-Bearbeitung hielt und das LESEN von vercel.json blockierte. Genau das
 * ist erlaubt: Regel 1 verbietet das Aendern, nicht das Nachsehen. Eine Sperre,
 * die bei jedem zweiten harmlosen Befehl grundlos zumacht, wird abgeschaltet —
 * und dann ist sie ganz weg.
 *
 * Unbekanntes Programm = schreibend. Bei einer eisernen Regel wird im Zweifel
 * zugemacht, nicht aufgemacht.
 *
 * @param {string} abschnitt ein einzelnes Kommando aus abschnitte()
 * @param {string} ziel      Dateiname als Regex-Quelltext, z.B. 'vercel\\.json'
 */
export function schreibtAuf(abschnitt, ziel) {
  if (leitetUm(abschnitt, ziel)) return true;

  const prog = programm(abschnitt);
  if (!LESEND.has(prog)) return true;

  // Die Ausnahmen: Leseprogramme mit einem Schreibschalter.
  if (prog === 'awk' && /(^|\s)(-i\s+inplace|--in-place)/.test(abschnitt)) return true;
  if (prog === 'sed' && /(^|\s)-[a-zA-Z]*i/.test(abschnitt)) return true;
  if (prog === 'sort' && /(^|\s)(-o|--output)\b/.test(abschnitt)) return true;
  if (prog === 'find' && /(^|\s)-(delete|exec|ok|execdir|okdir)\b/.test(abschnitt)) return true;
  if (prog === 'git') {
    const unter = (argumente(abschnitt).find((w) => !w.startsWith('-')) || '').toLowerCase();
    if (!GIT_LESEND.has(unter)) return true;
  }
  return false;
}

/** Sperre zu. Meldung geht als Klartext ans Modell und in die Oberflaeche. */
export function nein(grund) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: grund,
    },
  }));
  process.exit(0);
}

/** Nichts zu beanstanden — kein Ausgang heisst "normale Berechtigungspruefung". */
export function durch() {
  process.exit(0);
}
