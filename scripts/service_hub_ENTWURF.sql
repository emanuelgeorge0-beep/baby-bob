-- ############################################################
-- #  E N T W U R F  —  N I C H T   A U S F U E H R E N       #
-- ############################################################
-- Diese Datei entstand, BEVOR klar war, dass es eine Spezifikation der
-- Serviceabteilung gibt. Sie ist aus dem Code abgeleitet und enthaelt
-- Annahmen (15 Status, Partner-Mitglieder, Objekt/Anlage, Sync-Metadaten),
-- die NICHT aus einer Spezifikation stammen.
--
-- Bis die Spezifikation vorliegt, gilt scripts/service_minimal.sql.
-- Diese Datei bleibt nur als Materialsammlung liegen.
-- ############################################################

-- ============================================================
-- George Solutions — Service Operations Hub (Entwurf)
-- MANUELL im Supabase SQL Editor ausfuehren.
-- Idempotent. Rein ADDITIV: keine Tabelle wird geloescht, keine Spalte
-- entfernt, keine bestehende Zeile veraendert.
-- ============================================================
--
-- AUSGANGSLAGE (geprueft, nicht vermutet)
--   gs_service_auftrag       existiert live, 12 Spalten, objekt ist Freitext
--   gs_service_techniker     existiert live, n:m Auftrag<->gs_techniker(id)
--   gs_tagesrapporte         hat service_auftrag_id  -> Zeiterfassung ist da
--   gs_projekt_medien        hat service_auftrag_id  -> Fotos sind da
--   gs_material              projekt_id ist NULLABLE  -> Service nachruestbar
--   gs_rapport_nr_next(k,j)  race-feste Nummernvergabe -> fuer SA- wiederverwendbar
--   gs_wochenberichte        hat quelle='service' + service_auftrag_id (ohne FK)
--
-- LEITSATZ. Es wird NICHTS parallel neu gebaut. Zeiten bleiben in
-- gs_tagesrapporte, Fotos in gs_projekt_medien, Material in gs_material,
-- Dokumentgestaltung in gs_branding. Diese Datei fuellt nur die Luecken:
-- Objekt/Anlage, Auftragstiefe, Timeline, Dokumente, Freigabelink,
-- Partner-Mehrbenutzer.
--
-- ZWEI DROPs kommen vor, beide zwingend und beide harmlos:
-- die CHECK-Constraints auf gs_service_auftrag.status und .quelle. Ein CHECK
-- laesst sich nicht erweitern, nur ersetzen. Es wird KEINE Tabelle und KEINE
-- Spalte gedroppt. Die Altwerte ('neu','angenommen','abgelehnt','erledigt',
-- 'manuell','sprache','mail') bleiben im neuen CHECK gueltig, bestehende
-- Zeilen fallen also nicht durch.

-- ══════════════════════════════════════════════════════════════════
-- 1. OBJEKT  —  wo steht die Anlage
-- ══════════════════════════════════════════════════════════════════
-- Heute ist gs_service_auftrag.objekt ein Textfeld. Damit gibt es keine
-- Objekt-Historie ("was war an dieser Liegenschaft schon alles?") und jede
-- Adresse wird bei jedem Auftrag neu getippt. Ein Objekt gehoert zum
-- Mandanten (partner_user_id) und optional zu einem Kunden.
create table if not exists gs_objekte (
  id                  uuid primary key default gen_random_uuid(),
  partner_user_id     uuid,                       -- Mandant. NULL = Bestand von George Solutions
  kunde_id            uuid references gs_kunden(id) on delete set null,
  bezeichnung         text not null,              -- "Liegenschaft Langstrasse 149"
  adresse             text,
  plz                 text,
  ort                 text,
  land                text default 'CH',
  notiz               text,
  -- Nummer aus dem System des Partners (OF-4000 o.ae.). Kein FK, reine Referenz.
  externe_objektnummer text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  geloescht_at        timestamptz                 -- Soft-Delete wie gs_projekte
);
create index if not exists idx_gs_objekte_partner on gs_objekte(partner_user_id);
create index if not exists idx_gs_objekte_kunde   on gs_objekte(kunde_id);
create index if not exists idx_gs_objekte_extern  on gs_objekte(partner_user_id, externe_objektnummer);

