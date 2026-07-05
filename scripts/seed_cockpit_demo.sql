-- ═══════════════════════════════════════════════════════════════════════════
-- DEMO-SEED · „Cockpit bewohnt" — Projektmanagement-Herzstück gefüllt
-- ---------------------------------------------------------------------------
-- EINMALIG (oder beliebig oft) im Supabase SQL-Editor ausführen.
-- Macht das Cockpit-PM „bewohnt": 3 Projekte MIT Technikern, erfassten Arbeiten
-- und Material — plus GENAU 4 Blockaden (1 kritisch/rot, 1 in Arbeit,
-- 1 freigegeben, 1 offen).
--
-- IDEMPOTENT & KOMPONIEREND (kein Umbau):
--   • Fasst NUR die eigenen Demo-Zeilen an (feste UUIDs / Demo-Projektnummern).
--   • Reichert das bestehende Geiger-Projekt additiv an (gleiche feste UUID wie
--     demo_geiger_seed.sql) → Häuser/Steps/Rapporte/Rechnung/UMSATZ bleiben
--     unberührt. Die Umsatz-Query wird NICHT angefasst.
--   • Techniker werden per Name wiederverwendet (nur angelegt, falls sie fehlen).
--   • Vor jedem Insert werden die eigenen PM-/Blockaden-Zeilen der 3 Demo-
--     Projekte gelöscht → beliebig wiederholbar, keine Duplikate.
--
-- Liest das Cockpit daraus (api/cockpit.js, pm_*):
--   gs_projekte · gs_kunden · gs_projekt_techniker(→gs_techniker) ·
--   gs_taetigkeiten · gs_material · gs_blockaden
--
-- Voraussetzung: rapport_system_migration.sql, blockaden_migration.sql und
-- master_cockpit_session6_pm.sql wurden ausgeführt (PM-Tabellen existieren).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  -- Kunden (feste IDs → idempotenter Upsert)
  k_geiger  UUID := '6e16e100-0042-4a00-8000-0000000000c0';  -- identisch zu demo_geiger_seed.sql
  k_steiner UUID := '6e16e100-0042-4a00-8000-0000000000c2';
  k_winti   UUID := '6e16e100-0042-4a00-8000-0000000000c3';

  -- Projekte (werden per projektnummer geupserted; IDs danach gelesen)
  p1 UUID;   -- Geiger AG (Flagship, bestehend)
  p2 UUID;   -- Steiner Immobilien
  p3 UUID;   -- Stadt Winterthur (Facility)

  -- Techniker (per Name wiederverwenden, sonst anlegen)
  t_dimitri UUID; t_patrick UUID; t_vasil UUID; t_yasemin UUID;

  v_week INT := EXTRACT(WEEK FROM NOW())::int;
  v_year INT := EXTRACT(YEAR FROM NOW())::int;
