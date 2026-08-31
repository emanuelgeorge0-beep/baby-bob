// scripts/test_sammelbericht.mjs — Sammelbericht: EIN PDF aus mehreren Projekten.
//
//   node scripts/test_sammelbericht.mjs
//
// OFFLINE. Faehrt den ECHTEN Handler api/wochenbericht.js gegen ein gemocktes
// Supabase (fetch-Attrappe) und eine gemockte Resend-API. Es geht keine Mail
// raus, es wird nichts in der echten Datenbank angefasst, und der Lauf ist
// deterministisch — deshalb laesst er sich beliebig oft hintereinander gruen
// bekommen, was der Abnahmeauftrag verlangt.
//
// Geprueft wird:
//   1. vier angehakte Projekte ergeben GENAU EIN PDF
//   2. die Gesamtsumme entspricht exakt der Summe der Zwischensummen
//   3. jedes enthaltene Projekt taucht mit Nummer und Zwischensumme im PDF auf
//   4. jede Tageszeile traegt ihre Projektnummer (Zuordnung ueber Seitenumbrueche)
//   5. ein Projekt OHNE Tageszeilen bricht nichts, sondern erscheint mit 0.00
//   6. der Einzelweg liefert unveraendert ein PDF je Projekt (Regression)
//   7. Versand ohne vorherige Pruef-Ansicht ist nicht moeglich
//   8. ein fehlgeschlagener Versand laesst den Status auf entwurf und ok:false
//   9. ein gelungener Versand friert ein, setzt versendet und protokolliert

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://attrappe.supabase.test';
process.env.SUPABASE_KEY = 'test-service-key-fuer-die-attrappe';
process.env.RESEND_API_KEY = 'test-attrappe-kein-echter-schluessel';

const MASTER = 'ee46a716-7017-4045-9f67-fe06d05171e7';
const TECH_U = 'ee46a716-7017-4045-9f67-fe06d05171e8';
const JAHR = 2026, WOCHE = 34;

const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';
const P3 = '33333333-3333-3333-3333-333333333333';
const P4 = '44444444-4444-4444-4444-444444444444';
const P5 = '55555555-5555-5555-5555-555555555555';   // ohne Tageszeilen
const WR = '99999999-9999-9999-9999-999999999999';

const NR = { [P1]: '60060.00', [P2]: '60133.00', [P3]: '60586.00', [P4]: '60829.00', [P5]: '60900.00' };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

