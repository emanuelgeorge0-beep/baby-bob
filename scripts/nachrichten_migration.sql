-- ═══════════════════════════════════════════════════════════
-- gs_nachrichten – in-app messages / notifications (Task 7)
-- Run ONCE in Supabase SQL Editor. Idempotent.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS gs_nachrichten (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  von_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  an_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  projekt_id  UUID REFERENCES gs_projekte(id) ON DELETE SET NULL,
  typ         TEXT NOT NULL DEFAULT 'nachricht',  -- materialliste | rapport | nachricht | system
  inhalt      JSONB DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'ungelesen'   -- ungelesen | gelesen | bestaetigt
              CHECK (status IN ('ungelesen','gelesen','bestaetigt')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nachrichten_an     ON gs_nachrichten(an_id, status);
CREATE INDEX IF NOT EXISTS idx_nachrichten_projekt ON gs_nachrichten(projekt_id);

ALTER TABLE gs_nachrichten ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_nachrichten ON gs_nachrichten;
CREATE POLICY service_all_nachrichten ON gs_nachrichten FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS own_nachrichten ON gs_nachrichten;
CREATE POLICY own_nachrichten ON gs_nachrichten FOR SELECT
  USING (an_id = auth.uid() OR von_id = auth.uid()
         OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'gs_admin'));

DROP POLICY IF EXISTS recipient_update_nachrichten ON gs_nachrichten;
CREATE POLICY recipient_update_nachrichten ON gs_nachrichten FOR UPDATE
  USING (an_id = auth.uid());
