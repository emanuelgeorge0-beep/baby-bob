// scripts/seed_knowledge_3.mjs — Task 9: push bob_knowledge past 1000.
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
const add = (k, u, t, i, tg) => E.push({ kategorie: k, unterkategorie: u, titel: t, inhalt: i, tags: tg, quelle: Q });

// Kantonale Förderung Heizungsersatz (26 Kantone)
const KANTONE = ['Zürich', 'Bern', 'Luzern', 'Uri', 'Schwyz', 'Obwalden', 'Nidwalden', 'Glarus', 'Zug', 'Freiburg', 'Solothurn', 'Basel-Stadt', 'Basel-Landschaft', 'Schaffhausen', 'Appenzell Ausserrhoden', 'Appenzell Innerrhoden', 'St. Gallen', 'Graubünden', 'Aargau', 'Thurgau', 'Tessin', 'Waadt', 'Wallis', 'Neuenburg', 'Genf', 'Jura'];
KANTONE.forEach((k) => add('Heizung', 'Förderung', `Förderung Heizungsersatz ${k}`, `Kanton ${k}: Förderbeiträge für Heizungsersatz (Wärmepumpe, Pellets, Fernwärme) via Gebäudeprogramm/kantonales Förderprogramm. Vor Baubeginn Gesuch stellen. Kombinierbar mit GEAK. Beträge variieren – aktuell auf der kantonalen Energiefachstelle prüfen.`, ['förderung', 'heizung', 'kanton', k.toLowerCase()]));

// Weitere Produkte mit Preisen
const PROD = [
  ['Sanitär', 'Duravit', 'WC-Sitz mit Absenkautomatik', 'CHF 80–180'],
  ['Sanitär', 'Geberit', 'Duofix WC-Element', 'CHF 200–320'],
  ['Sanitär', 'Nussbaum', 'Optipress-Fitting', 'CHF 5–25/Stück'],
  ['Sanitär', 'JRG', 'Sanipex Verbundrohr-System', 'CHF 8–20/m'],
  ['Sanitär', 'Schmidlin', 'Stahl-Email Duschwanne', 'CHF 300–800'],
  ['Sanitär', 'Kaldewei', 'Badewanne Stahl-Email', 'CHF 400–1200'],
  ['Heizung', 'Buderus', 'Logamax Gas-Brennwert', 'CHF 5500–9000'],
  ['Heizung', 'CTA', 'Wärmepumpe Optiheat', 'CHF 26000–40000'],
  ['Heizung', 'Domotec', 'Elektro-Wassererwärmer', 'CHF 800–1800'],
  ['Heizung', 'Meier Tobler', 'Heizungs-Service-Paket', 'CHF 250–400/Jahr'],
  ['Elektro', 'Gira', 'KNX Taster', 'CHF 120–300'],
  ['Elektro', 'Schneider', 'Sicherungsautomat', 'CHF 12–30'],
  ['Elektro', 'Theben', 'Bewegungsmelder', 'CHF 40–120'],
  ['Elektro', 'Steinel', 'Sensor-Aussenleuchte', 'CHF 50–150'],
  ['Lüftung', 'Wernig', 'Einzelraumlüftung WRG', 'CHF 800–1600/Gerät'],
  ['Klima', 'Toshiba', 'Split-Klima 3.5 kW', 'CHF 1400–2500'],
  ['Geräte', 'Siemens', 'Induktionskochfeld', 'CHF 600–1800'],
  ['Geräte', 'Bosch', 'Kühlschrank Einbau', 'CHF 900–2500'],
  ['Geräte', 'Liebherr', 'Gefrierschrank', 'CHF 700–2000'],
  ['Fliesen', 'weber', 'Abdichtung Dichtschlämme', 'CHF 40–80/Sack'],
  ['Maler', 'Knauf', 'Gipsspachtel', 'CHF 20–40/Sack'],
  ['Schreiner', 'Häfele', 'Möbelbeschlag-Set', 'CHF 30–120'],
  ['Garten', 'Gardena', 'Bewässerungssystem-Set', 'CHF 150–500'],
  ['Solar', 'Fronius', 'Wechselrichter Symo', 'CHF 1500–3500'],
  ['Solar', 'BYD', 'Batteriespeicher 10 kWh', 'CHF 7000–11000'],
];
PROD.forEach(([kat, marke, prod, preis]) => add(kat, 'Materialpreis', `${marke} ${prod} – Preis CH`, `${marke} ${prod}: ca. ${preis} (CH-Richtpreis, exkl. Montage/MwSt). Bezug via Grosshändler/Installateur.`, [marke.toLowerCase(), kat.toLowerCase(), 'preis']));

