-- ═══════════════════════════════════════════════════════════════════════════
-- FIX KW 34 — Technikerzuweisung heilen + Partnersichtbarkeit herstellen
-- ═══════════════════════════════════════════════════════════════════════════
-- Grundlage: Diagnosebericht vom 21.08.2026.
--
-- Befund (alle UUIDs am 21.08.2026 per read-only GET gegen die Live-DB
-- verifiziert, nichts geraten):
--
--   1) Es gibt ZWEI gs_techniker-Zeilen namens "Emanuel George":
--        03c67b2c-e670-46e2-add4-3910ea9d55fe  emanuelgeorge0@gmail.com
--            → user_id ee46a716-7017-4045-9f67-fe06d05171e7  (das Login,
--              mit dem Emanuel arbeitet: gs_admin + Extra-Rolle techniker)
--        ed1874fe-d167-4ea5-8129-6f70a6abe76a  emanuel.george@georgesolutions.ch
--            → user_id 13ad53b5-38c6-44e0-8f0e-48ae04198951  (anderes Konto)
--      Die Zuweisung vom 21.08. ging an ed1874fe → im Techniker-Cockpit
--      unsichtbar, weil api/cockpit.js:157 aus ee46a716 die id 03c67b2c auflöst.
--
--   2) Drei der vier KW-34-Projekte haben ÜBERHAUPT KEINE Zuweisung.
--
--   3) Alle vier Projekte haben partner_user_id = NULL → für Nievergelt
--      unsichtbar (api/cockpit.js:1808 filtert genau darauf).
--
-- Entscheidung des Betreibers: die Projekte gehören dem Partner. Emanuel
-- leistet Kapazitätsunterstützung; Schreibrechte für Nievergelt sind gewollt.
--
-- ───────────────────────────────────────────────────────────────────────────
-- AUSFÜHRUNG — bitte BLOCKWEISE, nicht die ganze Datei auf einmal:
--   Der Supabase-SQL-Editor zeigt nur das Ergebnis der LETZTEN Anweisung.
--   Also je Block: erst den Vorher-SELECT markieren und "Run selection",
--   Ergebnis prüfen, dann die auskommentierten Schreibzeilen des Blocks
--   markieren, Kommentarzeichen entfernen und ausführen.
--
--   Die Vorher-SELECTs sind aktiv (rein lesend, ungefährlich).
--   Alle schreibenden Anweisungen sind auskommentiert.
--
-- Diese Datei enthält KEIN CREATE TABLE, KEIN DROP, KEIN ALTER, KEINE
-- REFERENCES — ausschliesslich UPDATE / INSERT / SELECT auf bestehende
-- Tabellen und Spalten.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOCK 1 — Technikerzuweisung
-- ═══════════════════════════════════════════════════════════════════════════
-- Ziel: alle vier KW-34-Projekte hängen an gs_techniker 03c67b2c (Emanuels
-- Arbeits-Login) UND tragen zusätzlich techniker_user_id = ee46a716, damit
-- beide Spalten übereinstimmen.
--
-- Warum beide Spalten: gs_projekt_techniker hat zwei konkurrierende
-- Techniker-Spalten. api/cockpit.js liest techniker_id, aber api/projekte.js,
-- api/gewerke.js und api/projectflow.js lesen techniker_user_id. Nur mit
-- beiden ist die Zuweisung überall sichtbar. (Ab dieser Runde schreibt
-- assignTech in api/cockpit.js beide Spalten selbst — dieses SQL heilt den
-- Altbestand der vier Zeilen.)
--
-- Idempotenz: Der UPDATE adressiert die Zeile per Primärschlüssel und setzt
-- immer dieselben Werte. Der INSERT stützt sich auf den vorhandenen
-- partiellen Unique-Index
--   uq_pt_projekt_user (projekt_id, techniker_user_id) WHERE techniker_user_id IS NOT NULL
-- (scripts/master_cockpit_session6_pm.sql:77-79). Deshalb wird die
-- Index-Bedingung in der ON-CONFLICT-Klausel mitgegeben — ohne sie kann
-- Postgres den partiellen Index nicht ableiten.
-- ACHTUNG: Die Idempotenz des INSERT hängt daran, dass techniker_user_id
-- mitgeschrieben wird. Auf (projekt_id, techniker_id) allein gibt es KEINEN
-- Unique-Index.

