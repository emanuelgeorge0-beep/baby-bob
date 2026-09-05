# Berichtsmodus M1 — Ist-Zustand, Modell, Entscheidungen

Reine Papierrunde. Kein Code, kein Frontend, keine ausgefuehrte Migration,
SW-Cache unveraendert (v42, `cockpit-sw.js:5`).

M1 klaert die Grundlagen, auf denen M2 bis M11 aufsetzen. Die Architektur des
Berichtsmodus ist am 03.09. beschlossen; dieses Dokument erfindet sie nicht neu,
sondern prueft, worauf sie im Bestand aufsetzen kann — und zeigt, wo sie das
nicht kann.

Ergebnis dieser Runde:

| Datei | Inhalt |
|---|---|
| `scripts/berichtsmodus_m1.sql` | Das Modell. **NICHT ausfuehren.** |
| `docs/m1/architektur.md` | Dieses Dokument. |
| `docs/m1/testplan.md` | Saetze, die wahr sein muessen. |
| `docs/m1/annahmen.md` | Annahmen und Lueckenliste L-01..L-27. |

Jede Aussage ueber den Bestand ist mit Datei und Zeile belegt. Was nicht belegt
werden konnte, steht als Luecke in `annahmen.md`, nicht als Vermutung hier.

---

## 0 Der eine Satz vorweg

Der Leseschutz dieses Systems ist brauchbar. Der **Schreibschutz ist es nicht**.
Fuer einen Bericht, der einer Bauleitung vorgelegt wird, ist die zweite Haelfte
die wichtigere: „kann nicht nachtraeglich geaendert werden" wiegt schwerer als
„kann nicht gelesen werden". Genau diese Haelfte fehlt heute vollstaendig —
es gibt im gesamten Repo **keine einzige datenbankseitig erzwungene
Zustandskette** und **keinen einzigen Inhalts-Hash**.

Deshalb liegt der Schwerpunkt von M1 nicht auf neuen Tabellen, sondern auf den
drei Mechanismen, die einen Bericht vom Dokument zum Nachweis machen:
Mandant am Bericht selbst, Einbahnkette per Trigger, Hash beim Freigeben.

---

## 1 Ist-Zustand A — Mandantentrennung

### 1.1 RLS existiert als geschriebenes SQL, nicht als Durchsetzung

Policies sind in rund 25 Skripten geschrieben, u.a.:

| Tabelle | Beleg |
|---|---|
| `gs_projekte` | `scripts/rapport_system_migration.sql:105` — `partner_own_proj`, SELECT `partner_user_id = auth.uid()` |
| `gs_tagesrapporte` | `scripts/rapport_system_migration.sql:101` (`techniker_own`), `:107` (`partner_own_rapporte`) |
| `gs_rechnungen` | `scripts/rapport_system_migration.sql:110` |
| `gs_wochenberichte` | `scripts/wochenbericht.sql:183,186` — **nur** `service_all` + `admin_all`, keine Partner-Policy |
| `gs_taetigkeitenkatalog`, Snapshot-Tabelle | `scripts/taetigkeiten_katalog.sql:206-233` |
| `gs_rapport_nummernkreis` | `scripts/rapportnummer.sql:118-126` |

Zwei Einschraenkungen, beide belegt:

1. **Ob die Skripte in der Live-DB gelaufen sind, ist aus dem Repo nicht
   feststellbar.** Sie tragen durchgaengig den Vermerk „Run ONCE im Supabase
   SQL-Editor" (`scripts/wochenbericht.sql:11`,
   `scripts/gewerke_step_framework.sql:4`), und die API faengt fehlende Tabellen
   zur Laufzeit ab (`api/wochenbericht.js:331-337`). Ein Ausfuehrungsprotokoll
   gibt es nicht.
2. **Die Partner-Policy fuer `gs_projekte` ist an einer Stelle sogar
   auskommentiert** (`scripts/entitlements.sql:98-100`).

Die Skripte nennen RLS selbst „zweite Verteidigungslinie"
(`scripts/gewerke_step_framework.sql:6,63`; `scripts/wochenbericht.sql:178-179`).
Das ist die richtige Einordnung.

### 1.2 RLS ist im Serverpfad wirkungslos

Jeder Endpunkt arbeitet ausnahmslos mit dem `service_role`-Key:
`api/cockpit.js:30,34-38`, `api/tagesrapport.js:7-8`, `api/projekte.js:4-5`,
`api/rechnung.js:3-4`, `api/blockaden.js:18-20`, `api/gewerke.js:7-8`,
`api/nachrichten.js:8-9`, `api/projectflow.js:7-8`, `api/rapport.js:3` u.a.
Ein anon-Key kommt serverseitig nirgends vor.

Das User-Token wird **nur** gegen `/auth/v1/user` gehalten, um die Identitaet zu
ermitteln — nie fuer den Datenzugriff: `api/cockpit.js:136-138`,
`api/rapport.js:17`, `api/dashboard.js:29`, `api/wochenbericht.js:387`.

Der `service_role`-Key umgeht RLS vollstaendig. Das steht so im Repo:
`scripts/wochenrapport_feinschliff.sql:51-52`. **Folge: keine Policy schuetzt
irgendeinen Serverpfad.** RLS schuetzt genau eines — den Direktzugriff aus dem
Browser mit dem anon-Key.

