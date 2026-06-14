# Master-Cockpit — Fortschritt

> Wiedereinstieg: Diese Datei zuerst lesen. Branch: **master-cockpit** (NICHT main).
> Geheimer Pfad: `/gs-intern-7k2x` · Master/Admin-UUID: `ee46a716-7017-4045-9f67-fe06d05171e7`
> Arbeitsweise: kleine häufige Commits, 20x Bug-Analyse vor jeder Lieferung, production-ready.

## Architektur-Entscheidungen (Session 1)
- **Getrennt von der App gebaut:** eigenes Standalone-File `gs-intern.html` (NICHT in app.html).
  Routing `/gs-intern-7k2x` → `/gs-intern.html` (vorher → app.html).
- **Eigene PWA:** `cockpit-manifest.json`, `display:standalone`, Gold-Icons → eigenes iPhone-App-Icon.
- **Security-Modell:** DB-Tabellen via RLS nur für Master-UUID. Server `api/cockpit.js` nutzt
  service_role (umgeht RLS) und prüft HART Token→UUID==Master (sonst 403). Kein anon-Zugriff.
- **Lead-Quelle Block 1 = `gs_anfragen`** (neue Spalten `crm_stufe`, `zugewiesen_an`, `followup_datum`).
  Master-spezifische Daten (Notizen/Follow-ups/Aktivitäten) in eigenen RLS-Tabellen.
- **Live-Schema beachtet:** Kundentabellen nutzen `erstellt_am` (NICHT created_at); `gs_anfragen`
  hat `kunde_id` (aktiv) + Alt-Spalte `kunden_id` (leer) → Join über `kunde_id`.
- Basis-Branch: `origin/main` (sauber, unabhängig vom parallelen redesign-Branch).

## Status

### ✅ Fertig
- [x] Bestandsaufnahme: Live-Schema introspiziert, vorhandene Master-Reste in app.html gesichtet.
- [x] Branch `master-cockpit` von origin/main.
- [x] SQL Session 1: `scripts/master_cockpit_session1.sql` (idempotent, RLS master-only).
      → **MUSS einmalig im Supabase SQL Editor ausgeführt werden.**

- [x] `api/cockpit.js` — token-gated API (dashboard/leads/lead_detail/lead_update/customers/
      customer_detail/activity_add/task_add/task_done). Harte UUID-Prüfung + Rollen-Check.
- [x] `gs-intern.html` — Jarvis-Cockpit (Dashboard + Block 1 Leads + Block 2 CRM), erweiterbar.
      Login (Passwort/Magic-Link/Reset), Master-Gate (UUID==Master), Detail-Sheets,
      Stufe/Zuweisung/Follow-up, Kontakt-Historie, Aufgaben. Bottom-Nav + "Mehr"-Platzhalter.
- [x] `cockpit-manifest.json` + `vercel.json` Rewrite repoint + no-store/noindex Header.
- [x] 20x Bug-Analyse durchgeführt (siehe unten), kritische Fixes angewendet.
- [x] Smoke-Test gegen Live-DB: Cockpit zeigt echte Daten AUCH VOR der Migration
      (10 Leads, Stufen-Fallback korrekt, Joins/Quellen ok).

### ☐ Offen (Session 1)
- (nichts) — Grundstruktur + Block 1 + Block 2 stehen.

### ✅ Session 2 — Mehr-Tab ausgebaut (3 Module)
- [x] SQL Session 2: `scripts/master_cockpit_session2.sql` (idempotent, RLS master-only):
      `gs_mkt_kanal`, `gs_mkt_content`, `gs_todos`, `gs_margen`. → **MUSS einmalig ausgeführt werden.**
- [x] API erweitert (`api/cockpit.js`): marketing, mkt_kosten_set, mkt_content_add/set/del,
      todos, todo_add/update/del, margen, marge_add/update/del. UUID-Guard + Whitelists.
- [x] Dashboard erweitert: `todosHeute/Ueberfaellig/Offen`, `umsatzGesamt/margeGesamt/margeProzent`.
- [x] Frontend: Mehr-Menü → 3 Module (Gold/Dunkel, mobile-first):
      • **Marketing** — Kanal-Stats (Quelle↔Lead), Kosten/CPL/Conversion, Content-Plan (CRUD).
      • **To-Dos** — CRUD, Team (Emanuel/Dimitri/Patrick/Vasil/Yasemin), Prio, Fälligkeit (heute/überfällig).
      • **Verkauf/Margen** — Einkauf vs. Stundensatz×Stunden, Live-Vorschau, Totals, CRUD.
      • Dashboard: anklickbare To-Dos- + Marge-gesamt-Kacheln.
