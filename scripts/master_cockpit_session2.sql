-- ═══════════════════════════════════════════════════════════════════════════
-- MASTER-COCKPIT · SESSION 2 — Marketing · To-Dos · Verkauf/Margen
-- ---------------------------------------------------------------------------
-- EINMALIG im Supabase SQL Editor ausführen (Projekt bmdmoehjwadvdlbrmpuq).
-- Setzt Session 1 voraus (gs_master_uid()). Falls Session 1 noch NICHT lief,
-- wird gs_master_uid() hier sicherheitshalber erneut angelegt (idempotent).
-- Idempotent: gefahrlos mehrfach ausführbar. RLS NUR für die Master/Admin-UUID.
-- Master/Admin-UUID: ee46a716-7017-4045-9f67-fe06d05171e7
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Master-UUID-Funktion (idempotent, auch ohne Session 1 vorhanden) ─────
CREATE OR REPLACE FUNCTION gs_master_uid() RETURNS uuid
  LANGUAGE sql IMMUTABLE AS
  $$ SELECT 'ee46a716-7017-4045-9f67-fe06d05171e7'::uuid $$;

-- ── 1. MARKETING ────────────────────────────────────────────────────────────
-- Kosten je Kanal (manuell pflegbar). Leads/Conversion werden aus gs_anfragen
-- (Spalte quelle) im Server berechnet — hier nur die manuell gepflegten Kosten.
CREATE TABLE IF NOT EXISTS gs_mkt_kanal (
  kanal      TEXT PRIMARY KEY,         -- meta|google|app|linkedin|netzwerk|direkt|sonstige
  kosten     DECIMAL(12,2) DEFAULT 0,  -- Marketing-Ausgaben gesamt für diesen Kanal
  waehrung   TEXT DEFAULT 'CHF',
  notiz      TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Einfacher Content-Plan.
CREATE TABLE IF NOT EXISTS gs_mkt_content (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  datum      DATE,
  kanal      TEXT,
  idee       TEXT NOT NULL,
  status     TEXT DEFAULT 'idee' CHECK (status IN ('idee','geplant','veroeffentlicht')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mkt_content_datum ON gs_mkt_content(datum);

-- ── 2. TO-DOS (interne Aufgaben OHNE Kundenbezug) ───────────────────────────
CREATE TABLE IF NOT EXISTS gs_todos (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  titel        TEXT NOT NULL,
  beschreibung TEXT,
  zustaendig   TEXT,                                  -- Emanuel|Dimitri|Patrick|Vasil|Yasemin
  faelligkeit  DATE,
  prioritaet   TEXT DEFAULT 'mittel' CHECK (prioritaet IN ('niedrig','mittel','hoch')),
  status       TEXT DEFAULT 'offen'  CHECK (status IN ('offen','erledigt')),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_todos_offen ON gs_todos(faelligkeit) WHERE status='offen';

-- ── 3. VERKAUF / MARGEN (pro Projekt/Anfrage) ───────────────────────────────
-- Einkauf (Material/Kosten) vs. Verkauf (Stundensatz × Stunden) → Marge.
-- Optionaler Link auf eine Anfrage (Lead/Projekt). Umsatz kann manuell
-- überschrieben werden (umsatz_manuell), sonst = stundensatz × stunden.
CREATE TABLE IF NOT EXISTS gs_margen (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  anfrage_id    UUID REFERENCES gs_anfragen(id) ON DELETE SET NULL,
  titel         TEXT NOT NULL,
  einkauf       DECIMAL(12,2) DEFAULT 0,
  stundensatz   DECIMAL(10,2) DEFAULT 0,
  stunden       DECIMAL(10,2) DEFAULT 0,
  umsatz_manuell DECIMAL(12,2),          -- NULL → Umsatz = stundensatz*stunden
  waehrung      TEXT DEFAULT 'CHF',
  notiz         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_margen_anfrage ON gs_margen(anfrage_id);

-- ── 4. RLS: NUR Master/Admin-UUID (service_role umgeht RLS für den Server) ──
DO $$
DECLARE t TEXT;
  tabs TEXT[] := ARRAY['gs_mkt_kanal','gs_mkt_content','gs_todos','gs_margen'];
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

-- ── 5. Kanäle vorbefüllen (idempotent) ──────────────────────────────────────
INSERT INTO gs_mkt_kanal (kanal) VALUES
  ('meta'),('google'),('app'),('linkedin'),('netzwerk'),('direkt')
  ON CONFLICT (kanal) DO NOTHING;
