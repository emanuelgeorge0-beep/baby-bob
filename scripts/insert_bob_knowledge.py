#!/usr/bin/env python3
"""Insert 100 bob_knowledge entries: 10 Handwerk categories × 10 problems each."""

import json, urllib.request, urllib.error, os, sys

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://bmdmoehjwadvdlbrmpuq.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
if not SUPABASE_KEY:
    print("ERROR: SUPABASE_KEY oder SUPABASE_SERVICE_KEY muss als Umgebungsvariable gesetzt sein.")
    sys.exit(1)

ENTRIES = [

  # ─────────────────────────────────────────────────────
  # HEIZUNG (10 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Heizung", "unterkategorie": "Probleme",
    "titel": "Heizkörper kalt – Heizung läuft nicht",
    "inhalt": "Symptom: Heizkörper bleibt kalt, obwohl Thermostat aufgedreht ist. Diagnose: Entlüftung nötig, Ventil klemmt oder Umwälzpumpe defekt. Fachmann: Heizungsmonteur. Dringlichkeit: Hoch (Winter). Kosten: CHF 80–200.",
    "tags": ["heizung", "heizkörper", "kalt", "entlüften", "ventil"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Probleme",
    "titel": "Heizkessel startet nicht – Öl/Gas",
    "inhalt": "Symptom: Kessel springt nicht an, Fehlermeldung auf Display. Diagnose: Zündung defekt, Brenner verschmutzt, Ölfilter verstopft oder Gasabsperrventil geschlossen. Fachmann: Heizungsmonteur / Kesselfachmann. Dringlichkeit: Sehr hoch. Kosten: CHF 150–500.",
    "tags": ["kessel", "brenner", "zündung", "gasheizung", "ölheizung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Probleme",
    "titel": "Heizung macht Klopfgeräusche",
    "inhalt": "Symptom: Lautstarkes Klopfen oder Blubbern in Rohren und Heizkörpern. Diagnose: Luft im System, Kalkablagerungen oder Wassermangel im Kreislauf. Fachmann: Heizungsmonteur. Dringlichkeit: Mittel. Kosten: CHF 80–250.",
    "tags": ["heizung", "klopfen", "geräusche", "luft", "entlüften"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Probleme",
    "titel": "Thermostat reagiert nicht / zeigt falsche Temperatur",
    "inhalt": "Symptom: Zimmertemperatur weicht stark von eingestelltem Wert ab, Thermostat reagiert nicht. Diagnose: Batterie leer, Thermostat defekt oder Kalibrierung nötig. Fachmann: Heizungsmonteur oder Elektriker. Dringlichkeit: Mittel. Kosten: CHF 50–180.",
    "tags": ["thermostat", "temperatur", "heizung", "batterie", "steuerung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Probleme",
    "titel": "Boiler liefert kein heisses Wasser",
    "inhalt": "Symptom: Kein Warmwasser aus Dusche/Hahn trotz laufender Heizung. Diagnose: Boiler defekt, Heizstab durchgebrannt, Thermostat oder Mischventil defekt. Fachmann: Heizungsmonteur / Sanitär. Dringlichkeit: Hoch. Kosten: CHF 120–600.",
    "tags": ["boiler", "warmwasser", "heizstab", "mischventil", "sanitär"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Probleme",
    "titel": "Expansionsgefäss defekt – Druck fällt ab",
    "inhalt": "Symptom: Heizungsdruckanzeige fällt regelmässig unter 1 bar, Anlage muss oft nachgefüllt werden. Diagnose: Expansionsgefäss Membran defekt oder Vordruck zu niedrig. Fachmann: Heizungsmonteur. Dringlichkeit: Mittel. Kosten: CHF 150–400.",
    "tags": ["expansionsgefäss", "druck", "heizung", "membran", "nachfüllen"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Probleme",
    "titel": "Fussbodenheizung heizt ungleichmässig",
    "inhalt": "Symptom: Manche Zonen sind warm, andere kalt – Fussbodenheizung verteilt Wärme ungleich. Diagnose: Heizkreisverteiler-Ventil klemmt, Luftblasen im System oder Pumpenleistung zu schwach. Fachmann: Heizungsmonteur. Dringlichkeit: Mittel. Kosten: CHF 100–350.",
    "tags": ["fussbodenheizung", "heizkreis", "verteiler", "zone", "einregulieren"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Probleme",
    "titel": "Heizkörperventil klemmt – lässt sich nicht drehen",
    "inhalt": "Symptom: Thermostatventil am Heizkörper lässt sich nicht verstellen, ist eingerostet. Diagnose: Ventilstift korrodiert (häufig nach Sommer-Stillstand). Fachmann: Heizungsmonteur. Dringlichkeit: Niedrig–Mittel. Kosten: CHF 50–150.",
    "tags": ["ventil", "thermostat", "heizkörper", "eingerostet", "klemmt"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Probleme",
    "titel": "Heizung verliert Wasser – Leckage",
    "inhalt": "Symptom: Wasserflecken unter Heizkörper oder Rohren, Heizungsdruck sinkt. Diagnose: Dichtung defekt, Verschraubung undicht oder Korrosion am Rohr. Fachmann: Heizungsmonteur / Sanitärinstallateur. Dringlichkeit: Hoch. Kosten: CHF 100–500.",
    "tags": ["heizung", "leckage", "wasser", "dichtung", "druck"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Probleme",
    "titel": "Wärmepumpe läuft, heizt aber nicht ausreichend",
    "inhalt": "Symptom: Wärmepumpe ist in Betrieb, Haus bleibt aber kalt – COP sehr niedrig. Diagnose: Kältemittelmangel, Vereisung des Aussengeräts, Defekt Expansionsventil oder Kompressor. Fachmann: Kälte-/Heizungsmonteur. Dringlichkeit: Hoch. Kosten: CHF 200–1500.",
    "tags": ["wärmepumpe", "heizung", "kältemittel", "kompressor", "cop"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # SANITÄR (10 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Sanitär", "unterkategorie": "Probleme",
    "titel": "Wasserhahn tropft – ständiges Tropfen",
    "inhalt": "Symptom: Wasserhahn tropft auch wenn geschlossen. Diagnose: Dichtung (O-Ring/Kartusche) verschlissen. Fachmann: Sanitärinstallateur. Dringlichkeit: Mittel (erhöhter Wasserverbrauch). Kosten: CHF 60–150.",
    "tags": ["wasserhahn", "tropft", "dichtung", "kartusche", "armatur"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Sanitär", "unterkategorie": "Probleme",
    "titel": "WC läuft ständig nach",
    "inhalt": "Symptom: Wasser läuft dauerhaft in die WC-Schüssel. Diagnose: Spülventil (Füllventil/Ablaufventil) defekt oder falsch eingestellt. Fachmann: Sanitärinstallateur. Dringlichkeit: Mittel. Kosten: CHF 80–200.",
    "tags": ["wc", "toilette", "nachläufen", "spülventil", "füllventil"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Sanitär", "unterkategorie": "Probleme",
    "titel": "Abfluss verstopft – Waschbecken / Dusche",
    "inhalt": "Symptom: Wasser läuft sehr langsam oder gar nicht ab. Diagnose: Haare, Seifenreste oder Kalk verstopfen den Siphon oder das Rohr. Fachmann: Sanitärinstallateur / Rohrreiniger. Dringlichkeit: Mittel–Hoch. Kosten: CHF 80–300.",
    "tags": ["abfluss", "verstopft", "siphon", "rohrreinigung", "dusche"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Sanitär", "unterkategorie": "Probleme",
    "titel": "Niedriger Wasserdruck in ganzer Wohnung",
    "inhalt": "Symptom: Wasser kommt nur schwach aus allen Hähnen. Diagnose: Druckminderer defekt, Filter verstopft oder Leckage im Hauptleitungssystem. Fachmann: Sanitärinstallateur. Dringlichkeit: Mittel. Kosten: CHF 100–400.",
    "tags": ["wasserdruck", "druckminderer", "leitungsdruck", "filter", "sanitär"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Sanitär", "unterkategorie": "Probleme",
    "titel": "Rohrbruch – Wasser strömt aus Wand/Boden",
    "inhalt": "Symptom: Wasser tritt aus Wand, Boden oder Decke aus, Wasserflecken/Schaden sichtbar. Diagnose: Rohr geplatzt durch Frost, Korrosion oder mechanischen Schaden. Fachmann: Sanitärinstallateur (NOTFALL). Dringlichkeit: Sofort. Kosten: CHF 300–3000.",
    "tags": ["rohrbruch", "notfall", "wasser", "leckage", "frost"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Sanitär", "unterkategorie": "Probleme",
    "titel": "WC verstopft – Spülung funktioniert nicht",
    "inhalt": "Symptom: WC lässt sich nicht mehr spülen, Wasser steigt beim Spülen. Diagnose: Fremdkörper im Siphon oder Abflussrohr verstopft. Fachmann: Sanitärinstallateur / Rohrreiniger. Dringlichkeit: Hoch. Kosten: CHF 100–350.",
    "tags": ["wc", "verstopft", "rohrreinigung", "siphon", "spülung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Sanitär", "unterkategorie": "Probleme",
    "titel": "Dusche riecht nach Abwasser / faulem Ei",
    "inhalt": "Symptom: Übler Geruch steigt aus dem Duschabfluss auf, v.a. nach längerem Nicht-Benutzen. Diagnose: Siphon ausgetrocknet, Biofilm im Abfluss oder Rückstau aus dem Kanal. Fachmann: Sanitärinstallateur. Dringlichkeit: Mittel. Kosten: CHF 60–200.",
    "tags": ["dusche", "geruch", "abwasser", "siphon", "abfluss"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Sanitär", "unterkategorie": "Probleme",
    "titel": "Siphon tropft unter dem Waschbecken",
    "inhalt": "Symptom: Tropfendes Wasser unter dem Waschbecken, Schrank nass. Diagnose: Siphon-Dichtung verschlissen, Gewinde undicht oder Siphon gerissen. Fachmann: Sanitärinstallateur. Dringlichkeit: Mittel. Kosten: CHF 50–150.",
    "tags": ["siphon", "waschbecken", "tropft", "dichtung", "unterbau"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Sanitär", "unterkategorie": "Probleme",
    "titel": "Kaltes Wasser kommt warm – Legionellengefahr",
    "inhalt": "Symptom: Aus dem Kaltwasserhahn kommt lauwarm Wasser (über 25°C). Diagnose: Kaltwasserleitung erwärmt durch ungenügende Isolation oder Stagnation. Legionellengefahr! Fachmann: Sanitärinstallateur. Dringlichkeit: Hoch. Kosten: CHF 150–500.",
    "tags": ["kaltwasser", "legionellen", "hygiene", "temperatur", "stagnation"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Sanitär", "unterkategorie": "Probleme",
    "titel": "Badewannen-/Duschabdichtung undicht",
    "inhalt": "Symptom: Silikon um Badewanne oder Dusche ist schwarz, schimmelig oder löst sich ab. Wasser dringt möglicherweise in Wand. Diagnose: Silikon ausgehärtet und gerissen, Fugenanschluss nicht mehr dicht. Fachmann: Sanitärinstallateur / Fliesenleger. Dringlichkeit: Mittel. Kosten: CHF 80–250.",
    "tags": ["silikon", "abdichtung", "badewanne", "dusche", "schimmel"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # ELEKTRO (10 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Elektro", "unterkategorie": "Probleme",
    "titel": "Sicherung fliegt wiederholt raus",
    "inhalt": "Symptom: Eine bestimmte Sicherung löst wiederholt aus, sobald ein Gerät eingeschaltet wird. Diagnose: Überlastung des Stromkreises, Kurzschluss in Leitung oder defektes Gerät. Fachmann: Elektriker. Dringlichkeit: Hoch. Kosten: CHF 100–350.",
    "tags": ["sicherung", "überlastung", "kurzschluss", "stromkreis", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Probleme",
    "titel": "Steckdose funktioniert nicht",
    "inhalt": "Symptom: Steckdose gibt keinen Strom – angeschlossene Geräte funktionieren nicht. Diagnose: FI/Leitungsschutzschalter ausgelöst, Klemmverbindung locker oder Steckdose defekt. Fachmann: Elektriker. Dringlichkeit: Mittel. Kosten: CHF 80–200.",
    "tags": ["steckdose", "stromlos", "fi-schalter", "elektriker", "klemme"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Probleme",
    "titel": "Lichtschalter funkt oder knistert",
    "inhalt": "Symptom: Beim Betätigen des Lichtschalters ist Funkenbildung oder Knistern hörbar. Diagnose: Kontakte oxidiert/verschlissen, lockere Klemme oder Schalter zu alt. Brandgefahr! Fachmann: Elektriker. Dringlichkeit: Hoch. Kosten: CHF 80–180.",
    "tags": ["lichtschalter", "funken", "knistern", "brandgefahr", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Probleme",
    "titel": "FI-Schalter löst sofort aus",
    "inhalt": "Symptom: FI-Schutzschalter löst beim Einschalten aus oder lässt sich nicht einschalten. Diagnose: Fehlerstrom in Leitung, defektes Gerät oder feuchte Leitung. Fachmann: Elektriker. Dringlichkeit: Hoch. Kosten: CHF 100–400.",
    "tags": ["fi-schalter", "fehlerstrom", "rcd", "sicherungskasten", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Probleme",
    "titel": "Kein Strom in einem ganzen Raum",
    "inhalt": "Symptom: Kompletter Raum ohne Strom und Licht, alle Steckdosen tot. Diagnose: Leitungsschutzschalter ausgelöst, Kabel unterbrochen oder Verteilerkasten-Problem. Fachmann: Elektriker. Dringlichkeit: Mittel–Hoch. Kosten: CHF 100–500.",
    "tags": ["stromausfall", "raum", "sicherung", "verteiler", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Probleme",
    "titel": "Beleuchtung flackert",
    "inhalt": "Symptom: LED oder Glühbirne flackert, blinkt oder dimmt von selbst. Diagnose: Schlechter Kontakt in Fassung, ungeeignetes Leuchtmittel für Dimmer oder Trafo-Problem. Fachmann: Elektriker. Dringlichkeit: Niedrig–Mittel. Kosten: CHF 60–200.",
    "tags": ["beleuchtung", "flackern", "led", "dimmer", "trafo"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Probleme",
    "titel": "Steckdose riecht verbrannt / überhitzt",
    "inhalt": "Symptom: Steckdose ist warm, riecht nach verbranntem Plastik oder ist verfärbt. Diagnose: Kontaktkorrosion, Überlastung oder schlechte Klemmverbindung mit Lichtbogenbildung. Fachmann: Elektriker (SOFORT). Dringlichkeit: Sofort – Brandgefahr. Kosten: CHF 100–300.",
    "tags": ["steckdose", "brandgefahr", "überhitzt", "verbrannt", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Probleme",
    "titel": "Elektroherd oder Backofen heizt nicht",
    "inhalt": "Symptom: Herdplatte oder Backofen wird nicht warm, obwohl Strom vorhanden. Diagnose: Heizelement defekt, Temperaturregler kaputt oder Sicherheitsthermostat ausgelöst. Fachmann: Elektriker / Haushaltsgerät-Techniker. Dringlichkeit: Mittel. Kosten: CHF 100–450.",
    "tags": ["herd", "backofen", "heizelement", "thermostat", "küche"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Probleme",
    "titel": "Aussensteckdose / Gartenbeleuchtung funktioniert nicht",
    "inhalt": "Symptom: Strom im Garten oder auf Terrasse ausgefallen. Diagnose: Witterungsschutz-FI hat ausgelöst, Kabelbruch durch Grabarbeiten oder Feuchtigkeitsschaden. Fachmann: Elektriker. Dringlichkeit: Mittel. Kosten: CHF 100–500.",
    "tags": ["aussensteckdose", "gartenbeleuchtung", "fi-schalter", "witterungsschutz", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Probleme",
    "titel": "Zählerkasten / Sicherungskasten veraltet",
    "inhalt": "Symptom: Alte Schmelzsicherungen, kein FI-Schutz, unübersichtlicher Verteiler. Diagnose: Veraltete Elektroinstallation, entspricht nicht mehr den Normen (NIN). Fachmann: Elektriker. Dringlichkeit: Mittel (Sicherheit). Kosten: CHF 500–3000.",
    "tags": ["sicherungskasten", "zählerkasten", "fi-schutz", "nin", "sanierung"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # FLIESEN (10 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Fliesen", "unterkategorie": "Probleme",
    "titel": "Fliese gesprungen oder gerissen",
    "inhalt": "Symptom: Sichtbarer Riss oder Sprung in einer oder mehreren Fliesen. Diagnose: Setzungsriss im Untergrund, zu starker Temperaturwechsel oder Schlagschaden. Fachmann: Fliesenleger. Dringlichkeit: Mittel. Kosten: CHF 80–300 (pro Fliese).",
    "tags": ["fliese", "riss", "gesprungen", "fliesenleger", "bad"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fliesen", "unterkategorie": "Probleme",
    "titel": "Fuge schwarz oder schimmelig",
    "inhalt": "Symptom: Fugen im Bad oder Küche sind dunkel verfärbt oder zeigen Schimmelflecken. Diagnose: Schimmelbefall durch Feuchtigkeit und mangelnde Lüftung, Fugenmörtel porös. Fachmann: Fliesenleger / Maler. Dringlichkeit: Mittel (Gesundheit). Kosten: CHF 100–400.",
    "tags": ["fuge", "schimmel", "bad", "feuchtigkeit", "fugen"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fliesen", "unterkategorie": "Probleme",
    "titel": "Fliese klingt hohl – droht abzufallen",
    "inhalt": "Symptom: Beim Klopfen auf die Fliese entsteht ein hohles Geräusch. Diagnose: Klebemörtel hat sich vom Untergrund gelöst, Fliese ist nicht mehr vollflächig verklebt. Sturz- und Verletzungsgefahr. Fachmann: Fliesenleger. Dringlichkeit: Hoch. Kosten: CHF 100–350.",
    "tags": ["fliese", "hohl", "ablösend", "klebemörtel", "fliesenleger"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fliesen", "unterkategorie": "Probleme",
    "titel": "Fuge bröckelt oder fehlt",
    "inhalt": "Symptom: Fugenmörtel ist rissig, bröckelt heraus oder fehlt stellenweise. Diagnose: Fugenmörtel verwittert oder zu schwach (kein Epoxid in Nasszonen). Fachmann: Fliesenleger. Dringlichkeit: Mittel. Kosten: CHF 80–200.",
    "tags": ["fuge", "bröckelt", "fugenmörtel", "fliesenleger", "nasszelle"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fliesen", "unterkategorie": "Probleme",
    "titel": "Wasser dringt hinter Wandfliesen in der Dusche",
    "inhalt": "Symptom: Feuchtigkeit oder Schimmel hinter Wandfliesen, Fliesen lösen sich. Diagnose: Abdichtungsfolie fehlt oder ist beschädigt, Silikon-Anschluss gerissen. Fachmann: Fliesenleger / Sanitär. Dringlichkeit: Hoch. Kosten: CHF 500–3000 (Neuaufbau).",
    "tags": ["abdichtung", "dusche", "wand", "feuchtigkeit", "fliesenleger"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fliesen", "unterkategorie": "Probleme",
    "titel": "Bodenfliese wackelt oder hat sich verschoben",
    "inhalt": "Symptom: Einzelne Bodenfliesen bewegen sich beim Drauftreten. Diagnose: Klebemörtel unter Fliese fehlt oder hat sich gelöst (Wölbung). Fachmann: Fliesenleger. Dringlichkeit: Mittel (Stolpergefahr). Kosten: CHF 100–300.",
    "tags": ["bodenfliese", "wackelt", "klebemörtel", "fliesenleger", "sturz"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fliesen", "unterkategorie": "Probleme",
    "titel": "Balkonfliesen abgeplatzt durch Frost",
    "inhalt": "Symptom: Balkonfliesen platzen ab, brechen auf oder lösen sich nach Winter. Diagnose: Nicht frostbeständige Fliesen oder fehlende Gefälleableitung; Wasser gefriert unter Fliesen. Fachmann: Fliesenleger. Dringlichkeit: Mittel. Kosten: CHF 300–1500.",
    "tags": ["balkon", "fliesen", "frost", "abgeplatzt", "gefälle"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fliesen", "unterkategorie": "Probleme",
    "titel": "Fliesen neu verlegen – Bad renovieren",
    "inhalt": "Symptom: Veraltete, beschädigte oder unschöne Fliesen sollen erneuert werden. Diagnose: Vollständige Erneuerung inklusive Abdichtung empfohlen. Fachmann: Fliesenleger. Dringlichkeit: Niedrig (Renovierung). Kosten: CHF 80–160/m².",
    "tags": ["fliesen", "renovierung", "bad", "neuverlegen", "fliesenleger"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fliesen", "unterkategorie": "Probleme",
    "titel": "Fliesenverfärbung durch Kalk oder Rost",
    "inhalt": "Symptom: Weisse Kalkflecken oder orangefarbener Rost auf Fliesen und Armaturen. Diagnose: Hartes Leitungswasser (Kalk) oder Eisenoxidation aus Leitungen. Fachmann: Fliesenleger / Reinigungsservice. Dringlichkeit: Niedrig. Kosten: CHF 50–150.",
    "tags": ["kalkflecken", "rost", "verfärbung", "fliesen", "reinigung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fliesen", "unterkategorie": "Probleme",
    "titel": "Bodenfliesen rutschig – Sturzgefahr",
    "inhalt": "Symptom: Glatte Fliesen in Bad oder Küche sind nass sehr rutschig. Diagnose: Fliesen ohne ausreichende Rutschhemmung (unter R9), Antirutschbeschichtung sinnvoll. Fachmann: Fliesenleger. Dringlichkeit: Hoch (Sicherheit). Kosten: CHF 100–500.",
    "tags": ["rutschig", "bodenfliesen", "antirutsch", "bad", "sturzsicherheit"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # MALER (10 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Maler", "unterkategorie": "Probleme",
    "titel": "Wand hat Risse – Haarrisse oder grössere Risse",
    "inhalt": "Symptom: Sichtbare Risse in Putz oder Wandfarbe, von fein (Haarriss) bis breit. Diagnose: Setzungsrisse, Temperaturausdehnung oder Mauerwerksschaden. Fachmann: Maler / Gipser. Dringlichkeit: Mittel. Kosten: CHF 100–500.",
    "tags": ["risse", "wand", "putz", "haarriss", "maler"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Maler", "unterkategorie": "Probleme",
    "titel": "Farbe blättert ab – Wand schält sich",
    "inhalt": "Symptom: Wandfarbe blättert in Schichten ab, schält sich wie Sonnenbrand. Diagnose: Feuchtigkeit hinter der Farbe, falscher Untergrund oder minderwertige Farbe. Fachmann: Maler. Dringlichkeit: Mittel. Kosten: CHF 80–300 (pro Raum).",
    "tags": ["farbe", "abblättern", "wand", "feuchtigkeit", "maler"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Maler", "unterkategorie": "Probleme",
    "titel": "Schimmelflecken an Wand oder Decke",
    "inhalt": "Symptom: Schwarze, grüne oder braune Flecken an Wand oder Decke, bes. in Ecken. Diagnose: Kondensation durch mangelnde Lüftung, Wärmebrücke oder Feuchteschaden. Fachmann: Maler / Bausanierer. Dringlichkeit: Hoch (Gesundheit). Kosten: CHF 150–800.",
    "tags": ["schimmel", "wand", "feuchtigkeit", "maler", "gesundheit"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Maler", "unterkategorie": "Probleme",
    "titel": "Wasserflecken an Decke nach Wasserschaden",
    "inhalt": "Symptom: Braune oder gelbliche Wasserränder an Wand oder Decke nach Wasserschaden. Diagnose: Feuchtigkeit hat Gips/Farbe durchdrungen – nach Trocknung streichen. Fachmann: Maler. Dringlichkeit: Mittel. Kosten: CHF 100–400.",
    "tags": ["wasserfleck", "decke", "wasserschaden", "maler", "streichen"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Maler", "unterkategorie": "Probleme",
    "titel": "Aussenputz abgeplatzt oder rissig",
    "inhalt": "Symptom: Fassadenputz fällt in Stücken ab oder zeigt grossflächige Risse. Diagnose: Frost-Tau-Zyklen, Feuchtigkeit im Mauerwerk oder Putzhaftung nachlassend. Fachmann: Maler / Fassadensanierer. Dringlichkeit: Hoch. Kosten: CHF 50–120/m².",
    "tags": ["aussenputz", "fassade", "abgeplatzt", "frost", "maler"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Maler", "unterkategorie": "Probleme",
    "titel": "Tapete löst sich oder Blasen bilden sich",
    "inhalt": "Symptom: Tapete hebt sich an Nähten, bildet Blasen oder löst sich von der Wand. Diagnose: Kleister nicht ausgehärtet, Untergrund zu glatt oder Feuchtigkeit. Fachmann: Maler / Tapezierer. Dringlichkeit: Niedrig–Mittel. Kosten: CHF 80–250.",
    "tags": ["tapete", "ablösen", "blasen", "maler", "kleister"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Maler", "unterkategorie": "Probleme",
    "titel": "Holzfenster müssen gestrichen werden",
    "inhalt": "Symptom: Holzfenster haben abblätternde Farbe, Risse im Holz, Rahmen greift nicht mehr. Diagnose: UV-Schaden, Verwitterung – Holz muss geschliffen und neu versiegelt werden. Fachmann: Maler / Lackierer. Dringlichkeit: Mittel. Kosten: CHF 150–500 (pro Fenster).",
    "tags": ["holzfenster", "streichen", "verwittert", "maler", "lackierung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Maler", "unterkategorie": "Probleme",
    "titel": "Wohnung nach Einzug neu streichen",
    "inhalt": "Symptom: Wände sind vergilbt, fleckig oder in unschöner Farbe. Diagnose: Vollrenovation – alle Wände und Decken neu grundieren und streichen. Fachmann: Maler. Dringlichkeit: Niedrig (Komfort). Kosten: CHF 25–60/m².",
    "tags": ["renovierung", "streichen", "wohnung", "maler", "einzug"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Maler", "unterkategorie": "Probleme",
    "titel": "Decke vergilbt oder fleckig",
    "inhalt": "Symptom: Deckenfarbe ist gelb verfärbt, fleckig (bes. in Küche/Bad) oder zeigt Nikotinflecken. Diagnose: Fettfilmdampf, Nikotinablagerungen oder alte Farbe. Fachmann: Maler. Dringlichkeit: Niedrig. Kosten: CHF 80–250 (pro Raum).",
    "tags": ["decke", "vergilbt", "nikotin", "maler", "streichen"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Maler", "unterkategorie": "Probleme",
    "titel": "Keller feuchte Wände – Kellerstreichen",
    "inhalt": "Symptom: Kellerwände nass, weisse Ausblühungen oder Salzflecken sichtbar. Diagnose: Kapillarfeuchte aus Erdreich, Drainage fehlt oder Abdichtung defekt. Fachmann: Maler / Bausanierer. Dringlichkeit: Mittel. Kosten: CHF 50–150/m².",
    "tags": ["keller", "feuchte", "ausblühungen", "abdichtung", "maler"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # SCHREINER (10 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Schreiner", "unterkategorie": "Probleme",
    "titel": "Türe klemmt – lässt sich nicht mehr schliessen",
    "inhalt": "Symptom: Innentür lässt sich schwer oder nicht mehr schliessen, Schloss hakt. Diagnose: Türrahmen verzogen durch Feuchtigkeit oder Setzung, Scharniere lose. Fachmann: Schreiner. Dringlichkeit: Mittel. Kosten: CHF 80–300.",
    "tags": ["tür", "klemmt", "schreiner", "rahmen", "scharnier"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Schreiner", "unterkategorie": "Probleme",
    "titel": "Schrankscharnier gebrochen oder ausgerissen",
    "inhalt": "Symptom: Küchenschrank- oder Möbeltür hängt schief oder fällt heraus. Diagnose: Scharnier gebrochen, Dübel ausgerissen oder falsche Montage. Fachmann: Schreiner / Möbelmonteur. Dringlichkeit: Niedrig–Mittel. Kosten: CHF 50–150.",
    "tags": ["scharnier", "schrank", "küche", "schreiner", "türe"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Schreiner", "unterkategorie": "Probleme",
    "titel": "Parkett quietscht beim Gehen",
    "inhalt": "Symptom: Beim Laufen auf Parkett entsteht ein knarrendes/quietschendes Geräusch. Diagnose: Dielen haben sich gegeneinander verschoben, Trittschalldämmung fehlt oder Dübel locker. Fachmann: Schreiner / Bodenleger. Dringlichkeit: Niedrig. Kosten: CHF 80–400.",
    "tags": ["parkett", "quietschen", "knarren", "schreiner", "boden"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Schreiner", "unterkategorie": "Probleme",
    "titel": "Holzfenster verzogen – schliesst nicht dicht",
    "inhalt": "Symptom: Holzfenster schliesst nicht mehr richtig, zieht Kälte, pfeift beim Wind. Diagnose: Holz durch Feuchtigkeit gequollen oder verzogen, Dichtung verschlissen. Fachmann: Schreiner. Dringlichkeit: Mittel (Energieverlust). Kosten: CHF 100–400.",
    "tags": ["holzfenster", "verzogen", "abdichtung", "schreiner", "energieverlust"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Schreiner", "unterkategorie": "Probleme",
    "titel": "Treppenstufe locker oder wackelig",
    "inhalt": "Symptom: Treppenstufe gibt nach, wackelt oder knarrt beim Betreten. Diagnose: Befestigung gelöst, Klebung gebrochen oder Holz durch Feuchtigkeit verzogen. Fachmann: Schreiner. Dringlichkeit: Hoch (Sturzgefahr). Kosten: CHF 100–350.",
    "tags": ["treppe", "stufe", "wackelig", "schreiner", "sturzgefahr"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Schreiner", "unterkategorie": "Probleme",
    "titel": "Schublade klemmt oder lässt sich nicht öffnen",
    "inhalt": "Symptom: Schublade in Küche oder Möbel lässt sich schwer oder gar nicht öffnen. Diagnose: Schiene verbogen, Holz gequollen oder Führung verschmutzt. Fachmann: Schreiner / Möbelschreiner. Dringlichkeit: Niedrig. Kosten: CHF 50–200.",
    "tags": ["schublade", "klemmt", "schiene", "küche", "schreiner"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Schreiner", "unterkategorie": "Probleme",
    "titel": "Holzterrasse: Risse und Splitter",
    "inhalt": "Symptom: Holzterrassendielen haben Längsrisse, Splitter oder sind morsch. Diagnose: UV-Schaden, mangelnde Pflege, keine Ölung – Holz trocknet aus und reisst. Fachmann: Schreiner. Dringlichkeit: Mittel. Kosten: CHF 30–80/m² (Schleifen/Ölen).",
    "tags": ["holzterrasse", "risse", "splitter", "ölen", "schreiner"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Schreiner", "unterkategorie": "Probleme",
    "titel": "Küchenfront beschädigt oder abgeplatzt",
    "inhalt": "Symptom: Folie oder Lack der Küchenfront blättert ab, Ecke ist abgestossen. Diagnose: Feuchtigkeit, mechanischer Schlag oder minderwertige Beschichtung. Fachmann: Schreiner / Küchenfachbetrieb. Dringlichkeit: Niedrig. Kosten: CHF 80–400 (pro Front).",
    "tags": ["küchenfront", "abgeplatzt", "folie", "schreiner", "küche"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Schreiner", "unterkategorie": "Probleme",
    "titel": "Einbauschrank nachrüsten oder anpassen",
    "inhalt": "Symptom: Einbauschrank passt nicht mehr, Regal bricht durch oder neues Regal gewünscht. Diagnose: Massanfertigung oder Anpassung der vorhandenen Konstruktion notwendig. Fachmann: Schreiner. Dringlichkeit: Niedrig. Kosten: CHF 500–3000.",
    "tags": ["einbauschrank", "regal", "schreiner", "massanfertigung", "umbau"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Schreiner", "unterkategorie": "Probleme",
    "titel": "Balkongeländer aus Holz morsch",
    "inhalt": "Symptom: Holzgeländer am Balkon ist morsch, wackelt oder hat Faulstellen. Diagnose: Feuchtigkeit und UV-Schaden über Jahre zerstören unbehandeltes Holz. Fachmann: Schreiner. Dringlichkeit: Hoch (Absturzgefahr). Kosten: CHF 300–1500.",
    "tags": ["geländer", "balkon", "morsch", "schreiner", "absturzgefahr"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # UMZUG / MÖBEL (10 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Umzug", "unterkategorie": "Services",
    "titel": "Wohnungsumzug – alles von A nach B",
    "inhalt": "Symptom/Bedarf: Kompletter Haushaltsumzug in neue Wohnung. Diagnose: Professionelle Planung nötig – Kartons, LKW, Träger. Fachmann: Umzugsunternehmen. Dringlichkeit: Nach Termin. Kosten: CHF 800–3000 (2–4-Zi).",
    "tags": ["umzug", "wohnung", "lkw", "möbel", "träger"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Umzug", "unterkategorie": "Services",
    "titel": "Schwere Möbel transportieren (Treppen, enge Gänge)",
    "inhalt": "Symptom/Bedarf: Sofa, Schrank oder Kühlschrank muss durch enge Treppe oder Treppenhaus. Diagnose: Spezialequipment (Möbelrollen, Treppendolly) und erfahrene Träger nötig. Fachmann: Umzugsunternehmen / Möbeltransport. Dringlichkeit: Nach Termin. Kosten: CHF 200–800.",
    "tags": ["schwermöbel", "treppe", "transport", "umzug", "spedition"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Umzug", "unterkategorie": "Services",
    "titel": "Möbel zusammenbauen – IKEA & Co.",
    "inhalt": "Symptom/Bedarf: Neue Möbel aus Karton müssen auf- und eingebaut werden. Diagnose: Zeitaufwändige Montage mit Spezialwerkzeug und Erfahrung. Fachmann: Möbelmonteur / Handwerker. Dringlichkeit: Niedrig. Kosten: CHF 50–100/h.",
    "tags": ["möbel", "montage", "ikea", "zusammenbauen", "handwerker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Umzug", "unterkategorie": "Services",
    "titel": "Alte Möbel entsorgen oder abbauen",
    "inhalt": "Symptom/Bedarf: Alte Möbel, Matratzen oder Hausrat müssen entsorgt werden. Diagnose: Müllentsorgung nach kantonalen Vorschriften – oft Sperrgutabfuhr oder Mulde. Fachmann: Entsorgungsunternehmen / Umzugsfirma. Dringlichkeit: Niedrig. Kosten: CHF 150–600.",
    "tags": ["möbel", "entsorgen", "sperrmüll", "abbau", "entsorgung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Umzug", "unterkategorie": "Services",
    "titel": "Klavier oder Flügel transportieren",
    "inhalt": "Symptom/Bedarf: Klavier oder Flügel muss umgezogen oder transportiert werden. Diagnose: Sehr schwer, empfindlich – Spezialequipment und erfahrene Pianotransporteure nötig. Fachmann: Klaviertransport-Spezialist. Dringlichkeit: Nach Termin. Kosten: CHF 400–1500.",
    "tags": ["klavier", "flügel", "transport", "umzug", "spezialist"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Umzug", "unterkategorie": "Services",
    "titel": "Möbel einlagern – Lagerung gesucht",
    "inhalt": "Symptom/Bedarf: Möbel oder Hausrat müssen temporär gelagert werden (Zwischenumzug, Renovierung). Diagnose: Lagerraum, Möbellager oder Self-Storage geeignet. Fachmann: Lagerdienstleister / Umzugsfirma. Dringlichkeit: Nach Bedarf. Kosten: CHF 50–200/Monat.",
    "tags": ["lagerung", "möbel", "einlagern", "storage", "umzug"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Umzug", "unterkategorie": "Services",
    "titel": "Büroumzug planen",
    "inhalt": "Symptom/Bedarf: Büro muss mit IT-Equipment, Schreibtischen und Akten verlegt werden. Diagnose: Planung mit EDV-Spezialist und Umzugsfirma, ggf. ausserhalb der Geschäftszeiten. Fachmann: Umzugsunternehmen (Büro). Dringlichkeit: Nach Termin. Kosten: CHF 1500–8000.",
    "tags": ["büroumzug", "it", "schreibtisch", "umzug", "gewerbe"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Umzug", "unterkategorie": "Services",
    "titel": "Umzug per Aussenaufzug / Möbellift",
    "inhalt": "Symptom/Bedarf: Möbel können nicht durch Treppenhaus – Fenstermontage nötig. Diagnose: Aussenaufzug / Möbellift mieten für sicheren Möbeltransport über Balkone. Fachmann: Umzugsunternehmen mit Möbellift. Dringlichkeit: Nach Termin. Kosten: CHF 300–800.",
    "tags": ["möbellift", "aussenaufzug", "umzug", "fenster", "transport"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Umzug", "unterkategorie": "Services",
    "titel": "Möbel selbst aufbauen – Anleitung falsch",
    "inhalt": "Symptom/Bedarf: Möbel wurde falsch zusammengebaut, Teile fehlen oder passen nicht. Diagnose: Fehler bei Selbstmontage – Profi baut auseinander und korrekt wieder auf. Fachmann: Möbelmonteur. Dringlichkeit: Niedrig. Kosten: CHF 80–250.",
    "tags": ["montage", "möbel", "fehler", "ikea", "aufbau"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Umzug", "unterkategorie": "Services",
    "titel": "Letzte Reinigung nach Auszug",
    "inhalt": "Symptom/Bedarf: Wohnung muss für Übergabe besenrein oder besenrein + gereinigt sein. Diagnose: Abnahme-Reinigung gemäss Schweizer Mietrecht – professionell für Depot-Rückerstattung. Fachmann: Reinigungsunternehmen. Dringlichkeit: Hoch (Termin). Kosten: CHF 200–600.",
    "tags": ["reinigung", "auszug", "übergabe", "mietrecht", "depot"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # KÜCHE (10 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Küche", "unterkategorie": "Probleme",
    "titel": "Dunstabzugshaube filtert nicht mehr / stinkt",
    "inhalt": "Symptom: Küchengerüche bleiben trotz eingeschalteter Haube, Fettfilter ist schwarz. Diagnose: Fettfilter verstopft, Kohlefilter gesättigt oder Motor defekt. Fachmann: Elektriker / Haushaltsgeräte-Techniker. Dringlichkeit: Niedrig. Kosten: CHF 50–200.",
    "tags": ["dunstabzug", "haube", "filter", "küche", "fettfilter"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Küche", "unterkategorie": "Probleme",
    "titel": "Geschirrspüler läuft nicht oder spült nicht sauber",
    "inhalt": "Symptom: Spülmaschine startet nicht, bleibt stehen oder Geschirr bleibt schmutzig. Diagnose: Pumpe defekt, Sprüharm verstopft, Salz- oder Klarspülermangel oder Fehler im Programm. Fachmann: Haushaltsgeräte-Techniker. Dringlichkeit: Mittel. Kosten: CHF 100–400.",
    "tags": ["geschirrspüler", "spülmaschine", "pumpe", "sprüharm", "küche"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Küche", "unterkategorie": "Probleme",
    "titel": "Kühlschrank kühlt nicht mehr",
    "inhalt": "Symptom: Lebensmittel bleiben nicht kalt, Temperatur steigt auf über 10°C. Diagnose: Kältemittel verloren, Kompressor defekt oder Türdichtung undicht. Fachmann: Haushaltsgeräte-Techniker / Kältemonteur. Dringlichkeit: Hoch (Lebensmittelsicherheit). Kosten: CHF 100–600.",
    "tags": ["kühlschrank", "kühlt nicht", "kompressor", "kältemittel", "küche"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Küche", "unterkategorie": "Probleme",
    "titel": "Küchenabfluss verstopft oder riecht",
    "inhalt": "Symptom: Küchenspüle läuft langsam ab, stehendes Wasser oder übler Geruch aus dem Abfluss. Diagnose: Fett und Speisereste haben Siphon/Rohr verstopft. Fachmann: Sanitärinstallateur / Rohrreiniger. Dringlichkeit: Mittel. Kosten: CHF 80–300.",
    "tags": ["abfluss", "küche", "verstopft", "fett", "rohrreinigung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Küche", "unterkategorie": "Probleme",
    "titel": "Arbeitsplatte beschädigt oder brüchig",
    "inhalt": "Symptom: Küchenarbeitsplatte hat Risse, Brandflecken, Schnittstellen oder ist durchgebogen. Diagnose: Feuchtigkeit unter Spüle oder mechanischer Schaden. Fachmann: Schreiner / Küchenbauer. Dringlichkeit: Mittel. Kosten: CHF 300–1200 (Erneuerung).",
    "tags": ["arbeitsplatte", "riss", "brandflecken", "küche", "schreiner"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Küche", "unterkategorie": "Probleme",
    "titel": "Küche komplett einbauen",
    "inhalt": "Symptom/Bedarf: Neue Einbauküche muss montiert und angeschlossen werden. Diagnose: Elektro-, Sanitär- und Schreinierarbeiten koordinieren. Fachmann: Küchenmonteur + Elektriker + Sanitär. Dringlichkeit: Nach Termin. Kosten: CHF 500–2000 (Montage).",
    "tags": ["küche", "einbau", "montage", "elektriker", "sanitär"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Küche", "unterkategorie": "Probleme",
    "titel": "Mikrowelle oder Backofen defekt",
    "inhalt": "Symptom: Mikrowelle heizt nicht, Drehteller dreht sich nicht oder Backofen bleibt kalt. Diagnose: Magnetron defekt, Sicherung ausgelöst oder Thermostat kaputt. Fachmann: Haushaltsgeräte-Techniker. Dringlichkeit: Mittel. Kosten: CHF 80–350.",
    "tags": ["mikrowelle", "backofen", "defekt", "küche", "magnetron"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Küche", "unterkategorie": "Probleme",
    "titel": "Gefrierschrank vereist stark",
    "inhalt": "Symptom: Dicker Eismantel im Gefriergerät, No-Frost-Funktion ausgefallen. Diagnose: Heizstab für Abtauung defekt, Türdichtung undicht oder Abtauautomatik defekt. Fachmann: Haushaltsgeräte-Techniker. Dringlichkeit: Mittel. Kosten: CHF 80–300.",
    "tags": ["gefrierschrank", "vereist", "no-frost", "abtauung", "küche"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Küche", "unterkategorie": "Probleme",
    "titel": "Küchenrückwand anbringen oder erneuern",
    "inhalt": "Symptom/Bedarf: Küchenrückwand fehlt, ist beschädigt oder soll erneuert werden (Glas, Stein, Laminat). Diagnose: Massarbeit und sichere Befestigung notwendig. Fachmann: Schreiner / Fliesenleger / Handwerker. Dringlichkeit: Niedrig. Kosten: CHF 200–800.",
    "tags": ["küchenrückwand", "spritzschutz", "küche", "schreiner", "glas"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Küche", "unterkategorie": "Probleme",
    "titel": "Gasherd: Gas riecht / kein Zündfunke",
    "inhalt": "Symptom: Gasgeruch in der Küche oder Gasherd zündet nicht mehr. Diagnose: Gaszufuhr prüfen, Zündkerze verschmutzt oder Gasleitung undicht. Fachmann: Gasinstallateur / Elektriker (SOFORT bei Gasgeruch). Dringlichkeit: Sofort bei Gasgeruch. Kosten: CHF 80–400.",
    "tags": ["gasherd", "gasgeruch", "zündung", "gasinstallateur", "notfall"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # DACH (10 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Dach", "unterkategorie": "Probleme",
    "titel": "Dach undicht – Wasser dringt ins Haus",
    "inhalt": "Symptom: Nach Regen erscheinen Wasserflecken an Decke oder im Dachboden. Diagnose: Dachziegel verschoben/gebrochen, Dachdichtung rissig oder Firstabdichtung defekt. Fachmann: Dachdecker. Dringlichkeit: Hoch. Kosten: CHF 300–3000.",
    "tags": ["dach", "undicht", "regen", "dachdecker", "wassereinbruch"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Dach", "unterkategorie": "Probleme",
    "titel": "Dachziegel gebrochen oder verschoben",
    "inhalt": "Symptom: Einzelne Dachziegel sind sichtbar beschädigt, gebrochen oder liegen falsch. Diagnose: Sturmschaden, Frost oder mechanischer Aufprall (Ast, Hagel). Fachmann: Dachdecker. Dringlichkeit: Hoch (verhindert Folgeschaden). Kosten: CHF 200–800.",
    "tags": ["dachziegel", "gebrochen", "sturm", "dachdecker", "hagel"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Dach", "unterkategorie": "Probleme",
    "titel": "Dachrinne verstopft oder durchgebogen",
    "inhalt": "Symptom: Wasser läuft über die Dachrinne, spritzt gegen Fassade oder steht in der Rinne. Diagnose: Laub und Moos verstopfen Rinne, Halterung gebrochen oder Rinne falsch gefällt. Fachmann: Dachdecker / Spengler. Dringlichkeit: Mittel. Kosten: CHF 100–600.",
    "tags": ["dachrinne", "verstopft", "spengler", "dachdecker", "laub"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Dach", "unterkategorie": "Probleme",
    "titel": "Dachfenster undicht oder beschlägt",
    "inhalt": "Symptom: Um Dachfenster erscheinen Feuchtigkeitsränder, Kondensation oder Zugluft. Diagnose: Anschlussdichtung defekt, Scheibe undicht oder Folie gerissen. Fachmann: Dachdecker / Fenstermonteur. Dringlichkeit: Mittel–Hoch. Kosten: CHF 200–1000.",
    "tags": ["dachfenster", "undicht", "kondensation", "dachdecker", "velux"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Dach", "unterkategorie": "Probleme",
    "titel": "Moos auf Dachziegeln",
    "inhalt": "Symptom: Grünes Moos überzieht viele Dachziegel, Dach sieht vernachlässigt aus. Diagnose: Moos speichert Feuchtigkeit, beschleunigt Verwitterung und kann Ziegel sprengen. Fachmann: Dachdecker / Dachreinigung. Dringlichkeit: Mittel. Kosten: CHF 5–15/m².",
    "tags": ["moos", "dachziegel", "dach", "reinigung", "verwitterung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Dach", "unterkategorie": "Probleme",
    "titel": "Kamin undicht oder bröckelnde Fugen",
    "inhalt": "Symptom: Wasser tropft oder dringt am Kamin ein, Fugen sind mürbe, Kaminputz bröckelt. Diagnose: Anschluss Kamin/Dach undicht, Mörtel verwittert oder Blech oxidiert. Fachmann: Dachdecker / Kaminfeger. Dringlichkeit: Mittel. Kosten: CHF 300–1500.",
    "tags": ["kamin", "undicht", "fugen", "dachdecker", "kaminfeger"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Dach", "unterkategorie": "Probleme",
    "titel": "Dachboden feucht – Kondensation",
    "inhalt": "Symptom: Dachboden ist feucht, Balken zeigen Schimmel, Isolierung ist nass. Diagnose: Dampfbremse fehlt oder beschädigt, Lüftung ungenügend oder Dachhaut undicht. Fachmann: Dachdecker / Energieberater. Dringlichkeit: Hoch. Kosten: CHF 500–5000.",
    "tags": ["dachboden", "feuchtigkeit", "schimmel", "dampfbremse", "dachdecker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Dach", "unterkategorie": "Probleme",
    "titel": "Flachdach: Pfützenbildung oder undicht",
    "inhalt": "Symptom: Wasser bleibt auf Flachdach stehen, Bitumenbahn ist gerissen. Diagnose: Gefälle fehlt, Abläufe verstopft oder Dachabdichtung gealtert/gerissen. Fachmann: Dachdecker / Abdichter. Dringlichkeit: Hoch. Kosten: CHF 50–200/m².",
    "tags": ["flachdach", "pfützen", "bitumen", "abdichtung", "dachdecker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Dach", "unterkategorie": "Probleme",
    "titel": "Solaranlage auf Dach – Montage oder Schaden",
    "inhalt": "Symptom: PV-Module beschädigt, Befestigung locker oder Neuinstallation geplant. Diagnose: Dachdurchdringung muss sachgerecht abgedichtet werden, statische Prüfung nötig. Fachmann: Solarinstallateur / Dachdecker. Dringlichkeit: Mittel. Kosten: CHF 200–1500 (Service).",
    "tags": ["solar", "photovoltaik", "dach", "solaranlage", "montage"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Dach", "unterkategorie": "Probleme",
    "titel": "Schnee- und Eislastenschäden am Dach",
    "inhalt": "Symptom: Dachrinne hängt durch, Dachlatte gebrochen oder Eiszapfen haben Schaden verursacht. Diagnose: Schneelast hat Konstruktion überlastet, Rinnenbefestigung gerissen. Fachmann: Dachdecker / Spengler. Dringlichkeit: Hoch (Winter). Kosten: CHF 200–2000.",
    "tags": ["schnee", "eislast", "dach", "winter", "dachdecker"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # GARTEN (10 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Garten", "unterkategorie": "Probleme",
    "titel": "Rasen überwuchert – mähen und pflegen",
    "inhalt": "Symptom: Rasen ist sehr hoch, verfilzt oder von Unkraut durchsetzt. Diagnose: Regelmässige Pflege nötig – Mähen, Vertikutieren, Düngen. Fachmann: Gärtner / Gartenservice. Dringlichkeit: Niedrig. Kosten: CHF 60–150/h.",
    "tags": ["rasen", "mähen", "garten", "gärtner", "pflege"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Garten", "unterkategorie": "Probleme",
    "titel": "Hecke zu hoch – Schnitt erforderlich",
    "inhalt": "Symptom: Thujahecke oder Liguster überschreitet erlaubte Höhe, wächst auf Gehweg. Diagnose: Regelmässiger Rückschnitt gemäss Abstandsregeln (Kanton). Fachmann: Gärtner. Dringlichkeit: Mittel (Nachbarkonflikte). Kosten: CHF 50–120/h.",
    "tags": ["hecke", "schneiden", "garten", "gärtner", "thuja"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Garten", "unterkategorie": "Probleme",
    "titel": "Baum muss gefällt oder zurückgeschnitten werden",
    "inhalt": "Symptom: Baum ist abgestorben, zu gross, krank oder gefährdet Gebäude. Diagnose: Fällung mit Sicherung, ggf. Baubewilligung nötig (Baumschutz). Fachmann: Baumspezialist / Gärtner (Baumpfleger). Dringlichkeit: Mittel–Hoch. Kosten: CHF 300–2000.",
    "tags": ["baum", "fällen", "rückschnitt", "gärtner", "baumspezialist"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Garten", "unterkategorie": "Probleme",
    "titel": "Gartenbewässerung defekt oder verstopft",
    "inhalt": "Symptom: Sprinkler dreht nicht, Bewässerungsrohr tropft oder Zeitschaltuhr reagiert nicht. Diagnose: Ventil klemmt, Düse verstopft oder Steuerung defekt. Fachmann: Gärtner / Sanitär. Dringlichkeit: Mittel (Pflanzenschaden). Kosten: CHF 80–300.",
    "tags": ["bewässerung", "sprinkler", "garten", "gärtner", "tropfer"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Garten", "unterkategorie": "Probleme",
    "titel": "Pflastersteine reparieren oder verlegen",
    "inhalt": "Symptom: Gartenweg ist abgesackt, Pflastersteine wackeln oder sind gebrochen. Diagnose: Unterbau ausgeschwemmt oder nicht genug verdichtet. Fachmann: Gärtner / Maurerpolier. Dringlichkeit: Mittel (Stolpergefahr). Kosten: CHF 50–120/m².",
    "tags": ["pflastersteine", "gartenweg", "gärtner", "maurer", "abgesackt"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Garten", "unterkategorie": "Probleme",
    "titel": "Pool: Wasser trüb oder Algenbefall",
    "inhalt": "Symptom: Poolwasser ist grün, trüb oder es bilden sich Algen an den Wänden. Diagnose: pH-Wert ausser Balance, Chlorgehalt zu niedrig oder Filter verstopft. Fachmann: Poolservice / Gärtner. Dringlichkeit: Mittel. Kosten: CHF 100–400 (Service).",
    "tags": ["pool", "algen", "wasser", "ph-wert", "poolservice"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Garten", "unterkategorie": "Probleme",
    "titel": "Garten neu anlegen – komplette Gestaltung",
    "inhalt": "Symptom/Bedarf: Neubau oder Sanierung des Gartens – Beete, Rasen, Wege neu gestalten. Diagnose: Planung und Ausführung durch Gartengestalter. Fachmann: Gartenarchitekt / Gärtner. Dringlichkeit: Niedrig. Kosten: CHF 50–120/m² (Ausführung).",
    "tags": ["gartengestaltung", "neugarten", "gärtner", "planung", "anlegen"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Garten", "unterkategorie": "Probleme",
    "titel": "Zaunreparatur oder neuer Zaun gesucht",
    "inhalt": "Symptom: Zaunpfosten verrostet, Latten fehlen oder Gittermatte verbogen. Diagnose: Materialschaden durch Witterung oder mechanischen Einfluss. Fachmann: Gärtner / Schlosser / Schreiner. Dringlichkeit: Mittel. Kosten: CHF 40–120/m.",
    "tags": ["zaun", "reparatur", "zaunpfosten", "gärtner", "garten"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Garten", "unterkategorie": "Probleme",
    "titel": "Wühlmäuse oder Maulwürfe im Garten",
    "inhalt": "Symptom: Erdhügel, Frasspuren an Wurzeln oder Tunnelgänge im Rasen. Diagnose: Wühlmaus- oder Maulwurfbefall – spezifische Bekämpfung je nach Tierart. Fachmann: Schädlingsbekämpfer / Gärtner. Dringlichkeit: Mittel. Kosten: CHF 150–500.",
    "tags": ["wühlmäuse", "maulwurf", "schädlinge", "garten", "bekämpfung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Garten", "unterkategorie": "Probleme",
    "titel": "Herbst: Garten winterfest machen",
    "inhalt": "Symptom/Bedarf: Laubentsorgung, Pflanzen einwickeln, Bewässerung abstellen, Pool abdecken. Diagnose: Saisonale Gartenarbeiten für winterharten Zustand. Fachmann: Gartenservice / Gärtner. Dringlichkeit: Mittel (saisonal). Kosten: CHF 150–600 (einmalig).",
    "tags": ["herbst", "winterfest", "laubblasen", "garten", "gartenservice"], "quelle": "BOB Wissensdatenbank"
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
                status = resp.status
                if status in (200, 201):
                    total += len(batch)
                    print(f"  ✅ Batch {i//batch_size + 1}: {len(batch)} Einträge eingefügt (HTTP {status})")
                else:
                    print(f"  ⚠️  Batch {i//batch_size + 1}: HTTP {status}")
                    errors += 1
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            print(f"  ❌ Batch {i//batch_size + 1}: HTTP {e.code} – {body[:200]}")
            errors += 1
    return total, errors

if __name__ == "__main__":
    print(f"Inseriere {len(ENTRIES)} Einträge in bob_knowledge...")
    cats = {}
    for e in ENTRIES:
        cats[e["kategorie"]] = cats.get(e["kategorie"], 0) + 1
    for k, v in sorted(cats.items()):
        print(f"  {k}: {v} Einträge")
    print()
    total, errors = insert_batch(ENTRIES)
    print(f"\n{'='*40}")
    print(f"Ergebnis: {total} eingefügt, {errors} Fehler")
    if errors:
        sys.exit(1)
