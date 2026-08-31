// scripts/test_versandhistorie.mjs — Versandhistorie: wer hat wann was wohin geschickt?
//
//   node scripts/test_versandhistorie.mjs
//
// OFFLINE. Faehrt den ECHTEN Handler api/wochenbericht.js gegen ein gemocktes
// Supabase und eine gemockte Resend-API. Es geht keine Mail raus, die echte
// Datenbank wird nicht angefasst, der Lauf ist deterministisch.
//
// Der Kern dieser Suite ist die TRENNUNG, nicht die Anzeige: ein Partner darf
// ueber keinen Weg an die Vorgaenge eines anderen kommen — auch nicht, wenn er
// eine fremde Projekt-ID direkt in die Abfrage schreibt. Deshalb wird nicht
// die Oberflaeche geprueft, sondern der Server.
//
// Geprueft wird:
//   1. ein erfolgreicher Versand erscheint in der Historie
//   2. ein fehlgeschlagener Versand erscheint als fehlgeschlagen
//   3. ein Partner sieht seine eigenen Vorgaenge
//   4. ein Partner sieht die Vorgaenge eines anderen Partners NICHT, auch nicht
//      ueber direkte Abfrage mit fremder Projekt-ID
//   5. Master sieht beide
//   6. jede Zeile traegt Zeitpunkt, Typ, Nummer, Projekt, Empfaenger, Person,
//      Ergebnis und Dateigroesse; neueste zuerst; Filter nach Projekt und Zeitraum
//   7. ein frisch versendeter Sammelbericht taucht sofort auf — mit einem
//      Eintrag je enthaltenem Projekt

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://attrappe.supabase.test';
process.env.SUPABASE_KEY = 'test-service-key-fuer-die-attrappe';
process.env.RESEND_API_KEY = 'test-attrappe-kein-echter-schluessel';

const MASTER = 'ee46a716-7017-4045-9f67-fe06d05171e7';
const PA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';   // Partner A
const PB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';   // Partner B
const TECHU = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; // Techniker (darf nichts sehen)

const A1 = 'a1a1a1a1-0000-0000-0000-000000000001';   // gehoert A
const A2 = 'a2a2a2a2-0000-0000-0000-000000000002';   // gehoert A
const B1 = 'b1b1b1b1-0000-0000-0000-000000000001';   // gehoert B
const M1 = '10101010-0000-0000-0000-000000000001';   // Master-Projekt, kein Partner
const WR = '99999999-9999-9999-9999-999999999999';

const JAHR = 2026, WOCHE = 34;
const NR = { [A1]: '70010.00', [A2]: '70020.00', [B1]: '80010.00', [M1]: '90010.00' };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const eintrag = (o) => Object.assign({
  am: '2026-08-24T10:00:00.000Z', an: ['empfang@example.invalid'], empfaenger_herkunft: 'angefragt',
  typ: 'wochenbericht', bericht_nr: 'WB-X-2026-34', von: MASTER, ok: true, fehler: null,
  pdf_bytes: 46904, pdf_path: 'wochenberichte/x/WB-X-2026-34.pdf',
}, o);

