# Testplan Berichtsmodus M1 — Saetze, die wahr sein muessen

Fuer die Runde, in der `scripts/berichtsmodus_m1.sql` tatsaechlich laeuft. Diese
Runde ist Papier; hier steht, woran spaeter gemessen wird.

Der Plan ist so geschnitten, dass er **vor** dem Bauen als Abnahmeliste taugt:
jeder Punkt ist ein Satz, der wahr oder falsch ist, kein „funktioniert gut".

---

## 0 Rahmen

**Form.** Ein Regressionsskript im Stil des Hauses:
`scripts/test_berichtsmodus.mjs`, aufgerufen als
`node --env-file=.env.local scripts/test_berichtsmodus.mjs [baseUrl]`, mit dem
bekannten Zaehler `let pass = 0, fail = 0;` und `ok(bedingung, meldung)` —
Muster `scripts/test_zeitfeld_wache.mjs:21-22`. Danach in
`scripts/test_all.mjs:11-17` in die Suite-Liste eintragen.

**Der stehende Massstab.** Die Suite laeuft **fuenfmal hintereinander
vollstaendig gruen**, bevor irgendetwas als fertig gemeldet wird, und deckt
**alle vier Rollen** ab: Master, Partner, Techniker, Nicht-berechtigt. Keine
Handprobe als Ersatz.

**Testdaten.** Eigene Berichte eines Testpartners, die die Suite am Ende wieder
aufraeumt — Muster `scripts/test_zeitfeld_wache.mjs`, das in Jahr 2099 schreibt
und aufraeumt. Achtung, hier gibt es eine Besonderheit: **ein freigegebener
Testbericht laesst sich nicht mehr loeschen** (T-Z6). Das Aufraeumen darf
deshalb nur Entwuerfe entfernen; freigegebene Testberichte bleiben stehen und
muessen an einem eigenen Testpartner haengen, damit sie keinen echten
Nummernkreis verschmutzen. **Kein Testlauf fasst `gs_tagesrapporte`,
`gs_projekte`, `gs_kunden` oder `gs_wochenberichte` schreibend an**, ausser den
in T-E genannten `extern_*`-Spalten an eigens angelegten Testzeilen.

**Reihenfolge.** T-M zuerst (Migration), dann T-Z (Zustandskette), T-N
(Nummernkreis), T-H (Hash), T-K (Katalog/Snapshot), T-S (Datentrennung), T-E
(Export), zuletzt T-R (Regression auf dem Bestand). Faellt T-M, wird nicht
weitergetestet. Faellt T-Z, wird nicht ausgeliefert — M4 ist nicht verhandelbar.

---

## T-M · Migration

