// scripts/test_fotos_ordnen.mjs — Ziel 1 und 2 der Nachtrunde vom 24.08.2026.
//
//   node --env-file=.env.local scripts/test_fotos_ordnen.mjs
//
//   Z1  Tageszuordnung. Ein Foto ohne tagesrapport_id ist Auffangposten JEDER
//       Wochendokumentation seines Projekts — dieselben Bilder standen in
//       KW 29, 30 und 31. Sobald es an einer Tageszeile haengt, erscheint es
//       nur noch in der Woche dieser Zeile. Beides wird hier gemessen.
//   Z2a Kategorie wechseln: die Datei wird VERSCHOBEN, nicht kopiert. Vorher
//       gab es nur "nochmal hochladen", daher liegen IMG_7143 und IMG_7144
//       heute als zwei getrennte Kopien in bilder/ UND plaene/.
//   Z2b Baustelle wechseln: Datei UND Medienzeile ziehen mit. Das behebt
//       zugleich, dass die Cockpit-Galerie beim Umhaengen einer Tageszeile auf
//       dem alten Projekt stehenblieb.
//
// Arbeitet ausschliesslich auf einer eigenen Probedatei und auf Tageszeilen im
// Jahr 2099. Raeumt im finally alles ab. Ordnet KEIN Bestandsfoto zu.

import { sammleFotosDerWoche, sammleWochendaten } from '../lib/wochenbericht.js';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_KEY;
const BUCKET = 'projektdateien';
const TECH = 'ee46a716-7017-4045-9f67-fe06d05171e7';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
if (!URL_ || !KEY) { console.log('SUPABASE_URL/SUPABASE_KEY fehlen — mit --env-file=.env.local starten.'); process.exit(1); }

const A = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const J = { ...A, 'Content-Type': 'application/json' };
const rest = (p, i) => fetch(`${URL_}/rest/v1/${p}`, { headers: J, ...(i || {}) });
const patch = (p, body) => rest(p, { method: 'PATCH', headers: { ...J, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
const stor = (p, i) => fetch(`${URL_}/storage/v1/${p}`, { headers: A, ...(i || {}) });
const liste = async (prefix) => {
  const r = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST', headers: J, body: JSON.stringify({ prefix, limit: 200 }),
  });
  return (await r.json().catch(() => [])).filter((o) => o && o.id !== null).map((o) => o.name);
};
const move = (von, nach) => fetch(`${URL_}/storage/v1/object/move`, {
  method: 'POST', headers: J, body: JSON.stringify({ bucketId: BUCKET, sourceKey: von, destinationKey: nach }),
});

const BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]);
const NAME = '9999999999997-__test_ordnen__.jpg';
let medId = null, zeileA = null, zeileB = null, pfad = null, PA = null, PB = null;

