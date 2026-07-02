-- ═══════════════════════════════════════════════════════════════════════════
-- MASTER COCKPIT · SESSION 6 — Projektmanagement (Herzstück)
-- Neue Tabellen: Techniker-Zuweisung, Tätigkeiten, Material (pro Projekt).
-- Sicher & idempotent: mehrfach ausführbar. RLS = nur Master/Admin (service_role
-- des Servers umgeht RLS ohnehin; der anon-Key im Browser wird geblockt).
-- Master/Admin UUID: ee46a716-7017-4045-9f67-fe06d05171e7
--
-- AUSFÜHREN: Supabase → SQL Editor → dieses Skript einfügen → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Techniker ↔ Projekt (wer arbeitet wo, an was) ───────────────────────
CREATE TABLE IF NOT EXISTS gs_projekt_techniker (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  projekt_id   UUID REFERENCES gs_projekte(id) ON DELETE CASCADE,
  techniker_id UUID REFERENCES gs_techniker(id) ON DELETE CASCADE,
  taetigkeit   TEXT,                       -- z. B. "Servicearbeiten", "Montage"
  seit         TIMESTAMPTZ DEFAULT NOW(),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pt_projekt   ON gs_projekt_techniker(projekt_id);
CREATE INDEX IF NOT EXISTS idx_pt_techniker ON gs_projekt_techniker(techniker_id);

-- ── 2. Tätigkeiten / erfasste Arbeiten pro Projekt ─────────────────────────
CREATE TABLE IF NOT EXISTS gs_taetigkeiten (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  projekt_id     UUID REFERENCES gs_projekte(id) ON DELETE CASCADE,
  beschreibung   TEXT NOT NULL,
  techniker_name TEXT,
  datum          DATE DEFAULT CURRENT_DATE,
  stunden        DECIMAL(6,2),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_taet_projekt ON gs_taetigkeiten(projekt_id);

-- ── 3. Material pro Projekt ────────────────────────────────────────────────
-- CREATE mit fuller Schema; falls die Tabelle aus einer früheren Migration schon
-- existiert, ergänzen die ALTERs die vom Cockpit genutzten Spalten (kategorie/status).
CREATE TABLE IF NOT EXISTS gs_material (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  projekt_id  UUID REFERENCES gs_projekte(id) ON DELETE CASCADE,
  bezeichnung TEXT NOT NULL,
  menge       DECIMAL(10,2) DEFAULT 1,
  einheit     TEXT,
  kategorie   TEXT,
  status      TEXT DEFAULT 'offen',        -- offen | bestellt | geliefert | verbaut
  einzelpreis DECIMAL(10,2) DEFAULT 0,
  lieferant   TEXT,
  datum       DATE DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE gs_material ADD COLUMN IF NOT EXISTS kategorie TEXT;
ALTER TABLE gs_material ADD COLUMN IF NOT EXISTS status    TEXT DEFAULT 'offen';
CREATE INDEX IF NOT EXISTS idx_material_projekt ON gs_material(projekt_id);

-- ── 4. RLS: nur Master/Admin (service_role umgeht dies) ────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['gs_projekt_techniker','gs_taetigkeiten','gs_material'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS master_only ON %I', t);
    EXECUTE format($f$CREATE POLICY master_only ON %I FOR ALL
       USING (auth.uid() = 'ee46a716-7017-4045-9f67-fe06d05171e7'::uuid)
       WITH CHECK (auth.uid() = 'ee46a716-7017-4045-9f67-fe06d05171e7'::uuid)$f$, t);
  END LOOP;
END $$;

-- ── 5. Demo-Seed: Techniker Patrick bei Geiger AG (Servicearbeiten) ────────
-- Läuft nur, wenn Projekt „Geiger AG" existiert; legt Patrick bei Bedarf an.
DO $$
DECLARE v_proj UUID; v_tech UUID;
BEGIN
  SELECT id INTO v_proj FROM gs_projekte WHERE name ILIKE '%Geiger%' ORDER BY created_at LIMIT 1;
  IF v_proj IS NOT NULL THEN
    SELECT id INTO v_tech FROM gs_techniker WHERE name ILIKE '%Patrick%' LIMIT 1;
    IF v_tech IS NULL THEN
      INSERT INTO gs_techniker (name, qualifikation, verfuegbar)
      VALUES ('Patrick Meier', 'Sanitär-Servicetechniker', TRUE)
      RETURNING id INTO v_tech;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM gs_projekt_techniker WHERE projekt_id=v_proj AND techniker_id=v_tech) THEN
      INSERT INTO gs_projekt_techniker (projekt_id, techniker_id, taetigkeit)
      VALUES (v_proj, v_tech, 'Servicearbeiten');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM gs_material WHERE projekt_id=v_proj) THEN
      INSERT INTO gs_material (projekt_id, bezeichnung, menge, einheit, kategorie, status) VALUES
        (v_proj, 'Steigzonen-Absperrventil DN25', 4, 'Stk', 'Sanitär', 'offen'),
        (v_proj, 'Rohrisolierung 22mm', 30, 'm', 'Sanitär', 'bestellt');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM gs_taetigkeiten WHERE projekt_id=v_proj) THEN
      INSERT INTO gs_taetigkeiten (projekt_id, beschreibung, techniker_name, stunden) VALUES
        (v_proj, 'Bestandsaufnahme Steigzone Haus B, Zugang mit Fremdfirma geklärt', 'Patrick Meier', 2.5);
    END IF;
  END IF;
END $$;

-- Fertig. Danach im Cockpit: Mehr → Projektmanagement → Geiger AG öffnen.
