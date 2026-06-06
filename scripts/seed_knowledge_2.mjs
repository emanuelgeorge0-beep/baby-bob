// scripts/seed_knowledge_2.mjs — Task 9: bob_knowledge → 1000+.
// Generates distinct, real entries from curated Swiss data (brands, products,
// CHF prices, Grosshändler, HKLS norms, emergencies, seasonal, defects).
// Idempotent on titel.  node scripts/seed_knowledge_2.mjs

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
const E = [];
const add = (kategorie, unterkategorie, titel, inhalt, tags) => E.push({ kategorie, unterkategorie, titel, inhalt, tags, quelle: Q });
const GH = 'Bezug: Tobler/Walter Meier, Sanitär Heinze, Richner (Endkunde via Installateur).';

// ── Materialpreise: Produkte mit echten CH-Preisen ──
const PRODUKTE = [
  ['Sanitär', 'Geberit', 'UP-Spülkasten Sigma UP320', 'CHF 180–240'],
  ['Sanitär', 'Geberit', 'Betätigungsplatte Sigma01', 'CHF 60–110'],
  ['Sanitär', 'Geberit', 'Betätigungsplatte Sigma50', 'CHF 180–260'],
  ['Sanitär', 'Geberit', 'AquaClean Dusch-WC Mera', 'CHF 3500–4800'],
  ['Sanitär', 'Geberit', 'CleanLine Duschrinne', 'CHF 280–520'],
  ['Sanitär', 'Laufen', 'Pro Wand-WC spülrandlos', 'CHF 280–450'],
  ['Sanitär', 'Laufen', 'Pro Waschtisch 60 cm', 'CHF 150–280'],
  ['Sanitär', 'KWC', 'Küchenmischer Ono', 'CHF 350–650'],
  ['Sanitär', 'KWC', 'Waschtischmischer Ava', 'CHF 220–420'],
  ['Sanitär', 'Hansgrohe', 'Brauseset Croma 220', 'CHF 180–320'],
  ['Sanitär', 'Hansgrohe', 'Thermostat Ecostat', 'CHF 250–450'],
  ['Sanitär', 'Franke', 'Spültisch Edelstahl', 'CHF 200–600'],
  ['Sanitär', 'Similor', 'Armatur Arwa-Twin', 'CHF 280–500'],
  ['Heizung', 'Arbonia', 'Röhrenradiator', 'CHF 200–700'],
  ['Heizung', 'Zehnder', 'Charleston Heizkörper', 'CHF 300–900'],
  ['Heizung', 'Zehnder', 'Handtuchwärmer', 'CHF 250–600'],
  ['Heizung', 'Danfoss', 'Thermostatventil RA', 'CHF 20–45'],
  ['Heizung', 'Grundfos', 'Hocheffizienzpumpe Alpha', 'CHF 250–450'],
  ['Heizung', 'Oventrop', 'Thermostatkopf Uni', 'CHF 18–40'],
  ['Heizung', 'Viessmann', 'Vitodens Gas-Brennwert', 'CHF 6000–11000'],
  ['Heizung', 'Hoval', 'UltraSource Wärmepumpe', 'CHF 28000–42000'],
  ['Heizung', 'Stiebel Eltron', 'Luft/Wasser-WP', 'CHF 25000–38000'],
  ['Klima', 'Daikin', 'Split Comfora 3.5 kW', 'CHF 1500–2600'],
  ['Klima', 'Mitsubishi', 'Split MSZ 2.5 kW', 'CHF 1400–2400'],
  ['Lüftung', 'Zehnder', 'ComfoAir KWL-Gerät', 'CHF 4500–8000'],
  ['Lüftung', 'Helios', 'KWL EC 220', 'CHF 3500–6000'],
  ['Elektro', 'Feller', 'EDIZIOdue Steckdose T13', 'CHF 18–35'],
  ['Elektro', 'Feller', 'Wiser Funk-Schalter', 'CHF 60–110'],
  ['Elektro', 'Hager', 'Leitungsschutzschalter LS', 'CHF 12–28'],
  ['Elektro', 'Hager', 'FI-Schutzschalter 30mA', 'CHF 80–160'],
  ['Elektro', 'ABB', 'Wallbox 11 kW', 'CHF 900–1900'],
  ['Elektro', 'Zumtobel', 'LED-Einbauleuchte', 'CHF 40–120'],
  ['Geräte', 'V-Zug', 'Adora Waschmaschine', 'CHF 2500–4500'],
  ['Geräte', 'V-Zug', 'Adora Geschirrspüler', 'CHF 1800–3500'],
  ['Geräte', 'Electrolux', 'Backofen Einbau', 'CHF 800–2200'],
  ['Geräte', 'Miele', 'Wärmepumpentrockner', 'CHF 1500–2800'],
  ['Fliesen', 'Mapei', 'Flexkleber Keraflex', 'CHF 35–55/Sack'],
  ['Fliesen', 'Sika', 'Sanitärsilikon', 'CHF 9–16/Kartusche'],
  ['Maler', 'Caparol', 'Innenfarbe PremiumWeiss', 'CHF 60–120/10l'],
  ['Maler', 'Sikkens', 'Alpha Dispersion', 'CHF 70–130/10l'],
  ['Schreiner', 'Blum', 'Vollauszug Tandembox', 'CHF 25–60/Paar'],
  ['Schreiner', 'Hilti', 'Schlagbohrmaschine', 'CHF 250–500'],
];
PRODUKTE.forEach(([kat, marke, prod, preis]) => {
  add(kat, 'Materialpreis', `${marke} ${prod} – Preis CH`, `${marke} ${prod}: ca. ${preis} (CH-Richtpreis, exkl. Montage/MwSt 8.1%). ${GH}`, [marke.toLowerCase(), kat.toLowerCase(), 'preis', 'material']);
});

