-- ════════════════════════════════════════════════════════════════════════
-- George Solutions — Region-Feld auf gs_techniker
-- ════════════════════════════════════════════════════════════════════════
-- Für die GS-Partner-Anfrage "Techniker in Ihrer Nähe" (simulierte Karte).
-- Die Region ordnet jeden Techniker einem Schweizer Grossraum zu, damit die
-- Karte die Pins korrekt platziert und "in deiner Nähe" sortieren kann.
--
-- Manuell im Supabase SQL Editor ausführen. Idempotent (mehrfach ausführbar).
-- Hinweis: api/techniker.js leitet die Region zusätzlich aus dem Ort (location
-- im notizen-Sidecar) bzw. per Name ab (Fallback) — die Karte funktioniert
-- also auch VOR dieser Migration. Diese Spalte macht die Zuordnung dauerhaft.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Spalte anlegen.
ALTER TABLE gs_techniker
  ADD COLUMN IF NOT EXISTS region TEXT;

-- 2) Region aus bekanntem Ort ableiten, nur wo noch nicht gesetzt (idempotent).
--    Grossräume: Zürich · Nordwestschweiz · Zentralschweiz · Ostschweiz.
UPDATE gs_techniker SET region = 'Zürich'
  WHERE region IS NULL AND (notizen ILIKE '%"location":"Zürich"%' OR notizen ILIKE '%"location":"Winterthur"%');

UPDATE gs_techniker SET region = 'Nordwestschweiz'
  WHERE region IS NULL AND (notizen ILIKE '%"location":"Basel"%' OR notizen ILIKE '%"location":"Aarau"%' OR notizen ILIKE '%"location":"Baden"%');

UPDATE gs_techniker SET region = 'Zentralschweiz'
  WHERE region IS NULL AND (notizen ILIKE '%"location":"Zug"%' OR notizen ILIKE '%"location":"Luzern"%');

UPDATE gs_techniker SET region = 'Ostschweiz'
  WHERE region IS NULL AND (notizen ILIKE '%"location":"St. Gallen"%' OR notizen ILIKE '%"location":"Schaffhausen"%');

-- 3) Rest auf 'Zürich' als Default (Hauptstandort des Teams).
UPDATE gs_techniker SET region = 'Zürich'
  WHERE region IS NULL;

-- 4) Kontrolle.
SELECT id, name, region FROM gs_techniker ORDER BY region, name;
