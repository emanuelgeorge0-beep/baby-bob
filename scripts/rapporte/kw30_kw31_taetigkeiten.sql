-- ═══════════════════════════════════════════════════════════════════════════
-- KW 30 + KW 31 2026 — Tätigkeitstexte, Stunden und Zeiten nachtragen
-- ═══════════════════════════════════════════════════════════════════════════
-- Techniker Emanuel George
--   gs_techniker.id  03c67b2c-e670-46e2-add4-3910ea9d55fe
--   auth uid         ee46a716-7017-4045-9f67-fe06d05171e7
-- Projekt P-2026-3470 "Langstrasse 149 8004 Zürich Schweiz"
--   64c695d5-0ef7-4864-9951-ed7163a92791
--
-- Beide Wochenrapporte sind eingereicht und verrechnet. Die Korrektur läuft
-- über die Master-Ebene; die 24-h-Sperrfrist gilt für den Master nicht.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WAS DIESE DATEI TUT
--   14 UPDATE-Anweisungen auf bestehende Zeilen in gs_tagesrapporte:
--     BLOCK A — 5 Zeilen KW 30: Zeiten, Pause, Stunden, Tätigkeitstext
--     BLOCK B — 5 Zeilen KW 31: nur Tätigkeitstext
--     BLOCK C — 4 Zeilen KW 31: nur end_zeit (Angleich an die 8.0 h)
--   Kein INSERT, kein DELETE, kein CREATE, kein DROP, kein ALTER.
--   gs_wochenrapporte wird NICHT geschrieben: die Tabelle hat keine
--   Stundenspalte, jedes Wochentotal wird zur Laufzeit aus den Tageszeilen
--   summiert (api/cockpit.js:3086-3098, lib/wochenbericht.js:265-272).
--   gs_tagesrapporte.status wird nicht angefasst.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WARUM arbeiten UND NICHT taetigkeit
--   taetigkeit ist das Feld "Gewerk" mit serverseitiger Whitelist
--   ['Sanitär','Heizung','Klima','Lüftung','Divers'] (api/cockpit.js:2381).
--   Das im UI mit "Tätigkeit" beschriftete Freitextfeld ist die Textarea über
--   arbeiten (app.html:11078-11080, gs-intern.html:2268); im PDF füllt arbeiten
--   die Spalte "Ausgeführte Arbeiten" (lib/wochenbericht.js:488-496, 622-634).
--   Ein Fliesstext in taetigkeit würde die Gewerk-Spalte sprengen und den Wert
--   "Sanitär" verdrängen. taetigkeit bleibt deshalb unberührt.
--
--   Ebenso: die gefüllten Zeitspalten heissen start_zeit / end_zeit.
--   zeit_von / zeit_bis sind in allen 14 Zeilen NULL und gehören zum alten
--   Arbeitsrapport-Pfad (api/tagesrapport.js:139) — hier ohne Funktion.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ZEITEN KW 30 — nachgerechnet, end_zeit - start_zeit - pause = gesamtstunden
--   Mo 20.07.  07:00-16:45  =  9.75 h  - 1.25 h  =   8.5   ok
--   Di 21.07.  07:00-18:15  = 11.25 h  - 1.25 h  =  10.0   ok
--   Mi 22.07.  07:00-17:15  = 10.25 h  - 1.25 h  =   9.0   ok
--   Do 23.07.  07:00-16:45  =  9.75 h  - 1.25 h  =   8.5   ok
--   Fr 24.07.  07:00-12:15  =  5.25 h  - 1.25 h  =   4.0   ok
--                                          Summe    40.0 h
--   Damit ist zugleich der Erfassungsfehler vom 21.07. bereinigt
--   (stand auf start_zeit 21:41 mit end_zeit NULL).
--
--   stunden_manuell wird auf false gesetzt: die Stunden folgen nach dieser
--   Änderung exakt aus Start/Ende/Pause. true würde im Technik-UI
--   "· abweichend von Start/Ende" behaupten (app.html:11062).
--
-- KW 31 behält 8.0 h je Tag (Summe 40.0 h). BLOCK B setzt dort ausschliesslich
--   den Tätigkeitstext; BLOCK C gleicht danach nur die end_zeit an.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ZEITEN KW 31 — Angleich in BLOCK C
--   Vier der fünf KW-31-Tage trugen Zeiten, die nicht zu den gebuchten 8.0 h
--   passten. BLOCK C setzt allein die end_zeit auf 16:15; Pause (75 min) und
--   gesamtstunden (8.0) bleiben unangetastet, sie stehen bereits korrekt.
--
--     Tag        vorher        nachher       Rechnung nachher
--     Mo 27.07.  07:00-16:00 → 07:00-16:15   9.25 h - 1.25 h = 8.00 = 8.0  ok
--     Di 28.07.  07:00-16:00 → 07:00-16:15   9.25 h - 1.25 h = 8.00 = 8.0  ok
--     Mi 29.07.  07:00-16:15   unverändert   9.25 h - 1.25 h = 8.00 = 8.0  ok
--     Do 30.07.  07:00-16:00 → 07:00-16:15   9.25 h - 1.25 h = 8.00 = 8.0  ok
--     Fr 31.07.  07:00-16:00 → 07:00-16:15   9.25 h - 1.25 h = 8.00 = 8.0  ok
--
--   Die Wochensumme ändert sich dadurch nicht: gesamtstunden wird nicht
--   angefasst, KW 31 bleibt bei 40.0 h. Angeglichen wird nur die im Bericht
--   gedruckte Zeitspanne, damit sie zur gebuchten Stundenzahl passt.
--
-- spesen steht auf allen zehn Werktagen bereits auf 30.00 und wird nicht
--   geschrieben. Die SELECTs unten weisen den Wert aus.
--
-- ───────────────────────────────────────────────────────────────────────────
-- AUSFÜHRUNG
--   Datei als Ganzes im Supabase-SQL-Editor ausführen. Die Schreibbefehle
--   liegen in einer Transaktion (BEGIN … COMMIT), es wird also entweder alles
--   oder nichts geschrieben. Jede Anweisung setzt absolute Werte und ist
--   idempotent — ein zweiter Durchlauf ändert nichts mehr.
--   Der Editor zeigt nur das Ergebnis der letzten Anweisung; für den
--   Vorher-Stand den ersten SELECT einzeln markieren und "Run selection".
--
-- Jede UPDATE-Anweisung adressiert genau eine Zeile über
--   projekt_id + techniker_user_id + datum.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- VORHER — Ist-Stand der 14 Zeilen (rein lesend)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT datum,
       to_char(datum, 'Dy')        AS tag,
       woche,
       start_zeit,
       end_zeit,
       pause_minuten,
       gesamtstunden,
       stunden_manuell,
       spesen,
       taetigkeit                  AS gewerk,
       array_length(arbeiten, 1)   AS anz_taetigkeitszeilen,
       status