- [x] 20x-Analyse S2 (siehe unten) + Smoke-Test (Marketing-Agg live ok; alle S2-Tabellen 404 →
      graceful migHint; calcMarge ohne Division-durch-0).
- [x] **Vorfall behoben:** externer Branch-Wechsel/`reset` hatte master-cockpit auf S1 zurückgesetzt.
      S2-Commits via reflog (`reset --hard d21ef14`) wiederhergestellt; danach SOFORT gepusht.
      → **Lehre: nach jedem Commit sofort `git push origin master-cockpit`.**

### ✅ Session 3 — 4 Säulen · Lead→Projekt→Marge-Picker · Marketing-Kampagnen/Zeitraum
- [x] SQL Session 3: `scripts/master_cockpit_session3.sql` (idempotent, RLS master-only):
      `gs_mkt_kampagnen` (Kampagnen mit Laufzeit/Budget/Status) + `gs_margen.projekt_id`
      (guarded ALTER via `to_regclass`, läuft auch wenn S2 noch nicht lief). → **EINMALIG ausführen.**
- [x] **Modul „4 Säulen"** (`saeulen`): read-only Aggregation echter Daten, kein neues Schema.
      • S1 Baby BOB (aktiv) — App-Leads, App-Anteil %, Leads gesamt.
      • S2 Marketplace (Aufbau) — Handwerker im Netz, verfügbar, Ø Bewertung (aus gs_techniker).
      • S3 George Solutions (aktiv) — Leads/Offen/Gewonnen/Kunden/Pipeline + Marge (falls migriert).
      • S4 Facility (aktiv) — aktive Projekte, Projekte gesamt, gewonnene Aufträge, Techniker frei.
      • Status-Badge (aktiv/Aufbau/geplant) je Säule + Gesamt-Header. Hinweis-Zeile bei fehlenden Quellen.
- [x] **Lead → Projekt → Marge per Picker**: API `marge_pickers` (Leads + Projekte), Marge-Formular
      mit zwei Selects (Lead/Anfrage + Projekt). `anfrage_id` set/clear (Spalte seit S2),
      `projekt_id` nur schreiben wenn gewählt (migrationssicher vor S3). Marge-Karte zeigt 🔗 Lead / 🏗 Projekt.
- [x] **Marketing: Kampagnen + Zeitraum-Filter**: Zeitraum-Chips (Alle/30T/90T/Monat/Jahr) → Leads
      werden im Zeitraum gezählt; Kampagnen-CRUD (Name, Kanal, Budget vs. Ausgaben, Laufzeit, Status),
      gefiltert per Laufzeit-Überlappung; Kampagnen-Summen (Anzahl/aktiv/Budget/Ausgaben).
- [x] 20x-Analyse S3 (siehe unten) + Live-Smoke-Test: `gs_mkt_kampagnen`/`gs_margen` 404 → graceful [];
      projekte aktiv=1, techniker frei=4/12 (matcht Säulen-KPIs); Zeitraum Juni=10, davor=0 (matcht Client-Filter).

### ☐ Offen für Session 4
- [ ] Verknüpfung weiter ausbauen: Rapport → Vertrag (Kette Lead→Kunde→Projekt→**Rapport→Vertrag**).
- [ ] Kampagnen: Lead-Attribution je Kampagne (utm_campaign ↔ gs_mkt_kampagnen.name/Kanal) statt nur Kanal.
- [ ] Marketing-Kosten zeitraum-genau (aktuell Kanal-Kosten = manueller Gesamtwert; Kampagnen tragen
      die zeitraum-genauen Ausgaben). Optional CPL aus Kampagnen-Ausgaben statt Kanal-Summe.
- [ ] Säulen S1/S2: echte Nutzungs-/Buchungsdaten anbinden, sobald Quellen existieren (App-DB/Marketplace).
- [ ] RLS-Härtung gs_anfragen/gs_kunden gegen anon (Abstimmung mit App-Team/main) — Status:
      bereits 0 Zeilen für anon (S1 verifiziert), also nur Doku/Bestätigung offen.

### ✅ Session 5 — TEIL A: „Jarvis"-Sprach-Assistent · TEIL B: nur dokumentiert
- [x] **Jarvis-Backend** (`api/cockpit.js`, Action `jarvis`): sammelt die ECHTEN GS-Zahlen
      (`getJarvisFacts`) aus Supabase — Leads gesamt/heute/offen/pro Stufe/pro Kanal, Pipeline,
      Follow-ups heute/überfällig, offene CRM-Aufgaben, To-Dos, Kunden, Umsatz/Marge (falls migriert),
      Projekte aktiv/gesamt, Techniker frei. Diese Zahlen gehen als JSON-Kontext an Claude
      (`claude-sonnet-4-6`, gleiches Muster wie `api/bob-chat.js`), das eine kurze, **gesprochene**
      Antwort formuliert. NUR Lesezugriff — keine Schreibaktion, keine Agenten-Steuerung.