| # | Satz, der wahr sein muss |
|---|---|
| T-M1 | Das Skript laeuft in der Zieldatenbank fehlerfrei durch. |
| T-M2 | Ein **zweiter** Lauf direkt danach laeuft ebenfalls fehlerfrei durch und legt nichts doppelt an (Idempotenz — jedes `create` ist `if not exists`, jeder Constraint guarded, jeder Trigger `drop … if exists` davor). |
| T-M3 | Danach existieren genau neun Tabellen: `select table_name from information_schema.tables where table_schema='public' and (table_name='gs_berichte' or table_name like 'gs_bericht\_%')` → 9 Zeilen. |
| T-M4 | `select count(*)` ist vor und nach dem Lauf identisch fuer `gs_projekte`, `gs_kunden`, `gs_tagesrapporte`, `gs_wochenberichte`, `gs_taetigkeitenkatalog`, `gs_tagesrapport_taetigkeitenkatalog`. |
| T-M5 | Kein `drop table` und kein `alter … drop column` im Skript. Pruefbar per `grep -in "drop table\|drop column" scripts/berichtsmodus_m1.sql` → genau **ein** Treffer, die Kopfzeile 13 („KEIN DROP TABLE"), keine Anweisung. Die vorhandenen `drop trigger if exists` und `drop policy if exists` sind zulaessig und die einzigen `drop`s. |
| T-M6 | Die sechs Funktionen existieren: `gs_bericht_nr_next`, `gs_bericht_touch`, `gs_bericht_zustand_wache`, `gs_bericht_kein_delete`, `gs_bericht_inhalt_wache`, `gs_bericht_ereignis_wache`. |
| T-M7 | Die Vorpruefung in Teil 0 bricht sauber ab, wenn `gs_projekte` fehlt — pruefbar, indem man den `raise`-Zweig einzeln gegen einen falschen Tabellennamen laufen laesst. |
| T-M8 | `gs_bericht_bausteine` ist nach dem Lauf **leer**. Das Skript legt keine Bausteintexte an — die kommen von Emanuel und sind M2. |

---

## T-Z · Zustandskette (M4, nicht verhandelbar)

Der Kern dieser Runde. Jeder Satz hier prueft, dass die Kette **technisch
erzwungen** ist, nicht nur dokumentiert. Alle Negativtests laufen mit dem
`service_role`-Key — genau dem Key, mit dem der Server arbeitet
(`api/cockpit.js:30`) und der RLS umgeht. Ein Test, der nur mit dem anon-Key
scheitert, beweist nichts.

| # | Satz, der wahr sein muss |
|---|---|
| T-Z1 | `entwurf → freigegeben` gelingt, wenn mindestens ein Abschnitt existiert und `freigegeben_von` gesetzt ist. |
| T-Z2 | `freigegeben → versendet` gelingt, wenn `versendet_von` gesetzt ist. |
| T-Z3 | `freigegeben → entwurf` **scheitert** mit `check_violation` und der Meldung „Rueckweg … ist nicht erlaubt". Auch mit `service_role`. |
| T-Z4 | `versendet → freigegeben` und `versendet → entwurf` **scheitern** ebenso. |
| T-Z5 | `entwurf → versendet` **scheitert** („Sprung … ist nicht erlaubt") — die Freigabe laesst sich nicht ueberspringen. |
| T-Z6 | `delete from gs_berichte` auf einen freigegebenen oder versendeten Bericht **scheitert**. Auf einen Entwurf gelingt es. |
| T-Z7 | Nach der Freigabe scheitert jedes `update` auf `titel`, `datum`, `projekt_id`, `partner_user_id`, `bericht_nr`, `fassung`, `ersetzt_bericht_id`, `inhalt_hash`, `freigegeben_am`, `freigegeben_von` — je einzeln geprueft, zehn Faelle. |
| T-Z8 | Nach der Freigabe gelingt weiterhin: `zustand` vorwaerts, `versendet_am`, `versendet_von`, `pdf_path`, die fuenf `extern_*`-Spalten, `geloescht_am`. |
| T-Z9 | Nach der Freigabe scheitert `insert`, `update` und `delete` auf `gs_bericht_abschnitte` fuer diesen Bericht — drei Faelle. |
| T-Z10 | Nach der Freigabe scheitert dasselbe fuer `gs_bericht_zusatzarbeit` — drei Faelle. |
| T-Z11 | Ein Abschnitt laesst sich nicht per `update bericht_id` aus einem freigegebenen Bericht heraus verschieben (die Aushoehlung ueber den Umweg). |
| T-Z12 | `gs_bericht_uebersetzungen` laesst sich nach der Freigabe **weiterhin** anlegen und aendern — Uebersetzungen sind Beilage, bewusst nicht eingefroren. |
| T-Z13 | Freigabe eines Berichts **ohne Abschnitte** scheitert („Freigabe ohne Abschnitte"). |
| T-Z14 | Freigabe ohne `freigegeben_von` scheitert; Versand ohne `versendet_von` scheitert. |
| T-Z15 | Der `check` `gs_berichte_zustand_zeit_chk` faengt eine von Hand inkonsistent gesetzte Zeile ab: `zustand='freigegeben'` ohne `freigegeben_am` scheitert auch dann, wenn der Trigger umgangen wuerde. |
| T-Z16 | `update` auf `gs_bericht_ereignis` scheitert. `delete` auf `gs_bericht_ereignis` scheitert. `insert` gelingt. |

---

## T-N · Nummernkreis

| # | Satz, der wahr sein muss |
|---|---|
| T-N1 | Ein Bericht im Zustand `entwurf` hat `bericht_nr is null` und `bericht_seq is null`. Die Nummer entsteht nicht beim Anlegen. |
| T-N2 | Nach der Freigabe ist `bericht_nr` gesetzt und hat die Form `B-` + sechs Ziffern. |
| T-N3 | Zwei Berichte desselben Partners bekommen aufeinanderfolgende `bericht_seq` ohne Sprung. |
| T-N4 | **Lueckenlosigkeit:** `select partner_user_id from gs_berichte where bericht_seq is not null group by partner_user_id having count(*) <> max(bericht_seq)` liefert **0 Zeilen** (bezogen auf einen frischen Testpartner). |
| T-N5 | **Nebenlaeufigkeit:** 20 gleichzeitige Freigaben desselben Partners erzeugen 20 verschiedene `bericht_seq` von 1 bis 20, ohne Duplikat und ohne Luecke. Ausgefuehrt als 20 parallele Requests, nicht sequenziell — sonst prueft der Test nichts. |
| T-N6 | **Rollback gibt die Nummer zurueck:** eine Freigabe, die nach dem Ziehen scheitert (z.B. weil `freigegeben_von` fehlt), hinterlaesst **keine** verbrauchte Nummer — der naechste erfolgreiche Bericht bekommt die Nummer, die die gescheiterte gezogen haette. Dieser Satz ist der eigentliche Unterschied zum Bestand (`api/cockpit.js:2736-2739`, wo Luecken ausdruecklich erlaubt sind). |
| T-N7 | Zwei **verschiedene** Partner haben getrennte Kreise: beide beginnen bei 1, `B-000001` existiert zweimal, und der UNIQUE-Index `(partner_user_id, bericht_nr)` laesst das zu. |
| T-N8 | Ein zweites `update` auf `zustand='freigegeben'` (idempotenter Retry des Servers) zieht **keine** zweite Nummer — `bericht_nr` bleibt unveraendert. |
| T-N9 | `gs_bericht_nr_next` ist fuer `public` nicht ausfuehrbar und fuer `service_role` ausfuehrbar. |
| T-N10 | Es gibt keinen stillen Fallback: schlaegt die Nummernvergabe fehl, scheitert die **Freigabe**, statt einen Bericht ohne Nummer entstehen zu lassen. Gegenmuster: `api/cockpit.js:2683` (`catch (_) { return null; }`). |

---

## T-H · Inhalts-Hash

| # | Satz, der wahr sein muss |
|---|---|
| T-H1 | Nach der Freigabe ist `inhalt_hash` gesetzt, 64 Zeichen hex. |
| T-H2 | Zwei Berichte mit identischen Abschnitten in identischer Reihenfolge haben denselben `inhalt_hash`. |
| T-H3 | Zwei Berichte, die sich in genau einem Zeichen eines Abschnitts unterscheiden, haben verschiedene `inhalt_hash`. |
| T-H4 | Zwei Berichte mit denselben Abschnitten in **anderer Reihenfolge** haben verschiedene `inhalt_hash` (die Sortierung geht in die kanonische Form ein). |
| T-H5 | Der Hash laesst sich ausserhalb der DB nachrechnen: derselbe Wert entsteht, wenn man die Abschnitte nach `sortierung, id` liest, mit `0x1f` zwischen Sortierung und Text und `0x1e` zwischen den Abschnitten verbindet und SHA-256 bildet. Dieser Satz macht den Hash pruefbar statt nur vorhanden. |
| T-H6 | Ein Aendern eines Abschnitts nach der Freigabe ist unmoeglich (T-Z9) — also kann `inhalt_hash` nie veralten. Der Test belegt beides zusammen. |
| T-H7 | Der Server liefert den Hash **nicht** — ein mitgeschicktes `inhalt_hash` im Body wird beim Uebergang vom Trigger ueberschrieben. |

---

## T-K · Katalog und Snapshot

Diese Gruppe prueft die Regel des Hauses aus
`scripts/taetigkeiten_katalog.sql:154-155` fuer den Berichtsmodus.

| # | Satz, der wahr sein muss |
|---|---|
| T-K1 | Ein Abschnitt laesst sich ohne `text_snapshot` nicht anlegen (NOT NULL). |
| T-K2 | **Umbenennen:** ein Baustein wird nach der Freigabe umbenannt → der Bericht zeigt weiterhin den alten Text. Gelesen wird ueber den regulaeren Anzeigepfad, nicht per Direktabfrage. |
| T-K3 | **Deaktivieren:** `aktiv=false` auf dem Baustein → der Bericht ist unveraendert, der Baustein erscheint nur nicht mehr in der Auswahl. |
| T-K4 | **Loeschen:** wird der Baustein geloescht, bleibt der Abschnitt vollstaendig lesbar, `baustein_id` wird `null` (`on delete set null`). |
| T-K5 | Der Server fuellt `text_snapshot` selbst: ein Request, der `baustein_id` und einen **abweichenden** Text schickt, erzeugt einen Abschnitt mit dem Text **aus der Datenbank**, nicht mit dem des Clients. (Gegenmuster im Bestand: `app.html:11841` → `api/cockpit.js:2980`.) |
| T-K6 | Der Anzeige- und PDF-Pfad joint **nirgends** auf `gs_bericht_bausteine`. Pruefbar statisch: `grep -n "gs_bericht_bausteine" lib/ api/` zeigt Treffer nur in Katalogpflege und Abschnitts-Erzeugung, nicht im Lesepfad. |
| T-K7 | `slug` eines Bausteins laesst sich nicht aendern, sobald er verwendet wird — oder die Aenderung veraendert nachweislich keinen bestehenden Bericht. Einer der beiden Saetze muss wahr sein. |
| T-K8 | Ein globaler (`partner_user_id is null`) und ein partnereigener Baustein duerfen denselben `slug` tragen; zwei globale nicht; zwei desselben Partners nicht. Drei Faelle. |

---

## T-S · Datentrennung

Alle vier Rollen. Das ist die Gruppe, die der Bestand am ehesten reisst
(`docs/m1/architektur.md`, 1.4).

| # | Satz, der wahr sein muss |
|---|---|
| T-S1 | `partner_user_id` ist NOT NULL: ein `insert` ohne Mandant scheitert — auch mit `service_role`. |
| T-S2 | Partner A sieht in der Liste keinen Bericht von Partner B. Geprueft ueber den Endpunkt, nicht ueber die Tabelle. |
| T-S3 | Partner A kann einen Bericht von Partner B nicht einzeln lesen, nicht aendern, nicht freigeben, nicht versenden — vier Faelle, alle `403`. |
| T-S4 | Der Server setzt `partner_user_id` aus `scope.partnerId`; ein im Body mitgeschicktes `partner_user_id` wird **ignoriert**, nicht uebernommen. (Gegenmuster: `api/projekte.js:117`.) |
| T-S5 | Ein Bericht mit `projekt_id = null` gehoert trotzdem eindeutig einem Partner und ist fuer alle anderen unsichtbar. Das ist der Fall, den es im Bestand nicht gibt. |
| T-S6 | Ein Techniker sieht nur Berichte, die er selbst erstellt hat oder die zu einem ihm zugewiesenen Projekt gehoeren — und kann keinen fremden freigeben. |
| T-S7 | Ein nicht angemeldeter Aufruf jeder Berichts-Action liefert `401`, kein Datenleck. Vergleichsfall, der das heute verletzt: `api/gs.js:17-29`. |
| T-S8 | Jede ID in jedem Berichts-Endpunkt wird gegen `UUID_RE` validiert, bevor sie in einen PostgREST-Query geht — Muster `api/cockpit.js:2131`, nicht `api/tagesrapport.js:58`. Statisch pruefbar. |
| T-S9 | RLS ist auf allen neun Tabellen aktiv, und mit dem **anon**-Key liefert jede Tabelle 0 Zeilen fuer einen fremden Partner. |

---

## T-E · Export und Idempotenz

| # | Satz, der wahr sein muss |
|---|---|
| T-E1 | Die fuenf `extern_*`-Spalten existieren auf `gs_projekte`, `gs_kunden`, `gs_tagesrapporte` und `gs_berichte` — 20 Faelle, per `information_schema.columns` geprueft. |
| T-E2 | Zwei Zeilen desselben Partners mit gleichem `(extern_system, extern_id)` scheitern am UNIQUE-Index — je fuer `gs_projekte`, `gs_kunden`, `gs_berichte`. |
| T-E3 | Zwei Zeilen **verschiedener** Partner mit gleichem `(extern_system, extern_id)` sind erlaubt — der Schluessel enthaelt den Mandanten. |
| T-E4 | Zeilen mit `extern_id is null` kollidieren nie (partieller Index) — beliebig viele erlaubt. |
| T-E5 | `extern_export_status` akzeptiert nur `offen`, `gesendet`, `bestaetigt`, `fehler` und `null`; jeder andere Wert scheitert. Vier Tabellen. |
| T-E6 | Bei `gs_tagesrapporte` ist der Schluessel `(extern_system, extern_id)` **ohne** Mandant — der Test haelt das ausdruecklich fest, damit die Einschraenkung sichtbar bleibt, bis L-21 entschieden ist. |
| T-E7 | Ein zweiter Export derselben Zeile schreibt keinen zweiten Datensatz, sondern aktualisiert `extern_export_am` und `extern_export_status`. (Gilt fuer die Runde, in der der Export gebaut wird.) |

---

## T-A · Auditspur

| # | Satz, der wahr sein muss |
|---|---|
| T-A1 | Jede Freigabe erzeugt genau einen Eintrag in `gs_bericht_ereignis` mit `art='freigegeben'`, gesetztem `akteur_user_id` und gesetztem `inhalt_hash`. |
| T-A2 | Jeder Versand erzeugt genau einen Eintrag mit `art='versendet'`, `kanal`, `absender`, `betreff`, `empfaenger`, `ergebnis_ok` und — bei Mailversand — `provider_id`. Der Bestand wirft die Provider-ID heute weg (`lib/mail.js:73-76` vs. `lib/wochenbericht.js:2103`); dieser Satz haelt fest, dass das hier nicht passiert. |
| T-A3 | `am` kommt aus der Datenbank: ein im Body mitgeschickter Zeitstempel landet nicht in der Spalte. Eine Uhr, nicht zwei (`lib/wochenbericht.js:2096` vs. `scripts/wochenbericht.sql:166`). |
| T-A4 | Ein fehlgeschlagener Versand erzeugt ebenfalls einen Eintrag, mit `ergebnis_ok=false` und gefuelltem `fehler` — die Spur zeigt auch, was **nicht** geklappt hat. |
| T-A5 | Wird ein Bericht spaeter geloescht (nur als Entwurf moeglich), bleiben seine Ereigniszeilen stehen, `bericht_id` wird `null`, `bericht_nr` bleibt lesbar (`on delete set null`, Muster `scripts/wochenrapport_feinschliff.sql:60-73`). |
| T-A6 | Der Versand protokolliert **vor** dem Absenden den Versuch und danach das Ergebnis — oder er protokolliert atomar. Ein Versand ohne Spur darf es nicht geben. Muster: `api/cockpit.js:2761-2770` loggt vor dem Eingriff. |

---

## T-F · Fassung und Ersatz

| # | Satz, der wahr sein muss |
|---|---|
| T-F1 | `fassung=1` mit `ersetzt_bericht_id` gesetzt scheitert; `fassung>1` ohne `ersetzt_bericht_id` scheitert (`gs_berichte_fassung_chk`). |
| T-F2 | Ein Bericht kann hoechstens **einmal** ersetzt werden — ein zweiter Bericht mit demselben `ersetzt_bericht_id` scheitert am UNIQUE-Index. |
| T-F3 | Ein ersetzter Bericht laesst sich nicht loeschen, solange die Nachfolgerin auf ihn zeigt (`on delete restrict`). |
| T-F4 | Die Korrektur eines freigegebenen Berichts laeuft **ausschliesslich** ueber eine neue Fassung — es gibt keinen Endpunkt, der den alten aendert. Statisch und dynamisch geprueft. |
| T-F5 | Die neue Fassung bekommt eine **eigene** Berichtsnummer aus demselben Kreis; die alte behaelt ihre. Keine Nummer wird recycelt. |

---

## T-R · Regression auf dem Bestand

Nichts von alledem darf Bestehendes anfassen.

| # | Satz, der wahr sein muss |
|---|---|
| T-R1 | Der Wochenbericht (Erstellen, Vorschau, Versand, Sammelbericht) verhaelt sich unveraendert — bestehende Suite laeuft gruen. |
| T-R2 | Tagesrapport und Wochenblatt verhalten sich unveraendert, insbesondere `scripts/test_zeitfeld_wache.mjs`. |
| T-R3 | Der Taetigkeitenkatalog und sein Snapshot sind unberuehrt: Zeilenzahl und Inhalte vor/nach identisch. |
| T-R4 | `gs_rapport_nr_next` und der Rapport-Nummernkreis sind unberuehrt — der neue Kreis ist eine eigene Tabelle und eine eigene Funktion. |
| T-R5 | Der Service-Worker-Cache bleibt bei **v42** (`cockpit-sw.js:5`). Diese Runde aendert ihn nicht. |
| T-R6 | `vercel.json` `outputDirectory` ist unveraendert `"."`. |
| T-R7 | Die fuenf neuen Spalten auf `gs_projekte`, `gs_kunden` und `gs_tagesrapporte` sind auf allen Bestandszeilen `null` und aendern kein Verhalten — jede bestehende Query, die `select=*` benutzt, bekommt sie zusaetzlich und darf daran nicht scheitern. Dieser Satz ist der einzige echte Eingriff dieser Migration in Bestehendes und gehoert bewusst geprueft. |

---

## Abnahme

Die Runde gilt als bestanden, wenn:

- alle Gruppen gruen sind, **fuenfmal hintereinander**;
- T-Z vollstaendig gruen ist — faellt auch nur ein Satz aus T-Z, ist der Bericht
  kein Nachweis, und die Runde ist nicht bestanden, egal wie der Rest aussieht;
- T-N6 (Rollback gibt die Nummer zurueck) und T-H5 (Hash extern nachrechenbar)
  gruen sind — das sind die zwei Saetze, die den Unterschied zum Bestand
  ausmachen;
- T-R7 an echten Bestandsdaten geprueft ist, nicht nur an Testzeilen.
