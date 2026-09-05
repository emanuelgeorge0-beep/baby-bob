# Annahmen und Lueckenliste — Berichtsmodus M1

Drei Teile:

1. **Annahmen** — Modellentscheidungen, die ich getroffen habe, weil sie
   getroffen werden mussten. Jede ist umkehrbar und benennt, was die Umkehr
   kosten wuerde.
2. **Lueckenliste** — jede offene Frage einzeln, mit Kennung `L-nn`. Diese
   Antworten muessen von Emanuel (bzw. der Fachjuristin) kommen, bevor
   `scripts/berichtsmodus_m1.sql` laeuft.
3. **Was ich bewusst nicht getan habe.**

Grundsatz dieser Runde: **keine erfundenen Werte, keine Bausteintexte, keine
Rechtsauskunft.** Wo etwas fehlt, steht es hier als Luecke — nicht als Vermutung
im Modell.

---

## 1 Annahmen — was ich entschieden habe

### A-01 · Die Ownership-Spalte heisst `partner_user_id`, nicht `partner_id`

Die beschlossene Architektur nennt sie `partner_id`. Im Modell heisst sie
`partner_user_id`, weil **jede** bestehende Besitzpruefung im Code exakt diesen
Namen liest: `gs_projekte.partner_user_id`
(`scripts/rapport_system_migration.sql:26`, gelesen in `api/cockpit.js:198`,
`api/wochenbericht.js:373`, `api/tagesrapport.js:334-337`) und
`gs_kunden.partner_user_id` (`scripts/partner_kunden_scope.sql:17`).

Der Begriff ist unveraendert, nur der Name folgt dem Haus. Das Gegenbeispiel
`gs_branding.partner_id` (`scripts/branding_tabelle.sql:26`) existiert, ist aber
eine Tabelle, an der keine Zugriffspruefung haengt.

*Kosten bei Umkehr:* eine Zeile pro Tabelle (`alter table … rename column`),
solange keine Daten drin sind. Danach zusaetzlich jede Codestelle. Wenn Emanuel
`partner_id` will, sollte das **vor** dem ersten Lauf entschieden werden.
→ **L-01**

### A-02 · Die Einbahnkette liegt als Trigger in der Datenbank, nicht im Endpunkt

Begruendung ausfuehrlich in `architektur.md`, E-02. Kurz: der Server arbeitet
ausnahmslos mit dem `service_role`-Key (`api/cockpit.js:30` u.a.), der RLS
umgeht (`scripts/wochenrapport_feinschliff.sql:51-52`). Eine Regel im Endpunkt
gilt nur, wenn der Endpunkt sie aufruft — `api/tagesrapport.js:109-125` und
`api/gs.js:39-47` beweisen, dass das nicht verlaesslich ist.

Das Haus kann Trigger (sechs im Bestand) und hat `security definer` schon einmal
richtig eingesetzt (`scripts/rapportnummer.sql:134-159`). Neu ist nur, dass hier
zum ersten Mal **Geschaeftsregeln** statt `updated_at` in einem Trigger stehen.

*Kosten bei Umkehr:* die Trigger lassen sich einzeln fallen lassen, dann bleibt
das Modell als reine Tabellenstruktur bestehen. Der Bericht ist dann aber kein
Nachweis mehr, sondern eine Notiz — genau die Unterscheidung, die M4 nicht
verhandelbar macht.

### A-03 · Der Nummernkreis hat keinen Jahresschnitt

„Durchgehend pro Partnerbetrieb" habe ich woertlich genommen: PK ist
`partner_user_id` allein, der Zaehler laeuft ueber Jahresgrenzen weiter. Das
weicht vom Rapport ab, wo der PK `(kuerzel, jahr)` ist
(`scripts/rapportnummer.sql:110-116`).

*Kosten bei Umkehr:* mittel. Ein Jahresschnitt liesse sich nachtraeglich
einfuehren, aber nur fuer neue Jahre — die Nummern des laufenden Jahres bleiben
dann durchgehend, und man haette zwei Regime nebeneinander.
→ **L-12** (Format), **L-13** (Jahresschnitt)

### A-04 · `gs_bericht_nummernkreis` ist eine achte Tabelle

