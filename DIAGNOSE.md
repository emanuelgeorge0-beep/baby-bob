# DIAGNOSE — Rollen & Rapport · Foto/Video-Standort-Tagging · Service-Auftrag

Branch `schema-diagnose-rollen-foto-service` · reine Diagnose-Runde (kein Build, keine SQL-Ausführung).
Deliverables: `scripts/schema_rollen_foto_service.sql` (Vorschlag, manuell einzuspielen) + diese Datei.

---

## 1. Was heute existiert (Ist-Zustand)

### Rollen & Identität
- **`user_roles`** (`user_id` UNIQUE, `role`): `role IN ('bob_user','gs_partner','techniker','gs_admin')`.
- **Master** = feste UUID `ee46a716-…` **und** Rolle `master`/`gs_admin` (`cockpit.js` `MASTER_UID`, `verifyMaster`, `resolveAccess`).
- **Partner** = Auth-User mit Rolle `gs_partner` + Entitlements. Keine eigene Partner-Tabelle; Projektbindung über `gs_projekte.partner_user_id`. Firmenprofil in `gs_partner_profil` (PK `partner_user_id`).
- **Techniker** = Rolle `techniker` ist in `user_roles` erlaubt, **wird aber in `api/cockpit.js` NICHT als API-Aufrufer modelliert** — es gibt keinen `role==='techniker'`-Zweig. Techniker existieren heute nur als Datensätze.
- Mandantentrennung: durchgängig `partner_user_id`-Filter + `requireOwnedProjekt`/`requireOwnedRow` mit Service-Key (NICHT RLS). Interne Felder (`kosten`, `rohgewinn`, `ampel`, `ansatz_chf_h`, `eff_chf_h`) leben getrennt in `gs_kalk_*`/`gs_margen` und werden über mehrere `sanitize*ForPartner`-Whitelists nie an Partner ausgeliefert.

### Projekt↔Techniker
- **`gs_projekt_techniker`** existiert bereits (mehrere Techniker je Projekt).

### Rapport
- **Zwei parallele Systeme** (historisch gewachsen):
  - `gs_tagesrapporte` (neu, `api/tagesrapport.js` + PM in `cockpit.js`): projektbasiert, reich (`datum`, `gesamtstunden`, `material[]`, `arbeiten[]`, `besonderheiten`, `foto_urls[]`, Status, Auto-PDF/Rechnung). **`datum` frei setzbar** (kein auto-now). `UNIQUE(projekt_id, techniker_user_id, datum)`.
  - `techniker_rapporte` (alt, `api/rapport.js`): schlank (`techniker_id`, `datum`, `stunden`, `materialien[]`, `notiz`). `datum` ebenfalls frei.

### Dateien / Fotos
- **Keine DB-Tabelle für Datei-Metadaten.** Dateien liegen ausschließlich im Storage-Bucket **`projektdateien`**, Pfad `‹projektId›/‹kategorie›/‹stamp›-‹name›`.
- Einzige „Metadate" heute: **3 feste Ordner-Kategorien** `bilder | plaene | dateien`. **Kein Stockwerk, kein Raum, kein Bauabschnitt, keine Video-Behandlung.**
- Separates zweites Foto-System in `gs_tagesrapporte.foto_urls[]` (Buckets `rapport-photos` etc.) — davon unberührt.

### Gebäudestruktur
- Es gibt bereits eine Hierarchie **`gs_gw_haus → gs_gw_einheit → gs_gw_step`** (Gewerke-Step-Framework). Das ist ein **Arbeitsablauf-Modell** (Steps je Gewerk), **kein Stockwerk-/Ort-Modell**. Für Feature B ungeeignet als Ort-Achse → eigener, schlanker Stockwerk-Katalog.

---

## 2. Was neu ist (Soll — im Skript)

