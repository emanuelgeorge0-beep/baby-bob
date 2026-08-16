// scripts/test_branding.mjs — Branding-Fundament (gs_branding → lib/pdf.js).
// Rein lesend, kein INSERT/UPDATE/DELETE.
//   node --env-file=.env.local scripts/test_branding.mjs
//
// Beantwortet die Frage, die man einem fertigen PDF nicht ansieht: kommen Farbe,
// Logo, Firmenname und Fusszeile aus der Tabelle — oder doch aus dem Fallback?
// Beide sehen identisch aus, solange George Solutions der Standard ist.

import { ladeBranding, brandingCacheLeeren, buildPdf, BRANDING_FALLBACK,
  buildRapportPdf, buildRechnungPdf } from '../lib/pdf.js';
import { sammleWochendaten, buildWochenberichtPdf } from '../lib/wochenbericht.js';

const P_LIVE = '64c695d5-0ef7-4864-9951-ed7163a92791';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };

console.log('── gs_branding lesen ────────────────────────────────────');
brandingCacheLeeren();
const marke = await ladeBranding({});
ok(marke.aus_tabelle === true, 'Standard-Zeile kommt aus der Tabelle, nicht aus dem Fallback');
ok(marke.firmenname === 'George Solutions', `Firmenname (ist ${marke.firmenname})`);
ok(marke.akzentfarbe === '#C9A961', `Akzentfarbe (ist ${marke.akzentfarbe})`);
ok(marke.partner_id === null, 'Standard-Zeile hat partner_id NULL');
ok(Buffer.isBuffer(marke.logo) && marke.logo.length > 1000, `Logo geladen (${marke.logo && marke.logo.length} Bytes)`);
ok(/^\xFF\xD8/.test(marke.logo.toString('latin1').slice(0, 2)), 'Logo ist ein JPEG');
console.log(`  ${marke.firmenname} · ${marke.akzentfarbe} · ${marke.logo_url}`);

console.log('\n── Farbe stammt aus der Tabelle, nicht aus dem Code ─────');
const GOLD_RGB = '0.788 0.663 0.380';
const daten = await sammleWochendaten({ projektId: P_LIVE, jahr: 2026, woche: 31 });
const echt = buildWochenberichtPdf(daten, { logo: marke.logo, fotos: [], berichtNr: 'WB-PROBE', branding: marke }).toString('latin1');
ok(echt.includes(GOLD_RGB), 'GS-Bericht setzt #C9A961');

// Dieselben Daten, andere Marke: wenn die Farbe wirklich aus dem übergebenen
// Branding kommt, verschwindet Gold restlos aus dem Dokument.
const fremd = {
  firmenname: 'Nievergelt Haustechnik', akzentfarbe: '#1155CC',
  fusszeile: 'Nievergelt Haustechnik · Zürich', logo: marke.logo, logo_url: marke.logo_url,
  aus_tabelle: true, partner_id: '00000000-0000-0000-0000-000000000001',
};
const anders = buildWochenberichtPdf(daten, { logo: marke.logo, fotos: [], berichtNr: 'WB-PROBE', branding: fremd }).toString('latin1');
ok(anders.includes('0.067 0.333 0.800'), 'fremde Akzentfarbe #1155CC wird gesetzt');
ok(!anders.includes(GOLD_RGB), 'kein Gold mehr im Dokument — Farbe ist nicht hart codiert');
ok(anders.includes('Nievergelt Haustechnik'), 'fremde Fusszeile erscheint im Dokument');
ok(!anders.includes('george-solutions.ch'), 'GS-Fusszeile verschwindet mit der fremden Marke');

console.log('\n── Kaputte Farbe zerlegt kein Dokument ──────────────────');
const kaputt = buildWochenberichtPdf(daten, { logo: marke.logo, fotos: [], berichtNr: 'WB-PROBE',
  branding: { ...fremd, akzentfarbe: 'blau-ish' } }).toString('latin1');
