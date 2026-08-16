// scripts/test_zeitfeld_wache.mjs — Nachweis für die Start/Ende-Wache in
// saveTechTag (api/cockpit.js).
//
// Der Fehler, der hier festgenagelt wird: das Wochenblatt sendet start_zeit und
// end_zeit IMMER mit (leeres Eingabefeld → ''). Vorher standen beide Felder
// unbedingt im PATCH-Body, also überschrieb jeder Autosave bereits erfasste
// Zeiten mit NULL. Nach dem Fix gilt: leer oder nicht gesendet = nicht anfassen.
//
//   node --env-file=.env.local scripts/test_zeitfeld_wache.mjs [baseUrl]
//
// Schreibt eine einzige Tageszeile in einer weit entfernten Woche (Jahr 2099)
// und löscht sie am Ende wieder. Fasst keine echten Rapportdaten an.

const BASE = process.argv[2] || 'https://baby-bob.vercel.app';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const EMAIL = 'techniker.test@georgesolutions.ch';
const PASS = 'TestTech2026!';
const DATUM = '2099-03-02';   // Montag der KW10/2099

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log('SUPABASE_URL/SUPABASE_KEY fehlen — mit --env-file=.env.local starten.');
  process.exit(1);
}

const api = async (action, body) => {
  const r = await fetch(`${BASE}/api/cockpit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, token, ...body }),
  });
  return r.json().catch(() => ({}));
};

console.log(`\n── Anmeldung (Techniker) @ ${BASE} ──────────────────────`);
const lr = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS }),
});
const ld = await lr.json().catch(() => ({}));
const token = ld.access_token;
ok(!!token, 'Techniker angemeldet');
if (!token) { console.log('\n✗ ohne Token kein Test'); process.exit(1); }

// ── Fixture: der Testtechniker braucht eine Projektzuweisung ───────────────
// Wird nur angelegt, wenn keine existiert, und am Ende wieder entfernt.
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const sb = async (path, init) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SB, ...(init || {}) });
  return r.json().catch(() => null);
};

console.log('\n── Projekt des Technikers ───────────────────────────────');
let zuweisungAngelegt = null;
let pd = await api('tech_projekte', {});
if (!(pd.projekte || []).length) {
  const tRows = await sb(`gs_techniker?user_id=eq.${ld.user.id}&select=id&limit=1`);
  const technikerId = (tRows || [])[0] && tRows[0].id;
  const pRows = await sb('gs_projekte?select=id,name,geloescht_at&order=created_at.desc&limit=20');
  const kandidat = (pRows || []).filter((p) => !p.geloescht_at)[0];
  if (technikerId && kandidat) {
    await sb('gs_projekt_techniker', { method: 'POST', headers: { ...SB, Prefer: 'return=minimal' },
      body: JSON.stringify({ projekt_id: kandidat.id, techniker_id: technikerId }) });
    zuweisungAngelegt = { projekt_id: kandidat.id, techniker_id: technikerId };
    console.log(`  (Testzuweisung angelegt: ${kandidat.name || kandidat.id})`);
    pd = await api('tech_projekte', {});
  }
}
const projekt = (pd.projekte || [])[0];
ok(!!projekt, `zugewiesenes Projekt gefunden${projekt ? ' (' + (projekt.name || projekt.id) + ')' : ''}`);
if (!projekt) { console.log('\n✗ ohne Projekt kein Test'); process.exit(1); }

let zeileId = null;
try {
  console.log('\n── 1. Speichern MIT Zeiten ──────────────────────────────');
  const s1 = await api('tech_tag_save', {
    datum: DATUM, projekt_id: projekt.id, start_zeit: '07:00', end_zeit: '16:15',
    stunden: 8, pause_minuten: 75, taetigkeit: 'Sanitär',
  });
  zeileId = s1.row && s1.row.id;
  ok(!!zeileId, 'Tageszeile angelegt');
  ok(s1.row && String(s1.row.start_zeit || '').slice(0, 5) === '07:00', `start_zeit gespeichert (ist ${s1.row && s1.row.start_zeit})`);
  ok(s1.row && String(s1.row.end_zeit || '').slice(0, 5) === '16:15', `end_zeit gespeichert (ist ${s1.row && s1.row.end_zeit})`);

  console.log('\n── 2. Autosave OHNE Zeiten (leere Felder, wie im DOM) ───');
  // Genau das schickt tcCollectRow(), wenn die Zeit-Inputs leer sind.
  const s2 = await api('tech_tag_save', {
    id: zeileId, datum: DATUM, projekt_id: projekt.id,
    start_zeit: '', end_zeit: '', stunden: 8, taetigkeit: 'Sanitär',
  });
  ok(s2.row && String(s2.row.start_zeit || '').slice(0, 5) === '07:00', `start_zeit überlebt leeres Feld (ist ${s2.row && s2.row.start_zeit})`);
  ok(s2.row && String(s2.row.end_zeit || '').slice(0, 5) === '16:15', `end_zeit überlebt leeres Feld (ist ${s2.row && s2.row.end_zeit})`);

  console.log('\n── 3. Speichern ohne den Schlüssel überhaupt ────────────');
  const s3 = await api('tech_tag_save', { id: zeileId, datum: DATUM, projekt_id: projekt.id, stunden: 8 });
  ok(s3.row && String(s3.row.start_zeit || '').slice(0, 5) === '07:00', `start_zeit unangetastet (ist ${s3.row && s3.row.start_zeit})`);
  ok(s3.row && String(s3.row.end_zeit || '').slice(0, 5) === '16:15', `end_zeit unangetastet (ist ${s3.row && s3.row.end_zeit})`);

  console.log('\n── 4. Korrigieren bleibt möglich ────────────────────────');
  const s4 = await api('tech_tag_save', { id: zeileId, datum: DATUM, projekt_id: projekt.id, start_zeit: '06:30', end_zeit: '15:00', stunden: 8 });
  ok(s4.row && String(s4.row.start_zeit || '').slice(0, 5) === '06:30', `start_zeit überschreibbar (ist ${s4.row && s4.row.start_zeit})`);
  ok(s4.row && String(s4.row.end_zeit || '').slice(0, 5) === '15:00', `end_zeit überschreibbar (ist ${s4.row && s4.row.end_zeit})`);
} finally {
  console.log('\n── Aufräumen ────────────────────────────────────────────');
  if (zeileId) {
    const d = await api('tech_tag_del', { id: zeileId });
    ok(!!(d && d.ok), 'Testzeile gelöscht');
  }
  if (zuweisungAngelegt) {
    await sb(`gs_projekt_techniker?projekt_id=eq.${zuweisungAngelegt.projekt_id}&techniker_id=eq.${zuweisungAngelegt.techniker_id}`,
      { method: 'DELETE', headers: { ...SB, Prefer: 'return=minimal' } });
    console.log('  ✓ Testzuweisung entfernt');
  }
}

console.log(fail ? `\n✗ ${fail} FEHLER · ${pass} Prüfungen bestanden` : `\n✓ ALLE ${pass} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
