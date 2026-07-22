-- ═══════════════════════════════════════════════════════════════════════════
-- WOCHENRAPPORT — Kunden-Spesenreglement (Vorbereitung, rein additiv)
-- ═══════════════════════════════════════════════════════════════════════════
-- Nur Struktur, keine Pflege-UI: Sätze pro Kunde hinterlegbar als
--   {"saetze":[15,30,35,45]}
-- Ist der Wert NULL (Standard), nutzt der Wochenrapport-Editor die festen
-- Standard-Chips 15/30/35/45 CHF (siehe SPESEN_DEFAULT in api/cockpit.js).
-- Run ONCE im Supabase SQL-Editor (DDL geht nicht über die PostgREST-Data-API).
-- Idempotent (ADD COLUMN IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE gs_kunden ADD COLUMN IF NOT EXISTS spesenreglement JSONB;

SELECT 'wochenrapport_tabelle ready' AS status;
