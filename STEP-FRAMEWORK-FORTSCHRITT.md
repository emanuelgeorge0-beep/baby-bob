# GEWERKE-STEP-FRAMEWORK – Fortschritt

Branch: `feature/step-framework` (NICHT nach main mergen — Emanuel entscheidet).
Ziel: „Montag-Effekt" — der bauleitende Monteur sieht in <30 Sek pro Haus, was
offen / in Arbeit / fertig / blockiert ist. Projekt → Haus → Einheit → Zone → Step → Status.

## ⚠️ Was DU (Emanuel) im Supabase SQL Editor ausführen musst

**Genau eine Datei, einmalig, idempotent:**

```
scripts/gewerke_step_framework.sql
```

Erzeugt: `gs_gw_haus`, `gs_gw_einheit`, `gs_gw_step` (+ Indizes + RLS).
Hängt an bestehende Tabellen an (`gs_projekte`, `gs_projekt_techniker`, `user_roles`) —
nichts wird gelöscht oder umbenannt. Danach ist das Framework live.

Solange die Migration NICHT gelaufen ist, meldet das Setup sauber
„Haus konnte nicht erstellt werden (Migration ausgeführt?)" statt zu crashen.

## Architektur

- **DB**: `gs_gw_haus` → `gs_gw_einheit` → `gs_gw_step`. Projekt = bestehende `gs_projekte`.
  Templates sind NICHT in der DB — sie sind hart in `api/gewerke.js` hinterlegt.
- **API**: `api/gewerke.js` (Service-Key, Zugriff im Code durchgesetzt).
  Actions: `templates`, `projekte`, `tree`, `setup`, `einheit_add`, `step_update`,
  `haus_delete`, `statusbericht`.
- **Frontend**: `gewerke.html`, erreichbar unter `/gewerke` (Rewrite in vercel.json).
  Login via bestehendes `/api/auth` (Techniker/Bauleiter, Admin, Master).
- **Vorlesen**: nutzt den BESTEHENDEN Endpoint `/api/bob-speak` (ElevenLabs) —
  kein Neubau der Sprachausgabe, nur der fertige Berichtstext wird durchgeschickt.
  Fallback auf `SpeechSynthesis`, falls TTS nicht verfügbar.

## Gewerke-Templates (hart hinterlegt)

| Gewerk | Steps | Sequenz |
|---|---|---|
| Sanitär | 10 | fest |
| Heizung | 9 | fest (keine Zirkulation) |
| Splitklima | 8 | editierbar |
| Industriekälte | 8 | editierbar |

Pro Step: Gewerk, Reihenfolge-Nr, Foto-Gate, Pflicht-Vorgänger, Zone/Phase, Status,
%-fertig, rapport_ref, material_ref, Foto, Notiz, Unterschrift, Timestamps.

**Sequenzieller Pflicht-Workflow**: Ein Step kann erst starten (in_arbeit/abgeschlossen),
wenn sein Pflicht-Vorgänger abgeschlossen ist (z. B. keine Isolierung vor bestandener
Druckprobe). **Foto-Gate**: Abschluss nur mit Foto-Nachweis.

## Status

- [x] Schritt 1 – Backend: SQL-Migration, `api/gewerke.js`, Logik-Tests (42/42 grün)
- [ ] Schritt 2 – Frontend: `gewerke.html` Status-Dashboard + Setup + Statusbericht + 🔊
- [ ] Schritt 3 – Routing (`/gewerke`), Demo-Modus, End-to-End getestet

## Tests

`node scripts/test_gewerke.mjs` — 42 reine Logik-Tests (Templates, Vorgänger-Gate,
Foto-Gate, Fortschritt, ISO-KW, Demo-Maskierung, Berichtstext). Mit `GW_TOKEN`/`GW_BASE`/
`GW_PROJEKT` zusätzlich API-Smoke gegen ein Live-Deployment.

## Definition of Done

Projekt mit Gewerk anlegen → Steps automatisch erzeugt → Bauleiter sieht Status-Dashboard
pro Haus → Statusbericht für beliebige KW als PDF + 🔊 vorlesen. Mobile-first, Schwarz-Gold.
