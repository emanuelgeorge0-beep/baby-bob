# DEMO-READY — George Solutions / baby-bob

Stand: laufender Lauf auf Branch `fix/kritische-bugs`. Diese Datei dokumentiert pro Schritt
Befund, Fix, getestete Punkte und die manuellen Schritte, die Emanuel noch selbst machen muss.

---

## SCHRITT 0 — Datenkette Techniker-Rapport → Projekt ✅

**Befund (Live-Prüfung gegen Supabase `bmdmoehjwadvdlbrmpuq` + Production-API):**

- Die Tabelle heisst **`gs_tagesrapporte`** (nicht `gs_rapporte`). Sie hat eine Spalte
  `projekt_id` → das ist die Verknüpfung Rapport → Projekt. Zusätzlich verknüpft
  `gs_projekt_techniker` (projekt_id ↔ techniker_user_id) die Zuteilung.
- Material steckt direkt im Rapport als Array-Spalte **`material`** (`text[]`), zusätzlich
  optional als Positionen in `gs_rapport_positionen` (mehrere Projekte pro Tag).
- Materiallisten, die ein Techniker separat verschickt, landen in **`gs_nachrichten`**
  (`typ='materialliste'`, Inhalt mit `positionen` im `inhalt`-JSON).

**End-to-End-Test (Production):** Login als Techniker `techniker.test@georgesolutions.ch`
→ `tagesrapport save` mit `projekt_id` des Projekts „Tannenrauchstrasse 35" →
Rapport landet mit korrektem `projekt_id` und `material:["Kupferrohr 18mm x5"]` →
`tagesrapport list` liefert ihn zurück. **Kette funktioniert, keine Reparatur nötig.**
(Der Test-Rapport wurde danach wieder gelöscht, DB bleibt sauber.)

**Status DB aktuell:** 1 Projekt (P-2026-0001 Tannenrauchstrasse 35), 1 Techniker
zugeteilt (730172f2…), 0 echte Rapporte/Materiallisten — wird im echten Einsatz befüllt.

---

## SCHRITT 1 — Zurück-zum-Admin-Button überall ✅

