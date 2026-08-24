# Architekturuebersicht zur Zweitpruefung

**Stand:** 25.08.2026 · **System:** Projekt- und Leistungsverwaltung eines
Schweizer Sanitaer-/HKLS-Betriebs · **Stack:** statische HTML-Oberflaechen,
serverlose Funktionen (Vercel), PostgreSQL via Supabase (PostgREST als
Daten-API, Supabase Storage fuer Dateien), Anthropic-API fuer den Assistenten

Diese Datei ist **eigenstaendig**. Sie setzt keine Kenntnis des Repos voraus.
Sie enthaelt **keine Zugangsdaten, keine Projekt-IDs, keine Datenbank-UUIDs**.
Wo eine Kennung noetig waere, steht, wofuer sie steht.

---

## 1. Zweck des Systems in fuenf Saetzen

Ein Sanitaer- und Heizungsbetrieb fuehrt gleichzeitig mehrere Baustellen, auf
denen Monteure taeglich Stunden, Material, Taetigkeiten und Fotos erfassen.
Diese Erfassung ist die einzige Quelle fuer alles, was danach Geld bewegt: den
Wochenbericht an den Bauleiter des Kunden, das unterschriebene Stundenblatt fuer
die Buchhaltung und die Rechnung. Der Betriebsinhaber ("Master") sieht alles,
korrigiert Erfasstes, ordnet Fotos zu und erzeugt die Dokumente; die Monteure
sehen ausschliesslich die ihnen zugewiesenen Baustellen; Auftraggeber
("Partner") sehen lesend ihre eigenen Projekte. Ein Sprachassistent beantwortet
Fragen zum Bestand und nimmt Erfassungen entgegen, damit auf der Baustelle
nicht getippt werden muss. Das System ersetzt damit den Papierrapport, die
Excel-Wochenuebersicht und den manuell zusammengestellten Kundenbericht.

---

## 2. Datenmodellkarte

44 Tabellen mit dem Praefix des Betriebs. Gruppiert nach fachlicher Aufgabe;
je Tabelle die Frage, die sie beantwortet.

### 2.1 Kern: Wer, wo, was

| Tabelle | Beantwortet | Wichtige Beziehungen |
|---|---|---|
| **projekte** | Welche Baustellen gibt es? | → kunden (nullable!), → Partner-Konto, Soft-Delete-Feld |
| **kunden** | Wer bezahlt? | ← projekte, ← wochenrapporte |
| **techniker** | Wer arbeitet? | Bindeglied Login-Konto ↔ fachliche Person |
| **projekt_techniker** | Wer darf auf welche Baustelle? | projekte ↔ techniker · **die Zugriffskette der Monteure** |
| **projekt_beteiligte** | Wer ist sonst beteiligt? | → projekte |
| **projekt_stockwerk** | Wie ist das Gebaeude gegliedert? | → projekte |
| **bauabschnitte** | Welche Bauphasen? | → projekte |

> **Auffaellig:** Die Kundenbindung eines Projekts ist optional, und die
> Mehrheit der Projekte im Bestand traegt keinen Kunden. Jede Auswertung
> „nach Kunde" muss deshalb einen Fall „ohne Kunde" fuehren. Das ist kein
> Datenfehler, sondern gelebte Praxis — sie faellt aber jedem Neubau auf die
> Fuesse, der Kunde als Pflicht annimmt.

### 2.2 Leistungserfassung — das Herz

| Tabelle | Beantwortet | Beziehungen |
|---|---|---|
| **tagesrapporte** | Wer hat an welchem Tag wo wie lange gearbeitet? | → projekte *oder* → serviceauftrag *oder* Abwesenheit; → wochenrapporte |
| **wochenrapporte** | Was hat ein Monteur in einer Kalenderwoche geleistet? | ← tagesrapporte; traegt beide Unterschriften |
| **rapport_positionen** | Mehrere Teilleistungen innerhalb eines Tagesrapports | → tagesrapporte (Kaskade) |
| **wochenrapport_log** | Wer hat wann welche Zeile geaendert? | → tagesrapporte |
| **taetigkeiten** / **taetigkeitenkatalog** / **tagesrapport_taetigkeitenkatalog** | Welche Arbeit wurde ausgefuehrt, aus welchem Katalog? | → projekte, → tagesrapporte |
| **material** | Was wurde verbaut? | → projekte |

**Die zentrale Regel des Datenmodells**, weil sie zwei verschiedene
Aggregationen auf derselben Tabelle erzwingt:

