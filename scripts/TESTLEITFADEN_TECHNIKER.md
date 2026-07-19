# Testleitfaden — Techniker-Cockpit (ein manueller Durchlauf)

Branch `schema-diagnose-rollen-foto-service`. Voraussetzung: Branch ist **nach main gemergt & auf Vercel deployt** (die neue API + das Cockpit sind sonst nur lokal). Alles läuft mobil im Browser.

## Einmalige Vorbereitung (Emanuel)
1. **SQL** (Supabase SQL-Editor, service_role): `scripts/techniker_erstellt_von.sql` ausführen (additive Spalte `erstellt_von_user_id`). *(Das Haupt-Schema `schema_rollen_foto_service.sql` ist bereits drin.)*
2. **Supabase → Authentication → URL Configuration → Redirect URLs**: `https://baby-bob.vercel.app/login` ergänzen (sonst landet der Einladungslink auf der Startseite statt im Login). `/gs-intern-7k2x` bleibt.
3. **Vercel Env** vorhanden lassen: `RESEND_API_KEY`, `GS_MAIL_FROM` (für die Einladungsmail). Optional `GS_APP_URL` (Default `https://baby-bob.vercel.app`).
4. SW-Cache ist auf **v13** — im Master-Cockpit ggf. einmal hart neu laden.

## Durchlauf
1. **Master legt Techniker an** — `/gs-intern-7k2x` → Benutzer → „＋" → Rolle **🔧 Techniker**, Name/E-Mail (echte, erreichbare Adresse)/Qualifikation → **Account erstellen**.
   - ✅ Bestätigung zeigt „✉️ Einladung … gesendet" (+ Start-Passwort als Fallback).
   - ✅ Techniker taucht sofort in der Technikerliste **und** im Zuweisungs-Pool auf.
2. **Projekt zuweisen** — Projekt öffnen → Techniker zuweisen (bestehender Flow `pm_tech_assign`). Wähle den neuen Techniker.
3. **Einladungsmail** — im Postfach: GS-branded Mail „👷 Techniker-Zugang" → Button **„Passwort setzen & einloggen"**.
   - ✅ Landet auf `…/login` → **Passwort setzen** (Pflicht) → **Pflicht-Profil** (Qualifikation/Spezialisierung/IBAN/Tel).
4. **Onboarding-Tour** — 3 dezente Karten (Projekte / Rapport & Fotos / Service) → „Los geht's" (erscheint nur beim ersten Mal).
5. **Techniker-Cockpit (schwarz-gold)** — Bottom-Nav **Projekte · Service · Rapport · Profil**.
   - ✅ Unter **Projekte** erscheint **nur** das zugewiesene Projekt (kein fremdes).
6. **Rapport buchen** — Projekt öffnen → „＋ Rapport buchen": **Datum zurückdatieren** (z. B. letzte Woche), Stunden, Arbeiten/Material (je Zeile), Notiz → **speichern**.
   - ✅ Rapport erscheint im Projekt (und im Master-PM-Detail, da `gs_tagesrapporte`).
7. **Foto + Video mit Stockwerk** — im Projekt „📷 Foto / Video": **Stockwerk** wählen (Preset **oder** frei), optional Raum/Bauabschnitt → „Aufnehmen/Auswählen":
   - Einmal **Foto**, einmal **Video** aufnehmen.
   - ✅ Galerie darunter **gruppiert nach Stockwerk**; Video mit abspielbarer Vorschau, Foto als Bild.
8. **Service-Auftrag** — (als Partner/Master einen Service-Auftrag anlegen & den Techniker zuweisen, Status „angenommen"). Im Techniker-Cockpit **Service**-Tab:
   - ✅ Zugewiesener Auftrag sichtbar → öffnen → Rapport/Fotos dranhängen → **„✓ Als erledigt markieren"**.
9. **Enforcement-Gegenprobe** (optional) — ein **nicht** zugewiesenes Projekt/Auftrag ist nirgends sichtbar; direkte API-Aufrufe darauf liefern 403 (bereits automatisiert nachgewiesen: 33/33 live).

## Erwartetes Gesamtbild
Master legt an → Mail raus → Techniker setzt PW → GS-Cockpit → rückdatierter Rapport + Stockwerk-getaggte Foto/Video → Service-Auftrag sichtbar & erledigbar. Keine Marge-Felder (stundensatz/kosten) im Techniker-Blick.
