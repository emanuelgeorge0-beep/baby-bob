-- ═══════════════════════════════════════════════════════════════════════════
-- TÄTIGKEITSKATALOG — antippbare Tätigkeiten statt Freitext (Runde B, ZIEL 1)
-- ═══════════════════════════════════════════════════════════════════════════
-- KORREKTUR gegenüber der ersten Fassung: "gs_taetigkeiten" war KEIN freier
-- Name — er kollidierte mit einer bereits bestehenden, aktiv genutzten Tabelle
-- (Projekt-Tätigkeiten-Log: api/cockpit.js addTaetigkeit/pm_taetigkeit_add,
-- pm_taetigkeit_del, pmProjekt-Lesezugriff; UI in gs-intern.html). Der erste
-- Lauf dieses Skripts hat diese Tabelle überschrieben, alte Zeilen sind
-- unwiederbringlich weg (kein Restore möglich ausser über ein Supabase-Backup).
--
-- Diese Fassung macht drei Dinge:
--   1. Benennt den NEUEN Katalog um in gs_taetigkeitenkatalog (Daten aus dem
--      letzten Lauf bleiben per RENAME erhalten, kein erneutes Seeden nötig).
--   2. Benennt die Zuordnungstabelle entsprechend in
--      gs_tagesrapport_taetigkeitenkatalog um.
--   3. Legt die ALTE gs_taetigkeiten (projekt_id/beschreibung/techniker_name/
--      datum/stunden) wieder frisch an, damit pm_taetigkeit_add/_del und die
--      Projektdetailseite wieder funktionieren — die verlorenen alten Zeilen
--      kommen dadurch NICHT zurück, nur die Funktion wieder.
--
-- Geprüft: gs_taetigkeitenkatalog / gs_tagesrapport_taetigkeitenkatalog kommen
-- in KEINER .js/.html/.sql-Datei des Repos bisher vor (grep bestätigt) — keine
-- weitere Kollision.
--
-- Re-run-fest: CREATE TABLE IF NOT EXISTS legt nur die id-Spalte an, danach
-- ADD COLUMN IF NOT EXISTS pro Spalte. NOT NULL/CHECK/UNIQUE/FK erst, wenn die
-- jeweilige Spalte sicher existiert — per DO-Block gegen pg_constraint geprüft.
-- Run im Supabase SQL-Editor (DDL geht nicht über die PostgREST-Data-API).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Vorprüfung — bricht sauber ab, BEVOR irgendeine DDL läuft ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='gs_tagesrapporte'
  ) THEN
    RAISE EXCEPTION 'ABBRUCH: Tabelle gs_tagesrapporte existiert nicht — Skript gestoppt, nichts angelegt.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='gs_tagesrapporte'
      AND column_name='id' AND data_type='uuid'
  ) THEN
    RAISE EXCEPTION 'ABBRUCH: gs_tagesrapporte.id ist kein uuid — Fremdschlüssel würde fehlschlagen. Skript gestoppt.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='user_roles'
  ) THEN
    RAISE EXCEPTION 'ABBRUCH: Tabelle user_roles existiert nicht — RLS-Policies würden fehlschlagen. Skript gestoppt.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='gs_projekte'
  ) THEN
    RAISE EXCEPTION 'ABBRUCH: Tabelle gs_projekte existiert nicht — Fremdschlüssel der Legacy-Tabelle würde fehlschlagen. Skript gestoppt.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='gs_projekte'
      AND column_name='id' AND data_type='uuid'
  ) THEN
    RAISE EXCEPTION 'ABBRUCH: gs_projekte.id ist kein uuid — Fremdschlüssel würde fehlschlagen. Skript gestoppt.';
  END IF;
END $$;

-- ── 0b. Einmalige Umbenennung — rettet die 71 bereits geseedeten Katalogzeilen ──
-- Nur umbenennen, wenn "gs_taetigkeiten" GERADE JETZT das Katalog-Schema trägt
-- (erkennbar an der Spalte "slug", die es in der alten Legacy-Tabelle nie gab)
-- UND der Zielname noch frei ist. Auf einer frischen DB (wo gs_taetigkeiten nie
-- existiert hat oder schon die Legacy-Form hat) ist das ein No-Op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gs_taetigkeiten')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gs_taetigkeiten' AND column_name='slug')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gs_taetigkeitenkatalog')
  THEN
    ALTER TABLE gs_taetigkeiten RENAME TO gs_taetigkeitenkatalog;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gs_tagesrapport_taetigkeiten')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gs_tagesrapport_taetigkeitenkatalog')
  THEN
    ALTER TABLE gs_tagesrapport_taetigkeiten RENAME TO gs_tagesrapport_taetigkeitenkatalog;
  END IF;
