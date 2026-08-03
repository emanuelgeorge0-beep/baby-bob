-- ═══════════════════════════════════════════════════════════════════════════
-- TÄTIGKEITSKATALOG — antippbare Tätigkeiten statt Freitext (Runde B, ZIEL 1)
-- ═══════════════════════════════════════════════════════════════════════════
-- Rein additiv — keine bestehende Spalte wird umbenannt, entfernt oder umgebaut.
-- Der bestehende Freitext "Ausgeführte Arbeiten" (gs_tagesrapporte.arbeiten)
-- bleibt unverändert bestehen; der Katalog ergänzt ihn nur.
-- Run ONCE im Supabase SQL-Editor (DDL geht nicht über die PostgREST-Data-API).
-- Idempotent: CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING überall.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Katalog (Daten, nicht Code — Master pflegt ihn über eine eigene UI) ──
CREATE TABLE IF NOT EXISTS gs_taetigkeiten (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  gewerk             TEXT NOT NULL CHECK (gewerk IN ('sanitaer','heizung','klima','lueftung','divers')),
  kategorie          TEXT NOT NULL,                    -- z.B. "Fertigmontage", "Rohinstallation", "Zonen"
  bezeichnung        TEXT NOT NULL,                    -- "Brausetasse installiert"
  detail_felder      JSONB NOT NULL DEFAULT '[]'::jsonb, -- z.B. ["dn","ort"] — leer erlaubt
  sortierung         INT NOT NULL DEFAULT 0,
  aktiv              BOOLEAN NOT NULL DEFAULT true,
  verwendung_zaehler INT NOT NULL DEFAULT 0,
  erstellt_von       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (gewerk, kategorie, bezeichnung)               -- Basis für ON CONFLICT DO NOTHING beim Seeden
);
CREATE INDEX IF NOT EXISTS idx_gs_taetigkeiten_gewerk ON gs_taetigkeiten(gewerk) WHERE aktiv;

-- ── 2. Zuordnung Tageszeile ↔ Tätigkeit (mehrere pro Zeile, sortierbar) ──
-- bezeichnung_snapshot ist PFLICHT (NOT NULL): spätere Umbenennung/Deaktivierung
-- im Katalog darf bereits erfasste Rapporte NICHT rückwirkend verändern — die
-- Anzeige (Wochenblatt, PDF) liest immer bezeichnung_snapshot, nie den Katalog.
CREATE TABLE IF NOT EXISTS gs_tagesrapport_taetigkeiten (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tagesrapport_id      UUID NOT NULL REFERENCES gs_tagesrapporte(id) ON DELETE CASCADE,
  taetigkeit_id        UUID REFERENCES gs_taetigkeiten(id) ON DELETE SET NULL,
  bezeichnung_snapshot TEXT NOT NULL,
  details              JSONB NOT NULL DEFAULT '{}'::jsonb, -- {"dn":"56","anzahl":2,"ort":"1.OG"}
  sortierung           INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gs_tagesrapport_taetigkeiten_tr ON gs_tagesrapport_taetigkeiten(tagesrapport_id);

-- ── 3. RLS ──
-- gs_taetigkeiten: JEDE angemeldete Rolle darf lesen (Techniker tippt an,
-- Master pflegt), schreiben nur Master/gs_admin. service_role (Server) immer.
ALTER TABLE gs_taetigkeiten ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON gs_taetigkeiten;
CREATE POLICY service_all ON gs_taetigkeiten FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS read_all_angemeldet ON gs_taetigkeiten;
CREATE POLICY read_all_angemeldet ON gs_taetigkeiten FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS admin_write ON gs_taetigkeiten;
CREATE POLICY admin_write ON gs_taetigkeiten FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('gs_admin','master'))
);

-- gs_tagesrapport_taetigkeiten: folgt denselben drei Policies wie gs_tagesrapporte
-- (service_all / admin_all / techniker_own aus scripts/rapport_system_migration.sql),
-- nur dass "eigene Zeile" hier über einen Join auf gs_tagesrapporte geprüft wird,
-- weil diese Tabelle selbst keine techniker_user_id-Spalte hat.
ALTER TABLE gs_tagesrapport_taetigkeiten ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON gs_tagesrapport_taetigkeiten;
CREATE POLICY service_all ON gs_tagesrapport_taetigkeiten FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS admin_all ON gs_tagesrapport_taetigkeiten;
CREATE POLICY admin_all ON gs_tagesrapport_taetigkeiten FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('gs_admin','master'))
);
DROP POLICY IF EXISTS techniker_own ON gs_tagesrapport_taetigkeiten;
CREATE POLICY techniker_own ON gs_tagesrapport_taetigkeiten FOR ALL USING (
  EXISTS (
    SELECT 1 FROM gs_tagesrapporte t
    WHERE t.id = gs_tagesrapport_taetigkeiten.tagesrapport_id AND t.techniker_user_id = auth.uid()
  )
);

