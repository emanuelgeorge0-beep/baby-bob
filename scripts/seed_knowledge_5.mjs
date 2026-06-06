// scripts/seed_knowledge_5.mjs — Task 9: clear 1000.
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

const PROB = {
  Cheminée: ['Cheminée einbauen', 'Schwedenofen', 'Pelletofen', 'Cheminée-Glas reinigen', 'Zug zu schwach', 'Cheminée sanieren'],
  Pool: ['Pool reinigen', 'Poolpumpe defekt', 'Wasserwerte einstellen', 'Pool winterfest', 'Folie reparieren', 'Wärmepumpe Pool'],
  Wintergarten: ['Wintergarten planen', 'Beschattung', 'Belüftung Wintergarten', 'Glas ersetzen', 'Dichtungen', 'Heizung Wintergarten'],
  Innenausbau: ['Trennwand einziehen', 'Decke abhängen', 'Einbauschrank', 'Podest bauen', 'Dachausbau', 'Estrich ausbauen'],
  Abdichtung: ['Keller abdichten', 'Balkon abdichten', 'Flachdach abdichten', 'Terrasse abdichten', 'Fuge abdichten', 'Sockel abdichten'],
  Treppen: ['Treppe sanieren', 'Geländer montieren', 'Treppe knarrt', 'Handlauf', 'Antirutsch', 'Treppenlift'],
  Pflästerer: ['Sitzplatz pflästern', 'Einfahrt pflastern', 'Randsteine setzen', 'Platten verlegen aussen', 'Kies/Mergel', 'Entwässerung'],
  Metallbau: ['Geländer Stahl', 'Vordach', 'Tor/Zaun Metall', 'Sichtschutz Metall', 'Balkongeländer', 'Stahltreppe'],
};
Object.entries(PROB).forEach(([kat, list]) => list.forEach((p) => add(kat, 'Problem', `${kat}: ${p}`, `Anliegen "${p}" im Bereich ${kat}. BOB empfiehlt die passende Fachperson und einen realistischen CHF-Rahmen; bei grösseren Projekten 2–3 Offerten vergleichen.`, [kat.toLowerCase(), 'problem', p.split(' ')[0].toLowerCase()])));

const WASSER = ['Aarau', 'Baden', 'Schaffhausen', 'Chur', 'Sion', 'Fribourg', 'Neuchâtel', 'Biel', 'Thun', 'Uster', 'Rapperswil', 'Wil', 'Olten', 'Wetzikon', 'Frauenfeld', 'Dietikon', 'Kreuzlingen', 'Bellinzona'];
WASSER.forEach((ort) => add('Sanitär', 'Wasserhärte', `Wasserhärte ${ort}`, `Trinkwasser ${ort}: Härtegrad lokal unterschiedlich – beim Wasserversorger erfragen. Ab ~25 °fH lohnt Entkalkung/Enthärtung zum Schutz von Armaturen, Boiler und Haushaltgeräten.`, ['wasserhärte', 'sanitär', ort.toLowerCase()]));

const PROD = [
  ['Sanitär', 'Geberit', 'Mepla Verbundrohr 16mm', 'CHF 4–9/m'], ['Sanitär', 'Nussbaum', 'Optiflex-Rohr', 'CHF 5–11/m'],
  ['Sanitär', 'Laufen', 'Sonar Waschtisch', 'CHF 350–700'], ['Sanitär', 'Geberit', 'Spülrohr-Set', 'CHF 30–80'],
  ['Heizung', 'Wilo', 'Umwälzpumpe Stratos', 'CHF 300–600'], ['Heizung', 'Caleffi', 'Mischventil', 'CHF 60–180'],
  ['Heizung', 'Reflex', 'Ausdehnungsgefäss 25l', 'CHF 80–180'], ['Elektro', 'Feller', 'USB-Steckdose', 'CHF 60–120'],
  ['Elektro', 'Hager', 'Überspannungsschutz', 'CHF 150–400'], ['Elektro', 'Osram', 'LED-Panel 60x60', 'CHF 30–90'],
  ['Klima', 'Mitsubishi', 'Multisplit 5 kW', 'CHF 2800–5500'], ['Lüftung', 'Helios', 'Bad-Ventilator mit Nachlauf', 'CHF 60–180'],
  ['Geräte', 'Miele', 'Geschirrspüler G7000', 'CHF 1500–3000'], ['Fliesen', 'Mapei', 'Epoxidfuge Kerapoxy', 'CHF 60–110/Gebinde'],
  ['Solar', 'Huawei', 'Wechselrichter SUN2000', 'CHF 1200–2800'],
];
PROD.forEach(([kat, marke, prod, preis]) => add(kat, 'Materialpreis', `${marke} ${prod} – Preis CH`, `${marke} ${prod}: ca. ${preis} (CH-Richtpreis, exkl. Montage/MwSt). Bezug via Grosshändler/Installateur.`, [marke.toLowerCase(), kat.toLowerCase(), 'preis']));

const PREISE = [
  ['Sanitär', 'Silikonfugen erneuern Bad', 'CHF 150–400'], ['Sanitär', 'Spülkasten reparieren', 'CHF 120–300'],
  ['Heizung', 'Ausdehnungsgefäss ersetzen', 'CHF 250–500'], ['Heizung', 'Umwälzpumpe ersetzen', 'CHF 400–800'],
  ['Elektro', 'FI-Schalter nachrüsten', 'CHF 200–500'], ['Elektro', 'Lampe/Leuchte montieren', 'CHF 80–200'],
  ['Maler', 'Decke streichen Zimmer', 'CHF 150–400'], ['Fliesen', 'Einzelne Fliese ersetzen', 'CHF 120–300'],
  ['Schreiner', 'Tür einstellen/hobeln', 'CHF 100–250'], ['Garten', 'Rasen mähen Saison', 'CHF 40–100/Mal'],
  ['Dach', 'Dachrinne reinigen', 'CHF 150–400'], ['Reinigung', 'Umzugsreinigung 3.5-Zi', 'CHF 600–1200'],
  ['Schlüssel', 'Türöffnung Notdienst', 'CHF 150–350'], ['Fenster', 'Fensterdichtung ersetzen', 'CHF 5–15/lfm'],
];
PREISE.forEach(([kat, leistung, preis]) => add(kat, 'Richtpreis', `Richtpreis: ${leistung}`, `${leistung} (Schweiz): ca. ${preis} inkl. Arbeit, exkl. MwSt. Anfahrt zusätzlich. Offerte einholen.`, [kat.toLowerCase(), 'preis', 'richtwert']));

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
