# Pruefauftrag: UNIQUE auf gs_tagesrapporte

**Datum:** 24.08.2026 · **Repo:** `baby-bob` · **Stand:** `main` @ `09e7cf0`,
Branch `feat/fotoverwaltung-tageszeile` @ `bfc9cd9` · **Datenbank:** PostgreSQL
via Supabase (PostgREST als Daten-API)

Diese Datei ist **eigenstaendig**. Sie setzt keine Kenntnis des Repos voraus.
Alle Zeilennummern beziehen sich auf den Stand `bfc9cd9`.

---

## 0. Auftrag an den Pruefer

Ein Betreiber hat die Anforderung gestellt:

> Eine Tageszeile soll ein eigenes Projekt tragen koennen. Mehrere Zeilen je
> Kalendertag auf verschiedenen Projekten muessen moeglich sein. Ein echtes
> Duplikat — gleiches Projekt, gleicher Techniker, gleicher Tag — muss
> weiterhin abgewiesen werden.

Er hat dazu die Diagnose vorgegeben, der bestehende Constraint
`UNIQUE(projekt_id, techniker_user_id, datum)` verhindere das und muesse per
Migration aufgeloest werden.

**Meine Gegenthese lautet: es ist keine Migration noetig.** Der Constraint
erfuellt die Anforderung bereits woertlich. Der tatsaechliche Mangel liegt in
der Oberflaeche und in fehlender Fehlerbehandlung.

Bitte pruefen Sie diese Gegenthese — mit besonderem Augenmerk auf das, was ich
uebersehen haben koennte. Die Schlussfrage steht in Abschnitt 8.

---

## 1. Zweck der Tabelle `gs_tagesrapporte`

Das System ist eine Projektverwaltung fuer einen Schweizer Sanitaer-/HKLS-
Betrieb. Vier Rollen greifen darauf zu: `master` (Betreiber, Vollzugriff),
`gs_admin`, `partner` (Auftraggeber, lesend auf eigene Projekte), `techniker`
(Monteur auf der Baustelle).

`gs_tagesrapporte` ist die **zentrale Leistungserfassung**. Eine Zeile ist
*eine Arbeitsleistung eines Technikers an einem Kalendertag auf genau einem
Ziel*. Das Ziel ist genau eines von dreien — erzwungen durch einen CHECK
(Abschnitt 2.3):

1. ein **Projekt** (`projekt_id`) — eine Baustelle,
2. ein **Serviceauftrag** (`service_auftrag_id`) — ein Einzelauftrag,
3. eine **Abwesenheit** (`abwesenheit`) — Ferien, Unfall, Militaer, Feiertag.

Aus dieser Tabelle speisen sich vier Dokumente und mehrere Ansichten:

| Erzeugnis | Bezug | Was daraus gelesen wird |
|---|---|---|
| **Wochenbericht** | Projekt x Kalenderwoche | geht an den Bauleiter des Kunden |
| **Stundenblatt / Wochenrapport** | Techniker x Kalenderwoche | unterschreibt der Techniker, legt die Buchhaltung ab |
| **Fotodokumentation** | Techniker x KW, ueber alle Projekte | Bilder je (Tag, Projekt) |
| **Rechnung** | je Rapport | `gs_rechnungen.rapport_id` |

Zwei Groessen haben **unterschiedliche Aggregationsregeln**, und das ist fuer
die Pruefung zentral:

- **Stunden** werden je Kalendertag **addiert** (zwei Baustellen am Montag
  = 2 h + 6 h = 8 h).
- **Spesen** fallen je Kalendertag **einmal** an, unabhaengig von der Zahl der
  Baustellen. Umgesetzt als *Maximum je Kalendertag*, nicht als Summe.

Die Spalte `spesen` haengt aber an der **Zeile**, nicht am Tag. Das ist eine
bekannte Modellierungsschwaeche, die an sechs Stellen im Lesepfad kompensiert
wird (Abschnitt 5, Befund B6).

---

## 2. Das heutige Schema

### 2.1 Basis-DDL

Quelle: `scripts/rapport_system_migration.sql:43-65`

```sql
CREATE TABLE IF NOT EXISTS gs_tagesrapporte (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  projekt_id        UUID REFERENCES gs_projekte(id) ON DELETE SET NULL,
  techniker_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  datum             DATE NOT NULL,
  zeit_von          TIME,
  zeit_bis          TIME,
  gesamtstunden     DECIMAL(4,1) DEFAULT 0,
  team              TEXT[] DEFAULT '{}',
  arbeiten          TEXT[] DEFAULT '{}',
  material          TEXT[] DEFAULT '{}',
  besonderheiten    TEXT,
  foto_urls         TEXT[] DEFAULT '{}',
  unterschrift_url  TEXT,
  pdf_url           TEXT,
  empfaenger        TEXT[] DEFAULT '{}',
  status            TEXT DEFAULT 'entwurf',   -- entwurf | eingereicht
  woche             INT,
  jahr              INT,
  eingereicht_am    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(projekt_id, techniker_user_id, datum)
);
```

