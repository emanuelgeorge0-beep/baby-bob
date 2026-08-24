# Arbeitsplan Montag, 24.08.2026

Stand: `main` @ 3fcd0e8, SW v33. Erstellt am Abend des 23.08.2026 als reine
Diagnose — an diesem Abend wurde nichts gebaut, nichts gemergt, nichts deployt.

**Womit anfangen:** Befund 1 (Spesen). Er ist der einzige, der Geld falsch
ausweist, und er steckt an neun Stellen plus in den Daten selbst.

---

## Geprüfte Regel

> Ein Kalendertag kann mehrere Tageszeilen auf verschiedenen Baustellen tragen.
> Stunden werden je Kalendertag addiert.
> Spesen fallen je Kalendertag einmal an, unabhängig von der Zahl der Baustellen.

Belegfall KW 34, `R-GSO-2026-0011`, Techniker Emanuel — live gegengelesen:

| Datum | Zeilen | Projekte | Stunden | Spesen roh | Spesen nach Regel |
|---|---|---|---|---|---|
| Mo 17.08. | 2 | 60829.00, 60060.00 | 6.00 + 2.00 = 8.00 | 60.00 | 30.00 |
| Di 18.08. | 3 | 60586.00, 60829.00, 60133.00 | 4.00 + 1.50 + 2.50 = 8.00 | 90.00 | 30.00 |
| Mi–Fr | je 1 | 60133.00 | je 8.00 | je 30.00 | je 30.00 |
| Sa/So | je 1 | 60133.00 | 0.00 | 0.00 | 0.00 |
| **Summe** | **10** | **4** | **40.00** | **240.00** | **150.00** |

Die **Stunden in der Datenbank sind korrekt** (40.00). Falsch sind die Spesen —
und zwar schon in den Daten, nicht erst in der Anzeige.

---

# TEIL 1 — Befunde, nach Schwere sortiert

## Befund 1 · Spesen werden je Zeile statt je Kalendertag gezählt · **schwer**

Wirkt sich auf Geld aus. Neun Codestellen und zusätzlich der Datenbestand.

### 1a · Die Wurzel liegt in den Daten, nicht im Code · 20 min Analyse

`gs_tagesrapporte.spesen` hängt an der **Zeile**. Beide Mehrfachtage im Bestand
tragen CHF 30 auf *jeder* Zeile:

```
2026-08-17  2 Zeilen  Spesen [30.0, 30.0]        -> SPESEN MEHRFACH
2026-08-18  3 Zeilen  Spesen [30.0, 30.0, 30.0]  -> SPESEN MEHRFACH
=> 2 von 2 Mehrfachtagen betroffen
```

Selbst eine perfekt summierende Anzeige käme damit auf 240.00. **Entscheidung
nötig, bevor irgendetwas gebaut wird** — siehe „Offene Entscheidung C" unten.

### 1b · Erfassungsseite: jede Zeile bietet ein eigenes Spesenfeld · 30 min

`app.html:11067-11069` (`tcRowHtml`) rendert Label, CHF-Chips und
`<input class="f-spesen">` in **jede** Zeile. Legt der Techniker eine zweite
Baustelle für denselben Tag an, bekommt er die volle Spesenauswahl erneut
angeboten — nichts warnt, nichts sperrt. Das ist die Stelle, an der die
falschen Daten entstehen.

### 1c · Sechs Summenstellen ohne Entduplizierung nach `datum`

| Datei:Zeile | Funktion / Action | Wirkung |
|---|---|---|
| `app.html:11232` | `tcRecalcTotals` | Wochenblatt-Fusszeile des Technikers. Summiert `.f-spesen` über alle DOM-Zeilen. `rowEl` trägt `data-date` (gesetzt in `:11035`) — die Information zum Entduplizieren liegt da und wird nicht benutzt. |
| `api/cockpit.js:3098` | `getTechWochenRapport` / `tech_wochen_rapport` | Wochenansicht des Technikers |
| `api/cockpit.js:3125` | `getTechWochenListe` / `tech_wochen_liste` | Wochenliste des Technikers. **`datum` wird nicht einmal selektiert** → Fix erfordert Query-Änderung |
| `api/cockpit.js:3168` | `pmWochenrapporteListe` / `pm_wochenrapporte_liste` | Master-Wochenliste. **`datum` fehlt ebenfalls im Select** |
| `api/cockpit.js:3255` | `pmWochenrapport` / `pm_wochenrapport` | Master-Detailansicht — **die folgenreichste**, sie ist die Grundlage der Wochenansicht im Cockpit |
| `lib/wochenbericht.js:868` | `sammleWochenrapport` (`r2s('spesen')`) | **Stundenblatt-PDF** — gestern gebaut. Gemessen: 240.00 statt 150.00 |

