# NACHT-T1 — Status-Report (08.06.2026)

Live: baby-bob.vercel.app · Branch main · Commits `5a2b3df`, `36cd1b1`, `9a4f1bc` (+ Status).
Regression: **1004 passed / 0 failed** (volle Suite gegen Live nach Deploy).

## ✅ Gebaut & deployed
- **Block 1 – Feste 2er-Teams:** Team-Modus schlägt Team 1 (Emanuel George + Dimitri Grill) /
  Team 2 (Patrick Notter + Vasil Ignatov) mit Meister-Qualifikationen vor (`GS_TEAMS`,
  `gsRenderTeamChoice`/`gsSelectTeam`). Einzel = freie Personenwahl. Keine Equipment-Aufteilung sichtbar.
- **Block 2 – Vollausstattung/Fahrzeug raus:** Alle kundenseitigen „Vollequipment/Vollausstattung/
  Equipment-Träger/Fahrzeug"-Texte entfernt. 75/70-Tarif nur intern (`GS_PRICES.fahrzeug`, nie gerendert).
- **Block 3 – Preise final:** Tarif-Screen = 2 Tarife. Pilot **65/60**, Monat **70/65** (Einzel/Team,
  inkl. Spesen). Rate = Tarif × Team-Modus (`GS_PRICES`/`gsRate`). Quarterly/Annual/Single + alte
  Preise (67.90/66.50/68–70) entfernt; KI-Empfehlung mappt alte Vorschläge auf Pilot/Monat.
- **Block 6 – Lead-Detailansicht:** Lead im Dashboard klickbar → Overlay mit allen Daten
  (Kontakt mit tel:/mailto:, Baustelle/Adresse, Team/Personen, Tarif, Objekt, Beschreibung, Notiz)
  + „Jetzt anrufen". `api/dashboard.js` joint `gs_kunden` + liefert Detailfelder.
- **Block 7 – Lead-Mail:** Team/Personen + Tarif in der internen Lead-Alarm-Mail (`api/gs.js`)
  und in der DB-Notiz.
- **Block 8 – SHK→HKLS / Sprachen / Retext:** „SHK" → „HKLS" überall kundenseitig + BOB-Prompts +
  Mail-Footer (36 Stellen). Sprachumschalter jetzt **DE/EN/FR/IT/ES mit Flaggen**; volle FR- und
  IT-Übersetzung aller i18n-Keys (5/5 Sprachen, 65/65 Markup-Keys). „Begehung vereinbaren" →
  „Erstgespräch buchen" / „Anfrage abschicken – Dispo meldet sich <2 Std.".

## 🟡 Teilweise / offen (ehrlich)
- **Block 4 – i18n im GS-Flow:** Tarif- und Team-Screen sind jetzt i18n-fähig (statische Labels in
  5 Sprachen). Die übrigen GS-Screens (Erfassung, Datenblatt, Kontakt/Verfügbarkeit, Zusammenfassung,
  Buchung) haben weiterhin **hartcodierte deutsche** Formulartexte. Die i18n-Infrastruktur + FR/IT
  stehen — die restlichen ~50 GS-Formular-Strings müssen noch in Keys gezogen und in 5 Sprachen
  übersetzt werden (mechanisch, Folge-Schritt „Teil 2").
- **Block 5 – Voice ES:** Kein Code-Bug gefunden. `bobVoiceLang()` mappt korrekt
  (es-ES/fr-FR/it-IT), TTS nutzt `eleven_multilingual_v2` (ES/FR/IT funktionieren). Der Haupt-Mic
  (`startListening`) nutzt die **Browser-Spracherkennung**, deren ES/FR/IT-Unterstützung
  geräte-/browserabhängig ist → auf manchen Geräten „hört" BOB nur DE. Robuster Fix = Fallback auf
  die bereits vorhandene ElevenLabs-STT (`/api/voice` action:'stt'); das ist ein Umbau des
  Aufnahme-Pfads, der **echtes Geräte-Testing** braucht und daher bewusst nicht blind gebaut wurde.

## 🧪 Getestet
- Volle Regression gegen Live nach Deploy: **1004/0**.
- Automatisch: alle Inline-Scripts + `api/*.js` syntaxfrei; i18n 65/65 Keys in DE/EN/FR/IT/ES.
- ⚠️ **Emanuel muss im Browser klicken** (nicht automatisierbar hier): kompletter GS-Buchungs-Flow
  (Tarif → 2er-Team-Auswahl → Preis → Bestätigung), Sprachumschaltung DE/EN/FR/IT/ES,
  Voice-Eingabe auf echtem iOS/Android in ES/FR/IT, Lead-Detail-Overlay im Dashboard.

## ⚠️ Manuelle Aktionen (offen, aus früherem Lauf)
- Vercel-Env `RESEND_API_KEY` + Domain-Verifizierung (sonst keine Lead-Mails); echte `GS_PHONE`
  (Env + Konstante in index.html); `scripts/utm_tracking_migration.sql` (bereits gelaufen, bestätigt).