- **Stunden** werden je Kalendertag **addiert**.
- **Spesen** (Tagespauschale) fallen je Kalendertag **einmal** an, unabhaengig
  davon, auf wie vielen Baustellen gearbeitet wurde.

Die Spesenspalte haengt aber an der **Zeile**, nicht am Tag. Der Lesepfad
kompensiert das an **sechs Stellen** mit „Maximum je Kalendertag" — in
**drei** unabhaengigen Implementierungen (zwei serverseitig, eine im Browser).

Ein Eindeutigkeitsschluessel ueber (Projekt, Monteur, Datum) verhindert echte
Duplikate und erlaubt zugleich mehrere Baustellen am selben Tag. Er ist
**wirkungslos**, sobald das Projektfeld leer ist — also fuer Serviceauftraege
und Abwesenheiten, wo NULL-Werte zueinander als verschieden gelten.

### 2.3 Dokumente und Medien

| Tabelle | Beantwortet |
|---|---|
| **wochenberichte** | Welcher Bericht wurde fuer welche Baustelle und Woche erzeugt, versendet, eingefroren? |
| **projekt_medien** | Welches Foto/Video gehoert zu welcher Baustelle — und zu welchem Arbeitstag? |
| **rapport_nummernkreis** | Welche fortlaufende Nummer bekommt der naechste Rapport je Kunde? |
| **branding** | Wie sieht ein Dokument aus (Logo, Farbe, Fusszeile)? |

> **Die wichtigste offene Kante im Modell:** Ein Foto kann an einem Arbeitstag
> haengen — muss aber nicht. Haengt es an keinem, gehoert es keiner Woche an
> und erscheint als Auffangposten in **jeder** Wochendokumentation seiner
> Baustelle. Ein Aufnahmedatum gibt es nicht, nur einen Hochladezeitpunkt, und
> der ist nicht dasselbe. Die Zuordnung ist deshalb zwingend eine
> **menschliche Entscheidung** und darf nicht abgeleitet werden.

### 2.4 Vertrieb, Angebot, Zahlung

| Tabelle | Beantwortet |
|---|---|
| **anfragen** | Welche Leads kamen herein? |
| **crm_aktivitaeten** / **crm_aufgaben** | Was wurde mit einem Kunden besprochen, was steht an? |
| **angebote**, **kalk_positionen**, **kalk_settings**, **split_profile** | Was kostet es, wie ist es kalkuliert? |
| **auftragsbestaetigung**, **vertraege** | Was wurde verbindlich vereinbart? |
| **steps**, **escrow** | Welcher Zahlungsschritt ist faellig, welcher hinterlegt? |
| **rechnungen** | Was wurde fakturiert? |
| **umsatz_monat**, **margen** | Wie steht der Betrieb wirtschaftlich da? |

### 2.5 Service, Steuerung, Assistent

| Tabelle | Beantwortet |
|---|---|
| **service_auftrag**, **service_techniker** | Welcher Einzelauftrag laeuft, wer ist drauf? |
| **blockaden** | Was haelt eine Baustelle auf? |
| **gw_haus**, **gw_einheit**, **gw_step** | Wie weit ist welche Wohneinheit? |
| **nachrichten** | Was wurde im Team ausgetauscht? |
| **partner_profil**, **partner_entitlements**, **features** | Welcher Partner darf welches Modul sehen? |
| **bob_wissen**, **jarvis_wissen** | Was weiss der Assistent? |
| **katalog_entscheidung** | Welche Katalogzuordnung wurde bestaetigt? |

---

## 3. Zugriffskontrolle

### 3.1 Der Grundsatz — und sein Preis

**Jede serverlose Funktion arbeitet mit dem Service-Schluessel der Datenbank
und umgeht damit Row Level Security vollstaendig.** RLS ist in der Datenbank
zwar definiert (Monteur sieht nur eigene Zeilen, Partner nur eigene Projekte),
greift fuer den Serverpfad aber nie. Sie ist ein zweites Netz gegen den
oeffentlichen Browser-Schluessel, nicht die tragende Kontrolle.

**Die tragende Kontrolle sitzt vollstaendig im Anwendungscode.** Wer dort eine
Pruefung vergisst, hat keinen zweiten Schutz.

### 3.2 Der Ablauf jeder Anfrage

