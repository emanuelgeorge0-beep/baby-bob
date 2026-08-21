-- ═══════════════════════════════════════════════════════════════════════════
-- KW 34 · SCHRITT 1 von 6 — Ausgangslage (NUR LESEND)
-- ═══════════════════════════════════════════════════════════════════════════
-- Was diese Datei tut: zeigt für die vier KW-34-Projekte in einer einzigen
-- Abfrage, wie Technikerzuweisung, Partner und Kunde heute stehen. Sie
-- schreibt nichts.
--
-- Erwartet VOR dem Fix:
--   60133.00 Stofer Manuel      → techniker_id ed1874fe… (falsche Emanuel-Zeile),
--                                 techniker_user_id NULL
--   60586.00 Taeger Architektur → alle pt-Spalten NULL (keine Zuweisung)
--   60060.00 Arzt Praxis        → alle pt-Spalten NULL (keine Zuweisung)
--   60829.00 Fertigmontage      → alle pt-Spalten NULL (keine Zuweisung)
--   bei allen vier: partner_user_id NULL, partner NULL,
--                   kunde 'NIEVERGELT + PARTNER AG', status 'aktiv',
--                   geloescht_at NULL
--
-- Mehrfach ausführbar: ja, beliebig oft (reiner SELECT).
-- ═══════════════════════════════════════════════════════════════════════════

SELECT p.projektnummer,
       p.name                        AS projekt,
       pt.id                         AS zuweisung_id,
       pt.techniker_id,
       t.name                        AS techniker_name,
       t.email                       AS techniker_email,
       pt.techniker_user_id,
       pt.taetigkeit,
       pt.stundensatz,
       p.partner_user_id,
       pp.firma                      AS partner,
       k.firma                       AS kunde,
       p.status,
       p.geloescht_at
FROM gs_projekte p
LEFT JOIN gs_projekt_techniker pt ON pt.projekt_id = p.id
LEFT JOIN gs_techniker t          ON t.id = pt.techniker_id
LEFT JOIN gs_partner_profil pp    ON pp.partner_user_id = p.partner_user_id
LEFT JOIN gs_kunden k             ON k.id = p.kunde_id
WHERE p.id IN (
  'b6651bc5-ec35-497f-84bd-bad77eaa5373',  -- 60133.00 Stofer Manuel
  'b8a21470-c0de-4c0a-ba51-147054f0a0e9',  -- 60586.00 Taeger Architektur
  'ce5e0f0a-18ca-499a-acfc-c69c8a7b9ed2',  -- 60060.00 Arzt Praxis
  '70d185aa-fc82-4961-96d6-d3cf3ea301fc'   -- 60829.00 Fertigmontage
)
ORDER BY p.projektnummer;
