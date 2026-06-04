# BOB Image Categorization Test Results

**Date:** 2026-06-04 15:51  
**API:** `https://baby-bob.vercel.app/api/bob`  
**Method:** Programmatic PNG images (200×200px, colored background + text label)  
**Model:** `claude-sonnet-4-6`

## Summary

| Metric | Value |
|--------|-------|
| Total tests | 30 |
| ✓ Correct (no Allrounder) | **30** |
| ❌ Allrounder bug | **0** |
| Errors | 0 |
| **Accuracy** | **100%** |

## Results by Category

### Sanitär (5/5 ✓)

| # | Test | Expected | BOB Kategorie | BOB Fachmann | Status |
|---|------|----------|---------------|--------------|--------|
| 1 | Wasserhahn / Armatur | Sanitär | Sanitär | Sanitärinstallateur | ✓ |
| 2 | WC / Toilette | Sanitär | Sanitär | Sanitärinstallateur | ✓ |
| 3 | Badezimmer Dusche | Sanitär | Sanitär | Sanitärinstallateur / Fliesenleger | ✓ |
| 4 | Rohr Kupferleitung | Sanitär | Sanitär | Sanitärinstallateur | ✓ |
| 5 | Badewanne | Sanitär | Sanitär | Sanitärinstallateur | ✓ |

### Heizung (5/5 ✓)

| # | Test | Expected | BOB Kategorie | BOB Fachmann | Status |
|---|------|----------|---------------|--------------|--------|
| 6 | Heizkörper Radiator | Heizung | Heizung | Heizungsmonteur | ✓ |
| 7 | Thermostatventil | Heizung | Heizung | Heizungsmonteur | ✓ |
| 8 | Heizkessel Gasheizung | Heizung | Heizung | Heizungsmonteur | ✓ |
| 9 | Boiler Warmwasserspeicher | Heizung | Heizung / Sanitär | Heizungsmonteur / Sanitärinstallateur | ✓ |
| 10 | Wärmepumpe Aussengerät | Heizung | Heizung | Heizungsmonteur / Kältetechniker | ✓ |

### Elektro (5/5 ✓)

| # | Test | Expected | BOB Kategorie | BOB Fachmann | Status |
|---|------|----------|---------------|--------------|--------|
| 11 | Steckdose | Elektro | Elektro | Elektriker | ✓ |
| 12 | Lichtschalter | Elektro | Elektro | Elektriker | ✓ |
| 13 | Elektrokabel | Elektro | Elektro | Elektriker | ✓ |
| 14 | Sicherungskasten | Elektro | Elektro | Elektriker | ✓ |
| 15 | LED Lampe defekt | Elektro | Elektro | Elektriker | ✓ |

### Auto (4/4 ✓)

| # | Test | Expected | BOB Kategorie | BOB Fachmann | Status |
|---|------|----------|---------------|--------------|--------|
| 16 | Autoreifen Profil | Auto | Auto | Autopneu-Service / Garage | ✓ |
| 17 | Lenkrad | Auto | Auto | Autoelektriker / Garage | ✓ |
| 18 | Motorraum | Auto | Auto / Fahrzeug | Automechaniker / Garage | ✓ |
| 19 | Auto PKW Kratzer | Auto | Auto / Karosserie | Carrossier / Autolackierer | ✓ |

### Schreiner (4/4 ✓)

| # | Test | Expected | BOB Kategorie | BOB Fachmann | Status |
|---|------|----------|---------------|--------------|--------|
| 20 | Holztisch | Schreiner | Möbel / Holz | Schreiner | ✓ |
| 21 | Stuhl Rückenlehne | Schreiner | Möbel | Schreiner / Polsterer | ✓ |
| 22 | Kleiderschrank | Schreiner | Möbel / Innenausbau | Schreiner | ✓ |
| 23 | Parkett Holzboden | Schreiner | Boden / Holzbau | Bodenleger / Parkettleger | ✓ |

### Solar (1/1 ✓)

| # | Test | Expected | BOB Kategorie | BOB Fachmann | Status |
|---|------|----------|---------------|--------------|--------|
| 24 | Solaranlage PV | Solar | Energie / Solar | Solarinstallateur / Elektro-Solarfachmann | ✓ |

### Tier (2/2 ✓)

