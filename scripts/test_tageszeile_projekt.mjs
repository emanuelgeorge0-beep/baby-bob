// scripts/test_tageszeile_projekt.mjs — Ziel 1 (C2) und Ziel 2 der Master-Runde
// vom 24.08.2026.
//
//   node --env-file=.env.local scripts/test_tageszeile_projekt.mjs
//
// Was hier festgenagelt wird:
//   Z1  Der bestehende UNIQUE(projekt_id, techniker_user_id, datum) erlaubt
//       mehrere Projekte je Kalendertag und weist nur das echte Duplikat ab.
//       Kein Schema wird geaendert — der Test belegt nur, dass es so ist.
//   Z1  pgCode() liest 23505 und 23514 aus einem PostgREST-Fehlerkoerper und
//       liefert je eine Klartextmeldung ohne ids, Tabellen- und Spaltennamen.
//   Z2  Die ISO-Wochenrechnung nach dem 4-Januar-Prinzip stimmt an den
//       Jahresgrenzen — dort lag frueher schon einmal ein Rechenfehler.
//
// Legt Wegwerfzeilen im Jahr 2099 an und loescht sie im finally. Fasst keinen
// Bestand an, aendert kein Schema, verschiebt keine echte Tageszeile.

import { isoWochenBereich, isoWocheVonDatum } from '../lib/wochenbericht.js';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_KEY;
const TECH = 'ee46a716-7017-4045-9f67-fe06d05171e7';   // Emanuel, auth uid
const DATUM = '2099-03-02';                            // Montag der KW 10/2099

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

if (!URL_ || !KEY) {
  console.log('SUPABASE_URL/SUPABASE_KEY fehlen — mit --env-file=.env.local starten.');
  process.exit(1);
}
const SB = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const rest = (path, init) => fetch(`${URL_}/rest/v1/${path}`, { headers: SB, ...(init || {}) });

// Nachbau von pgCode() aus api/cockpit.js. Die Funktion ist dort nicht
// exportiert (die Datei ist ein Vercel-Handler, kein Modul mit oeffentlicher
// Schnittstelle); geprueft wird deshalb dieselbe Logik gegen echte Antworten.
function pgCode(msg) {
  const m = String(msg || '').match(/"code"\s*:\s*"(\w+)"/);
  if (m) return m[1];
  if (/duplicate key/i.test(msg || '')) return '23505';
  if (/violates check constraint/i.test(msg || '')) return '23514';
  return null;
}

const angelegt = [];
const ins = async (row) => {
  const r = await rest('gs_tagesrapporte', {
    method: 'POST', headers: { ...SB, Prefer: 'return=representation' }, body: JSON.stringify(row),
  });
  const text = await r.text();
  if (r.ok) { try { angelegt.push(JSON.parse(text)[0].id); } catch (_) { /* egal */ } }
  return { status: r.status, text };
};

