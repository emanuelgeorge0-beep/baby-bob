-- ═══════════════════════════════════════════════════════════════════════════
-- DEMO-SEED · Projekt „Geiger AG" + offene Blockaden
-- ---------------------------------------------------------------------------
-- Zweck: Damit der Sprachbefehl „Bob, zeig Blockaden von Geiger" im Kunden-
-- gespräch GARANTIERT echte Treffer zeigt (Projekt + mehrere offene Blockaden,
-- verschiedene Dringlichkeiten/Rollen für eine überzeugende Ansicht).
--
-- EINMALIG im Supabase SQL-Editor ausführen (Projekt bmdmoehjwadvdlbrmpuq).
-- Idempotent: gefahrlos mehrfach ausführbar (fester projektnummer-Key +
-- ON CONFLICT; Blockaden werden pro Titel nur einmal angelegt).
-- Setzt gs_projekte (rapport_system_migration.sql) und gs_blockaden
-- (blockaden_migration.sql) als bereits migriert voraus.
--
-- Rückgängig (Demo entfernen):
--   DELETE FROM gs_projekte WHERE projektnummer = 'DEMO-GEIGER';
--   (Blockaden hängen per ON DELETE CASCADE dran und verschwinden mit.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Projekt anlegen/aktualisieren (fester Schlüssel projektnummer) ───────
INSERT INTO gs_projekte (projektnummer, name, standort, bereich, status)
VALUES ('DEMO-GEIGER', 'Geiger AG', 'Wädenswil ZH', 'Sanierung', 'aktiv')
ON CONFLICT (projektnummer) DO UPDATE
  SET name = EXCLUDED.name,
      standort = EXCLUDED.standort,
      bereich = EXCLUDED.bereich,
      status = 'aktiv';

-- ── 2. Offene Blockaden für dieses Projekt (idempotent je beschreibung) ─────
-- projekt_id + projekt_name werden beide gesetzt: der Voice-Router findet die
-- Blockaden über die FK-Kopplung UND über den denormalisierten Namen.
WITH p AS (
  SELECT id, name FROM gs_projekte WHERE projektnummer = 'DEMO-GEIGER' LIMIT 1
), seed(beschreibung, haus, einheit, step_ref, blockiert_von_rolle, urgency, status, alter_stunden) AS (
  VALUES
    ('Steigzone gesperrt – Gerüst der Fremdfirma blockiert den Zugang zu Haus B.',
       'Haus B', '3. OG', 'S-04 Montage', 'extern', 'CRITICAL', 'eskaliert', 40),
    ('Lieferung Wärmepumpe verzögert – Material fehlt für den Anschluss.',
       'Haus A', 'Technikraum', 'S-07 Anschluss', 'material', 'HIGH', 'in_bearbeitung', 26),
    ('Planungsfreigabe für die Leitungsführung im 2. OG steht noch aus.',
       'Haus A', '2. OG', 'S-02 Planung', 'planung', 'MEDIUM', 'offen', 10),
    ('Gebäudetechnik: Elektroanschluss noch nicht gesetzt, Inbetriebnahme wartet.',
       'Haus B', 'UG', 'S-09 Inbetriebnahme', 'gebaeudetechnik', 'MEDIUM', 'offen', 4)
)
INSERT INTO gs_blockaden
  (projekt_id, projekt_name, haus, einheit, step_ref,
   beschreibung, blockiert_von_rolle, urgency, status,
   reporter_name, reporter_firma, owner_firma, eskalation_stunden,
   created_at, updated_at, woche, jahr,
   eskaliert, eskaliert_am)
SELECT
  p.id, p.name, s.haus, s.einheit, s.step_ref,
  s.beschreibung, s.blockiert_von_rolle, s.urgency, s.status,
  'Demo Techniker', 'Geiger AG', 'George Solutions', 24,
  NOW() - (s.alter_stunden || ' hours')::interval,
  NOW() - (s.alter_stunden || ' hours')::interval,
  EXTRACT(WEEK FROM NOW())::int, EXTRACT(YEAR FROM NOW())::int,
  (s.status = 'eskaliert'),
  CASE WHEN s.status = 'eskaliert' THEN NOW() - INTERVAL '2 hours' ELSE NULL END
FROM p CROSS JOIN seed s
WHERE NOT EXISTS (
  SELECT 1 FROM gs_blockaden b
  WHERE b.projekt_id = p.id AND b.beschreibung = s.beschreibung
);

-- ── 3. Kontrolle: was steht jetzt drin? ─────────────────────────────────────
SELECT p.name AS projekt, b.status, b.urgency, b.blockiert_von_rolle, b.beschreibung
FROM gs_blockaden b
JOIN gs_projekte p ON p.id = b.projekt_id
WHERE p.projektnummer = 'DEMO-GEIGER'
ORDER BY b.created_at DESC;
