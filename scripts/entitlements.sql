-- ═══════════════════════════════════════════════════════════════════════════
-- PARTNER-ACCESS · ENTITLEMENTS — admin-gesteuerte Feature-Freischaltung
-- Modell: Tenant = Partner-Account (gs_partner-User). Passt 1:1 zur bestehenden
-- Datentrennung (gs_projekte.partner_user_id = auth.uid) und zur User-Anlage in
-- api/admin.js. KEIN companies-/company_id-Umbau der Fach-Tabellen.
--
-- Sicher & idempotent: mehrfach ausführbar. Der Server (service_role) umgeht RLS
-- ohnehin und erzwingt Rolle + Entitlement in api/*.js; die RLS-Policies unten
-- sind Defense-in-Depth für direkten anon-Key-Zugriff.
-- Master/Admin UUID: ee46a716-7017-4045-9f67-fe06d05171e7
--
-- AUSFÜHREN: Supabase → SQL Editor → dieses Skript einfügen → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Feature-Katalog ─────────────────────────────────────────────────────
-- Ein Baustein = eine buchbare Funktion. label ist die deutsche Anzeige.
CREATE TABLE IF NOT EXISTS gs_features (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed aller Feature-Keys (idempotent; label wird bei erneutem Lauf aktualisiert).
INSERT INTO gs_features (key, label) VALUES
  ('projektmanagement', 'Projektmanagement'),
  ('material',          'Materialverwaltung'),
  ('reports',           'Berichte & Rapporte'),
  ('rapport',           'Rapport-Erfassung'),
  ('material_order',    'Materialbestellung'),
  ('bob_scan',          'Bob Scan'),
  ('kalkulation',       'Kalkulation'),
  ('blockaden',         'Blockaden-Management'),
  ('voice_memo',        'Sprachnotiz')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label;

-- ── 2. Freischaltungen pro Partner-Account ─────────────────────────────────
-- Eine Zeile = "dieser Partner darf dieses Feature". Fehlt eine Zeile, gilt das
-- Feature als NICHT freigeschaltet (Opt-in: der Admin schaltet einzeln frei).
CREATE TABLE IF NOT EXISTS gs_partner_entitlements (
  partner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key     TEXT NOT NULL REFERENCES gs_features(key) ON DELETE CASCADE,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (partner_user_id, feature_key)
);

CREATE INDEX IF NOT EXISTS gs_partner_entitlements_user_idx
  ON gs_partner_entitlements (partner_user_id);

-- ── 3. RLS (Defense-in-Depth) ──────────────────────────────────────────────
-- Server nutzt service_role → umgeht RLS. Diese Policies schützen nur den Fall
-- eines direkten Zugriffs mit anon-/User-Key aus dem Browser.
ALTER TABLE gs_features             ENABLE ROW LEVEL SECURITY;
ALTER TABLE gs_partner_entitlements ENABLE ROW LEVEL SECURITY;

-- Feature-Katalog ist für alle Eingeloggten lesbar (nur Anzeige-Labels).
DROP POLICY IF EXISTS gs_features_read ON gs_features;
CREATE POLICY gs_features_read ON gs_features
  FOR SELECT USING (auth.role() = 'authenticated');

-- Partner darf ausschliesslich SEINE eigenen Freischaltungen lesen.
DROP POLICY IF EXISTS gs_ent_partner_read ON gs_partner_entitlements;
CREATE POLICY gs_ent_partner_read ON gs_partner_entitlements
  FOR SELECT USING (partner_user_id = auth.uid());

-- Nur der Admin (gs_admin) darf Freischaltungen schreiben/ändern/löschen.
DROP POLICY IF EXISTS gs_ent_admin_all ON gs_partner_entitlements;
CREATE POLICY gs_ent_admin_all ON gs_partner_entitlements
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = 'gs_admin')
  );

-- ── 4. Optionale Datentrennung der Fach-Tabellen (Defense-in-Depth) ─────────
-- Die App trennt Partner-Daten bereits serverseitig über partner_user_id
-- (api/projekte.js). Diese Policies spiegeln das auf DB-Ebene für den Fall eines
-- direkten anon-Key-Zugriffs. gs_projekte hat die Spalte partner_user_id bereits.
-- Auskommentiert lassen, falls die Tabellen ohne RLS bleiben sollen.
--
-- ALTER TABLE gs_projekte ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS gs_projekte_partner ON gs_projekte;
-- CREATE POLICY gs_projekte_partner ON gs_projekte
--   FOR SELECT USING (
--     partner_user_id = auth.uid()
--     OR EXISTS (SELECT 1 FROM user_roles ur
--                WHERE ur.user_id = auth.uid() AND ur.role = 'gs_admin')
--   );
