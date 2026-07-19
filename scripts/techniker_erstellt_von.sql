-- ═══════════════════════════════════════════════════════════════════════════
-- Additiv: WER hat den Techniker-Account angelegt.
-- Heute immer der Master/gs_admin. Vorbereitung für späteres Feature
-- „freigeschaltete Partnerfirma legt eigene Techniker an" — NUR Datenmodell,
-- die Berechtigungslogik (wer darf anlegen) kommt in einer eigenen Runde.
-- Run ONCE im Supabase SQL-Editor. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE gs_techniker
  ADD COLUMN IF NOT EXISTS erstellt_von_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN gs_techniker.erstellt_von_user_id IS
  'Ersteller des Techniker-Accounts (Master/gs_admin heute; Vorbereitung: '
  'freigeschaltete Partnerfirma legt eigene Techniker an — Berechtigungslogik später).';