### 2.2 Spaeter ergaenzte Spalten

Alle rein additiv per `ADD COLUMN IF NOT EXISTS`:

| Spalte | Typ | Quelle |
|---|---|---|
| `abrechnung_status` | `TEXT DEFAULT 'offen'` | `projekt_detail_scharf.sql:32` |
| `erfasst_von` | `UUID REFERENCES auth.users(id) ON DELETE SET NULL` | `schema_rollen_foto_service.sql:70` |
| `rueckwirkend` | `BOOLEAN DEFAULT FALSE` | `schema_rollen_foto_service.sql:71` |
| `service_auftrag_id` | `UUID` (FK spaeter gesetzt) | `schema_rollen_foto_service.sql:72` |
| `wochenrapport_id` | `UUID REFERENCES gs_wochenrapporte(id) ON DELETE CASCADE` | `wochenrapport_migration.sql:31` |
| `taetigkeit` | `TEXT` (Gewerk, z. B. „Sanitaer") | `wochenrapport_migration.sql:32` |
| `start_zeit` | `TIME` | `wochenrapport_migration.sql:33` |
| `end_zeit` | `TIME` | `wochenrapport_migration.sql:34` |
| `spesen` | `NUMERIC(8,2) DEFAULT 0` | `wochenrapport_migration.sql:35` |
| `abwesenheit` | `TEXT CHECK (abwesenheit IN ('G','F','M','U','A'))` | `wochenrapport_migration.sql:37` |
| `abwesenheit_grund` | `TEXT` | `wochenrapport_migration.sql:38` |
| `material_positionen` | `JSONB DEFAULT '[]'::jsonb` | `wochenrapport_migration.sql:39` |
| `ueberzeit_25` | `NUMERIC(4,2) DEFAULT 0` | `wochenrapport_ueberzeit.sql:11` |
| `ueberzeit_50` | `NUMERIC(4,2) DEFAULT 0` | `wochenrapport_ueberzeit.sql:12` |
| `ueberzeit_100` | `NUMERIC(4,2) DEFAULT 0` | `wochenrapport_ueberzeit.sql:13` |
| `pause_minuten` | `NUMERIC(5,2)` | `wochenrapport_feinschliff.sql:16` |
| `stunden_manuell` | `BOOLEAN DEFAULT false` | `wochenrapport_feinschliff.sql:17` |
| `projektnummer_erfasst` | `TEXT` | `wochenrapport_feinschliff.sql:18` |

Zusaetzlich wurde `projekt_id` von `NOT NULL` befreit
(`schema_rollen_foto_service.sql`), damit Service- und Abwesenheitszeilen
moeglich sind. **Genau daraus entsteht Befund B8.**

Live gegengeprueft (PostgREST, 24.08.2026) — 38 Spalten:

```
id, projekt_id, techniker_user_id, datum, zeit_von, zeit_bis, gesamtstunden,
team, arbeiten, material, besonderheiten, foto_urls, unterschrift_url, pdf_url,
empfaenger, status, woche, jahr, eingereicht_am, created_at, abrechnung_status,
erfasst_von, rueckwirkend, service_auftrag_id, wochenrapport_id, taetigkeit,
start_zeit, end_zeit, spesen, abwesenheit, abwesenheit_grund,
material_positionen, ueberzeit_25, ueberzeit_50, ueberzeit_100, pause_minuten,
stunden_manuell, projektnummer_erfasst
```

### 2.3 Der CHECK-Constraint (Zielbindung)

Quelle: `scripts/wochenrapport_migration.sql:54-62`

```sql
ALTER TABLE gs_tagesrapporte
  ADD CONSTRAINT gs_tagesrapporte_bindung_chk
  CHECK (
    (abwesenheit IS NOT NULL AND projekt_id IS NULL AND service_auftrag_id IS NULL)
    OR (abwesenheit IS NULL AND projekt_id IS NOT NULL AND service_auftrag_id IS NULL)
    OR (abwesenheit IS NULL AND projekt_id IS NULL AND service_auftrag_id IS NOT NULL)
  ) NOT VALID;
```

> **Hinweis fuer den Pruefer:** `NOT VALID` bedeutet, dass Bestandszeilen nicht
> geprueft wurden. Neue und geaenderte Zeilen werden geprueft.

### 2.4 Fremdschluessel **auf** die Tabelle

| Quelle | Spalte | Verhalten |
|---|---|---|
| `gs_rechnungen` | `rapport_id` | `ON DELETE CASCADE` |
| `gs_rapport_positionen` | `rapport_id` | `ON DELETE CASCADE` |
| `gs_tagesrapport_taetigkeitenkatalog` | `tagesrapport_id` | `ON DELETE CASCADE` |
| `gs_projekt_medien` | `tagesrapport_id` | `ON DELETE SET NULL` |
| `gs_wochenrapport_log` | `tagesrapport_id` | `ON DELETE SET NULL` |

### 2.5 Indizes

```sql
idx_gs_tagesrapporte_wochenrapport    (wochenrapport_id)
idx_gs_tagesrapporte_service          (service_auftrag_id)
idx_gs_tagesrapporte_projekt_datum    (projekt_id, datum)
idx_gs_tagesrapporte_service_datum    (service_auftrag_id, datum)
```

### 2.6 RLS

`ENABLE ROW LEVEL SECURITY`. Policies: `service_all` (service_role umgeht
alles), `admin_all`, `techniker_own` (`techniker_user_id = auth.uid()`),
`partner_own_rapporte` (SELECT ueber `gs_projekte.partner_user_id`).
**Alle Server-Endpunkte laufen mit `service_role`**, umgehen RLS also, und
gaten stattdessen im Anwendungscode.

---

## 3. Der Constraint im Wortlaut

```sql
-- scripts/rapport_system_migration.sql:64
UNIQUE(projekt_id, techniker_user_id, datum)
```

Systemname:

```
gs_tagesrapporte_projekt_id_techniker_user_id_datum_key
```

Er wurde am 04.06.2026 angelegt und **seither nie geaendert**. Ein `grep` ueber
alle `scripts/*.sql` findet genau diese eine Definition auf dieser Tabelle: kein
`DROP`, kein Ersatzindex.

Der einzige Kommentar dazu im Repo, `scripts/schema_rollen_foto_service.sql:79-84`:

```sql
-- HINWEIS (kein DDL): die bestehende UNIQUE(projekt_id, techniker_user_id, datum)
-- bleibt. Fuer Service-Rapporte ist projekt_id NULL -> Postgres wertet NULLs als
-- distinct -> keine Kollision. Backdating einer ganzen Woche = verschiedene Daten
-- -> ebenfalls keine Kollision. Nur zwei Rapporte am SELBEN Tag/Projekt/Techniker
-- kollidieren weiterhin (dafuer existiert gs_rapport_positionen).
```

### 3.1 Empirische Pruefung

Am 24.08.2026 gegen die Live-Datenbank ausgefuehrt, mit Wegwerfzeilen im Jahr
2099, danach vollstaendig geloescht. Ein Techniker, ein Datum (02.03.2099):

| # | Einfuegung | HTTP | Ergebnis |
|---|---|---:|---|
| 1 | Projekt A | 201 | angelegt |
| 2 | Projekt B, **gleicher Tag** | 201 | **angelegt** — zwei Baustellen am selben Tag |
| 3 | Projekt A **nochmal**, gleicher Tag | **409** | `duplicate key value violates unique constraint "gs_tagesrapporte_projekt_id_techniker_user_id_datum_key"` |
| 4 | Abwesenheit (`projekt_id` NULL) | 201 | angelegt |
| 5 | Abwesenheit **nochmal**, gleicher Tag | 201 | **angelegt** — Constraint wirkungslos |

Zeilen 1–3 sind woertlich die Anforderung aus Abschnitt 0.
Zeile 4–5 sind Befund **B8**.

### 3.2 Der Bestand bestaetigt es

Techniker Emanuel, Jahr 2026, live gezaehlt:

| KW | Zeilen | Kalendertage | Projekte | Kalendertage mit >1 Zeile |
|---|---:|---:|---:|---:|
| 29 | 7 | 7 | 1 | 0 |
| 30 | 7 | 7 | 1 | 0 |
| 31 | 7 | 7 | 1 | 0 |
| 32 | 7 | 7 | 0 (Ferien) | 0 |
| 33 | 7 | 7 | 0 (Ferien) | 0 |
| **34** | **10** | **7** | **4** | **2** |

KW 34 traegt am 17.08. zwei und am 18.08. drei Zeilen auf verschiedenen
Projekten — **in Produktion, mit dem bestehenden Constraint**:

```
2026-08-17  60060.00   2.0 h   Spesen 30
2026-08-17  60829.00   6.0 h   Spesen 30
2026-08-18  60586.00   4.0 h   Spesen 30
2026-08-18  60133.00   2.5 h   Spesen 30
2026-08-18  60829.00   1.5 h   Spesen 30
```

### 3.3 Warum KW 30/31 dennoch einprojektig sind

Nicht die Datenbank verhindert es. Dort wurde je Kalendertag **eine** Zeile
angelegt und die Baustelle nie umgehaengt. Die tatsaechliche Baustelle steht nur
im Freitextfeld `arbeiten`:

```
KW30  20.07.  P-2026-3470  8.5 h  "Moorefield: Badewanne gesetzt ..."
      21.07.  P-2026-3470 10.0 h  "Jolles / Heglibachstrasse 119: ..."
      22.07.  P-2026-3470  9.0 h  "Jolles / Heglibachstrasse 119: ..."
KW31  28.07.  P-2026-3470  8.0 h  "Langstrasse 149: ..."
      30.07.  P-2026-3470  8.0 h  "Fabrikstrasse 5: ..."
```

Vier verschiedene Baustellen, eine einzige `projekt_id`. Ein Datenpflege- und
Bedienbarkeitsproblem, kein Schemaproblem.

---

## 4. Stellen, die die Annahme bereits tragen

Bewertung je Stelle: **traegt** = mehrere Zeilen je Kalendertag sind korrekt
verarbeitet, keine Aenderung noetig.

### G1 · `api/tagesrapport.js:195-204` — Wochenampel des Technikers

```js
const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?techniker_user_id=eq.${user.id}&jahr=eq.${jahr}&woche=eq.${kw}&select=datum,status,gesamtstunden,ueberzeit_25,ueberzeit_50,ueberzeit_100,projekt_id&order=datum.asc,created_at.asc`, { headers: SB }));
const byDate = {};
for (const r of Array.isArray(rows) ? rows : []) {
  const t = byDate[r.datum] || (byDate[r.datum] = { stunden: 0, ueberzeit: 0, zeilen: 0, alleEingereicht: true });
  t.stunden += Number(r.gesamtstunden || 0);
  t.ueberzeit += Number(r.ueberzeit_25 || 0) + Number(r.ueberzeit_50 || 0) + Number(r.ueberzeit_100 || 0);
  t.zeilen += 1;
  if (r.status !== 'eingereicht') t.alleEingereicht = false;
}
```

**Bewertung: traegt.** Akkumulator statt Zuweisung; ein Tag gilt erst als
eingereicht, wenn **alle** seine Zeilen es sind. Vor dem 22.08.2026 stand hier
`byDate[r.datum] = r` — nur die zuletzt gelesene Zeile ueberlebte, und die
Abfrage hatte kein `order`. Bereits repariert.

### G2 · `api/tagesrapport.js:237-250` — Statusuebersicht

`.filter()/.every()` statt `.find()`; „x/5 Tage" zaehlt Kalendertage statt
Zeilen. **Bewertung: traegt.**

### G3 · `api/tagesrapport.js:361-364` — Ueberfaelligkeit

```js
function hasOverdue(rows, todayStr, jahr, kw) {
  const have = new Set(rows.filter((r) => r.status === 'eingereicht').map((r) => r.datum));
  return mondayToFriday(jahr, kw).some((d) => d < todayStr && !have.has(d));
}
```

**Bewertung: traegt.** `Set` ueber `datum` — Vorlage der ganzen Umstellung.

### G4 · `lib/wochenbericht.js:288-292` — Wochenbericht, Tagesgruppierung

```js
const tageMap = new Map();
for (const z of zeilen) {
  if (!tageMap.has(z.datum)) tageMap.set(z.datum, []);
  tageMap.get(z.datum).push(z);
}
```

**Bewertung: traegt.** `Map<datum, Zeile[]>` — Tageskarte mit n Zeilen darunter.

### G5 · `lib/wochenbericht.js:322` — Fotozaehlung

```js
fotos: fotos.filter((f) => f.tagesrapport_id === z.id).length,
```

**Bewertung: traegt.** Zaehlt je **Tageszeile**, nicht je Kalendertag. Vorher
behauptete bei zwei Technikern jeder die Fotos des anderen mit.

### G6 · `lib/wochenbericht.js` — Fotodokumentation

Gruppiert nach **(Tag, Projekt)**; die Gruppengrenze ist zugleich die
Schnittkante fuer die Aufteilung grosser PDFs.

**Bewertung: traegt — die sauberste Stelle im System.** Sie war von Anfang an
auf mehrere Projekte je Kalendertag gebaut und braucht keine einzige Aenderung.

### G7 · `app.html:10512-10520` — Erfassungsmaske des Technikers

```js
var zByDate={}; dates.forEach(function(d){ zByDate[d]=[]; });
tcWocheZeilen.forEach(function(z){ if(zByDate[z.datum]) zByDate[z.datum].push(z); });
```

Kommentar im Code: „Wochenblatt rendern: Mo–So fest, **1..n Zeilen je Tag**".
Es gibt einen Knopf „＋ weiterer Eintrag".

**Bewertung: traegt.** Der Wert ist ein Array, kein Einzeldatensatz.

### G8 · `api/wochenbericht.js:274-284` — Sammelmaske „Wochenpaket"

Gruppiert nach `projekt_id` und `wochenrapport_id`, fasst Kalendertage gar nicht
an. **Bewertung: traegt.**

### G9 · `api/cockpit.js:2898-2911` — Duplikatserkennung (Fix vom 22.08.2026)

```js
try {
  const r = await sbWrite('POST', 'gs_tagesrapporte', row);
  return await finishSave(r);
} catch (e) {
  if (/duplicate key|23505|conflict/i.test((e && e.message) || '')) {
    if (row.service_auftrag_id) {
      return { error: 'Für diesen Serviceauftrag besteht an diesem Tag bereits ein Eintrag. Er wurde nicht überschrieben — bitte den bestehenden Eintrag ergänzen oder einen anderen Auftrag wählen.' };
    }
    if (row.projekt_id) {
      return { error: 'Für dieses Projekt besteht an diesem Tag bereits ein Eintrag. Er wurde nicht überschrieben — bitte den bestehenden Eintrag ergänzen oder ein anderes Projekt wählen.' };
    }
    return { error: 'Für diesen Tag besteht bereits ein Eintrag. Er wurde nicht überschrieben.' };
  }
  ...
}
```

**Bewertung: traegt — und muss bleiben.** Das ist die Klartextmeldung, die die
Anforderung („echtes Duplikat weiterhin abweisen") sichtbar macht. Faellt der
Constraint, faellt diese Meldung mit ihm.

> **Achtung, Wechselwirkung:** Der Zweig `if (row.service_auftrag_id)` ist
> **toter Code** — wegen B8 kann dieser Konflikt nie entstehen.

---

## 5. Stellen, die brechen oder taeuschen

Bewertung je Stelle: **bricht** = liefert bei mehreren Projekten je Kalendertag
einen Fehler oder ein falsches Ergebnis.

### B1 · `api/cockpit.js:3420-3448` — `pmWochenrapportMove`, Projekt umhaengen

Das ist **der Codepfad, den die Anforderung braucht**.

```js
async function pmWochenrapportMove(b, scope) {
  const id = uuid(b.id);
  const rows = await sbGet(`gs_tagesrapporte?id=eq.${id}&select=*&limit=1`).catch(() => []);
  const before = rows && rows[0];
  if (!before) return { error: 'Zeile nicht gefunden' };

  const neuerTechnikerUserId = b.techniker_user_id ? uuid(b.techniker_user_id) : before.techniker_user_id;
  const neuesProjektId = b.projekt_id !== undefined ? (b.projekt_id ? uuid(b.projekt_id) : null) : before.projekt_id;
  const neuerServiceId = b.projekt_id !== undefined ? null : before.service_auftrag_id;

  const row = { techniker_user_id: neuerTechnikerUserId, projekt_id: neuesProjektId, service_auftrag_id: neuerServiceId };
  ...
  const r = await sbWrite('PATCH', `gs_tagesrapporte?id=eq.${id}`, row);
  return { ok: true, row: Array.isArray(r) ? r[0] : r };
}
```

`sbWrite` wirft bei jedem Nicht-2xx (`api/cockpit.js:36-42`):

```js
if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${await r.text().catch(() => '')}`);
```