END $$;

-- ── 1. gs_taetigkeitenkatalog — Grundgerüst, dann Spalten einzeln ──
CREATE TABLE IF NOT EXISTS gs_taetigkeitenkatalog (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY
);
ALTER TABLE gs_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS gewerk         TEXT;
ALTER TABLE gs_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS slug           TEXT;                          -- stabil, nie ändern
ALTER TABLE gs_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS bezeichnung    TEXT;                          -- frei änderbar
ALTER TABLE gs_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS kategorie      TEXT;
ALTER TABLE gs_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS detailfelder   JSONB DEFAULT '{"felder":[]}'::jsonb; -- {"felder":["DN","M","ORT"]}
ALTER TABLE gs_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS sortierung     INT DEFAULT 0;                 -- Zehnerschritte
ALTER TABLE gs_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS quelle_service BOOLEAN DEFAULT false;          -- true = Service, im Wochenrapport ausgeblendet
ALTER TABLE gs_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS aktiv          BOOLEAN DEFAULT true;           -- deaktivieren statt löschen
ALTER TABLE gs_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ DEFAULT NOW();

-- Backfill (no-op bei leerer/neuer Tabelle, self-healing bei Altbestand)
UPDATE gs_taetigkeitenkatalog SET detailfelder   = '{"felder":[]}'::jsonb WHERE detailfelder IS NULL;
UPDATE gs_taetigkeitenkatalog SET sortierung     = 0     WHERE sortierung IS NULL;
UPDATE gs_taetigkeitenkatalog SET quelle_service = false WHERE quelle_service IS NULL;
UPDATE gs_taetigkeitenkatalog SET aktiv          = true  WHERE aktiv IS NULL;

-- NOT NULL erst setzen, wenn wirklich keine NULLs mehr drinstehen
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM gs_taetigkeitenkatalog
    WHERE gewerk IS NULL OR slug IS NULL OR bezeichnung IS NULL OR kategorie IS NULL
  ) THEN
    ALTER TABLE gs_taetigkeitenkatalog ALTER COLUMN gewerk         SET NOT NULL;
    ALTER TABLE gs_taetigkeitenkatalog ALTER COLUMN slug            SET NOT NULL;
    ALTER TABLE gs_taetigkeitenkatalog ALTER COLUMN bezeichnung     SET NOT NULL;
    ALTER TABLE gs_taetigkeitenkatalog ALTER COLUMN kategorie       SET NOT NULL;
    ALTER TABLE gs_taetigkeitenkatalog ALTER COLUMN detailfelder    SET NOT NULL;
    ALTER TABLE gs_taetigkeitenkatalog ALTER COLUMN sortierung      SET NOT NULL;
    ALTER TABLE gs_taetigkeitenkatalog ALTER COLUMN quelle_service  SET NOT NULL;
    ALTER TABLE gs_taetigkeitenkatalog ALTER COLUMN aktiv           SET NOT NULL;
  END IF;
END $$;

-- CHECK-Constraint guarded
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gs_taetigkeitenkatalog_gewerk_check') THEN
    ALTER TABLE gs_taetigkeitenkatalog ADD CONSTRAINT gs_taetigkeitenkatalog_gewerk_check
      CHECK (gewerk IN ('sanitaer','heizung','lueftung','klima','allgemein'));
  END IF;
END $$;

-- UNIQUE-Constraint guarded (Basis für ON CONFLICT im Seed weiter unten)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gs_taetigkeitenkatalog_gewerk_slug_key') THEN
    ALTER TABLE gs_taetigkeitenkatalog ADD CONSTRAINT gs_taetigkeitenkatalog_gewerk_slug_key UNIQUE (gewerk, slug);
  END IF;
END $$;

-- Index — erst hier, nachdem "aktiv" garantiert existiert
CREATE INDEX IF NOT EXISTS idx_gs_taetigkeitenkatalog_gewerk_aktiv ON gs_taetigkeitenkatalog(gewerk) WHERE aktiv;