Aufwand: **90 min** für alle sechs, wenn die Regel aus Entscheidung C feststeht.
Zwei davon brauchen zusätzlich eine Query-Erweiterung um `datum`.

### 1d · Sonderfall Wochenbericht je Projekt · 30 min Analyse, danach entscheiden

`lib/wochenbericht.js:272` (Tagessumme) und `:306` (Wochensumme). **Innerhalb
eines Projektberichts ist die Zahl korrekt** — jeder Kalendertag erscheint dort
nur einmal, weil die Abfrage auf ein Projekt eingeschränkt ist. Gemessen KW 34:

```
60060.00   2.00 h   30.00      60133.00  26.50 h  120.00
60586.00   4.00 h   30.00      60829.00   7.50 h   60.00
------------------------------------------------------
Summe der vier Berichte:  40.00 h (richtig)  ·  240.00 (falsch)
```

Die Stunden verteilen sich sauber. Die Spesen erscheinen in **jedem** Bericht in
voller Tageshöhe. Wenn die vier Berichte an vier Rechnungen gehen, wird die
Tagespauschale dreifach verrechnet. Das ist kein Rechenfehler *im* Dokument,
sondern eine Frage der Zurechnung — sie gehört in Entscheidung C.

---

## Befund 2 · `byDate[r.datum] = r` verliert Stunden und Status · **schwer**

`api/tagesrapport.js:189-190`, Funktion `week()`, Action `week`. Ihre Vermutung
ist **bestätigt**:

```js
const byDate = {};
for (const r of Array.isArray(rows) ? rows : []) byDate[r.datum] = r;
```

Zuweisung statt Akkumulation. Bei drei Baustellen an einem Tag überlebt nur eine
Zeile. Die Abfrage hat **kein `order=`**, also ist undefiniert, welche.

Drei Folgen, alle in derselben Funktion:
- **Stunden** zu niedrig (nur die letzte Zeile).
- **Status** willkürlich: `entwurf` + `eingereicht` am selben Tag → die Ampel
  zeigt, was zufällig zuletzt kam.
- **Überzeit fehlt ganz** — `ueberzeit_25/50/100` werden nicht einmal selektiert.

Zwei Konsumenten in `app.html`:
- `trLoadWeek` (`:6705-6717`) — Mo–Fr-Statusleiste.
- `tsLoadWeek` (`:6818-6828`) — addiert `day.stunden` und **multipliziert mit dem
  Tarif**: `var lohn=Math.round(tot*tsTarif*100)/100;`. Der Fehler landet also in
  einer angezeigten Lohnsumme.

**Drei verwandte Stellen in derselben Datei:**

| Zeile | Funktion | Befund |
|---|---|---|
| `:213` | `statusOverview` | `arr2.find(r => r.datum === todayStr)` — greift eine Zeile heraus. Ein Tag ist erst grün, wenn *alle* seine Zeilen eingereicht sind. |
| `:217` | `statusOverview` | `week_submitted` zählt **Zeilen**, wird aber als „x/5 **Tage**" angezeigt (`app.html:6369`). Zwei Baustellen am Montag ⇒ „6/5 Tage". |
| `:100` | `today` | `limit=1` ohne `order`. Latent — der einzige Aufrufer übergibt `projekt_id`. |

**Korrekt in derselben Datei:** `hasOverdue` (`:327-330`) macht es richtig —
`new Set(...map(r => r.datum))`. Das ist die Vorlage für die Reparatur.

Aufwand: **60 min** für `week()` + `statusOverview`, **15 min** für `today()`.

### Offene Zahl, die ich nicht bestätigen kann

Sie berichten „rund 24.5 h statt 40.0 h". Mit `byDate` (letzte Zeile gewinnt)
komme ich rechnerisch auf **28.5 h**; selbst die ungünstigste Reihenfolge ergibt
27.5 h. 24.5 h passt zu keiner Kombination. Entweder stammt die Zahl aus einer
anderen Ansicht, oder es fehlt zusätzlich eine Zeile. **Morgen zuerst klären:
welcher Bildschirm zeigte 24.5?** — 10 min.