**Bewertung: bricht.** Kein `23505`-Zweig. Haengt der Master eine Zeile auf ein
Projekt um, auf dem am selben Tag schon eine Zeile desselben Technikers liegt,
entsteht ein ungefangener Fehler → HTTP 500 → im Client
(`gs-intern.html:2662`) nur `toast('Verbindungsfehler')`. Der Master erfaehrt
nicht, dass ein fachlicher Konflikt vorliegt.

Zweiter Punkt: `row.wochenrapport_id` wird nur beim **Technikerwechsel**
nachgezogen. Beim reinen Projektwechsel bleibt es stehen. Da der Wochenrapport
Techniker x KW ist, halte ich das fuer korrekt — **bitte gegenpruefen.**

### B2 · `api/cockpit.js:3300-3332` — `pmWochenrapportUpdate`, Datum aenderbar

```js
const PM_TAG_UPDATE_FELDER = new Set([
  'datum', 'gesamtstunden', 'stunden_manuell', 'pause_minuten', 'start_zeit', 'end_zeit',
  'taetigkeit', 'projektnummer_erfasst', 'spesen', 'ueberzeit_25', 'ueberzeit_50', 'ueberzeit_100',
  'arbeiten', 'besonderheiten', 'abwesenheit', 'abwesenheit_grund',
]);
...
const r = await sbWrite('PATCH', `gs_tagesrapporte?id=eq.${id}`, row);
return { ok: true, row: Array.isArray(r) ? r[0] : r };
```

