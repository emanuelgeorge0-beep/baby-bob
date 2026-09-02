-- ═══════════════════════════════════════════════════════════════════════════
-- scripts/fix_kw2099.sql — die Tageszeile mit Jahr 2099 sichtbar machen
--
-- NICHT AUSFÜHREN LASSEN, was hier auskommentiert steht. Dieses Skript ist
-- eine LISTE, kein Eingriff: alles bis auf den letzten Block sind reine
-- SELECTs. Der UPDATE steht bewusst auskommentiert da, weil niemand ausser
-- dem Techniker weiss, welcher Tag wirklich gemeint war.
--
-- ── Befund (live gelesen am 03.09.2026, nur SELECT) ───────────────────────
--   gs_tagesrapporte.id  37a88d0d-1d25-4f33-bd89-a5937851cd5e
--   datum                2099-03-02   → jahr 2099, woche 10
--   projekt              b6651bc5-…   = 60133.00 "Stofer Manuel"
--   techniker_user_id    730172f2-…
--   gesamtstunden        8.00   (07:00–16:15, 75 min Pause)
--   taetigkeit           Sanitär
--   status               eingereicht
--   created_at           2026-08-31 17:53 UTC
--   wochenrapport_id     ec8ae8b9-…   Kopf R-GSO-2099-0008, KW 10/2099
--
-- Es ist EINE Zeile, und sie hängt an einem eigenen Wochenkopf, der nur wegen
-- ihr entstanden ist. Ein Umdatieren zieht deshalb IMMER zwei Dinge nach sich:
-- jahr/woche der Zeile UND die Bindung an den richtigen Wochenkopf. Wer nur
-- `datum` setzt, hat die Zeile danach im Kalender richtig — und in der
-- Wochenansicht des Technikers immer noch nicht, weil die über jahr/woche
-- filtert. Genau deshalb steht hier kein schneller Einzeiler.
--
-- Ab dieser Runde kann so eine Zeile nicht mehr entstehen: die Jahresschranke
-- (aktuelles Jahr −1 bis +1) sitzt serverseitig in lib/datum.js und wird von
-- api/cockpit.js (Wochenblatt + Master-Korrektur) und api/tagesrapport.js
-- erzwungen; scripts/rapport_feld.sql legt zusätzlich einen CHECK auf die
-- Spalte. Die bestehende Zeile bleibt davon unberührt (NOT VALID).
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. ALLE Tageszeilen ausserhalb des plausiblen Jahresbereichs
-- ───────────────────────────────────────────────────────────────────────────
-- Nicht nur 2099: die Frage ist „was steht in der Zukunft/Vergangenheit",
-- nicht „steht 2099 drin". Erwartet wird heute genau eine Zeile.
select
  t.id,
  t.datum,
  t.jahr,
  t.woche,
  t.gesamtstunden,
  t.start_zeit,
  t.end_zeit,
  t.pause_minuten,
  t.taetigkeit,
  t.status,
  t.created_at,
  p.projektnummer,
  p.name              as projekt,
  tk.name             as techniker,
  t.wochenrapport_id,
  w.rapport_nr
from gs_tagesrapporte t
left join gs_projekte      p  on p.id  = t.projekt_id
left join gs_techniker     tk on tk.user_id = t.techniker_user_id
left join gs_wochenrapporte w on w.id  = t.wochenrapport_id
where t.datum < (date_trunc('year', now())::date - interval '1 year')
   or t.datum > (date_trunc('year', now())::date + interval '2 years' - interval '1 day')
order by t.datum;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Nur die 2099er-Zeile auf Projekt 60133.00 — der konkrete Fall
-- ───────────────────────────────────────────────────────────────────────────
select t.*
from gs_tagesrapporte t
join gs_projekte p on p.id = t.projekt_id
where t.jahr = 2099
  and p.projektnummer = '60133.00';


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Hängt an dieser Zeile ein eigener Wochenkopf? Und hängt sonst noch etwas?
-- ───────────────────────────────────────────────────────────────────────────
-- Wichtig vor jedem Umdatieren: bleibt der Kopf leer zurück, ist er Datenmüll;
-- hängen Fotos an der Zeile, wandern sie mit (sie zeigen auf tagesrapport_id).
select
  w.id                as wochenrapport_id,
  w.rapport_nr,
  w.jahr,
  w.woche,
  w.status,
  count(t.id)         as zeilen_am_kopf
