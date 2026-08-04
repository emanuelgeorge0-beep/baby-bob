// ═══════════════════════════════════════════════════════════════════════════
// NACHKONTROLLE nach scripts/rapportnummer.sql (Rapport Feinschliff II)
// ═══════════════════════════════════════════════════════════════════════════
// Prüft gegen die LIVE-DB, ob die Migration wirklich vollständig angekommen ist.
// Fast alles ist lesend. Die EINZIGE Schreiboperation ist der in der SQL-Datei
// selbst vorgesehene Probezug des Nummernkreises mit dem Kürzel 'TST', der
// danach wieder gelöscht wird — er fasst keine echten Kunden-/Rapportdaten an.
//
// Lauf:  node scripts/verify_rapportnummer.mjs
// Liest SUPABASE_URL / SUPABASE_KEY aus .env.local. Gibt keine Secrets aus.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const env = {};
for (const zeile of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = zeile.indexOf('=');
  if (i > 0) env[zeile.slice(0, i).trim()] = zeile.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const URL_ = env.SUPABASE_URL, KEY = env.SUPABASE_KEY;
if (!URL_ || !KEY) { console.log('✗ SUPABASE_URL/SUPABASE_KEY fehlen in .env.local'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

let ok = 0, fail = 0;
const fehler = [];
function pruef(bed, was, detail) { if (bed) ok++; else { fail++; fehler.push(was + (detail ? ` — ${detail}` : '')); } }

async function get(pfad) {
  const r = await fetch(`${URL_}/rest/v1/${pfad}`, { headers: H });
  const txt = await r.text();
  return { okStatus: r.ok, status: r.status, body: txt ? JSON.parse(txt) : null, roh: txt };
}
async function post(pfad, body, prefer) {
  const r = await fetch(`${URL_}/rest/v1/${pfad}`, {
    method: 'POST', headers: { ...H, ...(prefer ? { Prefer: prefer } : {}) }, body: JSON.stringify(body),
  });
  const txt = await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (_) { j = txt; }
  return { okStatus: r.ok, status: r.status, body: j, roh: txt };
}
async function del(pfad) {
  const r = await fetch(`${URL_}/rest/v1/${pfad}`, { method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' } });
  return r.ok;
}

console.log('Nachkontrolle rapportnummer.sql');
console.log('─'.repeat(60));

// ── 1. Neue Spalten und Tabellen ──────────────────────────────────────────
const kz = await get('gs_kunden?select=id,firma,kuerzel&limit=200');
pruef(kz.okStatus, 'gs_kunden.kuerzel fehlt', kz.roh.slice(0, 120));

const wr = await get('gs_wochenrapporte?select=id,jahr,woche,rapport_nr,rapport_seq,kunde_id&limit=200');
pruef(wr.okStatus, 'gs_wochenrapporte.kunde_id/rapport_seq fehlen', wr.roh.slice(0, 120));

const nk = await get('gs_rapport_nummernkreis?select=kuerzel,jahr,letzte_nr&limit=50');
pruef(nk.okStatus, 'Tabelle gs_rapport_nummernkreis fehlt', nk.roh.slice(0, 120));

const ke = await get('gs_katalog_entscheidung?select=id,entscheidung,entschieden_at&limit=10');
pruef(ke.okStatus, 'Tabelle gs_katalog_entscheidung fehlt', ke.roh.slice(0, 120));

// ── 2. Nummernkreis-Funktion: zieht sie fortlaufend und atomar? ───────────
// Probezug mit 'TST' laut Kommentar in der SQL-Datei, danach aufgeräumt.
const z1 = await post('rpc/gs_rapport_nr_next', { p_kuerzel: 'TST', p_jahr: 2026 });
pruef(z1.okStatus, 'RPC gs_rapport_nr_next nicht aufrufbar', z1.roh.slice(0, 160));
if (z1.okStatus) {
  const n1 = Number(z1.body);
  pruef(n1 === 1, 'erster Zug liefert nicht 1', `bekommen: ${JSON.stringify(z1.body)}`);
  const z2 = await post('rpc/gs_rapport_nr_next', { p_kuerzel: 'TST', p_jahr: 2026 });
  pruef(Number(z2.body) === 2, 'zweiter Zug liefert nicht 2', `bekommen: ${JSON.stringify(z2.body)}`);

  // Kleinschreibung muss auf denselben Kreis laufen (Funktion macht upper()).
  const z3 = await post('rpc/gs_rapport_nr_next', { p_kuerzel: 'tst', p_jahr: 2026 });
  pruef(Number(z3.body) === 3, 'Kleinschreibung läuft auf einen ANDEREN Nummernkreis', `bekommen: ${JSON.stringify(z3.body)}`);

  // Anderes Jahr = eigener Kreis, beginnt wieder bei 1.
  const z4 = await post('rpc/gs_rapport_nr_next', { p_kuerzel: 'TST', p_jahr: 2027 });
  pruef(Number(z4.body) === 1, 'Jahreswechsel startet nicht bei 1', `bekommen: ${JSON.stringify(z4.body)}`);

  // Nebenläufigkeit: 10 gleichzeitige Züge müssen 10 VERSCHIEDENE Nummern geben.
  const gleichzeitig = await Promise.all(
    Array.from({ length: 10 }, () => post('rpc/gs_rapport_nr_next', { p_kuerzel: 'TST', p_jahr: 2028 })),
  );
  const werte = gleichzeitig.map((x) => Number(x.body)).filter(Number.isFinite);
  pruef(new Set(werte).size === 10 && werte.length === 10,
    'parallele Züge liefern Doppelnummern', `bekommen: ${JSON.stringify(werte.sort((a, b) => a - b))}`);

  // Ungültiges Jahr muss abgelehnt werden.
  const zBad = await post('rpc/gs_rapport_nr_next', { p_kuerzel: 'TST', p_jahr: 1500 });
  pruef(!zBad.okStatus, 'ungültiges Jahr wird NICHT abgelehnt');

  // Aufräumen — der Probekreis darf nicht stehenbleiben.
  const weg = await del('gs_rapport_nummernkreis?kuerzel=eq.TST');
  pruef(weg, 'Probe-Nummernkreis TST konnte nicht gelöscht werden');
  const rest = await get('gs_rapport_nummernkreis?kuerzel=eq.TST&select=kuerzel');
  pruef(rest.okStatus && Array.isArray(rest.body) && rest.body.length === 0, 'TST-Zeilen sind noch da');
}

// ── 3. Lagebild: was steht jetzt drin? ────────────────────────────────────
console.log('');
if (kz.okStatus) {
  const kunden = kz.body || [];
  const mit = kunden.filter((k) => k.kuerzel);
  console.log(`Kunden gesamt              : ${kunden.length}`);
  console.log(`davon mit Kürzel           : ${mit.length}` + (mit.length ? '  → ' + mit.map((k) => `${k.kuerzel} (${k.firma || '?'})`).join(', ') : ''));
  if (mit.length !== kunden.length) {
    console.log(`ohne Kürzel                : ${kunden.length - mit.length}  → deren Rapporte laufen auf R-GSO-…`);
  }
  // Doppelte Kürzel wären ein Zeichen, dass der UNIQUE-Index NICHT greift.
  const zaehl = {};
  mit.forEach((k) => { zaehl[k.kuerzel] = (zaehl[k.kuerzel] || 0) + 1; });
  const doppelt = Object.keys(zaehl).filter((k) => zaehl[k] > 1);
  pruef(!doppelt.length, 'doppelte Kürzel vorhanden — UNIQUE-Index greift nicht', doppelt.join(', '));
}
if (wr.okStatus) {
  const rows = wr.body || [];
  const neu = rows.filter((r) => (r.rapport_nr || '').startsWith('R-'));
  const alt = rows.filter((r) => r.rapport_nr && !r.rapport_nr.startsWith('R-'));
  console.log(`Wochenrapporte gesamt      : ${rows.length}`);
  console.log(`  neues Format R-…         : ${neu.length}`);
  console.log(`  Altformat WR-…           : ${alt.length}` + (alt.length ? '  → bleibt gültig, Backfill ist Abschnitt 7 der SQL' : ''));
}
if (nk.okStatus) {
  const kreise = (nk.body || []).filter((x) => x.kuerzel !== 'TST');
  console.log(`Nummernkreise in Benutzung : ${kreise.length}` + (kreise.length ? '  → ' + kreise.map((x) => `${x.kuerzel}/${x.jahr}=${x.letzte_nr}`).join(', ') : ''));
}
if (ke.okStatus) console.log(`Katalog-Entscheidungen     : ${(ke.body || []).length} protokolliert`);

// ── Ausgabe ───────────────────────────────────────────────────────────────
console.log('');
console.log('─'.repeat(60));
if (fail) {
  console.log(`✗ ${fail} von ${ok + fail} Prüfungen FEHLGESCHLAGEN:`);
  fehler.forEach((f) => console.log('   · ' + f));
} else {
  console.log(`✓ alle ${ok} Prüfungen bestanden — Migration vollständig`);
}
process.exit(fail ? 1 : 0);