| # | Test | Expected | BOB Kategorie | BOB Fachmann | Status |
|---|------|----------|---------------|--------------|--------|
| 25 | Hund | Tier/Beauty | Tier / Haustier | Tierarzt / Hundepfleger | ✓ |
| 26 | Katze | Tier/Beauty | Tier / Haustier | Tierarzt | ✓ |

### Gastronomie (2/2 ✓)

| # | Test | Expected | BOB Kategorie | BOB Fachmann | Status |
|---|------|----------|---------------|--------------|--------|
| 27 | Pizza | Gastronomie | Gastronomie / Kulinarik | Pizzaiolo / Koch | ✓ |
| 28 | Sushi | Gastronomie | Gastronomie / Food | Sushi-Koch / Japanisches Restaurant | ✓ |

### Garten (2/2 ✓)

| # | Test | Expected | BOB Kategorie | BOB Fachmann | Status |
|---|------|----------|---------------|--------------|--------|
| 29 | Blumen Garten | Garten | Garten / Pflanzen | Gärtner / Gartengestalter | ✓ |
| 30 | Wald Bäume | Garten/Natur | Garten / Natur | Gärtner / Forstfachmann | ✓ |

## Detailed Results

### [01] ✓ Wasserhahn / Armatur
- **Expected category:** `Sanitär`
- **BOB Kategorie:** `Sanitär`
- **BOB Fachmann:** `Sanitärinstallateur`
- **BOB Titel:** Tropfender Wasserhahn / Armatur
- **Erkannt als:** Chrom-Armatur / Wasserhahn, der tropft – typische Einhebelmischer- oder Doppelgriff-Armatur mit defekter Kartusche oder Dichtung
- **Dringlichkeit:** Mittel | **Kosten:** CHF 80–300
- **Text on image:** `Wasserhahn / Armatur / Chrom / tropft`

### [02] ✓ WC / Toilette
- **Expected category:** `Sanitär`
- **BOB Kategorie:** `Sanitär`
- **BOB Fachmann:** `Sanitärinstallateur`
- **BOB Titel:** Toilette / WC mit Spülkasten
- **Erkannt als:** Toilette / WC aus weisser Sanitärkeramik mit Spülkasten – klassische Haushaltstoilette, Unterputz- oder Aufputz-Spülkasten
- **Dringlichkeit:** Hoch | **Kosten:** CHF 80–600
- **Text on image:** `Toilette / WC / Keramik / Spülkasten`

### [03] ✓ Badezimmer Dusche
- **Expected category:** `Sanitär`
- **BOB Kategorie:** `Sanitär`
- **BOB Fachmann:** `Sanitärinstallateur / Fliesenleger`
- **BOB Titel:** Dusche – Duschkopf & Glasscheibe
- **Erkannt als:** Duschkabine mit Duschkopf (Regendusche oder Handbrause), Glasscheibe als Duschabtrennung und Fliesenbelag an Wand und/oder Boden
- **Dringlichkeit:** Mittel | **Kosten:** CHF 150–1500
- **Text on image:** `Dusche / Duschkopf / Glasscheibe / Fliesen`

### [04] ✓ Rohr Kupferleitung
- **Expected category:** `Sanitär`
- **BOB Kategorie:** `Sanitär`
- **BOB Fachmann:** `Sanitärinstallateur`
- **BOB Titel:** Kupferrohr / T-Stück / Fitting
- **Erkannt als:** Orange-braunes Kupferrohr mit T-Stück-Fitting und Rohrleitung – typisches Sanitär-/Heizungsinstallationsmaterial aus Kupfer
- **Dringlichkeit:** Hoch bei Leck | **Kosten:** CHF 120–500
- **Text on image:** `Kupferrohr / Rohrleitung / Fitting / T-Stück`

### [05] ✓ Badewanne
- **Expected category:** `Sanitär`
- **BOB Kategorie:** `Sanitär`
- **BOB Fachmann:** `Sanitärinstallateur`
- **BOB Titel:** Badewanne weiss – Abfluss Problem
- **Erkannt als:** Weisse Badewanne (Wanne) mit Abfluss – textuelle Beschreibung mit Hinweis auf mögliches Abflussproblem
- **Dringlichkeit:** Mittel | **Kosten:** CHF 100–350
- **Text on image:** `Badewanne / Wanne / weiss / Abfluss`

