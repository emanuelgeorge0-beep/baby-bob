# Material-Soll L2 — das Datenmodell der drei Ebenen

Papierrunde. Kein Code, keine ausgefuehrte Migration. Das Modell steht in
`scripts/material_soll_l2.sql`, diese Datei begruendet es.

Reihenfolge: erst was heute da ist, dann das Modell, dann die Begruendung der
vier Entscheidungen, die man spaeter nicht mehr billig umbauen kann.

---

## 1 Bestandsaufnahme — worauf das Modell aufsetzt

Rein lesend erhoben. Jede Aussage mit Datei und Zeile.

### 1.1 Projekt

`gs_projekte` ist die Klammer fuer alles.

| Was | Wo |
|---|---|
| Tabelle angelegt | `scripts/rapport_system_migration.sql:21-33` |
| Besitz eines Projekts | `partner_user_id uuid → auth.users` — `scripts/rapport_system_migration.sql:26` |
| Land und Waehrung | `land` Default `'CH'`, `waehrung` Default `'CHF'` — `scripts/master_cockpit_migration.sql:25-26` |
| Soft-Delete | `geloescht_at` — `scripts/runde8a.sql:16` |
| Freies SHK/HKLS-Datenblatt | `datenblatt jsonb` — `scripts/projekt_datenblatt.sql:29-30`, enthaelt bereits `materialstellung` (`wir` / `auftraggeber` / `teils`) |

### 1.2 Bauabschnitt

Es gibt **zwei verschiedene Dinge mit diesem Wort**, und beide sind nicht das,
was eine Materialzone braucht.

- `gs_bauabschnitte` — `scripts/zahlungssystem_migration.sql:8-24`. Das ist die
  **Zahlungsseite**: `gesamtbetrag`, `split_profil`, `status` aus
  `geplant | angezahlt | aktiv | zwischenfreigabe | abgeschlossen | nachtrag`.
  Sie kennt zwar `einheit_typ in ('zone','giessrahmen','verteiler','bad_wc',
  'meilenstein','pauschal')` — also genau unsere Begriffe — fuehrt aber keine
  einzige geometrische Angabe. Daran haengen `gs_steps`
  (`scripts/zahlungssystem_migration.sql:26-39`) und `gs_escrow` (`:44`).
- Das Wort **„Bauabschnitt" im baulichen Sinn kommt im Repo nicht vor.**
  `grep -ri bauabschnitt` trifft ausschliesslich die Zahlungstabelle.

### 1.3 Zone

**Zone ist heute kein Objekt, sondern ein Textfeld.** Zwei Stellen:

- `gs_gw_step.zone TEXT` — `scripts/gewerke_step_framework.sql:42`, im Kommentar
  als „Phasen-/Zonen-Gruppierung (optional)" bezeichnet. Der Demo-Seed fuellt sie
  mit Werten wie `'Rohinstallation'` und `'Dichtheit'`
  (`scripts/demo_geiger_seed.sql:77-81`) — also mit Phasen, nicht mit Strangzonen.
- `gs_blockaden.zone TEXT` — `scripts/blockaden_migration.sql:26`, dort neben
  `haus`, `einheit`, `step_ref` bewusst als freie Referenz gefuehrt.

Die bauliche Hierarchie selbst ist sauber vorhanden:
Projekt → Haus → Einheit → Step, `scripts/gewerke_step_framework.sql:12-20`
(`gs_gw_haus`), `:23-30` (`gs_gw_einheit`), `:35-61` (`gs_gw_step`).
Daneben gibt es `gs_projekt_stockwerk` (`scripts/schema_rollen_foto_service.sql:172-181`)
mit `UNIQUE (projekt_id, name)` — Stockwerke fuer die Medien-Gruppierung, ohne
Bezug zu Haus oder Einheit.

**Folge fuers Modell:** ein Freitextfeld kann keine Eingaben tragen, an denen
eine Regel rechnet. Geschosse, Wohnungen je Geschoss, Geschosshoehe, die letzte
Entnahmestelle der Zirkulation — das braucht ein Objekt. Deshalb `gs_mat_zone`.

### 1.4 Material heute

