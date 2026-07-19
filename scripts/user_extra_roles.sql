-- ═══════════════════════════════════════════════════════════════════════════
-- MEHRFACHROLLEN (additiv) — ein Account kann mehrere Rollen tragen.
-- user_roles bleibt die PRIMÄRROLLE (UNIQUE user_id, unverändert → kein Bruch für
-- die vielen getRole()-Leser). Zusätzliche Rollen stehen hier.
-- Effektive Rollen eines Users = user_roles.role  ∪  user_extra_roles.role.
--
-- Sicherheit: Das Umschalten der Ansicht im Cockpit ändert NIE die Rechte —
-- api/cockpit.js prüft jede Action serverseitig gegen die TATSÄCHLICH gehaltenen
-- Rollen (Primär+Extra). Der MASTER_UID-Lock und die Techniker-Kette
-- (auth.uid → gs_techniker.user_id → id → techniker_id) bleiben unangetastet.
-- Run ONCE im Supabase SQL-Editor. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_extra_roles (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('bob_user','gs_partner','techniker','gs_admin','master')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_user_extra_roles_user ON user_extra_roles(user_id);

ALTER TABLE user_extra_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON user_extra_roles;
CREATE POLICY service_all ON user_extra_roles FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS read_own ON user_extra_roles;
CREATE POLICY read_own ON user_extra_roles FOR SELECT USING (user_id = auth.uid());

-- ── Emanuel (Master) zusätzlich als Techniker freischalten ──
-- Führt die Extra-Rolle direkt ein UND legt/verknüpft sein gs_techniker-Profil
-- (falls noch nicht vorhanden). Danach kann er im Cockpit Master ⇄ Techniker
-- umschalten. Idempotent.
INSERT INTO user_extra_roles (user_id, role)
VALUES ('ee46a716-7017-4045-9f67-fe06d05171e7', 'techniker')
ON CONFLICT (user_id, role) DO NOTHING;

-- gs_techniker-Profil für Emanuel (nur, falls noch keins mit seiner user_id existiert).
INSERT INTO gs_techniker (name, email, user_id)
SELECT 'Emanuel George', 'emanuelgeorge0@gmail.com', 'ee46a716-7017-4045-9f67-fe06d05171e7'
WHERE NOT EXISTS (SELECT 1 FROM gs_techniker WHERE user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7');