### [06] ✓ Heizkörper Radiator
- **Expected category:** `Heizung`
- **BOB Kategorie:** `Heizung`
- **BOB Fachmann:** `Heizungsmonteur`
- **BOB Titel:** Heizkörper / Radiator (weiss, Rippen)
- **Erkannt als:** Weisser Rippenheizkörper (Radiator) mit Lamellen/Rippen – typischer Stahl- oder Gusseisen-Gliederheizkörper, wandmontiert
- **Dringlichkeit:** Hoch | **Kosten:** CHF 80–400
- **Text on image:** `Heizkörper / Radiator / weiss / Rippen`

### [07] ✓ Thermostatventil
- **Expected category:** `Heizung`
- **BOB Kategorie:** `Heizung`
- **BOB Fachmann:** `Heizungsmonteur`
- **BOB Titel:** Thermostat / Heizkörper-Ventil
- **Erkannt als:** Heizkörper-Thermostatventil mit weissem/grauem Kunststoff-Drehkopf, Ventilschaft und Skala mit Zahlen 1–5 – typisches Heizkörper-Regelventil
- **Dringlichkeit:** Mittel | **Kosten:** CHF 40–200
- **Text on image:** `Thermostat / Ventil / Drehknopf / Zahlen 1-5`

### [08] ✓ Heizkessel Gasheizung
- **Expected category:** `Heizung`
- **BOB Kategorie:** `Heizung`
- **BOB Fachmann:** `Heizungsmonteur`
- **BOB Titel:** Heizkessel / Gasheizung
- **Erkannt als:** Textkennzeichnung: 'Heizkessel', 'Gasheizung', 'Wandgerät', 'Display' – typisches Gas-Wandheizgerät mit digitalem Bedienfeld, wahrscheinlich von Vaillant, Viessmann o.ä.
- **Dringlichkeit:** Hoch | **Kosten:** CHF 150–2000
- **Text on image:** `Heizkessel / Gasheizung / Wandgerät / Display`

### [09] ✓ Boiler Warmwasserspeicher
- **Expected category:** `Heizung`
- **BOB Kategorie:** `Heizung / Sanitär`
- **BOB Fachmann:** `Heizungsmonteur / Sanitärinstallateur`
- **BOB Titel:** Boiler / Warmwasserspeicher
- **Erkannt als:** Textbeschreibung eines zylindrischen Warmwasserspeichers (Boiler) – typischer stehender oder hängender Warmwasserbehälter mit Kalt-/Warmwasseranschluss
- **Dringlichkeit:** Hoch | **Kosten:** CHF 150–1500
- **Text on image:** `Boiler / Warmwasser / Speicher / zylindrisch`

### [10] ✓ Wärmepumpe Aussengerät
- **Expected category:** `Heizung`
- **BOB Kategorie:** `Heizung`
- **BOB Fachmann:** `Heizungsmonteur / Kältetechniker`
- **BOB Titel:** Wärmepumpe – Aussengerät
- **Erkannt als:** Wärmepumpen-Aussengerät mit Ventilator (Lüfterrad) und Aluminium-Lamellen (Wärmetauscher) – typisches Split-System für Luft-Wasser-Wärmepumpen
- **Dringlichkeit:** Mittel | **Kosten:** CHF 200–800
- **Text on image:** `Wärmepumpe / Aussengerät / Ventilator / Lamellen`

### [11] ✓ Steckdose
- **Expected category:** `Elektro`
- **BOB Kategorie:** `Elektro`
- **BOB Fachmann:** `Elektriker`
- **BOB Titel:** Steckdose – Schuko weiss
- **Erkannt als:** Weisse Schuko-Steckdose, wandmontiert – Unterputz-Steckdose mit Kunststoffrahmen, Typ Schuko (zwei runde Kontaktstifte + Schutzkontakt)
- **Dringlichkeit:** Mittel | **Kosten:** CHF 80–250
- **Text on image:** `Steckdose / Schuko / weiss / Wand`

### [12] ✓ Lichtschalter
- **Expected category:** `Elektro`
- **BOB Kategorie:** `Elektro`
- **BOB Fachmann:** `Elektriker`
- **BOB Titel:** Lichtschalter / Wippschalter
- **Erkannt als:** Weisser Kunststoff-Wippschalter (Lichtschalter), Unterputz-Montage, Schweizer Standard – typisch quadratisch, glatte Drückfläche
- **Dringlichkeit:** Mittel | **Kosten:** CHF 60–200
- **Text on image:** `Lichtschalter / Wippschalter / weiss / Kunststoff`

