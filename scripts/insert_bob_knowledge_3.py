#!/usr/bin/env python3
"""Insert batch 3: Solar/PV, Haushaltsgeräte, IT, Smart Home, Entrümpelung, Poolservice."""

import json, urllib.request, urllib.error, os, sys
from collections import Counter

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://bmdmoehjwadvdlbrmpuq.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
if not SUPABASE_KEY:
    print("ERROR: SUPABASE_KEY oder SUPABASE_SERVICE_KEY muss gesetzt sein.")
    sys.exit(1)

ENTRIES = [

  # ─────────────────────────────────────────────────────
  # SOLAR / PHOTOVOLTAIK (10 Einträge) – war nur 1 Eintrag!
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Solar", "unterkategorie": "Photovoltaik",
    "titel": "Photovoltaikanlage installieren – Beratung",
    "inhalt": "Symptom/Bedarf: Solarstrom-Anlage auf Eigenheim gewünscht. Diagnose: Dachausrichtung, Verschattung, Netzanschluss und Wirtschaftlichkeit prüfen. Fachmann: Solarinstallateur / Elektriker. Dringlichkeit: Niedrig. Kosten: CHF 15000–40000 (8–12 kWp).",
    "tags": ["solar", "photovoltaik", "solaranlage", "pv", "solarinstallateur"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Solar", "unterkategorie": "Photovoltaik",
    "titel": "Solarmodul beschädigt oder defekt",
    "inhalt": "Symptom: Ein oder mehrere PV-Module produzieren keinen Strom, Glasbruch durch Hagel oder Ertragseinbruch. Diagnose: Moduldiagnose mit Wärmebildkamera, defektes Modul tauschen. Fachmann: Solarinstallateur. Dringlichkeit: Mittel. Kosten: CHF 200–800/Modul.",
    "tags": ["solar", "solarmodul", "defekt", "hagel", "photovoltaik"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Solar", "unterkategorie": "Photovoltaik",
    "titel": "Wechselrichter (Inverter) defekt",
    "inhalt": "Symptom: Solaranlage liefert keinen Strom, Wechselrichter zeigt Fehlermeldung oder bleibt dunkel. Diagnose: Wechselrichter ist das Herzstück der PV-Anlage – bei Ausfall kein Solarstrom. Fachmann: Solarinstallateur / Elektriker. Dringlichkeit: Hoch. Kosten: CHF 800–3000.",
    "tags": ["wechselrichter", "inverter", "solar", "photovoltaik", "defekt"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Solar", "unterkategorie": "Photovoltaik",
    "titel": "Solaranlage reinigen – Ertrag verbessern",
    "inhalt": "Symptom: Ertrag der PV-Anlage sinkt trotz Sonne, Module sichtlich verschmutzt (Staub, Vogelkot, Moos). Diagnose: Saubere Module bringen bis 20% mehr Ertrag. Fachmann: Solarservice / Dachreinigung. Dringlichkeit: Niedrig. Kosten: CHF 3–8/m².",
    "tags": ["solar", "reinigung", "pv", "solarmodul", "ertrag"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Solar", "unterkategorie": "Photovoltaik",
    "titel": "Batteriespeicher für Solaranlage nachrüsten",
    "inhalt": "Symptom/Bedarf: Solarstrom soll gespeichert werden für Nacht- oder Schlechtwetternutzung. Diagnose: Lithium-Speicher (5–15 kWh) nachrüsten – Amortisation ca. 10–15 Jahre. Fachmann: Solarinstallateur / Elektriker. Dringlichkeit: Niedrig. Kosten: CHF 8000–20000.",
    "tags": ["solar", "batteriespeicher", "speicher", "photovoltaik", "solarinstallateur"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Solar", "unterkategorie": "Photovoltaik",
    "titel": "Einspeisevergütung prüfen – Netzanschluss",
    "inhalt": "Symptom/Bedarf: Fragen zur Einspeisung ins Netz, Vergütung und Anmeldung beim Netzbetreiber. Diagnose: KEV oder Einmalvergütung, Anmeldung beim Kanton und Netzbetreiber nötig. Fachmann: Solarinstallateur / Energieberater. Dringlichkeit: Niedrig. Kosten: CHF 200–500 (Beratung).",
    "tags": ["solar", "einspeisevergütung", "netzanschluss", "kev", "energieberater"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Solar", "unterkategorie": "Solarthermie",
    "titel": "Solarthermieanlage für Warmwasser",
    "inhalt": "Symptom/Bedarf: Warmwasser soll solar beheizt werden. Diagnose: Flach- oder Vakuumröhrenkollektor, deckt bis 60% des Warmwasserbedarfs. Fachmann: Heizungsmonteur / Solarinstallateur. Dringlichkeit: Niedrig. Kosten: CHF 5000–12000.",
    "tags": ["solar", "solarthermie", "warmwasser", "kollektor", "heizungsmonteur"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Solar", "unterkategorie": "Photovoltaik",
    "titel": "PV-Anlage Monitoring – Ertragsüberwachung",
    "inhalt": "Symptom: Solaranlage hat kein Monitoring, Ertragsverlust wird nicht bemerkt. Diagnose: Monitoring-System installieren (App, Webportal) für Echtzeit-Überblick. Fachmann: Solarinstallateur. Dringlichkeit: Niedrig. Kosten: CHF 200–800.",
    "tags": ["solar", "monitoring", "photovoltaik", "ertrag", "app"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Solar", "unterkategorie": "Photovoltaik",
    "titel": "Balkonkraftwerk – Mini-PV installieren",
    "inhalt": "Symptom/Bedarf: Mieter oder Kleinhaushalt will eigenen Solarstrom via Balkonanlage. Diagnose: Bis 600W (CH: noch in Diskussion), Plug-in-Lösung über Schukosteckdose, Anmeldung beim Netzbetreiber. Fachmann: Elektriker (optional). Dringlichkeit: Niedrig. Kosten: CHF 400–900.",
    "tags": ["solar", "balkonkraftwerk", "mini-pv", "photovoltaik", "mieter"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Solar", "unterkategorie": "Photovoltaik",
    "titel": "PV-Anlage auf Flachdach installieren",
    "inhalt": "Symptom/Bedarf: Flachdach soll mit PV-Anlage bestückt werden. Diagnose: Aufständerung (10–15°), Ballastierung oder Dachdurchdringung, Statik prüfen. Fachmann: Solarinstallateur / Dachdecker. Dringlichkeit: Niedrig. Kosten: CHF 18000–50000.",
    "tags": ["solar", "flachdach", "photovoltaik", "aufständerung", "dachdecker"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # HAUSHALTSGERÄTE (10 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Geräte", "unterkategorie": "Haushaltsgeräte",
    "titel": "Waschmaschine läuft nicht / bleibt stehen",
    "inhalt": "Symptom: Waschmaschine startet nicht, bleibt mid-Programm stehen oder schleudert nicht. Diagnose: Pumpe verstopft, Türschloss defekt, Hauptplatine oder Antriebsriemen. Fachmann: Haushaltsgeräte-Techniker. Dringlichkeit: Mittel. Kosten: CHF 80–350.",
    "tags": ["waschmaschine", "defekt", "pumpe", "haushaltsgeräte", "reparatur"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Geräte", "unterkategorie": "Haushaltsgeräte",
    "titel": "Waschmaschine läuft aus / Wasser auf dem Boden",
    "inhalt": "Symptom: Wasser auf dem Boden unter oder vor der Waschmaschine. Diagnose: Türdichtung defekt, Schlauch gerissen oder Pumpe undicht. Fachmann: Haushaltsgeräte-Techniker / Sanitär. Dringlichkeit: Hoch. Kosten: CHF 80–300.",
    "tags": ["waschmaschine", "wasser", "leckage", "türdichtung", "reparatur"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Geräte", "unterkategorie": "Haushaltsgeräte",
    "titel": "Tumbler / Wäschetrockner heizt nicht",
    "inhalt": "Symptom: Trockner läuft aber Wäsche bleibt nass, wird nicht warm. Diagnose: Heizelement defekt, Sicherheitstemperaturbegrenzer ausgelöst oder Flusensieb verstopft. Fachmann: Haushaltsgeräte-Techniker. Dringlichkeit: Mittel. Kosten: CHF 80–300.",
    "tags": ["tumbler", "trockner", "heizt nicht", "heizelement", "reparatur"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Geräte", "unterkategorie": "Haushaltsgeräte",
    "titel": "Geschirrspüler riecht oder spült nicht sauber",
    "inhalt": "Symptom: Geschirr bleibt fettig oder hat Kalkflecken, Maschine riecht unangenehm. Diagnose: Sieb verstopft, Wasserenthärter leer oder Sprüharm blockiert. Fachmann: Haushaltsgeräte-Techniker. Dringlichkeit: Niedrig. Kosten: CHF 60–200.",
    "tags": ["geschirrspüler", "reinigung", "sieb", "kalk", "sprüharm"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Geräte", "unterkategorie": "Haushaltsgeräte",
    "titel": "Kaffeemaschine reinigen oder reparieren",
    "inhalt": "Symptom: Kaffeemaschine entkalken nötig, kein Dampf, Pumpe sehr laut oder kein Kaffee. Diagnose: Kalkablagerungen häufigste Ursache, Pumpe oder Thermoblock defekt. Fachmann: Kaffeemaschinen-Service / Haushaltsgeräte-Techniker. Dringlichkeit: Niedrig. Kosten: CHF 60–250.",
    "tags": ["kaffeemaschine", "entkalken", "reparatur", "pumpe", "thermoblock"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Geräte", "unterkategorie": "Haushaltsgeräte",
    "titel": "Kühlschrank macht Geräusche",
    "inhalt": "Symptom: Kühlschrank brummt laut, klackert oder vibriert stark. Diagnose: Kompressor in Endphase, Lüfter beschädigt oder Kühlschrank nicht waagrecht. Fachmann: Haushaltsgeräte-Techniker. Dringlichkeit: Mittel. Kosten: CHF 80–400.",
    "tags": ["kühlschrank", "geräusche", "brummt", "kompressor", "lüfter"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Geräte", "unterkategorie": "Haushaltsgeräte",
    "titel": "Elektroherd – eine Platte funktioniert nicht",
    "inhalt": "Symptom: Eine Kochzone des Elektro- oder Induktionsherds reagiert nicht. Diagnose: Heizelement defekt, Steuerplatine oder Verbindungskabel. Fachmann: Haushaltsgeräte-Techniker. Dringlichkeit: Niedrig. Kosten: CHF 80–300.",
    "tags": ["herd", "kochfeld", "induktion", "heizelement", "reparatur"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Geräte", "unterkategorie": "Haushaltsgeräte",
    "titel": "Geschirrspüler läuft nicht ab – Wasser steht",
    "inhalt": "Symptom: Nach dem Spülgang steht Wasser im Geschirrspüler. Diagnose: Ablaufpumpe defekt, Ablaufschlauch geknickt oder Sieb verstopft. Fachmann: Haushaltsgeräte-Techniker / Sanitär. Dringlichkeit: Mittel. Kosten: CHF 80–250.",
    "tags": ["geschirrspüler", "ablaufpumpe", "wasser", "verstopft", "reparatur"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Geräte", "unterkategorie": "Haushaltsgeräte",
    "titel": "Dunstabzug Motor defekt oder sehr laut",
    "inhalt": "Symptom: Dunstabzugshaube läuft sehr laut, Motor brummt ungewöhnlich oder dreht nicht mehr. Diagnose: Lager verschlissen, Motorwicklung defekt oder Fettfilter zu stark belastet. Fachmann: Haushaltsgeräte-Techniker. Dringlichkeit: Niedrig. Kosten: CHF 80–300.",
    "tags": ["dunstabzug", "motor", "laut", "lager", "reparatur"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Geräte", "unterkategorie": "Haushaltsgeräte",
    "titel": "Tiefkühler / Gefriergerät defekt",
    "inhalt": "Symptom: Tiefkühler hält Temperatur nicht, Lebensmittel tauen auf oder Gerät läuft dauerhaft. Diagnose: Kompressor defekt, Kältemittel verloren oder Türdichtung undicht. Fachmann: Haushaltsgeräte-Techniker / Kältemonteur. Dringlichkeit: Hoch (Lebensmittel). Kosten: CHF 100–500.",
    "tags": ["tiefkühler", "gefriergerät", "kompressor", "kältemittel", "defekt"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # IT / COMPUTER / NETZWERK (8 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "IT", "unterkategorie": "Computer",
    "titel": "Computer startet nicht oder ist sehr langsam",
    "inhalt": "Symptom: PC oder Laptop bootet nicht, bleibt beim Laden hängen oder ist extrem langsam. Diagnose: Virenbefall, volle Festplatte, RAM-Fehler oder Windows-Update-Problem. Fachmann: IT-Techniker / Computer-Service. Dringlichkeit: Mittel. Kosten: CHF 80–200.",
    "tags": ["computer", "pc", "laptop", "langsam", "it-techniker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "IT", "unterkategorie": "Netzwerk",
    "titel": "WLAN zu schwach oder kein Internet",
    "inhalt": "Symptom: WLAN-Signal reicht nicht bis in alle Räume, kein Internet trotz Router. Diagnose: Router neu starten, WLAN-Repeater oder Mesh-System für grosse Flächen. Fachmann: IT-Techniker / Netzwerkspezialist. Dringlichkeit: Mittel. Kosten: CHF 80–300.",
    "tags": ["wlan", "internet", "router", "netzwerk", "it-techniker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "IT", "unterkategorie": "Computer",
    "titel": "Laptop Bildschirm kaputt oder gebrochen",
    "inhalt": "Symptom: Laptop-Display hat Risse, zeigt nichts an oder flackert. Diagnose: Display oder Displaykabel defekt – Austausch nötig. Fachmann: Computer-Reparaturdienst. Dringlichkeit: Mittel. Kosten: CHF 150–400.",
    "tags": ["laptop", "bildschirm", "display", "gebrochen", "computer"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "IT", "unterkategorie": "Drucker",
    "titel": "Drucker druckt nicht oder hat Papierstau",
    "inhalt": "Symptom: Drucker reagiert nicht, Fehlermeldung oder Papier klemmt. Diagnose: Druckertreiber neu installieren, Papier korrekt einlegen, Tintenpatronen prüfen. Fachmann: IT-Techniker. Dringlichkeit: Niedrig. Kosten: CHF 50–150.",
    "tags": ["drucker", "papierstau", "druckertreiber", "tinte", "it-techniker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "IT", "unterkategorie": "Datensicherung",
    "titel": "Daten wiederherstellen – Festplatte defekt",
    "inhalt": "Symptom: Festplatte gibt Fehler, Dateien nicht mehr zugänglich oder Festplatte wird nicht erkannt. Diagnose: Sofort keine weiteren Schreibvorgänge – Datenrettungs-Service kontaktieren. Fachmann: Datenrettung / IT-Spezialist. Dringlichkeit: Hoch. Kosten: CHF 200–1500.",
    "tags": ["festplatte", "datenrettung", "backup", "datenverlust", "it"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "IT", "unterkategorie": "Smart Home",
    "titel": "Smart Home einrichten – Beleuchtung, Steckdosen, Thermostat",
    "inhalt": "Symptom/Bedarf: Wohnung soll smart gemacht werden: Licht, Heizung, Steckdosen per App steuern. Diagnose: System wählen (Philips Hue, IKEA, Home Assistant, KNX), Kompatibilität prüfen. Fachmann: Smart Home Techniker / Elektriker. Dringlichkeit: Niedrig. Kosten: CHF 200–3000.",
    "tags": ["smart home", "beleuchtung", "thermostat", "app", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "IT", "unterkategorie": "Smart Home",
    "titel": "Smarte Türklingel oder Türschloss installieren",
    "inhalt": "Symptom/Bedarf: Türklingel mit Kamera oder smartes Schloss gewünscht. Diagnose: Bestehende Klingelanlage prüfen, WLAN-Abdeckung am Eingang nötig. Fachmann: Elektriker / Smart Home Techniker. Dringlichkeit: Niedrig. Kosten: CHF 200–800.",
    "tags": ["türklingel", "türschloss", "smart home", "kamera", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "IT", "unterkategorie": "Netzwerk",
    "titel": "Netzwerkkabel / LAN verlegen im Haus",
    "inhalt": "Symptom/Bedarf: Stabiles Kabel-Internet in mehreren Räumen gewünscht. Diagnose: Ethernet Cat6 verlegen, ggf. durch Wände/Decken – professionelle Verlegung empfohlen. Fachmann: Elektriker / Netzwerktechniker. Dringlichkeit: Niedrig. Kosten: CHF 80–200/Punkt.",
    "tags": ["netzwerk", "lan", "kabel", "ethernet", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # POOL / SCHWIMMBAD (6 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Garten", "unterkategorie": "Pool",
    "titel": "Pool: Pumpe oder Filteranlage defekt",
    "inhalt": "Symptom: Poolpumpe läuft nicht, macht Geräusche oder Filterdruck zu hoch. Diagnose: Pumpe verschlissen, Filter verstopft oder Impeller defekt. Fachmann: Poolservice / Sanitär. Dringlichkeit: Mittel. Kosten: CHF 150–600.",
    "tags": ["pool", "pumpe", "filter", "poolservice", "schwimmbad"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Garten", "unterkategorie": "Pool",
    "titel": "Pool undicht – Wasserverlust",
    "inhalt": "Symptom: Poolwasserstand sinkt schnell (mehr als 2cm/Tag ohne Verdunstung). Diagnose: Folienschaden, Druckleitung undicht oder Skimmer defekt. Fachmann: Poolspezialist / Baufirma. Dringlichkeit: Hoch. Kosten: CHF 500–3000.",
    "tags": ["pool", "undicht", "wasserverlust", "folie", "poolspezialist"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Garten", "unterkategorie": "Pool",
    "titel": "Pool winterfest machen / Überwintern",
    "inhalt": "Symptom/Bedarf: Schwimmsaison endet, Pool muss für Winter vorbereitet werden. Diagnose: Wasser absenken, Leitungen entleeren, Überwinterungsmittel, Abdeckplane. Fachmann: Poolservice. Dringlichkeit: Saisonal. Kosten: CHF 150–400.",
    "tags": ["pool", "winterfest", "überwintern", "poolservice", "abdeckplane"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Garten", "unterkategorie": "Pool",
    "titel": "Pool aufbauen oder neu installieren",
    "inhalt": "Symptom/Bedarf: Neuer Schwimm- oder Whirlpool soll installiert werden. Diagnose: Baugenehmigung prüfen, Elektroanschluss, Drainage und Filteranlage planen. Fachmann: Poolbauer / Gärtner. Dringlichkeit: Niedrig. Kosten: CHF 5000–50000.",
    "tags": ["pool", "installation", "poolbauer", "whirlpool", "neubau"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Garten", "unterkategorie": "Pool",
    "titel": "Pool pH-Wert oder Chlor einstellen",
    "inhalt": "Symptom: Augen brennen nach dem Baden, Wasser riecht stark, Haut reagiert gereizt. Diagnose: pH ideal 7.2–7.6, Freichlor 0.5–1.5 mg/l. Ungleichgewicht korrigieren. Fachmann: Poolservice. Dringlichkeit: Mittel. Kosten: CHF 50–200 (Analyse + Mittel).",
    "tags": ["pool", "ph-wert", "chlor", "wasserqualität", "poolservice"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Garten", "unterkategorie": "Pool",
    "titel": "Poolheizung installieren oder nachrüsten",
    "inhalt": "Symptom/Bedarf: Poolwasser zu kalt, Verlängerung der Badesaison gewünscht. Diagnose: Wärmepumpe (effizient), Solarabsorber (günstig) oder Elektro-Heizung. Fachmann: Poolspezialist / Heizungsmonteur. Dringlichkeit: Niedrig. Kosten: CHF 2000–8000.",
    "tags": ["pool", "poolheizung", "wärmepumpe", "solarabsorber", "heizungsmonteur"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # ENTRÜMPELUNG / HAUSHALTAUFLÖSUNG (6 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Umzug", "unterkategorie": "Entrümpelung",
    "titel": "Haushaltsauflösung – komplett",
    "inhalt": "Symptom/Bedarf: Gesamten Haushalt auflösen (Todesfall, Umzug ins Heim, Renovierung). Diagnose: Professionelle Haushaltsauflösung mit Bewertung, Entsorgung und Wohnungsübergabe. Fachmann: Entrümpelungsunternehmen. Dringlichkeit: Nach Termin. Kosten: CHF 500–3000.",
    "tags": ["haushaltsauflösung", "entrümpelung", "entsorgung", "wohnungsauflösung", "umzug"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Umzug", "unterkategorie": "Entrümpelung",
    "titel": "Sperrmüll entsorgen – grosse Gegenstände",
    "inhalt": "Symptom/Bedarf: Sofa, Matratze, Kühlschrank oder alte Möbel müssen entsorgt werden. Diagnose: Sperrabfuhr der Gemeinde oder Entrümpelungsunternehmen anfordern. Fachmann: Entsorgungsunternehmen. Dringlichkeit: Niedrig. Kosten: CHF 100–400.",
    "tags": ["sperrmüll", "sperrabfuhr", "entsorgung", "möbel", "matratze"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Umzug", "unterkategorie": "Entrümpelung",
    "titel": "Elektronikschrott entsorgen",
    "inhalt": "Symptom/Bedarf: Alte Computer, Fernseher, Drucker oder Handys müssen entsorgt werden. Diagnose: Kostenlose Rückgabe bei Fachhändlern (SENS) oder Sammelstellen. Fachmann: Entsorgungsunternehmen / Sammelstelle. Dringlichkeit: Niedrig. Kosten: CHF 0–80.",
    "tags": ["elektronikschrott", "entsorgung", "computer", "fernseher", "sens"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Umzug", "unterkategorie": "Entrümpelung",
    "titel": "Keller oder Dachboden entrümpeln",
    "inhalt": "Symptom/Bedarf: Keller oder Estrich ist vollgestopft und muss ausgeräumt werden. Diagnose: Sortieren (Verkauf/Spende/Entsorgung), Mulde bestellen oder Entrümpelungsunternehmen. Fachmann: Entrümpelungsunternehmen. Dringlichkeit: Niedrig. Kosten: CHF 200–800.",
    "tags": ["keller", "estrich", "entrümpeln", "dachboden", "entsorgung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Umzug", "unterkategorie": "Entrümpelung",
    "titel": "Schrottabholung – Metall und Schrott",
    "inhalt": "Symptom/Bedarf: Altes Metall, Fahrräder, Heizkörper oder Schrott soll abgeholt werden. Diagnose: Schrott-Händler holt ab (oft kostenlos oder mit Vergütung). Fachmann: Schrotthändler. Dringlichkeit: Niedrig. Kosten: CHF 0 (oft gratis).",
    "tags": ["schrott", "metall", "fahrrad", "heizkörper", "entsorgung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Umzug", "unterkategorie": "Entrümpelung",
    "titel": "Bauabfälle und Schutt entsorgen",
    "inhalt": "Symptom/Bedarf: Nach Renovation fallen Gips, Fliesen, Beton oder Holz als Schutt an. Diagnose: Mulde bestellen, nach Material trennen – separate Deponierung für Asbest nötig! Fachmann: Entsorgungsunternehmen / Bauentsorgung. Dringlichkeit: Mittel. Kosten: CHF 200–1500.",
    "tags": ["schutt", "bauabfall", "mulde", "renovation", "entsorgung"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # SCHIMMEL / FEUCHTIGKEITSSANIERUNG (6 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Gebäude", "unterkategorie": "Schimmel",
    "titel": "Schimmel in der Wohnung – Ursache finden",
    "inhalt": "Symptom: Schwarze Flecken an Wänden, Ecken oder hinter Möbeln, muffiger Geruch. Diagnose: Ursachen unterscheiden: Kondensationsfeuchte (Lüftungsmangel), Kapillarfeuchte (Bauwerk) oder Leckage. Fachmann: Bausanierer / Energieberater. Dringlichkeit: Hoch (Gesundheit). Kosten: CHF 200–3000.",
    "tags": ["schimmel", "feuchtigkeit", "wand", "sanierung", "gesundheit"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Schimmel",
    "titel": "Schimmel im Bad bekämpfen",
    "inhalt": "Symptom: Schwarzer Schimmel an Silikon, Fugen oder hinter dem WC. Diagnose: Feuchtigkeit durch ungenügende Lüftung – Silikon erneuern, Lüftung verbessern. Fachmann: Fliesenleger / Maler / Lüftungstechniker. Dringlichkeit: Mittel. Kosten: CHF 80–400.",
    "tags": ["schimmel", "bad", "silikon", "fugen", "lüftung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Schimmel",
    "titel": "Wärmedämmung verbessern – gegen Kältebrücken",
    "inhalt": "Symptom: Wände fühlen sich kalt an, Schimmel in Ecken und an Aussenwänden. Diagnose: Wärmebrücken (ungedämmte Ecken) begünstigen Kondensation und Schimmel. Fachmann: Energieberater / Baufirma. Dringlichkeit: Mittel. Kosten: CHF 5000–30000 (Sanierung).",
    "tags": ["wärmedämmung", "kältebrücke", "schimmel", "sanierung", "energieberater"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Schimmel",
    "titel": "Lüftungsanlage reinigen oder nachrüsten",
    "inhalt": "Symptom: Luft in der Wohnung stickig, Schimmel tritt trotz Lüften immer wieder auf. Diagnose: Komfortlüftungsanlage (KWL) oder einfache Lüftungsanlage reinigen bzw. nachrüsten. Fachmann: Lüftungstechniker / Elektriker. Dringlichkeit: Mittel. Kosten: CHF 200–3000.",
    "tags": ["lüftung", "komfortlüftung", "kwl", "schimmel", "luftqualität"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Schimmel",
    "titel": "Feuchtigkeitsmessung und Schadensanalyse",
    "inhalt": "Symptom: Wand fühlt sich feucht an, Verdacht auf verdeckten Wasserschaden. Diagnose: Feuchtigkeitsmessung mit Profi-Gerät klärt ob Bau- oder Nutzerfeuchtigkeit. Fachmann: Bausachverständiger / Bausanierer. Dringlichkeit: Mittel. Kosten: CHF 200–600 (Messung).",
    "tags": ["feuchtigkeit", "feuchtigkeitsmessung", "schaden", "bausachverständiger", "wand"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Schimmel",
    "titel": "Kellerabdichtung gegen Schimmel und Nässe",
    "inhalt": "Symptom: Keller immer wieder feucht, Schimmel an Wänden trotz Lüften. Diagnose: Innen- oder Aussenabdichtung, Drainage verlegen oder Horizontalsperre einbringen. Fachmann: Bausanierer / Abdichter. Dringlichkeit: Hoch. Kosten: CHF 5000–20000.",
    "tags": ["keller", "abdichtung", "schimmel", "drainage", "bausanierung"], "quelle": "BOB Wissensdatenbank"
  },

]

def insert_batch(entries, batch_size=20):
    url = f"{SUPABASE_URL}/rest/v1/bob_knowledge"
    headers = {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "return=minimal"
    }
    total, errors = 0, 0
    for i in range(0, len(entries), batch_size):
        batch = entries[i:i+batch_size]
        data = json.dumps(batch).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req) as resp:
                if resp.status in (200, 201):
                    total += len(batch)
                    print(f"  ✅ Batch {i//batch_size + 1}: {len(batch)} eingefügt")
                else:
                    print(f"  ⚠️  Batch {i//batch_size + 1}: HTTP {resp.status}")
                    errors += 1
        except urllib.error.HTTPError as e:
            print(f"  ❌ Batch {i//batch_size + 1}: {e.code} – {e.read().decode()[:200]}")
            errors += 1
    return total, errors

if __name__ == "__main__":
    cats = Counter(e["kategorie"] for e in ENTRIES)
    print(f"Inseriere {len(ENTRIES)} Einträge:")
    for k, v in sorted(cats.items()):
        print(f"  {k}: {v}")
    print()
    total, errors = insert_batch(ENTRIES)
    print(f"\nErgebnis: {total} eingefügt, {errors} Fehler")
    if errors:
        sys.exit(1)
