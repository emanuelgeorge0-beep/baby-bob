-- ============================================================================
-- George Solutions — Berichtsmodus M1 (Fundament)
-- scripts/berichtsmodus_m1.sql
--
-- STATUS: NICHT AUSGEFUEHRT. Papierrunde. Diese Datei ist das Ergebnis der
-- Modellierung, nicht eine eingespielte Migration. Sie wird ausschliesslich
-- MANUELL von Emanuel im Supabase-SQL-Editor ausgefuehrt — und erst, wenn die
-- offenen Punkte in docs/m1/annahmen.md beantwortet sind. Bis dahin liegt sie.
--
-- ADDITIV. Legt NEUE Tabellen an (Praefix gs_bericht_ / gs_berichte) und haengt
-- vier bestehenden Tabellen je zwei bis fuenf Spalten mit `add column if not
-- exists` an. Keine bestehende Spalte wird entfernt oder umgetypt, KEIN
-- DROP TABLE. Idempotent: mehrfaches Ausfuehren ist unschaedlich.
--
-- NAMENSPRUEFUNG (Eiserne Regel 7) — alle neun Tabellennamen und alle sechs
-- Funktionsnamen wurden vor dem Schreiben per grep ueber *.sql, *.js, *.mjs,
-- *.html, *.md, *.json geprueft, jeder mit 0 Treffern:
--   gs_berichte, gs_bericht_abschnitte, gs_bericht_bausteine,
--   gs_bericht_diktate, gs_bericht_uebersetzungen, gs_bericht_zusatzarbeit,
--   gs_bericht_kenntnisnahme, gs_bericht_nummernkreis, gs_bericht_ereignis
--   gs_bericht_nr_next, gs_bericht_zustand_wache, gs_bericht_inhalt_wache,
--   gs_bericht_kein_delete, gs_bericht_ereignis_wache, gs_bericht_touch
--
-- LESEHILFE
--   Teil 1  Bausteinkatalog          — der lebende Katalog (M2 fuellt ihn)
--   Teil 2  gs_berichte              — der Berichtskopf, Ownership + Zustand
--   Teil 3  gs_bericht_abschnitte    — der Text-Snapshot
--   Teil 4  Diktat / Uebersetzung / Zusatzarbeit / Kenntnisnahme
--   Teil 5  Nummernkreis             — Zaehler + Ziehfunktion
--   Teil 6  gs_bericht_ereignis      — Auditspur, append-only
--   Teil 7  Die Wachen               — Trigger, die die Regeln erzwingen
--   Teil 8  extern_* / Export-Idempotenz auf vier Tabellen
--   Teil 9  RLS
--   Teil 10 Selbsttest (auskommentiert)
--
-- Begruendung jeder Entscheidung: docs/m1/architektur.md
-- Offene Fragen mit Kennung:      docs/m1/annahmen.md
-- Saetze, die wahr sein muessen:  docs/m1/testplan.md
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- TEIL 0 — VORPRUEFUNG
-- Muster: scripts/taetigkeiten_katalog.sql:33-72 und scripts/rapportnummer.sql:39-61.
-- Das Skript bricht ab, statt auf halbem Weg etwas Halbes zu hinterlassen.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'gs_projekte') then
    raise exception 'berichtsmodus_m1: gs_projekte fehlt — zuerst rapport_system_migration.sql';
  end if;
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'gs_kunden') then
    raise exception 'berichtsmodus_m1: gs_kunden fehlt — zuerst setup_auth.sql';
  end if;
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'gs_tagesrapporte') then
    raise exception 'berichtsmodus_m1: gs_tagesrapporte fehlt — zuerst rapport_system_migration.sql';
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- TEIL 1 — BAUSTEINKATALOG. Der lebende Katalog.
-- ═══════════════════════════════════════════════════════════════════════════