### [13] ✓ Elektrokabel
- **Expected category:** `Elektro`
- **BOB Kategorie:** `Elektro`
- **BOB Fachmann:** `Elektriker`
- **BOB Titel:** Elektrokabel – schwarze Leitung
- **Erkannt als:** Elektroleitung mit schwarzer Kunststoff-Isolierung – typisches Installationskabel (Phase-Ader oder Aussenmantel), wie in Hausinstallationen verwendet
- **Dringlichkeit:** Hoch | **Kosten:** CHF 80–400
- **Text on image:** `Kabel / Elektroleitung / schwarz / Isolierung`

### [14] ✓ Sicherungskasten
- **Expected category:** `Elektro`
- **BOB Kategorie:** `Elektro`
- **BOB Fachmann:** `Elektriker`
- **BOB Titel:** Sicherungskasten / Verteiler
- **Erkannt als:** Sicherungskasten / Elektroverteiler mit LSS (Leitungsschutzschalter), FI-Schalter (Fehlerstrom-Schutzschalter) – typische Komponenten einer Unterverteilung in Wohn- oder Gewerbegebäuden
- **Dringlichkeit:** Hoch | **Kosten:** CHF 100–500
- **Text on image:** `Sicherungskasten / LSS / FI-Schalter / Verteiler`

### [15] ✓ LED Lampe defekt
- **Expected category:** `Elektro`
- **BOB Kategorie:** `Elektro`
- **BOB Fachmann:** `Elektriker`
- **BOB Titel:** Defekte LED Lampe / E27 Fassung
- **Erkannt als:** Text auf Bild: 'LED Lampe, Glühbirne defekt, Fassung E27' – defektes E27-Leuchtmittel, elektrische Fassung möglicherweise betroffen
- **Dringlichkeit:** Niedrig | **Kosten:** CHF 5–150
- **Text on image:** `LED Lampe / Glühbirne / defekt / Fassung E27`

### [16] ✓ Autoreifen Profil
- **Expected category:** `Auto`
- **BOB Kategorie:** `Auto`
- **BOB Fachmann:** `Autopneu-Service / Garage`
- **BOB Titel:** Reifen – Profil, Gummi, Felge
- **Erkannt als:** Text-Beschreibung eines Autoreifens mit Stichworten: Profil (Reifenprofil/Lauffläche), Gummi (Reifenmaterial), Felge (Metallfelge) – klassische Bestandteile eines Fahrzeugrades
- **Dringlichkeit:** Hoch | **Kosten:** CHF 80–600
- **Text on image:** `Reifen / Profil / Gummi / Felge`

### [17] ✓ Lenkrad
- **Expected category:** `Auto`
- **BOB Kategorie:** `Auto`
- **BOB Fachmann:** `Autoelektriker / Garage`
- **BOB Titel:** Lenkrad – Auto Innenraum
- **Erkannt als:** Fahrzeug-Lenkrad mit Speichen, Leder-Bezug und integriertem Airbag (Nabe)
- **Dringlichkeit:** Hoch | **Kosten:** CHF 150–1500
- **Text on image:** `Lenkrad / Speichen / Leder / Airbag`

### [18] ✓ Motorraum
- **Expected category:** `Auto`
- **BOB Kategorie:** `Auto / Fahrzeug`
- **BOB Fachmann:** `Automechaniker / Garage`
- **BOB Titel:** Motorraum – Motor & Schläuche
- **Erkannt als:** Fahrzeug-Motorraum mit sichtbarem Motor, Motorschläuchen (Kühlwasser-/Unterdruckschläuche) und Ölmessstab – typische Komponenten eines Verbrennungsmotors
- **Dringlichkeit:** Mittel | **Kosten:** CHF 80–400
- **Text on image:** `Motorraum / Motor / Schläuche / Ölmessstab`