### 1.3 Was tatsaechlich traegt: eine Kette im Anwendungscode

`resolveAccess` (`api/cockpit.js:134-191`) ist der Kern, und er ist gut gebaut:

1. `:136-141` Token gegen `/auth/v1/user` → `user.id`. Der einzige Punkt, an dem
   eine Identitaet entsteht.
2. `:146-153` Rollen aus `user_roles` und `user_extra_roles`.
3. `:155` `canMaster = user.id === MASTER_UID` — `MASTER_UID` ist eine
   hartkodierte Konstante (`api/cockpit.js:32`).
4. `:160-164` der vom Client geschickte `mode` wird nur honoriert, wenn die Rolle
   wirklich gehalten wird.
5. `:181-189` Partner → **`partnerId: user.id`**.

**Der Mandant ist also immer `user.id` aus dem verifizierten Token, nie ein Wert
aus dem Body.** Das ist die tragende Staerke des Musters, und der Berichtsmodus
baut darauf auf.

Die Wachen darueber:

- `requireOwnedProjekt` (`api/cockpit.js:196-201`) — liest
  `gs_projekte.partner_user_id`, vergleicht mit `scope.partnerId`.
  **Wichtig: Zeile 197 `if (!scope || !scope.partnerId) return;` — fuer Master
  UND fuer Techniker ist die Funktion ein No-Op.**
- `requireOwnedRow` (`:208-214`), `requireAssignedProjekt` (`:2324-2331`).
- `assertProjektAccess` (`:4505-4511`) verzweigt korrekt nach `scope.role` und
  ist deshalb die richtige Vorlage — nicht `requireOwnedProjekt` direkt.
- `uuid()` (`:2131`) validiert jede ID gegen `UUID_RE` und wirft sonst.

Dasselbe Muster ausserhalb: `api/wochenbericht.js:371-375` (`darfProjekt`),
`api/tagesrapport.js:334-345`, `api/projekte.js:87-91`, `api/gewerke.js:165-178`.

### 1.4 Wo das Muster reisst

**Es gibt keine Mandantenspalte.** Die einzige Eigentuemerachse ist
`gs_projekte.partner_user_id` (`scripts/rapport_system_migration.sql:26`). Alles
Abgeleitete haengt ueber `projekt_id` daran: `gs_tagesrapporte` hat selbst keine
Besitzspalte (`scripts/rapport_system_migration.sql:41-65`), `gs_wochenberichte`
auch nicht (`scripts/wochenbericht.sql:52-91`).

Wer einen Endpunkt schreibt, der eine `projekt_id` aus dem Body nimmt und die
Wache vergisst, hat **keinen zweiten Schutz** — RLS greift ja nicht. Genau das
ist zweimal passiert:

- **`api/tagesrapport.js:109-125`** — `save()` prueft nur die Rolle
  (`:110 role !== 'techniker' && role !== 'gs_admin'`), nimmt `projekt_id` roh
  aus dem Body (`:111`) und schreibt (`:147`), **ohne** je
  `gs_projekt_techniker` oder `partner_user_id` zu befragen. Jeder eingeloggte
  Techniker kann in ein fremdes Projekt buchen. *Selbst nachgelesen und
  bestaetigt.* Gegenbeispiel im selben Repo: `api/cockpit.js:3022` ruft
  `requireAssignedProjekt`.
- **`api/gs.js:39-47`** — die Datei hat **keine Token-Pruefung** (`:17-29`);
  `action:'erstgespraech'` nimmt `anfrage_id` aus dem Body und PATCHt
  `gs_anfragen` mit dem `service_role`-Key. *Selbst nachgelesen und bestaetigt.*

Weitere belegte Luecken: `api/techniker.js:29-32` (unauthentifiziertes
`select=*`), `api/projekte.js:113-130` (Eigentuemerwechsel per Body-Feld),
`api/projekte.js:132-137` (`assign()` ohne Besitzpruefung), PostgREST-Parameter
ohne UUID-Validierung an mehreren Stellen (`api/tagesrapport.js:58,100`,
`api/rechnung.js:49`, `api/blockaden.js:275`).

### 1.5 Was das fuer einen Nachweis bedeutet

**Traegt:** der Lesepfad fuer Partner (`api/wochenbericht.js:266` + `:371-375`,
UUID-validiert `:263`); der Versand ist Master/Admin vorbehalten (`:298-301`);
die Techniker-Kette im Cockpit (`api/cockpit.js:2324-2331`); der Autor einer
Zeile wird serverseitig gesetzt, nie vom Client (`api/tagesrapport.js:147`).

**Traegt nicht:** die Integritaet des Inhalts. Ein Bericht, dessen
Datengrundlage jeder Techniker der Instanz befuellen kann
(`api/tagesrapport.js:109-125`), ist gegenueber einer Bauleitung kein Nachweis.
Dazu: kein Backstop (1.2), keine Unveraenderlichkeit, kein Hash, kein Mandant
auf dem Bericht selbst.

---

## 2 Ist-Zustand B — Nummernvergabe und Auditspur

