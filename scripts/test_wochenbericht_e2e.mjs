// scripts/test_wochenbericht_e2e.mjs — Ende-zu-Ende gegen die LIVE-DB.
//
// Der vollständige Weg an ECHTEN Daten: Projekt P-2026-3470, echte KW, echte
// Tageszeilen. Weil gs_tagesrapport_taetigkeitenkatalog und gs_projekt_medien
// live noch leer sind, legt der Test dort Zeilen an, rendert den Bericht und
// LÖSCHT SIE WIEDER — inklusive der hochgeladenen Bilder im Storage.
//
// Angefasst und wieder hergestellt:
//   gs_tagesrapport_taetigkeitenkatalog  (INSERT → DELETE)
//   gs_projekt_medien                    (INSERT → DELETE)
//   Storage projektdateien/wochenbericht-e2e/…  (Upload → DELETE)
//   gs_wochenberichte                    (INSERT → DELETE)
// NIEMALS geschrieben: gs_tagesrapporte (nur gelesen). Insbesondere bleibt das
// Altfeld gs_tagesrapporte.status unberührt.
//
// Das Aufräumen läuft in finally und wird am Ende nachgezählt: bricht der Test
// mitten drin ab, bleibt trotzdem nichts liegen.
//
//   node --env-file=.env.local scripts/test_wochenbericht_e2e.mjs
//   PDF_TEST_OUT=/tmp node --env-file=.env.local scripts/test_wochenbericht_e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import { erzeugeBericht, sammleWochendaten } from '../lib/wochenbericht.js';

const PROJEKT = '64c695d5-0ef7-4864-9951-ed7163a92791';   // P-2026-3470, Langstrasse 149
const JAHR = 2026, WOCHE = 31;                            // echte Woche mit echten Zeilen
const FOTO_DIR = process.env.E2E_FOTO_DIR || null;        // 8 JPEGs; ohne das wird das Logo vervielfacht
const OUT = process.env.PDF_TEST_OUT || null;
const PREFIX = 'wochenbericht-e2e';

