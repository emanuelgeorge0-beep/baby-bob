# NACHT-STATUS — George Solutions / Baby BOB

_Stand: 2026-06-07. Alle unten genannten Änderungen sind committet + auf `main` gepusht._

---

## ✅ Fertig (committet + gepusht)

### Techniker/Admin – kritische Bugfixes (`d144373`)
- **Scrollen:** `.tech-screen`/`.admin-screen` waren `min-height:100dvh` ohne `overflow-y` → bei `body{overflow:hidden}` nicht scrollbar. Jetzt echte Scroll-Container (`height:100dvh; overflow-y:auto; -webkit-overflow-scrolling:touch`), `padding-bottom:140px + safe-area`, dvh-Fallback, globaler `focusin`→`scrollIntoView` (Felder/Button über der Tastatur erreichbar).
- **Absenden:** Buttons waren nur von der Tastatur verdeckt (Scroll-Fix behebt es). Beide Handler (`trSave`, `tmSend`) gehärtet: „Sendet…" → „✓ Gesendet" / „⚠️ Fehler" + Toast + Meldung in den View gescrollt — nie stiller Abbruch.
- **Projektnr.** editierbar (`disabled` entfernt; vorbefüllt, überschreibbar).
- **Zurück-Buttons** in allen Sub-Views vorhanden; Demo-Banner verdeckt Inhalt nicht (`body.demo-on` Top-Padding).

### Block 2 — HKLS-Stichwort-Buttons (`25f2340`)
Feste, rechnungsreife Tätigkeiten (Fertigmontage, Ablaufleitung DN56/63/75/110, Aluverbundrohr, C-Stahl Heizungsinstallation, Edelstahl Wasserinstallation, Rohrisolation, Druckprobe …), Freitext „Weitere Tätigkeit", Mengen-/Artikelfeld pro gewähltem Material. **Keine** KI-Begriffskorrektur (sagt der Techniker „C-Stahl", bleibt „C-Stahl").

### Block 4 — Voice strikt nur im BOB-Scanner (`8bea398` + `25f2340`)
`bobVoiceAllowed()` erlaubt Sprache NUR bei Begrüßung + Diagnose im Scanner. Admin/Techniker/Partner komplett stumm. Stopp bei Navigation/Tab-Wechsel/`visibilitychange`/`pagehide`. Diagnose-Vorlesen gekürzt. Reserve-Flag `window.__bobAssistantActive` für den späteren KI-Assistenten (Stimme an Funktion gebunden, nicht an Account-Typ).

### Block 8 — IBAN-Validierung (`e5f5c43`)
`ibanValid()` (Format + Länderlänge + Mod-97), `phonePlausible()`. Im Techniker-Profil + Onboarding: ungültig → sichtbarer ⚠️-Hinweis, Feld rot, Speichern blockiert. Garbage wie „Atbebejjekwkwkwk" wird abgelehnt.

### Block 1 — Mehrere Projekte/Positionen pro Rapport-Tag (`4b18e56`)
„+ Weiteres Projekt / weitere Position": pro Position Projekt, Projektnr., Von/Bis (Auto-Stunden), Tätigkeiten, Material, Notiz, entfernbar. Σ-Gesamtstunden über alle Positionen. `api/tagesrapport.js` speichert Positionen in `gs_rapport_positionen` (best-effort). Additiv → keine Regression am bestehenden Einzel-Rapport.

### Conversion / Lead-Sicherung (`ea57fbd`) — Phase-2 Priorität 1+2
- Aktions-Badge „🎁 Erste 2 Stunden gratis — **ab Monatsvertrag** (nicht beim Pilot)" an GS-CTA + Erfassungs-Flow. Gold, seriös, kein Fake-Countdown, Marge geschützt.
- Success-Screen: „📞 Kostenloses Erstgespräch anfordern – Rückruf <2 Std. (werktags) · Unverbindlich & kostenlos" → markiert Lead (`status: 'Erstgespräch angefordert'`).
- Telefon + E-Mail Pflicht + Hinweistext; weiche Plausibilität (warnt, blockiert NICHT → Lead geht nie verloren). `api/gs` liefert `anfrage_id` zurück.

