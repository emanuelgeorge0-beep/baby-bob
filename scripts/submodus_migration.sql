-- ============================================================
-- George Solutions — Sub-/Akkord-Modus
-- scripts/submodus_migration.sql | Stand 09.07.2026
-- Manuell im Supabase SQL Editor ausgefuehrt.
-- ============================================================

create table if not exists gs_partner_profil (
  partner_user_id uuid primary key,
  firma           text not null default '',
  logo_url        text,
  adresse         text,
  plz             text,
  ort             text,
  telefon         text,
  email           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table gs_projekte
  add column if not exists projekt_art text not null default 'kapazitaet'
    check (projekt_art in ('kapazitaet','sub_akkord'));

alter table gs_projekte
  add column if not exists sub_status text
    check (sub_status in ('entwurf','angefragt','in_pruefung','angebot_offen','angenommen','abgelehnt','aktiv'));

alter table gs_projekte
  add column if not exists angefragt_am timestamptz;

create table if not exists gs_angebote (
  id                uuid primary key default gen_random_uuid(),
  projekt_id        uuid not null references gs_projekte(id) on delete cascade,
  version           int  not null default 1,
  gesamtbetrag      numeric(12,2) not null default 0,
  ansatz_chf_h      numeric(6,2),
  bemerkung         text,
  bauabschnitt_vorschlag jsonb,
  status            text not null default 'entwurf'
    check (status in ('entwurf','abgeschickt','angenommen','abgelehnt','besprechung')),
  abgeschickt_am    timestamptz,
  entschieden_am    timestamptz,
  entschieden_by    uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_gs_angebote_projekt on gs_angebote(projekt_id);

create table if not exists gs_auftragsbestaetigung (
  id             uuid primary key default gen_random_uuid(),
  projekt_id     uuid not null references gs_projekte(id) on delete cascade,
  angebot_id     uuid references gs_angebote(id) on delete set null,
  nummer         text,
  gesamtbetrag   numeric(12,2) not null default 0,
  bestaetigt_am  timestamptz not null default now(),
  bestaetigt_by  uuid,
  created_at     timestamptz not null default now()
);
create index if not exists idx_gs_ab_projekt on gs_auftragsbestaetigung(projekt_id);

drop trigger if exists trg_touch_partner_profil on gs_partner_profil;
create trigger trg_touch_partner_profil before update on gs_partner_profil
  for each row execute function gs_touch_updated_at();

drop trigger if exists trg_touch_angebote on gs_angebote;
create trigger trg_touch_angebote before update on gs_angebote
  for each row execute function gs_touch_updated_at();

insert into gs_features (key, label) values
  ('sub_akkord',      'Sub-/Akkordprojekte'),
  ('partner_branding','Firmenlogo & Branding')
on conflict (key) do update set label = excluded.label;

alter table gs_partner_profil        enable row level security;
alter table gs_angebote              enable row level security;
alter table gs_auftragsbestaetigung  enable row level security;