let db;
function reset() {
  db = {
    user_roles: [
      { user_id: MASTER, role: 'master' }, { user_id: PA, role: 'gs_partner' },
      { user_id: PB, role: 'gs_partner' }, { user_id: TECHU, role: 'techniker' },
    ],
    gs_techniker: [
      { id: 'tm', user_id: MASTER, name: 'Emanuel George' },
      { id: 'ta', user_id: PA, name: 'Partner Anna' },
      { id: 'tb', user_id: PB, name: 'Partner Bruno' },
    ],
    gs_wochenrapporte: [{ id: WR, jahr: JAHR, woche: WOCHE, techniker_user_id: MASTER, rapport_nr: 'R-EG-2026-0004' }],
    gs_kunden: [], gs_partner_profil: [], gs_projekt_medien: [], gs_tagesrapport_taetigkeitenkatalog: [],
    gs_projekte: [
      { id: A1, name: 'Halle Nord', projektnummer: NR[A1], kuerzel: 'HAN', standort: null, kunde_id: null, projektleiter: null, ansprechperson: null, ansprech_email: 'a1@example.invalid', partner_user_id: PA },
      { id: A2, name: 'Halle Sued', projektnummer: NR[A2], kuerzel: 'HAS', standort: null, kunde_id: null, projektleiter: null, ansprechperson: null, ansprech_email: 'a2@example.invalid', partner_user_id: PA },
      { id: B1, name: 'Werkhof Ost', projektnummer: NR[B1], kuerzel: 'WEO', standort: null, kunde_id: null, projektleiter: null, ansprechperson: null, ansprech_email: 'b1@example.invalid', partner_user_id: PB },
      { id: M1, name: 'Eigenobjekt', projektnummer: NR[M1], kuerzel: 'EIG', standort: null, kunde_id: null, projektleiter: null, ansprechperson: null, ansprech_email: 'm1@example.invalid', partner_user_id: null },
    ],
    gs_tagesrapporte: [
      zeile('z1', '2026-08-17', A1, 8, 30), zeile('z2', '2026-08-18', A2, 6, 30), zeile('z3', '2026-08-19', M1, 4, 30),
    ],
    gs_wochenberichte: [
      kopf(A1, 'WB-HAN-2026-34', [
        eintrag({ am: '2026-08-20T08:00:00.000Z', bericht_nr: 'WB-HAN-2026-34', an: ['anna@example.invalid'], von: PA, ok: true, pdf_bytes: 41000 }),
        eintrag({ am: '2026-08-24T12:00:00.000Z', bericht_nr: 'WB-HAN-2026-34', an: ['anna@example.invalid'], von: MASTER, ok: false, fehler: 'Resend 422', pdf_bytes: 41200 }),
      ]),
      kopf(A2, 'WB-HAS-2026-34', [
        eintrag({ am: '2026-08-22T09:30:00.000Z', bericht_nr: 'WB-HAS-2026-34', an: ['anna@example.invalid', 'bauleiter@example.invalid'], von: PA, ok: true, pdf_bytes: 39000 }),
      ]),
      kopf(B1, 'WB-WEO-2026-34', [
        eintrag({ am: '2026-08-23T11:00:00.000Z', bericht_nr: 'WB-WEO-2026-34', an: ['bruno@example.invalid'], von: PB, ok: true, pdf_bytes: 37000 }),
      ]),
      kopf(M1, 'WB-EIG-2026-34', [
        // Altentrag OHNE typ — aus der Zeit vor dem Sammelbericht.
        { am: '2026-08-19T07:00:00.000Z', an: ['buero@example.invalid'], bericht_nr: 'WB-EIG-2026-34', von: MASTER, ok: true, fehler: null, pdf_bytes: 33000, pdf_path: 'wochenberichte/m1/x.pdf' },
      ]),
    ],
  };
}
function kopf(projekt_id, bericht_nr, protokoll) {
  return {
    id: 'wb-' + projekt_id.slice(0, 4), quelle: 'projekt', projekt_id, jahr: JAHR, woche: WOCHE,
    bericht_nr, status: 'versendet', daten: null, pdf_path: null,
    empfaenger: [], versendet_am: null, versand_protokoll: protokoll,
  };
}
function zeile(id, datum, projekt_id, std, spesen) {
  return {
    id, datum, projekt_id, techniker_user_id: MASTER, erfasst_von: MASTER, wochenrapport_id: WR,
    taetigkeit: 'Montage', start_zeit: '07:00', end_zeit: '17:00', pause_minuten: 60, stunden_manuell: null,
    gesamtstunden: std, ueberzeit_25: 0, ueberzeit_50: 0, ueberzeit_100: 0, spesen,
    projektnummer_erfasst: NR[projekt_id], abwesenheit: null, abwesenheit_grund: null,
    material: null, material_positionen: null, arbeiten: ['Montage'], besonderheiten: null,
    woche: WOCHE, jahr: JAHR, created_at: `${datum}T06:00:00Z`, abrechnung_status: 'offen',
  };
}

