// Sperre d — .env und alles, was mit .env anfaengt, wird nicht geschrieben.
//
// CLAUDE.md Regel 3: Keine Secrets im Code — nur aus Vercel-Env. Eine .env im
// Worktree ist genau der Weg, auf dem ein Schluessel doch im Repo landet: erst
// "nur lokal zum Testen", dann ein git add -A, und der Supabase-Service-Key
// steht in der Historie. .env und .env.local stehen zwar in .gitignore, aber
// .env.probe oder .env.neu eben nicht — deshalb sperrt das hier den ganzen
// Praefix, nicht nur die zwei bekannten Namen.
//
// Diese Sperre hier ist die SCHREIBhaelfte. Das Lesen sperrt permissions.deny
// in .claude/settings.json (Read(./.env), Read(./.env.*)) — und zwar nachweislich
// auch fuer Bash: Claude Code loest Dateipfade in Bash-Befehlen statisch auf und
// haelt sie gegen die Read()-Regeln. Nachgemessen mit derselben Regelform:
// `ls -d node_modules` wird verweigert, `ls -d api lib` kommt durch.
//
// ACHTUNG, hier weicht diese Sperre bewusst von sperre_vercel.mjs ab:
// bei vercel.json ist LESEN erlaubt und nur Schreiben verboten, bei .env ist
// BEIDES verboten. Die beiden duerfen deshalb nicht dieselbe Lese-Politik haben.
// Eine Luecke laesst die Pfadanalyse offen: `git show HEAD:.env` liest aus den
// Git-Objekten, nicht vom Dateisystem, und taucht dort als Pfad gar nicht auf.
// Den einen Fall macht diese Datei unten ausdruecklich zu.

import { basename } from 'node:path';
import { ereignis, pfade, befehl, abschnitte, programm, argumente, schreibtAuf, nein, durch } from './_sperre.mjs';

const GRUND = 'GESPERRT (CLAUDE.md Regel 3 "Keine Secrets im Code"): Dateien, die mit .env '
  + 'anfangen, werden aus dem Agenten heraus nicht geschrieben. So landet ein Schluessel '
  + 'im Worktree, ueberlebt das naechste git add -A und steht danach fuer immer in der '
  + 'Historie. Geheimnisse kommen aus der Vercel-Umgebung, nicht aus einer Datei hier. '
  + 'Wenn lokal wirklich eine .env gebraucht wird: Emanuel legt sie von Hand an.';

// .env am Anfang eines Dateinamens. Das Zeichen davor darf kein Wortzeichen sein,
// sonst schlaegt jedes harmlose process.env an.
const ENV_IM_TEXT = /(?<![\w])\.env(\b|[.\-\w]*)/;

function istEnvDatei(p) {
  return basename(p).startsWith('.env');
}

const e = await ereignis();

// Weg 1: Write/Edit/NotebookEdit direkt auf die Datei.
for (const p of pfade(e)) {
  if (istEnvDatei(p)) nein(`${GRUND} (Pfad: ${p})`);
}

// Nachricht fuer den einen Leseweg, den die Pfadanalyse nicht sieht.
const GRUND_GIT = 'GESPERRT (CLAUDE.md Regel 3 "Keine Secrets im Code"): das liest eine '
  + '.env-Datei aus den Git-Objekten. Der Umweg zaehlt genauso wie ein cat — waere je '
  + 'ein Schluessel eingecheckt worden, holt genau dieser Befehl ihn wieder hervor. '
  + 'Geheimnisse kommen aus der Vercel-Umgebung.';

// Weg 2: Bash — Schreibzugriffe. Was als Schreiben gilt, entscheidet schreibtAuf()
// in _sperre.mjs. Die reinen Dateisystem-Lesewege (cat, head, grep) laufen hier
// durch und werden eine Ebene tiefer von permissions.deny abgefangen.
const cmd = befehl(e);
if (cmd && ENV_IM_TEXT.test(cmd)) {
  for (const a of abschnitte(cmd)) {
    if (!ENV_IM_TEXT.test(a)) continue;
    if (schreibtAuf(a, '\\.env')) nein(GRUND);

    // Zusatzregel, die es bei vercel.json bewusst NICHT gibt: git show/cat-file/grep
    // holt den Inhalt aus der Historie statt von der Platte. Fuer schreibtAuf() ist
    // das zu Recht ein Lesezugriff — hier ist Lesen aber gerade verboten.
    if (programm(a) === 'git') {
      const unter = (argumente(a).find((w) => !w.startsWith('-')) || '').toLowerCase();
      if (['show', 'cat-file', 'grep', 'diff', 'log', 'blame'].includes(unter)) nein(GRUND_GIT);
    }
  }
}

durch();
