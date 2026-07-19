-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEMA — Rollen & Rapport (A) · Foto/Video-Standort-Tagging (B) · Service-Auftrag (C)
-- ---------------------------------------------------------------------------
-- Branch: schema-diagnose-rollen-foto-service
-- Status: VORSCHLAG aus der Diagnose-Runde. NICHT automatisch ausführen.
--         Emanuel führt dieses Skript MANUELL im Supabase SQL-Editor als
--         service_role aus (DDL geht nicht über die PostgREST-Data-API).
--
-- Grundmuster (unverändert, KEINE RLS-Abhängigkeit für den Live-Pfad):
--   • Enforcement passiert in api/cockpit.js mit dem Service-Key.
--   • Mandantentrennung über gs_projekte.partner_user_id + requireOwnedProjekt.
--   • RLS ist nur zweite Verteidigungslinie (Service-Key umgeht sie).
--   • Admin/Master-UUID: ee46a716-7017-4045-9f67-fe06d05171e7
--
-- Idempotent wo möglich (IF NOT EXISTS / DROP-CREATE POLICY / ADD COLUMN IF NOT EXISTS).
-- Foreign Keys gesetzt. Alle Tabellen bekommen service_all-Policy als Backstop.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN PERFORM 1; END $$;  -- noop


-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ FEATURE A — Techniker-Rollen & Rapport                                    ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
-- BEFUND: Das meiste existiert bereits (siehe DIAGNOSE.md):
--   • user_roles                → Rollen-Quelle (role: bob_user|gs_partner|techniker|gs_admin)
--   • gs_projekt_techniker      → Projekt↔Techniker (mehrere Techniker je Projekt)
--   • gs_tagesrapporte          → Rapport mit FREI setzbarem Datum, Stunden, Material, Notiz
-- Dieser Block richtet die vorhandenen Strukturen nur kanonisch aus (additiv),
-- er baut sie NICHT neu. Die Rolle 'techniker' als API-Aufrufer zu aktivieren
-- ist reine CODE-Arbeit (BLOCK 2) — hier nichts zu tun außer der Rollen-CHECK.

-- A.1 — Rollen-Hierarchie master / techniker / partner in user_roles zulassen.
--       Bestand: 'gs_admin' (= Master) / 'gs_partner' (= Partner) / 'techniker'.
--       Wir ERGÄNZEN 'master' als Synonym (gewerke.js prüft bereits IN ('gs_admin','master')),
--       ohne Bestehendes umzubenennen. Rein additiv.
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('bob_user','gs_partner','techniker','gs_admin','master'));

-- A.2 — Projekt↔Techniker-Zuordnung (mehrere Techniker je Projekt).
--       MASSGABE (in Live-DB verifiziert): KANONISCH ist techniker_id → gs_techniker(id),
--       die Pool-PK (cockpit.js:1754-1758 joint so). Die ebenfalls vorhandene Spalte
--       techniker_user_id ist VERWAIST (Rest aus gewerke-RLS) → NICHT verwenden,
--       NICHT droppen (Cleanup später separat). Bestehende Live-Tabelle bleibt unberührt.
CREATE TABLE IF NOT EXISTS gs_projekt_techniker (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  projekt_id   UUID NOT NULL REFERENCES gs_projekte(id)  ON DELETE CASCADE,
  techniker_id UUID NOT NULL REFERENCES gs_techniker(id) ON DELETE CASCADE,  -- = gs_techniker.id
  taetigkeit   TEXT,
  seit         DATE,
  stundensatz  NUMERIC(7,2),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (projekt_id, techniker_id)
);
-- Falls die Tabelle bereits existiert (Live), fehlende Spalten additiv ergänzen.
ALTER TABLE gs_projekt_techniker
  ADD COLUMN IF NOT EXISTS taetigkeit  TEXT,
  ADD COLUMN IF NOT EXISTS seit        DATE,
  ADD COLUMN IF NOT EXISTS stundensatz NUMERIC(7,2);
CREATE INDEX IF NOT EXISTS idx_gs_projekt_techniker_projekt ON gs_projekt_techniker(projekt_id);
CREATE INDEX IF NOT EXISTS idx_gs_projekt_techniker_tech    ON gs_projekt_techniker(techniker_id);

