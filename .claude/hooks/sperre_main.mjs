// Sperre c — kein Merge, kein Push auf main aus dem Agenten heraus.
//
// CLAUDE.md Regel 5: EIN Agent pro Ordner, Merges nur ohne laufenden Agenten.
// IRON RULE: Kein Merge im Agenten-Terminal.
//
// Der Grund ist nicht Vorsicht, sondern Erfahrung: main ist bei Vercel auf
// Auto-Deploy. Ein Push auf main ist ein Deploy auf baby-bob.vercel.app — sofort,
// fuer alle, ohne Zwischenschritt. Und mehrere Worktrees arbeiten hier parallel;
// ein Merge aus einem laufenden Agenten heraus zieht fremde, halbfertige Staende
// mit. Ein Zweig-Push ist erlaubt, der Weg nach main geht ueber einen Menschen.

import { execFileSync } from 'node:child_process';
import { ereignis, befehl, abschnitte, programm, argumente, nein, durch } from './_sperre.mjs';

const HAUPT = /^(main|master|origin\/main|origin\/master)$/;

function aktuellerZweig(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: cwd || process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const e = await ereignis();
const cmd = befehl(e);
if (!cmd) durch();

for (const a of abschnitte(cmd)) {
  const prog = programm(a);
  const args = argumente(a).filter((w) => w !== '--');

  if (prog === 'gh' && args[0] === 'pr' && args[1] === 'merge') {
    nein('GESPERRT (CLAUDE.md Regel 5 / IRON RULE "Kein Merge im Agenten-Terminal"): '
      + '"gh pr merge" fuehrt den Zweig nach main zusammen und loest damit den Auto-Deploy aus. '
      + 'Der Agent oeffnet die PR, zusammengefuehrt wird von Hand.');
  }

  if (prog !== 'git') continue;
  const unter = (args.find((w) => !w.startsWith('-')) || '').toLowerCase();

  // Jeder Merge, egal wohin. Regel 5 kennt keine Ausnahme fuer "nur schnell".
  if (unter === 'merge') {
    nein('GESPERRT (CLAUDE.md Regel 5 / IRON RULE "Kein Merge im Agenten-Terminal"): '
      + '"git merge" laeuft nicht aus einem Agenten. Hier arbeiten mehrere Worktrees parallel — '
      + 'ein Merge aus einer laufenden Runde zieht fremde, halbfertige Staende mit. '
      + 'Der Agent committet auf seinen Zweig und meldet fertig; zusammengefuehrt wird '
      + 'im Ruhezustand von Emanuel.');
  }

  // Ein Push, dessen Ziel main/master ist — auch als Refspec HEAD:main.
  if (unter === 'push') {
    const ziele = args.filter((w) => !w.startsWith('-') && w !== 'push');
    const nachHaupt = ziele.some((z) => {
      const rechts = z.includes(':') ? z.split(':').pop() : z;
      return HAUPT.test(rechts.replace(/^refs\/heads\//, ''));
    });
    // Ohne Refspec pusht git den aktuellen Zweig — auf main stehend ist das main.
    const ohneZiel = ziele.length <= 1 && HAUPT.test(aktuellerZweig(e.cwd));
    if (nachHaupt || ohneZiel) {
      nein('GESPERRT (CLAUDE.md Regel 5): ein Push auf main ist bei Vercel ein sofortiger '
        + 'Deploy auf baby-bob.vercel.app — live, fuer alle, ohne Zwischenschritt. '
        + 'Der Agent pusht nur seinen eigenen Zweig (hier: feat/…). '
        + `Aktueller Zweig: ${aktuellerZweig(e.cwd) || 'unbekannt'}.`);
    }
  }

  // git pull auf main ist ein Merge nach main mit Extraschritt.
  if (unter === 'pull' && HAUPT.test(aktuellerZweig(e.cwd))) {
    nein('GESPERRT (CLAUDE.md Regel 5): "git pull" auf main ist ein Merge nach main. '
      + 'Siehe Sperre fuer git merge — das macht Emanuel ohne laufenden Agenten.');
  }
}

durch();
