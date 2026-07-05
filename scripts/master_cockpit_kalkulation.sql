-- ═══════════════════════════════════════════════════════════════════════════
-- Master-Cockpit · Modul "Projektplanung + Kalkulation + Materialauszug"
-- ADDITIV & IDEMPOTENT — nur ADD COLUMN IF NOT EXISTS. Baut NICHTS um, löscht
-- nichts. Erweitert die bestehenden PM-Tabellen (Session 6) um Preis-/Kalkula-
-- tionsfelder. In Supabase → SQL-Editor ausführen; danach greifen die neuen
-- Cockpit-Felder. Ohne diese Migration bleibt das Cockpit voll funktionsfähig
-- (die neuen Felder werden dann einfach ignoriert / mit 0 gerechnet).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Techniker: Stundensätze  (EK = Kostensatz intern, VK = Verkaufssatz) ──
ALTER TABLE gs_techniker ADD COLUMN IF NOT EXISTS kostensatz  DECIMAL(10,2);  -- EK CHF/h (intern)
ALTER TABLE gs_techniker ADD COLUMN IF NOT EXISTS stundensatz DECIMAL(10,2);  -- VK CHF/h (Verkauf)

-- ── 2. Material: Einkauf → Verkauf pro Position ──────────────────────────────
-- Marge % führt: VK = EK × (1 + marge/100). verkaufspreis überschreibt das,
-- wenn gesetzt (dann rechnet das Cockpit die effektive Marge zurück).
ALTER TABLE gs_material ADD COLUMN IF NOT EXISTS einzelpreis   DECIMAL(10,2) DEFAULT 0;  -- EK je Einheit
ALTER TABLE gs_material ADD COLUMN IF NOT EXISTS marge_prozent DECIMAL(6,2)  DEFAULT 0;  -- Aufschlag % auf EK
ALTER TABLE gs_material ADD COLUMN IF NOT EXISTS verkaufspreis DECIMAL(10,2);            -- VK je Einheit (NULL ⇒ aus EK×Marge)
ALTER TABLE gs_material ADD COLUMN IF NOT EXISTS lieferant     TEXT;
ALTER TABLE gs_material ADD COLUMN IF NOT EXISTS datum         DATE DEFAULT CURRENT_DATE;

-- ── 3. Arbeit (Tätigkeiten): Satz-Snapshot je Position ───────────────────────
-- techniker_name bleibt Freitext; die Sätze werden pro Position gespeichert
-- (Snapshot), damit spätere Satz-Änderungen alte Kalkulationen nicht verändern.
ALTER TABLE gs_taetigkeiten ADD COLUMN IF NOT EXISTS kostensatz   DECIMAL(10,2);  -- EK CHF/h (Snapshot)
ALTER TABLE gs_taetigkeiten ADD COLUMN IF NOT EXISTS stundensatz  DECIMAL(10,2);  -- VK CHF/h (Snapshot)
ALTER TABLE gs_taetigkeiten ADD COLUMN IF NOT EXISTS techniker_id UUID;           -- optionaler Link → gs_techniker
ALTER TABLE gs_taetigkeiten ADD COLUMN IF NOT EXISTS kategorie    TEXT;           -- Gewerk/Kategorie

-- ── 4. Projekt: Gesamt-Aufschlag & Rabatt auf Kalkulationsebene ──────────────
ALTER TABLE gs_projekte ADD COLUMN IF NOT EXISTS aufschlag_prozent DECIMAL(6,2) DEFAULT 0;  -- global auf VK
ALTER TABLE gs_projekte ADD COLUMN IF NOT EXISTS rabatt_prozent    DECIMAL(6,2) DEFAULT 0;  -- global auf VK (nach Aufschlag)

-- ── 5. LV-Andockung  (ZUKUNFT — nur Felder anlegen, KEINE Funktion bauen) ────
-- Spätere Ausbaustufe: Leistungsverzeichnis (LV) hochladen, mit unseren Preisen
-- (Stundensatz, Materialpreise, Hersteller) automatisch füllen, Rabatt geben und
-- ZWEI Versionen speichern/laden — kalkuliertes LV + Original. Damit LV-Positionen
-- (Pos-Nr · Text · Menge · Einheit · EK · VK) später OHNE Umbau an dieselben
-- Positionstabellen andocken, tragen Material- und Arbeitspositionen schon heute:
--   • pos_nr  → LV-Positionsnummer (z. B. "01.02.030")
--   • quelle  → 'manuell' (Default) | 'lv'  (Herkunft der Position)
--   • lv_ref  → gruppiert Positionen eines LV-Imports / einer Version
-- Bezeichnung/Text, Menge, Einheit, EK (einzelpreis) und VK (verkaufspreis) sind
-- bereits vorhanden ⇒ eine Materialposition IST bereits eine vollwertige LV-Zeile.
ALTER TABLE gs_material     ADD COLUMN IF NOT EXISTS pos_nr TEXT;
ALTER TABLE gs_material     ADD COLUMN IF NOT EXISTS quelle TEXT DEFAULT 'manuell';
ALTER TABLE gs_material     ADD COLUMN IF NOT EXISTS lv_ref TEXT;
ALTER TABLE gs_taetigkeiten ADD COLUMN IF NOT EXISTS pos_nr TEXT;
ALTER TABLE gs_taetigkeiten ADD COLUMN IF NOT EXISTS quelle TEXT DEFAULT 'manuell';
ALTER TABLE gs_taetigkeiten ADD COLUMN IF NOT EXISTS lv_ref TEXT;

-- ── Kontrolle (optional): zeigt die neuen Spalten an ─────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name IN ('gs_material','gs_taetigkeiten','gs_techniker','gs_projekte')
-- ORDER BY table_name, ordinal_position;
