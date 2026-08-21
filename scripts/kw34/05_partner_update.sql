-- ═══════════════════════════════════════════════════════════════════════════
-- KW 34 · SCHRITT 5 von 6 — Partnersichtbarkeit herstellen (SCHREIBT)
-- ═══════════════════════════════════════════════════════════════════════════
-- Was diese Datei tut: setzt bei allen vier KW-34-Projekten den Besitzer auf
-- den Partner NIEVERGELT + PARTNER AG.
--
--   partner_user_id = 'fa807e1c-2c07-41e4-af45-63731172b254'
--   (verifiziert über gs_partner_profil → firma 'NIEVERGELT + PARTNER AG';
--    dieselbe UUID steht in gs_kunden.partner_user_id des Kunden
--    7568933d-c68d-4919-be71-17880005517c, der bereits an allen vier
--    Projekten hängt — Kunden- und Partnerbezug passen danach zusammen.)
--
-- Wirkung: Nievergelt sieht die Projekte im Partner-Cockpit (pm_projekte
-- filtert auf partner_user_id, api/cockpit.js:1808) und darf sie bearbeiten
-- (requireOwnedProjekt, api/cockpit.js:178-183). Der Master verliert nichts —
-- die Master-Sicht filtert nicht auf partner_user_id.
--
-- Erwartet danach: 4 Zeilen, partner = 'NIEVERGELT + PARTNER AG'.
--
-- Mehrfach ausführbar: ja, setzt immer denselben Wert.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE gs_projekte
   SET partner_user_id = 'fa807e1c-2c07-41e4-af45-63731172b254'
 WHERE id IN (
   'b6651bc5-ec35-497f-84bd-bad77eaa5373',
   'b8a21470-c0de-4c0a-ba51-147054f0a0e9',
   'ce5e0f0a-18ca-499a-acfc-c69c8a7b9ed2',
   '70d185aa-fc82-4961-96d6-d3cf3ea301fc'
 );

-- Ergebnis dieser Anweisung sichtbar machen:
SELECT p.projektnummer,
       p.name          AS projekt,
       p.partner_user_id,
       pp.firma        AS partner,
       k.firma         AS kunde
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