`gs_material` existiert in zwei Fassungen, die additiv uebereinanderliegen:

- erste Fassung — `scripts/master_cockpit_migration.sql:37-49`:
  `projekt_id, bezeichnung, menge, einheit, einzelpreis, gesamt, lieferant, datum`.
  `gesamt` ist eine berechnete Spalte: `GENERATED ALWAYS AS (menge * einzelpreis) STORED` (`:44`).
- zweite Fassung — `scripts/master_cockpit_session6_pm.sql:98-112`: ergaenzt
  `kategorie` und `status` mit dem Kommentar
  `-- offen | bestellt | geliefert | verbaut` (`:105`).

Wichtig: **dieser Status hat keinen `check`-Constraint.** Der Handler schreibt,
was ankommt — `String(b.status).slice(0, 40)`, `api/cockpit.js:3976`.
RLS auf `gs_material` ist `master_only` (`scripts/master_cockpit_session6_pm.sql:115-127`);
Partner erreichen die Tabelle nur ueber die API mit dem Service-Key.

Zwei weitere Stellen, an denen heute „Material" steht:
- `gs_rapport_positionen.material text[]` — `scripts/rapport_positionen_migration.sql:21`.
  Freitext-Array im Tagesrapport, ohne Artikelbezug.
- `gs_einkauf` — `scripts/master_cockpit_migration.sql:94-105`, mit
  `status in ('bestellt','geliefert','bezahlt')`. Das ist die Beschaffungs-, nicht
  die Bauseite.

### 1.5 Katalogstrukturen — das Muster

`gs_taetigkeitenkatalog` ist der vorhandene Katalog und der Bauplan fuer den
Artikelkatalog. `scripts/taetigkeiten_katalog.sql:96-107`:

- `slug` — „stabil, nie aendern" (`:100`), `bezeichnung` — „frei aenderbar" (`:101`)
- `detailfelder jsonb` mit `{"felder":["DN","M","ORT"]}` (`:103`) — die Idee,
  Dimensionen als benannte Felder zu fuehren, ist im Repo also schon da, nur
  als loses JSON
- `aktiv boolean` — „deaktivieren statt loeschen" (`:106`)
- `UNIQUE (gewerk, slug)` guarded angelegt (`:145-148`)

Und, entscheidend, der **Snapshot**: `gs_tagesrapport_taetigkeitenkatalog`
(`scripts/taetigkeiten_katalog.sql:154-165`) mit
`bezeichnung_snapshot TEXT NOT NULL` und dem Kommentar (`:154-156`):

> Katalogaenderungen duerfen bereits erfasste Rapporte nie rueckwirkend
> veraendern — Anzeige liest immer den Snapshot.

Dazu `gs_katalog_entscheidung` (`scripts/rapportnummer.sql:202-215`): ein
Protokoll jedes Anlagevorgangs, das die damals angezeigten Vorschlaege als
`jsonb`-Snapshot festhaelt — ausdruecklich „nicht als Verweis: die Auswertung
will wissen, was in DEM Moment vorgeschlagen wurde" (`:197-198`). Beide Fremd-
schluessel dort sind `ON DELETE SET NULL` (`:204`, `:208`), damit das Protokoll
eine spaetere Katalogbereinigung ueberlebt.

### 1.6 Mandantentrennung — wie sie heute durchgesetzt wird

Vier Schichten, in dieser Reihenfolge:

1. **Rolle** — `resolveAccess`, `api/cockpit.js:134-190`. Effektive Rollen aus
   `user_roles` ∪ `user_extra_roles`. Master nur fuer die feste
   `MASTER_UID` (`api/cockpit.js:32`). Techniker erreichen ausschliesslich
   Actions aus `TECHNIKER_ACTIONS` (`:170`), sonst 403.