const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };
const H_STORAGE = { apikey: K, Authorization: `Bearer ${K}` };   // ohne Content-Type, s.u.

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };
const g = async (p) => (await fetch(`${U}/rest/v1/${p}`, { headers: H })).json();
const post = async (t, body) => {
  const r = await fetch(`${U}/rest/v1/${t}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`INSERT ${t}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

const angelegt = { taet: [], medien: [], storage: [], berichte: [] };

try {
  // ── Ausgangszustand festhalten ───────────────────────────────────────────
  const vorher = {
    taet: (await g('gs_tagesrapport_taetigkeitenkatalog?select=id')).length,
    medien: (await g('gs_projekt_medien?select=id')).length,
    rapporte: (await g('gs_tagesrapporte?select=id')).length,
    berichte: (await g('gs_wochenberichte?select=id')).length,
  };
  console.log('── Ausgangszustand ──────────────────────────────────────');
  console.log(`  Tätigkeiten ${vorher.taet} · Medien ${vorher.medien} · Tagesrapporte ${vorher.rapporte} · Berichte ${vorher.berichte}`);

  const zeilen = await g(`gs_tagesrapporte?projekt_id=eq.${PROJEKT}&datum=gte.2026-07-27&datum=lte.2026-08-02&select=id,datum,gesamtstunden&order=datum.asc`);
  ok(zeilen.length === 7, `7 echte Tageszeilen gefunden (sind ${zeilen.length})`);
  const arbeitstage = zeilen.filter((z) => Number(z.gesamtstunden) > 0);
  ok(arbeitstage.length === 5, `5 Arbeitstage (sind ${arbeitstage.length})`);

  // ── Tätigkeiten aus dem ECHTEN Katalog anhängen ──────────────────────────
  console.log('\n── Tätigkeiten anlegen (echter Katalog) ─────────────────');
  const katalog = await g('gs_taetigkeitenkatalog?select=id,slug,bezeichnung,detailfelder&gewerk=eq.sanitaer&aktiv=is.true&order=sortierung.asc&limit=10');
  ok(katalog.length >= 4, `Katalog liefert ${katalog.length} Sanitär-Positionen`);
  const detailFuer = (felder, i) => {
    const d = {};
    for (const f of (felder || [])) {
      if (f === 'DN') d.DN = String([15, 20, 25, 32, 56][i % 5]);
      else if (f === 'M') d.M = String(3 + i * 2);
      else if (f === 'STK') d.STK = String(1 + (i % 4));
      else if (f === 'ORT') d.ORT = ['EG', '1.OG', '2.OG', '3.OG', 'UG'][i % 5];
      else if (f === 'M2') d.M2 = String(4 + i);
      else if (f === 'BAR') d.BAR = '6';
      else if (f === 'TYP') d.TYP = 'Standard';
    }
    return d;
  };
  const taetRows = [];
  arbeitstage.forEach((z, ti) => {
    const anzahl = (ti % 2) + 2;                       // 2–3 Tätigkeiten je Tag
    for (let k = 0; k < anzahl; k++) {
      const kat = katalog[(ti * 2 + k) % katalog.length];
      taetRows.push({
        tagesrapport_id: z.id,
        taetigkeit_id: kat.id,
        bezeichnung_snapshot: kat.bezeichnung,
        details: detailFuer(kat.detailfelder && kat.detailfelder.felder, ti + k),
        sortierung: (k + 1) * 10,
      });
    }
  });
  const taetIns = await post('gs_tagesrapport_taetigkeitenkatalog', taetRows);
  angelegt.taet = taetIns.map((x) => x.id);
  console.log(`  ${taetIns.length} Tätigkeiten an ${arbeitstage.length} Tagen`);
  ok(taetIns.length === taetRows.length, 'alle Tätigkeiten angelegt');
  ok(taetIns.every((x) => x.bezeichnung_snapshot), 'bezeichnung_snapshot überall gefüllt');

  // ── Fotos hochladen und verknüpfen ───────────────────────────────────────
  console.log('\n── Fotos anlegen ────────────────────────────────────────');
  let bilder = [];
  if (FOTO_DIR && fs.existsSync(FOTO_DIR)) {
    bilder = fs.readdirSync(FOTO_DIR).filter((f) => /\.jpe?g$/i.test(f)).sort()
      .map((f) => ({ name: f, buf: fs.readFileSync(path.join(FOTO_DIR, f)) }));
  }
  if (!bilder.length) {
    const logo = fs.readFileSync(new URL('../lib/logo-gs.jpg', import.meta.url));
    bilder = Array.from({ length: 8 }, (_, i) => ({ name: `ersatz${i + 1}.jpg`, buf: logo }));
  }
  ok(bilder.length >= 7, `${bilder.length} Bilder bereit (verschiedene Seitenverhältnisse)`);

  const orte = ['Bad OG', 'Steigzone', 'Küche EG', 'WC EG', 'Technikraum UG', 'Verteiler 1.OG', 'Bad 2.OG', 'Steigzone 3.OG'];
  const medienRows = [];
  for (let i = 0; i < bilder.length; i++) {
    const z = arbeitstage[i % arbeitstage.length];
    const pfad = `${PREFIX}/${PROJEKT}/${i + 1}-${bilder[i].name}`;
    const up = await fetch(`${U}/storage/v1/object/projektdateien/${pfad}`, {
      method: 'POST',
      headers: { ...H_STORAGE, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
      body: bilder[i].buf,
    });
    if (!up.ok) throw new Error(`Upload ${pfad}: ${up.status} ${(await up.text()).slice(0, 120)}`);
    angelegt.storage.push(pfad);
    medienRows.push({
      projekt_id: PROJEKT, tagesrapport_id: z.id, medientyp: 'foto',
      bucket: 'projektdateien', path: pfad, dateiname: bilder[i].name,
      mime: 'image/jpeg', groesse: bilder[i].buf.length,
      stockwerk: orte[i % orte.length].split(' ').pop(), raum: orte[i % orte.length],
      notiz: `E2E-Test ${i + 1}`,
    });
  }
  const medIns = await post('gs_projekt_medien', medienRows);
  angelegt.medien = medIns.map((x) => x.id);
  console.log(`  ${medIns.length} Fotos hochgeladen und an Tageszeilen gehängt`);
  ok(medIns.length === bilder.length, 'alle Medien-Zeilen angelegt');

  // ── Datensammlung sieht beides ───────────────────────────────────────────
  console.log('\n── Datensammlung ────────────────────────────────────────');
  const daten = await sammleWochendaten({ projektId: PROJEKT, jahr: JAHR, woche: WOCHE });
  const mitTaet = daten.tage.filter((t) => t.zeilen.some((z) => z.taetigkeiten.length));
  console.log(`  Tage ${daten.tage.length} · Tage mit Tätigkeiten ${mitTaet.length} · Fotos ${daten.fotos.length} · Stunden ${daten.summen.stunden}`);
  ok(mitTaet.length === 5, `Tätigkeiten an 5 Tagen sichtbar (sind ${mitTaet.length})`);
  ok(daten.fotos.length === bilder.length, `alle ${bilder.length} Fotos zugeordnet`);
  ok(daten.fotos_vorhanden === true, 'fotos_vorhanden = true');
  ok(daten.fotos.every((f) => f.datum), 'jedes Foto trägt das Datum seiner Tageszeile');
  ok(daten.fotos.every((f) => f.ort), 'jedes Foto trägt einen Ort');
  const einTaet = daten.tage.flatMap((t) => t.zeilen).flatMap((z) => z.taetigkeiten)[0];
  ok(einTaet && einTaet.bezeichnung && Object.keys(einTaet.details).length > 0, `Detailfelder da: ${JSON.stringify(einTaet && einTaet.details)}`);

  // ── Bericht erzeugen ─────────────────────────────────────────────────────
  console.log('\n── Bericht erzeugen ─────────────────────────────────────');
  const r = await erzeugeBericht({ projektId: PROJEKT, jahr: JAHR, woche: WOCHE });
  angelegt.berichte.push(r.bericht.id);
  const s = r.pdf.toString('latin1');
  const seiten = parseInt((s.match(/\/Count (\d+)>>/) || [])[1] || '0', 10);
  console.log(`  ${r.bericht.bericht_nr} · ${r.pdf.length} Bytes · ${seiten} Seiten · ${r.fotos_im_pdf} Fotos im PDF`);

  ok(s.startsWith('%PDF-1.4') && s.endsWith('%%EOF'), 'gültiges PDF');
  ok(seiten >= 2, `mehrseitig (${seiten})`);
  ok(r.fotos_im_pdf === 6, `genau 6 Fotos eingebettet, Rest verwiesen (sind ${r.fotos_im_pdf})`);
  ok((s.match(/\/Subtype\/Image/g) || []).length === 7, `6 Fotos + Logo als XObject (sind ${(s.match(/\/Subtype\/Image/g) || []).length})`);
  ok(s.includes('Weitere 2 Foto'), 'die restlichen 2 Fotos werden verwiesen');
  ok(s.includes('Tagesverlauf'), 'Tagesblöcke im Dokument');
  ok(s.includes('Montag') && s.includes('Freitag'), 'Wochentage benannt');
  ok(/DN \d/.test(s), 'Tätigkeiten mit DN-Detailfeld im Dokument');
  ok(s.includes('Einreichstatus'), 'Einreichstatus im Dokument');
  ok(!s.includes('?) Tj'), 'keine unlesbaren Zeichen');
  ok(s.includes('0.788 0.663 0.380 RG'), 'goldene Trennlinie #C9A961 (Regel 6)');
  ok(!s.includes('0.039 0.039 0.043'), 'kein Command-Center-Schwarz (Regel 6)');

  // xref byte-genau
  const sx = s.lastIndexOf('startxref');
  const xs = parseInt(s.slice(sx + 9).trim(), 10);
  const m = s.slice(xs).match(/^xref\n0 (\d+)\n/);
  const body = s.slice(xs + m[0].length + 20);
  let bad = 0;
  for (let i = 0; i < parseInt(m[1], 10) - 1; i++) {
    const off = parseInt(body.slice(i * 20, i * 20 + 10), 10);
    if (s.slice(off, off + `${i + 1} 0 obj`.length) !== `${i + 1} 0 obj`) bad++;
  }
  ok(bad === 0, `xref byte-genau über ${parseInt(m[1], 10) - 1} Objekte`);

  if (OUT) { fs.writeFileSync(path.join(OUT, 'wb-e2e.pdf'), r.pdf); console.log(`  geschrieben: ${path.join(OUT, 'wb-e2e.pdf')}`); }

  // ── gs_tagesrapporte darf sich NICHT verändert haben ─────────────────────
  console.log('\n── Unversehrtheit der Rapporte ──────────────────────────');
  const nachher = await g('gs_tagesrapporte?select=id,status');
  ok(nachher.length === vorher.rapporte, `Tagesrapporte unverändert (${nachher.length})`);
  ok(nachher.every((x) => x.status === 'eingereicht'), 'Altfeld status unberührt');
} finally {
  // ── Aufräumen, komme was wolle ───────────────────────────────────────────
  console.log('\n── Aufräumen ────────────────────────────────────────────');
  for (const id of angelegt.medien) await fetch(`${U}/rest/v1/gs_projekt_medien?id=eq.${id}`, { method: 'DELETE', headers: H }).catch(() => null);
  for (const id of angelegt.taet) await fetch(`${U}/rest/v1/gs_tagesrapport_taetigkeitenkatalog?id=eq.${id}`, { method: 'DELETE', headers: H }).catch(() => null);
  for (const id of angelegt.berichte) await fetch(`${U}/rest/v1/gs_wochenberichte?id=eq.${id}`, { method: 'DELETE', headers: H }).catch(() => null);
  // Storage-DELETE OHNE Content-Type: mit 'application/json' antwortet Supabase
  // 400 ("Body cannot be empty") und die Datei bliebe liegen.
  for (const p of angelegt.storage) await fetch(`${U}/storage/v1/object/projektdateien/${p}`, { method: 'DELETE', headers: H_STORAGE }).catch(() => null);

  const rest = {
    taet: (await g('gs_tagesrapport_taetigkeitenkatalog?select=id')).length,
    medien: (await g('gs_projekt_medien?select=id')).length,
    rapporte: (await g('gs_tagesrapporte?select=id')).length,
    berichte: (await g('gs_wochenberichte?select=id')).length,
  };
  const files = await (await fetch(`${U}/storage/v1/object/list/projektdateien`, {
    method: 'POST', headers: H, body: JSON.stringify({ prefix: `${PREFIX}/${PROJEKT}`, limit: 200 }),
  })).json();
  const reste = Array.isArray(files) ? files.filter((f) => f.id) : [];
  console.log(`  Tätigkeiten ${rest.taet} · Medien ${rest.medien} · Tagesrapporte ${rest.rapporte} · Berichte ${rest.berichte} · Storage-Reste ${reste.length}`);
  ok(rest.taet === 0, `gs_tagesrapport_taetigkeitenkatalog wieder leer (${rest.taet})`);
  ok(rest.medien === 0, `gs_projekt_medien wieder leer (${rest.medien})`);
  ok(rest.berichte === 0, `gs_wochenberichte wieder leer (${rest.berichte})`);
  ok(rest.rapporte === 23, `gs_tagesrapporte unangetastet (${rest.rapporte})`);
  ok(reste.length === 0, `keine Testdateien im Storage (${reste.length})`);

  console.log(`\n${fail === 0 ? '✓ ALLE' : '✗ ' + fail + ' FEHLER ·'} ${pass} Prüfungen bestanden`);
  process.exit(fail ? 1 : 0);
}