-- Vorbild woertlich: gs_taetigkeitenkatalog (scripts/taetigkeiten_katalog.sql:96-151).
-- Von dort uebernommen und hier bewusst gleich gehalten:
--   slug        ist stabil und wird NIE geaendert (dort :100)
--   text        ist frei aenderbar (dort heisst das Feld bezeichnung, :101)
--   aktiv       deaktivieren statt loeschen (dort :106)
--   unique      je Besitzer, nicht global (dort unique(gewerk,slug), :146)
--
-- partner_user_id NULL = globaler Baustein, der allen gehoert. Gesetzt = ein
-- Baustein, den ein Partnerbetrieb sich selbst angelegt hat. Muster gs_branding
-- (scripts/branding_tabelle.sql:26-27) — und wie dort BEWUSST OHNE Fremdschluessel
-- auf auth.users: eine Partner-Tabelle existiert nicht, einen Partner gibt es nur
-- als auth.users-ID (scripts/branding_tabelle.sql:19-22).
-- ACHTUNG Namenswahl: die Architektur vom 03.09. nennt die Spalte partner_id.
-- Hier heisst sie partner_user_id, weil JEDE bestehende Besitzpruefung im Code
-- exakt diesen Namen liest (gs_projekte.partner_user_id,
-- scripts/rapport_system_migration.sql:26; gs_kunden.partner_user_id,
-- scripts/partner_kunden_scope.sql:17). Siehe docs/m1/annahmen.md, A-01.
--
-- KEINE Bausteintexte in diesem Skript. Die Texte kommen von Emanuel und sind M2.
create table if not exists gs_bericht_bausteine (
  id              uuid primary key default gen_random_uuid(),
  partner_user_id uuid,                            -- NULL = global (siehe oben)
  gewerk          text,                            -- sanitaer | heizung | lueftung | klima | allgemein
  kategorie       text,
  slug            text not null,                   -- stabil, nie aendern
  text            text not null,                   -- der Baustein selbst, frei aenderbar
  sortierung      int  not null default 0,
  aktiv           boolean not null default true,   -- deaktivieren statt loeschen
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Zwei Teilindizes, weil NULL in einem gewoehnlichen unique-Index nicht mit NULL
-- kollidiert — Muster scripts/branding_tabelle.sql:42-45.
create unique index if not exists idx_gs_bericht_bausteine_slug_global
  on gs_bericht_bausteine (slug) where partner_user_id is null;
create unique index if not exists idx_gs_bericht_bausteine_slug_partner
  on gs_bericht_bausteine (partner_user_id, slug) where partner_user_id is not null;
create index if not exists idx_gs_bericht_bausteine_auswahl
  on gs_bericht_bausteine (gewerk, kategorie, sortierung) where aktiv;

-- BEWUSST KEIN check auf gewerk, obwohl gs_taetigkeitenkatalog einen hat
-- (scripts/taetigkeiten_katalog.sql:136-138). Dort ist die Liste der fuenf Gewerke
-- gesetzt; ob der Berichtsmodus dieselben fuenf braucht, ist offen (L-04).
-- Ein check wuerde eine Vollstaendigkeit behaupten, die niemand geprueft hat.

comment on table  gs_bericht_bausteine is
  'Lebender Bausteinkatalog. Bausteine werden NIE geloescht, nur aktiv=false. Berichte lesen nie hier, sondern aus gs_bericht_abschnitte.text_snapshot.';
comment on column gs_bericht_bausteine.slug is
  'Stabile Kennung. Wird nach dem Anlegen nie geaendert — Muster gs_taetigkeitenkatalog.slug.';


-- ═══════════════════════════════════════════════════════════════════════════
-- TEIL 2 — gs_berichte. Der Berichtskopf.
-- ═══════════════════════════════════════════════════════════════════════════

-- WARUM partner_user_id NOT NULL, und warum das der Kern dieser Runde ist.
-- Heute gibt es genau EINE Eigentuemerachse im System: gs_projekte.partner_user_id
-- (scripts/rapport_system_migration.sql:26). Alles Abgeleitete haengt ueber
-- projekt_id daran — gs_tagesrapporte hat selbst keine Besitzspalte
-- (scripts/rapport_system_migration.sql:41-65), gs_wochenberichte auch nicht
-- (scripts/wochenbericht.sql:52-91). Jede Besitzpruefung im Code joint deshalb
-- auf das Projekt: requireOwnedProjekt (api/cockpit.js:196-201),
-- darfProjekt (api/wochenbericht.js:371-375), partnerProjektIds
-- (api/tagesrapport.js:334-337).
--
-- Fuer den Berichtsmodus ist projekt_id ausdruecklich NULLABLE (Beschluss 03.09.).
-- Damit faellt genau diese Achse weg: ein Bericht ohne Projekt haette nach dem
-- heutigen Muster ueberhaupt keinen Eigentuemer. Deshalb traegt der Bericht seinen
-- Mandanten selbst, und zwar NOT NULL. Eine Berichtszeile ohne Eigentuemer darf
-- nicht entstehen koennen — dann kann auch kein vergessener Endpunkt eine anlegen.
--
-- Der Wert kommt serverseitig aus scope.partnerId (api/cockpit.js:181-189), also
-- aus user.id des gegen /auth/v1/user verifizierten Tokens (api/cockpit.js:136-141),
-- NIE aus dem Request-Body. Gegenbeispiel, das genau daran scheitert:
-- api/projekte.js:117 uebernimmt partner_user_id roh aus dem Body.
create table if not exists gs_berichte (
  id                 uuid primary key default gen_random_uuid(),

  -- ── Ownership ──────────────────────────────────────────────────────────
  partner_user_id    uuid not null,                -- der Mandant. Siehe oben.
  projekt_id         uuid references gs_projekte(id) on delete set null,
  kunde_id           uuid references gs_kunden(id)   on delete set null,
  erstellt_von       uuid not null,                 -- auth.users-ID des Erzeugers
  freigegeben_von    uuid,                          -- wer freigegeben hat
  versendet_von      uuid,                          -- wer versendet hat

  -- ── Identitaet ─────────────────────────────────────────────────────────
  -- bericht_nr wird NUR vom Trigger vergeben, nur beim Uebergang nach
  -- 'freigegeben', nur serverseitig, nur online. Siehe Teil 5 und Teil 7.
  bericht_nr         text,
  bericht_seq        int,                           -- die rohe Zahl hinter bericht_nr
  titel              text,
  datum              date not null default current_date,

  -- ── Zustand. Kette ohne Rueckweg: entwurf -> freigegeben -> versendet ──
  -- Der check ist NUR eine Werteliste. Die Einbahn erzwingt der Trigger
  -- gs_bericht_zustand_wache in Teil 7 — ein check kennt den Vorzustand nicht.
  zustand            text not null default 'entwurf'
                       check (zustand in ('entwurf','freigegeben','versendet')),
  freigegeben_am     timestamptz,
  versendet_am       timestamptz,

  -- ── Fassung / Ersatz ───────────────────────────────────────────────────
  -- Ein freigegebener Bericht wird nie korrigiert, sondern ersetzt. Die neue
  -- Fassung zeigt auf die alte. on delete restrict, weil eine ersetzte Fassung
  -- nicht verschwinden darf, solange die Nachfolgerin auf sie zeigt.
  fassung            int not null default 1 check (fassung >= 1),
  ersetzt_bericht_id uuid references gs_berichte(id) on delete restrict,

  -- ── Nachweis ───────────────────────────────────────────────────────────
  -- inhalt_hash wird beim Uebergang nach 'freigegeben' vom Trigger aus den
  -- Abschnitten berechnet, nicht vom Server geliefert. Begruendung:
  -- docs/m1/architektur.md, Abschnitt 4. Das ist der Unterschied zwischen
  -- einem Dokument und einem Nachweis, und genau das fehlt heute bei
  -- gs_wochenberichte (kein Hash, nur pdf_bytes/pdf_path,
  -- lib/wochenbericht.js:2106-2107).
  inhalt_hash        text,
  pdf_path           text,

  geloescht_am       timestamptz,                   -- Soft-Delete, Muster runde8a
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Die Nummer ist je Partnerbetrieb eindeutig. NICHT global: zwei Betriebe duerfen
-- dieselbe laufende Nummer haben, sie sind getrennte Nummernkreise.
create unique index if not exists idx_gs_berichte_nr_partner
  on gs_berichte (partner_user_id, bericht_nr) where bericht_nr is not null;
create unique index if not exists idx_gs_berichte_seq_partner
  on gs_berichte (partner_user_id, bericht_seq) where bericht_seq is not null;

-- Eine Fassung ersetzt hoechstens EINEN Bericht, und ein Bericht wird hoechstens
-- EINMAL ersetzt. Ohne diesen Index entstehen Ketten mit zwei Nachfolgerinnen,
-- und dann ist nicht mehr entscheidbar, welche gilt.
create unique index if not exists idx_gs_berichte_ersetzt_einmal
  on gs_berichte (ersetzt_bericht_id) where ersetzt_bericht_id is not null;

create index if not exists idx_gs_berichte_partner   on gs_berichte (partner_user_id, zustand, datum desc);
create index if not exists idx_gs_berichte_projekt   on gs_berichte (projekt_id) where projekt_id is not null;
create index if not exists idx_gs_berichte_offen     on gs_berichte (partner_user_id, datum desc) where geloescht_am is null;

-- Zeitstempel und Zustand duerfen sich nicht widersprechen. Das ist billig zu
-- pruefen und faengt jeden Schreibpfad ab, der den Trigger umgeht.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gs_berichte_zustand_zeit_chk') then
    alter table gs_berichte add constraint gs_berichte_zustand_zeit_chk check (
      (zustand = 'entwurf'     and freigegeben_am is null and versendet_am is null and bericht_nr is null)
   or (zustand = 'freigegeben' and freigegeben_am is not null and versendet_am is null and bericht_nr is not null)
   or (zustand = 'versendet'   and freigegeben_am is not null and versendet_am is not null and bericht_nr is not null)
    );
  end if;
end $$;

-- Eine Fassung > 1 muss sagen, was sie ersetzt. Fassung 1 darf nichts ersetzen.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gs_berichte_fassung_chk') then
    alter table gs_berichte add constraint gs_berichte_fassung_chk check (
      (fassung = 1 and ersetzt_bericht_id is null)
   or (fassung > 1 and ersetzt_bericht_id is not null)
    );
  end if;
end $$;

comment on table  gs_berichte is
  'Taetigkeitsbericht. Eigener Modus, unabhaengig vom Tagesrapport. projekt_id darf null sein — deshalb traegt der Bericht seinen Mandanten selbst (partner_user_id NOT NULL).';
comment on column gs_berichte.zustand is
  'entwurf -> freigegeben -> versendet. Kein Rueckweg. Erzwungen von gs_bericht_zustand_wache, nicht vom check.';
comment on column gs_berichte.inhalt_hash is
  'SHA-256 ueber die Abschnitte in Reihenfolge, berechnet beim Uebergang nach freigegeben. Beweist, dass der ausgelieferte Text der freigegebene ist.';


-- ═══════════════════════════════════════════════════════════════════════════
-- TEIL 3 — gs_bericht_abschnitte. Der Text-Snapshot.
-- ═══════════════════════════════════════════════════════════════════════════

-- Vorbild woertlich: gs_tagesrapport_taetigkeitenkatalog
-- (scripts/taetigkeiten_katalog.sql:156-201). Der Kommentar dort, :154-155, ist
-- die Regel dieses Hauses: "bezeichnung_snapshot ist PFLICHT: Katalogaenderungen
-- duerfen bereits erfasste Rapporte nie rueckwirkend veraendern — Anzeige liest
-- immer den Snapshot."
--
-- Woertlich uebernommen:
--   text_snapshot NOT NULL            (dort bezeichnung_snapshot NOT NULL, :176)
--   FK auf den Katalog ON DELETE SET NULL   (dort :194-198)
--   FK auf den Kopf   ON DELETE CASCADE     (dort :185-190)
--
-- EINE Sache wird bewusst ANDERS gemacht. Der Bestand kopiert NUR die Bezeichnung
-- und joint fuer detailfelder weiter auf den lebenden Katalog
-- (api/cockpit.js:2953, ausgewertet :2957). Dadurch wirkt eine Katalogaenderung
-- an detailfelder heute DOCH rueckwirkend auf die Bearbeitungsmaske alter
-- Rapporte. Fuer einen Nachweis ist das nicht tragbar, deshalb wird hier ALLES
-- kopiert, was jemals angezeigt wird: Text, Titel, Kategorie, Gewerk, Reihenfolge.
-- Der Lesepfad darf dann NIE joinen — genau so, wie es lib/wochenbericht.js:279-290
-- schon richtig macht (dort gibt es gar keinen Join).
create table if not exists gs_bericht_abschnitte (
  id             uuid primary key default gen_random_uuid(),
  bericht_id     uuid not null references gs_berichte(id) on delete cascade,

  -- Herkunft. Darf verschwinden, ohne den Bericht zu beschaedigen.
  baustein_id    uuid references gs_bericht_bausteine(id) on delete set null,

  -- Der Snapshot. Ab hier ist der Bericht vom Katalog unabhaengig.
  text_snapshot      text not null,
  titel_snapshot     text,
  kategorie_snapshot text,
  gewerk_snapshot    text,
  slug_snapshot      text,

  -- Was der Techniker zusaetzlich erfasst hat (Menge, Ort, DN …). Eigenstaendige
  -- Erfassung, keine Kopie — Muster details in
  -- scripts/taetigkeiten_katalog.sql:162.
  details        jsonb not null default '{}'::jsonb,

  -- herkunft trennt, wie der Abschnitt entstanden ist. Fuer die Beweisfuehrung
  -- wichtig: ein diktierter Absatz ist etwas anderes als ein angetippter Baustein.
  herkunft       text not null default 'baustein'
                   check (herkunft in ('baustein','diktat','frei')),

  sortierung     int not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists idx_gs_bericht_abschnitte_bericht
  on gs_bericht_abschnitte (bericht_id, sortierung);

comment on column gs_bericht_abschnitte.text_snapshot is
  'PFLICHT. Vollstaendiger Text zum Zeitpunkt des Einfuegens. Der Lesepfad liest NUR hier — nie in gs_bericht_bausteine.';
comment on column gs_bericht_abschnitte.baustein_id is
  'Nur Herkunftsnachweis. on delete set null: verschwindet der Baustein, bleibt der Abschnitt vollstaendig lesbar.';


-- ═══════════════════════════════════════════════════════════════════════════
-- TEIL 4 — DIKTAT, UEBERSETZUNG, ZUSATZARBEIT, KENNTNISNAHME
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 4.1  gs_bericht_diktate ─────────────────────────────────────────────────
-- Rohtext und Vorschlag getrennt. Der Rohtext ist das, was die Spracherkennung
-- geliefert hat, der Vorschlag das, was daraus gemacht wurde. Beide bleiben
-- stehen: wer spaeter fragt "hat der Techniker das wirklich gesagt", muss den
-- Rohtext sehen koennen, nicht nur das Ergebnis.
-- requires_review: der Vorschlag darf nie ungeprueft in einen Bericht wandern.
create table if not exists gs_bericht_diktate (
  id               uuid primary key default gen_random_uuid(),
  bericht_id       uuid references gs_berichte(id) on delete cascade,
  partner_user_id  uuid not null,                 -- eigener Mandant: ein Diktat kann vor dem Bericht da sein
  erfasst_von      uuid not null,
  rohtext          text not null,                 -- unveraendert, wie erkannt
  vorschlag        text,                          -- daraus abgeleiteter Textvorschlag
  requires_review  boolean not null default true, -- nie ungeprueft uebernehmen
  uebernommen_am   timestamptz,
  abschnitt_id     uuid references gs_bericht_abschnitte(id) on delete set null,
  quelle           text,                          -- z.B. browser_sr | elevenlabs — Liste offen, L-09
  created_at       timestamptz not null default now()
);
create index if not exists idx_gs_bericht_diktate_bericht on gs_bericht_diktate (bericht_id);
create index if not exists idx_gs_bericht_diktate_partner on gs_bericht_diktate (partner_user_id, created_at desc);

comment on column gs_bericht_diktate.rohtext is
  'Unveraendert, wie erkannt. Wird nie ueberschrieben — auch nicht, wenn der Vorschlag korrigiert wird.';


-- ── 4.2  gs_bericht_uebersetzungen ──────────────────────────────────────────
-- Beilage. Deutsch bleibt verbindlich. Das ist keine Absichtserklaerung im
-- Kommentar, sondern ein check: eine deutsche Zeile kann in dieser Tabelle gar
-- nicht entstehen. Damit ist strukturell ausgeschlossen, dass jemand spaeter eine
-- "deutsche Uebersetzung" ablegt und sie mit dem Original verwechselt.
create table if not exists gs_bericht_uebersetzungen (
  id            uuid primary key default gen_random_uuid(),
  bericht_id    uuid not null references gs_berichte(id) on delete cascade,
  abschnitt_id  uuid references gs_bericht_abschnitte(id) on delete cascade,
  sprache       text not null check (sprache <> 'de' and sprache = lower(sprache)),
  text          text not null,
  maschinell    boolean not null default true,   -- maschinell oder von Hand
  erstellt_von  uuid,
  created_at    timestamptz not null default now()
);
create index if not exists idx_gs_bericht_uebersetzungen_bericht
  on gs_bericht_uebersetzungen (bericht_id, sprache);

comment on table gs_bericht_uebersetzungen is
  'Beilage, nie das Original. Der check sprache <> ''de'' macht es unmoeglich, eine deutsche Fassung hier abzulegen — Deutsch bleibt verbindlich.';


-- ── 4.3  gs_bericht_zusatzarbeit ────────────────────────────────────────────
-- RECHTLICH OFFEN. Welche Angaben eine Regiearbeit tragen MUSS, damit sie
-- gegenueber einer Bauleitung durchsetzbar ist, wartet auf fachjuristische
-- Rueckmeldung (docs/m1/annahmen.md, L-14 bis L-18).
-- Deshalb: Felder anlegen, KEIN NOT NULL ausser der Zuordnung und dem typ.
-- Sobald die Antwort da ist, setzt ein Nachtrag die NOT NULL — das geht additiv.
-- Umgekehrt waere es nicht gegangen: ein zu frueh gesetztes NOT NULL wirft beim
-- Nachtrag echte Zeilen raus.
--
-- typ ist auf 'regie' festgenagelt, nicht als Vorrat offengelassen. Wenn spaeter
-- eine zweite Art dazukommt, ist das eine bewusste Erweiterung des checks, kein
-- stilles Hineinrutschen.
create table if not exists gs_bericht_zusatzarbeit (
  id                uuid primary key default gen_random_uuid(),
  bericht_id        uuid not null references gs_berichte(id) on delete cascade,
  typ               text not null default 'regie' check (typ = 'regie'),

  -- Ab hier alles nullable — bewusst, siehe oben.
  beschreibung      text,
  angeordnet_von    text,          -- Name/Funktion der anordnenden Person
  angeordnet_am     timestamptz,
  angeordnet_wie    text,          -- muendlich | schriftlich | … Liste offen, L-15
  stunden           numeric(6,2),
  ansatz            numeric(10,2),
  material          text,
  bemerkung         text,
  beleg_pfad        text,          -- Foto/Scan der Anordnung, falls vorhanden

  created_at        timestamptz not null default now()
);
create index if not exists idx_gs_bericht_zusatzarbeit_bericht
  on gs_bericht_zusatzarbeit (bericht_id);

comment on table gs_bericht_zusatzarbeit is
  'Regiearbeit. Pflichtfeldlogik BEWUSST offen (fachjuristische Rueckmeldung ausstehend, docs/m1/annahmen.md L-14..L-18). NOT NULL wird spaeter additiv nachgetragen.';


-- ── 4.4  gs_bericht_kenntnisnahme ───────────────────────────────────────────
-- Wer hat den Bericht zur Kenntnis genommen. Nicht zu verwechseln mit dem
-- Versand: versendet heisst "abgeschickt", Kenntnisnahme heisst "angeschaut oder
-- quittiert". Der Bestand kennt diesen Unterschied nicht — versand_protokoll
-- fuehrt nur ok=true im Sinne von "Resend hat 2xx geliefert" (lib/mail.js:43),
-- also Annahme durch den Provider, nicht Zustellung und schon gar nicht Kenntnis.
create table if not exists gs_bericht_kenntnisnahme (
  id                uuid primary key default gen_random_uuid(),
  bericht_id        uuid not null references gs_berichte(id) on delete cascade,
  empfaenger_email  text,
  empfaenger_name   text,
  rolle             text,                  -- bauleitung | kunde | intern — Liste offen, L-19
  token             text,                  -- Freigabelink, mit dem geoeffnet wurde
  geoeffnet_am      timestamptz,
  quittiert_am      timestamptz,
  quittiert_von     text,                  -- Name, wie er beim Quittieren eingegeben wurde
  bemerkung         text,
  created_at        timestamptz not null default now()
);
create unique index if not exists idx_gs_bericht_kenntnisnahme_token
  on gs_bericht_kenntnisnahme (token) where token is not null;
create index if not exists idx_gs_bericht_kenntnisnahme_bericht
  on gs_bericht_kenntnisnahme (bericht_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- TEIL 5 — NUMMERNKREIS. Zaehler + Ziehfunktion.
-- ═══════════════════════════════════════════════════════════════════════════

-- Vorbild woertlich: gs_rapport_nummernkreis + gs_rapport_nr_next
-- (scripts/rapportnummer.sql:110-159). Das Verfahren dort ist nachweislich
-- rennsicher: INSERT … ON CONFLICT DO UPDATE … RETURNING nimmt eine Zeilensperre
-- auf den Zaehlerschluessel, zwei parallele Ziehungen serialisieren
-- (scripts/rapportnummer.sql:148-153).
--
-- ZWEI Unterschiede zum Vorbild, beide mit Grund:
--
-- 1. Der Schluessel ist der PARTNER, nicht das Kundenkuerzel. Beim Rapport ist der
--    PK (kuerzel, jahr) aus gs_kunden.kuerzel (scripts/rapportnummer.sql:110-116,
--    Aufloesung api/cockpit.js:2655-2670). Zwei Techniker desselben Betriebs auf
--    zwei Kunden laufen dort in zwei verschiedene Kreise. Fuer "durchgehend pro
--    Partnerbetrieb" ist das falsch. Hier ist der PK partner_user_id allein — auch
--    kein Jahresschnitt, weil "durchgehend" genau das heisst.
--
-- 2. LUECKENLOS. Beim Rapport sind Luecken ausdruecklich erlaubt: die Nummer wird
--    beim ANLEGEN gezogen (api/cockpit.js:2718-2721), und bei einem Race verfaellt
--    sie ersatzlos ("Die eben gezogene Nummer verfaellt dabei — gewollt, Luecken
--    sind erlaubt", api/cockpit.js:2736-2739). Hier wird die Nummer NICHT vom
--    Anwendungscode gezogen, sondern im BEFORE-UPDATE-Trigger, also in DERSELBEN
--    Transaktion wie der Zustandswechsel. Scheitert die Freigabe, rollt der
--    Zaehler mit zurueck — genau deshalb ist der Zaehler eine TABELLENZEILE und
--    keine Sequence: eine Sequence rollt NICHT zurueck und erzeugt Luecken.
--    Der Preis: Freigaben desselben Betriebs serialisieren. Das ist gewollt.
create table if not exists gs_bericht_nummernkreis (
  partner_user_id uuid primary key,
  letzte_nr       int not null default 0 check (letzte_nr >= 0),
  aktualisiert_am timestamptz not null default now()
);

comment on table gs_bericht_nummernkreis is
  'Ein Zaehler je Partnerbetrieb, durchgehend, ohne Jahresschnitt. Tabellenzeile statt Sequence, damit ein Rollback die Nummer zurueckgibt (Lueckenfreiheit).';

-- SECURITY DEFINER + fixer search_path — Muster scripts/rapportnummer.sql:134-140.
create or replace function gs_bericht_nr_next(p_partner uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nr int;
begin
  if p_partner is null then
    raise exception 'gs_bericht_nr_next: partner_user_id fehlt';
  end if;

  insert into gs_bericht_nummernkreis (partner_user_id, letzte_nr, aktualisiert_am)
  values (p_partner, 1, now())
  on conflict (partner_user_id)
  do update set letzte_nr       = gs_bericht_nummernkreis.letzte_nr + 1,
                aktualisiert_am = now()
  returning letzte_nr into v_nr;

  return v_nr;
end $$;

revoke all on function gs_bericht_nr_next(uuid) from public;
grant execute on function gs_bericht_nr_next(uuid) to service_role;

comment on function gs_bericht_nr_next(uuid) is
  'Zieht die naechste Berichtsnummer eines Partnerbetriebs. Rennsicher durch die Zeilensperre aus ON CONFLICT DO UPDATE. Wird vom Trigger gerufen, nicht vom Anwendungscode.';


-- ═══════════════════════════════════════════════════════════════════════════
-- TEIL 6 — gs_bericht_ereignis. Die Auditspur.
-- ═══════════════════════════════════════════════════════════════════════════

-- WARUM eine eigene Tabelle und nicht eine JSONB-Spalte wie versand_protokoll.
-- versand_protokoll auf gs_wochenberichte (scripts/wochenbericht_versand.sql:30-31)
-- ist als Betriebs-Log brauchbar, als Auditspur nicht. Belegt, nicht vermutet:
--   - Anhaengen ist ein Read-Modify-Write in JS ueber die ganze Spalte
--     (lib/wochenbericht.js:2033-2043). Der Code raeumt selbst ein, dass zwei
--     gleichzeitige Versande sich einen Eintrag ueberschreiben koennen
--     (lib/wochenbericht.js:2026-2031).
--   - Kein Trigger verbietet UPDATE oder DELETE auf der Spalte; der einzige
--     Trigger der Tabelle setzt updated_at (scripts/wochenbericht.sql:160-173).
--     Jedes PATCH kann das Array kuerzen — spurlos.
--   - Die Identitaet ist optional: von: userId || null (lib/wochenbericht.js:2101)
--     in einem JSONB ohne NOT NULL. Wie es richtig geht, steht im selben Repo:
--     gs_katalog_entscheidung.entschieden_von UUID NOT NULL
--     (scripts/rapportnummer.sql:211), gs_wochenrapport_log.geaendert_von NOT NULL
--     (scripts/wochenrapport_feinschliff.sql:69).
--   - Die Provider-ID wird weggeworfen: sendResendEmail liefert { ok, status, id }
--     (lib/mail.js:73-76), der Eintrag uebernimmt nur mail.ok
--     (lib/wochenbericht.js:2088, :2103). Ein Versand ist beim Provider hinterher
--     nicht mehr referenzierbar.
--
-- Diese Tabelle ist append-only. Erzwungen wird das in Teil 7 durch
-- gs_bericht_ereignis_wache — ein Trigger, der UPDATE und DELETE verbietet.
-- FK bewusst ON DELETE SET NULL statt CASCADE, damit das Protokoll den Verlust
-- des Objekts ueberlebt — Muster gs_wochenrapport_log
-- (scripts/wochenrapport_feinschliff.sql:60-73).
create table if not exists gs_bericht_ereignis (
  id               uuid primary key default gen_random_uuid(),
  bericht_id       uuid references gs_berichte(id) on delete set null,
  bericht_nr       text,                    -- mitgeschrieben, ueberlebt den FK-Verlust
  partner_user_id  uuid not null,
  art              text not null,           -- angelegt | freigegeben | versendet | kenntnisnahme | export | ersetzt
  akteur_user_id   uuid,                    -- NULL nur bei art='system'
  akteur_rolle     text,                    -- master | partner | techniker | system | extern
  am               timestamptz not null default now(),   -- DB-Zeit, EINE Uhr (siehe unten)
  kanal            text,                    -- mail | link | api | pdf
  absender         text,
  betreff          text,
  empfaenger       text[] not null default '{}',
  ergebnis_ok      boolean,
  provider_id      text,                    -- Resend-ID o.ae. — heute verworfen, hier gefuehrt
  provider_status  text,
  fehler           text,
  inhalt_hash      text,                    -- welcher Inhalt ging raus
  pdf_path         text,
  pdf_bytes        int,
  meta             jsonb not null default '{}'::jsonb
);

create index if not exists idx_gs_bericht_ereignis_bericht on gs_bericht_ereignis (bericht_id, am desc);
create index if not exists idx_gs_bericht_ereignis_partner on gs_bericht_ereignis (partner_user_id, am desc);

-- EINE Uhr. Der Bestand hat zwei Zeitquellen auf derselben Zeile: Node-Uhr fuer
-- am (lib/wochenbericht.js:2096) gegen DB-now() fuer updated_at
-- (scripts/wochenbericht.sql:166). Hier ist am default now(), also Datenbankzeit,
-- und der Server soll das Feld nicht setzen.
comment on column gs_bericht_ereignis.am is
  'Datenbankzeit (default now()). Der Server setzt dieses Feld NICHT — sonst gaebe es wieder zwei Uhren.';
comment on table gs_bericht_ereignis is
  'Append-only Auditspur. UPDATE und DELETE sind per Trigger gesperrt (gs_bericht_ereignis_wache).';


-- ═══════════════════════════════════════════════════════════════════════════
-- TEIL 7 — DIE WACHEN. Hier wird erzwungen, was oben nur behauptet ist.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Vorbemerkung, damit klar ist, warum das ueberhaupt in die Datenbank gehoert:
-- Der Server arbeitet ausnahmslos mit dem service_role-Key (api/cockpit.js:30,
-- api/tagesrapport.js:7-8, api/wochenbericht.js, api/projekte.js:4-5 u.a.). Dieser
-- Key umgeht RLS vollstaendig — das steht so im Repo
-- (scripts/wochenrapport_feinschliff.sql:51-52). RLS ist damit im gesamten
-- Serverpfad wirkungslos und taugt NICHT als Durchsetzung.
-- Ein Trigger dagegen greift auch beim service_role-Key. Er ist die einzige
-- Stelle, an der eine Regel gilt, ohne dass ein Endpunkt sie aufrufen muss.
--
-- Im Bestand gibt es KEINE einzige DB-seitig erzwungene Zustandskette: alle
-- Status-checks sind reine Wertelisten ohne Vorzustandsbezug
-- (scripts/wochenbericht.sql:71-72, scripts/wochenrapport_migration.sql:22,
-- scripts/service_minimal.sql:52-59). Die einzige Uebergangslogik liegt im
-- Anwendungscode (api/cockpit.js:5047-5092). Dass der Wochenbericht faktisch nicht
-- zurueckgesetzt wird, ist die ABWESENHEIT von Code, keine Garantie.
-- M4 ist nicht verhandelbar — also wird die Kette hier erzwungen.

-- ── 7.1  updated_at ─────────────────────────────────────────────────────────
-- Muster scripts/wochenbericht.sql:160-173.
create or replace function gs_bericht_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_gs_berichte_touch on gs_berichte;
create trigger trg_gs_berichte_touch
  before update on gs_berichte
  for each row execute function gs_bericht_touch();

drop trigger if exists trg_gs_bericht_bausteine_touch on gs_bericht_bausteine;
create trigger trg_gs_bericht_bausteine_touch
  before update on gs_bericht_bausteine
  for each row execute function gs_bericht_touch();


-- ── 7.2  Die Zustandswache ──────────────────────────────────────────────────
-- Sie leistet vier Dinge, und jedes einzelne waere ohne Trigger nicht erzwingbar:
--   (a) kein Rueckweg          — Rang darf nie sinken
--   (b) kein Sprung            — entwurf -> versendet direkt ist verboten
--   (c) Nummer + Hash          — werden beim Uebergang gezogen/berechnet, atomar
--   (d) Inhalt eingefroren     — ab 'freigegeben' sind Kopffelder unveraenderlich
create or replace function gs_bericht_zustand_wache()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alt   int;
  v_neu   int;
  v_kanon text;
  v_anz   int;
begin
  v_alt := case old.zustand when 'entwurf' then 0 when 'freigegeben' then 1 when 'versendet' then 2 end;
  v_neu := case new.zustand when 'entwurf' then 0 when 'freigegeben' then 1 when 'versendet' then 2 end;

  -- (a) kein Rueckweg.
  if v_neu < v_alt then
    raise exception 'Bericht %: Rueckweg % -> % ist nicht erlaubt', old.id, old.zustand, new.zustand
      using errcode = 'check_violation';
  end if;

  -- (b) kein Sprung ueber die Freigabe hinweg.
  if v_neu - v_alt > 1 then
    raise exception 'Bericht %: Sprung % -> % ist nicht erlaubt', old.id, old.zustand, new.zustand
      using errcode = 'check_violation';
  end if;

  -- (c) Uebergang entwurf -> freigegeben: Nummer ziehen, Inhalt hashen.
  if v_alt = 0 and v_neu = 1 then
    select count(*) into v_anz from gs_bericht_abschnitte where bericht_id = new.id;
    if v_anz = 0 then
      raise exception 'Bericht %: Freigabe ohne Abschnitte ist nicht moeglich', new.id
        using errcode = 'check_violation';
    end if;

    -- Der Hash wird HIER berechnet, nicht vom Server geliefert. Ein vom Server
    -- gelieferter Hash beweist nur, dass der Server rechnen kann.
    select coalesce(string_agg(a.sortierung || E'\x1f' || a.text_snapshot,
                               E'\x1e' order by a.sortierung, a.id), '')
      into v_kanon
      from gs_bericht_abschnitte a
     where a.bericht_id = new.id;

    new.inhalt_hash    := encode(sha256(convert_to(v_kanon, 'UTF8')), 'hex');
    new.freigegeben_am := coalesce(new.freigegeben_am, now());

    -- Nummer NUR hier, NUR einmal, in dieser Transaktion. Siehe Teil 5.
    if new.bericht_nr is null then
      new.bericht_seq := gs_bericht_nr_next(new.partner_user_id);
      new.bericht_nr  := 'B-' || lpad(new.bericht_seq::text, 6, '0');
    end if;

    if new.freigegeben_von is null then
      raise exception 'Bericht %: Freigabe ohne freigegeben_von ist nicht moeglich', new.id
        using errcode = 'not_null_violation';
    end if;
  end if;

  -- Uebergang freigegeben -> versendet.
  if v_alt = 1 and v_neu = 2 then
    new.versendet_am := coalesce(new.versendet_am, now());
    if new.versendet_von is null then
      raise exception 'Bericht %: Versand ohne versendet_von ist nicht moeglich', new.id
        using errcode = 'not_null_violation';
    end if;
  end if;

  -- (d) Ab 'freigegeben' ist der Kopf eingefroren. Aufgezaehlt statt pauschal,
  -- damit sichtbar bleibt, was sich noch aendern DARF (Zustand vorwaerts,
  -- Versandfelder, pdf_path, Export-Felder, Soft-Delete).
  if v_alt >= 1 then
    if new.partner_user_id   is distinct from old.partner_user_id
    or new.projekt_id        is distinct from old.projekt_id
    or new.kunde_id          is distinct from old.kunde_id
    or new.erstellt_von      is distinct from old.erstellt_von
    or new.bericht_nr        is distinct from old.bericht_nr
    or new.bericht_seq       is distinct from old.bericht_seq
    or new.titel             is distinct from old.titel
    or new.datum             is distinct from old.datum
    or new.fassung           is distinct from old.fassung
    or new.ersetzt_bericht_id is distinct from old.ersetzt_bericht_id
    or new.inhalt_hash       is distinct from old.inhalt_hash
    or new.freigegeben_am    is distinct from old.freigegeben_am
    or new.freigegeben_von   is distinct from old.freigegeben_von then
      raise exception 'Bericht % ist % — Kopfdaten sind eingefroren', old.id, old.zustand
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_gs_berichte_zustand on gs_berichte;
create trigger trg_gs_berichte_zustand
  before update on gs_berichte
  for each row execute function gs_bericht_zustand_wache();

-- Loeschen eines freigegebenen oder versendeten Berichts ist verboten. Sonst
-- entstuende genau die Luecke im Nummernkreis, die dieses Modell ausschliesst.
-- Zurueckgezogen wird ueber eine neue Fassung (ersetzt_bericht_id), nicht ueber
-- delete. geloescht_am bleibt fuer Entwuerfe der weiche Weg.
create or replace function gs_bericht_kein_delete()
returns trigger language plpgsql as $$
begin
  if old.zustand <> 'entwurf' then
    raise exception 'Bericht % ist % und darf nicht geloescht werden', old.id, old.zustand
      using errcode = 'check_violation';
  end if;
  return old;
end $$;

drop trigger if exists trg_gs_berichte_kein_delete on gs_berichte;
create trigger trg_gs_berichte_kein_delete
  before delete on gs_berichte
  for each row execute function gs_bericht_kein_delete();

-- Kindtabellen: Inhalt aendern nur, solange der Kopf Entwurf ist.
-- OLD und NEW werden getrennt behandelt. In PL/pgSQL ist OLD bei INSERT NICHT
-- zugewiesen — ein `case when tg_op='DELETE' then old.x else new.x end` wuerde
-- beim Insert zur Laufzeit scheitern, weil beide Zweige aufgeloest werden.
create or replace function gs_bericht_inhalt_wache()
returns trigger language plpgsql as $$
declare
  v_bericht uuid;
  v_zustand text;
begin
  if tg_op = 'DELETE' then
    v_bericht := old.bericht_id;
  else
    v_bericht := new.bericht_id;
  end if;

  select b.zustand into v_zustand from gs_berichte b where b.id = v_bericht;

  if v_zustand is not null and v_zustand <> 'entwurf' then
    raise exception 'Bericht ist % — Inhalt ist eingefroren (%, %)', v_zustand, tg_table_name, tg_op
      using errcode = 'check_violation';
  end if;

  -- Beim Verschieben eines Abschnitts in einen anderen Bericht muss auch der
  -- ALTE Kopf Entwurf sein, sonst liesse sich ein freigegebener Bericht durch
  -- Wegnehmen eines Abschnitts aushoehlen.
  if tg_op = 'UPDATE' and new.bericht_id is distinct from old.bericht_id then
    select b.zustand into v_zustand from gs_berichte b where b.id = old.bericht_id;
    if v_zustand is not null and v_zustand <> 'entwurf' then
      raise exception 'Herkunftsbericht ist % — Inhalt ist eingefroren', v_zustand
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_gs_bericht_abschnitte_frost on gs_bericht_abschnitte;
create trigger trg_gs_bericht_abschnitte_frost
  before insert or update or delete on gs_bericht_abschnitte
  for each row execute function gs_bericht_inhalt_wache();

drop trigger if exists trg_gs_bericht_zusatzarbeit_frost on gs_bericht_zusatzarbeit;
create trigger trg_gs_bericht_zusatzarbeit_frost
  before insert or update or delete on gs_bericht_zusatzarbeit
  for each row execute function gs_bericht_inhalt_wache();

-- Uebersetzungen sind BEWUSST nicht eingefroren: sie sind Beilage, nicht der
-- verbindliche Text. Eine Uebersetzung darf auch nach dem Versand noch entstehen,
-- ohne den deutschen Nachweis anzutasten. Deshalb kein Frost-Trigger hier.


-- ── 7.3  Die Auditwache. Append-only, wirklich. ─────────────────────────────
create or replace function gs_bericht_ereignis_wache()
returns trigger language plpgsql as $$
begin
  raise exception 'gs_bericht_ereignis ist append-only — % ist nicht erlaubt', tg_op
    using errcode = 'check_violation';
end $$;

drop trigger if exists trg_gs_bericht_ereignis_append_only on gs_bericht_ereignis;
create trigger trg_gs_bericht_ereignis_append_only
  before update or delete on gs_bericht_ereignis
  for each row execute function gs_bericht_ereignis_wache();


-- ═══════════════════════════════════════════════════════════════════════════
-- TEIL 8 — extern_system / extern_id und Export-Idempotenz
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WOZU JETZT. Kommt 2027 die Anbindung an ein bestehendes Verrechnungsprogramm,
-- ist die teuerste Frage nicht "wie rufen wir deren API", sondern "welche Zeile
-- bei uns ist welche Zeile bei denen, und haben wir sie schon geschickt".
-- Wer diese Felder erst dann anlegt, muss den gesamten Bestand nachtraeglich
-- zuordnen. Jetzt kosten sie zwei Spalten und einen Index.
--
-- GETRENNTE Felder, kein zusammengesetzter Text. Ein Feld "SYS:12345" laesst sich
-- nicht indizieren, nicht filtern und nicht migrieren, wenn ein zweites System
-- dazukommt.
--
-- Der Idempotenzschluessel ist (Mandant, Quellsystem, externe ID) — NICHT die
-- externe ID allein, die ist nur innerhalb eines Betriebs eindeutig. Genau so
-- steht es schon einmal im Repo: scripts/service_hub_ENTWURF.sql:241-246.
-- Dort heissen die Spalten source_system / external_order_id; hier heissen sie
-- extern_system / extern_id, weil der Rest dieses Moduls deutsch benannt ist.
-- Siehe docs/m1/annahmen.md, A-06.

-- ── 8.1  gs_projekte ────────────────────────────────────────────────────────
alter table gs_projekte add column if not exists extern_system         text;
alter table gs_projekte add column if not exists extern_id             text;
alter table gs_projekte add column if not exists extern_export_am      timestamptz;
alter table gs_projekte add column if not exists extern_export_status  text;
alter table gs_projekte add column if not exists extern_export_fehler  text;

create unique index if not exists idx_gs_projekte_extern_idem
  on gs_projekte (partner_user_id, extern_system, extern_id)
  where extern_id is not null;

-- ── 8.2  gs_kunden (= Kontakt) ──────────────────────────────────────────────
alter table gs_kunden add column if not exists extern_system         text;
alter table gs_kunden add column if not exists extern_id             text;
alter table gs_kunden add column if not exists extern_export_am      timestamptz;
alter table gs_kunden add column if not exists extern_export_status  text;
alter table gs_kunden add column if not exists extern_export_fehler  text;

create unique index if not exists idx_gs_kunden_extern_idem
  on gs_kunden (partner_user_id, extern_system, extern_id)
  where extern_id is not null;

-- ── 8.3  gs_tagesrapporte ───────────────────────────────────────────────────
-- ACHTUNG, offene Stelle: gs_tagesrapporte hat KEINE Mandantenspalte
-- (scripts/rapport_system_migration.sql:41-65) — der Besitz haengt ueber
-- projekt_id am Projekt. Der Idempotenzschluessel kann hier deshalb NICHT
-- (Mandant, System, ID) sein. Er ist bewusst (System, ID) ohne Mandant, was
-- korrekt ist, solange nur EIN Verrechnungsprogramm angebunden wird, aber
-- kollidiert, sobald zwei Betriebe dasselbe Fremdsystem mit eigenen ID-Raeumen
-- benutzen. Zwei Auswege, beide offen: docs/m1/annahmen.md, L-21.
alter table gs_tagesrapporte add column if not exists extern_system         text;
alter table gs_tagesrapporte add column if not exists extern_id             text;
alter table gs_tagesrapporte add column if not exists extern_export_am      timestamptz;
alter table gs_tagesrapporte add column if not exists extern_export_status  text;
alter table gs_tagesrapporte add column if not exists extern_export_fehler  text;

create unique index if not exists idx_gs_tagesrapporte_extern_idem
  on gs_tagesrapporte (extern_system, extern_id)
  where extern_id is not null;

-- ── 8.4  gs_berichte ────────────────────────────────────────────────────────
-- Hier ist der Mandant da (partner_user_id NOT NULL), der Schluessel also
-- vollstaendig.
alter table gs_berichte add column if not exists extern_system         text;
alter table gs_berichte add column if not exists extern_id             text;
alter table gs_berichte add column if not exists extern_export_am      timestamptz;
alter table gs_berichte add column if not exists extern_export_status  text;
alter table gs_berichte add column if not exists extern_export_fehler  text;

create unique index if not exists idx_gs_berichte_extern_idem
  on gs_berichte (partner_user_id, extern_system, extern_id)
  where extern_id is not null;

-- Der Status ist eine kleine, geschlossene Liste — anders als bei gewerk oben ist
-- hier nichts fachlich offen, ein Export kann nur diese vier Ausgaenge haben.
do $$
declare t text;
begin
  foreach t in array array['gs_projekte','gs_kunden','gs_tagesrapporte','gs_berichte'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_extern_status_chk') then
      execute format(
        'alter table %I add constraint %I check (extern_export_status is null or extern_export_status in (''offen'',''gesendet'',''bestaetigt'',''fehler''))',
        t, t || '_extern_status_chk');
    end if;
  end loop;
end $$;

comment on column gs_berichte.extern_id is
  'ID dieser Zeile im Fremdsystem. Zusammen mit extern_system und partner_user_id der Idempotenzschluessel — Muster scripts/service_hub_ENTWURF.sql:241-246.';


-- ═══════════════════════════════════════════════════════════════════════════
-- TEIL 9 — RLS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Ehrliche Einordnung, damit niemand sich darauf verlaesst: RLS ist im
-- Serverpfad WIRKUNGSLOS, weil jeder Endpunkt den service_role-Key benutzt
-- (api/cockpit.js:30, api/tagesrapport.js:7-8, api/projekte.js:4-5 …), und der
-- umgeht RLS — im Repo festgehalten in scripts/wochenrapport_feinschliff.sql:51-52.
-- RLS ist hier zweierlei und nicht mehr:
--   1. der Riegel gegen einen Direktzugriff aus dem Browser mit dem anon-Key,
--   2. die dokumentierte Absicht.
-- Die tatsaechliche Durchsetzung leisten die Trigger aus Teil 7 und die
-- Zugriffspruefung im Anwendungscode.
--
-- Anders als gs_wochenberichte (scripts/wochenbericht.sql:180-192, nur service +
-- admin) bekommt jede Tabelle hier ZUSAETZLICH eine Partner-Policy. Wenn der
-- Bericht ein Nachweis sein soll, muss die Datenbank sagen koennen, wem er gehoert.

do $$
declare t text;
begin
  foreach t in array array[
    'gs_berichte','gs_bericht_abschnitte','gs_bericht_bausteine','gs_bericht_diktate',
    'gs_bericht_uebersetzungen','gs_bericht_zusatzarbeit','gs_bericht_kenntnisnahme',
    'gs_bericht_nummernkreis','gs_bericht_ereignis'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists service_all on %I', t);
    execute format('create policy service_all on %I for all using (auth.role() = ''service_role'')', t);
  end loop;
end $$;

-- Partner sehen ihre eigenen Zeilen. Lesend — geschrieben wird ausschliesslich
-- serverseitig.
drop policy if exists partner_own on gs_berichte;
create policy partner_own on gs_berichte for select
  using (partner_user_id = auth.uid());

drop policy if exists partner_own on gs_bericht_diktate;
create policy partner_own on gs_bericht_diktate for select
  using (partner_user_id = auth.uid());

drop policy if exists partner_own on gs_bericht_ereignis;
create policy partner_own on gs_bericht_ereignis for select
  using (partner_user_id = auth.uid());

drop policy if exists partner_own on gs_bericht_nummernkreis;
create policy partner_own on gs_bericht_nummernkreis for select
  using (partner_user_id = auth.uid());

-- Die Kindtabellen ueber den Kopf.
do $$
declare t text;
begin
  foreach t in array array[
    'gs_bericht_abschnitte','gs_bericht_uebersetzungen',
    'gs_bericht_zusatzarbeit','gs_bericht_kenntnisnahme'
  ] loop
    execute format('drop policy if exists partner_own on %I', t);
    execute format(
      'create policy partner_own on %I for select using (exists (select 1 from gs_berichte b where b.id = bericht_id and b.partner_user_id = auth.uid()))', t);
  end loop;
end $$;

-- Bausteine: globale sieht jeder Angemeldete, eigene nur der Besitzer.
drop policy if exists partner_own on gs_bericht_bausteine;
create policy partner_own on gs_bericht_bausteine for select
  using (partner_user_id is null or partner_user_id = auth.uid());


-- ═══════════════════════════════════════════════════════════════════════════
-- TEIL 10 — SELBSTTEST. Auskommentiert, gehoert in scripts/test_berichtsmodus.mjs.
-- Die Saetze dahinter stehen in docs/m1/testplan.md.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- -- T-M3  Neun Tabellen sind da:
-- select table_name from information_schema.tables
--  where table_schema='public' and (table_name='gs_berichte' or table_name like 'gs_bericht_%')
--  order by 1;
--
-- -- T-Z1  Rueckweg wird abgewiesen (muss mit check_violation scheitern):
-- -- update gs_berichte set zustand='entwurf' where zustand='freigegeben';
--
-- -- T-N2  Lueckenlosigkeit je Partner:
-- select partner_user_id, count(*) as anzahl, max(bericht_seq) as hoechste
--   from gs_berichte where bericht_seq is not null
--  group by partner_user_id having count(*) <> max(bericht_seq);   -- muss 0 Zeilen liefern
--
-- -- T-S4  Kein Bericht ohne Mandant (muss 0 sein, sonst ist NOT NULL kaputt):
-- select count(*) from gs_berichte where partner_user_id is null;
--
-- ============================================================================
-- ENDE. Nicht ausfuehren, bevor docs/m1/annahmen.md beantwortet ist.
-- ============================================================================
