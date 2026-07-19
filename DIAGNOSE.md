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

**STATUS:** BLOCK 2 = Feature A (Backend) umgesetzt. Keine SQL ausgeführt. Warte auf Freigabe für Feature B/C.
