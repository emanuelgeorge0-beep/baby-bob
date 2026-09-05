// ═══════════════════════════════════════════════════════════════════════════
// SPERREN — Beweis, dass die vier PreToolUse-Hooks das Richtige blockieren
// UND das Richtige durchlassen.
// ═══════════════════════════════════════════════════════════════════════════
// Hintergrund: die Regeln in CLAUDE.md waren beratend. Seit .claude/settings.json
// setzen vier Hooks sie technisch durch. Der erste Entwurf hatte zwei Fehler, die
// beide nur durch die DURCHLASS-Faelle auffielen, nie durch die Treffer:
//
//   1. Ein Heredoc-Rumpf wurde als Befehlsfolge gelesen. `cat > scripts/x.sql
//      <<EOF ... CREATE TABLE ... EOF` schlug bei der SQL-Sperre an — also genau
//      der Weg, der erlaubt sein MUSS: Agent schreibt die .sql, Emanuel fuehrt aus.
//   2. Ein blankes /-i\b/ hielt jedes `grep -i` fuer eine In-Place-Bearbeitung
//      und blockierte das LESEN von vercel.json. Regel 1 verbietet das Aendern,
//      nicht das Nachsehen. Und `git show|diff|log` fiel durch, weil `git` nicht
//      in der Leseliste stand.
//
// Deshalb pruefen hier Treffer und Durchlaesse gleichberechtigt. Eine Sperre, die
// bei jedem zweiten harmlosen Befehl grundlos zumacht, wird abgeschaltet — und
// dann ist sie ganz weg.
//
// Die Ausloeser-Zeichenketten werden aus Teilen zusammengesetzt. Stuenden sie
// wortwoertlich in einer Zeile, wuerden die Sperren den Test blockieren, der sie
// prueft — das ist beim Bau tatsaechlich passiert.
//
// Lauf:  node scripts/test_sperren.mjs
// Kein Netz, keine DB, keine Env — nur die Hooks gegen erfundene Ereignisse.
// ═══════════════════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const WURZEL = new URL('..', import.meta.url).pathname;
const H = `${WURZEL}.claude/hooks/`;
const V = ['vercel', '.', 'json'].join('');
const E = ['.', 'env'].join('');

const bash = (command) => ({ tool_name: 'Bash', cwd: WURZEL, tool_input: { command } });