// ── Die gemockte Datenbank ────────────────────────────────────────────────
// Nur Zeilen, keine Logik. Die Filter werden unten von einem winzigen
// PostgREST-Nachbau ausgewertet, damit der Handler exakt seine echten Abfragen
// stellen darf und der Test nicht an einer umformulierten Query zerbricht.
let db;
function reset() {
  db = {
    user_roles: [{ user_id: MASTER, role: 'master' }],
    gs_techniker: [{ id: 'tt', user_id: TECH_U, name: 'Test Techniker' }],
    gs_wochenrapporte: [{ id: WR, jahr: JAHR, woche: WOCHE, techniker_user_id: TECH_U, rapport_nr: 'R-TT-2026-0004' }],
    gs_projekte: [
      { id: P1, name: 'Neubau Seestrasse', projektnummer: NR[P1], kuerzel: 'SEE', standort: 'Seestrasse 4', kunde_id: null, projektleiter: 'E. George', ansprechperson: 'Bauleiter Eins', ansprech_email: 'eins@example.invalid', partner_user_id: null },
      { id: P2, name: 'Umbau Bahnhofplatz', projektnummer: NR[P2], kuerzel: 'BHP', standort: null, kunde_id: null, projektleiter: null, ansprechperson: null, ansprech_email: 'zwei@example.invalid', partner_user_id: null },
      { id: P3, name: 'Sanierung Lindenweg', projektnummer: NR[P3], kuerzel: 'LIN', standort: null, kunde_id: null, projektleiter: null, ansprechperson: null, ansprech_email: null, partner_user_id: null },
      { id: P4, name: 'Ersatz Heizzentrale', projektnummer: NR[P4], kuerzel: 'HZG', standort: null, kunde_id: null, projektleiter: null, ansprechperson: null, ansprech_email: null, partner_user_id: null },
      { id: P5, name: 'Ruhende Baustelle', projektnummer: NR[P5], kuerzel: 'RUH', standort: null, kunde_id: null, projektleiter: null, ansprechperson: null, ansprech_email: null, partner_user_id: null },
    ],
    gs_kunden: [],
    gs_partner_profil: [],
    gs_projekt_medien: [],
    gs_tagesrapport_taetigkeitenkatalog: [],
    gs_wochenberichte: [],
    // Jeder Tag gehoert genau einem Projekt — damit ist das "fuehrende Projekt"
    // je Kalendertag eindeutig und die Tagespauschale faellt genau einmal an.
    gs_tagesrapporte: [
      zeile('t1', '2026-08-17', P1, 8, 30, 'Steigzonen montiert'),
      zeile('t2', '2026-08-18', P2, 7.5, 30, 'Verteiler gesetzt'),
      zeile('t3', '2026-08-19', P3, 6, 30, 'Leitungen gespuelt'),
      zeile('t4', '2026-08-20', P3, 4, 0, 'Druckprobe'),
      zeile('t5', '2026-08-21', P4, 5, 30, 'Kessel angeschlossen'),
    ],
  };
}
function zeile(id, datum, projekt_id, std, spesen, taetigkeit) {
  return {
    id, datum, projekt_id, techniker_user_id: TECH_U, erfasst_von: TECH_U, wochenrapport_id: WR,
    taetigkeit, start_zeit: '07:00', end_zeit: '17:00', pause_minuten: 60, stunden_manuell: null,
    gesamtstunden: std, ueberzeit_25: 0, ueberzeit_50: 0, ueberzeit_100: 0, spesen,
    projektnummer_erfasst: NR[projekt_id], abwesenheit: null, abwesenheit_grund: null,
    material: null, material_positionen: null, arbeiten: [taetigkeit], besonderheiten: null,
    woche: WOCHE, jahr: JAHR, created_at: `${datum}T06:00:00Z`, abrechnung_status: 'offen',
  };
}

// ── Winziger PostgREST-Nachbau: parst genau die Operatoren, die vorkommen ──
function leseTabelle(pfad) {
  const [tabelle, qs] = pfad.split('?');
  const rows = (db[tabelle] || []).slice();
  const params = new URLSearchParams(qs || '');
  let out = rows;
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

// ── fetch-Attrappe ────────────────────────────────────────────────────────
let mailAntwort = { ok: true, id: 'mail-1' };
let mails = [];
let storageUploads = [];

const res = (body, okFlag = true, status = 200) => ({
  ok: okFlag, status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  arrayBuffer: async () => new ArrayBuffer(0),
});

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = (opts.method || 'GET').toUpperCase();

  // Mail-ATTRAPPE. Es geht nie eine echte Mail raus.
  if (u.includes('api.resend.com')) {
    mails.push(JSON.parse(opts.body));
    return mailAntwort.ok ? res({ id: mailAntwort.id }) : res(mailAntwort.error || 'abgelehnt', false, 422);
  }
  if (u.includes('/auth/v1/user')) {
    const tok = String((opts.headers || {}).Authorization || '').replace('Bearer ', '').trim();
    return tok === 'tokMaster' ? res({ id: MASTER, email: 'master@test' }) : res({ error: 'bad' }, false, 401);
  }
  if (u.includes('/storage/v1/object/')) {
    if (method === 'POST') { storageUploads.push(u); return res({ Key: 'ok' }); }
    return res('nicht gefunden', false, 404);
  }
  if (u.includes('/rest/v1/')) {
    const pfad = decodeURIComponent(u.split('/rest/v1/')[1]);
    const [tabelle] = pfad.split('?');
    if (!(tabelle in db)) return res(`relation "${tabelle}" does not exist`, false, 404);

    if (method === 'GET') return res(leseTabelle(pfad));
    if (method === 'POST') {
      const roh = JSON.parse(opts.body);
      // Spalten-Vorgaben aus scripts/wochenbericht.sql nachbilden — sonst
      // haette eine frisch angelegte Zeile gar keinen Status und der Test
      // koennte "bleibt auf entwurf" nicht ehrlich pruefen.
      const vorgabe = tabelle === 'gs_wochenberichte'
        ? { quelle: 'projekt', status: 'entwurf', daten: null, pdf_path: null, empfaenger: [], versendet_am: null, versand_protokoll: [] }
        : {};
      const neu = { id: `neu-${db[tabelle].length + 1}-${tabelle}`, created_at: new Date().toISOString(), ...vorgabe, ...roh };
      db[tabelle].push(neu);
      return res([neu]);
    }
    if (method === 'PATCH') {
      const treffer = leseTabelle(pfad);
      const patch = JSON.parse(opts.body);
      for (const r of treffer) Object.assign(r, patch);
      return res(treffer);
    }
  }
  return res('unbekannter Aufruf: ' + u, false, 500);
};