-- A.3 — Rapport: bestehende gs_tagesrapporte WIEDERVERWENDEN.
--       Datum ist bereits FREI setzbar (DATE, kein auto-now) → Backdating OK.
--       Wir ergänzen nur zwei additive Dinge:
--        (a) Herkunft/Provenienz, damit Master rückwirkend erfasste Rapporte erkennt.
--        (b) service_auftrag_id (Vorbereitung Feature C, siehe dort) + projekt_id
--            nullbar, damit derselbe Rapport-Pfad Service-Aufträge tragen kann.
ALTER TABLE gs_tagesrapporte
  ADD COLUMN IF NOT EXISTS erfasst_von        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rueckwirkend       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS service_auftrag_id UUID;   -- FK wird in Feature C gesetzt

-- projekt_id nullbar machen, damit ein Rapport ENTWEDER an ein Projekt ODER an
-- einen Service-Auftrag hängt (Feature C). Bestehende Zeilen bleiben unberührt.
ALTER TABLE gs_tagesrapporte ALTER COLUMN projekt_id DROP NOT NULL;

-- HINWEIS (kein DDL): die bestehende UNIQUE(projekt_id, techniker_user_id, datum)
-- bleibt. Für Service-Rapporte ist projekt_id NULL → Postgres wertet NULLs als
-- distinct → keine Kollision. Backdating einer ganzen Woche = verschiedene Daten
-- → ebenfalls keine Kollision. Nur zwei Rapporte am SELBEN Tag/Projekt/Techniker
-- kollidieren weiterhin (dafür existiert gs_rapport_positionen).


-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ FEATURE C — Service-Auftrag (schlanke, eigene Tabelle)                     ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
-- (Vor Feature B definiert, weil B (Medien) auf service_auftrag_id verweist.)
-- Getrennt von gs_projekte: KEIN Datenblatt / Bauabschnitt / Zahlplan.
-- Partner sendet Objekt + Beschreibung (Sprache→Text). Status-Automat.
-- Master weist Techniker zu. Rapport/Fotos/Videos hängen dran (Wiederverwendung
-- von gs_tagesrapporte bzw. gs_projekt_medien über service_auftrag_id).

