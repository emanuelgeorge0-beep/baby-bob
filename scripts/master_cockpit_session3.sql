-- ═══════════════════════════════════════════════════════════════════════════
-- MASTER-COCKPIT · SESSION 3 — Marketing-Kampagnen · Lead→Projekt→Marge-Link
-- ---------------------------------------------------------------------------
-- EINMALIG im Supabase SQL Editor ausführen (Projekt bmdmoehjwadvdlbrmpuq).
-- Reihenfolge: Session 1 → Session 2 → Session 3 (alle idempotent).
-- Idempotent: gefahrlos mehrfach ausführbar. RLS NUR für die Master/Admin-UUID.
-- Master/Admin-UUID: ee46a716-7017-4045-9f67-fe06d05171e7
--
-- Das Modul "4 Säulen" braucht KEINE neue Tabelle — es aggregiert nur bereits
-- vorhandene Daten (gs_anfragen / gs_kunden / gs_projekte / gs_techniker /
-- gs_margen) serverseitig. Diese Datei legt nur an, was geschrieben wird.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Master-UUID-Funktion (idempotent, auch ohne Session 1/2 vorhanden) ───
CREATE OR REPLACE FUNCTION gs_master_uid() RETURNS uuid
  LANGUAGE sql IMMUTABLE AS
  $$ SELECT 'ee46a716-7017-4045-9f67-fe06d05171e7'::uuid $$;

-- ── 1. MARKETING-KAMPAGNEN (echte Kampagnen-Objekte mit Laufzeit & Budget) ──
-- Ergänzt die reinen Kanal-Kosten (gs_mkt_kanal) um benannte Kampagnen mit
-- Zeitraum (start/end), Budget vs. tatsächliche Kosten und Status.
CREATE TABLE IF NOT EXISTS gs_mkt_kampagnen (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  kanal       TEXT,                       -- meta|google|app|linkedin|netzwerk|direkt|sonstige
  budget      DECIMAL(12,2) DEFAULT 0,    -- geplantes Budget
  kosten      DECIMAL(12,2) DEFAULT 0,    -- tatsächliche Ausgaben
  start_datum DATE,
  end_datum   DATE,
  status      TEXT DEFAULT 'geplant' CHECK (status IN ('geplant','aktiv','pausiert','beendet')),
  notiz       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kampagnen_zeit ON gs_mkt_kampagnen(start_datum, end_datum);

-- ── 2. gs_margen.projekt_id — Lead→Projekt→Marge-Kette (nur falls gs_margen da) ──
-- gs_margen wird erst durch Session 2 angelegt. Dieser Block läuft gefahrlos
-- auch dann, wenn Session 2 noch NICHT ausgeführt wurde (dann passiert nichts).
DO $$
BEGIN
  IF to_regclass('public.gs_margen') IS NOT NULL THEN
    ALTER TABLE gs_margen ADD COLUMN IF NOT EXISTS projekt_id UUID
      REFERENCES gs_projekte(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_margen_projekt ON gs_margen(projekt_id);
  END IF;
END $$;

-- ── 3. RLS: NUR Master/Admin-UUID (service_role umgeht RLS für den Server) ──
DO $$
DECLARE t TEXT;
  tabs TEXT[] := ARRAY['gs_mkt_kampagnen'];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS master_only ON %I', t);
    EXECUTE format(
      'CREATE POLICY master_only ON %I FOR ALL '
      || 'USING (auth.uid() = gs_master_uid()) '
      || 'WITH CHECK (auth.uid() = gs_master_uid())', t);
  END LOOP;
END $$;
