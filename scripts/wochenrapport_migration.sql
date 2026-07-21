-- ═══════════════════════════════════════════════════════════════════════════
-- WOCHENRAPPORT — Kopf + strukturierte Tageszeilen (Papierformular-Struktur)
-- ═══════════════════════════════════════════════════════════════════════════
-- Ein Rapport = eine Kalenderwoche (Kopf) mit mehreren Tageszeilen (bestehende
-- gs_tagesrapporte, additiv erweitert). Rein additiv — keine bestehende Spalte
-- wird entfernt oder umgebaut, keine bestehende Zeile verändert.
-- Run ONCE im Supabase SQL-Editor. Idempotent (IF NOT EXISTS / IF EXISTS überall).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Wochenkopf ──
-- Wird server-seitig get-or-create angelegt, sobald ein Techniker die erste
-- Tageszeile einer KW speichert. hauptprojekt_id ist reine Anzeige (erstes
-- bebuchtes Projekt der Woche), Zeilen können auf beliebig viele andere
-- Projekte laufen (mehrere Projekte/Tag = mehrere Zeilen, siehe unten).
CREATE TABLE IF NOT EXISTS gs_wochenrapporte (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  techniker_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  jahr              INT NOT NULL,
  woche             INT NOT NULL,
  hauptprojekt_id   UUID REFERENCES gs_projekte(id) ON DELETE SET NULL,
  rapport_nr        TEXT,                          -- z.B. "WR-2026-29-Emanuel"
  status            TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','eingereicht')),
  eingereicht_am    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (techniker_user_id, jahr, woche)
);
CREATE INDEX IF NOT EXISTS idx_gs_wochenrapporte_techniker ON gs_wochenrapporte(techniker_user_id);

-- ── 2. Tageszeile erweitern (bestehende Tabelle, additiv) ──
ALTER TABLE gs_tagesrapporte
  ADD COLUMN IF NOT EXISTS wochenrapport_id     UUID REFERENCES gs_wochenrapporte(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS taetigkeit           TEXT,                      -- Gewerk, z.B. "Sanitär"
  ADD COLUMN IF NOT EXISTS start_zeit           TIME,
  ADD COLUMN IF NOT EXISTS end_zeit             TIME,
  ADD COLUMN IF NOT EXISTS spesen               NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS abwesenheit          TEXT CHECK (abwesenheit IN ('G','F','M','U','A')),
  ADD COLUMN IF NOT EXISTS abwesenheit_grund    TEXT,                      -- nur bei 'A' (Absenzen inkl. Krankheit) relevant
  ADD COLUMN IF NOT EXISTS material_positionen  JSONB DEFAULT '[]'::jsonb; -- [{"bezeichnung":"Ventil DN15","menge":3}]
CREATE INDEX IF NOT EXISTS idx_gs_tagesrapporte_wochenrapport ON gs_tagesrapporte(wochenrapport_id);

-- Bindung lockern: ein Abwesenheits-Tag (G/F/M/U/A) hat KEIN Projekt/Service-
-- Auftrag. Ein Arbeits-Tag hat weiterhin GENAU eines von beiden (unverändert).
-- NOT VALID: bestehende Zeilen werden NICHT rückwirkend geprüft (falls doch
-- irgendwo eine Alt-Zeile ohne projekt_id/service_auftrag_id existiert, blockiert
-- das die Migration nicht) — ab jetzt gilt die Regel nur für neue INSERT/UPDATE.
-- Optional danach (nur falls die Prüf-Query unten 0 Zeilen liefert):
--   ALTER TABLE gs_tagesrapporte VALIDATE CONSTRAINT gs_tagesrapporte_bindung_chk;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gs_tagesrapporte_bindung_chk') THEN
    ALTER TABLE gs_tagesrapporte DROP CONSTRAINT gs_tagesrapporte_bindung_chk;
  END IF;
  ALTER TABLE gs_tagesrapporte
    ADD CONSTRAINT gs_tagesrapporte_bindung_chk
    CHECK (
      (abwesenheit IS NOT NULL AND projekt_id IS NULL AND service_auftrag_id IS NULL)
      OR (abwesenheit IS NULL AND projekt_id IS NOT NULL AND service_auftrag_id IS NULL)
      OR (abwesenheit IS NULL AND projekt_id IS NULL AND service_auftrag_id IS NOT NULL)
    ) NOT VALID;
END $$;

-- ── 3. Fotos an eine konkrete Tageszeile hängen (fürs künftige Foto-Wochenbericht) ──
-- Nullable/additiv — bestehende, nicht tagesgebundene Projekt-Fotos funktionieren
-- unverändert weiter (Filter/Anzeige bleibt primär über projekt_id/service_auftrag_id).
ALTER TABLE gs_projekt_medien
  ADD COLUMN IF NOT EXISTS tagesrapport_id UUID REFERENCES gs_tagesrapporte(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_gs_projekt_medien_tagesrapport ON gs_projekt_medien(tagesrapport_id);

-- ── 4. RLS Wochenkopf (Server läuft mit service_role und umgeht das ohnehin —
--      das hier ist die zusätzliche DB-seitige Absicherung, gleiches Muster
--      wie gs_tagesrapporte in rapport_system_migration.sql) ──
ALTER TABLE gs_wochenrapporte ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON gs_wochenrapporte;
CREATE POLICY service_all ON gs_wochenrapporte FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS admin_all ON gs_wochenrapporte;
CREATE POLICY admin_all ON gs_wochenrapporte FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('gs_admin','master'))
);
DROP POLICY IF EXISTS techniker_own ON gs_wochenrapporte;
CREATE POLICY techniker_own ON gs_wochenrapporte FOR ALL USING (techniker_user_id = auth.uid());

SELECT 'wochenrapport_migration ready' AS status;