// ── Grosshändler ──
const GROSS = [
  ['Tobler (Walter Meier)', 'führender SHK-Grosshändler CH, Heizung/Sanitär/Lüftung, dichtes Filialnetz, eShop für Installateure'],
  ['Sanitär Heinze', 'Sanitär- und Heizungs-Grosshandel, breites Sortiment, Ausstellungen'],
  ['Richner', 'Bäder, Plättli, Sanitär – Ausstellungen in der ganzen CH (CRH-Gruppe)'],
  ['Debrunner Koenig', 'Stahl, Haustechnik, Befestigung, Werkzeuge für Profis'],
  ['Otto Fischer', 'Elektro-Grosshandel CH, Kabel, Apparate, Leuchten'],
  ['Elektro-Material AG (EM)', 'Elektro-Grosshandel, schweizweit, eShop'],
  ['HG Commerciale', 'Baustoffe, Holz, Haustechnik – Genossenschaft'],
  ['Hagebau / bauhaus / Coop Bau+Hobby', 'Baumärkte für Endkunden, Werkzeug/Material'],
];
GROSS.forEach(([name, desc]) => add('Gewerke', 'Grosshändler', `Grosshändler: ${name}`, `${name}: ${desc}. Endkunden beziehen i.d.R. über den Installateur (bessere Konditionen).`, ['grosshändler', 'bezug', name.split(' ')[0].toLowerCase()]));

// ── HKLS-Normen Schweiz ──
const NORMEN = [
  ['SIA 384/1', 'Heizungsanlagen – Grundlagen und Anforderungen, Heizlastberechnung nach SN EN 12831'],
  ['SIA 385/1', 'Anlagen für Trinkwarmwasser – Grundlagen und Anforderungen (Legionellenschutz)'],
  ['SIA 382/1', 'Lüftungs- und Klimaanlagen – Allgemeine Grundlagen und Anforderungen'],
  ['SIA 180', 'Wärme- und Feuchteschutz im Hochbau – Bauphysik'],
  ['SWKI VA104-01', 'Hygiene in raumlufttechnischen Anlagen (Lüftungshygiene)'],
  ['SWKI BT102-01', 'Trinkwasserhygiene in Gebäuden'],
  ['SN EN 1717', 'Schutz des Trinkwassers vor Rückfluss / Verschmutzung'],
  ['NIN 2020 (SNR 462638)', 'Niederspannungs-Installationsnorm – FI/RCD-Pflicht, Querschnitte, Schutzmassnahmen'],
  ['VKF Brandschutz', 'Brandschutzvorschriften (Feuerungen, Kaminabstände, Schächte)'],
  ['SVGW W3', 'Richtlinie für Trinkwasserinstallationen (Sanitär)'],
  ['MuKEn 2014', 'Mustervorschriften der Kantone im Energiebereich (GEAK, Heizungsersatz)'],
  ['ChemRRV / F-Gas', 'Kältemittel-Vorschriften, Zertifikatspflicht für Kältetechnik'],
];
NORMEN.forEach(([norm, desc]) => add('Gewerke', 'Norm', `Norm ${norm}`, `${norm}: ${desc}. Relevant für fachgerechte Ausführung und Abnahme in der Schweiz.`, ['norm', 'hkls', 'schweiz', norm.split(' ')[0].toLowerCase()]));