**Bewertung: bricht.** `datum` steht in der Whitelist, `projekt_id` nicht.
Verschiebt der Master eine Zeile auf einen Tag, an dem dasselbe Projekt schon
belegt ist, derselbe ungefangene 500.

Zusaetzlich: `abwesenheit` ist aenderbar, `projekt_id` aber nicht — damit laesst
sich per Update eine Zeile erzeugen, die den CHECK aus 2.3 verletzt
(`abwesenheit` gesetzt **und** `projekt_id` gesetzt). Der CHECK faengt das ab,
aber wieder als ungefangener 500. **Diesen Punkt habe ich in der urspruenglichen
Diagnose nicht genannt.**

### B3 · `api/tagesrapport.js:148-152` — `save()`, falscher Konfliktschluessel

```js
const up = await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?on_conflict=id`, {
  method: 'POST', headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row),
});
const saved = (await sbJson(up))?.[0];
if (!up.ok || !saved) return res.status(500).json({ error: 'Rapport konnte nicht gespeichert werden' });
```

**Bewertung: bricht (nur Meldung).** `on_conflict=id` ist der Primaerschluessel,
nicht der fachliche Schluessel. Ein `23505` auf dem UNIQUE wird nicht
aufgeloest, sondern faellt in den generischen 500-Text. Der einzige Schreibpfad
ohne Klartext.

Kontext: **eine einzige Stelle im ganzen Repo** nennt den fachlichen Schluessel
als `on_conflict`, und das ist ein Seed-Skript
(`scripts/seed_demo_accounts.mjs:89`).

### B4 · `api/tagesrapport.js:95-103` — `today()`, undefinierte Auswahl

```js
const f = [`techniker_user_id=eq.${user.id}`, `datum=eq.${datum}`];
if (body.projekt_id) f.push(`projekt_id=eq.${body.projekt_id}`);
const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?${f.join('&')}&select=${SELECT}&limit=1`, { headers: SB }));
const existing = (Array.isArray(rows) ? rows : [])[0] || null;
```

