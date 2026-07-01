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
- [x] Schritt 2 – Frontend: `gewerke.html` (Login, Projekt-Picker, Status-Dashboard mit
      Fortschritts-Ring + ✅🟡⏳🔴, Setup „＋ Haus", Step-Sheet mit Gate-Meldungen,
      Statusbericht-Modal + PDF-Druck + 🔊 Vorlesen). Routing `/gewerke` in vercel.json
      (outputDirectory "." unangetastet). `api/auth.js` erlaubt jetzt auch `/gewerke`
      als Magic-Link/Reset-Redirect (+ Query, z. B. `?demo=1`).
- [x] Schritt 3 – Automatischer End-to-End-Test (self-cleaning) in `scripts/test_gewerke.mjs`;
      Handler-Smoke gegen Live-DB (templates ok, Auth-Gate 401, `gs_projekte` erreichbar,
      `gs_gw_*` noch 404 = erwartet vor Migration). **Offen: E2E-Lauf NACH der SQL-Migration.**

> Hinweis: Auf diesem Branch committet parallel ein zweiter Prozess (Blockaden-Feature).
> Ich stage ausschließlich meine eigenen Dateien und pushe nach jedem Schritt.

## ✅ So verifizierst du es (nach der SQL-Migration)

1. `scripts/gewerke_step_framework.sql` im Supabase SQL Editor ausführen (einmalig).
2. Deployen (Vercel Preview des Branch `feature/step-framework`).
3. `/gewerke` öffnen → mit deinem Account (Techniker/Admin/Master) anmelden.
4. Projekt wählen → **＋ Haus** → Gewerk(e) + Einheiten → Steps erscheinen automatisch.
5. Step antippen → Status setzen. Test die Gates: Schritt 2 lässt sich nicht starten,
   solange Schritt 1 nicht abgeschlossen ist; ein Foto-Gate-Schritt lässt sich nicht ohne
   Foto abschließen.
6. **📋 Statusbericht** → Zeitraum (heute/KW/Gesamt) → **Als PDF** + **🔊 vorlesen**.
7. Automatischer End-to-End-Test (legt ein Test-Haus an, prüft alle Gates + Bericht,
   löscht sich selbst wieder):
   ```
   # Access-Token: auf /gewerke einloggen, dann in der Browser-Konsole:
   #   localStorage.getItem('bob_auth_token')
   GW_TOKEN=<token> GW_BASE=https://<dein-preview-deploy> node scripts/test_gewerke.mjs
   ```
   Erwartet: „✅ ALLE TESTS GRÜN".

## Tests

`node scripts/test_gewerke.mjs` — 42 reine Logik-Tests (Templates, Vorgänger-Gate,
Foto-Gate, Fortschritt, ISO-KW, Demo-Maskierung, Berichtstext). Mit `GW_TOKEN`/`GW_BASE`/
`GW_PROJEKT` zusätzlich API-Smoke gegen ein Live-Deployment.

## Definition of Done

Projekt mit Gewerk anlegen → Steps automatisch erzeugt → Bauleiter sieht Status-Dashboard
pro Haus → Statusbericht für beliebige KW als PDF + 🔊 vorlesen. Mobile-first, Schwarz-Gold.
