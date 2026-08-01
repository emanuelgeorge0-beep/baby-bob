-- ═══════════════════════════════════════════════════════════════════════════
-- WOCHENRAPPORT — Feinschliff Runde A (ZIEL 1–3, Papierformular-Parität)
-- ═══════════════════════════════════════════════════════════════════════════
-- Rein additiv — keine bestehende Spalte wird umbenannt, entfernt oder umgebaut.
-- Run ONCE im Supabase SQL-Editor (DDL geht nicht über die PostgREST-Data-API).
-- Idempotent (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS überall).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Tageszeile: Pause + Manuell-Markierung + freie Projektnummer (ZIEL 1) ──
-- pause_minuten: Vorbelegung 1.25h (=75min) macht das UI, NICHT die DB (kein
-- Server-Default hier — sonst genau das Datenrisiko aus dem Livetest erneut).
-- stunden_manuell: true sobald der Techniker das berechnete Std-Feld überschreibt
-- (Anzeige-Flag "weicht von Start/Ende ab").
-- projektnummer_erfasst: freies Feld für Fälle ohne (passendes) System-Projekt —
-- ergänzt, ersetzt NICHT die bestehende Anzeige über gs_projekte.projektnummer.
ALTER TABLE gs_tagesrapporte
  ADD COLUMN IF NOT EXISTS pause_minuten        NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS stunden_manuell      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS projektnummer_erfasst TEXT;

-- ── 2. Wochenkopf: Unterschriften (ZIEL 2) ──
-- Bilder liegen im Storage-Bucket (Pfad-Präfix unterschriften/<wochenrapport_id>/...,
-- gleicher Bucket wie Projekt-/Rapport-Fotos), hier nur Pfad + Zeitstempel + Name.
-- unterschrift_kunde_status: 'signiert' (Bild vorhanden) oder 'folgt' (noch offen,
-- Grund in unterschrift_kunde_grund, später nachziehbar — daher kein NOT NULL).
ALTER TABLE gs_wochenrapporte
  ADD COLUMN IF NOT EXISTS unterschrift_technik_path TEXT,
  ADD COLUMN IF NOT EXISTS unterschrift_technik_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unterschrift_technik_name TEXT,
  ADD COLUMN IF NOT EXISTS unterschrift_kunde_path     TEXT,
  ADD COLUMN IF NOT EXISTS unterschrift_kunde_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unterschrift_kunde_name     TEXT,
  ADD COLUMN IF NOT EXISTS unterschrift_kunde_funktion TEXT,
  ADD COLUMN IF NOT EXISTS unterschrift_kunde_status   TEXT,
  ADD COLUMN IF NOT EXISTS unterschrift_kunde_grund    TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gs_wochenrapporte_uk_status_chk') THEN
    ALTER TABLE gs_wochenrapporte DROP CONSTRAINT gs_wochenrapporte_uk_status_chk;
  END IF;
  ALTER TABLE gs_wochenrapporte
    ADD CONSTRAINT gs_wochenrapporte_uk_status_chk
    CHECK (unterschrift_kunde_status IS NULL OR unterschrift_kunde_status IN ('signiert','folgt'));
END $$;

-- ── 3. Kunde: Pausen-Vorgabe je Kunde (ZIEL 1, Vorbereitung — UI folgt später) ──
-- Wenn gesetzt, hat sie Vorrang vor dem festen 1.25h-UI-Default. NULL = weiter 1.25h.
ALTER TABLE gs_kunden ADD COLUMN IF NOT EXISTS pause_standard NUMERIC(5,2);
-- Hinweis: gs_kunden hat aktuell KEINE RLS aktiviert (in keiner bisherigen Migration
-- eingeschaltet, Server läuft ohnehin mit service_role und umgeht RLS). Diese Datei
-- ändert daran nichts — Aktivieren wäre ein Verhaltenswechsel für bestehende Reads/
-- Writes auf gs_kunden und gehört nicht additiv hier rein. Bitte separat entscheiden,
-- falls gewünscht.

-- ── 4. Änderungsprotokoll für Master-Eingriffe (ZIEL 3) ──
-- Jede Löschung/Verschiebung eines Rapports durch den Master landet hier (wer, wann,
-- Wert vorher) statt hart zu überschreiben. wochenrapport_id/tagesrapport_id OHNE
-- CASCADE-Löschung, damit das Protokoll auch überlebt, falls der Kopf/die Zeile später
-- selbst gelöscht wird.
CREATE TABLE IF NOT EXISTS gs_wochenrapport_log (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wochenrapport_id  UUID REFERENCES gs_wochenrapporte(id) ON DELETE SET NULL,
  tagesrapport_id   UUID REFERENCES gs_tagesrapporte(id) ON DELETE SET NULL,
  aktion            TEXT NOT NULL CHECK (aktion IN ('geloescht','verschoben','geaendert')),
  feld              TEXT,                    -- z.B. 'techniker_user_id', 'projekt_id' (bei 'verschoben')
  wert_vorher       JSONB,                   -- Snapshot der betroffenen Werte vor dem Eingriff
  geaendert_von     UUID NOT NULL REFERENCES auth.users(id),
  geaendert_am      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gs_wochenrapport_log_wr ON gs_wochenrapport_log(wochenrapport_id);
CREATE INDEX IF NOT EXISTS idx_gs_wochenrapport_log_tr ON gs_wochenrapport_log(tagesrapport_id);

ALTER TABLE gs_wochenrapport_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON gs_wochenrapport_log;
CREATE POLICY service_all ON gs_wochenrapport_log FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS admin_all ON gs_wochenrapport_log;
CREATE POLICY admin_all ON gs_wochenrapport_log FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('gs_admin','master'))
);
-- Bewusst KEINE techniker_own-Policy — nur Master liest/schreibt das Protokoll.

-- ── 5. RLS-Check bestehender Tabellen für die neuen Spalten (ZIEL 1–2) ──
-- RLS in Postgres greift pro ZEILE, nicht pro Spalte. Beide betroffenen Tabellen
-- haben bereits vollständige FOR ALL Policies (service_all / admin_all / techniker_own):
--   gs_tagesrapporte     → scripts/rapport_system_migration.sql (Zeile ~92–101)
--   gs_wochenrapporte     → scripts/wochenrapport_migration.sql (Zeile ~73–81)
-- Die neuen Spalten (pause_minuten, stunden_manuell, projektnummer_erfasst,
-- unterschrift_*) sind damit automatisch abgedeckt — keine neuen Policies nötig.
-- Die serverseitige Sperre "Techniker darf nach 24h / nach Einreichung nicht mehr
-- schreiben" ist KEINE RLS-Regel (RLS kennt kein Zeitfenster ohne weitere Spalte)
-- und muss in api/cockpit.js (saveTechTag/delTechTag) geprüft werden — folgt in
-- Block 3, nicht Teil dieser SQL-Datei.

SELECT 'wochenrapport_feinschliff ready' AS status;