**Bewertung: latent.** `limit=1` **ohne `order`**. Ohne `projekt_id` ist
undefiniert, welche Zeile die Eingabemaske vorfuellt. Der einzige heutige
Aufrufer (`app.html:6418`) schickt `projekt_id` mit — deshalb heute folgenlos,
morgen nicht mehr.

### B5 · `lib/wochenbericht.js:261-285` — „fuehrendes Projekt je Kalendertag"

```js
const fuehrendesProjekt = {};                      // datum -> projekt_id
if (userIds.length) {
  const alle = await sbSoft(
    `gs_tagesrapporte?techniker_user_id=in.(${userIds.join(',')})&datum=gte.${von}&datum=lte.${bis}`
    + '&select=datum,projekt_id,gesamtstunden&order=datum.asc', []) || [];
  const proTag = {};
  for (const z of alle) {
    if (!z.datum || !z.projekt_id) continue;
    const t = proTag[z.datum] || (proTag[z.datum] = {});
    t[z.projekt_id] = (t[z.projekt_id] || 0) + num(z.gesamtstunden);
  }
  ...
  for (const [d, m] of Object.entries(proTag)) {
    fuehrendesProjekt[d] = Object.keys(m).sort((a, b) => (m[b] - m[a])
      || String(nummern[a] || '').localeCompare(String(nummern[b] || '')))[0];
  }
}
const traegtSpesen = (datum) => !fuehrendesProjekt[datum] || fuehrendesProjekt[datum] === projektId;
```

