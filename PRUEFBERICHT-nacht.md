# PRÜFBERICHT — Nachtlauf

**Branch:** `fix/tageskarten-leer` · nicht gemergt, nicht deployed, SW unverändert v23, kein SQL
**Umfang:** ZUSATZ 1 (Scroll-Isolation) gebaut, ZUSATZ 2 (a–e) vollständig durchgeführt

---

## Gesamtergebnis

| Prüfung | Umfang | Ergebnis |
|---|---|---|
| Wochenblatt im echten Browser (`repro_wochenblatt.mjs`) | 5 Szenarien, 73 Einzelprüfungen | ✓ bestanden |
| Rollen & Aufrufketten (`test_regression_rollen.mjs`) | 463 Prüfungen | ✓ bestanden |
| ISO-Kalenderwoche (`test_isowoche.mjs`) | 7317 Prüfungen, jeder Tag 2026–2030 | ✓ bestanden |
| Katalog-Ähnlichkeit (`test_katalog_aehnlich.mjs`) | 77 Prüfungen | ✓ bestanden |
| Syntax aller HTML-Skriptblöcke + `api/*.js` | 32 Blöcke/Dateien | ✓ bestanden |
| Console-Fehler im Durchlauf | alle 5 Szenarien | **0** |
| Netzwerkfehler im Durchlauf | alle 5 Szenarien | **0** |

---

## ZUSATZ 1 — Scroll-Isolation des Rades

Umgesetzt und mit **echten Touch-Events** geprüft (Szenario D, Chrome mit
aktivierten Touch-Events, 390×844):

| Anforderung | Umsetzung | geprüft |
|---|---|---|
| `overscroll-behavior: contain` | auf `.tc-wheel` und `.tc-wheel-col` | ✓ computed `contain` |
| `touch-action: pan-y` nur im Rad | `.tc-wheel-col`; Hintergrund und Blatt auf `none` | ✓ computed `pan-y` / `none` |
| Seite hinter dem Rad sperren | `tcSeiteSperren()` setzt `body{position:fixed;top:-Y}` | ✓ `position:fixed`, `top:-420px` |
| exakt zurück an dieselbe Stelle | `tcSeiteFreigeben()` + `scrollTo(0,Y)` | ✓ wieder auf 420, auch nach Tap ausserhalb |
| Tap ausserhalb schliesst | Backdrop-Klick | ✓ |
| Trägheit abfangen | `scroll-snap-stop:always` + kein Einrasten solange ein Finger aufliegt | ✓ Woche wechselt erst nach `touchend` |

`position:fixed` auf dem Body ist bewusst gewählt: `overflow:hidden` allein
greift auf iOS Safari nicht. Der Preis ist der Sprung nach oben, deshalb wird
die Scrollposition gemerkt und beim Schliessen exakt wiederhergestellt.

**Dabei gefunden und mitkorrigiert:** die 80-ms-Aufbausperre (`tcWheelBusy`)
verschluckte Wischgesten, die unmittelbar nach dem Öffnen begannen — das Rad
wirkte in der ersten Zehntelsekunde tot. Eine echte Berührung schlägt die
Sperre jetzt durch (`if(tcWheelBusy && !tcWheelGeste) return;`).

---

## ZUSATZ 2a — Jeder Weg im Wochenblatt einmal durchlaufen

Szenario E, 44 Prüfungen. Jeder Schritt musste **messbar** etwas bewirken —
geprüft wurde jeweils die Wirkung im DOM *und* was `tcCollectRow` an den Server
schicken würde, nicht bloss "kein Fehler".

