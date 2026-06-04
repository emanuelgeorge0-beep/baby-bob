-- ═══════════════════════════════════════════════════════════
-- Techniker Profile + Linkage Migration
-- Aligns the LIVE gs_techniker table (legacy German schema) with the
-- profile fields needed by the GS Techniker-Auswahl screen, and adds the
-- auth linkage / rapport table that api/auth.js + api/rapport.js expect.
--
-- Safe to run multiple times (idempotent).
-- Run in Supabase SQL Editor: dashboard.supabase.com → SQL Editor.
--
-- WHY THIS IS A MANUAL STEP: DDL (ALTER/CREATE) cannot be executed through
-- the PostgREST data API with the service key. Until this runs, the app
-- works via a JSON sidecar stored in gs_techniker.notizen (see
-- api/techniker.js). After this runs, the real columns automatically take
-- precedence — no app code change required.
-- ═══════════════════════════════════════════════════════════


-- ── 1. Profile + linkage columns on the existing gs_techniker ──
ALTER TABLE gs_techniker
  ADD COLUMN IF NOT EXISTS user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS photo_url        TEXT,
  ADD COLUMN IF NOT EXISTS specialization   TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS rating           DECIMAL(2,1) DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS years_experience INT;

-- Backfill the structured columns from the notizen JSON sidecar (one-time).
UPDATE gs_techniker
SET
  specialization = COALESCE(
    NULLIF(specialization, '{}'),
    (SELECT array_agg(value::text)
       FROM jsonb_array_elements_text((notizen::jsonb)->'specialization'))
  ),
  rating = COALESCE(rating, ((notizen::jsonb)->>'rating')::decimal),
  years_experience = COALESCE(years_experience, ((notizen::jsonb)->>'years_experience')::int)
WHERE notizen IS NOT NULL AND notizen ~ '^\s*\{';

-- Link the test techniker auth account to its gs_techniker row by email.
UPDATE gs_techniker t
SET user_id = u.id
FROM auth.users u
WHERE t.user_id IS NULL AND lower(t.email) = lower(u.email);


-- ── 2. techniker_rapporte (api/rapport.js writes here) ──
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

DROP POLICY IF EXISTS "service_all_rapporte"   ON techniker_rapporte;
DROP POLICY IF EXISTS "techniker_own_rapporte" ON techniker_rapporte;
DROP POLICY IF EXISTS "admin_read_rapporte"    ON techniker_rapporte;

CREATE POLICY "service_all_rapporte" ON techniker_rapporte
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "techniker_own_rapporte" ON techniker_rapporte
  FOR ALL USING (user_id = auth.uid());
CREATE POLICY "admin_read_rapporte" ON techniker_rapporte
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'gs_admin')
  );


-- ── 3. RLS so the public showcase can read available technicians ──
-- (api/techniker.js uses the service key, but allow anon read of available
--  technicians directly in case the client ever queries with the anon key.)
ALTER TABLE gs_techniker ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_available_techniker" ON gs_techniker;
CREATE POLICY "public_read_available_techniker" ON gs_techniker
  FOR SELECT USING (verfuegbar = TRUE);
