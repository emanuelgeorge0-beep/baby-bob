// Sperre a — vercel.json ist unantastbar.
//
// CLAUDE.md Regel 1: outputDirectory "." NIEMALS aendern/entfernen. Warum das
// eine eiserne Regel ist, steht im Gedaechtnis: ohne den Eintrag serviert Vercel
// nur noch public/, und jede Datei im Wurzelverzeichnis (index.html, app.html,
// gs-intern.html) antwortet mit 404. Ein Zeichen in dieser Datei legt die
// gesamte Oberflaeche still.
//
// Die Sperre gilt fuer JEDEN Schreibweg: Write/Edit auf die Datei genauso wie
// sed -i, tee, mv, cp, rm oder eine Umleitung aus Bash heraus. Lesen bleibt frei.

import { ereignis, pfade, befehl, abschnitte, programm, LESEND, leitetUm, nein, durch } from './_sperre.mjs';

const GRUND = 'GESPERRT (CLAUDE.md Regel 1): vercel.json wird nicht veraendert. '
  + 'Ohne "outputDirectory": "." serviert Vercel nur noch public/ — index.html, app.html '
  + 'und gs-intern.html antworten dann mit 404 und die ganze Oberflaeche ist tot. '
  + 'Lesen ist erlaubt, Schreiben nicht. Wenn hier wirklich etwas geaendert werden muss: '
  + 'Emanuel fragen und von Hand machen, nicht aus dem Agenten heraus.';

const e = await ereignis();

// Weg 1: ein Werkzeug will die Datei direkt schreiben.
for (const p of pfade(e)) {
  if (/(^|\/)vercel\.json$/.test(p)) nein(GRUND);
}

// Weg 2: Bash. Nur anschlagen, wenn der Abschnitt die Datei auch anfassen will —
// ein `cat vercel.json` oder `git diff vercel.json` bleibt erlaubt.
const cmd = befehl(e);
if (cmd && /vercel\.json/.test(cmd)) {
  for (const a of abschnitte(cmd)) {
    if (!/vercel\.json/.test(a) && !leitetUm(a, 'vercel\\.json')) continue;
    const prog = programm(a);
    if (leitetUm(a, 'vercel\\.json')) nein(GRUND);
    if (!LESEND.has(prog)) nein(GRUND);
    // `sed`/`perl` stehen nicht in LESEND, `awk` schon — awk -i inplace waere
    // der eine Schlupfweg, also hier noch einmal ausdruecklich zu.
    if (/-i\b|inplace/.test(a)) nein(GRUND);
  }
}

durch();
