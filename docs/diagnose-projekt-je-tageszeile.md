# Teil B — Diagnose: Projekt je Tageszeile

Stand `main` @ 09e7cf0, Branch `feat/fotoverwaltung-tageszeile`, 24.08.2026.
Reine Diagnose. Nichts geändert, nichts migriert, nichts ausgeführt.

---

## Das Wichtigste zuerst: die Prämisse trägt nicht

> „gs_tagesrapporte hat UNIQUE(projekt_id, techniker_user_id, datum), und im
> Master ist die Baustelle nicht änderbar."

Beide Hälften stimmen so nicht. Der Constraint ist **kein** Hindernis, und die
Baustelle **ist** änderbar — nur an einer Stelle, die man nicht vermutet.

### Der Constraint greift über drei Spalten, nicht über zwei

`gs_tagesrapporte_projekt_id_techniker_user_id_datum_key`, unverändert seit
`scripts/rapport_system_migration.sql:64` (04.06.2026). Er sagt:

| Fall | Ergebnis |
|---|---|
| Montag · Emanuel · Projekt A **+** Montag · Emanuel · Projekt B | **erlaubt** |
| Montag · Emanuel · Projekt A **+** Montag · Emanuel · Projekt A | **23505 abgewiesen** |

Live gegengeprüft am 24.08.2026 mit Wegwerfzeilen im Jahr 2099, danach gelöscht:

```
1) Projekt 60133.00, 02.03.2099              -> 201
2) anderes Projekt, GLEICHER Tag             -> 201   <- mehrere Baustellen/Tag
3) Projekt 60133.00 nochmal, gleicher Tag    -> 409 duplicate key
4) Abwesenheit (projekt_id NULL)             -> 201
5) Abwesenheit ZWEITES Mal, gleicher Tag     -> 201   <- Lücke, siehe unten
```

Zeile 1–3 sind **wörtlich die Forderung aus C1**. Sie ist bereits erfüllt.

### Der Bestand beweist es ebenfalls

| KW | Zeilen | Kalendertage | Projekte | Mehrfachtage |
|---|---:|---:|---:|---:|
| 29 | 7 | 7 | 1 | 0 |
| 30 | 7 | 7 | 1 | 0 |
| 31 | 7 | 7 | 1 | 0 |
| 32 | 7 | 7 | 0 (Ferien) | 0 |
| 33 | 7 | 7 | 0 (Ferien) | 0 |
| **34** | **10** | **7** | **4** | **2** |

KW 34 trägt am 17.08. zwei und am 18.08. drei Zeilen auf verschiedenen
Projekten. Das läuft heute, in Produktion, mit dem bestehenden Constraint.

### Warum KW 30 trotzdem einprojektig ist

Nicht weil die Datenbank es verbietet, sondern weil dort **eine Zeile je
Kalendertag** angelegt wurde und die Baustelle nie umgehängt wurde. Die
richtige Baustelle steht — wie Sie sagen — nur im Tätigkeitstext:

```
KW30  20.07.  P-2026-3470  8.5h  "Moorefield: Badewanne gesetzt …"
      21.07.  P-2026-3470  10.0h "Jolles / Heglibachstrasse 119: …"
      22.07.  P-2026-3470   9.0h "Jolles / Heglibachstrasse 119: …"
      23.07.  P-2026-3470   8.5h "Jolles / Heglibachstrasse 119: …"
      24.07.  P-2026-3470   4.0h "Jolles / Heglibachstrasse 119: …"
KW31  27.07.  P-2026-3470   8.0h "Heglibachstrasse 119: …"
      28.07.  P-2026-3470   8.0h "Langstrasse 149: …"
      30.07.  P-2026-3470   8.0h "Fabrikstrasse 5: …"
```

Vier verschiedene Baustellen, ein einziges Projekt in der Spalte. Das ist ein
**Datenpflege-** und **Bedienbarkeitsproblem**, kein Schemaproblem.

### Die Baustelle ist änderbar — unter „Verschieben"

`gs-intern.html:2632` `wrRowMove()`, der Knopf **↦** neben jeder Tageszeile.
Er bietet „Neues Projekt" an und ruft `pm_wochenrapport_move`
(`api/cockpit.js:3420`). Der Knopf **✏️** (`wrRowEdit`, `:2494`) — der, den man
zum Ändern anklickt — bietet Gewerk, Start, Ende, Pause, Stunden, Spesen und
Tätigkeit an, aber **kein Projekt**. Wer die Baustelle ändern will, sucht sie
im Stift und findet sie nicht.

Drei echte Mängel bleiben also für C2:

