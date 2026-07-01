# Blockaden-Modul – Fortschritt

Branch: `feature/blockaden` (von `main`). **NICHT nach main mergen** – Emanuel merged selbst.

Killer-Feature für Hausverwaltungen/Bauleiter-Büros: Blockaden als First-Class-Objekt,
gekoppelt ans Step-Framework (Projekt → Haus → Einheit → Zone → Step). Eine Blockade
blockiert einen konkreten Step → 🔴 im Status-Dashboard.

## Eiserne Regeln (eingehalten)
- `"outputDirectory": "."` in vercel.json bleibt erhalten. ✅
- George Solutions = Marke; „Bob GS" nur die KI-Funktion. Kein Renaming auf „Felix". ✅
- Echte Kundendaten (Geiger AG, M. Fierz) → Demo-Modus maskiert (`demo:true`). ✅
- Bestehende GS-Sprachfunktion (ElevenLabs Voice-ID nPczCjzI2devNBz1zQrb, STT) wiederverwendet. ✅
- SQL NICHT selbst ausführen → idempotentes Skript in `scripts/`. ✅

---

## ⚠️ Emanuel: EINMALIG ausführen
`scripts/blockaden_migration.sql` im **Supabase SQL-Editor** ausführen (DDL geht nicht über die Data-API).
Idempotent, gefahrlos wiederholbar. Legt an: `gs_blockaden`, `gs_projekt_beteiligte` (Multi-Firma), RLS, Indizes, Eskalations-Trigger.

Bis dahin degradiert die API sauber (`notMigrated: true`, HTTP 503) – nichts crasht.

---

## Schritt 1 – Backend + Datenmodell ✅ (committet)
- `scripts/blockaden_migration.sql` – Tabellen + RLS (service/admin/reporter/owner/partner/bauleiter_buero) + Indizes + `updated_at`-Trigger.
- `api/blockaden.js` – Actions:
  - `classify` – KI-Auto-Zuordnung (Claude sonnet-4-6) aus Sprach-/Text-Meldung → Vorschlag {haus, einheit, zone, step_ref, urgency, blockiert_von_rolle, beschreibung}. Heuristik-Fallback ohne KI. Kein Login nötig.
  - `create` – Blockade anlegen + Sofort-Benachrichtigung (Resend-Mail an Owner/Bauleiter-Büro + Blockade-PDF + erstes Foto) + In-App-Push (gs_nachrichten → Badge). FK-sicher (wie gs_nachrichten).
  - `list` – rollen-/firmen-gefiltert, nach Dringlichkeit sortiert; Medien-Base64 gestrippt (nur Zähler).
  - `get` – Detail inkl. Fotos (Zugriffsprüfung).
  - `update` – Status/Resolution/Urgency/Rolle ändern (+ Mail bei Statuswechsel).
  - `freigeben` – Bauleiter-Büro/Owner/Admin → Status `freigegeben`, `freigegeben_am`, Step entsperrt, Melder informiert.
  - `eskalieren` / `check_escalations` + **GET-Cron** (stündlich, in vercel.json) – offene Blockaden > X Std ohne Aktion → `eskaliert` + Mail.
  - `report` – Wochenreport „Was hat uns diese Woche verzögert?" (PDF + optional Mail).
  - `speak_text` – fertiger Vorlese-Text (Status/Report) → Frontend schickt ihn an `/api/voice` (ElevenLabs).
- `lib/pdf.js` – `buildBlockadePdf`, `buildBlockadenReportPdf` (einseitig, Top-10).
- `lib/mail.js` – `blockadeEmailHtml`, `blockadenReportEmailHtml` (schwarz/gold).
- `vercel.json` – Cron `/api/blockaden` stündlich (outputDirectory unangetastet).

Sichtbarkeit (Multi-Firma):
- **gs_admin / master** = Bauleiter-Büro-Sicht → ALLE Blockaden.
- **gs_partner** = Projekt-Owner → alle Blockaden seiner Projekte + eigene.
- **Bauleiter-Büro** (beteiligt mit rolle `bauleiter_buero`) → alle Blockaden dieser Projekte.
- **techniker / beteiligte Firma** → nur selbst gemeldete/zugewiesene (keine Preise/Notizen anderer Firmen).

Demo-Maskierung: `demo:true` → Namen/Firmen/E-Mails maskiert, „Geiger/Fierz" im Freitext neutralisiert.

Validierung: `node --check` grün; PDF/E-Mail-Erzeugung getestet (gültiger %PDF-Header, HTML enthält Urgency).

---

## Schritt 2 – Frontend (Techniker + Admin/Bauleiter + Partner) ✅ (committet)
Alles in `app.html` (Bestandsmuster wiederverwendet: tech-screen/admin-screen/ob-chip/tr-voice; schwarz-gold, mobile-first).

- **Techniker** – Nav-Tab „🚧 Blockade" → Screen `tech-blockade`:
  Projektwahl, Sprache/Text-Schilderung (Dauer-Diktat), „🧠 BOB: Zuordnen" (classify → füllt Step/Haus/Einheit/Zone/Urgency/Rolle/Beschreibung, editierbar),
  Foto (mehrfach, komprimiert), optionale Owner-E-Mail, „🚨 Blockade melden" → create. Darunter „Meine gemeldeten Blockaden".
- **Admin/Bauleiter-Büro** – Hub-Card „🚧 Blockaden" → Screen `admin-blockaden`:
  Filter (Offen/Alle/🔴Kritisch/⚠Eskaliert/Freigegeben), nach Dringlichkeit sortierte Karten,
  „🔊 Blockaden-Status abrufen" (ElevenLabs), „📄 Wochenreport" (Summary + PDF-Download + 🔊 Vorlesen).
- **Partner** – pd-Tab „🚧 Blockaden": alle Blockaden seiner Projekte, „+ Blockade eröffnen" (gleicher Erfassungs-Screen, kontext-aware Back), 🔊 Status, Wochenreport.
- **Detail-Modal** (rollenübergreifend): alle Felder, Fotos, 🔊 „Blockade vorlesen"; Bauleiter-Büro/Owner/Admin/Partner: „▶ In Bearbeitung" + „✅ Freigeben – Step entsperren".
- **Vorlese-Funktion**: dedizierter Audio-Player (`blSpeak`, ElevenLabs Voice, `eleven_flash_v2_5`), Play/Stop-Toggle, Fallback SpeechSynthesis; stoppt bei Screenwechsel. Nur der fertige Text geht an `/api/voice`.
- **Demo-Modus**: `demoMode` → lokaler `blDemoApi`-Store mit fiktiven/maskierten Daten (keine echten Kundennamen).

Robustheit: Alle Listen fangen `notMigrated` sauber ab (freundlicher Hinweis statt Crash). Syntax der Inline-Scripts automatisiert geprüft (0 Fehler). `outputDirectory:"."` unangetastet.

## Offen (nächster Schritt)
- Schritt 3 – E2E-Testskript (adaptiv, 20×, alle 4 Rollen) + Preview-Test mobil.
