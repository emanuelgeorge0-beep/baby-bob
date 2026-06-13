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

### ☐ Offen (Session 1)
- [ ] `api/cockpit.js` — token-gated API (dashboard/leads/crm).
- [ ] `gs-intern.html` — Jarvis-Cockpit (Dashboard + Block 1 Leads + Block 2 CRM), erweiterbar.
- [ ] `cockpit-manifest.json` + `vercel.json` Rewrite repoint + Headers.
- [ ] 20x Bug-Analyse (RLS/secret-path/leak/FK/PWA) dokumentiert.

### ☐ Nächste Sessions
- [ ] Module: Marketing, To-Dos, Verkauf/Einkauf (Marge), 4 Säulen.
- [ ] Verknüpfung Lead → Kunde → Projekt → Rapport → Vertrag voll ausbauen.
- [ ] RLS-Härtung gs_anfragen/gs_kunden gegen anon (in Abstimmung mit App-Team/main).

## NÄCHSTER SCHRITT
→ `api/cockpit.js` bauen (Token-Gate + Dashboard/Leads/CRM-Endpunkte).

## Manuelle Aktionen für Emanuel
1. `scripts/master_cockpit_session1.sql` im Supabase SQL Editor ausführen.
