-- ═══════════════════════════════════════════════════════════════════════════
-- scripts/rapport_feld.sql — Runde "Rapport Feld" (Branch feat/rapport-feld)
--
-- NICHT AUTOMATISCH AUSGEFÜHRT. Manuell im Supabase-SQL-Editor laufen lassen.
-- Reihenfolge egal, alle Blöcke sind einzeln wiederholbar (idempotent).
--
-- Enthält:
--   1. Abwesenheitskatalog erweitern  (Phase 1)
--   2. Datumsschranke für Tageszeilen (Phase 2)
--   3. Projekt-Status "unvollstaendig" + Fremdnummer (Phase 3)
--   4. Video: nur Kommentare, keine neue Spalte     (Phase 4)
--   5. Erinnerung an unvollständige Rapporte        (Phase 7)
--
-- Vor jedem CREATE TABLE wurde geprüft, ob der Name schon vergeben ist
-- (Eiserne Regel 7). Es wird KEINE Tabelle angelegt und KEINE gelöscht —
-- ausschliesslich ALTER TABLE ... ADD COLUMN IF NOT EXISTS und das Ersetzen
-- eines CHECK-Constraints.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. ABWESENHEITSKATALOG ERWEITERN                                (Phase 1)
-- ───────────────────────────────────────────────────────────────────────────
-- Bisher: G, F, M, U, A (scripts/wochenrapport_migration.sql).
-- Neu zusätzlich: K Krankheit, B Trauerfall, AR Arztbesuch, S Schule/Kurs,
--                 UB unbezahlter Urlaub, SW Schlechtwetter.
--
-- Die Liste im Code steht in lib/abwesenheit.js und MUSS mit dieser hier
-- übereinstimmen. Solange dieser Block nicht gelaufen ist, lehnt Postgres jede
-- Zeile mit einem der neuen Codes ab (23514); api/cockpit.js sagt dann
-- ausdrücklich, dass die Migration fehlt, statt „Abwesenheit und Baustelle".
--
-- Der alte Constraint wird ERSETZT, nicht gelöscht und offen gelassen: eine
-- Spalte ohne Prüfung nähme jeden Tippfehler an.

-- Was steht heute drin? (Kontrolle vor dem Umbau — erwartet nur G/F/M/U/A)
select abwesenheit, count(*) as zeilen
from gs_tagesrapporte
where abwesenheit is not null
group by abwesenheit
order by abwesenheit;

do $$
begin
  -- Der Constraint heisst je nach Entstehung anders; beide Namen abräumen.
  if exists (select 1 from pg_constraint where conname = 'gs_tagesrapporte_abwesenheit_check') then
    alter table gs_tagesrapporte drop constraint gs_tagesrapporte_abwesenheit_check;
  end if;
  if exists (select 1 from pg_constraint where conname = 'gs_tagesrapporte_abwesenheit_chk') then
    alter table gs_tagesrapporte drop constraint gs_tagesrapporte_abwesenheit_chk;
  end if;
  alter table gs_tagesrapporte
    add constraint gs_tagesrapporte_abwesenheit_chk
    check (abwesenheit is null or abwesenheit in
      ('G','F','M','U','A','K','B','AR','S','UB','SW'));
end $$;

comment on column gs_tagesrapporte.abwesenheit is
  'Abwesenheitsgrund. Katalog identisch mit lib/abwesenheit.js: G Gesetzl. Feiertag, '
  'F Ferien, M Militaer/Zivilschutz, U Unfall, A Absenz, K Krankheit, B Trauerfall, '
  'AR Arztbesuch, S Schule/Kurs, UB Unbezahlter Urlaub, SW Schlechtwetter. '
  'gesamtstunden traegt auf diesen Zeilen die ABWESENHEITSSTUNDEN und wird '
  'ueberall getrennt von den Arbeitsstunden gezaehlt.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. DATUMSSCHRANKE FÜR TAGESZEILEN                               (Phase 2)
-- ───────────────────────────────────────────────────────────────────────────
-- Die Prüfung läuft serverseitig in api/cockpit.js und api/tagesrapport.js
-- (aktuelles Jahr −1 bis +1). Dieser Block ist das Netz darunter, falls je
-- ein anderer Weg auf die Tabelle schreibt.
--
-- BEWUSST WEIT: 2000–2100 statt „Jahr ±1". Ein Constraint kann das laufende
-- Jahr nicht kennen (er müsste dafür auf now() zugreifen und wäre damit nicht
-- IMMUTABLE); und eine Schranke, die im Januar plötzlich Altzeilen ungültig
-- macht, wäre schlimmer als die Lücke, die sie schliesst. Er fängt genau den
-- Fall ab, um den es geht: Tippfehler wie 2099 oder 0202.
--
-- NOT VALID: bestehende Zeilen werden NICHT rückwirkend geprüft. Die eine
-- 2099er-Zeile (siehe scripts/fix_kw2099.sql) bleibt damit stehen, bis sie
-- bewusst angefasst wird.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'gs_tagesrapporte_datum_plausibel_chk') then
    alter table gs_tagesrapporte drop constraint gs_tagesrapporte_datum_plausibel_chk;
  end if;
  alter table gs_tagesrapporte
    add constraint gs_tagesrapporte_datum_plausibel_chk
    check (datum is null or (datum >= date '2000-01-01' and datum < date '2100-01-01'))
    not valid;
