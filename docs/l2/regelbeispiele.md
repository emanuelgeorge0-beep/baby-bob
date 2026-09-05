# Die zwei Steigzonenregeln — abgelegt und durchgerechnet

Zeigt an zwei Beispielen, wie eine Kennzahlregel in der Datenbank liegt und wie
sie ausgewertet wird. Beide Regeln stehen als Seed in
`scripts/material_soll_l2.sql` (Abschnitte S.1 und S.2). Das Modell dahinter:
`modell.md`, Abschnitt „Ebene B".

Alle Zahlen unten stammen entweder aus der fachlichen Vorgabe oder sind
gewaehlte Beispielwerte einer fiktiven Zone. **Keine Kennzahl ist erfunden.** Wo
eine fehlt, steht sie als Luecke mit Kennung in `annahmen.md`.

---

## 0 Wie eine Regel abgelegt ist

Drei `jsonb`-Listen auf `gs_mat_regel`:

| Liste | Form | Bedeutung |
|---|---|---|
| `eingaben` | `{key, label, typ, pflicht, standard?}` | was die Zone liefern muss |
| `parameter` | `{key, label, standard, min?, max?, quelle}` | die Stellschrauben der Rechnung |
| `positionen` | `{key, artikel_slug, einheit, ausdruck, bedingung?, notiz?}` | was erzeugt wird |

`ausdruck` rechnet ueber die `key`s aus `eingaben` und `parameter`, mit den vier
Grundrechenarten, Klammern und `ceil`.

**`quelle` ist auf jedem Parameter Pflicht** und traegt `praxis`, `hersteller`
oder `offen`. Ein Parameter mit `standard: null` und `quelle: "offen"` bringt den
Lauf zum Stehen, statt mit einer erfundenen Zahl zu rechnen. Das ist kein
Fehler — das ist die Luecke, sichtbar gemacht.

`region` und `variante` stehen auf der Regelzeile selbst. `region NULL` heisst
„gilt ueberall"; ein gesetzter Wert bindet die Regel an einen Markt.

### Der Ablauf eines Laufs

1. Zone waehlen. `gs_mat_zone` liefert `medium`, `region`, `variante` und
   `eingaben`.
2. Passende Regel suchen: `medium` gleich, `region` gleich **oder** `NULL`,
   `variante` gleich **oder** `NULL`. Gibt es eine partnereigene Regel mit
   demselben `slug`, gewinnt sie gegen die globale.
3. Parameter aufloesen: Wert aus der Zone, sonst `standard`.
   **Ist ein Pflichtparameter danach `null`, bricht der Lauf ab** und meldet,
   welcher Wert fehlt und woher er kommen muesste.
4. Jeden `ausdruck` rechnen.
5. Eine Zeile `gs_mat_regel_lauf` schreiben: Eingaben, benutzte Parameter,
   Ergebnis-Snapshot, `regel_version`.
6. Je Ergebnis eine `gs_mat_position` anlegen mit
   `menge_vorschlag` = Ergebnis, `menge_erfasst` = `NULL`,
   `herkunft` = `'gerechnet'`, `regel_lauf_id` und `regel_slug_snapshot` gesetzt.

Der Techniker traegt spaeter `menge_erfasst` ein. `menge_gueltig` kippt
automatisch auf seinen Wert, `abweichung` faellt an. Der Vorschlag bleibt daneben
stehen. **Ein zweiter Lauf ueberschreibt eine erfasste Menge nie** — er legt
einen neuen Lauf an und schlaegt die Differenz vor.

---

## 1 Steigzone Trinkwasser (KW, WW, ZK)

`slug = steigzone_trinkwasser`, `medium = trinkwasser`, `region = NULL`
(gilt ueberall), `variante = NULL`.

### 1.1 Eingaben

