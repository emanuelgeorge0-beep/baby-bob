# Testplan — wie das Modell geprueft wird

Fuer die Runde, in der `scripts/material_soll_l2.sql` tatsaechlich laeuft und
die Endpunkte gebaut werden. Diese Runde ist Papier; hier steht, woran spaeter
gemessen wird.

Der Plan ist so geschnitten, dass er **vor** dem Bauen als Abnahmeliste taugt:
jeder Punkt ist ein Satz, der wahr oder falsch ist, kein „funktioniert gut".

---

## 0 Rahmen

**Form.** Ein Regressionsskript im Stil des Hauses:
`scripts/test_material_soll.mjs`, `node --env-file=.env.local
scripts/test_material_soll.mjs [baseUrl]`, mit dem bekannten Zaehler
`let pass = 0, fail = 0;` und `ok(bedingung, meldung)` — Muster
`scripts/test_zeitfeld_wache.mjs:21-22`. Danach in `scripts/test_all.mjs:11-17`
in die Suite-Liste eintragen.

**Der stehende Massstab.** Die Suite laeuft **fuenfmal hintereinander
vollstaendig gruen**, bevor irgendetwas als fertig gemeldet wird, und deckt
**alle vier Rollen** ab: Master, Partner, Techniker, Nicht-berechtigt. Keine
Handprobe als Ersatz.

**Testdaten.** Eigene Zone in einem Testprojekt, das die Suite am Ende wieder
loescht — Muster `test_zeitfeld_wache.mjs`, das in Jahr 2099 schreibt und
aufraeumt. **Kein Testlauf fasst `gs_material`, `gs_gw_step`, `gs_projekte` oder
`gs_bauabschnitte` schreibend an.**

**Reihenfolge.** T-M zuerst (Migration), dann T-A bis T-C, dann T-S
(Datentrennung), dann T-R (Regression auf dem Bestand). Faellt T-M, wird nicht
weitergetestet.

---

## T-M · Migration

| # | Satz, der wahr sein muss |
|---|---|
| T-M1 | Das Skript laeuft in einer leeren Datenbank fehlerfrei durch. |
| T-M2 | Ein **zweiter** Lauf direkt danach laeuft ebenfalls fehlerfrei durch und legt nichts doppelt an (Idempotenz — jedes `create` ist `if not exists`, jeder `check` und jeder Seed guarded). |
| T-M3 | Danach existieren genau zehn Tabellen `gs_mat_%`: `select table_name from information_schema.tables where table_schema='public' and table_name like 'gs_mat_%'` → 10 Zeilen. |
| T-M4 | `select count(*) from gs_material` ist vor und nach dem Lauf identisch. Ebenso `gs_gw_step`, `gs_projekte`, `gs_bauabschnitte`, `gs_taetigkeitenkatalog`. |
| T-M5 | Kein `drop table` und kein `alter … drop` im Skript. Pruefbar per `grep -in "drop table\|drop column" scripts/material_soll_l2.sql` → nur die `drop policy if exists`-Zeilen. |
| T-M6 | Der Seed legt genau zwei Regeln und drei Fachregeln an; ein zweiter Lauf legt keine weiteren an. |
| T-M7 | `gs_mat_position.regel_id` und `.regel_lauf_id` tragen nach dem Lauf beide einen Fremdschluessel (die nachgetragenen Constraints in B.3 sind gesetzt). |

---

## T-A · Ebene A — Artikel