1. Das Projekt fehlt in der naheliegenden Maske (✏️).
2. Die Auswahl unter ↦ listet **alle** Projekte, nicht die des Kunden.
3. `pmWochenrapportMove` fängt **23505 nicht ab** → beim echten Konflikt sieht
   der Master „Verbindungsfehler" statt der vorhandenen Klartextmeldung.

---

## Was am UNIQUE hängt — Stelle für Stelle

Geprüft wurde jede der von Ihnen genannten Stellen gegen die Frage: *setzt sie
voraus, dass es höchstens eine Zeile je Tag und Projekt gibt, und was passiert,
wenn diese Annahme fällt?*

### 🟢 Trägt bereits mehrere Zeilen je Tag — nichts zu tun

| Stelle | Muster | Warum es trägt |
|---|---|---|
| `api/tagesrapport.js:196-205` `week()` | `byDate[datum]` = Akkumulator | Stunden und Überzeit werden addiert, Status nur grün wenn **alle** Zeilen eingereicht. Am 22.08. repariert. |
| `api/tagesrapport.js:237-250` `statusOverview()` | `.filter()/.every()`, `jeTag`-Map | Ampel und „x/5 Tage" zählen Kalendertage, nicht Zeilen. |
| `api/tagesrapport.js:361` `hasOverdue()` | `new Set(datum)` | Vorbild der ganzen Umstellung. |
| `lib/wochenbericht.js:288` Wochenbericht | `Map<datum, Zeile[]>` | Tageskarte mit n Zeilen darunter. |
| `lib/wochenbericht.js:322` Fotozählung | je `tagesrapport_id` | Zwei Techniker am selben Tag beanspruchen nicht mehr die Fotos des anderen. |
| `lib/wochenbericht.js` Fotodokumentation | Gruppen je **(Tag, Projekt)** | Die sauberste Stelle im System. Sie war von Anfang an auf mehrere Projekte je Tag gebaut. |
| `app.html:10512` Sammelmaske (Wochenblatt) | `zByDate[d] = []`, dann `.push()` | Ausdrücklich „1..n Zeilen je Tag", inkl. „＋ weiterer Eintrag". |
| `api/wochenbericht.js:274` Sammelmaske (Wochenpaket) | gruppiert nach `projekt_id` / `wochenrapport_id` | Fasst Tage gar nicht an. |
| `api/cockpit.js` Spesenlogik | `spesenJeTag()` — Max je Kalendertag | Genau für mehrere Zeilen je Tag gebaut. Wird durch C richtiger, nicht falscher. |
| `api/cockpit.js:2888-2915` Duplikatserkennung (Fix 22.08.) | 23505 → Klartext | Fängt genau den Fall ab, den C1 weiterhin abweisen will. **Muss bleiben.** |

### 🔴 Bricht oder täuscht, sobald mehrere Projekte je Tag Alltag werden

