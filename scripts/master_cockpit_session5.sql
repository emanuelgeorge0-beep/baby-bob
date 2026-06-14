-- ═══════════════════════════════════════════════════════════════════════════
-- MASTER-COCKPIT · SESSION 5
-- ---------------------------------------------------------------------------
-- TEIL A (Jarvis-Sprach-Assistent) braucht KEINE neue Tabelle — er ist reiner
-- LESEZUGRIFF auf bereits vorhandene Daten (gs_anfragen / gs_kunden /
-- gs_projekte / gs_techniker / gs_margen / gs_todos / gs_crm_aufgaben) und
-- funktioniert auch ohne diese Datei. NICHTS hier ist für Teil A nötig.
--
-- TEIL B (Agenten-Steuerung) ist in Session 5 NUR DOKUMENTIERT, NICHT GEBAUT.
-- Diese Datei legt das Schema dafür schon einmal idempotent bereit, damit es
-- vorhanden ist, sobald Teil B umgesetzt wird. Bis dahin liegen die Tabellen
-- nur leer da und stören nichts. EINMALIG (optional/vorbereitend) im Supabase
-- SQL Editor ausführen (Projekt bmdmoehjwadvdlbrmpuq).
--
-- Idempotent: gefahrlos mehrfach ausführbar. RLS NUR für die Master/Admin-UUID.
-- Master/Admin-UUID: ee46a716-7017-4045-9f67-fe06d05171e7
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Master-UUID-Funktion (idempotent, auch eigenständig lauffähig) ───────
CREATE OR REPLACE FUNCTION gs_master_uid() RETURNS uuid
  LANGUAGE sql IMMUTABLE AS
  $$ SELECT 'ee46a716-7017-4045-9f67-fe06d05171e7'::uuid $$;

-- ── 1. AGENT_TASKS — vorbereitete Aufträge + fertige Prompts ────────────────
-- Das Cockpit/Jarvis legt hier Aufträge mit fertigem Prompt ab. Claude Code im
-- Terminal liest offene Tasks ("hol die Aufträge ab"), arbeitet sie ab und
-- schreibt ergebnis + status zurück. WICHTIG: Das Cockpit kann NICHT selbst ein
-- Terminal/Claude Code starten — die Ausführung wird im Terminal ausgelöst.
CREATE TABLE IF NOT EXISTS agent_tasks (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  titel              TEXT NOT NULL,
  beschreibung       TEXT,
  status             TEXT DEFAULT 'offen' CHECK (status IN ('offen','in_arbeit','erledigt')),
  zugewiesener_agent TEXT,                    -- z.B. 'claude-code', 'recherche', ...
  vorbereiteter_prompt TEXT,                  -- fertiger Prompt für den Agenten
  ergebnis           TEXT,                    -- vom Agenten zurückgeschrieben
  erstellt_am        TIMESTAMPTZ DEFAULT NOW(),
  aktualisiert_am    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status, erstellt_am);

-- ── 2. AGENT_WISSEN — allgemeiner Wissensspeicher (Kontext für Agenten) ─────
CREATE TABLE IF NOT EXISTS agent_wissen (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thema       TEXT NOT NULL,
  inhalt      TEXT NOT NULL,
  tags        TEXT,                            -- kommagetrennt, optional
  erstellt_am TIMESTAMPTZ DEFAULT NOW(),
  aktualisiert_am TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_wissen_thema ON agent_wissen(thema);

-- ── 3. RLS: NUR Master/Admin-UUID (service_role umgeht RLS für den Server) ──
DO $$
DECLARE t TEXT;
  tabs TEXT[] := ARRAY['agent_tasks','agent_wissen'];
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
