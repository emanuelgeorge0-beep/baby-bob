// Sperre d — .env und alles, was mit .env anfaengt, wird nicht geschrieben.
//
// CLAUDE.md Regel 3: Keine Secrets im Code — nur aus Vercel-Env. Eine .env im
// Worktree ist genau der Weg, auf dem ein Schluessel doch im Repo landet: erst
// "nur lokal zum Testen", dann ein git add -A, und der Supabase-Service-Key
// steht in der Historie. .env und .env.local stehen zwar in .gitignore, aber
// .env.probe oder .env.neu eben nicht — deshalb sperrt das hier den ganzen
// Praefix, nicht nur die zwei bekannten Namen.
//
// Lesen sperrt zusaetzlich die deny-Regel in .claude/settings.json
// (Read/Grep/Glob auf .env*). Diese Sperre hier ist die Schreibhaelfte.

import { basename } from 'node:path';
import { ereignis, pfade, befehl, abschnitte, programm, LESEND, nein, durch } from './_sperre.mjs';

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

// Weg 2: Bash. Wieder nur, wenn der Abschnitt sie auch anfasst — cat/grep bleibt frei,
// das Lesen wird an anderer Stelle geregelt.
const cmd = befehl(e);
if (cmd && ENV_IM_TEXT.test(cmd)) {
  for (const a of abschnitte(cmd)) {
    if (!ENV_IM_TEXT.test(a)) continue;
    if (/>>?\s*['"]?[^\s'"|]*\.env/.test(a)) nein(GRUND);
    const prog = programm(a);
    if (!LESEND.has(prog)) nein(GRUND);
    if (/\s-i\b|inplace/.test(a)) nein(GRUND);
  }
}

durch();