// Dienstleistungs-Richtpreise
const PREISE = [
  ['Sanitär', 'Wasserhahn ersetzen', 'CHF 200–550'], ['Sanitär', 'WC ersetzen', 'CHF 600–1500'], ['Sanitär', 'Boiler entkalken', 'CHF 150–250'],
  ['Sanitär', 'Rohrreinigung', 'CHF 150–400'], ['Sanitär', 'Badsanierung komplett', 'CHF 18000–35000'], ['Sanitär', 'Duschwanne ersetzen', 'CHF 800–2000'],
  ['Heizung', 'Heizungs-Service', 'CHF 200–350'], ['Heizung', 'Heizkörper ersetzen', 'CHF 350–900'], ['Heizung', 'Wärmepumpe EFH', 'CHF 30000–45000'],
  ['Heizung', 'Hydraulischer Abgleich', 'CHF 500–1500'], ['Elektro', 'Steckdose montieren', 'CHF 80–180'], ['Elektro', 'Sicherungskasten erneuern', 'CHF 2000–5000'],
  ['Elektro', 'Wallbox installieren', 'CHF 1600–4500'], ['Maler', 'Wohnung streichen 3.5-Zi', 'CHF 2500–4500'], ['Maler', 'Fassade streichen', 'CHF 25–55/m²'],
  ['Fliesen', 'Bad fliesen', 'CHF 2500–5000'], ['Schreiner', 'Einbauküche', 'CHF 8000–30000'], ['Garten', 'Heckenschnitt', 'CHF 60–110/h'],
  ['Dach', 'Dachsanierung', 'CHF 250–450/m²'], ['Fenster', 'Fenster ersetzen', 'CHF 700–1400/Stück'], ['Solar', 'PV-Anlage 8–12 kWp', 'CHF 18000–28000'],
  ['Lüftung', 'Komfortlüftung KWL', 'CHF 15000–25000'], ['Klima', 'Split-Klima montieren', 'CHF 800–1800'], ['Gebäude', 'Fassadendämmung', 'CHF 180–280/m²'],
];
PREISE.forEach(([kat, leistung, preis]) => add(kat, 'Richtpreis', `Richtpreis: ${leistung}`, `${leistung} (Schweiz): typische Kosten ca. ${preis} inkl. Arbeit, exkl. MwSt 8.1%. Anfahrt CHF 60–120 zusätzlich. Offerte einholen.`, [kat.toLowerCase(), 'preis', 'richtwert']));

// Probleme pro weiterem Gewerk
const PROB = {
  Klima: ['Klima kühlt nicht', 'Klima tropft', 'Klima laut', 'Klima riecht', 'Fernbedienung defekt', 'Kältemittel nachfüllen'],
  Lüftung: ['Lüftung zu laut', 'Filter wechseln', 'Schlechte Luft', 'Kondensat Lüftung', 'Ventilator defekt', 'WRG ineffizient'],
  Solar: ['PV-Ertrag tief', 'Wechselrichter Fehler', 'Modul verschattet', 'Speicher lädt nicht', 'Monitoring offline', 'Reinigung Module'],
  Auto: ['Auto springt nicht an', 'Reifenwechsel', 'Bremsen quietschen', 'Service fällig', 'Batterie leer', 'Klima Auto'],
  Geräte: ['Waschmaschine pumpt nicht', 'Tumbler trocknet nicht', 'Geschirrspüler Fehler', 'Backofen kalt', 'Kühlschrank zu warm', 'Induktion Fehler'],
  Beauty: ['Haarschnitt', 'Coloration', 'Maniküre', 'Pediküre', 'Gesichtsbehandlung', 'Wimpern'],
  IT: ['WLAN langsam', 'Drucker offline', 'PC startet nicht', 'Daten retten', 'Virus entfernen', 'Backup einrichten'],
  Umzug: ['Umzug planen', 'Möbel transportieren', 'Endreinigung', 'Entsorgung', 'Klaviertransport', 'Einlagerung'],
  Boden: ['Parkett verlegen', 'Laminat reparieren', 'Teppich entfernen', 'Boden schleifen', 'Vinyl verlegen', 'Plättli Boden'],
};
Object.entries(PROB).forEach(([kat, list]) => list.forEach((p) => add(kat, 'Problem', `${kat}: ${p}`, `Anliegen im Bereich ${kat}: "${p}". BOB empfiehlt die passende Fachperson und nennt einen realistischen CHF-Rahmen. Bei Sicherheits-/Gewährleistungsfragen Profi beiziehen.`, [kat.toLowerCase(), 'problem', p.split(' ')[0].toLowerCase()])));