// ── Notfall-Szenarien ──
const NOTFALL = [
  ['Wasserrohrbruch', 'Haupthahn (Keller/Zähler) ZU, Strom in nassen Räumen aus, Wasser aufnehmen, Notdienst + Versicherung.'],
  ['Gasgeruch', 'Kein Licht/Schalter, keine Flamme, Fenster auf, Haupthahn zu, raus, Gasversorger/118 von draussen.'],
  ['Heizungsausfall Winter', 'Reset 1x, Druck/Brennstoff prüfen, Räume >5°C halten, SHK-Notdienst.'],
  ['Stromausfall mit Brandgeruch', 'Hauptschalter aus, nichts einschalten, Feuerwehr 118.'],
  ['Verstopfung total WC', 'Pümpel, kein Chemie-Cocktail, Notdienst Kanalreinigung CHF 200–400.'],
  ['Überlaufendes Wasser', 'Zulauf zudrehen (Eckventil/Haupthahn), Boden trocknen, Stockwerk drunter warnen.'],
  ['Eingefrorene Leitung', 'Haupthahn zu (Bruchgefahr), mit Föhn auftauen, NIE offene Flamme.'],
  ['Kein Warmwasser', 'Boiler-Sicherung/Thermostat prüfen; bei Gas/WP Störung notieren, Fachmann.'],
  ['Aufzug blockiert', 'Notruf-Knopf im Lift, Aufzugsfirma (Nummer in Kabine), ruhig bleiben.'],
  ['Schlüssel abgebrochen im Schloss', 'Nicht weiterdrehen, Schlüsseldienst – Zylinder evtl. tauschen CHF 80–200.'],
  ['Glasbruch Fenster', 'Splitter sichern, Notverglasung/Folie, Glaser; Einbruch → Polizei 117 + Versicherung.'],
  ['Sturmschaden Dach', 'Bereich absperren (herabfallende Ziegel), Notabdeckung, Dachdecker + Gebäudeversicherung.'],
];
NOTFALL.forEach(([sz, txt]) => add('Notfall', 'Szenario', `Notfall: ${sz}`, `${sz} – Sofortmassnahmen: ${txt}`, ['notfall', 'sofort', sz.split(' ')[0].toLowerCase()]));

// ── Saisonale Wartung (pro Monat) ──
const SAISON = [
  ['Januar', 'Frostschutz prüfen (Aussenleitungen), Heizung läuft – Druck kontrollieren, Storen/Eis.'],
  ['Februar', 'Lüftungsfilter wechseln, Heizkörper entlüften, Vordächer/Schneelast beobachten.'],
  ['März', 'Gartensaison-Start: Bewässerung/Aussenhahn entwintern, Hecke vor Brutzeit schneiden.'],
  ['April', 'Klimaanlage-Service vor Sommer, Dachrinnen nach Winter prüfen, Fassade auf Frostschäden.'],
  ['Mai', 'Storen/Markisen warten, Aussenbeleuchtung, PV-Module-Ertrag prüfen/reinigen.'],
  ['Juni', 'Klima-Filter reinigen, Sonnenschutz, Regenwassernutzung/Bewässerung optimieren.'],
  ['Juli', 'Hitzeschutz, Klimaanlage-Kondensat prüfen, Garten-Bewässerung.'],
  ['August', 'Vor Herbst: Heizungs-Service planen, Kaminfeger-Termin, Holz/Pellets bestellen.'],
  ['September', 'Heizung-Check vor Saison, Dichtungen Fenster/Türen prüfen, Dachrinnen.'],
  ['Oktober', 'Heizung entlüften/Druck, Aussenhahn entleeren, Laub aus Rinnen, Frostschutz.'],
  ['November', 'Frostschutz Leitungen/Garten, Heizung optimal einstellen, Storen winterfest.'],
  ['Dezember', 'Heizlast prüfen, Lüften gegen Kondensat/Schimmel, Notfall-Nummern bereit.'],
];
SAISON.forEach(([monat, txt]) => add('Diagnose', 'Saison', `Saisonale Wartung: ${monat}`, `${monat}: ${txt}`, ['saison', 'wartung', monat.toLowerCase()]));