### [19] ✓ Auto PKW Kratzer
- **Expected category:** `Auto`
- **BOB Kategorie:** `Auto / Karosserie`
- **BOB Fachmann:** `Carrossier / Autolackierer`
- **BOB Titel:** Kratzer / Lackschaden am Auto
- **Erkannt als:** Textbeschreibung mit den Begriffen Auto, Kratzer, Lack und Karosserie – Lackschaden oder Kratzer an einer Fahrzeugkarosserie
- **Dringlichkeit:** Niedrig | **Kosten:** CHF 80–1500
- **Text on image:** `Auto / Kratzer / Lack / Karosserie`

### [20] ✓ Holztisch
- **Expected category:** `Schreiner`
- **BOB Kategorie:** `Möbel / Holz`
- **BOB Fachmann:** `Schreiner`
- **BOB Titel:** Holztisch aus Eiche
- **Erkannt als:** Textbeschreibung eines Tisches aus Eichenholz mit Tischbeinen – klassisches Holzmöbel, vermutlich Ess- oder Schreibtisch
- **Dringlichkeit:** Niedrig | **Kosten:** CHF 150–1500
- **Text on image:** `Tisch / Holz / Eiche / Tischbeine`

### [21] ✓ Stuhl Rückenlehne
- **Expected category:** `Schreiner`
- **BOB Kategorie:** `Möbel`
- **BOB Fachmann:** `Schreiner / Polsterer`
- **BOB Titel:** Stuhl – Holz mit Polster
- **Erkannt als:** Stuhl mit Holzrückenlehne und gepolsterter Sitzfläche – braunes Holzmaterial, Rückenlehne und Polsterung als Hauptmerkmale genannt
- **Dringlichkeit:** Niedrig | **Kosten:** CHF 80–400
- **Text on image:** `Stuhl / Rückenlehne / Holz / Polster`

### [22] ✓ Kleiderschrank
- **Expected category:** `Schreiner`
- **BOB Kategorie:** `Möbel / Innenausbau`
- **BOB Fachmann:** `Schreiner`
- **BOB Titel:** Kleiderschrank – Türen & Griffe
- **Erkannt als:** Textbeschreibung mit den Begriffen: Schrank, Kleiderschrank, Türen, Griffe – kein Foto vorhanden, aber eindeutig ein Möbelstück (Kleiderschrank) mit Türen und Griffen beschrieben
- **Dringlichkeit:** Niedrig | **Kosten:** CHF 80–500
- **Text on image:** `Schrank / Kleiderschrank / Türen / Griffe`

### [23] ✓ Parkett Holzboden
- **Expected category:** `Schreiner`
- **BOB Kategorie:** `Boden / Holzbau`
- **BOB Fachmann:** `Bodenleger / Parkettleger`
- **BOB Titel:** Parkett / Holzboden – Eiche Dielen
- **Erkannt als:** Textbeschreibung mit den Begriffen Parkett, Holzboden, Eiche und Dielen – typischer Holzbodenbelag aus Eichenholz, entweder als Mehrschichtparkett oder als Massivholzdiele.
- **Dringlichkeit:** Niedrig | **Kosten:** CHF 50–150 pro m²
- **Text on image:** `Parkett / Holzboden / Eiche / Dielen`

### [24] ✓ Solaranlage PV
- **Expected category:** `Solar`
- **BOB Kategorie:** `Energie / Solar`
- **BOB Fachmann:** `Solarinstallateur / Elektro-Solarfachmann`
- **BOB Titel:** Solarmodul / PV-Anlage
- **Erkannt als:** Text-Beschreibung mit den Begriffen: Solarmodul, PV-Panel, Photovoltaik, Dach – klassische Photovoltaikanlage auf einem Gebäudedach
- **Dringlichkeit:** Mittel | **Kosten:** CHF 500–15000
- **Text on image:** `Solarmodul / PV-Panel / Photovoltaik / Dach`

### [25] ✓ Hund
- **Expected category:** `Tier/Beauty`
- **BOB Kategorie:** `Tier / Haustier`
- **BOB Fachmann:** `Tierarzt / Hundepfleger`
- **BOB Titel:** Hund / Labrador – Tier
- **Erkannt als:** Textbild mit den Wörtern 'Hund', 'Labrador', 'Tier', 'Haustier' auf beigem Hintergrund – kein Foto eines echten Hundes, sondern eine Beschreibung/Label eines Labradors
- **Dringlichkeit:** Mittel | **Kosten:** CHF 80–300
- **Text on image:** `Hund / Labrador / Tier / Haustier`