| # | Weg | belegt durch |
|---|---|---|
| 1 | Projekt wählen | Feldblock wird sichtbar, `projekt_id` in den Speicherdaten |
| 2 | Gewerk | 5 Chips, Auswahl markiert, `taetigkeit:'Heizung'` |
| 3 | Start/Ende über Chips | Felder auf 07:00 / 17:00 |
| 4 | Pause + Stundenrechnung | 1.25 h vorbelegt; (Ende−Start)−Pause auf Halbstunden = 9.00; Pause ändern rechnet neu |
| 5 | Stunden von Hand | `data-manuell=1`, Hinweis „abweichend" sichtbar, Merkmal geht mit |
| 6 | Spesen | 4 Chips, Auswahl setzt CHF 30 |
| 7 | Tätigkeits-Picker | öffnet; **Ziel 6**: 2 Vorschläge, projektbezogener zuerst und hervorgehoben; 3 Kategorien |
| 8 | Tätigkeit hinzufügen | Eintrag erscheint, geht mit an den Server, Pille erscheint |
| 9 | Tätigkeit löschen + Rückgängig | verschwindet, kommt an derselben Stelle zurück |
| 10 | Notiz | Text landet in den Speicherdaten |
| 11 | Diktat | Knopf vorhanden, Freitext landet in den Speicherdaten |
| 12 | Autosave | `tech_tag_save` gefeuert, gespeicherte Werte stimmen (Gewerk/Spesen/Stunden) |
| 13 | weiterer Eintrag / löschen / Rückgängig | +1, Löschknopf auch ohne id, −1, Rückgängig +1 |
| 14 | Unterschrift zeichnen | 240 px, Zeichnen erkannt, Bild erzeugt, **Ziel 7** Schimmer auf „speichern" |
| 15 | Unterschrift löschen + Rückgängig | Pille erscheint, Zeichnung kommt zurück |
| 16 | Unterschrift senden + Einreichen | `tech_wochen_sign` mit Bilddaten, `tech_wochen_einreichen` gerufen |
| 17 | Netz | kein ungewollter Netzzugriff |

