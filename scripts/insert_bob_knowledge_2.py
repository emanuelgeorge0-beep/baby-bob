#!/usr/bin/env python3
"""Insert batch 2: gap-fill + new categories to reach 300+ total."""

import json, urllib.request, urllib.error, os, sys

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://bmdmoehjwadvdlbrmpuq.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
if not SUPABASE_KEY:
    print("ERROR: SUPABASE_KEY oder SUPABASE_SERVICE_KEY muss gesetzt sein.")
    sys.exit(1)

ENTRIES = [

  # ─────────────────────────────────────────────────────
  # AUTO (10 Einträge) – komplett neue Kategorie
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Auto", "unterkategorie": "Probleme",
    "titel": "Auto springt nicht an – Batterie oder Anlasser",
    "inhalt": "Symptom: Auto startet nicht, Anlasser dreht langsam oder Stille beim Schlüsseldrehen. Diagnose: Batterie entladen/defekt, Anlasser defekt oder Wegfahrsperre aktiv. Fachmann: Automechaniker / ADAC/TCS. Dringlichkeit: Hoch. Kosten: CHF 80–400.",
    "tags": ["auto", "springt nicht an", "batterie", "anlasser", "werkstatt"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Auto", "unterkategorie": "Probleme",
    "titel": "Reifenwechsel – Sommer/Winterreifen",
    "inhalt": "Symptom/Bedarf: Reifenwechsel zur Saison oder Reifen verschlissen. Diagnose: Mindestprofil 1.6mm (Schweiz empfiehlt 3mm Winter). Fachmann: Reifenservice / Autowerkstatt. Dringlichkeit: Saisonal. Kosten: CHF 60–150 (Montage).",
    "tags": ["auto", "reifen", "reifenwechsel", "winterreifen", "werkstatt"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Auto", "unterkategorie": "Probleme",
    "titel": "Bremsgeräusche – quietschen oder schleifen",
    "inhalt": "Symptom: Beim Bremsen quietscht oder schleift es, Pedal vibriert. Diagnose: Bremsbeläge abgenutzt, Bremsscheibe verrostet oder Bremssattel klemmt. Fachmann: Automechaniker. Dringlichkeit: Hoch (Sicherheit). Kosten: CHF 150–600.",
    "tags": ["auto", "bremsen", "quietschen", "bremsbeläge", "werkstatt"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Auto", "unterkategorie": "Probleme",
    "titel": "Motorwarnleuchte leuchtet auf",
    "inhalt": "Symptom: Gelbe oder rote Motorleuchte im Armaturenbrett leuchtet dauerhaft oder blinkt. Diagnose: Fehlercode auslesen nötig – kann Lambdasonde, Zündkerze, Abgasreinigung oder ernsteres Problem sein. Fachmann: Automechaniker. Dringlichkeit: Mittel–Hoch. Kosten: CHF 50–500.",
    "tags": ["auto", "motorleuchte", "fehlercode", "obd", "werkstatt"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Auto", "unterkategorie": "Probleme",
    "titel": "Ölwechsel fällig",
    "inhalt": "Symptom: Service-Intervall erreicht, Öl-Warnleuchte leuchtet oder Ölstand niedrig. Diagnose: Motoröl und Filter gemäss Herstellervorschrift wechseln. Fachmann: Autowerkstatt / Schnellservice. Dringlichkeit: Mittel. Kosten: CHF 80–200.",
    "tags": ["auto", "ölwechsel", "service", "motoröl", "werkstatt"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Auto", "unterkategorie": "Probleme",
    "titel": "Klimaanlage kühlt nicht mehr",
    "inhalt": "Symptom: Auto-Klimaanlage bläst nur warme Luft. Diagnose: Kältemittel verloren, Kompressor defekt oder Kondensator verschmutzt. Fachmann: Autoklima-Spezialist / Werkstatt. Dringlichkeit: Mittel. Kosten: CHF 100–500.",
    "tags": ["auto", "klimaanlage", "kühlt nicht", "kältemittel", "werkstatt"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Auto", "unterkategorie": "Probleme",
    "titel": "Unfallschaden – Karosserie oder Lack",
    "inhalt": "Symptom: Delle, Kratzer, abgebrochener Spiegel oder Parkschaden. Diagnose: Kostenvoranschlag beim Karosseriebetrieb, Versicherungsmeldung prüfen. Fachmann: Karosseriebetrieb / Autolackierer. Dringlichkeit: Niedrig–Mittel. Kosten: CHF 200–3000.",
    "tags": ["auto", "unfall", "delle", "karosserie", "lackierung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Auto", "unterkategorie": "Probleme",
    "titel": "Auto-MFK (Motorfahrzeugkontrolle) vorbereiten",
    "inhalt": "Symptom: MFK-Termin steht an, Auto muss geprüft werden. Diagnose: Vorcheck empfohlen: Bremsen, Licht, Reifen, Abgaswerte. Fachmann: Autowerkstatt / MFK-Service. Dringlichkeit: Termin-abhängig. Kosten: CHF 50–200 (Vorcheck).",
    "tags": ["auto", "mfk", "motorfahrzeugkontrolle", "prüfung", "werkstatt"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Auto", "unterkategorie": "Probleme",
    "titel": "Scheinwerfer defekt oder eingetrübt",
    "inhalt": "Symptom: Scheinwerfer leuchtet nicht oder Linse ist vergilbt/eingetrübt. Diagnose: Birne/LED defekt oder UV-Schaden an Kunststofflinse. Fachmann: Autowerkstatt / Elektriker. Dringlichkeit: Hoch (Verkehrssicherheit). Kosten: CHF 50–300.",
    "tags": ["auto", "scheinwerfer", "licht", "eingetrübt", "werkstatt"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Auto", "unterkategorie": "Probleme",
    "titel": "Windschutzscheibe rissig oder gesprungen",
    "inhalt": "Symptom: Steinschlag-Chip oder langer Riss in der Windschutzscheibe. Diagnose: Kleiner Chip reparierbar (bis 3cm), grösserer Riss: Scheibentausch. Fachmann: Autoglaser / Glasservice. Dringlichkeit: Mittel (Sichtbehinderung). Kosten: CHF 50–600.",
    "tags": ["auto", "windschutzscheibe", "steinschlag", "riss", "autoglaser"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # LAMPE / BELEUCHTUNG (8 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Elektro", "unterkategorie": "Beleuchtung",
    "titel": "Lampe funktioniert nicht – Leuchtmittel prüfen",
    "inhalt": "Symptom: Lampe gibt kein Licht obwohl Strom vorhanden. Diagnose: Leuchtmittel (LED/Birne) defekt, Fassung oxidiert oder Kabelbruch. Fachmann: Elektriker. Dringlichkeit: Niedrig. Kosten: CHF 20–120.",
    "tags": ["lampe", "licht", "leuchtmittel", "led", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Beleuchtung",
    "titel": "Deckenlampe hängt durch oder fällt ab",
    "inhalt": "Symptom: Lampe hängt schief, Befestigung ist locker oder Lampe droht herabzufallen. Diagnose: Dübel ausgerissen, Deckenhalterung defekt oder zu schwer für Deckendose. Fachmann: Elektriker. Dringlichkeit: Hoch (Sturzgefahr). Kosten: CHF 80–200.",
    "tags": ["deckenlampe", "hängt", "befestigung", "sturz", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Beleuchtung",
    "titel": "LED-Streifen oder Smart-Beleuchtung installieren",
    "inhalt": "Symptom/Bedarf: LED-Streifen, Spots oder Smart-Home-Beleuchtung soll eingebaut werden. Diagnose: Verkabelung, Trafo und ggf. Smart-Home-Steuerung nötig. Fachmann: Elektriker. Dringlichkeit: Niedrig. Kosten: CHF 100–500.",
    "tags": ["led", "smart home", "beleuchtung", "spots", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Beleuchtung",
    "titel": "Aussenlampe / Hausnummernbeleuchtung defekt",
    "inhalt": "Symptom: Hauseingang-Lampe oder Gartenleuchte leuchtet nicht. Diagnose: Leuchtmittel defekt, Bewegungsmelder ausgefallen oder Kabelbruch. Fachmann: Elektriker. Dringlichkeit: Mittel (Sicherheit). Kosten: CHF 60–250.",
    "tags": ["aussenlampe", "hauseingang", "gartenleuchte", "bewegungsmelder", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Beleuchtung",
    "titel": "Dimmer funktioniert nicht mit LED",
    "inhalt": "Symptom: Dimmer flackert, brummt oder lässt sich nicht tief dimmen mit neuen LED-Lampen. Diagnose: Alter Dimmer nicht LED-kompatibel – LED-fähigen Phasendimmer nötig. Fachmann: Elektriker. Dringlichkeit: Niedrig. Kosten: CHF 60–180.",
    "tags": ["dimmer", "led", "flackern", "brummen", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Beleuchtung",
    "titel": "Einbaustrahler im Bad defekt oder nass",
    "inhalt": "Symptom: Einbauspot im Badezimmer flackert, leuchtet nicht oder hat Kondenswasser. Diagnose: Falscher Schutzgrad (Feuchtraum erfordert IP44+), Leuchtmittel defekt oder Kurzschluss. Fachmann: Elektriker. Dringlichkeit: Mittel (Feuchtraum-Sicherheit). Kosten: CHF 80–250.",
    "tags": ["einbaustrahler", "bad", "ip44", "feuchtraum", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Beleuchtung",
    "titel": "Notbeleuchtung / Treppenhaus-Licht defekt",
    "inhalt": "Symptom: Treppenhauslicht schaltet nicht automatisch, bleibt dauerhaft an oder Notlicht fehlt. Diagnose: Zeitrelais defekt, Bewegungsmelder fehlerhaft oder Notstromversorgung leer. Fachmann: Elektriker. Dringlichkeit: Mittel. Kosten: CHF 80–300.",
    "tags": ["treppenhaus", "notbeleuchtung", "zeitrelais", "bewegungsmelder", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Elektro", "unterkategorie": "Beleuchtung",
    "titel": "Strassenlampe / Hofleuchte flackert",
    "inhalt": "Symptom: Hoflampe oder Gartenbeleuchtung flackert oder geht nach kurzer Zeit aus. Diagnose: Leuchtmittelverschleiss, lockere Klemme oder Bewegungsmelder-Empfindlichkeit zu hoch. Fachmann: Elektriker. Dringlichkeit: Niedrig. Kosten: CHF 50–200.",
    "tags": ["hoflampe", "gartenbeleuchtung", "flackern", "bewegungsmelder", "elektriker"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # BOILER / WARMWASSER (8 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Heizung", "unterkategorie": "Boiler",
    "titel": "Boiler heizt Wasser nicht auf Temperatur",
    "inhalt": "Symptom: Warmwasser kommt nie richtig heiss, max. lauwarm. Diagnose: Thermostat auf zu niedrige Temperatur eingestellt (min. 60°C wegen Legionellen), Heizstab defekt oder Kalkablagerungen. Fachmann: Heizungsmonteur / Sanitär. Dringlichkeit: Mittel. Kosten: CHF 80–400.",
    "tags": ["boiler", "warmwasser", "thermostat", "heizstab", "legionellen"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Boiler",
    "titel": "Boiler tropft oder hat Leckage",
    "inhalt": "Symptom: Wasser tropft vom Boiler, Boden unter Boiler ist nass. Diagnose: Sicherheitsventil hat ausgelöst (zu hoher Druck), Flanschdichtung defekt oder Behälter korrodiert. Fachmann: Heizungsmonteur. Dringlichkeit: Hoch. Kosten: CHF 100–600.",
    "tags": ["boiler", "leckage", "sicherheitsventil", "tropft", "druck"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Boiler",
    "titel": "Warmwasserboiler muss entkalkt werden",
    "inhalt": "Symptom: Warmwasser kommt langsam, Boiler ist sehr laut beim Aufheizen oder riecht. Diagnose: Kalkablagerungen auf dem Heizstab reduzieren Effizienz, erhöhen Energieverbrauch. Fachmann: Heizungsmonteur / Sanitär. Dringlichkeit: Mittel. Kosten: CHF 80–250.",
    "tags": ["boiler", "kalk", "entkalken", "heizstab", "warmwasser"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Boiler",
    "titel": "Boiler erneuern – alter Boiler defekt",
    "inhalt": "Symptom: Boiler ist über 15 Jahre alt, repariert sich nicht mehr, Rostflecken im Wasser. Diagnose: Neuanschaffung empfohlen – Wärmepumpenboiler als energieeffiziente Option. Fachmann: Heizungsmonteur / Sanitär. Dringlichkeit: Mittel. Kosten: CHF 800–3000 (inkl. Einbau).",
    "tags": ["boiler", "erneuerung", "wärmepumpenboiler", "rost", "heizungsmonteur"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Boiler",
    "titel": "Boiler macht Klopfgeräusche beim Aufheizen",
    "inhalt": "Symptom: Boiler knackt, klopft oder pfeift während des Aufheizens. Diagnose: Kalkablagerungen auf Heizstab, die beim Erhitzen aufplatzen (typisches Zeichen für hartes Wasser). Fachmann: Heizungsmonteur. Dringlichkeit: Niedrig–Mittel. Kosten: CHF 80–200.",
    "tags": ["boiler", "klopfen", "geräusche", "kalk", "aufheizen"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Boiler",
    "titel": "Durchlauferhitzer liefert kein heisses Wasser",
    "inhalt": "Symptom: Elektro-Durchlauferhitzer läuft, Wasser bleibt kalt. Diagnose: Heizelement defekt, Sicherheitstemperaturbegrenzer ausgelöst oder Wasserdruck zu niedrig (Minimum 1 bar). Fachmann: Elektriker / Heizungsmonteur. Dringlichkeit: Hoch. Kosten: CHF 80–350.",
    "tags": ["durchlauferhitzer", "warmwasser", "heizelement", "elektriker", "sanitär"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Boiler",
    "titel": "Solarthermie-Boiler: Anlage heizt nicht",
    "inhalt": "Symptom: Solaranlage für Warmwasser liefert trotz Sonnenschein kein warmes Wasser. Diagnose: Pumpe defekt, Fühler falsch platziert oder Solarflüssigkeit nachfüllen. Fachmann: Heizungsmonteur / Solarinstallateur. Dringlichkeit: Mittel. Kosten: CHF 150–600.",
    "tags": ["solarthermie", "boiler", "solar", "warmwasser", "pumpe"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Heizung", "unterkategorie": "Boiler",
    "titel": "Warmwasser riecht nach faulen Eiern",
    "inhalt": "Symptom: Warmwasser riecht nach Schwefel oder faulen Eiern, v.a. nach Abwesenheit. Diagnose: Legionellen- oder Sulfatreduzierer-Bakterien im Boiler durch zu niedrige Temperatur oder Stagnation. Fachmann: Heizungsmonteur. Dringlichkeit: Hoch (Gesundheit). Kosten: CHF 80–250.",
    "tags": ["boiler", "geruch", "legionellen", "bakterien", "warmwasser"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # BALKON (8 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Gebäude", "unterkategorie": "Balkon",
    "titel": "Balkon undicht – Wasser tropft in Wohnung darunter",
    "inhalt": "Symptom: Bei Regen erscheinen Flecken an der Decke der Wohnung unter dem Balkon. Diagnose: Balkonabdichtung defekt, Gefälle fehlt oder Dehnfuge gerissen. Fachmann: Abdichter / Fliesenleger / Dachdecker. Dringlichkeit: Hoch. Kosten: CHF 500–3000.",
    "tags": ["balkon", "undicht", "abdichtung", "gefälle", "wasser"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Balkon",
    "titel": "Balkongeländer wackelt oder ist locker",
    "inhalt": "Symptom: Geländer am Balkon wackelt beim Anfassen. Diagnose: Befestigung im Beton korrodiert, Geländerfuss verrostet oder Dübel ausgerissen. Fachmann: Schlosser / Schreiner. Dringlichkeit: Sehr hoch (Absturzgefahr). Kosten: CHF 200–1000.",
    "tags": ["balkon", "geländer", "wackelt", "rost", "absturzgefahr"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Balkon",
    "titel": "Balkonboden erneuern – Belag defekt",
    "inhalt": "Symptom: Balkonboden ist gerissen, Fliesen abgeplatzt oder Holz morsch. Diagnose: Witterungsschäden über Jahre – komplette Erneuerung inkl. Abdichtung nötig. Fachmann: Fliesenleger / Abdichter. Dringlichkeit: Mittel. Kosten: CHF 80–200/m².",
    "tags": ["balkon", "boden", "belag", "fliesen", "abdichtung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Balkon",
    "titel": "Balkonüberdachung / Markise montieren",
    "inhalt": "Symptom/Bedarf: Balkon soll mit Markise oder Überdachung gegen Sonne/Regen geschützt werden. Diagnose: Statische Prüfung und korrekte Verankerung in Fassade nötig. Fachmann: Markisenmonteur / Schreiner. Dringlichkeit: Niedrig. Kosten: CHF 500–3000.",
    "tags": ["balkon", "markise", "überdachung", "sonnenschutz", "montage"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Balkon",
    "titel": "Risse am Balkon oder Balkonkante bröckelt",
    "inhalt": "Symptom: Beton bröckelt an der Balkonkante ab, Risse im Bodenbelag oder im Balkonrahmen. Diagnose: Karbonatisierung und Bewehrungskorrosion – Sanierung nötig bevor Bewehrung weiterrostet. Fachmann: Betonbauer / Bausanierer. Dringlichkeit: Hoch. Kosten: CHF 300–2000.",
    "tags": ["balkon", "beton", "risse", "bröckelt", "sanierung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Balkon",
    "titel": "Balkon mit Holzboden ausstatten",
    "inhalt": "Symptom/Bedarf: Balkon soll mit Holzdielen (WPC oder Massivholz) belegt werden. Diagnose: Unterkonstruktion und Entwässerung wichtig, WPC wartungsarm. Fachmann: Schreiner / Verleger. Dringlichkeit: Niedrig. Kosten: CHF 60–150/m².",
    "tags": ["balkon", "holzboden", "wpc", "dielen", "schreiner"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Balkon",
    "titel": "Balkon-Sichtschutz montieren",
    "inhalt": "Symptom/Bedarf: Sichtschutz am Balkon gewünscht – gegen Einblick der Nachbarn. Diagnose: Bambus-Matten, PVC-Streifen oder Holz-Lattenzaun je nach Ästhetik und Genehmigung. Fachmann: Schreiner / Monteur. Dringlichkeit: Niedrig. Kosten: CHF 100–600.",
    "tags": ["balkon", "sichtschutz", "privatsphäre", "schreiner", "montage"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Balkon",
    "titel": "Balkontür klemmt oder schliesst nicht dicht",
    "inhalt": "Symptom: Balkontüre geht schwer auf/zu, zieht Zugluft oder lässt Regen eindringen. Diagnose: Türe verzogen, Dichtung defekt oder Beschlag falsch eingestellt. Fachmann: Schreiner / Fensterbauer. Dringlichkeit: Mittel. Kosten: CHF 80–350.",
    "tags": ["balkontür", "klemmt", "dichtung", "zugluft", "schreiner"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # TERRASSE (8 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Gebäude", "unterkategorie": "Terrasse",
    "titel": "Terrasse: Bodenplatten abgesackt oder wackelig",
    "inhalt": "Symptom: Terrassenplatten haben sich abgesenkt, stehen uneben oder wackeln beim Betreten. Diagnose: Unterbau ausgeschwemmt, Splittbett verrutscht oder Frost hat Boden gehoben. Fachmann: Gärtner / Plattenleger / Maurer. Dringlichkeit: Mittel (Stolpergefahr). Kosten: CHF 50–120/m².",
    "tags": ["terrasse", "platten", "abgesackt", "wackelig", "plattenleger"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Terrasse",
    "titel": "Terrasse neu anlegen – Beratung und Planung",
    "inhalt": "Symptom/Bedarf: Neue Terrasse soll angelegt werden – Naturstein, Beton oder Holz. Diagnose: Planung mit Gefälle (2%), Entwässerung und Unterbau wichtig. Fachmann: Gärtner / Plattenleger. Dringlichkeit: Niedrig. Kosten: CHF 80–200/m².",
    "tags": ["terrasse", "neu anlegen", "naturstein", "plattenleger", "garten"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Terrasse",
    "titel": "Terrassenüberdachung / Pergola planen",
    "inhalt": "Symptom/Bedarf: Terrassenüberdachung oder Pergola für Regen- und Sonnenschutz gewünscht. Diagnose: Baubewilligung prüfen, Statik bei Schneelasten beachten. Fachmann: Schreiner / Metallbauer. Dringlichkeit: Niedrig. Kosten: CHF 2000–15000.",
    "tags": ["terrasse", "überdachung", "pergola", "schreiner", "baugesuch"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Terrasse",
    "titel": "Terrassenholz vergraut und muss erneuert werden",
    "inhalt": "Symptom: Holzterrasse ist grau, rissig oder splittert – Schutzschicht völlig weg. Diagnose: Schleifen, Grundierung und neues Terrassenöl nötig. Fachmann: Schreiner / Maler. Dringlichkeit: Mittel. Kosten: CHF 25–60/m² (Aufarbeitung).",
    "tags": ["terrasse", "holz", "vergraut", "ölen", "schreiner"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Terrasse",
    "titel": "Terrassengeländer defekt oder fehlt",
    "inhalt": "Symptom: Terrassengeländer ist verrostet, lose oder fehlt. Diagnose: Absturzsicherung gesetzlich vorgeschrieben ab 1m Absturzhöhe (SN EN 14122). Fachmann: Schlosser / Schreiner. Dringlichkeit: Hoch (Sicherheit). Kosten: CHF 300–1500.",
    "tags": ["terrasse", "geländer", "absturzsicherung", "schlosser", "sicherheit"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Terrasse",
    "titel": "Moos und Algen auf Terrassenplatten",
    "inhalt": "Symptom: Terrassenplatten sind grün oder schwarz durch Moos/Algen, rutschig. Diagnose: Biologische Verschmutzung durch Schatten und Feuchtigkeit. Hochdruckreiniger + Spezialreiniger. Fachmann: Reinigungsservice / Gärtner. Dringlichkeit: Mittel (Rutschgefahr). Kosten: CHF 3–10/m².",
    "tags": ["terrasse", "moos", "algen", "reinigung", "rutschig"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Terrasse",
    "titel": "Terrassenmöbel aufarbeiten oder schützen",
    "inhalt": "Symptom: Gartenmöbel verwittert, Metall rostet oder Kunststoff vergilbt. Diagnose: Reinigen, schleifen, ölen (Holz) oder lackieren (Metall). Fachmann: Maler / Handwerker. Dringlichkeit: Niedrig. Kosten: CHF 50–300.",
    "tags": ["terrasse", "gartenmöbel", "rost", "holz", "aufarbeiten"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Gebäude", "unterkategorie": "Terrasse",
    "titel": "Terrassenabdichtung undicht",
    "inhalt": "Symptom: Unter der Terrasse (Tiefgarage/Kellerdecke) erscheinen Wasserflecken. Diagnose: Terrassenabdichtung gealtert, Dehnfugen gerissen oder Bauteilanschlüsse undicht. Fachmann: Abdichter / Bauingenieur. Dringlichkeit: Hoch. Kosten: CHF 100–300/m².",
    "tags": ["terrasse", "abdichtung", "tiefgarage", "dehnfuge", "wasser"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # REINIGUNG (8 Einträge) – neue Kategorie
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Reinigung", "unterkategorie": "Haushalt",
    "titel": "Wohnungsreinigung – regelmässige Unterhaltsreinigung",
    "inhalt": "Symptom/Bedarf: Wohnung soll regelmässig professionell gereinigt werden. Diagnose: Stundenweise oder Pauschalreinigung. Fachmann: Reinigungsunternehmen / Putzhilfe. Dringlichkeit: Niedrig. Kosten: CHF 40–60/h.",
    "tags": ["reinigung", "wohnung", "putzhilfe", "unterhaltsreinigung", "haushalt"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Reinigung", "unterkategorie": "Haushalt",
    "titel": "Endreinigung nach Auszug",
    "inhalt": "Symptom/Bedarf: Wohnung muss für die Rückgabe perfekt gereinigt werden. Diagnose: Schweizer Mietrecht: besenrein und in sauberem Zustand – professionell für Depot. Fachmann: Reinigungsunternehmen. Dringlichkeit: Hoch (Termin). Kosten: CHF 200–800.",
    "tags": ["reinigung", "auszug", "endreinigung", "übergabe", "depot"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Reinigung", "unterkategorie": "Haushalt",
    "titel": "Teppich reinigen – Flecken oder Geruch",
    "inhalt": "Symptom: Teppich hat Flecken, Tiergeruch oder ist stark verschmutzt. Diagnose: Professionelle Teppichreinigung mit Heissdampf oder Trockenreinigung. Fachmann: Teppichreinigung / Reinigungsunternehmen. Dringlichkeit: Niedrig. Kosten: CHF 5–15/m².",
    "tags": ["teppich", "reinigung", "flecken", "geruch", "reinigungsunternehmen"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Reinigung", "unterkategorie": "Haushalt",
    "titel": "Polstercouch oder Matratze reinigen",
    "inhalt": "Symptom: Sofa oder Matratze ist fleckig, riecht oder hat Milben. Diagnose: Polsterreinigung mit Spezialgerät, Milben durch UV-Heissdampf bekämpfen. Fachmann: Polsterreinigung / Textilreinigung. Dringlichkeit: Mittel. Kosten: CHF 80–300.",
    "tags": ["polster", "sofa", "matratze", "reinigung", "milben"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Reinigung", "unterkategorie": "Gebäude",
    "titel": "Fassadenreinigung – Algen oder Graffiti",
    "inhalt": "Symptom: Hausfassade hat grüne Algenflecken, Graffiti oder ist stark verschmutzt. Diagnose: Niederdruckreinigung mit Bio-Algenentferner oder Graffiti-Entferner. Fachmann: Fassadenreinigung / Maler. Dringlichkeit: Mittel. Kosten: CHF 8–25/m².",
    "tags": ["fassade", "reinigung", "algen", "graffiti", "hochdruckreiniger"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Reinigung", "unterkategorie": "Gebäude",
    "titel": "Fenster putzen – professionell",
    "inhalt": "Symptom/Bedarf: Fenster sind stark verschmutzt, schwer zugänglich oder es sind viele. Diagnose: Professionelle Fensterreinigung mit Teleskopstange oder Hubsteiger. Fachmann: Glasreinigung / Gebäudereinigung. Dringlichkeit: Niedrig. Kosten: CHF 5–15/Fenster.",
    "tags": ["fenster", "reinigung", "glasreinigung", "professionell", "fensterputzen"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Reinigung", "unterkategorie": "Gebäude",
    "titel": "Keller oder Estrich ausmisten / Entrümpeln",
    "inhalt": "Symptom/Bedarf: Keller, Estrich oder Garage ist vollgestopft und soll geleert werden. Diagnose: Entrümpelung mit Entsorgung und Deponiergebühren. Fachmann: Entrümpelungsunternehmen / Umzugsfirma. Dringlichkeit: Niedrig. Kosten: CHF 200–800.",
    "tags": ["keller", "estrich", "entrümpeln", "entsorgung", "haushaltsauflösung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Reinigung", "unterkategorie": "Haushalt",
    "titel": "Küche Tiefenreinigung – Fettablagerungen",
    "inhalt": "Symptom: Küche hat hartnäckige Fettablagerungen auf Herd, Haube oder Fliesen. Diagnose: Tiefenreinigung mit Entfetter und Dampfreiniger nötig. Fachmann: Reinigungsunternehmen. Dringlichkeit: Niedrig. Kosten: CHF 80–250.",
    "tags": ["küche", "tiefenreinigung", "fett", "dampfreiniger", "reinigung"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # SCHLÜSSELDIENST / SICHERHEIT (6 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Schlüsseldienst", "unterkategorie": "Notfall",
    "titel": "Ausgesperrt – Schlüssel vergessen oder verloren",
    "inhalt": "Symptom: Tür ist verschlossen, Schlüssel nicht vorhanden. Diagnose: Schlüsseldienst öffnet Tür ohne Beschädigung (Pick, Bohrung nur wenn nötig). Fachmann: Schlüsseldienst. Dringlichkeit: Sofort. Kosten: CHF 80–300 (Notfalltarif).",
    "tags": ["ausgesperrt", "schlüssel", "schlüsseldienst", "tür", "notfall"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Schlüsseldienst", "unterkategorie": "Sicherheit",
    "titel": "Schloss austauschen nach Einbruch oder Schlüsselverlust",
    "inhalt": "Symptom: Einbruch oder Schlüssel verloren – Schloss nicht mehr sicher. Diagnose: Schloss sofort tauschen, hochwertige Sicherheitsschlösser (Europrofil, Sicherheitsbeschlag) empfohlen. Fachmann: Schlüsseldienst / Schreiner. Dringlichkeit: Hoch. Kosten: CHF 150–500.",
    "tags": ["schloss", "einbruch", "schlüsselverlust", "sicherheit", "schlüsseldienst"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Schlüsseldienst", "unterkategorie": "Sicherheit",
    "titel": "Einbruchschutz – Tür oder Fenster sichern",
    "inhalt": "Symptom/Bedarf: Wohnung soll einbruchsicher gemacht werden. Diagnose: Mehrfachverriegelung, Querriegelschloss, Pilzkopfzapfen an Fenstern. Fachmann: Schlüsseldienst / Schreiner. Dringlichkeit: Mittel. Kosten: CHF 200–1000.",
    "tags": ["einbruchschutz", "sicherheit", "schloss", "fenster", "schlüsseldienst"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Schlüsseldienst", "unterkategorie": "Sicherheit",
    "titel": "Schlüssel nachmachen lassen",
    "inhalt": "Symptom/Bedarf: Zusätzliche Schlüssel für Wohnung, Briefkasten oder Keller nötig. Diagnose: Einfache Schlüssel beim Schlüsseldienst, Sicherheitsschlüssel nur mit Eigentümerkarte. Fachmann: Schlüsseldienst. Dringlichkeit: Niedrig. Kosten: CHF 10–60.",
    "tags": ["schlüssel", "nachmachen", "kopie", "briefkasten", "schlüsseldienst"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Schlüsseldienst", "unterkategorie": "Sicherheit",
    "titel": "Tresor öffnen – Kombination vergessen",
    "inhalt": "Symptom: Tresor-Code vergessen oder Schlüssel verloren. Diagnose: Spezialist öffnet Tresor, ggf. Bohrung nötig. Nachweis der Eigentümerschaft erforderlich. Fachmann: Schlosser / Tresorspezialist. Dringlichkeit: Mittel. Kosten: CHF 150–600.",
    "tags": ["tresor", "öffnen", "code", "schlosser", "schlüsseldienst"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Schlüsseldienst", "unterkategorie": "Sicherheit",
    "titel": "Alarmanlage installieren oder reparieren",
    "inhalt": "Symptom/Bedarf: Einbruchmeldeanlage gewünscht oder defekt. Diagnose: Planung mit Fachmann, Anbindung an Notrufzentrale empfohlen. Fachmann: Sicherheitstechniker / Elektriker. Dringlichkeit: Mittel. Kosten: CHF 500–3000.",
    "tags": ["alarmanlage", "einbruchmeldung", "sicherheit", "elektriker", "sicherheitstechnik"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # FENSTER (8 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Fenster", "unterkategorie": "Probleme",
    "titel": "Fenster beschlägt innen – Kondenswasser",
    "inhalt": "Symptom: Feuchtigkeit oder Eiskristalle bilden sich auf der Innenscheibe. Diagnose: Raumluftfeuchte zu hoch (>50% rel.F.), Fenster zu wenig isolierend oder zu wenig lüften. Fachmann: Fensterservice / Energieberater. Dringlichkeit: Mittel. Kosten: CHF 80–300.",
    "tags": ["fenster", "kondenswasser", "beschlag", "feuchtigkeit", "isolation"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fenster", "unterkategorie": "Probleme",
    "titel": "Fenster beschlägt zwischen den Scheiben",
    "inhalt": "Symptom: Nebel oder Feuchtigkeit erscheint zwischen den Glasscheiben (Isolierverglasung). Diagnose: Randverbund der Isolierglaseinheit defekt, Edelgasfüllung (Argon) entwichen. Scheibentausch nötig. Fachmann: Glaserei / Fensterbauer. Dringlichkeit: Mittel. Kosten: CHF 150–500/Scheibe.",
    "tags": ["fenster", "scheibenbeschlag", "isolierglas", "argon", "glaserei"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fenster", "unterkategorie": "Probleme",
    "titel": "Fenster klemmt oder lässt sich nicht öffnen",
    "inhalt": "Symptom: Fenster klemmt beim Öffnen/Schliessen, geht schwer oder lässt sich gar nicht bewegen. Diagnose: Beschlag falsch eingestellt, Rahmen verzogen oder Scharnier defekt. Fachmann: Schreiner / Fensterservice. Dringlichkeit: Mittel. Kosten: CHF 50–200.",
    "tags": ["fenster", "klemmt", "beschlag", "scharnier", "schreiner"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fenster", "unterkategorie": "Probleme",
    "titel": "Fensterdichtung defekt – zieht Zugluft",
    "inhalt": "Symptom: Kalter Zug spürbar, Wind pfeift ums Fenster oder Regen dringt ein. Diagnose: Dichtungsgummi ausgehärtet/gerissen oder Fenster falsch eingestellt. Fachmann: Schreiner / Fensterservice. Dringlichkeit: Mittel. Kosten: CHF 30–150/Fenster.",
    "tags": ["fensterdichtung", "zugluft", "kalt", "dichtung", "schreiner"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fenster", "unterkategorie": "Probleme",
    "titel": "Fenster ersetzen – Altbau-Sanierung",
    "inhalt": "Symptom/Bedarf: Alte Einfachverglasung oder undichte Verbundfenster sollen durch moderne Fenster ersetzt werden. Diagnose: 3-fach Isolierverglasung spart bis 20% Energie. Fachmann: Fensterbauer / Schreiner. Dringlichkeit: Mittel. Kosten: CHF 500–2000/Fenster.",
    "tags": ["fenster", "ersetzen", "sanierung", "isolierverglasung", "energiesparen"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fenster", "unterkategorie": "Probleme",
    "titel": "Rolllade klemmt oder lässt sich nicht hochziehen",
    "inhalt": "Symptom: Rolllade hängt fest, lässt sich nicht hochziehen oder ist aus der Führung. Diagnose: Gurt gerissen, Motor defekt (elektr. Rolllade) oder Lager klemmt. Fachmann: Rollladenmonteur / Schreiner. Dringlichkeit: Mittel. Kosten: CHF 80–400.",
    "tags": ["rolllade", "storen", "klemmt", "gurt", "motor"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fenster", "unterkategorie": "Probleme",
    "titel": "Glasscheibe gebrochen – Notfall",
    "inhalt": "Symptom: Fensterscheibe ist gebrochen oder durch Einbruchsversuch beschädigt. Diagnose: Sofortabdichtung mit Folie oder Spanplatte, danach Scheibentausch. Fachmann: Glaserei (Notdienst). Dringlichkeit: Sofort. Kosten: CHF 100–800.",
    "tags": ["glasscheibe", "gebrochen", "glaserei", "notfall", "fenster"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Fenster", "unterkategorie": "Probleme",
    "titel": "Innenläden oder Jalousien reparieren",
    "inhalt": "Symptom: Jalousielamellen verbogen, Schnur gerissen oder Innenläden klemmen. Diagnose: Mechanismus defekt oder Lamelle muss ersetzt werden. Fachmann: Sonnenschutzservice / Schreiner. Dringlichkeit: Niedrig. Kosten: CHF 50–250.",
    "tags": ["jalousien", "innenladen", "lamellen", "schnur", "sonnenschutz"], "quelle": "BOB Wissensdatenbank"
  },

  # ─────────────────────────────────────────────────────
  # KELLER (8 Einträge)
  # ─────────────────────────────────────────────────────
  {
    "kategorie": "Keller", "unterkategorie": "Probleme",
    "titel": "Keller überschwemmt – Wasser läuft ein",
    "inhalt": "Symptom: Bei Starkregen oder Schneeschmelze steht Wasser im Keller. Diagnose: Drainage verstopft, Abdichtung defekt oder Rückstausicherung fehlt. Fachmann: Sanitär / Bausanierer. Dringlichkeit: Hoch. Kosten: CHF 500–5000.",
    "tags": ["keller", "wasser", "überschwemmt", "drainage", "rückstau"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Keller", "unterkategorie": "Probleme",
    "titel": "Keller riecht muffig oder schimmelig",
    "inhalt": "Symptom: Kellerraum riecht nach Schimmel, Moder oder feuchtem Mauerwerk. Diagnose: Kapillarfeuchte, Kondenswasser oder Leckage – Feuchtigkeitsmessung und Ursachenanalyse. Fachmann: Bausanierer / Maler. Dringlichkeit: Mittel. Kosten: CHF 200–2000.",
    "tags": ["keller", "schimmel", "muffig", "feuchtigkeit", "bausanierung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Keller", "unterkategorie": "Probleme",
    "titel": "Kellertreppe: Stufe locker oder Geländer fehlt",
    "inhalt": "Symptom: Kellertreppenbelag ablösend, Stufe wackelt oder Handlauf fehlt. Diagnose: Sturzgefahr – Befestigung und Belag erneuern, Handlauf nachsetzen. Fachmann: Schreiner / Maurer. Dringlichkeit: Hoch (Sturzgefahr). Kosten: CHF 100–500.",
    "tags": ["keller", "treppe", "stufe", "geländer", "sturzgefahr"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Keller", "unterkategorie": "Probleme",
    "titel": "Kellerwand hat Salzausblühungen",
    "inhalt": "Symptom: Weisse oder grau-braune Flecken auf der Kellerwand, Putz bröckelt. Diagnose: Feuchtesalze aus dem Mauerwerk treten aus – Zeichen für Kapillarfeuchte. Fachmann: Bausanierer / Maler. Dringlichkeit: Mittel. Kosten: CHF 50–120/m².",
    "tags": ["keller", "salzausblühungen", "feuchtigkeit", "mauerwerk", "bausanierung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Keller", "unterkategorie": "Probleme",
    "titel": "Kellerfenster klemmt oder ist undicht",
    "inhalt": "Symptom: Kellerlüftungsfenster öffnet nicht, ist undicht oder hat kein Netz gegen Insekten. Diagnose: Beschlag defekt, Rahmen gequollen oder Dichtung fehlt. Fachmann: Schreiner / Glaserei. Dringlichkeit: Niedrig–Mittel. Kosten: CHF 50–250.",
    "tags": ["keller", "kellerfenster", "klemmt", "undicht", "insekten"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Keller", "unterkategorie": "Probleme",
    "titel": "Keller-Heizraum: Öltank prüfen oder ersetzen",
    "inhalt": "Symptom: Öltank rostet, undicht oder Wechsel auf Gas/WP geplant. Diagnose: Öltank älter als 30 Jahre: Reinigung und Leckagentest empfohlen. Fachmann: Heizungsmonteur / Entsorgung. Dringlichkeit: Mittel. Kosten: CHF 500–3000.",
    "tags": ["öltank", "heizraum", "keller", "heizung", "entsorgung"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Keller", "unterkategorie": "Probleme",
    "titel": "Keller ausbauen – Nutzungsraum schaffen",
    "inhalt": "Symptom/Bedarf: Keller soll zu Hobbyraum, Büro oder Lagerraum ausgebaut werden. Diagnose: Baubewilligung prüfen, Feuchtigkeitsschutz und Belüftung essentiell. Fachmann: Bausanierer / Schreiner / Elektriker. Dringlichkeit: Niedrig. Kosten: CHF 5000–30000.",
    "tags": ["keller", "ausbau", "hobbyraum", "bausanierung", "renovation"], "quelle": "BOB Wissensdatenbank"
  },
  {
    "kategorie": "Keller", "unterkategorie": "Probleme",
    "titel": "Kellertür klemmt oder Schloss defekt",
    "inhalt": "Symptom: Kellertür öffnet schwer, Schloss hakt oder Tür lässt sich nicht abschliessen. Diagnose: Holztür gequollen, Metallrahmen korrodiert oder Schloss verschlissen. Fachmann: Schlosser / Schreiner. Dringlichkeit: Mittel. Kosten: CHF 80–300.",
    "tags": ["keller", "tür", "schloss", "klemmt", "schlosser"], "quelle": "BOB Wissensdatenbank"
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
    from collections import Counter
    cats = Counter(e["kategorie"] for e in ENTRIES)
    print(f"Inseriere {len(ENTRIES)} Einträge:")
    for k, v in sorted(cats.items()):
        print(f"  {k}: {v}")
    print()
    total, errors = insert_batch(ENTRIES)
    print(f"\nErgebnis: {total} eingefügt, {errors} Fehler")
    if errors:
        sys.exit(1)
