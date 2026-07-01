-- ═══════════════════════════════════════════════════════════════════════════
-- GEWERKE-STEP-FRAMEWORK – Schema + RLS
-- Hierarchie: Projekt (gs_projekte) → Haus → Einheit → Zone/Step → Status
-- Run ONCE in Supabase SQL Editor. Idempotent (IF NOT EXISTS / DROP-CREATE POLICY).
-- Die API (api/gewerke.js) arbeitet mit dem Service-Key und setzt die
-- Zugriffsrechte im Code durch; RLS ist die zweite Verteidigungslinie.
-- Admin/Master UUID: ee46a716-7017-4045-9f67-fe06d05171e7
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN PERFORM 1; END $$;  -- noop

-- ── 1. HAUS (unter Projekt) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gs_gw_haus (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  projekt_id    UUID NOT NULL REFERENCES gs_projekte(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  reihenfolge   INT  DEFAULT 0,
  notiz         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gw_haus_projekt ON gs_gw_haus(projekt_id);

-- ── 2. EINHEIT / WOHNUNG (unter Haus) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS gs_gw_einheit (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  haus_id       UUID NOT NULL REFERENCES gs_gw_haus(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  reihenfolge   INT  DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gw_einheit_haus ON gs_gw_einheit(haus_id);

-- ── 3. STEP (unter Einheit; je Gewerk eine eigene Step-Spur) ───────────────
-- status: offen | in_arbeit | abgeschlossen | blockiert
-- pflicht_vorgaenger_nr: reihenfolge_nr des Vorgänger-Steps in derselben
--   (einheit, gewerk)-Spur; NULL = kein Vorgänger (Start erlaubt).
CREATE TABLE IF NOT EXISTS gs_gw_step (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  einheit_id           UUID NOT NULL REFERENCES gs_gw_einheit(id) ON DELETE CASCADE,
  gewerk               TEXT NOT NULL,           -- sanitaer | heizung | splitklima | industriekaelte
  reihenfolge_nr       INT  NOT NULL,
  titel                TEXT NOT NULL,
  zone                 TEXT,                    -- Phasen-/Zonen-Gruppierung (optional)
  foto_gate            BOOLEAN DEFAULT FALSE,
  pflicht_vorgaenger_nr INT,
  status               TEXT DEFAULT 'offen'
                         CHECK (status IN ('offen','in_arbeit','abgeschlossen','blockiert')),
  prozent_fertig       INT  DEFAULT 0 CHECK (prozent_fertig BETWEEN 0 AND 100),
  rapport_ref          UUID,                    -- optional → gs_tagesrapporte(id)
  material_ref         UUID,                    -- optional → gs_material(id)
  foto_url             TEXT,
  notiz                TEXT,
  unterschrift         TEXT,                    -- Name/Signatur bei Abnahme
  blockiert_grund      TEXT,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_by           UUID,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gw_step_einheit ON gs_gw_step(einheit_id);
CREATE INDEX IF NOT EXISTS idx_gw_step_spur    ON gs_gw_step(einheit_id, gewerk, reihenfolge_nr);

-- ── 4. RLS (zweite Verteidigungslinie; Service-Key umgeht sie) ─────────────
ALTER TABLE gs_gw_haus    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gs_gw_einheit ENABLE ROW LEVEL SECURITY;
ALTER TABLE gs_gw_step    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['gs_gw_haus','gs_gw_einheit','gs_gw_step'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_all ON %I', t);
    EXECUTE format('CREATE POLICY service_all ON %I FOR ALL USING (auth.role() = ''service_role'')', t);
    EXECUTE format('DROP POLICY IF EXISTS admin_all ON %I', t);
    EXECUTE format($p$CREATE POLICY admin_all ON %I FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('gs_admin','master')))$p$, t);
  END LOOP;
END $$;

-- Techniker: Lese-/Schreibzugriff auf Häuser/Einheiten/Steps ihrer Projekte
DROP POLICY IF EXISTS tech_haus ON gs_gw_haus;
CREATE POLICY tech_haus ON gs_gw_haus FOR ALL USING (
  EXISTS (SELECT 1 FROM gs_projekt_techniker pt WHERE pt.projekt_id = gs_gw_haus.projekt_id AND pt.techniker_user_id = auth.uid())
);
DROP POLICY IF EXISTS tech_einheit ON gs_gw_einheit;
CREATE POLICY tech_einheit ON gs_gw_einheit FOR ALL USING (
  EXISTS (SELECT 1 FROM gs_gw_haus h JOIN gs_projekt_techniker pt ON pt.projekt_id = h.projekt_id
          WHERE h.id = gs_gw_einheit.haus_id AND pt.techniker_user_id = auth.uid())
);
DROP POLICY IF EXISTS tech_step ON gs_gw_step;
CREATE POLICY tech_step ON gs_gw_step FOR ALL USING (
  EXISTS (SELECT 1 FROM gs_gw_einheit e JOIN gs_gw_haus h ON h.id = e.haus_id
          JOIN gs_projekt_techniker pt ON pt.projekt_id = h.projekt_id
          WHERE e.id = gs_gw_step.einheit_id AND pt.techniker_user_id = auth.uid())
);

-- Partner: Lesezugriff auf ihre Projekte
DROP POLICY IF EXISTS partner_haus ON gs_gw_haus;
CREATE POLICY partner_haus ON gs_gw_haus FOR SELECT USING (
  EXISTS (SELECT 1 FROM gs_projekte p WHERE p.id = gs_gw_haus.projekt_id AND p.partner_user_id = auth.uid())
);
DROP POLICY IF EXISTS partner_einheit ON gs_gw_einheit;
CREATE POLICY partner_einheit ON gs_gw_einheit FOR SELECT USING (
  EXISTS (SELECT 1 FROM gs_gw_haus h JOIN gs_projekte p ON p.id = h.projekt_id
          WHERE h.id = gs_gw_einheit.haus_id AND p.partner_user_id = auth.uid())
);
DROP POLICY IF EXISTS partner_step ON gs_gw_step;
CREATE POLICY partner_step ON gs_gw_step FOR SELECT USING (
  EXISTS (SELECT 1 FROM gs_gw_einheit e JOIN gs_gw_haus h ON h.id = e.haus_id
          JOIN gs_projekte p ON p.id = h.projekt_id
          WHERE e.id = gs_gw_step.einheit_id AND p.partner_user_id = auth.uid())
);

-- ── Fertig. Templates sind hart in api/gewerke.js hinterlegt (kein DB-Seed nötig). ──