Die beschlossene Architektur nennt sieben Tabellen. Ein Nummernkreis braucht
einen Zaehler; das Vorbild `gs_rapport_nummernkreis`
(`scripts/rapportnummer.sql:110-116`) ist ebenfalls eine eigene Tabelle. Das ist
Mechanik, keine neue Architektur.

*Kosten bei Umkehr:* keine sinnvolle Alternative. Eine Sequence waere die
einzige, und sie waere falsch: Sequences rollen nicht zurueck und erzeugen
genau die Luecken, die dieses Modell ausschliesst (`architektur.md`, E-03).

### A-05 · `gs_bericht_ereignis` ist eine neunte Tabelle

Ebenfalls nicht in der beschlossenen Liste. Begruendung in `architektur.md`,
2.3: `versand_protokoll` ist als Auditspur nachweislich untauglich — kein Hash,
ueberschreibbare Archivdatei (`lib/wochenbericht.js:2009,2014`), verworfene
Provider-ID (`lib/mail.js:73-76` vs. `lib/wochenbericht.js:2103`), optionale
Identitaet (`:2101`), und Read-Modify-Write ohne Append-Zwang (`:2033-2043`,
Eingestaendnis `:2026-2031`).

Ein Bericht, der einer Bauleitung vorgelegt wird, braucht eine Spur, die nicht
nachtraeglich umgeschrieben werden kann.

*Kosten bei Umkehr:* die Tabelle lassen sich streichen und durch eine
JSONB-Spalte auf `gs_berichte` ersetzen. Dann hat der Berichtsmodus dieselben
sechs Maengel wie der Wochenbericht heute. → **L-22**

### A-06 · `extern_system` / `extern_id` deutsch benannt

`scripts/service_hub_ENTWURF.sql:241-246` nennt dieselben Felder
`source_system` / `external_order_id`. Der Auftrag nennt sie `extern_system` /
`extern_id`, und der Rest dieses Moduls ist deutsch benannt — also deutsch.

*Kosten bei Umkehr:* gering, solange leer. Der ENTWURF ist ausdruecklich nicht
ausgefuehrt (`scripts/service_hub_ENTWURF.sql:1-11`), es gibt also keinen
Bestand, zu dem Konsistenz noetig waere. → **L-20**

### A-07 · Der Hash deckt Text und Reihenfolge, sonst nichts

Kanonische Form: `sortierung || 0x1f || text_snapshot`, verbunden mit `0x1e`,
sortiert nach `sortierung, id`. Nicht im Hash: `details`, `titel_snapshot`,
Zusatzarbeit, Kopfdaten, Fotos.

Grund: der Hash soll genau das absichern, was im Bericht als Aussage steht.
Je mehr hineingeht, desto oefter aendert er sich aus Gruenden, die niemand als
inhaltliche Aenderung versteht.

*Kosten bei Umkehr:* der Hash-Umfang laesst sich spaeter erweitern, aber dann
sind alte und neue Hashes nicht mehr vergleichbar. Wenn `details` (Menge, Ort,
DN) rechtlich Teil der Aussage sind, gehoeren sie hinein — und das ist eine
fachliche Frage. → **L-06**

### A-08 · Freigabe ohne Abschnitte wird abgewiesen

Ein leerer Nachweis ist keiner. Der Trigger verlangt mindestens einen Abschnitt.

*Kosten bei Umkehr:* eine Zeile. Wenn es einen realen Fall gibt, in dem ein
Bericht ohne Textabschnitt (nur Fotos, nur Zusatzarbeit) freigegeben werden
koennen muss, faellt diese Regel. → **L-07**

### A-09 · `gs_bericht_diktate` traegt einen eigenen Mandanten

`partner_user_id NOT NULL`, `bericht_id` nullable — ein Diktat kann entstehen,
bevor der Bericht existiert (jemand spricht auf dem Weg vom Dach). Ohne eigene
Mandantenspalte waere so ein Diktat herrenlos.

*Kosten bei Umkehr:* keine; die Spalte kann ungenutzt bleiben.

### A-10 · Uebersetzungen sind nicht eingefroren