| # | Satz, der wahr sein muss |
|---|---|
| T-A1 | Ein globaler Artikel (`partner_id is null`) und ein partnereigener mit **demselben `slug`** koennen nebeneinander existieren. |
| T-A2 | Zwei globale Artikel mit demselben `slug` werden abgelehnt (Teilindex `idx_gs_mat_artikel_slug_global`). |
| T-A3 | Zwei Artikel desselben Partners mit demselben `slug` werden abgelehnt; dieselben `slug`s bei **verschiedenen** Partnern sind erlaubt. |
| T-A4 | Ein Set, das sich selbst als Bestandteil enthaelt, wird abgelehnt (`gs_mat_set_pos_kein_selbstbezug`). Ein Set, das ueber zwei Stufen auf sich selbst zeigt (A → B → A), wird von der **Anwendung** abgelehnt — die Datenbank faengt das nicht. |
| T-A5 | Ein Artikel kann gleichzeitig eine DVGW- und eine SVGW-Zeile in `gs_mat_zulassung` tragen, mit unterschiedlichem `land` und unterschiedlicher Gueltigkeit. |
| T-A6 | Derselbe Artikel kann Preise bei zwei Lieferanten, in CHF und in EUR, mit unterschiedlichem `gueltig_ab` tragen. |
| T-A7 | `dn` ist numerisch vergleichbar: `where dn >= 50` liefert das erwartete Ergebnis. `zoll` bleibt daneben unabhaengig gefuellt. |
| T-A8 | Ein Artikel ohne `presskontur` (z. B. Schweissteil) laesst sich anlegen — das Feld ist nicht Pflicht. |
| T-A9 | `aktiv = false` blendet den Artikel aus der Auswahl, **entfernt** aber keine bestehende Position, die auf ihn zeigt. |

---

## T-P · Die Position — Mengenherkunft

Der Kern. Hier faellt die Entscheidung dieser Runde durch oder besteht.

| # | Satz, der wahr sein muss |
|---|---|
| T-P1 | Nur `menge_vorschlag = 12` gesetzt → `menge_gueltig = 12`, `abweichung is null`. |
| T-P2 | `menge_erfasst = 13` dazu → `menge_gueltig = 13`, `abweichung = 1`. **Der Vorschlag 12 steht unveraendert daneben.** |
| T-P3 | `menge_erfasst = 0` (nichts verbaut) → `menge_gueltig = 0`, nicht 12. Null ist ein Wert, nicht „leer". |
| T-P4 | `menge_erfasst` wieder auf `null` → `menge_gueltig` faellt auf 12 zurueck, `abweichung is null`. |
| T-P5 | Nur `menge_erfasst` gesetzt, kein Vorschlag (Techniker legt eine Position von Hand an) → `menge_gueltig` = der erfasste Wert, `abweichung is null`, `herkunft = 'erfasst'`. |
| T-P6 | **Ein zweiter Regellauf ueberschreibt eine bereits erfasste Menge nicht.** Er legt einen neuen `gs_mat_regel_lauf` an; `menge_erfasst` bleibt stehen. |
| T-P7 | Jede Schreiboperation setzt `geaendert_von` und `geaendert_at`. Nach einer Aenderung durch den Techniker steht dessen `user_id` dort, nicht die des Masters. |
| T-P8 | `herkunft` akzeptiert nur `gerechnet`, `erfasst`, `plan`; jeder andere Wert wird abgelehnt (`check`). |
| T-P9 | **Plan-Simulation:** eine Position mit `herkunft = 'plan'` und gefuellter `menge_vorschlag` verhaelt sich in T-P1 bis T-P4 identisch. Kein Feld, keine Abfrage muss sich dafuer aendern. Das ist der Nachweis, dass das spaetere Planlesen das Modell nicht bricht. |
| T-P10 | `status` akzeptiert nur `geplant`, `bestellt`, `geliefert`, `verbaut` — anders als `gs_material` heute, das jeden String bis 40 Zeichen nimmt (`api/cockpit.js:3976`). |
| T-P11 | Teilmenge: `menge_gueltig = 21`, `menge_geliefert = 15` ist speicherbar, und die Auswertung „was fehlt noch" liefert 6. |
| T-P12 | Eine Position kann auf einen `gs_gw_step` zeigen, und **mehrere Positionen koennen auf denselben Step zeigen.** |
| T-P13 | Auswertung ueber Projekte hinweg: `select regel_slug_snapshot, avg(abweichung) … where abweichung is not null group by 1` liefert je Regel eine Zeile. Das ist die Frage, fuer die das Modell gebaut ist. |

---

## T-N · Snapshot — keine Rueckwirkung

