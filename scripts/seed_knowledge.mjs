// scripts/seed_knowledge.mjs — Task 8: expand bob_knowledge to 500+ entries.
//   node scripts/seed_knowledge.mjs
// Curated Swiss-Handwerk entries (Materialkunde, CHF prices, CH manufacturers,
// Grosshändler). Idempotent on titel: existing titles are skipped.

import { readFileSync } from 'node:fs';
let { SUPABASE_URL, SUPABASE_KEY } = process.env;
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m?.[1] === 'SUPABASE_URL' && !SUPABASE_URL) SUPABASE_URL = m[2].trim();
    if (m?.[1] === 'SUPABASE_KEY' && !SUPABASE_KEY) SUPABASE_KEY = m[2].trim();
  }
} catch {}
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const Q = 'BOB Wissensdatenbank 2026';
const e = (kategorie, unterkategorie, titel, inhalt, tags) => ({ kategorie, unterkategorie, titel, inhalt, tags, quelle: Q });

const E = [
  // ─── SANITÄR ───
  e('Sanitär','Material','Geberit Spülkasten UP320','Der Geberit UP320 Unterputz-Spülkasten ist Schweizer Standard. Material ca. CHF 180–240, Betätigungsplatte (Sigma) CHF 60–250. Ersatz Füllventil ca. CHF 45. Bezug: Sanitär Heinze, Tobler (Walter Meier), Richner.',['geberit','spülkasten','up320','wc']),
  e('Sanitär','Preise','Wasserhahn-Wechsel Küche','Einhebelmischer Küche ersetzen: Material CHF 90–350 (z.B. KWC, Franke, Hansgrohe), Arbeit ca. 1–1.5 h à CHF 90–120. Total typ. CHF 200–550.',['armatur','küche','mischer','preis']),
  e('Sanitär','Diagnose','Wasserhahn tropft','Tropfender Einhebelmischer: meist defekte Kartusche (CHF 25–60) oder Dichtung. Bei Zweigriff: Ventiloberteil/Dichtung tauschen. Reparatur ca. 0.5–1 h.',['tropft','kartusche','dichtung','leck']),
  e('Sanitär','Diagnose','WC läuft nach','Dauerlauf WC: Füll- oder Spülventil im Spülkasten defekt/verkalkt. Geberit Ersatzteile günstig (CHF 20–50). Spart bis 200 l/Tag.',['wc','spülkasten','dauerlauf','ventil']),
  e('Sanitär','Diagnose','Abfluss verstopft','Verstopfung: erst Pümpel/Saugglocke, dann Spirale. Chemie sparsam. Hartnäckig: Rohrreinigung CHF 150–350. Geruch = Siphon trocken/defekt.',['abfluss','verstopft','spirale','siphon']),
  e('Sanitär','Material','Silikon Sanitär','Sanitärsilikon (essigvernetzend, fungizid) für Nassbereich. Kartusche CHF 8–15 (z.B. Sika, Soudal). Acryl NICHT im Spritzwasserbereich. Fugen alle 5–10 J. erneuern.',['silikon','fuge','bad','abdichtung']),
  e('Sanitär','Material','Rohrmaterial Wasser','Trinkwasser CH: Pressfitting-Systeme (Optipress/Geberit Mapress) Edelstahl/Rotguss, oder Kunststoff-Verbundrohr (Geberit Mepla). Bezug: Tobler, Sanitär Heinze.',['rohr','pressfitting','mapress','mepla']),
  e('Sanitär','Preise','Lavabo / Waschtisch ersetzen','Waschtisch inkl. Armatur: Material CHF 150–600, Montage 1.5–2 h. Total CHF 350–900. Aufsatzbecken Trend, Unterschrank separat.',['lavabo','waschtisch','montage','preis']),
  e('Sanitär','Diagnose','Boiler kein Warmwasser','Elektroboiler: Heizstab/Thermostat defekt oder verkalkt. Entkalken CHF 150–250, Heizstab CHF 80–150 + Arbeit. Lebensdauer 12–18 J.',['boiler','warmwasser','heizstab','entkalken']),
  e('Sanitär','Material','Eckventil / Anschlussschlauch','Eckventil CHF 8–20, Panzerschlauch CHF 6–15. Bei Wechsel immer beide ersetzen. Standard 3/8".',['eckventil','schlauch','anschluss']),
  e('Sanitär','Grosshändler','Sanitär-Bezugsquellen CH','Grosshändler SHK Schweiz: Tobler (Walter Meier), Sanitär Heinze, Richner, Debrunner Koenig, HG Commerciale. Endkunden via Installateur, oft bessere Konditionen.',['grosshändler','tobler','heinze','richner']),
  e('Sanitär','Diagnose','Dusche schwacher Druck','Schwacher Duschdruck: Brausekopf/Strahlregler verkalkt (in Essig legen), oder Eckventil zu. Druckminderer prüfen. Selten Leitungsproblem.',['dusche','druck','verkalkt','brause']),

  // ─── HEIZUNG ───
  e('Heizung','Diagnose','Heizung wird nicht warm','Kalter Heizkörper: entlüften (oben Luft), Thermostatkopf klemmt, oder hydraulischer Abgleich nötig. Pumpe/Druck (1–1.5 bar) prüfen.',['heizung','heizkörper','entlüften','kalt']),
  e('Heizung','Diagnose','Heizung entlüften','Gluckern/oben kalt = Luft. Mit Entlüftungsschlüssel oben am Heizkörper, bis Wasser kommt. Danach Anlagendruck kontrollieren/nachfüllen.',['entlüften','luft','gluckern','druck']),
  e('Heizung','Preise','Wärmepumpe Einfamilienhaus','Luft/Wasser-WP EFH: CHF 30’000–45’000 inkl. Installation. Sole/Wasser (Erdsonde) CHF 40’000–60’000. Förderung Kanton + Gebäudeprogramm prüfen.',['wärmepumpe','efh','preis','förderung']),
  e('Heizung','Material','Heizkörper-Thermostat','Thermostatkopf CHF 15–45, programmierbar/smart CHF 40–90 (z.B. Danfoss, Honeywell). Spart 5–10% Heizenergie.',['thermostat','heizkörper','smart','danfoss']),
  e('Heizung','Wartung','Heizung Service Intervall','Gas/Öl-Heizung: jährlicher Service CHF 200–350 (inkl. Brennerreinigung, Abgasmessung). Wärmepumpe: alle 2 J. CHF 200–300.',['service','wartung','intervall','brenner']),
  e('Heizung','Diagnose','Brenner Störung Öl/Gas','Störlampe: oft Reset möglich (1x). Wiederholt = Fachmann. Ursachen: Düse, Zündung, Druckwächter, Kondensat-Ablauf verstopft.',['brenner','störung','reset','öl','gas']),
  e('Heizung','Material','Fussbodenheizung','FBH Aufbau: Verbundrohr 16–17 mm, Verteiler mit Durchflussmessern. Vorlauf 30–35°C ideal für WP. Einzelraumregelung.',['fussbodenheizung','fbh','verteiler','wärmepumpe']),
  e('Heizung','Preise','Heizkörper ersetzen','Kompaktheizkörper Material CHF 120–400 je Grösse, Montage 1.5–3 h. Total CHF 350–900 pro Stück. Marken: Arbonia, Zehnder.',['heizkörper','ersetzen','arbonia','zehnder']),
  e('Heizung','Diagnose','Heizung verliert Druck','Druckabfall <1 bar: Wasser nachfüllen. Häufig = Leck oder defektes Ausdehnungsgefäss (CHF 150–300). MAG-Vordruck prüfen.',['druck','nachfüllen','ausdehnungsgefäss','mag']),
  e('Heizung','Solar','Solarthermie Warmwasser','Solarthermie WW EFH: 4–6 m² Kollektoren + 400–500 l Speicher, CHF 12’000–18’000. Deckt 50–65% WW-Bedarf.',['solarthermie','warmwasser','kollektor','speicher']),
  e('Heizung','Kältetechnik','Wärmepumpe Geräusch','WP zu laut: Aufstellort/Entkopplung prüfen, Nachtabsenkung, Schallhaube. Grenzwerte Lärmschutzverordnung beachten (Nachbarn).',['wärmepumpe','lärm','schall','nachbar']),

  // ─── ELEKTRO ───
  e('Elektro','Sicherheit','Sicherung fliegt raus','FI/LS löst aus: Gerät defekt oder Überlast. Einzeln zuschalten zum Eingrenzen. FI-Test-Taste monatlich. Wiederholt = Elektriker (NIN-Pflicht).',['sicherung','fi','ls','überlast']),
  e('Elektro','Preise','Steckdose montieren','Neue Steckdose (UP): Material CHF 15–40, Arbeit 0.5–1 h. Total CHF 80–180. Nur konzessionierter Elektriker (Anschlussbewilligung).',['steckdose','montage','preis','nin']),
  e('Elektro','Material','Schalter/Steckdosen CH','CH-Standard: Feller EDIZIO/EDIZIOdue, Hager Kallysto. T13-Steckdose Standard, T23 für höhere Last. Bezug: Otto Fischer, Elektro-Material AG.',['feller','steckdose','t13','schalter']),
  e('Elektro','Sicherheit','FI-Schalter Pflicht','RCD/FI 30 mA Pflicht für Steckdosenkreise, Bad, aussen (NIN 2020). Schützt vor Stromschlag. Nachrüsten dringend empfohlen.',['fi','rcd','nin','schutz']),
  e('Elektro','Diagnose','Licht flackert','Flackern: LED inkompatibel mit Dimmer, lose Klemme, oder Trafo defekt. Lose Verbindung = Brandgefahr, Elektriker.',['licht','flackern','dimmer','led']),
  e('Elektro','Smart Home','KNX vs. Funk','KNX = Bus-Standard, robust, EFH CHF 15’000–40’000. Funk (Zigbee/Feller Wiser) günstiger nachrüstbar. Planung früh einbeziehen.',['knx','smarthome','zigbee','wiser']),
  e('Elektro','Preise','E-Auto Ladestation','Wallbox 11 kW: Gerät CHF 800–2000, Installation CHF 800–2500 (Kabelweg). Anmeldung beim Netzbetreiber/EW nötig.',['wallbox','laden','emobilität','preis']),
  e('Elektro','Material','Kabelquerschnitt','Faustregel CH: Licht 1.5 mm², Steckdosen 2.5 mm², Herd 4–6 mm². Absicherung passend (10A/13A/16A). NIN beachten.',['kabel','querschnitt','absicherung','nin']),

  // ─── LÜFTUNG / KLIMA ───
  e('Lüftung','Material','Komfortlüftung KWL','KWL mit WRG (Wärmerückgewinnung 80–90%): EFH CHF 15’000–25’000. Filter (F7/G4) 2x/Jahr wechseln CHF 30–60. Marke: Zehnder, Helios.',['kwl','lüftung','wrg','zehnder']),
  e('Lüftung','Wartung','Lüftungsfilter wechseln','Filterwechsel KWL alle 3–6 Mt. Verschmutzt = weniger Luft, mehr Stromverbrauch. Pollenfilter F7 für Allergiker.',['filter','kwl','wartung','pollen']),
  e('Lüftung','Diagnose','Schimmel im Bad','Schimmel = zu wenig Lüftung/zu viel Feuchte. Stoss-/Querlüften, Ventilator mit Nachlauf, Fugen prüfen. Hartnäckig: Fachmann.',['schimmel','feuchte','lüften','bad']),
  e('Klima','Material','Split-Klimaanlage','Mono-Split 2.5–3.5 kW: Material CHF 1200–2500, Montage CHF 800–1800. Kältemittel R32. F-Gas-zertifizierter Betrieb Pflicht.',['klima','split','r32','fgas']),
  e('Klima','Wartung','Klimaanlage Service','Klima-Service jährlich: Filter/Verdampfer reinigen, Kältemitteldruck, Kondensat. CHF 150–280. Schlechte Wartung = Geruch/Leistungsverlust.',['klima','service','filter','kältemittel']),
  e('Lüftung','Preise','Dunstabzug Ablufthaube','Ablufthaube mit Mauerkasten: Material CHF 300–1500, Montage CHF 300–700. Umluft einfacher (Aktivkohlefilter CHF 30–60).',['dunstabzug','abluft','umluft','küche']),

  // ─── FLIESEN ───
  e('Fliesen','Preise','Bad fliesen','Wand/Boden fliesen: Material CHF 30–120/m² (Feinsteinzeug), Arbeit CHF 90–160/m². Kleinbad (6 m² Wand) total CHF 2500–5000.',['fliesen','bad','preis','feinsteinzeug']),
  e('Fliesen','Material','Fliesenkleber/Fugen','Flexkleber für Feinsteinzeug/FBH (z.B. Mapei, weber). Fuge 2–5 mm, Silikon an Bewegungsfugen. Epoxidfuge für Nassbereich teurer/dichter.',['kleber','fuge','mapei','flex']),
  e('Fliesen','Diagnose','Fliese gesprungen','Riss = Untergrund arbeitet oder Hohllage. Einzelne Fliese ausstemmen/ersetzen. Reservefliesen wichtig (Charge/Farbton).',['fliese','riss','hohllage','ersetzen']),
  e('Fliesen','Material','Abdichtung Dusche','Verbundabdichtung (Dichtschlämme + Dichtband) unter Fliesen Pflicht im Nassbereich. Bodengleiche Dusche: Gefälle 2%.',['abdichtung','dusche','dichtschlämme','bodengleich']),

  // ─── MALER ───
  e('Maler','Preise','Wohnung streichen','Wände weiss streichen: CHF 8–18/m² Wandfläche inkl. Material (2 Anstriche). 3.5-Zi-Whg ca. CHF 2500–4500. Abdecken/Spachteln extra.',['maler','streichen','preis','wand']),
  e('Maler','Material','Innenwandfarbe','Dispersion matt, Deckkraft Klasse 1 (z.B. Caparol, Sikkens). 10 l ≈ 80–120 m²/Anstrich, CHF 40–120. Nassabriebklasse beachten.',['farbe','dispersion','caparol','deckkraft']),
  e('Maler','Diagnose','Risse in der Wand','Haarrisse = Putz/Anstrich, mit Gewebe überspachteln. Setzrisse (treppenförmig) = statisch beobachten, Fachmann.',['riss','wand','spachtel','gewebe']),
  e('Maler','Material','Tapete vs. Anstrich','Vliestapete überstreichbar, robust. Raufaser klassisch günstig. Entfernen aufwändig. Glattvlies modern. Material CHF 5–30/Rolle.',['tapete','vlies','raufaser','anstrich']),

  // ─── SCHREINER / KÜCHE ───
  e('Schreiner','Preise','Küche Kosten','Einbauküche CH: einfach CHF 8000–15’000, mittel CHF 15’000–30’000, gehoben 30’000+. Geräte (V-Zug, Electrolux) separat.',['küche','preis','einbau','vzug']),
  e('Schreiner','Material','Arbeitsplatte Küche','Optionen: Laminat (CHF 80–200/lfm), Massivholz, Stein/Quarz (CHF 300–700/lfm), Keramik. Quarz pflegeleicht, hitzebeständig.',['arbeitsplatte','küche','quarz','laminat']),
  e('Schreiner','Diagnose','Tür klemmt','Holztür klemmt: Scharniere nachstellen oder unten/seitlich nachhobeln. Quellt bei Feuchte. Bänder ölen gegen Quietschen.',['tür','klemmt','scharnier','hobeln']),
  e('Schreiner','Material','Parkett Arten','Massivparkett (schleifbar mehrfach) vs. Mehrschicht/Fertigparkett (CHF 40–120/m²). Versiegelt oder geölt. FBH-geeignet beachten.',['parkett','boden','massiv','fertigparkett']),
  e('Küche','Geräte','Geschirrspüler Fehler','GS spült nicht ab: Sieb reinigen, Sprüharme frei, Klarspüler/Salz füllen. Fehlercode am Display. Marken V-Zug, Bosch.',['geschirrspüler','fehler','sieb','vzug']),

  // ─── DACH / FENSTER / GEBÄUDE ───
  e('Dach','Diagnose','Dach undicht','Wassereintrag: Ziegel verschoben/gebrochen, Anschlüsse/Kamin, verstopfte Rinne. Sofort Fachmann (Folgeschäden). Notabdeckung Plane.',['dach','undicht','ziegel','rinne']),
  e('Dach','Preise','Dachsanierung','Steildach neu eindecken inkl. Unterdach/Dämmung: CHF 250–450/m². EFH-Dach (120 m²) CHF 30’000–55’000. Gerüst extra.',['dach','sanierung','preis','dämmung']),
  e('Fenster','Preise','Fenster ersetzen','Kunststoff-/Holz-Metall-Fenster 3-fach verglast: CHF 700–1400/Stück inkl. Montage. Förderung möglich (U-Wert ≤0.9).',['fenster','ersetzen','3fach','uwert']),
  e('Fenster','Diagnose','Fenster zieht / beschlägt','Zug = Dichtung hart/defekt (CHF 5–15/lfm). Kondensat innen = lüften/Feuchte. Zwischen Scheiben = Glas defekt, Ersatz.',['fenster','dichtung','kondensat','zug']),
  e('Gebäude','Material','Dämmung Fassade','Aussendämmung (WDVS) EPS/Mineralwolle 14–20 cm: CHF 180–280/m². Spart 20–30% Heizenergie. Förderung Gebäudeprogramm.',['dämmung','fassade','wdvs','förderung']),
  e('Gebäude','Diagnose','Feuchter Keller','Feuchter Keller: Kondensation (lüften) vs. aufsteigende Nässe (Abdichtung aussen/Horizontalsperre CHF 5000+). Ursache messen lassen.',['keller','feuchte','abdichtung','nässe']),

  // ─── GARTEN / SOLAR / SMART HOME ───
  e('Garten','Preise','Hecke schneiden','Heckenschnitt: CHF 60–110/h inkl. Entsorgung, oder pro lfm CHF 8–20. Schnittzeit beachten (Vogelschutz 1.3–31.7. zurückhaltend).',['hecke','garten','schnitt','preis']),
  e('Garten','Material','Rasen anlegen','Rollrasen CHF 12–20/m² verlegt, Saat günstiger aber langsamer. Boden vorbereiten, walzen, wässern. Bewässerung optional.',['rasen','rollrasen','saat','garten']),
  e('Solar','Preise','Photovoltaik EFH','PV-Anlage 8–12 kWp EFH: CHF 18’000–28’000. Einmalvergütung (EIV) Pronovo ~CHF 5000–8000. Speicher 10 kWh +CHF 8000–12’000.',['photovoltaik','pv','pronovo','speicher']),
  e('Solar','Diagnose','PV-Ertrag zu tief','Minderertrag: Verschattung, Verschmutzung, Wechselrichter-Fehler, String-Ausfall. Monitoring prüfen, Reinigung CHF 200–500.',['pv','ertrag','wechselrichter','verschattung']),
  e('Smart Home','Material','Smartes Thermostat','Smart-Thermostate (tado, Netatmo): Einzelraum, App, Zeitpläne. Nachrüstbar CHF 60–100/Heizkörper. Spart 10–20%.',['smarthome','thermostat','tado','heizung']),

  // ─── NOTFALL / DIAGNOSE ───
  e('Notfall','Sanitär','Wasserrohrbruch sofort','Rohrbruch: Haupthahn ZU (meist Keller/Zähler), Strom in nassen Räumen aus, Wasser aufnehmen, Notdienst. Versicherung (Gebäude/Hausrat) melden.',['rohrbruch','notfall','haupthahn','wasser']),
  e('Notfall','Elektro','Stromausfall Wohnung','Nur eigene Wohnung dunkel: FI/Sicherung prüfen/zuschalten. Ganzes Haus/Quartier = EW/Netzbetreiber. Brandgeruch = Feuerwehr 118.',['stromausfall','fi','notfall','ew']),
  e('Notfall','Heizung','Heizung Ausfall Winter','Heizungsausfall: Reset 1x, Druck/Brennstoff prüfen, Störung notieren. Notdienst SHK. Frostschutz: Räume >5°C, Leitungen.',['heizung','ausfall','notdienst','frost']),
  e('Notfall','Sanitär','Verstopfung Notfall','WC/Abfluss komplett dicht: kein Chemie-Cocktail. Pümpel, dann Notdienst Kanalreinigung CHF 200–400 (Nacht/WE teurer).',['verstopfung','notfall','kanal','pümpel']),
  e('Diagnose','Allgemein','Wasserschaden Decke','Feuchter Fleck Decke: Quelle drüber (Leitung/Bad/Dach). Foto + Datum, austrocknen (Bautrockner), Versicherung. Schimmelgefahr.',['wasserschaden','decke','versicherung','schimmel']),
  e('Diagnose','Allgemein','Geruch Abwasser','Kanalgeruch: trockener Siphon (Wasser nachgiessen), defekte Rückstausicherung, oder Entlüftung verstopft. Bodenablauf prüfen.',['geruch','abwasser','siphon','kanal']),
  e('Diagnose','Allgemein','Strom-/Wasserzähler ablesen','Zählerstand für Abrechnung/Schadensnachweis fotografieren. Hauptabsperrung/Hauptschalter Lage kennen — wichtig im Notfall.',['zähler','ablesen','hauptschalter','notfall']),

  // ─── MATERIALKUNDE / GROSSHÄNDLER ───
  e('Gewerke','Grosshändler','Grosshändler Übersicht CH','SHK: Tobler/Walter Meier, Sanitär Heinze, Richner. Elektro: Otto Fischer, Elektro-Material AG. Bau/Allg.: HG Commerciale, Debrunner, Hagebau CH/bauhaus.',['grosshändler','tobler','ottofischer','hagebau']),
  e('Gewerke','Hersteller','Schweizer Hersteller','CH-Marken: V-Zug (Geräte), Geberit (Sanitär), Laufen/Keramik Laufen, KWC/Franke (Armaturen), Zehnder (Heizkörper/Lüftung), Arbonia, Hilti (Befestigung).',['hersteller','vzug','geberit','laufen']),
  e('Gewerke','Material','Befestigung/Dübel','Dübelwahl nach Untergrund: Beton (Spreizdübel/Hilti), Backstein (Langdübel), Gipskarton (Hohlraumdübel/Molly). Last beachten.',['dübel','befestigung','hilti','untergrund']),
  e('Gewerke','Preise','Stundenansätze Handwerk CH','Richtwerte CH: Sanitär/Heizung CHF 90–130/h, Elektro CHF 95–130/h, Maler CHF 75–110/h, Schreiner CHF 90–120/h. + Anfahrt/Material/MwSt 8.1%.',['stundenansatz','preis','handwerk','mwst']),
  e('Gewerke','Material','Werkzeug Grundausstattung','Basis: Akkuschrauber, Wasserwaage, Zollstock/Lasermesser, Cutter, Zangen-Set, Bithalter. Marken Bosch, Makita, Hilti, Knipex.',['werkzeug','akkuschrauber','bosch','knipex']),
  e('Gewerke','Diagnose','Wann Fachmann rufen','Selbst: Dichtung, Filter, Entlüften, Sicherung. Fachmann: Gas, fest verdrahteter Strom (NIN), Kältemittel (F-Gas), Statik, Wasserleitung in Wand.',['fachmann','diy','grenze','sicherheit']),

  // ─── BATCH 2 ───
  e('Sanitär','Material','Duschwanne / Duschrinne','Acryl-Duschwanne CHF 150–400, Mineralguss flach CHF 300–800. Bodengleich mit Duschrinne (z.B. Geberit CleanLine) CHF 250–600. Gefälle/Abdichtung beachten.',['duschwanne','duschrinne','bodengleich','geberit']),
  e('Sanitär','Material','WC-Typen','Wand-WC (spülrandlos, leicht zu reinigen) + UP-Element CHF 400–900. Stand-WC günstiger CHF 200–500. Dusch-WC (Geberit AquaClean) CHF 1500–4500.',['wc','spülrandlos','duschwc','aquaclean']),
  e('Sanitär','Diagnose','Spülkasten läuft über','Überlauf in WC: Schwimmer/Füllventil falsch eingestellt oder defekt. Wasserstand justieren, Ventil entkalken/ersetzen (CHF 20–50).',['spülkasten','überlauf','schwimmer','füllventil']),
  e('Sanitär','Preise','Badsanierung komplett','Komplettes Bad (4–6 m²) sanieren: CHF 18’000–35’000 inkl. Sanitär, Fliesen, Elektro, Maler. Luxus 40’000+. Dauer 3–5 Wochen.',['badsanierung','komplett','preis','umbau']),
  e('Heizung','Material','Pelletheizung','Pelletkessel EFH: CHF 25’000–40’000 inkl. Lager/Austragung. Pellets ca. CHF 8–12/100 kg. CO2-neutral, Lagerraum nötig.',['pellets','heizung','kessel','holz']),
  e('Heizung','Diagnose','Thermostatventil klemmt','Heizkörper bleibt warm/kalt: Ventilstift unter Thermostatkopf klemmt (festgegammelt). Kopf ab, Stift vorsichtig lösen/bewegen, ölen.',['thermostatventil','klemmt','stift','heizkörper']),
  e('Heizung','Wartung','Hydraulischer Abgleich','Abgleich verteilt Wärme gleichmässig, spart 5–15%. Voreinstellung Ventile nach Heizlast. Pflicht für viele Förderungen. CHF 500–1500 EFH.',['abgleich','hydraulisch','förderung','effizienz']),
  e('Elektro','Diagnose','Steckdose ohne Strom','Tote Steckdose: FI/LS geprüft? Andere im Raum tot = Kreis/Klemme. Einzeln = lose Klemme/defekt. Spannungsprüfer. Elektriker bei Unsicherheit.',['steckdose','strom','klemme','fi']),
  e('Elektro','Material','LED-Leuchtmittel','LED E27 günstig CHF 3–12, dimmbar teurer. Lichtfarbe: warmweiss 2700K Wohnen, neutralweiss 4000K Arbeit. Lumen statt Watt vergleichen.',['led','leuchtmittel','lichtfarbe','lumen']),
  e('Elektro','Sicherheit','Mehrfachstecker Überlast','Steckerleisten nicht kaskadieren, keine Heizgeräte. Max. Last beachten (meist 2300–3680 W). Brandgefahr bei Überlast.',['mehrfachstecker','überlast','brand','last']),
  e('Lüftung','Diagnose','Bad-Ventilator zu schwach','Abluftventilator schwach/laut: Lager/Verschmutzung, Rückstauklappe klemmt, Rohr zu lang. Nachlauf + Feuchtesensor sinnvoll.',['ventilator','bad','abluft','feuchte']),
  e('Klima','Diagnose','Klima kühlt nicht','Split kühlt schlecht: Filter verschmutzt, Kältemittel zu wenig (Leck → F-Gas-Fachmann), Aussenteil verschmutzt/verschattet.',['klima','kühlt','kältemittel','filter']),
  e('Fliesen','Preise','Naturstein verlegen','Naturstein (Marmor/Granit/Schiefer): Material CHF 60–250/m², Verlegung aufwändiger CHF 120–200/m². Imprägnieren nötig.',['naturstein','marmor','verlegen','imprägnieren']),
  e('Maler','Preise','Fassade streichen','Fassadenanstrich (Mineral-/Silikonharzfarbe): CHF 25–55/m² inkl. Gerüst-Anteil. Vorbereitung (Algen, Risse) extra. 10–15 J. Haltbarkeit.',['fassade','anstrich','silikonharz','gerüst']),
  e('Maler','Material','Grundierung wann','Grundieren bei saugendem/kreidendem Untergrund, Gips, nach Spachtelung. Tiefgrund festigt, Haftgrund für glatte Flächen.',['grundierung','tiefgrund','haftgrund','untergrund']),
  e('Schreiner','Preise','Einbauschrank Mass','Massgefertigter Einbauschrank: CHF 800–2500/lfm je Ausführung. Schiebetüren, Innenausstattung extra. Günstiger: Pax-System anpassen.',['einbauschrank','mass','schreiner','schiebetür']),
  e('Schreiner','Diagnose','Schublade läuft schwer','Auszug schwer: Schiene verschmutzt/verbogen, Last zu hoch. Reinigen/ölen oder Vollauszug (Blum) nachrüsten CHF 20–50/Paar.',['schublade','auszug','schiene','blum']),
  e('Dach','Material','Dachrinne reinigen','Rinne 1–2x/Jahr reinigen (Laub) gegen Überlauf/Frostschäden. Laubgitter nachrüsten. Reinigung CHF 150–400 je Haus/Zugang.',['dachrinne','reinigen','laub','laubgitter']),
  e('Dach','Diagnose','Schneerückstau / Eis','Eisstau an Traufe = Wärmebrücke/schlechte Dämmung, Schmelzwasser staut unter Ziegel. Dämmung/Lüftung Dach prüfen.',['eis','schnee','traufe','dämmung']),
  e('Fenster','Material','Storen / Sonnenschutz','Lamellenstoren aussen CHF 400–900/Fenster, Rollladen CHF 350–800, Stoffmarkise grösser. Motorisierung + CHF 150–400.',['storen','rollladen','sonnenschutz','markise']),
  e('Gebäude','Preise','Gipser / Verputz','Innenputz/Glätten Wand: CHF 30–60/m². Decke spachteln/glätten CHF 25–50/m². Aussenputz mit Gerüst CHF 60–120/m².',['gipser','verputz','glätten','preis']),
  e('Gebäude','Diagnose','Schimmel Schlafzimmer','Schimmel Aussenwand/Ecke: Wärmebrücke + zu wenig Lüften. Möbel 5 cm abrücken, 2–3x stosslüften, Hygrometer (<60% rF).',['schimmel','wärmebrücke','lüften','hygrometer']),
  e('Garten','Preise','Gartenpflege Abo','Unterhaltsabo: Rasen/Hecke/Beete saisonal CHF 60–100/h oder Pauschale je Fläche. Frühjahr/Herbst Hauptarbeiten.',['gartenpflege','abo','unterhalt','preis']),
  e('Garten','Material','Gartenzaun / Sichtschutz','Doppelstabmatten CHF 40–80/m, Holz CHF 60–150/m, WPC pflegeleicht teurer. Fundament/Pfosten extra. Grenzabstand Gemeinde prüfen.',['zaun','sichtschutz','doppelstab','wpc']),
  e('Solar','Material','PV-Module Typen','Monokristallin (höchster Wirkungsgrad 20–22%), heute Standard. CHF 0.8–1.5/Wp Modul. Wechselrichter (Fronius, SMA) zentral oder Optimierer.',['pvmodul','mono','wechselrichter','fronius']),
  e('Smart Home','Material','Smarte Storensteuerung','Storen automatisieren (Sonne/Zeit/Wetter): KNX oder Funk (Feller Wiser, Shelly). Nachrüst-Aktor CHF 50–120/Storen.',['storen','smarthome','shelly','automatik']),
  e('Notfall','Allgemein','Gasgeruch sofort','Gasgeruch: NICHT Licht/Schalter/Klingel betätigen, keine Flamme. Fenster auf, Haupthahn zu, raus, Gasversorger/Feuerwehr 118 von draussen.',['gas','geruch','notfall','feuerwehr']),
  e('Notfall','Sanitär','Eingefrorene Leitung','Gefrorene Leitung: Haupthahn zu (Bruchgefahr beim Auftauen), vorsichtig mit Föhn/Warmluft auftauen, NIE offene Flamme. Vorbeugen: heizen/dämmen.',['frost','leitung','auftauen','föhn']),
  e('Diagnose','Allgemein','Heizkosten zu hoch','Hohe Heizkosten: Vorlauf zu hoch, kein Abgleich, alte Pumpe, Fenster/Dämmung, Lüftungsverhalten. Hocheffizienzpumpe spart CHF 50–100/J.',['heizkosten','effizienz','pumpe','dämmung']),
  e('Diagnose','Allgemein','Stromverbrauch zu hoch','Stromfresser: alter Boiler/Kühlschrank, Standby, E-Heizung. Messsteckdose nutzen. A-Geräte, Standby-Leisten, PV prüfen.',['strom','verbrauch','standby','boiler']),
  e('Gewerke','Preise','MwSt & Offerten CH','CH MwSt 8.1% (2024+). Offerte = unverbindlich, Kostenvoranschlag darf 10% überschritten werden, Festpreis bindet. Regiearbeit nach Aufwand.',['mwst','offerte','kostenvoranschlag','regie']),
  e('Gewerke','Material','Silikon vs. Acryl','Silikon: elastisch, wasserfest, nicht überstreichbar (Sanitär/Glas). Acryl: überstreichbar, für Anschlussfugen innen (Wand/Decke), nicht im Nassbereich.',['silikon','acryl','fuge','überstreichbar']),
  e('Gewerke','Diagnose','Bohren in Wand sicher','Vor dem Bohren: Leitungsortung (Strom/Wasser) — nie über/neben Steckdosen/Schaltern senkrecht bohren. Ortungsgerät nutzen. Installationszonen beachten.',['bohren','leitung','ortung','sicherheit']),
  e('Auto','Diagnose','Auto springt nicht an','Startet nicht: Batterie (Licht schwach?), Anlasser, Sprit. Überbrücken (rot+/schwarz−). Batterie 4–6 J. Ersatz CHF 120–300 + Einbau.',['auto','batterie','starten','überbrücken']),
  e('Geräte','Diagnose','Waschmaschine pumpt nicht ab','WM ohne Ablauf: Flusensieb reinigen, Ablaufschlauch/Pumpe verstopft, Knick. Sieb 1x/Quartal. Marken V-Zug, Miele, Bosch.',['waschmaschine','abpumpen','flusensieb','pumpe']),
  e('Geräte','Diagnose','Tumbler trocknet schlecht','Wärmepumpentrockner schwach: Flusensieb + Wärmetauscher reinigen, Kondensatbehälter leeren. Spart Energie, kürzere Laufzeit.',['tumbler','trockner','flusensieb','wärmetauscher']),
];

async function existingTitles() {
  const set = new Set();
  let from = 0;
  while (true) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/bob_knowledge?select=titel`, { headers: { ...H, Range: `${from}-${from + 999}` } });
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    rows.forEach((x) => set.add((x.titel || '').trim()));
    if (rows.length < 1000) break;
    from += 1000;
  }
  return set;
}

const existing = await existingTitles();
const fresh = E.filter((x) => !existing.has(x.titel.trim()));
console.log(`Curated: ${E.length} · already present: ${E.length - fresh.length} · inserting: ${fresh.length}`);
if (fresh.length) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/bob_knowledge`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(fresh) });
  console.log(r.ok ? `✓ Inserted ${fresh.length}` : `✗ Insert failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
// Report new total
const cr = await fetch(`${SUPABASE_URL}/rest/v1/bob_knowledge?select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
console.log(`bob_knowledge total now: ${(cr.headers.get('content-range') || '/?').split('/')[1]}`);
