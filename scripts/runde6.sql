-- ============================================================
-- George Solutions — Sub-Modus Runde 6 (Zahlungsplan-Kette)
-- scripts/runde6.sql | manuell im Supabase SQL Editor ausführen.
-- Erweitert nur bestehende Tabellen. Ändert KEINE Engine-Logik.
-- Runtime funktioniert auch OHNE diese Spalten (try/catch auf Spaltenfehler),
-- die Zusatzfelder machen den Zahlungsplan-Audit-Trail aber persistent.
-- ============================================================

-- Block 6: zwei getrennte Zustimmungen (Angebot + Zahlungsplan) im Audit-Trail.
-- angebot_angenommen_at spiegelt gs_angebote.entschieden_am für den schnellen
-- Zugriff auf Projektebene; die Zahlungsplan-Annahme ist die zweite Zustimmung.
alter table gs_projekte add column if not exists angebot_angenommen_at timestamptz;
alter table gs_projekte add column if not exists zahlungsplan_status text;          -- null | 'offen' | 'angenommen'
alter table gs_projekte add column if not exists zahlungsplan_angenommen_at timestamptz;
alter table gs_projekte add column if not exists zahlungsplan_angenommen_by uuid;
alter table gs_projekte add column if not exists zahlungsplan_aktiv boolean not null default false;

-- Hinweis: gs_bauabschnitte / gs_steps / gs_escrow existieren bereits (Zahlungssystem).
-- Der Zahlungsplan wird nach Angebot-Annahme aus dem ANGENOMMENEN Betrag neu
-- generiert (Steps summieren exakt auf den Angebotsbetrag). Bis zur zweiten
-- Annahme bleibt der Plan inaktiv (Steps 'wartend', kein 'hinterlegen').
