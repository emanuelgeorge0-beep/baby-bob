# DIAGNOSE — Tageskarten im Techniker-Wochenblatt „leer"

**Gemeldet:** nach Deploy v23 (`1149a4e`, Rapport Feinschliff II)
**Bearbeitet:** Nachtauftrag, Branch `fix/tageskarten-leer`
**Status:** Ursache gefunden, reproduziert, gefixt. Nicht gemergt, nicht deployed.

---

## 1. Ursache

**Das neue Kalenderwochen-Rad (ZIEL 4) fängt die Wischbewegung ab, wechselt
dadurch ungewollt die Woche und lädt neu. Dabei geht die eben gewählte, noch
nicht gespeicherte Zeile verloren.**

Der Techniker sieht danach wieder eine leere Tageskarte — und zwar in einer
*anderen* Kalenderwoche als der, in der er gerade gearbeitet hat.

### Warum das genau so aussieht wie gemeldet

Eine frische Zeile rendert mit `.rc-body { display:none }`; erst
`tcRowZielChange` blendet die Felder ein. Nach dem ungewollten Neuladen steht
dort wieder eine frische Zeile — also **Projekt-Wähler und „Notiz & Fotos"
sichtbar, alles dazwischen unsichtbar**. Exakt die gemeldete Beschreibung.

### Die Kette

1. `tcRenderWoche` setzt das Rad als **offenen, 170 px hohen Scroll-Container
   über den Inhalt** (`.tc-wheel-col { overflow-y:auto }`), volle Breite.
2. Auf dem Handy ist die erste Bewegung nach der Projektauswahl ein Wisch nach
   unten zu den Feldern. Dieser Wisch landet auf dem Rad. Ein Scroll-Container
   verbraucht die Geste selbst — die Seite bewegt sich nicht, das Rad schon.
3. Jedes Scrollen löst `tcWheelScroll` aus, 140 ms später `tcWheelSettle`.
4. `tcWheelSettle` liest die Scrollposition, bekommt eine andere KW und ruft
   `tcLoadWoche(jahr, andereWoche)`.
5. `tcLoadWoche` rendert das ganze Wochenblatt neu. Die Zeile mit dem eben
   gewählten Projekt war noch **nicht gespeichert** — `tcScheduleSave` wartet
   700 ms — und existiert danach nicht mehr.

Der Datenverlust ist dabei das Schlimmere: nicht nur die Ansicht springt,
sondern eine begonnene Erfassung verschwindet ersatzlos.

### Reproduktion

`scripts/repro_wochenblatt.mjs` baut aus `app.html` eine eigenständige Seite
(echtes CSS, echtes JS, gestubbte API) und fährt sie in Chrome headless.

Vorher (`main`, v23):

| Schritt | `.rc-body` | KW | Ladevorgänge |
|---|---|---|---|
| nach dem Rendern | `none` | 33 | 1 |
| Projekt gewählt | **`block`** ✓ | 33 | 1 |
| 40 px über dem Rad gescrollt | **`none`** ✗ | **34** | **2** |

Der dritte Schritt ist der Fehler: ungewollter Wochenwechsel, Zeile weg.

---

## 2. Was NICHT die Ursache war

Die ursprüngliche Vermutung (`tcRowHtml` / `tcRefreshRowChrome`) ist widerlegt:

- `tcRowZielChange` und `tcApplyLockState` sind **byteweise identisch** zum
  Stand vor der Runde (`git diff 502ef73`).
- `tcRowHtml` unterscheidet sich nur um den jetzt bedingungslos gerenderten
  🗑-Knopf plus Kommentar — beides **nach** `.rc-body`.
- Ausgeführt erzeugt `tcRowHtml` alle Felder vollständig: Gewerk-Chips,
  Start/Ende/Pause, Std-Feld, Spesen-Chips. Tags sauber balanciert
  (55 `<div>` / 55 `</div>`).
- `tcRefreshRowChrome` läuft ohnehin erst **nach** dem ersten Speichern.
- Die ISO-Korrektur ist unschuldig: die gespeicherten `datum`-Werte aller
  Wochen (KW29/30/31) treffen mit alter *und* neuer Rechnung 7 von 7.

---

## 3. Der Fix

Das Rad bleibt als Bedienkonzept erhalten (ZIEL 4), verliert aber die
Eigenschaft, die den Schaden verursacht: **es ist kein offener Scroll-Container
mehr im Lesefluss der Seite.**

1. **Standardmässig zugeklappt.** Sichtbar ist eine kompakte Zeile
   „KW 33 · 2026 · 10.08.–16.08. ▾". Kein Scroll-Container, nichts zu fangen.
2. **Beim Antippen öffnet es sich als Overlay** über der Seite, mit
   abdunkelndem Hintergrund. Solange es offen ist, scrollt die Seite ohnehin
   nicht — die Geste kann nicht mehr fehlgedeutet werden.
3. **`overscroll-behavior:contain`** auf den Spalten: eine Scrollbewegung im
   Rad läuft nicht in die Seite über und umgekehrt.
4. **`tcWheelSettle` verlangt eine echte Geste.** Ein Flag wird nur bei
   `pointerdown` innerhalb des Rades gesetzt. Programmatisches Scrollen,
   Layout-Nachläufer und Snap-Korrekturen lösen keinen Wochenwechsel mehr aus.