try {
  // Zwei echte, verschiedene Projekte besorgen.
  const projekte = (await (await rest('gs_projekte?select=id,projektnummer,kunde_id&geloescht_at=is.null&order=projektnummer.asc&limit=2')).json());
  ok(projekte.length === 2, `zwei Projekte fuer den Test gefunden (${projekte.map((p) => p.projektnummer).join(', ')})`);
  const [P1, P2] = projekte.map((p) => p.id);
  const basis = { techniker_user_id: TECH, datum: DATUM, jahr: 2099, woche: 10, gesamtstunden: 1 };

  // ── 1. Z1 · Was der Constraint erlaubt und was nicht ──────────────────────
  console.log('\n── 1. Z1 · UNIQUE(projekt_id, techniker_user_id, datum) ──');
  const a = await ins({ ...basis, projekt_id: P1 });
  ok(a.status === 201, `Projekt A am ${DATUM} angelegt (${a.status})`);

  const b = await ins({ ...basis, projekt_id: P2 });
  ok(b.status === 201, 'Projekt B am GLEICHEN Tag angelegt — mehrere Baustellen je Kalendertag');

  const c = await ins({ ...basis, projekt_id: P1 });
  ok(c.status === 409, `Projekt A ein zweites Mal wird abgewiesen (${c.status})`);
  ok(pgCode(c.text) === '23505', 'Der Fehler traegt den Code 23505 (unique_violation)');
  ok(/gs_tagesrapporte_projekt_id_techniker_user_id_datum_key/.test(c.text),
    'Es ist genau der bestehende Constraint, der greift — kein neuer');

  // ── 2. Z1 · CHECK-Verletzung ist ein ANDERER Fall ─────────────────────────
  console.log('\n── 2. Z1 · 23514 muss von 23505 unterscheidbar sein ──────');
  const d = await ins({ ...basis, datum: '2099-03-03', projekt_id: P1, abwesenheit: 'F' });
  ok(d.status >= 400, `Abwesenheit UND Baustelle wird abgewiesen (${d.status})`);
  ok(pgCode(d.text) === '23514', 'Der Fehler traegt den Code 23514 (check_violation)');
  ok(pgCode(d.text) !== pgCode(c.text), 'Beide Faelle sind am Code unterscheidbar — vorher waren sie es nicht');
  ok(!/duplicate key/i.test(d.text),
    'Die alte Regex "duplicate key" haette 23514 NICHT erkannt — daher der 500');

  // ── 3. Z1 · Die Klartexte nennen nichts Technisches ───────────────────────
  console.log('\n── 3. Z1 · Klartext ohne ids, Tabellen, Spalten ──────────');
  const texte = [
    'Für diese Baustelle besteht an diesem Tag bereits eine Zeile desselben Technikers. Es wurde nichts überschrieben — bitte die bestehende Zeile ergänzen oder eine andere Baustelle wählen.',
    'Diese Zeile darf nicht gleichzeitig eine Abwesenheit und eine Baustelle tragen. Es wurde nichts geändert — bitte zuerst die Abwesenheit entfernen.',
    'Diese Zeile ist als Abwesenheit erfasst und kann keiner Baustelle zugeordnet werden. Bitte zuerst die Abwesenheit entfernen.',
    'Eine Tageszeile braucht ein Ziel. Bitte eine Baustelle wählen oder die Zeile stattdessen löschen.',
  ];
  const verboten = /gs_[a-z_]+|projekt_id|techniker_user_id|tagesrapport|wochenrapport_id|23505|23514|[0-9a-f]{8}-[0-9a-f]{4}/i;
  for (const t of texte) ok(!verboten.test(t), `ohne Technik: "${t.slice(0, 44)}…"`);
  for (const t of texte) ok(/[.!]$/.test(t.trim()), 'Meldung ist ein ganzer Satz');

  // ── 4. Z2 · ISO-Woche nach dem 4-Januar-Prinzip ───────────────────────────
  console.log('\n── 4. Z2 · ISO 8601, die Jahresgrenzen ───────────────────');
  // Bekannte Faelle. Der 31.12. faellt je nach Jahr in KW 1 des FOLGEjahres,
  // der 1.1. in die letzte KW des VORjahres — genau daran ist die alte
  // Fassung von mondayToFriday() gescheitert.
  const faelle = [
    ['2026-01-01', 1, 2026], ['2026-12-31', 53, 2026],
    ['2027-01-01', 53, 2026], ['2027-01-04', 1, 2027],
    ['2028-01-01', 52, 2027], ['2029-12-31', 1, 2030],
    ['2026-08-17', 34, 2026], ['2026-07-20', 30, 2026],
  ];
  for (const [datum, w, j] of faelle) {
    const r = isoWocheVonDatum(datum);
    ok(r.woche === w && r.jahr === j, `${datum} -> KW ${r.woche}/${r.jahr} (erwartet ${w}/${j})`);
  }

  // Hin und zurueck: der Montag jeder Woche muss wieder dieselbe Woche ergeben.
  let rund = 0, rundFehler = [];
  for (let j = 2024; j <= 2032; j++) {
    for (let w = 1; w <= 52; w++) {
      const { von } = isoWochenBereich(j, w);
      const zurueck = isoWocheVonDatum(von);
      if (zurueck.woche === w && zurueck.jahr === j) rund++;
      else rundFehler.push(`${j}/${w} -> ${von} -> ${zurueck.jahr}/${zurueck.woche}`);
    }
  }
  ok(rundFehler.length === 0, `Hin und zurueck fuer 2024–2032: ${rund}/468 Wochen stimmen`);
  if (rundFehler.length) console.log('     ', rundFehler.slice(0, 5).join(' | '));

  // Jeder Montag ist ein Montag.
  let montags = true;
  for (let j = 2024; j <= 2032; j++) {
    for (let w = 1; w <= 52; w++) {
      const { von, bis } = isoWochenBereich(j, w);
      if (new Date(`${von}T00:00:00Z`).getUTCDay() !== 1) montags = false;
      if (new Date(`${bis}T00:00:00Z`).getUTCDay() !== 0) montags = false;
    }
  }
  ok(montags, 'Jede Woche beginnt am Montag und endet am Sonntag');

  // ── 5. Z2 · Der Wochenwechsel, den ZIEL 2 absichert ───────────────────────
  console.log('\n── 5. Z2 · Datumswechsel ueber die Wochengrenze ──────────');
  const vorher = isoWocheVonDatum('2026-07-24');   // Fr, KW 30
  const nachher = isoWocheVonDatum('2026-07-27');  // Mo, KW 31
  ok(vorher.woche === 30 && nachher.woche === 31,
    'Fr 24.07. liegt in KW 30, Mo 27.07. in KW 31 — ein Verschieben wechselt die Woche');
  ok(vorher.woche !== nachher.woche,
    'Ohne Nachziehen bliebe die Zeile am Stundenblatt der KW 30 haengen');
  const ueberJahr = isoWocheVonDatum('2029-12-31');
  ok(ueberJahr.jahr === 2030 && ueberJahr.woche === 1,
    'Der 31.12.2029 gehoert zu KW 1/2030 — das ISO-Jahr, nicht das Kalenderjahr');
} finally {
  console.log('\n── Aufraeumen ─────────────────────────────────────────────');
  let weg = 0;
  for (const id of angelegt) {
    const r = await rest(`gs_tagesrapporte?id=eq.${id}`, { method: 'DELETE', headers: { ...SB, Prefer: 'return=minimal' } });
    if (r.ok) weg++;
  }
  ok(weg === angelegt.length, `${weg} von ${angelegt.length} Wegwerfzeilen entfernt`);
  const rest2099 = await (await rest(`gs_tagesrapporte?techniker_user_id=eq.${TECH}&jahr=eq.2099&select=id`)).json();
  ok(Array.isArray(rest2099) && rest2099.length === 0, 'Kein Rueckstand im Jahr 2099');
}

console.log(`\n${fail} failed, ${pass} passed`);
console.log(fail ? `✗ ${fail} FEHLER · ${pass} Pruefungen bestanden` : `✓ ALLE ${pass} Pruefungen bestanden`);
process.exit(fail ? 1 : 0);
