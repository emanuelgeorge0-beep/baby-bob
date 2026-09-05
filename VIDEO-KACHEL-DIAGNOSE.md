# Videos-Kachel — Diagnose (Runde feat/videos-kachel, Stand fe82018)

## 1. Wo die drei bestehenden Kacheln definiert sind

Die drei Kacheln Bilder / Pläne / Dateien existieren an **drei** Stellen. Alle drei
bauen sie mit einer lokalen Hilfsfunktion `katBlock(kat,label,icon)` und listen aus
derselben Quelle.

| Oberfläche | Datei:Zeile | Funktion | Upload-Knopf |
|---|---|---|---|
| Master-Cockpit, Projekt-Detail | `gs-intern.html:1856` | `pmDateiInnerHtml()` (ab `:1839`), Kasten `#pm-datei-box` `gs-intern.html:1635` | `openDateiUpload(kat)` `gs-intern.html:2010` |
| Partner-Cockpit, Projekt-Detail | `app.html:8407` | `pmPaintDetail()` → `katBlock` ab `:8393` | `pmFileUpload(kat)` `app.html:8819` |
| Partner-Cockpit, Sub-/Akkord | `app.html:9278` | `subDateiHtml()` ab `:9257` | `subFileUpload(kat)` `app.html:9281` |

## 2. Wie die Kacheln an ihre Daten kommen

Nicht über `gs_projekt_medien`, sondern über eine **Storage-Auflistung**:

- `pm_projekt` liefert `d.dateien` → `listProjektDateien(projektId)` — `api/cockpit.js:4315`
- Aufgelistet werden genau vier Präfixe: `projektId/` (Altbestand) und
  `projektId/bilder/`, `projektId/plaene/`, `projektId/dateien/`
  (`PM_KATEGORIEN`, `api/cockpit.js:4320`)
- `gs_projekt_medien` wird dort nur **nachgeschlagen**, um Anzeigename und
  Tageszuordnung zu überlagern (`api/cockpit.js:4330–4356`) — nicht, um Zeilen zu listen.

**Folge, und das ist der Kern:** Videos liegen unter `projektId/medien/…`
(`api/cockpit.js:4647` bzw. `:4779`). Dieses Präfix wird von `listProjektDateien`
**nicht** aufgelistet. Ein hochgeladenes Video kann in den drei bestehenden Kacheln
also gar nicht erscheinen — auch dann nicht, wenn man den `accept`-Wert erweiterte.
Die vierte Kachel braucht deshalb zwingend `medien_list`, nicht `d.dateien`.

## 3. Der accept-Wert am Datei-Dialog

Wortgleich an allen drei Stellen
(`gs-intern.html:2014`, `app.html:8821`, `app.html:9283`):

```js
inp.accept = (kategorie==='bilder') ? 'image/*'
           : (kategorie==='plaene') ? 'application/pdf,.dwg,.dxf,image/*'
           : '*/*';
```

Ein `capture`-Attribut wird an diesen drei Eingaben **nirgends** gesetzt.

## 4. Warum iOS derzeit nur Fotos anbietet

**Es liegt am `accept`-Attribut, nicht am `capture`-Attribut.**

- iOS baut das Auswahlblatt aus der `accept`-Liste. Bei `image/*` heisst der
  Kameraeintrag „Foto aufnehmen" (nicht „Foto oder Video aufnehmen") und die
  Mediathek zeigt nur Fotos — Videos sind ausgegraut bzw. gar nicht erst gelistet.
  Es steht kein einziger Video-MIME-Typ in der Liste, also bietet iOS auch keinen an.
- Die Kachel „Dateien" hat `*/*`. Das nimmt zwar Videos an, öffnet auf iOS aber die
  Dateien-App und bietet weder Mediathek noch Kamera. Auch darüber kommt ein frisch
  gedrehter Clip nicht ins Projekt.
- `capture` ist hier **nicht** die Ursache, weil es an diesen Eingaben fehlt. Es wäre
  aber die Ursache, wenn man es naiv ergänzte: `capture` erzwingt auf iOS direkt die
  Kamera und nimmt die Mediathek aus dem Blatt. Genau das passiert im
  Technik-Cockpit (`app.html:10093`, `inp.capture='environment'`) — dort ist es
  gewollt (Baustelle, Aufnahme vor Ort), für die neue Kachel wäre es falsch.

**Daraus folgt der Wert für die neue Kachel:** Video-MIME-Typen **plus** Endungen im
`accept`, und **kein** `capture`. Dann zeigt iOS „Fotomediathek", „Foto oder Video
aufnehmen" und „Datei auswählen".

## 5. Was serverseitig schon existiert (nichts davon wird angefasst)

| Zweck | Action | Stelle |
|---|---|---|
| Liste (Fotos + Videos, nach Stockwerk gruppiert, signierte URLs) | `medien_list` | `api/cockpit.js:358`, Handler `:4701` |
| Signierte Upload-URL (umgeht das ~4,5-MB-Body-Limit) | `medien_sign_upload` | `:359`, Handler `:4755` |
| Zeile eintragen + Standbild ablegen + Regeln nachmessen | `medien_register` | `:360`, Handler `:4796` |
| Löschen (Datei + Standbild + Zeile) | `medien_del` | `:361`, Handler `:4733` |
| Stockwerk-Katalog (Pflichtfeld bei Projekt-Medien) | `stockwerk_list` | Handler `:4890` |

Grenzen, serverseitig massgeblich: `VIDEO_MAX_BYTES = 100 MB`, `VIDEO_MAX_SEKUNDEN = 120`,
`VIDEO_MIME = mp4 / quicktime / x-m4v` — `api/cockpit.js:4586–4589`;
Prüftext in Klartext: `videoRegelFehler()` `:4592`. Standbild: `legeStandbildAb()` `:4613`
(der Frame kommt vom Client, der Server hat keinen Dekoder).

## 6. Ein Befund, der die Oberfläche einschränkt

`assertProjektAccess()` — `api/cockpit.js:4507`:

```js
if (scope.role === 'partner') { if (write) throw new Forbidden(); … }
```

Ein **Partner** ist bei Medien schreibgeschützt. Ein Upload-Knopf in der
Partner-Kachel (`app.html:8407`) liefe unweigerlich in 403. Ihn dort zu ermöglichen
wäre eine Serveränderung — die ist in dieser Runde ausgeschlossen.

Die vierte Kachel mit Upload gehört deshalb in das **Master-Cockpit**
(`gs-intern.html`, Projekt-Detail): dort ist `scope.role === 'master'`, dort stehen
die drei bestehenden Kacheln mit Upload-Knopf, und dort lädt Emanuel vom iPhone hoch.
