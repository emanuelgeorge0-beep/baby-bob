-- ═══════════════════════════════════════════════════════════
-- Blockaden-Modul – Schema Migration (v1)
-- Blockaden als First-Class-Objekt, gekoppelt an das Step-Framework
-- (Projekt → Haus → Einheit → Zone → Step). Eine Blockade blockiert einen
-- konkreten Step → dieser erscheint 🔴 im Status-Dashboard.
--
-- Killer-Feature für Hausverwaltungen / Bauleiter-Büros:
--   • Multi-Firma-Sichtbarkeit (jede Firma sieht ihre Steps + relevante Blockaden,
--     Bauleiter-Büro sieht ALLE)
--   • automatische Benachrichtigung (E-Mail via Resend + In-App)
--   • Eskalations-Timer
--
-- EINMAL im Supabase SQL-Editor ausführen (DDL geht NICHT über die Data-API).
-- Idempotent: gefahrlos wiederholbar.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Blockaden ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gs_blockaden (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Kopplung ans Step-Framework (Hierarchie als freie Referenzen, damit das Modul
  -- unabhängig vom finalen Step-Schema lauffähig ist; projekt_id ist die harte Klammer).
  projekt_id          UUID REFERENCES gs_projekte(id) ON DELETE CASCADE,
  projekt_name        TEXT,                 -- denormalisiert (Anzeige/Report, robust falls Projekt entfällt)
  haus                TEXT,
  einheit             TEXT,
  zone                TEXT,
  step_ref            TEXT,                 -- der blockierte Step (Freitext-Referenz / Step-ID)

  beschreibung        TEXT NOT NULL,
  fotos               TEXT[] DEFAULT '{}',  -- Storage-Pfade oder Data-URLs (Foto-Belege)
  videos              TEXT[] DEFAULT '{}',  -- optional

  -- Wer hat gemeldet
  reporter_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reporter_name       TEXT,
  reporter_firma      TEXT,                 -- meldende Firma (Multi-Firma)

  -- Klassifikation (Vorschlag durch KI, vom Nutzer bestätigt/korrigiert)
  blockiert_von_rolle TEXT DEFAULT 'extern'    -- planung | material | extern | gebaeudetechnik
    CHECK (blockiert_von_rolle IN ('planung','material','extern','gebaeudetechnik')),
  urgency             TEXT DEFAULT 'MEDIUM'
    CHECK (urgency IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status              TEXT DEFAULT 'offen'
    CHECK (status IN ('offen','in_bearbeitung','freigegeben','eskaliert')),

  -- Zuständigkeit & Auflösung
  owner_id            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_email         TEXT,                 -- Ziel der Benachrichtigung (Owner / Bauleiter-Büro)
  owner_firma         TEXT,
  resolution          TEXT,                 -- wie wurde freigegeben / gelöst

  -- Eskalation
  eskaliert           BOOLEAN DEFAULT FALSE,
  eskaliert_am        TIMESTAMPTZ,
  eskalation_stunden  INT DEFAULT 24,       -- Timer-Schwelle in Stunden (0 = aus)

  -- Zeitstempel & Report-Buckets
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  freigegeben_am      TIMESTAMPTZ,
  woche               INT,                  -- ISO-KW (für Wochenreport)
  jahr                INT
);

-- Migrationssicher: fehlende Spalten nachziehen (falls eine ältere Tabelle existiert).
ALTER TABLE gs_blockaden
  ADD COLUMN IF NOT EXISTS projekt_name        TEXT,
  ADD COLUMN IF NOT EXISTS haus                TEXT,
  ADD COLUMN IF NOT EXISTS einheit             TEXT,
  ADD COLUMN IF NOT EXISTS zone                TEXT,
  ADD COLUMN IF NOT EXISTS step_ref            TEXT,
  ADD COLUMN IF NOT EXISTS fotos               TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS videos              TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reporter_id         UUID,
  ADD COLUMN IF NOT EXISTS reporter_name       TEXT,
  ADD COLUMN IF NOT EXISTS reporter_firma      TEXT,
  ADD COLUMN IF NOT EXISTS owner_id            UUID,
  ADD COLUMN IF NOT EXISTS owner_email         TEXT,
  ADD COLUMN IF NOT EXISTS owner_firma         TEXT,
  ADD COLUMN IF NOT EXISTS resolution          TEXT,
  ADD COLUMN IF NOT EXISTS eskaliert           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS eskaliert_am        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eskalation_stunden  INT DEFAULT 24,
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS freigegeben_am      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS woche               INT,
  ADD COLUMN IF NOT EXISTS jahr                INT;

CREATE INDEX IF NOT EXISTS idx_blockaden_projekt  ON gs_blockaden(projekt_id);
CREATE INDEX IF NOT EXISTS idx_blockaden_status   ON gs_blockaden(status);
CREATE INDEX IF NOT EXISTS idx_blockaden_urgency  ON gs_blockaden(urgency);
CREATE INDEX IF NOT EXISTS idx_blockaden_reporter ON gs_blockaden(reporter_id);
CREATE INDEX IF NOT EXISTS idx_blockaden_owner    ON gs_blockaden(owner_id);
CREATE INDEX IF NOT EXISTS idx_blockaden_kw       ON gs_blockaden(jahr, woche);
CREATE INDEX IF NOT EXISTS idx_blockaden_step     ON gs_blockaden(step_ref);

-- updated_at automatisch pflegen
CREATE OR REPLACE FUNCTION gs_blockaden_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_blockaden_touch ON gs_blockaden;
CREATE TRIGGER trg_blockaden_touch BEFORE UPDATE ON gs_blockaden
  FOR EACH ROW EXECUTE FUNCTION gs_blockaden_touch();

-- ── 2. Multi-Firma: welche Firmen/Rollen sind an einem Projekt beteiligt ──
-- Bauleiter-Büro sieht ALLE Blockaden; jede andere Firma nur ihre eigenen
-- (gemeldet ODER ihr als Owner zugewiesen). Keine Preise/Notizen anderer Firmen.
CREATE TABLE IF NOT EXISTS gs_projekt_beteiligte (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  projekt_id  UUID REFERENCES gs_projekte(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  firma       TEXT,
  rolle       TEXT DEFAULT 'firma'          -- bauleiter_buero | firma | gebaeudetechnik | isolierung | giessrahmen | planung
    CHECK (rolle IN ('bauleiter_buero','firma','gebaeudetechnik','isolierung','giessrahmen','planung','material','extern')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (projekt_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_beteiligte_projekt ON gs_projekt_beteiligte(projekt_id);
CREATE INDEX IF NOT EXISTS idx_beteiligte_user    ON gs_projekt_beteiligte(user_id);

-- ── 3. RLS ────────────────────────────────────────────────────
-- Hinweis: Die API greift mit dem Service-Key zu und erzwingt die Rollen-Filterung
-- in der Anwendungsschicht (wie gs_nachrichten). Die Policies sind Defense-in-Depth,
-- falls jemals mit einem User-JWT direkt auf die Data-API zugegriffen wird.
ALTER TABLE gs_blockaden          ENABLE ROW LEVEL SECURITY;
ALTER TABLE gs_projekt_beteiligte ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['gs_blockaden','gs_projekt_beteiligte'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_all ON %I', t);
    EXECUTE format('CREATE POLICY service_all ON %I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t);
    EXECUTE format('DROP POLICY IF EXISTS admin_all ON %I', t);
    EXECUTE format('CREATE POLICY admin_all ON %I FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = ''gs_admin''))', t);
  END LOOP;
END $$;

-- Reporter: eigene Blockaden lesen/anlegen/ändern.
DROP POLICY IF EXISTS reporter_own ON gs_blockaden;
CREATE POLICY reporter_own ON gs_blockaden FOR ALL
  USING (reporter_id = auth.uid())
  WITH CHECK (reporter_id = auth.uid());

-- Owner: mir zugewiesene Blockaden lesen/bearbeiten (freigeben).
DROP POLICY IF EXISTS owner_assigned ON gs_blockaden;
CREATE POLICY owner_assigned ON gs_blockaden FOR ALL
  USING (owner_id = auth.uid());

-- Partner (Projekt-Auftraggeber): alle Blockaden ihrer Projekte lesen.
DROP POLICY IF EXISTS partner_project_blockaden ON gs_blockaden;
CREATE POLICY partner_project_blockaden ON gs_blockaden FOR SELECT
  USING (EXISTS (SELECT 1 FROM gs_projekte p WHERE p.id = projekt_id AND p.partner_user_id = auth.uid()));

-- Bauleiter-Büro: ALLE Blockaden der Projekte, an denen es beteiligt ist.
DROP POLICY IF EXISTS bauleiter_all_project ON gs_blockaden;
CREATE POLICY bauleiter_all_project ON gs_blockaden FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM gs_projekt_beteiligte b
    WHERE b.projekt_id = gs_blockaden.projekt_id
      AND b.user_id = auth.uid()
      AND b.rolle = 'bauleiter_buero'
  ));

-- Beteiligte Firma (nicht Bauleiter-Büro): nur Blockaden, die sie selbst gemeldet hat
-- oder die ihr als Owner zugewiesen sind (bereits durch reporter_own/owner_assigned
-- abgedeckt) – zusätzlich die eigenen Beteiligungs-Einträge sichtbar machen.
DROP POLICY IF EXISTS beteiligte_own_rows ON gs_projekt_beteiligte;
CREATE POLICY beteiligte_own_rows ON gs_projekt_beteiligte FOR SELECT
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM gs_projekte p WHERE p.id = projekt_id AND p.partner_user_id = auth.uid()
  ));

-- ── 4. Storage-Bucket (manuell/API): blockaden-fotos (PRIVATE, signed URLs) ──
-- Fotos werden aktuell als komprimierte Data-URL im Array gehalten (kein Bucket nötig);
-- der Bucket ist optional für spätere Auslagerung grosser Medien.
