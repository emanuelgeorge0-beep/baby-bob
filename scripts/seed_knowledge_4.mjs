// scripts/seed_knowledge_4.mjs — Task 9: final push bob_knowledge past 1000.
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

// Weitere Gewerke + häufige Anliegen
const PROB = {
  Reinigung: ['Umzugsreinigung mit Abnahmegarantie', 'Fensterreinigung', 'Teppichreinigung', 'Bauendreinigung', 'Unterhaltsreinigung Büro', 'Polsterreinigung', 'Hauswartung', 'Grundreinigung'],
  Schlüssel: ['Ausgesperrt – Türöffnung', 'Schloss wechseln', 'Zylinder ersetzen', 'Schliessanlage', 'Tresor öffnen', 'Briefkastenschloss'],
  Schädlinge: ['Wespennest entfernen', 'Mäuse bekämpfen', 'Ameisen', 'Schaben', 'Marder im Dach', 'Bettwanzen'],
  Spengler: ['Dachrinne ersetzen', 'Fallrohr defekt', 'Blechabdeckung', 'Kaminhut', 'Fassadenblech', 'Schneefang montieren'],
  Storen: ['Storen reparieren', 'Rollladen klemmt', 'Storenmotor defekt', 'Lamellen ersetzen', 'Markise', 'Storensteuerung'],
  Tore: ['Garagentor defekt', 'Torantrieb', 'Sektionaltor', 'Zaun-Tor', 'Tor-Fernbedienung', 'Lichtschranke'],
  Bodenleger: ['Parkett verlegen', 'Parkett abschleifen', 'Vinyl verlegen', 'Teppich verlegen', 'Linoleum', 'Sockelleisten'],
  Gipser: ['Wand verputzen', 'Decke glätten', 'Trockenbau Wand', 'Akustikdecke', 'Stuck reparieren', 'Riss spachteln'],
  Plattenleger: ['Bad neu plätteln', 'Naturstein', 'Mosaik', 'Aussenplatten Terrasse', 'Sockel plätteln', 'Fugen erneuern'],
  Kaminfeger: ['Kamin reinigen', 'Feinstaubmessung', 'Cheminée-Kontrolle', 'Russbrand', 'Abgasmessung', 'Kaminsanierung'],
};
Object.entries(PROB).forEach(([kat, list]) => list.forEach((p) => add(kat, 'Problem', `${kat}: ${p}`, `Anliegen "${p}" im Bereich ${kat}. BOB empfiehlt die passende Fachperson in Ihrer Region und einen realistischen CHF-Rahmen. Mehrere Offerten vergleichen.`, [kat.toLowerCase(), 'problem', p.split(' ')[0].toLowerCase()])));

// Wasserhärte pro Region (Auswahl Städte)
const WASSER = [
  ['Zürich', 'mittelhart bis hart (~25–32 °fH)'], ['Bern', 'mittel (~18–25 °fH)'], ['Basel', 'hart (~25–35 °fH)'],
  ['Genf', 'mittel-hart'], ['Lausanne', 'mittel'], ['Luzern', 'mittel-hart'], ['St. Gallen', 'weich-mittel'],
  ['Winterthur', 'hart'], ['Zug', 'mittel-hart'], ['Lugano', 'weich-mittel'],
];
WASSER.forEach(([ort, h]) => add('Sanitär', 'Wasserhärte', `Wasserhärte ${ort}`, `Trinkwasser ${ort}: ${h}. Bei hartem Wasser (>25 °fH) Entkalkung/Enthärtung sinnvoll – schützt Armaturen, Boiler und Geräte. Werte beim lokalen Wasserversorger prüfen.`, ['wasserhärte', 'sanitär', ort.toLowerCase()]));

