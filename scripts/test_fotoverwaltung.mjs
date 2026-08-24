// scripts/test_fotoverwaltung.mjs — nagelt die vier Befunde der Abendrunde vom
// 24.08.2026 fest (A0 bis A4 der Fotoverwaltung).
//
//   node --env-file=.env.local scripts/test_fotoverwaltung.mjs
//
// Was hier geprueft wird und warum:
//   A0  Fotos ohne Tageszuordnung erscheinen in der Fotodokumentation. Vorher
//       filterte das Auffangnetz zusaetzlich auf created_at BETWEEN von..bis —
//       21 am 24.08. hochgeladene Bilder fielen damit aus der KW 34 heraus und
//       das Dokument kam leer zurueck.
//   A1  Loeschen im Storage. Der Aufruf trug 'Content-Type: application/json'
//       ohne Koerper; Supabase Storage (Fastify) weist das mit 400 ab. Beide
//       Richtungen werden geprueft, damit der Fehler nicht zurueckkommt.
//   A2  Umbenennen. Der Anzeigename lebt in gs_projekt_medien.dateiname, der
//       Speicherpfad bleibt unangetastet, und der neue Name erscheint in der
//       Bildunterschrift der Fotodokumentation.
//   A4  Keine Doppelerfassung: dieselbe Datei unter bilder/ UND plaene/ ergibt
//       trotzdem nur EIN Bild im Dokument.
//
// Legt genau eine Probedatei an (Praefix __test_fotoverwaltung__) und raeumt sie
// im finally wieder ab. Fasst keinen Bestand an.

import { sammleFotosDerWoche, fotoCaption } from '../lib/wochenbericht.js';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_KEY;
const BUCKET = 'projektdateien';
// Nidelbadstrasse / 60133.00 — das Projekt aus dem belegten Fall.
const PROJEKT = 'b6651bc5-ec35-497f-84bd-bad77eaa5373';
const JAHR = 2026, WOCHE = 34;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

if (!URL_ || !KEY) {
  console.log('SUPABASE_URL/SUPABASE_KEY fehlen — mit --env-file=.env.local starten.');
  process.exit(1);
}

const AUTH = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const SB = { ...AUTH, 'Content-Type': 'application/json' };
const rest = (path, init) => fetch(`${URL_}/rest/v1/${path}`, { headers: SB, ...(init || {}) });

// 1x1-JPEG-Rumpf. Es geht nur um Bytes im Bucket, nicht um ein decodierbares Bild.
const PROBE_BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]);
const probePfad = `${PROJEKT}/bilder/9999999999999-__test_fotoverwaltung__.jpg`;
let probeId = null;