// ── Häufige Defekte (pro Gerät/System) ──
const DEFEKTE = [
  ['Sanitär', 'WC-Spülung schwach', 'Spülmenge zu klein eingestellt, Füllventil verkalkt, oder Spülrohr-Dichtung. Geberit-Ersatzteile günstig.'],
  ['Sanitär', 'Duschthermostat unkonstant', 'Thermostatkartusche verkalkt – entkalken/ersetzen (CHF 60–150).'],
  ['Sanitär', 'Geruch aus Bodenablauf', 'Siphon trocken (Wasser nachgiessen) oder Rückstauklappe defekt.'],
  ['Heizung', 'Heizkörper unten kalt', 'Schlamm/Hydraulik – Heizung entschlammen oder Abgleich.'],
  ['Heizung', 'Pumpe brummt', 'Luft im System oder festsitzendes Pumpenrad; entlüften, ggf. Hocheffizienzpumpe.'],
  ['Heizung', 'Brenner taktet', 'Überdimensioniert oder Regelung falsch; Fachmann optimiert Modulation.'],
  ['Elektro', 'LED summt/flackert', 'Dimmer inkompatibel – dimmbare LED + passenden LED-Dimmer.'],
  ['Elektro', 'Steckdose locker', 'Kontakt ausgeleiert/heiss – ersetzen (Brandgefahr), Elektriker.'],
  ['Geräte', 'Waschmaschine laut beim Schleudern', 'Lager defekt oder Wäsche unwucht; Lagerschaden = oft Neugerät wirtschaftlicher.'],
  ['Geräte', 'Geschirrspüler trocknet nicht', 'Klarspüler fehlt, oder Wärmetauscher/Heizung; Sieb reinigen.'],
  ['Geräte', 'Backofen heizt nicht', 'Heizelement oder Thermostat defekt; Ersatz CHF 80–200 + Arbeit.'],
  ['Klima', 'Klima tropft innen', 'Kondensatablauf verstopft/verlegt; reinigen, Gefälle prüfen.'],
  ['Lüftung', 'KWL pfeift', 'Filter zu, Klappe oder Ventilator-Lager; Filter wechseln.'],
  ['Fenster', 'Fenster schliesst schwer', 'Beschlag verstellt – Bänder/Schliesszapfen justieren.'],
  ['Dach', 'Feuchtigkeit Dachboden', 'Unterdach/Anschluss undicht oder Kondensat (Lüftung Dach).'],
  ['Schreiner', 'Schranktür schliesst nicht', 'Scharnier (Topfband) justieren – 3 Schrauben für Höhe/Seite/Tiefe.'],
  ['Maler', 'Farbe blättert ab', 'Untergrund nicht grundiert/feucht; abkratzen, grundieren, neu streichen.'],
  ['Garten', 'Rasen vergilbt', 'Trockenheit, Pilz oder Nährstoffmangel; wässern, vertikutieren, düngen.'],
];
DEFEKTE.forEach(([kat, def, txt]) => add(kat, 'Defekt', `Defekt: ${def}`, `${def}: ${txt}`, [kat.toLowerCase(), 'defekt', def.split(' ')[0].toLowerCase()]));

// ── Materialkunde / Tipps ──
const KUNDE = [
  ['Sanitär', 'Rohrdimension Trinkwasser', 'Übliche CH-Dimensionen: 16/20 mm Steigleitung, 12/16 mm Verteiler (Verbundrohr). Druckverlust beachten.'],
  ['Sanitär', 'Wasserhärte CH', 'Region unterschiedlich (z.B. ZH hart). Bei >25 °fH Entkalkung sinnvoll – schützt Geräte/Armaturen.'],
  ['Heizung', 'Vorlauftemperatur WP', 'Für Wärmepumpen Vorlauf möglichst tief (30–35°C, FBH) für hohe JAZ/Effizienz.'],
  ['Heizung', 'Anlagendruck richtig', 'EFH typ. 1.0–1.5 bar kalt. Unter 0.8 bar nachfüllen, über 2.5 bar Ausdehnungsgefäss prüfen.'],
  ['Elektro', 'Absicherung Standard', 'Licht 10 A (1.5 mm²), Steckdosen 13/16 A (2.5 mm²), Herd 3×16 A. FI 30 mA Pflicht.'],
  ['Lüftung', 'Luftwechselrate', 'Wohnräume ca. 0.3–0.5/h, Nasszellen höher. KWL mit Feuchte-/CO2-Steuerung effizient.'],
  ['Klima', 'Kältemittel R32', 'Aktueller Standard (geringeres GWP als R410A). Arbeiten nur durch F-Gas-zertifizierte Betriebe.'],
  ['Fliesen', 'Verlegerichtung', 'Grossformat braucht ebenen Untergrund (Buttering-Floating). Bewegungsfugen einplanen.'],
  ['Solar', 'Ausrichtung PV', 'Süd optimal, Ost/West verteilt Ertrag über den Tag. Verschattung vermeiden, Neigung 25–35°.'],
  ['Dach', 'Schneefang Pflicht', 'In vielen Gemeinden Schneefang vorgeschrieben (Schutz Passanten/Eingänge).'],
];
KUNDE.forEach(([kat, t, txt]) => add(kat, 'Materialkunde', `Wissen: ${t}`, txt, [kat.toLowerCase(), 'materialkunde', t.split(' ')[0].toLowerCase()]));

