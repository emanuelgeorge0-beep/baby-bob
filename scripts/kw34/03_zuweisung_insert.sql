-- ═══════════════════════════════════════════════════════════════════════════
-- KW 34 · SCHRITT 3 von 6 — fehlende Zuweisungen ergänzen (SCHREIBT)
-- ═══════════════════════════════════════════════════════════════════════════
-- Was diese Datei tut: drei der vier KW-34-Projekte haben überhaupt keine
-- Technikerzuweisung. Sie werden auf gs_techniker 03c67b2c… gelegt, mit
-- passender Auth-User-ID in techniker_user_id.
--
--   60586.00 Taeger Architektur  b8a21470-c0de-4c0a-ba51-147054f0a0e9
--   60060.00 Arzt Praxis         ce5e0f0a-18ca-499a-acfc-c69c8a7b9ed2
--   60829.00 Fertigmontage       70d185aa-fc82-4961-96d6-d3cf3ea301fc
--
-- Erwartet danach: 3 Zeilen, alle mit
--   techniker_id      = 03c67b2c-e670-46e2-add4-3910ea9d55fe
--   techniker_user_id = ee46a716-7017-4045-9f67-fe06d05171e7
--
-- Mehrfach ausführbar: ja. Die Idempotenz stützt sich auf den vorhandenen
-- partiellen Unique-Index
--   uq_pt_projekt_user (projekt_id, techniker_user_id) WHERE techniker_user_id IS NOT NULL
-- (angelegt in scripts/master_cockpit_session6_pm.sql:77-79). Deshalb steht
-- die Index-Bedingung in der ON-CONFLICT-Klausel — ohne sie kann Postgres den
-- partiellen Index nicht ableiten.
-- ACHTUNG: Die Idempotenz hängt daran, dass techniker_user_id mitgeschrieben
-- wird. Auf (projekt_id, techniker_id) allein gibt es KEINEN Unique-Index.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO gs_projekt_techniker (projekt_id, techniker_id, techniker_user_id)
VALUES
  ('b8a21470-c0de-4c0a-ba51-147054f0a0e9',
   '03c67b2c-e670-46e2-add4-3910ea9d55fe',
   'ee46a716-7017-4045-9f67-fe06d05171e7'),
  ('ce5e0f0a-18ca-499a-acfc-c69c8a7b9ed2',
   '03c67b2c-e670-46e2-add4-3910ea9d55fe',
   'ee46a716-7017-4045-9f67-fe06d05171e7'),
  ('70d185aa-fc82-4961-96d6-d3cf3ea301fc',
   '03c67b2c-e670-46e2-add4-3910ea9d55fe',
   'ee46a716-7017-4045-9f67-fe06d05171e7')
ON CONFLICT (projekt_id, techniker_user_id)
  WHERE techniker_user_id IS NOT NULL
  DO NOTHING;

-- Ergebnis dieser Anweisung sichtbar machen:
SELECT p.projektnummer,
       p.name          AS projekt,
       pt.id           AS zuweisung_id,
       pt.techniker_id,
       t.name          AS techniker_name,
       pt.techniker_user_id,
       pt.stundensatz
FROM gs_projekt_techniker pt
JOIN gs_projekte p       ON p.id = pt.projekt_id
LEFT JOIN gs_techniker t ON t.id = pt.techniker_id
WHERE pt.projekt_id IN (
  'b8a21470-c0de-4c0a-ba51-147054f0a0e9',
  'ce5e0f0a-18ca-499a-acfc-c69c8a7b9ed2',
  '70d185aa-fc82-4961-96d6-d3cf3ea301fc'
)
ORDER BY p.projektnummer;
