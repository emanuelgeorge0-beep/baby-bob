-- ═══════════════════════════════════════════════════════════
-- Baby BOB / George Solutions – Auth Setup Migration
-- Run in Supabase SQL Editor (dashboard.supabase.com)
-- ═══════════════════════════════════════════════════════════

-- 1. user_roles – maps Supabase Auth users to app roles
CREATE TABLE IF NOT EXISTS user_roles (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'bob_user'
              CHECK (role IN ('bob_user','gs_partner','techniker','gs_admin')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own role
CREATE POLICY "users_read_own_role" ON user_roles
  FOR SELECT USING (auth.uid() = user_id);

-- Only service role can write
CREATE POLICY "service_manage_roles" ON user_roles
  FOR ALL USING (auth.role() = 'service_role');


-- 2. gs_techniker – update existing table or create
CREATE TABLE IF NOT EXISTS gs_techniker (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  photo_url           TEXT,
  qualification       TEXT CHECK (qualification IN ('Meister','Gesellenbrief AF','Monteur','Bauleiter')),
  specialization      TEXT[] DEFAULT '{}',
  years_experience    INT,
  rating              DECIMAL(2,1) DEFAULT 5.0 CHECK (rating BETWEEN 0 AND 5),
  availability_status BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Add new columns if table already exists
DO $$ BEGIN
  ALTER TABLE gs_techniker ADD COLUMN IF NOT EXISTS photo_url TEXT;
  ALTER TABLE gs_techniker ADD COLUMN IF NOT EXISTS qualification TEXT;
  ALTER TABLE gs_techniker ADD COLUMN IF NOT EXISTS specialization TEXT[] DEFAULT '{}';
  ALTER TABLE gs_techniker ADD COLUMN IF NOT EXISTS years_experience INT;
  ALTER TABLE gs_techniker ADD COLUMN IF NOT EXISTS rating DECIMAL(2,1) DEFAULT 5.0;
  ALTER TABLE gs_techniker ADD COLUMN IF NOT EXISTS availability_status BOOLEAN DEFAULT TRUE;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

ALTER TABLE gs_techniker ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY "service_all_techniker" ON gs_techniker
  FOR ALL USING (auth.role() = 'service_role');

-- gs_admin sees everything
CREATE POLICY "admin_read_techniker" ON gs_techniker
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'gs_admin')
  );

-- gs_partner sees non-private fields (limited view via API)
CREATE POLICY "partner_read_techniker" ON gs_techniker
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'gs_partner')
  );

-- Techniker reads own record only
CREATE POLICY "techniker_own_record" ON gs_techniker
  FOR SELECT USING (user_id = auth.uid());


-- 3. techniker_rapporte – weekly time/activity reports
CREATE TABLE IF NOT EXISTS techniker_rapporte (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  techniker_id  UUID NOT NULL REFERENCES gs_techniker(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  projekt_id    UUID,                          -- optional link to gs_anfragen
  datum         DATE NOT NULL,
  stunden       DECIMAL(4,1) NOT NULL DEFAULT 0 CHECK (stunden BETWEEN 0 AND 24),
  aktivitaeten  TEXT[] DEFAULT '{}',           -- activity tags
  materialien   TEXT[] DEFAULT '{}',           -- material checkboxes
  notiz         TEXT,
  woche         INT,
  jahr          INT,
  eingereicht_am TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(techniker_id, datum)
);

ALTER TABLE techniker_rapporte ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY "service_all_rapporte" ON techniker_rapporte
  FOR ALL USING (auth.role() = 'service_role');

-- Techniker reads/writes own rapporte
CREATE POLICY "techniker_own_rapporte" ON techniker_rapporte
  FOR ALL USING (user_id = auth.uid());

-- gs_admin reads all rapporte
CREATE POLICY "admin_read_rapporte" ON techniker_rapporte
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'gs_admin')
  );


-- 4. RLS on existing tables (gs_kunden, gs_anfragen)
-- Only enable if not already enabled

ALTER TABLE IF EXISTS gs_kunden ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_manage_kunden" ON gs_kunden;
CREATE POLICY "service_manage_kunden" ON gs_kunden
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admin_read_kunden" ON gs_kunden;
CREATE POLICY "admin_read_kunden" ON gs_kunden
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'gs_admin')
  );


ALTER TABLE IF EXISTS gs_anfragen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_manage_anfragen" ON gs_anfragen;
CREATE POLICY "service_manage_anfragen" ON gs_anfragen
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admin_read_anfragen" ON gs_anfragen;
CREATE POLICY "admin_read_anfragen" ON gs_anfragen
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'gs_admin')
  );


-- 5. Quick-setup: insert your own gs_admin role
-- Replace 'YOUR-USER-ID' with your Supabase Auth user UUID after first login
-- INSERT INTO user_roles (user_id, role) VALUES ('YOUR-USER-ID', 'gs_admin')
-- ON CONFLICT (user_id) DO UPDATE SET role = 'gs_admin';


-- ═══════════════════════════════════════════════════════════
-- Supabase Dashboard: Authentication → URL Configuration
--   Site URL:         https://baby-bob.vercel.app
--   Redirect URLs:    https://baby-bob.vercel.app
-- ═══════════════════════════════════════════════════════════
