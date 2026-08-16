-- ============================================================
-- George Solutions — Serviceauftrag, Minimum
-- scripts/service_minimal.sql | MANUELL im Supabase SQL Editor ausfuehren.
-- Rein additiv. Kein DROP TABLE, kein DROP COLUMN, kein ALTER COLUMN.
-- Idempotent.
-- ============================================================
--
-- WARUM SO KLEIN. Im Repo gibt es KEINE Spezifikation der Serviceabteilung
-- (gesucht in allen *.md, in docs/, ueber alle Branches, im Dateinamen und im
-- Volltext; "Sandra", "Serviceabteilung" als Konzeptdokument, "Saeule 4" als
-- Spezifikation kommen nirgends vor). Deshalb hier nur das Minimum, das die
-- bereits vorhandenen Endpunkte brauchen — nichts Erfundenes.
--
-- Was die vorhandenen Endpunkte svcListe / svcDetail / svcCreate / svcStatus /
-- svcAssign / svcUnassign (api/cockpit.js:3771-3858) schemaseitig brauchen:
-- NICHTS. Sie laufen heute gegen gs_service_auftrag + gs_service_techniker.
--
-- Bleibt genau ein Punkt aus den vier genannten Eckpunkten, der zwingend ins
-- Schema muss: der fuenfte Status. Die uebrigen drei Eckpunkte brauchen keine
-- Schemaaenderung (Begruendung unten).

-- ══════════════════════════════════════════════════════════════════
-- 1. Fuenfter Status
-- ══════════════════════════════════════════════════════════════════
-- Heute erlaubt der CHECK vier Werte: neu | angenommen | abgelehnt | erledigt
-- (scripts/schema_rollen_foto_service.sql:107-108).
--
-- >>> HIER LESEN, BEVOR DU AUSFUEHRST <<<
-- Der Name des fuenften Status ist nicht spezifiziert. Ich habe ihn NICHT
-- geraten, sondern den einzigen Wert eingesetzt, der sich aus dem vorhandenen
-- Automaten zwingend ergibt: zwischen 'angenommen' und 'erledigt' fehlt der
-- Zustand, in dem der Techniker arbeitet. Heisst er bei euch anders
-- (z.B. 'in_bearbeitung', 'unterwegs', 'vor_ort'), aendere die eine Zeile
-- unten, bevor du das Skript laufen laesst.
--
-- Ein CHECK laesst sich nicht erweitern, nur ersetzen. Der Constraint wird
-- deshalb gedroppt und neu gesetzt — die vier Altwerte bleiben alle gueltig,
-- keine bestehende Zeile faellt durch, keine Spalte wird angefasst.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'gs_service_auftrag'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table gs_service_auftrag drop constraint %I', c);
  end loop;
end $$;

alter table gs_service_auftrag add constraint gs_service_auftrag_status_chk
  check (status in (
    'neu',
    'angenommen',
    'in_arbeit',     -- <<< der fuenfte Status. Namen hier anpassen, falls anders.
    'erledigt',
    'abgelehnt'
  ));

-- ══════════════════════════════════════════════════════════════════
-- 2. Die drei uebrigen Eckpunkte — warum hier NICHTS steht
-- ══════════════════════════════════════════════════════════════════
--
-- "Sandra ist partner-scoped Rolle"
--   Deckt das bestehende Modell bereits ab: ein Partner ist ein auth-User mit
--   Rolle 'gs_partner', und gs_service_auftrag.partner_user_id ist der
--   Mandantenschluessel. assertServiceAccess (api/cockpit.js:3534-3539)
--   erzwingt ihn serverseitig. Keine Schemaaenderung noetig.
--   OFFEN: falls mehrere Mitarbeiter EINER Partnerfirma getrennte Logins
--   brauchen und dieselben Auftraege sehen sollen, fehlt eine Firmenebene —
--   das ist ein eigener Entwurf und braucht die Spezifikation.
--
-- "Intake per E-Mail-Weiterleitung"
--   quelle erlaubt bereits 'mail' (schema_rollen_foto_service.sql:105-106).
--   Welche Felder aus der Mail uebernommen und wie Duplikate erkannt werden,
--   steht nicht fest — dafuer erst die Spezifikation.
--
-- "Pflicht-Abschlussflow"
--   Was Pflicht ist (Unterschrift? Fotos? Arbeitszeit? Bericht?), ist nicht
--   spezifiziert. Solange das offen ist, waere jede Spalte hier geraten.
--   Der Statuswechsel nach 'erledigt' laesst sich spaeter serverseitig an
--   Bedingungen knuepfen, ohne das Schema zu aendern.

-- ══════════════════════════════════════════════════════════════════
-- Kontrolle nach dem Lauf
-- ══════════════════════════════════════════════════════════════════
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'gs_service_auftrag'::regclass and contype = 'c';
--   select status, count(*) from gs_service_auftrag group by status;
