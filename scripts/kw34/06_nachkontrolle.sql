-- ═══════════════════════════════════════════════════════════════════════════
-- KW 34 · SCHRITT 6 von 6 — Nachkontrolle (NUR LESEND)
-- ═══════════════════════════════════════════════════════════════════════════
-- Was diese Datei tut: prüft in einer Abfrage, ob die Kette für alle vier
-- Projekte steht. Sie schreibt nichts.
--
-- Erwartet danach: 4 Zeilen, in jeder
--   techniker_id      = 03c67b2c-e670-46e2-add4-3910ea9d55fe
--   techniker_user_id = ee46a716-7017-4045-9f67-fe06d05171e7
--   partner_user_id   = fa807e1c-2c07-41e4-af45-63731172b254
--   status            = 'aktiv'
--   geloescht_at      = NULL
--   kette_ok          = 'OK'
--
-- Steht in kette_ok überall 'OK', ist der Fix vollständig. Steht irgendwo
-- 'PRUEFEN', fehlt ein Schritt — dann zurück zu 02 bzw. 05.
--
-- Mehrfach ausführbar: ja, beliebig oft (reiner SELECT).
-- ═══════════════════════════════════════════════════════════════════════════

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
