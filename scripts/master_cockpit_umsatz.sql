-- ═══════════════════════════════════════════════════════════════════════════
-- MASTER-COCKPIT · UMSATZ-DATEN — Tabelle gs_umsatz_monat
-- ---------------------------------------------------------------------------
-- EINMALIG im Supabase SQL Editor ausführen (Projekt bmdmoehjwadvdlbrmpuq).
-- Idempotent: gefahrlos mehrfach ausführbar. RLS NUR für die Master/Admin-UUID.
-- Master/Admin-UUID: ee46a716-7017-4045-9f67-fe06d05171e7
--
-- HIER trägst du deine echten Monatsumsätze ein (siehe Block 3 ganz unten).
-- Jarvis und das Command-Center lesen NUR aus dieser Tabelle — keine erfundenen
-- Zahlen. Solange nichts eingetragen ist, zeigt das Cockpit ehrlich „—".
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Master-UUID-Funktion (idempotent, auch ohne Session 1/2/3 vorhanden) ──
CREATE OR REPLACE FUNCTION gs_master_uid() RETURNS uuid
  LANGUAGE sql IMMUTABLE AS
  $$ SELECT 'ee46a716-7017-4045-9f67-fe06d05171e7'::uuid $$;

-- ── 1. TABELLE gs_umsatz_monat (eine Zeile pro Monat) ───────────────────────
CREATE TABLE IF NOT EXISTS gs_umsatz_monat (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  jahr            INT  NOT NULL,
  monat           INT  NOT NULL CHECK (monat BETWEEN 1 AND 12),
  umsatz_chf      NUMERIC(12,2) NOT NULL DEFAULT 0,  -- Monatsumsatz in CHF
  anzahl_projekte INT,                               -- optional
  notiz           TEXT,                              -- optional
  erstellt_am     TIMESTAMPTZ DEFAULT NOW()
);
-- Ein Datensatz je (Jahr, Monat) → erneutes Einspielen aktualisiert statt doppelt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_umsatz_jahr_monat ON gs_umsatz_monat(jahr, monat);

-- ── 2. RLS: NUR Master/Admin-UUID (service_role umgeht RLS für den Server) ──
ALTER TABLE gs_umsatz_monat ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_only ON gs_umsatz_monat;
CREATE POLICY master_only ON gs_umsatz_monat FOR ALL
  USING (auth.uid() = gs_master_uid())
  WITH CHECK (auth.uid() = gs_master_uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- ── 3. DEINE ECHTEN ZAHLEN — HIER EINTRAGEN ─────────────────────────────────
-- ---------------------------------------------------------------------------
-- SO FÜLLST DU ES AUS:
--   1. Entferne unten das Kommentarzeichen „-- " vor JEDER Zeile, die du brauchst
--      (Block-Kopf INSERT … VALUES, die gewünschten Monats-Zeilen UND den
--       ON CONFLICT-Abschnitt).
--   2. Ersetze in jeder Monats-Zeile die 0 (= umsatz_chf) durch deinen echten
--      Umsatz in CHF, z. B. 18500.  anzahl_projekte / 'Notiz' sind optional
--      (NULL lassen oder ausfüllen).
--   3. Markiere alles und „Run". Dank ON CONFLICT kannst du es jederzeit erneut
--      ausführen, um Zahlen zu korrigieren oder Monate zu ergänzen.
--   4. Du musst nicht alle Monate ausfüllen — nimm nur die, für die du Zahlen hast.
-- ---------------------------------------------------------------------------
-- INSERT INTO gs_umsatz_monat (jahr, monat, umsatz_chf, anzahl_projekte, notiz) VALUES
--   (2025,  1,    0, NULL, NULL),   -- Januar 2025      ← Umsatz CHF eintragen
--   (2025,  2,    0, NULL, NULL),   -- Februar 2025
--   (2025,  3,    0, NULL, NULL),   -- März 2025
--   (2025,  4,    0, NULL, NULL),   -- April 2025
--   (2025,  5,    0, NULL, NULL),   -- Mai 2025
--   (2025,  6,    0, NULL, NULL),   -- Juni 2025
--   (2025,  7,    0, NULL, NULL),   -- Juli 2025
--   (2025,  8,    0, NULL, NULL),   -- August 2025
--   (2025,  9,    0, NULL, NULL),   -- September 2025
--   (2025, 10,    0, NULL, NULL),   -- Oktober 2025
--   (2025, 11,    0, NULL, NULL),   -- November 2025
--   (2025, 12,    0, NULL, NULL),   -- Dezember 2025
--   (2026,  1,    0, NULL, NULL),   -- Januar 2026
--   (2026,  2,    0, NULL, NULL),   -- Februar 2026
--   (2026,  3,    0, NULL, NULL),   -- März 2026
--   (2026,  4,    0, NULL, NULL),   -- April 2026
--   (2026,  5,    0, NULL, NULL),   -- Mai 2026
--   (2026,  6,    0, NULL, NULL)    -- Juni 2026         ← letzte Zeile OHNE Komma
-- ON CONFLICT (jahr, monat) DO UPDATE
--   SET umsatz_chf      = EXCLUDED.umsatz_chf,
--       anzahl_projekte = EXCLUDED.anzahl_projekte,
--       notiz           = EXCLUDED.notiz;
-- ═══════════════════════════════════════════════════════════════════════════