Alle anderen Kindtabellen sperren ab `freigegeben`. Uebersetzungen nicht, weil
sie Beilage sind und Deutsch verbindlich bleibt: eine Uebersetzung darf auch
nach dem Versand entstehen, ohne den Nachweis anzutasten. Der `check
sprache <> 'de'` macht strukturell unmoeglich, dass hier je eine „deutsche
Uebersetzung" abgelegt wird, die man mit dem Original verwechseln koennte.

*Kosten bei Umkehr:* ein Trigger mehr, wenn Uebersetzungen doch mitversiegelt
werden sollen. → **L-05**

---

## 2 Lueckenliste

Jede Zeile ist eine Frage, die beantwortet sein muss, bevor gebaut wird. Die
Spalte **Blockiert** sagt, was ohne Antwort nicht gehen kann.

### Modell und Benennung

| Kennung | Offene Frage | Blockiert |
|---|---|---|
| **L-01** | Heisst die Ownership-Spalte `partner_user_id` (Hausstandard, A-01) oder `partner_id` (Wortlaut der Architektur)? | Der erste Lauf des SQL. Danach teuer. |
| **L-02** | Ist ein Partnerbetrieb wirklich = eine `auth.users`-ID? Heute ja (`scripts/branding_tabelle.sql:19-22`: „einen Partner gibt es nur als auth.users-ID, eine Partner-Tabelle existiert nicht"). Wenn ein Betrieb je mehrere Mitarbeiter haben soll, ist das Modell an dieser Stelle zu eng. | M5 aufwaerts, und die Mandantenfaehigkeit insgesamt. |
| **L-03** | Braucht `gs_berichte` ein `berichtsart`-Feld (Taetigkeitsbericht / Regiebericht / Fotodokumentation), oder ist der Modus eine einzige Art? Die Architektur sagt dazu nichts. | M2 (Aufbau der Oberflaeche). |
| **L-04** | Welche `gewerk`-Werte gelten fuer Bausteine? `gs_taetigkeitenkatalog` kennt fuenf (`scripts/taetigkeiten_katalog.sql:136-138`). Dieselben? Deshalb hier bewusst **kein** check. | M2 (Katalogstruktur). |
| **L-05** | Sollen Uebersetzungen beim Versand mitversiegelt werden (A-10)? | M8. |

### Nachweis und Hash

| Kennung | Offene Frage | Blockiert |
|---|---|---|
| **L-06** | Gehen `details` (Menge, Ort, DN) in den `inhalt_hash` ein? Rechtlich: sind sie Teil der Aussage oder Beiwerk? (A-07) | M4. Nachtraeglich aenderbar, aber dann sind alte Hashes nicht vergleichbar. |
| **L-07** | Darf ein Bericht ohne Textabschnitt freigegeben werden — nur Fotos, nur Regiearbeit? (A-08) | M4. |
| **L-27** | Braucht der Nachweis eine **Unterschrift** (Techniker und/oder Bauleitung), und wenn ja: Bild, Name-getippt oder beides? Der Bestand hat `gs_tagesrapporte.unterschrift_url` (`scripts/rapport_system_migration.sql:55`) — der Berichtsmodus hat heute nichts davon. | M4/M8. Wenn ja, fehlt eine Spalte. |

### Offline und Bausteinkatalog

| Kennung | Offene Frage | Blockiert |
|---|---|---|
| **L-08** | Bekommt `/app` einen eigenen Service Worker, oder wird der Scope von `cockpit-sw.js` erweitert? Heute registriert `app.html` **keinen** SW (kein Treffer fuer `serviceWorker` in der Datei). | Offline ueberhaupt. |
| **L-09** | Bekommt der Bausteinkatalog eine eigene **GET**-Route? Der heutige Katalog laeuft ueber POST (`app.html:10435`), und `cockpit-sw.js:34` kann POST nicht cachen. | Offline-Katalog. |
| **L-10** | Wird die harte Ausnahme `cockpit-sw.js:38` (`/api/` nie cachen) fuer genau diese eine Route aufgeweicht — mit stale-while-revalidate, das es im Repo bisher nirgends gibt? Oder liegt der Katalog stattdessen im Client (IndexedDB)? | Offline-Katalog. |
| **L-11** | Woran erkennt der Client, dass sein Katalogstand veraltet ist? Heute ist die einzige Invalidierung die Handkonstante `cockpit-sw.js:5`. Braucht `gs_bericht_bausteine` ein `stand`/`etag` je Partner? | Offline-Katalog. |
| | *Hinweis, keine Luecke:* solange L-08..L-11 offen sind, waere ein DB-Katalog offline **schlechter** als die heutige Hardcoded-Liste `app.html:6794-6805`. Reihenfolge beachten. | |

### Nummernkreis

| Kennung | Offene Frage | Blockiert |
|---|---|---|
| **L-12** | Format der Berichtsnummer. Vorschlag `B-000001`. Soll ein Betriebskuerzel hinein (`B-MUE-000001`)? Fuer eine Bauleitung, die Berichte mehrerer Betriebe erhaelt, waere `B-000001` zweimal verwirrend. Ein Betriebskuerzel gibt es heute nicht — `gs_kunden.kuerzel` (`scripts/rapportnummer.sql:77-85`) ist ein **Kunden**kuerzel. | M4. Format nach der ersten vergebenen Nummer nicht mehr aenderbar. |
| **L-13** | Jahresschnitt ja oder nein? (A-03) | M4. |
| **L-23** | Bekommt eine neue **Fassung** eine eigene Nummer (so modelliert) oder dieselbe Nummer mit Fassungszusatz (`B-000012 F2`)? Fachlich ist beides ueblich. | M4/M9. |

### Regiearbeit — rechtlich offen

Dieser Block wartet auf fachjuristische Rueckmeldung. Bis dahin sind alle Felder
in `gs_bericht_zusatzarbeit` **nullable** (A-06 in `architektur.md`, E-06). NOT
NULL laesst sich additiv nachtragen; umgekehrt nicht.

| Kennung | Offene Frage | Blockiert |
|---|---|---|
| **L-14** | Welche Angaben muss eine Regiearbeit tragen, damit sie gegenueber einer Bauleitung durchsetzbar ist? Welche davon sind Pflicht, welche nur ueblich? | Die NOT-NULL-Nachtraege. |
| **L-15** | Welche Werte darf `angeordnet_wie` haben, und macht es rechtlich einen Unterschied (muendlich / schriftlich / Mail / vor Ort quittiert)? | Ein `check` auf dem Feld. |
| **L-16** | Muss die anordnende Person namentlich benannt sein, oder genuegt die Funktion („Bauleitung")? | `angeordnet_von` NOT NULL ja/nein. |
| **L-17** | Gibt es eine Frist, innerhalb derer eine Regiearbeit gemeldet sein muss, damit sie gilt? Falls ja, braucht das Modell ein Feld dafuer und die Freigabe eine Pruefung. | M6. |
| **L-18** | Braucht die Regiearbeit einen eigenen, getrennt quittierbaren Nachweis, oder reicht sie als Teil des Berichts? | M6, ggf. eine zusaetzliche Kenntnisnahme-Zeile. |
| **L-19** | Welche Rollen gibt es bei der Kenntnisnahme (`bauleitung`, `kunde`, `intern`, …)? Heute bewusst ohne `check`. | M8. |

### Export

| Kennung | Offene Frage | Blockiert |
|---|---|---|
| **L-20** | Bleibt es bei `extern_system` / `extern_id` (deutsch, A-06), obwohl `scripts/service_hub_ENTWURF.sql:243` `source_system`/`external_order_id` vorschlaegt? | Kosmetik, aber vor dem ersten Lauf zu klaeren. |
| **L-21** | `gs_tagesrapporte` hat keine Mandantenspalte. Der Idempotenzschluessel ist dort `(extern_system, extern_id)` **ohne** Mandant und kollidiert, sobald zwei Betriebe dasselbe Fremdsystem nutzen. Zwei Auswege: **(a)** `partner_user_id` additiv auf `gs_tagesrapporte` nachtragen und aus dem Projekt fuellen, **(b)** die Einschraenkung akzeptieren, solange nur ein Verrechnungsprogramm angebunden ist. Ich empfehle (a) — es loest zugleich die Ursache von L-24. | Die Export-Runde. Nicht M1. |

### Auditspur

| Kennung | Offene Frage | Blockiert |
|---|---|---|
| **L-22** | Bleibt `gs_bericht_ereignis` als eigene Tabelle (A-05), oder soll es eine JSONB-Spalte wie `versand_protokoll` werden? Bei JSONB gelten die sechs in `architektur.md` 2.3 belegten Maengel wieder. | M8. |

### Ausserhalb von M1, aber M1 entwertend

Diese drei sind keine Modellfragen, sondern Befunde aus der Bestandsaufnahme.
Sie stehen hier, weil sie den Nachweischarakter des Berichts aushebeln, egal wie
gut das Modell ist.

| Kennung | Befund | Beleg |
|---|---|---|
| **L-24** | `save()` prueft nur die Rolle und nimmt `projekt_id` roh aus dem Body, **ohne** `gs_projekt_techniker` oder `partner_user_id` zu befragen. Jeder eingeloggte Techniker kann in ein fremdes Projekt buchen — und diese Zeilen fliessen in fremde Wochenberichte. *Selbst nachgelesen und bestaetigt.* | `api/tagesrapport.js:109-125`, Zeilen 110/111/147. Richtig gemacht wird es in `api/cockpit.js:3022` (`requireAssignedProjekt`). |
| **L-25** | `api/gs.js` hat **keine** Token-Pruefung und schreibt mit dem `service_role`-Key: `action:'erstgespraech'` PATCHt `gs_anfragen` anhand einer `anfrage_id` aus dem Body. *Selbst nachgelesen und bestaetigt.* | `api/gs.js:17-29` (kein Auth), `:39-47` (PATCH). |
| **L-26** | Die Master-Identitaet ist eine Quelltextkonstante — ein zweiter Betrieb ist strukturell nicht darstellbar. Der Berichtsmodus setzt Mandantenfaehigkeit voraus. | `api/cockpit.js:32`, geprueft `:155`. Bestaetigt in `docs/architektur-uebersicht-25-08-2026.md:255-266`. |

Weitere belegte Schreib-Luecken, die ich nicht einzeln durchnummeriere, weil sie
zur selben Ursache gehoeren (kein Backstop, weil RLS im Serverpfad wirkungslos
ist): `api/techniker.js:29-32` (unauthentifiziertes `select=*` auf
`gs_techniker`), `api/projekte.js:113-130` (Eigentuemerwechsel ueber ein
Body-Feld), `api/projekte.js:132-137` (`assign()` ohne Besitzpruefung), sowie
IDs ohne UUID-Validierung direkt im PostgREST-Query (`api/tagesrapport.js:58`,
`:100`, `api/rechnung.js:49`, `api/blockaden.js:275`, `api/nachrichten.js:176`,
`api/gewerke.js:387`).

---

## 3 Was ich bewusst nicht getan habe

- **Kein SQL ausgefuehrt.** `scripts/berichtsmodus_m1.sql` ist geschrieben und
  liegt. Ausgefuehrt wird es von Hand im Supabase-SQL-Editor, und erst, wenn
  L-01, L-12, L-13, L-20 und der rechtliche Block beantwortet sind.
- **Keine Bausteintexte erfunden.** `gs_bericht_bausteine` bleibt leer; die
  Texte kommen von Emanuel und sind M2. Der Testplan haelt das als T-M8 fest.
- **Keinen Code angefasst.** Kein Endpunkt, kein Frontend, kein `lib/`. Die
  Anforderungen an M3 (Snapshot serverseitig fuellen) und M8 (Auditspur
  schreiben) stehen als Saetze im Testplan, nicht als Implementierung.
- **Den SW-Cache nicht angefasst.** Bleibt v42 (`cockpit-sw.js:5`).
- **`api/cockpit.js:5124` nur gelesen.** `scope.isMaster` bzw. der dortige
  `svcUpdate`-Pfad ist unveraendert.
- **Keine Norm- oder Rechtsauskunft gegeben.** Der gesamte Block L-14..L-18
  bleibt offen, statt eine plausible Antwort zu erfinden. Genau deshalb ist in
  `gs_bericht_zusatzarbeit` kein einziges fachliches Feld NOT NULL.
- **Kein `DROP TABLE`, kein `DROP COLUMN`.** Die einzigen `drop`s im Skript sind
  `drop trigger if exists` und `drop policy if exists`, beide zwingend fuer
  Idempotenz.
