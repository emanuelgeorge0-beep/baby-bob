-- ═══════════════════════════════════════════════════════════════════════════
-- PARTNER-KUNDEN-SCOPE — Datentrennung der Kundenstammdaten (CRM) pro Partner.
-- Run ONCE in Supabase SQL Editor. Idempotent (IF NOT EXISTS).
--
-- Hintergrund: Im Partner-Cockpit ist das Master-Projektmanagement (pm_*-Actions
-- in api/cockpit.js) verfügbar, server-seitig auf die eigenen Projekte des Partners
-- gefiltert. Kundenstammdaten (gs_kunden) sind CRM und dürfen NICHT zwischen
-- Partnern/Master geteilt werden. Diese Migration ergänzt eine Besitz-Spalte, über
-- die der Server pm_kunden / pm_kunde_save je Partner filtert.
--
-- OHNE diese Migration verhält sich der Server sicher (fail-safe): der Partner sieht
-- schlicht KEINE Kundenliste (leere Liste), kann aber inline neue Kunden anlegen und
-- Projekten zuordnen. Nach dem Einspielen erscheinen die eigenen Kunden im Dropdown.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE gs_kunden
  ADD COLUMN IF NOT EXISTS partner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gs_kunden_partner ON gs_kunden (partner_user_id);

-- Bestehende Kunden bleiben partner_user_id = NULL (gehören dem Master-Bestand) und
-- sind damit für keinen Partner sichtbar – Master sieht weiterhin alle (kein Filter).
