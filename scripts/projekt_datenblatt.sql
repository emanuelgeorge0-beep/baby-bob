-- ============================================================================
-- Projektdatenblatt — ausfüllbares SHK/HKLS-Datenblatt je Projekt
-- ----------------------------------------------------------------------------
-- Speichert das gesamte Datenblatt als JSONB direkt auf dem Projekt. Damit
-- gilt die bestehende Datentrennung (gs_projekte.partner_user_id) unverändert:
-- ein Partner sieht/ändert nur EIGENE Projekte, der Master sieht alles. Die
-- API lädt die Spalte automatisch (select=*) und schreibt sie via
-- action 'pm_datenblatt_save' (server-seitig whitelisted + längenbegrenzt).
--
-- Struktur (Beispiel):
-- {
--   "kunde":   {"firma":"","ansprechperson":"","telefon":"","email":"","objekt":""},
--   "anlagenart": ["sanitaer","heizung","fernwaerme","heizzentrale",
--                  "kaelte","lueftung","wohnblock"],
--   "details": { "fernwaerme": {"art":"Neubau","anschluss":"indirekt",
--                  "uebergabe":"ja","speicher":["Pufferspeicher"],
--                  "heizsystem":["Radiatoren"],"bewohnt":"ja","plan":"nein"} },
--   "umfang":  ["Zentrale","Verteilung","Warmwasser","Anschluss Bestand","Dämmung"],
--   "materialstellung": "wir",         -- 'wir' | 'auftraggeber' | 'teils'
--   "start":   "KW 32 / Aug 2026",
--   "notiz":   "...",
--   "updated_at": "2026-07-07T...Z",
--   "updated_by": "master"             -- 'master' | 'partner'
-- }
--
-- Idempotent: mehrfaches Ausführen ist unschädlich.
-- ============================================================================

ALTER TABLE gs_projekte
  ADD COLUMN IF NOT EXISTS datenblatt jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN gs_projekte.datenblatt IS
  'Ausfüllbares Projektdatenblatt (SHK/HKLS). Von Master und gescopetem Partner '
  'über action pm_datenblatt_save befüllt. Struktur siehe scripts/projekt_datenblatt.sql.';

-- Optionaler GIN-Index (nur nötig, falls später nach Datenblatt-Inhalten
-- gefiltert werden soll — für das Feature selbst nicht erforderlich):
-- CREATE INDEX IF NOT EXISTS idx_gs_projekte_datenblatt ON gs_projekte USING gin (datenblatt);
