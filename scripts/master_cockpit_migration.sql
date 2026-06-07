-- ═══════════════════════════════════════════════════════════════════════════
-- MASTER COCKPIT – Schema + RLS (PM / CRM / Marketing / To-Dos)
-- Run ONCE in Supabase SQL Editor. Idempotent (IF NOT EXISTS). Order: base → dependent.
-- SECURITY: only the Master/Admin UUID may read/write these tables (RLS below).
-- Admin/Master UUID: ee46a716-7017-4045-9f67-fe06d05171e7
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN PERFORM 1; END $$;  -- noop

-- ── 0. Roles: allow 'master' ──────────────────────────────────────────────
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('bob_user','gs_partner','techniker','gs_admin','master'));
INSERT INTO user_roles (user_id, role)
  VALUES ('ee46a716-7017-4045-9f67-fe06d05171e7','master')
  ON CONFLICT (user_id) DO UPDATE SET role='master', updated_at=NOW();

-- ── 1. Extend existing tables ─────────────────────────────────────────────
ALTER TABLE gs_techniker ADD COLUMN IF NOT EXISTS typ TEXT DEFAULT 'techniker';
  -- typ ∈ techniker | marketing | assistenz | extern | admin. Public urgency view shows ONLY typ='techniker'.
ALTER TABLE gs_projekte
  ADD COLUMN IF NOT EXISTS kunde_id     UUID REFERENCES gs_kunden(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_datum  DATE,
  ADD COLUMN IF NOT EXISTS end_datum    DATE,
  ADD COLUMN IF NOT EXISTS land         TEXT DEFAULT 'CH',
  ADD COLUMN IF NOT EXISTS waehrung     TEXT DEFAULT 'CHF',
  ADD COLUMN IF NOT EXISTS notiz        TEXT;
ALTER TABLE gs_kunden
  ADD COLUMN IF NOT EXISTS ansprechpartner TEXT,
  ADD COLUMN IF NOT EXISTS typ          TEXT DEFAULT 'endkunde',  -- partner|endkunde|verwaltung|versicherung
  ADD COLUMN IF NOT EXISTS land         TEXT DEFAULT 'CH',
  ADD COLUMN IF NOT EXISTS notiz        TEXT;
ALTER TABLE gs_anfragen
  ADD COLUMN IF NOT EXISTS land         TEXT DEFAULT 'CH',
  ADD COLUMN IF NOT EXISTS waehrung     TEXT DEFAULT 'CHF';

-- ── 2. PM: Material + Reports link ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gs_material (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  projekt_id  UUID REFERENCES gs_projekte(id) ON DELETE CASCADE,
  bezeichnung TEXT NOT NULL,
  menge       DECIMAL(10,2) DEFAULT 1,
  einheit     TEXT,
  einzelpreis DECIMAL(10,2) DEFAULT 0,
  gesamt      DECIMAL(12,2) GENERATED ALWAYS AS (menge * einzelpreis) STORED,
  lieferant   TEXT,
  datum       DATE DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_material_projekt ON gs_material(projekt_id);

-- ── 3. CRM ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gs_crm_leads (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  kunde_id        UUID REFERENCES gs_kunden(id) ON DELETE SET NULL,
  projekt_id      UUID REFERENCES gs_projekte(id) ON DELETE SET NULL,
  stufe           TEXT DEFAULT 'lead' CHECK (stufe IN ('lead','kontaktiert','angebot','gewonnen','verloren')),
  wert            DECIMAL(12,2) DEFAULT 0,
  waehrung        TEXT DEFAULT 'CHF',
  bereich         TEXT,
  quelle          TEXT,   -- bob_scan|gs_anfrage|tiktok|instagram|google_ads|empfehlung|direkt|sonstige
  naechster_schritt TEXT,
  naechstes_datum DATE,
  email           TEXT,   -- for dedup
  telefon         TEXT,   -- for dedup
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leads_stufe ON gs_crm_leads(stufe);
CREATE INDEX IF NOT EXISTS idx_leads_dedup ON gs_crm_leads(email, telefon);

CREATE TABLE IF NOT EXISTS gs_crm_aktivitaeten (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id       UUID REFERENCES gs_crm_leads(id) ON DELETE CASCADE,
  kunde_id      UUID REFERENCES gs_kunden(id) ON DELETE CASCADE,
  typ           TEXT CHECK (typ IN ('anruf','email','notiz','meeting','whatsapp')),
  datum         TIMESTAMPTZ DEFAULT NOW(),
  beschreibung  TEXT,
  mitarbeiter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_akt_lead ON gs_crm_aktivitaeten(lead_id);
CREATE INDEX IF NOT EXISTS idx_akt_kunde ON gs_crm_aktivitaeten(kunde_id);

CREATE TABLE IF NOT EXISTS gs_crm_aufgaben (  -- Follow-ups (kunde/lead-gebunden)
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id       UUID REFERENCES gs_crm_leads(id) ON DELETE CASCADE,
  kunde_id      UUID REFERENCES gs_kunden(id) ON DELETE CASCADE,
  faelligkeit   DATE,
  beschreibung  TEXT,
  status        TEXT DEFAULT 'offen' CHECK (status IN ('offen','erledigt')),
  mitarbeiter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. Einkauf / Verkauf (Marge) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gs_einkauf (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  projekt_id  UUID REFERENCES gs_projekte(id) ON DELETE SET NULL,
  lieferant   TEXT,
  position    TEXT,
  menge       DECIMAL(10,2) DEFAULT 1,
  einzelpreis DECIMAL(10,2) DEFAULT 0,
  gesamt      DECIMAL(12,2) GENERATED ALWAYS AS (menge * einzelpreis) STORED,
  datum       DATE DEFAULT CURRENT_DATE,
  status      TEXT DEFAULT 'bestellt' CHECK (status IN ('bestellt','geliefert','bezahlt')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS gs_verkauf (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  kunde_id    UUID REFERENCES gs_kunden(id) ON DELETE SET NULL,
  projekt_id  UUID REFERENCES gs_projekte(id) ON DELETE SET NULL,
  positionen  JSONB DEFAULT '[]'::jsonb,
  summe       DECIMAL(12,2) DEFAULT 0,
  status      TEXT DEFAULT 'entwurf' CHECK (status IN ('entwurf','versendet','angenommen','bezahlt')),
  datum       DATE DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. Marketing ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gs_mkt_kampagnen (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name      TEXT NOT NULL,
  kanal     TEXT,  -- tiktok|instagram|google_ads|tutti|willhaben|sonstige
  status    TEXT DEFAULT 'aktiv',
  start_datum DATE, end_datum DATE,
  budget    DECIMAL(12,2) DEFAULT 0,
  ausgaben  DECIMAL(12,2) DEFAULT 0,
  waehrung  TEXT DEFAULT 'CHF',
  land      TEXT DEFAULT 'CH',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS gs_mkt_content (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  titel       TEXT NOT NULL,
  format      TEXT,  -- reel|post|story|video|bild
  kanal       TEXT,
  datum       DATE,
  status      TEXT DEFAULT 'idee' CHECK (status IN ('idee','in_arbeit','geplant','veroeffentlicht')),
  mitarbeiter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  skript      TEXT,
  link        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. To-Dos (ohne Kundenbezug, getrennt von CRM-Follow-ups) ─────────────
CREATE TABLE IF NOT EXISTS gs_todos (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  titel         TEXT NOT NULL,
  beschreibung  TEXT,
  status        TEXT DEFAULT 'offen' CHECK (status IN ('offen','in_arbeit','erledigt')),
  faelligkeit   DATE,
  prioritaet    TEXT DEFAULT 'mittel' CHECK (prioritaet IN ('niedrig','mittel','hoch')),
  mitarbeiter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kategorie     TEXT,  -- marketing|technik|admin|akquise
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. Master settings (auto-lead on/off etc.) ────────────────────────────
CREATE TABLE IF NOT EXISTS gs_master_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
INSERT INTO gs_master_settings (key, value) VALUES ('auto_lead','on') ON CONFLICT (key) DO NOTHING;

-- ═══ RLS: ONLY the Master/Admin UUID (or service_role) may access ═══════════
-- service_role bypasses RLS for the server API. The anon/authenticated client
-- (DevTools/console) is blocked unless auth.uid() = the master UUID.
DO $$
DECLARE t TEXT; tabs TEXT[] := ARRAY[
  'gs_material','gs_crm_leads','gs_crm_aktivitaeten','gs_crm_aufgaben',
  'gs_einkauf','gs_verkauf','gs_mkt_kampagnen','gs_mkt_content','gs_todos','gs_master_settings'];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS master_only ON %I', t);
    EXECUTE format($f$CREATE POLICY master_only ON %I FOR ALL
       USING (auth.uid() = 'ee46a716-7017-4045-9f67-fe06d05171e7'::uuid)
       WITH CHECK (auth.uid() = 'ee46a716-7017-4045-9f67-fe06d05171e7'::uuid)$f$, t);
  END LOOP;
END $$;

-- NOTE: gs_projekte / gs_kunden / gs_techniker also carry tester-facing data, so
-- they keep their existing role-based RLS. The PUBLIC technician view must filter
-- typ='techniker' in the API (api/techniker.js) — marketing/assistenz/extern/admin
-- never appear publicly.