Das Rad (Weg „Wheel") ist in den Szenarien B und D abgedeckt.

---

## ZUSATZ 2c — Die acht Ziele der Runde

Keines ist durch den Fix beschädigt.

| Ziel | Zustand | Beleg |
|---|---|---|
| 1 Rückgängig | ✓ | Szenario C + E: Eintrag, Tätigkeit, Unterschrift je hinzufügen/löschen/zurücknehmen; Pille sitzt über der Navigation |
| 2 Master löscht Rapport | ✓ unberührt | keine Änderung an `gs-intern.html`/`api` in dieser Nacht; 463 Rollen-Prüfungen |
| 3 Rapportnummer | ✓ unberührt | dito; Migration bereits live verifiziert |
| 4 Wochen-Rad | ✓ **verbessert** | Szenario B: 53 Wochen für 2026, Datumsspanne, Tap lädt genau diese Woche; Szenario D: Isolation |
| 4b ISO-Korrektur | ✓ | 7317 Prüfungen; KW33/2026 = 10.08., KW1/2027 = 04.01. |
| 5 Lesbarkeit | ✓ | Szenario C: „Montag" ≥18 px, Canvas 240 px = CSS 240 px |
| 6 Tätigkeitsvorschläge | ✓ im Code · ✗ **in Produktion wirkungslos** | Szenario E belegt die Logik; siehe Befund 1 unten |
| 7 Button-Rückmeldung | ✓ | Szenario E: Schimmer auf „Unterschrift speichern"; Haken-Puls und Druckanimation im Code |
| 8 Duplikatschutz Katalog | ✓ unberührt | 77 Ähnlichkeitsprüfungen |

---

## ZUSATZ 2d — Jede geänderte Funktion gegen `502ef73`

Maschinell verglichen (Rumpf ohne Kommentare/Leerraum). **Nichts entfernt**
ausser `rapportNr`, das in `rapportNrAlt` umbenannt wurde und weiterhin als
Rückfallformat dient.

### `app.html` — 24 geändert, 29 neu

| Funktion | warum |
|---|---|
| `tcISOWeekMonday`, `trMondayOfWeek` | ISO-Korrektur auf die 4.-Januar-Regel; die alte Formel lag 2027 und 2028 eine ganze Woche daneben |
| `tcLoadWoche` | **Fix**: offene Speicherungen ausführen und Rad schliessen, bevor die Woche wechselt |
| `tcRenderWoche` | Rad statt ‹ ›-Pfeilen (Ziel 4); `data-daycard` für `tcDayFixup`; Rad wird nicht mehr beim Rendern aufgebaut |
| `tcRowHtml` | Löschknopf immer rendern, nicht erst nach dem ersten Speichern (Ziel 1) |
| `tcRowDel` | ungespeicherte Zeilen rein im Client entfernen + Rückgängig (Ziel 1) |
| `tcAddRow` | Rückgängig + Haptik (Ziel 1/7) |
| `tcRefreshRowChrome` | Nachrüsten des Löschknopfs entfällt, weil er jetzt immer da ist (Ziel 1) |
| `tcTaetAdd`, `tcTaetRemove` | Rückgängig, Wiedereinsetzen an der ursprünglichen Position (Ziel 1) |
| `tcSignClear` | Zeichnung vor dem Leeren sichern, Rückgängig (Ziel 1) |
| `tcSignInit` | Canvas 240 px (Ziel 5) + Schimmer ab dem ersten Strich (Ziel 7) |
| `tcTaetPickerToggle`, `tcTaetPickerContentHtml` | Projektbezug an den Picker, Vorschlagszeile (Ziel 6) |
| `tcEinreichenHtml` | Schimmer auf „Woche einreichen", sobald die Technik-Unterschrift steht (Ziel 7) |
| `tcRowStatus` | Haken-Puls genau beim Übergang nach „gespeichert" (Ziel 7) |
| `tcRowGewerkPick`, `tcSpesenChipPick`, `tcTimeChipPick`, `tcTaetChipPick` | je eine Zeile Haptik (Ziel 7) |
| `tcSaveSign`, `tcSubmitWoche` | Haptik bei Abschluss (Ziel 7) |
| `tcRenderWochenListe` | Rapportnummer in der Liste (Ziel 3) + Pille schliessen |
| `tcGo` | Pille schliessen beim Verlassen der Ansicht (Ziel 1) |

29 neue Funktionen: Rückgängig (6), Rad (13), Scroll-Sperre (2), Haptik (1),
ISO (1), Vorschläge (2), Hilfen (4).

### `api/cockpit.js` — 5 geändert, 6 neu

| Funktion | warum |
|---|---|
| `getOrCreateWochenrapport` | Rapportnummer pro Kunde ziehen, weich zurückfallend (Ziel 3) |
| `savePmKunde` | Kundenkürzel, **Master-only**, lesbare Fehlermeldungen (Ziel 3) |
| `exportRapporte` | Rapportnummer je KW im PDF, **nur Master** (Ziel 3) |
| `getTechWochenRapport` | `medien_anzahl` je Zeile, damit die Pille beim Löschen ehrlich sein kann (Ziel 1) |
| `getTaetigkeitenKatalogTech` | `projekt_id` in denselben Embed, ohne zusätzliche Abfrage (Ziel 6) |

### `gs-intern.html` — 6 geändert, 23 neu

`openWochenrapport` (Gefahrenzone, Ziel 2), `openKundeEdit` + `openKundenListe`
(Kürzel, Ziel 3), `ktNewForm` + `ktNewSave` (Duplikatschutz, Ziel 8).

### `api/tagesrapport.js` — 1 geändert

`mondayToFriday` — dieselbe ISO-Korrektur; betrifft die Wochenübersicht und die
Überfällig-Meldung.

**Hinweis zur Methode:** Die Funktionsabgrenzung ist grob (Rumpf bis zur
nächsten Funktion). Vier zunächst als „geändert" gemeldete Funktionen —
`tcLoadGallery`, `requireOwnedRow`, `pmTaetigkeitenKatalogToggle`,
`ktToggleAktiv` — habe ich einzeln nachgeprüft: **byteweise identisch**. Sie
sind in den Zahlen oben bereits abgezogen.

---

## ZUSATZ 2e — Console- und Netzwerkfehler

Jedes Szenario schreibt `window.onerror`, `unhandledrejection` und jeden
`fetch`-Versuch mit. Über alle fünf Läufe: **0 JS-Fehler, 0 Netzwerkversuche**.

**Dabei ein Mangel im Testaufbau selbst gefunden und behoben:** ein Szenario,
das unterwegs abstürzt, meldete vorher stillschweigend „bestanden" — es gab
einfach kein ✗ mehr aus. Der Läufer verlangt jetzt eine FERTIG-Marke; fehlt
sie, gilt der Lauf als fehlgeschlagen. Genau dieser Fall war einmal
aufgetreten (`touchEvt` ausserhalb des Sichtbereichs) und wäre sonst als
grüner Lauf durchgegangen.

---

## Befunde

### 1 — Ziel 6 ist in Produktion wirkungslos (älter als diese Runde)

Unverändert wie in `DIAGNOSE-tageskarten.md` beschrieben: doppelter
Fremdschlüssel → `PGRST201` → die Nutzungsstatistik kommt immer leer zurück,
also erscheinen nie Vorschlags-Chips; ausserdem erscheinen **erfasste
Tätigkeiten weder im Wochenblatt noch in der Master-Ansicht**. Existiert
bereits in `502ef73`. Braucht deine Entscheidung (siehe unten).

### 2 — Stundenrundung auf Halbstunden

07:00–17:00 minus 1.25 h Pause = 8.75 h, angezeigt werden **9.00 h**. Das
entspricht der Vorgabe „Std-Feld in Halbstundenschritten" aus der Übergabe vom
01.08. Meine Testerwartung war zunächst falsch, nicht der Code. Nur gemeldet —
falls die Rundung bei Abrechnungen stören sollte, ist das eine eigene
Entscheidung.

### 3 — `scroll-snap-stop:always` bremst weite Sprünge

Eine Wischgeste bewegt das Rad jetzt um genau eine Rastung — so verlangt
(„kein Weiterdrehen über die Rastung hinaus"). Von KW 5 auf KW 45 zu wischen
ist damit mühsam. Der schnelle Weg bleibt der direkte **Tap auf eine Zeile**
und „Zur aktuellen Woche". Falls dir das zu zäh ist, kann die Begrenzung
gelockert werden — dann kehrt aber etwas Trägheit zurück.

### 4 — Zeit-Chips markieren nie den passenden Wert

`start_zeit` kommt als `"07:00:00"` aus der DB, die Chips vergleichen gegen
`"07:00"`. Rein kosmetisch, das Zeitfeld selbst stimmt. Nicht angefasst
(ausserhalb des Auftrags).

### 5 — Zwei Zeilen ohne Wochenbezug

`gs_tagesrapporte` enthält zwei Zeilen mit `jahr/woche = null` aus
`seed_demo_accounts.mjs`. Harmlos, erklären aber abweichende Zeilenzahlen
zwischen DB und Wochenansicht. Nicht angefasst.

---

## Was ich nicht prüfen konnte

- **Echtes Gerät.** Chrome headless mit Touch-Events ist nah dran, ersetzt aber
  kein iPhone: Momentum-Scrolling, Safari-Rubberband und die Wirkung der
  Body-Sperre beim Drehen des Geräts bleiben offen.
- **Master-Cockpit und Partner-/Sub-Ansichten** habe ich in dieser Nacht nicht
  im Browser durchlaufen — sie wurden auch nicht angefasst. Abgedeckt ist nur
  die statische Prüfung (463 Aufruf- und Rollen-Prüfungen).
- **Ziel 6 im Echtbetrieb** lässt sich erst nach Befund 1 beurteilen.
