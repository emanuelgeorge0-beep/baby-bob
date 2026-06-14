-- ═══════════════════════════════════════════════════════════════════════════
-- MASTER-COCKPIT · JARVIS-GEDÄCHTNIS  (gs_jarvis_wissen)
-- ---------------------------------------------------------------------------
-- Persistentes Gedächtnis für Jarvis: was der Geschäftsführer im Gespräch
-- "merken" lässt ("merk dir …", "für die Planung …"), landet hier. Jarvis liest
-- diese Einträge bei JEDER Frage zusätzlich zum Live-DB-Stand mit ein und
-- erinnert sich so an frühere Planungen.
--
-- GEMEINSAME WISSENSBASIS Jarvis ↔ Claude-Code:
--   Dieselbe Tabelle kann auch von Claude-Code-Agenten im Terminal gelesen und
--   beschrieben werden (über den service_role-Key / Supabase SQL Editor). So
--   teilen sich Jarvis (im Cockpit) und Claude Code (im Terminal) EIN
--   gemeinsames Gedächtnis: Was Jarvis sich merkt, sieht der Code-Agent — und
--   umgekehrt.
--
-- EINMALIG im Supabase SQL Editor ausführen (Projekt bmdmoehjwadvdlbrmpuq).
-- Idempotent: gefahrlos mehrfach ausführbar. RLS NUR für die Master/Admin-UUID;
-- der Server (api/cockpit.js) nutzt service_role und umgeht RLS, prüft aber hart
-- die Master-UUID, bevor er liest/schreibt.
-- Master/Admin-UUID: ee46a716-7017-4045-9f67-fe06d05171e7
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Master-UUID-Funktion (idempotent, auch eigenständig lauffähig) ───────
CREATE OR REPLACE FUNCTION gs_master_uid() RETURNS uuid
  LANGUAGE sql IMMUTABLE AS
  $$ SELECT 'ee46a716-7017-4045-9f67-fe06d05171e7'::uuid $$;

-- ── 1. TABELLE gs_jarvis_wissen ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gs_jarvis_wissen (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  kategorie   TEXT DEFAULT 'allgemein',   -- z.B. 'planung', 'business', 'allgemein'
  inhalt      TEXT NOT NULL,              -- der zu merkende Sachverhalt
  erstellt_am TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gs_jarvis_wissen_zeit
  ON gs_jarvis_wissen(erstellt_am DESC);

-- ── 2. RLS: NUR Master/Admin-UUID (service_role umgeht RLS für den Server) ──
ALTER TABLE gs_jarvis_wissen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_only ON gs_jarvis_wissen;
CREATE POLICY master_only ON gs_jarvis_wissen FOR ALL
  USING (auth.uid() = gs_master_uid())
  WITH CHECK (auth.uid() = gs_master_uid());