-- ── 2. gs_tagesrapport_taetigkeitenkatalog — Grundgerüst, dann Spalten einzeln ──
-- bezeichnung_snapshot ist PFLICHT: Katalogänderungen dürfen bereits erfasste
-- Rapporte nie rückwirkend verändern — Anzeige liest immer den Snapshot.
CREATE TABLE IF NOT EXISTS gs_tagesrapport_taetigkeitenkatalog (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY
);
ALTER TABLE gs_tagesrapport_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS tagesrapport_id      UUID;
ALTER TABLE gs_tagesrapport_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS taetigkeit_id        UUID;
ALTER TABLE gs_tagesrapport_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS bezeichnung_snapshot TEXT;
ALTER TABLE gs_tagesrapport_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS details              JSONB DEFAULT '{}'::jsonb; -- {"DN":"56","STK":2,"ORT":"1.OG"}
ALTER TABLE gs_tagesrapport_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS sortierung           INT DEFAULT 0;
ALTER TABLE gs_tagesrapport_taetigkeitenkatalog ADD COLUMN IF NOT EXISTS created_at           TIMESTAMPTZ DEFAULT NOW();

UPDATE gs_tagesrapport_taetigkeitenkatalog SET details    = '{}'::jsonb WHERE details IS NULL;
UPDATE gs_tagesrapport_taetigkeitenkatalog SET sortierung = 0           WHERE sortierung IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM gs_tagesrapport_taetigkeitenkatalog
    WHERE tagesrapport_id IS NULL OR bezeichnung_snapshot IS NULL
  ) THEN
    ALTER TABLE gs_tagesrapport_taetigkeitenkatalog ALTER COLUMN tagesrapport_id      SET NOT NULL;
    ALTER TABLE gs_tagesrapport_taetigkeitenkatalog ALTER COLUMN bezeichnung_snapshot SET NOT NULL;
    ALTER TABLE gs_tagesrapport_taetigkeitenkatalog ALTER COLUMN details              SET NOT NULL;
    ALTER TABLE gs_tagesrapport_taetigkeitenkatalog ALTER COLUMN sortierung           SET NOT NULL;
  END IF;
END $$;

-- Fremdschlüssel guarded
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gs_tagesrapport_taetigkeitenkatalog_tagesrapport_id_fkey') THEN
    ALTER TABLE gs_tagesrapport_taetigkeitenkatalog
      ADD CONSTRAINT gs_tagesrapport_taetigkeitenkatalog_tagesrapport_id_fkey
      FOREIGN KEY (tagesrapport_id) REFERENCES gs_tagesrapporte(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gs_tagesrapport_taetigkeitenkatalog_taetigkeit_id_fkey') THEN
    ALTER TABLE gs_tagesrapport_taetigkeitenkatalog
      ADD CONSTRAINT gs_tagesrapport_taetigkeitenkatalog_taetigkeit_id_fkey
      FOREIGN KEY (taetigkeit_id) REFERENCES gs_taetigkeitenkatalog(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gs_tagesrapport_taetigkeitenkatalog_tr ON gs_tagesrapport_taetigkeitenkatalog(tagesrapport_id);

-- ── 3. RLS ──
-- gs_taetigkeitenkatalog: JEDE angemeldete Rolle darf lesen (Techniker tippt an,
-- Master pflegt), schreiben nur Master/gs_admin. service_role (Server) immer.
ALTER TABLE gs_taetigkeitenkatalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON gs_taetigkeitenkatalog;
CREATE POLICY service_all ON gs_taetigkeitenkatalog FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS read_all_angemeldet ON gs_taetigkeitenkatalog;
CREATE POLICY read_all_angemeldet ON gs_taetigkeitenkatalog FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS admin_write ON gs_taetigkeitenkatalog;
CREATE POLICY admin_write ON gs_taetigkeitenkatalog FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('gs_admin','master'))
);

