# Annahmen und Lueckenliste

Drei Teile:

1. **Annahmen** — Modellentscheidungen, die ich getroffen habe, weil sie
   getroffen werden mussten. Jede ist umkehrbar und benennt, was sie kosten
   wuerde.
2. **Lueckenliste** — jede offene fachliche Frage einzeln, mit Kennung L-nn.
   Diese Fragen muessen von Emanuel kommen, bevor gebaut wird.
3. **Praxis oder Herstellerangabe** — die saubere Trennung, damit spaeter
   nachvollziehbar bleibt, woher eine Zahl stammt.

Grundsatz dieser Runde: **keine erfundenen Werte, keine Normverweise ohne
Quelle.** Wo etwas fehlt, steht `null` und `quelle: "offen"`, und die Regel
laeuft bewusst nicht durch.

---

## 1 Annahmen — was ich entschieden habe

### A-01 · Zone wird ein eigenes Objekt

Heute ist Zone nur Text (`gs_gw_step.zone`, `scripts/gewerke_step_framework.sql:42`;
`gs_blockaden.zone`, `scripts/blockaden_migration.sql:26`). Ein Textfeld kann
keine Eingaben tragen, an denen gerechnet wird. Deshalb `gs_mat_zone` mit
`eingaben jsonb`.

*Kosten bei Umkehr:* gering, solange keine Daten drin sind. Die Eingaben
muessten dann an `gs_gw_step` oder `gs_projekte.datenblatt` haengen — beides
schlechter, weil ein Step keine Geschosszahl hat und das Datenblatt je Projekt
nur einmal existiert, eine Zone aber je Haus mehrfach.

### A-02 · Preis als eigene Tabelle, nicht als zwei Spalten

`gs_mat_preis` je Artikel, Lieferant und Land. Begruendung in `modell.md`,
Abschnitt Ebene A: derselbe Artikel kommt in mehreren Laendern mit anderer
Waehrung vor, und der Katalog soll nicht je Markt dupliziert werden.

*Kosten bei Umkehr:* mittel. Zwei Preisspalten am Artikel waeren einfacher zu
lesen, wuerden aber CH und DE zu zwei Katalogen machen und damit auch die
Fachregeln verdoppeln.

### A-03 · Verbindungsart steht auf der Position, nicht am Artikel

Woertlich aus der Vorgabe: „Verbindungsart als Attribut der Position:
Schweissmuffe oder Pressverbindung". So umgesetzt.

*Folgefrage:* ob der Artikel zusaetzlich eine eigene Verbindungsart traegt (um
den Katalog danach filtern zu koennen), ist offen — **L-19**.

### A-04 · Drei Snapshot-Felder statt einem

Das Vorbild `gs_tagesrapport_taetigkeitenkatalog` friert nur die Bezeichnung ein
(`scripts/taetigkeiten_katalog.sql:161`). Eine Materialposition wird bestellt und
bezahlt, also sind zusaetzlich `artikel_snapshot` (Masse, Kontur, Werkstoff,
Zulassungen) und `preis_snapshot` eingefroren.

*Kosten bei Umkehr:* keine — man kann die Felder ungenutzt lassen. Ohne sie ist
eine alte Rechnung aber nicht mehr rekonstruierbar.

### A-05 · Zustandskette wird um Mengen ergaenzt, nicht ersetzt

`geplant → bestellt → geliefert → verbaut` bleibt als Statusspalte, daneben
stehen `menge_bestellt`, `menge_geliefert`, `menge_verbaut`. Begruendung mit den
drei Befunden in `modell.md`, Abschnitt 3.

*Kosten bei Umkehr:* keine. Die drei Mengenfelder koennen leer bleiben, dann
verhaelt sich die Tabelle genau wie `gs_material` heute.

### A-06 · `menge_gueltig` und `abweichung` sind berechnete Spalten