### Frühere Nächte (bereits gepusht)
Split-Landing GS/BOB, Regionen-Flaggen, GS-Telefon-CTA, Master-Zurück, Herkunftsflaggen, Navbar-Fix, branchenabhängige Diagnose-Optionen (`701df96`); GS-Logo in Landing/Booking/Login/Admin (`7016a97`, `3a9b96d`); Voice/i18n/oder-Chip (`8bea398`).

---

## ⚠️ MANUELL im Supabase SQL-Editor ausführen (idempotent)
Reihenfolge egal, alle `IF NOT EXISTS`:
1. **`scripts/rapport_positionen_migration.sql`** — NEU (Block 1): Tabelle `gs_rapport_positionen` + RLS. **Ohne diese Migration** wird der Rapport trotzdem gespeichert, aber die Zusatz-Positionen werden nicht persistiert (Frontend funktioniert, API loggt nur eine Warnung).
2. `scripts/gs_techniker_equipment.sql` — Equipment-Träger-Flag (frühere Nacht; optional, Name-Fallback wirkt auch ohne).
3. `scripts/gs_techniker_herkunft.sql` — Herkunftsflaggen CH/CH_AT (frühere Nacht; optional, Name-Fallback wirkt auch ohne).
4. `scripts/nachrichten_migration.sql` — falls noch nicht ausgeführt (Materialliste→Projektleiter).

---

## ❌ NICHT gebaut / bewusst zurückgestellt

- **Block 3 — Voice → BOB → Rapport-Übernehmen:** Mechanik (STT `tmDictate`, `🧠 BOB analysieren`) existiert in der Materialliste; der „✓ Bericht übernehmen"-Flow, der BOB-Vorschläge strukturiert in die Rapport-Felder füllt, ist **noch offen**. Das ist laut Phase-2 das **wertvollste nächste Feature** → höchste Priorität für die nächste Session. Erfordert: `api/bob.js` strukturierte Rapport-Ausgabe (Tätigkeiten/Material-Positionen) + Übernehmen-Button + Ladezustand. WICHTIG: nur formulieren/strukturieren, KEINE fachliche Begriffskorrektur.
- **Block 5 — i18n:** Engine + DE/ES/EN für die B2C-Kernflächen ist live (`8bea398`). Offen: weitere Sprachen (FR/IT/PT/TR/AR/AL/SR) und **RTL (Arabisch `dir="rtl"`)** — Struktur ist vorbereitet (data-i18n + `lib/regions.js`), Strings/Sprachen müssen ergänzt werden. Tiefe Sekundärflächen (Premium-Detailliste, Kontaktformular GS, „Über BOB") noch teils deutsch.
- **Block 6 — „oder"-Chip:** bereits in `8bea398` gefixt (Flex-Element, keine Überlappung). Erledigt.
- **Block 7 — GS Uber-Style (simulierte Karte):** **BACKLOG** gemäss Phase-2-Direktive („keine neuen Module, Fokus Leads/Conversion/Rapport/PM"). Migration `techniker_region` NICHT angelegt. Bei Bedarf später.

---

## 🔭 Morgen testen / offene Punkte
- Nach Ausführen von `rapport_positionen_migration.sql`: echten Multi-Positions-Rapport als eingeloggter Techniker senden → in `gs_rapport_positionen` + PDF/Abrechnung prüfen.
- Lead-Flow end-to-end mit echtem Login: Anfrage senden → „Erstgespräch anfordern" → im Lead-Dashboard erscheint Status „Erstgespräch angefordert".
- Real auf iOS Safari + Android Chrome: Scrollen mit offener Tastatur in Rapport/Material/Profil/Admin; Absenden beider Formulare; Aktions-Badge & Erstgespräch-CTA sichtbar.
- Voice: prüfen, dass in Techniker/Partner/Admin **nie** Sprache kommt; im Scanner Begrüßung + (gekürzte) Diagnose ok.

---

## Leitlinie (Phase 2)
Jede neue Entscheidung gegen die Frage prüfen: *„Hilft das Feature in den nächsten 90 Tagen, mehr Kunden zu gewinnen ODER bestehende Projekte effizienter abzuwickeln?"* — sonst Backlog. Fokus: Verkaufen · Auslastung · Kunden · Cashflow.
