-- ═══════════════════════════════════════════════════════════════════════════
-- ENTWURF — Projekt je Tageszeile. NICHT AUSGEFUEHRT.
-- scripts/tageszeile_projekt_ENTWURF.sql | Stand 24.08.2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- KURZFASSUNG FUER DEN MASTER
--   Fuer Teil C1 ist NICHTS zu migrieren. Der bestehende Constraint
--   UNIQUE(projekt_id, techniker_user_id, datum) erlaubt bereits genau das,
--   was gefordert ist, und weist genau das ab, was abgewiesen werden soll.
--   Abschnitt 1 belegt das rein lesend.
--
--   Uebrig bleibt eine echte, aber ANDERE Luecke (Abschnitt 2): fuer Zeilen
--   ohne projekt_id greift der Constraint gar nicht. Die zugehoerige DDL steht
--   unten AUSKOMMENTIERT, weil sie eine fachliche Entscheidung verlangt, die
--   noch nicht getroffen ist.
--
-- ───────────────────────────────────────────────────────────────────────────
-- NAMENSPRUEFUNG (Eiserne Regel 7/8)
--   Es wird KEINE Tabelle angelegt. Kein CREATE TABLE, kein DROP TABLE,
--   kein DROP CONSTRAINT, kein ALTER COLUMN, kein REFERENCES, kein DELETE,
--   kein UPDATE. Abschnitt 1 ist reines SELECT. Abschnitt 2 ist auskommentiert
--   und waere, wenn eingeschaltet, ein rein additives CREATE UNIQUE INDEX
--   IF NOT EXISTS. Die beiden Indexnamen
--     idx_gs_tagesrapporte_service_tag_uniq
--     idx_gs_tagesrapporte_abwesenheit_tag_uniq
--   kommen in keiner .js/.html/.sql/.mjs des Repos vor (geprueft am 24.08.2026).
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- ABSCHNITT 1 — Nachweis, dass fuer C1 nichts zu tun ist (REIN LESEND)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Der Constraint heisst gs_tagesrapporte_projekt_id_techniker_user_id_datum_key
-- und steht seit scripts/rapport_system_migration.sql:64 unveraendert.
--
-- Er greift ueber DREI Spalten, nicht ueber zwei. Deshalb gilt:
--
--   Montag, Emanuel, Projekt A   +   Montag, Emanuel, Projekt B   -> ERLAUBT
--   Montag, Emanuel, Projekt A   +   Montag, Emanuel, Projekt A   -> 23505
--
-- Genau das verlangt C1. Live gegengeprueft am 24.08.2026 mit Wegwerfzeilen im
-- Jahr 2099 (danach geloescht):
--   1) Projekt 60133.00, 02.03.2099          -> 201
--   2) anderes Projekt, GLEICHER Tag         -> 201   <- mehrere Baustellen/Tag
--   3) Projekt 60133.00 nochmal, gleicher Tag-> 409 duplicate key
-- Und im Bestand: KW 34/2026 traegt 10 Zeilen an 7 Kalendertagen auf 4
-- Projekten, davon 2 Mehrfachtage. Das laeuft heute schon.

-- 1a) Wie sieht der Constraint wirklich aus?
select conname,
       pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'gs_tagesrapporte'::regclass
   and contype in ('u','p')
 order by conname;
-- Erwartet u.a.:
--   gs_tagesrapporte_projekt_id_techniker_user_id_datum_key
--   UNIQUE (projekt_id, techniker_user_id, datum)

-- 1b) Gibt es heute schon Kalendertage mit mehreren Projekten? (Ja.)
select techniker_user_id,
       datum,
       count(*)                            as zeilen,
       count(distinct projekt_id)           as projekte,
       sum(gesamtstunden)                   as stunden,
       max(spesen)                          as spesen_regelkonform,
       sum(spesen)                          as spesen_roh
  from gs_tagesrapporte
 where projekt_id is not null
 group by techniker_user_id, datum
having count(*) > 1
 order by datum;

-- 1c) Echte Dubletten (gleiches Projekt, gleicher Techniker, gleicher Tag).
--     Muss leer sein — sonst gaebe es den Constraint nicht.
select projekt_id, techniker_user_id, datum, count(*)
  from gs_tagesrapporte
 where projekt_id is not null
 group by projekt_id, techniker_user_id, datum
having count(*) > 1;