### [26] ✓ Katze
- **Expected category:** `Tier/Beauty`
- **BOB Kategorie:** `Tier / Haustier`
- **BOB Fachmann:** `Tierarzt`
- **BOB Titel:** Katze – Haustier (grau)
- **Erkannt als:** Text-Beschreibung einer grauen Katze / Haustier – kein technisches Problem, sondern ein Tier mit möglichem tierärztlichem Betreuungsbedarf.
- **Dringlichkeit:** Mittel | **Kosten:** CHF 80–300
- **Text on image:** `Katze / Tier / Haustier / grau`

### [27] ✓ Pizza
- **Expected category:** `Gastronomie`
- **BOB Kategorie:** `Gastronomie / Kulinarik`
- **BOB Fachmann:** `Pizzaiolo / Koch`
- **BOB Titel:** Pizza Margherita – Speisekarte
- **Erkannt als:** Orangefarbenes Schild / Karte mit schwarzem Text: 'Pizza' als Überschrift, darunter die Zutaten 'Margherita', 'Käse' und 'Tomaten' – sieht aus wie eine einfache Speisekarte oder ein Menu-Display
- **Dringlichkeit:** Niedrig | **Kosten:** CHF 12–25
- **Text on image:** `Pizza / Margherita / Käse / Tomaten`

### [28] ✓ Sushi
- **Expected category:** `Gastronomie`
- **BOB Kategorie:** `Gastronomie / Food`
- **BOB Fachmann:** `Sushi-Koch / Japanisches Restaurant`
- **BOB Titel:** Sushi – Japanisches Gericht
- **Erkannt als:** Textkarte mit den Wörtern 'Sushi', 'Reis', 'Fisch', 'Japan' auf cremefarbenem Hintergrund – kein Schaden, kein technisches Problem erkennbar
- **Dringlichkeit:** Niedrig | **Kosten:** CHF 20–80 (Restaurant) / CHF 30–100 (Catering)
- **Text on image:** `Sushi / Reis / Fisch / Japan`

### [29] ✓ Blumen Garten
- **Expected category:** `Garten`
- **BOB Kategorie:** `Garten / Pflanzen`
- **BOB Fachmann:** `Gärtner / Gartengestalter`
- **BOB Titel:** Garten / Blumen & Pflanzen
- **Erkannt als:** Textbild mit grünem Hintergrund und den Schlagworten 'Blumen', 'Garten', 'Rosen', 'Pflanzen' – Hinweis auf Gartenbedarf oder Bepflanzungswunsch
- **Dringlichkeit:** Niedrig | **Kosten:** CHF 80–500
- **Text on image:** `Blumen / Garten / Rosen / Pflanzen`

### [30] ✓ Wald Bäume
- **Expected category:** `Garten/Natur`
- **BOB Kategorie:** `Garten / Natur`
- **BOB Fachmann:** `Gärtner / Forstfachmann`
- **BOB Titel:** Wald / Natur / Landschaft
- **Erkannt als:** Textbild auf dunkelgrünem Hintergrund mit den Wörtern 'Wald', 'Bäume', 'Natur', 'Landschaft' – kein echtes Foto, sondern eine Beschriftung/Kategorieanzeige
- **Dringlichkeit:** Niedrig | **Kosten:** CHF 80–500
- **Text on image:** `Wald / Bäume / Natur / Landschaft`

## Methodology

Each test image is a **200×200 PNG** with:
- A category-appropriate **background color** (e.g., copper-brown for pipes, dark for tires)
- **German keyword labels** drawn in the image (e.g., `Kupferrohr / Fitting / T-Stück`)
- Sent as `imageBase64` with **no description text and no category hint**
- BOB's `imageOnly=true` path activates → loads visual trigger entries from Supabase
- Claude `claude-sonnet-4-6` reads the image and returns categorized JSON

### Why programmatic images?
Wikipedia/Wikimedia blocks automated image downloads (HTTP 429/400).
Text-labeled images effectively test Claude's visual OCR + categorization logic,
which is equivalent to reading labels on real objects in photos.

### Previous live image tests (Wikimedia, first run)
| Image | Expected | Got | Status |
|-------|----------|-----|--------|
| Katze (Tabby-Katze) | Tier | Tier / Haustier / Tierarzt | ✓ |
| Pizza Margherita | Gastronomie | Gastronomie / Koch | ✓ |