`generated always as … stored`, Muster `gs_material.gesamt`
(`scripts/master_cockpit_migration.sql:44`). Damit kann keine Anzeige und keine
Auswertung die Vorrangregel („was der Techniker eintraegt, gewinnt") neu
erfinden.

*Kosten bei Umkehr:* eine Migration, weil berechnete Spalten nicht nachtraeglich
in normale umgewandelt werden.

### A-07 · Kein `check` auf Werkstoff und Presskontur

Genannt sind C-Stahl, Edelstahl, M und V. Ob das vollstaendig ist, weiss
niemand. Ein `check` mit genau diesen Werten wuerde beim Katalogimport (L3)
fachlich richtige Zeilen verwerfen. Siehe **L-01** und **L-02**.

### A-08 · `region` und `variante` sind Auswahlparameter auf der Regel

`region NULL` = gilt ueberall. Die Trinkwasserregel traegt `NULL`, weil zu ihr
kein Regionsunterschied genannt wurde; die Giessrahmen-Regel traegt `'CH'`, weil
die Praxis ausdruecklich auf die Schweiz bezogen ist.

*Achtung, das ist eine Annahme:* dass die **Trinkwasserregel** in Oesterreich
genauso gilt, hat niemand gesagt. Sie steht auf `NULL`, weil kein Unterschied
genannt wurde — nicht, weil bestaetigt waere, dass keiner besteht. Siehe
**L-24**.

### A-09 · Drei Regelzeilen fuer die drei Abwasser-Varianten

Statt einer Regel mit Verzweigungen: A, B und C erzeugen andere Positionen,
nicht andere Zahlen. Nur B ist geseedet — **L-17**.

### A-10 · Der Verweis laeuft Position → Step

`gs_mat_position.step_id`. `gs_gw_step.material_ref`
(`scripts/gewerke_step_framework.sql:49`) ist eine einzelne uuid und kann die
acht bis zehn Positionen einer Zone nicht halten. Das bestehende Feld bleibt
unberuehrt.

### A-11 · Keine Techniker-RLS-Policy auf den neuen Tabellen

`gs_projekt_techniker` fuehrt zwei Zuweisungsspalten nebeneinander
(`scripts/rapport_system_migration.sql:38` gegen
`scripts/master_cockpit_session6_pm.sql:21`). Eine Policy muesste sich fuer eine
entscheiden und damit eine ungeklaerte Frage per Migration beantworten. Siehe
**L-16**.

### A-12 · Ausdruckssprache: vier Grundrechenarten, Klammern, `ceil`

Mehr braucht keine der beiden Regeln. Das ist eine Bauentscheidung fuer L4, keine
fachliche — sie steht hier, damit sie nicht unbemerkt zur Festlegung wird.

---

## 2 Lueckenliste — was von Emanuel kommen muss

### 2.1 Katalog und Artikel (Ebene A)

**L-01 · Werkstoffliste** — Genannt sind C-Stahl und Edelstahl. Welche
Werkstoffe fuehrt der Katalog sonst noch, und braucht jeder von ihnen eine
eigene Medium-Regel? *Blockiert:* den `check`-Constraint auf `werkstoff` und die
Vollstaendigkeit von Ebene C.

**L-02 · Presskonturen** — Genannt sind M und V, und dass sie nicht kompatibel
sind. Gibt es weitere Konturen im Bestand? Sind M und V untereinander die einzige
Unvertraeglichkeit? *Blockiert:* den `check` auf `presskontur` und die Regel
`presskontur_nicht_mischen`.

**L-03 · Was ist der VPE-Preis genau** — Ist `preis_vpe` der Preis **je
Einheit** bei VPE-Abnahme oder der Preis **der ganzen VPE**? Beides ist ueblich,
und der Unterschied ist der Faktor `vpe_menge`. *Blockiert:* jede Preisrechnung.
Aktuell im Modell als „Preis je Einheit bei VPE-Abnahme" kommentiert — das ist
eine Vermutung, keine Festlegung.

**L-04 · VPE-Einheiten** — Karton, Bund, Rolle, Palette? Welche Begriffe fuehrt
der Grosshaendler? *Blockiert:* nichts Hartes, aber ohne Liste bleibt das Feld
Freitext und ist spaeter nicht auswertbar.

**L-05 · Zulassungszeichen** — Genannt sind DVGW und SVGW. Braucht es weitere
Zeichen fuer die anderen gefuehrten Maerkte (AT, ES, GB — `lib/regions.js:5-9`)?
*Blockiert:* die Regel `trinkwasser_zulassung_noetig`, die heute nur CH und DE
kennt.

**L-06 · Verschnittzuschlag** — Ausdruecklich als offen benannt. Ein Prozentsatz?
Je Material verschieden? Je Zone oder je Position? *Blockiert:* jede
Rohrlaengenrechnung. Die 21.0 m im Beispiel sind reine Stranglaenge.

**L-07 · Aufrundung auf Stangenlaengen** — Ausdruecklich als offen benannt.
Welche Stangenlaengen fuehrt der Handel je Material? Wird je Position
aufgerundet oder ueber die Zone summiert und dann aufgerundet? Der Unterschied
ist erheblich. *Blockiert:* die Bestellmenge, nicht die Sollmenge — beide
muessen aber unterscheidbar bleiben.

**L-08 · Zugabe fuer Boegen und Etagenversatz** — Die Formel
`Geschosse × Geschosshoehe` misst senkrecht. Ein Strang laeuft nicht senkrecht
durch. Gibt es eine Zugabe, und ist sie ein Prozentsatz oder ein Wert je
Geschoss?

**L-09 · Anschlusslaengen ab T-Stueck** — Die T-Stuecke sind gezaehlt, die
Leitung von dort zur Wohnung nicht. Gehoert sie in diese Zone oder in eine
eigene?

### 2.2 Steigzone Abwasser

**L-10 · Schellenabstand Abwasser** — Bekannt ist die Spanne 110 bis 150 cm.
Zwei Fragen: (a) welcher Standardwert innerhalb der Spanne? (b) Bei haengenden
Leitungen richtet sich der Abstand nach dem Querschnitt — **welcher Querschnitt
bekommt welchen Abstand?** Diese Zuordnung fehlt vollstaendig. *Blockiert:* die
Regel `steigzone_abwasser` laeuft nicht. Rechnerische Auswirkung im Beispiel:
14 gegen 20 Schellen auf einer Zone.

**L-11 · Abstand Ausdehnungsmuffen** — Bekannt: alle 5 bis 6 m. Ein
Standardwert fehlt. *Blockiert:* dieselbe Regel. Auswirkung im Beispiel:
4 gegen 5 Muffen.

**L-12 · Reduktion 110/56 oder 110/63** — Beide genannt, die Auswahl nicht.
Haengt sie am Waschtischtyp, am Rohrsystem, am Lieferanten? *Blockiert:* die
Positionszeile `reduktion_110` bekommt keinen Artikel.

**L-13 · Laengenformel fuer den Abwasser-Fallstrang** — `Geschosse ×
Geschosshoehe` ist fuer die **Trinkwasser**-Straenge genannt. Fuer den
Abwasser-Fallstrang wurde sie in der Rechnung uebernommen, weil Schellenabstand
und Ausdehnungsmuffe sich sonst auf nichts beziehen koennten. **Das ist eine
Uebertragung, keine Angabe.** Zu bestaetigen oder zu korrigieren.

**L-14 · Der Abzweiger dazwischen** — „dazwischen ein weiterer Abzweiger":
welche Groesse und welcher Winkel? Fuer den ersten ist 110/110/88 Grad genannt,
fuer diesen nichts. *Blockiert:* die Artikelzuordnung dieser Position.

**L-15 · Dusche und Kueche separat** — In Variante B ist die Dusche nicht im
Giessrahmen; sie wird eingelegt und separat gefuehrt, oft zusammen mit der
Kueche. Ist diese separate Fuehrung eine eigene Zone mit eigener Regel? Wenn ja:
welche Positionen erzeugt sie? *Heute erzeugt die Regel dafuer gar nichts* —
die Dusche faellt aus der Materialliste, wenn niemand sie anderswo erfasst.
Das ist die betrieblich gefaehrlichste Luecke der Liste.

**L-17 · Varianten A und C** — A (getrennte Steigzonen: eine nur WC, separate
fuer Waschtisch, Dusche, Rinne) und C (alles im Giessrahmen inklusive Dusche)
sind benannt, aber nicht positionsweise beschrieben. Welche Positionen entstehen
je Variante, und in welcher Zahl?

**L-22 · Anschlussgroessen „je nach Situation"** — WC 110/90, Waschtisch,
Dusche, Rinne 63/56, Kueche 63/75, „je nach Situation". **Was ist die
Situation?** Solange das offen ist, kann die Regel keine Groesse festlegen und
muss sie erfragen.

**L-23 · Aufrundung bei Ausdehnungsmuffen** — `ceil(21.0 / 5) = 5`. Sitzt am
oberen Ende des Strangs noch eine Muffe, oder ist die letzte Teilstrecke ohne?
Bei `floor` waeren es 4.

### 2.3 Steigzone Trinkwasser

**L-20 · Letzte Entnahmestelle der Zirkulation** — Sie ist eine Eingabe, das
ist klar. Aber in welcher Form: als Geschossnummer oder als Meterwert? Sitzt die
letzte Entnahmestelle in der Mitte eines Geschosses, ist die Geschossnummer zu
grob. Im Modell aktuell als Geschossnummer
(`zk_letzte_entnahme_geschoss`).

**L-21 · Schellen je Strang oder gemeinsam** — Im Beispiel ist je Strang
gerechnet: KW 12 + WW 12 + ZK 10 = 34. Tragen gemeinsame Schellen alle drei
Straenge, ist die Zahl eine andere. Der Schellenabstand 1.75 m ist genannt, die
Schellenart nicht.

### 2.4 Fachregeln (Ebene C)

**L-18 · Zulassung — Sperre oder Warnung?** Der Zulassungsstatus ist als
**Filter** fuer Trinkwasser benannt. Verhindert eine fehlende Zulassung das
Speichern (Sperre) oder wird nur gewarnt? *Aktuell:* die Regel
`trinkwasser_zulassung_noetig` ist mit `aktiv = false` angelegt und greift
nicht. Bis zur Entscheidung bleibt die Zulassung reiner Katalogfilter.

**L-19 · Verbindungsart — welche Regel?** Sie ist als Attribut der Position
benannt, aber es ist keine Unvertraeglichkeit genannt. Gibt es eine — etwa eine
Kombination aus Werkstoff und Verbindungsart, die nicht zulaessig ist? *Aktuell
existiert keine Regel vom Typ `verbindungsart`.*

**L-24 · Gilt die Trinkwasserregel auch ausserhalb der Schweiz?** Sie steht auf
`region = NULL`, also „gilt ueberall". Das ist der Zustand mangels
gegenteiliger Angabe, keine Bestaetigung. Fuer das Abwasser ist der
Regionsunterschied ausdruecklich genannt — beim Trinkwasser wurde er weder
bejaht noch verneint.

**L-25 · Kaelte als eigenes Medium** — Edelstahl ist „ueblich bei Kaelte,
Spitaelern und ueberall wo Langlebigkeit vor Materialkosten geht". Ist Kaelte
ein eigenes Zonen-Medium mit eigenen Kennzahlregeln, oder nur ein
Anwendungsfall? *Aktuell:* `gs_mat_position.medium` kennt `kaelte`,
`gs_mat_zone.medium` nicht — eine bewusste Asymmetrie, bis die Frage geklaert
ist.

**L-26 · Kupfer, Kunststoff, Mehrschichtverbund** — Nicht genannt, aber im
Trinkwasser- und Abwasserbau ueblich. Werden sie gefuehrt? Wenn ja, brauchen sie
Medium-Regeln wie C-Stahl? Ohne Antwort ist Ebene C unvollstaendig, ohne dass es
auffaellt: eine fehlende Regel sperrt nichts.

### 2.5 Technisch, aber ohne Emanuel nicht entscheidbar

**L-16 · Techniker-Kette** — `gs_projekt_techniker` fuehrt `techniker_user_id`
(auth.users, `scripts/rapport_system_migration.sql:38`) und `techniker_id`
(gs_techniker, `scripts/master_cockpit_session6_pm.sql:21`) nebeneinander. Die
Gewerke-Policies waehlen die erste (`scripts/gewerke_step_framework.sql:80-95`),
das PM die zweite. Welche gilt fuer Material? *Blockiert:* die
Techniker-RLS-Policy auf den zehn neuen Tabellen.

**L-27 · Zollmass-Format** — `zoll` ist Text, weil Bruchschreibweise. Wie
schreibt der Katalog es: `1/2`, `½`, `0.5`? Ohne festes Format ist das Feld nicht
filterbar. *Blockiert:* nichts vor dem Import, alles danach.

**L-28 · Darf ein Partner globale Kennzahlregeln ueberschreiben?** Im Modell ja:
er legt eine eigene Regel mit demselben `slug` an, und die eigene gewinnt. Ob
das gewollt ist — ein Partner rechnet Steigzonen anders als das Haus — oder ob
die Hauskennzahl verbindlich bleiben soll, ist eine Geschaeftsentscheidung.
Dasselbe gilt fuer **Fachregeln**, und dort waere ein Ueberschreiben heikler:
ein Partner koennte die C-Stahl-Sperre bei sich abschalten.

**L-29 · DATANORM-Umfang** — Die Anfrage an den Grosshaendler ist offen. Welche
Felder liefert die Datei tatsaechlich, und decken sie Werkstoff, DN, Zoll,
Presskontur und Zulassung ab, oder muessen diese aus der Bezeichnung gelesen
werden? *Blockiert:* L3 vollstaendig. Das Modell steht bewusst vorher — aber der
Zuschnitt des Importers haengt daran.

---

## 3 Praxis oder Herstellerangabe — die Trennung

Damit spaeter nachvollziehbar bleibt, woher eine Zahl stammt, traegt **jeder
Parameter und jede Fachregel ein Pflichtfeld `quelle`** mit drei Werten:

| Wert | Bedeutung | Referenz noetig |
|---|---|---|
| `praxis` | Emanuels Erfahrungswert. Gilt, bis die Auswertung der Abweichungen etwas anderes zeigt. | nein — als Praxiswissen gekennzeichnet, das ist die Nachvollziehbarkeit |
| `hersteller` | Steht so im Datenblatt eines Herstellers. | **ja** — `quelle_ref` ist per `check` erzwungen |
| `offen` | Niemand hat es festgelegt. | — |

Ein vierter Wert `norm` ist **bewusst nicht vorgesehen.** Es liegt keine Quelle
vor, und eine geratene Normnummer waere schlimmer als keine. Kommt eine echte
Quelle, wird der Wert ergaenzt — dann mit Pflichtreferenz wie bei `hersteller`.

### 3.1 Heute als `praxis` abgelegt

| Was | Wert | Wo |
|---|---|---|
| Geschosshoehe | 3.5 m als Vorbelegung | Eingabe beider Regeln |
| Schellenabstand Trinkwasser | 1.75 m, Spanne 1.5–2.0 | Parameter `schellenabstand_m` |
| T-Stueck je Wohnung in KW und WW, keines in ZK | — | Positionsliste Trinkwasser |
| ZK nur bis zur letzten Entnahmestelle | — | Eingabe, kein abgeleiteter Wert |
| C-Stahl nicht fuer Trinkwasser, im Heizkreis unkritisch | — | Fachregel `cstahl_nicht_trinkwasser` |
| Presskontur M und V nicht kompatibel | — | Fachregel `presskontur_nicht_mischen` |
| Giessrahmen ist in der Schweiz der Normalfall | — | `region = 'CH'` auf der Abwasserregel |
| Dusche nicht im Giessrahmen, weil das Gefaelle nicht reicht | — | keine Position in Variante B |
| Kaskade: von jeder Entnahmestelle zur naechsten ein Abzweiger | — | Positionsliste Abwasser B |

### 3.2 Was Herstellerangabe **waere** und heute fehlt

Diese vier stehen bewusst nicht in der Datenbank, weil sie aus einem Datenblatt
kommen muessen und nicht aus der Erinnerung:

- **Bogenwinkel je Hersteller.** Der 30-Grad-Bogen am WC-Anschluss ist als
  Praxis genannt. Welche Winkel ein Hersteller tatsaechlich liefert und welcher
  fuer welchen Anschluss vorgesehen ist, ist Herstellerangabe.
- **Schellenabstand nach Querschnitt bei haengenden Leitungen** (L-10b). Die
  Zuordnung Querschnitt → Abstand steht in Herstellerunterlagen, nicht in der
  Praxis-Spanne 110–150 cm.
- **Stangenlaengen je Material** (L-07). Was der Handel fuehrt, ist eine
  Lieferantenangabe.
- **Zulassungsnummern zu DVGW und SVGW** (L-05). Registriernummer und
  Gueltigkeit gehoeren in `gs_mat_zulassung.nachweis` und
  `.gueltig_bis` — aus dem Zertifikat, nicht geschaetzt.

Wenn eine dieser Zahlen kommt, wird sie mit `quelle = 'hersteller'` und
ausgefuellter `quelle_ref` abgelegt. Der `check`-Constraint
`gs_mat_fachregel_quelle_belegt` laesst es gar nicht anders zu.

---

## 4 Abweichungen von der Auftragsbeschreibung

Drei Stellen, an denen der Auftrag auf etwas verweist, das im Repo nicht so
existiert. Der Vollstaendigkeit halber, damit nichts stillschweigend anders
umgesetzt ist als beschrieben:

1. **`gs_berichte` und `gs_bericht_abschnitte` gibt es nicht.** `grep` ueber
   `*.sql`, `*.js`, `*.html`, `*.md`: null Treffer. Gemeint ist fuer das
   `partner_id`-Muster mit hoher Wahrscheinlichkeit **`gs_branding`** — dort
   steht es woertlich (`scripts/branding_tabelle.sql:19-27, 41-45`) — und fuer
   das Snapshot-Muster **`gs_tagesrapport_taetigkeitenkatalog`**
   (`scripts/taetigkeiten_katalog.sql:154-156`). Beide Muster sind uebernommen.
   Was tatsaechlich existiert, heisst `gs_wochenberichte`.
2. **`api/cockpit.js:5124` traegt kein `scope.isMaster`.** Die Zeile steht in
   `svc_update` (Service-Auftrag). `scope.isMaster` kommt an `:5695`, `:5959`
   und `:6298` vor. Angefasst wurde ohnehin keine Zeile Code.
3. **„Bauabschnitt" ist im Repo bereits belegt** — durch `gs_bauabschnitte`
   (`scripts/zahlungssystem_migration.sql:8-24`), die Zahlungsseite. Der
   bauliche Bauabschnitt existiert nicht. Das neue Modell benutzt das Wort
   deshalb nicht und verweist nur optional auf die Zahlungstabelle
   (`gs_mat_zone.bauabschnitt_id`).

---

## 5 Die Lueckenliste als Frageliste

Kurzform zum Abarbeiten. Jede Zeile ist eine Frage, die nur Emanuel beantworten
kann.

| # | Frage | Blockiert |
|---|---|---|
| L-01 | Welche Werkstoffe fuehrt der Katalog ausser C-Stahl und Edelstahl? | Ebene C Vollstaendigkeit |
| L-02 | Gibt es weitere Presskonturen als M und V? | Kontur-Regel |
| L-03 | Ist `preis_vpe` je Einheit oder je ganzer VPE? | jede Preisrechnung |
| L-04 | Welche VPE-Einheiten fuehrt der Grosshaendler? | Auswertbarkeit |
| L-05 | Welche Zulassungszeichen ausser DVGW und SVGW? | Zulassungsregel |
| L-06 | Verschnittzuschlag: Wert, und je Material oder pauschal? | jede Laengenrechnung |
| L-07 | Stangenlaengen je Material, und wird je Position oder je Zone aufgerundet? | Bestellmenge |
| L-08 | Zugabe fuer Boegen und Etagenversatz? | Rohrlaenge |
| L-09 | Gehoert die Leitung ab T-Stueck in diese Zone? | Zonenschnitt |
| L-10a | Standard-Schellenabstand Abwasser innerhalb 110–150 cm? | Abwasserregel laeuft nicht |
| L-10b | Zuordnung Querschnitt → Schellenabstand bei haengenden Leitungen? | Abwasserregel laeuft nicht |
| L-11 | Standardwert Ausdehnungsmuffe zwischen 5 und 6 m? | Abwasserregel laeuft nicht |
| L-12 | Reduktion 110/56 oder 110/63 — was entscheidet? | Artikelzuordnung |
| L-13 | Gilt `Geschosse × Geschosshoehe` auch fuer den Abwasser-Fallstrang? | alle Abwasserlaengen |
| L-14 | Groesse und Winkel des Abzweigers zwischen WC und Reduktion? | Artikelzuordnung |
| L-15 | Dusche und Kueche separat — eigene Zone, eigene Regel, welche Positionen? | Dusche fehlt sonst ganz |
| L-16 | `techniker_id` oder `techniker_user_id` fuer Material? | Techniker-RLS |
| L-17 | Positionen der Varianten A und C? | zwei von drei Varianten |
| L-18 | Fehlende Trinkwasser-Zulassung: Sperre oder Warnung? | Regel steht inaktiv |
| L-19 | Gibt es eine unzulaessige Kombination bei der Verbindungsart? | Regeltyp leer |
| L-20 | ZK-Entnahmestelle als Geschoss oder als Meter? | Genauigkeit ZK |
| L-21 | Schellen je Strang oder gemeinsam fuer KW/WW/ZK? | Schellenzahl |
| L-22 | Was ist die „Situation" bei den Anschlussgroessen? | Groessenwahl |
| L-23 | Ausdehnungsmuffen aufrunden oder abrunden? | ±1 Muffe je Strang |
| L-24 | Gilt die Trinkwasserregel auch ausserhalb der Schweiz? | Regionsbindung |
| L-25 | Ist Kaelte ein eigenes Zonen-Medium? | Medium-Liste |
| L-26 | Werden Kupfer, Kunststoff, Mehrschichtverbund gefuehrt? | Ebene C Vollstaendigkeit |
| L-27 | Zollmass-Format im Katalog? | Filterbarkeit nach Import |
| L-28 | Darf ein Partner globale Kennzahl- und Fachregeln ueberschreiben? | Geschaeftsregel |
| L-29 | Welche Felder liefert DATANORM tatsaechlich? | L3 Importer |
