-- ============================================================
-- George Solutions — Runde 8a (Blocker)
-- scripts/runde8a.sql | MANUELL im Supabase SQL Editor ausführen.
-- Erweitert nur bestehende Tabellen. Ändert KEINE Engine-Logik.
-- Die Runtime funktioniert auch OHNE diese Spalte (Listen filtern
-- JS-seitig, Löschen meldet dann sauber „scripts/runde8a.sql ausführen").
-- Idempotent.
-- ============================================================

-- ── Block 3: Projekte löschen (Soft-Delete) ──
-- Master (Sub-Anfragen-Liste, x-Button) und Partner (eigene Entwürfe) können
-- Projekte entfernen. Gelöschte Projekte verschwinden aus ALLEN Listen,
-- bleiben aber in der DB (geloescht_at gesetzt statt DELETE).
-- Gesperrt, sobald Escrow-Geld hinterlegt ist (Steps hinterlegt/gs_fertig/
-- freigegeben) — dann nur Stornierung.
alter table gs_projekte add column if not exists geloescht_at timestamptz;
