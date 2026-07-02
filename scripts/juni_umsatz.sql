-- ═══════════════════════════════════════════════════════════════════════════
-- MASTER-COCKPIT · JUNI-2026-UMSATZ nachtragen — Tabelle gs_umsatz_monat
-- ---------------------------------------------------------------------------
-- Trägt den Juni-2026-Gesamtumsatz von CHF 16'975 ein — exakt gleiche Struktur
-- wie März/April/Mai (eine Zeile pro (jahr, monat) in gs_umsatz_monat).
-- Idempotent & gefahrlos mehrfach ausführbar: existiert der Juni-Eintrag schon,
-- wird NUR der Betrag auf 16'975 aktualisiert (kein Duplikat, vorhandene
-- anzahl_projekte/notiz bleiben erhalten).
--
-- AUSFÜHREN: Supabase → SQL Editor → dieses Skript einfügen → Run.
-- (Basis-Tabelle stammt aus scripts/master_cockpit_umsatz.sql.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Sicherheitsnetz: Tabelle + Unique-Index anlegen, falls (wider Erwarten)
--    noch nicht vorhanden. Bestehende Tabelle/Daten bleiben unangetastet. ──
CREATE TABLE IF NOT EXISTS gs_umsatz_monat (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  jahr            INT  NOT NULL,
  monat           INT  NOT NULL CHECK (monat BETWEEN 1 AND 12),
  umsatz_chf      NUMERIC(12,2) NOT NULL DEFAULT 0,
  anzahl_projekte INT,
  notiz           TEXT,
  erstellt_am     TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_umsatz_jahr_monat ON gs_umsatz_monat(jahr, monat);

-- ── Juni 2026 = CHF 16'975 (Upsert über (jahr, monat)) ──────────────────────
INSERT INTO gs_umsatz_monat (jahr, monat, umsatz_chf) VALUES
  (2026, 6, 16975)
ON CONFLICT (jahr, monat) DO UPDATE
  SET umsatz_chf = EXCLUDED.umsatz_chf;

-- Kontrolle (optional): zeigt die 2026er-Monate nach dem Lauf.
-- SELECT jahr, monat, umsatz_chf FROM gs_umsatz_monat WHERE jahr = 2026 ORDER BY monat;
