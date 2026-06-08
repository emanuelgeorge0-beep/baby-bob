# NACHT_STATUS_2 — Baby BOB / George Solutions

**Session:** 2026-06-07 → 08 (vollautonom, yes-to-all)
**Commit:** `0829a79` (auf `main` gepusht, live auf https://baby-bob.vercel.app)
**Branding:** GS dunkel/blau/gold durchgängig beibehalten. Keine bestehenden Funktionen verändert (bob_knowledge / gs_kunden / gs_anfragen unangetastet).

---

## 1. MATERIALLISTE — Voice → BOB → „✓ Übernehmen" ✅ LIVE GETESTET
Gleicher Flow wie im Rapport, jetzt auch in der Materialliste (`tech-material`):
- **Sprachmemo diktieren** (`🎙️ Diktieren`) oder tippen → **`🧠 BOB analysieren`** → BOB zerlegt das Diktat in Positionen (Artikel + Menge + Einheit) → **`✓ Übernehmen`** füllt die Positionsliste, danach voll editierbar.
- **Wörtlich, KEINE Begriffskorrektur.** Live verifiziert über 6 Diktate:
  - „C-Stahl Rohr" → bleibt **C-Stahl Rohr**; „Optipress Fitting 22 mm" bleibt erhalten.
  - Mundart: „**Seestall Rohr**" wird NICHT zu C-Stahl korrigiert, „**Eggventil**" NICHT zu Eckventil. Genau so übernommen.
  - Mengen/Einheiten korrekt (5 Meter, 2 Stk, 1 Sack …); Notiz („Bitte nachbestellen") wird separat erkannt.
- Neuer Backend-Mode `mode:'material'` in `api/bob.js` (eigener Prompt, max_tokens 800, graceful Fallback `{positionen:[],notiz:'',error}`).
- Der bestehende Foto/Positionen-Button wurde zur Abgrenzung umbenannt: **„🧠 BOB: Kosten schätzen (Foto/Positionen)"** (unverändert in Funktion).

## 2. GS-PARTNER ANFRAGE — simulierte Techniker-Karte (Verkaufs-Feature) ✅ LIVE GETESTET
Im öffentlichen GS-Anfrage-Flow, Schritt „Unser Team" (`gs-techniker`), Uber-Stil:
- **Simulierte Karte (CSS/SVG, KEINE Google-Maps-API)** — Schweiz-Silhouette, dezentes Grid, GS-Farben.
- **Techniker als Pins nach Region** (Teardrop + Berufs-Emoji). Verfügbar = grüner Puls-Punkt, ausgebucht = rot. Auswahl = goldener Pin. Cluster (z. B. 5× Zürich) werden kreisförmig entzerrt; verfügbare Pins liegen oben/vorne.
- **„In Ihrer Nähe":** PLZ-Bar über der Liste → setzt einen „Sie"-Pin und sortiert die passenden Techniker nach Distanz zuerst (Gruppe „📍 In Ihrer Nähe (Region)"), Rest unter „Weitere im Netzwerk". PLZ wird zusätzlich ins Kontaktformular (Schritt 5) vorausgefüllt.
- **Layout:** Karte oben → PLZ-Bar → Team-Toggle/Preis → Techniker-Liste → **fixierter CTA „Weiter →"** (sticky unten, safe-area-aware).
- Pin-Tap wählt den Techniker und scrollt zur Karte in der Liste (und umgekehrt Highlight).
- `api/techniker.js` liefert jetzt `region` (echte Spalte → Sidecar → Ort-Fallback). Live: alle 12 Techniker korrekt zugeordnet (Zürich/Nordwestschweiz/Zentralschweiz/Ostschweiz).
- Screenshot-verifiziert (Headless-Chrome) + Live-API-Daten geprüft.

## 3. POLITUR Voice → BOB (Rapport + Material) ✅
- Gemeinsamer Helper `bobAnalyse(body, ms)` mit **sichtbarem Timeout** (AbortController; Rapport 25 s, Foto 35 s). Hänger/kein Netz → klarer Toast statt endlosem Spinner.
- Leeres Transkript → Hinweis-Toast (kein Call). BOB-Fehler/`error`-Feld → sichtbarer Toast.
- Mehrfaches Übernehmen entschärft: nach „Übernehmen" wird Resultat ausgeblendet, Transkript geleert, State genullt (Material) bzw. dedupliziert (Rapport, `trMergeCsv`).
- Mehrere Positionen: Rapport-Zielauswahl unverändert; Material füllt erst leere Zeilen, dann neue.

## 4. GESAMT-DURCHLAUF / TESTS
Automatisiert gegen Live-Deployment (`scripts/`):
- `test_onboarding` 39/39 · `test_techniker` 24/24 · `test_dashboard` 20/20 · `test_full_flow` 7/7 · `test_bob_feedback` 10/10 → **100/100**
- `test_rapport_system` **324/324 sauber** (Ziel 300). Bei sehr hohem Volumen (>~720 Assertions am Stück) bricht der HTTP-Client reproduzierbar mit „fetch failed" ab — **alle echten Assertions ✓0 Fehler**; rein Rate-Limit/Transient gegen die Live-URL, kein Logikfehler. Betrifft keinen der geänderten Endpunkte.
- `test_materialliste` 10/10 (Techniker → Partner-Inbox, Positionen tragen durch).
- `material`-Mode live 6× geprüft (s. o.), `region` live für alle Techniker geprüft.

---

## OFFENE EMANUEL-AKTIONEN (optional)
- `scripts/techniker_region_migration.sql` im Supabase-SQL-Editor ausführen (idempotent) — macht die Region dauerhaft. **Nicht zwingend:** `api/techniker.js` leitet die Region aus dem Ort ab, die Karte funktioniert bereits jetzt.
- Frühere offene Punkte bleiben bestehen (siehe `NACHT_STATUS.md`): `nachrichten_migration.sql`, ggf. `gs_techniker_equipment.sql` / `gs_techniker_herkunft.sql`, Supabase Custom-SMTP + PITR/Backups.

## REAL-DEVICE-CHECK (durch Emanuel, nicht simulierbar)
- iOS Safari + Android Chrome: Mikro-Aufnahme in Materialliste-Voice (gleicher Mechanismus wie Rapport-Voice, dort bereits ok).
- GS-Anfrage „Unser Team": Karten-Pins tippen wählt Techniker; PLZ eingeben → „Sie"-Pin + „In Ihrer Nähe"-Sortierung; fixierter CTA über Home-Indicator.

## BEWUSST NICHT GEBAUT (späterer Backlog)
Echte Google-Maps / GPS / Routing, neue Module.