---

## Befund 3 · Fotodokumentation sprengt das Vercel-Antwortlimit · **schwer**

Neu von gestern, in Produktion **noch nie ausgeführt**. Gemessen an KW 29 mit
den zehn nachgetragenen Fotos:

```
PDF roh       6.72 MB  (10 Bilder)
base64        8.96 MB
JSON-Antwort  8.96 MB
Vercel-Limit  4.50 MB   -> UEBERSCHRITTEN
Hochrechnung auf den Deckel von 24 Bildern: ~16 MB PDF, ~22 MB JSON
```

`api/wochenbericht.js` liefert das PDF als `pdf_base64` im JSON-Körper. Ab etwa
**fünf Fotos** reisst das. Der Wochenbericht bleibt unter der Grenze (Deckel 6
Bilder, gemessen 1.87 MB), die Fotodokumentation nicht.

Drei Wege, alle ohne neue Abhängigkeit:
1. Bilder vor dem Einbetten verkleinern (JPEG neu kodieren — braucht einen
   Encoder, den `lib/pdf.js` nicht hat). **Aufwand hoch.**
2. PDF in den Storage schreiben und eine signierte URL zurückgeben, wie es
   `versendeBericht` bereits mit `wochenberichte/<projekt>/<nr>.pdf` tut.
   **Aufwand 60 min, empfohlen** — das Muster existiert schon.
3. Deckel auf 4–5 Bilder senken. **Aufwand 5 min**, aber macht das Feature
   für seinen Zweck unbrauchbar.

Aufwand: **60 min** für Weg 2. **Vor dem nächsten Deploy erledigen** — sonst
läuft die Fotodokumentation live in einen Fehler.

---

## Befund 4 · KW 32 und 33 (Ferien) stehen als „offen" in der Abrechnung · **mittel**

Die Daten sind korrekt erfasst — alle 14 Zeilen tragen `abwesenheit='F'`,
0.00 h, 0.00 Spesen, kein Projekt:

```
KW32  R-GSO-2026-0001  7 Zeilen  03.08.-09.08.  abwesenheit='F'  abrechnung=offen
KW33  R-GSO-2026-0006  7 Zeilen  10.08.-16.08.  abwesenheit='F'  abrechnung=offen
```

Ursache: `abrechnung_status` hat den Default `'offen'`, und mein Filter aus
Punkt 5 (`wrGruppe` in `gs-intern.html`) steckt jede Woche mit mindestens einer
nicht-verrechneten Zeile in „Offen". Eine reine Abwesenheitswoche hat aber
**nichts zu verrechnen** — sie gehört weder zu „Offen" noch zu „Verrechnet".

Vorschlag: fünfte Gruppe „Nichts zu verrechnen" für Wochen, deren Zeilen alle
0 Stunden und 0 Spesen tragen. Alternativ ein eigener Chip „Ferien/Abwesenheit".

Aufwand: **25 min** (Frontend-Gruppierung, kein SQL, keine Schemaänderung).

---

## Befund 5 · Toter Altcode mit falschem Tagesmodell · **niedrig**

`app.html:9445` ff. — `techDayData = {}`, ein Objekt **eine Zeile je Datum**,
ohne `projekt_id`, ohne `spesen`. Mehrere Baustellen an einem Tag lassen sich
darin gar nicht abbilden. Der Block ist im Dateikopf (`:9430-9436`) ausdrücklich
als tot markiert; `buildTechWeek()` wird von nichts Lebendem aufgerufen.

Keine Wirkung heute — aber genau die Struktur, die den Fehler wieder einführt,
wenn jemand sie wiederbelebt. Löschen oder deutlicher markieren.

Aufwand: **20 min** Löschen inkl. Prüfung der Aufrufer.

---

## Ausdrücklich KORREKT — hier ist nichts zu tun

Diese Stellen habe ich geprüft und für regelkonform befunden. Sie stehen hier,
damit morgen niemand dieselbe Prüfung wiederholt.

**Stunden werden überall additiv verdichtet.** Kein einziger Fund, an dem
Stunden je Tag falsch zusammengezählt werden — ausser Befund 2.

