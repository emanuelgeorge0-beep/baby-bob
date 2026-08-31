// scripts/test_wochenprojekte.mjs — Ziel 5 der Nachtrunde vom 24.08.2026.
//
//   node --env-file=.env.local scripts/test_wochenprojekte.mjs
//
// Sammelerzeugung des Wochenberichts direkt aus der Wochenrapport-Liste.
// Geprueft wird die Datengrundlage (wochenProjekte) und der Bericht selbst:
//
//   • KW 34 hat vier Projekte und muss in Summe 40.00 h / CHF 150.00 zeigen.
//   • Der Zustand 'verrechnet' darf das Erzeugen NICHT blockieren — KW 29 und
//     KW 30 sind verrechnet und muessen trotzdem einen Bericht liefern.
//   • KW 32 und 33 (Ferien) liefern keine Projekte und dafuer einen Grund im
//     Klartext, statt eines leeren Ergebnisses.
//
// Rein lesend bis auf den Berichtskopf, den erzeugeBericht ohnehin anlegt bzw.
// wiederverwendet. Keine Tageszeile wird angefasst, kein Schema geaendert.

import { wochenProjekte } from '../api/wochenbericht.js';
import { erzeugeBericht } from '../lib/wochenbericht.js';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_KEY;
const TECH = 'ee46a716-7017-4045-9f67-fe06d05171e7';
const MASTER = TECH;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
if (!URL_ || !KEY) { console.log('SUPABASE_URL/SUPABASE_KEY fehlen — mit --env-file=.env.local starten.'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const g = async (p) => (await fetch(`${URL_}/rest/v1/${p}`, { headers: H })).json();

const wr = await g(`gs_wochenrapporte?select=id,jahr,woche&jahr=eq.2026&techniker_user_id=eq.${TECH}&order=woche.asc`);
const idVon = {};
for (const x of wr) idVon[x.woche] = x.id;
ok(Object.keys(idVon).length >= 6, `Wochenrapporte gefunden (KW ${Object.keys(idVon).join(', ')})`);

// ── 1. KW 34: vier Projekte, Summen stimmen ────────────────────────────────
console.log('\n── 1. KW 34 · vier Projekte in einer Woche ────────────────');
const d34 = await wochenProjekte(idVon[34]);
ok(d34.projekte.length === 4, `vier Projekte gefunden (${d34.projekte.length})`);
const nummern = d34.projekte.map((p) => p.projektnummer).sort();
ok(JSON.stringify(nummern) === JSON.stringify(['60060.00', '60133.00', '60586.00', '60829.00']),
  `die erwarteten vier: ${nummern.join(', ')}`);
ok(Math.abs(d34.summen.stunden - 40.00) < 0.005, `Stundensumme ${d34.summen.stunden.toFixed(2)} h (erwartet 40.00)`);
ok(Math.abs(d34.summen.spesen - 150.00) < 0.005, `Spesensumme CHF ${d34.summen.spesen.toFixed(2)} (erwartet 150.00)`);
const summeProjekte = d34.projekte.reduce((a, p) => a + p.stunden, 0);
ok(Math.abs(summeProjekte - 40.00) < 0.005, `Die vier Projekte ergeben zusammen ${summeProjekte.toFixed(2)} h`);
ok(d34.grund === null, 'Kein Hinderungsgrund gemeldet');

// Spesen sind je Kalendertag gezaehlt, nicht je Zeile — 10 Zeilen, 5 Arbeitstage.
ok(d34.summen.zeilen === 10, `10 Tageszeilen an 7 Kalendertagen (${d34.summen.zeilen})`);
ok(d34.summen.spesen < d34.summen.zeilen * 30, 'Spesen sind NICHT je Zeile summiert worden');

// ── 2. Jeder der vier Berichte laesst sich erzeugen ────────────────────────
console.log('\n── 2. KW 34 · alle vier Berichte erzeugen ─────────────────');
let std = 0, sp = 0;
for (const p of d34.projekte) {
  const r = await erzeugeBericht({ projektId: p.id, jahr: 2026, woche: 34, userId: MASTER });
  const s = r.daten.summen;
  std += Number(s.stunden || 0); sp += Number(s.spesen || 0);
  ok(r.pdf && r.pdf.length > 800, `${p.projektnummer}: PDF erzeugt (${Math.round(r.pdf.length / 1024)} KB, ${Number(s.stunden).toFixed(2)} h)`);
}
ok(Math.abs(std - 40.00) < 0.005, `Summe der vier Berichte: ${std.toFixed(2)} h (erwartet 40.00)`);
ok(Math.abs(sp - 150.00) < 0.005, `Summe der vier Berichte: CHF ${sp.toFixed(2)} (erwartet 150.00)`);

// ── 3. 'verrechnet' blockiert das Erzeugen nicht ───────────────────────────
console.log('\n── 3. Verrechnete Wochen bleiben abrufbar ─────────────────');
for (const kw of [29, 30]) {
  const d = await wochenProjekte(idVon[kw]);
  ok(d.projekte.length > 0, `KW ${kw} liefert ${d.projekte.length} Projekt(e)`);
  ok(d.projekte.every((p) => p.abrechnung === 'verrechnet'), `KW ${kw} ist als verrechnet ausgewiesen`);
  const r = await erzeugeBericht({ projektId: d.projekte[0].id, jahr: 2026, woche: kw, userId: MASTER });
  ok(r.pdf && r.pdf.length > 800, `KW ${kw}: Bericht trotz 'verrechnet' erzeugt (${Math.round(r.pdf.length / 1024)} KB)`);
}

// ── 4. KW 32/33 (Ferien): kein Projekt, aber ein Grund ─────────────────────
console.log('\n── 4. KW 32/33 · warum kein Wochenbericht moeglich ist ────');
for (const kw of [32, 33]) {
  const d = await wochenProjekte(idVon[kw]);
  ok(d.projekte.length === 0, `KW ${kw} hat kein Projekt`);
  ok(typeof d.grund === 'string' && d.grund.length > 20, `KW ${kw} nennt den Grund im Klartext`);
  ok(/Abwesenheit/i.test(d.grund), `KW ${kw}: "${d.grund.slice(0, 62)}…"`);
  ok(d.summen.zeilen === 7, `KW ${kw} hat 7 Tageszeilen — sie sind da, nur ohne Baustelle`);
}

// ── 5. Der Grund nennt nichts Technisches ──────────────────────────────────
console.log('\n── 5. Klartext ohne ids, Tabellen, Spalten ────────────────');
const verboten = /gs_[a-z_]+|projekt_id|techniker_user_id|tagesrapport|wochenrapport_id|[0-9a-f]{8}-[0-9a-f]{4}/i;
for (const kw of [32, 33]) {
  const d = await wochenProjekte(idVon[kw]);
  ok(!verboten.test(d.grund), `KW ${kw}: Grund ohne Technik`);
}

console.log(`\n${fail} failed, ${pass} passed`);
console.log(fail ? `✗ ${fail} FEHLER · ${pass} Pruefungen bestanden` : `✓ ALLE ${pass} Pruefungen bestanden`);
process.exit(fail ? 1 : 0);
