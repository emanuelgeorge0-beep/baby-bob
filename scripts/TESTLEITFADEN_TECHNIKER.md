# Testleitfaden — Techniker-Cockpit (ein manueller Durchlauf)

Basis-Backend/UI aus Branch `schema-diagnose-rollen-foto-service` (bereits in main). Diese Runde (`feature-techniker-rapport-funktionen`) ergänzt: Kontakt/Adresse/Leistungen im Projekt-Detail, Rapport- und Material-Erfassung im Zahlungsplan-Kartenstil, Material-Chips. Voraussetzung: Branch ist **nach main gemergt & auf Vercel deployt**. Alles läuft mobil im Browser.

## Einmalige Vorbereitung (Emanuel)
1. **SQL** (Supabase SQL-Editor, service_role) — falls noch nicht gelaufen: `scripts/techniker_erstellt_von.sql`, `scripts/projekt_detail_scharf.sql` (liefert die Felder Projektadresse/Ansprechperson/Tel/Mail), `scripts/projekt_datenblatt.sql`. *(Haupt-Schema `schema_rollen_foto_service.sql` ist bereits drin.)* Alle Skripte sind idempotent — mehrfaches Ausführen schadet nicht.
2. **Supabase → Authentication → URL Configuration → Redirect URLs**: `https://baby-bob.vercel.app/login` ergänzen. `/gs-intern-7k2x` bleibt.
3. **Vercel Env** vorhanden lassen: `RESEND_API_KEY`, `GS_MAIL_FROM`. Optional `GS_APP_URL`.
4. SW-Cache ist auf **v15** — im Master-Cockpit und im Techniker-Cockpit einmal hart neu laden (Cmd+Shift+R bzw. App schliessen/neu öffnen), sonst bleibt die alte Version im Cache.

## Schritt-für-Schritt: Nievergelt-Projekt anlegen + dir zuweisen (Master)
1. Als **Master** einloggen → `/gs-intern-7k2x`.
2. Unten **„Mehr"** → **🏗️ Projektmanagement**.
3. **„＋ Neues Projekt"** antippen. Felder ausfüllen:
   - **Projektname \*** — z. B. „Nievergelt"
   - **Projektnummer** — optional, falls vorhanden
   - **Standort** — Ort/Gemeinde
   - **Projektadresse (Baustelle)** — die volle Adresse (Strasse, PLZ Ort) — das ist das **WO**
   - **Bereich** — z. B. „HKLS" / „Sanierung"
   - **Projektleiter** — optional
   - **Ansprechperson vor Ort** → Name: **Thomas Haag**
   - **Telefon** / **E-Mail** der Ansprechperson dazu (falls bekannt) — das ist das **WER**
   - Status **aktiv** lassen, Kunde optional
   - **„Speichern"**
4. Im geöffneten Projekt: **„＋ ausfüllen"** neben Datenblatt antippen (Projektdatenblatt) für das **WAS**:
   - **Anlagenart** ankreuzen (z. B. Sanitär/Heizung)
   - **Umfang** ankreuzen (die auszuführenden Leistungen)
   - Optional **Notiz** — z. B. Besonderheiten zum Auftrag
   - **„Datenblatt speichern"**
5. Zurück im Projekt, Abschnitt **„Techniker"** → **„＋ zuweisen"**:
   - Deine Techniker-Karte antippen (auswählen)
   - Stundentarif setzen
   - **Tätigkeit** kurz eintragen (z. B. „Servicearbeiten")
   - **„Zuweisen"**
6. ✅ Fertig — das Projekt ist jetzt dir als Techniker zugewiesen und erscheint im Techniker-Cockpit.

## Durchlauf (Techniker-Seite)
1. **Master legt Techniker an** — `/gs-intern-7k2x` → Benutzer → „＋" → Rolle **🔧 Techniker**, Name/E-Mail/Qualifikation → **Account erstellen**. *(Übersprungen, falls dein Techniker-Account schon existiert.)*
2. **Projekt zuweisen** — siehe Abschnitt oben (Nievergelt-Projekt).
3. **Einladungsmail** *(nur bei neuem Account)* — GS-branded Mail „👷 Techniker-Zugang" → **„Passwort setzen & einloggen"** → Pflicht-Profil.
4. **Onboarding-Tour** — 3 Karten (Projekte / Rapport & Fotos / Service), erscheint nur beim ersten Mal.
5. **Techniker-Cockpit (schwarz-gold)** — Bottom-Nav **Projekte · Service · Rapport · Profil**.
   - ✅ Unter **Projekte** erscheint **nur** das zugewiesene Projekt (kein fremdes).
   - ✅ Projekt öffnen → Karte **„📇 Kontakt & Adresse"** zeigt Adresse + Thomas Haag (Tel/Mail antippbar) und Karte **„🛠️ Leistungen"** zeigt Anlagenart/Umfang.
6. **Rapport buchen** — Projekt öffnen → „＋ Rapport buchen" (Karten im Zahlungsplan-Stil):
   - Karte **Datum & Stunden**: Datum **zurückdatieren** (z. B. letzte Woche), Stunden eintragen
   - Karte **Ausgeführte Arbeiten**: Tätigkeiten (eine pro Zeile)
   - Karte **Material**: häufige Positionen als **Chips antippen** (fügt automatisch eine Zeile ein) oder „＋ Position" für freie Zeilen (Bezeichnung + Menge), Zeilen mit ✕ löschbar
   - Karte **Notiz**: Besonderheiten
   - **„Rapport speichern"**
   - ✅ Rapport erscheint im Projekt (und im Master-PM-Detail, da `gs_tagesrapporte`).
7. **Foto + Video mit Stockwerk** — im Projekt „📷 Foto / Video": **Stockwerk** wählen (Preset **oder** frei), optional Raum/Bauabschnitt → „Aufnehmen/Auswählen":
   - Einmal **Foto**, einmal **Video** aufnehmen.
   - ✅ Galerie darunter **gruppiert nach Stockwerk**; Video mit abspielbarer Vorschau, Foto als Bild.
8. **Service-Auftrag** — (als Partner/Master einen Service-Auftrag anlegen & den Techniker zuweisen, Status „angenommen"). Im Techniker-Cockpit **Service**-Tab:
   - ✅ Zugewiesener Auftrag sichtbar → öffnen → Rapport/Fotos dranhängen → **„✓ Als erledigt markieren"**.
9. **Enforcement-Gegenprobe** (optional) — ein **nicht** zugewiesenes Projekt/Auftrag ist nirgends sichtbar; direkte API-Aufrufe darauf liefern 403 (automatisiert nachgewiesen: 33/33 live).

## Erwartetes Gesamtbild
Master legt Nievergelt-Projekt mit Adresse/Ansprechperson Thomas Haag/Leistungen an → weist dich als Techniker zu → im Techniker-Cockpit siehst du WO/WAS/WER auf einen Blick → rückdatierter Rapport mit Stunden/Arbeiten/Material (Chips) + Stockwerk-getaggte Foto/Video. Keine Marge-Felder (stundensatz/kosten) im Techniker-Blick.