**Bewertung: funktional korrekt, fachlich unabgestimmt — und geldrelevant.**

Der Wochenbericht ist Projekt x KW und sieht nur die Zeilen *seines* Projekts.
Er kann von sich aus nicht wissen, ob der Tag noch auf anderen Baustellen lief.
Ohne diese Zusatzabfrage wiesen vier Projektberichte desselben Tages die
Tagespauschale viermal aus (KW 34: 4 x CHF 30 statt 1 x CHF 30).

Die Zurechnungsregel — *Projekt mit den meisten Stunden, bei Gleichstand die
kleinste Projektnummer* — ist nirgends fachlich beschlossen. Je mehr
Mehrfachtage entstehen, desto haeufiger entscheidet sie darueber, welchem
Kunden CHF 30 verrechnet werden. Das ist der Punkt, der mit der Anforderung
**haeufiger** wird, nicht seltener.

### B6 · Dreifach kopierte Spesenregel

| Datei:Zeile | Funktion |
|---|---|
| `lib/wochenbericht.js:55` | `spesenJeTagAus()` |
| `api/cockpit.js:3032` | `spesenJeTag()` |
| `app.html:11236` | `spesenProTag()` (Browser) |

```js
// lib/wochenbericht.js:55
function spesenJeTagAus(zeilen, datumVon = (z) => z.datum, wert = (z) => z.spesen) {
  const proTag = {};
  let ohneDatum = 0;
  for (const z of zeilen || []) {
    const v = num(wert(z));
    const d = datumVon(z);
    if (!d) { ohneDatum += v; continue; }
    if (!(d in proTag) || v > proTag[d]) proTag[d] = v;
  }
  return r2(Object.values(proTag).reduce((a, v) => a + v, 0) + ohneDatum);
}
```

```js
// app.html:11236 — dieselbe Regel im Browser, ueber das DOM
function spesenProTag(){
  var proTag={};
  Array.prototype.forEach.call(document.querySelectorAll('#tc-content .tc-row[data-row]'),function(rowEl){
    var zielVal=(rowEl.querySelector('.rc-ziel')||{}).value||'';
    if(!zielVal) return;
    var d=rowEl.getAttribute('data-date')||'';
    var e=rowEl.querySelector('.f-spesen');
    var v=e?(Number(e.value)||0):0;
    if(!d){ proTag['_'+Math.random()]=v; return; }
    if(!(d in proTag) || v>proTag[d]) proTag[d]=v;
  });
  var t=0; for(var k in proTag) t+=proTag[k];
  return Math.round(t*100)/100;
}
```

