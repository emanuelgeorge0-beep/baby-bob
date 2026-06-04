-- ═══════════════════════════════════════════════════════════
-- Rapport System – Full Schema Migration (v1)
-- The "ultimate Techniker Rapport" epic: projects, daily rapporte,
-- invoices, assignments, status. Supersedes techniker_profile_migration.sql.
--
-- Run ONCE in Supabase SQL Editor (DDL can't run via the data API).
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════

-- ── 0. gs_techniker linkage + profile (from techniker_profile_migration) ──
ALTER TABLE gs_techniker
  ADD COLUMN IF NOT EXISTS user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS photo_url        TEXT,
  ADD COLUMN IF NOT EXISTS specialization   TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS rating           DECIMAL(2,1) DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS years_experience INT;
UPDATE gs_techniker t SET user_id = u.id
  FROM auth.users u WHERE t.user_id IS NULL AND lower(t.email) = lower(u.email);

-- ── 1. Projekte (Baustellen/Objekte) ──
CREATE TABLE IF NOT EXISTS gs_projekte (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  projektnummer   TEXT UNIQUE,
  name            TEXT NOT NULL,
  kunde_id        UUID REFERENCES gs_kunden(id) ON DELETE SET NULL,
  partner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  standort        TEXT,
  bereich         TEXT,
  tarif           TEXT,
  stundensatz     DECIMAL(7,2),         -- for automatic invoicing
  status          TEXT DEFAULT 'aktiv', -- aktiv | abgeschlossen | pausiert
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Many-to-many: which technicians are assigned to a project
CREATE TABLE IF NOT EXISTS gs_projekt_techniker (
  projekt_id        UUID REFERENCES gs_projekte(id) ON DELETE CASCADE,
  techniker_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (projekt_id, techniker_user_id)
);

-- ── 2. Tagesrapporte (the daily report) ──
CREATE TABLE IF NOT EXISTS gs_tagesrapporte (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  projekt_id        UUID REFERENCES gs_projekte(id) ON DELETE SET NULL,
  techniker_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Ausgeführt von
  datum             DATE NOT NULL,
  zeit_von          TIME,
  zeit_bis          TIME,
  gesamtstunden     DECIMAL(4,1) DEFAULT 0,
  team              TEXT[] DEFAULT '{}',  -- other team members present
  arbeiten          TEXT[] DEFAULT '{}',  -- Ausgeführte Arbeiten
  material          TEXT[] DEFAULT '{}',
  besonderheiten    TEXT,
  foto_urls         TEXT[] DEFAULT '{}',  -- storage paths (bucket: rapport-photos)
  unterschrift_url  TEXT,                 -- storage path (bucket: rapport-signatures)
  pdf_url           TEXT,                 -- generated PDF (bucket: rapport-pdfs)
  empfaenger        TEXT[] DEFAULT '{}',  -- recipient emails/roles
  status            TEXT DEFAULT 'entwurf', -- entwurf | eingereicht
  woche             INT,
  jahr              INT,
  eingereicht_am    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(projekt_id, techniker_user_id, datum)
);

-- ── 3. Rechnungen (auto-generated from a submitted rapport) ──
CREATE TABLE IF NOT EXISTS gs_rechnungen (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rapport_id      UUID REFERENCES gs_tagesrapporte(id) ON DELETE CASCADE,
  projekt_id      UUID REFERENCES gs_projekte(id) ON DELETE SET NULL,
  rechnungsnummer TEXT UNIQUE,
  stunden         DECIMAL(6,1),
  stundensatz     DECIMAL(7,2),
  betrag          DECIMAL(10,2),         -- stunden × stundensatz
  pdf_url         TEXT,
  empfaenger      TEXT[] DEFAULT '{}',
  status          TEXT DEFAULT 'erstellt', -- erstellt | versendet | bezahlt
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. RLS ──
ALTER TABLE gs_projekte          ENABLE ROW LEVEL SECURITY;
ALTER TABLE gs_projekt_techniker ENABLE ROW LEVEL SECURITY;
ALTER TABLE gs_tagesrapporte     ENABLE ROW LEVEL SECURITY;
ALTER TABLE gs_rechnungen        ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['gs_projekte','gs_projekt_techniker','gs_tagesrapporte','gs_rechnungen'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_all ON %I', t);
    EXECUTE format('CREATE POLICY service_all ON %I FOR ALL USING (auth.role() = ''service_role'')', t);
    EXECUTE format('DROP POLICY IF EXISTS admin_all ON %I', t);
    EXECUTE format('CREATE POLICY admin_all ON %I FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = ''gs_admin''))', t);
  END LOOP;
END $$;

-- Technicians: their own rapporte
DROP POLICY IF EXISTS techniker_own ON gs_tagesrapporte;
CREATE POLICY techniker_own ON gs_tagesrapporte FOR ALL USING (techniker_user_id = auth.uid());

-- Partners: rapporte/invoices/projects for projects they own
DROP POLICY IF EXISTS partner_own_proj ON gs_projekte;
CREATE POLICY partner_own_proj ON gs_projekte FOR SELECT USING (partner_user_id = auth.uid());
DROP POLICY IF EXISTS partner_own_rapporte ON gs_tagesrapporte;
CREATE POLICY partner_own_rapporte ON gs_tagesrapporte FOR SELECT
  USING (EXISTS (SELECT 1 FROM gs_projekte p WHERE p.id = projekt_id AND p.partner_user_id = auth.uid()));
DROP POLICY IF EXISTS partner_own_rechnungen ON gs_rechnungen;
CREATE POLICY partner_own_rechnungen ON gs_rechnungen FOR SELECT
  USING (EXISTS (SELECT 1 FROM gs_projekte p WHERE p.id = projekt_id AND p.partner_user_id = auth.uid()));

-- ── 5. Storage buckets (or create via API): rapport-photos, rapport-signatures,
--      rapport-pdfs, projekt-dokumente — all PRIVATE; access via signed URLs.