| key | Label | Typ | Pflicht | Standard |
|---|---|---|---|---|
| `geschosse` | Geschosse | int | ja | — |
| `wohnungen_je_geschoss` | Wohnungen je Geschoss | int | ja | — |
| `geschosshoehe_m` | Geschosshoehe (m) | numeric | ja | **3.5** |
| `zk_letzte_entnahme_geschoss` | ZK: letzte Entnahmestelle (Geschoss) | int | ja | — |

Die letzte Entnahmestelle der Zirkulation ist **eine Eingabe, kein abgeleiteter
Wert.** Sie steht deshalb hier und nicht in einer Formel. Ob sie als Geschoss
oder als Meterwert erfasst wird, ist offen — **L-20**.

### 1.2 Parameter

| key | Label | Standard | min | max | quelle |
|---|---|---|---|---|---|
| `schellenabstand_m` | Schellenabstand (m) | **1.75** | 1.5 | 2.0 | `praxis` |

Der einzige Parameter, und er hat einen Standardwert. Die Regel laeuft also
durch.

### 1.3 Positionen

| key | Einheit | Ausdruck |
|---|---|---|
| `rohr_kw` | m | `geschosse * geschosshoehe_m` |
| `rohr_ww` | m | `geschosse * geschosshoehe_m` |
| `rohr_zk` | m | `zk_letzte_entnahme_geschoss * geschosshoehe_m` |
| `tstueck_kw` | Stk | `geschosse * wohnungen_je_geschoss` |
| `tstueck_ww` | Stk | `geschosse * wohnungen_je_geschoss` |
| `schellen_kw` | Stk | `ceil((geschosse * geschosshoehe_m) / schellenabstand_m)` |
| `schellen_ww` | Stk | `ceil((geschosse * geschosshoehe_m) / schellenabstand_m)` |
| `schellen_zk` | Stk | `ceil((zk_letzte_entnahme_geschoss * geschosshoehe_m) / schellenabstand_m)` |

**In ZK gibt es keine T-Stuecke.** Das ist keine Zeile mit Menge 0, sondern
gar keine Zeile — eine Position mit Menge 0 wuerde als „noch zu bestellen"
gelesen.

### 1.4 Durchgerechnet

Beispielzone: **6 Geschosse, 2 Wohnungen je Geschoss, 3.5 m Geschosshoehe,
Zirkulation bis Geschoss 5.**

```
Wohnungen gesamt   = 6 × 2       = 12
Stranglaenge KW/WW = 6 × 3.5     = 21.0 m
Stranglaenge ZK    = 5 × 3.5     = 17.5 m
```

| Position | Rechnung | `menge_vorschlag` | Einheit |
|---|---|---|---|
| Rohr KW | 6 × 3.5 | **21.0** | m |
| Rohr WW | 6 × 3.5 | **21.0** | m |
| Rohr ZK | 5 × 3.5 | **17.5** | m |
| T-Stueck KW | 6 × 2 | **12** | Stk |
| T-Stueck WW | 6 × 2 | **12** | Stk |
| T-Stueck ZK | — | *keine Position* | — |
| Schellen KW | `ceil(21.0 / 1.75)` = `ceil(12.0)` | **12** | Stk |
| Schellen WW | `ceil(21.0 / 1.75)` = `ceil(12.0)` | **12** | Stk |
| Schellen ZK | `ceil(17.5 / 1.75)` = `ceil(10.0)` | **10** | Stk |

Summe Rohr 59.5 m, T-Stuecke 24 Stk, Schellen 34 Stk.

### 1.5 Was diese Zahlen nicht enthalten

Vier Zuschlaege fehlen, und sie fehlen **absichtlich**, weil kein Wert vorliegt:

- **Verschnitt** — die 21.0 m sind die reine Stranglaenge (**L-06**)
- **Aufrundung auf Stangenlaengen** — 21.0 m sind hier eine glatte Zahl, aber
  Rohr kommt in Stangen (**L-07**)