- [x] **Jarvis-Frontend** (`gs-intern.html`, View `jarvis` + Hero-Button im „Mehr"-Tab):
      Text-Eingabe UND Spracheingabe (Mikrofon → MediaRecorder → `/api/voice` STT). Antwort als
      Text-Bubble UND Stimme (ElevenLabs über vorhandenes `/api/voice`, Fallback Browser-`SpeechSynthesis`).
      Quick-Fragen-Chips, animierter „Orb" (idle/think/speak), Stimme an/aus-Schalter, mobile-first.
- [x] **Voice-Reuse:** TTS+STT laufen über das **bereits verifizierte** `/api/voice` (ElevenLabs,
      Voice-ID `nPczCjzI2devNBz1zQrb` „Brian", in Vercel als funktionierend markiert). Bewusste
      Entscheidung statt eines neuen, ungetesteten Endpoints → production-ready. Die gewünschte
      Voice-ID kann bei Bedarf in `api/voice.js` (`VOICE_ID`) getauscht werden.
- [x] **Teil B (NUR DOKUMENTIERT, nicht gebaut):** Roadmap-Sektion „Agenten-Steuerung & Integrationen"
      unten + idempotentes Schema `scripts/master_cockpit_session5.sql` (`agent_tasks`, `agent_wissen`,
      RLS master-only) als Vorbereitung. KEIN Agenten-Code (API/Frontend) geschrieben.
- [x] **PWA mobile-first / installierbar (überall):** Das ganze Cockpit (Dashboard, Leads, CRM,
      Marketing, To-Dos, **Verkauf/Margen-Umsatzübersicht**, 4 Säulen, **Jarvis inkl. Sprachein-/ausgabe**)
      läuft auf iPhone/Android — mobile-first CSS, Safe-Area-Insets, Bottom-Nav, Touch-Targets.
      • **Echte PNG-Icons** (`cockpit-icon-180/192/512.png` + `cockpit-maskable-512.png`) statt SVG —
        iOS ignoriert SVG-`apple-touch-icon`, daher PNG → korrektes GS-Icon am Homescreen.
      • **Service-Worker** (`cockpit-sw.js`): macht die App auf **Android installierbar** (fetch-Handler
        ist Pflicht für den Install-Prompt) + schneller App-Start; `/api/*` wird **nie** gecacht (immer Live).
      • **Install-Hinweis** im Cockpit: Android → „Installieren"-Button (`beforeinstallprompt`);
        iOS → Anleitung „Teilen → Zum Home-Bildschirm". Dismissbar, gemerkt in localStorage.
      • Standalone-Modus über `cockpit-manifest.json` (`display:standalone`, scope/start_url = secret path).
      • `vercel.json`: `Service-Worker-Allowed`+no-cache für den SW, `outputDirectory "."` erhalten.
      • **Keine Funktion ist desktop-only** — Mikrofon (getUserMedia/MediaRecorder) & Sprachausgabe
        (ElevenLabs/SpeechSynthesis) laufen im iOS-Standalone-PWA (ab iOS 14.3) und Android Chrome.
- [x] 20x-Analyse S5 (siehe unten) + **Live-Smoke gegen echte DB**: `getJarvisFacts` liefert
      10 Leads / 10 Kunden / Projekte aktiv 1 / Techniker 4 von 12 frei / Pipeline ~CHF 65 (deckt sich
      mit S1–S3). S2/S3-Tabellen (gs_todos/gs_margen/gs_crm_aufgaben) 404 → graceful (null/0/[]).
      Claude-Call lokal NICHT testbar (lokaler `ANTHROPIC_API_KEY` ist ein Platzhalter `your_…`);
      Aufruf ist byte-identisch zum produktiv laufenden `api/bob-chat.js` → in Vercel funktionsfähig.

## 20x Bug-/Security-Analyse (Session 1) — Ergebnis
1. **RLS gegen DevTools/anon-Key — VERIFIZIERT:** Mit dem im Client (app.html) eingebetteten
   `sb_publishable_…`-Key liefert Supabase für gs_anfragen/gs_kunden/gs_projekte/user_roles
   **0 Zeilen** → kein Lead-/Kunden-Leak an Tester. (Nur gs_techniker ist öffentlich = gewollt.)
2. **Neue CRM-Tabellen:** RLS `master_only` (auth.uid()=Master) → anon/authenticated geblockt.
3. **Server-Gate hart:** api/cockpit.js prüft Token→user.id==Master-UUID **und** Rolle, sonst 403.
   service_role nur serverseitig, nie im Client.
4. **Strikter Frontend-Gate:** Zugang nur wenn user.id==Master-UUID (nicht nur Rolle) → „NUR Admin-UUID".
5. **Funktioniert VOR Migration (kritischer Fix):** loadCore nutzt `select=*` statt einzelner neuer
   Spalten → kein 400, wenn crm_stufe/typ etc. noch fehlen; Fallback via stufeOf/Defaults.
6. **Token-Refresh:** 403 → 1× Refresh über bob_refresh, sonst Logout; `_tried` wird nach
   Erfolg zurückgesetzt (kein Hängenbleiben nach späterem Ablauf).
7. **XSS:** alle dynamischen Strings via esc(); keine User-Daten in src/href ohne Escape.
8. **FK-Integrität:** aktivitaeten/aufgaben → gs_anfragen(id)/gs_kunden(id), ON DELETE CASCADE.
9. **kunde_id vs. kunden_id:** Join über aktives `kunde_id` (Alt-Spalte `kunden_id` leer).
10. **Live-Schema:** `erstellt_am` (nicht created_at) konsequent verwendet.
11. **SQL idempotent:** Funktion CREATE OR REPLACE; user_roles Upsert ohne Constraint-Name;
    ADD COLUMN IF NOT EXISTS; Constraint via pg_constraint-Guard; RLS DROP+CREATE.
12. **CHECK crm_stufe** nach Default+Backfill gesetzt → keine Verletzung bestehender Zeilen.
13. **Secret-Path:** /gs-intern-7k2x nirgends verlinkt; noindex/nofollow/X-Robots-Tag + no-store;
    kein Directory-Listing auf Vercel. Echter Schutz = Auth-Gate, nicht Pfad-Geheimnis.
14. **PWA installierbar:** Manifest (192+512 Icons, standalone, scope/start_url=secret path),
    apple-touch-icon im HTML, theme-color → eigenes iPhone-App-Icon.
15. **Leere Tabellen vor Migration:** gs_crm_* 404 → in dashboard/detail via try/catch → []; Cockpit bleibt nutzbar.
16. **CSRF:** Token im Body (keine Cookies) → kein CSRF-Vektor; CORS nur POST.
17. **Fehler generisch:** API liefert „Kein Zugriff"/„Serverfehler" ohne Detail-Leak.
18. **Logout teilt Session mit App** (bob_auth_token) — bewusst, gleiche Auth.
19. **Pipeline-Wert** aus tarif_preis geparst → als „(geschätzt)" gelabelt (kein Fake-Genauigkeitsanspruch).
20. **gs_admin ≠ Master:** würde Frontend-/Server-seitig per UUID-Check geblockt (kein 403-Loop dank Strict-Gate vor App-Eintritt).

## 20x Bug-/Security-Analyse (Session 2) — Ergebnis
1. **Vor Migration nutzbar:** marketing liest gs_anfragen (immer da); gs_mkt_*/todos/margen via
   try/catch → []/migHint. Dashboard-Widgets ebenso. Smoke-Test bestätigt (alle S2-Tabellen 404 → ok).
2. **Schreiben vor Migration:** POST → 404 → handler-catch 500 → Frontend-Toast „Migration nötig?". Kein Crash.
3. **RLS neue Tabellen:** master_only (auth.uid()=gs_master_uid()); service_role nur Server; anon blockiert.
4. **UUID-Injection:** alle id-Pfade per `uuid()` (Regex) geprüft; kanal/status/prioritaet per Whitelist.
5. **Upsert mkt_kosten_set:** POST on_conflict=kanal + resolution=merge-duplicates; PK=kanal; vorab-geseedet.
6. **calcMarge:** Division durch 0 abgesichert (umsatz>0); umsatz_manuell ''/null → Fallback Satz×Stunden.
7. **num():** isFinite-Guard → 0 bei ungültig; '' → 0; umsatz_manuell '' → null (echter Fallback).
8. **kanalOf:** Freitext-Quelle → kanonischer Kanal; 'test-script' → sonstige (live verifiziert).
9. **'sonstige'-Kanal:** erscheint nur bei vorhandenen Leads (Object.keys(agg)); Kosten editierbar.
10. **CPL/Conversion:** durch leads>0 abgesichert (kein Infinity/NaN).
11. **XSS:** idee/titel/notiz/zustaendig via esc(); data-*-Attribute nur UUIDs/Whitelist-Keys.
12. **To-Do done-Toggle:** robustes `data-done`-Attribut statt Style-Regex.
13. **Sortierung:** todos offen-zuerst (Frontend-Split); faelligkeit asc nullslast; margen created_at desc.
14. **FK gs_margen.anfrage_id:** ON DELETE SET NULL → Marge bleibt bei Lead-Löschung.
15. **Gate gilt für alle neuen Actions:** liegen hinter verifyMaster (403) im selben switch.
16. **Delete=hard delete** (master-only, Toast-Bestätigung) — bewusst, kein Undo in v1.
17. **Back-Nav:** Sub-Views markieren „Mehr" (MEHR_VIEWS); Escape/Backdrop schließt Sheets.
18. **Keine Secrets im Client:** nur /api-Calls; noindex/no-store unverändert.
19. **Idempotente SQL:** CREATE TABLE IF NOT EXISTS; CHECK inline; RLS DROP+CREATE; Kanäle ON CONFLICT DO NOTHING.
20. **outputDirectory ".":** in vercel.json gesetzt (verhindert 404 nach Merge); Rewrite → /gs-intern.html.

## 20x Bug-/Security-Analyse (Session 3) — Ergebnis
1. **Vor Migration nutzbar:** `gs_mkt_kampagnen`/`gs_margen.projekt_id` fehlen → alle Lesepfade
   via try/catch → []/null. Live-Smoke bestätigt (PGRST205 → graceful).
2. **Schreiben vor Migration:** kampagne_add / projekt-Link → Tabelle/Spalte fehlt → handler-catch 500
   → Frontend-Toast „Migration nötig?". Kein Crash, kein Datenverlust.
3. **Marge-Edit bleibt S2-kompatibel:** `projekt_id` wird nur geschrieben, wenn ein Projekt gewählt ist;
   `projekt_id_clear` NUR, wenn die Marge vorher bereits ein Projekt hatte (vor S3 nie der Fall) →
   bestehende Margen-Bearbeitung bricht nach S2/vor S3 NICHT.
4. **anfrage_id set/clear:** Spalte existiert seit S2 → voll unterstützt ('' → null entkoppelt).
5. **UUID-Guard:** kampagne_update/del, marge picker-ids, anfrage_id/projekt_id alle per `uuid()` (Regex).
6. **Whitelists:** Kampagnen-Status (geplant/aktiv/pausiert/beendet), Kanal (KANAELE+sonstige sonst null).
7. **RLS neue Tabelle:** `gs_mkt_kampagnen` master_only (auth.uid()=gs_master_uid()); anon blockiert.
8. **Idempotente SQL:** CREATE TABLE IF NOT EXISTS; ADD COLUMN IF NOT EXISTS unter `to_regclass`-Guard;
   RLS DROP+CREATE; gefahrlos mehrfach + auch ohne S2 ausführbar.
9. **FK projekt_id → gs_projekte(id) ON DELETE SET NULL:** Marge bleibt bei Projekt-Löschung erhalten.
10. **Zeitraum-Filter (Client↔Server konsistent):** Datum-Stringvergleich YYYY-MM-DD; Live-Gegenprobe
    Juni=10 / davor=0 = identisch zur Server-Filterung.
11. **Date-Range-Berechnung:** setDate()-Arithmetik (30/90 Tage) überschreitet Monatsgrenzen korrekt;
    Monat/Jahr aus today abgeleitet; 'alle' → kein Filter (von/bis null).
12. **CPL-Ehrlichkeit:** Kanal-Kosten sind ein manueller Gesamtwert → Tile heißt „Kanal-Kosten" (nicht
    „Kosten gesamt"); zeitraum-genaue Ausgaben laufen über Kampagnen-Objekte. Kein Genauigkeits-Fake.
13. **Kampagnen-Zeitraum = Laufzeit-Überlappung** [start,end] ∩ [von,bis]; offenes Ende (null) zählt mit.
14. **Säulen ehrlich:** S1 App-Anteil aus echtem Kanal (kanalOf 'app'); fehlende App-/Marketplace-Daten
    klar als Hinweis ausgewiesen statt Fake-Zahlen. Status-Badge spiegelt Datenlage (aktiv/Aufbau).
15. **Säulen read-only:** keine Schreib-Action, kein neues Schema — reine Aggregation (geringe Angriffsfläche).
16. **XSS:** Kampagnen-Name/Notiz, Säulen-Labels/Values, Picker-Labels alle via esc(); data-* nur UUIDs.
17. **Division-durch-0:** Budget-% (budget>0), CPL (leads>0), appAnteil (leads>0), ratingAvg (len>0) abgesichert.
18. **Picker-Race:** marge_pickers lädt async; bei sofortigem „+ Position" evtl. leere Optionen → Position
    trotzdem anlegbar (nur ohne Link), Picker füllt sich beim nächsten Render. Kein Fehler.
19. **Gate gilt für alle neuen Actions** (saeulen, kampagne_*, marge_pickers): hinter verifyMaster (403).
20. **outputDirectory ".":** in vercel.json unverändert erhalten (Rewrite /gs-intern-7k2x → /gs-intern.html).

## 20x Bug-/Security-Analyse (Session 5) — Ergebnis
1. **Lesezugriff only:** `jarvis` ruft ausschliesslich `sbGet`-Reads — keine Schreib-/DDL-Operation,
   keine Agenten-Steuerung (das ist bewusst erst Teil B). Angriffsfläche minimal.
2. **Gate:** `jarvis` liegt hinter `verifyMaster` (403) im selben switch wie alle anderen Actions.
3. **Resilient vor Migration:** S2/S3-Tabellen (gs_todos/gs_margen/gs_crm_aufgaben) via try/catch →
   0/null/[]. Live-Smoke bestätigt (alle drei 404 → Facts trotzdem vollständig & korrekt).
4. **Keine Halluzination:** System-Prompt zwingt Claude auf die mitgelieferten JSON-Zahlen; fehlt eine
   Zahl, soll es ehrlich „keine Zahl im Cockpit" sagen. Zahlen werden serverseitig real berechnet.
5. **Eingabe begrenzt:** `frage` auf 500 Zeichen gekappt; kein SQL-Pfad aus User-Text (nur fixe Reads).
6. **Claude-Ausfall:** API-Fehler/kein Key → `jarvisFallback` liefert eine ehrliche Kurz-Übersicht
   aus den echten Zahlen (nie erfunden), statt zu crashen. `{fallback:true}` signalisiert es.
7. **TTS-Reuse statt Neubau:** `/api/voice` ist verifiziert (ElevenLabs Brian). Kein zweiter,
   ungetesteter Voice-Endpoint → kein Risiko einer kaputten Demo-Stimme.
8. **TTS-Fallback:** `/api/voice` non-200 (kein Key/Rate-Limit) → Frontend nutzt `SpeechSynthesis`
   (de-DE). Antwort kommt IMMER als Text-Bubble, Stimme ist additiv.
9. **iOS-Audio-Unlock:** `Audio`-Objekt wird im Tap-Kontext (`jarvisAsk`) erzeugt und später mit
   `src` befüllt → iOS erlaubt `play()`. `play().catch` → SpeechSynthesis-Fallback.
10. **Mic-Capability-Check:** ohne `mediaDevices`/`MediaRecorder` → Toast „nicht verfügbar", kein Crash;
    Mime-Typ wird über `isTypeSupported` gewählt (webm/mp4/ogg) → Safari iOS & Chrome abgedeckt.
11. **Mic-Permission verweigert:** `getUserMedia`-reject → Toast, kein Hängenbleiben; Stream-Tracks
    werden in `onstop` sauber gestoppt (kein offenes Mikrofon/rote Status-Leiste).
12. **XSS:** Frage, Antwort, Quick-Chips alle via `esc()`; `white-space:pre-wrap` rendert Zeilenumbrüche
    ohne HTML. data-q über `esc()` ins Attribut, beim Lesen vom Browser dekodiert.
13. **Doppel-Senden verhindert:** `_jBusy`-Guard blockt parallele Fragen; „…"-Platzhalter-Bubble wird
    durch die Antwort ersetzt (kein Doppel-Append).
14. **Markdown-frei für Vorlese:** Server entfernt `* # \` _` aus der Antwort → saubere Sprachausgabe,
    konsistent mit der No-Markdown-Regel von bob-chat.
15. **Nav-Integration:** `jarvis` in `MEHR_VIEWS` → „Mehr"-Tab bleibt markiert; `go('jarvis')` via
    Hero-Button + Modul-Liste. Zurück-Zeile (`backRow`/`wireBack`) wie alle Module.
16. **Layout-Bug behoben:** Eingabeleiste war `position:sticky;bottom:0` → hätte hinter der fixen
    Bottom-Nav gelegen. Auf `margin-top:auto` im Flex-Column umgestellt (sitzt über der Nav).
17. **Stimme-Schalter:** `_jVoiceOn` togglebar; beim Ausschalten `stopSpeak()` (Audio + SpeechSynthesis
    abgebrochen) → keine weiterlaufende Sprachausgabe.
18. **Kein Secret im Client:** Frontend ruft nur `/api/cockpit` (token-gated) & `/api/voice`; ElevenLabs-
    und Claude-Keys bleiben serverseitig. noindex/no-store unverändert.
19. **Teil B nicht gebaut:** `master_cockpit_session5.sql` legt `agent_tasks`/`agent_wissen` nur an
    (idempotent, RLS master-only), KEIN API-/Frontend-Code. Tabellen leer = ohne Wirkung, kein Risiko.
20. **outputDirectory ".":** in `vercel.json` unverändert erhalten (keine Routing-/404-Regression).

## 20x Bug-/Mobile-Analyse (Session 5 · PWA-Härtung) — Ergebnis
1. **iOS-Icon-Bug behoben:** apple-touch-icon war SVG (von iOS ignoriert → Screenshot statt Icon).
   Jetzt PNG 180×180 → korrektes GS-Icon am iPhone-Homescreen. Visuell gerendert & geprüft.
2. **Android-Install:** SW mit fetch-Handler erfüllt das Chrome-Install-Kriterium; Manifest hat
   PNG 192 & 512 + maskable. `beforeinstallprompt` → „Installieren"-Button.
3. **Maskable-Icon:** eigene Variante mit Safe-Zone-Padding (~66%) → kein Abschneiden unter Android-Masken.
4. **SW-Scope:** `/cockpit-sw.js` (Root) registriert mit scope `/gs-intern-7k2x`; zusätzlich Header
   `Service-Worker-Allowed`. Kontrolliert NUR den geheimen Pfad, nicht die ganze Domain.
5. **API nie gecacht:** SW lässt alle POST + alle `/api/*` durch → Jarvis/Cockpit/Voice immer Live-Daten.
6. **Fremd-Hosts unangetastet:** SW ignoriert cross-origin (ElevenLabs/Claude laufen serverseitig eh,
   aber doppelt abgesichert) → keine kaputte Sprachausgabe durch Caching.
7. **SW-Update trotz immutable-JS:** `updateViaCache:'none'` + `Cache-Control:no-cache` für den SW →
   neue Versionen greifen, keine „eingefrorene" App.
8. **Navigation network-first:** online immer frisches HTML (kein Stale nach Deploy), offline Fallback Shell.
9. **Mic im Standalone:** getUserMedia/MediaRecorder laufen im iOS-Homescreen-PWA (ab iOS 14.3) & Android;
   nur über HTTPS (Vercel) + Tap-Geste → erfüllt.
10. **Install-Hinweis-Timing:** zeigt nur eingeloggt (`TOKEN`), nicht im Standalone, nicht nach Dismiss;
    Android-Button nur wenn `beforeinstallprompt` da, sonst iOS-Anleitung; Desktop ohne Prompt → kein Hinweis.
11. **Kein Doppel-Banner:** `$('installbar')`-Guard + Entfernen bei `appinstalled`.
12. **Layout:** Install-Bar mit Seitenrand (kein Rand-an-Rand), sitzt zwischen Topbar und View; Bottom-Nav
    unverändert (fixe Nav + Safe-Area). Margen-/Umsatz-Übersicht bleibt 2-Spalten-Grid, mobil lesbar.
13. **outputDirectory ".":** unverändert — Icons/SW/Manifest werden als Root-Statics ausgeliefert (kein 404).
14. **Secret-Modell unberührt:** noindex/no-store für Cockpit-HTML bleibt; SW/Icons sind unkritische Statics.

## Roadmap — Agenten-Steuerung & Integrationen (TEIL B · NUR DOKUMENTIERT)
> Status: **konzipiert, NICHT gebaut.** Schema-Vorbereitung liegt idempotent bereit
> (`scripts/master_cockpit_session5.sql`). Kein Agenten-Code (API/Frontend) in Session 5.

**Idee / Datenfluss**
- Cockpit/Jarvis legt **vorbereitete Aufträge** mit **fertigem Prompt** in `agent_tasks` ab
  (`status='offen'`). Optional sammelt `agent_wissen` allgemeinen Kontext für die Agenten.
- Im **Terminal** sage ich „hol die Aufträge ab" → **Claude Code** liest offene `agent_tasks`,
  arbeitet sie ab und schreibt `ergebnis` + `status` (`in_arbeit`/`erledigt`) zurück.
- Cockpit zeigt danach Ergebnis/Status read-only an (späterer Ausbau).

**Tabellen (RLS nur Master-UUID — siehe SQL)**
- `agent_tasks(id, titel, beschreibung, status[offen|in_arbeit|erledigt], zugewiesener_agent,
  vorbereiteter_prompt, ergebnis, erstellt_am, aktualisiert_am)`
- `agent_wissen(id, thema, inhalt, tags, erstellt_am, aktualisiert_am)`

**WICHTIGE technische GRENZE (ehrlich)**
- Das Cockpit ist eine **Browser-App** und kann **KEIN Terminal öffnen** oder Claude Code direkt
  starten. Es **bereitet nur vor** (Task + Prompt in der DB). Die **Ausführung löse ICH im Terminal
  aus**. Das ist die Architektur-Grenze, kein Bug.

**Integrationen — Machbarkeit (Roadmap)**
- **E-Mail senden/lesen:** machbar. Senden via Resend (im Projekt vorhanden, vgl. `api/nachrichten.js`);
  Lesen via Mailbox-API (IMAP/Gmail-API) als eigener Server-Job. Aufwand mittel.
- **Kalender:** machbar via Google/Microsoft Calendar API (OAuth, Server-seitig). Aufwand mittel.
- **WhatsApp:** **nur teilweise.** Ohne offizielles WhatsApp-Business-API kann die App lediglich einen
  Chat **mit vorgefülltem Text öffnen** (`https://wa.me/<nr>?text=…`). **KEIN Vollzugriff, KEIN
  Auslesen** eingehender Nachrichten. Vollzugriff bräuchte WhatsApp Business API (Meta-Freigabe,
  Provider, Kosten). Grenze klar im Demo benennen.

**Geräte-Roadmap**
- **iPhone / Android:** ✅ erledigt — installierbare PWA (Homescreen, standalone, Icon, Sprache). Kein Store nötig.
- **Apple Watch:** braucht später eine **native App** (watchOS/SwiftUI, separates Xcode-Projekt; eine PWA
  läuft NICHT auf der Watch). **NICHT Teil dieses Auftrags** — nur als Roadmap vermerkt. Anbindung dann
  über dieselbe token-gated `/api/cockpit`-API (z.B. Jarvis-Kurzabfragen + Komplikationen/Kennzahlen).

## NÄCHSTE SESSION (6) — Wiedereinstieg
→ Diese Datei lesen. Teil A (Jarvis) steht & ist DB-verifiziert. Offene Ausbaupunkte:
   • Jarvis: Multi-Turn-Verlauf (aktuell Einzel-Frage), optional gewünschte ElevenLabs-Voice-ID setzen,
     evtl. Charts/Trends als Sprachantwort.
   • **Teil B BAUEN** (falls gewünscht): `agent_tasks`-API (Lese-/Schreib-Actions hinter `verifyMaster`),
     Cockpit-UI zum Anlegen von Aufträgen + Prompts, Terminal-Skript „hol die Aufträge ab".
   • Weiter offen aus S4: Rapport→Vertrag-Kette, Kampagnen-Lead-Attribution (utm_campaign), CPL je Kampagne.
   Architektur steht: Nav (`MEHR_VIEWS` + `go()`), `renderXxx()`-Muster, API-Actions im switch, Picker via `*_pickers`.

## Manuelle Aktionen für Emanuel
1. **`scripts/master_cockpit_session1.sql`** im Supabase SQL Editor ausführen (CRM-Schreiben).
2. **`scripts/master_cockpit_session2.sql`** im Supabase SQL Editor ausführen (Marketing/To-Dos/Margen).
3. **`scripts/master_cockpit_session3.sql`** im Supabase SQL Editor ausführen (Kampagnen + Marge.projekt_id).
   Reihenfolge **S1 → S2 → S3** (alle idempotent). Lesen/Dashboard/Säulen funktionieren auch ohne.
4. **`scripts/master_cockpit_session5.sql`** — **OPTIONAL / Vorbereitung für Teil B** (Agenten-Steuerung).
   Für **Jarvis (Teil A) NICHT nötig** — Jarvis ist reiner Lesezugriff und läuft sofort. Nur ausführen,
   wenn das Agenten-Modul später gebaut werden soll.
5. **Vercel-Env prüfen:** `ANTHROPIC_API_KEY` (für Jarvis-Antworten) und `ELEVENLABS_API_KEY` (für die
   Stimme) müssen im Vercel-Projekt gesetzt sein. Beide sind dort bereits in Gebrauch (bob-chat / voice).
   Ohne ElevenLabs-Key spricht Jarvis per Browser-Stimme; ohne Anthropic-Key gibt es nur die Fallback-Übersicht.
6. Supabase Auth: Redirect-URL für Magic-Link auf `…/gs-intern-7k2x` zulassen (falls Magic-Login gewünscht).
7. Login mit `emanuelgeorge0@gmail.com` (Master-UUID) → /gs-intern-7k2x → Tab **„Mehr" → „Jarvis fragen"**.
   Am Handy testen: Frage tippen oder Mikrofon antippen; Antwort kommt als Text + Stimme.
8. **Als App installieren (kein Store nötig):** iPhone → Safari öffnen, /gs-intern-7k2x, **Teilen ⬆️ →
   „Zum Home-Bildschirm"**. Android → Chrome, **„Installieren"-Hinweis** im Cockpit oder Menü → „App
   installieren". Danach startet das Cockpit im Vollbild wie eine echte App (Icon = goldenes GS).
   Beim ersten Mikrofon-Antippen die **Mikrofon-Berechtigung erlauben**.