-- ══════════════════════════════════════════════════════════════════
-- 2. ANLAGE  —  nur Struktur, bewusst schlank
-- ══════════════════════════════════════════════════════════════════
-- OF-4000 kennt Anlagenverwaltung. Wir bereiten die Struktur vor, damit ein
-- Auftrag spaeter an einer konkreten Waermepumpe haengen kann — mehr nicht.
-- Keine Wartungsplaene, keine Zaehlerstaende, keine Ersatzteillisten.
create table if not exists gs_anlagen (
  id                 uuid primary key default gen_random_uuid(),
  objekt_id          uuid not null references gs_objekte(id) on delete cascade,
  bezeichnung        text not null,               -- "Waermepumpe Keller"
  typ                text,                        -- waermepumpe | boiler | kaeltemaschine | ...
  hersteller         text,
  modell             text,
  seriennummer       text,
  baujahr            int,
  standort_im_objekt text,                        -- "UG, Technikraum"
  notiz              text,
  externe_anlagennummer text,
  created_at         timestamptz not null default now(),
  geloescht_at       timestamptz
);
create index if not exists idx_gs_anlagen_objekt on gs_anlagen(objekt_id);

-- ══════════════════════════════════════════════════════════════════
-- 3. PARTNER-MITGLIEDER  —  ein Unternehmen, mehrere Benutzer
-- ══════════════════════════════════════════════════════════════════
-- Heute gilt: ein Partner IST ein auth-User. partner_user_id ist in ~10
-- Tabellen der Mandantenschluessel. Diesen Schluessel umzubauen waere ein
-- Breaking Change quer durch die ganze Anwendung.
--
-- Deshalb der additive Weg: partner_user_id bleibt der Mandant (= die Firma,
-- verkoerpert durch den Eigentuemer-Account). Weitere Mitarbeiter bekommen
-- eine Mitgliedszeile und werden serverseitig auf denselben Mandanten
-- gemappt. Bestehende Ein-Personen-Partner haben keine Zeile hier und
-- funktionieren unveraendert weiter.
create table if not exists gs_partner_mitglied (
  id              uuid primary key default gen_random_uuid(),
  partner_user_id uuid not null,                  -- die FIRMA (Eigentuemer-Account)
  user_id         uuid not null,                  -- der Mitarbeiter (auth.users)
  name            text,
  abteilung       text,                           -- "Serviceabteilung", "Projektleitung"
  -- Rolle INNERHALB des Partnerunternehmens. Steuert, was der Mitarbeiter im
  -- Partnerbereich darf; die Mandantengrenze ist davon unberuehrt.
  partner_rolle   text not null default 'auftraggeber'
                    check (partner_rolle in ('admin','disponent','auftraggeber','viewer','buchhaltung')),
  aktiv           boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (partner_user_id, user_id)
);
-- Ein Benutzer gehoert zu genau EINER Firma. Ohne diesen Index waere die
-- Mandantenzuordnung mehrdeutig und damit ein Datenleck zwischen Partnern.
create unique index if not exists idx_gs_partner_mitglied_user
  on gs_partner_mitglied(user_id) where aktiv;

-- ══════════════════════════════════════════════════════════════════
-- 4. SERVICEAUFTRAG  —  Tiefe nachruesten
-- ══════════════════════════════════════════════════════════════════
-- Alle Spalten additiv. Der Auftrag ist das Wurzelobjekt: hier laufen Kunde,
-- Objekt, Anlage, Kontakt, Termin, externe Referenzen, Unterschrift und
-- Freigabelink zusammen.

-- ── 4.1 Zuordnung ──
alter table gs_service_auftrag add column if not exists kunde_id  uuid references gs_kunden(id) on delete set null;
alter table gs_service_auftrag add column if not exists objekt_id uuid references gs_objekte(id) on delete set null;
alter table gs_service_auftrag add column if not exists anlage_id uuid references gs_anlagen(id) on delete set null;

