-- ═══════════════════════════════════════════════════════════════════════════
-- KW 34 · SCHRITT 4 von 6 — Stundentarif der drei neuen Zeilen (OPTIONAL, SCHREIBT)
-- ═══════════════════════════════════════════════════════════════════════════
-- OPTIONAL — diese Datei darf übersprungen werden.
--
-- Was diese Datei tut: setzt den Stundentarif der in Schritt 3 angelegten
-- Zuweisungen auf 70 CHF/h, wie ihn die bestehende Zeile für 60133.00
-- Stofer Manuel bereits trägt. Ohne diesen Schritt bleibt stundensatz NULL
-- und es gilt der Projekttarif.
--
-- Das ist eine kaufmännische Entscheidung, keine Reparatur — deshalb ein
-- eigener Schritt. Wer den Projekttarif greifen lassen will, überspringt ihn.
--
-- Erwartet danach: 3 Zeilen mit stundensatz 70.
--
-- Mehrfach ausführbar: ja. Die Bedingung 'stundensatz IS NULL' sorgt dafür,
-- dass ein bereits gesetzter (auch abweichender) Tarif nie überschrieben wird.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE gs_projekt_techniker
   SET stundensatz = 70
 WHERE techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
   AND stundensatz IS NULL
   AND projekt_id IN (
     'b8a21470-c0de-4c0a-ba51-147054f0a0e9',
     'ce5e0f0a-18ca-499a-acfc-c69c8a7b9ed2',
     '70d185aa-fc82-4961-96d6-d3cf3ea301fc'
   );

-- Ergebnis dieser Anweisung sichtbar machen:
SELECT p.projektnummer,
       p.name          AS projekt,
       pt.id           AS zuweisung_id,
       pt.stundensatz
FROM gs_projekt_techniker pt
JOIN gs_projekte p ON p.id = pt.projekt_id
WHERE pt.projekt_id IN (
  'b8a21470-c0de-4c0a-ba51-147054f0a0e9',
  'ce5e0f0a-18ca-499a-acfc-c69c8a7b9ed2',
  '70d185aa-fc82-4961-96d6-d3cf3ea301fc'
)
ORDER BY p.projektnummer;