### 2.1 Das gute Muster ist schon da

`gs_rapport_nr_next` (`scripts/rapportnummer.sql:134-156`) macht es richtig:
Zaehlertabelle `gs_rapport_nummernkreis` mit PK `(kuerzel, jahr)` (`:110-116`),
Ziehung per

```sql
insert into gs_rapport_nummernkreis (kuerzel, jahr, letzte_nr, aktualisiert_am)
values (v_kuerzel, p_jahr, 1, now())
on conflict (kuerzel, jahr)
do update set letzte_nr = gs_rapport_nummernkreis.letzte_nr + 1, ...
returning letzte_nr into v_nr;
```

(`:148-153`), `security definer`, `set search_path = public` (`:134-140`),
`revoke all … from public` + `grant execute … to service_role` (`:158-159`).

**Das ist rennsicher.** `on conflict do update` nimmt eine Zeilensperre auf den
Zaehlerschluessel; zwei parallele Ziehungen serialisieren. Absicherung
zusaetzlich durch einen partiellen UNIQUE-Index (`:102-103`).

### 2.2 Warum es fuer den Berichtsmodus trotzdem nicht reicht

| Befund | Beleg |
|---|---|
| Der Zaehler ist **kunden**bezogen, nicht partnerbezogen — PK `(kuerzel, jahr)` aus `gs_kunden.kuerzel` | `scripts/rapportnummer.sql:110-116`, Aufloesung `api/cockpit.js:2655-2670` |
| **Luecken sind ausdruecklich gewollt** — bei einem Race verfaellt die gezogene Nummer: „Die eben gezogene Nummer verfaellt dabei — gewollt, Luecken sind erlaubt." | `api/cockpit.js:2736-2739`, ebenso `scripts/rapportnummer.sql:7-11` |
| Die Nummer wird beim **Anlegen** gezogen, nicht beim Freigeben; `einreichenWoche` vergibt nichts | `api/cockpit.js:2718-2721` vs. `:3191-3206` |
| **Stiller Fallback** auf ungeschuetztes Altformat `WR-…`, das der partielle UNIQUE-Index nicht abdeckt | `api/cockpit.js:2683` (`catch (_) { return null; }`), `:2722`, Index `scripts/rapportnummer.sql:102-103` |

Daneben laufen **fuenf weitere Nummernverfahren**, drei davon unsicher:
Projektnummer `max()+1` ohne Sperre (`api/projekte.js:202-209`),
Rechnungsnummer `max()+1` ohne Sperre gegen ein `UNIQUE`
(`api/tagesrapport.js:316-321`, Constraint
`scripts/rapport_system_migration.sql:72`), Auftragsbestaetigung per
Zeitstempel-Suffix ganz ohne Zaehler und ohne UNIQUE (`api/cockpit.js:5333-5334`,
Spalte `scripts/submodus_migration.sql:53`).

### 2.3 `versand_protokoll` taugt nicht als Auditspur

Es ist keine Tabelle, sondern eine JSONB-Spalte auf `gs_wochenberichte`
(`scripts/wochenbericht_versand.sql:30-31`), geschrieben von `protokolliere`
(`lib/wochenbericht.js:2032-2051`).

| Anforderung | Urteil | Beleg |
|---|---|---|
| a) Wer hat freigegeben | **teilweise** — `von: userId \|\| null`, optional statt Pflicht; ausserdem protokolliert wird der *Versender*, nicht der *Freigebende* | `lib/wochenbericht.js:2101` |
| b) Wann, welche Uhr | **ja, mit Mangel** — Serverzeit UTC, aber Node-Uhr fuer `am` gegen DB-`now()` fuer `updated_at`: zwei Uhren auf einer Zeile | `lib/wochenbericht.js:2096` vs. `scripts/wochenbericht.sql:166` |
| c) Was genau ging raus | **nein** — nur `pdf_bytes` und `pdf_path`, **kein Hash**; die Ablage laeuft mit `x-upsert: true` auf deterministischem Pfad, ein zweiter Versand **ueberschreibt die archivierte PDF** | `lib/wochenbericht.js:2106-2107`, `:2009`, `:2014` |
| d) An wen | **Empfaenger ja, Kanal nein** — `an[]` + `empfaenger_herkunft` sind da, Kanal/Absender/Betreff fehlen, obwohl im Versand gesetzt | `lib/wochenbericht.js:2097-2098` vs. `:2085-2087` |
| e) Ergebnis | **teilweise** — `ok`/`fehler` da, **Provider-ID verworfen**: `sendResendEmail` liefert `{ok,status,id}`, uebernommen wird nur `ok` | `lib/mail.js:73-76` vs. `lib/wochenbericht.js:2088,2103` |
| f) Unveraenderlichkeit | **nein** — Read-Modify-Write des ganzen Arrays per PATCH, kein Trigger dagegen; der Code raeumt die Race selbst ein | `lib/wochenbericht.js:2033-2043`, Eingestaendnis `:2026-2031` — *selbst nachgelesen* |

Zusaetzlich: `ok:true` heisst „Resend hat 2xx geliefert" (`lib/mail.js:43`), also
Annahme durch den Provider — nicht Zustellung. Einen Webhook-Empfaenger fuer
Bounces gibt es im Repo nicht.

