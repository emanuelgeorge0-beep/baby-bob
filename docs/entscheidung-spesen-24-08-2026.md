# Entscheidungsvorlage: Zurechnung der Tagespauschale

**Datum:** 24.08.2026 · **Stand:** Branch `feat/fotoverwaltung-tageszeile` @ `85134da`
**Status:** nichts gebaut, nichts geändert. Die Regel läuft unverändert weiter.

Anlass: Am 24.08.2026 wurde eine Zurechnungsregel eingebaut, die abrechnungs-
wirksam ist und nicht beschlossen wurde. Diese Vorlage stellt sie offen und legt
drei Wege daneben.

---

## 1. Warum es die Regel überhaupt gibt

Zwei Regeln stossen aufeinander:

- **Stunden** werden je Kalendertag **addiert**.
- **Spesen** fallen je Kalendertag **einmal** an, unabhängig von der Zahl der
  Baustellen.

Der Wochenbericht ist aber **Projekt × Kalenderwoche** und geht an *einen*
Bauleiter. Er sieht nur die Zeilen seines Projekts und kann von sich aus nicht
wissen, ob der Tag noch auf anderen Baustellen lief.

Ohne Zurechnung wies deshalb **jeder** Projektbericht desselben Tages die volle
Tagespauschale aus. Gemessen an KW 34: vier Berichte, vier × CHF 30 für den
17./18.08. — die Pauschale wäre vierfach verrechnet worden. Die Regel behebt
einen echten Fehler. Zur Debatte steht nicht *ob* zugerechnet wird, sondern
*wie*.

---

## 2. Wie die Regel heute genau rechnet

**Datei:** `lib/wochenbericht.js`, Funktion `sammleWochendaten`

| Zeile | Was dort steht |
|---|---|
| `261` | `const fuehrendesProjekt = {};   // datum -> projekt_id` |
| `263-266` | Zusatzabfrage **quer über alle Projekte** des Technikers im Wochenfenster |
| `268-273` | Stunden je (Kalendertag, Projekt) aufsummieren |
| `280-283` | je Kalendertag **ein** Projekt küren |
| `285` | `const traegtSpesen = (datum) => !fuehrendesProjekt[datum] \|\| fuehrendesProjekt[datum] === projektId;` |
| `303` | `spesen: traegtSpesen(datum) ? Math.max(0, ...out.map((x) => num(x.spesen)), 0) : 0` |

Der Kern, wörtlich (`lib/wochenbericht.js:280-283`):

```js
for (const [d, m] of Object.entries(proTag)) {
  fuehrendesProjekt[d] = Object.keys(m).sort((a, b) => (m[b] - m[a])
    || String(nummern[a] || '').localeCompare(String(nummern[b] || '')))[0];
}
```

In Worten:

> Die Tagespauschale geht **vollständig** an das Projekt mit den **meisten
> Stunden** an diesem Kalendertag. Bei Gleichstand an das mit der **kleinsten
> Projektnummer** (Zeichenkettenvergleich). Alle übrigen Projekte des Tages
> erhalten **CHF 0.00**.

Es ist ein **Alles-oder-nichts**. Es gibt keinen Teilbetrag.

> **Nebenwirkung, die zur Regel gehört:** Die Zusatzabfrage in `:263` liest die
> Zeilen **aller** Projekte des Technikers. Ein Bauleiter, der nur sein eigenes
> Projekt kennt, bekommt damit eine Zahl, deren Zustandekommen von Baustellen
> abhängt, die ihn nichts angehen. Sichtbar wird das nicht — im Bericht steht
> nur „CHF 0.00".

Dieselbe Regel wirkt **nicht** im Stundenblatt (Techniker × KW). Dort greift
`spesenJeTagAus()` (`lib/wochenbericht.js:55`) — Maximum je Kalendertag über
alle Projekte. Die Wochensumme stimmt dort immer.

---

## 3. Was die Projekte in KW 29 bis 34 dadurch tragen

Techniker Emanuel, Jahr 2026, live gerechnet am 24.08.2026.

### 3.1 Übersicht

| KW | Projekt | Stunden | **Spesen heute** | Anteil an den Wochenspesen |
|---|---|---:|---:|---:|
| 29 | P-2026-3470 | 24.00 | **CHF 90.00** | 100 % |
| 30 | P-2026-3470 | 40.00 | **CHF 150.00** | 100 % |
| 31 | P-2026-3470 | 40.00 | **CHF 150.00** | 100 % |
| 32 | *(Ferien, kein Projekt)* | 0.00 | **CHF 0.00** | — |
| 33 | *(Ferien, kein Projekt)* | 0.00 | **CHF 0.00** | — |
| 34 | 60060.00 Arzt Praxis | 2.00 | **CHF 0.00** | 0 % |
| 34 | 60829.00 Fertigmontage | 7.50 | **CHF 30.00** | 20 % |
| 34 | 60586.00 Taeger Architektur | 4.00 | **CHF 30.00** | 20 % |
| 34 | 60133.00 Stofer Manuel | 26.50 | **CHF 90.00** | 60 % |
| | **Summe KW 34** | **40.00** | **CHF 150.00** | 100 % |