**Bewertung: traegt heute, driftet morgen.** Drei Implementierungen, sechs
Aufrufer (`api/cockpit.js:3124, 3154, 3199, 3286`, `lib/wochenbericht.js`,
`app.html`). Aendert sich die Regel, muss sie dreimal gleich geaendert werden.
Kein Test haelt die drei gegeneinander.

### B7 · `lib/wochenbericht.js:886-889` — irrefuehrender Kommentar

```js
// Nicht zu verwechseln mit dem Wochenbericht: der ist Projekt x KW und geht an
// den Bauleiter. Dieser hier ist das Stundenblatt, das der Techniker
// unterschreibt und die Buchhaltung ablegt — eine Zeile je Tag, quer ueber
// alle Projekte, mit beiden Unterschriften aus gs_wochenrapporte.
```

**Bewertung: nur Text, aber falsch.** Das PDF rendert laengst eine Tabellenzeile
je Datensatz. Bei zwei Baustellen am Montag erscheinen zwei Zeilen „Mo 17.08.".

### B8 · Schema — NULL-Luecke im Constraint

**Bewertung: echter Mangel, unabhaengig von der Anforderung.**

In PostgreSQL sind NULL-Werte in einem UNIQUE-Constraint zueinander *distinct*.
Fuer jede Zeile mit `projekt_id IS NULL` ist der Constraint deshalb wirkungslos.
Das betrifft beide Zielarten, die der CHECK aus 2.3 ausdruecklich zulaesst:

- Serviceauftrag-Zeilen (`service_auftrag_id` gesetzt),
- Abwesenheitszeilen (`abwesenheit` gesetzt).

Empirisch belegt (Abschnitt 3.1, Zeilen 4/5): zwei identische
Abwesenheitszeilen am selben Tag liessen sich beide anlegen.

Folge: der Zweig `if (row.service_auftrag_id)` in G9 ist toter Code.

**Bestand heute** (live, 24.08.2026): 45 Tageszeilen — 31 mit Projekt,
14 Abwesenheit (KW 32/33 Ferien), 0 Service. Dubletten in allen drei Gruppen: 0.

### B9 · `api/tagesrapport.js:195, 231` — Filter ueber `jahr`/`woche`

Beide Abfragen filtern `jahr=eq.&woche=eq.` statt ueber einen `datum`-Bereich.
Altzeilen mit `woche IS NULL` fehlen. `lib/wochenbericht.js:143` macht es
richtig (`datum=gte.&datum=lte.`).

**Bewertung: unabhaengig von der Anforderung, aber in derselben Datei.**

---

## 6. Der Migrationsentwurf

Datei: `scripts/tageszeile_projekt_ENTWURF.sql` — **nicht ausgefuehrt**.

Er enthaelt **keine** Aenderung am bestehenden UNIQUE, weil nach Abschnitt 3
keine noetig ist. Aktiv sind ausschliesslich fuenf `SELECT`. Die einzige echte
DDL — zwei partielle Unique-Indizes gegen B8 — steht **auskommentiert**.

### 6.1 Aktiver Teil (rein lesend)

```sql
-- 1a) Wie sieht der Constraint wirklich aus?
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'gs_tagesrapporte'::regclass
   and contype in ('u','p')
 order by conname;

-- 1b) Gibt es heute schon Kalendertage mit mehreren Projekten?
select techniker_user_id, datum,
       count(*)                   as zeilen,
       count(distinct projekt_id) as projekte,
       sum(gesamtstunden)         as stunden,
       max(spesen)                as spesen_regelkonform,
       sum(spesen)                as spesen_roh
  from gs_tagesrapporte
 where projekt_id is not null
 group by techniker_user_id, datum
having count(*) > 1
 order by datum;

-- 1c) Echte Dubletten. Muss leer sein.
select projekt_id, techniker_user_id, datum, count(*)
  from gs_tagesrapporte
 where projekt_id is not null
 group by projekt_id, techniker_user_id, datum
having count(*) > 1;

-- 2) Vorpruefung fuer die auskommentierte DDL. Beide muessen leer sein.
select service_auftrag_id, techniker_user_id, datum, count(*)
  from gs_tagesrapporte
 where projekt_id is null and service_auftrag_id is not null
 group by service_auftrag_id, techniker_user_id, datum
having count(*) > 1;

select techniker_user_id, datum, count(*)
  from gs_tagesrapporte
 where projekt_id is null and service_auftrag_id is null and abwesenheit is not null
 group by techniker_user_id, datum
having count(*) > 1;
```

### 6.2 Auskommentierter Teil (DDL gegen B8)