-- gs_tagesrapport_taetigkeitenkatalog: folgt denselben drei Policies wie
-- gs_tagesrapporte (service_all / admin_all / techniker_own), "eigene Zeile"
-- hier per Join auf gs_tagesrapporte, weil diese Tabelle selbst keine
-- techniker_user_id-Spalte hat.
ALTER TABLE gs_tagesrapport_taetigkeitenkatalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON gs_tagesrapport_taetigkeitenkatalog;
CREATE POLICY service_all ON gs_tagesrapport_taetigkeitenkatalog FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS admin_all ON gs_tagesrapport_taetigkeitenkatalog;
CREATE POLICY admin_all ON gs_tagesrapport_taetigkeitenkatalog FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('gs_admin','master'))
);
DROP POLICY IF EXISTS techniker_own ON gs_tagesrapport_taetigkeitenkatalog;
CREATE POLICY techniker_own ON gs_tagesrapport_taetigkeitenkatalog FOR ALL USING (
  EXISTS (
    SELECT 1 FROM gs_tagesrapporte t
    WHERE t.id = gs_tagesrapport_taetigkeitenkatalog.tagesrapport_id AND t.techniker_user_id = auth.uid()
  )
);

-- ── 4. Startkatalog — Seed per UPSERT, nicht DO NOTHING ──
-- Bezeichnung/Kategorie/Detailfelder/Sortierung sind später über den Slug
-- korrigierbar (erneuter Lauf dieser INSERT-Sektion aktualisiert sie); der
-- Slug selbst ändert sich nie.
INSERT INTO gs_taetigkeitenkatalog (gewerk, slug, bezeichnung, kategorie, detailfelder, sortierung, quelle_service) VALUES
  -- sanitaer / Leitungsbau
  ('sanitaer','kaltwasserleitung',      'Kaltwasserleitung',              'Leitungsbau', '{"felder":["DN","M","ORT"]}', 10, false),
  ('sanitaer','warmwasserleitung',      'Warmwasserleitung',              'Leitungsbau', '{"felder":["DN","M","ORT"]}', 20, false),
  ('sanitaer','zirkulation',            'Zirkulationsleitung',            'Leitungsbau', '{"felder":["DN","M","ORT"]}', 30, false),
  ('sanitaer','ablaufleitung',          'Ablaufleitung',                  'Leitungsbau', '{"felder":["DN","M","ORT"]}', 40, false),
  ('sanitaer','entlueftungsleitung',    'Entlüftungsleitung',             'Leitungsbau', '{"felder":["DN","M","ORT"]}', 50, false),
  ('sanitaer','steigzone',              'Steigzone',                      'Leitungsbau', '{"felder":["DN","ORT"]}',     60, false),
  ('sanitaer','zone_kaltwasser',        'Zone Kaltwasser',                'Leitungsbau', '{"felder":["ORT"]}',         70, false),
  ('sanitaer','zone_warmwasser',        'Zone Warmwasser',                'Leitungsbau', '{"felder":["ORT"]}',         80, false),
  ('sanitaer','zone_zirkulation',       'Zone Zirkulation',               'Leitungsbau', '{"felder":["ORT"]}',         90, false),
  ('sanitaer','kernbohrung',            'Kernbohrung / Durchbruch',       'Leitungsbau', '{"felder":["STK","DN","ORT"]}',100, false),
  ('sanitaer','isolation_sanitaer',     'Isolation Sanitärleitungen',     'Leitungsbau', '{"felder":["M","ORT"]}',     110, false),

  -- sanitaer / Fertigmontage
  ('sanitaer','fertigmontage',          'Fertigmontage allgemein',        'Fertigmontage', '{"felder":["ORT"]}',           10, false),
  ('sanitaer','waschtisch',             'Waschtisch montiert',            'Fertigmontage', '{"felder":["STK","ORT"]}',     20, false),
  ('sanitaer','wc_montiert',            'WC montiert',                    'Fertigmontage', '{"felder":["STK","ORT"]}',     30, false),
  ('sanitaer','brausetasse',            'Brausetasse installiert',        'Fertigmontage', '{"felder":["STK","ORT"]}',     40, false),
  ('sanitaer','badewanne',              'Badewanne montiert',             'Fertigmontage', '{"felder":["STK","ORT"]}',     50, false),
  ('sanitaer','duschenarmatur',         'Dusche / Duschenarmatur',        'Fertigmontage', '{"felder":["STK","ORT"]}',     60, false),
  ('sanitaer','armatur',                'Armatur montiert',               'Fertigmontage', '{"felder":["STK","TYP","ORT"]}',70, false),
  ('sanitaer','spuelkasten',            'Spülkasten / Betätigungsplatte', 'Fertigmontage', '{"felder":["STK","ORT"]}',     80, false),
  ('sanitaer','kuechenanschluss',       'Küchenanschluss / Spüle',        'Fertigmontage', '{"felder":["STK","ORT"]}',     90, false),
  ('sanitaer','waschmaschinenanschluss','Waschmaschinenanschluss',        'Fertigmontage', '{"felder":["STK","ORT"]}',    100, false),
  ('sanitaer','badezimmerinstallation', 'Badezimmerinstallation komplett','Fertigmontage', '{"felder":["ORT"]}',          110, false),
  ('sanitaer','silikonarbeiten',        'Silikonarbeiten',                'Fertigmontage', '{"felder":["ORT"]}',          120, false),

  -- sanitaer / Apparate
  ('sanitaer','boiler',                 'Boiler / Wassererwärmer',        'Apparate', '{"felder":["TYP","STK","ORT"]}', 10, false),
  ('sanitaer','enthaertung',            'Enthärtungsanlage',              'Apparate', '{"felder":["TYP","ORT"]}',       20, false),
  ('sanitaer','druckreduzierventil',    'Druckreduzierventil / Absperrarmatur','Apparate', '{"felder":["STK","DN","ORT"]}',30, false),
  ('sanitaer','hebeanlage',             'Hebeanlage / Pumpe',             'Apparate', '{"felder":["TYP","ORT"]}',       40, false),
  ('sanitaer','regenwasseranlage',      'Regenwasseranlage',              'Apparate', '{"felder":["TYP","ORT"]}',       50, false),

  -- sanitaer / Prüfung & Inbetriebnahme
  ('sanitaer','druckprobe_sanitaer',    'Druckprobe / Dichtheitsprüfung', 'Prüfung & Inbetriebnahme', '{"felder":["BAR","ORT"]}', 10, false),
  ('sanitaer','spuelen_desinfektion',   'Spülen / Desinfektion',          'Prüfung & Inbetriebnahme', '{"felder":["ORT"]}',       20, false),

  -- heizung / Verteilung
  ('heizung','heizung_vorlauf',         'Heizung Vorlauf',                'Verteilung', '{"felder":["DN","M","ORT"]}', 10, false),
  ('heizung','heizung_ruecklauf',       'Heizung Rücklauf',               'Verteilung', '{"felder":["DN","M","ORT"]}', 20, false),
  ('heizung','heizkreisverteiler',      'Verteiler / Heizkreisverteiler', 'Verteilung', '{"felder":["STK","ORT"]}',    30, false),
  ('heizung','steigzone_heizung',       'Steigzone Heizung',              'Verteilung', '{"felder":["DN","ORT"]}',     40, false),
  ('heizung','isolation_heizung',       'Isolation Heizleitungen',        'Verteilung', '{"felder":["M","ORT"]}',      50, false),

  -- heizung / Wärmeabgabe
  ('heizung','heizkoerper',             'Heizkörper montiert',            'Wärmeabgabe', '{"felder":["STK","TYP","ORT"]}', 10, false),
  ('heizung','handtuchheizkoerper',     'Handtuchheizkörper Bad',         'Wärmeabgabe', '{"felder":["STK","ORT"]}',       20, false),
  ('heizung','fussbodenheizung',        'Fussbodenheizung verlegt',       'Wärmeabgabe', '{"felder":["M2","STK","ORT"]}',  30, false),
  ('heizung','thermostatventil',        'Thermostatventil / Ventilkopf',  'Wärmeabgabe', '{"felder":["STK","ORT"]}',       40, false),

  -- heizung / Wärmeerzeugung
  ('heizung','waermepumpe',             'Wärmepumpe',                     'Wärmeerzeugung', '{"felder":["TYP","ORT"]}',      10, false),
  ('heizung','waermetauscher',          'Wärmetauscher',                  'Wärmeerzeugung', '{"felder":["TYP","ORT"]}',      20, false),
  ('heizung','heizkessel',              'Heizkessel',                     'Wärmeerzeugung', '{"felder":["TYP","ORT"]}',      30, false),
  ('heizung','pumpengruppe',            'Pumpengruppe / Umwälzpumpe',     'Wärmeerzeugung', '{"felder":["TYP","STK","ORT"]}',40, false),
  ('heizung','expansionsgefaess',       'Expansionsgefäss',               'Wärmeerzeugung', '{"felder":["TYP","ORT"]}',      50, false),
  ('heizung','speicher_weiche',         'Speicher / Hydraulische Weiche', 'Wärmeerzeugung', '{"felder":["TYP","ORT"]}',      60, false),

  -- heizung / Prüfung & Inbetriebnahme
  ('heizung','befuellen_entlueften',    'Befüllen / Entlüften',           'Prüfung & Inbetriebnahme', '{"felder":["ORT"]}',       10, false),
  ('heizung','druckprobe_heizung',      'Druckprobe Heizung',             'Prüfung & Inbetriebnahme', '{"felder":["BAR","ORT"]}', 20, false),
  ('heizung','hydraulischer_abgleich',  'Hydraulischer Abgleich',         'Prüfung & Inbetriebnahme', '{"felder":["ORT"]}',       30, false),
  ('heizung','inbetriebnahme_heizung',  'Inbetriebnahme / Einregulierung','Prüfung & Inbetriebnahme', '{"felder":["ORT"]}',       40, false),

  -- lueftung / Lüftung
  ('lueftung','lueftungskanal',         'Kanal- / Rohrmontage',           'Lüftung', '{"felder":["DN","M","ORT"]}', 10, false),
  ('lueftung','lueftungsgeraet',        'Lüftungsgerät montiert',         'Lüftung', '{"felder":["TYP","ORT"]}',    20, false),
  ('lueftung','luftauslass',            'Ventil / Auslass montiert',      'Lüftung', '{"felder":["STK","ORT"]}',    30, false),
  ('lueftung','filterwechsel',          'Filterwechsel',                  'Lüftung', '{"felder":["STK","ORT"]}',    40, false),
  ('lueftung','einregulierung_luft',    'Einregulierung Luftmengen',      'Lüftung', '{"felder":["ORT"]}',          50, false),

  -- klima / Klima
  ('klima','kaelteleitung',             'Kälteleitung verlegt',           'Klima', '{"felder":["DN","M","ORT"]}',     10, false),
  ('klima','innengeraet',               'Innengerät montiert',            'Klima', '{"felder":["STK","TYP","ORT"]}',  20, false),
  ('klima','aussengeraet',              'Aussengerät montiert',           'Klima', '{"felder":["STK","TYP","ORT"]}',  30, false),
  ('klima','kondensatleitung',          'Kondensatleitung',               'Klima', '{"felder":["DN","M","ORT"]}',     40, false),
  ('klima','inbetriebnahme_kaelte',     'Inbetriebnahme Kälte',           'Klima', '{"felder":["ORT"]}',              50, false),

  -- allgemein / Baustelle
  ('allgemein','baustelleneinrichtung', 'Baustelleneinrichtung',          'Baustelle', '{"felder":["ORT"]}', 10, false),
  ('allgemein','materialtransport',     'Materialtransport / Anlieferung','Baustelle', '{"felder":["ORT"]}', 20, false),
  ('allgemein','konstruktion_gebaut',   'Konstruktion gebaut',            'Baustelle', '{"felder":["ORT"]}', 30, false),
  ('allgemein','demontage',             'Demontage / Rückbau',            'Baustelle', '{"felder":["ORT"]}', 40, false),
  ('allgemein','baustellenreinigung',   'Baustellenreinigung',            'Baustelle', '{"felder":["ORT"]}', 50, false),
  ('allgemein','aufmass_kontrolle',     'Aufmass / Kontrolle',            'Baustelle', '{"felder":["ORT"]}', 60, false),
  ('allgemein','koordination',          'Besprechung / Koordination Bauleitung','Baustelle', '{"felder":[]}', 70, false),
  ('allgemein','regiearbeit',           'Regiearbeit nach Anweisung',     'Baustelle', '{"felder":["ORT"]}', 80, false),

  -- allgemein / Service — quelle_service = true (im Wochenrapport ausgeblendet)
  ('allgemein','wartung',               'Wartung durchgeführt',           'Service', '{"felder":["TYP","ORT"]}', 10, true),
  ('allgemein','serviceauftrag',        'Serviceauftrag',                 'Service', '{"felder":["TYP","ORT"]}', 20, true),
  ('allgemein','stoerungsbehebung',     'Störungsbehebung / Reparatur',   'Service', '{"felder":["TYP","ORT"]}', 30, true),
  ('allgemein','vergebliche_anfahrt',   'Vergebliche Anfahrt',            'Service', '{"felder":[]}',            40, true)