5. **Kein Wochenwechsel über unfertige Arbeit.** Vor dem Laden wird ein
   ausstehender Autosave sofort ausgeführt (`tcFlushOffeneSpeicherungen`).
   Eine begonnene Zeile ist damit gespeichert, bevor die Ansicht wechselt.

6. **Scroll-Isolation (ZUSATZ 1).** Solange das Rad offen ist, bleibt jede
   Geste dort, wo sie hingehört:
   - `overscroll-behavior:contain` auf Rad und Spalten — die Bewegung läuft
     nicht in die Seite über und umgekehrt.
   - `touch-action:pan-y` ausschliesslich in den Rad-Spalten; Hintergrund und
     Blatt nehmen mit `touch-action:none` gar keine Wischgeste an.
   - Die Seite dahinter wird gesperrt (`tcSeiteSperren`: `body{position:fixed;
     top:-Y}`) und beim Schliessen **exakt an dieselbe Scrollposition**
     zurückgesetzt. `overflow:hidden` allein genügt auf iOS Safari nicht.
   - Trägheit: `scroll-snap-stop:always` begrenzt eine Wischgeste auf genau
     eine Rastung, und solange ein Finger aufliegt, wird überhaupt nicht
     eingerastet — die Woche kann nicht mitten in der Bewegung wegspringen.
   - Ein Tap auf den Hintergrund schliesst.
7. **Nebenbefund beim Prüfen:** die 80-ms-Aufbausperre verschluckte
   Wischgesten, die unmittelbar nach dem Öffnen begannen — das Rad wirkte
   kurz tot. Eine echte Berührung schlägt die Sperre jetzt durch.

Nachher (Branch `fix/tageskarten-leer`), gleiche Reproduktion:

| Schritt | `.rc-body` | KW | Ladevorgänge |
|---|---|---|---|
| nach dem Rendern | `none` | 33 | 1 |
| Projekt gewählt | **`block`** ✓ | 33 | 1 |
| 40 px über dem Rad-Bereich gescrollt | **`block`** ✓ | **33** | **1** |

---

## 4. Zweiter Befund — braucht deine Entscheidung, heute NICHT angefasst

Bei der Diagnose gegen die Live-DB gefunden, **älter als diese Runde**
(existiert unverändert schon in `502ef73`, also seit v22):

```
PGRST201  Could not embed because more than one relationship was found
   gs_tagesrapport_taetigkeiten_taetigkeit_id_fkey
   gs_tagesrapport_taetigkeitenkatalog_taetigkeit_id_fkey
```

`scripts/taetigkeiten_katalog.sql` hat die Tabelle umbenannt; der **alte
Fremdschlüssel ist mit umgezogen und der neue kam dazu**. Jetzt gibt es zwei
identische Beziehungen zwischen denselben Tabellen, und PostgREST weigert sich
zu raten. Betroffen sind zwei Abfragen, beide in `try/catch` — der Fehler ist
deshalb bisher nie aufgefallen:

- `loadTaetigkeitenFuerTagesrapporte` → **erfasste Tätigkeiten erscheinen weder
  im Wochenblatt noch in der Master-Ansicht.** Gespeichert sind sie korrekt.
- die Nutzungsstatistik in `getTaetigkeitenKatalogTech` → **die Vorschlags-Chips
  aus ZIEL 6 können nie erscheinen**, weil die Nutzung immer leer zurückkommt.
  Ziel 6 ist in Produktion damit wirkungslos, obwohl der Code stimmt.

**Zwei Wege, beide heute bewusst nicht gegangen:**

- *Ohne SQL:* Beziehung im Code eindeutig benennen, z. B.
  `taetigkeit:gs_taetigkeitenkatalog!gs_tagesrapport_taetigkeitenkatalog_taetigkeit_id_fkey(detailfelder)`.
  Reine Code-Änderung, sofort wirksam — aber sie liegt ausserhalb dieses Fixes
  und berührt auch den Master-Lesepfad.
- *Mit SQL:* den verwaisten alten Fremdschlüssel entfernen
  (`ALTER TABLE gs_tagesrapport_taetigkeitenkatalog DROP CONSTRAINT gs_tagesrapport_taetigkeiten_taetigkeit_id_fkey;`).
  Sauberer, aber SQL war heute Nacht untersagt.

Ich empfehle den SQL-Weg: der doppelte Schlüssel ist ein Migrationsrest ohne
Nutzen, und der Code bleibt lesbar. Vorher prüfen, dass wirklich beide
Constraints dieselben Spalten verbinden — das ist oben belegt.

---

## 5. Weitere Kleinigkeit, nur notiert

`gs_tagesrapporte.start_zeit` kommt als `"07:00:00"` (mit Sekunden) zurück.
Die Zeit-Schnellwahl vergleicht gegen `'07:00'` und markiert den passenden Chip
deshalb nie als gewählt. Rein kosmetisch, das Zeitfeld selbst stimmt.
Nicht angefasst.

---

## 6. Zwei Zeilen ohne Wochenbezug

In `gs_tagesrapporte` liegen zwei Zeilen mit `jahr = null, woche = null`
(2026-07-13 / -14, aus `scripts/seed_demo_accounts.mjs`). Sie hängen an keinem
Wochenrapport und tauchen im Wochenblatt nicht auf. Harmlos, aber sie erklären,
warum Zeilenzahlen in der DB und in der Wochenansicht auseinandergehen können.
Nicht angefasst.