// Energie / GEAK / Effizienz
const ENERGIE = [
  ['GEAK', 'Gebäudeenergieausweis der Kantone – bewertet Energieeffizienz A–G. GEAK Plus mit Beratungsbericht/Massnahmen, oft Fördervoraussetzung.'],
  ['Minergie', 'Schweizer Baustandard für Komfort und Energieeffizienz (Minergie/-P/-A); kontrollierte Lüftung typisch.'],
  ['Heizungsersatz-Pflicht', 'Mehrere Kantone verlangen bei Heizungsersatz erneuerbaren Anteil (MuKEn). Frühzeitig planen.'],
  ['Eigenverbrauch PV', 'PV-Strom selbst nutzen lohnt am meisten; ZEV/Eigenverbrauchsgemeinschaft für Mehrfamilienhäuser.'],
  ['Pronovo EIV', 'Einmalvergütung für PV-Anlagen über Pronovo; Anmeldung nach Inbetriebnahme.'],
  ['Heizgradtage', 'Verbrauch normalisieren über Heizgradtage zum Jahresvergleich.'],
];
ENERGIE.forEach(([t, txt]) => add('Gebäude', 'Energie', `Energie: ${t}`, `${t}: ${txt}`, ['energie', 'effizienz', t.split(' ')[0].toLowerCase()]));

// Mehr Produkte
const PROD = [
  ['Sanitär', 'Geberit', 'Urinalsteuerung', 'CHF 200–500'], ['Sanitär', 'Laufen', 'Bidet', 'CHF 200–450'],
  ['Sanitär', 'KWC', 'Ausziehbrause Küche', 'CHF 300–600'], ['Heizung', 'Zehnder', 'Design-Heizkörper', 'CHF 400–1200'],
  ['Heizung', 'Belimo', 'Stellantrieb Ventil', 'CHF 80–250'], ['Elektro', 'Feller', 'KNX Raumcontroller', 'CHF 200–450'],
  ['Elektro', 'Hager', 'Verteilerschrank', 'CHF 150–600'], ['Klima', 'Daikin', 'Multisplit Aussengerät', 'CHF 2500–5000'],
  ['Lüftung', 'Zehnder', 'ComfoFond Erdregister', 'CHF 2000–5000'], ['Geräte', 'V-Zug', 'CombiSteamer', 'CHF 3000–6000'],
  ['Fliesen', 'Schlüter', 'Schiene/Profil', 'CHF 10–40/Stück'], ['Maler', 'Caparol', 'Fassadenfarbe Silikonharz', 'CHF 90–160/12l'],
  ['Garten', 'Husqvarna', 'Mähroboter', 'CHF 800–3500'], ['Solar', 'SMA', 'Hybrid-Wechselrichter', 'CHF 2000–4000'],
];
PROD.forEach(([kat, marke, prod, preis]) => add(kat, 'Materialpreis', `${marke} ${prod} – Preis CH`, `${marke} ${prod}: ca. ${preis} (CH-Richtpreis, exkl. Montage/MwSt). Bezug via Grosshändler/Installateur.`, [marke.toLowerCase(), kat.toLowerCase(), 'preis']));

// Diagnose-Leitfäden
const DIAG = [
  ['Sanitär', 'Wo ist das Wasserleck?', 'Trocknen, Küchenpapier auslegen, beobachten welche Stelle nass wird; Eckventil/Schlauch/Siphon/Silikon prüfen. Wasserzähler bei allem Zu beobachten (dreht = Leck).'],
  ['Heizung', 'Heizung-Selbstcheck', 'Druck (1–1.5 bar), alle Thermostate auf, entlüften, Vorlauf fühlbar warm? Pumpe läuft? Sonst Fachmann.'],
  ['Elektro', 'Fehlerstrom finden', 'Alle Verbraucher aus, FI ein, dann einzeln zuschalten bis FI auslöst → defektes Gerät/Kreis.'],
  ['Gebäude', 'Feuchtequelle bestimmen', 'Kondensation (lüften) vs. eindringend (aussen) vs. aufsteigend (Sockel) – Feuchtemessung/Fachmann.'],
  ['Klima', 'Klima-Selbstcheck', 'Filter reinigen, Aussenteil frei, Fernbedienung/Modus prüfen, Kondensatablauf offen.'],
];
DIAG.forEach(([kat, t, txt]) => add(kat, 'Diagnose', `Leitfaden: ${t}`, txt, [kat.toLowerCase(), 'diagnose', 'leitfaden']));

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
