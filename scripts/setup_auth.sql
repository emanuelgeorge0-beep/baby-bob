-- ═══════════════════════════════════════════════════════════
-- Baby BOB / George Solutions – Auth Setup Migration v2
-- Safe to run multiple times (fully idempotent).
-- Run in Supabase SQL Editor: dashboard.supabase.com
-- ═══════════════════════════════════════════════════════════


-- ── 1. user_roles ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_roles (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'bob_user'
             CHECK (role IN ('bob_user','gs_partner','techniker','gs_admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_role"  ON user_roles;
DROP POLICY IF EXISTS "service_manage_roles" ON user_roles;

CREATE POLICY "users_read_own_role" ON user_roles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_manage_roles" ON user_roles
  FOR ALL USING (auth.role() = 'service_role');


-- ── 2. gs_techniker – add missing columns to existing table ──
-- (CREATE TABLE IF NOT EXISTS is skipped when table exists,
--  so we always ALTER to add columns that may be missing.)

CREATE TABLE IF NOT EXISTS gs_techniker (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name                TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE gs_techniker
  ADD COLUMN IF NOT EXISTS user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS photo_url           TEXT,
  ADD COLUMN IF NOT EXISTS qualification       TEXT,
  ADD COLUMN IF NOT EXISTS specialization      TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS years_experience    INT,
  ADD COLUMN IF NOT EXISTS rating              DECIMAL(2,1) DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS availability_status BOOLEAN DEFAULT TRUE;

ALTER TABLE gs_techniker ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_all_techniker"  ON gs_techniker;
DROP POLICY IF EXISTS "admin_read_techniker"   ON gs_techniker;
DROP POLICY IF EXISTS "partner_read_techniker" ON gs_techniker;
DROP POLICY IF EXISTS "techniker_own_record"   ON gs_techniker;

CREATE POLICY "service_all_techniker" ON gs_techniker
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "admin_read_techniker" ON gs_techniker
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'gs_admin')
  );

CREATE POLICY "partner_read_techniker" ON gs_techniker
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'gs_partner')
  );

CREATE POLICY "techniker_own_record" ON gs_techniker
  FOR SELECT USING (user_id = auth.uid());


-- ── 3. techniker_rapporte ────────────────────────────────
CREATE TABLE IF NOT EXISTS techniker_rapporte (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  techniker_id   UUID NOT NULL REFERENCES gs_techniker(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  projekt_id     UUID,
  datum          DATE NOT NULL,
  stunden        DECIMAL(4,1) NOT NULL DEFAULT 0 CHECK (stunden BETWEEN 0 AND 24),
  aktivitaeten   TEXT[] DEFAULT '{}',
  materialien    TEXT[] DEFAULT '{}',
  notiz          TEXT,
  woche          INT,
  jahr           INT,
  eingereicht_am TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(techniker_id, datum)
);

ALTER TABLE techniker_rapporte ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_all_rapporte"    ON techniker_rapporte;
DROP POLICY IF EXISTS "techniker_own_rapporte"  ON techniker_rapporte;
DROP POLICY IF EXISTS "admin_read_rapporte"     ON techniker_rapporte;

CREATE POLICY "service_all_rapporte" ON techniker_rapporte
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "techniker_own_rapporte" ON techniker_rapporte
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "admin_read_rapporte" ON techniker_rapporte
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'gs_admin')
  );


-- ── 4. RLS on gs_kunden ──────────────────────────────────
ALTER TABLE IF EXISTS gs_kunden ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_manage_kunden" ON gs_kunden;
DROP POLICY IF EXISTS "admin_read_kunden"     ON gs_kunden;

CREATE POLICY "service_manage_kunden" ON gs_kunden
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "admin_read_kunden" ON gs_kunden
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'gs_admin')
  );


-- ── 5. RLS on gs_anfragen ────────────────────────────────
ALTER TABLE IF EXISTS gs_anfragen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_manage_anfragen" ON gs_anfragen;
DROP POLICY IF EXISTS "admin_read_anfragen"     ON gs_anfragen;

CREATE POLICY "service_manage_anfragen" ON gs_anfragen
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "admin_read_anfragen" ON gs_anfragen
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'gs_admin')
  );


-- ── 6. Assign gs_admin role to yourself ──────────────────
-- Run AFTER your first login via Magic Link.
-- Find your user UUID in: Authentication → Users in Supabase Dashboard.
--
-- INSERT INTO user_roles (user_id, role)
-- VALUES ('PASTE-YOUR-UUID-HERE', 'gs_admin')
-- ON CONFLICT (user_id) DO UPDATE SET role = 'gs_admin', updated_at = NOW();


-- ═══════════════════════════════════════════════════════════
-- Also set in Supabase Dashboard → Authentication → URL Config:
--   Site URL:      https://baby-bob.vercel.app
--   Redirect URLs: https://baby-bob.vercel.app
-- ═══════════════════════════════════════════════════════════
