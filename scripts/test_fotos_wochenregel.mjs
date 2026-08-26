// scripts/test_fotos_wochenregel.mjs — Abnahme der Wochenregel fuer Fotos ohne Tag.
//
// RUFT NUR LESENDE WEGE: sammleWochendaten (Wochenbericht) und fotodokuVorschau
// (Fotodokumentation). erzeugeBericht und erzeugeFotodoku bleiben aussen vor —
// die legen Berichtskoepfe an und schreiben PDFs in den Storage.
// gs_tagesrapporte wird ausschliesslich gelesen, das Altfeld status nicht angefasst.
//
//   node --env-file=.env.local scripts/test_fotos_wochenregel.mjs
import {
  sammleWochendaten, fotodokuVorschau, fotoWochenurteil, wochenMitStunden, isoWocheVonDatum,
} from '../lib/wochenbericht.js';

const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}` };
const g = async (p) => {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: H });
  if (!r.ok) throw new Error(`${p} → ${r.status}`);
  return r.json();
};

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };

// ── 1. Einheitentests des Urteils ─────────────────────────────────────────
const W = (a) => new Set(a);
ok(fotoWochenurteil({ wochen: W(['2026-34']), jahr: 2026, woche: 34 }).zeigen === true, 'eine Woche, dieselbe → zeigen');
ok(fotoWochenurteil({ wochen: W(['2026-34']), jahr: 2026, woche: 35 }).grund === 'andere_woche', 'eine Woche, andere → andere_woche');
ok(fotoWochenurteil({ wochen: W(['2026-34', '2026-35']), jahr: 2026, woche: 34 }).zeigen === false, 'mehrere Wochen → nicht zeigen');
ok(fotoWochenurteil({ wochen: W(['2026-34', '2026-35']), jahr: 2026, woche: 34 }).grund === 'mehrdeutig', 'mehrere Wochen → mehrdeutig');
ok(fotoWochenurteil({ wochen: W([]), jahr: 2026, woche: 34 }).grund === 'keine_stunden', 'keine Woche → keine_stunden');
ok(fotoWochenurteil({ wochen: W(['2026-05']), jahr: 2026, woche: 5 }).zeigen === true, 'einstellige Woche stimmt (Nullpolsterung)');

// ── 2. Datenlage einsammeln ───────────────────────────────────────────────
const projekte = await g('gs_projekte?select=id,projektnummer,name&limit=1000');
const medien = await g('gs_projekt_medien?select=projekt_id,tagesrapport_id,medientyp&limit=5000');
const zeilen = await g('gs_tagesrapporte?select=projekt_id,datum,gesamtstunden&limit=5000');

const fotosJeProjekt = {}, ohneTagJeProjekt = {};
for (const m of medien) {
  if (m.medientyp !== 'foto' || !m.projekt_id) continue;
  fotosJeProjekt[m.projekt_id] = (fotosJeProjekt[m.projekt_id] || 0) + 1;
  if (!m.tagesrapport_id) ohneTagJeProjekt[m.projekt_id] = (ohneTagJeProjekt[m.projekt_id] || 0) + 1;
}

// Zu pruefen sind alle Projekte mit Fotos, in allen Wochen, in denen sie
// Tageszeilen haben — plus die Wochen davor/danach, damit auffaellt, wenn ein
// Foto in einer fremden Woche auftaucht.
const wochenJeProjekt = {};
for (const z of zeilen) {
  if (!z.projekt_id || !z.datum) continue;
  const { jahr, woche } = isoWocheVonDatum(z.datum);
  if (!jahr) continue;
  (wochenJeProjekt[z.projekt_id] = wochenJeProjekt[z.projekt_id] || new Set()).add(`${jahr}-${woche}`);
}

const paare = [];
for (const pid of Object.keys(fotosJeProjekt)) {
  const set = wochenJeProjekt[pid] || new Set();
  const kws = [...set];
  if (!kws.length) kws.push('2026-34');                 // Projekt ohne Tageszeilen: eine Woche zur Probe
  for (const k of kws) {
    const [jahr, woche] = k.split('-').map(Number);
    paare.push({ pid, jahr, woche });
  }
}
paare.sort((a, b) => {
  const na = (projekte.find((p) => p.id === a.pid) || {}).projektnummer || '';
  const nb = (projekte.find((p) => p.id === b.pid) || {}).projektnummer || '';
  return String(na).localeCompare(String(nb)) || a.woche - b.woche;
});

// ── 3. Abnahmetabelle ─────────────────────────────────────────────────────
const zeile = (c) => c.map((x, i) => String(x).padEnd([16, 6, 9, 9, 9, 9, 30][i])).join(' ');
console.log('\nABNAHME — Fotozahlen je Projekt und Kalenderwoche');
console.log(zeile(['Projektnr', 'KW', 'WB Tag', 'WB ges.', 'FD ges.', 'ohne Zu.', 'Befund']));
console.log('-'.repeat(96));

const stunden = await wochenMitStunden(Object.keys(fotosJeProjekt));

for (const { pid, jahr, woche } of paare) {
  const p = projekte.find((x) => x.id === pid) || {};
  const nr = p.projektnummer || 'ohne Nummer';

  const wb = await sammleWochendaten({ quelle: 'projekt', projektId: pid, jahr, woche });
  const fd = await fotodokuVorschau({ projektId: pid, jahr, woche });

  const wbTag = (wb.fotos || []).length;
  const wbOhneTag = (wb.fotos_ohne_tag || []).length;
  const wbGesamt = wbTag + wbOhneTag;
  const wbOz = (wb.fotos_ohne_zuordnung || {}).anzahl || 0;

  const fdGesamt = fd.gesamt;
  const fdOz = (fd.ohne_zuordnung || {}).anzahl || 0;

  const befund = [];
  if (wbGesamt !== fdGesamt) befund.push(`FEHLER Fotozahl ${wbGesamt} ≠ ${fdGesamt}`);
  if (wbOz !== fdOz) befund.push(`FEHLER ohne Zuordnung ${wbOz} ≠ ${fdOz}`);
  // Nichts darf verschwinden: gezeigt + gemeldet = alle Fotos ohne Tag am Projekt,
  // solange keine Fotos an Tageszeilen haengen.
  const alleOhneTag = ohneTagJeProjekt[pid] || 0;
  if (wbOhneTag + wbOz !== alleOhneTag) befund.push(`FEHLER Bilanz ${wbOhneTag}+${wbOz} ≠ ${alleOhneTag}`);
  // Regel b: mehrere Wochen mit Stunden ⇒ kein Bild ohne Tag im Dokument.
  const nWochen = (stunden.get(pid) || new Set()).size;
  if (nWochen > 1 && wbOhneTag > 0) befund.push('FEHLER Regel b verletzt');

  ok(wbGesamt === fdGesamt, `${nr} KW${woche}: Fotozahl ${wbGesamt} vs ${fdGesamt}`);
  ok(wbOz === fdOz, `${nr} KW${woche}: ohne Zuordnung ${wbOz} vs ${fdOz}`);
  ok(wbOhneTag + wbOz === alleOhneTag, `${nr} KW${woche}: Bilanz`);
  ok(!(nWochen > 1 && wbOhneTag > 0), `${nr} KW${woche}: Regel b`);

  console.log(zeile([nr, 'KW' + woche, wbTag, wbGesamt, fdGesamt, wbOz,
    befund.length ? befund.join(' · ') : '✓ gleich']));
}

console.log('-'.repeat(96));
console.log(`\n${pass} Prüfungen bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
