# Datei-Upload – Testleitfaden (Branch fix/datei-upload)

Der Fix wirkt im **Partner-Cockpit** (`app.html`, Route `/app`). Dieses Cockpit nutzt
**keinen** Service-Worker → der Fix ist nach Deploy sofort aktiv (ggf. einmal Hard-Reload
/ neu laden). Der SW-Cache-Bump (v9 → v10) betrifft nur das Master-Cockpit `/gs-intern-7k2x`.

## Haupttest — grosses Foto (der eigentliche Regressionsfall) — 4 Klicks
1. `/app` öffnen, als **Partner** einloggen (Feature „Projektmanagement" freigeschaltet).
2. **Projekte** → ein Projekt öffnen.
3. Bei der Kategorie **Bilder** auf **„＋ hochladen"** → ein **grosses Handy-Foto (5–9 MB)** wählen.
4. Erwartung:
   - Toast **„1 hochgeladen"** (kein „zu gross (max. 3 MB)" mehr).
   - Das Foto erscheint sofort in der **Bilder-Galerie** des Projekts.

**Wo die Datei danach liegen muss:** Supabase → Storage → Bucket **`projektdateien`**
→ Ordner **`<projekt-id>/bilder/`** → Datei `…-<name>.jpg` (Bilder werden als JPEG
komprimiert abgelegt, Endung `.jpg`). Über die Galerie per signierter URL abrufbar.

## Gegentest — grosses PDF (klarer Fehler statt lautlos) — 2 Klicks
1. Bei Kategorie **Pläne** auf **„＋ hochladen"** → ein **PDF > 3 MB** wählen.
2. Erwartung: Toast **„… zu gross für Direkt-Upload (max ~3 MB) — bitte komprimieren."**
   → sichtbare Abweisung, kein stilles Scheitern. Ein PDF **< 3 MB** lädt normal hoch
   und erscheint unter `<projekt-id>/plaene/`.

## Optional — Sub-/Akkord-Projekt
Gleicher Ablauf im **Sub-/Akkord-Bereich** (Upload → `sub_datei_upload`, gleicher Bucket).

## Regressionscheck (nicht kaputt gemacht)
- Kleines Foto/PDF (< 3 MB) lädt weiter normal.
- Master-Cockpit (`/gs-intern-7k2x`) Datei-Upload unverändert (12-MB-Grenze).
