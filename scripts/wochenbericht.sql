-- ═══════════════════════════════════════════════════════════════════════════
-- WOCHENBERICHT (Projekt × KW) — Bauleiter-Dokument, getrennt vom Wochenrapport
-- ═══════════════════════════════════════════════════════════════════════════
-- Der Wochenrapport (Techniker × Woche, gs_wochenrapporte) bleibt vollständig
-- unangetastet. Dies hier ist ein ZWEITES, eigenes Dokument: alles was in einer
-- Kalenderwoche auf EIN Projekt gebucht wurde, chronologisch nach Tag, innerhalb
-- des Tages die Techniker als Zeilen.
--
-- Rein additiv. Kein DROP, kein RENAME, keine bestehende Spalte verändert.
-- gs_tagesrapporte.status (Altfeld) wird NICHT angefasst.
-- Run ONCE im Supabase SQL-Editor (DDL geht nicht über die PostgREST-Data-API).
-- Idempotent (IF NOT EXISTS / guarded DO-Blöcke überall).
--
-- ── NAMENSPRÜFUNG (Eiserne Regel 7) ───────────────────────────────────────
--   gs_wochenberichte  → 0 Treffer in *.sql / *.js / *.html / *.mjs des Repos,
--                        404 gegen die Live-DB (bmdmoehjwadvdlbrmpuq). Frei.
--   gs_projekte.kuerzel → existiert nicht (42703 gegen Live-DB). Frei.
-- Keine DROP-Anweisung in dieser Datei → Regel 8 nicht berührt.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Projektkürzel ───────────────────────────────────────────────────────
-- EINE Kürzel-Logik im System: der Rapport-Nummernkreis arbeitet bereits mit
-- R-{KUERZEL}-{JAHR}-{4-stellig} (scripts/rapportnummer.sql), Kunden/Partner
-- haben ein Kürzel (z.B. NIE = Nievergelt). Das Projekt bekommt dasselbe Prinzip.
--
-- Serverseitige Fallback-Kette für die Berichtsnummer:
--   gs_projekte.kuerzel  →  gs_projekte.projektnummer  →  'GSO'
-- Grund für den mittleren Schritt: 7 von 14 Live-Projekten haben heute weder
-- Kürzel noch gepflegte Projektnummer; ohne Kette wäre die Nummer nicht baubar.
ALTER TABLE gs_projekte ADD COLUMN IF NOT EXISTS kuerzel TEXT;

COMMENT ON COLUMN gs_projekte.kuerzel IS
  'Kurzzeichen des Projekts für Dokumentnummern (WB-{KUERZEL}-{JAHR}-{KW}). '
  'Analog gs_kunden.kuerzel. NULL erlaubt — Server fällt auf projektnummer, dann GSO zurück.';