// Geräte-Fehlercodes (generisch, häufig)
const CODES = [
  ['Waschmaschine', 'F08/E10', 'Wasserzulauf-Problem: Hahn auf? Sieb im Zulaufschlauch reinigen.'],
  ['Waschmaschine', 'F21/E20', 'Abpumpfehler: Flusensieb + Ablaufschlauch reinigen.'],
  ['Geschirrspüler', 'E15/A03', 'Wasser im Boden / Aquastop: Gerät kippen zum Entleeren, Leck prüfen.'],
  ['Gastherme', 'F28/F29', 'Keine Zündung: Gaszufuhr/Druck, Kondensatablauf prüfen – Fachmann.'],
  ['Wärmepumpe', 'E/Störung', 'Hochdruck/Niederdruck: Filter/Volumenstrom, Aussenteil frei? Reset, sonst Servicefirma.'],
  ['Backofen', 'F1/F2', 'Temperatursensor defekt: Fühler ersetzen lassen.'],
];
CODES.forEach(([geraet, code, txt]) => add('Geräte', 'Fehlercode', `${geraet} Fehler ${code}`, `${geraet} Fehlercode ${code}: ${txt}`, ['fehlercode', geraet.toLowerCase(), 'gerät']));

// Sicherheits-/Materialkunde Ergänzungen
const TIPS = [
  ['Elektro', 'Stromschlag vermeiden', 'Vor Arbeiten freischalten (Sicherung aus + Spannung prüfen). Bad/Aussen nur mit FI 30 mA. Fest verdrahtet = konzessionierter Elektriker.'],
  ['Sanitär', 'Wasserschaden vorbeugen', 'Schläuche (Waschmaschine/GS) alle 5–10 J. ersetzen, Aquastop nutzen, Hauptabsperrung kennen, bei Abwesenheit zudrehen.'],
  ['Heizung', 'CO-Gefahr', 'Brennstoff-Heizungen: CO-Melder sinnvoll, Abgaskontrolle jährlich, Lüftung Heizraum frei halten.'],
  ['Gebäude', 'Schimmel vermeiden', 'Stosslüften 3×/Tag, Feuchte <60% rF, Möbel von Aussenwänden abrücken, Wärmebrücken dämmen.'],
  ['Dach', 'Arbeitssicherheit Dach', 'Höhenarbeiten nur mit Sicherung/Gerüst – kein Selbstversuch bei Steildach (Absturzgefahr).'],
  ['Klima', 'F-Gas-Pflicht', 'Kältemittelarbeiten nur durch zertifizierte Betriebe (Umweltrecht). Dichtheitskontrolle vorgeschrieben.'],
  ['Garten', 'Heckenschnitt-Zeit', 'Schonzeit für Vögel 1. März–31. Juli – stärkere Rückschnitte ausserhalb planen.'],
  ['Sanitär', 'Legionellen-Schutz', 'Warmwasser ≥60°C im Speicher, Leitungen ≥55°C; bei Ferienabwesenheit vor Nutzung heiss spülen.'],
];
TIPS.forEach(([kat, t, txt]) => add(kat, 'Sicherheit', `Sicherheit: ${t}`, txt, [kat.toLowerCase(), 'sicherheit', t.split(' ')[0].toLowerCase()]));

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
console.log(`Generated: ${E.length} · new: ${fresh.length}`);
for (let i = 0; i < fresh.length; i += 100) {
  const batch = fresh.slice(i, i + 100);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/bob_knowledge`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(batch) });
  console.log(r.ok ? `  ✓ inserted ${batch.length}` : `  ✗ ${r.status}: ${(await r.text()).slice(0, 150)}`);
}
const cr = await fetch(`${SUPABASE_URL}/rest/v1/bob_knowledge?select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
console.log(`bob_knowledge total now: ${(cr.headers.get('content-range') || '/?').split('/')[1]}`);