-- ── 4. Startkatalog (vorläufig, additiv, idempotent) ──
-- Bewusst vorläufig: der Master erweitert/benennt um/deaktiviert über die
-- Katalog-Pflege im Master-Cockpit. Kategorien sind Text, keine feste Liste.
INSERT INTO gs_taetigkeiten (gewerk, kategorie, bezeichnung, detail_felder, sortierung) VALUES
  -- Sanitär / Fertigmontage — Montagen: Anzahl + Ort
  ('sanitaer','Fertigmontage','Brausetasse installiert',      '["anzahl","ort"]', 10),
  ('sanitaer','Fertigmontage','Waschtisch montiert',          '["anzahl","ort"]', 20),
  ('sanitaer','Fertigmontage','WC montiert',                  '["anzahl","ort"]', 30),
  ('sanitaer','Fertigmontage','Armaturen montiert',           '["anzahl","ort"]', 40),
  ('sanitaer','Fertigmontage','Duschabtrennung montiert',     '["anzahl","ort"]', 50),
  -- Sanitär / Rohinstallation — Leitungen: DN + Ort
  ('sanitaer','Rohinstallation','Kaltwasserleitung installiert',   '["dn","ort"]', 10),
  ('sanitaer','Rohinstallation','Warmwasserleitung installiert',   '["dn","ort"]', 20),
  ('sanitaer','Rohinstallation','Zirkulationsleitung installiert', '["dn","ort"]', 30),
  ('sanitaer','Rohinstallation','Ablaufleitung installiert',       '["dn","ort"]', 40),
  ('sanitaer','Rohinstallation','Steigzone montiert',              '["dn","ort"]', 50),
  -- Sanitär / Zonen — nur Ort
  ('sanitaer','Zonen','Zone Kaltwasser',    '["ort"]', 10),
  ('sanitaer','Zonen','Zone Warmwasser',    '["ort"]', 20),
  ('sanitaer','Zonen','Zone Zirkulation',   '["ort"]', 30),
  -- Heizung — Leitungen (DN+Ort) und Montagen (Anzahl+Ort) gemischt, eine Kategorie
  ('heizung','Heizung','Vorlauf installiert',                  '["dn","ort"]', 10),
  ('heizung','Heizung','Rücklauf installiert',                 '["dn","ort"]', 20),
  ('heizung','Heizung','Heizkörper montiert',                  '["anzahl","ort"]', 30),
  ('heizung','Heizung','Handtuchheizkörper Bad montiert',      '["anzahl","ort"]', 40),
  ('heizung','Heizung','Wärmetauscher installiert',            '["anzahl","ort"]', 50),
  ('heizung','Heizung','Heizungsverteiler montiert',           '["anzahl","ort"]', 60),
  ('heizung','Heizung','Fussbodenheizung verlegt',             '["ort"]', 70),
  -- Übergreifend (gewerkunabhängig) — unter "divers" eingeordnet, da die Tabelle
  -- genau ein Gewerk je Zeile erlaubt und "Divers" bereits der bestehende
  -- Catch-all in GEWERK_OPTIONS (api/cockpit.js) ist.
  ('divers','Übergreifend','Konstruktion gebaut',        '["ort"]', 10),
  ('divers','Übergreifend','Druckprobe durchgeführt',    '[]', 20),
  ('divers','Übergreifend','gefüllt und entlüftet',      '[]', 30),
  ('divers','Übergreifend','Inbetriebnahme',             '[]', 40),
  ('divers','Übergreifend','Wartung durchgeführt',       '[]', 50),
  ('divers','Übergreifend','Störungsbehebung',           '[]', 60),
  ('divers','Übergreifend','Baustelle geräumt',          '[]', 70)
ON CONFLICT (gewerk, kategorie, bezeichnung) DO NOTHING;

SELECT 'taetigkeiten_katalog ready' AS status;