-- ── 4.2 Auftragsinhalt ──
alter table gs_service_auftrag add column if not exists titel        text;
alter table gs_service_auftrag add column if not exists kategorie    text;   -- sanitaer|heizung|klima|stoerung|wartung|reparatur|kontrolle|sonstiges
alter table gs_service_auftrag add column if not exists prioritaet   text not null default 'normal'
  check (prioritaet in ('normal','dringend','notfall'));
alter table gs_service_auftrag add column if not exists interne_hinweise text;  -- nur Master + Techniker, nie Partner-PDF

-- ── 4.3 Kontakt vor Ort ──
alter table gs_service_auftrag add column if not exists kontakt_name     text;
alter table gs_service_auftrag add column if not exists kontakt_telefon  text;
alter table gs_service_auftrag add column if not exists kontakt_email    text;

-- ── 4.4 Termin ──
-- terminwunsch_* = was der Partner sich wuenscht, termin_* = was disponiert ist.
-- Getrennt, damit sichtbar bleibt, ob der Wunsch gehalten wurde.
alter table gs_service_auftrag add column if not exists terminwunsch_datum date;
alter table gs_service_auftrag add column if not exists terminwunsch_text  text;   -- "vormittags", "KW 32"
alter table gs_service_auftrag add column if not exists termin_datum       date;
alter table gs_service_auftrag add column if not exists termin_von         time;
alter table gs_service_auftrag add column if not exists termin_bis         time;

-- ── 4.5 Herkunft und Auftraggeber ──
alter table gs_service_auftrag add column if not exists erstellt_von_user_id uuid;   -- welcher Mitarbeiter des Partners
alter table gs_service_auftrag add column if not exists abteilung            text;

-- ── 4.6 Externe Referenzen (Partner-Sicht) ──
alter table gs_service_auftrag add column if not exists externe_referenz        text;
alter table gs_service_auftrag add column if not exists externe_auftragsnummer  text;
alter table gs_service_auftrag add column if not exists externe_kundennummer    text;
alter table gs_service_auftrag add column if not exists externe_objektnummer    text;

-- ── 4.7 Sync-Metadaten (Adapter-Layer, noch ohne Anbindung) ──
alter table gs_service_auftrag add column if not exists source_system       text;    -- 'partnerportal'|'of4000'|'email'|'whatsapp'|'import'|'api'
alter table gs_service_auftrag add column if not exists external_order_id   text;
alter table gs_service_auftrag add column if not exists external_customer_id text;
alter table gs_service_auftrag add column if not exists external_object_id  text;
alter table gs_service_auftrag add column if not exists imported_at         timestamptz;
alter table gs_service_auftrag add column if not exists last_synced_at      timestamptz;
alter table gs_service_auftrag add column if not exists sync_status         text;    -- ok | fehler | ausstehend
alter table gs_service_auftrag add column if not exists sync_error          text;
alter table gs_service_auftrag add column if not exists source_payload_hash text;

-- ── 4.8 Abschluss ──
alter table gs_service_auftrag add column if not exists ursache            text;
alter table gs_service_auftrag add column if not exists loesung            text;
alter table gs_service_auftrag add column if not exists empfehlung         text;
alter table gs_service_auftrag add column if not exists folgearbeit_noetig boolean not null default false;
alter table gs_service_auftrag add column if not exists folgeauftrag_von_id uuid references gs_service_auftrag(id) on delete set null;

-- ── 4.9 Kundenunterschrift ──
alter table gs_service_auftrag add column if not exists unterschrift_name text;
alter table gs_service_auftrag add column if not exists unterschrift_path text;   -- Storage: service/<id>/unterschrift/...
alter table gs_service_auftrag add column if not exists unterschrift_am   timestamptz;

-- ── 4.10 Freigabelink fuer die externe mobile Ansicht ──
-- Zufaelliger Token, nicht ableitbar aus der id. Ohne Token kein Zugriff;
-- der Token laesst sich jederzeit neu ziehen (Widerruf).
alter table gs_service_auftrag add column if not exists share_token       text;
alter table gs_service_auftrag add column if not exists share_token_am    timestamptz;
create unique index if not exists idx_gs_service_auftrag_share
  on gs_service_auftrag(share_token) where share_token is not null;

