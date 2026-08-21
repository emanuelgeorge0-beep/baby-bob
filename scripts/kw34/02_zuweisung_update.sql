-- ═══════════════════════════════════════════════════════════════════════════
-- KW 34 · SCHRITT 2 von 6 — bestehende Zuweisung umhängen (SCHREIBT)
-- ═══════════════════════════════════════════════════════════════════════════
-- Was diese Datei tut: die einzige vorhandene Zuweisung (Projekt 60133.00
-- Stofer Manuel) hängt an der falschen der beiden gleichnamigen
-- gs_techniker-Zeilen. Sie wird umgehängt und bekommt zusätzlich die
-- Auth-User-ID, damit beide Techniker-Spalten übereinstimmen.
--
--   von:  techniker_id      = ed1874fe-d167-4ea5-8129-6f70a6abe76a
--                             (emanuel.george@georgesolutions.ch, Konto 13ad53b5…)
--   auf:  techniker_id      = 03c67b2c-e670-46e2-add4-3910ea9d55fe
--                             (emanuelgeorge0@gmail.com, Konto ee46a716…)
--         techniker_user_id = ee46a716-7017-4045-9f67-fe06d05171e7
--
-- Warum beide Spalten: api/cockpit.js liest techniker_id, aber
-- api/projekte.js, api/gewerke.js und api/projectflow.js lesen
-- techniker_user_id. Nur mit beiden ist die Zuweisung überall sichtbar.
--
-- Erwartet danach: genau 1 Zeile, techniker_name 'Emanuel George',
-- techniker_email 'emanuelgeorge0@gmail.com',
-- techniker_user_id 'ee46a716-7017-4045-9f67-fe06d05171e7'.
--
-- Mehrfach ausführbar: ja. Die Zeile wird per Primärschlüssel adressiert und
-- bekommt immer dieselben Werte.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE gs_projekt_techniker
   SET techniker_id      = '03c67b2c-e670-46e2-add4-3910ea9d55fe',
       techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
 WHERE id = '2f464873-719d-4f4f-bae4-601839599c98';

-- Ergebnis dieser Anweisung sichtbar machen:
SELECT p.projektnummer,
       p.name          AS projekt,
       pt.id           AS zuweisung_id,
       pt.techniker_id,
       t.name          AS techniker_name,
       t.email         AS techniker_email,
       pt.techniker_user_id
FROM gs_projekt_techniker pt
JOIN gs_projekte p     ON p.id = pt.projekt_id
LEFT JOIN gs_techniker t ON t.id = pt.techniker_id
WHERE pt.id = '2f464873-719d-4f4f-bae4-601839599c98';