// [Sperre, Skript, Beschreibung, erwartet, Ereignis]
const faelle = [
  // ── a · vercel.json: SCHREIBEN ist verboten ───────────────────────────────
  ['a', 'sperre_vercel.mjs', 'Write auf die Datei', 'sperren', { tool_name: 'Write', tool_input: { file_path: `${WURZEL}${V}`, content: '{}' } }],
  ['a', 'sperre_vercel.mjs', 'Edit auf die Datei', 'sperren', { tool_name: 'Edit', tool_input: { file_path: V, old_string: 'a', new_string: 'b' } }],
  ['a', 'sperre_vercel.mjs', 'sed -i', 'sperren', bash(`sed -i '' s/x/y/ ${V}`)],
  ['a', 'sperre_vercel.mjs', 'Umleitung >', 'sperren', bash(`echo '{}' > ${V}`)],
  ['a', 'sperre_vercel.mjs', 'Umleitung >>', 'sperren', bash(`echo x >> ${V}`)],
  ['a', 'sperre_vercel.mjs', 'tee', 'sperren', bash(`echo '{}' | tee ${V}`)],
  ['a', 'sperre_vercel.mjs', 'mv darauf', 'sperren', bash(`mv neu ${V}`)],
  ['a', 'sperre_vercel.mjs', 'cp darauf', 'sperren', bash(`cp muster ${V}`)],
  ['a', 'sperre_vercel.mjs', 'rm', 'sperren', bash(`rm ${V}`)],
  ['a', 'sperre_vercel.mjs', 'sort -o', 'sperren', bash(`sort -o ${V} andere`)],
  ['a', 'sperre_vercel.mjs', 'awk -i inplace', 'sperren', bash(`awk -i inplace '{print}' ${V}`)],
  ['a', 'sperre_vercel.mjs', 'find -delete', 'sperren', bash(`find . -name ${V} -delete`)],
  ['a', 'sperre_vercel.mjs', 'git checkout --', 'sperren', bash(`git checkout -- ${V}`)],
  ['a', 'sperre_vercel.mjs', 'git restore', 'sperren', bash(`git restore ${V}`)],
  ['a', 'sperre_vercel.mjs', 'python -m json.tool', 'sperren', bash(`python3 -m json.tool ${V}`)],

  // ── a · vercel.json: LESEN muss durchkommen ───────────────────────────────
  // Regel 1 verbietet das Aendern, nicht das Nachsehen. Der Hook sagt das in
  // seinem eigenen Meldungstext — diese Zeilen halten ihn daran fest.
  ['a', 'sperre_vercel.mjs', 'cat', 'durch', bash(`cat ${V}`)],
  ['a', 'sperre_vercel.mjs', 'head -20', 'durch', bash(`head -20 ${V}`)],
  ['a', 'sperre_vercel.mjs', 'jq .', 'durch', bash(`jq . ${V}`)],
  ['a', 'sperre_vercel.mjs', 'grep', 'durch', bash(`grep outputDirectory ${V}`)],
  ['a', 'sperre_vercel.mjs', 'grep -i', 'durch', bash(`grep -i outputdirectory ${V}`)],
  ['a', 'sperre_vercel.mjs', 'sed -n Bereich', 'durch', bash(`sed -n '1,10p' ${V}`)],
  ['a', 'sperre_vercel.mjs', 'git show HEAD:', 'durch', bash(`git show HEAD:${V}`)],
  ['a', 'sperre_vercel.mjs', 'git diff', 'durch', bash(`git diff ${V}`)],
  ['a', 'sperre_vercel.mjs', 'git log --', 'durch', bash(`git log --oneline -- ${V}`)],
  ['a', 'sperre_vercel.mjs', 'diff gegen andere', 'durch', bash(`diff ${V} andere`)],
  ['a', 'sperre_vercel.mjs', 'cat | jq', 'durch', bash(`cat ${V} | jq .`)],
  ['a', 'sperre_vercel.mjs', 'ls -la', 'durch', bash(`ls -la ${V}`)],
  ['a', 'sperre_vercel.mjs', 'Read auf api/x.js', 'durch', { tool_name: 'Write', tool_input: { file_path: 'api/x.js', content: 'x' } }],

  // ── b · SQL: ausfuehren verboten, schreiben nach scripts/ erlaubt ─────────
  ['b', 'sperre_sql.mjs', 'psql -c', 'sperren', bash('psql "$DATABASE_URL" -c "select 1"')],
  ['b', 'sperre_sql.mjs', 'PGPASSWORD=… psql -f', 'sperren', bash('PGPASSWORD=x psql -h db -f scripts/runde8a.sql')],
  ['b', 'sperre_sql.mjs', 'supabase db push', 'sperren', bash('supabase db push')],
  ['b', 'sperre_sql.mjs', 'supabase migration up', 'sperren', bash('supabase migration up')],
  ['b', 'sperre_sql.mjs', 'curl auf rpc/exec_sql', 'sperren', bash('curl -X POST https://x.supabase.co/rest/v1/rpc/exec_sql -d @q.json')],
  ['b', 'sperre_sql.mjs', 'rohes SQL in der Zeile', 'sperren', bash('DROP TABLE gs_projekte;')],
  ['b', 'sperre_sql.mjs', 'pg_dump', 'sperren', bash('pg_dump -h db -t gs_projekte')],
  ['b', 'sperre_sql.mjs', 'grep psql in scripts/', 'durch', bash('grep -rn psql scripts/')],
  ['b', 'sperre_sql.mjs', '.sql per Heredoc anlegen', 'durch', bash("cat > scripts/neu.sql <<'EOF'\nCREATE TABLE x();\nDROP TABLE y;\nEOF")],
  ['b', 'sperre_sql.mjs', 'Write auf scripts/neu.sql', 'durch', { tool_name: 'Write', tool_input: { file_path: 'scripts/neu.sql', content: 'DROP TABLE x;' } }],
  ['b', 'sperre_sql.mjs', 'node scripts/smoke_api.mjs', 'durch', bash('node scripts/smoke_api.mjs')],

  // ── c · main: kein Merge, kein Push dorthin ───────────────────────────────
  ['c', 'sperre_main.mjs', 'git merge', 'sperren', bash('git merge feat/irgendwas')],
  ['c', 'sperre_main.mjs', 'git push origin main', 'sperren', bash('git push origin main')],
  ['c', 'sperre_main.mjs', 'git push HEAD:main', 'sperren', bash('git push origin HEAD:main')],
  ['c', 'sperre_main.mjs', 'git push refs/heads/main', 'sperren', bash('git push origin HEAD:refs/heads/main')],
  ['c', 'sperre_main.mjs', 'gh pr merge', 'sperren', bash('gh pr merge 12 --squash')],
  ['c', 'sperre_main.mjs', 'push auf eigenen Zweig', 'durch', bash('git push -u origin feat/claude-setup')],
  ['c', 'sperre_main.mjs', 'git commit', 'durch', bash('git commit -m "x"')],
  ['c', 'sperre_main.mjs', 'git status', 'durch', bash('git status --short')],

  // ── d · .env: schreiben verboten, lesen ebenfalls ─────────────────────────
  ['d', 'sperre_env.mjs', `Write auf ${E}.probe`, 'sperren', { tool_name: 'Write', tool_input: { file_path: `${E}.probe`, content: 'K=1' } }],
  ['d', 'sperre_env.mjs', 'Umleitung >>', 'sperren', bash(`echo K=1 >> ${E}`)],
  ['d', 'sperre_env.mjs', 'cp darauf', 'sperren', bash(`cp muster ${E}.local`)],
  ['d', 'sperre_env.mjs', 'mv darauf', 'sperren', bash(`mv alt ${E}`)],
  ['d', 'sperre_env.mjs', 'sed -i', 'sperren', bash(`sed -i '' s/a/b/ ${E}`)],
  // Der Weg, den die Pfadanalyse von permissions.deny nicht sieht:
  ['d', 'sperre_env.mjs', 'git show HEAD:', 'sperren', bash(`git show HEAD:${E}`)],
  ['d', 'sperre_env.mjs', 'git cat-file', 'sperren', bash(`git cat-file -p HEAD:${E}`)],
  ['d', 'sperre_env.mjs', 'git log -p', 'sperren', bash(`git log -p -- ${E}`)],
  ['d', 'sperre_env.mjs', 'process.env im Code', 'durch', bash('node -e "console.log(process.env.HOME)"')],
  ['d', 'sperre_env.mjs', 'Write auf api/x.js', 'durch', { tool_name: 'Write', tool_input: { file_path: 'api/x.js', content: 'x' } }],
];

