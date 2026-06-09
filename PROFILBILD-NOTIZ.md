# Profilbild / Cartoon-Avatar — zu klären (NICHT blind umgesetzt)

**Ziel:** Cartoon-Avatar (`emanuel-cartoon.jpg`) als Profilbild für Techniker
**Emanuel George**, User-UUID `ee46a716-7017-4045-9f67-fe06d05171e7`, Rolle `techniker`.

**Status: GESTOPPT** — kein klarer Avatar-Mechanismus + Bild fehlt. Auftragsregel:
„Falls es keine avatar_url-Spalte oder keinen klaren Avatar-Mechanismus gibt, NICHT raten
und KEINE Migration blind schreiben." Daher unten die offenen Punkte.

## Befunde (Code-Stand geprüft)

1. **Bild fehlt.** `emanuel-cartoon.jpg` liegt **nicht** im Repo (kein `/public/emanuel-cartoon.jpg`,
   `find . -iname "*cartoon*"` = leer). Es gibt nur `public/old/` (Landing-Assets). Ein `/public`
   für App-Avatare existiert nicht.

2. **Keine `avatar_url`-Spalte.** Es gibt aber **`gs_techniker.photo_url TEXT`**
   (in `scripts/setup_auth.sql`, `techniker_profile_migration.sql`, `rapport_system_migration.sql`).

3. **`photo_url` wird im Frontend NIRGENDS gerendert** (`grep photo_url index.html` = leer).
   - Techniker-**Showcase** (`gsRenderTechCard`, `.gs-tech-avatar`) zeigt ein **Emoji**: `t.photo_emoji || '👷'`.
   - Techniker-**Profil-Screen** (`showTechProfil`, `#tech-profil`) zeigt **gar kein** Avatar-/Bild-Element —
     nur Tarif, Name, Telefon, Qualifikation, Spezialisierung, IBAN, Speichern, Dokumente.

4. **`api/account.js` (`update_settings`)** akzeptiert ein Feld `photo_url`, schreibt es aber in
   `auth user_metadata` — **nicht** nach `gs_techniker.photo_url`. Beide sind voneinander getrennt
   und keines wird angezeigt. `api/techniker.js` liefert nur `photo_emoji` (Default `👷`).

5. **Kein Avatar-Storage-Bucket.** Vorhandene Buckets: `rapport-photos`, `rapport-signatures`,
   `rapport-pdfs`, `projekt-dokumente`. Kein `avatars`/`profile`-Bucket.

→ **Fazit:** Selbst wenn man `gs_techniker.photo_url` oder `user_metadata.photo_url` auf einen Pfad
setzt, erscheint **kein** Avatar, weil keine UI-Stelle ein Bild lädt. Es ist also nicht „nur Pfad
eintragen", sondern es fehlt (a) das Bild und (b) der Render-Mechanismus.

## Zu klären / Entscheidungen (bevor umgesetzt wird)

1. **Bild liefern:** Wo soll `emanuel-cartoon.jpg` liegen?
   - Variante A: statisch im Repo, z.B. `lib/avatars/emanuel-cartoon.jpg` (wird wie `/lib/...` ausgeliefert),
     `photo_url` zeigt auf `/lib/avatars/emanuel-cartoon.jpg`.
   - Variante B: Supabase Storage (neuer Bucket `avatars`, öffentlich oder signierte URL).

2. **Speicherort des Pfads:** `gs_techniker.photo_url` (empfohlen, Spalte existiert) **oder**
   `user_metadata.photo_url`? — Bitte EINE Quelle festlegen, sonst zwei Wahrheiten.

3. **Render-Mechanismus (Frontend muss ergänzt werden):**
   - Avatar-Element im Profil-Screen `#tech-profil` (oben, rund, mit Bild).
   - Showcase/Team-Karten: `photo_url` → `<img>`, Fallback auf `photo_emoji`.
   - `api/techniker.js` müsste `photo_url` mitliefern (aktuell nur `photo_emoji`).

4. **Ziel-Datensatz bestätigen:** UUID `ee46a716-7017-4045-9f67-fe06d05171e7` ist eine **andere**
   als der Test-Techniker (`730172f2-…`). Bitte bestätigen, dass dieser User Emanuels
   `gs_techniker`-Eintrag (`name = 'Emanuel George'`) ist bzw. damit verknüpft ist
   (`gs_techniker.user_id = ee46a716-…`), damit das Bild beim richtigen Profil landet.

## Empfohlener Weg (NICHT ausgeführt — wartet auf Freigabe)

1. `emanuel-cartoon.jpg` nach `lib/avatars/` ins Repo legen.
2. Frontend: Avatar-`<img>` im `#tech-profil` + `photo_url`-Fallback in Showcase/Team-Karten;
   `api/techniker.js` und `api/account.js me` geben `photo_url` zurück.
3. `gs_techniker.photo_url = '/lib/avatars/emanuel-cartoon.jpg'` für `user_id = ee46a716-…`
   (per REST-Update mit Service-Key, **keine** neue Migration nötig — Spalte existiert).

Sag, welche Varianten (1.A/1.B, 2, Ziel-UUID) gelten, dann setze ich es in einem Rutsch um.