ok(kaputt.startsWith('%PDF-1.4'), 'ungültige Farbe erzeugt trotzdem ein gültiges PDF');
ok(kaputt.includes(GOLD_RGB), 'ungültige Farbe fällt auf Gold zurück');

console.log('\n── Fallback, wenn die Tabelle nicht antwortet ───────────');
// Umgebung wegnehmen → ladeBranding kann nicht lesen und MUSS trotzdem liefern.
const url = process.env.SUPABASE_URL;
delete process.env.SUPABASE_URL;
brandingCacheLeeren();
const notfall = await ladeBranding({});
process.env.SUPABASE_URL = url;
brandingCacheLeeren();
ok(notfall.aus_tabelle === false, 'ohne DB greift der Fallback und sagt es auch');
ok(notfall.akzentfarbe === BRANDING_FALLBACK.akzentfarbe, 'Fallback trägt die heutigen GS-Werte');
ok(Buffer.isBuffer(notfall.logo), 'Fallback lädt das Logo aus dem Repo');

console.log('\n── Partner-Zeile hat Vorrang vor dem Standard ───────────');
// Live existiert nur die Standard-Zeile; geprüft wird die Auswahllogik, indem
// eine unbekannte partner_id sauber auf den Standard zurückfällt.
brandingCacheLeeren();
const fuerPartner = await ladeBranding({ partnerId: '00000000-0000-0000-0000-000000000009' });
ok(fuerPartner.aus_tabelle === true && fuerPartner.partner_id === null,
  'unbekannter Partner bekommt die Standard-Zeile, keinen Fallback');

console.log('\n── Die fünf Altdokumente bleiben im alten Stil ──────────');
const rap = buildRapportPdf({ projekt_name: 'X', datum: '2026-01-01', gesamtstunden: 8 }).toString('latin1');
const rech = buildRechnungPdf({ rechnungsnummer: 'R-1', stunden: 8, stundensatz: 120, betrag: 960 }).toString('latin1');
for (const [name, s] of [['Rapport', rap], ['Rechnung', rech]]) {
  ok(!s.includes('0.043 0.043 0.047 rg'), `${name}: kein schwarzer Kopfbalken`);
  ok(!s.includes('Seite 1 von'), `${name}: keine neue Fusszeile`);
  ok(s.startsWith('%PDF-1.4'), `${name}: gültiges PDF`);
}

console.log('\n── Stil "brief" ist opt-in ──────────────────────────────');
const ohneStil = buildPdf({ title: 'Probe', blocks: [{ t: 'text', text: 'x' }] }).toString('latin1');
const mitStil = buildPdf({ style: 'brief', branding: marke, title: 'Probe', blocks: [{ t: 'text', text: 'x' }] }).toString('latin1');
ok(!ohneStil.includes('0.043 0.043 0.047 rg'), 'ohne style bleibt alles wie bisher');
ok(mitStil.includes('0.043 0.043 0.047 rg'), 'mit style="brief" kommt der Kopfbalken');

console.log('\n── Fusszeile und Seitenzahl auf JEDER Seite ─────────────');
// Je Seite ein Content-Stream (Bild-Streams tragen kein BT). Geprüft wird nicht
// "kommt irgendwo vor", sondern "kommt auf jeder einzelnen Seite vor" — sonst
// fällt ein Fehler auf Seite 1 nicht auf, solange die letzte Seite stimmt.
const textStreams = (buf) => [...buf.toString('latin1').matchAll(/stream\n([\s\S]*?)\nendstream/g)]
  .map((m) => m[1]).filter((t) => /BT /.test(t));