FROM gs_tagesrapporte
WHERE projekt_id         = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id  = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum BETWEEN DATE '2026-07-20' AND DATE '2026-08-02'
ORDER BY datum;


BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- BLOCK A — KW 30 (20.07.–24.07.2026), Total 40.0 h
-- Zeiten, Pause, Stunden und Tätigkeitstext
-- ═══════════════════════════════════════════════════════════════════════════

-- Mo 20.07.2026 — 8.5 h (07:00–16:45 abzüglich 75 min)
UPDATE gs_tagesrapporte SET
  start_zeit      = TIME '07:00',
  end_zeit        = TIME '16:45',
  pause_minuten   = 75,
  gesamtstunden   = 8.5,
  stunden_manuell = false,
  arbeiten        = ARRAY[$$Moorefield: Badewanne gesetzt, auf Mass positioniert, in Waage ausgerichtet, Ablauf angeschlossen. Dabei Beschädigung an der Wanne festgestellt und mit Projektleiter Bruno vor Ort besprochen; Instandstellung durch Fachfirma vereinbart. Untergrund im Holzriegelbau ohne tragfähige Auflage für die Wannenfüsse, Wanne wieder demontiert, damit der Zimmermann die Unterkonstruktion verstärken konnte. Rückflussverhinderer konnte mangels Material nicht eingebaut werden.$$]
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum             = DATE '2026-07-20';

-- Di 21.07.2026 — 10.0 h (07:00–18:15 abzüglich 75 min)
-- Bereinigt zugleich die Fehlerfassung start_zeit 21:41 / end_zeit NULL.
UPDATE gs_tagesrapporte SET
  start_zeit      = TIME '07:00',
  end_zeit        = TIME '18:15',
  pause_minuten   = 75,
  gesamtstunden   = 10.0,
  stunden_manuell = false,
  arbeiten        = ARRAY[$$Jolles / Heglibachstrasse 119: Badezimmer Rohinstallation, Ver- und Entsorgungsleitungen für WC, Waschtisch und Dusche erstellt. Duschrinne neu ab Garage angebunden. Leitungen befestigt und isoliert.$$]
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum             = DATE '2026-07-21';

