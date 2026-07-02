-- ═══════════════════════════════════════════════════════════════════════════
-- DEMO-SEED · „Geiger AG" — vollständig zeigbares Präsentations-Projekt
-- ---------------------------------------------------------------------------
-- EINMALIG im Supabase SQL-Editor ausführen (Projekt bmdmoehjwadvdlbrmpuq).
-- IDEMPOTENT & SELF-CLEANING: löscht am Anfang exakt die eigenen Demo-Zeilen
-- (gescoped auf die feste Projekt-UUID) und legt sie frisch an → beliebig oft
-- wiederholbar, ohne andere Projekte/Kunden zu berühren.
--
-- Legt an:
--   • Kunde   „Geiger AG" (Bauleitungs-Büro)
--   • Projekt „Geiger AG – Wohnüberbauung Seefeld" (Stundensatz CHF 95)
--   • 3 Häuser A/B/C mit Einheiten, Zonen und Steps in versch. Status
--       (Stellbohrungen/Einlegearbeiten … bis Fertig)
--   • 3 Blockaden (1 eskaliert, 1 in Bearbeitung, 1 gelöst/freigegeben)
--   • 6 Tagesrapporte mit erfassten Stunden + Materiallisten (47.5 h gesamt)
--   • 1 Rechnungs-ENTWURF (Status „erstellt" = Entwurf, NICHT versendet)
--   • 1 Umsatz-Monatszeile (Juli 2026) → Jarvis/Voice liest Umsätze daraus
--
-- Verwendete Tabellen (bestehendes Schema):
--   gs_kunden, gs_projekte, gs_projekt_techniker,
--   gs_gw_haus, gs_gw_einheit, gs_gw_step,
--   gs_blockaden, gs_tagesrapporte, gs_rechnungen, gs_umsatz_monat
--
-- Feste UUIDs (damit Cross-Referenzen & Re-Runs stabil sind):
--   Projekt : 6e16e100-0042-4a00-8000-000000000001
--   Kunde   : 6e16e100-0042-4a00-8000-0000000000c0
-- Techniker (bestehend, „Dimitri Grill"): 730172f2-c8a9-4cc4-90f7-98a96d283b48
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. SELF-CLEANING: nur die eigenen Demo-Zeilen entfernen ─────────────────
DELETE FROM gs_rechnungen  WHERE projekt_id = '6e16e100-0042-4a00-8000-000000000001';
DELETE FROM gs_blockaden   WHERE projekt_id = '6e16e100-0042-4a00-8000-000000000001';
DELETE FROM gs_tagesrapporte WHERE projekt_id = '6e16e100-0042-4a00-8000-000000000001';
DELETE FROM gs_projekt_techniker WHERE projekt_id = '6e16e100-0042-4a00-8000-000000000001';
DELETE FROM gs_gw_haus     WHERE projekt_id = '6e16e100-0042-4a00-8000-000000000001'; -- CASCADE → einheit → step
DELETE FROM gs_projekte    WHERE id = '6e16e100-0042-4a00-8000-000000000001';
DELETE FROM gs_kunden      WHERE id = '6e16e100-0042-4a00-8000-0000000000c0';

-- ── 1. KUNDE (Bauleitungs-Büro Geiger AG) ───────────────────────────────────
INSERT INTO gs_kunden (id, firma, kontaktperson, email, telefon, adresse, plz, ort, vertragstyp)
VALUES ('6e16e100-0042-4a00-8000-0000000000c0',
        'Geiger AG', 'Markus Geiger', 'bauleitung@geiger-ag.ch',
        '+41 44 500 42 42', 'Seefeldstrasse 120', '8008', 'Zürich', 'Rahmenvertrag');

-- ── 2. PROJEKT ──────────────────────────────────────────────────────────────
INSERT INTO gs_projekte (id, projektnummer, name, kunde_id, standort, bereich, tarif, stundensatz, status)
VALUES ('6e16e100-0042-4a00-8000-000000000001',
        'P-2026-0042', 'Geiger AG – Wohnüberbauung Seefeld',
        '6e16e100-0042-4a00-8000-0000000000c0',
        '8008 Zürich, Seefeldstrasse 120', 'Sanitär / Heizung',
        'Standard', 95.00, 'aktiv');

-- Techniker dem Projekt zuweisen (Dimitri Grill)
INSERT INTO gs_projekt_techniker (projekt_id, techniker_user_id)
VALUES ('6e16e100-0042-4a00-8000-000000000001', '730172f2-c8a9-4cc4-90f7-98a96d283b48')
ON CONFLICT DO NOTHING;

-- ── 3. HÄUSER A / B / C ─────────────────────────────────────────────────────
INSERT INTO gs_gw_haus (id, projekt_id, name, reihenfolge, notiz) VALUES
 ('6e16e100-0042-4a00-8000-0000000000aa', '6e16e100-0042-4a00-8000-000000000001', 'Haus A', 1, 'Fertiggestellt – Abnahme erfolgt'),
 ('6e16e100-0042-4a00-8000-0000000000bb', '6e16e100-0042-4a00-8000-000000000001', 'Haus B', 2, 'In Arbeit – 1 Blockade (Isolierung, Material)'),
 ('6e16e100-0042-4a00-8000-0000000000cc', '6e16e100-0042-4a00-8000-000000000001', 'Haus C', 3, 'Rohbau – Stellbohrungen laufen');

-- ── 4. EINHEITEN ────────────────────────────────────────────────────────────
INSERT INTO gs_gw_einheit (id, haus_id, name, reihenfolge) VALUES
 ('6e16e100-0042-4a00-8000-0000000a0001', '6e16e100-0042-4a00-8000-0000000000aa', 'A · EG links',   1),
 ('6e16e100-0042-4a00-8000-0000000a0002', '6e16e100-0042-4a00-8000-0000000000aa', 'A · 1. OG rechts', 2),
 ('6e16e100-0042-4a00-8000-0000000b0001', '6e16e100-0042-4a00-8000-0000000000bb', 'B · EG links',   1),
 ('6e16e100-0042-4a00-8000-0000000b0002', '6e16e100-0042-4a00-8000-0000000000bb', 'B · 1. OG rechts', 2),
 ('6e16e100-0042-4a00-8000-0000000c0001', '6e16e100-0042-4a00-8000-0000000000cc', 'C · EG links',   1);

-- ── 5. STEPS (Sanitär-Spur je Einheit; Status spiegelt Baufortschritt) ──────
-- Sanitär-Template (10 Schritte), 1:1 wie in api/gewerke.js hinterlegt.
-- Status-Logik je Einheit über (done_count, in_arbeit_nr, blockiert_nr).
WITH tpl(nr, titel, zone, foto) AS (VALUES
  (1,  'Einlegearbeiten (Leitungen in Beton vor Betonage)', 'Rohbau', true),
  (2,  'Wasserzonen + Zirkulation (Kalt-, Warmwasser, Zirkulation)', 'Rohinstallation', false),
  (3,  'Ablaufzonen (WC, Waschmaschine, Dusche, Waschtisch)', 'Rohinstallation', false),
  (4,  'Druckprobe (Wasserzonen + Ablaufzonen)', 'Dichtheit', true),
  (5,  'Isolierung', 'Ausbau', true),
  (6,  'Gießrahmen-Installation (WC, Waschtisch, Dusche, Waschmaschine)', 'Ausbau', false),
  (7,  'Gießrahmen-Anschlüsse (Wasser + Abläufe verbinden)', 'Ausbau', false),
  (8,  'Finale Druckprobe (komplette Wohnung mit Gießrahmen)', 'Dichtheit', true),
  (9,  'Finale Spülung + Abnahme (Abläufe spülen, Ventile prüfen, Wände schließen)', 'Abnahme', true),
  (10, 'Apparaten-/Fertigmontage (WC, Armaturen, Möbel, Spiegelschrank, Haltegriffe, Betätigungsplatten, Eckventile, Waschmaschinenventil)', 'Fertigmontage', true)
),
-- Fortschritts-Matrix: einheit_id → done bis inkl., optional in_arbeit / blockiert
prog(einheit_id, done, inarbeit, blockiert) AS (VALUES
  ('6e16e100-0042-4a00-8000-0000000a0001'::uuid, 10,  0,  0),  -- A EG   : fertig
  ('6e16e100-0042-4a00-8000-0000000a0002'::uuid, 10,  0,  0),  -- A 1.OG : fertig
  ('6e16e100-0042-4a00-8000-0000000b0001'::uuid,  4,  0,  5),  -- B EG   : bis 4 fertig, 5 blockiert (Isolierung)
  ('6e16e100-0042-4a00-8000-0000000b0002'::uuid,  3,  4,  0),  -- B 1.OG : bis 3 fertig, 4 in Arbeit
  ('6e16e100-0042-4a00-8000-0000000c0001'::uuid,  0,  1,  0)   -- C EG   : Step 1 (Stellbohrungen) in Arbeit
)
INSERT INTO gs_gw_step
  (einheit_id, gewerk, reihenfolge_nr, titel, zone, foto_gate, pflicht_vorgaenger_nr,
   status, prozent_fertig, blockiert_grund, started_at, completed_at)
SELECT
  p.einheit_id, 'sanitaer', t.nr, t.titel, t.zone, t.foto,
  CASE WHEN t.nr > 1 THEN t.nr - 1 ELSE NULL END,
  CASE
    WHEN t.nr <= p.done       THEN 'abgeschlossen'
    WHEN t.nr = p.inarbeit    THEN 'in_arbeit'
    WHEN t.nr = p.blockiert   THEN 'blockiert'
    ELSE 'offen'
  END,
  CASE
    WHEN t.nr <= p.done     THEN 100
    WHEN t.nr = p.inarbeit  THEN 50
    ELSE 0
  END,
  CASE WHEN t.nr = p.blockiert
       THEN 'Isoliermaterial (Rohrschalen 22/28 mm) nicht geliefert – siehe Blockade'
       ELSE NULL END,
  CASE WHEN t.nr <= p.done OR t.nr = p.inarbeit OR t.nr = p.blockiert
       THEN NOW() - ((12 - t.nr) || ' days')::interval ELSE NULL END,
  CASE WHEN t.nr <= p.done
       THEN NOW() - ((11 - t.nr) || ' days')::interval ELSE NULL END
FROM prog p CROSS JOIN tpl t;

-- Heizungs-Spur in Haus A · EG (voll abgeschlossen → zeigt Multi-Gewerk)
WITH htpl(nr, titel, zone, foto) AS (VALUES
  (1, 'Einlegearbeiten (falls Bodenleitungen vor Betonage)', 'Rohbau', true),
  (2, 'Heizungszonen Vorlauf + Rücklauf', 'Rohinstallation', false),
  (3, 'Druckprobe / Abdrücken / Pressen', 'Dichtheit', true),
  (4, 'Isolierung', 'Ausbau', true),
  (5, 'Fußbodenheizungs-Verteiler anschließen', 'Ausbau', false),
  (6, 'Trittschalldämmung verlegen', 'Ausbau', false),
  (7, 'Fußbodenheizung installieren', 'Ausbau', false),
  (8, 'Fußbodenheizung abdrücken', 'Dichtheit', true),
  (9, 'Heizungszentrale erstellen (Wärmeerzeuger, Anbindung, Inbetriebnahme)', 'Inbetriebnahme', false)
)
INSERT INTO gs_gw_step
  (einheit_id, gewerk, reihenfolge_nr, titel, zone, foto_gate, pflicht_vorgaenger_nr,
   status, prozent_fertig, started_at, completed_at)
SELECT
  '6e16e100-0042-4a00-8000-0000000a0001', 'heizung', h.nr, h.titel, h.zone, h.foto,
  CASE WHEN h.nr > 1 THEN h.nr - 1 ELSE NULL END,
  'abgeschlossen', 100,
  NOW() - ((16 - h.nr) || ' days')::interval,
  NOW() - ((15 - h.nr) || ' days')::interval
FROM htpl h;

-- ── 6. BLOCKADEN (1 eskaliert, 1 in Bearbeitung/offen, 1 gelöst/freigegeben) ─
INSERT INTO gs_blockaden
  (id, projekt_id, projekt_name, haus, einheit, zone, step_ref, beschreibung,
   reporter_name, reporter_firma, blockiert_von_rolle, urgency, status,
   owner_firma, owner_email, eskaliert, eskaliert_am, eskalation_stunden,
   resolution, freigegeben_am, created_at, updated_at, woche, jahr)
VALUES
 -- (1) ESKALIERT (Timer > 24 h abgelaufen) — Material: Isolierung Haus B blockiert
 ('6e16e100-0042-4a00-8000-000000b10001', '6e16e100-0042-4a00-8000-000000000001',
  'Geiger AG – Wohnüberbauung Seefeld', 'Haus B', 'B · EG links', 'Ausbau',
  'Sanitär #5 · Isolierung',
  'Isoliermaterial (Rohrschalen 22/28 mm) nicht geliefert. Wasser- und Ablaufzonen sind druckgeprüft und bereit, die Isolierung kann ohne Material nicht starten – Folge-Schritte (Gießrahmen) stehen still.',
  'Dimitri Grill', 'George Solutions', 'material', 'HIGH', 'eskaliert',
  'Geiger AG (Bauleitung)', 'bauleitung@geiger-ag.ch',
  TRUE, NOW() - INTERVAL '6 hours', 24,
  NULL, NULL, NOW() - INTERVAL '2 days', NOW() - INTERVAL '6 hours', 27, 2026),

 -- (2) OFFEN / in Bearbeitung — Extern: Baustellenzugang Haus C
 ('6e16e100-0042-4a00-8000-000000b10002', '6e16e100-0042-4a00-8000-000000000001',
  'Geiger AG – Wohnüberbauung Seefeld', 'Haus C', 'C · EG links', 'Rohbau',
  'Sanitär #1 · Einlegearbeiten (Stellbohrungen)',
  'Baumeister hat Deckenschalung noch nicht freigegeben – Stellbohrungen für die Einlegearbeiten können erst nach Freigabe gesetzt werden. Termin mit Bauleitung angefragt.',
  'Dimitri Grill', 'George Solutions', 'extern', 'MEDIUM', 'in_bearbeitung',
  'Geiger AG (Bauleitung)', 'bauleitung@geiger-ag.ch',
  FALSE, NULL, 48,
  NULL, NULL, NOW() - INTERVAL '1 day', NOW() - INTERVAL '4 hours', 27, 2026),

 -- (3) GELÖST / freigegeben — Planung: Rückbau-Detail Haus A geklärt
 ('6e16e100-0042-4a00-8000-000000b10003', '6e16e100-0042-4a00-8000-000000000001',
  'Geiger AG – Wohnüberbauung Seefeld', 'Haus A', 'A · 1. OG rechts', 'Rohinstallation',
  'Sanitär #3 · Ablaufzonen',
  'Position Bodenablauf Dusche wich vom Plan ab (Kollision mit Trägerlage). Rückfrage an Planung gestellt.',
  'Dimitri Grill', 'George Solutions', 'planung', 'MEDIUM', 'freigegeben',
  'Geiger AG (Bauleitung)', 'bauleitung@geiger-ag.ch',
  FALSE, NULL, 24,
  'Planung hat revidiertes Detail geliefert (Ablauf 15 cm versetzt). Umgesetzt und druckgeprüft – freigegeben.',
  NOW() - INTERVAL '9 days', NOW() - INTERVAL '11 days', NOW() - INTERVAL '9 days', 26, 2026);

-- ── 7. TAGESRAPPORTE (erfasste Stunden + Materiallisten) ────────────────────
-- 6 Rapporte, Techniker Dimitri Grill. Summe = 47.5 h → Basis der Rechnung.
INSERT INTO gs_tagesrapporte
  (projekt_id, techniker_user_id, datum, zeit_von, zeit_bis, gesamtstunden,
   arbeiten, material, besonderheiten, status, woche, jahr, eingereicht_am)
VALUES
 ('6e16e100-0042-4a00-8000-000000000001', '730172f2-c8a9-4cc4-90f7-98a96d283b48',
  '2026-06-16', '07:00', '16:00', 8.5,
  ARRAY['Haus A EG: Wasserzonen Kalt-/Warmwasser + Zirkulation verlegt', 'Ablaufzonen WC + Dusche gesetzt'],
  ARRAY['Geberit Mepla 20 mm – 60 m', 'PE-Ablaufrohr DN50 – 24 m', 'Pressfittings Sortiment – 1 Satz'],
  'Rohinstallation Haus A planmäßig.', 'eingereicht', 25, 2026, '2026-06-16T16:30:00+00:00'),

 ('6e16e100-0042-4a00-8000-000000000001', '730172f2-c8a9-4cc4-90f7-98a96d283b48',
  '2026-06-18', '07:00', '16:30', 9.0,
  ARRAY['Haus A EG: Druckprobe Wasser-/Ablaufzonen bestanden (10 bar / 15 min)', 'Isolierung Kalt-/Warmwasser'],
  ARRAY['Rohrschalen 22 mm – 40 m', 'Rohrschalen 28 mm – 25 m', 'Armaflex-Klebeband – 4 Rollen'],
  'Druckprobe protokolliert, Foto abgelegt.', 'eingereicht', 25, 2026, '2026-06-18T17:00:00+00:00'),

 ('6e16e100-0042-4a00-8000-000000000001', '730172f2-c8a9-4cc4-90f7-98a96d283b48',
  '2026-06-23', '07:30', '16:00', 8.0,
  ARRAY['Haus B EG: Einlegearbeiten Leitungen vor Betonage', 'Stellbohrungen gesetzt'],
  ARRAY['Leerrohr M25 – 30 m', 'Befestigungsschellen – 50 Stk', 'Brandschutzmanschetten DN50 – 8 Stk'],
  'Betonage Haus B für KW26 angekündigt.', 'eingereicht', 26, 2026, '2026-06-23T16:15:00+00:00'),

 ('6e16e100-0042-4a00-8000-000000000001', '730172f2-c8a9-4cc4-90f7-98a96d283b48',
  '2026-06-25', '07:00', '15:30', 7.5,
  ARRAY['Haus B EG: Wasserzonen + Ablaufzonen', 'Druckprobe vorbereitet'],
  ARRAY['Geberit Mepla 20 mm – 45 m', 'PE-Ablaufrohr DN50 – 18 m'],
  NULL, 'eingereicht', 26, 2026, '2026-06-25T15:45:00+00:00'),

 ('6e16e100-0042-4a00-8000-000000000001', '730172f2-c8a9-4cc4-90f7-98a96d283b48',
  '2026-07-01', '07:00', '16:00', 8.5,
  ARRAY['Haus B EG: Druckprobe bestanden', 'Isolierung vorbereitet – GESTOPPT: Rohrschalen fehlen (Blockade)'],
  ARRAY['(Isoliermaterial ausstehend – siehe Blockade)'],
  'Isolierung blockiert – Material nicht geliefert. Blockade an Bauleitung gemeldet.', 'eingereicht', 27, 2026, '2026-07-01T16:20:00+00:00'),

 ('6e16e100-0042-4a00-8000-000000000001', '730172f2-c8a9-4cc4-90f7-98a96d283b48',
  '2026-07-02', '08:00', '14:30', 6.0,
  ARRAY['Haus C EG: Stellbohrungen begonnen', 'Aufmaß Einlegearbeiten'],
  ARRAY['Bohrkronen 32/52 mm – Verschleiß', 'Leerrohr M25 – 15 m'],
  'Deckenschalung teils noch nicht freigegeben – Blockade offen.', 'eingereicht', 27, 2026, '2026-07-02T14:45:00+00:00');

-- ── 8. RECHNUNGS-ENTWURF (Status „erstellt" = Entwurf; NICHT versendet) ─────
-- Betrag = erfasste Stunden × Stundensatz = 47.5 h × CHF 95.00 = CHF 4'512.50 (netto).
-- MwSt (8.1%) wird auf der PDF-Rechnung (scripts/demo_geiger_rechnung.html) ausgewiesen.
INSERT INTO gs_rechnungen
  (id, projekt_id, rechnungsnummer, stunden, stundensatz, betrag, empfaenger, status)
VALUES
 ('6e16e100-0042-4a00-8000-00000000f001', '6e16e100-0042-4a00-8000-000000000001',
  'R-2026-0042', 47.5, 95.00, 4512.50,
  ARRAY['bauleitung@geiger-ag.ch'], 'erstellt');

-- ── 9. UMSATZ-MONAT (Juli 2026) → Jarvis/Voice liest Umsätze aus dieser Tabelle
-- Demo-Wert = Rechnungsbetrag netto. ON CONFLICT → korrigierbar / entfernbar.
INSERT INTO gs_umsatz_monat (jahr, monat, umsatz_chf, anzahl_projekte, notiz)
VALUES (2026, 7, 4512.50, 1, 'Demo: Geiger AG Etappe 1 (Rechnung R-2026-0042)')
ON CONFLICT (jahr, monat) DO UPDATE
  SET umsatz_chf = EXCLUDED.umsatz_chf,
      anzahl_projekte = EXCLUDED.anzahl_projekte,
      notiz = EXCLUDED.notiz;

COMMIT;

-- ── KONTROLLE (optional, nach dem Run markieren + ausführen) ────────────────
-- SELECT name, projektnummer, status, stundensatz FROM gs_projekte WHERE id='6e16e100-0042-4a00-8000-000000000001';
-- SELECT status, count(*) FROM gs_gw_step s JOIN gs_gw_einheit e ON e.id=s.einheit_id
--   JOIN gs_gw_haus h ON h.id=e.haus_id WHERE h.projekt_id='6e16e100-0042-4a00-8000-000000000001' GROUP BY status;
-- SELECT haus, status, urgency, eskaliert FROM gs_blockaden WHERE projekt_id='6e16e100-0042-4a00-8000-000000000001' ORDER BY created_at;
-- SELECT sum(gesamtstunden) AS stunden FROM gs_tagesrapporte WHERE projekt_id='6e16e100-0042-4a00-8000-000000000001';
-- SELECT rechnungsnummer, stunden, stundensatz, betrag, status FROM gs_rechnungen WHERE projekt_id='6e16e100-0042-4a00-8000-000000000001';