**Befund:** Es gab bereits einen globalen Floating-Button `#admin-return-btn`
(„← Zurück zum Admin", links oben fixiert). Seine Sichtbarkeit war aber an ein Flag
`adminReturnArmed` gekoppelt, das nur gesetzt wurde, wenn man GS/BOB **über die
Admin-Hub-Karte** betrat → an anderen Wegen fehlte der Button.

**Fix:** `updateAdminReturnBtn()` zeigt den Button jetzt **immer**, sobald ein Admin
(`master`/`gs_admin`, kein Demo) sich ausserhalb der Admin-Screens befindet — GS-Modus,
Baby-BOB-Scanner, Login, Partner-/Techniker-Ansichten, alle Unterscreens. Alle
Navigations-Funktionen (`go`, `showScreen`, `setMode`, `enterAdminMode`) rufen die
Update-Funktion bereits auf. Klick → `adminReturnHome()` → `admin-home`.
Kein Leak: Für Nicht-Admins/Demo bleibt er aus (`isMasterContext()`).

## SCHRITT 2 — Voice aus GS-Modus ✅ (verifiziert, keine Änderung nötig)

`bobVoiceAllowed()` blockiert jede aktive `.gs-screen`/`.admin-screen`/`.tech-screen`/
`.login-screen` sowie alles mit `appMode!=='bob'` und respektiert `bobIsGsSilent()`.
Damit ist der GS-Modus tonlos; nur der Baby-BOB-Scanner (`.screen.active` in BOB-Mode)
spricht. Bereits in Commit `e2cf882` umgesetzt — hier nur bestätigt.

## SCHRITT 3 — PM-Detailansicht ✅

Projektmanagement → Projekt anklicken → Projektdatenblatt (`pbRender` in `app.html`).
Komplett überarbeitet:

- **Zugeteilter Techniker / Team** — Chips (zuweisen/entfernen wie bisher).
- **Rapporte (N)** — ALLE auf das Projekt gebuchten Rapporte aller Techniker, jeder mit
  **Status-Badge**:
  - `abgeschlossen` (grün) = Rapport eingereicht
  - `läuft noch in dieser KW` (gelb) = Entwurf in der aktuellen ISO-Kalenderwoche
  - `in Arbeit` (blau) = Entwurf aus einer früheren Woche
  Pro Rapport: Datum, Techniker, Stunden, Arbeiten und das jeweilige Material inline.
- **Stunden pro Techniker** — Admin-Auswertung (Summe je Techniker) + Gesamtsumme.
- **Materiallisten (N)** — ALLE Materiallisten zum Projekt (aus `gs_nachrichten`,
  gematcht über `projekt_id` ODER Projektname), mehrere Techniker / mehrere Listen.
- **AGQR entfernt:** Das alte „Material (aggregiert)"-Element (×-Zähler) ist raus und
  durch die echten Materiallisten ersetzt.
- **Partner-Sicht:** Partner sehen ihre eigenen Projekte read-only (Tab „Projekte" →
  Projekt öffnen): Stunden gesamt, Rapporte mit denselben Status-Labels inkl. Material,
  und alle Materiallisten. (`pdRenderProjektDetail`.)

## SCHRITT 4 — Materialliste per E-Mail (Resend + PDF) ✅

Im Projektdatenblatt: Sektion **„Materialliste senden"** → Empfänger-E-Mail eingeben
(Projektleiter vor Ort), optionale Notiz → **„📧 Materialliste per E-Mail senden"**.

- Sammelt alle Material-Positionen des Projekts (strukturierte Materiallisten-Positionen
  + Freitext-Material aus Rapporten, dedupliziert).
- Versand über **Resend**, Absender fix **info@george-solutions.ch** (`lib/mail.js`).
- Material sauber formatiert im **Mail-Body** (GS-Branding) **+ PDF-Anhang**
  (`lib/pdf.js → buildMaterialPdf`, dependency-frei).
- Backend: `api/nachrichten.js` (`action:'send', typ:'materialliste'`) hängt das PDF an.

**Tests:**
- `scripts/test-material-content.mjs` — **16/16 grün** (deploy-unabhängig, kein Key nötig):
  beweist, dass Mail-Body UND PDF die korrekten Positionen, Mengen und die Notiz enthalten.
- `scripts/test-material-mail.mjs` — echter End-to-End-Resend-Versand gegen das Deployment.
  **AUSGEFÜHRT am 2026-06-14 gegen das Preview-Deployment dieses Branches: 20 Durchläufe,
  101 Assertions, 0 Fehler — ALLE GRÜN.** Pro Durchlauf bestätigt: HTTP 200, `mail_sent=true`,
  echte `resend_id`, 3 korrekte Material-Positionen im Versand, PDF-Anhang erzeugt.
  Empfänger ist die Resend-Test-Adresse `delivered@resend.dev` → akzeptiert + „zugestellt",
  aber KEINE echte Mail an reale Postfächer → beliebig oft wiederholbar.
  Re-Run (das Preview ist Vercel-SSO-geschützt → Bypass-Secret nötig):
  `VERCEL_BYPASS=<secret> node scripts/test-material-mail.mjs <preview-url> 20`
  (Secret: Vercel → Projekt baby-bob → Settings → Deployment Protection →
  Protection Bypass for Automation.)

## SCHRITT 5 — WhatsApp-Button ✅ (final)

Im Projektdatenblatt neben dem Mail-Button:
**„💬 Per WhatsApp teilen (Empfänger frei wählbar)"**.

- Öffnet `https://api.whatsapp.com/send?text=<Materialliste als Text>` **OHNE festen
  Empfänger** → WhatsApp zeigt die Kontaktauswahl, der Nutzer wählt selbst (Projektleiter,
  Kollege, Gruppe). Funktioniert am Handy (iOS + Android).
- Material ist als Text vorausgefüllt (Projekt + Projektnummer, alle Positionen mit Menge).
- **Kein automatischer Versand** (technisch unmöglich) — der Nutzer drückt in WhatsApp
  selbst „Senden".
- **Kein Dateianhang** über WhatsApp (technisch nicht möglich); Dateiversand (PDF) bleibt
  bei der E-Mail.
- **`GS_WHATSAPP_NR='41764829428'`** ist als optionale GS-Schnellkontakt-/Support-Nummer
  hinterlegt (für einen evtl. „Kontakt GS"-Button). Der Materiallisten-Versand nutzt diese
  Nummer bewusst NICHT (freie Empfängerwahl).

---

## Preview-URL zum Selbst-Testen im Browser

**https://baby-bob-git-fix-kritische-bugs-baby-bob.vercel.app**

Im Browser bist du als Vercel-Projektinhaber eingeloggt → die Seite öffnet direkt
(die SSO-Schutzschranke betrifft nur anonyme Tools/curl, nicht deinen Browser).
Erster Test-Pfad: **GS-Modus öffnen → Projektmanagement → Projekt anklicken
(PM-Detailansicht: Status, Stunden/Techniker, Materiallisten) → Materialliste per
E-Mail + WhatsApp → „← Zurück zum Admin"-Button.**

## Manuelle Schritte für Emanuel

1. ✅ E2E-Mailtest 20× grün ausgeführt (siehe Schritt 4). Re-Run jederzeit möglich.
2. ✅ WhatsApp final eingebaut — Materiallisten-Versand mit freier Empfängerwahl;
   keine Nummer mehr nötig. Support-Nummer `41764829428` ist hinterlegt.
3. `RESEND_API_KEY` ist in Vercel für **production + preview** gesetzt (geprüft). ✓
4. `outputDirectory: "."` in `vercel.json` ist unverändert erhalten geblieben. ✓
5. Wenn alles im Browser passt: `fix/kritische-bugs` nach Production mergen/deployen.

Nur dieser eine Wert muss geändert werden; der WhatsApp-Button nutzt ihn automatisch.