| # | Satz, der wahr sein muss |
|---|---|
| T-N1 | Position anlegen, dann `gs_mat_artikel.bezeichnung` aendern → `bezeichnung_snapshot` der Position bleibt der alte Text. |
| T-N2 | Position anlegen, dann `gs_mat_artikel.presskontur` von M auf V aendern → `artikel_snapshot` der Position zeigt weiterhin M. |
| T-N3 | Position anlegen, dann einen neuen `gs_mat_preis` mit spaeterem `gueltig_ab` anlegen → `preis_snapshot` der Position bleibt der alte Preis. |
| T-N4 | Artikel loeschen → die Position bleibt bestehen, `artikel_id is null`, und ist ueber die drei Snapshot-Felder **vollstaendig lesbar**. |
| T-N5 | Regel aendern und `version` erhoehen → alte `gs_mat_regel_lauf`-Zeilen behalten ihre `regel_version` und ihren `ergebnis`-Snapshot. |
| T-N6 | Regel loeschen → `gs_mat_position.regel_id is null`, aber `regel_slug_snapshot` steht noch da. Der Vorschlag bleibt zuordenbar. |
| T-N7 | Fachregel-Begruendung aendern → `gs_mat_befund.begruendung_snapshot` einer alten Verletzung bleibt der Text, den der Nutzer damals gesehen hat. |

---

## T-B · Ebene B — Kennzahlregeln

### T-B1 Trinkwasser, durchgerechnet

Eingaben: `geschosse = 6`, `wohnungen_je_geschoss = 2`,
`geschosshoehe_m = 3.5`, `zk_letzte_entnahme_geschoss = 5`.
Parameter: `schellenabstand_m = 1.75`.

Erwartet — **acht** Positionen mit exakt diesen Werten:

| Position | `menge_vorschlag` |
|---|---|
| Rohr KW | 21.0 |
| Rohr WW | 21.0 |
| Rohr ZK | 17.5 |
| T-Stueck KW | 12 |
| T-Stueck WW | 12 |
| Schellen KW | 12 |
| Schellen WW | 12 |
| Schellen ZK | 10 |

| # | Satz, der wahr sein muss |
|---|---|
| T-B1a | Genau acht Positionen, mit genau diesen acht Werten. |
| T-B1b | **Keine** Position „T-Stueck ZK" — auch nicht mit Menge 0. |
| T-B1c | `schellenabstand_m` auf 1.5 → Schellen KW/WW werden 14, ZK 12. Alle Rohr- und T-Stueck-Werte bleiben unveraendert. |
| T-B1d | `zk_letzte_entnahme_geschoss = 6` → Rohr ZK wird 21.0, Schellen ZK 12. Nichts anderes aendert sich. Die Zirkulation ist **kein abgeleiteter Wert**: die Regel rechnet sie nie aus `geschosse`. |
| T-B1e | `geschosshoehe_m` nicht mitgegeben → der Standard 3.5 wird benutzt, und der benutzte Wert steht in `gs_mat_regel_lauf.eingaben`. |
| T-B1f | Der Lauf schreibt genau eine `gs_mat_regel_lauf`-Zeile mit `eingaben`, `parameter`, `ergebnis` und `regel_version`. |
| T-B1g | Jede erzeugte Position traegt `herkunft = 'gerechnet'`, `regel_lauf_id` und `regel_slug_snapshot = 'steigzone_trinkwasser'`. |

### T-B2 Abwasser Variante B — der Lauf muss abbrechen

| # | Satz, der wahr sein muss |
|---|---|
| T-B2a | Der Lauf **bricht ab** und legt keine Position an, weil `schellenabstand_m`, `ausdehnungsmuffe_m` und `reduktion_dn` `standard: null` mit `quelle: "offen"` tragen. |
| T-B2b | Die Fehlermeldung benennt **alle drei** fehlenden Parameter namentlich, nicht nur den ersten. |
| T-B2c | Wird `schellenabstand_m = 1.50` von Hand mitgegeben, aendert sich die Meldung auf die verbleibenden zwei. |
| T-B2d | Mit allen drei Werten (1.50 / 6.0 / 63) laeuft die Regel durch und erzeugt: Fallrohr 21.0 m; Abzweiger 110/110/88° 12; Bogen 30° 12; Abzweiger dazwischen 12; Reduktion 12; Anschluss Waschtisch 12; Schellen 14; Ausdehnungsmuffen 4. |
| T-B2e | Mit 1.10 / 5.0 statt 1.50 / 6.0: Schellen 20, Ausdehnungsmuffen 5. Alle anderen Positionen unveraendert. **Das ist der Nachweis, warum kein Mittelwert erfunden wurde.** |
| T-B2f | **Keine** Position fuer die Dusche. |
| T-B2g | Ein Wert ausserhalb der Spanne (`schellenabstand_m = 2.5`, `max` ist 1.50) wird abgelehnt oder erzeugt eine sichtbare Warnung — nicht stillschweigend gerechnet. |