- **Zugabe fuer Boegen und Etagenversatz** — die Formel misst senkrecht (**L-08**)
- **T-Stueck-Anschlusslaengen** — die Abzweigung zur Wohnung selbst ist nicht
  gerechnet (**L-09**)

Und eine Frage, die die Schellenzahl direkt aendert: **werden KW, WW und ZK
einzeln geschellt oder tragen gemeinsame Schellen alle drei Straenge?** Oben ist
je Strang gerechnet, ergibt 34. Bei gemeinsamer Schellung waeren es 12 fuer die
gemeinsame Strecke plus die Differenz — eine andere Zahl. **L-21.**

### 1.6 Wie eine Abweichung entsteht

Der Techniker baut die Zone und traegt 13 Schellen fuer KW ein statt der
vorgeschlagenen 12:

| Feld | Wert |
|---|---|
| `menge_vorschlag` | 12 |
| `menge_erfasst` | 13 |
| `menge_gueltig` | **13** (berechnet) |
| `abweichung` | **+1** (berechnet) |
| `herkunft` | `erfasst` |
| `regel_slug_snapshot` | `steigzone_trinkwasser` |
| `geaendert_von` / `geaendert_at` | der Techniker, sein Zeitpunkt |

Die 12 verschwinden nicht. Ueber `regel_lauf_id` steht daneben, dass mit
`schellenabstand_m = 1.75` gerechnet wurde. Zeigt sich nach genug Projekten ein
durchgaengiges `+1`, war der Parameter zu grosszuegig — nicht die Baustelle
besonders. Das ist genau die Frage, die ohne das Lauf-Protokoll nicht
beantwortbar waere.

---

## 2 Steigzone Abwasser, Variante B — Giessrahmen

`slug = steigzone_abwasser`, `medium = abwasser`, **`region = 'CH'`**,
**`variante = 'B'`**.

Region ist hier gesetzt, nicht `NULL`: die Giessrahmen-Praxis gilt fuer die
Schweiz. In Oesterreich wird anders gebaut — dort greift diese Regel nicht, und
das ist der Unterschied zwischen einem Parameter und einer Annahme.

### 2.1 Warum drei Regelzeilen und nicht eine mit Verzweigung

Die Variante bestimmt **welche Positionen entstehen**, nicht welche Zahlen:

- **A — getrennte Steigzonen:** eine Zone nur WC, separate Zonen fuer Waschtisch,
  Dusche, Rinne.
- **B — Giessrahmen:** eine Zone, alles im Rahmen ausser der Dusche.
- **C — alles im Giessrahmen inklusive Dusche:** moeglich, Ausnahme.

Eine Regel mit `bedingung`-Verzweigungen ueber drei Varianten waere in der
Datenbank kaum noch lesbar. Drei Zeilen mit demselben `slug` und
unterschiedlicher `variante` sind es. Der Teilindex laesst das zu: er ist auf
`(slug, coalesce(region,''), coalesce(variante,''))` gesetzt.

**Nur B ist geseedet.** A und C haben dieselbe Struktur, aber ihre Positionen
sind nicht in dem Detail beschrieben wie B — **L-17**.

### 2.2 Eingaben

| key | Label | Typ | Pflicht | Standard |
|---|---|---|---|---|
| `geschosse` | Geschosse | int | ja | — |
| `wohnungen_je_geschoss` | Wohnungen je Geschoss | int | ja | — |
| `geschosshoehe_m` | Geschosshoehe (m) | numeric | ja | 3.5 |

### 2.3 Parameter — zwei davon leer

| key | Standard | min | max | quelle |
|---|---|---|---|---|
| `schellenabstand_m` | **`null`** | 1.10 | 1.50 | `offen` |
| `ausdehnungsmuffe_m` | **`null`** | 5.0 | 6.0 | `offen` |
| `reduktion_dn` | **`null`** | Auswahl 56 \| 63 | | `offen` |

Alle drei Werte sind als **Spanne** bekannt, nicht als Wert:

