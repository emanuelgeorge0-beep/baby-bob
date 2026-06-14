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

### ✅ Session 6 — „MASTER GEORGE" Command-Center · Umsatz-Daten (Jarvis liest echte Zahlen)
- [x] **TEIL 1 · Umsatz-Tabelle** `scripts/master_cockpit_umsatz.sql` (idempotent, RLS master-only):
      `gs_umsatz_monat(id, jahr, monat 1–12, umsatz_chf, anzahl_projekte?, notiz?)`, UNIQUE(jahr,monat).
      Enthält einen **ausfüllbaren INSERT-Block** (Jan 2025 – Jun 2026, eine Zeile pro Monat, komplett
      auskommentiert + Schritt-für-Schritt-Anleitung, `ON CONFLICT (jahr,monat) DO UPDATE` → korrigierbar).
      → **EINMALIG im Supabase SQL Editor ausführen, dann die echten Zahlen eintragen.** SQL NICHT von mir ausgeführt.
- [x] **TEIL 1 · Jarvis liest Umsatz aus der DB** (`api/cockpit.js`): neuer Helper `getUmsatzStats()`
      (Gesamt, bester Monat, Umsatz dieses Jahr, Trend, Reihe pro Monat) fliesst in `getJarvisFacts` als
      `umsatz_pro_monat / umsatz_erfasste_monate_chf / umsatz_dieses_jahr_chf / bester_umsatzmonat /
      umsatz_daten_vorhanden`. System-Prompt zwingt Jarvis, Umsatzfragen NUR aus diesen Feldern zu
      beantworten und bei leerer Tabelle ehrlich „noch keine Umsatzdaten hinterlegt" zu sagen. Fallback
      ebenso. (Margen-Umsatz aus `gs_margen` sauber getrennt → Feld umbenannt zu `margen_umsatz_chf`.)
