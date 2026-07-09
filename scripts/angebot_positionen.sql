-- ============================================================
-- George Solutions — Angebot mit Positionen + Konditionen
-- scripts/angebot_positionen.sql | Runde 4
-- Manuell im Supabase SQL Editor ausführen. Erweitert nur gs_angebote.
-- ============================================================

alter table gs_angebote add column if not exists positionen        jsonb;
alter table gs_angebote add column if not exists rabatt_prozent    numeric(6,2) not null default 0;
alter table gs_angebote add column if not exists zuschlag_prozent  numeric(6,2) not null default 0;
alter table gs_angebote add column if not exists mwst_prozent      numeric(6,2) not null default 8.1;
alter table gs_angebote add column if not exists zahlungsziel_tage int;
alter table gs_angebote add column if not exists gueltig_bis       date;
alter table gs_angebote add column if not exists ausfuehrung_von   date;
alter table gs_angebote add column if not exists ausfuehrung_bis   date;