-- ── Vorher-SELECT Block 1 ──────────────────────────────────────────────────
SELECT p.projektnummer,
       p.name                        AS projekt,
       pt.id                         AS zuweisung_id,
       pt.techniker_id,
       t.name                        AS techniker_name,
       t.email                       AS techniker_email,
       pt.techniker_user_id,
       pt.taetigkeit,
       pt.stundensatz
FROM gs_projekte p
LEFT JOIN gs_projekt_techniker pt ON pt.projekt_id = p.id
LEFT JOIN gs_techniker t          ON t.id = pt.techniker_id
WHERE p.id IN (
  'b6651bc5-ec35-497f-84bd-bad77eaa5373',  -- 60133.00 Stofer Manuel
  'b8a21470-c0de-4c0a-ba51-147054f0a0e9',  -- 60586.00 Taeger Architektur
  'ce5e0f0a-18ca-499a-acfc-c69c8a7b9ed2',  -- 60060.00 Arzt Praxis
  '70d185aa-fc82-4961-96d6-d3cf3ea301fc'   -- 60829.00 Fertigmontage
)
ORDER BY p.projektnummer;

-- Erwartet VOR dem Fix: genau eine Zeile mit einer Zuweisung
--   (60133.00 Stofer Manuel → techniker_id ed1874fe…, techniker_user_id NULL),
--   die drei anderen Projekte mit NULL in allen pt-Spalten.

-- ── Schreibend Block 1 (auskommentiert) ────────────────────────────────────

-- -- 1a) Bestehende Zeile umhängen: ed1874fe → 03c67b2c, user_id nachtragen.
-- UPDATE gs_projekt_techniker
--    SET techniker_id      = '03c67b2c-e670-46e2-add4-3910ea9d55fe',
--        techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
--  WHERE id = '2f464873-719d-4f4f-bae4-601839599c98';
--
-- -- 1b) Die drei fehlenden Zuweisungen ergänzen.
-- INSERT INTO gs_projekt_techniker (projekt_id, techniker_id, techniker_user_id)
-- VALUES
--   ('b8a21470-c0de-4c0a-ba51-147054f0a0e9',
--    '03c67b2c-e670-46e2-add4-3910ea9d55fe',
--    'ee46a716-7017-4045-9f67-fe06d05171e7'),
--   ('ce5e0f0a-18ca-499a-acfc-c69c8a7b9ed2',
--    '03c67b2c-e670-46e2-add4-3910ea9d55fe',
--    'ee46a716-7017-4045-9f67-fe06d05171e7'),
--   ('70d185aa-fc82-4961-96d6-d3cf3ea301fc',
--    '03c67b2c-e670-46e2-add4-3910ea9d55fe',
--    'ee46a716-7017-4045-9f67-fe06d05171e7')
-- ON CONFLICT (projekt_id, techniker_user_id)
--   WHERE techniker_user_id IS NOT NULL
--   DO NOTHING;

-- -- 1c) OPTIONAL, nur falls gewünscht: Stundentarif der drei neuen Zeilen auf
-- --     70 CHF/h setzen (die bestehende Zeile für Stofer Manuel trägt 70).
-- --     Ohne diesen Schritt bleibt stundensatz NULL und es gilt der
-- --     Projekttarif. Bewusst getrennt — das ist eine kaufmännische
-- --     Entscheidung, keine Reparatur.
-- UPDATE gs_projekt_techniker
--    SET stundensatz = 70
--  WHERE techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
--    AND stundensatz IS NULL
--    AND projekt_id IN (
--      'b8a21470-c0de-4c0a-ba51-147054f0a0e9',
--      'ce5e0f0a-18ca-499a-acfc-c69c8a7b9ed2',
--      '70d185aa-fc82-4961-96d6-d3cf3ea301fc'
--    );


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOCK 2 — Partnersichtbarkeit
-- ═══════════════════════════════════════════════════════════════════════════
-- Ziel: die vier Projekte gehören dem Partner NIEVERGELT + PARTNER AG.
--
-- Volle UUID am 21.08.2026 aus der DB verifiziert:
--   gs_partner_profil.partner_user_id = 'fa807e1c-2c07-41e4-af45-63731172b254'
--   → firma 'NIEVERGELT + PARTNER AG'
--   (dieselbe UUID steht auch in gs_kunden.partner_user_id des Kunden
--    7568933d-c68d-4919-be71-17880005517c, der bereits an allen vier
--    Projekten hängt — Kunden- und Partnerbezug passen danach zusammen.)
--
-- Wirkung: Nievergelt sieht die Projekte im Partner-Cockpit (pm_projekte
-- filtert auf partner_user_id, api/cockpit.js:1808) und darf sie bearbeiten
-- (requireOwnedProjekt, api/cockpit.js:178-183). Der Master verliert nichts —
-- die Master-Sicht filtert nicht auf partner_user_id.
--
-- Idempotenz: setzt immer denselben Wert, mehrfaches Ausführen ist folgenlos.

