# Testleitfaden – Fix „Neues Projekt buchen" (Partner-Cockpit)

**Branch:** feat/projekt-buchen-fix · **SW-Cache:** gs-cockpit-v12

## Ursache (Block 1)
Button `app.html:2657` rief `setMode('gs')` → öffentlicher George-Solutions-B2C-Buchungstrichter
(`#gs-home`, gelbe Landing). Legte die GS-`.screen` über das `#partner-dash` (`.admin-screen`)
ohne Rückweg → gefühlter Logout (Token blieb faktisch erhalten).

## Fix (Block 2)
`app.html:2657` neu:
```html
<button class="admin-add-btn" onclick="pmMode='kapazitaet';pdTab('projekte');">+ Neues Projekt buchen</button>
```
Cockpit-intern: setzt Standard-Modus **Kapazitätsunterstützung**, öffnet den Projekte-Tab
via `pdTab('projekte')` → `pmRender()`. Kein `setMode`, kein `appMode`-Wechsel, `#partner-dash`
und Session bleiben. Sonst nichts geändert.

## Test (als eingeloggter Partner, gs_partner)
1. **Login** über Partner-/Techniker-Login (app.html). Cockpit-Startseite `#partner-dash` sichtbar.
2. Auf der Startseite **„+ Neues Projekt buchen"** tippen.
   - ✅ Bleibt in `#partner-dash` (Header „PARTNER COCKPIT" bleibt, kein gelbes GS-Muster).
   - ✅ Projekte-Tab aktiv (Bottom-Nav „Projekte" markiert), Segment **Kapazitätsunterstützung** vorausgewählt.
   - ✅ Kein Logout: „Abmelden" oben, keine Login-/Landing-Seite, Account unverändert.
3. Im Projekte-Bereich Segment **„Sub-/Akkordprojekte"** antippen.
   - ✅ Umschalter erreichbar; wechselt in den Sub-Bereich (sofern Feature `sub_akkord` frei).
   - ✅ Zurück auf **„Kapazitätsunterstützung"** funktioniert.
4. **Reload** (F5) auf der Seite.
   - ✅ Partner bleibt eingeloggt, landet wieder im `#partner-dash` (Token-Restore via initAuth).
5. **Grenzfälle:**
   - Partner ohne `projektmanagement`, aber mit `sub_akkord`: Button öffnet Projekte-Tab,
     `pmRender()` schaltet automatisch auf Sub-Bereich (kein toter Screen).
   - Partner ohne beide Rechte: Tab zeigt gesperrt-Hinweis, kein GS-Sprung, kein Logout.

## Regressionscheck
- Master-Cockpit (`gs-intern.html`, `/gs-intern-7k2x`) unberührt – nur `cockpit-sw.js`-Version erhöht → holt neue Assets.
- `setMode('gs')` bleibt an allen anderen Stellen (B2C-Landing, Mode-Toggle) unverändert.