// ── Handler aufrufen ──────────────────────────────────────────────────────
const { default: handler, versandHistorie } = await import('../api/wochenbericht.js');

async function ruf(body, token = 'tokMaster') {
  let out = { status: 0, body: null };
  const res_ = {
    setHeader() {}, status(s) { out.status = s; return this; },
    json(j) { out.body = j; return this; }, end() { return this; },
  };
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res_);
  return out;
}

// PDF-Text aus dem unkomprimierten Inhaltsstrom (lib/pdf.js schreibt Text als
// reines latin1, nur Bilder sind Flate-kodiert).
function pdfText(b64) {
  const roh = Buffer.from(b64, 'base64').toString('latin1');
  const teile = [];
  for (const m of roh.matchAll(/\((?:\\.|[^\\()])*\)\s*Tj/g)) {
    teile.push(m[0].slice(1, m[0].lastIndexOf(')')).replace(/\\([()\\])/g, '$1').replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))));
  }
  return teile.join('\n');
}

console.log('\n══ SAMMELBERICHT ══');

// ═══════════════════════════════════════════════════════════════════════════
reset();
console.log('\n── 1. Vier angehakte Projekte ergeben GENAU EIN PDF ───────');
const vier = [P1, P2, P3, P4];
const r1 = await ruf({ action: 'sammel_pruefung', jahr: JAHR, woche: WOCHE, wochenrapport_id: WR, projekt_ids: vier });
ok(r1.status === 200 && r1.body.ok, `Pruef-Ansicht liefert 200 (${r1.status}${r1.body && r1.body.error ? ' · ' + r1.body.error : ''})`);
ok(typeof r1.body.pdf_base64 === 'string' && !Array.isArray(r1.body.pdf_base64), 'genau ein pdf_base64, keine Liste');
const pdf1 = Buffer.from(r1.body.pdf_base64 || '', 'base64');
ok(pdf1.slice(0, 5).toString() === '%PDF-', `es ist ein PDF (${Math.round(pdf1.length / 1024)} KB)`);
ok(r1.body.projekte.length === 4, `vier Projekte im einen Dokument (${(r1.body.projekte || []).length})`);
ok(/^SB-TT-2026-34$/.test(r1.body.nr || ''), `eigene Nummer nach bestehendem Schema: ${r1.body.nr}`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 2. Gesamtsumme = Summe der Zwischensummen ──────────────');
const zwStd = r1.body.projekte.reduce((a, p) => a + p.stunden, 0);
const zwSp = r1.body.projekte.reduce((a, p) => a + p.spesen, 0);
ok(Math.abs(r1.body.summen.stunden - zwStd) < 0.0001, `Stunden: gesamt ${r1.body.summen.stunden.toFixed(2)} = Summe ${zwStd.toFixed(2)}`);
ok(Math.abs(r1.body.summen.spesen - zwSp) < 0.0001, `Spesen: gesamt ${r1.body.summen.spesen.toFixed(2)} = Summe ${zwSp.toFixed(2)}`);
ok(Math.abs(r1.body.summen.stunden - 30.5) < 0.0001, `erwartete 30.50 h (${r1.body.summen.stunden.toFixed(2)})`);
ok(Math.abs(r1.body.summen.spesen - 120) < 0.0001, `erwartete CHF 120.00 (${r1.body.summen.spesen.toFixed(2)})`);
const txt1 = pdfText(r1.body.pdf_base64);
ok(/Gesamtsumme/.test(txt1), 'Abschnitt "Gesamtsumme" steht im PDF');
ok(txt1.split('\n').filter((l) => l.trim() === '30.50').length >= 2, 'die 30.50 steht im PDF (Deckblatt und Gesamtsumme)');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 3. Jedes Projekt mit Nummer und Zwischensumme ──────────');
for (const p of vier) {
  ok(txt1.includes(NR[p]), `${NR[p]} steht im PDF`);
  const zeileText = new RegExp(`Zwischensumme ${NR[p].replace('.', '\\.')}: `);
  ok(zeileText.test(txt1), `Zwischensumme fuer ${NR[p]} ausgewiesen`);
}
ok(/Zwischensumme 60060\.00: 8\.00 h/.test(txt1), 'Zwischensumme P1 = 8.00 h');
ok(/Zwischensumme 60586\.00: 10\.00 h/.test(txt1), 'Zwischensumme P3 = 10.00 h (zwei Tage)');
ok(txt1.includes('Enthaltene Projekte'), 'Deckblatt fuehrt die enthaltenen Projekte auf');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 4. Jede Tageszeile traegt ihre Projektnummer ───────────');
// P3 hat zwei Tageszeilen, also muss 60586.00 mindestens 2x als Zeilenzelle
// vorkommen (plus Deckblatt, Abschnittskopf, Zwischensumme, Gesamtsumme).
const zaehl = (s) => txt1.split('\n').filter((l) => l.trim() === s).length;
ok(zaehl(NR[P3]) >= 2, `${NR[P3]} steht als eigene Zelle in beiden Tageszeilen (${zaehl(NR[P3])}x)`);
ok(zaehl(NR[P1]) >= 1, `${NR[P1]} steht als eigene Zelle in seiner Tageszeile (${zaehl(NR[P1])}x)`);
ok(txt1.includes('PROJEKT') && txt1.includes('DATUM') && txt1.includes('TECHNIKER'),
  'die Tagestabelle fuehrt Projekt, Datum und Techniker als Spalten');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 5. Projekt OHNE Tageszeilen bricht nichts ──────────────');
const fuenf = [P1, P2, P3, P4, P5];
const r5 = await ruf({ action: 'sammel_pruefung', jahr: JAHR, woche: WOCHE, wochenrapport_id: WR, projekt_ids: fuenf });
ok(r5.status === 200 && r5.body.ok, 'Bericht mit einem leeren Projekt wird erzeugt');
ok(r5.body.projekte.length === 5, `fuenf Abschnitte (${(r5.body.projekte || []).length})`);
const leer = (r5.body.projekte || []).find((p) => p.projekt_id === P5);
ok(!!leer && leer.stunden === 0 && leer.spesen === 0, `${NR[P5]} erscheint mit Zwischensumme 0.00`);
ok(Math.abs(r5.body.summen.stunden - 30.5) < 0.0001, 'Gesamtsumme unveraendert 30.50 h');
const txt5 = pdfText(r5.body.pdf_base64);
ok(/Zwischensumme 60900\.00: 0\.00 h/.test(txt5), 'Zwischensumme 0.00 steht im PDF');
ok(/nichts gebucht/.test(txt5), 'der Abschnitt sagt im Klartext, dass nichts gebucht wurde');
ok((r5.body.hinweise || []).some((x) => /ohne Buchung/.test(x)), 'Hinweis zur Datenlage nennt das leere Projekt');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 6. Regression: der Einzelweg bleibt ein PDF je Projekt ─');
reset();
const einzeln = [];
for (const p of vier) {
  const e = await ruf({ action: 'pdf', projekt_id: p, jahr: JAHR, woche: WOCHE });
  ok(e.status === 200 && !!e.body.pdf_base64, `${NR[p]}: eigenes PDF erzeugt`);
  einzeln.push(e.body);
}
ok(einzeln.length === 4, 'vier Projekte → vier PDFs (unveraendert)');
ok(new Set(einzeln.map((x) => x.bericht.bericht_nr)).size === 4, 'vier verschiedene Berichtsnummern');
ok(einzeln.every((x) => /^WB-/.test(x.bericht.bericht_nr)), 'die Einzelnummern bleiben WB-… und unberuehrt');
ok(db.gs_wochenberichte.length === 4, `vier Berichtskoepfe angelegt (${db.gs_wochenberichte.length})`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 7. Versand ohne Pruef-Ansicht ist nicht moeglich ───────');
reset();
const ohne = await ruf({ action: 'sammel_versenden', jahr: JAHR, woche: WOCHE, wochenrapport_id: WR, projekt_ids: vier, empfaenger: 'bauleiter@example.invalid' });
ok(ohne.status === 400 && ohne.body.pruefung_fehlt === true, 'ohne pruef_id: abgelehnt');
ok(mails.length === 0, 'es ging nichts raus');

const geraten = await ruf({ action: 'sammel_versenden', jahr: JAHR, woche: WOCHE, wochenrapport_id: WR, projekt_ids: vier, pruef_id: 'a'.repeat(32), empfaenger: 'bauleiter@example.invalid' });
ok(geraten.status === 400 && geraten.body.pruefung_fehlt === true, 'mit geratenem Kennzeichen: abgelehnt');

const pruef = await ruf({ action: 'sammel_pruefung', jahr: JAHR, woche: WOCHE, wochenrapport_id: WR, projekt_ids: [P1, P2] });
const fremd = await ruf({ action: 'sammel_versenden', jahr: JAHR, woche: WOCHE, wochenrapport_id: WR, projekt_ids: vier, pruef_id: pruef.body.pruef_id, empfaenger: 'bauleiter@example.invalid' });
ok(fremd.status === 400 && fremd.body.pruefung_fehlt === true, 'Kennzeichen einer ANDEREN Auswahl: abgelehnt');
ok(mails.length === 0, 'auch dabei ging nichts raus');
ok(db.gs_wochenberichte.every((r) => r.status !== 'versendet'), 'kein Bericht wurde auf versendet gesetzt');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 8. Fehlgeschlagener Versand: entwurf und ok:false ──────');
reset(); mails = []; mailAntwort = { ok: false, error: 'Attrappe lehnt ab' };
const pv8 = await ruf({ action: 'sammel_pruefung', jahr: JAHR, woche: WOCHE, wochenrapport_id: WR, projekt_ids: vier });
const v8 = await ruf({ action: 'sammel_versenden', jahr: JAHR, woche: WOCHE, wochenrapport_id: WR, projekt_ids: vier, pruef_id: pv8.body.pruef_id, empfaenger: 'bauleiter@example.invalid' });
ok(v8.status === 200 && v8.body.ok === false, 'der Versand meldet sich als fehlgeschlagen');
ok(db.gs_wochenberichte.length === 4, 'die vier Berichtskoepfe existieren');
ok(db.gs_wochenberichte.every((r) => r.status === 'entwurf'), 'alle vier bleiben auf entwurf');
const eintraege8 = db.gs_wochenberichte.flatMap((r) => r.versand_protokoll || []);
ok(eintraege8.length === 4, `vier Protokolleintraege (${eintraege8.length})`);
ok(eintraege8.every((e) => e.ok === false), 'jeder Eintrag steht auf ok:false');
ok(eintraege8.every((e) => e.typ === 'sammelbericht' && e.sammel_nr === 'SB-TT-2026-34'), 'Typ und Sammelnummer stehen im Protokoll');
ok(db.gs_wochenberichte.every((r) => !r.daten), 'nichts wurde eingefroren');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 9. Gelungener Versand: einfrieren, versendet, Protokoll ─');
reset(); mails = []; storageUploads = []; mailAntwort = { ok: true, id: 'mail-ok' };
const pv9 = await ruf({ action: 'sammel_pruefung', jahr: JAHR, woche: WOCHE, wochenrapport_id: WR, projekt_ids: vier });
ok((pv9.body.empfaenger_vorschlag || []).join(',') === 'eins@example.invalid,zwei@example.invalid',
  `Empfaenger vorbelegt: ${(pv9.body.empfaenger_vorschlag || []).join(', ')}`);
ok(/Ansprechperson/.test(pv9.body.empfaenger_herkunft_text || ''), `Herkunft im Klartext: ${pv9.body.empfaenger_herkunft_text}`);
const v9 = await ruf({ action: 'sammel_versenden', jahr: JAHR, woche: WOCHE, wochenrapport_id: WR, projekt_ids: vier, pruef_id: pv9.body.pruef_id, empfaenger: 'bauleiter@example.invalid' });
ok(v9.status === 200 && v9.body.ok === true, 'Versand gemeldet als gelungen');
ok(mails.length === 1, `GENAU EINE Mail fuer vier Projekte (${mails.length})`);
ok((mails[0].attachments || []).length === 1, 'genau ein Anhang');
ok(mails[0].attachments[0].filename === 'SB-TT-2026-34.pdf', `Anhang heisst ${mails[0].attachments[0].filename}`);
ok(mails[0].to.join(',') === 'bauleiter@example.invalid', 'die eingetippte Adresse gilt');
ok(db.gs_wochenberichte.length === 4 && db.gs_wochenberichte.every((r) => r.status === 'versendet'), 'alle vier stehen auf versendet');
ok(db.gs_wochenberichte.every((r) => r.daten && r.daten.kopf), 'alle vier sind eingefroren');
const eintraege9 = db.gs_wochenberichte.flatMap((r) => r.versand_protokoll || []);
ok(eintraege9.length === 4 && eintraege9.every((e) => e.ok === true), 'vier Protokolleintraege mit ok:true');
ok(eintraege9.every((e) => e.pdf_bytes > 800 && e.pdf_path), 'Dateigroesse und Ablagepfad stehen im Protokoll');
ok(new Set(eintraege9.map((e) => e.bericht_nr)).size === 4, 'jeder Eintrag nennt die Nummer SEINES Einzelberichts');
ok(db.gs_wochenberichte.every((r) => /^WB-/.test(r.bericht_nr)), 'die Nummern der Einzelberichte blieben unberuehrt');
ok(storageUploads.length === 1 && /sammel/.test(storageUploads[0]), 'das Sammel-PDF wurde einmal abgelegt');

// Der Einzelweg funktioniert danach unveraendert weiter — jetzt aus dem
// eingefrorenen Stand, genau wie nach einem Einzelversand.
const nach = await ruf({ action: 'pdf', projekt_id: P1, jahr: JAHR, woche: WOCHE });
ok(nach.status === 200 && nach.body.aus_snapshot === true, 'der Einzelbericht rendert danach aus dem Snapshot');

console.log(`\n${pass} passed, ${fail} failed`);
console.log(fail ? `✗ ${fail} FEHLER · ${pass} Pruefungen bestanden` : `✓ ALLE ${pass} Pruefungen bestanden`);
process.exit(fail ? 1 : 0);