ON CONFLICT (gewerk, slug) DO UPDATE SET
  bezeichnung  = EXCLUDED.bezeichnung,
  kategorie    = EXCLUDED.kategorie,
  detailfelder = EXCLUDED.detailfelder,
  sortierung   = EXCLUDED.sortierung,
  quelle_service = EXCLUDED.quelle_service;

-- ═══════════════════════════════════════════════════════════════════════════
-- ── 5. LEGACY-WIEDERHERSTELLUNG — gs_taetigkeiten (Projekt-Tätigkeiten-Log) ──
-- Altes Schema, unverändert zu dem, was addTaetigkeit/pm_taetigkeit_add/
-- pmProjekt (api/cockpit.js) erwarten. KEIN Code-Change dort nötig — nur die
-- Tabelle fehlte. Die durch das Drop verlorenen alten Zeilen kommen dadurch
-- NICHT zurück, nur die Funktion (Hinzufügen/Lesen/Löschen) wieder.
-- ═══════════════════════════════════════════════════════════════════════════

-- Sicherheitsnetz: falls die Umbenennung oben aus irgendeinem Grund NICHT
-- gegriffen hat, trägt "gs_taetigkeiten" an dieser Stelle noch das
-- Katalog-Schema (Spalte "slug") — dann lieber laut abbrechen, als Katalog-
-- und Legacy-Spalten auf derselben Tabelle zu vermischen (genau der Fehler,
-- der uns die Tabelle das erste Mal gekostet hat).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='gs_taetigkeiten' AND column_name='slug'
  ) THEN
    RAISE EXCEPTION 'ABBRUCH: gs_taetigkeiten trägt noch das Katalog-Schema (Spalte slug) — Umbenennung nach gs_taetigkeitenkatalog ist nicht wie erwartet gelaufen. Skript gestoppt, Legacy-Tabelle nicht angefasst.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS gs_taetigkeiten (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY
);
ALTER TABLE gs_taetigkeiten ADD COLUMN IF NOT EXISTS projekt_id      UUID;
ALTER TABLE gs_taetigkeiten ADD COLUMN IF NOT EXISTS beschreibung    TEXT;
ALTER TABLE gs_taetigkeiten ADD COLUMN IF NOT EXISTS techniker_name  TEXT;
ALTER TABLE gs_taetigkeiten ADD COLUMN IF NOT EXISTS datum           DATE;
ALTER TABLE gs_taetigkeiten ADD COLUMN IF NOT EXISTS stunden         NUMERIC;
ALTER TABLE gs_taetigkeiten ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM gs_taetigkeiten WHERE projekt_id IS NULL OR beschreibung IS NULL
  ) THEN
    ALTER TABLE gs_taetigkeiten ALTER COLUMN projekt_id   SET NOT NULL;
    ALTER TABLE gs_taetigkeiten ALTER COLUMN beschreibung SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gs_taetigkeiten_projekt_id_fkey') THEN
    ALTER TABLE gs_taetigkeiten
      ADD CONSTRAINT gs_taetigkeiten_projekt_id_fkey
      FOREIGN KEY (projekt_id) REFERENCES gs_projekte(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gs_taetigkeiten_projekt ON gs_taetigkeiten(projekt_id);

-- RLS: Master-only Feature (requireOwnedProjekt/requireOwnedRow prüfen Zugriff
-- bereits im Code), Server läuft ohnehin über service_role — dieselbe Absicherung
-- wie bei vergleichbaren PM-only-Tabellen (kein techniker_own nötig).
ALTER TABLE gs_taetigkeiten ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON gs_taetigkeiten;
CREATE POLICY service_all ON gs_taetigkeiten FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS admin_all ON gs_taetigkeiten;
CREATE POLICY admin_all ON gs_taetigkeiten FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('gs_admin','master'))
);

SELECT
  (SELECT count(*) FROM gs_taetigkeitenkatalog) AS katalog_zeilen,
  (SELECT count(*) FROM gs_taetigkeiten) AS legacy_zeilen_projekt_taetigkeiten,
  'taetigkeiten_katalog + legacy-fix ready' AS status;
