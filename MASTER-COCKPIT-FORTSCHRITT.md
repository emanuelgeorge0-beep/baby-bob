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

### ☐ Nächste Sessions
- [ ] Module: Marketing, To-Dos, Verkauf/Einkauf (Marge), 4 Säulen.
- [ ] Verknüpfung Lead → Kunde → Projekt → Rapport → Vertrag voll ausbauen.
- [ ] RLS-Härtung gs_anfragen/gs_kunden gegen anon (in Abstimmung mit App-Team/main).

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

## NÄCHSTE SESSION — Wiedereinstieg
→ Diese Datei lesen. Dann Module (Marketing/To-Dos/Verkauf/4 Säulen) im „Mehr"-Tab ausbauen;
   Nav-Array in gs-intern.html + neue Actions in api/cockpit.js erweitern (Architektur steht).

## Manuelle Aktionen für Emanuel
1. **`scripts/master_cockpit_session1.sql`** im Supabase SQL Editor ausführen (für Schreiben:
   Stufe ändern, Zuweisung, Follow-ups, Kontakt-Historie). Lesen/Dashboard geht auch ohne.
2. Supabase Auth: Redirect-URL für Magic-Link auf `…/gs-intern-7k2x` zulassen (falls Magic-Login gewünscht).
3. Login mit `emanuelgeorge0@gmail.com` (Master-UUID) testen → /gs-intern-7k2x.