-- Mi 22.07.2026 — 9.0 h (07:00–17:15 abzüglich 75 min)
UPDATE gs_tagesrapporte SET
  start_zeit      = TIME '07:00',
  end_zeit        = TIME '17:15',
  pause_minuten   = 75,
  gesamtstunden   = 9.0,
  stunden_manuell = false,
  arbeiten        = ARRAY[$$Jolles / Heglibachstrasse 119: Duschinstallation, Unterputz-Mischer Dornbracht mit Kopfbrause montiert. Waschtischarmatur Dornbracht unter Putz installiert für Designwaschtisch mit Auslauf von oben. Abluftventilator Badezimmer montiert und mit flexiblem Lüftungsschlauch DN 75 an den Schacht angebunden.$$]
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum             = DATE '2026-07-22';

-- Do 23.07.2026 — 8.5 h (07:00–16:45 abzüglich 75 min)
UPDATE gs_tagesrapporte SET
  start_zeit      = TIME '07:00',
  end_zeit        = TIME '16:45',
  pause_minuten   = 75,
  gesamtstunden   = 8.5,
  stunden_manuell = false,
  arbeiten        = ARRAY[$$Jolles / Heglibachstrasse 119: Kücheninstallation, Standboiler unter der Küchenzeile gesetzt und mit Sicherheitsgruppe angeschlossen. Neue Küchenanschlüsse erstellt. Heizkörperanschluss Küche vorbereitet, Anschluss durch Heizungstechniker der Bauherrschaft.$$]
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum             = DATE '2026-07-23';

-- Fr 24.07.2026 — 4.0 h (07:00–12:15 abzüglich 75 min)
UPDATE gs_tagesrapporte SET
  start_zeit      = TIME '07:00',
  end_zeit        = TIME '12:15',
  pause_minuten   = 75,
  gesamtstunden   = 4.0,
  stunden_manuell = false,
  arbeiten        = ARRAY[$$Jolles / Heglibachstrasse 119: Anlage gespült und auf Dichtheit geprüft. Speicher gefüllt, Inbetriebnahme durchgeführt. Wasserzufuhr wohnungsseitig abgesperrt, damit die Leitungen während der Bauarbeiten nicht unter Betriebsdruck stehen. Baustelle gereinigt und übergeben. Keine Überzeit bewilligt, daher 4.0 h früher beendet.$$]
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum             = DATE '2026-07-24';


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOCK B — KW 31 (27.07.–31.07.2026), Total 40.0 h, je 8.0 h
-- Nur Tätigkeitstext. Zeiten, Pause und Stunden bleiben unverändert.
-- ═══════════════════════════════════════════════════════════════════════════

-- Mo 27.07.2026
UPDATE gs_tagesrapporte SET
  arbeiten = ARRAY[$$Heglibachstrasse 119: Badewanne nach Verstärkung der Unterkonstruktion durch den Zimmermann definitiv gesetzt und am Boden fixiert. Wasseranschluss erstellt, Rückflussverhinderer Viega eingebaut, Ablauf angeschlossen. Wanne gefüllt, Ablauf gespült, Anlage auf Dichtheit geprüft.$$]
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum             = DATE '2026-07-27';

-- Di 28.07.2026
UPDATE gs_tagesrapporte SET
  arbeiten = ARRAY[$$Langstrasse 149: Duschtassen 90 x 110 cm setzen, 1. OG. Restliche Positionen fertiggestellt.$$]
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum             = DATE '2026-07-28';

-- Mi 29.07.2026
UPDATE gs_tagesrapporte SET
  arbeiten = ARRAY[$$Langstrasse 149: Anschlüsse gespült und auf Dichtheit geprüft. Restarbeiten Sanitär.$$]
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum             = DATE '2026-07-29';

-- Do 30.07.2026
UPDATE gs_tagesrapporte SET
  arbeiten = ARRAY[$$Fabrikstrasse 5: Schachtkonstruktion erstellt, Traggerüste nach Konstruktionsplan aufgebaut, an der Decke fixiert und mit Querverstrebungen rundum ausgesteift. Schachttiefe rund 50 cm, Gesamthöhe rund 6 m, erste rund 2 m ausgeführt, Weiterbau durch das Team. Ausführung mit Video dokumentiert.$$]
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum             = DATE '2026-07-30';

