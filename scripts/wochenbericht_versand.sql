-- ═══════════════════════════════════════════════════════════════════════════
-- WOCHENBERICHT — Versandprotokoll (Nachtrag zu scripts/wochenbericht.sql)
-- ═══════════════════════════════════════════════════════════════════════════
-- EINE additive Spalte. Kein DROP, kein Umbau, keine neue Tabelle.
-- Run ONCE im Supabase SQL-Editor. Idempotent.
--
-- Warum überhaupt: gs_wochenberichte trägt bereits versendet_am und empfaenger,
-- aber beide werden bei einem erneuten Versand überschrieben. Ein Bericht, der
-- an den Bauleiter und später an den Kunden geht, hätte danach nur noch den
-- letzten Empfänger — der erste Versand wäre spurlos. Das Protokoll ist
-- append-only und beantwortet: wer hat wann welche Nummer bekommen.
--
-- Warum keine eigene Tabelle: der Verlauf gehört genau zu einem Berichtskopf,
-- wird nur mit ihm gelesen und ist nach Zeilenzahl winzig. Eine Tabelle mit FK,
-- Index und RLS wäre mehr Apparat als Inhalt.
--
-- Warum nicht in `daten`: das ist der eingefrorene Datenstand des Berichts.
-- Ein Versandeintrag ist kein Berichtsinhalt und hat dort nichts verloren.
--
-- Der Code läuft AUCH OHNE diese Migration: fehlt die Spalte, wird der Versand
-- weiterhin über versendet_am/empfaenger/status festgehalten, nur eben ohne
-- Historie. Kein 500, keine blockierte Mail (Muster wie überall: notMigrated).
--
-- ── NAMENSPRÜFUNG (Eiserne Regel 7) ───────────────────────────────────────
--   versand_protokoll kommt in keiner .sql des Repos vor; gs_wochenberichte
--   existiert bereits (scripts/wochenbericht.sql ist gelaufen).
--   Kein CREATE TABLE, kein DROP TABLE → Regeln 7/8 nicht weiter berührt.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE gs_wochenberichte
  ADD COLUMN IF NOT EXISTS versand_protokoll JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN gs_wochenberichte.versand_protokoll IS
  'Append-only Versandhistorie. Ein Objekt je Versand: '
  '{"am":"2026-08-10T12:00:00Z","an":["bauleiter@..."],"bericht_nr":"WB-NIE-2026-31",'
  '"von":"<user-uuid>","ok":true,"fehler":null,"pdf_bytes":51234}. '
  'versendet_am/empfaenger auf derselben Zeile spiegeln immer den LETZTEN Versand — '
  'die vollständige Historie steht nur hier.';

-- Sichtprüfung (read-only):
--   SELECT bericht_nr, status, versendet_am,
--          jsonb_array_length(versand_protokoll) AS versande
--     FROM gs_wochenberichte ORDER BY created_at DESC;

SELECT 'wochenbericht_versand ready' AS status;
