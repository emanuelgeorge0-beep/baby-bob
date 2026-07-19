# Testleitfaden — Mehrfachrollen + Demo-Accounts

Branch `feature-multirole-und-demo`. Voraussetzung: **nach main gemergt & deployt** (SW v14).

## Einmalige Vorbereitung
1. **SQL** (Supabase SQL-Editor, service_role): `scripts/user_extra_roles.sql` ausführen.
   → legt die additive Tabelle `user_extra_roles` an, schaltet **dich (Master) zusätzlich als Techniker** frei und legt/verknüpft dein `gs_techniker`-Profil.
2. **Deploy:** Branch → main (Vercel Auto-Deploy).
3. **Demo-Daten** (schon einmal gelaufen; bei Bedarf erneut, idempotent):
   `node --env-file=.env.local scripts/seed_demo_accounts.mjs`

---

## Flow A — Du (Emanuel) als Master **und** Techniker, mit Umschalten
1. Öffne dein Master-Cockpit `/gs-intern-7k2x` (Login `emanuelgeorge0@gmail.com`).
2. Weise dich selbst einem Projekt zu: Projekt öffnen → **Techniker zuweisen** → „Emanuel George" wählen. *(Erscheint im Pool, weil Schritt-1-SQL dein gs_techniker-Profil angelegt hat.)*
3. Oben in der Topbar erscheint **„🔧 Techniker-Ansicht"** → anklicken.
   - ✅ Du landest im schwarz-gold **Techniker-Cockpit** (app.html), siehst **nur die dir zugewiesenen** Projekte, **keine** Marge-Felder (kein stundensatz/kosten).
4. Im Techniker-Hero oben links: Pill **„👑 Master ⇄ 🔧 Techniker"** → **Master** bringt dich zurück ins `/gs-intern-7k2x`.
5. Gegenprobe Sicherheit: Im Techniker-Modus werden Server-seitig nur Techniker-Rechte gewährt — das Umschalten ändert **nur die Sicht**, nie die Rechte (mock- & live-verifiziert).

## Flow B — Bestehender Mail eine zusätzliche Rolle geben (der gemeldete Bug)
1. `/gs-intern-7k2x` → **Benutzer** → „＋ Neuen Benutzer anlegen".
2. Gib eine **bereits existierende** E-Mail ein + wähle eine Rolle → **Account erstellen**.
   - ✅ Statt „E-Mail ist bereits registriert" kommt jetzt: **„E-Mail existiert bereits — Rolle zusätzlich geben?"** (mit den aktuellen Rollen). Bestätigen → Rolle wird ergänzt (bei Techniker inkl. gs_techniker-Profil).

## Flow C — Demo-Accounts fürs Video
Logins (nach dem Seed):
- **Demo-Partner:** `demo.partner@demo.felix.app` / `FelixDemo2026!`
- **Demo-Techniker:** `demo.techniker@demo.felix.app` / `FelixDemo2026!`

1. **Partner zeigen:** `/login` → Demo-Partner → Partner-Cockpit mit **3 DEMO-Projekten** (DEMO-001/002/003) + 1 Service-Auftrag.
2. **Techniker zeigen:** `/login` → Demo-Techniker → Techniker-Cockpit mit den **3 zugewiesenen** DEMO-Projekten, rückdatierten Rapporten, Service-Auftrag „DEMO · Notdienst Heizung Wetzikon".
3. **Master zeigen:** dein echtes Master-Login `/gs-intern-7k2x` — die DEMO-###-Projekte liegen dort neben deinen echten; du kannst live zuweisen/ansehen. **Master = echter Login auf dem isolierten Demo-Datensatz** (kein zweiter Master-Account, keine Vermischung).

**Alles wieder entfernen:** `node --env-file=.env.local scripts/cleanup_demo_accounts.mjs`
(löscht DEMO-Projekte inkl. Zuweisung/Rapporte/Medien, den Demo-Service-Auftrag und beide Demo-Accounts).

---

## Sicherheit (Kurzfassung)
- `user_roles` bleibt Primärrolle; zusätzliche Rollen in `user_extra_roles`. Effektive Rollen = Primär ∪ Extra.
- Jede Cockpit-Action wird serverseitig gegen die **tatsächlich gehaltenen** Rollen geprüft. Der Client-`mode` steuert nur die Sicht — ein `mode`, den der User nicht hält, wird **ignoriert** (keine Rechte-Eskalation; getestet: Techniker mit `mode=master` → 403).
- `MASTER_UID`-Lock und die Techniker-Kette (`auth.uid → gs_techniker.user_id → id → techniker_id`) unverändert.