let fehler = 0;
let letzte = '';
for (const [sperre, skript, was, erwartet, ereignis] of faelle) {
  let aus = '';
  try {
    aus = execFileSync('node', [H + skript], { input: JSON.stringify(ereignis), encoding: 'utf8' });
  } catch (err) {
    aus = `ABSTURZ ${err.message}`;
  }
  let ist = 'durch';
  if (aus.trim()) {
    try {
      const j = JSON.parse(aus);
      ist = j.hookSpecificOutput?.permissionDecision === 'deny' ? 'sperren' : 'durch';
    } catch { ist = 'kaputt'; }
  }
  const ok = ist === erwartet;
  if (!ok) fehler++;
  if (sperre !== letzte) { console.log(`\nSperre ${sperre}`); letzte = sperre; }
  console.log(`  ${ok ? '✓' : '✗'} ${was.padEnd(30)} erwartet=${erwartet.padEnd(7)} ist=${ist}`);
}

// ── Die Ebene, die kein Hook prueft ────────────────────────────────────────
// Das LESEN von .env sperrt nicht ein Hook, sondern permissions.deny in
// settings.json — Claude Code loest Dateipfade in Bash-Befehlen statisch auf und
// haelt sie gegen die Read()-Regeln (nachgemessen: `ls -d node_modules` wird
// verweigert, `ls -d api lib` kommt durch). Wird diese Liste stillschweigend
// gekuerzt, faellt es sonst niemandem auf: die Hooks melden weiter gruen.
console.log('\nLesesperre in .claude/settings.json');
const noetig = [`Read(./${E})`, `Read(./${E}.*)`, 'Read(./node_modules/**)', 'Read(./.vercel/**)'];
let einst;
try {
  einst = JSON.parse(readFileSync(`${WURZEL}.claude/settings.json`, 'utf8'));
} catch (err) {
  console.log(`  ✗ settings.json nicht lesbar: ${err.message}`);
  fehler += noetig.length;
  einst = null;
}
if (einst) {
  const deny = einst.permissions?.deny || [];
  for (const regel of noetig) {
    const da = deny.includes(regel);
    if (!da) fehler++;
    console.log(`  ${da ? '✓' : '✗'} ${regel}`);
  }
}

const gesamt = faelle.length + noetig.length;
console.log(`\n${fehler ? `✗ ${fehler} von ${gesamt} Pruefungen falsch` : `✓ alle ${gesamt} Pruefungen wie erwartet`}`);
process.exit(fehler ? 1 : 0);