2. **Freischaltung** — `PM_ACTIONS` (`api/cockpit.js:76-95`) hinter dem
   Entitlement `projektmanagement`, Sonderfeatures ueber
   `PARTNER_FEATURE_ACTIONS` (`:100`). Die Schluessel liegen in
   `lib/entitlements.js:10-31`; darunter sind **`material` („Materialverwaltung",
   `:16`), `material_order` („Materialbestellung", `:17`) und
   `bob_assist_material` („Bob im Material", `:29`) bereits vergeben.**
   `getEnabledFeatures` ist fail-open, wenn die Tabelle fehlt (`:38-56`).
3. **Zeilenbesitz** — `requireOwnedProjekt` (`api/cockpit.js:196-203`) prueft
   `gs_projekte.partner_user_id === scope.partnerId`, sonst `Forbidden`.
   `requireOwnedRow(table, id, scope)` (`:208-215`) loest ueber die `projekt_id`
   der Zeile auf dasselbe auf. Genau so laufen die Material-Handler:
   `addMaterial` (`:3968-3969`), `updMaterial` (`:3995-3996`),
   `pm_material_del` ueber `delPmRow` (`:301`, `:4009-4010`).
4. **RLS** — zweite Verteidigungslinie, der Service-Key umgeht sie. Muster in
   `scripts/gewerke_step_framework.sql:64-111`: `service_all` + `admin_all` +
   je eine Partner- und Techniker-Policy.

**Es gibt keine Partner-Tabelle.** Ein Partner ist ausschliesslich eine
`auth.users`-ID. `scripts/branding_tabelle.sql:19-22` sagt das ausdruecklich und
zieht die Konsequenz: `gs_branding.partner_id uuid` **ohne Fremdschluessel**,
`NULL` = Standard fuer alle, gesetzt = dieser Partner hat Vorrang (`:24-27`).
Die Eindeutigkeit laeuft ueber zwei Teilindizes, „weil NULL in einem
UNIQUE-Index nicht mit NULL kollidiert" (`:41-45`).

### 1.7 Sperren im Ablauf — das Muster

`validateStatusChange` in `api/gewerke.js:93-107`: eine reine, testbare Funktion,
die `{ok, error}` zurueckgibt. Zwei Tore — Pflicht-Vorgaenger (`:95-101`) und
Foto-Gate (`:103-105`) — und beide liefern **den Grund im Klartext mit**:

> `Pflicht-Vorgaenger "…" (Schritt n) muss zuerst abgeschlossen sein.`

Das ist genau die Form, die Ebene C braucht: blockieren und begruenden in einem.
Fuer die schwerere Stoerung existiert daneben `gs_blockaden`
(`scripts/blockaden_migration.sql:18-60`) mit `urgency LOW|MEDIUM|HIGH|CRITICAL`
und `status offen|in_bearbeitung|freigegeben|eskaliert`.

### 1.8 Region

`lib/regions.js:5-9` fuehrt fuenf Maerkte: CH, AT, DE, ES, GB, je mit `locale`,
`currency` (CHF / EUR / GBP) und `phonePrefix`. Am Projekt haengen `land` und
`waehrung` (`scripts/master_cockpit_migration.sql:25-26`). Region ist im Repo
also bereits ein gefuehrter Parameter, keine Annahme.

### 1.9 Was aus der Aufgabenstellung im Bestand nicht existiert

Drei Punkte, damit sie nicht als stillschweigende Voraussetzung mitlaufen:

- **`gs_berichte` und `gs_bericht_abschnitte` gibt es nicht.** `grep` ueber
  `*.sql`, `*.js`, `*.html`, `*.md`: null Treffer. Gemeint ist mit hoher
  Wahrscheinlichkeit `gs_branding` fuer das `partner_id`-Muster (dort steht es
  woertlich, `scripts/branding_tabelle.sql:19-27, 41-45`) und
  `gs_tagesrapport_taetigkeitenkatalog` fuer das Snapshot-Muster
  (`scripts/taetigkeiten_katalog.sql:154-156`). Beide Muster sind uebernommen.
  Was tatsaechlich existiert, heisst `gs_wochenberichte`.
- **`api/cockpit.js:5124` traegt kein `scope.isMaster`.** Die Zeile steht mitten
  in `svc_update` (Service-Auftrag). `scope.isMaster` kommt in der Datei an
  `:5695`, `:5959` und `:6298` vor. Angefasst wurde in dieser Runde ohnehin keine
  Zeile Code.
- **`gs_projekt_techniker` fuehrt zwei Zuweisungsspalten nebeneinander**:
  `techniker_user_id → auth.users` (`scripts/rapport_system_migration.sql:38`)
  und `techniker_id → gs_techniker` (`scripts/master_cockpit_session6_pm.sql:21`,
  mit `techniker_user_id` daneben als „Legacy"). Deshalb traegt das neue Modell
  **keine** Techniker-RLS-Policy — siehe 4.4.

---

## 2 Das Modell

Zehn neue Tabellen, alle mit Praefix `gs_mat_`. Nichts Bestehendes wird
geaendert.

```
gs_projekte ──┬── gs_mat_zone ────────── gs_mat_regel_lauf ─── gs_mat_regel
              │        │                        │                  (Ebene B)
              │        └────────┬───────────────┘
              │                 ▼
              └────────── gs_mat_position ─────── gs_mat_befund ── gs_mat_fachregel
                                 │                                    (Ebene C)
                                 ▼
                          gs_mat_artikel ──┬── gs_mat_preis
                              (Ebene A)    ├── gs_mat_zulassung
                                           └── gs_mat_set_pos
```

### Ebene A — Artikel: was es gibt

| Tabelle | Traegt |
|---|---|
| `gs_mat_artikel` | `slug` (stabil) / `bezeichnung` (frei), `werkstoff`, **`dn int`** und **`zoll text`** getrennt, **`presskontur`** als eigenes Feld, `einheit`, `ist_set`, `aktiv`, `partner_id` |
| `gs_mat_preis` | je Lieferant und Land: **`preis_einzel`** und **`preis_vpe`** nebeneinander, dazu `vpe_menge`, `waehrung`, `gueltig_ab/bis`, `quelle` |
| `gs_mat_zulassung` | `kuerzel` (DVGW / SVGW), `land`, `status`, `gueltig_bis` |
| `gs_mat_set_pos` | Stueckliste eines Sets: Set-Artikel → Bestandteil-Artikel + Menge |

Vier Punkte, die nicht Geschmackssache sind:

- **DN und Zoll sind zwei Felder.** `dn` ist eine Zahl und damit sortier- und
  vergleichbar (`dn >= 50`), `zoll` bleibt Text, weil Bruchschreibweise. Ein
  Artikel darf beide tragen, eines von beiden oder keines.
- **Presskontur ist ein Attribut, nicht Teil der Bezeichnung.** Nur so kann
  Ebene C ueberhaupt pruefen, ob in einer Zone M und V gemischt werden.
- **Verbindungsart steht bewusst NICHT hier**, sondern auf der Position.
  Schweissmuffe oder Pressverbindung ist eine Entscheidung an der Leitung, nicht
  eine Eigenschaft des Katalogeintrags.
- **Preis ist eine eigene Tabelle, nicht zwei Spalten.** Derselbe Artikel kommt
  bei mehreren Lieferanten, in mehreren Laendern und mit Preisstaenden vor. Das
  ist der Fall, den die Anforderung selbst benennt: die Struktur ist
  uebertragbar, die deutschen Daten sind es nicht — fuer die Schweiz braucht es
  SVGW und CHF. Bei zwei Preisspalten am Artikel muesste der Katalog fuer jedes
  Land dupliziert werden, und die Fachregeln wuerden zweimal gepflegt.

Kein `check` auf `werkstoff` und `presskontur`: genannt sind C-Stahl, Edelstahl,
M und V. Ob das vollstaendig ist, weiss niemand. Ein `check` mit genau diesen
Werten wuerde beim Katalogimport (L3) fachlich richtige Zeilen verwerfen.

### Zone — `gs_mat_zone`

Traeger der Regel-Eingaben. `projekt_id` ist die harte Klammer (Muster
`gs_blockaden`), `haus_id` / `einheit_id` sind weiche Verweise, weil das
Gewerke-Step-Framework nicht in jedem Projekt angelegt ist. `bauabschnitt_id`
verweist optional auf die Zahlungsseite, ohne sie vorauszusetzen.

`medium` ist gebunden auf `kaltwasser | warmwasser | zirkulation | abwasser |
heizung`. `region` steht als eigenes Feld mit Default `'CH'` — Region ist ein
Parameter, keine Annahme. `variante` traegt beim Abwasser A, B oder C.
`eingaben jsonb` haelt Geschosse, Wohnungen je Geschoss, Geschosshoehe und die
letzte Entnahmestelle der Zirkulation.

### Die Position — `gs_mat_position`

Die zentrale Entscheidung. Jede Position traegt **beide** Mengen:

| Feld | Bedeutung |
|---|---|
| `menge_vorschlag` | gerechnet oder aus Plan |
| `menge_erfasst` | was der Techniker eintraegt |
| `menge_gueltig` | **berechnet**: `coalesce(menge_erfasst, menge_vorschlag)` |
| `abweichung` | **berechnet**: `menge_erfasst - menge_vorschlag`, `NULL` solange eine fehlt |
| `herkunft` | `gerechnet` \| `erfasst` \| `plan` |
| `regel_id`, `regel_lauf_id`, `regel_slug_snapshot` | woher der Vorschlag stammt |
| `geaendert_von`, `geaendert_at` | wer zuletzt geaendert hat |

`menge_gueltig` und `abweichung` sind **berechnete Spalten** (`generated always
as … stored`), nicht Anwendungslogik. Das Muster gibt es im Haus schon:
`gs_material.gesamt` (`scripts/master_cockpit_migration.sql:44`). Der Grund ist
nicht Bequemlichkeit — es sorgt dafuer, dass **keine Anzeige und keine Auswertung
die Vorrangregel neu erfinden kann.** Was der Techniker eintraegt, gewinnt, und
zwar an genau einer Stelle festgeschrieben.

`herkunft` ist bewusst getrennt von der Frage, welche Spalte gefuellt ist. Das
spaetere Planlesen fuellt **dieselbe** `menge_vorschlag`-Spalte, die heute die
Kennzahl fuellt, und setzt `herkunft = 'plan'`. Das Modell muss sich dafuer nicht
mehr aendern — das ist die Anforderung, und sie ist der Grund, warum
`menge_vorschlag` neutral heisst und nicht `menge_gerechnet`.

### Ebene B — Kennzahlregeln als Daten

`gs_mat_regel` haelt drei `jsonb`-Listen:

- `eingaben` — was die Zone liefern muss: `{key, label, typ, pflicht, standard?}`
- `parameter` — die Stellschrauben: `{key, label, standard, min?, max?, quelle}`.
  **`quelle` ist Pflicht** und traegt `praxis | hersteller | offen`.
- `positionen` — was erzeugt wird:
  `{key, artikel_slug, einheit, ausdruck, bedingung?, notiz?}`

`region` und `variante` sind Auswahlparameter auf der Regel selbst: `region NULL`
heisst „gilt ueberall", ein gesetzter Wert bindet die Regel an einen Markt. Die
Giessrahmen-Regel traegt deshalb `region = 'CH'` und `variante = 'B'`.

`gs_mat_regel_lauf` protokolliert jeden Durchlauf mit den tatsaechlichen
Eingaben, den tatsaechlich benutzten Parameterwerten und dem Ergebnis als
Snapshot — Muster `gs_katalog_entscheidung`. Ohne dieses Protokoll ist die
Abweichung spaeter nicht auswertbar: man saehe zwar, dass 12 statt 14 verbaut
wurden, aber nicht, mit welchem Schellenabstand die 14 entstanden sind.

Durchgerechnet in `regelbeispiele.md`.

### Ebene C — Fachregeln als eigene Wissensebene

`gs_mat_fachregel`: `typ` (`werkstoff_medium | presskontur | verbindungsart |
zulassung`), `bedingung jsonb`, `schwere` (`sperre | warnung`),
**`begruendung text not null`** und `quelle` (`praxis | hersteller | offen`).

`begruendung` ist `not null`, weil Felix nicht nur blockieren, sondern die
Begruendung mitliefern soll. Eine Regel ohne Satz waere eine Sperre ohne Grund.

`quelle` trennt, woher eine Aussage stammt, und ein `check` erzwingt es:
`quelle = 'hersteller'` verlangt eine ausgefuellte `quelle_ref`. Praxiswissen
braucht keine Referenz — es ist als Praxiswissen gekennzeichnet und damit
nachvollziehbar. Ein Normverweis wird gar nicht erst angeboten, solange keine
Quelle vorliegt.

`gs_mat_befund` haelt jede Verletzung als Zeile fest, mit
`begruendung_snapshot` — dem Text, den der Nutzer **damals** gesehen hat.

**Wie eine verletzte Regel im Ablauf erscheint:**

| Schwere | Schreibvorgang | Befund | Uebersteuerbar |
|---|---|---|---|
| `sperre` | wird abgelehnt, mit `begruendung` im Klartext (Form wie `api/gewerke.js:93-107`) | wird trotzdem geschrieben, `status = 'offen'` | nein — per `check` verboten |
| `warnung` | geht durch | `status = 'offen'`, bis behoben oder uebersteuert | ja, nur mit `uebersteuert_grund` |

Beides zugleich gibt es also: **auch eine Sperre hinterlaesst einen Befund.**
Sonst waere spaeter nicht sichtbar, wie oft jemand gegen dieselbe Wand gelaufen
ist — und genau das ist die Zahl, die zeigt, ob eine Regel richtig sitzt oder
den Betrieb nur aufhaelt.

Dieselbe Sachlage kann in einem Medium sperren und in einem anderen unauffaellig
sein. Das wird ueber **zwei Regelzeilen mit unterschiedlicher `bedingung`**
geloest, nicht ueber eine dritte Schwere. Der C-Stahl-Fall ist genau das: eine
Zeile fuer `{werkstoff: c_stahl, medium: trinkwasser}` mit `schwere = sperre` —
und fuer den Heizkreis gar keine Zeile, weil dort nichts zu sperren ist. Der
Grund steht im Begruendungstext derselben Regel:

> C-Stahl ist fuer Trinkwasser nicht zugelassen, weil er korrodiert. Im
> geschlossenen Heizkreis ist das unkritisch, weil dort kein staendiger Wasser-
> und Sauerstoffnachschub ankommt — dort darf C-Stahl bleiben. Fuer Trinkwasser
> ist Edelstahl der Weg.

Edelstahl bekommt aus demselben Grund **keine eigene Regel**: er ist fuer beide
Medien zugelassen, es gibt nichts zu sperren und nichts zu warnen. Dass er bei
Heizung die hochwertigere Variante ist und ueblich bei Kaelte, Spitaelern und
ueberall, wo Langlebigkeit vor Materialkosten geht, gehoert in Felix' Antwort —
nicht in eine Regelzeile, die nie greift.

---

## 3 Zustandskette — Pruefung und Korrekturvorschlag

Vorgabe: `geplant → bestellt → geliefert → verbaut`.

**Die Kette passt zum Vokabular des Bestands, aber nicht zur Mengenwelt.**
Drei Befunde, dann der Vorschlag.

### Befund 1 — das Vokabular weicht um ein Wort ab

`gs_material` fuehrt heute `offen | bestellt | geliefert | verbaut`
(`scripts/master_cockpit_session6_pm.sql:105`, Default `'offen'`, ohne
`check`-Constraint). Der Unterschied ist `offen` statt `geplant`.

*Korrektur:* `gs_mat_position` benutzt `geplant`, wie vorgegeben, **mit** einem
`check`-Constraint — der bei `gs_material` fehlt, weshalb dort heute jeder
beliebige String bis 40 Zeichen landen kann (`api/cockpit.js:3976`).
`gs_material` bleibt unveraendert; die Zuordnung `offen → geplant` ist
dokumentiert und wird bei einer spaeteren Uebernahme einmal angewandt.
Keine zwei Vokabulare in einer Tabelle.

### Befund 2 — ein Status kann keine Teilmenge

„Bestellt" ist keine Eigenschaft der Position, sondern eines Teils ihrer Menge.
Bei 21 m Rohr sind 15 m geliefert und 6 m stehen aus. Mit einer einzigen
Statusspalte muss man luegen: entweder ist die ganze Position „bestellt", obwohl
zwei Drittel schon liegen, oder „geliefert", obwohl ein Drittel fehlt. Genau
dieser Fall ist der haeufige — die Steigzone wird gestaffelt geliefert.

*Korrektur:* drei Mengenfelder neben dem Status —
`menge_bestellt`, `menge_geliefert`, `menge_verbaut`. Der Status bleibt als grobe
Anzeige erhalten (er ist die Vorgabe und die Anzeige braucht ihn), aber die
Wahrheit steht in den Mengen. Regel: der Status ist der weiteste Zustand, den
eine Menge groesser null erreicht hat.

### Befund 3 — `verbaut` gehoert zwei Welten an

`bestellt` und `geliefert` sind Beschaffung — dafuer gibt es bereits `gs_einkauf`
mit `status in ('bestellt','geliefert','bezahlt')`
(`scripts/master_cockpit_migration.sql:103`). `verbaut` ist Bau — dafuer gibt es
`gs_gw_step.status in ('offen','in_arbeit','abgeschlossen','blockiert')`
(`scripts/gewerke_step_framework.sql:45-46`).

Die Verbindung zwischen beiden Welten ist heute `gs_gw_step.material_ref uuid`
(`scripts/gewerke_step_framework.sql:49`) — **eine einzelne uuid.** Eine
Steigzone erzeugt aber acht bis zehn Positionen. Ein Step kann sie mit einem
Feld nicht halten.

*Korrektur:* der Verweis laeuft **von der Position zum Step**, nicht umgekehrt:
`gs_mat_position.step_id → gs_gw_step(id) on delete set null`. Viele Positionen
je Step, wie es der Sache entspricht. `gs_gw_step.material_ref` bleibt
unangetastet — Regel 4, nur erweitern.

### Ergebnis

Die vorgegebene Kette wird uebernommen und um die Mengenebene ergaenzt.
Kein bestehender Status wird umbenannt oder migriert.

---

## 4 Vier Entscheidungen, die spaeter teuer waeren

### 4.1 Snapshot statt Verweis — warum der Bezeichnungs-Snapshot nicht reicht

`gs_tagesrapport_taetigkeitenkatalog` friert genau ein Feld ein:
`bezeichnung_snapshot` (`scripts/taetigkeiten_katalog.sql:161`). Das genuegt dort,
weil ein Rapporteintrag nur gelesen wird.

Eine Materialposition wird **bestellt und bezahlt**. Aendert der Grosshaendler
im Januar den Preis und wird im Maerz die Rechnung eines im Dezember
abgeschlossenen Projekts geprueft, muss der Dezemberpreis dastehen. Aendert
jemand am Katalogartikel die Presskontur von M auf V, darf ein abgeschlossenes
Projekt nicht rueckwirkend eine andere Zone bekommen.

Deshalb drei eingefrorene Felder statt einem:
- `bezeichnung_snapshot text not null` — wie im Vorbild
- `artikel_snapshot jsonb` — `slug`, `dn`, `zoll`, `presskontur`, `werkstoff`,
  Zulassungen zum Zeitpunkt
- `preis_snapshot jsonb` — `preis_einzel`, `preis_vpe`, `vpe_menge`, `waehrung`,
  `lieferant`, `gueltig_ab`

Dazu `artikel_id … on delete set null`: die Position ueberlebt die
Katalogbereinigung und bleibt ueber den Snapshot vollstaendig lesbar. Genau die
Begruendung, die bei `gs_katalog_entscheidung` steht
(`scripts/rapportnummer.sql:202-208`).

### 4.2 Global und partnereigen nebeneinander

`partner_id uuid` **ohne Fremdschluessel**, `NULL` = global. Woertlich das
Muster aus `scripts/branding_tabelle.sql:19-27`, samt der dort gegebenen
Begruendung: eine Partner-Tabelle existiert nicht, und ein Fremdschluessel auf
`auth.users` waere ein Eingriff in den Auth-Bereich.

Eindeutigkeit ueber zwei Teilindizes, weil `NULL` in einem gewoehnlichen
`unique`-Index nicht mit `NULL` kollidiert (`branding_tabelle.sql:41-45`):

```
unique (slug)              where partner_id is null      -- der globale Katalog
unique (partner_id, slug)  where partner_id is not null  -- je Partner einer
```

Damit koennen ein globaler und ein partnereigener Eintrag denselben `slug`
tragen. **Aufloesung: der eigene gewinnt.** Ein Partner aendert den globalen
Katalog nie; er legt seinen eigenen Eintrag mit demselben `slug` an. Das gilt
gleichermassen fuer `gs_mat_artikel`, `gs_mat_regel` und `gs_mat_fachregel` —
ein Partner darf eine Kennzahl anders ansetzen als das Haus, aber er darf sie
niemandem sonst verstellen.

### 4.3 Regeln als Daten, nicht als Code

Der Grund ist nicht Eleganz. Die Kennzahlen sind das, was sich aendern **wird**:
der Schellenabstand ist heute 1,75 m und ist morgen nach zweihundert Projekten
1,85 m; die Giessrahmen-Praxis gilt fuer die Schweiz und nicht fuer Oesterreich.
Steht das im Code, ist jede Korrektur ein Deploy und ein Risiko, und die alten
Projekte rechnen rueckwirkend anders.

Als Daten mit `version` und einem Lauf-Protokoll gilt: die Regel wird geaendert,
`version` steigt, alte `gs_mat_regel_lauf`-Zeilen behalten ihre Version und
ihren Ergebnis-Snapshot. Der Vorschlag von damals bleibt erklaerbar.

Ein Parameter mit `standard: null` und `quelle: "offen"` **blockiert den Lauf
absichtlich**. Die Abwasserregel hat zwei davon (`schellenabstand_m`,
`ausdehnungsmuffe_m`). Sie laeuft nicht durch, bis die Werte da sind — das ist
die Alternative zum Erfinden einer Zahl, und sie macht die Luecke im Betrieb
sichtbar statt sie zu verstecken.

### 4.4 RLS ohne Techniker-Policy — bewusst

Die neuen Tabellen bekommen `service_all`, `admin_all`, eine Partner-Lesepolicy
fuer die Kataloge und eine Partner-Projektpolicy fuer die projektbezogenen
Tabellen. **Keine Techniker-Policy.**

Grund: `gs_projekt_techniker` fuehrt zwei Zuweisungsspalten nebeneinander —
`techniker_user_id → auth.users` (`scripts/rapport_system_migration.sql:38`) und
`techniker_id → gs_techniker` (`scripts/master_cockpit_session6_pm.sql:21`). Die
bestehenden Gewerke-Policies waehlen `techniker_user_id`
(`scripts/gewerke_step_framework.sql:80-95`), das PM waehlt `techniker_id`. Eine
neue Policy muesste sich fuer eine Seite entscheiden und wuerde damit eine
ungeklaerte Frage per Migration beantworten.

Der Techniker-Zugriff laeuft ohnehin ueber den Service-Key mit Pruefung im Code
(`resolveAccess`, `api/cockpit.js:170-179`). Die Policy kommt, wenn die Kette
entschieden ist — annahmen.md **L-16**.

---

## 5 Was diese Runde bewusst nicht entscheidet

- **Keine Artikeldaten.** `artikel_slug` ist in beiden Seed-Regeln durchgaengig
  `null`. Die Regeln erzeugen benannte Positionen ohne Artikelbezug, bis der
  Katalog (L3) vorliegt. Die DATANORM-Anfrage an den Grosshaendler ist offen.
- **Keine Ausdruckssprache im Detail.** Die `ausdruck`-Felder benutzen die vier
  Grundrechenarten, `ceil` und Klammern ueber die `key`s aus `eingaben` und
  `parameter`. Ob daraus ein eigener kleiner Auswerter wird oder etwas anderes,
  ist eine Bauentscheidung fuer L4, keine fachliche.
- **Kein Endpunkt, kein Frontend, kein SW-Cache.** `lib/entitlements.js:16-17`
  haelt die Schluessel `material` und `material_order` bereits bereit; sie werden
  nicht angefasst.
- **Keine Normverweise.** Wo eine Norm gemeint sein koennte, steht die offene
  Frage in `annahmen.md` — keine geratene Nummer.