-- ── 4.11 Soft-Delete + Bericht ──
alter table gs_service_auftrag add column if not exists geloescht_at timestamptz;
alter table gs_service_auftrag add column if not exists bericht_pdf_path text;
alter table gs_service_auftrag add column if not exists bericht_erstellt_am timestamptz;

-- ── 4.12 Status- und Quellen-CHECK ersetzen ──
-- Der Altbestand kennt nur neu|angenommen|abgelehnt|erledigt. Der Hub braucht
-- den vollen Lebenszyklus. 'erledigt' BLEIBT gueltig (Altzeilen!), wird im
-- Code aber wie 'abgeschlossen' behandelt.
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

  for c in
    select conname from pg_constraint
     where conrelid = 'gs_service_auftrag'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%quelle%'
  loop
    execute format('alter table gs_service_auftrag drop constraint %I', c);
  end loop;
end $$;

alter table gs_service_auftrag add constraint gs_service_auftrag_status_chk
  check (status in (
    'entwurf','neu','disposition','zugewiesen','angenommen','unterwegs','vor_ort',
    'in_arbeit','unterbrochen','material_noetig','arbeit_fertig','rapport_offen',
    'abgeschlossen','abgelehnt','storniert',
    'erledigt'   -- Altwert, bleibt lesbar
  ));

alter table gs_service_auftrag add constraint gs_service_auftrag_quelle_chk
  check (quelle in ('manuell','sprache','mail','partnerportal','whatsapp','api','import'));

-- ── 4.13 Idempotenz beim Import ──
-- Derselbe externe Auftrag darf nicht zweimal ankommen. Schluessel ist
-- (Mandant, Quellsystem, externe Auftrags-ID) — nicht die externe ID allein,
-- die ist nur innerhalb eines Partners eindeutig.
create unique index if not exists idx_gs_service_auftrag_extern_idem
  on gs_service_auftrag(partner_user_id, source_system, external_order_id)
  where external_order_id is not null;

create index if not exists idx_gs_service_auftrag_objekt on gs_service_auftrag(objekt_id);
create index if not exists idx_gs_service_auftrag_kunde  on gs_service_auftrag(kunde_id);
create index if not exists idx_gs_service_auftrag_termin on gs_service_auftrag(termin_datum);
create index if not exists idx_gs_service_auftrag_pstat  on gs_service_auftrag(partner_user_id, status);

-- ══════════════════════════════════════════════════════════════════
-- 5. TIMELINE / AUDIT
-- ══════════════════════════════════════════════════════════════════
-- Jede relevante Aktion landet hier, automatisch geschrieben vom Server.
-- Vorbild ist gs_wochenrapport_log; bewusst breiter, weil die Timeline auch
-- dem Partner gezeigt wird (sichtbar_partner steuert das).
-- Die 'art'-Werte sind zugleich die Namen der spaeteren Webhook-Events
-- (service_order.created usw.) — deshalb kein CHECK, sonst muesste jede neue
-- Aktion eine Migration nach sich ziehen.
create table if not exists gs_service_ereignis (
  id                 uuid primary key default gen_random_uuid(),
  service_auftrag_id uuid not null references gs_service_auftrag(id) on delete cascade,
  art                text not null,               -- erstellt | zugewiesen | status | foto | material | unterschrift | bericht | geteilt | ...
  text               text,                        -- fertige Anzeigezeile
  akteur_user_id     uuid,
  akteur_name        text,
  akteur_rolle       text,                        -- master | partner | techniker | system | extern
  sichtbar_partner   boolean not null default true,
  meta               jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);
create index if not exists idx_gs_service_ereignis_auftrag on gs_service_ereignis(service_auftrag_id, created_at desc);