| Feature | Neu | Wiederverwendet |
|---|---|---|
| **A Rollen & Rapport** | `role`-CHECK um `master` ergänzt; `erfasst_von`/`rueckwirkend` auf `gs_tagesrapporte`; Absicherung `gs_projekt_techniker` | `user_roles`, `gs_projekt_techniker`, `gs_tagesrapporte` (Datum bereits frei → Backdating OK) |
| **B Foto/Video-Tagging** | `gs_projekt_stockwerk` (Katalog, Preset+frei); `gs_projekt_medien` (Foto **und** Video, `medientyp`, `thumbnail_path`, `dauer_sekunden`; Ort-Achse `stockwerk`/`wohnung`/`raum` getrennt von `bauabschnitt`) | Bucket `projektdateien`, signierte URLs (`sbSignUrl`) |
| **C Service-Auftrag** | `gs_service_auftrag` (Status-Automat neu→angenommen/abgelehnt→erledigt); `gs_service_techniker` (Zuweisung) | Rapport via `gs_tagesrapporte.service_auftrag_id`; Medien via `gs_projekt_medien.service_auftrag_id` (dieselbe Logik) |

**Zwei Achsen sauber getrennt (Feature B):** ORT = `stockwerk` (Pflicht) → `wohnung` (opt) → `raum` (opt); ARBEITSPHASE = `bauabschnitt` (opt). Getrennte Felder, nie vermischt. `stockwerk` ist denormalisiert als TEXT (robuste Galerie-Gruppierung) **plus** optionaler FK `stockwerk_id` auf den Katalog.

**Polymorphie (A/C-Reuse):** Rapport **und** Medien binden per `projekt_id` **XOR** `service_auftrag_id` (CHECK erzwingt genau eine Bindung). So trägt ein einziger Rapport-/Medien-Pfad beide Welten.

---

## 3. Enforcement-Logik pro Rolle (Beschreibung, NICHT gebaut — für BLOCK 2)

Umsetzung wie gehabt in `api/cockpit.js` mit Service-Key; RLS im Skript nur als Backstop.

- **Master** (`isMaster`, `partnerId=null`): sieht/ändert **alles**. Weist Techniker zu (Projekt & Service). Setzt Service-Status. Sieht interne Felder.
- **Techniker** (neu zu aktivieren, `role==='techniker'`, Identität = `auth`-User-ID):
  - Sichtbar nur Projekte mit `gs_projekt_techniker.techniker_user_id = self` bzw. Service-Aufträge mit `gs_service_techniker.techniker_user_id = self`.
  - Darf Rapport (Stunden/Material/Notiz, **Datum frei/rückwirkend**) und Medien (Foto/Video + Standort-Tags) **nur** auf zugewiesene Projekte/Aufträge schreiben.
  - Sieht **keine** internen Kosten-/Margen-Felder (kommen ohnehin nur aus `gs_kalk_*`/`gs_margen`, nie in Rapport/Medien-Payloads).
- **Partner** (`gs_partner`, `partnerId=self`): **read-only** auf Eigenes. Projekte via `partner_user_id`; Service-Aufträge, die er selbst erstellt hat. Darf Service-Auftrag **anlegen** (Objekt+Beschreibung), aber **nicht** Status setzen / Techniker zuweisen. Payloads laufen durch die bestehenden `sanitize*ForPartner`-Whitelists; Medien-/Rapport-Felder enthalten keine internen Werte.

Server-Filter je Rolle (Muster wie heute): `&partner_user_id=eq.<self>` (Partner), Techniker-Filter über Join auf `gs_projekt_techniker`/`gs_service_techniker`, Master ohne Filter.

---

## 4. Getroffene Annahmen

