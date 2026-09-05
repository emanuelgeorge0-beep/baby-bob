-- ============================================================================
-- George Solutions — Material-Soll L2 (Datenmodell der drei Ebenen)
-- scripts/material_soll_l2.sql
--
-- STATUS: NICHT AUSGEFUEHRT. Papierrunde. Diese Datei ist das Ergebnis der
-- Modellierung, nicht eine eingespielte Migration. Sie wird ausschliesslich
-- MANUELL von Emanuel im Supabase-SQL-Editor ausgefuehrt — und erst, wenn die
-- offenen Punkte in docs/l2/annahmen.md beantwortet sind. Bis dahin bleibt sie
-- liegen.
--
-- ADDITIV. Legt nur NEUE Tabellen an (Praefix gs_mat_). Keine bestehende
-- Tabelle wird geaendert, keine Spalte entfernt, KEIN DROP TABLE. gs_material,
-- gs_gw_step, gs_bauabschnitte und gs_taetigkeitenkatalog bleiben unberuehrt.
-- Idempotent: mehrfaches Ausfuehren ist unschaedlich (if not exists ueberall,
-- Constraints und Seeds guarded).
--
-- NAMENSPRUEFUNG (Eiserne Regel 7) — alle neun Namen wurden vor dem Schreiben
-- per grep ueber *.sql, *.js, *.mjs, *.html, *.md geprueft, jeder mit 0 Treffern:
--   gs_mat_artikel, gs_mat_preis, gs_mat_zulassung, gs_mat_set_pos,
--   gs_mat_zone, gs_mat_position, gs_mat_regel, gs_mat_regel_lauf,
--   gs_mat_fachregel, gs_mat_befund
--
-- LESEHILFE. Die drei Ebenen sind bewusst getrennt:
--   A  Artikel        — was es gibt      → gs_mat_artikel + _preis + _zulassung + _set_pos
--   B  Kennzahlregeln — wieviel es braucht → gs_mat_regel + _regel_lauf
--   C  Fachregeln     — was zulaessig ist  → gs_mat_fachregel + _befund
-- Dazwischen steht die Position (gs_mat_position) als das, was am Ende auf der
-- Baustelle liegt, und die Zone (gs_mat_zone) als Traeger der Regel-Eingaben.
--
-- Begruendung jeder Entscheidung: docs/l2/modell.md
-- Offene fachliche Fragen:        docs/l2/annahmen.md
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- EBENE A — ARTIKEL. Was es gibt.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A.1  gs_mat_artikel ────────────────────────────────────────────────────
-- Muster: gs_taetigkeitenkatalog (scripts/taetigkeiten_katalog.sql:96-107).
-- Von dort uebernommen: slug ist stabil und wird nie geaendert, bezeichnung ist
-- frei aenderbar, aktiv=false statt Loeschen.
--
-- partner_id: NULL = globaler Katalogeintrag, der allen gehoert. Gesetzt = ein
-- Eintrag, den ein Partner sich selbst angelegt hat. Muster gs_branding
-- (scripts/branding_tabelle.sql:24-27). Wie dort BEWUSST OHNE Fremdschluessel:
-- einen Partner gibt es nur als auth.users-ID (gs_projekte.partner_user_id,
-- scripts/rapport_system_migration.sql:26), eine Partner-Tabelle existiert nicht.
--
-- dn und zoll sind getrennte Felder, kein Freitext. Ein Artikel darf beide
-- tragen, eines von beiden oder keines (z.B. ein Set).
-- presskontur ist ein eigenes Attribut (M/V), NICHT Teil der Bezeichnung.
-- verbindungsart steht bewusst NICHT hier, sondern auf der Position — siehe C.2.
create table if not exists gs_mat_artikel (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid,                          -- NULL = global (siehe oben)
  slug          text not null,                 -- stabil, nie aendern
  bezeichnung   text not null,                 -- frei aenderbar
  gewerk        text,                          -- sanitaer | heizung | lueftung | klima | allgemein
  kategorie     text,
  werkstoff     text,                          -- c_stahl | edelstahl | … Liste offen, siehe annahmen.md
  dn            int,                            -- Nennweite als Zahl, kein Freitext
  zoll          text,                           -- Zollmass getrennt (Bruchschreibweise) — siehe annahmen.md
  presskontur   text,                           -- 'M' | 'V' — eigenes Attribut, nicht kompatibel
  einheit       text not null default 'Stk',    -- Stk | m | …
  ist_set       boolean not null default false, -- true → Stueckliste in gs_mat_set_pos
  hersteller    text,
  aktiv         boolean not null default true,  -- deaktivieren statt loeschen
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Ein slug ist je Besitzer eindeutig. Zwei Teilindizes, weil NULL in einem
-- gewoehnlichen unique-Index nicht mit NULL kollidiert (Muster gs_branding,
-- scripts/branding_tabelle.sql:42-45): der globale Katalog braucht seine eigene
-- Eindeutigkeit, jeder Partner seine.
create unique index if not exists idx_gs_mat_artikel_slug_global
  on gs_mat_artikel (slug) where partner_id is null;
create unique index if not exists idx_gs_mat_artikel_slug_partner
  on gs_mat_artikel (partner_id, slug) where partner_id is not null;
create index if not exists idx_gs_mat_artikel_suche
  on gs_mat_artikel (gewerk, werkstoff, dn) where aktiv;

-- Bewusst KEIN check auf werkstoff und presskontur: Emanuel hat C-Stahl,
-- Edelstahl sowie die Konturen M und V genannt. Ob das die vollstaendige Liste
-- ist, ist offen (annahmen.md L-01, L-02). Ein check mit genau diesen Werten
-- wuerde eine Vollstaendigkeit behaupten, die niemand geprueft hat, und beim
-- Katalogimport (L3) Zeilen verwerfen, die fachlich richtig sind.


-- ── A.2  gs_mat_preis ──────────────────────────────────────────────────────
-- Zwei Preise je Artikel: Einzelpreis und Preis bei VPE-Abnahme.
-- Eigene Tabelle statt zwei Spalten am Artikel, weil derselbe Artikel bei
-- mehreren Lieferanten, in mehreren Laendern und mit Preisstaenden vorkommt.
-- Genau das ist der Fall, den Emanuel benennt: "Struktur ist uebertragbar,
-- deutsche Daten nicht — fuer die Schweiz braucht es SVGW und CHF".
-- land/waehrung folgen gs_projekte.land / .waehrung
-- (scripts/master_cockpit_migration.sql:25-26, Default 'CH' / 'CHF') und den
-- Regionen aus lib/regions.js:5-9 (CH, AT, DE, ES, GB).
create table if not exists gs_mat_preis (
  id                    uuid primary key default gen_random_uuid(),
  artikel_id            uuid not null references gs_mat_artikel(id) on delete cascade,
  lieferant             text not null,
  lieferanten_artikelnr text,
  land                  text not null default 'CH',
  waehrung              text not null default 'CHF',
  preis_einzel          numeric(12,4),          -- Preis je einheit bei Einzelabnahme
  preis_vpe             numeric(12,4),          -- Preis bei VPE-Abnahme — Bezugsgroesse offen, annahmen.md L-03
  vpe_menge             numeric(12,3),          -- wieviele einheit(en) eine VPE enthaelt
  vpe_einheit           text,                   -- Karton | Bund | Rolle | … (offen, annahmen.md L-04)
  gueltig_ab            date not null default current_date,
  gueltig_bis           date,
  quelle                text not null default 'manuell',  -- manuell | datanorm | …
  created_at            timestamptz not null default now()
);
create index if not exists idx_gs_mat_preis_artikel on gs_mat_preis (artikel_id);
create index if not exists idx_gs_mat_preis_gueltig on gs_mat_preis (artikel_id, land, gueltig_ab desc);


-- ── A.3  gs_mat_zulassung ──────────────────────────────────────────────────
-- Zulassungsstatus als Filter fuer Trinkwasser. Eigene Zeilen statt eines
-- Feldes am Artikel, weil ein Artikel mehrere Zulassungen gleichzeitig tragen
-- kann (dieselbe Rohrfamilie mit DVGW fuer DE und SVGW fuer CH) und weil eine
-- Zulassung ablaufen kann, ohne dass der Artikel verschwindet.
-- kuerzel bleibt Text: Emanuel hat DVGW und SVGW genannt; ob weitere Zeichen
-- gefuehrt werden muessen, ist offen (annahmen.md L-05).
create table if not exists gs_mat_zulassung (
  id          uuid primary key default gen_random_uuid(),
  artikel_id  uuid not null references gs_mat_artikel(id) on delete cascade,
  kuerzel     text not null,                    -- 'DVGW' | 'SVGW' | …
  land        text,                             -- fuer welchen Markt die Zulassung zaehlt
  status      text not null default 'gueltig'
                check (status in ('gueltig','abgelaufen','unbekannt')),
  nachweis    text,                             -- Registriernummer/Dokument, wenn vorhanden
  gueltig_bis date,
  created_at  timestamptz not null default now()
);
create index if not exists idx_gs_mat_zulassung_artikel on gs_mat_zulassung (artikel_id);
create index if not exists idx_gs_mat_zulassung_kuerzel on gs_mat_zulassung (kuerzel, land);


-- ── A.4  gs_mat_set_pos ────────────────────────────────────────────────────
-- Stueckliste eines Sets. Ein Set ist selbst ein Artikel (ist_set = true),
-- seine Bestandteile sind wieder Artikel — damit gilt fuer sie dieselbe
-- Fachregelpruefung (Werkstoff, Presskontur, Zulassung) wie fuer Einzelteile.
create table if not exists gs_mat_set_pos (
  id             uuid primary key default gen_random_uuid(),
  set_artikel_id uuid not null references gs_mat_artikel(id) on delete cascade,
  artikel_id     uuid not null references gs_mat_artikel(id) on delete restrict,
  menge          numeric(12,3) not null default 1,
  sortierung     int not null default 0
);
create index if not exists idx_gs_mat_set_pos_set on gs_mat_set_pos (set_artikel_id);

-- Ein Set darf sich nicht selbst enthalten. Verschachtelte Sets bleiben
-- moeglich; eine tiefere Zyklenpruefung gehoert in die Anwendung (Testplan T-A4).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gs_mat_set_pos_kein_selbstbezug') then
    alter table gs_mat_set_pos add constraint gs_mat_set_pos_kein_selbstbezug
      check (set_artikel_id <> artikel_id);
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- BAUSTRUKTUR — die Zone als Objekt.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Z.1  gs_mat_zone ───────────────────────────────────────────────────────
-- Heute ist "Zone" im Repo kein Objekt, sondern Text: gs_gw_step.zone
-- (scripts/gewerke_step_framework.sql:42, "Phasen-/Zonen-Gruppierung (optional)")
-- und gs_blockaden.zone (scripts/blockaden_migration.sql:26). Ein Freitextfeld
-- kann keine Eingaben tragen, an denen eine Regel rechnet — deshalb hier ein
-- eigenes Objekt.
--
-- Nicht zu verwechseln mit gs_bauabschnitte (scripts/zahlungssystem_migration.sql:8-24):
-- das ist die ZAHLUNGSseite (Betrag, Split-Profil, Escrow-Status), die zwar
-- einheit_typ 'zone' und 'giessrahmen' kennt, aber keine Geometrie fuehrt.
-- bauabschnitt_id ist deshalb nur ein optionaler Verweis, keine Pflicht — die
-- Materialzone existiert auch in Projekten ohne Zahlungsplan.
--
-- projekt_id ist die harte Klammer fuer die Datentrennung (Muster gs_blockaden,
-- scripts/blockaden_migration.sql:22). haus_id/einheit_id sind weiche Verweise,
-- weil das Gewerke-Step-Framework nicht in jedem Projekt angelegt ist.
--
-- region ist ein Parameter, keine Annahme: die Giessrahmen-Praxis gilt fuer die
-- Schweiz, in Oesterreich wird anders gebaut. Default 'CH' wie gs_projekte.land.
create table if not exists gs_mat_zone (
  id              uuid primary key default gen_random_uuid(),
  projekt_id      uuid not null references gs_projekte(id) on delete cascade,
  haus_id         uuid references gs_gw_haus(id) on delete set null,
  einheit_id      uuid references gs_gw_einheit(id) on delete set null,
  bauabschnitt_id uuid references gs_bauabschnitte(id) on delete set null,
  name            text not null,
  medium          text not null
                    check (medium in ('kaltwasser','warmwasser','zirkulation','abwasser','heizung')),
  region          text not null default 'CH',
  variante        text,                        -- Abwasser: 'A' | 'B' | 'C'; sonst NULL
  eingaben        jsonb not null default '{}'::jsonb,  -- Geschosse, Wohnungen je Geschoss, …
  notiz           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_gs_mat_zone_projekt on gs_mat_zone (projekt_id);
create index if not exists idx_gs_mat_zone_medium  on gs_mat_zone (projekt_id, medium);

comment on column gs_mat_zone.eingaben is
  'Rohwerte der Zone, an denen die Kennzahlregel rechnet. Beispiel Trinkwasser: '
  '{"geschosse":6,"wohnungen_je_geschoss":2,"geschosshoehe_m":3.5,'
  '"zk_letzte_entnahme_geschoss":5}. Struktur je Regel siehe gs_mat_regel.eingaben.';


-- ═══════════════════════════════════════════════════════════════════════════
-- DIE POSITION — zwei Mengen, eine Herkunft.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── P.1  gs_mat_position ───────────────────────────────────────────────────
-- Die zentrale Entscheidung dieser Runde: jede Position traegt die
-- VORGESCHLAGENE und die ERFASSTE Menge nebeneinander. Was der Techniker
-- eintraegt, gewinnt. Der Vorschlag bleibt daneben stehen. Die Abweichung ist
-- die auswertbare Groesse.
--
-- menge_gueltig und abweichung sind berechnete Spalten, damit keine Auswertung
-- und keine Anzeige die Vorrangregel neu erfinden kann. Muster: gs_material.gesamt
-- (scripts/master_cockpit_migration.sql:44, generated always as … stored).
--
-- Snapshot-Prinzip wie bei gs_tagesrapport_taetigkeitenkatalog
-- (scripts/taetigkeiten_katalog.sql:154-156: "Katalogaenderungen duerfen bereits
-- erfasste Rapporte nie rueckwirkend veraendern — Anzeige liest immer den
-- Snapshot"). Hier reicht der Bezeichnungs-Snapshot nicht: eine Position wird
-- bestellt und bezahlt, also muessen auch Masse und Preis eingefroren sein.
-- artikel_id ist deshalb on delete set null — die Position ueberlebt die
-- Katalogpflege (Muster gs_katalog_entscheidung, scripts/rapportnummer.sql:204-208).
--
-- verbindungsart steht HIER und nicht am Artikel: sie ist ein Attribut der
-- Position (Schweissmuffe oder Pressverbindung).
--
-- step_id: der Verweis laeuft von der Position zum Step, nicht umgekehrt.
-- gs_gw_step.material_ref (scripts/gewerke_step_framework.sql:49) ist eine
-- einzelne uuid und kann die vielen Positionen einer Zone nicht tragen.
-- Das bestehende Feld bleibt unberuehrt.
create table if not exists gs_mat_position (
  id                  uuid primary key default gen_random_uuid(),
  projekt_id          uuid not null references gs_projekte(id) on delete cascade,
  zone_id             uuid references gs_mat_zone(id) on delete set null,
  haus_id             uuid references gs_gw_haus(id) on delete set null,
  einheit_id          uuid references gs_gw_einheit(id) on delete set null,
  step_id             uuid references gs_gw_step(id) on delete set null,

  -- Artikelbezug + eingefrorener Zustand zum Zeitpunkt der Anlage
  artikel_id          uuid references gs_mat_artikel(id) on delete set null,
  bezeichnung_snapshot text not null,
  artikel_snapshot    jsonb not null default '{}'::jsonb,   -- slug, dn, zoll, presskontur, werkstoff, zulassungen
  preis_snapshot      jsonb not null default '{}'::jsonb,   -- preis_einzel, preis_vpe, vpe_menge, waehrung, lieferant, gueltig_ab
  einheit             text not null default 'Stk',

  -- Die zwei Mengen
  menge_vorschlag     numeric(12,3),
  menge_erfasst       numeric(12,3),
  menge_gueltig       numeric(12,3) generated always as (coalesce(menge_erfasst, menge_vorschlag)) stored,
  abweichung          numeric(12,3) generated always as (menge_erfasst - menge_vorschlag) stored,

  -- Woher die gueltige Menge stammt
  herkunft            text not null default 'gerechnet'
                        check (herkunft in ('gerechnet','erfasst','plan')),

  -- Aus welcher Regel der Vorschlag kommt (Kennung bleibt lesbar, auch wenn die
  -- Regel spaeter geaendert oder deaktiviert wird). Die beiden Fremdschluessel
  -- werden weiter unten nachgetragen, weil gs_mat_regel und gs_mat_regel_lauf
  -- erst in Ebene B entstehen — die Lesereihenfolge der Datei folgt den drei
  -- Ebenen, nicht der Abhaengigkeit.
  regel_id            uuid,
  regel_lauf_id       uuid,
  regel_slug_snapshot text,

  -- Fachliche Merkmale der Position
  verbindungsart      text check (verbindungsart in ('schweissmuffe','pressverbindung')),
  medium              text check (medium in ('trinkwasser','heizung','abwasser','kaelte')),

  -- Beschaffungs-/Bauzustand. Grobe Kette wie vorgegeben; die Mengen darunter
  -- tragen die Wahrheit bei Teillieferungen (siehe docs/l2/modell.md, Abschnitt
  -- "Zustandskette — Korrekturvorschlag").
  status              text not null default 'geplant'
                        check (status in ('geplant','bestellt','geliefert','verbaut')),
  menge_bestellt      numeric(12,3) not null default 0,
  menge_geliefert     numeric(12,3) not null default 0,
  menge_verbaut       numeric(12,3) not null default 0,

  -- Wer zuletzt geaendert hat
  geaendert_von       uuid references auth.users(id) on delete set null,
  geaendert_at        timestamptz not null default now(),

  notiz               text,
  created_at          timestamptz not null default now()
);
create index if not exists idx_gs_mat_position_projekt on gs_mat_position (projekt_id);
create index if not exists idx_gs_mat_position_zone    on gs_mat_position (zone_id);
create index if not exists idx_gs_mat_position_artikel on gs_mat_position (artikel_id);
create index if not exists idx_gs_mat_position_lauf    on gs_mat_position (regel_lauf_id);
-- Auswertung der Abweichung ueber viele Projekte: nur Zeilen, die beide Mengen tragen.
create index if not exists idx_gs_mat_position_abw
  on gs_mat_position (regel_slug_snapshot) where menge_erfasst is not null and menge_vorschlag is not null;

comment on column gs_mat_position.menge_gueltig is
  'Berechnet: erfasste Menge, sonst Vorschlag. Was der Techniker eintraegt, gewinnt immer.';
comment on column gs_mat_position.abweichung is
  'Berechnet: erfasst minus Vorschlag. NULL, solange eine der beiden Mengen fehlt. '
  'Das ist die Groesse, an der sich nach genug Projekten zeigt, ob die Kennzahl '
  'falsch war oder die Baustelle besonders.';
comment on column gs_mat_position.herkunft is
  'gerechnet = Vorschlag aus einer Kennzahlregel; erfasst = vom Techniker eingetragen; '
  'plan = aus einem gelesenen Plan. Das spaetere Planlesen fuellt dieselbe '
  'Vorschlagsspalte wie heute die Kennzahl — das Modell aendert sich dafuer nicht.';


-- ═══════════════════════════════════════════════════════════════════════════
-- EBENE B — KENNZAHLREGELN. Wieviel es braucht. Als Daten, nicht als Code.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── B.1  gs_mat_regel ──────────────────────────────────────────────────────
-- Eine Regel hat Eingaben, Parameter mit Standardwerten und erzeugt Positionen.
-- Region und Variante sind Auswahlparameter: region NULL heisst "gilt ueberall",
-- ein gesetzter Wert bindet die Regel an einen Markt.
--
-- partner_id wie beim Artikel: NULL = globale Regel, gesetzt = eigene Regel
-- eines Partners. Ein Partner kann eine globale Regel nicht aendern, sondern
-- legt eine eigene mit demselben slug an; die eigene gewinnt (Aufloesung in der
-- Anwendung, siehe docs/l2/modell.md).
--
-- version wird bei jeder inhaltlichen Aenderung hochgezaehlt. Der Regel-Lauf
-- haelt die Version fest, damit ein alter Vorschlag erklaerbar bleibt.
create table if not exists gs_mat_regel (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid,                             -- NULL = global
  slug        text not null,                    -- stabil, z.B. 'steigzone_trinkwasser'
  bezeichnung text not null,
  medium      text not null
                check (medium in ('trinkwasser','heizung','abwasser','kaelte')),
  region      text,                             -- NULL = gilt ueberall; 'CH', 'AT', …
  variante    text,                             -- 'A' | 'B' | 'C' beim Abwasser, sonst NULL
  eingaben    jsonb not null default '[]'::jsonb,
  parameter   jsonb not null default '[]'::jsonb,
  positionen  jsonb not null default '[]'::jsonb,
  version     int  not null default 1,
  aktiv       boolean not null default true,
  hinweis     text,                             -- was die Regel bewusst NICHT rechnet
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists idx_gs_mat_regel_slug_global
  on gs_mat_regel (slug, coalesce(region,''), coalesce(variante,'')) where partner_id is null;
create unique index if not exists idx_gs_mat_regel_slug_partner
  on gs_mat_regel (partner_id, slug, coalesce(region,''), coalesce(variante,'')) where partner_id is not null;

comment on column gs_mat_regel.eingaben is
  'Was die Zone liefern muss. Liste von {key,label,typ,pflicht,standard?}. '
  'standard ist ein Vorbelegungswert, kein abgeleiteter Wert.';
comment on column gs_mat_regel.parameter is
  'Stellschrauben der Rechnung. Liste von {key,label,standard,min?,max?,quelle}. '
  'quelle ist Pflicht und trennt Emanuels Praxis von Herstellerangaben: '
  'praxis | hersteller | offen. Ein Parameter mit standard=null und quelle=offen '
  'blockiert den Lauf absichtlich, bis der Wert da ist.';
comment on column gs_mat_regel.positionen is
  'Was die Regel erzeugt. Liste von {key,artikel_slug,einheit,ausdruck,bedingung?,notiz?}. '
  'ausdruck rechnet ueber die keys aus eingaben und parameter. Bedingung leer = immer.';


-- ── B.2  gs_mat_regel_lauf ─────────────────────────────────────────────────
-- Protokoll jedes Regeldurchlaufs. Ohne dieses Protokoll ist die Abweichung
-- spaeter nicht auswertbar: man saehe zwar, dass 12 statt 14 verbaut wurden,
-- aber nicht, mit welchen Eingaben und mit welchem Schellenabstand die 14
-- entstanden sind.
-- Muster: gs_katalog_entscheidung (scripts/rapportnummer.sql:202-215) — dort
-- steht der Vorschlag ebenfalls als jsonb-Snapshot und nicht als Verweis,
-- "weil die Auswertung wissen will, was in DEM Moment vorgeschlagen wurde".
create table if not exists gs_mat_regel_lauf (
  id                  uuid primary key default gen_random_uuid(),
  projekt_id          uuid not null references gs_projekte(id) on delete cascade,
  zone_id             uuid references gs_mat_zone(id) on delete set null,
  regel_id            uuid references gs_mat_regel(id) on delete set null,
  regel_slug_snapshot text not null,
  regel_version       int  not null,
  region              text,
  variante            text,
  eingaben            jsonb not null default '{}'::jsonb,   -- die tatsaechlichen Werte
  parameter           jsonb not null default '{}'::jsonb,   -- die tatsaechlich benutzten Werte inkl. Standard
  ergebnis            jsonb not null default '[]'::jsonb,   -- die erzeugten Positionen als Snapshot
  gelaufen_von        uuid references auth.users(id) on delete set null,
  gelaufen_at         timestamptz not null default now()
);
create index if not exists idx_gs_mat_regel_lauf_zone on gs_mat_regel_lauf (zone_id, gelaufen_at desc);
create index if not exists idx_gs_mat_regel_lauf_slug on gs_mat_regel_lauf (regel_slug_snapshot, gelaufen_at desc);

-- ── B.3  Nachgetragene Fremdschluessel der Position auf Ebene B ────────────
-- Beide on delete set null: wird eine Regel entfernt, bleibt die Position
-- bestehen und bleibt ueber regel_slug_snapshot erklaerbar.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gs_mat_position_regel_fkey') then
    alter table gs_mat_position add constraint gs_mat_position_regel_fkey
      foreign key (regel_id) references gs_mat_regel(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gs_mat_position_regel_lauf_fkey') then
    alter table gs_mat_position add constraint gs_mat_position_regel_lauf_fkey
      foreign key (regel_lauf_id) references gs_mat_regel_lauf(id) on delete set null;
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- EBENE C — FACHREGELN. Was zulaessig ist.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── C.1  gs_mat_fachregel ──────────────────────────────────────────────────
-- Jede Regel traegt ihre Begruendung als Text mit: Felix soll nicht nur
-- blockieren, sondern sagen, warum. begruendung ist deshalb not null.
--
-- quelle trennt, woher eine Aussage stammt. 'praxis' = Emanuels Praxiswissen,
-- 'hersteller' = Herstellerangabe (dann gehoert eine Referenz in quelle_ref),
-- 'offen' = noch niemand hat es festgelegt. Ein Normverweis wird bewusst NICHT
-- angeboten, solange keine Quelle vorliegt — eine geratene Normnummer waere
-- schlimmer als keine.
--
-- schwere: 'sperre' verhindert das Speichern, 'warnung' laesst es zu und
-- hinterlaesst einen Befund. Dieselbe Sachlage kann in einem Medium eine Sperre
-- und in einem anderen unauffaellig sein — das wird ueber zwei Regelzeilen mit
-- unterschiedlicher bedingung geloest, nicht ueber eine dritte Schwere.
create table if not exists gs_mat_fachregel (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid,                             -- NULL = global
  slug        text not null,
  bezeichnung text not null,
  typ         text not null
                check (typ in ('werkstoff_medium','presskontur','verbindungsart','zulassung')),
  bedingung   jsonb not null default '{}'::jsonb,
  schwere     text not null check (schwere in ('sperre','warnung')),
  begruendung text not null,                    -- der Satz, den Felix ausgibt
  quelle      text not null default 'offen'
                check (quelle in ('praxis','hersteller','offen')),
  quelle_ref  text,                             -- nur ausfuellen, wenn belegt
  aktiv       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists idx_gs_mat_fachregel_slug_global
  on gs_mat_fachregel (slug) where partner_id is null;
create unique index if not exists idx_gs_mat_fachregel_slug_partner
  on gs_mat_fachregel (partner_id, slug) where partner_id is not null;

-- Wer 'hersteller' sagt, muss sagen woher. Praxiswissen braucht keine Referenz.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gs_mat_fachregel_quelle_belegt') then
    alter table gs_mat_fachregel add constraint gs_mat_fachregel_quelle_belegt
      check (quelle <> 'hersteller' or (quelle_ref is not null and length(quelle_ref) > 0));
  end if;
end $$;

comment on column gs_mat_fachregel.bedingung is
  'Wann die Regel greift. Beispiel: {"werkstoff":"c_stahl","medium":"trinkwasser"}. '
  'Beim Typ presskontur gilt sie ueber mehrere Positionen einer Zone hinweg: '
  '{"gemischte_kontur_in_zone":true}.';


-- ── C.2  gs_mat_befund ─────────────────────────────────────────────────────
-- Eine verletzte Fachregel wird zur Zeile, nicht nur zur Fehlermeldung. Auch
-- eine Sperre hinterlaesst einen Befund: sonst waere spaeter nicht sichtbar,
-- wie oft jemand gegen dieselbe Wand gelaufen ist.
--
-- Uebersteuern ist nur bei 'warnung' erlaubt und nur mit Grund. Die Begruendung
-- wird mitgeschrieben (begruendung_snapshot), damit im Nachhinein der Text
-- steht, den der Nutzer damals gesehen hat — und nicht der, den die Regel heute
-- traegt. Gleiches Prinzip wie beim Positions-Snapshot.
create table if not exists gs_mat_befund (
  id                    uuid primary key default gen_random_uuid(),
  projekt_id            uuid not null references gs_projekte(id) on delete cascade,
  position_id           uuid references gs_mat_position(id) on delete cascade,
  zone_id               uuid references gs_mat_zone(id) on delete set null,
  fachregel_id          uuid references gs_mat_fachregel(id) on delete set null,
  fachregel_slug_snapshot text not null,
  begruendung_snapshot  text not null,
  schwere               text not null check (schwere in ('sperre','warnung')),
  status                text not null default 'offen'
                          check (status in ('offen','behoben','uebersteuert')),
  uebersteuert_von      uuid references auth.users(id) on delete set null,
  uebersteuert_grund    text,
  uebersteuert_at       timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists idx_gs_mat_befund_projekt  on gs_mat_befund (projekt_id, status);
create index if not exists idx_gs_mat_befund_position on gs_mat_befund (position_id);

-- Eine Sperre kann nicht uebersteuert werden, und Uebersteuern ohne Grund geht nicht.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gs_mat_befund_uebersteuerung') then
    alter table gs_mat_befund add constraint gs_mat_befund_uebersteuerung
      check (
        status <> 'uebersteuert'
        or (schwere = 'warnung'
            and uebersteuert_grund is not null and length(uebersteuert_grund) > 0
            and uebersteuert_at is not null)
      );
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — zweite Verteidigungslinie.
-- ═══════════════════════════════════════════════════════════════════════════
-- Die Endpunkte arbeiten mit dem Service-Key und setzen die Datentrennung im
-- Code durch (api/cockpit.js:196 requireOwnedProjekt, :208 requireOwnedRow,
-- ueber gs_projekte.partner_user_id). RLS ist die zweite Linie, exakt wie in
-- scripts/gewerke_step_framework.sql:64-111 beschrieben.
--
-- BEWUSST OHNE Techniker-Policy: gs_projekt_techniker fuehrt zwei
-- Zuweisungsspalten nebeneinander — techniker_user_id (auth.users,
-- scripts/rapport_system_migration.sql:38) und techniker_id (gs_techniker,
-- scripts/master_cockpit_session6_pm.sql:21). Eine Policy muesste sich fuer eine
-- entscheiden. Der Techniker-Zugriff laeuft ohnehin ueber den Service-Key; die
-- Policy kommt, wenn die Kette entschieden ist (annahmen.md L-16).
alter table gs_mat_artikel    enable row level security;
alter table gs_mat_preis      enable row level security;
alter table gs_mat_zulassung  enable row level security;
alter table gs_mat_set_pos    enable row level security;
alter table gs_mat_zone       enable row level security;
alter table gs_mat_position   enable row level security;
alter table gs_mat_regel      enable row level security;
alter table gs_mat_regel_lauf enable row level security;
alter table gs_mat_fachregel  enable row level security;
alter table gs_mat_befund     enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'gs_mat_artikel','gs_mat_preis','gs_mat_zulassung','gs_mat_set_pos',
    'gs_mat_zone','gs_mat_position','gs_mat_regel','gs_mat_regel_lauf',
    'gs_mat_fachregel','gs_mat_befund'
  ] loop
    execute format('drop policy if exists service_all on %I', t);
    execute format('create policy service_all on %I for all using (auth.role() = ''service_role'')', t);
    execute format('drop policy if exists admin_all on %I', t);
    execute format($p$create policy admin_all on %I for all using (
      exists (select 1 from user_roles where user_id = auth.uid() and role in ('gs_admin','master'))
    )$p$, t);
  end loop;
end $$;

-- Katalog + Regeln: Partner lesen global (partner_id is null) und ihr Eigenes.
do $$
declare t text;
begin
  foreach t in array array['gs_mat_artikel','gs_mat_regel','gs_mat_fachregel'] loop
    execute format('drop policy if exists partner_lesen on %I', t);
    execute format('create policy partner_lesen on %I for select using (partner_id is null or partner_id = auth.uid())', t);
    execute format('drop policy if exists partner_eigene_schreiben on %I', t);
    execute format('create policy partner_eigene_schreiben on %I for all using (partner_id = auth.uid()) with check (partner_id = auth.uid())', t);
  end loop;
end $$;

-- Projektbezogene Tabellen: Partner sieht nur eigene Projekte.
do $$
declare t text;
begin
  foreach t in array array['gs_mat_zone','gs_mat_position','gs_mat_regel_lauf','gs_mat_befund'] loop
    execute format('drop policy if exists partner_projekt on %I', t);
    execute format($p$create policy partner_projekt on %I for all using (
      exists (select 1 from gs_projekte p where p.id = %I.projekt_id and p.partner_user_id = auth.uid())
    )$p$, t, t);
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- SEED — die zwei Kennzahlregeln und die Fachregeln.
-- ═══════════════════════════════════════════════════════════════════════════
-- Nur Werte, die Emanuel genannt hat. Wo eine Zahl fehlt, steht standard: null
-- und quelle: "offen" — die Regel laeuft dann bewusst nicht durch, statt mit
-- einer erfundenen Zahl zu rechnen. Jede dieser Luecken ist in
-- docs/l2/annahmen.md einzeln benannt.
-- Guarded: legt nur an, was noch nicht da ist. Aendert nie einen bestehenden Wert.

-- ── S.1  Steigzone Trinkwasser (KW, WW, ZK) ────────────────────────────────
insert into gs_mat_regel (partner_id, slug, bezeichnung, medium, region, variante, eingaben, parameter, positionen, hinweis)
select null, 'steigzone_trinkwasser', 'Steigzone Trinkwasser (KW, WW, ZK)', 'trinkwasser', null, null,
$j$[
  {"key":"geschosse",                   "label":"Geschosse",                          "typ":"int",     "pflicht":true},
  {"key":"wohnungen_je_geschoss",       "label":"Wohnungen je Geschoss",              "typ":"int",     "pflicht":true},
  {"key":"geschosshoehe_m",             "label":"Geschosshoehe (m)",                  "typ":"numeric", "pflicht":true, "standard":3.5},
  {"key":"zk_letzte_entnahme_geschoss", "label":"ZK: letzte Entnahmestelle (Geschoss)","typ":"int",    "pflicht":true,
   "notiz":"Eingabe, kein abgeleiteter Wert. Die Zirkulation laeuft nur bis hierher."}
]$j$::jsonb,
$j$[
  {"key":"schellenabstand_m", "label":"Schellenabstand (m)", "standard":1.75, "min":1.5, "max":2.0, "quelle":"praxis"}
]$j$::jsonb,
$j$[
  {"key":"rohr_kw",     "artikel_slug":null, "einheit":"m",   "ausdruck":"geschosse * geschosshoehe_m",                     "notiz":"Strang Kaltwasser ueber alle Geschosse"},
  {"key":"rohr_ww",     "artikel_slug":null, "einheit":"m",   "ausdruck":"geschosse * geschosshoehe_m",                     "notiz":"Strang Warmwasser ueber alle Geschosse"},
  {"key":"rohr_zk",     "artikel_slug":null, "einheit":"m",   "ausdruck":"zk_letzte_entnahme_geschoss * geschosshoehe_m",   "notiz":"Zirkulation nur bis zur letzten Entnahmestelle"},
  {"key":"tstueck_kw",  "artikel_slug":null, "einheit":"Stk", "ausdruck":"geschosse * wohnungen_je_geschoss",               "notiz":"je Wohnung eines in KW"},
  {"key":"tstueck_ww",  "artikel_slug":null, "einheit":"Stk", "ausdruck":"geschosse * wohnungen_je_geschoss",               "notiz":"je Wohnung eines in WW"},
  {"key":"schellen_kw", "artikel_slug":null, "einheit":"Stk", "ausdruck":"ceil((geschosse * geschosshoehe_m) / schellenabstand_m)"},
  {"key":"schellen_ww", "artikel_slug":null, "einheit":"Stk", "ausdruck":"ceil((geschosse * geschosshoehe_m) / schellenabstand_m)"},
  {"key":"schellen_zk", "artikel_slug":null, "einheit":"Stk", "ausdruck":"ceil((zk_letzte_entnahme_geschoss * geschosshoehe_m) / schellenabstand_m)"}
]$j$::jsonb,
'In ZK bewusst KEINE T-Stuecke. Kein Verschnittzuschlag, keine Aufrundung auf '
'Stangenlaengen, keine Zugabe fuer Boegen oder Etagenversatz — alle vier sind '
'offen (annahmen.md L-06 bis L-09). artikel_slug ist ueberall null, weil der '
'Katalog (L3) noch nicht vorliegt; die Regel erzeugt bis dahin benannte '
'Positionen ohne Artikelbezug.'
where not exists (select 1 from gs_mat_regel where partner_id is null and slug = 'steigzone_trinkwasser');

-- ── S.2  Steigzone Abwasser, Variante B (Giessrahmen, Schweiz) ─────────────
-- Variante B ist in der Schweiz der Normalfall. Die Variante bestimmt die
-- Positionen, deshalb eine eigene Regelzeile je Variante statt einer Regel mit
-- Verzweigung: A und C erzeugen andere Positionen, nicht andere Zahlen.
-- Region ist hier gesetzt ('CH'), weil Emanuel die Giessrahmen-Praxis
-- ausdruecklich auf die Schweiz bezieht.
insert into gs_mat_regel (partner_id, slug, bezeichnung, medium, region, variante, eingaben, parameter, positionen, hinweis)
select null, 'steigzone_abwasser', 'Steigzone Abwasser — Variante B (Giessrahmen)', 'abwasser', 'CH', 'B',
$j$[
  {"key":"geschosse",             "label":"Geschosse",             "typ":"int",     "pflicht":true},
  {"key":"wohnungen_je_geschoss", "label":"Wohnungen je Geschoss", "typ":"int",     "pflicht":true},
  {"key":"geschosshoehe_m",       "label":"Geschosshoehe (m)",     "typ":"numeric", "pflicht":true, "standard":3.5}
]$j$::jsonb,
$j$[
  {"key":"schellenabstand_m",  "label":"Schellenabstand (m)",       "standard":null, "min":1.10, "max":1.50, "quelle":"offen",
   "notiz":"Emanuel: 110 bis 150 cm. Bei haengenden Leitungen richtet sich der Abstand nach dem Querschnitt — diese Zuordnung fehlt (annahmen.md L-10)."},
  {"key":"ausdehnungsmuffe_m", "label":"Abstand Ausdehnungsmuffe (m)","standard":null,"min":5.0,"max":6.0, "quelle":"offen",
   "notiz":"Emanuel: alle 5 bis 6 m. Ein Standardwert ist nicht genannt (annahmen.md L-11)."},
  {"key":"reduktion_dn",       "label":"Reduktion auf",             "standard":null, "auswahl":[56,63], "quelle":"offen",
   "notiz":"Emanuel: 110/56 oder 110/63. Wann welche, ist offen (annahmen.md L-12)."}
]$j$::jsonb,
$j$[
  {"key":"fallrohr_110",        "artikel_slug":null, "einheit":"m",   "ausdruck":"geschosse * geschosshoehe_m",
   "notiz":"Laengenformel aus der Trinkwasser-Angabe uebernommen — fuer Abwasser nicht ausdruecklich bestaetigt (annahmen.md L-13)."},
  {"key":"abzweiger_110_110_88","artikel_slug":null, "einheit":"Stk", "ausdruck":"geschosse * wohnungen_je_geschoss",
   "notiz":"Abzweiger 110/110/88 Grad, je Wohnung einer."},
  {"key":"bogen_30",            "artikel_slug":null, "einheit":"Stk", "ausdruck":"geschosse * wohnungen_je_geschoss",
   "notiz":"WC ueber 30-Grad-Bogen angeschlossen."},
  {"key":"abzweiger_zwischen",  "artikel_slug":null, "einheit":"Stk", "ausdruck":"geschosse * wohnungen_je_geschoss",
   "notiz":"Der weitere Abzweiger zwischen WC-Anschluss und Reduktion. Groesse nicht genannt (annahmen.md L-14)."},
  {"key":"reduktion_110",       "artikel_slug":null, "einheit":"Stk", "ausdruck":"geschosse * wohnungen_je_geschoss",
   "notiz":"Reduktion 110/56 oder 110/63 zum Waschtisch — Auswahl siehe Parameter reduktion_dn."},
  {"key":"anschluss_waschtisch","artikel_slug":null, "einheit":"Stk", "ausdruck":"geschosse * wohnungen_je_geschoss",
   "notiz":"Waschtisch 63/56."},
  {"key":"schellen",            "artikel_slug":null, "einheit":"Stk", "ausdruck":"ceil((geschosse * geschosshoehe_m) / schellenabstand_m)"},
  {"key":"ausdehnungsmuffen",   "artikel_slug":null, "einheit":"Stk", "ausdruck":"ceil((geschosse * geschosshoehe_m) / ausdehnungsmuffe_m)"}
]$j$::jsonb,
'Dusche ist in Variante B bewusst NICHT im Giessrahmen: das Gefaelle reicht '
'nicht, sie wird eingelegt und separat gefuehrt, oft zusammen mit der Kueche. '
'Diese separate Fuehrung ist noch keine Regel (annahmen.md L-15). Kaskade-Probe: '
'zwei Entnahmestellen im Rahmen (WC, Waschtisch) ergeben zwei Abzweiger je '
'Wohnung — das deckt sich mit der Positionsliste. Zwei Parameter haben '
'standard=null: die Regel laeuft absichtlich nicht durch, bis die Werte da sind.'
where not exists (select 1 from gs_mat_regel where partner_id is null and slug = 'steigzone_abwasser' and variante = 'B');

-- Varianten A und C sind NICHT geseedet. Sie haben dieselbe Regelstruktur,
-- aber eine andere Positionsliste, und die Positionen sind fuer A und C nicht
-- in dem Detail beschrieben wie fuer B (annahmen.md L-17).


-- ── S.3  Fachregeln ────────────────────────────────────────────────────────
insert into gs_mat_fachregel (partner_id, slug, bezeichnung, typ, bedingung, schwere, begruendung, quelle, aktiv)
select null, 'cstahl_nicht_trinkwasser', 'C-Stahl nicht fuer Trinkwasser', 'werkstoff_medium',
  '{"werkstoff":"c_stahl","medium":"trinkwasser"}'::jsonb, 'sperre',
  'C-Stahl ist fuer Trinkwasser nicht zugelassen, weil er korrodiert. Im geschlossenen '
  'Heizkreis ist das unkritisch, weil dort kein staendiger Wasser- und Sauerstoffnachschub '
  'ankommt — dort darf C-Stahl bleiben. Fuer Trinkwasser ist Edelstahl der Weg.',
  'praxis', true
where not exists (select 1 from gs_mat_fachregel where partner_id is null and slug = 'cstahl_nicht_trinkwasser');

insert into gs_mat_fachregel (partner_id, slug, bezeichnung, typ, bedingung, schwere, begruendung, quelle, aktiv)
select null, 'presskontur_nicht_mischen', 'Presskontur M und V nicht mischen', 'presskontur',
  '{"gemischte_kontur_in_zone":true,"verbindungsart":"pressverbindung"}'::jsonb, 'sperre',
  'Presskontur M und V sind nicht kompatibel. In derselben Presszone darf nur eine '
  'Kontur vorkommen, sonst passt das Pressbackenprofil nicht auf das Fitting.',
  'praxis', true
where not exists (select 1 from gs_mat_fachregel where partner_id is null and slug = 'presskontur_nicht_mischen');

-- Zulassungsregel: bewusst INAKTIV angelegt. Emanuel nennt den Zulassungsstatus
-- als FILTER fuer Trinkwasser — ob eine fehlende Zulassung das Speichern
-- verhindert (Sperre) oder nur warnt, hat er nicht gesagt. Die Zeile steht hier,
-- damit das Modell vollstaendig ist; sie greift erst, wenn die Schwere
-- entschieden ist (annahmen.md L-18). Bis dahin bleibt die Zulassung reiner
-- Katalogfilter (gs_mat_zulassung), keine Sperre.
insert into gs_mat_fachregel (partner_id, slug, bezeichnung, typ, bedingung, schwere, begruendung, quelle, aktiv)
select null, 'trinkwasser_zulassung_noetig', 'Trinkwasser braucht die Zulassung des Marktes', 'zulassung',
  '{"medium":"trinkwasser","zulassung_je_land":{"CH":"SVGW","DE":"DVGW"}}'::jsonb, 'warnung',
  'Fuer Trinkwasser zaehlt die Zulassung des jeweiligen Marktes: in der Schweiz SVGW, '
  'in Deutschland DVGW. Ein Artikel ohne die passende Zulassung gehoert nicht in eine '
  'Trinkwasserleitung.',
  'praxis', false
where not exists (select 1 from gs_mat_fachregel where partner_id is null and slug = 'trinkwasser_zulassung_noetig');

-- Edelstahl braucht keine Regel: er ist fuer beide Medien zugelassen, bei
-- Heizung die hochwertigere Variante, ueblich bei Kaelte, Spitaelern und
-- ueberall, wo Langlebigkeit vor Materialkosten geht. Es gibt nichts zu sperren
-- und nichts zu warnen — der Satz gehoert in die Begruendung der C-Stahl-Regel
-- und in Felix' Antwort, nicht in eine eigene Zeile.

-- Verbindungsart hat bewusst KEINE Regel: sie ist als Attribut der Position
-- benannt, aber welche Kombination unzulaessig waere, ist nicht gesagt
-- (annahmen.md L-19).


-- ============================================================================
-- PRUEFABFRAGEN nach dem Lauf (von Hand, lesend):
--   select table_name from information_schema.tables
--    where table_schema='public' and table_name like 'gs_mat_%' order by 1;   -- 10 Zeilen
--   select slug, medium, region, variante, version, aktiv from gs_mat_regel order by slug;
--   select slug, typ, schwere, quelle, aktiv from gs_mat_fachregel order by slug;
--   select count(*) from gs_material;      -- unveraendert gegenueber vorher
--   select count(*) from gs_gw_step;       -- unveraendert gegenueber vorher
-- ============================================================================
