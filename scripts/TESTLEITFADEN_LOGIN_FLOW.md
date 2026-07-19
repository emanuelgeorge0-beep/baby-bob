# Testleitfaden — Login-Flow geschlossen + vereinheitlicht + schwarz-gold

Branch `feature-login-flow-schliessen`. Voraussetzung: nach main gemergt & deployt.

## ⚠️ Brauche ich Cmd+Shift+R nach dem Merge?
**Ja, einmal empfohlen** — aber nur als Vorsichtsmassnahme:
- `app.html` ist **nicht** Service-Worker-gecacht (der einzige SW `cockpit-sw.js` gehört zu `/gs-intern-7k2x`, den diese Runde nicht anfasst — Version bleibt v14).
- Nach dem Deploy liefert Vercel `app.html` frisch aus; ein normaler Reload genügt meist. Da aber Browser/PWA die HTML/CSS zwischenspeichern können, mach nach dem Merge **einmal Cmd+Shift+R** (Desktop) bzw. am Handy: App schliessen & neu öffnen / Pull-to-Refresh. Danach ist kein weiterer Hard-Reload nötig.
- Das **Master-Cockpit** (`/gs-intern-7k2x`) ist unverändert — dort ist **kein** Reload nötig.

---

## Teil 1 — „Ohne Login"-Weg ist wirklich weg (Sicherheit)
1. Öffne `/login`.
   - ✅ Es gibt **keinen** Button „🔧 Techniker – ohne Login starten" mehr.
   - ✅ Es gibt keinen „🧪 Demo-Modus (ohne Login)"-Block mehr.
   - ✅ Nur noch: E-Mail + „Magic Link" / „Mit Passwort anmelden" + „Passwort vergessen".
2. „Ohne Anmeldung weiter (BOB Scanner – nur Endkunden)" bleibt — Klick führt in den **anonymen BOB-Scanner** (Endkunden). Dort gibt es **keine** Projekt-/Techniker-/Rollen-Daten; jeder rollen-geschützte Server-Aufruf würde 403 liefern (Enforcement serverseitig, mock- & live-verifiziert).

## Teil 2 — EIN Login für alle Rollen → richtiges Cockpit
Der Server entscheidet nach Login anhand der **echten** Rolle (nicht Client-Angabe).

- **Als Master:** `emanuelgeorge0@gmail.com` → über `/login` (oder wie gewohnt `/gs-intern-7k2x`). Multirole (Master+Techniker) → oben Umschalter (falls `user_extra_roles.sql` gelaufen).
  *(Hinweis: Der dedizierte Master-Einstieg bleibt `/gs-intern-7k2x`; der CEO-/Admin-Zugang war für diese Runde ausdrücklich ausgeklammert.)*
- **Als Partner:** Demo-Partner `demo.partner@demo.felix.app` / `FelixDemo2026!` → `/login` → landet im **Partner-Cockpit** (schwarz-gold).
- **Als Techniker:** Demo-Techniker `demo.techniker@demo.felix.app` / `FelixDemo2026!` → **derselbe** `/login` → landet im **Techniker-Cockpit** (schwarz-gold), sieht nur zugewiesene Projekte, keine Marge-Felder.

**Weg-Check:** Landing (GS-Seite) → GS-Onboarding → „🔑 Partner / Techniker Login" → **dieser eine Login** → korrektes Cocksit je Rolle. Durchgängig, geschlossen.

## Teil 3 — Design aus einem Guss (schwarz-gold)
Durchklicken und prüfen, dass **kein Blau-Bruch** mehr auftritt:
1. **Landing** → GS-Hälfte ist jetzt schwarz-gold (BOB-Hälfte bleibt bewusst neon — B2C).
2. **GS-Onboarding**: „HKLS-Expertise auf Abruf", Erfassung, Datenblatt, Tarif, Team, Bestätigung, Buchung — alle schwarz-gold, Akzente in Gold (#C9A961). Inhalt/Funktion (Neues Projekt erfassen, Erstgespräch, CHF 60/h, 4 Bereiche) unverändert.
3. **Login-Screen**: schwarz-gold, Gold-Buttons.
4. **BOB-Scanner** (Baby-BOB, Endkunden): unverändert neon — soll so bleiben.

---

## Erwartetes Gesamtbild
Kein Login-freier Rollen-Zugang mehr · ein Login für alle Rollen mit serverseitigem Routing · Landing → Onboarding → Login → Cockpit optisch aus einem Guss. Enforcement-Kette, MASTER_UID-Lock und Multirole-Umschalter unangetastet.