-- C.1 — Service-Auftrag
CREATE TABLE IF NOT EXISTS gs_service_auftrag (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auftragsnummer   TEXT UNIQUE,
  partner_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- Ersteller/Besitzer (Mandant)
  objekt           TEXT NOT NULL,                                      -- Adresse/Objektbezeichnung
  beschreibung     TEXT,                                               -- aus Sprache→Text
  -- Herkunft des Auftrags. 'manuell' = im Cockpit erfasst, 'sprache' = Sprach→Text,
  -- 'mail' = künftiger Mail-Ingest (Hausverwaltungen/Alt-Software mailen → Felix extrahiert).
  -- NUR das Feld; der Mail-Ingest selbst ist eine spätere eigene Runde.
  quelle           TEXT NOT NULL DEFAULT 'manuell'
                     CHECK (quelle IN ('sprache','mail','manuell')),
  status           TEXT NOT NULL DEFAULT 'neu'
                     CHECK (status IN ('neu','angenommen','abgelehnt','erledigt')),
  ablehn_grund     TEXT,
  angenommen_am    TIMESTAMPTZ,
  erledigt_am      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gs_service_auftrag_partner ON gs_service_auftrag(partner_user_id);
CREATE INDEX IF NOT EXISTS idx_gs_service_auftrag_status  ON gs_service_auftrag(status);

-- C.2 — Master weist Techniker zu (mehrere Techniker je Auftrag möglich; spiegelt
--        das Muster von gs_projekt_techniker aus Feature A).
-- Konsistent mit Feature A: techniker_id → gs_techniker(id) (NICHT auth.users).
CREATE TABLE IF NOT EXISTS gs_service_techniker (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  service_auftrag_id UUID NOT NULL REFERENCES gs_service_auftrag(id) ON DELETE CASCADE,
  techniker_id       UUID NOT NULL REFERENCES gs_techniker(id)       ON DELETE CASCADE,  -- = gs_techniker.id
  zugewiesen_am      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (service_auftrag_id, techniker_id)
);
CREATE INDEX IF NOT EXISTS idx_gs_service_techniker_auftrag ON gs_service_techniker(service_auftrag_id);
CREATE INDEX IF NOT EXISTS idx_gs_service_techniker_tech    ON gs_service_techniker(techniker_id);

-- C.3 — Jetzt den FK von gs_tagesrapporte.service_auftrag_id auf gs_service_auftrag
--        setzen (die Zieltabelle existiert ab hier). Guarded, damit idempotent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gs_tagesrapporte_service_auftrag_fk') THEN
    ALTER TABLE gs_tagesrapporte
      ADD CONSTRAINT gs_tagesrapporte_service_auftrag_fk
      FOREIGN KEY (service_auftrag_id) REFERENCES gs_service_auftrag(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Genau EINE Bindung je Rapport: Projekt ODER Service-Auftrag (nicht beides/keins).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gs_tagesrapporte_bindung_chk') THEN
    ALTER TABLE gs_tagesrapporte
      ADD CONSTRAINT gs_tagesrapporte_bindung_chk
      CHECK (
        (projekt_id IS NOT NULL AND service_auftrag_id IS NULL)
        OR (projekt_id IS NULL AND service_auftrag_id IS NOT NULL)
      );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_gs_tagesrapporte_service ON gs_tagesrapporte(service_auftrag_id);


-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ FEATURE B — Foto/VIDEO-Standort-Tagging & Gebäudestruktur                 ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
-- BEFUND: Heute liegen Dateien NUR im Bucket 'projektdateien' mit 3 festen
--   Ordner-Kategorien (bilder/plaene/dateien) — KEINE DB-Metadaten, KEIN
--   Stockwerk/Raum. Dieser Block führt eine echte Medien-Metadaten-Tabelle ein.
-- Bucket bleibt 'projektdateien' (Fotos UND Videos, Übergabe-Doc §6).
-- Zwei Achsen sauber getrennt:
--   • ORT (Stockwerk → Wohnung → Raum)  ≠  BAUABSCHNITT (Arbeitsphase)
--   → getrennte Felder, siehe unten.

-- B.1 — Stockwerk-Katalog je Projekt (Dropdown-Quelle + Gruppierung).
--        Einträge entstehen aus PRESET-Liste (UG/EG/1.OG/2.OG…) UND frei
--        eintippbar → Feld 'quelle'. Presets sind app-seitig hart hinterlegt
--        (wie gewerke-Templates), es gibt hier bewusst KEINEN DB-Seed.
CREATE TABLE IF NOT EXISTS gs_projekt_stockwerk (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  projekt_id   UUID NOT NULL REFERENCES gs_projekte(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,                     -- "UG", "EG", "1.OG", frei…
  reihenfolge  INT  DEFAULT 0,                    -- für sortierte Gruppierung
  quelle       TEXT DEFAULT 'preset' CHECK (quelle IN ('preset','frei')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (projekt_id, name)
);
CREATE INDEX IF NOT EXISTS idx_gs_projekt_stockwerk_projekt ON gs_projekt_stockwerk(projekt_id);

-- B.2 — Medien-Tabelle (Fotos UND Videos) mit Standort-Tags.
--        medientyp trägt beide Typen von Anfang an. Standort-Tags gelten für beide.
--        stockwerk (denormalisiert als TEXT für robuste Galerie-Gruppierung) ist NULLBAR;
--        Pflicht wird app-seitig nur bei Projekt-Fotos erzwungen (Service-Fotos dürfen leer).
--        zusätzlich optionaler FK auf den Katalog. wohnung/raum/bauabschnitt optional.
--        raum aus fester Liste (Bad, Dusche, Küche, WC, Technikraum, Steigzone) + frei
--        → app-seitige Liste, hier freies TEXT.
--        Polymorph: projekt_id XOR service_auftrag_id (dieselbe Logik wie Rapport).
CREATE TABLE IF NOT EXISTS gs_projekt_medien (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  projekt_id         UUID REFERENCES gs_projekte(id)        ON DELETE CASCADE,
  service_auftrag_id UUID REFERENCES gs_service_auftrag(id) ON DELETE CASCADE,

  -- Datei im Bucket 'projektdateien' (Bucket-Name mitgeführt für Zukunftssicherheit)
  medientyp          TEXT NOT NULL DEFAULT 'foto' CHECK (medientyp IN ('foto','video')),
  bucket             TEXT NOT NULL DEFAULT 'projektdateien',
  path               TEXT NOT NULL,                    -- vollständiger Storage-Pfad
  dateiname          TEXT,                             -- Original-/Anzeigename
  mime               TEXT,
  groesse            BIGINT,                           -- Bytes
  dauer_sekunden     INT,                              -- nur Video (optional)
  thumbnail_path     TEXT,                             -- Video-Poster/Vorschau im selben Bucket (optional)

  -- ACHSE 1 — ORT
  stockwerk_id       UUID REFERENCES gs_projekt_stockwerk(id) ON DELETE SET NULL,
  stockwerk          TEXT,                             -- denormalisiert (Gruppierung); NULLBAR:
                                                       -- Pflicht wird APP-SEITIG nur bei Projekt-Fotos
                                                       -- erzwungen. Service-Auftrag-Fotos (z.T. per Mail
                                                       -- ohne Etage) dürfen stockwerk leer haben.
  wohnung            TEXT,                             -- optional
  raum               TEXT,                             -- optional (feste Liste + frei)

  -- ACHSE 2 — BAUABSCHNITT (Arbeitsphase, bewusst getrennt vom Ort)
  bauabschnitt       TEXT,                             -- optional

  notiz              TEXT,
  hochgeladen_von    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),

  -- Genau EINE Bindung: Projekt ODER Service-Auftrag
  CONSTRAINT gs_projekt_medien_bindung_chk CHECK (
    (projekt_id IS NOT NULL AND service_auftrag_id IS NULL)
    OR (projekt_id IS NULL AND service_auftrag_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_gs_medien_projekt   ON gs_projekt_medien(projekt_id);
CREATE INDEX IF NOT EXISTS idx_gs_medien_service   ON gs_projekt_medien(service_auftrag_id);
-- Galerie-Gruppierung nach Stockwerk (Sortierung via JOIN auf gs_projekt_stockwerk.reihenfolge):
CREATE INDEX IF NOT EXISTS idx_gs_medien_stockwerk ON gs_projekt_medien(projekt_id, stockwerk);

-- Zwei-Achsen-Intent in der DB festschreiben (Ort ≠ Arbeitsphase):
COMMENT ON COLUMN gs_projekt_medien.stockwerk    IS 'ACHSE 1 (Ort): Stockwerk — Galerie-Gruppierung. NULLBAR; Pflicht app-seitig nur bei Projekt-Fotos. Werte aus gs_projekt_stockwerk (preset+frei).';
COMMENT ON COLUMN gs_projekt_medien.bauabschnitt IS 'ACHSE 2 (Arbeitsphase): bewusst getrennt vom Ort. Optional.';
COMMENT ON COLUMN gs_projekt_medien.medientyp    IS 'foto | video. Video zusätzlich mit thumbnail_path (Vorschau) + dauer_sekunden.';
-- stockwerk: Pflicht wird APP-SEITIG bei Projekt-Fotos erzwungen (medienUpload in api/cockpit.js).
-- Service-Auftrag-Fotos dürfen ohne Stockwerk hochgeladen werden (Mail-Ingest ohne Etage).


-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ RLS — zweite Verteidigungslinie (Service-Key umgeht sie; Live = api/cockpit)║
-- ╚═════════════════════════════════════════════════════════════════════════╝
ALTER TABLE gs_service_auftrag    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gs_service_techniker  ENABLE ROW LEVEL SECURITY;
ALTER TABLE gs_projekt_stockwerk  ENABLE ROW LEVEL SECURITY;
ALTER TABLE gs_projekt_medien     ENABLE ROW LEVEL SECURITY;
ALTER TABLE gs_projekt_techniker  ENABLE ROW LEVEL SECURITY;

-- service_all-Backstop + admin_all für alle neuen Tabellen
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'gs_service_auftrag','gs_service_techniker','gs_projekt_stockwerk',
    'gs_projekt_medien','gs_projekt_techniker'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_all ON %I', t);
    EXECUTE format('CREATE POLICY service_all ON %I FOR ALL USING (auth.role() = ''service_role'')', t);
    EXECUTE format('DROP POLICY IF EXISTS admin_all ON %I', t);
    EXECUTE format($p$CREATE POLICY admin_all ON %I FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('gs_admin','master')))$p$, t);
  END LOOP;
END $$;

-- Techniker: Lese-/Schreibzugriff auf Medien/Rapport seiner zugewiesenen Projekte …
-- Kette: auth.uid() → gs_techniker.user_id → gs_techniker.id = *.techniker_id.
DROP POLICY IF EXISTS tech_medien_projekt ON gs_projekt_medien;
CREATE POLICY tech_medien_projekt ON gs_projekt_medien FOR ALL USING (
  projekt_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM gs_projekt_techniker pt
    JOIN gs_techniker gt ON gt.id = pt.techniker_id
    WHERE pt.projekt_id = gs_projekt_medien.projekt_id AND gt.user_id = auth.uid()
  )
);
-- … und seiner zugewiesenen Service-Aufträge.
DROP POLICY IF EXISTS tech_medien_service ON gs_projekt_medien;
CREATE POLICY tech_medien_service ON gs_projekt_medien FOR ALL USING (
  service_auftrag_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM gs_service_techniker st
    JOIN gs_techniker gt ON gt.id = st.techniker_id
    WHERE st.service_auftrag_id = gs_projekt_medien.service_auftrag_id AND gt.user_id = auth.uid()
  )
);
DROP POLICY IF EXISTS tech_service_auftrag ON gs_service_auftrag;
CREATE POLICY tech_service_auftrag ON gs_service_auftrag FOR SELECT USING (
  EXISTS (SELECT 1 FROM gs_service_techniker st
          JOIN gs_techniker gt ON gt.id = st.techniker_id
          WHERE st.service_auftrag_id = gs_service_auftrag.id AND gt.user_id = auth.uid())
);
DROP POLICY IF EXISTS tech_stockwerk ON gs_projekt_stockwerk;
CREATE POLICY tech_stockwerk ON gs_projekt_stockwerk FOR ALL USING (
  EXISTS (SELECT 1 FROM gs_projekt_techniker pt
          JOIN gs_techniker gt ON gt.id = pt.techniker_id
          WHERE pt.projekt_id = gs_projekt_stockwerk.projekt_id AND gt.user_id = auth.uid())
);

-- Partner: NUR Lesezugriff auf Eigenes (Projekte via partner_user_id, Service via Ersteller).
DROP POLICY IF EXISTS partner_medien_projekt ON gs_projekt_medien;
CREATE POLICY partner_medien_projekt ON gs_projekt_medien FOR SELECT USING (
  projekt_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM gs_projekte p WHERE p.id = gs_projekt_medien.projekt_id AND p.partner_user_id = auth.uid()
  )
);
DROP POLICY IF EXISTS partner_medien_service ON gs_projekt_medien;
CREATE POLICY partner_medien_service ON gs_projekt_medien FOR SELECT USING (
  service_auftrag_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM gs_service_auftrag s WHERE s.id = gs_projekt_medien.service_auftrag_id AND s.partner_user_id = auth.uid()
  )
);
DROP POLICY IF EXISTS partner_service_auftrag ON gs_service_auftrag;
CREATE POLICY partner_service_auftrag ON gs_service_auftrag FOR SELECT USING (partner_user_id = auth.uid());
DROP POLICY IF EXISTS partner_stockwerk ON gs_projekt_stockwerk;
CREATE POLICY partner_stockwerk ON gs_projekt_stockwerk FOR SELECT USING (
  EXISTS (SELECT 1 FROM gs_projekte p WHERE p.id = gs_projekt_stockwerk.projekt_id AND p.partner_user_id = auth.uid())
);

-- ═══════════════════════════════════════════════════════════════════════════
-- ENDE. Kein Seed. Storage-Bucket 'projektdateien' existiert bereits.
-- Enforcement-Logik pro Rolle: siehe DIAGNOSE.md (Abschnitt Enforcement).
-- ═══════════════════════════════════════════════════════════════════════════
