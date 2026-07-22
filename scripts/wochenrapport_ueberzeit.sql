-- ═══════════════════════════════════════════════════════════════════════════
-- WOCHENRAPPORT — Überzeit-Spalten (25% / 50% / 100%), rein additiv
-- ═══════════════════════════════════════════════════════════════════════════
-- gs_tagesrapporte.gesamtstunden bleibt unverändert = Normalstunden (war schon
-- immer "gearbeitete Stunden"). Diese drei Spalten kommen zusätzlich dazu,
-- damit das Wochenblatt Normal/ÜZ25/ÜZ50/ÜZ100 getrennt wie auf Papier führen
-- kann. Run ONCE im Supabase SQL-Editor. Idempotent (ADD COLUMN IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE gs_tagesrapporte
  ADD COLUMN IF NOT EXISTS ueberzeit_25  NUMERIC(4,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ueberzeit_50  NUMERIC(4,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ueberzeit_100 NUMERIC(4,2) DEFAULT 0;

SELECT 'wochenrapport_ueberzeit ready' AS status;
