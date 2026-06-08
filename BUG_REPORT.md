# BUG_REPORT — Systematische Prüfung vor Werbestart

Datum: 2026-06-08 · Branch: main · Methodik: Code-Logik-Analyse + automatische Tests
(Mikro, echte Mail-Zustellung, echtes iOS-Touch, Magic-Link-Login sind hier **nicht**
final testbar → unten unter „Emanuel muss manuell testen" gelistet).

Legende: ✅ geprüft & in Ordnung · 🛠️ Bug gefunden & gefixt · 🟡 manuell verifizieren · ℹ️ Hinweis (kein Bug)

---

## 1. SPRACHE 🛠️ (gefixt)
- **Bug:** App zeigte teils automatisch Spanisch. **Ursache:** `lib/regions.js → detectRegion()`
  erzwang per `navigator.language`/Zeitzone die Region (ES) und damit die Sprache.
- **Fix:** Auto-Detect entfernt (`detectRegion()` → immer `CH`); Sprache von der Region entkoppelt;
  **Standard immer Deutsch**, persistiert in `localStorage["bb_lang"]`; sichtbarer Umschalter
  **DE/EN/ES** (GS-Landing-Kachel + GS-Home-Header) statt des statischen „🇨🇭 Schweiz"-Labels.
- **Automatisch geprüft:** alle **53** `data-i18n`-Keys in DE/ES/EN vollständig vorhanden —
  **keine** fehlenden Übersetzungen / deutschen Reste bei EN/ES.
- 🟡 Manuell: frisch öffnen mit ES-Browser/VPN → muss Deutsch sein; Wechsel + Reload persistiert.

## 2. GS-ANFRAGE 🛠️/✅ (Tracking+Mails neu, Rest robust)
- ✅ **Submit-Handler robust:** `AbortController`-Timeout (15 s), Button-Reset in allen Pfaden,
  klare Fehler-Toasts, JSON-Parsing abgesichert.
- ✅ **Pflichtfeld-Validierung:** Vorname, Nachname, Strasse, PLZ, Ort, **Telefon UND E-Mail**
  hart erforderlich (`gsVerfuegbarkeitWeiter`); zusätzlich weiche Plausibilitätswarnung
  (E-Mail-Regex + Telefon-Länge), die **nicht** blockiert (Lead-Sicherung). Server validiert zusätzlich.
- 🛠️ **UTM/Quelle wird gespeichert** (war vorher nicht vorhanden) — inkl. Ableitung
  `utm_source > Referrer > direkt`, Migration `scripts/utm_tracking_migration.sql`.
- ✅ **Lead-Insert fehlerfrei** in **`gs_anfragen`** (reale Tabelle; Auftrag nannte fälschlich
  `gs_kundenanfragen`). **Fallback** ohne Tracking-Spalten, falls Migration noch nicht lief →
  Lead geht nie verloren.
- 🛠️ **Mail-Versand korrekt verdrahtet:** Lead-Alarm an `info@george-solutions.ch` + `emanuelgeorge0@gmail.com`
  und Kundenbestätigung — via Resend REST. **Mailfehler bricht das Speichern NICHT ab**
  (try/catch, nur Log; fehlender Key → übersprungen, Lead bleibt gespeichert).
- 🟡 Manuell: echte Zustellung (Resend-Key + Domain-Verifizierung, siehe NACHT_STATUS_3.md).

## 3. TECHNIKER-RAPPORT ✅
- ✅ **Mehrere Positionen/Tag:** `trCollectPositions()` sammelt Zusatzpositionen (leere werden
  übersprungen), Backend (`api/tagesrapport.js`) löscht+schreibt sie nach **`gs_rapport_positionen`**
  (Tabelle existiert live, 200). Best-effort try/catch → Hauptrapport bleibt bei Fehler erhalten.
- ✅ **Gesamtstunden-Summe:** `trGrandTotalHours()` summiert Hauptposition + alle Zusatzpositionen,
  Anzeige live aktualisiert; Wert geht als `gesamtstunden` ans Backend.
- ✅ **Voice→BOB→übernehmen (`mode:'rapport'`):** `bobAnalyse` mit Timeout, Ergebnis in Haupt-
  oder Zielposition übernehmbar, **rein strukturierend** (keine Begriffskorrektur). Sauber.
- ✅ **Submit robust:** Projektpflicht, Button-Reset, sichtbare Erfolg/Fehler-Meldung, Verbindungsfehler abgefangen.
- ℹ️ **Projektnummer (Haupt-Position):** Das Feld `tr-pnr` ist editierbar und wird aus dem Projekt
  vorbefüllt. Eine **Änderung der Haupt-Position-Nummer wird bewusst NICHT** in `gs_tagesrapporte`
  gespeichert — die Tabelle hat **keine** `projektnummer`-Spalte (Nummer kommt kanonisch aus
  `gs_projekte`; das PDF nutzt diese). Ein Insert dieser Spalte würde **alle** Rapport-Saves brechen,
  daher **bewusst nicht** „gefixt". Für **Zusatzpositionen** wird `projektnummer` korrekt gespeichert.
  → Falls die Haupt-Nummer pro Rapport überschreibbar sein soll: separate Spalte/Migration nötig (Design-Entscheid).

## 4. MATERIALLISTE ✅
- ✅ **Voice→BOB→übernehmen (`mode:'material'`):** `tmVoiceAnalyse()` parst `positionen`
  (Position/Menge/Einheit), füllt leere Zeilen bzw. legt neue an; Notiz wird angehängt.
- ✅ **Positionen gespeichert:** `tmSend()` validiert Projekt + (Positionen **oder** Foto),
  sendet als Nachricht `typ:'materialliste'` an den Projektleiter über `api/nachrichten.js`
  (→ `gs_nachrichten`, mit FK-Fallback). **`gs_material_listen` existiert bewusst nicht** (404 ist kein Bug).
- ✅ Submit robust (Button-Reset, Fehler-Toast, sichtbare Meldung).

## 5. SCROLLEN/LAYOUT ✅ (Code) / 🟡 (Pixel)
- ✅ Alle Scroll-Container (`.screen`, `.gs-screen`, `.tech-screen`, `.admin-screen`, `.login-screen`)
  haben `overflow-y:auto`.
- ✅ **Kein 100vh-Problem:** durchgehend `100dvh` + `--vh`-Fallback (`setVH()` an `resize`/`orientationchange`).
- ✅ **Navbar überlappt nicht:** Bottom-Nav (`.bnav`) nur in `#home`/`#about`; beide mit
  `padding-bottom` 90px/86px. `tech-/admin-screen` mit `padding-bottom: calc(140px + safe-area)`,
  `gs-screen` 32px. Tastatur: `bindFocusScroll` hält fokussiertes Feld sichtbar.
- 🟡 Manuell auf echtem iOS Safari / Android Chrome (Notch/Home-Indicator, Tastatur, Rotation) sichten.

## 6. ZURÜCK-BUTTONS ✅
- ✅ Jede Unteransicht hat funktionierende Navigation: GS-Flow `gs-back-btn` (→ vorheriger Step),
  Tech-Bereich Tab-Nav + „←", Admin/Partner `admin-back`, Login-Flows zurück zu `login`,
  Erfolgs-/Buchungs-Screens mit „+ Neues Projekt" / „Zurück zu Baby BOB".
- ℹ️ `tech-rapport` ist der Wurzel-Tab des Techniker-Bereichs (Tab-Nav + Logout) — korrekt ohne „Zurück".

## 7. VOICE-REGEL ✅
- ✅ Zentral abgesichert: `bobSpeak()` ruft `bobVoiceAllowed()`; spricht **nur** wenn
  `appMode==='bob'` **und** ein BOB-Scanner-`.screen` aktiv **und** **kein**
  `.gs-/.admin-/.tech-/.login-screen` aktiv. Alle Nicht-Scanner-Screens tragen diese Klassen
  (verifiziert) → Admin/Techniker/Partner garantiert stumm. `setMode()` stoppt zusätzlich laufende Sprache.

## 8. IBAN-VALIDIERUNG ✅
- ✅ `ibanValid()`: Format/Länder-Längen-Check + **Mod-97** korrekt.
  **Automatischer Test 9/9 bestanden** (CH/DE/GB/FR gültig → true; falsche Prüfziffer / zu kurz /
  Müll / leer → false).

---

## 🟡 Emanuel muss manuell testen (hier nicht final verifizierbar)
1. **Sprache live:** Mit spanischem Geräte-/Browser-Locale oder VPN öffnen → muss **Deutsch** starten.
   DE↔ES↔EN umschalten, App neu laden → Auswahl bleibt.
2. **Mail-Zustellung:** Nach Setzen von `RESEND_API_KEY` + Domain-Verifizierung eine Test-Anfrage
   absenden → Lead-Mail an **beide** Adressen (Telefon-/Mail-Links antippbar) + Kundenbestätigung.
3. **Mikrofon/Voice:** Diktat im Rapport/Material auf echtem iOS Safari + Android Chrome
   (Spracherkennung ist browser-/geräteabhängig).
4. **Magic-Link-Login** (Supabase-Auth) end-to-end (Mail-Empfang + Login).
5. **Touch/Layout** auf echten Geräten: Scrollen bis zum letzten Element, Bottom-Nav verdeckt nichts,
   Tastatur schiebt Felder korrekt, Rotation, Notch/Safe-Areas.
6. **UTM end-to-end:** `?utm_source=google&utm_campaign=test` → Quelle in DB + Dashboard-Badge.

## Fazit
- **Gefixt:** Sprach-Auto-Detect-Bug (1). **Neu & verdrahtet:** UTM-Tracking, Lead-Alarm- &
  Kundenbestätigungs-Mail (2).
- **Geprüft & in Ordnung:** Rapport (3), Material (4), Layout (5), Zurück-Buttons (6),
  Voice-Regel (7), IBAN (8) — **keine** eindeutigen Bugs gefunden.
- **1 bewusster Nicht-Fix** dokumentiert (Haupt-Position-Projektnummer, Punkt 3 — Design-Entscheid,
  Fix würde sonst Saves brechen).
- Bestehende Funktionen nicht verändert außer den beschriebenen Fixes/Features.