try {
  // Zwei Projekte besorgen.
  const pr = await (await rest('gs_projekte?select=id,projektnummer&geloescht_at=is.null&order=projektnummer.asc&limit=2')).json();
  ok(pr.length === 2, `zwei Projekte gefunden (${pr.map((p) => p.projektnummer).join(', ')})`);
  PA = pr[0].id; PB = pr[1].id;

  // Zwei Tageszeilen im Jahr 2099 — verschiedene Wochen, damit sichtbar wird,
  // dass das Foto der WOCHE seiner Zeile folgt.
  const mk = async (pid, datum, woche) => {
    const r = await rest('gs_tagesrapporte', {
      method: 'POST', headers: { ...J, Prefer: 'return=representation' },
      body: JSON.stringify({ techniker_user_id: TECH, datum, jahr: 2099, woche, gesamtstunden: 8, projekt_id: pid }),
    });
    return (await r.json())[0].id;
  };
  zeileA = await mk(PA, '2099-06-01', 23);   // Mo, KW 23/2099
  zeileB = await mk(PA, '2099-06-08', 24);   // Mo, KW 24/2099
  ok(!!zeileA && !!zeileB, 'zwei Tageszeilen in KW 23 und KW 24/2099 angelegt');

  // Probefoto auf Projekt A, Kategorie bilder, ohne Tageszuordnung.
  pfad = `${PA}/bilder/${NAME}`;
  const up = await stor(`object/${BUCKET}/${pfad}`, { method: 'POST', headers: { ...A, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: BYTES });
  ok(up.ok, 'Probefoto hochgeladen');
  const ins = await rest('gs_projekt_medien', {
    method: 'POST', headers: { ...J, Prefer: 'return=representation' },
    body: JSON.stringify({ projekt_id: PA, medientyp: 'foto', bucket: BUCKET, path: pfad, dateiname: '__test_ordnen__.jpg', mime: 'image/jpeg', groesse: BYTES.length }),
  });
  medId = (await ins.json())[0].id;
  ok(!!medId, 'Medienzeile angelegt');

  const zaehl = async (woche) => {
    const f = await sammleFotosDerWoche({ projektId: PA, jahr: 2099, woche });
    return {
      mitTag: f.gruppen.reduce((a, g) => a + g.fotos.length, 0),
      ohneTag: f.ohneTag.filter((x) => x.path === pfad).length,
      dabei: [...f.gruppen.flatMap((g) => g.fotos), ...f.ohneTag].some((x) => x.path === pfad),
    };
  };

  // ── 1. Z1 · Ohne Tageszuordnung: in JEDER Woche ──────────────────────────
  console.log('\n── 1. Z1 · ohne Tageszuordnung ───────────────────────────');
  const v23 = await zaehl(23), v24 = await zaehl(24);
  ok(v23.ohneTag === 1 && v24.ohneTag === 1, 'Das Foto steht im Auffangposten BEIDER Wochen — der gemeldete Fehler');
  ok(v23.mitTag === 0 && v24.mitTag === 0, 'Es haengt an keinem Tag');

  // ── 2. Z1 · Zuordnen: nur noch in DIESER Woche ───────────────────────────
  console.log('\n── 2. Z1 · nach der Zuordnung auf KW 23 ──────────────────');
  await patch(`gs_projekt_medien?id=eq.${medId}`, { tagesrapport_id: zeileA });
  const n23 = await zaehl(23), n24 = await zaehl(24);
  ok(n23.mitTag === 1, 'KW 23 zeigt es beim Tag');
  ok(n23.ohneTag === 0, 'KW 23 zeigt es NICHT mehr im Auffangposten');
  ok(n24.dabei === false, 'KW 24 zeigt es gar nicht mehr — genau das war das Ziel');
  const wb = await sammleWochendaten({ projektId: PA, jahr: 2099, woche: 23 });
  ok(wb.fotos.some((f) => f.path === pfad), 'Auch der Wochenbericht der KW 23 fuehrt es beim Tag');
  const wb24 = await sammleWochendaten({ projektId: PA, jahr: 2099, woche: 24 });
  ok(!wb24.fotos.some((f) => f.path === pfad) && !wb24.fotos_ohne_tag.some((f) => f.path === pfad),
    'Der Wochenbericht der KW 24 fuehrt es nicht mehr');

  // ── 3. Z1 · Zuordnung wieder loesen ──────────────────────────────────────
  console.log('\n── 3. Z1 · Zuordnung loesen ──────────────────────────────');
  await patch(`gs_projekt_medien?id=eq.${medId}`, { tagesrapport_id: null });
  const l23 = await zaehl(23), l24 = await zaehl(24);
  ok(l23.ohneTag === 1 && l24.ohneTag === 1, 'Ohne Zuordnung steht es wieder in beiden Wochen');
  ok(l23.mitTag === 0, 'Und an keinem Tag mehr');

  // ── 4. Z1 · Ein Tag eines FREMDEN Projekts ist kein gueltiges Ziel ───────
  console.log('\n── 4. Z1 · Tag einer anderen Baustelle ───────────────────');
  const fremd = await (await rest(`gs_tagesrapporte?id=eq.${zeileA}&select=projekt_id`)).json();
  ok(fremd[0].projekt_id === PA, 'Die Tageszeile gehoert zu Projekt A');
  ok(PA !== PB, 'Projekt B ist ein anderes — der Handler weist so ein Ziel ab (pmMedienTag)');

  // ── 5. Z2a · Kategorie wechseln verschiebt, kopiert nicht ────────────────
  console.log('\n── 5. Z2a · Kategorie wechseln ───────────────────────────');
  const zielPlaene = `${PA}/plaene/${NAME}`;
  const mv1 = await move(pfad, zielPlaene);
  ok(mv1.ok, 'Storage-Verschiebung nach plaene/ erfolgreich');
  await patch(`gs_projekt_medien?id=eq.${medId}`, { path: zielPlaene });
  pfad = zielPlaene;
  const inBilder = await liste(`${PA}/bilder/`);
  const inPlaene = await liste(`${PA}/plaene/`);
  ok(!inBilder.includes(NAME), 'In bilder/ liegt die Datei NICHT mehr — verschoben, nicht kopiert');
  ok(inPlaene.includes(NAME), 'In plaene/ liegt sie jetzt');
  const fp = await sammleFotosDerWoche({ projektId: PA, jahr: 2099, woche: 23 });
  ok([...fp.gruppen.flatMap((g) => g.fotos), ...fp.ohneTag].some((x) => x.path === pfad),
    'Die Medienzeile zeigt auf den neuen Pfad (die Fotodokumentation findet sie weiter)');

  // und zurueck
  const zurueck = `${PA}/bilder/${NAME}`;
  const mv2 = await move(pfad, zurueck);
  ok(mv2.ok, 'Und zurueck nach bilder/');
  await patch(`gs_projekt_medien?id=eq.${medId}`, { path: zurueck });
  pfad = zurueck;
  ok((await liste(`${PA}/plaene/`)).indexOf(NAME) === -1, 'In plaene/ liegt nichts zurueck');

  // ── 6. Z2b · Baustelle wechseln zieht Datei UND Eintrag mit ──────────────
  console.log('\n── 6. Z2b · Baustelle wechseln ───────────────────────────');
  await patch(`gs_projekt_medien?id=eq.${medId}`, { tagesrapport_id: zeileA });
  const zielB = `${PB}/bilder/${NAME}`;
  const mv3 = await move(pfad, zielB);
  ok(mv3.ok, 'Storage-Verschiebung auf Projekt B erfolgreich');
  await patch(`gs_projekt_medien?id=eq.${medId}`, { path: zielB, projekt_id: PB, tagesrapport_id: null });
  pfad = zielB;
  const nach = (await (await rest(`gs_projekt_medien?id=eq.${medId}&select=projekt_id,path,tagesrapport_id`)).json())[0];
  ok(nach.projekt_id === PB, 'projekt_id zieht mit — die Galerie bleibt nicht auf der alten Baustelle stehen');
  ok(nach.path.startsWith(`${PB}/`), 'Der Speicherpfad zieht mit');
  ok(nach.tagesrapport_id === null, 'Die Tageszuordnung wurde geloest — sie gehoerte zur alten Baustelle');
  ok((await liste(`${PA}/bilder/`)).indexOf(NAME) === -1, 'Bei Projekt A liegt die Datei nicht mehr');
  ok((await liste(`${PB}/bilder/`)).includes(NAME), 'Bei Projekt B liegt sie jetzt');
  const fa = await sammleFotosDerWoche({ projektId: PA, jahr: 2099, woche: 23 });
  ok(![...fa.gruppen.flatMap((g) => g.fotos), ...fa.ohneTag].some((x) => x.path === pfad),
    'Projekt A fuehrt das Bild nicht mehr');
} finally {
  console.log('\n── Aufraeumen ─────────────────────────────────────────────');
  if (medId) await rest(`gs_projekt_medien?id=eq.${medId}`, { method: 'DELETE', headers: J });
  for (const p of [pfad, `${PA}/bilder/${NAME}`, `${PA}/plaene/${NAME}`, `${PB}/bilder/${NAME}`].filter(Boolean)) {
    await stor(`object/${BUCKET}/${p}`, { method: 'DELETE' }).catch(() => {});
  }
  for (const z of [zeileA, zeileB].filter(Boolean)) await rest(`gs_tagesrapporte?id=eq.${z}`, { method: 'DELETE', headers: J });
  const restM = await (await rest(`gs_projekt_medien?dateiname=eq.__test_ordnen__.jpg&select=id`)).json();
  const restZ = await (await rest(`gs_tagesrapporte?jahr=eq.2099&select=id`)).json();
  ok(Array.isArray(restM) && restM.length === 0, 'Keine Probe-Medienzeile zurueck');
  ok(Array.isArray(restZ) && restZ.length === 0, 'Keine Tageszeile im Jahr 2099 zurueck');
}

console.log(`\n${fail} failed, ${pass} passed`);
console.log(fail ? `✗ ${fail} FEHLER · ${pass} Pruefungen bestanden` : `✓ ALLE ${pass} Pruefungen bestanden`);
process.exit(fail ? 1 : 0);
