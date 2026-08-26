// scripts/test_wochenbericht_knopf.mjs — der Knopf "Wochenbericht" aus der
// Wochenrapport-Liste, Ende zu Ende durch den ECHTEN Endpunkt.
//
// Der Knopf lief in zwei Schritten und scheiterte im ersten:
//   1. wochen_projekte  → welche Projekte hat der Techniker in dieser Woche
//   2. pdf              → je ausgewaehltem Projekt ein Wochenbericht
// Schritt 1 wird ueber den WOCHENRAPPORT adressiert, nicht ueber einen
// Zeitraum — die Pflichtpruefung auf jahr/woche traf ihn trotzdem.
//
// Der Handler wird IN-PROCESS mit einem Attrappen-req/res gerufen: derselbe
// Code wie auf Vercel, aber ohne Port und ohne Netz.
//
// Rollen-Kunstgriff wie in scripts/test_dashboard.mjs: das Techniker-Testkonto
// wird kurz auf gs_admin gehoben und im finally auf seinen Ausgangswert
// zurueckgesetzt. gs_tagesrapporte wird ausschliesslich gelesen.
//
//   node --env-file=.env.local scripts/test_wochenbericht_knopf.mjs
import handler from '../api/wochenbericht.js';

const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_KEY;
const SB = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };
const KONTO = { email: 'techniker.test@georgesolutions.ch', password: 'TestTech2026!' };
const PROJEKTNUMMER = 'P-2026-3470';
const JAHR = 2026, WOCHE = 31;

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const g = async (p) => {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: SB });
  if (!r.ok) throw new Error(`Lesen fehlgeschlagen (${r.status})`);
  return r.json();
};

// Attrappe fuer req/res — Vercel reicht den Body bereits geparst herein.
async function ruf(token, body) {
  const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body };
  let code = 0, daten = null;
  const res = {
    setHeader() {},
    status(c) { code = c; return res; },
    json(d) { daten = d; return res; },
    end() { return res; },
  };
  await handler(req, res);
  return { code, daten };
}

const login = async () => {
  const r = await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', headers: SB, body: JSON.stringify(KONTO) });
  const d = await r.json();
  if (!d.access_token) throw new Error('Anmeldung des Testkontos fehlgeschlagen');
  return { token: d.access_token, uid: d.user.id };
};
const setzeRolle = async (uid, rolle) => {
  const r = await fetch(`${U}/rest/v1/user_roles?user_id=eq.${uid}`, {
    method: 'PATCH', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify({ role: rolle }),
  });
  if (!r.ok) throw new Error(`Rolle konnte nicht gesetzt werden (${r.status})`);
};

const { token, uid } = await login();
const rolleVorher = ((await g(`user_roles?user_id=eq.${uid}&select=role&limit=1`))[0] || {}).role || 'gs_techniker';