-- ══════════════════════════════════════════════════════════════════
-- 6. MATERIAL — bestehende Tabelle oeffnen statt neue bauen
-- ══════════════════════════════════════════════════════════════════
-- gs_material.projekt_id ist bereits NULLABLE. Es reicht, den Service-Slot zu
-- ergaenzen — exakt dasselbe Muster wie seinerzeit bei gs_tagesrapporte und
-- gs_projekt_medien. Damit bleibt Material EINE Tabelle und ist spaeter in
-- einem Zug fakturierbar.
alter table gs_material add column if not exists service_auftrag_id uuid references gs_service_auftrag(id) on delete cascade;
alter table gs_material add column if not exists tagesrapport_id    uuid references gs_tagesrapporte(id) on delete set null;
alter table gs_material add column if not exists artikelnummer      text;
alter table gs_material add column if not exists beschreibung       text;
alter table gs_material add column if not exists bemerkung          text;
alter table gs_material add column if not exists erfasst_von        uuid;
create index if not exists idx_material_service on gs_material(service_auftrag_id);

-- Genau EINE Bindung: Projekt ODER Service. Beides gleichzeitig waere eine
-- Position, die in zwei Rechnungen landen kann.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid='gs_material'::regclass and conname='gs_material_bindung_chk') then
    alter table gs_material add constraint gs_material_bindung_chk
      check (projekt_id is not null or service_auftrag_id is not null);
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════
-- 7. ZEITERFASSUNG — bestehende Tabelle ergaenzen
-- ══════════════════════════════════════════════════════════════════
-- gs_tagesrapporte traegt service_auftrag_id bereits. Fuer den Serviceeinsatz
-- fehlen nur An- und Rueckfahrt; alles andere (Start/Ende, Pause, Stunden,
-- Ueberzeit, Spesen) ist da und wird unveraendert weiterbenutzt.
alter table gs_tagesrapporte add column if not exists anfahrt_minuten   int;
alter table gs_tagesrapporte add column if not exists rueckfahrt_minuten int;

-- ══════════════════════════════════════════════════════════════════
-- 8. DOKUMENTCENTER
-- ══════════════════════════════════════════════════════════════════
-- Fotos und Videos bleiben in gs_projekt_medien (dort ist die ganze
-- Upload-/Signier-/Loesch-Maschinerie). Hier liegen NUR Dokumente: Beauftragung,
-- Plaene, Herstellerunterlagen, erzeugte Berichte.
-- sichtbarkeit entscheidet, wer es sieht — der Techniker soll nicht die
-- kaufmaennische Beauftragung lesen, der Partner keine internen Notizen.
create table if not exists gs_service_dokument (
  id                 uuid primary key default gen_random_uuid(),
  service_auftrag_id uuid not null references gs_service_auftrag(id) on delete cascade,
  art                text not null default 'dokument',   -- beauftragung|plan|schema|herstellerdoku|bericht|sonstiges
  bucket             text not null default 'projektdateien',
  path               text not null,
  dateiname          text,
  mime               text,
  groesse            bigint,
  sichtbarkeit       text not null default 'alle'
                       check (sichtbarkeit in ('alle','intern','techniker','partner')),
  hochgeladen_von    uuid,
  created_at         timestamptz not null default now()
);
create index if not exists idx_gs_service_dokument_auftrag on gs_service_dokument(service_auftrag_id);

-- ══════════════════════════════════════════════════════════════════
-- 9. KOMMUNIKATIONS-PROTOKOLL
-- ══════════════════════════════════════════════════════════════════
-- Kein Chat-System. Nur: wann ging was an wen raus.
create table if not exists gs_service_versand (
  id                 uuid primary key default gen_random_uuid(),
  service_auftrag_id uuid not null references gs_service_auftrag(id) on delete cascade,
  kanal              text not null check (kanal in ('email','whatsapp','link')),
  empfaenger         text,
  betreff            text,
  ok                 boolean not null default true,
  fehler             text,
  gesendet_von       uuid,
  gesendet_am        timestamptz not null default now()
);
create index if not exists idx_gs_service_versand_auftrag on gs_service_versand(service_auftrag_id, gesendet_am desc);

-- ══════════════════════════════════════════════════════════════════
-- 10. TECHNIKER-ZUWEISUNG erweitern
-- ══════════════════════════════════════════════════════════════════
alter table gs_service_techniker add column if not exists rolle          text;    -- 'leitung' | 'unterstuetzung'
alter table gs_service_techniker add column if not exists angenommen_am  timestamptz;
alter table gs_service_techniker add column if not exists zugewiesen_von uuid;