try {
  // ── 1. A1 · Storage-Loeschen: der Header entscheidet ──────────────────────
  console.log('\n── 1. A1 · Storage-Loeschen ───────────────────────────────');
  const put = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${probePfad}`, {
    method: 'POST', headers: { ...AUTH, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: PROBE_BYTES,
  });
  ok(put.ok, `Probedatei hochgeladen (${put.status})`);

  const mitCT = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${probePfad}`, { method: 'DELETE', headers: SB });
  const ctText = await mitCT.text().catch(() => '');
  ok(mitCT.status === 400 && /Body cannot be empty/i.test(ctText),
    'MIT Content-Type: 400 "Body cannot be empty" — der urspruengliche Fehler');
  ok(!mitCT.ok, 'MIT Content-Type wird die Datei NICHT geloescht');

  const ohneCT = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${probePfad}`, { method: 'DELETE', headers: AUTH });
  ok(ohneCT.ok, `OHNE Content-Type: geloescht (${ohneCT.status})`);

  const nachher = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST', headers: SB, body: JSON.stringify({ prefix: `${PROJEKT}/bilder/`, limit: 200 }),
  });
  const objs = await nachher.json().catch(() => []);
  ok(Array.isArray(objs) && !objs.some((o) => String(o.name).includes('__test_fotoverwaltung__')),
    'Probedatei ist aus dem Storage verschwunden');

  // ── 2. A2 · Umbenennen laesst den Pfad in Ruhe ────────────────────────────
  console.log('\n── 2. A2 · Anzeigename aendern ────────────────────────────');
  // Erneut hochladen: Abschnitt 1 hat die Datei bewusst geloescht, die naechsten
  // Abschnitte brauchen sie wieder — und das Aufraeumen am Ende soll etwas
  // Echtes zu tun haben statt ins Leere zu greifen.
  const put2 = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${probePfad}`, {
    method: 'POST', headers: { ...AUTH, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: PROBE_BYTES,
  });
  ok(put2.ok, 'Probedatei wieder hochgeladen');
  const ins = await rest('gs_projekt_medien', {
    method: 'POST', headers: { ...SB, Prefer: 'return=representation' },
    body: JSON.stringify({
      projekt_id: PROJEKT, medientyp: 'foto', bucket: BUCKET, path: probePfad,
      dateiname: '__test_fotoverwaltung__.jpg', mime: 'image/jpeg', groesse: PROBE_BYTES.length,
    }),
  });
  const insRows = await ins.json().catch(() => []);
  probeId = (insRows[0] || {}).id || null;
  ok(!!probeId, 'Medienzeile angelegt');

  const pat = await rest(`gs_projekt_medien?path=eq.${encodeURIComponent(probePfad)}`, {
    method: 'PATCH', headers: { ...SB, Prefer: 'return=representation' },
    body: JSON.stringify({ dateiname: 'Steigzone UG vorher' }),
  });
  const patRows = await pat.json().catch(() => []);
  ok(pat.ok && patRows.length === 1, 'Umbenennen trifft genau eine Zeile');
  ok((patRows[0] || {}).path === probePfad, 'Speicherpfad ist unveraendert geblieben');
  ok((patRows[0] || {}).dateiname === 'Steigzone UG vorher', 'Anzeigename ist der neue');

  // ── 3. A2 · Der neue Name steht in der Bildunterschrift ───────────────────
  console.log('\n── 3. A2 · Bildunterschrift der Fotodokumentation ─────────');
  const auto = { path: probePfad, dateiname: '__test_fotoverwaltung__.jpg', datum: '2026-08-19', ort: 'UG · Technikraum' };
  const benannt = { ...auto, dateiname: 'Steigzone UG vorher' };
  ok(fotoCaption(auto) === '19.08.2026 · UG · Technikraum',
    'Automatischer Name (IMG_…) erscheint NICHT — er sagt dem Kunden nichts');
  ok(fotoCaption(benannt).startsWith('Steigzone UG vorher · '),
    'Vergebener Name steht vorn in der Bildunterschrift');
  ok(fotoCaption({ path: probePfad, dateiname: 'Steigzone UG vorher', hochgeladen: '2026-08-24' })
    === 'Steigzone UG vorher · hochgeladen 24.08.2026',
    'Auch ohne Tageszuordnung traegt das Bild seinen Namen');

  // ── 4. A0 · Auffangnetz ohne Zeitfenster ──────────────────────────────────
  console.log('\n── 4. A0 · Fotos ohne Tageszuordnung im Dokument ──────────');
  const q = await sammleFotosDerWoche({ projektId: PROJEKT, jahr: JAHR, woche: WOCHE });
  const mitTag = q.gruppen.reduce((a, g) => a + g.fotos.length, 0);
  ok(q.zeilen.length > 0, `KW ${WOCHE} hat Tageszeilen (${q.zeilen.length})`);
  ok(q.ohneTag.length > 0, `Auffangnetz greift: ${q.ohneTag.length} Foto(s) ohne Tageszuordnung`);
  ok(q.ohneTag.some((f) => f.path === probePfad),
    'Die Probedatei ist dabei — obwohl sie ausserhalb des Wochenfensters liegt');
  const probeImNetz = q.ohneTag.find((f) => f.path === probePfad);
  ok(probeImNetz && probeImNetz.dateiname === 'Steigzone UG vorher',
    'Der vergebene Name reist bis in die Sammelfunktion mit');

  // Ein Projekt ganz OHNE Tageszeilen dieser Woche muss seine Fotos trotzdem
  // liefern — vorher fiel es aus projIds heraus und das Dokument blieb leer.
  const leer = await sammleFotosDerWoche({ projektId: PROJEKT, jahr: 2026, woche: 35 });
  ok(leer.zeilen.length === 0, 'KW 35 hat keine Tageszeilen auf diesem Projekt');
  ok(leer.ohneTag.length > 0, 'Trotzdem findet die Fotodokumentation die Fotos des Projekts');

  // ── 5. A4 · Keine Doppelerfassung ─────────────────────────────────────────
  console.log('\n── 5. A4 · Dieselbe Datei unter bilder/ UND plaene/ ───────');
  const alle = [...q.gruppen.flatMap((g) => g.fotos), ...q.ohneTag];
  const jePfad = {};
  for (const f of alle) jePfad[f.path] = (jePfad[f.path] || 0) + 1;
  ok(!Object.values(jePfad).some((n) => n > 1), 'Kein Pfad erscheint zweimal im Dokument');

  const plaene = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST', headers: SB, body: JSON.stringify({ prefix: `${PROJEKT}/plaene/`, limit: 200 }),
  });
  const planObjs = (await plaene.json().catch(() => [])).filter((o) => o && o.id !== null);
  const doppelt = planObjs
    .map((o) => String(o.name).replace(/^\d{10,}-/, ''))
    .filter((n) => alle.some((f) => f.path.endsWith(`-${n}`)));
  ok(planObjs.length > 0, `plaene/ traegt ${planObjs.length} Datei(en)`);
  ok(doppelt.length > 0, `davon liegen ${doppelt.length} auch unter bilder/ (${doppelt.join(', ')})`);
  const jeName = {};
  for (const f of alle) { const n = f.path.split('/').pop().replace(/^\d{10,}-/, ''); jeName[n] = (jeName[n] || 0) + 1; }
  ok(!doppelt.some((n) => jeName[n] > 1),
    'Sie erscheinen trotzdem nur EINMAL — gs_projekt_medien fuehrt nur die Kategorie bilder');

  // Fotos mit Tageszuordnung und Fotos ohne sind disjunkt (is.null vs in.(ids)).
  const ohneIds = new Set(q.ohneTag.map((f) => f.id));
  ok(!q.gruppen.flatMap((g) => g.fotos).some((f) => ohneIds.has(f.id)),
    'Tagesgebundene Fotos und Auffangposten ueberschneiden sich nicht');
  ok(mitTag + q.ohneTag.length === alle.length, 'Die Zaehlung geht auf');
} finally {
  // ── Aufraeumen ────────────────────────────────────────────────────────────
  console.log('\n── Aufraeumen ─────────────────────────────────────────────');
  if (probeId) {
    const d = await rest(`gs_projekt_medien?id=eq.${probeId}`, { method: 'DELETE', headers: { ...SB, Prefer: 'return=minimal' } });
    ok(d.ok, 'Medienzeile der Probe entfernt');
  }
  const ds = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${probePfad}`, { method: 'DELETE', headers: AUTH });
  ok(ds.ok || ds.status === 404, 'Probedatei im Storage entfernt');
}

console.log(`\n${fail} failed, ${pass} passed`);
console.log(fail ? `✗ ${fail} FEHLER · ${pass} Pruefungen bestanden` : `✓ ALLE ${pass} Pruefungen bestanden`);
process.exit(fail ? 1 : 0);
