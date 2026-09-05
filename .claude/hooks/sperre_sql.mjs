// Sperre b — kein SQL gegen die Datenbank aus dem Agenten heraus.
//
// IRON RULE: SQL nur in scripts/ und nur manuell in Supabase durch Emanuel.
// CLAUDE.md Regel 7 und 8: vor jedem CREATE TABLE pruefen, kein DROP TABLE ohne
// Pruefung. Ein Agent, der eine Migration selbst faehrt, kann beides nicht
// verlaesslich — er sieht die Live-Daten nicht, die er gerade wegwirft.
//
// Was gesperrt wird: das AUSFUEHREN. Eine .sql-Datei in scripts/ schreiben,
// lesen, greppen bleibt ausdruecklich erlaubt — genau so ist der Weg gedacht:
// Agent schreibt scripts/foo.sql, Emanuel fuehrt es im Supabase-Editor aus.
//
// Erkannt wird das Programm am Anfang eines Abschnitts, nicht irgendwo im Text.
// Sonst wuerde schon `grep psql scripts/` anschlagen, und eine Sperre, die bei
// jedem zweiten Befehl ohne Grund zumacht, wird abgeschaltet — dann ist sie weg.

import { ereignis, befehl, abschnitte, programm, argumente, nein, durch } from './_sperre.mjs';

const GRUND_KOPF = 'GESPERRT (IRON RULE: SQL nur in scripts/, ausgefuehrt von Hand durch Emanuel): ';
const GRUND_FUSS = ' Der vorgesehene Weg: die Anweisungen in eine Datei unter scripts/ schreiben '
  + '(das ist erlaubt und wird nicht blockiert), im Rundenbericht darauf hinweisen, '
  + 'und Emanuel fuehrt sie im Supabase-SQL-Editor aus. Vorher gilt CLAUDE.md Regel 7 '
  + '(Tabellenname pruefen) und Regel 8 (kein DROP TABLE ohne Pruefung).';

// Datenbank-Klienten. Wer eines davon startet, redet mit einer Datenbank.
const KLIENTEN = new Set(['psql', 'pgcli', 'pg_dump', 'pg_restore', 'pgbench', 'mysql', 'mysqldump', 'sqlite3', 'usql', 'dbmate', 'flyway', 'liquibase']);

// Rohes SQL, direkt als Befehl getippt.
const SQL_ANFANG = /^(select|insert|update|delete|drop|create|alter|truncate|grant|revoke|begin|commit|vacuum|copy|with)\b/i;

const e = await ereignis();
const cmd = befehl(e);
if (!cmd) durch();

for (const a of abschnitte(cmd)) {
  const prog = programm(a);
  const args = argumente(a);

  if (KLIENTEN.has(prog)) {
    nein(`${GRUND_KOPF}"${prog}" startet einen Datenbank-Klienten. Ein Agent fuehrt kein SQL gegen die Datenbank aus.${GRUND_FUSS}`);
  }

  // supabase db push / db reset / migration up / sql — alles Schreibwege in die DB.
  if (prog === 'supabase' && /^(db|sql|migration|migrations)$/i.test(args[0] || '')) {
    nein(`${GRUND_KOPF}"supabase ${args[0]}" fasst die Datenbank an.${GRUND_FUSS}`);
  }

  // Supabase-REST als Umweg: curl auf /rest/v1/rpc/... oder eine exec_sql-Funktion.
  if ((prog === 'curl' || prog === 'wget' || prog === 'http' || prog === 'httpie')
      && /supabase\.(co|in)|\/rest\/v1\/|\/rpc\//i.test(a)
      && /rpc|exec_sql|execute_sql|query|\bsql\b/i.test(a)) {
    nein(`${GRUND_KOPF}das ist ein SQL-Aufruf ueber die Supabase-REST-Schnittstelle. Der Umweg zaehlt genauso.${GRUND_FUSS}`);
  }

  // Ein Einzeiler in node/python, der sich einen Postgres-Klienten holt.
  if (/^(node|python3?|deno|bun|ts-node|tsx)$/.test(prog)
      && /require\(['"]pg['"]\)|from ['"]pg['"]|import\s+pg\b|psycopg|postgres\(|createClient\(/.test(a)
      && /-e\b|-c\b|--eval/.test(a)) {
    nein(`${GRUND_KOPF}dieser Einzeiler oeffnet eine Datenbankverbindung.${GRUND_FUSS}`);
  }

  // Rohes SQL, direkt in die Kommandozeile getippt.
  if (SQL_ANFANG.test(a) && /;\s*$|\bfrom\b|\btable\b|\binto\b/i.test(a)) {
    nein(`${GRUND_KOPF}das ist eine SQL-Anweisung.${GRUND_FUSS}`);
  }
}

durch();
