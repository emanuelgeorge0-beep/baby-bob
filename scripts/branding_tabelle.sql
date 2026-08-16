-- ============================================================
-- George Solutions — Branding-Fundament fuer erzeugte Dokumente
-- scripts/branding_tabelle.sql | MANUELL im Supabase SQL Editor ausfuehren.
-- Legt EINE neue Tabelle an, aendert nichts Bestehendes. Idempotent.
-- ============================================================
--
-- WOZU. Farbe, Logo, Firmenname und Fusszeile der erzeugten Dokumente
-- (Wochenbericht, spaeter Rechnung/Serviceauftrag) stehen heute fest im Code.
-- Sie kommen ab jetzt aus dieser Tabelle, damit dasselbe PDF spaeter im
-- Auftritt eines Partners erscheinen kann, ohne dass jemand lib/pdf.js anfasst.
--
-- ABGRENZUNG — nicht verwechseln:
--   gs_partner_profil  = das Firmenprofil, das ein Partner sich SELBST pflegt
--                        (Adresse, Telefon, eigenes Logo; Feature 'partner_branding').
--   gs_branding        = wie ein von uns ERZEUGTES DOKUMENT aussieht.
-- Der Name gs_branding ist neu; er kommt weder in der Live-DB noch im Code vor
-- (geprueft per REST-Sondierung und grep ueber api/, lib/, scripts/, *.html).
--
-- KEIN Fremdschluessel auf partner_id: einen Partner gibt es nur als
-- auth.users-ID (gs_projekte.partner_user_id), es existiert keine Partner-
-- Tabelle. Eine Referenz auf auth.users waere ein Eingriff in den Auth-Bereich
-- und ist hier bewusst nicht gesetzt.

create table if not exists gs_branding (
  id           uuid primary key default gen_random_uuid(),
  -- NULL = Standard fuer alle. Ein Eintrag mit partner_id hat Vorrang.
  partner_id   uuid,
  firmenname   text not null default 'George Solutions',
  -- Repo-Pfad ODER absolute URL. lib/pdf.js loest beides auf.
  logo_url     text,
  -- Strukturfarbe (Kopfbalken-Akzent, Trennlinien, Kacheln). Gold fuehrt.
  akzentfarbe  text not null default '#C9A961'
    check (akzentfarbe ~* '^#[0-9a-f]{6}$'),
  fusszeile    text,
  aktiv        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Genau EIN aktiver Standard und je Partner genau EIN aktiver Eintrag.
-- Zwei Indizes, weil NULL in einem UNIQUE-Index nicht mit NULL kollidiert.
create unique index if not exists idx_gs_branding_standard
  on gs_branding ((true)) where partner_id is null and aktiv;
create unique index if not exists idx_gs_branding_partner
  on gs_branding (partner_id) where partner_id is not null and aktiv;

-- Gelesen wird ausschliesslich serverseitig mit dem Service-Key (der RLS
-- ohnehin umgeht). RLS an, ohne Policy = kein Direktzugriff aus dem Browser.
alter table gs_branding enable row level security;

-- ── Erster Datensatz: George Solutions, Standard fuer alle ──
-- logo_url ist der Repo-Pfad; lib/pdf.js liest die Datei lokal und faellt auf
-- https://baby-bob.vercel.app/lib/logo-gs.jpg zurueck (gleiche Kette wie bisher).
insert into gs_branding (partner_id, firmenname, logo_url, akzentfarbe, fusszeile, aktiv)
select null,
       'George Solutions',
       'lib/logo-gs.jpg',
       '#C9A961',
       'George Solutions · Sanitaer, Heizung, Klima · Zuerich · george-solutions.ch',
       true
where not exists (select 1 from gs_branding where partner_id is null and aktiv);

-- Kontrolle nach dem Lauf:
--   select id, partner_id, firmenname, akzentfarbe, logo_url, aktiv from gs_branding;