### T-B3 Auswahl der richtigen Regel

| # | Satz, der wahr sein muss |
|---|---|
| T-B3a | Zone mit `medium = abwasser`, `region = 'CH'`, `variante = 'B'` findet `steigzone_abwasser`. |
| T-B3b | Dieselbe Zone mit `region = 'AT'` findet **keine** Regel und meldet das. Sie rechnet nicht ersatzweise mit der Schweizer Regel. |
| T-B3c | Zone mit `medium = trinkwasser` und `region = 'AT'` findet `steigzone_trinkwasser`, weil deren `region` `null` ist. |
| T-B3d | Legt ein Partner eine eigene Regel mit `slug = 'steigzone_trinkwasser'` an, gewinnt sie fuer seine Zonen. Fuer alle anderen Partner und fuer den Master gilt weiter die globale. |

---

## T-C · Ebene C — Fachregeln

| # | Satz, der wahr sein muss |
|---|---|
| T-C1 | Position mit `werkstoff = c_stahl` und `medium = trinkwasser` → **wird abgelehnt.** |
| T-C2 | Die Ablehnung liefert den Begruendungstext im Klartext mit, nicht nur einen Code — Form wie `api/gewerke.js:93-107`. |
| T-C3 | Die Ablehnung schreibt trotzdem einen `gs_mat_befund` mit `schwere = 'sperre'`, `status = 'offen'`. |
| T-C4 | Position mit `werkstoff = c_stahl` und `medium = heizung` → **geht durch**, kein Befund. |
| T-C5 | Position mit `werkstoff = edelstahl` geht bei `trinkwasser` **und** bei `heizung` durch. |
| T-C6 | Zwei Positionen derselben Zone, beide `verbindungsart = pressverbindung`, eine mit Kontur M und eine mit V → **wird abgelehnt**, mit Begruendung. |
| T-C7 | Dieselben zwei Positionen mit `verbindungsart = schweissmuffe` → gehen durch. Die Konturregel greift nur bei Pressverbindung. |
| T-C8 | Ein Befund mit `schwere = 'sperre'` laesst sich **nicht** auf `status = 'uebersteuert'` setzen (`check gs_mat_befund_uebersteuerung`). |
| T-C9 | Ein Befund mit `schwere = 'warnung'` laesst sich uebersteuern, **aber nur mit** `uebersteuert_grund` und `uebersteuert_at`. Ohne Grund wird abgelehnt. |
| T-C10 | Eine Fachregel mit `quelle = 'hersteller'` und leerer `quelle_ref` wird abgelehnt (`check gs_mat_fachregel_quelle_belegt`). |
| T-C11 | Eine Fachregel mit `quelle = 'praxis'` und leerer `quelle_ref` wird angenommen. |
| T-C12 | `begruendung = null` wird abgelehnt. Es gibt keine Sperre ohne Grund. |
| T-C13 | Die Regel `trinkwasser_zulassung_noetig` ist `aktiv = false` und greift nicht — solange **L-18** offen ist. Wird sie aktiviert, greift sie sofort ohne weitere Aenderung. |
| T-C14 | Bestandteile eines Sets werden einzeln geprueft: ein Set mit einem C-Stahl-Teil in einer Trinkwasserzone wird abgelehnt. |

---

## T-S · Datentrennung — alle vier Rollen

Gegen alle Endpunkte, die spaeter entstehen. Muster:
`scripts/test_partner_pm_scope.mjs`.