end $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. PROJEKT: STATUS "unvollstaendig" + FREMDNUMMER               (Phase 3)
-- ───────────────────────────────────────────────────────────────────────────
-- Ein aus dem Rapport heraus schnell angelegtes Projekt trägt nur eine
-- Bezeichnung. Es ist ein echtes Projekt, aber es fehlen Angaben — das steht
-- in einer eigenen Spalte und NICHT in gs_projekte.status, weil status den
-- Bauablauf beschreibt (aktiv/abgeschlossen) und nicht die Datenqualität.
--
-- fremdnummer bleibt LEER. Die Nummer des Auftraggebers wird nicht erfunden;
-- vergeben wird ausschliesslich eine provisorische interne Nummer
-- (projektnummer, Präfix siehe api/cockpit.js → naechsteProvisorischeNummer).
alter table gs_projekte
  add column if not exists unvollstaendig      boolean not null default false,
  add column if not exists fremdnummer         text,
  add column if not exists schnellanlage_von   uuid,
  add column if not exists schnellanlage_am    timestamptz;

comment on column gs_projekte.unvollstaendig is
  'true = im Rapport schnell angelegt, Pflichtangaben fehlen noch. Im Cockpit '
  'als solches gekennzeichnet und nachtragbar. Kein Bauablauf-Status.';
comment on column gs_projekte.fremdnummer is
  'Projektnummer des Auftraggebers. Wird NIE automatisch erzeugt — leer heisst leer.';

create index if not exists idx_gs_projekte_unvollstaendig
  on gs_projekte(unvollstaendig) where unvollstaendig;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. MEDIEN: VIDEO                                                (Phase 4)
-- ───────────────────────────────────────────────────────────────────────────
-- KEINE neue Spalte nötig. Live am 03.09.2026 gegengeprüft: gs_projekt_medien
-- trägt bereits medientyp, dauer_sekunden, thumbnail_path, groesse und mime.
-- Der Video-Upload benutzt genau diese fünf. Hier stehen deshalb nur die
-- Kommentare, damit die Bedeutung in der Datenbank dokumentiert ist.
comment on column gs_projekt_medien.medientyp is
  'foto | video. Video: mp4/mov, max 100 MB, max 120 s (Grenzen in api/cockpit.js).';
comment on column gs_projekt_medien.dauer_sekunden is
  'Nur bei medientyp = video. Grenze: 120 s.';
comment on column gs_projekt_medien.thumbnail_path is
  'Standbild zum Video, im selben Bucket. Wird beim Upload aus dem Video erzeugt.';
comment on column gs_projekt_medien.groesse is
  'Dateigroesse in Bytes. Video-Grenze: 104857600 (100 MB).';


-- ───────────────────────────────────────────────────────────────────────────
-- 5. ERINNERUNG AN UNVOLLSTAENDIGE RAPPORTE                       (Phase 7)
-- ───────────────────────────────────────────────────────────────────────────
-- Zwei Zeitstempel je Tageszeile. Sie sind der einzige Schutz gegen
-- Mehrfachversand: gesetzt heisst versendet, und der stuendliche Lauf
-- (api/rapport_erinnerung.js) ueberspringt die Zeile danach.
alter table gs_tagesrapporte
  add column if not exists erinnerung_24_am timestamptz,
  add column if not exists erinnerung_48_am timestamptz;

comment on column gs_tagesrapporte.erinnerung_24_am is
  'Zeitpunkt der ersten Erinnerung an die erfassende Person (24 h). NULL = noch keine.';
comment on column gs_tagesrapporte.erinnerung_48_am is
  'Zeitpunkt der zweiten und letzten Erinnerung (48 h). NULL = noch keine.';

-- Findet die Kandidaten schnell, ohne die ganze Tabelle zu lesen.
create index if not exists idx_gs_tagesrapporte_erinnerung
  on gs_tagesrapporte(created_at)
  where erinnerung_48_am is null and abwesenheit is null;

-- Der Mailtext, je Betrieb. Leer heisst: der neutrale Standardtext aus
-- lib/erinnerung.js gilt. Der Text darf die Lohnzahlung NICHT an die Abgabe
-- des Rapports knuepfen — api/cockpit.js weist solche Texte beim Speichern ab
-- (lib/erinnerung.js, erinnerungTextPruefen).
alter table gs_branding
  add column if not exists rapport_erinnerung_text text;

comment on column gs_branding.rapport_erinnerung_text is
  'Vorlage der Erinnerungsmail an unvollstaendige Rapporte. Platzhalter: '
  '{name} {anzahl} {liste} {stunden}. Leer = neutraler Standardtext aus lib/erinnerung.js. '
  'Darf keine Lohnzahlung an die Abgabe knuepfen.';


-- ───────────────────────────────────────────────────────────────────────────
-- KONTROLLE NACH DEM LAUF
-- ───────────────────────────────────────────────────────────────────────────
select conname, pg_get_constraintdef(oid) as regel
from pg_constraint
where conrelid = 'gs_tagesrapporte'::regclass
  and conname in ('gs_tagesrapporte_abwesenheit_chk', 'gs_tagesrapporte_datum_plausibel_chk')
order by conname;

select column_name, data_type, column_default
from information_schema.columns
where table_name = 'gs_projekte'
  and column_name in ('unvollstaendig', 'fremdnummer', 'schnellanlage_von', 'schnellanlage_am')
order by column_name;

select column_name, data_type
from information_schema.columns
where table_name in ('gs_tagesrapporte', 'gs_branding')
  and column_name in ('erinnerung_24_am', 'erinnerung_48_am', 'rapport_erinnerung_text')
order by table_name, column_name;

select column_name, data_type
from information_schema.columns
where table_name = 'gs_projekt_medien'
  and column_name in ('medientyp', 'dauer_sekunden', 'thumbnail_path', 'groesse', 'mime')
order by column_name;
