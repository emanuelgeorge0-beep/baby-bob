-- ═══════════════════════════════════════════════════════════════════════════
-- MASTER-COCKPIT · SESSION 1 — Grundstruktur + Block 1 (Leads) + Block 2 (CRM)
-- ---------------------------------------------------------------------------
-- EINMALIG im Supabase SQL Editor ausführen (Projekt bmdmoehjwadvdlbrmpuq).
-- Idempotent: gefahrlos mehrfach ausführbar (IF NOT EXISTS / WHERE NOT EXISTS).
-- Reihenfolge: Basis (Rolle, Spalten) → abhängige Tabellen (FKs) → RLS zuletzt.
--
-- SICHERHEIT: Die neuen CRM-Tabellen sind per RLS NUR für die Master/Admin-UUID
-- lesbar/schreibbar. Der Server (api/cockpit.js) nutzt den service_role-Key und
-- umgeht RLS — gated aber zusätzlich im Code auf exakt diese UUID. Der anon-Key
-- im Browser/DevTools wird durch RLS hart geblockt.
--
-- Master/Admin-UUID: ee46a716-7017-4045-9f67-fe06d05171e7
-- An EINER Stelle definiert (Funktion unten) → kein Copy-Paste-Drift.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Master-UUID zentral als IMMUTABLE-Funktion (in RLS-Policies genutzt) ──
CREATE OR REPLACE FUNCTION gs_master_uid() RETURNS uuid
  LANGUAGE sql IMMUTABLE AS
  $$ SELECT 'ee46a716-7017-4045-9f67-fe06d05171e7'::uuid $$;

-- ── 1. Rolle 'master' erlauben + dem Admin zuweisen ─────────────────────────
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('bob_user','gs_partner','techniker','gs_admin','master'));

-- Idempotenter Upsert ohne Abhängigkeit von einem Constraint-Namen:
UPDATE user_roles SET role='master', updated_at=NOW()
  WHERE user_id = gs_master_uid();
INSERT INTO user_roles (user_id, role)
  SELECT gs_master_uid(), 'master'
  WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = gs_master_uid());

-- ── 2. Bestehende Tabellen erweitern (Block 1 + Block 2) ────────────────────
-- gs_kunden: CRM-Stammdaten (Live-Schema nutzt 'erstellt_am', NICHT created_at).
ALTER TABLE gs_kunden
  ADD COLUMN IF NOT EXISTS ansprechpartner TEXT,
  ADD COLUMN IF NOT EXISTS typ   TEXT DEFAULT 'endkunde',  -- endkunde|partner|verwaltung|versicherung
  ADD COLUMN IF NOT EXISTS land  TEXT DEFAULT 'CH',
  ADD COLUMN IF NOT EXISTS notiz TEXT;

-- gs_anfragen = die zentrale Lead-Tabelle (Block 1). crm_stufe ist die normalisierte
-- Pipeline-Stufe; das bestehende Freitext-Feld 'status' (App/Mails) bleibt unberührt.
ALTER TABLE gs_anfragen
  ADD COLUMN IF NOT EXISTS crm_stufe       TEXT DEFAULT 'neu',
  ADD COLUMN IF NOT EXISTS zugewiesen_an   TEXT,   -- Name/Kürzel des/der Verantwortlichen
  ADD COLUMN IF NOT EXISTS followup_datum  DATE,
  ADD COLUMN IF NOT EXISTS land            TEXT DEFAULT 'CH',
  ADD COLUMN IF NOT EXISTS waehrung        TEXT DEFAULT 'CHF';

-- crm_stufe absichern (Re-run-safe: Constraint separat, nur wenn fehlend).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gs_anfragen_crm_stufe_check') THEN
    ALTER TABLE gs_anfragen ADD CONSTRAINT gs_anfragen_crm_stufe_check
      CHECK (crm_stufe IN ('neu','kontaktiert','angebot','gewonnen','verloren'));
  END IF;
END $$;

-- Einmaliger Backfill: bestehende Anfragen sinnvoll in die Pipeline einsortieren.
UPDATE gs_anfragen SET crm_stufe='kontaktiert'
  WHERE crm_stufe='neu' AND status ILIKE '%erstgespräch%';

CREATE INDEX IF NOT EXISTS idx_anfragen_crm_stufe ON gs_anfragen(crm_stufe);
CREATE INDEX IF NOT EXISTS idx_anfragen_followup  ON gs_anfragen(followup_datum);

-- ── 3. Abhängige CRM-Tabellen (FKs zuletzt) ─────────────────────────────────
-- Kontakt-Historie pro Lead/Kunde (Block 2).
CREATE TABLE IF NOT EXISTS gs_crm_aktivitaeten (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  anfrage_id   UUID REFERENCES gs_anfragen(id) ON DELETE CASCADE,
  kunde_id     UUID REFERENCES gs_kunden(id)   ON DELETE CASCADE,
  typ          TEXT CHECK (typ IN ('anruf','email','notiz','meeting','whatsapp')),
  beschreibung TEXT,
  datum        TIMESTAMPTZ DEFAULT NOW(),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_akt_anfrage ON gs_crm_aktivitaeten(anfrage_id);
CREATE INDEX IF NOT EXISTS idx_akt_kunde   ON gs_crm_aktivitaeten(kunde_id);

-- Follow-ups / Aufgaben (Block 1 + 2: heute/überfällig-Widget).
CREATE TABLE IF NOT EXISTS gs_crm_aufgaben (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  anfrage_id   UUID REFERENCES gs_anfragen(id) ON DELETE CASCADE,
  kunde_id     UUID REFERENCES gs_kunden(id)   ON DELETE CASCADE,
  faelligkeit  DATE,
  beschreibung TEXT,
  status       TEXT DEFAULT 'offen' CHECK (status IN ('offen','erledigt')),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auf_faellig ON gs_crm_aufgaben(faelligkeit) WHERE status='offen';
CREATE INDEX IF NOT EXISTS idx_auf_anfrage ON gs_crm_aufgaben(anfrage_id);

-- Master-Settings (z. B. Feature-Flags der kommenden Module).
CREATE TABLE IF NOT EXISTS gs_master_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. RLS: NUR die Master/Admin-UUID (service_role umgeht RLS für den Server) ─
DO $$
DECLARE t TEXT;
  tabs TEXT[] := ARRAY['gs_crm_aktivitaeten','gs_crm_aufgaben','gs_master_settings'];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS master_only ON %I', t);
    EXECUTE format(
      'CREATE POLICY master_only ON %I FOR ALL '
      || 'USING (auth.uid() = gs_master_uid()) '
      || 'WITH CHECK (auth.uid() = gs_master_uid())', t);
  END LOOP;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- HINWEIS zu gs_anfragen / gs_kunden:
--   Diese Tabellen tragen App-/GS-Daten und behalten ihre bestehende RLS.
--   Das Cockpit liest sie ausschliesslich serverseitig (service_role) über
--   api/cockpit.js, das HART auf die Master-UUID prüft (403 sonst). Es gibt
--   KEINEN Cockpit-Zugriff mit dem anon-Key. Die rein Master-spezifischen
--   Daten (Notizen, Follow-ups, Aktivitäten) liegen in den oben RLS-gesperrten
--   Tabellen → kein Leak an Tester/Partner/Techniker.
-- ═══════════════════════════════════════════════════════════════════════════