try {
  // ── 1. Ohne Rechte: die Absage muss die ROLLE nennen, nicht den Zeitraum ──
  console.log('\n── Ohne Master-Rechte ───────────────────────────────────');
  const wrAlle = await g(`gs_wochenrapporte?jahr=eq.${JAHR}&woche=eq.${WOCHE}&select=id,jahr,woche&limit=1`);
  ok(wrAlle.length === 1, `Wochenrapport KW ${WOCHE}/${JAHR} vorhanden`);
  const wrId = wrAlle[0].id;

  const ohneRecht = await ruf(token, { action: 'wochen_projekte', wochenrapport_id: wrId });
  ok(ohneRecht.code === 403, `Techniker bekommt 403 (nicht 400) — bekam ${ohneRecht.code}`);
  ok(!/jahr/i.test((ohneRecht.daten || {}).error || ''), 'die Absage verlangt keinen Zeitraum mehr');

  // ── 2. Mit Master-Rechten: Schritt 1 des Knopfes ─────────────────────────
  console.log('\n── Schritt 1: Projekte der Woche ────────────────────────');
  await setzeRolle(uid, 'gs_admin');
  const schritt1 = await ruf(token, { action: 'wochen_projekte', wochenrapport_id: wrId });
  ok(schritt1.code === 200, `Antwort 200 — bekam ${schritt1.code} ${(schritt1.daten || {}).error || ''}`);
  const d1 = schritt1.daten || {};
  ok(d1.jahr === JAHR && d1.woche === WOCHE, `Zeitraum kommt aus dem Wochenrapport: KW ${d1.woche}/${d1.jahr}`);
  const ziel = (d1.projekte || []).find((p) => p.projektnummer === PROJEKTNUMMER);
  ok(!!ziel, `${PROJEKTNUMMER} steht in der Auswahl`);

  // ── 3. Schritt 2 des Knopfes: das PDF ────────────────────────────────────
  console.log('\n── Schritt 2: Wochenbericht als PDF ─────────────────────');
  const schritt2 = await ruf(token, { action: 'pdf', projekt_id: ziel && ziel.id, jahr: d1.jahr, woche: d1.woche });
  ok(schritt2.code === 200, `Antwort 200 — bekam ${schritt2.code} ${(schritt2.daten || {}).error || ''}`);
  const d2 = schritt2.daten || {};
  const pdf = Buffer.from(d2.pdf_base64 || '', 'base64');
  ok(pdf.slice(0, 4).toString() === '%PDF', 'Antwort ist ein PDF');
  ok(pdf.length > 1000, `PDF hat Inhalt (${pdf.length} Bytes)`);
  console.log(`     ${d2.filename} · ${pdf.length} Bytes · ${d2.fotos_im_pdf} Foto(s) eingebettet`);

  // ── 3b. Die Pflichtangabe gilt weiter, wo sie gebraucht wird ─────────────
  // Die Ausnahme darf nicht zur Regel werden: Aktionen, die ohne Zeitraum
  // nicht arbeiten koennen, muessen ihn weiterhin verlangen.
  console.log('\n── Zeitraum bleibt Pflicht, wo er gebraucht wird ────────');
  const ohneJahr = await ruf(token, { action: 'vorschau', projekt_id: ziel && ziel.id });
  ok(ohneJahr.code === 400, `Vorschau ohne Zeitraum → 400 (bekam ${ohneJahr.code})`);
  const fdOhneJahr = await ruf(token, { action: 'fotodoku_vorschau', wochenrapport_id: wrId });
  ok(fdOhneJahr.code === 400, `Fotodokumentation ohne Zeitraum → 400 (bekam ${fdOhneJahr.code})`);

  // ── 4. Die Fotodokumentation aus derselben Liste ─────────────────────────
  console.log('\n── Fotodokumentation aus derselben Liste ────────────────');
  const fdV = await ruf(token, { action: 'fotodoku_vorschau', wochenrapport_id: wrId, jahr: JAHR, woche: WOCHE });
  ok(fdV.code === 200, `Vorschau 200 — bekam ${fdV.code} ${(fdV.daten || {}).error || ''}`);
  const v = (fdV.daten || {}).vorschau || {};
  ok(typeof v.gesamt === 'number', `Vorschau zaehlt ${v.gesamt} Foto(s) im Dokument`);
  ok(!!(v.ohne_zuordnung && typeof v.ohne_zuordnung.anzahl === 'number'), `Vorschau meldet ${v.ohne_zuordnung && v.ohne_zuordnung.anzahl} ohne Tageszuordnung`);

  const fd = await ruf(token, { action: 'fotodoku', wochenrapport_id: wrId, jahr: JAHR, woche: WOCHE });
  ok(fd.code === 200, `Erzeugen 200 — bekam ${fd.code} ${(fd.daten || {}).error || ''}`);
  const d4 = fd.daten || {};
  ok(Array.isArray(d4.dokumente) && d4.dokumente.length >= 1, `${(d4.dokumente || []).length} Teildokument(e)`);
  console.log(`     ${d4.abgebildet} von ${d4.erfasst} abgebildet · ${(d4.ohne_zuordnung || {}).anzahl} ohne Tageszuordnung`);
} finally {
  await setzeRolle(uid, rolleVorher);
  const jetzt = ((await g(`user_roles?user_id=eq.${uid}&select=role&limit=1`))[0] || {}).role;
  ok(jetzt === rolleVorher, `Rolle des Testkontos zurueckgesetzt (${jetzt})`);
}

console.log(`\n${pass} Prüfungen bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
