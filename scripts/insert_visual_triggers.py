#!/usr/bin/env python3
"""Insert visual trigger entries for image-based categorization.
Adds bob_knowledge entries with visual descriptions (colors, shapes, materials)
so BOB can correctly categorize photos without text input.
Categories: Sanitär, Heizung, Elektro, Möbel, Auto
"""

import json, urllib.request, urllib.error, os, sys
from collections import Counter

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://bmdmoehjwadvdlbrmpuq.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
if not SUPABASE_KEY:
    print("ERROR: SUPABASE_KEY oder SUPABASE_SERVICE_KEY muss gesetzt sein.")
    sys.exit(1)

ENTRIES = [

  # ─────────────────────────────────────────────────────
  # SANITÄR – Visuelle Trigger (5 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Sanitär", "unterkategorie": "Armatur",
    "titel": "Armatur / Wasserhahn visuell erkennen",
    "inhalt": "Visuelle Merkmale: Silbern oder chrom glänzend, metallische Oberfläche, Hahnkörper mit Ausfluss, Einhebelmischer oder Doppelgriff-Armatur, Küchenarmatur oder Badarmatur. Material: Messing verchromt, Edelstahl. Symptom/Bedarf: Wasserhahn tropft, Armatur undicht, Kartusche defekt, neue Armatur einbauen. Fachmann: Sanitärinstallateur. Dringlichkeit: Mittel. Kosten: CHF 80–300.",
    "tags": ["armatur", "wasserhahn", "chrom", "silber", "metallisch", "einhebelmischer", "sanitär", "tropft", "undicht", "küchenarmatur"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Sanitär", "unterkategorie": "Rohrleitungen",
    "titel": "Rohr / Leitung visuell erkennen",
    "inhalt": "Visuelle Merkmale: Rundes Rohr, kupferfarben oder silbergrau oder weiss/grau (Kunststoff), T-Stück, Rohrbogen, Rohrverbindungen, Klemmring, Fittings, Rohrisolierung. Material: Kupfer (orange-braun), verzinkter Stahl (grau), PVC oder PE (weiss/grau). Symptom/Bedarf: Rohrbruch, Leck, Rohr verlegen, Druckprüfung. Fachmann: Sanitärinstallateur. Dringlichkeit: Hoch bei Leck. Kosten: CHF 120–500.",
    "tags": ["rohr", "leitung", "kupfer", "kunststoff", "pvc", "rohrbruch", "leck", "sanitär", "t-stück", "fitting"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Sanitär", "unterkategorie": "WC / Toilette",
    "titel": "WC / Toilette visuell erkennen",
    "inhalt": "Visuelle Merkmale: Weisse ovale Keramikschale, WC-Becken, Spülkasten (oben oder eingebaut), WC-Sitz mit Deckel, Spülknopf (rund oder rechteckig), Toilettenpapierhalter daneben. Material: Weisse Sanitärkeramik, Kunststoff-Sitz. Symptom/Bedarf: WC spült nicht, läuft ständig nach, WC-Sitz wechseln, Verstopfung, Neues WC einbauen. Fachmann: Sanitärinstallateur. Dringlichkeit: Hoch bei Verstopfung. Kosten: CHF 80–600.",
    "tags": ["wc", "toilette", "keramik", "weiss", "oval", "spülkasten", "spülknopf", "toilettensitz", "sanitär", "verstopft"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Sanitär", "unterkategorie": "Dusche",
    "titel": "Dusche / Duschabtrennung visuell erkennen",
    "inhalt": "Visuelle Merkmale: Duschkabine mit Glasscheibe (klar oder satiniert), Duschhebel oder Einhebelmischer, Regendusche (Duschkopf von oben), Handbrause an Wandhalter, Duschablauf im Boden, Duschwanne oder bodenebene Dusche, Fliesenwand. Material: Glas, Aluminiumprofil, Chrom, Fliesen. Symptom/Bedarf: Dusche tropft, Kalk, Silikon defekt, neue Duschabtrennung. Fachmann: Sanitärinstallateur / Fliesenleger. Dringlichkeit: Mittel. Kosten: CHF 150–1500.",
    "tags": ["dusche", "duschkabine", "glasscheibe", "regendusche", "handbrause", "duschwanne", "sanitär", "chrom", "fliesen", "ablauf"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Sanitär", "unterkategorie": "Badezimmer",
    "titel": "Waschbecken / Lavabo visuell erkennen",
    "inhalt": "Visuelle Merkmale: Weisses oder farbiges Keramikbecken, wandmontiert oder auf Unterschrank, rund oder eckig, Abfluss mittig, Überlauf-Öffnung, Siphon darunter (gebogenes Rohr). Material: Sanitärkeramik, Mineralguss, manchmal Glas. Symptom/Bedarf: Waschbecken verstopft, undicht, neues Lavabo einbauen. Fachmann: Sanitärinstallateur. Dringlichkeit: Mittel. Kosten: CHF 100–800.",
    "tags": ["waschbecken", "lavabo", "keramik", "weiss", "abfluss", "siphon", "sanitär", "bad", "badezimmer", "verstopft"], "quelle": "BOB Wissensdatenbank Visual"
  },

  # ─────────────────────────────────────────────────────
  # HEIZUNG – Visuelle Trigger (5 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Heizung", "unterkategorie": "Heizkörper",
    "titel": "Heizkörper / Radiator visuell erkennen",
    "inhalt": "Visuelle Merkmale: Weisses oder cremefarbenes Metallobjekt an der Wand, horizontal montiert, Rippen oder Lamellen, Ventil unten links/rechts, Thermostatventil oben mit Drehknopf, Stahlplattenheizkörper (flach) oder Gliederheizkörper (mit Rippen). Material: Stahl weiss lackiert, Gusseisen. Symptom/Bedarf: Heizkörper kalt, ungleichmässig warm, gluckert, entlüften. Fachmann: Heizungsmonteur. Dringlichkeit: Hoch im Winter. Kosten: CHF 80–400.",
    "tags": ["heizkörper", "radiator", "weiss", "metall", "rippen", "thermostatventil", "heizung", "kalt", "entlüften", "wandmontiert"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Regelung",
    "titel": "Thermostat / Regelventil visuell erkennen",
    "inhalt": "Visuelle Merkmale: Weisser oder grauer Kunststoffkopf auf Ventilschaft am Heizkörper, Drehring mit Zahlen 1-5 oder Schneeflocken-Symbol, Thermokopf, Heizkörper-Thermostatventil. Alternativ: Digitaler Raumthermostat an Wand, weiss quadratisch mit Display und Temperaturanzeige. Symptom/Bedarf: Heizkörper lässt sich nicht regeln, Thermostat klemmt, Temperatur falsch. Fachmann: Heizungsmonteur. Dringlichkeit: Mittel. Kosten: CHF 40–200.",
    "tags": ["thermostat", "thermostatventil", "regelventil", "drehknopf", "zahlen", "heizung", "raumthermostat", "kunststoff", "weiss", "temperatur"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Wärmeerzeugung",
    "titel": "Heizkessel / Brenner visuell erkennen",
    "inhalt": "Visuelle Merkmale: Grosses weisses oder graues Wandgerät (60–80cm hoch), mehrere Rohranschlüsse (rot/blau für Vor-/Rücklauf), Gasanschluss gelb, Bedienfeld mit Display und Temperatur-Regler, Abgasrohr durch Wand oder Dach, Brenner-Kontrollleuchte. Hersteller: Vaillant, Buderus, Viessmann, Wolf, Bosch. Symptom/Bedarf: Kessel zündet nicht, Fehlermeldung, Störung. Fachmann: Heizungsmonteur. Dringlichkeit: Hoch. Kosten: CHF 150–2000.",
    "tags": ["kessel", "heizkessel", "brenner", "wandgerät", "gasheizung", "vaillant", "viessmann", "display", "heizung", "störung"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Wärmeerzeugung",
    "titel": "Boiler / Warmwasserspeicher visuell erkennen",
    "inhalt": "Visuelle Merkmale: Grosser runder zylindrischer Behälter (weiss, grau oder blau), stehend oder hängend, zwei Rohranschlüsse (Kalt-/Warmwasser), Sicherheitsventil, Anode, Temperaturfühler. Grösse typisch 80-300 Liter. Symptom/Bedarf: Kein Warmwasser, Boiler tropft, Kalk, Anode wechseln, Thermostat defekt. Fachmann: Heizungsmonteur / Sanitärinstallateur. Dringlichkeit: Hoch bei kein Warmwasser. Kosten: CHF 150–1500.",
    "tags": ["boiler", "warmwasserspeicher", "zylindrisch", "rund", "weiss", "warmwasser", "heizung", "kalk", "anode", "speicher"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Wärmepumpe",
    "titel": "Wärmepumpe / Aussengerät visuell erkennen",
    "inhalt": "Visuelle Merkmale: Grosses Aussengerät (weiss oder grau, 60–150cm), Ventilator vorne, Lamellengitter, aussen an Wand oder auf Fundament, Kältemittelleitung in Wanddurchführung. Innengerät: flache weisse Box im Technikraum. Symptom/Bedarf: Wärmepumpe läuft nicht, Effizienz sinkt, Kältemittel leck, Wartung. Fachmann: Heizungsmonteur / Kältetechniker. Dringlichkeit: Hoch. Kosten: CHF 200–3000.",
    "tags": ["wärmepumpe", "aussengerät", "ventilator", "lamellen", "weiss", "grau", "heizung", "kältemittel", "luft-wasser", "effizienz"], "quelle": "BOB Wissensdatenbank Visual"
  },

  # ─────────────────────────────────────────────────────
  # ELEKTRO – Visuelle Trigger (5 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Elektro", "unterkategorie": "Steckdose",
    "titel": "Steckdose / Schuko visuell erkennen",
    "inhalt": "Visuelle Merkmale: Weisses oder cremefarbenes Rechteck an Wand, zwei runde Löcher (Stiftsteckdose Schweizer Typ J: drei Löcher im Dreieck), Kunststoffrahmen, manchmal Kinderschutz (Schieber). Unterputz oder Aufputz montiert. Steckdosenleiste: mehrere Steckdosen in Reihe mit Kabel. Symptom/Bedarf: Steckdose hat keinen Strom, Funken, Steckdose defekt, neue Steckdose installieren. Fachmann: Elektriker. Dringlichkeit: Mittel-Hoch. Kosten: CHF 80–250.",
    "tags": ["steckdose", "schuko", "steckdosenleiste", "weiss", "rechteck", "kunststoff", "elektro", "kein strom", "defekt", "wandsteckdose"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Schalter",
    "titel": "Lichtschalter / Wippschalter visuell erkennen",
    "inhalt": "Visuelle Merkmale: Weisses oder cremefarbenes Quadrat/Rechteck an Wand, glatte Drückfläche (Wippschalter), Unterputzrahmen, manchmal mit LED-Kontrolllicht, Dimmer mit Drehelement, Taster für Treppenlicht. Größe ca. 8x8cm. Symptom/Bedarf: Schalter funktioniert nicht, Licht geht nicht, Schalter defekt, Dimmer flackert. Fachmann: Elektriker. Dringlichkeit: Mittel. Kosten: CHF 60–200.",
    "tags": ["lichtschalter", "schalter", "wippschalter", "weiss", "quadrat", "dimmer", "taster", "elektro", "wandschalter", "kunststoff"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Kabel / Leitungen",
    "titel": "Elektrokabel / Leitung visuell erkennen",
    "inhalt": "Visuelle Merkmale: Flexible runde oder flache Leitung, Isolation schwarz/grau/weiss, Kabelkanal weiss, Leerrohre orange oder grau, Adern: schwarz (Phase), blau (Neutral), grün-gelb (Schutzleiter). Kabelstecker, Schukostecker, CEE-Stecker (blau/rot), Verlängerungskabel. Symptom/Bedarf: Kabel beschädigt, Isolation defekt, Kabel verlegen, Stecker wechseln. Fachmann: Elektriker. Dringlichkeit: Hoch bei sichtbarem Schaden. Kosten: CHF 80–400.",
    "tags": ["kabel", "leitung", "elektroleitung", "kabelkanal", "stecker", "schwarz", "grau", "elektro", "isolation", "verlängerungskabel"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Sicherungskasten",
    "titel": "Sicherungskasten / Verteiler visuell erkennen",
    "inhalt": "Visuelle Merkmale: Grauer oder weisser Metallkasten mit Klappe (Unterputz oder Aufputz), innen Reihe von Sicherungsautomaten (Leitungsschutzschalter, schwarz-weiss, Kippschalter), Fehlerstrom-Schutzschalter (FI, breiter Schalter), Hauptschalter, Zähler. Typisch im Keller, Flur oder Küche. Symptom/Bedarf: Sicherung fliegt raus, kein Strom, FI löst aus. Fachmann: Elektriker. Dringlichkeit: Hoch. Kosten: CHF 100–500.",
    "tags": ["sicherungskasten", "sicherung", "verteiler", "leitungsschutzschalter", "fi-schalter", "elektro", "kein strom", "grau", "klappe", "unterputz"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Beleuchtung",
    "titel": "Lampe / Leuchte defekt visuell erkennen",
    "inhalt": "Visuelle Merkmale: Glühbirne (rund, weiss-matt oder klar), LED-Leuchtmittel (verschiedene Formen), Deckenleuchte, Pendelleuchte, Einbaustrahler, defekte oder dunkle Leuchtstoffröhre, schwarze Verfärbung an Leuchtmittel. Fassung E27, E14, GU10, G9. Symptom/Bedarf: Licht geht nicht, Lampe flackert, Leuchtstoffröhre defekt, Leuchte wechseln. Fachmann: Elektriker. Dringlichkeit: Niedrig-Mittel. Kosten: CHF 40–300.",
    "tags": ["lampe", "glühbirne", "led", "leuchte", "einbaustrahler", "defekt", "elektro", "flackert", "leuchtmittel", "fassung"], "quelle": "BOB Wissensdatenbank Visual"
  },

  # ─────────────────────────────────────────────────────
  # MÖBEL (Schreiner) – Visuelle Trigger (5 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Schreiner", "unterkategorie": "Tische",
    "titel": "Tisch / Tischplatte visuell erkennen",
    "inhalt": "Visuelle Merkmale: Holztischplatte (braun, eiche, buche, weiss lackiert), vier Beine (rund oder eckig), rechteckig oder rund, Esstisch, Schreibtisch, Couchtisch, Massivholz oder MDF/Span mit Furnier. Tischbeine aus Holz, Metall oder Kunststoff. Symptom/Bedarf: Tisch wackelt, Tischplatte beschädigt, kratzer, Tisch reparieren, neuer Tisch, Massanfertigung. Fachmann: Schreiner / Möbeltischler. Kosten: CHF 150–2000.",
    "tags": ["tisch", "tischplatte", "holz", "eiche", "braun", "vier beine", "schreiner", "möbel", "esstisch", "schreibtisch"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Schreiner", "unterkategorie": "Stühle",
    "titel": "Stuhl / Sitzgelegenheit visuell erkennen",
    "inhalt": "Visuelle Merkmale: Sitzfläche mit Rückenlehne, vier Beine, Holzstuhl (gebeizt, lackiert), Polsterstuhl (Stoff, Leder), Bürostuhl (mit Rollen, Kunststoff/Metall), Barhocker (erhöht, ohne Rückenlehne), Schaukelstuhl. Symptom/Bedarf: Stuhl wackelt, Bein abgebrochen, Polster erneuern, Stuhl reparieren. Fachmann: Schreiner / Polsterer. Kosten: CHF 80–500.",
    "tags": ["stuhl", "sitzfläche", "rückenlehne", "holz", "polster", "möbel", "schreiner", "wackelt", "barhocker", "bürostuhl"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Schreiner", "unterkategorie": "Schränke",
    "titel": "Schrank / Kleiderschrank visuell erkennen",
    "inhalt": "Visuelle Merkmale: Grosses Möbelstück mit Türen (Drehtüren oder Schiebetüren), Griffe oder grifflose Öffnung (Push-to-open), Kleiderschrank, Wäscheschrank, Badschrank, Unterschrank, weiss oder Holzoptik (eiche, nuss), Inneneinteilung mit Stangen und Einlegeböden. Symptom/Bedarf: Schranktür schiesst nicht, Scharnier defekt, Schrank aufbauen, Einbauschrank. Fachmann: Schreiner / Möbelmonteur. Kosten: CHF 100–3000.",
    "tags": ["schrank", "kleiderschrank", "türen", "schiebetüren", "griffe", "möbel", "schreiner", "weiss", "holz", "einbauschrank"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Schreiner", "unterkategorie": "Böden",
    "titel": "Holzboden / Parkett visuell erkennen",
    "inhalt": "Visuelle Merkmale: Holzdielenoptik, Parkettboden (Eiche, Nuss, Buche), Laminatboden (Holzimitat), hellbrauner oder dunkler Holzboden, Fischgrätenparkett, Dielen, Randleisten an der Wand, glänzend oder matt versiegelt. Symptom/Bedarf: Parkett zerkratzt, Diele quietscht, Boden auffrischen, abschleifen, versiegeln. Fachmann: Bodenleger / Schreiner. Kosten: CHF 30–120/m².",
    "tags": ["parkett", "holzboden", "laminat", "dielen", "eiche", "bodenleger", "schreiner", "kratzer", "quietscht", "versiegeln"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Schreiner", "unterkategorie": "Fenster / Türen",
    "titel": "Holztür / Innentür visuell erkennen",
    "inhalt": "Visuelle Merkmale: Innentür (weiss lackiert oder Holzoptik), Türblatt mit Türgriff (Edelstahl, weiss, bronze), Scharnier (3 Stück), Türrahmen, Türfüllung (flach oder mit Kassetten), Schiebetür in Wandschlitz. Symptom/Bedarf: Tür schliesst nicht, Tür klemmt, Scharnier defekt, Türgriff locker, neue Innentür. Fachmann: Schreiner / Türmonteur. Kosten: CHF 100–800.",
    "tags": ["tür", "innentür", "türgriff", "scharnier", "holz", "weiss", "schreiner", "klemmt", "schliesst nicht", "türrahmen"], "quelle": "BOB Wissensdatenbank Visual"
  },

  # ─────────────────────────────────────────────────────
  # AUTO – Visuelle Trigger (5 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Auto", "unterkategorie": "Bereifung",
    "titel": "Reifen / Pneu visuell erkennen",
    "inhalt": "Visuelle Merkmale: Schwarzes Gummiprofil mit Lauffläche (Rillenmuster), Felge (Stahlfelge grau oder Alufelge silber/schwarz), Reifenwand, Reifenprofil-Tiefe, montiert an Fahrzeug oder einzeln liegend, Winterreifen (M+S-Symbol), Sommerreifen. Symptom/Bedarf: Reifen platt, Profil abgefahren, Reifenwechsel, Reifen wuchten, Saisonwechsel. Fachmann: Pneudienst / Garage. Kosten: CHF 50–300/Reifen.",
    "tags": ["reifen", "pneu", "profil", "schwarz", "gummi", "felge", "alufelge", "auto", "winterreifen", "reifenwechsel"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Auto", "unterkategorie": "Innenraum",
    "titel": "Lenkrad / Cockpit visuell erkennen",
    "inhalt": "Visuelle Merkmale: Rundes Lenkrad (Leder schwarz, Kunststoff grau/schwarz), Speichen (3-4 Speichen), Hupfläche mittig (oft Herstellerlogo), Airbag-Deckel, Tachometer dahinter, Schalter am Lenkrad (Tempomat, Radio), Multifunktionslenkrad. Symptom/Bedarf: Lenkrad vibriert, Servolenkung defekt, Airbag-Leuchte, Lenkrad tauschen. Fachmann: Automechaniker / Autoelektriker. Kosten: CHF 150–1500.",
    "tags": ["lenkrad", "lenkung", "airbag", "cockpit", "rund", "schwarz", "leder", "auto", "speichen", "multifunktion"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Auto", "unterkategorie": "Motor",
    "titel": "Motorraum / Motor visuell erkennen",
    "inhalt": "Visuelle Merkmale: Komplexe Anordnung von Metallteilen, schwarzer Kunststoff-Motorabdeckung, Schläuche (schwarz, blau, grün), Kabel-Bündel, Ölmessstab (gelber Griff), Kühlwasserausgleichsbehälter (weiss, halbtransparent), Lichtmaschine, Keilriemen, Luftfiltergehäuse. Motoröl-Flecken. Symptom/Bedarf: Motor springt nicht an, Ölverlust, Kühlwasser leer, Motorlicht leuchtet, Service fällig. Fachmann: Automechaniker. Kosten: CHF 100–3000.",
    "tags": ["motor", "motorraum", "ölmessstab", "schläuche", "kabel", "auto", "ölverlust", "motorlicht", "kühlwasser", "keilriemen"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Auto", "unterkategorie": "Karosserie",
    "titel": "Kratzer / Delle / Lackschaden visuell erkennen",
    "inhalt": "Visuelle Merkmale: Kratzer im Autolack (silber, weiss, schwarz, rot, blau, metallic), Delle in Türblech oder Kotflügel, Lackabplatzung, Rostfleck (braun-orange), Unfallschaden an Stossstange, Witterungsschäden. Symptom/Bedarf: Kratzer ausbessern, Delle herausdrücken (PDR), Neulackierung, Karosserie reparieren. Fachmann: Carrossier / Autolackierer. Kosten: CHF 200–3000.",
    "tags": ["kratzer", "delle", "lackschaden", "rost", "karosserie", "auto", "stossstange", "carrossier", "lackierung", "unfallschaden"], "quelle": "BOB Wissensdatenbank Visual"
  },
  {
    "kategorie": "Auto", "unterkategorie": "Bremsen",
    "titel": "Bremsscheibe / Bremsbelag visuell erkennen",
    "inhalt": "Visuelle Merkmale: Runde metallische Scheibe hinter Felge (Bremsscheibe, silber-grau, manchmal orange verrostet), Bremssattel (rot, grün, schwarz lackiert oder blank), Bremsbelag sichtbar. Tiefe Riefen auf Scheibe oder sehr dünner Belag. Symptom/Bedarf: Bremsen quietschen, vibrieren, schleifen, Bremsscheibe wechseln, Bremsbeläge ersetzen. Fachmann: Automechaniker / Garage. Kosten: CHF 200–600/Achse.",
    "tags": ["bremsscheibe", "bremse", "bremssattel", "bremsbelag", "silber", "auto", "quietscht", "vibriert", "garage", "verschlissen"], "quelle": "BOB Wissensdatenbank Visual"
  },

]

def upsert_entries(entries):
    url = f"{SUPABASE_URL}/rest/v1/bob_knowledge"
    headers = {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "resolution=merge-duplicates",
    }
    data = json.dumps(entries).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def main():
    total = len(ENTRIES)
    print(f"Inserting {total} visual trigger entries...")

    cats = Counter(e["kategorie"] for e in ENTRIES)
    for cat, count in sorted(cats.items()):
        print(f"  {cat}: {count} entries")

    batch_size = 10
    success = 0
    for i in range(0, len(ENTRIES), batch_size):
        batch = ENTRIES[i:i+batch_size]
        status, body = upsert_entries(batch)
        if status in (200, 201, 204):
            success += len(batch)
            print(f"  Batch {i//batch_size + 1}: OK ({len(batch)} entries)")
        else:
            print(f"  Batch {i//batch_size + 1}: ERROR {status} – {body[:200]}")

    print(f"\nDone: {success}/{total} entries inserted.")

if __name__ == "__main__":
    main()