| # | Stelle | Was passiert |
|---|---|---|
| **B1** | `api/cockpit.js:3446` `pmWochenrapportMove` | Kein 23505-Zweig. Verschieben auf ein belegtes (Projekt, Techniker, Tag) → ungefangener 500 → Client zeigt „Verbindungsfehler". **Genau der Knopf, den C2 braucht.** |
| **B2** | `api/cockpit.js:3330` `pmWochenrapportUpdate` | `datum` steht in `PM_TAG_UPDATE_FELDER`. Datum auf einen belegten Tag schieben → derselbe ungefangene 500. |
| **B3** | `api/tagesrapport.js:148` `save()` | `on_conflict=id` statt des fachlichen Schlüssels, **kein 23505-Zweig** → generisches „Rapport konnte nicht gespeichert werden". Der einzige Schreibpfad ohne Klartext. |
| **B4** | `api/tagesrapport.js:100` `today()` | `limit=1` **ohne `order`**. Ohne `projekt_id` ist undefiniert, welche Zeile die Maske vorfüllt. Heute latent (der einzige Aufrufer schickt `projekt_id` mit), morgen nicht mehr. |
| **B5** | `lib/wochenbericht.js:283` `fuehrendesProjekt[datum]` | Reduziert einen Tag zwingend auf **ein** Projekt, um die Tagespauschale nur einmal auszuweisen. Fachlich gewollt — aber die Regel („das Projekt mit den meisten Stunden, bei Gleichstand die kleinste Projektnummer") ist nie abgestimmt worden. Je mehr Mehrfachtage, desto häufiger entscheidet sie über Geld. |
| **B6** | `lib/wochenbericht.js:55`, `api/cockpit.js:3031`, `app.html:11242` | Die Spesenregel „Max je Kalendertag" existiert **dreimal** mit sechs Aufrufern. Ändert C etwas daran, muss es an drei Stellen gleich geändert werden. |
| **B7** | `lib/wochenbericht.js:1310` | Kopfkommentar des Stundenblatts behauptet „eine Zeile je Tag". Das PDF rendert längst eine Tabellenzeile je Datensatz. Nur Text — aber irreführend. |
| **B8** | Schema, `projekt_id IS NULL` | NULLs sind in UNIQUE zueinander distinct → für Service- und Abwesenheitszeilen greift der Constraint **gar nicht**. Live belegt (Probe 4/5 oben). Folge: die Klartextmeldung „Für diesen Serviceauftrag besteht an diesem Tag bereits ein Eintrag" (`api/cockpit.js:2905`) kann heute nicht ausgelöst werden. |
| **B9** | `api/tagesrapport.js:195`, `:231` | Filtert über `jahr`/`woche` statt über einen `datum`-Bereich. Altzeilen mit `woche IS NULL` fehlen. Unabhängig von C, aber in derselben Datei. |

### Fotodokumentation — die Zuordnung, die C erst möglich macht

Fotos hängen über `gs_projekt_medien.tagesrapport_id` an **einer Tageszeile**,
nicht am Kalendertag (`scripts/wochenrapport_migration.sql:67`,
`ON DELETE SET NULL`). Die Struktur, die Sie wollen — „Fotos je Baustelle" —
ist bereits da. Was fehlt, ist der Tag mit dem richtigen Projekt daran.

Heute trägt **keine einzige** der 43 Medienzeilen ein `tagesrapport_id`
(live gezählt). Alle laufen über das Auffangnetz. Sobald Tageszeilen ihr
eigenes Projekt tragen, wird die Zuordnung Foto → Baustelle überhaupt erst
sinnvoll — und das Foto fällt dann aus dem Auffangposten heraus.

---

## Der Migrationsentwurf

`scripts/tageszeile_projekt_ENTWURF.sql` — **nicht ausgeführt**.

Er enthält bewusst **keine** Änderung am bestehenden UNIQUE, weil keine nötig
ist. Aktiv sind ausschliesslich fünf `SELECT`. Die einzige echte DDL — zwei
partielle Unique-Indizes gegen die NULL-Lücke B8 — steht **auskommentiert**,
weil sie eine offene fachliche Frage berührt: *darf ein Techniker an einem Tag
zwei verschiedene Abwesenheiten tragen (halber Tag Unfall, halber Tag Ferien)?*
Drei Varianten stehen im Entwurf; ohne Ihre Antwort wird nichts eingeschaltet.

Pflicht-Prüfungen gelaufen:

```
grep -n "REFERENCES|DROP|ALTER COLUMN"  -> 2 Treffer, beide in Kommentarzeilen
aktive Anweisungen                      -> 5 x SELECT, sonst nichts
Namensprüfung (Eiserne Regel 7)         -> beide Indexnamen 0 Treffer im Repo
Bestand: 45 Tageszeilen, 0 Dubletten in allen drei Gruppen
```

---

## Was C damit wirklich ist

| Punkt | Ursprüngliche Annahme | Tatsächlich nötig |
|---|---|---|
| **C1** UNIQUE auflösen | Schemaänderung | **Keine.** Der Constraint tut bereits genau das. Zu tun: die 23505-Behandlung dort nachziehen, wo sie fehlt (B1, B2, B3), damit der Klartext auch beim Umhängen erscheint. |
| **C2** Projekt umhängen | neu bauen | **Vorhanden** (`wrRowMove`). Zu tun: ins ✏️ holen, auf die Projekte des Kunden einschränken, Konflikt sauber melden. |
| **C3** Fundstellen anpassen | breite Umstellung | **Schmal.** Die Verdichtung ist am 22.–24.08. bereits umgestellt worden. Offen sind B1–B9, davon B5/B6 als Entscheidung, nicht als Code. |

Der Aufwand liegt damit deutlich unter dem angenommenen — und ohne
Schemaänderung. Die Wochen 29–31 bleiben unangetastet; das Umhängen machen wir
wie besprochen morgen gemeinsam.

---

## STOPP

Teil B endet hier. Teil C und D erst nach Ihrer Freigabe.

Eine Rückfrage, weil sie den Zuschnitt von C ändert: da für C1 keine
Schemaänderung nötig ist, entfällt der Grund für den Halt an dieser Stelle.
Soll ich C so bauen, wie oben unter „tatsächlich nötig" beschrieben — also
23505-Klartext nachziehen und das Projekt in die ✏️-Maske holen, ohne die
Datenbank anzufassen?
