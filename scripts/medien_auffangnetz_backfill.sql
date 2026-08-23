-- ═══════════════════════════════════════════════════════════════════════════
-- AUFFANGNETZ — Bestandsfotos aus dem Storage in gs_projekt_medien nachtragen
-- ═══════════════════════════════════════════════════════════════════════════
-- Hintergrund: Die Projektdateien-Kachel im Master (pm_datei_upload) legte
-- bisher NUR eine Storage-Datei an, keine DB-Zeile. Der Wochenbericht liest
-- ausschliesslich gs_projekt_medien — solche Fotos waren dort unsichtbar.
--
-- Ab dieser Runde registriert pm_datei_upload jedes Bild selbst
-- (api/cockpit.js, Kategorie 'bilder'). Dieses Skript holt den ALTBESTAND nach,
-- der vor der Aenderung hochgeladen wurde.
--
-- Es setzt tagesrapport_id BEWUSST NICHT: diese Uploads kennen keinen Tag.
-- Im Bericht erscheinen sie im Abschnitt "Ohne Tageszuordnung", datiert mit
-- dem Hochladezeitpunkt (created_at), ausdruecklich als solcher benannt.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WAS DIESES SKRIPT TUT
--   Ein INSERT ... SELECT aus storage.objects nach gs_projekt_medien.
--   Kein UPDATE, kein DELETE, kein CREATE, kein DROP, kein ALTER.
--   Keine Schemaaenderung. gs_tagesrapporte wird nicht angefasst.
--   Idempotent: NOT EXISTS auf path verhindert Doppeleintraege, das Skript
--   darf beliebig oft laufen.
--
-- Aufgenommen wird nur, was alle vier Bedingungen erfuellt:
--   1. Bucket 'projektdateien', Pfadmuster <projekt-uuid>/bilder/<datei>
--   2. MIME beginnt mit image/          (Plaene und Dokumente bleiben draussen)
--   3. Das Projekt existiert noch in gs_projekte
--   4. Es gibt noch keine Medienzeile mit diesem path
--
-- ACHTUNG PDF-Motor: lib/pdf.js bettet ausschliesslich BASELINE-JPEG bis 3 MB
--   ein (lib/pdf.js:318, ladeFotoBytes maxBytes). Progressive JPEG, PNG, WEBP
--   und HEIC werden im Bericht als "Bild nicht darstellbar" gedruckt bzw. still
--   uebersprungen. Der Vorher-SELECT unten weist Format und Groesse aus, damit
--   das vor dem Schreiben sichtbar ist.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- VORHER — was wuerde eingefuegt (rein lesend)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT p.projektnummer,
       p.name                                        AS projekt,
       regexp_replace(split_part(o.name, '/', 3), '^\d{10,}-', '') AS dateiname,
       o.metadata ->> 'mimetype'                     AS mime,
       ROUND(((o.metadata ->> 'size')::bigint) / 1048576.0, 2)     AS mb,
       CASE
         WHEN (o.metadata ->> 'mimetype') <> 'image/jpeg'          THEN 'kein JPEG - wird im PDF uebersprungen'
         WHEN ((o.metadata ->> 'size')::bigint) > 3 * 1024 * 1024  THEN 'ueber 3 MB - wird im PDF uebersprungen'
         ELSE 'ok'
       END                                           AS pdf_tauglich,
       o.created_at                                  AS hochgeladen,
       o.name                                        AS path
FROM storage.objects o
JOIN gs_projekte p ON p.id = split_part(o.name, '/', 1)::uuid
WHERE o.bucket_id = 'projektdateien'
  AND o.name ~ '^[0-9a-fA-F-]{36}/bilder/.+'
  AND (o.metadata ->> 'mimetype') LIKE 'image/%'
  AND NOT EXISTS (SELECT 1 FROM gs_projekt_medien m WHERE m.path = o.name)
ORDER BY p.projektnummer, o.created_at;


-- ═══════════════════════════════════════════════════════════════════════════
-- SCHREIBEN
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

INSERT INTO gs_projekt_medien
  (projekt_id, service_auftrag_id, tagesrapport_id,
   medientyp, bucket, path, dateiname, mime, groesse, created_at)
SELECT split_part(o.name, '/', 1)::uuid,
       NULL,
       NULL,                                          -- kein Tag: Auffangnetz
       'foto',
       'projektdateien',
       o.name,
       regexp_replace(split_part(o.name, '/', 3), '^\d{10,}-', ''),
       o.metadata ->> 'mimetype',
       (o.metadata ->> 'size')::bigint,
       o.created_at                                   -- Hochladezeitpunkt erhalten
FROM storage.objects o
WHERE o.bucket_id = 'projektdateien'
  AND o.name ~ '^[0-9a-fA-F-]{36}/bilder/.+'
  AND (o.metadata ->> 'mimetype') LIKE 'image/%'
  AND EXISTS (SELECT 1 FROM gs_projekte p WHERE p.id = split_part(o.name, '/', 1)::uuid)
  AND NOT EXISTS (SELECT 1 FROM gs_projekt_medien m WHERE m.path = o.name);

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- NACHKONTROLLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Erwartet: je Projekt die Zahl der Bilder aus dem Storage, alle mit
-- tagesrapport_id IS NULL. offen_im_storage muss 0 sein.
SELECT p.projektnummer,
       p.name                                                       AS projekt,
       COUNT(*)                                                     AS medienzeilen,
       COUNT(*) FILTER (WHERE m.tagesrapport_id IS NULL)            AS ohne_tageszuordnung,
       COUNT(*) FILTER (WHERE m.tagesrapport_id IS NOT NULL)        AS mit_tageszuordnung,
       MIN(m.created_at)::date                                      AS aeltestes,
       MAX(m.created_at)::date                                      AS neuestes
FROM gs_projekt_medien m
JOIN gs_projekte p ON p.id = m.projekt_id
WHERE m.medientyp = 'foto'
GROUP BY p.projektnummer, p.name
ORDER BY p.projektnummer;

-- Rest-Kontrolle: darf keine Zeile mehr liefern.
SELECT COUNT(*) AS offen_im_storage
FROM storage.objects o
WHERE o.bucket_id = 'projektdateien'
  AND o.name ~ '^[0-9a-fA-F-]{36}/bilder/.+'
  AND (o.metadata ->> 'mimetype') LIKE 'image/%'
  AND EXISTS (SELECT 1 FROM gs_projekte p WHERE p.id = split_part(o.name, '/', 1)::uuid)
  AND NOT EXISTS (SELECT 1 FROM gs_projekt_medien m WHERE m.path = o.name);