| Datei:Zeile | Funktion | Warum korrekt |
|---|---|---|
| `app.html:10515-10537` | `tcRenderWoche` | `zByDate[d]=[]` vorbelegt, dann `.push(z)` — akkumuliert. Eine gerenderte Zeile je Tageszeile unter einer Tageskarte. **Vorbild für alle anderen.** |
| `app.html:11228-11231` | `tcRecalcTotals` | Stunden und ÜZ 25/50/100 additiv — richtig |
| `app.html:11117-11175` | `tcAddRow`, `tcDayFixup` | Mehrere Zeilen je Tag sind erstklassiges Konzept, `tcRowSeq[date]` je Tag |
| `app.html:10133-10148` | `tcGoWocheNeueZeile` | erkennt die belegte Zeile und hängt an, statt zu überschreiben |
| `app.html:11393-11396` | `tcRowDel` | Fotozahl je Tageszeile — richtig, Fotos hängen an genau einer Zeile |
| `app.html:6498`, `6135`, `6157`, `8169` | diverse Summen | Stunden additiv |
| `api/tagesrapport.js:327-330` | `hasOverdue` | `new Set` auf `datum` — genau das fehlende Muster aus Befund 2 |
| `api/cockpit.js:3094-3097` | `getTechWochenRapport` | Stunden + ÜZ korrekt (nur `spesen` daneben falsch) |
| `api/cockpit.js:3068-3081` | `medien_anzahl` | je `tagesrapport_id`, `+=` — disjunkt, kein Doppelzählen |
| `api/cockpit.js:3219-3224` | `pmWochenrapport` Medien | Vereinigung über Zeilen-ids, jede Mediendatei einmal |
| `api/cockpit.js:3149,3154,3172-3184` | `pmWochenrapporteListe` | Zeilenzähler heissen „Zeilen"; Projekt-`Set` je Woche |
| `api/cockpit.js:4652-4681` | `exportRapporte` | Stunden je KW additiv; „Rapporte" ist als Zeilenzahl beschriftet |
| `api/cockpit.js:3915`, `3956` | `svcListe`, `svcDetail` | additiv, je Auftrag |
| `api/cockpit.js:3498-3512` | `setRapportAbrechnung` | `count` ist ausdrücklich eine Zeilenzahl |
| `lib/wochenbericht.js:269` | Fotos je Zeile | seit gestern über `tagesrapport_id` — richtig |
| `lib/wochenbericht.js:310`, `380`, `892` | Tageszählung | `new Set` auf `datum` bzw. Filter `stunden > 0` — richtig |
| `lib/pdf.js` | — | **verdichtet nichts.** Die beiden `reduce` sind Spaltenbreiten; `:1005-1009` druckt die Werte einer einzelnen Zeile |
| `gs-intern.html` | **die ganze Datei** | **Keine Verdichtungsfehler.** Alle Totale kommen vom Server; lokal wird nur über Stunden summiert. `:2364-2388` rendert eine `<tr>` je Tageszeile, nichts wird zusammengefasst. `:3168-3186` (`wbPaintVorschau`) ist Tageskarte → verschachtelte Zeilen — vorbildlich. |

**Nicht betroffen:** Umsatz und Margen lesen ausschliesslich `gs_umsatz_monat`
und `gs_margen`. Kein Umsatzpfad fasst `gs_tagesrapporte` an.

---

# TEIL 2 — Fotodokumentation, zwei Änderungswünsche

Beide nur untersucht, nichts gebaut.

## 2a · Ganze Woche über alle Projekte statt einzelnes Projekt

**Heute:** `erzeugeFotodoku({projektId, jahr, woche})` verlangt ein Projekt.
`sammleWochendaten` bricht ohne `projektId` ab (`lib/wochenbericht.js:88`:
`if (!projektId) throw new Error('projekt_id erforderlich')`).

**Betroffene Dateien:**
- `lib/wochenbericht.js` — neue Sammelfunktion ohne Projektfilter, oder Schleife
  über die Projekte der Woche mit Zusammenführung. Die Fotoabfrage müsste von
  `tagesrapport_id IN (Zeilen dieses Projekts)` auf `IN (Zeilen dieser Woche)`
  umgestellt werden.
- `api/wochenbericht.js` — `projekt_id` von Pflicht auf optional. Achtung: die
  Rechteprüfung `darfProjekt(projektId, …)` hängt genau daran und bräuchte einen
  Ersatz für den projektlosen Fall.