- Schellenabstand 110 bis 150 cm; bei haengenden Leitungen richtet er sich nach
  dem Querschnitt — diese Zuordnung fehlt (**L-10**).
- Ausdehnungsmuffe alle 5 bis 6 m; ein Standardwert ist nicht genannt (**L-11**).
- Reduktion 110/56 **oder** 110/63; wann welche, ist offen (**L-12**).

**Diese Regel laeuft in dieser Form nicht durch.** Sie bricht in Schritt 3 ab
und meldet, welche drei Werte fehlen. Das ist gewollt: die Alternative waere,
1.30 m zu erfinden, weil es in der Mitte liegt — und dann in zwei Jahren nicht
mehr zu wissen, dass die Zahl geraten war. Unten wird deshalb mit **beiden
Enden der Spanne** gerechnet, damit sichtbar wird, worueber entschieden wird.

### 2.4 Positionen

Aus der Beschreibung des Giessrahmens, Position fuer Position:

| key | Einheit | Ausdruck | Herkunft der Zeile |
|---|---|---|---|
| `fallrohr_110` | m | `geschosse * geschosshoehe_m` | Laengenformel uebernommen — **L-13** |
| `abzweiger_110_110_88` | Stk | `geschosse * wohnungen_je_geschoss` | Abzweiger 110/110/88 Grad je Wohnung |
| `bogen_30` | Stk | `geschosse * wohnungen_je_geschoss` | WC ueber 30-Grad-Bogen angeschlossen |
| `abzweiger_zwischen` | Stk | `geschosse * wohnungen_je_geschoss` | „dazwischen ein weiterer Abzweiger" — Groesse offen, **L-14** |
| `reduktion_110` | Stk | `geschosse * wohnungen_je_geschoss` | Reduktion 110/56 oder 110/63 |
| `anschluss_waschtisch` | Stk | `geschosse * wohnungen_je_geschoss` | Waschtisch 63/56 |
| `schellen` | Stk | `ceil((geschosse * geschosshoehe_m) / schellenabstand_m)` | Parameter offen |
| `ausdehnungsmuffen` | Stk | `ceil((geschosse * geschosshoehe_m) / ausdehnungsmuffe_m)` | Parameter offen |

**Keine Dusche.** In Variante B ist sie nicht im Giessrahmen, weil das Gefaelle
nicht reicht; sie wird eingelegt und separat gefuehrt, oft zusammen mit der
Kueche. Die Regel erzeugt dafuer **keine Position** — die separate Fuehrung ist
eine eigene Zone und noch keine Regel (**L-15**).

**Kaskade-Probe.** „Von jeder Entnahmestelle zur naechsten ein Abzweiger."
Im Rahmen haengen zwei Entnahmestellen: WC und Waschtisch. Das ergibt zwei
Abzweiger je Wohnung — `abzweiger_110_110_88` und `abzweiger_zwischen`. Die
Positionsliste und das Kaskadenprinzip stimmen also ueberein. Das ist die
Gegenprobe, dass keine Zeile fehlt und keine doppelt ist.

**Anschlussgroessen** aus der Vorgabe, als Merkmal am Artikel (nicht als eigene
Position): WC 110/90 · Waschtisch, Dusche, Rinne 63/56 · Kueche 63/75, je nach
Situation. Was „je nach Situation" entscheidet, ist offen — **L-22.**

### 2.5 Durchgerechnet

Dieselbe Beispielzone: **6 Geschosse, 2 Wohnungen je Geschoss, 3.5 m.**

```
Wohnungen gesamt = 6 × 2   = 12
Fallstranglaenge = 6 × 3.5 = 21.0 m
```