function leseTabelle(pfad) {
  const [tabelle, qs] = pfad.split('?');
  let out = (db[tabelle] || []).slice();
  const params = new URLSearchParams(qs || '');
  for (const [key, raw] of params.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    const m = String(raw).match(/^(eq|neq|gt|gte|lt|lte|is|in)\.(.*)$/s);
    if (!m) continue;
    const [, op, wert] = m;
    out = out.filter((r) => {
      const v = r[key];
      if (op === 'eq') return String(v) === wert;
      if (op === 'neq') return String(v) !== wert;
      if (op === 'gt') return Number(v) > Number(wert);
      if (op === 'gte') return String(v) >= wert;
      if (op === 'lt') return Number(v) < Number(wert);
      if (op === 'lte') return String(v) <= wert;
      if (op === 'is') return wert === 'null' ? (v == null) : (String(v) === wert);
      if (op === 'in') return wert.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(v));
      return true;
    });
  }
  const ord = params.get('order');
  if (ord) {
    const stufen = ord.split(',').map((x) => x.split('.'));
    out = out.slice().sort((a, b) => {
      for (const [feld, richtung] of stufen) {
        const c = String(a[feld] == null ? '' : a[feld]).localeCompare(String(b[feld] == null ? '' : b[feld]));
        if (c) return richtung === 'desc' ? -c : c;
      }
      return 0;
    });
  }
  const lim = Number(params.get('limit'));
  if (Number.isFinite(lim) && lim > 0) out = out.slice(0, lim);
  return out;
}

let mails = [];
const res = (body, okFlag = true, status = 200) => ({
  ok: okFlag, status, json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  arrayBuffer: async () => new ArrayBuffer(0),
});
const TOKEN = { tokMaster: MASTER, tokA: PA, tokB: PB, tokTech: TECHU };

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const method = (opts.method || 'GET').toUpperCase();
  if (u.includes('api.resend.com')) { mails.push(JSON.parse(opts.body)); return res({ id: 'mail-ok' }); }
  if (u.includes('/auth/v1/user')) {
    const tok = String((opts.headers || {}).Authorization || '').replace('Bearer ', '').trim();
    return TOKEN[tok] ? res({ id: TOKEN[tok], email: tok + '@test' }) : res({ error: 'bad' }, false, 401);
  }
  if (u.includes('/storage/v1/object/')) return method === 'POST' ? res({ Key: 'ok' }) : res('weg', false, 404);
  if (u.includes('/rest/v1/')) {
    const pfad = decodeURIComponent(u.split('/rest/v1/')[1]);
    const [tabelle] = pfad.split('?');
    if (!(tabelle in db)) return res(`relation "${tabelle}" does not exist`, false, 404);
    if (method === 'GET') return res(leseTabelle(pfad));
    if (method === 'POST') {
      const vorgabe = tabelle === 'gs_wochenberichte'
        ? { quelle: 'projekt', status: 'entwurf', daten: null, pdf_path: null, empfaenger: [], versendet_am: null, versand_protokoll: [] } : {};
      const neu = { id: `neu-${db[tabelle].length + 1}`, created_at: new Date().toISOString(), ...vorgabe, ...JSON.parse(opts.body) };
      db[tabelle].push(neu); return res([neu]);
    }
    if (method === 'PATCH') {
      const treffer = leseTabelle(pfad); const patch = JSON.parse(opts.body);
      for (const r of treffer) Object.assign(r, patch);
      return res(treffer);
    }
  }
  return res('unbekannter Aufruf: ' + u, false, 500);
};