from gs_wochenrapporte w
left join gs_tagesrapporte t on t.wochenrapport_id = w.id
where w.jahr = 2099
group by w.id, w.rapport_nr, w.jahr, w.woche, w.status;

select
  m.id, m.medientyp, m.path, m.created_at
from gs_projekt_medien m
where m.tagesrapport_id in (
  select t.id from gs_tagesrapporte t where t.jahr = 2099
);


-- ───────────────────────────────────────────────────────────────────────────
-- 4. KORREKTUR — AUSKOMMENTIERT. NICHT AUSFÜHREN, BEVOR DER TAG FESTSTEHT.
-- ───────────────────────────────────────────────────────────────────────────
-- Erst klären: welcher Kalendertag war wirklich gemeint? Die Zeile wurde am
-- 31.08.2026 erfasst, das legt eine Woche um den 31.08.2026 nahe — bewiesen
-- ist es nicht. Den Tag nennt der Techniker, nicht dieses Skript.
--
-- Danach in DIESER Reihenfolge, in EINER Transaktion:
--   a) Wochenkopf der Zielwoche holen oder anlegen (er kann schon bestehen)
--   b) Zeile umdatieren: datum, jahr, woche UND wochenrapport_id zusammen
--   c) den leer gewordenen 2099er-Kopf entfernen — aber nur, wenn er leer ist
--
-- <ZIELDATUM> durch den echten Tag ersetzen, z. B. '2026-08-31'.
--
-- begin;
--
-- -- a) Zielkopf bestimmen (legt keinen an, wenn schon einer existiert)
-- with ziel as (
--   select
--     '37a88d0d-1d25-4f33-bd89-a5937851cd5e'::uuid            as zeile_id,
--     date '<ZIELDATUM>'                                       as neues_datum,
--     '730172f2-c8a9-4cc4-90f7-98a96d283b48'::uuid            as tech_user
-- )
-- select
--   z.neues_datum,
--   extract(isoyear from z.neues_datum)::int as neues_jahr,
--   extract(week    from z.neues_datum)::int as neue_woche,
--   (select w.id from gs_wochenrapporte w
--     where w.techniker_user_id = z.tech_user
--       and w.jahr  = extract(isoyear from z.neues_datum)::int
--       and w.woche = extract(week    from z.neues_datum)::int
--     limit 1) as zielkopf_id
-- from ziel z;
--
-- -- b) Zeile umhängen. <ZIELKOPF_ID> ist das Ergebnis aus (a); ist es NULL,
-- --    muss zuerst ein Wochenkopf angelegt werden (gs_wochenrapporte) —
-- --    einfacher und sicherer ist es, den Techniker im Wochenblatt einmal
-- --    die Zielwoche oeffnen zu lassen, dann entsteht der Kopf von selbst.
-- update gs_tagesrapporte
--    set datum            = date '<ZIELDATUM>',
--        jahr             = extract(isoyear from date '<ZIELDATUM>')::int,
--        woche            = extract(week    from date '<ZIELDATUM>')::int,
--        wochenrapport_id = '<ZIELKOPF_ID>'::uuid
--  where id = '37a88d0d-1d25-4f33-bd89-a5937851cd5e';
--
-- -- c) Nur loeschen, wenn wirklich nichts mehr daran haengt. Kein DROP, kein
-- --    pauschales DELETE — die Bedingung ist der ganze Punkt.
-- delete from gs_wochenrapporte w
--  where w.id = 'ec8ae8b9-f32e-4403-81e0-51023fda9574'
--    and not exists (select 1 from gs_tagesrapporte t where t.wochenrapport_id = w.id);
--
-- -- Vor dem commit gegenpruefen: liefert Block 1 jetzt 0 Zeilen?
-- -- commit;   -- oder rollback;