**KW 29 bis 31 sind heute nicht betroffen** — dort liegt alles auf einem
einzigen Projekt, die Regel hat nichts zu entscheiden. Das ändert sich, sobald
die vier Wochen auf ihre echten Baustellen umgehängt werden.

### 3.2 KW 34 im Einzelnen — hier entscheidet die Regel wirklich

| Datum | Stunden je Projekt | Tagespauschale | geht an | leer aus gehen |
|---|---|---:|---|---|
| Mo 17.08. | 60060.00 **2.00 h** · 60829.00 **6.00 h** | CHF 30.00 | 60829.00 | **60060.00** |
| Di 18.08. | 60586.00 **4.00 h** · 60133.00 **2.50 h** · 60829.00 **1.50 h** | CHF 30.00 | 60586.00 | **60133.00, 60829.00** |
| Mi 19.08. | 60133.00 8.00 h | CHF 30.00 | 60133.00 | — |
| Do 20.08. | 60133.00 8.00 h | CHF 30.00 | 60133.00 | — |
| Fr 21.08. | 60133.00 8.00 h | CHF 30.00 | 60133.00 | — |
| Sa/So | 60133.00 0.00 h | CHF 0.00 | — | — |

Der Fall, den Sie benannt haben: **60060.00 trägt CHF 0.00, 60829.00 CHF 30.00.**
Der Grund ist allein, dass am 17.08. 6.00 h auf 60829.00 gebucht sind und
2.00 h auf 60060.00.

An zwei von fünf Arbeitstagen entscheidet die Regel über CHF 30. Drei Projekte
gehen an einem Tag leer aus, an dem sie tatsächlich Arbeit getragen haben.

---

## 4. Drei Optionen

### Option A — Zurechnung nach Stundenanteil

Die Tagespauschale wird im Verhältnis der Stunden des Tages aufgeteilt.

Berechnet für KW 34:

| Projekt | Stunden | heute | **Option A** | Differenz |
|---|---:|---:|---:|---:|
| 60060.00 | 2.00 | CHF 0.00 | **CHF 7.50** | +7.50 |
| 60829.00 | 7.50 | CHF 30.00 | **CHF 28.13** | −1.87 |
| 60586.00 | 4.00 | CHF 30.00 | **CHF 15.00** | −15.00 |
| 60133.00 | 26.50 | CHF 90.00 | **CHF 99.38** | +9.38 |
| **Summe** | **40.00** | **CHF 150.00** | **CHF 150.00** | **0.00** |

**Dafür:** Jedes Projekt trägt, was es verursacht hat. Kein Projekt geht leer
aus, obwohl Arbeit stattfand. Die Summe bleibt exakt CHF 150.00. Die Regel ist
in einem Satz erklärbar und braucht keine Bedienung.

**Dagegen:** Es entstehen Rappenbeträge (CHF 7.50, CHF 28.13). Eine
Tagespauschale ist fachlich unteilbar — sie deckt Anfahrt und Verpflegung des
*Menschen*, nicht der Baustelle; ein Bauleiter, der CHF 28.13 auf der Rechnung
sieht, wird fragen, wie diese Zahl zustande kommt. Rundungsdifferenzen sind
möglich (drei Projekte, CHF 30, Drittel), sie müssten auf das grösste Projekt
gelegt werden. Und: die Zahl bleibt von fremden Baustellen abhängig — die
Nebenwirkung aus Abschnitt 2 bleibt.

**Zu bauen:** `lib/wochenbericht.js` — `fuehrendesProjekt` wird zu
`spesenAnteil[datum][projekt_id]`; `traegtSpesen()` wird zu einem Faktor
zwischen 0 und 1; Zeile `303` multipliziert statt zu schalten. Rundung
zentral, damit die Summe zwingend aufgeht. Zusätzlich eine Zeile im PDF, die
den Anteil ausweist, sonst ist die Zahl nicht nachvollziehbar.
**Aufwand: rund 90 Minuten**, davon 30 für Rundung und Test.

---

### Option B — Zurechnung an ein vom Master gewähltes Projekt

Der Master bestimmt je Kalendertag, welche Baustelle die Pauschale trägt. Bis
er entscheidet, gilt die heutige Regel als Vorschlag.

**Dafür:** Die Zurechnung wird eine Entscheidung statt einer Sortierung. Sie ist
begründbar — wer weit fährt, trägt die Anfahrt, nicht wer viele Stunden bucht.
Der Betrag bleibt ganz, keine Rappenbeträge. Die Entscheidung ist
dokumentiert und im Nachhinein nachvollziehbar.

**Dagegen:** Das ist Arbeit, jeden Tag mit mehreren Baustellen. Bei
40 Mehrfachtagen im Jahr sind es 40 Entscheidungen. Ohne Pflege bleibt der
Vorschlag stehen und man hat den heutigen Zustand mit mehr Aufwand. Und es
braucht einen **Speicherort** — das ist die einzige der drei Optionen, die eine
Schemaänderung verlangt.

