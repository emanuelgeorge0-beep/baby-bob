-- ════════════════════════════════════════════════════════════════════════
-- George Solutions — Equipment-Träger Flag auf gs_techniker
-- ════════════════════════════════════════════════════════════════════════
-- USP: GS-Teams sind voll ausgestattet (Werkzeug · Fahrzeug · Material).
-- Im 2er-Team ist deshalb IMMER ein Equipment-Träger dabei:
--   Emanuel George ODER Patrick Notter.
--
-- Manuell im Supabase SQL Editor ausführen. Idempotent — mehrfaches
-- Ausführen ist gefahrlos.
--
-- Hinweis: Der Buchungsflow funktioniert auch OHNE diese Spalte, weil
-- api/techniker.js als Fallback per Name erkennt (Emanuel George /
-- Patrick Notter). Diese Migration macht das Flag explizit/datenbankseitig
-- und erlaubt, später weitere Equipment-Träger zu markieren.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Spalte anlegen (falls noch nicht vorhanden), Default false.
ALTER TABLE gs_techniker
  ADD COLUMN IF NOT EXISTS equipment_traeger BOOLEAN DEFAULT false;

-- 2) Bestehende NULL-Werte auf false normalisieren (idempotent).
UPDATE gs_techniker
  SET equipment_traeger = false
  WHERE equipment_traeger IS NULL;

-- 3) Equipment-Träger markieren: Emanuel George + Patrick Notter = true.
--    ILIKE + Wildcards toleriert Schreibweisen/Mittelnamen.
UPDATE gs_techniker
  SET equipment_traeger = true
  WHERE name ILIKE '%emanuel%george%'
     OR name ILIKE '%patrick%notter%';

-- 4) Kontrolle: zeigt, wer als Equipment-Träger gilt.
SELECT id, name, equipment_traeger
  FROM gs_techniker
  ORDER BY equipment_traeger DESC, name;
