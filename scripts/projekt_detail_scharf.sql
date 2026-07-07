-- ═══════════════════════════════════════════════════════════════════════════
-- PROJEKT-DETAIL SCHARF — additive Erweiterung für die Master-Projektansicht
-- ---------------------------------------------------------------------------
-- Rein ADDITIV & IDEMPOTENT: fügt nur Spalten/Bucket hinzu, löscht/ändert nichts.
-- Beliebig oft ausführbar. Alle bestehenden Tabellen bleiben unberührt.
--
-- AUSFÜHREN: Supabase → SQL Editor → einfügen → Run.
--
-- Deckt ab:
--   1. Projekt-Stammdaten: Adresse, Projektleiter, Ansprechperson + Tel/Mail
--   3. Tarif pro Techniker-Zuweisung (Stundensatz)
--   4. Datei-/Foto-Upload → Storage-Bucket 'projektdateien'
--   6. Abrechnungs-Status pro Arbeitsrapport (offen | verrechnet)
-- (2 Techniker-Karten, 5 Rapporte-Liste, 7 Material, 8 Rechnungs-History nutzen
--  bereits bestehende Spalten/Tabellen und brauchen KEINE Migration.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Projekt-Stammdaten erweitern (gs_projekte) ──────────────────────────
ALTER TABLE gs_projekte ADD COLUMN IF NOT EXISTS projektadresse   TEXT;
ALTER TABLE gs_projekte ADD COLUMN IF NOT EXISTS projektleiter    TEXT;
ALTER TABLE gs_projekte ADD COLUMN IF NOT EXISTS ansprechperson   TEXT;
ALTER TABLE gs_projekte ADD COLUMN IF NOT EXISTS ansprech_telefon TEXT;
ALTER TABLE gs_projekte ADD COLUMN IF NOT EXISTS ansprech_email   TEXT;

-- ── 3. Tarif pro Techniker-Zuweisung (gs_projekt_techniker) ────────────────
-- Stundensatz je Zuweisung (z. B. 65 / 70 / 72 CHF/h). Projekt-Stundensatz
-- (gs_projekte.stundensatz) bleibt als Default/Fallback bestehen.
ALTER TABLE gs_projekt_techniker ADD COLUMN IF NOT EXISTS stundensatz DECIMAL(8,2);

-- ── 6. Abrechnungs-Status pro Arbeitsrapport (gs_tagesrapporte) ────────────
-- 'offen' = noch nicht verrechnet, 'verrechnet' = in Rechnung übernommen.
ALTER TABLE gs_tagesrapporte ADD COLUMN IF NOT EXISTS abrechnung_status TEXT DEFAULT 'offen';

-- ── 4. Storage-Bucket 'projektdateien' (privat; nur serverseitig, signierte URLs) ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('projektdateien', 'projektdateien', false)
ON CONFLICT (id) DO NOTHING;
-- Zugriff ausschliesslich über api/cockpit.js mit dem service_role-Key (umgeht RLS).
-- Der Endpunkt ist bereits hart auf den Master gegated → keine zusätzlichen Policies nötig.

-- Fertig. Danach im Cockpit: Mehr → Projektmanagement → Projekt öffnen.
