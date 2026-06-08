-- scripts/utm_tracking_migration.sql
-- Quellen-/UTM-Tracking für GS-Leads. Idempotent (mehrfach ausführbar).
-- WICHTIG: Die produktive Lead-Tabelle heisst real `gs_anfragen` (NICHT `gs_kundenanfragen`).
-- Im Supabase SQL-Editor ausführen (DDL läuft nicht über die Data-API).

ALTER TABLE gs_anfragen ADD COLUMN IF NOT EXISTS utm_source   TEXT;
ALTER TABLE gs_anfragen ADD COLUMN IF NOT EXISTS utm_medium   TEXT;
ALTER TABLE gs_anfragen ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE gs_anfragen ADD COLUMN IF NOT EXISTS utm_term     TEXT;
ALTER TABLE gs_anfragen ADD COLUMN IF NOT EXISTS utm_content  TEXT;
ALTER TABLE gs_anfragen ADD COLUMN IF NOT EXISTS referrer     TEXT;
ALTER TABLE gs_anfragen ADD COLUMN IF NOT EXISTS quelle       TEXT;

-- Bestehende Zeilen ohne Quelle als "direkt" markieren (idempotent).
UPDATE gs_anfragen SET quelle = 'direkt' WHERE quelle IS NULL;

-- Optional: schneller Filter nach Quelle im Dashboard.
CREATE INDEX IF NOT EXISTS idx_gs_anfragen_quelle ON gs_anfragen (quelle);