```
Token  →  Auth-Dienst  →  Benutzerkennung
                              │
                              ├─ Primaerrolle  (Pflicht)
                              └─ Zusatzrollen  (optional)
                                     │
                          gewuenschte Rolle, sofern gehalten
                                     │
              ┌──────────────────────┼──────────────────────┐
           MASTER                 MONTEUR                PARTNER
```

**Master.** Doppelt gesperrt: die Benutzerkennung muss *exakt* einer im Code
fest verdrahteten Kennung entsprechen **und** die Rolle muss stimmen. Danach
Vollzugriff auf jede Aktion. Ein zweiter Betrieb ist damit ausgeschlossen —
siehe Abschnitt 5.

**Monteur.** Nur Aktionen aus einer Positivliste (**23 Eintraege**). Alles
andere wird verweigert, bevor irgendetwas gelesen wird. Die Zugriffskette:

```
Benutzerkennung → Monteur-Datensatz → Zuweisungstabelle → erlaubte Baustellen
```

Ohne verknuepften Monteur-Datensatz ist die Kette gerissen und **alles** wird
verweigert — bewusst so, nicht als Fehler.

**Partner.** Zwei Wege, beide an eine Freischaltung gebunden: entweder die
Aktion steht in der Projektmanagement-Liste (**58 Eintraege**) und der Partner
ist fuer dieses Modul freigeschaltet, oder die Aktion hat ein eigenes
Feature-Recht und dieses ist freigeschaltet. Partner sind ueberdies auf allen
Schreibpfaden lesend gestellt.

### 3.3 Die zwei Besitzpruefungen

| Pruefung | Fuer wen | Weg | Fehlt der Treffer |
|---|---|---|---|
| **„gehoert mir"** | Partner | Projekt → Besitzerfeld = anfragender Partner | verboten |
| **„ist mir zugewiesen"** | Monteur | Monteur-Datensatz → Zuweisungstabelle → Projekt | verboten |

Beim Master sind **beide Pruefungen wirkungslos** — sie kehren sofort zurueck.
Das ist gewollt, macht aber die Master-Sperre zum einzigen Riegel dieser Ebene.

Fuer Zeilen-Tabellen (Material, Taetigkeiten) gibt es die abgeleitete Variante:
Zeile → zugehoeriges Projekt → „gehoert mir".

### 3.4 Was daran auffaellt

1. **Die Master-Kennung steht im Quelltext.** Kein Konfigurationswert, keine
   Tabelle. Ein zweiter Betrieb erfordert eine Code-Aenderung.
2. **Positivliste statt Sperrliste** — richtig herum. Eine neue Aktion ist
   standardmaessig fuer alle ausser dem Master gesperrt.
3. **Zwei Aktionsgruppen sind bewusst in keiner Liste** und damit
   Master-exklusiv, auch ohne eigene Pruefung. Das funktioniert, ist aber eine
   Regel, die man nur durch Lesen des Verteilers erfaehrt.
4. **Die Rollenermittlung kostet zwei Datenbankabfragen je Anfrage**, ohne
   Zwischenspeicher.

---

## 4. Die vier Erzeugnisse

Alle vier gehen durch **einen einzigen, selbstgeschriebenen PDF-Erzeuger**
ohne externe Bibliothek. Alle vier sind hell: weisser Grund, schwarze Schrift.

### 4.1 Wochenbericht — Baustelle × Kalenderwoche

*Fuer den Bauleiter des Kunden.* Sammelt die Tageszeilen **ueber das Datum**
(nicht ueber die gespeicherte Wochennummer, damit Altzeilen ohne Wochenangabe
nicht verschwinden), gruppiert nach Kalendertag mit mehreren Zeilen darunter,
haengt Taetigkeiten und Material an und bettet bis zu sechs Fotos ein.

**Die heikelste Stelle im ganzen System sitzt hier:** Der Bericht sieht nur die
Zeilen *seiner* Baustelle, die Tagespauschale faellt aber je Kalendertag nur
einmal an. Damit vier Berichte desselben Tages die Pauschale nicht viermal
ausweisen, laeuft eine **Zusatzabfrage ueber alle Baustellen des Monteurs**
und kuert je Tag ein „fuehrendes" Projekt — das mit den meisten Stunden, bei
Gleichstand das mit der kleineren Projektnummer. Nur dieses weist die Pauschale
aus, die uebrigen null.

Damit haengt eine **geldwirksame** Zahl von einer Sortierregel ab, und der
Bauleiter sieht eine Zahl, deren Zustandekommen von Baustellen abhaengt, die
ihn nichts angehen. Diese Regel ist derzeit als Entscheidungsvorlage offen.