**Urteil:** brauchbares Betriebs-Log, untaugliche Auditspur.

### 2.4 Es gibt im Bestand keine erzwungene Einbahnkette

Alle Status-`check`s sind reine Wertelisten ohne Vorzustandsbezug:
`scripts/wochenbericht.sql:71-72`, `scripts/wochenrapport_migration.sql:22`,
`scripts/service_minimal.sql:52-59`. Die einzige Uebergangslogik liegt im
Anwendungscode: `SVC_UEBERGAENGE` (`api/cockpit.js:5047-5053`), durchgesetzt
`:5090-5092`.

Dass ein versendeter Wochenbericht faktisch nicht zurueckgesetzt wird, ist die
**Abwesenheit von Code**, keine Garantie — ein PATCH mit dem `service_role`-Key
setzt ihn jederzeit zurueck.

Die Datenbank *kann* das Haus: sechs Trigger und sechs Funktionen existieren
(`scripts/blockaden_migration.sql:98,102`, `scripts/wochenbericht.sql:160,171`,
`scripts/zahlungssystem_migration.sql:89,94,98`,
`scripts/submodus_migration.sql:62,66`), dazu `gs_rapport_nr_next` mit
`security definer`. Nur sind alle sechs Trigger reine `updated_at`-Setzer. Das
Muster „harte Regel in die DB" ist genau **einmal** benutzt worden — dort, wo
`max()+1` nachweislich gerissen haette.

Sauberste Audit-Haltung im Repo: `gs_wochenrapport_log` — Snapshot vor dem
Eingriff, FKs `on delete set null` statt `cascade`, damit das Protokoll den
Verlust des Objekts ueberlebt (`scripts/wochenrapport_feinschliff.sql:60-73`),
und der Schreiber loggt **vor** dem Eingriff (`api/cockpit.js:2761-2770`).

---

## 3 Ist-Zustand C — Service-Worker und Katalogmuster

### 3.1 Der Service Worker

Es gibt genau einen: `cockpit-sw.js`, 63 Zeilen. Version `gs-cockpit-v42`
(`cockpit-sw.js:5`), von Hand erhoeht. Ein Versionssprung loescht **alle**
anderen Caches (`:24-30`), es gibt kein selektives Migrieren.

- Precache: sechs Eintraege Shell (`:6-13`), `addAll` mit `cache:'reload'`
  (`:15-22`), danach `skipWaiting()`.
- **`/api/*` wird NIE gecacht** — harte Ausnahme `:38`
  (`if (url.pathname.startsWith('/api/')) return;`), Absicht im Kopf `:4`,
  serverseitig doppelt via `Cache-Control: no-store` in `vercel.json`.
  *Selbst nachgelesen und bestaetigt.*
- POST geht immer durch (`:34`), Fremdhosts unangetastet (`:37`).
- Zwei Strategien: network-first fuer Navigation und Cockpit-HTML (`:46-52`),
  cache-first mit Nachcachen fuer alles andere (`:56-61`).
  **stale-while-revalidate existiert nirgends.**
- Registriert wird der SW **nur** in `gs-intern.html:7077-7081`, Scope
  `/gs-intern-7k2x`. `skipWaiting` + `clients.claim`, **kein** Reload-Prompt,
  kein `updatefound`-Handler.

**`app.html` — die Techniker-PWA auf `/app` — registriert ueberhaupt keinen
Service Worker.** Kein Treffer fuer `serviceWorker` in der Datei; nur
`<link rel="manifest">` (`app.html:21`). Der Techniker hat heute **keinen
Offline-Cache**.

### 3.2 Was fuer einen offline-faehigen Bausteinkatalog fehlt

Fuenf Dinge, jedes einzeln blockierend:

1. Der SW gilt nur fuer `/gs-intern-7k2x` (`gs-intern.html:7079`). Fuer `/app`
   gibt es keinen.
2. Ein Runtime-Cache fuer GET `/api/...` fehlt und ist aktiv verboten
   (`cockpit-sw.js:38`).
3. Der Katalog wird per **POST** geladen (`app.html:10435`
   `techApi('tech_taetigkeitenkatalog')`), und `cockpit-sw.js:34` kann POST
   prinzipiell nicht cachen. Es braucht eine eigene GET-Route.
4. Kein Client-Persistenzlayer fuer Fachdaten: `localStorage` nur fuer
   Auth/Praeferenzen, kein IndexedDB. `TC_TAET_KATALOG` (`app.html:10297`) lebt
   nur im RAM und ist nach einem Reload ohne Netz leer.
5. Kein Versions-/Invalidierungssignal fuer Katalogdaten — die einzige
   Invalidierung ist die Handkonstante `cockpit-sw.js:5`.

**Konsequenz fuer die Reihenfolge:** Ein serverseitig gepflegter
`gs_bericht_bausteine` waere fuer Offline zunaechst **schlechter** als das
Heutige. Was heute als Baustein existiert, ist eine hartkodierte
Client-Konstante — `var SHK_BAUSTEINE=[…]` (`app.html:6794-6805`, 10 Strings) —
und die liegt im HTML, ist also da, sobald die Seite da ist. Wer den Katalog in
die DB verlegt, ohne Punkt 1-4 zu erledigen, verschlechtert den Offline-Fall.
Das ist eine Reihenfolge-Entscheidung fuer M2/M3, nicht fuer M1 — hier nur
festgehalten.