1. **Keine Umbenennung** bestehender Rollen. `gs_admin`=Master, `gs_partner`=Partner bleiben; `master` wird als zusätzlich erlaubter Wert ergänzt (gewerke.js prüft ihn schon). „Bob" bleibt unangetastet.
2. **Rapport wiederverwenden statt neu bauen** — `gs_tagesrapporte` ist die kanonische Rapport-Tabelle (bereits im PM sichtbar), erweitert um Service-Bindung. Das alte `techniker_rapporte` bleibt unberührt (kein Zwang zur Migration in dieser Runde).
3. **Medien als eigene DB-Tabelle** (heute existiert keine) — Dateien bleiben physisch im Bucket `projektdateien`, die Tabelle hält nur Metadaten + Standort-Tags. Bucket unverändert.
4. **Video von Anfang an** in derselben Tabelle (`medientyp`), inkl. `thumbnail_path` (Poster/Vorschau) und `dauer_sekunden`. Vorschau/Download laufen über signierte URLs (`sbSignUrl`) wie bei Dokumenten.
5. **Stockwerk-Presets app-seitig** (wie gewerke-Templates), kein DB-Seed. `raum`-Liste (Bad/Dusche/Küche/WC/Technikraum/Steigzone) + frei ebenfalls app-seitig → Feld ist freies TEXT.
6. **`projekt_id` in `gs_tagesrapporte` nullbar** gemacht, damit Service-Rapporte darin Platz haben. Bestehende Zeilen/Upsert-Logik (`on_conflict=id`) bleiben funktionsfähig; die bestehende Composite-UNIQUE greift für Service-Zeilen nicht (NULL = distinct).

---

## 5. Geklärte Fragen & offene Punkte

### Geklärt (durch Emanuel in der Live-DB verifiziert)
- **Q1 `gs_projekt_techniker`-Spalte — GELÖST.** Die Tabelle hat BEIDE Spalten, aber **kanonisch ist `techniker_id` → `gs_techniker.id`** (4/5 Zeilen gefüllt). `techniker_user_id` ist verwaist (1/5, Rest aus gewerke-RLS) → **wird nicht verwendet, nicht gedroppt** (Cleanup später). Enforcement-Kette:
  `auth.uid() → gs_techniker.user_id → gs_techniker.id → gs_projekt_techniker.techniker_id → projekt_id`. Schema + Code referenzieren durchgängig `techniker_id`.
- **Q2 Kanonische Rapport-Tabelle — ENTSCHIEDEN: `gs_tagesrapporte`.** Techniker-Buchungen schreiben in `gs_tagesrapporte` (die Tabelle, die das Master-PM-Detail bereits anzeigt → Stunden sofort sichtbar). `techniker_rapporte` (legacy, `api/rapport.js`) bleibt bestehen, wird für NEUE Techniker-Buchungen aber **nicht** mehr verwendet. Datum bleibt frei setzbar (Backdating).