-- Fr 31.07.2026
UPDATE gs_tagesrapporte SET
  arbeiten = ARRAY[$$Langstrasse 149: Restarbeiten Sanitär abgeschlossen. Material entsorgt, Baustelle geräumt und gereinigt.$$]
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum             = DATE '2026-07-31';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════════
-- BLOCK C — ANGLEICH DER KW-31-ZEITEN (eigenständig, eigene Transaktion)
-- ═══════════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════════
-- Dieser Block steht bewusst ausserhalb der Transaktion von BLOCK A und B und
-- lässt sich einzeln markieren und ausführen — oder weglassen, ohne dass die
-- Tätigkeitstexte darunter leiden.
--
-- Er setzt AUSSCHLIESSLICH end_zeit auf 16:15. Nicht angefasst werden:
--   start_zeit      (steht bereits auf 07:00)
--   pause_minuten   (steht bereits auf 75)
--   gesamtstunden   (bleibt 8.0 — die Wochensumme KW 31 bleibt 40.0 h)
--   stunden_manuell, spesen, taetigkeit, arbeiten, status
--
-- Ergebnis je Tag: 16:15 - 07:00 = 9.25 h, abzüglich 75 min Pause = 8.00 h,
-- also exakt die gebuchten 8.0 h. Der 29.07. steht schon auf 16:15 und kommt
-- hier nicht vor.
--
-- Die Nachkontrolle darunter prüft das nach: nach BLOCK C müssen alle zehn
-- Werktagszeilen 'ok' zeigen.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Mo 27.07.2026 — 16:00 → 16:15
UPDATE gs_tagesrapporte SET
  end_zeit = TIME '16:15'
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum             = DATE '2026-07-27';

-- Di 28.07.2026 — 16:00 → 16:15
UPDATE gs_tagesrapporte SET
  end_zeit = TIME '16:15'
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum             = DATE '2026-07-28';

-- Mi 29.07.2026 — bleibt unverändert bei 07:00–16:15, kein UPDATE.

-- Do 30.07.2026 — 16:00 → 16:15
UPDATE gs_tagesrapporte SET
  end_zeit = TIME '16:15'
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum             = DATE '2026-07-30';

-- Fr 31.07.2026 — 16:00 → 16:15
UPDATE gs_tagesrapporte SET
  end_zeit = TIME '16:15'
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum             = DATE '2026-07-31';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- NACHKONTROLLE — Zeilenweise Probe: Zeit minus Pause muss die Stunden ergeben
-- ═══════════════════════════════════════════════════════════════════════════
-- Erwartet nach BLOCK A, B und C — 14 Zeilen:
--   20.-24.07. (KW 30, 5 Zeilen)  pruefung = 'ok', Std 8.5 / 10.0 / 9.0 / 8.5 / 4.0
--   25./26.07. (Sa/So, 2 Zeilen)  pruefung = 'keine Zeit erfasst', 0.0 h
--   27.-31.07. (KW 31, 5 Zeilen)  pruefung = 'ok', Std je 8.0, Zeit je 07:00-16:15
--   01./02.08. (Sa/So, 2 Zeilen)  pruefung = 'keine Zeit erfasst', 0.0 h
--
-- Alle zehn Werktagszeilen müssen 'ok' zeigen und einen Tätigkeitstext tragen.
-- Jede einzelne 'ABWEICHUNG' ist ein Fehlschlag — dann nicht weiterarbeiten,
-- sondern melden. (Wird BLOCK C bewusst ausgelassen, zeigen 27., 28., 30. und
-- 31.07. erwartungsgemäss 'ABWEICHUNG' mit 7.75 h statt 8.0 h.)
SELECT datum,
       to_char(datum, 'Dy')  AS tag,
       woche,
       start_zeit,
       end_zeit,
       pause_minuten,
       gesamtstunden,
       stunden_manuell,
       spesen,
       taetigkeit            AS gewerk,
       CASE
         WHEN start_zeit IS NULL OR end_zeit IS NULL THEN 'keine Zeit erfasst'
         WHEN ROUND(
                EXTRACT(EPOCH FROM (end_zeit - start_zeit)) / 3600.0
                - COALESCE(pause_minuten, 0) / 60.0
              , 2) = ROUND(gesamtstunden, 2) THEN 'ok'
         ELSE 'ABWEICHUNG'
       END                   AS pruefung,
       left(array_to_string(arbeiten, ' | '), 70) AS taetigkeit_anfang
FROM gs_tagesrapporte
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum BETWEEN DATE '2026-07-20' AND DATE '2026-08-02'
ORDER BY datum;

-- Wochentotale — erwartet: KW 30 = 40.0 h, KW 31 = 40.0 h, Spesen je 150.00
SELECT woche,
       ROUND(SUM(gesamtstunden), 2) AS total_stunden,
       ROUND(SUM(spesen), 2)        AS total_spesen,
       COUNT(*) FILTER (WHERE array_length(arbeiten, 1) > 0) AS zeilen_mit_text
FROM gs_tagesrapporte
WHERE projekt_id        = '64c695d5-0ef7-4864-9951-ed7163a92791'
  AND techniker_user_id = 'ee46a716-7017-4045-9f67-fe06d05171e7'
  AND datum BETWEEN DATE '2026-07-20' AND DATE '2026-08-02'
GROUP BY woche
ORDER BY woche;
