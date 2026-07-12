-- ═══════════════════════════════════════════════════════════════════════════
-- feat/zahlplan-ux · Block 1(f)/Block 5: "ungelesen/neu" pro Eingang
-- VORSCHLAG – NICHT automatisch ausgeführt. Manuell im Supabase SQL-Editor laufen lassen.
--
-- Befund (Block 1): Die EREIGNIS-Zeitstempel existieren bereits:
--   gs_projekte.angefragt_am               (Partner schickt Anfrage)
--   gs_angebote.abgeschickt_am             (Master schickt Angebot)
--   gs_angebote.entschieden_am             (Kunde/Partner nimmt an / lehnt ab / Termin)
--   gs_projekte.zahlungsplan_angenommen_at (Partner nimmt Zahlungsplan an)
-- Es fehlt aber ein "GESEHEN"-Marker pro Seite. Einziger impliziter Lese-Marker
-- heute: sub_status angefragt→in_pruefung beim Öffnen des Master-Sub-Details
-- (api/cockpit.js msubDetail) – deckt nur NEUE Anfragen ab, nicht Kundenaktionen,
-- und auf Partner-Seite gibt es gar nichts (gs_nachrichten.status='ungelesen'
-- ist ein anderes System und hängt nicht an Projekten/Angeboten).
--
-- Lösung: zwei Spalten auf gs_projekte. "Ungelesen" wird dann rein per Vergleich
-- berechnet (kein neues Tabellen-System, kein Trigger):
--   Master-Seite ungelesen  <=>  max(angefragt_am, entschieden_am,
--                                    zahlungsplan_angenommen_at) > master_gesehen_at
--   Partner-Seite ungelesen <=>  abgeschickt_am > partner_gesehen_at
-- Öffnen des Eintrags patcht die jeweilige Spalte auf now().
-- ═══════════════════════════════════════════════════════════════════════════

alter table gs_projekte
  add column if not exists master_gesehen_at  timestamptz;   -- Master hat Sub-Detail zuletzt geöffnet

alter table gs_projekte
  add column if not exists partner_gesehen_at timestamptz;   -- Partner hat Projekt-Detail zuletzt geöffnet

comment on column gs_projekte.master_gesehen_at  is 'Blink-/Ungelesen-Logik: letzter Öffnen-Zeitpunkt der Sub-Anfrage durch den Master';
comment on column gs_projekte.partner_gesehen_at is 'Blink-/Ungelesen-Logik: letzter Öffnen-Zeitpunkt des Sub-Projekts durch den Partner';
