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

### ☐ Nächste Sessions (Session 3)
- [ ] Modul **4 Säulen** (Platzhalter steht im Mehr-Menü).
- [ ] Verknüpfung Lead → Kunde → Projekt → Rapport → Vertrag voll ausbauen
      (Margen optional an `anfrage_id` koppelbar — Picker im UI ergänzen).
- [ ] Marketing: echte Kampagnen-Objekte + Zeitraum-Filter (statt nur Kosten je Kanal).
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

## NÄCHSTE SESSION (3) — Wiedereinstieg
→ Diese Datei lesen. Modul **4 Säulen** bauen; Lead→Projekt→Marge-Picker; Marketing-Kampagnen/Zeitraum.
   Architektur steht: Nav (`MEHR_VIEWS` + `go()`), `renderXxx()`-Muster, API-Actions im switch.

## Manuelle Aktionen für Emanuel
1. **`scripts/master_cockpit_session1.sql`** im Supabase SQL Editor ausführen (CRM-Schreiben).
2. **`scripts/master_cockpit_session2.sql`** im Supabase SQL Editor ausführen (Marketing/To-Dos/Margen-
   Schreiben). Reihenfolge S1 → S2 (beide idempotent). Lesen/Dashboard geht auch ohne.
3. Supabase Auth: Redirect-URL für Magic-Link auf `…/gs-intern-7k2x` zulassen (falls Magic-Login gewünscht).
4. Login mit `emanuelgeorge0@gmail.com` (Master-UUID) testen → /gs-intern-7k2x.