### Offen
1. **Composite-UNIQUE bei Backdating:** `gs_tagesrapporte` hat `UNIQUE(projekt_id, techniker_user_id, datum)` → zwei Rapporte am **selben** Tag/Projekt/Techniker kollidieren (der Code fängt das ab und meldet freundlich). Reicht „ein Rapport pro Tag/Projekt", oder braucht ein Techniker mehrere Einträge pro Tag? Falls ja: UNIQUE lockern.
2. **Service-Auftrag → Projekt-Promotion:** Soll ein Service-Auftrag später in ein volles `gs_projekte` überführbar sein, oder strikt getrennt bleiben? (Aktuell: strikt getrennt, wie gefordert.)
3. **Medien-Migration Altbestand:** Vorhandene Dateien im Bucket `projektdateien` haben keine Metadaten. Best-effort in `gs_projekt_medien` nachtragen (Stockwerk „unbekannt"), oder nur Neu-Uploads taggen?

---

## 6. Roadmap-Notizen (Datenmodell-Vorbereitung, NICHT jetzt gebaut)

- **Techniker-Ansicht bekommt später das schwarz-gold Command-Center-Design** (eigene Runde nach Feature A); Onboarding-Flow der Landing-Page wird gleichzeitig neu designt. Feature A liefert nur Backend-Enforcement + Rapport, kein Design.
- **`gs_techniker` für die spätere Onboarding-/Profil-Maske:** Vorhanden sind bereits `name`, `telefon`, `email`, `qualification/qualifikation`, `specialization`, `rating`, `years_experience`, `photo_url`, `availability_status/verfuegbar`, `user_id`, `typ`, `herkunft`, `region` (+ JSON-Sidecar in `notizen`). **Möglicherweise fehlend** für ein vollständiges Onboarding (in der Design-Runde bestätigen, dann additiv ergänzen):
  - Adresse / PLZ / Ort des Technikers (heute nur `partner_location`/`region` grob),
  - Sprachen, Zertifikate + Ablaufdaten (Sicherheits-/Schweiß-/Kälte-Scheine),
  - interner Kostensatz (CHF/h) — **intern**, nie in techniker-/partner-sichtbaren Payloads.
  Kein Handlungsbedarf jetzt; nur als Merkposten notiert.

---

## 7. BLOCK 2 — Feature A umgesetzt (Code)

**Nur Feature A (Enforcement + Rapport-Anbindung), Design separat.** Geänderte Dateien:
- `api/cockpit.js`:
  - `TECHNIKER_ACTIONS` = { `tech_projekte`, `tech_projekt`, `tech_rapporte`, `tech_rapport_add` }.
  - `resolveAccess`: neuer Techniker-Zweig — löst `auth.uid()` über `gs_techniker.user_id` zur `gs_techniker.id` auf; `scope` trägt `technikerId` (Pool-PK) + `technikerUserId` (auth).
  - `requireAssignedProjekt(projektId, scope)`: filtert `gs_projekt_techniker.techniker_id = scope.technikerId` — Fremdprojekt → 403.
  - `getTechProjekte` / `getTechProjekt`: nur zugewiesene Projekte; `techSafeProjekt` whitelistet Felder (kein `stundensatz`/Kosten/Kunden-Kontakt).
  - `addTechRapport`: schreibt in `gs_tagesrapporte`, **Datum frei/rückwirkend**, `techniker_user_id`/`erfasst_von` serverseitig gesetzt, tolerant gegenüber noch fehlenden Provenienz-Spalten.
- `scripts/schema_rollen_foto_service.sql`: `gs_projekt_techniker` auf kanonisches `techniker_id → gs_techniker(id)` umgestellt; RLS-Joins gehen über `gs_techniker` (siehe unten).

**Test-Voraussetzung:** braucht ein `techniker`-Login (in `user_roles` + verknüpfte `gs_techniker.user_id`) und eine Projekt-Zuweisung; die Provenienz-Spalten kommen erst mit dem manuell einzuspielenden Schema-Skript (Code läuft aber auch vorher, dank Spalten-Toleranz).

---

## 8. BLOCK 3 — Feature B & C im Schema finalisiert (Freigabe erteilt)

Beide Features liegen als DDL im SELBEN Skript `scripts/schema_rollen_foto_service.sql` (Emanuel spielt es EINMAL manuell ein). Konsistent mit Feature A: Techniker-Enforcement überall über `gs_techniker.user_id → id → techniker_id`.

**Feature B — Foto/Video-Standort-Tagging:**
- `gs_projekt_stockwerk` (Katalog je Projekt): `name` (UG/EG/1.OG… preset ODER frei), `reihenfolge`, `quelle` (`preset`/`frei`), `UNIQUE(projekt_id,name)`.
- `gs_projekt_medien` (Fotos UND Videos): `medientyp` (`foto`/`video`), `bucket` (Default `projektdateien`), `path`, `dateiname`, `mime`, `groesse`, `dauer_sekunden` (Video), `thumbnail_path` (Video-Vorschau); **Achse 1 (Ort):** `stockwerk` (**nullbar**; Pflicht app-seitig NUR bei Projekt-Fotos, Service-Fotos dürfen leer) + `stockwerk_id` (FK-Katalog) + `wohnung` + `raum` (feste Liste + frei, app-seitig); **Achse 2:** `bauabschnitt` (optional, getrennt); `notiz`, `hochgeladen_von`, `created_at`. Bindung `projekt_id` XOR `service_auftrag_id` (CHECK).

**Feature C — Service-Auftrag:**
- `gs_service_auftrag`: `auftragsnummer`, `partner_user_id` (Ersteller), `objekt`, `beschreibung` (Sprache→Text), `quelle` (`sprache`/`mail`/`manuell`, Default `manuell` — Herkunft für künftigen Mail-Ingest; Ingest selbst spätere Runde), `status` (`neu`→`angenommen`/`abgelehnt`→`erledigt`), `ablehn_grund`, `angenommen_am`, `erledigt_am`, Timestamps.
- `gs_service_techniker`: `service_auftrag_id` + `techniker_id` (→ `gs_techniker.id`), `UNIQUE`.
- Rapport & Medien hängen per `service_auftrag_id` dran (gleiche Polymorphie wie Projekt): `gs_tagesrapporte.service_auftrag_id` (+ `projekt_id` nullbar + XOR-CHECK, FK), `gs_projekt_medien.service_auftrag_id`.

**Entschieden:** `stockwerk` nullbar (Pflicht app-seitig nur bei Projekt-Fotos); `quelle` auf `gs_service_auftrag` für spätere Mail-Ingest-Herkunft. **Offen (§5):** Composite-UNIQUE bei Backdating, Service→Projekt-Promotion, Medien-Altbestand-Migration.

---

**STATUS BLOCK 3:** Feature B & C im Schema finalisiert (ein Skript). Feature A (Backend) steht.

---

## 9. BLOCK 4 — API für Feature B & C (Code, cockpit.js)

Rollenbewusst über `scope.role` (master/partner/techniker); Enforcement über die verifizierte Kette (Feature A). `scope` trägt zusätzlich `userId`.

**Neue Actions** (Multi-Rollen = in PM_ACTIONS **und** TECHNIKER_ACTIONS registriert; Schreibrechte je Rolle IM Handler erzwungen):
- **Medien:** `medien_list` (Galerie, **gruppiert nach Stockwerk**), `medien_upload` (Foto/Video → Bucket `projektdateien` + `gs_projekt_medien`-Zeile; Video optional mit `thumbnail`+`dauer_sekunden`), `medien_del` (Techniker nur eigene Uploads).
- **Stockwerk:** `stockwerk_list` (+Presets UG/EG/1.OG…), `stockwerk_add` (Master+Techniker), `stockwerk_del` (Master-only).
- **Service:** `svc_liste` / `svc_detail` (rollen-gescoped), `svc_create` (Master+Partner-Ersteller, `quelle` sprache/mail/manuell), `svc_status` (Automat: Master alle erlaubten Übergänge, Techniker nur zugewiesen `angenommen→erledigt`, Partner keine), `svc_assign`/`svc_unassign` (Master-only).
- **Rapport:** `tech_rapport_add` erweitert → Projekt **XOR** `service_auftrag_id`.

**Zentrale Enforcement-Helfer:** `assertProjektAccess` / `assertServiceAccess` (write-Flag; Partner=read-only, Techniker=Kette), `resolveMedienTarget` (Projekt XOR Service). Interne Marge-Felder erscheinen in keinem B/C-Payload.

**Verifikation:** `scripts/test_medien_service.mjs` — Mock-basiert (echter Handler, kein Live-DB), **22 Enforcement-Checks × 5 Durchläufe = grün** (master/partner/techniker × list/upload/del/status/assign, inkl. Fremdzugriff→403, Partner-Upload→403, Stockwerk-Pflicht bei Projekt-Fotos). `node --check` grün.

**Noch offen (nach SQL-Einspielen):** UI (Galerie/Upload-Maske, Service-Cockpit) und ggf. Voice→svc_create; sind separate Design-Runden.

---

**STATUS BLOCK 4:** API für B & C gebaut + getestet (Mock, 22×5).

---

## 10. BLOCK 5 — Live-Verifikation gegen echte Supabase (Schema eingespielt)

Schema von Emanuel eingespielt („Success, no rows"). Zwei Skripte:
- `scripts/verify_live_schema.mjs` — read-only: alle 6 Tabellen + neue Spalten live vorhanden ✅
- `scripts/verify_live_medien_service.mjs` — voller E2E gegen Live-DB: legt Testdaten an (Präfix `ZZVERIFY`), erzeugt **echte** Techniker-/Partner-JWTs (auth-admin + Passwort-Login), treibt den **echten** cockpit.js-Handler, räumt danach alles weg.

**Ergebnis: 29/29 Checks grün**, Prod-DB danach nachweislich sauber (0 Residuen). Belegt LIVE:
- **Enforcement-Kette greift:** Techniker sieht nur zugewiesenes ProjA, Fremd-ProjB fehlt in `tech_projekte`; `tech_projekt(ProjB)` → **403**; `medien_upload(ProjB)` → **403**.
- **Keine internen Felder** in der Techniker-Projektsicht (kein `stundensatz`/`kosten`).
- **Medien:** Foto-Upload (Stockwerk EG) + Video-Upload (1.OG, `dauer_sekunden`, **Thumbnail-Vorschau-URL**) landen in Bucket + `gs_projekt_medien`; Galerie **gruppiert nach Stockwerk** (EG + 1.OG); Stockwerk-Pflicht bei Projekt-Fotos greift; Partner-Upload → **403** (read-only), Partner-Fremdgalerie → **403**.
- **Service:** Partner erstellt Auftrag (`quelle=sprache`, `status=neu`); Techniker `svc_create` → **403**; zugewiesener Techniker `angenommen→erledigt` (setzt `erledigt_am`); Partner-Statuswechsel → **403**; Techniker auf fremden Auftrag (`svc_detail`/`medien_upload`) → **403**.

*(Master-only-Übergänge/`svc_assign` sind durch den Mock-Suite abgedeckt; live nicht getrieben, weil dafür ein JWT der echten MASTER_UID nötig wäre — bewusst nicht impersoniert.)*

---

**STATUS BLOCK 5:** Live verifiziert (33/33 inkl. Video-Direktupload), Prod-DB sauber. Backend A/B/C scharf.

---

## 11. BLOCK 6 — Techniker-UI (schwarz-gold), schließt das System

Drei Teile, alle committet:
- **Teil 1 (Master):** `api/admin.js createUser(role=techniker)` legt `gs_techniker`-Profil an (+ `erstellt_von_user_id`, Vorbereitung „Partner legt eigene Techniker an") und verschickt branded **Magic-/Recovery-Einladung** (`generate_link` + `lib/mail.js technikerInviteHtml`), Temp-PW als Fallback. Maske in `gs-intern.html` (Qualifikation-Feld, Mail-Status). SW `cockpit-sw.js` v12→**v13**. SQL: `scripts/techniker_erstellt_von.sql` (additiv).
- **Teil 2 (Login/Onboarding):** bestehender Login/PW-Change/Profil-Setup wiederverwendet; `applyRole` techniker → `initTechCockpit()`; dezente 3-Karten-Tour (einmalig).
- **Teil 3 (Cockpit):** neues `#tech-cockpit` in `app.html` (Palette #0A0A0B/#C9A961, Vorlage Partner-Shell). Nav Projekte/Service/Rapport/Profil; nur zugewiesene Projekte; Rapport **frei rückdatierbar**; **Foto** (komprimiert) + **Video** (Direktupload sign→PUT→register) mit **Stockwerk-Tagging**; **Galerie gruppiert nach Stockwerk**; Service-Flow (erledigt). Keine Marge-Felder.
- **Backend-Zusatz:** `cockpit.js` `medien_sign_upload` + `medien_register` (Video umgeht 4,5-MB-Body-Limit).

**Tests:** Mock-Enforcement 27×5 grün; Live 33/33 grün (inkl. Video-Direktupload), Prod sauber; app.html-JS `node --check` grün. **Manueller Durchlauf:** `scripts/TESTLEITFADEN_TECHNIKER.md`.

**Vor dem manuellen Test nötig:** Branch→main (Deploy), `scripts/techniker_erstellt_von.sql` einspielen, Redirect-URL `…/login` in Supabase allowlisten.

---

**STATUS:** Techniker-UI fertig (Teil 1–3). Damit ist die letzte Nicht-GS-Ansicht im schwarz-gold Look — System geschlossen. Offen (spätere Runden): Mail-Ingest für Service-Aufträge, Voice→`svc_create`, „Partnerfirma legt eigene Techniker an" (Berechtigungslogik).