```sql
-- -- Serviceauftrag: hoechstens eine Zeile je (Auftrag, Techniker, Tag).
-- create unique index if not exists idx_gs_tagesrapporte_service_tag_uniq
--   on gs_tagesrapporte (service_auftrag_id, techniker_user_id, datum)
--   where projekt_id is null and service_auftrag_id is not null;
--
-- -- Abwesenheit: hoechstens eine Zeile je (Techniker, Tag) — Variante A.
-- create unique index if not exists idx_gs_tagesrapporte_abwesenheit_tag_uniq
--   on gs_tagesrapporte (techniker_user_id, datum)
--   where projekt_id is null and service_auftrag_id is null and abwesenheit is not null;
```

### 6.3 Warum auskommentiert

Eine offene fachliche Frage: *darf ein Techniker an einem Kalendertag zwei
verschiedene Abwesenheiten tragen — halber Tag Unfall, halber Tag Ferien?*

- **Variante A** (wie oben): hoechstens **eine** Abwesenheitszeile je Techniker
  und Tag. Streng, deckt den Ferienfall ab, verbietet den geteilten Tag.
- **Variante B**: UNIQUE ueber `(techniker_user_id, datum, abwesenheit)` —
  mehrere Abwesenheiten je Tag erlaubt, dieselbe nicht doppelt.
- **Variante C**: nichts tun, heutiger Zustand.

Ohne Entscheidung wird nichts eingeschaltet.

### 6.4 Durchgefuehrte Pflichtpruefungen

```
grep -n "REFERENCES|DROP|ALTER COLUMN"  -> 2 Treffer, beide in Kommentarzeilen
aktive Anweisungen                      -> 5 x SELECT, sonst nichts
Namenspruefung beider Indexnamen        -> 0 Treffer im uebrigen Repo
Bestand                                 -> 45 Zeilen, 0 Dubletten in allen drei Gruppen
```

### 6.5 Was ausdruecklich nicht getan wird

- Der bestehende UNIQUE wird **nicht** gedroppt und **nicht** ersetzt. Er ist
  die Duplikatsperre der Anforderung und die Grundlage der Klartextmeldungen
  aus G9.
- `gs_tagesrapporte.status` wird nicht angefasst.
- Keine Zeile wird korrigiert, verschoben oder geloescht.
- Keine neue Tabelle, keine neue Spalte, keine neue Abhaengigkeit.

---

## 7. Zusammenfassung meiner Bewertung

| Anforderung | Urspruengliche Annahme | Meine Bewertung |
|---|---|---|
| UNIQUE aufloesen | Schemaaenderung noetig | **Keine noetig.** Der Constraint erfuellt sie woertlich (3.1, 3.2). Zu tun: `23505`-Klartext dort nachziehen, wo er fehlt — B1, B2, B3. |
| Projekt einer Tageszeile umhaengen | neu zu bauen | **Vorhanden** als `pmWochenrapportMove` (B1), erreichbar ueber den Knopf „Verschieben" (`gs-intern.html:2632`). Zu tun: in die naheliegende Bearbeitungsmaske holen (`wrRowEdit`, `gs-intern.html:2543`, bietet heute Gewerk/Zeiten/Stunden/Spesen/Taetigkeit, aber **kein Projekt**), Auswahl auf die Projekte des Kunden einschraenken, Konflikt melden. |
| Fundstellen anpassen | breite Umstellung | **Schmal.** Die Verdichtung wurde am 22.–24.08.2026 bereits umgestellt (G1–G8). Offen sind B1–B4 und B7/B9 als Code, B5/B6 als fachliche Entscheidung. |

**Restrisiko, das ich sehe und benenne:** Wenn mehrere Projekte je Kalendertag
zum Normalfall werden, wird B5 (Zurechnung der Tagespauschale) von einer
Randerscheinung zu einer regelmaessigen, geldwirksamen Entscheidung — getroffen
von einer Sortierregel, die nie beschlossen wurde. Das ist aus meiner Sicht das
groessere Problem als der Constraint.

---

## 8. Frage an den Pruefer

Bitte gehen Sie Abschnitt 6 durch und beantworten Sie:

> **Welche Annahme faellt durch diese Migration, die oben nicht genannt ist?**

Hilfreich waere zusaetzlich eine Einschaetzung zu:

1. Ist meine Lesart des Constraints korrekt — erlaubt
   `UNIQUE(projekt_id, techniker_user_id, datum)` tatsaechlich mehrere Projekte
   je Kalendertag, und ist der empirische Nachweis in 3.1 tragfaehig?
2. `pmWochenrapportMove` (B1) zieht `wochenrapport_id` nur beim
   Technikerwechsel nach, nicht beim Projektwechsel. Ist das korrekt, wenn der
   Wochenrapport Techniker x Kalenderwoche ist?
3. Uebersehe ich eine Stelle, an der `ON DELETE SET NULL` auf
   `gs_projekt_medien.tagesrapport_id` (2.4) in Verbindung mit dem Umhaengen
   von Tageszeilen Daten still verliert?
4. Die partiellen Indizes aus 6.2 sind additiv — aber sie weisen kuenftig
   Einfuegungen ab, die heute gelingen. Welcher heute funktionierende
   Anwendungsfall wuerde dadurch brechen?
