-- ============================================================
-- George Solutions — Zahlungssystem (Escrow-Logik)
-- scripts/zahlungssystem_migration.sql | Stand 08.07.2026
-- Manuell im Supabase SQL Editor ausfuehren. Agent fasst DB nie an.
-- ============================================================

-- 1) BAUABSCHNITTE -------------------------------------------
create table if not exists gs_bauabschnitte (
  id             uuid primary key default gen_random_uuid(),
  projekt_id     uuid not null references gs_projekte(id) on delete cascade,
  name           text not null,
  reihenfolge    int  not null default 1,
  einheit_typ    text not null default 'pauschal'
                   check (einheit_typ in ('zone','giessrahmen','verteiler','bad_wc','meilenstein','pauschal')),
  einheit_anzahl int  not null default 0,
  team_tage      numeric(6,2)  not null default 0,
  gesamtbetrag   numeric(12,2) not null default 0,
  split_profil   text not null default 'stueck_15_70_15',
  status         text not null default 'geplant'
                   check (status in ('geplant','angezahlt','aktiv','zwischenfreigabe','abgeschlossen','nachtrag')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_gs_bauabschnitte_projekt on gs_bauabschnitte(projekt_id);

-- 2) STEPS (Zahlung + Blockade in einer Tabelle) -------------
create table if not exists gs_steps (
  id              uuid primary key default gen_random_uuid(),
  bauabschnitt_id uuid not null references gs_bauabschnitte(id) on delete cascade,
  reihenfolge     int  not null,
  typ             text not null check (typ in ('zahlung','blockade')),
  zahlung_art     text check (zahlung_art in ('anzahlung','fortschritt','meilenstein','abnahme','schlussrate')),
  bezeichnung     text not null,
  betrag          numeric(12,2) not null default 0,
  status          text not null default 'wartend'
                   check (status in ('wartend','aktiv','hinterlegt','gs_fertig','freigegeben','geklaert','offen')),
  foto_ref        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_gs_steps_abschnitt on gs_steps(bauabschnitt_id);

-- 3) ESCROW (Geld-Ledger, treuhaender-tauglich) --------------
create table if not exists gs_escrow (
  id                       uuid primary key default gen_random_uuid(),
  step_id                  uuid not null references gs_steps(id) on delete cascade,
  escrow_status            text not null default 'offen'
                             check (escrow_status in ('offen','hinterlegt','freigegeben','zurueckerstattet')),
  betrag                   numeric(12,2) not null default 0,
  rueckbehalt_prozent      numeric(5,2)  not null default 0,
  stripe_payment_intent_id text,
  stripe_transfer_id       text,
  gs_bestaetigt_at         timestamptz,
  gs_bestaetigt_by         uuid,
  kunde_bestaetigt_at      timestamptz,
  kunde_bestaetigt_by      uuid,
  freigegeben_at           timestamptz,
  nachweis_foto_ref        text,
  created_at               timestamptz not null default now()
);
create index if not exists idx_gs_escrow_step on gs_escrow(step_id);

-- 4) SPLIT-PROFILE (als Datensatz, Bob lernt sie) ------------
create table if not exists gs_split_profile (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,
  bezeichnung text not null,
  verteilung  jsonb not null,
  created_at  timestamptz not null default now()
);

-- 5) BOB-WISSEN (Weg 1: dedizierte Lern-Tabelle) -------------
create table if not exists gs_bob_wissen (
  id              uuid primary key default gen_random_uuid(),
  quelle          text not null default 'bauabschnitt',
  bauabschnitt_id uuid references gs_bauabschnitte(id) on delete set null,
  einheit_typ     text,
  team_tage       numeric(6,2),
  einheit_anzahl  int,
  split_profil    text,
  ansatz_chf_h    numeric(6,2),
  eff_chf_h       numeric(6,2),
  datensatz       jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_gs_bob_wissen_abschnitt on gs_bob_wissen(bauabschnitt_id);

-- 6) updated_at Trigger --------------------------------------
create or replace function gs_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_touch_bauabschnitte on gs_bauabschnitte;
create trigger trg_touch_bauabschnitte before update on gs_bauabschnitte
  for each row execute function gs_touch_updated_at();

drop trigger if exists trg_touch_steps on gs_steps;
create trigger trg_touch_steps before update on gs_steps
  for each row execute function gs_touch_updated_at();

-- 7) Split-Profile Startdaten --------------------------------
insert into gs_split_profile (name, bezeichnung, verteilung) values
  ('stueck_15_70_15','Stueck/Zone 15/70/15',
   '{"anzahlung":15,"einheiten":70,"abnahme":15,"rueckbehalt":10}'),
  ('komplex_15_25_50_10','Komplex-Block (Zentrale)',
   '{"anzahlung":15,"meilensteine":[25,50],"abnahme":10,"rueckbehalt":10}'),
  ('endmontage_30_70','Endmontage 30/70 (letzte=Abnahme)',
   '{"anzahlung":30,"einheiten":70,"abnahme":0,"rueckbehalt":10}'),
  ('klein_pauschal','Klein-Pauschal mit Blockaden',
   '{"anzahlung":20,"einheiten":70,"abnahme":10,"rueckbehalt":10}')
on conflict (name) do nothing;

-- 8) RLS aktiv (Zugriff nur server-side via api/cockpit.js) --
alter table gs_bauabschnitte enable row level security;
alter table gs_steps         enable row level security;
alter table gs_escrow        enable row level security;
alter table gs_split_profile enable row level security;
alter table gs_bob_wissen    enable row level security;
