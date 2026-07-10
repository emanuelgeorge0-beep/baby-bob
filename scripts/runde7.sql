-- ============================================================
-- George Solutions — Runde 7 (Zahlungsplan-Editor + Bugfixes)
-- scripts/runde7.sql | MANUELL im Supabase SQL Editor ausführen.
-- Erweitert nur bestehende Tabellen. Ändert KEINE Engine-Logik.
-- Die Runtime funktioniert auch OHNE diese Spalten (try/catch bzw.
-- Spalten-Fallbacks); die Felder machen Ansprechperson + Bob-Training
-- aber persistent. Reihenfolge egal, alle Statements sind idempotent.
-- ============================================================

-- ── Block 3: Ansprechperson (echter Name) im Partnerprofil ──
-- Bisher fiel die Anzeige auf die Login-E-Mail zurück (kein Namensfeld).
-- Fallback-Reihenfolge im UI: ansprechperson → firma → email.
alter table gs_partner_profil add column if not exists ansprechperson text;

-- ── Block 7: Trainingsdaten für Bob aus der FINAL abgeschickten Kette ──
-- gs_bob_wissen existiert bereits (Zahlungssystem). Die Zusatzspalten halten
-- den vom Master final angepassten Zahlungsplan fest (nicht den Generator-
-- Vorschlag). Sind sie nicht vorhanden, schreibt die Runtime den Kern trotzdem
-- (datensatz jsonb) und überspringt die fehlenden Spalten still.
alter table gs_bob_wissen add column if not exists quelle             text;
alter table gs_bob_wissen add column if not exists projekt_art        text;
alter table gs_bob_wissen add column if not exists leistungsarten     jsonb;
alter table gs_bob_wissen add column if not exists personen           int;
alter table gs_bob_wissen add column if not exists einheit_anzahl     int;
alter table gs_bob_wissen add column if not exists gesamtbetrag       numeric(12,2);
alter table gs_bob_wissen add column if not exists finale_step_kette  jsonb;
