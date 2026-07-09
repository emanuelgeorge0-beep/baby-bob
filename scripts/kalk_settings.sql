-- ============================================================
-- George Solutions — Kalkulations-Kostensätze + Kalk-Positionen
-- scripts/kalk_settings.sql | Runde 4
-- Manuell im Supabase SQL Editor ausführen.
-- Ändert NICHT die Zahlungssystem-Engine-Tabellen (gs_bauabschnitte/gs_steps/
-- gs_escrow). gs_kalk_positionen hängt nur per FK an gs_bauabschnitte.
-- ============================================================

-- Singleton-Kostensätze (genau EINE Zeile) — intern, nie im Angebot/Partner.
create table if not exists gs_kalk_settings (
  id                    uuid primary key default gen_random_uuid(),
  vollkosten_chf_h      numeric(8,2) not null default 46,
  spesen_pro_person_tag numeric(8,2) not null default 40,
  kfz_pauschale_tag     numeric(8,2) not null default 20,
  equipment_pro_woche   numeric(8,2) not null default 280,
  stunden_pro_team_tag  numeric(6,2) not null default 8,
  ansatz_detailliert    numeric(8,2) not null default 90,
  ansatz_schnell        numeric(8,2) not null default 85,
  ampel_gruen_ab        numeric(8,2) not null default 70,
  ampel_rot_unter       numeric(8,2) not null default 56,
  updated_at            timestamptz  not null default now()
);
-- genau eine Zeile anlegen (Defaults), falls noch keine existiert
insert into gs_kalk_settings (vollkosten_chf_h)
select 46 where not exists (select 1 from gs_kalk_settings);

-- Kalk-Eingaben je Bauabschnitt (Personen/Team-Tage/Ansatz-Modus). Umsatz wird
-- daraus berechnet und in gs_bauabschnitte.gesamtbetrag geschrieben (Engine unverändert).
create table if not exists gs_kalk_positionen (
  bauabschnitt_id uuid primary key references gs_bauabschnitte(id) on delete cascade,
  personen        int          not null default 2,
  team_tage       numeric(8,2) not null default 0,
  ansatz_modus    text         not null default 'detailliert'
    check (ansatz_modus in ('detailliert','schnell')),
  updated_at      timestamptz  not null default now()
);

alter table gs_kalk_settings   enable row level security;
alter table gs_kalk_positionen enable row level security;