**Zu bauen:** Ein Feld für „dieses Projekt trägt die Tagespauschale". Zwei Wege:
eine neue Spalte `spesen_traeger` auf `gs_tagesrapporte` (nur auf einer Zeile
je Tag gesetzt), oder ein boolesches `spesen_traeger_flag`. Beides Schema.
Dazu Bedienung in der Wochenansicht des Masters (Auswahl je Tag),
`lib/wochenbericht.js` liest das Feld statt zu rechnen, und ein Rückfall auf die
heutige Regel, solange nichts gesetzt ist.
**Aufwand: rund 240 Minuten**, plus SQL-Migration, plus die Frage, was mit den
Bestandsdaten geschieht.

---

### Option C — keine Zurechnung an ein Kundenprojekt

Die Tagespauschale erscheint im **Wochenbericht überhaupt nicht** mehr. Sie
bleibt vollständig im Stundenblatt (Techniker × KW), wo sie ohnehin korrekt
steht, und wird von dort abgerechnet.

**Dafür:** Die ehrlichste Option. Eine Tagespauschale gehört zum *Techniker*,
nicht zur Baustelle — sie deckt seine Anfahrt und Verpflegung. Genau deshalb
lässt sie sich nicht sauber auf Baustellen verteilen. Es gibt keine
Zurechnungsregel mehr, also auch keine, die falsch sein kann. Die Nebenwirkung
aus Abschnitt 2 verschwindet: der Wochenbericht braucht die Zeilen fremder
Projekte nicht mehr zu lesen. **Am wenigsten zu bauen und am wenigsten, was
später bricht.**

**Dagegen:** Wenn Spesen heute über den Wochenbericht an den Bauleiter
weiterverrechnet werden, fällt dieser Weg weg — dann muss die Abrechnung über
das Stundenblatt laufen. **Das ist die einzige Frage, die ich nicht aus dem Code
beantworten kann und die Sie beantworten müssen: Wird die Tagespauschale dem
Kunden über den Wochenbericht verrechnet, oder ist der Wochenbericht ein
Leistungsnachweis und die Abrechnung läuft über das Stundenblatt?** Falls
Ersteres: Option C entfällt.

**Zu bauen:** `lib/wochenbericht.js` — Zeilen `257-285` entfallen ersatzlos
(die Zusatzabfrage über alle Projekte), Zeile `303` wird zu `spesen: 0`, die
Spesenspalte verschwindet aus dem Wochenbericht-PDF. Im Stundenblatt ändert
sich nichts.
**Aufwand: rund 45 Minuten**, davon 20 für das PDF-Layout.

---

## 5. Gegenüberstellung

| | A · Stundenanteil | B · Master wählt | C · gar nicht |
|---|---|---|---|
| Summe bleibt CHF 150.00 | ja | ja | ja (im Stundenblatt) |
| Betrag bleibt ganz | **nein** | ja | ja |
| tägliche Pflege nötig | nein | **ja** | nein |
| Schemaänderung | nein | **ja** | nein |
| hängt von fremden Baustellen ab | ja | nein | **nein** |
| Aufwand | 90 min | 240 min + SQL | 45 min |
| kann später falsch sein | ja | nur bei fehlender Pflege | **nein** |

**Meine Einschätzung**, ausdrücklich als solche: **Option C**, falls die
Tagespauschale nicht über den Wochenbericht verrechnet wird — sie beseitigt das
Problem, statt es besser zu verteilen. Sonst **Option A**, weil sie ohne
tägliche Pflege auskommt und kein Projekt leer ausgehen lässt. Option B halte
ich nur für richtig, wenn die Zurechnung tatsächlich vom Fall abhängt und nicht
von einer Formel — dann ist sie jeden Aufwand wert.

**Nichts davon ist gebaut. Die Regel läuft unverändert weiter, bis Sie
entscheiden.**

---

## 6. Was zusätzlich zu bedenken ist

1. **Die Regel wird häufiger greifen, nicht seltener.** Heute betrifft sie zwei
   von fünf Arbeitstagen einer einzigen Woche. Sobald KW 29–31 auf ihre echten
   Baustellen umgehängt sind — Moorefield, Jolles/Heglibachstrasse 119,
   Fabrikstrasse 5, Langstrasse 149 — entscheidet sie über drei weitere Wochen.
2. **Die Regel steht heute nur an einer Stelle.** Die verwandte Regel „Spesen
   je Kalendertag = Maximum" gibt es dagegen **dreimal**
   (`lib/wochenbericht.js:55`, `api/cockpit.js:3032`, `app.html:11236`, sechs
   Aufrufer). Wird an der Zurechnung etwas geändert, ist zu prüfen, ob eine
   dieser drei mitgeht.
3. **Der Gleichstandsfall ist heute rein technisch entschieden.** Bei gleichen
   Stunden gewinnt die kleinste Projektnummer als *Zeichenkette* — `'60060.00'`
   vor `'60133.00'`, aber auch `'P-2026-3470'` nach `'60829.00'`. Das ist keine
   fachliche Regel, das ist eine Sortierung, die stabil sein sollte.
