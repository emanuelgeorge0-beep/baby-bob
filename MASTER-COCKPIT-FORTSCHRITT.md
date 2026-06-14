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

## NÄCHSTE SESSION (4) — Wiedereinstieg
→ Diese Datei lesen. Offene Punkte unter „Offen für Session 4": Rapport→Vertrag-Kette,
   Kampagnen-Lead-Attribution (utm_campaign), zeitraum-genaue Kosten/CPL, S1/S2-Datenquellen.
   Architektur steht: Nav (`MEHR_VIEWS` + `go()`), `renderXxx()`-Muster, API-Actions im switch, Picker via `*_pickers`.

## Manuelle Aktionen für Emanuel
1. **`scripts/master_cockpit_session1.sql`** im Supabase SQL Editor ausführen (CRM-Schreiben).
2. **`scripts/master_cockpit_session2.sql`** im Supabase SQL Editor ausführen (Marketing/To-Dos/Margen).
3. **`scripts/master_cockpit_session3.sql`** im Supabase SQL Editor ausführen (Kampagnen + Marge.projekt_id).
   Reihenfolge **S1 → S2 → S3** (alle idempotent). Lesen/Dashboard/Säulen funktionieren auch ohne.
4. Supabase Auth: Redirect-URL für Magic-Link auf `…/gs-intern-7k2x` zulassen (falls Magic-Login gewünscht).
5. Login mit `emanuelgeorge0@gmail.com` (Master-UUID) testen → /gs-intern-7k2x.