- `gs-intern.html` — Auswahl umbauen: Woche zuerst, Projekt und Tage als Filter.

**Aufwand:** 150 min, davon 40 min allein für die Rechteprüfung.

**Entscheidung A, die Sie vorher treffen müssen:** Was ist „alle Projekte"?
Ihre Formulierung „wie der Wochenbericht" trägt nicht — der Wochenbericht *ist*
Projekt × KW. Drei mögliche Bedeutungen:
1. alle Projekte, auf die in dieser Woche gebucht wurde (firmenweit),
2. alle Projekte **eines Kunden** in dieser Woche,
3. alle Projekte **eines Technikers** in dieser Woche.

Variante 3 passt zum Stundenblatt, Variante 2 zum Wochenpaket. Ohne diese
Antwort baue ich das Falsche.

## 2b · Projekt-Fotodokumentation über alle Fotos, ohne Wochenaufteilung

**Heute:** Es gibt keinen Weg dahin. Jede Fotosammlung ist wochengefenstert.

**Betroffene Dateien:**
- `lib/wochenbericht.js` oder besser eine neue `lib/fotodoku.js` — Sammlung nur
  über `projekt_id`, ohne Datumsfenster. Datum je Foto käme weiterhin über
  `tagesrapport_id → gs_tagesrapporte.datum`; Fotos aus dem Auffangnetz haben
  keines und tragen nur `created_at`. **Kein `import.meta` in neuen lib-Dateien.**
- `api/cockpit.js` oder `api/wochenbericht.js` — neue Action. Die Projektansicht
  lebt im Cockpit, das spricht für `api/cockpit.js`.
- `gs-intern.html:1736` — dort sitzt bereits der Abschnitt „📷 Fotos & Videos"
  (`medienSec`, gefüllt von `medienLoad` in `:2103`). Sauberster Andockpunkt.

**Mengengerüst heute:** `gs_projekt_medien` hat 11 Zeilen, das grösste Projekt
10 Fotos. Klein — aber genau deshalb trügerisch, siehe Befund 3.

**Aufwand:** 120 min.

**Entscheidung B, die Sie vorher treffen müssen:** Nach was wird gruppiert?
- **nach Tag** (wie heute) — braucht `tagesrapport_id`; die zehn Bestandsfotos
  haben keines und landeten alle im Sammelabschnitt am Ende.
- **nach Stockwerk** — `gs_projekt_medien.stockwerk` ist dafür gedacht und
  `medienList` gruppiert bereits so. Bei den Bestandsfotos aber leer.
- **rein chronologisch** nach `created_at` — funktioniert immer, sagt aber am
  wenigsten aus.

Zusätzlich: **Deckel und Grösse**. Ein Projekt mit 200 Fotos ergibt ohne
Verkleinerung ein PDF von über 100 MB. Befund 3 muss vorher gelöst sein.

---

# TEIL 3 — Weitere offene Punkte

## Entscheidung C · Wie werden Spesen künftig geführt? · Voraussetzung für Befund 1

Drei Wege, keiner davon in dieser Runde entschieden:

1. **Beim Erfassen erzwingen** — das Wochenblatt bietet Spesen nur auf der
   ersten Zeile eines Tages an, weitere Zeilen erben sie sichtbar.
   *Sauberste Daten, ändert die Erfassung.* ~90 min plus Bereinigung des
   Bestands per SQL.
2. **Beim Lesen entduplizieren** — jede Summe nimmt je `datum` nur den höchsten
   Spesenwert. *Kein Eingriff in die Erfassung, aber sechs Stellen müssen es
   konsistent tun, und die Daten bleiben mehrdeutig.* ~90 min.
3. **Beides** — Erfassung führt, Lesen sichert ab. ~150 min. Empfehlung.

Offen bleibt zusätzlich, **welchem Projekt** die Tagespauschale zugerechnet
wird, wenn ein Tag drei Baustellen hat (Befund 1d): dem ersten, dem mit den
meisten Stunden, oder anteilig?

## Die 13 Projekte ohne `kunde_id`