Der Bericht kann eingefroren und per Mail versendet werden; ab dann wird er aus
einem Datenabzug gerendert, nicht neu eingesammelt.

### 4.2 Fotodokumentation — Monteur × Kalenderwoche, ueber alle Baustellen

Gruppiert nach **(Tag, Baustelle)**; diese Gruppengrenze ist zugleich die
Schnittkante fuer die Aufteilung. Fotos werden vor dem Hochladen im Browser
verkleinert, weil serverseitig kein Bildcodec zur Verfuegung steht. Das
fertige PDF wird **nicht** in der Antwort zurueckgegeben, sondern im Objektspeicher
abgelegt und als zeitlich begrenzter Link geliefert — ein Dokument mit zehn
Fotos ueberschritt sonst die Antwortgrenze der Plattform. Bei Bedarf wird in
mehrere Teile geschnitten.

Zwei bewusste Grenzen: ein Deckel von 24 Bildern je Woche, und Fotos ohne
Tageszuordnung erscheinen im Auffangposten **jeder** Woche dieser Baustelle.

### 4.3 Stundenblatt — Monteur × Kalenderwoche

*Fuer Unterschrift und Buchhaltung.* Sammelt ueber die Wochenzugehoerigkeit,
quer ueber alle Baustellen, mit beiden Unterschriften. Hier ist die
Spesensumme **immer richtig** — sie wird nirgends zugerechnet, sondern schlicht
je Kalendertag einmal gezaehlt. Wer die Wochensumme pruefen will, prueft hier.

### 4.4 Arbeitsrapport — Einzeltag

Der aelteste der vier, aus der Zeit vor dem Wochenblatt. Ein Kopfsatz plus
Zusatzpositionen fuer mehrere Baustellen an einem Tag — der historische
Behelf, bevor mehrere Tageszeilen je Tag moeglich waren. Er speichert ueber
einen anderen Weg als das Wochenblatt und ist der einzige Schreibpfad, dessen
Konfliktschluessel nicht der fachliche ist.

---

## 5. Wo das System bei zehn und bei hundert Betrieben nicht mehr traegt

### 5.1 Es gibt genau **einen** Betrieb — im Quelltext

Die Kennung des Betriebsinhabers steht als Konstante im Code, und der
Master-Zugang prueft auf Gleichheit mit ihr. Es gibt keine Mandantenspalte auf
Projekten, Kunden, Monteuren oder Tagesrapporten. **Bei zwei Betrieben** sieht
Betrieb A die Baustellen von Betrieb B, sobald beide dieselbe Instanz nutzen —
denn RLS ist im Serverpfad umgangen und die Anwendungspruefungen kennen nur
„gehoert mir" (Partner) und „ist mir zugewiesen" (Monteur), nicht „gehoert
meinem Betrieb".

Das ist **kein Skalierungsproblem, sondern ein Trennungsproblem**, und es ist
die erste und teuerste Baustelle. Nachtraeglich eine Mandantenspalte
einzuziehen heisst: jede Tabelle, jede Abfrage, jede Zugriffspruefung.

### 5.2 Die Dokumenterzeugung laeuft synchron in der Anfrage

Ein Wochenbericht laedt Fotos aus dem Objektspeicher, bettet sie ein und baut
das PDF — alles innerhalb der Antwortzeit einer serverlosen Funktion. Die
Sammelerzeugung ueber vier Baustellen laeuft deshalb bewusst **nacheinander**,
nicht parallel. Ein Betrieb mit zwanzig Baustellen je Woche wartet dann
minutenlang; ein Zeitlimit der Plattform bricht mitten in der Kette ab, und es
gibt keinen Wiederaufsetzpunkt.

**Bei zehn Betrieben** faellt das zusammen, wenn alle freitagnachmittags ihre
Woche abschliessen. Es braucht eine Warteschlange mit Fortschritt und
Wiederaufnahme, nicht mehr Rechenzeit.

### 5.3 Dieselbe fachliche Regel liegt mehrfach im Code

Die Regel „Spesen je Kalendertag" existiert in drei Implementierungen mit sechs
Aufrufern, zwei davon serverseitig, eine im Browser. Die Zurechnungsregel zum
„fuehrenden Projekt" liegt an einer Stelle, wird aber von einer zweiten Regel
gelesen. Kein Test haelt die Implementierungen gegeneinander.

