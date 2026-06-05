-- ═══════════════════════════════════════════════════════════
-- BOB Self-Learning – Schema (Task 7)
-- Run ONCE in Supabase SQL Editor (DDL can't run via the data API).
-- Idempotent.
-- ═══════════════════════════════════════════════════════════

-- Feedback on each BOB diagnosis.
CREATE TABLE IF NOT EXISTS bob_scans (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bild_hash       TEXT,
  bob_antwort     TEXT,
  kategorie       TEXT,
  user_feedback   TEXT CHECK (user_feedback IN ('correct','wrong','corrected')),
  user_korrektur  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Things BOB didn't know — user teaches it.
CREATE TABLE IF NOT EXISTS bob_unbekannt (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bild_hash          TEXT,
  bob_antwort        TEXT,
  user_korrektur     TEXT,
  kategorie_vorschlag TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bob_scans     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bob_unbekannt ENABLE ROW LEVEL SECURITY;

-- Public can INSERT feedback (anonymous B2C); only service/admin can read.
DROP POLICY IF EXISTS anon_insert_scans ON bob_scans;
CREATE POLICY anon_insert_scans ON bob_scans FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS admin_read_scans ON bob_scans;
CREATE POLICY admin_read_scans ON bob_scans FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'gs_admin'));

DROP POLICY IF EXISTS anon_insert_unbekannt ON bob_unbekannt;
CREATE POLICY anon_insert_unbekannt ON bob_unbekannt FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS admin_read_unbekannt ON bob_unbekannt;
CREATE POLICY admin_read_unbekannt ON bob_unbekannt FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'gs_admin'));

-- NOTE: api/bob-feedback.js writes here with the service key, so it works
-- regardless of the anon policies above.