const { default: handler } = await import('../api/wochenbericht.js');
async function ruf(body, token = 'tokMaster') {
  let out = { status: 0, body: null };
  const r = { setHeader() {}, status(s) { out.status = s; return this; }, json(j) { out.body = j; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, r);
  return out;
}
const historie = (extra, token) => ruf(Object.assign({ action: 'versand_historie' }, extra || {}), token);

console.log('\n══ VERSANDHISTORIE ══');
reset();

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 1. Ein erfolgreicher Versand erscheint in der Historie ──');
const m = await historie({}, 'tokMaster');
ok(m.status === 200 && m.body.ok, `Master bekommt 200 (${m.status}${m.body && m.body.error ? ' · ' + m.body.error : ''})`);
const alle = m.body.vorgaenge || [];
ok(alle.length === 5, `fuenf Vorgaenge insgesamt (${alle.length})`);
const gut = alle.filter((v) => v.ok);
ok(gut.length === 4, `vier davon erfolgreich (${gut.length})`);
ok(gut.some((v) => v.bericht_nr === 'WB-HAS-2026-34' && v.empfaenger.length === 2), 'der Versand an zwei Adressen ist als solcher da');

console.log('\n── 2. Ein fehlgeschlagener Versand steht als fehlgeschlagen ─');
const schlecht = alle.filter((v) => !v.ok);
ok(schlecht.length === 1, `genau ein Fehlversuch (${schlecht.length})`);
ok(schlecht[0].bericht_nr === 'WB-HAN-2026-34' && schlecht[0].fehler === 'Resend 422', `Grund im Klartext: ${schlecht[0].fehler}`);
ok(schlecht[0].ok === false, 'er wird NICHT als Erfolg ausgewiesen');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 3. Ein Partner sieht seine eigenen Vorgaenge ────────────');
const a = await historie({}, 'tokA');
ok(a.status === 200 && a.body.ok, 'Partner A bekommt 200');
const va = a.body.vorgaenge || [];
ok(va.length === 3, `drei Vorgaenge (A1 zweimal, A2 einmal) — sind ${va.length}`);
ok(va.every((v) => v.projekt_id === A1 || v.projekt_id === A2), 'ausschliesslich seine beiden Projekte');
ok(a.body.sichtbarkeit === 'partner', 'die Antwort sagt, dass gescoped wurde');
ok((a.body.projekte || []).length === 2, 'die Filterliste zeigt nur seine Projekte');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 4. Fremde Vorgaenge: ueber KEINEN Weg ───────────────────');
ok(!va.some((v) => v.projekt_id === B1), 'Partner B kommt in As Liste nicht vor');
ok(!va.some((v) => v.projekt_id === M1), 'das Master-Projekt kommt in As Liste nicht vor');
ok(!JSON.stringify(va).includes('bruno@example.invalid'), 'auch keine Adresse aus Bs Vorgang');
ok(!JSON.stringify(va).includes('WB-WEO-2026-34'), 'auch keine Berichtsnummer aus Bs Vorgang');

const direkt = await historie({ projekt_id: B1 }, 'tokA');
ok(direkt.status === 403, `direkte Abfrage mit fremder Projekt-ID: ${direkt.status} (erwartet 403)`);
ok(!(direkt.body.vorgaenge || []).length, 'und keine Daten in der Antwort');
ok(/Berechtigung/i.test(direkt.body.error || ''), `klare Ansage: "${direkt.body.error}"`);

const direktMaster = await historie({ projekt_id: M1 }, 'tokA');
ok(direktMaster.status === 403, 'auch das Master-Projekt bleibt A verschlossen');

const b = await historie({}, 'tokB');
ok(b.status === 200 && (b.body.vorgaenge || []).length === 1, `Partner B sieht genau seinen einen Vorgang (${(b.body.vorgaenge || []).length})`);
ok((b.body.vorgaenge || [])[0].projekt_id === B1, 'und zwar den zu seinem Projekt');
ok(!JSON.stringify(b.body.vorgaenge).includes('anna@example.invalid'), 'B sieht keine Adresse von A');

const t = await historie({}, 'tokTech');
ok(t.status === 403, `ein Techniker bekommt gar nichts (${t.status})`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 5. Master sieht beide ───────────────────────────────────');
ok(alle.some((v) => v.projekt_id === A1), 'Master sieht A1');
ok(alle.some((v) => v.projekt_id === A2), 'Master sieht A2');
ok(alle.some((v) => v.projekt_id === B1), 'Master sieht B1');
ok(alle.some((v) => v.projekt_id === M1), 'Master sieht sein eigenes Projekt');
ok(m.body.sichtbarkeit === 'master', 'die Antwort weist die volle Sicht aus');
ok((m.body.projekte || []).length === 4, 'die Filterliste kennt alle vier Projekte');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 6. Was in einer Zeile steht, und in welcher Reihenfolge ─');
const v0 = alle[0];
ok(!!v0.am && /^\d{4}-\d{2}-\d{2}T/.test(v0.am), `Zeitpunkt: ${v0.am}`);
ok(!!v0.typ_text, `Berichtstyp: ${v0.typ_text}`);
ok(!!v0.bericht_nr, `Berichtsnummer: ${v0.bericht_nr}`);
ok(!!v0.projekt && !!v0.projektnummer, `Projekt: ${v0.projektnummer} · ${v0.projekt}`);
ok(Array.isArray(v0.empfaenger) && v0.empfaenger.length > 0, `Empfaengeradresse: ${v0.empfaenger.join(', ')}`);
ok(!!v0.von_name, `absendende Person: ${v0.von_name}`);
ok(typeof v0.ok === 'boolean', 'Ergebnis als ok/fehlgeschlagen');
ok(v0.pdf_bytes > 0, `Dateigroesse: ${v0.pdf_bytes} Bytes`);

const zeiten = alle.map((v) => v.am);
ok(JSON.stringify(zeiten) === JSON.stringify(zeiten.slice().sort().reverse()), 'neueste zuerst');
ok(alle.find((v) => v.projekt_id === M1).typ === 'wochenbericht', 'ein Altentrag ohne typ gilt als Wochenbericht');
ok(alle.find((v) => v.von_user_id === PA).von_name === 'Partner Anna', 'der Name der absendenden Person wird aufgeloest');

const nurA1 = await historie({ projekt_id: A1 }, 'tokMaster');
ok((nurA1.body.vorgaenge || []).length === 2, `Filter nach Projekt: zwei Vorgaenge zu A1 (${(nurA1.body.vorgaenge || []).length})`);
const zeitraum = await historie({ von: '2026-08-22', bis: '2026-08-23' }, 'tokMaster');
ok((zeitraum.body.vorgaenge || []).length === 2, `Filter nach Zeitraum 22.–23.08.: zwei Vorgaenge (${(zeitraum.body.vorgaenge || []).length})`);
ok((zeitraum.body.vorgaenge || []).every((v) => v.am >= '2026-08-22' && v.am <= '2026-08-24'), 'und alle liegen darin');
const zeitraumA = await historie({ von: '2026-08-22', bis: '2026-08-23' }, 'tokA');
ok((zeitraumA.body.vorgaenge || []).length === 1, 'der Zeitraumfilter hebt die Partner-Trennung nicht auf');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 7. Frisch versendeter Sammelbericht taucht sofort auf ───');
reset(); mails = [];
const vorher = ((await historie({}, 'tokMaster')).body.vorgaenge || []).length;
const pv = await ruf({ action: 'sammel_pruefung', jahr: JAHR, woche: WOCHE, wochenrapport_id: WR, projekt_ids: [A1, A2, M1] });
ok(pv.status === 200 && !!pv.body.pruef_id, 'Pruef-Ansicht liefert das Kennzeichen');
const vs = await ruf({ action: 'sammel_versenden', jahr: JAHR, woche: WOCHE, wochenrapport_id: WR, projekt_ids: [A1, A2, M1], pruef_id: pv.body.pruef_id, empfaenger: 'sammel@example.invalid' });
ok(vs.status === 200 && vs.body.ok === true, 'der Sammelversand gelingt (gegen die Mail-Attrappe)');
ok(mails.length === 1, 'genau eine Mail');

const nachher = await historie({}, 'tokMaster');
const neu = (nachher.body.vorgaenge || []).filter((v) => v.typ === 'sammelbericht');
ok((nachher.body.vorgaenge || []).length === vorher + 3, `drei neue Vorgaenge (${(nachher.body.vorgaenge || []).length - vorher})`);
ok(neu.length === 3, 'je enthaltenem Projekt ein Eintrag');
ok(neu.every((v) => v.typ_text === 'Sammelbericht'), 'sie sind als Sammelbericht ausgewiesen');
ok(new Set(neu.map((v) => v.sammel_nr)).size === 1 && neu[0].sammel_nr === vs.body.nr, `alle drei tragen dieselbe Sammelnummer ${neu[0].sammel_nr}`);
ok(new Set(neu.map((v) => v.projekt_id)).size === 3, 'und drei verschiedene Projekte');
ok(neu.every((v) => v.pdf_bytes > 800 && v.von_name === 'Emanuel George'), 'mit Dateigroesse und absendender Person');
ok(neu[0].am === (nachher.body.vorgaenge || [])[0].am, 'der neueste Vorgang steht oben');

// Und die Trennung haelt auch fuer die frischen Eintraege.
const nachA = await historie({}, 'tokA');
const neuA = (nachA.body.vorgaenge || []).filter((v) => v.typ === 'sammelbericht');
ok(neuA.length === 2, `Partner A sieht vom Sammelversand nur seine zwei Projekte (${neuA.length})`);
ok(!neuA.some((v) => v.projekt_id === M1), 'das Master-Projekt aus demselben Sammelbericht bleibt ihm verborgen');
ok(!JSON.stringify(nachA.body.vorgaenge).includes(NR[M1]), 'auch dessen Projektnummer taucht nirgends auf');

console.log(`\n${pass} passed, ${fail} failed`);
console.log(fail ? `✗ ${fail} FEHLER · ${pass} Pruefungen bestanden` : `✓ ALLE ${pass} Pruefungen bestanden`);
process.exit(fail ? 1 : 0);