**Bei einem Betrieb** faellt eine Abweichung auf, weil eine Person alle Zahlen
kennt. **Bei hundert** faellt sie in einer Rechnung auf, ein halbes Jahr
spaeter, bei einem Kunden, den niemand im Blick hatte. Fachregeln, die Geld
bewegen, gehoeren an genau eine Stelle mit einem Test, der sie festnagelt.

---

## 6. Die drei am schwersten rueckgaengig zu machenden Entscheidungen

### 6.1 Kein Paketmanifest, keine einzige Abhaengigkeit

Es gibt keine Paketdatei. Der PDF-Erzeuger, der Mailversand, die
Bildverkleinerung, die Kalenderwochenrechnung — alles selbst geschrieben,
alles ueber eingebaute Sprachmittel.

*Warum es gut ist:* keine Lieferkette, keine Sicherheitsupdates, kein
Installationsschritt, ein Ladeverhalten ohne Ueberraschungen.
*Warum es schwer umkehrbar ist:* Eine Paketdatei einzufuehren aendert, **wie
die Plattform die Servermodule laedt** — aus einem Modulformat wird ein
anderes. Bestehende Dateien, die auf das heutige Verhalten bauen, stuerzen dann
beim Laden ab. Das ist im System schon einmal passiert und hat sich als
generischer Verbindungsfehler getarnt.

Diese Entscheidung ist **kein Detail, sondern eine Architekturgrenze**.

### 6.2 PostgREST als einzige Datenzugriffsschicht

Es gibt keine Abfragesprache im Code, keinen Objektabbilder, keine
Transaktionen. Jeder Zugriff ist ein HTTP-Aufruf mit Filtern in der Adresszeile.

*Folgen:* Mehrere Schreibvorgaenge lassen sich **nicht** in eine Transaktion
fassen. Wo zwei Dinge zusammen gelingen muessen — Datei verschieben *und*
Eintrag umschreiben — steht im Code ein von Hand gebautes Zurueckrollen.
Schemaaenderungen laufen ausserhalb, von Hand.

*Warum schwer umkehrbar:* Ein Wechsel beruehrt jede einzelne Datenzugriffszeile.

### 6.3 Die Zugriffskontrolle liegt vollstaendig in der Anwendung

Der Service-Schluessel umgeht RLS. Damit ist RLS **nicht** die Kontrolle,
sondern ein zweites Netz. Jede neue Aktion muss selbst daran denken, Besitz zu
pruefen.

*Warum schwer umkehrbar:* Die Kontrolle in die Datenbank zurueckzuholen hiesse,
jede Anfrage mit dem Token des Anfragenden statt mit dem Service-Schluessel zu
fahren — und damit jede Stelle neu zu bewerten, die heute bewusst mehr sieht,
als der Anfragende duerfte (Rollenermittlung, die Zurechnung ueber fremde
Baustellen, jede betriebsweite Auswertung).

---

## 7. Drei Fragen an den Pruefer

### 7.1 Welche Annahme traegt dieses System, die nirgends aufgeschrieben ist?

Zur Orientierung ein paar Kandidaten, die ich sehe — die interessante Antwort
ist die, die hier **nicht** steht:

- dass ein Monteur an einem Kalendertag hoechstens einen Arbeitgeber und eine
  Tagespauschale hat;
- dass die Person, die erfasst, dieselbe ist, die geleistet hat;
- dass eine Kalenderwoche die kleinste Abrechnungseinheit ist;
- dass ein Foto zu genau einer Baustelle gehoert;
- dass die Zeit des Servers und die des Monteurs dieselbe Zeitzone haben.

### 7.2 Was bricht zuerst, wenn statt einem Betrieb fuenfzig darauf arbeiten?

Bitte begruenden Sie die Reihenfolge, nicht nur den ersten Punkt — und pruefen
Sie, ob die Trennung der Betriebe (5.1) wirklich vor der Dokumenterzeugung
(5.2) bricht oder umgekehrt.

### 7.3 Welche Integration wuerde den groessten Aufwand sparen, und was muesste dafuer vorher stimmen?

Der Betrieb erfasst Leistung heute vollstaendig hier und uebertraegt Rechnungen
danach von Hand in seine Finanzsoftware. Welche Anbindung waere der groesste
Hebel — Buchhaltung, Lohn, Materialbestellung, Zeiterfassung? Und welche
Datenqualitaet muesste **vorher** stimmen, damit die Anbindung nicht falsche
Zahlen sauber automatisiert? Bitte benennen Sie die Vorbedingung so konkret,
dass sie pruefbar ist.