| # | Satz, der wahr sein muss |
|---|---|
| T-S1 | **Master** sieht Zonen, Positionen und Laeufe aller Projekte. |
| T-S2 | **Partner A** sieht nur Projekte mit `partner_user_id = A`. Ein Zugriff auf ein Projekt von Partner B ergibt 403, nicht eine leere Liste — Muster `requireOwnedProjekt`, `api/cockpit.js:196-203`. |
| T-S3 | Partner A kann eine Position von Partner B auch dann nicht aendern, wenn er ihre `id` kennt (`requireOwnedRow`, `:208-215`). |
| T-S4 | **Techniker** erreicht nur Actions aus `TECHNIKER_ACTIONS`; alles andere ergibt 403, wie in `resolveAccess` (`api/cockpit.js:170`). |
| T-S5 | Der Techniker darf `menge_erfasst` und `status` setzen — aber **nicht** `menge_vorschlag` ueberschreiben. Der Vorschlag gehoert der Regel. |
| T-S6 | Ein Nutzer **ohne** die passende Rolle bekommt 403 mit generischer Meldung, ohne Hinweis darauf, ob das Projekt existiert. |
| T-S7 | Partner A sieht **alle** globalen Artikel und Regeln (`partner_id is null`) und seine eigenen — aber keinen einzigen Eintrag von Partner B. |
| T-S8 | Partner A kann einen globalen Eintrag nicht aendern und nicht loeschen. Er kann nur einen eigenen mit demselben `slug` anlegen. |
| T-S9 | Ohne Freischaltung `material` (`lib/entitlements.js:16`) erreicht ein Partner die Material-Actions nicht. |
| T-S10 | Fehlt `gs_partner_entitlements` ganz, gilt fail-open wie heute (`lib/entitlements.js:38-56`) — **die Datentrennung ueber `partner_user_id` bleibt davon unberuehrt.** Das ist gesondert zu pruefen, weil hier zwei Mechanismen mit verschiedenem Ausfallverhalten aufeinandertreffen. |

---

## T-R · Regression auf dem Bestand

Der Beweis, dass die Runde additiv war. Laeuft nach jedem Schritt.

| # | Satz, der wahr sein muss |
|---|---|
| T-R1 | `scripts/test_all.mjs` bleibt vollstaendig gruen, mit derselben Zahl an Assertions wie vor der Runde. |
| T-R2 | `scripts/test_materialliste.mjs` bleibt gruen. `gs_material` ist unveraendert. |
| T-R3 | `scripts/test_gewerke.mjs` bleibt gruen. `gs_gw_step.material_ref` ist unangetastet. |
| T-R4 | `scripts/test_zahlplan_motor.mjs` bleibt gruen. `gs_bauabschnitte` und `gs_steps` sind unangetastet. |
| T-R5 | `scripts/test_partner_pm_scope.mjs` und `scripts/test_regression_rollen.mjs` bleiben gruen. |
| T-R6 | `scripts/test_sperren.mjs` bleibt gruen — die Hooks aus `feat/claude-setup` greifen weiter. |
| T-R7 | `vercel.json` traegt unveraendert `"outputDirectory": "."`. |
| T-R8 | Der SW-Cache ist unveraendert (v42), solange kein Frontend entsteht. |
| T-R9 | Das Wort „Bob" ist im Code nirgends umbenannt. |

---

## T-D · Dokumente

Falls aus dem Material spaeter eine Bestell- oder Materialliste als Dokument
entsteht — nicht in dieser Runde, aber der Massstab steht schon:

| # | Satz, der wahr sein muss |
|---|---|
| T-D1 | Weisser Hintergrund, schwarze Schrift, druckbar. |
| T-D2 | Logo oben, duenne goldene Trennlinie `#C9A961` unter dem Kopf, sonst neutral. |
| T-D3 | Kein dunkler Command-Center-Stil (`#0A0A0B`) im Dokument. Der gilt nur fuer die Oberflaeche. |
| T-D4 | Farbe, Logo und Fusszeile kommen aus `gs_branding` (`scripts/branding_tabelle.sql:24-38`), nicht aus dem Code. |

---

## Abnahme

Fertig ist die Bau-Runde, wenn:

1. T-M bis T-R **fuenfmal hintereinander vollstaendig gruen** sind.
2. Alle vier Rollen abgedeckt sind — Master, Partner, Techniker,
   Nicht-berechtigt.
3. `scripts/test_material_soll.mjs` in `scripts/test_all.mjs` eingetragen ist.
4. Kein Punkt der Lueckenliste in `annahmen.md` durch eine erfundene Zahl
   umgangen wurde. **Konkret pruefbar:** kein Parameter im Seed traegt einen
   Standardwert mit `quelle: "offen"`. Steht dort eine Zahl, muss `quelle` auf
   `praxis` oder `hersteller` stehen — und bei `hersteller` auf eine Referenz
   zeigen.
