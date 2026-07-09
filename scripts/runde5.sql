-- ============================================================
-- George Solutions — Sub-Modus Runde 5 (Blocker vor Kundenversand)
-- scripts/runde5.sql | manuell im Supabase SQL Editor ausführen.
-- Erweitert nur bestehende Tabellen. Ändert KEINE Engine-Logik.
-- ============================================================

-- Aufgabe 4: dritte Ansatz-Option "Schmerzgrenze" (Default 75 CHF/h).
-- Runtime nutzt schon 75 als Fallback-Default; diese Spalte macht ihn editierbar.
alter table gs_kalk_settings add column if not exists ansatz_minimum numeric(8,2) not null default 75;

-- Aufgabe 7: sichtbare Projekt-ID (Präfix S-/K-). Die Nummer wird derzeit zur
-- Laufzeit aus der Erstell-Reihenfolge berechnet (kein DB-Zugriff nötig). Diese
-- optionale Spalte ist für Runde 6 vorbereitet, damit die Nummer persistiert
-- werden kann. Runtime funktioniert auch OHNE diese Spalte.
alter table gs_projekte add column if not exists anzeige_nr int;

-- Aufgabe 6: Leistungsarten (2. Ebene unter Bereich) werden als Array in
-- gs_projekte.datenblatt.sub.leistungsarten (jsonb) gespeichert — KEIN Schema-
-- Änderung nötig (datenblatt ist bereits jsonb). Grund: später Bobs Trainings-
-- material in gs_bob_wissen. Hier nur als Doku vermerkt.