-- ═══════════════════════════════════════════════════════════════════════════
-- ABSCHNITT 2 — Die verbleibende Luecke: Zeilen OHNE projekt_id
-- ═══════════════════════════════════════════════════════════════════════════
--
-- BEFUND
--   In Postgres sind NULL-Werte in einem UNIQUE-Constraint zueinander distinct.
--   Fuer jede Zeile mit projekt_id IS NULL ist der Constraint deshalb wirkungslos.
--   Das betrifft zwei Sorten Zeilen, die der CHECK gs_tagesrapporte_bindung_chk
--   ausdruecklich zulaesst:
--     • Serviceauftrag-Zeilen (service_auftrag_id gesetzt)
--     • Abwesenheitszeilen    (abwesenheit gesetzt, z. B. 'F' Ferien)
--
--   Live gegengeprueft am 24.08.2026: zwei identische Abwesenheitszeilen fuer
--   denselben Techniker am selben Tag liessen sich beide anlegen (201, 201).
--
--   Folge im Code: die Klartextmeldung in api/cockpit.js saveTechTag
--   ("Fuer diesen Serviceauftrag besteht an diesem Tag bereits ein Eintrag")
--   kann heute gar nicht ausgeloest werden — der Konflikt entsteht nie.
--
-- BESTAND HEUTE (Stand 24.08.2026, live gezaehlt)
--   45 Tageszeilen: 31 mit Projekt, 14 Abwesenheit (KW 32/33 Ferien), 0 Service.
--   Dubletten in allen drei Gruppen: 0. Die Indizes wuerden also sauber greifen.
--
-- ───────────────────────────────────────────────────────────────────────────
-- OFFENE ENTSCHEIDUNG, BEVOR DAS HIER EINGESCHALTET WIRD
--
--   Darf ein Techniker an EINEM Kalendertag ZWEI verschiedene Abwesenheiten
--   tragen? Halber Tag Unfall, halber Tag Ferien — fachlich denkbar.
--
--   Variante A (der Index unten, wie er dasteht): hoechstens EINE
--     Abwesenheitszeile je Techniker und Tag. Streng, deckt den Ferienfall ab,
--     verbietet aber den geteilten Tag.
--   Variante B: UNIQUE ueber (techniker_user_id, datum, abwesenheit) — mehrere
--     Abwesenheiten je Tag erlaubt, aber dieselbe nicht doppelt.
--   Variante C: gar nichts tun. Der heutige Zustand.
--
--   Der Index unten ist Variante A. Bei Variante B die WHERE-Zeile behalten und
--   'abwesenheit' in die Spaltenliste aufnehmen.
--
-- WICHTIG: Beide Anweisungen sind AUSKOMMENTIERT. Sie gehoeren NICHT zu Teil C
-- und werden nicht ohne ausdrueckliche Ansage ausgefuehrt.
-- ───────────────────────────────────────────────────────────────────────────

-- Vorpruefung — muss zwei leere Ergebnisse liefern, sonst schlaegt der Index fehl.
select service_auftrag_id, techniker_user_id, datum, count(*)
  from gs_tagesrapporte
 where projekt_id is null and service_auftrag_id is not null
 group by service_auftrag_id, techniker_user_id, datum
having count(*) > 1;

select techniker_user_id, datum, count(*)
  from gs_tagesrapporte
 where projekt_id is null and service_auftrag_id is null and abwesenheit is not null
 group by techniker_user_id, datum
having count(*) > 1;

-- -- Serviceauftrag: hoechstens eine Zeile je (Auftrag, Techniker, Tag).
-- create unique index if not exists idx_gs_tagesrapporte_service_tag_uniq
--   on gs_tagesrapporte (service_auftrag_id, techniker_user_id, datum)
--   where projekt_id is null and service_auftrag_id is not null;
--
-- -- Abwesenheit: hoechstens eine Zeile je (Techniker, Tag) — Variante A.
-- create unique index if not exists idx_gs_tagesrapporte_abwesenheit_tag_uniq
--   on gs_tagesrapporte (techniker_user_id, datum)
--   where projekt_id is null and service_auftrag_id is null and abwesenheit is not null;
--
-- comment on index idx_gs_tagesrapporte_service_tag_uniq is
--   'Schliesst die NULL-Luecke von UNIQUE(projekt_id, techniker_user_id, datum) fuer Servicezeilen.';
-- comment on index idx_gs_tagesrapporte_abwesenheit_tag_uniq is
--   'Schliesst die NULL-Luecke fuer Abwesenheitszeilen. Variante A: eine Abwesenheit je Tag.';


-- ═══════════════════════════════════════════════════════════════════════════
-- ABSCHNITT 3 — Was ausdruecklich NICHT getan wird
-- ═══════════════════════════════════════════════════════════════════════════
--
--   • Der bestehende UNIQUE wird NICHT gedroppt und NICHT ersetzt. Er ist die
--     Duplikatsperre aus C1 und die Grundlage der Klartextmeldungen in
--     api/cockpit.js saveTechTag. Faellt er, faellt beides.
--   • gs_tagesrapporte.status wird nicht angefasst.
--   • Keine Zeile wird korrigiert, verschoben oder geloescht. Die vier Wochen
--     bleiben auf ihrem heutigen Projekt.
--   • Keine neue Tabelle, keine neue Spalte, keine neue Abhaengigkeit.
--
-- Kontrolle nach einem etwaigen Lauf von Abschnitt 2:
--   select indexname from pg_indexes
--    where tablename = 'gs_tagesrapporte' and indexname like '%_uniq';