- [x] **TEIL 2 · Command-Center „MASTER GEORGE"** (`gs-intern.html`, `paintDashboard` neu): animierter
      Gold-Orb (rotierende Ringe + Puls + Sweep-Glow) mit Titel **MASTER GEORGE / COMMAND CENTER**,
      Live-Punkt + tickende Uhr. **Tap auf den Hero → Jarvis öffnet & Mikrofon startet sofort**
      (im Tap-Kontext → iOS/Android erlauben getUserMedia). 8 KPI-Kacheln mit **echten** Live-Zahlen:
      Leads gesamt, Follow-ups (heute/überfällig), Pipeline, Kunden, **Umsatz gesamt**, **bester Monat**,
      aktive Projekte, Techniker frei. Fehlt eine Quelle → ehrlich „—". **System-Status** (6 Module)
      ehrlich aus echten Daten abgeleitet (Aktiv/Bereit, KEINE erfundenen „17 Agenten"). **Umsatz-Mini-
      Chart** (Balken pro Monat) nur bei echten Daten. Darunter Pipeline-pro-Stufe + Quellen + To-Do/Marge.
- [x] Mobile-first/Hochformat: 2-Spalten-Grid, Safe-Area, Touch-Targets; Hero/Chart skalieren; reine
      CSS-Animationen (kein JS-Loop ausser 20-s-Uhr, die sich selbst stoppt) → flüssig fürs Demo-Reel.
- [x] 20x-Analyse S6 (siehe unten) + **Live-Smoke gegen echte DB**: `gs_umsatz_monat` 404 → graceful
      `present:false` → Cockpit zeigt „—" und Status „Umsatz-Tracking: noch keine Daten". Übrige Quellen
      decken sich mit S1–S5 (10 Leads, 10 Kunden, Projekte 1/1 aktiv, Techniker 4/12 frei, 0 App-Leads).
      Render beider Zustände (mit/ohne Umsatzdaten) im DOM-Sandbox geprüft: kein NaN/undefined, Chart nur
      bei Daten, „—" sonst, 6 System-Zeilen, Titel MASTER GEORGE. Claude-Call wie gehabt lokal nicht
      testbar (Platzhalter-Key) → byte-gleich zum produktiven bob-chat-Muster.

### ✅ Session 7 — Jarvis: Geschäftskontext · Datenschutz · Gedächtnis
- [x] **DATENSCHUTZ auf Datenebene** (`api/cockpit.js`): Jarvis nennt standardmässig KEINE
      Kunden-/Firmennamen. `getJarvisFacts` gibt nur grobe **Regionen** statt Adressen heraus
      (`leads_pro_region`/`kunden_pro_region`, abgeleitet aus PLZ → Schweizer Leitregion 1. Ziffer,
      Helper `regionVonPlz`). **Namen verlassen den Server NUR bei ausdrücklicher Freigabe** im selben
      Gespräch — sonst existiert das Feld `kunden_namen` gar nicht (Schutz auf Datenebene, nicht nur
      per Prompt). Freigabe-Erkennung `FREIGABE_RE` (z. B. „Freigabe", „du darfst den Namen nennen",
      „ich gebe die Namen frei") über den ganzen Gesprächsverlauf; eine blosse Namensfrage löst KEINE
      Freigabe aus → Jarvis verweist höflich auf den Datenschutz und liefert Eckdaten (Datum/Umsatz/Region).
- [x] **Video/Social besonders streng:** System-Prompt-Regel — sobald der Nutzer sagt, es sei für Video/
      Reel/Social/Aufnahme, nur Regionen + Zahlen, keine Namen bis zur Freigabe (zusätzlich greift die
      Datenebene-Sperre).
- [x] **Fester Geschäftskontext** (`GESCHAEFTSKONTEXT`-Konstante, in den System-Prompt injiziert, NUR
      die echten Fakten — nichts erfunden): Pilotphase abgeschlossen (2 Projekte, ~35'000 CHF zu Pilot-
      Tarifen) → Übergang Skalierung; 4er-Team (Team1 Emanuel+Dimitri, Team2 Patrick+Vasil); Patrick bis
      Ende Juni im Raum Wädenswil (ZH); Werbung/Meta-Kampagnen ab 24.06.; Tarife steigen → Umsatz steigend;
      Leadmaschine = GS + alle Kanäle. Prognosen IMMER klar als Schätzung gekennzeichnet.
- [x] **Verlauf wird mitgesendet** (`gs-intern.html` `jarvisAsk` → `verlauf`): Jarvis kennt den
      Gesprächskontext (für In-Conversation-Freigabe und Anschlussfragen). Backend baut daraus
      alternierende Claude-Messages (konsekutive gleiche Rollen gemerged, Start mit user erzwungen).
- [x] **Jarvis-Gedächtnis** `scripts/master_cockpit_jarvis_wissen.sql` (idempotent, RLS master-only):
      Tabelle `gs_jarvis_wissen(id, kategorie, inhalt, erstellt_am)`. Sagt der Nutzer „merk dir …",
      „notier dir …", „für die Planung …" (`MERK_RE`), schreibt Jarvis den Inhalt dort hinein
      (Kategorie heuristisch: planung/business/allgemein). Bei JEDER Frage liest Jarvis dieses Wissen
      zusätzlich zum Live-DB-Stand mit (`gespeichertes_wissen` in den Facts) → erinnert sich an frühere
      Planungen. → **EINMALIG im Supabase SQL Editor ausführen** (vorher: 404 → graceful `[]`).
- [x] **Gemeinsame Wissensbasis Jarvis ↔ Claude-Code:** `gs_jarvis_wissen` kann auch von Claude-Code-
      Agenten im Terminal gelesen/geschrieben werden (service_role / SQL Editor). Was Jarvis sich merkt,
      sieht der Code-Agent — und umgekehrt (gemeinsames Gedächtnis). Dokumentiert im SQL-Header.
- [x] Beantwortbare Fragen jetzt u. a.: „Wie laufen die Finanzen?", „Wie sieht die Leadmaschine aus?",
      „Was muss ich noch erledigen?", „Was schätzt du für die nächsten 3–4 Monate?", „In welcher Phase
      sind wir?" — alle aus echten DB-Daten + Geschäftskontext, Schätzungen klar gekennzeichnet.
- [x] 20x-Analyse S7 (siehe unten) + **Live-Smoke gegen echte DB**: Region-Aggregation 9 Kunden →
      „Region Zürich/Ostschweiz" (deckt sich mit Pilot/ZH), keine Namen nötig. `gs_jarvis_wissen` 404 →
      graceful `[]`. `gs_umsatz_monat` 200 (März 3171 / April 17896 / Mai 13317.50 — wie hinterlegt).
      Regex-Tests Freigabe/Merk grün. Claude-Call lokal nicht testbar (Platzhalter-Key) → byte-gleich
      zum produktiven bob-chat/Jarvis-Muster.

> **SQL für Emanuel (einmalig im Supabase SQL Editor, Projekt bmdmoehjwadvdlbrmpuq):**
> `scripts/master_cockpit_jarvis_wissen.sql` ausführen → legt `gs_jarvis_wissen` + RLS (master-only) an.
> Danach merkt sich Jarvis Planungen dauerhaft; bis dahin läuft alles, nur ohne Gedächtnis (graceful).

### ✅ Session 8 — Reel-Finish: Command-Center mobil gehärtet (visuelle QA mit echten Screenshots)
- [x] **Echte Render-QA statt Annahmen:** Das Cockpit über Headless-Chrome mit gemocktem `fetch`
      (echtes `gs-intern.html`, nur API-Antworten gestubbt) als iPhone-Hochformat gerendert und Pixel
      für Pixel geprüft — Command-Center, Leerzustand (ohne Umsatzdaten), Jarvis, Mehr-Menü, Leads.
- [x] **Titel-Clipping endgültig behoben:** „MASTER GEORGE" (Georgia, breite Versalien) lief auf schmalen
      Geräten (≈390 px iPhone) knapp aus dem Hero. Messbasiertes JS-Skalieren war im Layout unzuverlässig
      (Container-Cap / Timing). Jetzt **als Inline-SVG** (`viewBox` + `preserveAspectRatio` + `textLength`):
      der Titel skaliert mathematisch exakt auf die verfügbare Breite und kann auf **keinem** Gerät
      (iPhone SE 320 px bis Tablet) abgeschnitten werden — kein JS, kein Reflow-Risiko. (`width:min(100%,360px)`.)
- [x] **Wichtige Erkenntnis dokumentiert:** Der „Clipping"-Eindruck früher war teils ein **Screenshot-Artefakt**
      (Headless-Chrome erzwingt min. 500 px Viewport; ein 390-px-Screenshot schneidet die rechte Seite der
      zentrierten Hero ab). Die SVG-Lösung ist trotzdem die korrekte Härtung (Original-`h1` clippte auf 390 px real knapp).
- [x] **Jarvis-Hero-Button (Mehr-Menü):** Titel und Untertitel klebten zusammen („Jarvis fragenSprach-
      Assistent…") → `.jt`/`.jd` auf `display:block` gestackt, sauber lesbar.
- [x] **Loses-Enden-Check:** Boot + Navigation durch ALLE 9 Views (dashboard/leads/crm/mehr/jarvis/
      marketing/todos/margen/saeulen) im Headless-Browser → **0 JS-Fehler**, keine kaputten Buttons,
      keine leeren Crash-Views (Leerzustände zeigen ehrliche „keine Daten"-Texte).
- [x] **Ehrlichkeit erneut verifiziert (Render):** Dashboard ohne Umsatzdaten zeigt „—" bei Umsatz/Bester
      Monat, blendet den Chart aus, „Umsatz-Tracking: BEREIT" — kein NaN, keine erfundene Zahl.
- [x] **API-Keys geprüft (Code-Ebene):** Jarvis-Antwort = `ANTHROPIC_API_KEY` (`api/cockpit.js`),
      Jarvis-Stimme rein/raus = `ELEVENLABS_API_KEY` (`api/voice.js`: TTS Brian + STT scribe_v1).
      Lokal nur Platzhalter → Live-Stimme/Claude muss in **Vercel** gesetzt sein (beide bereits in Gebrauch
      durch bob-chat/voice). Ohne ElevenLabs-Key → Browser-Stimme; ohne Anthropic-Key → Fallback-Übersicht.

> **SQL für Emanuel (Stand S8):** Nur noch `scripts/master_cockpit_jarvis_wissen.sql` ist offen (Gedächtnis,
> optional). `gs_umsatz_monat` ist bereits live befüllt (März 3171 / April 17896 / Mai 13317.50) → Command-
> Center zeigt echten Umsatz. S1–S3 nach Bedarf für Schreibfunktionen; Lesen/Reel läuft ohne.

### ✅ Session 9 — Master-Login demo-tauglich + Access-Reality geklärt
- [x] **MERGE-CHECK (wichtig, ehrlich):** Der Cockpit-Code (`gs-intern.html`, `cockpit-manifest.json`)
      liegt **NUR auf `master-cockpit`, NICHT auf `main`**. Auf `main` zeigt `vercel.json` den Pfad
      `/gs-intern-7k2x` sogar auf `/app.html` → die **Produktions-URL `baby-bob.vercel.app/gs-intern-7k2x`
      liefert die Baby-BOB-Landing, NICHT das Cockpit.** Die Branch-Preview
      `baby-bob-git-master-cockpit-baby-bob.vercel.app/gs-intern-7k2x` liefert das Cockpit, ist aber durch
      **Vercel Deployment Protection (Vercel Authentication) geschützt → HTTP 401** (bestätigt via
      `_vercel_sso_nonce`-Cookie). ⇒ **Aktuell ist KEINE URL ohne Eingriff am Handy offen.** Zwei Hebel:
      (A) Deployment Protection für das Projekt deaktivieren → Preview-URL offen, oder
      (B) master-cockpit → main mergen → Produktions-URL offen (NICHT autonom gemacht: zieht auch
      `app.html`/`api/nachrichten.js`/`lib/pdf.js`-Änderungen in die Live-B2C-App; braucht deine Freigabe).
- [x] **Schneller, zuverlässiger Master-Login (gebaut):** Passwort-Login ist der **Hauptweg** — läuft
      server-seitig über `/api/auth` (`grant_type=password`, = `signInWithPassword`), gibt access+refresh
      zurück; das Cockpit speichert beide in `localStorage` und refresht bei 403 automatisch → **Session
      hält an, kein erneuter Login** (persistSession-Äquivalent). KEIN Umweg über `/app`, KEIN Redirect
      zur Landing (eigenständige Datei).
- [x] **Login-Seite** (`gs-intern.html`): klarer **„Master-Login"** (E-Mail + Passwort, goldener Haupt-
      Button), darunter sekundär „Kein Passwort? Magic-Link senden" und „Passwort vergessen / neu setzen".
- [x] **Magic-Link/Reset landen EXAKT im Cockpit:** Frontend sendet `redirect_to = origin+'/gs-intern-7k2x'`;
      `api/auth.js` hängt es (per `safeRedirectQuery`, **nur** Pfad `/gs-intern-7k2x` erlaubt → kein
      Open-Redirect) an `/auth/v1/otp` bzw. `/auth/v1/recover`. `boot()` liest das `#access_token` aus dem
      Hash → **direkt im Cockpit**, nicht auf `/app`. (Supabase erzwingt zusätzlich seine Redirect-Allowlist
      → siehe manuelle Aktion unten.)
- [x] **Passwort-Setz-Skript** `scripts/set-master-password.mjs` (idempotent): setzt via service_role-
      Admin-API (`PUT /auth/v1/admin/users/{master-uid}`) ein Passwort + `email_confirm:true`. Prüft vorher,
      dass die UUID wirklich `emanuelgeorge0@gmail.com` ist (kein falscher Account). Liest `SUPABASE_URL`/
      `SUPABASE_KEY` aus `.env.local`. **Aufruf:** `node scripts/set-master-password.mjs 'DeinPasswort'`.
      (Admin-API lokal verifiziert: HTTP 200, Master-User gefunden, `SUPABASE_KEY` = `sb_secret_…` = service_role.)
- [x] **PWA-Homescreen:** Manifest-Name → **„Master George"** (`short_name`), `apple-mobile-web-app-title`
      → „Master George"; standalone, portrait, Schwarz-Gold, echte PNG-Icons + maskable (aus S5). `vercel.json`
      `outputDirectory "."` **unberührt**.
- [x] Syntaxchecks grün (`node --check` auth.js/Skript/Cockpit-JS), Redirect-Schutz unit-getestet, Login-Seite
      gerendert (sauber, schwarz-gold), nur eigene Dateien committet + sofort gepusht.

### ✅ Session 9b — MERGE master-cockpit → main (LIVE auf Produktion)
- [x] **Vorab-Checks (ohne Änderung):** Dry-Run-Merge `master-cockpit → main` = **0 Konflikte**;
      gemergte `vercel.json` behält `outputDirectory "."` **und** Rewrite `/gs-intern-7k2x → /gs-intern.html`.
- [x] **Konflikt-Hinweis fix/kritische-bugs:** dieser Branch (13 Commits, noch nicht in main) ändert
      dieselben Dateien wie das Cockpit → künftiger Merge `fix/kritische-bugs → main` kollidiert in
      **`app.html`** und **`DEMO-READY.md`** (dry-run bestätigt). Blockiert diesen Merge NICHT, aber beim
      späteren Mergen von fix/kritische-bugs müssen diese beiden Dateien manuell aufgelöst werden.
- [x] **Merge ausgeführt** (`--no-ff`), nach `origin/main` gepusht (`1d74486..a26a199`). Bringt zusätzlich
      die B2C-Features aus den Cockpit-Sessions live: `app.html` (+162), `api/nachrichten.js`, `lib/pdf.js`.
- [x] **LIVE verifiziert:** `https://baby-bob.vercel.app/gs-intern-7k2x` → **HTTP 200, zeigt das Cockpit**
      (MASTER GEORGE / Master-Login / cockpit-manifest). Manifest 200 (`short_name "Master George"`),
      Icon-180 200, Header `x-robots-tag: noindex` + `cache-control: no-store` erhalten. Login-Seite live gerendert.

> **MANUELLE AKTIONEN FÜR EMANUEL (Stand Session 9b — Cockpit ist LIVE):**
> 1. **Passwort setzen (einmalig):** im Projekt-Root `node scripts/set-master-password.mjs 'DeinPasswort'`.
>    → Danach auf `https://baby-bob.vercel.app/gs-intern-7k2x` mit E-Mail + Passwort einloggen.
> 2. **Vercel Deployment Protection ist NICHT mehr nötig** (Produktion ist offen, Cockpit ist login-gegated).
> 3. **Für Magic-Link (optional):** Supabase → Authentication → URL Configuration → **Redirect URLs**
>    → `https://baby-bob.vercel.app/gs-intern-7k2x` eintragen. Für reinen Passwort-Login NICHT nötig.

### ✅ Session 12 — Jarvis auf Baby-BOB-Niveau: Zahl-Aussprache + stärkere Intelligenz/Gedächtnis
- [x] **Vergleich Baby BOB ↔ Jarvis durchgeführt.** Baby BOB hat: `sanitizeForSpeech` (Zahl→Wort, aber OHNE
      Datum/Uhrzeit), `bob_knowledge` (RAG in `api/bob.js`), `bob-learn.js` (täglicher Cron destilliert aus
      B2C-Feedback neue Wissens-Einträge). Jarvis hatte: `gs_jarvis_wissen` (Gedächtnis, bei jeder Antwort
      gelesen + „merk dir"-Schreiben), Verlauf→Claude, aber KEINE Zahl-Aussprache und nutzte das Gedächtnis
      im Prompt nicht explizit.
- [x] **Zahl-Aussprache (Hauptbug) — `jSanitizeSpeech` in gs-intern.html, NUR vor dem TTS-Call:** übernimmt
      Baby BOBs Zahl-zu-Wort-Logik und ist **umfangreicher** — zusätzlich **Datum + Uhrzeit**:
      • Geld: CHF 34'384 → „vierunddreissigtausenddreihundertvierundachtzig Franken" (+ Rappen bei Dezimal).
      • Datum: 24.06. → „vierundzwanzigster Juni"; 24.06.2026 → „… zweitausendsechsundzwanzig"; auch
        „24. Juni" → „vierundzwanzigster Juni".
      • Uhrzeit: 20:17 → „zwanzig Uhr siebzehn"; 14:00 → „vierzehn Uhr" (doppeltes „Uhr" wird geschluckt).
      • Prozent, Dezimal (3,5 → „drei Komma fünf"), Zahlen-/CHF-Bereiche, Millionen, m². Zahl-Token endet
        auf einer Ziffer → **Satzzeichen bleiben** (saubere Sprech-Pausen). **Der Chat zeigt weiter CHF 34'384.**
- [x] **System-Prompt stärker (`JARVIS_SYSTEM` in cockpit.js):** CEO-Berater-Persona + **HKLS/Facility-
      Expertise** (Baby-BOB-Stärke „kompetenter Experte", auf Master/CEO zugeschnitten), proaktiv-aber-knapp
      (ein konkreter Handlungshinweis), **explizite Gedächtnisnutzung** (gespeichertes_wissen aktiv einbeziehen,
      „merk dir" kurz bestätigen via soeben_gemerkt), Vorlese-Format-Regeln. **Datenschutz-, Umsatz- und
      Schätz-Regeln unverändert.**
- [x] **Gedächtnis/Lernen bestätigt:** (a) „merk dir …" → `gs_jarvis_wissen` (MERK_RE), (b) bei JEDER Antwort
      gelesen (top 30 → `gespeichertes_wissen`), (c) Verlauf→Claude-Messages. Jarvis hat damit ein **explizites
      Gedächtnis, das Baby BOBs Chat fehlt**; der Prompt nutzt es jetzt aktiv.
- [x] **Getestet:** Sanitizer-Unit-Tests (alle Beispiele korrekt); Headless: Chat-Bubble zeigt „CHF 34'384",
      an `/api/voice` geht die ausgesprochene Version. **LIVE Backend-Test** (echter Login + Claude): Antwort
      sauber, echte Zahlen, Geschäftskontext, proaktive Einschätzung, `fallback:false`. `outputDirectory "."`
      unberührt; Stimme/STT-Logik nicht angefasst.
- [x] **Ehrlicher Vergleich:** Jarvis BESSER bei Zahl-Aussprache (inkl. Datum/Uhrzeit), explizitem
      Gedächtnis, Datenschutz (Regionen statt Namen), Live-Geschäftszahlen. Baby BOB hat als EINZIGES mehr:
      einen **automatischen Lern-Cron** (`bob-learn`), der aus B2C-Diagnose-Feedback selbstständig
      `bob_knowledge` erweitert — für den CEO-Cockpit-Fall (persönliche Notizen + Live-Zahlen) ist das
      explizite „merk dir"-Gedächtnis aber die passendere Form. Optionaler Nachbau wäre ein analoger
      Jarvis-Cron, der Gespräche zu dauerhaften Notizen destilliert (noch nicht gebaut).

### ✅ Session 11 — Jarvis-Voice-Bugfix am iPhone (2 echte Bugs gefunden & behoben)
- [x] **BUG 1 „Stimme spielt nie" → URSACHE: ElevenLabs-GUTHABEN ERSCHÖPFT (kein Code-Bug).**
      Live-Test gegen Prod-`/api/voice` (5×, iPhone-User-Agent): **alle HTTP 502**, ElevenLabs-Detail
      `"This request exceeds your quota of 10000. You have 4 credits remaining, while 96 required"`.
      Der Key GREIFT zur Laufzeit (ElevenLabs antwortet inhaltlich) — das Konto ist schlicht leer. **Baby BOB
      ist genauso betroffen** (fällt nur still auf die Browser-Stimme zurück → wirkt „ok"). Mein früherer
      Erfolgstest verbrauchte die letzten Credits. ⇒ **Fix = ElevenLabs aufladen/Plan upgraden** (Emanuel-Aktion).
      Code: Jarvis liest jetzt die JSON-Fehlerantwort und zeigt die **echte Ursache** an
      („Stimme: ElevenLabs-Guthaben erschöpft — bitte aufladen") statt pauschal „nicht verfügbar". Sobald
      Guthaben da ist, spielt die Stimme ohne weitere Änderung (Wiedergabe-/Unlock-Pfad in S10 verifiziert).
- [x] **BUG 2 „STT erkennt nichts" → URSACHE: falscher STT-Pfad für iOS.** Jarvis nutzte MediaRecorder→
      `/api/voice` scribe_v1; iOS Safari liefert **audio/mp4**, der Server hängte fix `audio.webm` an →
      ElevenLabs gab leeren Text. **Baby BOB nutzt für STT GAR NICHT scribe**, sondern die **native
      `webkitSpeechRecognition`** (`bobChatMic`, app.html) — die am iPhone zuverlässig läuft und kein
      ElevenLabs-Guthaben kostet. ⇒ **Fix: Jarvis exakt auf denselben nativen SR-Pfad umgestellt.**
      • Manueller Stopp (Tippen Start / Tippen Stopp, ⏹-Button). • `continuous`+`interimResults`; endet iOS
        bei einer Sprechpause, wird **neu gestartet bis zum manuellen Stopp** → kein vorzeitiges Abschneiden.
      • Transkript **sessionsicher** akkumuliert (`_jBase`+`_jSessionFinal`) → keine Duplikate über Neustarts.
      • MediaRecorder/scribe-Pfad + WebAudio-Stille-Gerüst entfernt.
- [x] **Getestet (headless, beide Globals gemockt):** native SR-Ergebnis → `jarvisAsk("wie viele leads
      gesamt")` (kein Duplikat), Dialog korrekt; TTS-502-Quota → klare Guthaben-Meldung, `speechSynthesis`
      NICHT benutzt. **Prod nach Deploy:** `webkitSpeechRecognition` aktiv, `MediaRecorder` nur noch im
      Kommentar, Guthaben-Meldung vorhanden. `outputDirectory "."` unberührt.

> **MANUELLE AKTION FÜR EMANUEL (Session 11):** **ElevenLabs-Konto aufladen** (oder Plan upgraden) —
> aktuell nur 4 von 10'000 Credits übrig, deshalb spielt KEINE Stimme (weder Jarvis noch Baby BOB).
> Sobald Guthaben da ist, funktioniert die ElevenLabs-Stimme sofort wieder. Spracheingabe (STT) läuft
> ab sofort unabhängig davon (native Browser-Erkennung, kostenlos).

### ✅ Session 10 — Jarvis-Stimme = Baby BOB (ElevenLabs only) + manueller Stopp
- [x] **Ursache der „schlechten Stimme" gefunden:** Jarvis rief zwar schon `/api/voice` auf (= Baby-BOB-
      Stimme), kippte aber bei iOS-**Autoplay-Block** sofort auf die **Browser-Stimme** (`SpeechSynthesis`) —
      v. a. im Sprach-Dialog (Antwort kommt aus dem STT-Callback, also ohne Tap-Geste). Baby BOB bleibt
      dort robust. Live verifiziert: Prod-`/api/voice` liefert echtes ElevenLabs-Audio (HTTP 200, audio/mpeg,
      ~40 KB), `ELEVENLABS_API_KEY` ist gesetzt → der Key war NIE das Problem.
- [x] **Fix Stimme:** `SpeechSynthesis`-Fallback **komplett entfernt** (grep `speechSynthesis` = 0). Jarvis
      spricht nur noch über `/api/voice` — **identischer Pfad/Voice-ID/Model wie `bobSpeak()` in app.html**
      (ElevenLabs, `eleven_multilingual_v2`, voice_settings serverseitig). EIN persistentes Audio-Element,
      im Tap-Kontext per stillem WAV **entsperrt** → Sprachantwort spielt auch ohne direkte Geste zuverlässig.
      Bei Autoplay-Block: goldener **„🔊 Antippen zum Hören"**-Button (spielt dieselbe ElevenLabs-Aufnahme) —
      NIE eine Roboterstimme. Bei `/api/voice`-Ausfall: nur Hinweis, Text steht ohnehin da.
- [x] **Fix Mic/Spracherkennung:** weiterhin **manueller Stopp** (Tippen zum Starten, Tippen zum Stoppen),
      **KEIN Auto-Cutoff** → der Anfang wird nie abgeschnitten. Klarer **STOP-Button** während der Aufnahme
      (Mic-Icon → **⏹**, rot pulsierend, Status „● Ich höre zu… — zum Stoppen tippen"). STT unverändert
      **scribe_v1** via `/api/voice` (wie Baby BOB).
- [x] **Stille-Erkennung vorbereitet, DEFAULT AUS:** `_jSilenceAuto=false` + `armSilenceDetection()`
      (WebAudio-AnalyserNode-RMS-Gerüst, greift erst nach Mindest-Sprechzeit → schneidet den Anfang nie ab).
      Zum Nachrüsten nur Flag auf `true`.
- [x] **Getestet:** Headless-Funktionstest (Chip → Antwort → Wiedergabe): `speechSynthesis benutzt=false`,
      `audio.src=blob:` (ElevenLabs), `play()` aufgerufen, Status „Jarvis spricht". Prod nach Deploy: neuer
      Code live (`speechSynthesis`=0, `⏹` vorhanden, `/api/voice` aktiv). `outputDirectory "."` unberührt.
- [x] **Hinweis Voice-ID:** Baby BOB & Jarvis nutzen real `/api/voice` → Voice-ID `nPczCjzI2devNBz1zQrb`
      (echter ElevenLabs „Brian") + `eleven_multilingual_v2`. Die genannte ID `Gubgw9l4dtIoQA9YZHgx` steht
      NICHT im Code (ähnelt dem ungenutzten Legacy-`api/bob-speak.js` `nGgbw9l4dtIoQA9YZHgx`). Soll bewusst
      eine ANDERE Stimme genutzt werden, ist es eine 1-Zeilen-Änderung in `api/voice.js` (gilt dann für beide).

## 20x Bug-/Mobile-Analyse (Session 8 · Reel-Finish Command-Center) — Ergebnis
1. **Titel nie abgeschnitten:** SVG-`textLength`+`preserveAspectRatio` skaliert „MASTER GEORGE" exakt in
   `width:min(100%,360px)` → garantiert randlos auf 320–768 px. Render auf 500 px bestätigt (textW<svgW<Hero).
2. **Kein JS-Messpfad mehr:** `fitCcTitle` (Container-Cap/Timing-anfällig) komplett entfernt → keine Reflows,
   keine Race-Conditions, kein `_ccDbg`/Debug-Rest im Code (`node --check` grün, grep leer).
3. **Pre-Paint-Fallback:** SVG hat `width="320" height="43"`-Attribute → korrektes Seitenverhältnis, auch
   falls CSS `min()` mal nicht greift (alte Engines) → nie überbreit.
4. **Hero-Tap → Jarvis+Mic unverändert:** `ccActivateJarvis` (Tap-Kontext) intakt; SVG ist nur Kind des
   weiterhin klickbaren `#cc-hero` → Sprachstart fürs Reel funktioniert.
5. **Jarvis-Hero-Text gestackt:** `.jt`/`.jd` `display:block` → Titel/Untertitel getrennt; kein Zusammenkleben.
6. **0 Laufzeitfehler:** alle 9 Views im Headless-Boot ohne `window.onerror`/`unhandledrejection`-Treffer.
7. **Ehrliche Leerzustände gerendert:** Umsatz/Bester Monat „—", Chart aus, System „BEREIT" statt Fake-on.
8. **2-Spalten-KPI-Grid:** alle 8 Kacheln + lange CHF-Werte („CHF 34'384"/„CHF 17'896") passen ohne Umbruch.
9. **Chart nur bei Daten:** 3 echte Pilot-Monate als Balken + Jahres-Summe; ohne Daten kein Chart (kein leerer Rahmen).
10. **System-Status ehrlich:** 6 reale Module mit AKTIV/BEREIT aus echten Zahlen — keine erfundenen Agenten.
11. **Swipe-Chips:** Jarvis-Quick-Fragen & Lead-Filter `overflow-x:auto` (bewusst horizontal scrollbar, kein Clip-Bug).
12. **Input-Leiste über Nav:** `.jbar margin-top:auto` → sitzt über der fixen Bottom-Nav, keine Überlappung (Render bestätigt).
13. **Safe-Area:** Topbar `env(safe-area-inset-top)`, Nav `env(safe-area-inset-bottom)`, Viewport `viewport-fit=cover` — unverändert.
14. **Touch-Targets:** KPI-Kacheln/Nav/Buttons ≥44 px; Tap-Kacheln (`data-go`/`data-tap`) verdrahtet & geprüft.
15. **Animationen rein CSS:** Orb-Spin/Puls/Sweep + Live-Blink; einziger JS-Timer ist die 20-s-Uhr (Selbst-Stopp) → flüssig.
16. **Kein Secret im Client / Gate unberührt:** nur `/api/cockpit`+`/api/voice`; `verifyMaster`-403 & noindex/no-store unverändert.
17. **outputDirectory ".":** `vercel.json` nicht angefasst — keine Routing-/404-Regression.
18. **Nur eigene Datei committet:** ausschliesslich `gs-intern.html` gestaged (paralleler Worker auf dem Branch), sofort gepusht.
19. **Build/Syntax:** `node --check` des eingebetteten Frontend-JS grün; SVG-String valide in der JS-Konkatenation.
20. **API-Keys-Pfad ehrlich:** Live-Stimme/Claude nur über Vercel-Env testbar → klar als Emanuel-Aktion ausgewiesen, nicht „grün" behauptet.

## 20x Bug-/Datenschutz-Analyse (Session 7 · Kontext + Datenschutz + Gedächtnis) — Ergebnis
1. **Namen-Sperre auf Datenebene:** Ohne Freigabe wird `kunden_namen` GAR NICHT in die Facts geschrieben
   → Claude kann keine Namen nennen, selbst wenn es wollte (nicht nur Prompt-Regel).
2. **Region statt Adresse:** `regionVonPlz` nutzt nur die 1. PLZ-Ziffer → bewusst grob, nie ein falscher
   Kanton. PLZ ohne Treffer/leer → „Region unbekannt" (aus Aggregat herausgefiltert).
3. **Freigabe nur explizit:** `FREIGABE_RE` matcht Freigabe-Formulierungen, NICHT eine blosse Namensfrage
   („Wie heisst der Kunde?" → false). Getestet (6 Fälle grün).
4. **Freigabe gilt fürs ganze Gespräch:** geprüft über `verlauf` + aktuelle Frage → einmal freigegeben,
   bleibt im selben Chat frei (wie gefordert „im selben Gespräch").
5. **Video/Social:** zusätzliche, betonte Prompt-Regel; Datenebene-Sperre greift ohnehin → doppelt sicher.
6. **Kein Namensleck über Fallback:** `jarvisFallback` nennt nie Namen (nur Zahlen) — unverändert sicher.
7. **Gedächtnis-Tabelle idempotent + RLS master-only:** CREATE IF NOT EXISTS, Index IF NOT EXISTS,
   Policy DROP+CREATE; `gs_master_uid()` CREATE OR REPLACE. anon/authenticated geblockt.
8. **Vor Migration nutzbar:** `gs_jarvis_wissen`-Read in try/catch → 404 → `gespeichertes_wissen=[]`
   (Live verifiziert). Merk-Schreiben in try/catch → bei fehlender Tabelle `merken_fehlgeschlagen=true`,
   keine Exception, Antwort kommt trotzdem.
9. **Merk-Erkennung präzise:** `MERK_RE` matcht „merk dir/notier dir/speicher dir/für die planung/
   vergiss nicht"; Inhalt sauber extrahiert (führende Trigger + Satzzeichen entfernt) — getestet.
10. **Heuristische Kategorie:** planung/business/allgemein aus Stichworten — rein additiv, kein Risiko.
11. **Verlauf → valide Claude-Messages:** konsekutive gleiche Rollen gemerged, Platzhalter „…" gefiltert,
    Start mit `user` erzwungen, aktuelle Frage garantiert letzte user-Message → kein 400 (role-Wechsel-Pflicht).
12. **Verlauf gekappt:** Front + Back auf die letzten 12 Einträge, je Text auf 800 Zeichen → kein
    unbegrenzter Prompt, kein Token-Run-away.
13. **Umsatz weiterhin nur echt:** Umsatzregel im Prompt unverändert; Region/Gedächtnis berühren die
    Umsatzfelder nicht. Live: gs_umsatz_monat-Werte unverändert gelesen.
14. **Geschäftskontext = nur Fakten:** `GESCHAEFTSKONTEXT` enthält ausschliesslich die vorgegebenen
    Angaben; Prognosen sind im Prompt zwingend als Schätzung zu kennzeichnen → keine erfundenen „Fakten".
15. **Gate unverändert:** `jarvis` weiter hinter `verifyMaster` (403); kein neuer ungegateter Endpoint;
    Schreibzugriff auf `gs_jarvis_wissen` nur über den gegateten Server (service_role).
16. **Kein Secret im Client:** Frontend sendet nur `frage`+`verlauf`; Keys/Schreibrechte serverseitig.
17. **XSS/Vorlese-Text:** Antwort weiterhin von Markdown-Symbolen bereinigt; keine neuen ungeprüften
    dynamischen DOM-Einfügungen (Region/Wissen fliessen als Text in die Bubble via bestehendes esc/paint).
18. **Performance:** ein zusätzlicher kleiner Read (`gs_jarvis_wissen`, limit 30) pro Frage; Region-Agg
    rein in-memory aus bereits geladenem `loadCore` → kein N+1, keine Extra-Kundenabfrage.
19. **outputDirectory ".":** `vercel.json` unberührt — keine Routing-/404-Regression.
20. **Syntax/Build:** `node --check api/cockpit.js` ok; Regex-/Extraktions-Tests grün; Live-Smoke grün.

## 20x Bug-/Mobile-Analyse (Session 6 · Command-Center + Umsatz) — Ergebnis
1. **Umsatz nur echt:** Jarvis & Cockpit lesen ausschliesslich `gs_umsatz_monat`/aggregierte Felder —
   keine erfundenen Zahlen. Leere Tabelle → ehrlich „noch keine Umsatzdaten" (System-Prompt + Fallback + UI „—").
2. **Vor Migration nutzbar:** `getUmsatzStats` ist try/catch → `present:false`. Live-Smoke: 404 → graceful.
3. **RLS neue Tabelle:** `gs_umsatz_monat` master_only (auth.uid()=gs_master_uid()); anon/authenticated geblockt.
4. **Idempotente SQL:** CREATE TABLE IF NOT EXISTS, UNIQUE-Index IF NOT EXISTS, RLS DROP+CREATE; INSERT-
   Block komplett auskommentiert → erstes Ausführen legt nur Schema an (keine 0-Fake-Zeilen).
5. **ON CONFLICT (jahr,monat):** erneutes Einspielen aktualisiert Zahlen statt Duplikate; UNIQUE erzwingt es.
6. **CHECK monat 1–12:** verhindert ungültige Monate.
7. **Trennung Margen vs. Monatsumsatz:** Facts-Feld `umsatz_gesamt_chf`→`margen_umsatz_chf` umbenannt,
   damit Claude Umsatzfragen nicht aus der Margen-Kalkulation beantwortet. Keine Altreferenz (grep leer).
8. **Division/Empty-Guards:** bester Monat nur wenn Zeilen da; Chart-Skalierung mx≥1; Trend nur ab 2 Monaten.
9. **Auto-Mic im Tap-Kontext:** Hero-Tap setzt `_jAutoMic` und ruft `go('jarvis')` synchron → `renderJarvis`
   startet `startJarvisMic()` noch im selben Gesten-Stack → iOS/Android erlauben getUserMedia. Ohne Mic → Toast.
10. **Kein hängendes Mikrofon:** Mic-Pfad unverändert (S5) — Stream-Tracks in onstop gestoppt, Capability-Check.
11. **Live-Uhr leakt nicht:** `startCcClock` clwith clearInterval bei jedem Render + Selbst-Stopp wenn
    `#cc-clock` fehlt (Tab-Wechsel) → kein Timer-Stau, keine Last im Hintergrund.
12. **XSS:** alle dynamischen Werte (System-Labels/Details, Monatslabels, bester Monat) via `esc()`;
    Zahlen via `chf()`/mono. Sandbox-Render: kein NaN/undefined in beiden Zuständen.
13. **Ehrlicher System-Status:** state aus echten Daten (Leads>0, Projekte>0, Techniker>0, App-Leads>0,
    Umsatzdaten vorhanden) → „Aktiv"/„Bereit". Keine Fake-Liste, kein „online"-Theater.
14. **Mobile-Hochformat:** 2-Spalten cc-grid, Hero/Orb/Chart responsiv, Safe-Area, Touch ≥44px; reine
    CSS-Animationen → flüssig, screenshot-/reel-tauglich.
15. **Performance:** Dashboard-API macht zusätzliche Reads (projekte/techniker/umsatz) parallel zum Rest;
    alle klein (select nur nötige Spalten). Keine N+1, kein Client-Polling.
16. **Tap-Kacheln:** data-go (leads/crm/saeulen) + data-tap (todos/margen) generisch verdrahtet; Nav konsistent.
17. **Gate unverändert:** dashboard/jarvis weiter hinter `verifyMaster` (403); keine neue Action ohne Gate.
18. **Kein Secret im Client:** nur `/api/cockpit` & `/api/voice`; Keys serverseitig; noindex/no-store unberührt.
19. **outputDirectory ".":** in `vercel.json` unverändert — keine Routing-/404-Regression.
20. **Syntax/Build:** `node --check api/cockpit.js` ok; eingebettetes Frontend-JS via `new Function` fehlerfrei.

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
4b. **`scripts/master_cockpit_umsatz.sql`** (Session 6) im Supabase SQL Editor ausführen → legt
   `gs_umsatz_monat` an. **Danach in DERSELBEN Datei** den auskommentierten INSERT-Block (Block 3 unten)
   einkommentieren, die `0` je Monat durch deinen **echten Umsatz in CHF** ersetzen und erneut „Run".
   Erst dann zeigen Command-Center („Umsatz gesamt"/„Bester Monat") und Jarvis echte Umsatzzahlen;
   vorher steht ehrlich „—" bzw. „noch keine Umsatzdaten hinterlegt". Mehrfach ausführbar (ON CONFLICT).
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