### 3.3 Das Snapshot-Muster — es ist da, und es funktioniert

Zwei Tabellen in `scripts/taetigkeiten_katalog.sql`:

- **Lebender Katalog** `gs_taetigkeitenkatalog` (`:96-151`): `slug` „stabil, nie
  aendern" (`:100`), `bezeichnung` „frei aenderbar" (`:101`), `aktiv`
  „deaktivieren statt loeschen" (`:106`), UNIQUE `(gewerk, slug)` (`:146`).
- **Snapshot** `gs_tagesrapport_taetigkeitenkatalog` (`:156-201`):
  `bezeichnung_snapshot` NOT NULL (`:161,176`), `details jsonb` (`:162`),
  `taetigkeit_id` bewusst NULLABLE.

Die Regel des Hauses steht als Kommentar direkt darueber, `:154-155`:

> „bezeichnung_snapshot ist PFLICHT: Katalogaenderungen duerfen bereits erfasste
> Rapporte nie rueckwirkend veraendern — Anzeige liest immer den Snapshot."

*Selbst nachgelesen und woertlich bestaetigt.*

Die Fremdschluessel sind der eigentliche Trick:

- auf den Katalog: **`on delete set null`** (`:194-198`) — der Katalogeintrag
  darf verschwinden, die Rapportzeile bleibt mit intaktem Text stehen;
- auf den Rapport: **`on delete cascade`** (`:185-190`).

**Schreibpfad:** `syncTagesrapportTaetigkeiten` (`api/cockpit.js:2967-2985`) —
delete+insert bei jedem Speichern, aufgerufen aus `saveTechTag`
(`api/cockpit.js:3106-3122`). Nicht beim Freigeben; es gibt keinen zweiten
Kopiervorgang.

**Lesepfad:** liest wirklich den Snapshot. `api/cockpit.js:2953` selektiert
`bezeichnung_snapshot` und joint auf den lebenden Katalog **nur** fuer
`detailfelder`; `lib/wochenbericht.js:279-290` joint **gar nicht** und rendert
`bezeichnung` + `details` (`:758-765`).

### 3.4 Die eine Stelle, an der das Muster leckt

**Beweisfrage — aendert eine Katalogaenderung einen bestehenden Rapport?
Antwort: teilweise.**

- Umbenennen der `bezeichnung`: **nein.** Der Update-Endpoint
  `pmTaetigkeitenKatalogUpdate` (`api/cockpit.js:2870-2884`) fasst die
  Snapshot-Tabelle nicht an, und kein Trigger zieht nach.
