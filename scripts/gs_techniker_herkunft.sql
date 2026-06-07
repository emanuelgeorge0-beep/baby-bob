-- ════════════════════════════════════════════════════════════════════════
-- George Solutions — Herkunfts-Flagge auf gs_techniker
-- ════════════════════════════════════════════════════════════════════════
-- Dezente Herkunfts-Anzeige neben dem Techniker-Namen:
--   'CH'    → 🇨🇭   (Schweiz)
--   'CH_AT' → 🇨🇭🇦🇹 (Schweiz & Österreich)
--
-- Manuell im Supabase SQL Editor ausführen. Idempotent.
-- Hinweis: api/techniker.js erkennt die CH_AT-Techniker zusätzlich per Name
-- (Fallback), die Anzeige funktioniert also auch vor dieser Migration.
-- NICHT verwechseln mit den Markt-Flaggen der Landingseite (CH/AT/DE/ES/GB) —
-- das hier ist die persönliche Herkunft eines Technikers.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Spalte anlegen (Default 'CH').
ALTER TABLE gs_techniker
  ADD COLUMN IF NOT EXISTS herkunft TEXT DEFAULT 'CH';

-- 2) NULL-Werte auf 'CH' normalisieren (idempotent).
UPDATE gs_techniker
  SET herkunft = 'CH'
  WHERE herkunft IS NULL;

-- 3) CH_AT-Techniker setzen: Emanuel George, Dimitri Grill, Vasil Ignatov.
UPDATE gs_techniker
  SET herkunft = 'CH_AT'
  WHERE name ILIKE '%emanuel%george%'
     OR name ILIKE '%dimitri%grill%'
     OR name ILIKE '%vasil%ignatov%';

-- 4) Sicherstellen: Patrick Notter (und alle übrigen) = 'CH'.
UPDATE gs_techniker
  SET herkunft = 'CH'
  WHERE name ILIKE '%patrick%notter%';

-- 5) Kontrolle.
SELECT id, name, herkunft
  FROM gs_techniker
  ORDER BY herkunft DESC, name;