-- ── 2. Berichtskopf ────────────────────────────────────────────────────────
-- BEWUSST OHNE SEQUENZZÄHLER. WB-{KUERZEL}-{JAHR}-{KW} ist durch
-- (Projekt, Jahr, KW) vollständig determiniert — eine laufende Nummer käme im
-- Format gar nicht vor. Race-Sicherheit liefert der UNIQUE-Index unter Punkt 3:
-- zwei gleichzeitige Erzeugungen → eine gewinnt, die andere bekommt 23505 und
-- liest den bestehenden Kopf. Gleiche Garantie wie ein Zähler, eine Tabelle
-- weniger. gs_rapport_nummernkreis bleibt unangetastet und wird NICHT geteilt
-- (dessen Keyspace ist (Kundenkürzel, Jahr) — ein Projektkürzel darin würde den
-- Kundenzähler beschädigen, sobald sich zwei Kürzel gleichen).
--
-- quelle / service_auftrag_id werden JETZT angelegt, obwohl die Serviceabteilung
-- NICHT gebaut wird: zwei Spalten heute sind billiger als ein ALTER auf einer
-- Tabelle mit Produktivdaten später. Der CHECK erzwingt dieselbe Polymorphie wie
-- gs_tagesrapporte und gs_projekt_medien (genau EINE Bindung).
CREATE TABLE IF NOT EXISTS gs_wochenberichte (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Herkunft. 'service' ist vorbereitet, aber ungenutzt — die Serviceabteilung
  -- wird in dieser Runde nicht gebaut.
  quelle             TEXT NOT NULL DEFAULT 'projekt'
                       CHECK (quelle IN ('projekt','service')),
  projekt_id         UUID REFERENCES gs_projekte(id)        ON DELETE CASCADE,
  -- Bewusst OHNE Fremdschlüssel. Die Spalte trägt bereits die Serviceabteilung,
  -- der FK folgt erst beim Bau derselben (gleiches Muster wie seinerzeit
  -- gs_tagesrapporte.service_auftrag_id, siehe schema_rollen_foto_service.sql:72
  -- „FK wird in Feature C gesetzt"). Die Integrität hängt bis dahin am CHECK
  -- gs_wochenberichte_bindung_chk unten, der ohne FK auskommt.
  service_auftrag_id UUID,

  jahr               INT  NOT NULL CHECK (jahr BETWEEN 2000 AND 2999),
  woche              INT  NOT NULL CHECK (woche BETWEEN 1 AND 53),

  bericht_nr         TEXT,                    -- WB-{KUERZEL}-{JAHR}-{KW}
  status             TEXT NOT NULL DEFAULT 'entwurf'
                       CHECK (status IN ('entwurf','versendet')),

  -- Snapshot der eingesammelten Daten zum Zeitpunkt des Versands. Ein bereits
  -- versendeter Bericht darf sich nicht rückwirkend ändern, nur weil jemand
  -- später eine Tageszeile korrigiert. Bei status='entwurf' NULL oder Vorschau.
  daten              JSONB,

  pdf_path           TEXT,                    -- Storage-Pfad im Bucket projektdateien
  empfaenger         TEXT[] DEFAULT '{}',     -- Bauleiter-Mailadressen
  versendet_am       TIMESTAMPTZ,
  erstellt_von       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT gs_wochenberichte_bindung_chk CHECK (
       (quelle = 'projekt' AND projekt_id IS NOT NULL AND service_auftrag_id IS NULL)
    OR (quelle = 'service' AND projekt_id IS NULL     AND service_auftrag_id IS NOT NULL)
  )
);

COMMENT ON TABLE  gs_wochenberichte IS
  'Wochenbericht Projekt × KW für den Bauleiter. Getrennt von gs_wochenrapporte (Techniker × Woche).';
COMMENT ON COLUMN gs_wochenberichte.daten IS
  'Eingefrorener Datenstand beim Versand. Spätere Korrekturen an gs_tagesrapporte ändern einen versendeten Bericht nicht.';
COMMENT ON COLUMN gs_wochenberichte.quelle IS
  'projekt | service. service ist vorbereitet, aber noch nicht implementiert.';
COMMENT ON COLUMN gs_wochenberichte.service_auftrag_id IS
  'OHNE Fremdschlüssel angelegt. Der FK auf gs_service_auftrag(id) ON DELETE CASCADE wird '
  'nachgezogen, sobald die Serviceabteilung gebaut wird — analog zu dem Weg, den '
  'gs_tagesrapporte.service_auftrag_id genommen hat (Spalte zuerst, FK in einem zweiten '
  'guarded DO-Block). Bis dahin sichert der CHECK gs_wochenberichte_bindung_chk, dass die '
  'Spalte nur zusammen mit quelle=''service'' und ohne projekt_id gesetzt sein kann. '
  'Nachtragen später mit: ALTER TABLE gs_wochenberichte ADD CONSTRAINT '
  'gs_wochenberichte_service_fk FOREIGN KEY (service_auftrag_id) '
  'REFERENCES gs_service_auftrag(id) ON DELETE CASCADE;';


-- ── 3. Eindeutigkeit = Race-Schutz ─────────────────────────────────────────
-- Partielle UNIQUE-Indizes, weil je nach quelle genau eine der beiden Spalten
-- NULL ist (Postgres wertet NULLs in einem normalen UNIQUE als distinct — das
-- würde hier nichts sperren).
CREATE UNIQUE INDEX IF NOT EXISTS idx_gs_wochenberichte_projekt_kw
  ON gs_wochenberichte (projekt_id, jahr, woche)         WHERE projekt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gs_wochenberichte_service_kw
  ON gs_wochenberichte (service_auftrag_id, jahr, woche) WHERE service_auftrag_id IS NOT NULL;

-- Liste „alle Berichte dieses Projekts", neueste zuerst.
CREATE INDEX IF NOT EXISTS idx_gs_wochenberichte_projekt
  ON gs_wochenberichte (projekt_id, jahr DESC, woche DESC);


-- ── 4. Fehlende Indizes auf Bestandstabellen ───────────────────────────────
-- Die Kernabfrage des Wochenberichts ist „alle Zeilen eines Projekts in einem
-- DATUMSBEREICH". Sie läuft bewusst über datum und NICHT über woche/jahr: zwei
-- Altzeilen (2026-07-13/14, Projekt 3336e6f1) haben woche IS NULL und jahr IS
-- NULL und würden bei einer woche/jahr-Abfrage stillschweigend verschwinden.
-- Diese Zeilen werden NICHT repariert — die Abfrage richtet sich nach ihnen.
--
-- Bisher existieren auf gs_tagesrapporte nur idx_..._service (service_auftrag_id)
-- und idx_..._wochenrapport (wochenrapport_id). Für (projekt_id, datum) gibt es
-- keinen Index.
CREATE INDEX IF NOT EXISTS idx_gs_tagesrapporte_projekt_datum
  ON gs_tagesrapporte (projekt_id, datum);
CREATE INDEX IF NOT EXISTS idx_gs_tagesrapporte_service_datum
  ON gs_tagesrapporte (service_auftrag_id, datum);

-- gs_tagesrapport_taetigkeitenkatalog wird von loadTaetigkeitenFuerTagesrapporte
-- (api/cockpit.js) über tagesrapport_id=in.(…) getroffen, hat aber keinen Index —
-- scripts/taetigkeiten_katalog.sql legt keinen an. Bei einer Projektwoche sind das
-- schnell ~50 IDs pro Abfrage.
-- Guarded, weil die Tabelle aus einer separaten Migration stammt.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'gs_tagesrapport_taetigkeitenkatalog'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_gs_tr_taetkat_rapport
      ON gs_tagesrapport_taetigkeitenkatalog (tagesrapport_id);
  ELSE
    RAISE NOTICE 'gs_tagesrapport_taetigkeitenkatalog fehlt — Index übersprungen (kein Fehler).';
  END IF;
END $$;


-- ── 5. updated_at automatisch nachziehen ───────────────────────────────────
-- Eigener Trigger-Name mit gs_wochenbericht-Präfix, damit er mit nichts
-- Bestehendem kollidiert.
CREATE OR REPLACE FUNCTION gs_wochenbericht_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gs_wochenberichte_touch ON gs_wochenberichte;
CREATE TRIGGER trg_gs_wochenberichte_touch
  BEFORE UPDATE ON gs_wochenberichte
  FOR EACH ROW EXECUTE FUNCTION gs_wochenbericht_touch();


-- ── 6. RLS ─────────────────────────────────────────────────────────────────
-- Gleiches Muster wie gs_wochenrapporte (scripts/wochenrapport_migration.sql).
-- Der Server läuft mit service_role und umgeht RLS ohnehin — das hier ist die
-- zusätzliche DB-seitige Absicherung.
ALTER TABLE gs_wochenberichte ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all ON gs_wochenberichte;
CREATE POLICY service_all ON gs_wochenberichte FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS admin_all ON gs_wochenberichte;
CREATE POLICY admin_all ON gs_wochenberichte FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('gs_admin','master'))
);

-- Bewusst KEINE techniker_own-Policy: der Wochenbericht ist ein Dokument FÜR den
-- Bauleiter ÜBER die Techniker. Ein Techniker sieht seinen eigenen Wochenrapport
-- (gs_wochenrapporte), nicht die Projektsicht auf alle Kollegen.


-- ── 7. Kontrolle ───────────────────────────────────────────────────────────
SELECT 'wochenbericht ready' AS status;

-- Danach zur Sichtprüfung (optional, read-only):
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'gs_wochenberichte' ORDER BY ordinal_position;
--   SELECT indexname FROM pg_indexes WHERE tablename = 'gs_wochenberichte';
--   SELECT indexname FROM pg_indexes WHERE tablename = 'gs_tagesrapporte';
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'gs_projekte' AND column_name = 'kuerzel';