- Loeschen: **nein.** `on delete set null` (`:197`), `bezeichnung_snapshot` ist
  NOT NULL und ueberlebt. Der Produktweg ist ohnehin Deaktivieren
  (`api/cockpit.js:2886-2900`, Kommentar `:2886-2887`: „NIE loeschen — alte
  Rapporte referenzieren die id weiter").
- **`detailfelder`: JA, rueckwirkend.** `api/cockpit.js:2953` embeddet
  `taetigkeit:gs_taetigkeitenkatalog(detailfelder)`, ausgewertet `:2957`. Aendert
  jemand die Felddefinition, aendert sich die Bearbeitungsmaske einer **alten**
  Zeile. Fuer Anzeige und PDF folgenlos (dort wird nicht gejoint), fuer einen
  Nachweis aber genau die falsche Eigenschaft.

Zweiter Mangel: der Snapshot kommt **vom Client**. `app.html:11841` schickt
`bezeichnung_snapshot: it.getAttribute('data-bezeichnung')`, der Server
uebernimmt den String ungeprueft (`api/cockpit.js:2980`, nur `.slice(0,200)`) und
liest die Bezeichnung nicht selbst nach.

### 3.5 Weitere Snapshot-Muster im Bestand

Das staerkste ist die Volleinfrierung des Wochenberichts:
`gs_wochenberichte.daten jsonb` (`scripts/wochenbericht.sql:76-78`), Kommentar
`:94-95` („Spaetere Korrekturen an gs_tagesrapporte aendern einen versendeten
Bericht nicht"), geschrieben `lib/wochenbericht.js:1923` beim Versand
(`:2060 einfrieren: true`), gelesen `:1858-1860`. Bekannte Schwaeche desselben
Musters: alte Snapshots kennen neuere Felder nicht (`lib/wochenbericht.js:966`,
`lib/sammelbericht.js:539-541`).

Ausserdem: Angebotspositionen als JSONB-Kopie
(`scripts/angebot_positionen.sql:7`, `api/cockpit.js:6495`), Zahlungsplan aus
eingefrorener Step-Kette (`api/cockpit.js:5336-5338,5364-5372`),
Materialpositionen als JSONB in der Tageszeile (`api/cockpit.js:3085`),
Katalog-Entscheidungsprotokoll als bewusste Momentaufnahme
(`api/cockpit.js:3020-3031`).

---

## 4 Das Modell

Neun Tabellen, alle neu, alle Namen vorher per grep geprueft (Eiserne Regel 7,
je **0 Treffer**): `gs_berichte`, `gs_bericht_abschnitte`,
`gs_bericht_bausteine`, `gs_bericht_diktate`, `gs_bericht_uebersetzungen`,
`gs_bericht_zusatzarbeit`, `gs_bericht_kenntnisnahme`,
`gs_bericht_nummernkreis`, `gs_bericht_ereignis`. Ebenso die sechs
Funktionsnamen (`gs_bericht_nr_next`, `gs_bericht_touch`,
`gs_bericht_zustand_wache`, `gs_bericht_kein_delete`,
`gs_bericht_inhalt_wache`, `gs_bericht_ereignis_wache`).

Sieben davon sind die beschlossene Architektur. Zwei sind Mechanik, die die
Beschluesse ueberhaupt erst durchsetzbar macht — `gs_bericht_nummernkreis`
(ohne Zaehler kein Nummernkreis) und `gs_bericht_ereignis` (ohne append-only
Tabelle keine Auditspur, siehe 2.3). Beide sind in `annahmen.md` als
Entscheidung A-04 und A-05 markiert und strichfaehig.

```
gs_bericht_bausteine ──(on delete set null)──┐
                                             │
gs_berichte ──(cascade)──► gs_bericht_abschnitte
   │  partner_user_id NOT NULL  ← der Mandant
   │  projekt_id NULLABLE       ← deshalb obiges NOT NULL
   │  zustand: entwurf → freigegeben → versendet   (Trigger, kein Rueckweg)
   │  bericht_nr / bericht_seq  ← nur vom Trigger, nur bei Freigabe
   │  inhalt_hash               ← SHA-256, berechnet in der DB
   │
   ├──(cascade)──► gs_bericht_uebersetzungen   (sprache <> 'de')
   ├──(cascade)──► gs_bericht_zusatzarbeit     (typ='regie', Felder nullable)
   ├──(cascade)──► gs_bericht_kenntnisnahme
   ├──(cascade)──► gs_bericht_diktate          (rohtext | vorschlag getrennt)
   └──(set null)─► gs_bericht_ereignis         (append-only)

gs_bericht_nummernkreis: eine Zeile je Partnerbetrieb
```

---

## 5 Die Entscheidungen

### E-01 · Der Mandant steht auf dem Bericht, nicht am Projekt

`gs_berichte.partner_user_id UUID NOT NULL`.

**Warum.** Der Beschluss vom 03.09. sagt: `projekt_id` darf null sein. Damit
faellt die einzige Eigentuemerachse des Systems weg (1.4) — ein Bericht ohne
Projekt haette nach heutigem Muster gar keinen Eigentuemer. Deshalb traegt der
Bericht ihn selbst, und zwar `NOT NULL`: eine Zeile ohne Mandant darf nicht
entstehen koennen, dann kann auch kein vergessener Endpunkt eine anlegen.

Gefuellt wird das Feld serverseitig aus `scope.partnerId`
(`api/cockpit.js:181-189`), also aus dem verifizierten Token — nie aus dem Body.
Das Gegenbeispiel, das genau daran scheitert, steht in `api/projekte.js:117`.

**Namenswahl.** Die Architektur nennt die Spalte `partner_id`. Hier heisst sie
`partner_user_id`, weil jede bestehende Besitzpruefung im Code exakt diesen
Namen liest (`gs_projekte.partner_user_id`,
`scripts/rapport_system_migration.sql:26`; `gs_kunden.partner_user_id`,
`scripts/partner_kunden_scope.sql:17`). Der Begriff ist identisch, nur der Name
folgt dem Haus. Umkehrbar mit einem `rename` — siehe `annahmen.md`, A-01.

### E-02 · Die Einbahn wird per Trigger erzwungen, nicht behauptet

Ein `check`-Constraint kann das nicht: er sieht den Vorzustand nicht. Genau
deshalb sind alle Status-`check`s im Bestand blosse Wertelisten (2.4).

`gs_bericht_zustand_wache` (BEFORE UPDATE auf `gs_berichte`) leistet vier Dinge:

1. **Kein Rueckweg** — Rang `entwurf=0 / freigegeben=1 / versendet=2` darf nie
   sinken.
2. **Kein Sprung** — `entwurf → versendet` direkt ist verboten.
3. **Nummer und Hash** werden im Uebergang gezogen bzw. berechnet, atomar mit
   dem Zustandswechsel.
4. **Kopf eingefroren** ab `freigegeben` — die unveraenderlichen Felder sind
   einzeln aufgezaehlt, damit sichtbar bleibt, was sich noch aendern darf.

Dazu drei weitere Wachen: Loeschen eines nicht-Entwurfs ist verboten
(`gs_bericht_kein_delete`), Abschnitte und Zusatzarbeit sind ab `freigegeben`
gegen INSERT/UPDATE/DELETE gesperrt (`gs_bericht_inhalt_wache`, inklusive des
Falls „Abschnitt in einen anderen Bericht verschieben"), und
`gs_bericht_ereignis` weist UPDATE und DELETE grundsaetzlich ab
(`gs_bericht_ereignis_wache`).

**Warum in der Datenbank und nicht im Endpunkt.** Weil der Endpunkt mit dem
`service_role`-Key arbeitet (1.2) und RLS damit wirkungslos ist. Ein Trigger ist
die einzige Stelle, die auch dann greift — er ist unabhaengig davon, ob jemand
eine Pruefung aufruft. Die zwei Luecken in 1.4 sind der Beweis, dass „ein
Endpunkt ruft die Wache schon auf" keine tragfaehige Annahme ist.

**Uebersetzungen sind bewusst NICHT eingefroren.** Sie sind Beilage, nicht der
verbindliche Text; eine Uebersetzung darf auch nach dem Versand noch entstehen,
ohne den deutschen Nachweis anzutasten.

### E-03 · Der Nummernkreis ist lueckenlos, weil er in derselben Transaktion zieht

Verfahren wie `gs_rapport_nr_next` (2.1) — dasselbe `on conflict do update …
returning`, dieselbe Zeilensperre, dasselbe `security definer` +
`set search_path`.

Zwei Unterschiede, beide begruendet:

1. **Schluessel ist der Partner, nicht das Kundenkuerzel** und **ohne
   Jahresschnitt** — „durchgehend pro Partnerbetrieb" heisst genau das. Beim
   Rapport ist der PK `(kuerzel, jahr)`, zwei Techniker desselben Betriebs auf
   zwei Kunden laufen dort in zwei Kreise (2.2).
2. **Gezogen wird im Trigger, nicht im Anwendungscode.** Beim Rapport zieht der
   Code beim Anlegen, und eine verlorene Nummer verfaellt ausdruecklich
   (`api/cockpit.js:2736-2739`). Hier zieht der Trigger im Uebergang nach
   `freigegeben` — also in **derselben Transaktion** wie der Zustandswechsel.
   Scheitert die Freigabe, rollt der Zaehler mit zurueck.

**Deshalb ist der Zaehler eine Tabellenzeile und keine Sequence.** Eine Sequence
rollt nicht zurueck; sie ist rennsicher, aber prinzipiell lueckenbehaftet. Der
Preis der Tabellenzeile: Freigaben desselben Betriebs serialisieren. Fuer einen
Vorgang, den ein Mensch ausloest, ist das kein Preis.

Der zweite Grund fuer Lueckenfreiheit ist das Loeschverbot aus E-02: eine
geloeschte freigegebene Zeile waere eine Luecke, die kein Zaehler heilen kann.

Format `B-000001`, je Partner eindeutig. Ob ein Betriebskuerzel ins Format soll —
offen, `annahmen.md` L-12.

### E-04 · Der Hash wird in der Datenbank berechnet, nicht geliefert

Beim Uebergang nach `freigegeben` bildet der Trigger

```
string_agg(sortierung || 0x1f || text_snapshot, 0x1e order by sortierung, id)
```

und legt `encode(sha256(convert_to(…,'UTF8')),'hex')` in `inhalt_hash` ab.

**Warum nicht vom Server.** Ein vom Server gelieferter Hash beweist nur, dass der
Server rechnen kann. Der in der DB gebildete Hash beweist, dass der freigegebene
Text der ist, der in der DB steht — und ab diesem Moment sperrt E-02 jede
Aenderung an den Abschnitten. Damit ist die Kette geschlossen: Text eingefroren,
Hash darueber, Hash selbst eingefroren.

**Zusatzregel:** Freigabe ohne Abschnitte wird abgewiesen. Ein leerer Nachweis
ist keiner. Ebenso Freigabe ohne `freigegeben_von` und Versand ohne
`versendet_von` — im Gegensatz zu `von: userId || null`
(`lib/wochenbericht.js:2101`).

### E-05 · Der Snapshot kopiert alles, was angezeigt wird

`gs_bericht_abschnitte.text_snapshot TEXT NOT NULL` — woertlich das Muster aus
`scripts/taetigkeiten_katalog.sql:161,176`, ebenso `on delete set null` auf den
Katalog und `on delete cascade` auf den Kopf (3.3).

Zwei bewusste Abweichungen, beide aus 3.4 hergeleitet:

1. **Nicht nur der Text wird kopiert**, sondern auch Titel, Kategorie, Gewerk,
   Slug und Reihenfolge. Der Bestand kopiert nur die Bezeichnung und joint fuer
   `detailfelder` weiter auf den lebenden Katalog (`api/cockpit.js:2953,2957`) —
   dadurch wirkt eine Katalogaenderung dort **doch** rueckwirkend. Wenn nichts
   mehr gejoint werden muss, kann auch nichts mehr zurueckwirken.
2. **Der Server fuellt den Snapshot, nicht der Client.** Heute schickt der Client
   den Text (`app.html:11841` → `api/cockpit.js:2980`). Kuenftig schickt er nur
   die `baustein_id`, und der Server liest den Text zum Speicherzeitpunkt aus
   `gs_bericht_bausteine`. Das ist eine Anforderung an M3, hier festgehalten und
   im Testplan als T-K5 geprueft.

`herkunft` (`baustein | diktat | frei`) trennt, wie ein Abschnitt entstanden ist.
Fuer die Beweisfuehrung ist ein diktierter Absatz etwas anderes als ein
angetippter Baustein.

### E-06 · Zusatzarbeit: Felder ja, Pflicht nein

`gs_bericht_zusatzarbeit` mit `typ='regie'` als einzigem erlaubten Wert. Alle
fachlichen Felder — `angeordnet_von`, `angeordnet_am`, `angeordnet_wie`,
`stunden`, `ansatz`, `beleg_pfad` — sind **nullable**, weil die Pflichtfeldlogik
auf fachjuristische Rueckmeldung wartet (`annahmen.md` L-14..L-18).

Die Richtung ist wichtig: NOT NULL laesst sich spaeter **additiv** nachtragen.
Umgekehrt geht es nicht — ein zu frueh gesetztes NOT NULL wirft beim Nachtrag
echte Zeilen raus.

### E-07 · `extern_system` / `extern_id` getrennt, Idempotenz mit Mandant

Auf `gs_projekte`, `gs_kunden`, `gs_tagesrapporte` und `gs_berichte` je fuenf
Spalten: `extern_system`, `extern_id`, `extern_export_am`,
`extern_export_status` (`offen|gesendet|bestaetigt|fehler`),
`extern_export_fehler`.

**Getrennt, nicht zusammengesetzt.** Ein Feld `"SYS:12345"` laesst sich nicht
indizieren, nicht filtern und nicht migrieren, wenn ein zweites System dazukommt.

**Der Idempotenzschluessel ist (Mandant, System, externe ID)** — nicht die
externe ID allein, die ist nur innerhalb eines Betriebs eindeutig. Genau so steht
es schon einmal im Repo: `scripts/service_hub_ENTWURF.sql:241-246`.

**Eine offene Stelle, bewusst so belassen:** `gs_tagesrapporte` hat keine
Mandantenspalte (1.4). Der Schluessel ist dort `(extern_system, extern_id)` ohne
Mandant — korrekt, solange nur ein Verrechnungsprogramm angebunden wird,
kollidierend, sobald zwei Betriebe dasselbe Fremdsystem mit eigenen ID-Raeumen
nutzen. Zwei Auswege, beide offen: `annahmen.md` L-21.

**Warum jetzt.** Kommt 2027 die Anbindung, ist die teuerste Frage nicht „wie
rufen wir deren API", sondern „welche Zeile bei uns ist welche bei denen, und
haben wir sie schon geschickt". Wer die Felder erst dann anlegt, muss den
gesamten Bestand nachtraeglich zuordnen. Jetzt kosten sie zwei Spalten und einen
Index.

### E-08 · RLS wird gesetzt, aber nicht als Durchsetzung verkauft

Alle neun Tabellen bekommen `enable row level security`, eine
`service_all`-Policy und — anders als `gs_wochenberichte`
(`scripts/wochenbericht.sql:180-192`, nur service + admin) — **zusaetzlich eine
Partner-Policy**. Wenn der Bericht ein Nachweis sein soll, muss die Datenbank
sagen koennen, wem er gehoert.

Was RLS hier leistet: den Riegel gegen Direktzugriff aus dem Browser mit dem
anon-Key, und die dokumentierte Absicht. Was es **nicht** leistet: Schutz im
Serverpfad (1.2). Die Durchsetzung machen die Trigger.

---

## 6 Was M1 nicht loest

Drei Dinge, die vor M4 auf dem Tisch liegen muessen. Sie sind nicht Teil dieses
Modells, aber sie entwerten es, wenn sie offen bleiben:

1. **`api/tagesrapport.js:109-125`** — jeder Techniker kann in ein fremdes
   Projekt buchen. `gs_berichte` waere sonst ein sauber gesicherter Tresor auf
   einem Fundament, in das jeder hineinschreiben kann. (`annahmen.md` L-24)
2. **`api/gs.js:39-47`** — unauthentifizierter Schreibzugriff mit dem
   `service_role`-Key. Solange das existiert, ist der Satz „nur berechtigte
   Nutzer schreiben in diese Datenbank" nicht haltbar. (L-25)
3. **Master-Identitaet als Quelltextkonstante** (`api/cockpit.js:32`) — ein
   zweiter Betrieb ist strukturell nicht darstellbar. Der Berichtsmodus setzt
   Mandantenfaehigkeit voraus. (L-26)

Ausserdem offen und in `annahmen.md` gefuehrt: die Offline-Reihenfolge aus 3.2
(L-08 bis L-11) und die gesamte rechtliche Klaerung zur Regiearbeit
(L-14 bis L-18).

---

## 7 Reihenfolge

1. `docs/m1/annahmen.md` beantworten — insbesondere L-01, L-12, L-21 und den
   rechtlichen Block L-14..L-18.
2. Erst dann `scripts/berichtsmodus_m1.sql` von Hand im Supabase-SQL-Editor.
3. Danach `scripts/test_berichtsmodus.mjs` nach `docs/m1/testplan.md`, fuenfmal
   hintereinander gruen.
4. Erst danach M2 (Bausteintexte von Emanuel).