-- ── Vorher-SELECT Block 2 ──────────────────────────────────────────────────
SELECT p.projektnummer,
       p.name          AS projekt,
       p.partner_user_id,
       pp.firma        AS partner_heute,
       p.kunde_id,
       k.firma         AS kunde,
       p.status,
       p.geloescht_at
FROM gs_projekte p
LEFT JOIN gs_partner_profil pp ON pp.partner_user_id = p.partner_user_id
LEFT JOIN gs_kunden k          ON k.id = p.kunde_id
WHERE p.id IN (
  'b6651bc5-ec35-497f-84bd-bad77eaa5373',
  'b8a21470-c0de-4c0a-ba51-147054f0a0e9',
  'ce5e0f0a-18ca-499a-acfc-c69c8a7b9ed2',
  '70d185aa-fc82-4961-96d6-d3cf3ea301fc'
)
ORDER BY p.projektnummer;

-- Erwartet VOR dem Fix: partner_user_id NULL, partner_heute NULL,
--   kunde = 'NIEVERGELT + PARTNER AG', status 'aktiv', geloescht_at NULL.

-- ── Schreibend Block 2 (auskommentiert) ────────────────────────────────────

-- UPDATE gs_projekte
--    SET partner_user_id = 'fa807e1c-2c07-41e4-af45-63731172b254'
--  WHERE id IN (
--    'b6651bc5-ec35-497f-84bd-bad77eaa5373',
--    'b8a21470-c0de-4c0a-ba51-147054f0a0e9',
--    'ce5e0f0a-18ca-499a-acfc-c69c8a7b9ed2',
--    '70d185aa-fc82-4961-96d6-d3cf3ea301fc'
--  );


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOCK 3 — Nachkontrolle (rein lesend, immer ausführbar)
-- ═══════════════════════════════════════════════════════════════════════════
-- Nach Block 1 + 2 muss diese Abfrage für JEDES der vier Projekte genau eine
-- Zeile liefern mit:
--   techniker_id      = 03c67b2c-e670-46e2-add4-3910ea9d55fe
--   techniker_user_id = ee46a716-7017-4045-9f67-fe06d05171e7
--   partner_user_id   = fa807e1c-2c07-41e4-af45-63731172b254
--   status            = 'aktiv'
--   geloescht_at      = NULL
-- Steht in kette_ok überall 'OK', ist der Fix vollständig.

SELECT p.projektnummer,
       p.name                        AS projekt,
       pt.techniker_id,
       t.name                        AS techniker_name,
       t.email                       AS techniker_email,
       pt.techniker_user_id,
       p.partner_user_id,
       pp.firma                      AS partner,
       p.status,
       p.geloescht_at,
       CASE
         WHEN pt.techniker_id      = '03c67b2c-e670-46e2-add4-3910ea9d55fe'
          AND pt.techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
          AND p.partner_user_id    = 'fa807e1c-2c07-41e4-af45-63731172b254'
          AND p.geloescht_at IS NULL
         THEN 'OK'
         ELSE 'PRUEFEN'
       END                           AS kette_ok
FROM gs_projekte p
LEFT JOIN gs_projekt_techniker pt ON pt.projekt_id = p.id
LEFT JOIN gs_techniker t          ON t.id = pt.techniker_id
LEFT JOIN gs_partner_profil pp    ON pp.partner_user_id = p.partner_user_id
WHERE p.id IN (
  'b6651bc5-ec35-497f-84bd-bad77eaa5373',
  'b8a21470-c0de-4c0a-ba51-147054f0a0e9',
  'ce5e0f0a-18ca-499a-acfc-c69c8a7b9ed2',
  '70d185aa-fc82-4961-96d6-d3cf3ea301fc'
)
ORDER BY p.projektnummer;