BEGIN
  -- ── 1. KUNDEN ─────────────────────────────────────────────────────────────
  INSERT INTO gs_kunden (id, firma, kontaktperson, email, telefon, adresse, plz, ort, vertragstyp) VALUES
    (k_geiger,  'Geiger AG',              'Markus Geiger',  'bauleitung@geiger-ag.ch', '+41 44 500 42 42', 'Seefeldstrasse 120', '8008', 'Zürich',     'Rahmenvertrag'),
    (k_steiner, 'Steiner Immobilien AG',  'Andrea Steiner', 'technik@steiner-immo.ch',  '+41 44 860 12 12', 'Bahnhofstrasse 7',   '8180', 'Bülach',     'Einzelauftrag'),
    (k_winti,   'Stadt Winterthur – Immobilien', 'Reto Bühler', 'facility@win.ch',      '+41 52 267 00 00', 'Pionierstrasse 7',   '8403', 'Winterthur', 'Servicevertrag')
  ON CONFLICT (id) DO UPDATE SET
    firma=EXCLUDED.firma, kontaktperson=EXCLUDED.kontaktperson, email=EXCLUDED.email,
    telefon=EXCLUDED.telefon, adresse=EXCLUDED.adresse, plz=EXCLUDED.plz,
    ort=EXCLUDED.ort, vertragstyp=EXCLUDED.vertragstyp;

  -- ── 2. PROJEKTE (Upsert per projektnummer, IDs einlesen) ──────────────────
  INSERT INTO gs_projekte (projektnummer, name, kunde_id, standort, bereich, tarif, stundensatz, status)
    VALUES ('P-2026-0042', 'Geiger AG – Wohnüberbauung Seefeld', k_geiger,
            '8008 Zürich, Seefeldstrasse 120', 'Sanitär / Heizung', 'Standard', 95.00, 'aktiv')
    ON CONFLICT (projektnummer) DO UPDATE SET
      name=EXCLUDED.name, kunde_id=EXCLUDED.kunde_id, standort=EXCLUDED.standort,
      bereich=EXCLUDED.bereich, tarif=EXCLUDED.tarif, stundensatz=EXCLUDED.stundensatz, status=EXCLUDED.status
    RETURNING id INTO p1;

  INSERT INTO gs_projekte (projektnummer, name, kunde_id, standort, bereich, tarif, stundensatz, status)
    VALUES ('DEMO-COCKPIT-2', 'Steiner Immobilien – Sanierung MFH Bülachhof', k_steiner,
            '8180 Bülach, Bülachhof 4', 'Heizung', 'Standard', 92.00, 'aktiv')
    ON CONFLICT (projektnummer) DO UPDATE SET
      name=EXCLUDED.name, kunde_id=EXCLUDED.kunde_id, standort=EXCLUDED.standort,
      bereich=EXCLUDED.bereich, tarif=EXCLUDED.tarif, stundensatz=EXCLUDED.stundensatz, status=EXCLUDED.status
    RETURNING id INTO p2;

  INSERT INTO gs_projekte (projektnummer, name, kunde_id, standort, bereich, tarif, stundensatz, status)
    VALUES ('DEMO-COCKPIT-3', 'Stadt Winterthur – Unterhalt Schulhaus Altstadt', k_winti,
            '8400 Winterthur, Schulhaus Altstadt', 'Facility / Sanitär-Service', 'Service', 88.00, 'aktiv')
    ON CONFLICT (projektnummer) DO UPDATE SET
      name=EXCLUDED.name, kunde_id=EXCLUDED.kunde_id, standort=EXCLUDED.standort,
      bereich=EXCLUDED.bereich, tarif=EXCLUDED.tarif, stundensatz=EXCLUDED.stundensatz, status=EXCLUDED.status
    RETURNING id INTO p3;

  -- ── 3. TECHNIKER: per Name wiederverwenden, sonst minimal anlegen ─────────
  --      (nur name/qualifikation/verfuegbar — deckungsgleich mit session6-Seed)
  SELECT id INTO t_dimitri FROM gs_techniker WHERE name ILIKE '%Dimitri%' LIMIT 1;
  IF t_dimitri IS NULL THEN
    INSERT INTO gs_techniker (name, qualifikation, verfuegbar)
    VALUES ('Dimitri Grill', 'Sanitär-Monteur', TRUE) RETURNING id INTO t_dimitri;
  END IF;

  SELECT id INTO t_patrick FROM gs_techniker WHERE name ILIKE '%Patrick%' LIMIT 1;
  IF t_patrick IS NULL THEN
    INSERT INTO gs_techniker (name, qualifikation, verfuegbar)
    VALUES ('Patrick Meier', 'Sanitär-Servicetechniker', TRUE) RETURNING id INTO t_patrick;
  END IF;

  SELECT id INTO t_vasil FROM gs_techniker WHERE name ILIKE '%Vasil%' LIMIT 1;
  IF t_vasil IS NULL THEN
    INSERT INTO gs_techniker (name, qualifikation, verfuegbar)
    VALUES ('Vasil Petrov', 'Heizungsmonteur', TRUE) RETURNING id INTO t_vasil;
  END IF;

  SELECT id INTO t_yasemin FROM gs_techniker WHERE name ILIKE '%Yasemin%' LIMIT 1;
  IF t_yasemin IS NULL THEN
    INSERT INTO gs_techniker (name, qualifikation, verfuegbar)
    VALUES ('Yasemin Kaya', 'Facility- & Servicetechnikerin', TRUE) RETURNING id INTO t_yasemin;
  END IF;

  -- ── 4. SELF-CLEANING: eigene PM-/Blockaden-Zeilen der 3 Projekte entfernen ─
  DELETE FROM gs_projekt_techniker WHERE projekt_id IN (p1, p2, p3);
  DELETE FROM gs_taetigkeiten      WHERE projekt_id IN (p1, p2, p3);
  DELETE FROM gs_material          WHERE projekt_id IN (p1, p2, p3);
  DELETE FROM gs_blockaden         WHERE projekt_id IN (p1, p2, p3);
  -- Alte Demo-Blockaden aus früheren Seeds wegräumen, damit die Demo GENAU 4 zeigt.
  DELETE FROM gs_blockaden WHERE projekt_id IN
    (SELECT id FROM gs_projekte WHERE projektnummer = 'DEMO-GEIGER');

  -- ── 5. TECHNIKER-ZUWEISUNGEN (wer arbeitet wo, an was) ────────────────────
  INSERT INTO gs_projekt_techniker (projekt_id, techniker_id, taetigkeit) VALUES
    (p1, t_dimitri, 'Sanitär-Rohinstallation & Druckproben'),
    (p1, t_patrick, 'Isolierung & Servicearbeiten'),
    (p2, t_vasil,   'Heizungsmontage & Inbetriebnahme'),
    (p3, t_yasemin, 'Facility-Unterhalt & Sanitär-Service');

  -- ── 6. ERFASSTE ARBEITEN (Tätigkeiten) ────────────────────────────────────
  INSERT INTO gs_taetigkeiten (projekt_id, beschreibung, techniker_name, datum, stunden) VALUES
    (p1, 'Haus A: Wasserzonen Kalt-/Warmwasser + Zirkulation verlegt', 'Dimitri Grill', CURRENT_DATE - 19, 8.5),
    (p1, 'Haus A: Druckprobe Wasser-/Ablaufzonen bestanden (10 bar / 15 min)', 'Dimitri Grill', CURRENT_DATE - 17, 9.0),
    (p1, 'Haus B: Einlegearbeiten vor Betonage, Stellbohrungen gesetzt', 'Patrick Meier', CURRENT_DATE - 12, 8.0),
    (p2, 'Technikraum: Wärmepumpe positioniert, Vor-/Rücklauf grob verlegt', 'Vasil Petrov', CURRENT_DATE - 6, 7.5),
    (p2, 'Verteiler UG angeschlossen, Heizkreise beschriftet', 'Vasil Petrov', CURRENT_DATE - 3, 6.5),
    (p3, 'Schulhaus: Steigzonen-Kontrolle, 2 Absperrventile ersetzt', 'Yasemin Kaya', CURRENT_DATE - 2, 4.0),
    (p3, 'WC-Anlage EG: Spülkasten-Service, Dichtungen erneuert', 'Yasemin Kaya', CURRENT_DATE - 1, 3.5);

  -- ── 7. MATERIAL ───────────────────────────────────────────────────────────
  INSERT INTO gs_material (projekt_id, bezeichnung, menge, einheit, kategorie, status) VALUES
    (p1, 'Geberit Mepla 20 mm',                 60, 'm',   'Sanitär', 'verbaut'),
    (p1, 'PE-Ablaufrohr DN50',                  24, 'm',   'Sanitär', 'verbaut'),
    (p1, 'Rohrschalen 22/28 mm (Isolierung)',   65, 'm',   'Sanitär', 'offen'),
    (p2, 'Wärmepumpe Sole/Wasser 12 kW',         1, 'Stk', 'Heizung', 'bestellt'),
    (p2, 'Verteiler Fussbodenheizung 8-fach',    2, 'Stk', 'Heizung', 'geliefert'),
    (p3, 'Absperrventil DN25',                   4, 'Stk', 'Sanitär', 'verbaut'),
    (p3, 'Spülkasten-Dichtungsset',              6, 'Stk', 'Sanitär', 'verbaut');

  -- ── 8. BLOCKADEN — GENAU 4 (1 kritisch/rot, 1 in Arbeit, 1 freigegeben, 1 offen)
  INSERT INTO gs_blockaden
    (projekt_id, projekt_name, haus, einheit, zone, step_ref, beschreibung,
     reporter_name, reporter_firma, blockiert_von_rolle, urgency, status,
     owner_firma, owner_email, eskaliert, eskaliert_am, eskalation_stunden,
     resolution, freigegeben_am, created_at, updated_at, woche, jahr)
  VALUES
   -- (1) KRITISCH / ROT — eskaliert, Material blockiert Isolierung Haus B
   (p1, 'Geiger AG – Wohnüberbauung Seefeld', 'Haus B', 'B · EG links', 'Ausbau',
    'Sanitär #5 · Isolierung',
    'Isoliermaterial (Rohrschalen 22/28 mm) nicht geliefert. Wasser- und Ablaufzonen sind druckgeprüft und bereit – die Isolierung kann ohne Material nicht starten, Folge-Schritte (Gießrahmen) stehen still.',
    'Dimitri Grill', 'George Solutions', 'material', 'CRITICAL', 'eskaliert',
    'Geiger AG (Bauleitung)', 'bauleitung@geiger-ag.ch',
    TRUE, NOW() - INTERVAL '6 hours', 24,
    NULL, NULL, NOW() - INTERVAL '2 days', NOW() - INTERVAL '6 hours', v_week, v_year),

   -- (2) IN ARBEIT — Wärmepumpen-Lieferung verzögert (Steiner)
   (p2, 'Steiner Immobilien – Sanierung MFH Bülachhof', 'Haus A', 'Technikraum', 'Inbetriebnahme',
    'Heizung · Anschluss Wärmeerzeuger',
    'Wärmepumpe (Sole/Wasser 12 kW) – Liefertermin um zwei Wochen verschoben. Anschluss und Inbetriebnahme verzögern sich; Ersatztermin beim Lieferanten angefragt.',
    'Vasil Petrov', 'George Solutions', 'material', 'HIGH', 'in_bearbeitung',
    'Steiner Immobilien AG', 'technik@steiner-immo.ch',
    FALSE, NULL, 48,
    NULL, NULL, NOW() - INTERVAL '1 day', NOW() - INTERVAL '3 hours', v_week, v_year),

   -- (3) FREIGEGEBEN — Plankollision Bodenablauf Dusche geklärt (Geiger)
   (p1, 'Geiger AG – Wohnüberbauung Seefeld', 'Haus A', 'A · 1. OG rechts', 'Rohinstallation',
    'Sanitär #3 · Ablaufzonen',
    'Position Bodenablauf Dusche wich vom Plan ab (Kollision mit Trägerlage). Rückfrage an Planung gestellt.',
    'Dimitri Grill', 'George Solutions', 'planung', 'MEDIUM', 'freigegeben',
    'Geiger AG (Bauleitung)', 'bauleitung@geiger-ag.ch',
    FALSE, NULL, 24,
    'Planung hat revidiertes Detail geliefert (Ablauf 15 cm versetzt). Umgesetzt und druckgeprüft – freigegeben.',
    NOW() - INTERVAL '9 days', NOW() - INTERVAL '11 days', NOW() - INTERVAL '9 days', v_week - 1, v_year),

   -- (4) OFFEN — Zugang Steigzone nur über Hauswart (Winterthur)
   (p3, 'Stadt Winterthur – Unterhalt Schulhaus Altstadt', 'Trakt B', 'UG', 'Rohbau',
    'Service · Steigzonen-Unterhalt',
    'Hauptwasser-Absperrung nur über den Hauswart zugänglich – Termin für die Steigzonen-Arbeiten ist noch offen. Anfrage an die Liegenschaftsverwaltung läuft.',
    'Yasemin Kaya', 'George Solutions', 'extern', 'HIGH', 'offen',
    'Stadt Winterthur – Immobilien', 'facility@win.ch',
    FALSE, NULL, 48,
    NULL, NULL, NOW() - INTERVAL '10 hours', NOW() - INTERVAL '10 hours', v_week, v_year);
END $$;

COMMIT;

-- ── KONTROLLE (optional markieren + ausführen) ──────────────────────────────
-- SELECT projektnummer, name, status FROM gs_projekte
--   WHERE projektnummer IN ('P-2026-0042','DEMO-COCKPIT-2','DEMO-COCKPIT-3') ORDER BY projektnummer;
-- SELECT p.projektnummer, t.name, pt.taetigkeit
--   FROM gs_projekt_techniker pt JOIN gs_projekte p ON p.id=pt.projekt_id
--   JOIN gs_techniker t ON t.id=pt.techniker_id
--   WHERE p.projektnummer IN ('P-2026-0042','DEMO-COCKPIT-2','DEMO-COCKPIT-3') ORDER BY p.projektnummer;
-- SELECT status, urgency, count(*) FROM gs_blockaden
--   WHERE projekt_id IN (SELECT id FROM gs_projekte
--     WHERE projektnummer IN ('P-2026-0042','DEMO-COCKPIT-2','DEMO-COCKPIT-3'))
--   GROUP BY status, urgency ORDER BY status;
