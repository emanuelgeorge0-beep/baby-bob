# Datei-Upload – Diagnose (Block 1, Branch fix/datei-upload)

## Kompletter Upload-Pfad

### Frontend
- **Partner-Cockpit (`app.html`)**
  - Projekt-Dateien: `pmFileUpload` / `pmDoUpload` → `pmApi('pm_datei_upload', …)` — `app.html:8071–8095`
  - Sub-/Akkord-Dateien: `subFileUpload` / `subDoUpload` → `pmApi('sub_datei_upload', …)` — `app.html:8470–8495`
  - Firmenlogo: `pdDoLogoUpload` → `pmApi('pm_logo_upload', …)` — `app.html:8784–8798`
  - Client-Limit: `UPLOAD_MAX_MB = 3` — `app.html:8070` (Checks: 8085, 8485)
- **Master-Cockpit (`gs-intern.html`)**
  - `openDateiUpload` / `pmUploadFiles` → `api('pm_datei_upload', …)` — `gs-intern.html:1633–1661`
  - Client-Limit: 12 MB — `gs-intern.html:1647` (NICHT auf 3 MB angepasst)

### Backend (`api/cockpit.js`)
- Routing: `pm_datei_upload` / `sub_datei_upload` → `pmDateiUpload()` — `api/cockpit.js:223, 240`; `pm_logo_upload` → `partnerLogoUpload()` — `:233`
- Kern-Upload: `pmDateiUpload()` — `api/cockpit.js:2100–2123`
- Ziel: **Supabase Storage-Bucket `projektdateien`** — `api/cockpit.js:2096`; Pfad `${projektId}/${kategorie}/${stamp}-${name}`
- Zugriffs-Gating: `PM_ACTIONS` (Entitlement `projektmanagement`) — `:66–73`; `sub_datei_upload` (Entitlement `sub_akkord`) — `:81`
- Server nutzt `service_role`-Key → **RLS wird umgangen** (kein RLS-Problem beim Schreiben)
- base64-Dekodierung inkl. Data-URL-Präfix-Strip: `sbDecodeB64` — `:2736–2739` (korrekt)
- Bucket-Anlage: `scripts/projekt_detail_scharf.sql:38–40`

## Verdacht geprüft – NICHT bestätigt
Der Verdacht war: die Umleitung der Sende-Wege über die Prüf-Ansicht bzw. die
Kalkulator-Angebot-Entkopplung (runde8a) habe den Upload abgehängt.

**Verifiziert per Diff (`git diff de517fd..ead39c1`):** runde8a änderte nur
- `msub_angebot_quick_send` → `msub_angebot_save`+`msub_angebot_send` (Angebots-Versandweg),
- drei Pflicht-Häkchen in der Prüf-Ansicht,
- Soft-Delete `geloescht_at`.

**Kein einziger dieser Diffs berührt den Datei-Upload-Pfad** (`pmDateiUpload`,
`pm_datei_upload`, `openDateiUpload`/`pmUploadFiles`/`pmDoUpload`). Der Verdacht ist damit widerlegt.

## Tatsächliche, code-belegte Ursache
Der einzige jüngste Eingriff in den Upload ist **runde7 block2 (Commit `41189d5`)**:
Das Client-Limit im Partner-Cockpit wurde von **12 MB → 3 MB** gesenkt
(`app.html:8070`, `UPLOAD_MAX_MB=3`), um Vercels ~4,5 MB Body-Limit einzuhalten.

Folge: Normale Baustellen-Fotos (Handy: 3–9 MB) und PDF-Pläne (>3 MB) werden jetzt
clientseitig mit „… zu gross (max. 3 MB)" abgewiesen → aus Nutzersicht „Upload
funktioniert nicht mehr". Das Master-Cockpit (`gs-intern.html:1647`) hat weiterhin
12 MB und läuft dort in einen stillen 413 (Body zu gross) von Vercel.

### Alternative Ursache (nur falls Totalausfall bei JEDER Grösse)
Bucket `projektdateien` fehlt in der aktuellen Supabase-Umgebung → Backend meldet
„Bucket 'projektdateien' fehlt – scripts/projekt_detail_scharf.sql ausführen." In
dem Fall ist der Fix eine SQL-Ausführung (nach `scripts/`), kein Code.

## Geplanter minimaler Fix (Block 2) — abhängig vom Symptom
- **Fall A (Meldung „zu gross (max. 3 MB)")**: Upload nicht mehr als ein Riesen-
  JSON durch die Function schicken, sondern direkt-zu-Storage mit signierter Upload-
  URL — ODER, minimalst: clientseitige Bild-Komprimierung vor dem Upload, damit
  Fotos unter das Limit kommen. Master-Cockpit (12 MB) an dieselbe Grenze angleichen.
- **Fall B (Bucket fehlt / „Bucket … fehlt")**: `scripts/projekt_detail_scharf.sql`
  in Supabase ausführen (SQL-only, wird nicht von mir ausgeführt).
- **Fall C (anderer Fehlertext / 403 / gar nichts)**: gezielt an diesem Fehler ansetzen.