-- ══════════════════════════════════════════════════════════════════
-- 11. AUFTRAGSNUMMER  —  bestehenden Nummernkreis wiederverwenden
-- ══════════════════════════════════════════════════════════════════
-- gs_rapport_nr_next(kuerzel, jahr) ist bereits race-fest (INSERT .. ON
-- CONFLICT DO UPDATE .. RETURNING, SECURITY DEFINER) und an keine Fachtabelle
-- gebunden. Wir belegen darin den Schluessel 'SERVICE'.
--
-- Warum 'SERVICE' und nicht 'SA': der Keyspace teilt sich mit den
-- Kundenkuerzeln, und die sind dreistellig. Ein siebenstelliges 'SERVICE'
-- kann mit keinem Kundenkuerzel kollidieren. Format: SA-2026-0001.
insert into gs_rapport_nummernkreis (kuerzel, jahr, letzte_nr)
select 'SERVICE', extract(year from now())::int, 0
where not exists (
  select 1 from gs_rapport_nummernkreis
   where kuerzel = 'SERVICE' and jahr = extract(year from now())::int
);

-- ══════════════════════════════════════════════════════════════════
-- 12. FEATURE-KEY
-- ══════════════════════════════════════════════════════════════════
insert into gs_features (key, label) values ('service', 'Serviceauftraege')
on conflict (key) do update set label = excluded.label;

-- ══════════════════════════════════════════════════════════════════
-- 13. RLS  —  zweite Verteidigungslinie
-- ══════════════════════════════════════════════════════════════════
-- Der Live-Pfad laeuft mit dem service_role-Key und umgeht RLS; die
-- Durchsetzung steckt in api/cockpit.js (assertServiceAccess). Diese Policies
-- sind der Backstop, falls je ein anon/authenticated-Key direkt zugreift.
alter table gs_objekte            enable row level security;
alter table gs_anlagen            enable row level security;
alter table gs_partner_mitglied   enable row level security;
alter table gs_service_ereignis   enable row level security;
alter table gs_service_dokument   enable row level security;
alter table gs_service_versand    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['gs_objekte','gs_anlagen','gs_partner_mitglied',
                           'gs_service_ereignis','gs_service_dokument','gs_service_versand'] loop
    execute format('drop policy if exists service_all on %I', t);
    execute format('create policy service_all on %I for all using (auth.role() = ''service_role'')', t);
    execute format('drop policy if exists admin_all on %I', t);
    execute format($f$create policy admin_all on %I for all using (
      exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('gs_admin','master')))$f$, t);
  end loop;
end $$;

-- Partner liest seine eigenen Objekte/Anlagen.
drop policy if exists partner_objekte on gs_objekte;
create policy partner_objekte on gs_objekte for select using (partner_user_id = auth.uid());
drop policy if exists partner_anlagen on gs_anlagen;
create policy partner_anlagen on gs_anlagen for select using (
  exists (select 1 from gs_objekte o where o.id = gs_anlagen.objekt_id and o.partner_user_id = auth.uid()));
-- Mitglied sieht die eigene Zeile (damit der Client die Firmenzugehoerigkeit kennt).
drop policy if exists mitglied_own on gs_partner_mitglied;
create policy mitglied_own on gs_partner_mitglied for select using (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════
-- 14. FK fuer gs_wochenberichte nachziehen
-- ══════════════════════════════════════════════════════════════════
-- scripts/wochenbericht.sql:95-106 hat den FK bewusst offen gelassen, bis die
-- Serviceabteilung existiert. Jetzt existiert sie.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gs_wochenberichte_service_fk') then
    alter table gs_wochenberichte add constraint gs_wochenberichte_service_fk
      foreign key (service_auftrag_id) references gs_service_auftrag(id) on delete cascade;
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════
-- Kontrolle nach dem Lauf
-- ══════════════════════════════════════════════════════════════════
--   select column_name, data_type from information_schema.columns
--    where table_name = 'gs_service_auftrag' order by ordinal_position;
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'gs_service_auftrag'::regclass and contype = 'c';
--   select kuerzel, jahr, letzte_nr from gs_rapport_nummernkreis where kuerzel = 'SERVICE';
--   select count(*) from gs_objekte;