Sie zwingen die Sammelmaske („Wochenpaket") in den Behelfseintrag
„— Projekte ohne Kunde —". Reine Datenpflege, keine Schemaänderung.

| Projektnummer | Bezeichnung | Status |
|---|---|---|
| DEMO-001 | DEMO · Fernwärmezentrale MFH Seefeld | aktiv |
| DEMO-002 | DEMO · Sanitär-Sanierung Wohnblock Aarau | aktiv |
| DEMO-003 | DEMO · Splitklima Büro Baar | aktiv |
| DEMO-GEIGER | Geiger AG | aktiv |
| P-2026-0001 | Tannenrauchstrasse 35 | aktiv |
| **P-2026-3470** | **Langstrasse 149 8004 Zürich Schweiz** | aktiv |
| *(ohne Nr)* | Test Wohnblock mit 10 WEH | aktiv |
| *(ohne Nr)* | Servicearbeit Pumpe austauschen | aktiv |
| *(ohne Nr)* | Fernwärme zentrale Bauen | aktiv |
| *(ohne Nr)* | Fernwärme zentrale Bauen | aktiv |
| *(ohne Nr)* | Stranggebrechen | aktiv |
| *(ohne Nr)* | Heizungszentrale mit Luftwärmepumpe | aktiv |
| *(ohne Nr)* | Badezimmer Sanierung | aktiv |

Vier davon sind Demo-Daten, zwei „Fernwärme zentrale Bauen" sehen nach einem
Doppeleintrag aus. **P-2026-3470 ist das einzige produktive mit Buchungen** —
es allein zuzuweisen macht das Wochenpaket für KW 29–31 sofort brauchbar.

Aufwand: **15 min** für P-2026-3470 allein, **45 min** für alle 13 inklusive
Klärung der Dubletten.

## Erledigt und verifiziert (kein Handlungsbedarf)

- **Backfill gelaufen.** `gs_projekt_medien` hat 11 Zeilen, davon 10 für
  P-2026-3470 aus `bilder/`, alle mit `tagesrapport_id = NULL`.
- **Auffangnetz funktioniert.** KW 29 zeigt `fotos_ohne_tag = 10`; der
  Wochenbericht bettet 4 davon ein (eigener Deckel) und trägt den Abschnitt
  „Ohne Tageszuordnung". Fotodoku-Vorschau meldet 10 von 10 innerhalb des
  Deckels von 24.
- **KW-30-SQL gelaufen.** Das Stundenblatt zeigt Mo 20.07. mit 07:00–16:45 und
  8.50 h samt Tätigkeitstext.
- **Testlage grün.** 8 Testläufe ohne Fehler, `test_wochenbericht_pdf` seit
  3fcd0e8 bei 56/56.

---

# Reihenfolge für Montag

| # | Aufgabe | Minuten | Warum diese Stelle |
|---|---|---|---|
| 1 | Klären: welcher Bildschirm zeigte 24.5 h? | 10 | Meine Rechnung sagt 28.5 — die Lücke muss weg, bevor repariert wird |
| 2 | **Entscheidung C** treffen (Spesenführung) | 20 | Blockiert Befund 1 vollständig |
| 3 | Befund 3: Fotodoku-PDF in den Storage | 60 | Läuft sonst beim ersten Live-Aufruf in einen Fehler |
| 4 | Befund 2: `week()` + `statusOverview` | 60 | Falsche Stunden und falscher Lohn in der Technikeransicht |
| 5 | Befund 1c: sechs Spesensummen | 90 | Erst nach Entscheidung C |
| 6 | Befund 1b: Erfassungsseite | 30 | Verhindert neue falsche Daten |
| 7 | Bestand bereinigen (SQL nach `scripts/`) | 30 | Zwei Tage betroffen — überschaubar |
| 8 | Befund 4: Ferienwochen aus „Offen" nehmen | 25 | Kosmetisch, aber täglich sichtbar |
| 9 | P-2026-3470 einen Kunden geben | 15 | Macht das Wochenpaket sofort brauchbar |
| 10 | **Entscheidungen A und B** treffen (Teil 2) | 20 | Erst danach lohnt sich Bauen |
| 11 | Befund 5: toten Altcode löschen | 20 | Aufräumen, wenn Zeit bleibt |
| | **Summe ohne Teil 2** | **~6 h** | |
| | Teil 2a + 2b, falls A und B entschieden | +270 | eigener Tag |

**Nicht vergessen:** `main` ist seit 3fcd0e8 gepusht, aber der Smoke-Test gegen
`baby-bob.vercel.app` inklusive Prüfung auf SW v33 steht noch aus.