| Position | Rechnung | `menge_vorschlag` | Einheit |
|---|---|---|---|
| Fallrohr 110 | 6 × 3.5 | **21.0** | m |
| Abzweiger 110/110/88° | 6 × 2 | **12** | Stk |
| Bogen 30° | 6 × 2 | **12** | Stk |
| Abzweiger (dazwischen) | 6 × 2 | **12** | Stk |
| Reduktion 110/56 oder 110/63 | 6 × 2 | **12** | Stk |
| Anschluss Waschtisch 63/56 | 6 × 2 | **12** | Stk |
| Dusche | — | *keine Position* | — |
| Schellen | `ceil(21.0 / ?)` | **14 bis 20** | Stk |
| Ausdehnungsmuffen | `ceil(21.0 / ?)` | **4 bis 5** | Stk |

Die beiden Spannen aufgeschluesselt:

```
Schellen        bei 1.50 m:  ceil(21.0 / 1.50) = ceil(14.00) = 14 Stk
                bei 1.10 m:  ceil(21.0 / 1.10) = ceil(19.09) = 20 Stk
                → 6 Stueck Unterschied, das sind 43 Prozent

Ausdehnungsmuffen bei 6 m:   ceil(21.0 / 6)    = ceil( 3.50) =  4 Stk
                  bei 5 m:   ceil(21.0 / 5)    = ceil( 4.20) =  5 Stk
```

**Das ist der Grund, warum die Regel nicht mit einem Mittelwert laeuft.** Sechs
Schellen Unterschied auf einer einzigen Zone sind bei zwoelf Zonen zweiundsiebzig
Stueck — das ist keine Rundungsfrage mehr, sondern eine Bestellung.

Ob `ceil` bei den Ausdehnungsmuffen ueberhaupt richtig ist, ist ebenfalls offen:
sitzt am oberen Ende des Strangs noch eine Muffe oder nicht (**L-23**)?

### 2.6 Was fehlt, bevor diese Regel laufen kann

| Kennung | Frage |
|---|---|
| **L-10** | Schellenabstand Abwasser — ein Standardwert, und die Zuordnung Querschnitt → Abstand bei haengenden Leitungen |
| **L-11** | Ausdehnungsmuffe — ein Standardwert zwischen 5 und 6 m |
| **L-12** | Reduktion 110/56 oder 110/63 — was entscheidet |
| **L-13** | Gilt `Geschosse × Geschosshoehe` auch fuer den Abwasser-Fallstrang? |
| **L-14** | Welche Groesse hat der Abzweiger zwischen WC-Anschluss und Reduktion? |
| **L-15** | Die separate Fuehrung von Dusche und Kueche — eigene Regel? |
| **L-23** | `ceil` oder `floor` bei den Ausdehnungsmuffen |

Vollstaendig und mit Begruendung in `annahmen.md`.

---

## 3 Was die beiden Beispiele zusammen zeigen

1. **Dieselbe Struktur traegt beide Faelle.** Trinkwasser laeuft durch, Abwasser
   bleibt an fehlenden Parametern stehen — ohne dass an der Tabelle etwas anders
   ist. Genau das war zu pruefen.
2. **Region und Variante sind Auswahlparameter, keine eingebauten Annahmen.**
   Die Trinkwasserregel traegt `region = NULL` und gilt ueberall; die
   Giessrahmen-Regel traegt `region = 'CH'` und gilt nur dort.
3. **Eine fehlende Zahl ist ein sichtbarer Zustand, kein stiller.** `standard:
   null` mit `quelle: "offen"` haelt den Lauf an und benennt, was fehlt.
4. **Der Vorschlag ist reproduzierbar.** Ueber `gs_mat_regel_lauf` steht zu jeder
   Position, mit welcher Regelversion, welchen Eingaben und welchen
   Parameterwerten sie entstanden ist. Erst das macht die Abweichung zu einer
   Aussage statt zu einer Zahl.
5. **Das spaetere Planlesen aendert nichts am Modell.** Es fuellt dieselbe
   `menge_vorschlag`-Spalte und setzt `herkunft = 'plan'`. Der Rest bleibt.