// ── Häufige Probleme/Lösungen pro Gewerk (Varianten) ──
const PROBLEME = {
  Sanitär: ['Wasserhahn tropft', 'WC verstopft', 'Abfluss riecht', 'Dusche kalt', 'Spülkasten läuft', 'Wasserdruck schwach', 'Boiler leckt', 'Silikonfuge schimmlig', 'Lavabo verstopft', 'Eckventil tropft'],
  Heizung: ['Heizkörper kalt', 'Heizung gluckert', 'Thermostat defekt', 'Druck zu tief', 'Heizung zu laut', 'Boiler kein Warmwasser', 'Pumpe defekt', 'Fussbodenheizung ungleich', 'Brenner Störung', 'Heizkosten zu hoch'],
  Elektro: ['Sicherung fliegt', 'Steckdose tot', 'Licht flackert', 'FI löst aus', 'Lampe defekt', 'Kein Strom Raum', 'Schalter defekt', 'Kabel beschädigt', 'Sicherungskasten alt', 'Überspannungsschutz fehlt'],
  Fliesen: ['Fliese gerissen', 'Fuge bröckelt', 'Fliese hohl', 'Silikon erneuern', 'Plättli lose', 'Bad abdichten'],
  Maler: ['Wand Risse', 'Schimmel Wand', 'Farbe blättert', 'Tapete lösen', 'Decke fleckig', 'Fassade Algen'],
  Schreiner: ['Tür klemmt', 'Schublade hakt', 'Parkett zerkratzt', 'Schrank justieren', 'Möbel reparieren', 'Holz quillt'],
  Garten: ['Hecke schneiden', 'Rasen anlegen', 'Baum fällen', 'Unkraut', 'Bewässerung', 'Zaun setzen'],
  Dach: ['Dach undicht', 'Rinne verstopft', 'Ziegel lose', 'Schneefang', 'Dachfenster leckt', 'Kamin abdichten'],
};
Object.entries(PROBLEME).forEach(([kat, list]) => list.forEach((p) => {
  const satz = kat === 'Elektro' ? 'CHF 95–130' : kat === 'Maler' ? 'CHF 75–110' : 'CHF 90–130';
  const inhalt = 'Häufiges Problem im Bereich ' + kat + ': "' + p + '". BOB empfiehlt: zuerst einfache Ursachen pruefen, bei Unsicherheit/Sicherheitsrisiko Fachperson beiziehen. Richt-Stundensatz CH ' + satz + '/h.';
  add(kat, 'Problem', kat + ': ' + p, inhalt, [kat.toLowerCase(), 'problem', p.split(' ')[0].toLowerCase()]);
}));

async function existingTitles() {
  const set = new Set(); let from = 0;
  while (true) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/bob_knowledge?select=titel`, { headers: { ...H, Range: `${from}-${from + 999}` } });
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    rows.forEach((x) => set.add((x.titel || '').trim()));
    if (rows.length < 1000) break; from += 1000;
  }
  return set;
}
const existing = await existingTitles();
const seen = new Set();
const fresh = E.filter((x) => { const t = x.titel.trim(); if (existing.has(t) || seen.has(t)) return false; seen.add(t); return true; });
console.log(`Generated: ${E.length} · new (deduped): ${fresh.length}`);
for (let i = 0; i < fresh.length; i += 100) {
  const batch = fresh.slice(i, i + 100);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/bob_knowledge`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(batch) });
  console.log(r.ok ? `  ✓ inserted ${batch.length}` : `  ✗ ${r.status}: ${(await r.text()).slice(0, 150)}`);
}
const cr = await fetch(`${SUPABASE_URL}/rest/v1/bob_knowledge?select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
console.log(`bob_knowledge total now: ${(cr.headers.get('content-range') || '/?').split('/')[1]}`);