const wb = buildWochenberichtPdf(daten, { logo: marke.logo, fotos: [], berichtNr: 'WB-PROBE', branding: marke });
const seiten = textStreams(wb);
ok(seiten.length >= 2, `mehrseitig (${seiten.length} Seiten)`);
ok(seiten.every((st) => st.includes('george-solutions.ch')), 'Firmenzeile aus gs_branding auf jeder Seite');
ok(seiten.every((st, i) => st.includes(`Seite ${i + 1} von ${seiten.length}`)), 'Seitenzahl auf jeder Seite, richtig gezählt');
// Eine einzeln ausgedruckte Seite muss zuordenbar bleiben.
ok(seiten.every((st, i) => st.includes(`WB-PROBE \\267 Seite ${i + 1} von`)), 'Berichtsnummer steht im Fuss jeder Seite, neben der Seitenzahl');
ok(seiten.every((st) => /BT \/F2 6\.8 Tf/.test(st)), 'Fusskennung kleiner gesetzt als die Firmenzeile (7.5)');
ok(seiten.slice(1).every((st) => st.includes('WB-PROBE')), 'Folgeseiten tragen die Berichtsnummer im Kopf');

console.log('\n── Berichtstyp in der Akzentfarbe ───────────────────────');
const kopfOps = seiten[0];
ok(/0\.788 0\.663 0\.380 rg BT \/F1 18 Tf/.test(kopfOps), '"Wochenbericht" steht in Gold, nicht in Weiss');
ok(/0\.72 0\.72 0\.72 rg BT \/F2 8\.5 Tf/.test(kopfOps), 'Nummer/KW darunter bleiben gedämpftes Weiss');

console.log('\n── Seitenausgleich ─────────────────────────────────────');
// Ein Dokument, dessen Rest ohne Ausgleich als Handvoll Zeilen auf der letzten
// Seite landet. Der Ausgleich muss den Bruch nach oben ziehen, ohne eine
// zusätzliche Seite zu erzeugen.
const probeBloecke = [];
for (let i = 1; i <= 9; i++) {
  probeBloecke.push({ t: 'h2', text: `Abschnitt ${i}` });
  probeBloecke.push({ t: 'table', size: 8.5, cols: [{ w: 100, label: 'A' }, { w: 100, label: 'B' }], rows: [['x' + i, 'y' + i]] });
}
const bau = (bal) => buildPdf({ style: 'brief', balance: bal, branding: marke, title: 'Probe', footer: 'PR-1', blocks: probeBloecke });
const tiefstes = (buf) => {
  const st = textStreams(buf).slice(-1)[0];
  const ys = [...st.matchAll(/ (\d+\.\d+) Td/g)].map((m) => +m[1]).filter((v) => v > 100);
  return ys.length ? Math.min(...ys) : 999;
};
const ohne = bau(false), mit = bau(true);
ok(textStreams(ohne).length === textStreams(mit).length, 'Ausgleich kostet keine zusätzliche Seite');
ok(tiefstes(mit) < tiefstes(ohne) - 40, `letzte Seite trägt mehr (y ${tiefstes(ohne).toFixed(0)} → ${tiefstes(mit).toFixed(0)})`);
ok(tiefstes(bau(true)) === tiefstes(mit), 'Ausgleich ist deterministisch');
// Der Ausgleich darf die VORDEREN Seiten nicht ausdünnen. Ohne diese Bedingung
// landete WB-NIE-2026-31 bei 0.66/0.72: rechnerisch ausgewogen, aber Seite 1
// brach nach einer einzigen Tageszeile ab.
const ersteSeiteEnde = (buf) => {
  const st = textStreams(buf)[0];
  const ys = [...st.matchAll(/ (\d+\.\d+) Td/g)].map((m) => +m[1]).filter((v) => v > 100);
  return ys.length ? Math.min(...ys) : 999;
};
ok(ersteSeiteEnde(mit) < 300, `Seite 1 bleibt gut gefüllt (endet bei y ${ersteSeiteEnde(mit).toFixed(0)})`);

console.log(fail ? `\n✗ ${fail} FEHLER · ${pass} Prüfungen bestanden` : `\n✓ ALLE ${pass} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
