// scripts/test_rapport_feld.mjs — Runde "Rapport Feld", Phasen 1 bis 6.
//
//   node scripts/test_rapport_feld.mjs
//
// OFFLINE und deterministisch. Fährt die ECHTEN Handler (api/cockpit.js,
// api/wochenbericht.js) und die echten Bibliotheken gegen ein gemocktes
// Supabase. Es geht keine Mail raus, die Live-Datenbank wird nicht angefasst,
// der Lauf lässt sich beliebig oft wiederholen — genau das verlangt der
// Abnahmeauftrag (5× grün).
//
// Die Attrappe bildet AUCH die DB-Regeln nach, die scripts/rapport_feld.sql
// setzt (CHECK auf abwesenheit, CHECK auf datum). Sonst bewiese der Test nur,
// dass der Server nichts verbietet — und nicht, dass die Kette hält.
//
// Geprüft wird:
//   Phase 1 — Abwesenheiten
//     1.1  alle elf Kürzel werden angenommen, ein unbekanntes nicht
//     1.2  eine Abwesenheit K erhöht das Stundentotal NICHT
//     1.3  Abwesenheitsstunden laufen als eigene Summe mit
//     1.4  im Stundenblatt-PDF stehen sie in einem eigenen Block mit Summe
//     1.5  ohne Migration meldet der Server die fehlende Migration im Klartext

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://attrappe.supabase.test';
process.env.SUPABASE_KEY = 'test-service-key-fuer-die-attrappe';
process.env.RESEND_API_KEY = 'test-attrappe-kein-echter-schluessel';

const MASTER = 'ee46a716-7017-4045-9f67-fe06d05171e7';
const TECHU = 'ee46a716-7017-4045-9f67-fe06d05171e8';   // Techniker (User-ID)
const TECHID = '77777777-7777-7777-7777-777777777777';  // gs_techniker.id
const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';
const WR = '99999999-9999-9999-9999-999999999999';
const JAHR = 2026, WOCHE = 36;
const NR = { [P1]: '60060.00', [P2]: '60133.00' };
// Montag der KW 36/2026 — alle Testdaten liegen in dieser Woche.
const MO = '2026-08-31', DI = '2026-09-01', MI = '2026-09-02', DO = '2026-09-03';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const abschnitt = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`);

// ═══════════════════════════════════════════════════════════════════════════
// Die gemockte Datenbank
// ═══════════════════════════════════════════════════════════════════════════
// Zwei Schalter bilden den Migrationsstand nach. So lässt sich beides prüfen:
// mit gelaufener scripts/rapport_feld.sql und ohne.
let migriertAbwesenheit = true;
const ABW_ALT = ['G', 'F', 'M', 'U', 'A'];
const ABW_NEU = ['G', 'F', 'M', 'U', 'A', 'K', 'B', 'AR', 'S', 'UB', 'SW'];

let db;
function reset() {
  migriertAbwesenheit = true;
  db = {
    user_roles: [{ user_id: MASTER, role: 'master' }, { user_id: TECHU, role: 'techniker' }],
    user_extra_roles: [],
    gs_techniker: [{ id: TECHID, user_id: TECHU, name: 'Test Techniker' }],
    gs_projekt_techniker: [
      { id: 'pt1', projekt_id: P1, techniker_id: TECHID },
      { id: 'pt2', projekt_id: P2, techniker_id: TECHID },
    ],
    gs_wochenrapporte: [{
      id: WR, jahr: JAHR, woche: WOCHE, techniker_user_id: TECHU, techniker_id: TECHID,
      rapport_nr: 'R-TT-2026-0006', status: 'entwurf', eingereicht_am: null, hauptprojekt_id: P1,
    }],
    gs_projekte: [
      { id: P1, name: 'Arzt Praxis', projektnummer: NR[P1], kuerzel: 'ARZ', standort: 'Bahnhofstrasse 1', kunde_id: null, projektleiter: null, ansprechperson: null, ansprech_email: null, partner_user_id: null, status: 'aktiv', geloescht_at: null, unvollstaendig: false, fremdnummer: null },
      { id: P2, name: 'Stofer Manuel', projektnummer: NR[P2], kuerzel: 'STO', standort: null, kunde_id: null, projektleiter: null, ansprechperson: null, ansprech_email: null, partner_user_id: null, status: 'aktiv', geloescht_at: null, unvollstaendig: false, fremdnummer: null },
    ],
    gs_kunden: [],
    gs_partner_profil: [],
    gs_branding: [],
    gs_projekt_medien: [],
    gs_tagesrapport_taetigkeitenkatalog: [],
    gs_taetigkeitenkatalog: [],
    gs_wochenberichte: [],
    gs_wochenrapport_log: [],
    gs_tagesrapporte: [],
    gs_partner_entitlements: [],
    gs_service_auftrag: [],
  };
}

// ── DB-Regeln, die scripts/rapport_feld.sql setzt ────────────────────────
// Nachgebildet, damit der Test nicht nur den Server, sondern die ganze Kette
// belegt. Wirft dieselben Meldungen wie PostgREST.
function pruefeTagesrapport(row) {
  const erlaubt = migriertAbwesenheit ? ABW_NEU : ABW_ALT;
  if (row.abwesenheit != null && !erlaubt.includes(row.abwesenheit)) {
    return '{"code":"23514","message":"new row for relation \\"gs_tagesrapporte\\" violates check constraint \\"gs_tagesrapporte_abwesenheit_chk\\""}';
  }
  const hatProjekt = !!row.projekt_id, hatService = !!row.service_auftrag_id, hatAbw = !!row.abwesenheit;
  if ([hatProjekt, hatService, hatAbw].filter(Boolean).length !== 1) {
    return '{"code":"23514","message":"violates check constraint \\"gs_tagesrapporte_bindung_chk\\""}';
  }
  if (row.datum && !(row.datum >= '2000-01-01' && row.datum < '2100-01-01')) {
    return '{"code":"23514","message":"violates check constraint \\"gs_tagesrapporte_datum_plausibel_chk\\""}';
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Winziger PostgREST-Nachbau
// ═══════════════════════════════════════════════════════════════════════════
function leseTabelle(pfad) {
  const [tabelle, qs] = pfad.split('?');
  let out = (db[tabelle] || []).slice();
  const params = new URLSearchParams(qs || '');
  for (const [key, raw] of params.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    if (key === 'or') continue;
    const m = String(raw).match(/^(eq|neq|gt|gte|lt|lte|is|in|not|like|ilike)\.(.*)$/s);
    if (!m) continue;
    let [, op, wert] = m;
    let negiert = false;
    if (op === 'not') {
      const m2 = wert.match(/^(eq|is|in)\.(.*)$/s);
      if (!m2) continue;
      negiert = true; op = m2[1]; wert = m2[2];
    }
    out = out.filter((r) => {
      const v = r[key];
      let t;
      if (op === 'eq') t = String(v) === wert;
      else if (op === 'neq') t = String(v) !== wert;
      else if (op === 'gt') t = Number(v) > Number(wert);
      else if (op === 'gte') t = String(v) >= wert;
      else if (op === 'lt') t = Number(v) < Number(wert);
      else if (op === 'lte') t = String(v) <= wert;
      else if (op === 'is') t = wert === 'null' ? (v == null) : (String(v) === wert);
      else if (op === 'in') t = wert.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(v));
      else if (op === 'like' || op === 'ilike') {
        const re = new RegExp('^' + wert.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/\\\*/g, '.*') + '$', op === 'ilike' ? 'i' : '');
        t = re.test(String(v ?? ''));
      } else t = true;
      return negiert ? !t : t;
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

const res = (body, okFlag = true, status = 200) => ({
  ok: okFlag, status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  arrayBuffer: async () => new ArrayBuffer(0),
});

let mails = [];
let storage = {};      // "bucket/path" -> bytes
const TOKENS = { tokMaster: MASTER, tokTech: TECHU };

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = (opts.method || 'GET').toUpperCase();

  if (u.includes('api.resend.com')) { mails.push(JSON.parse(opts.body)); return res({ id: 'mail-1' }); }
  if (u.includes('/auth/v1/user')) {
    const tok = String((opts.headers || {}).Authorization || '').replace('Bearer ', '').trim();
    const id = TOKENS[tok];
    return id ? res({ id, email: id + '@test' }) : res({ error: 'bad' }, false, 401);
  }
  if (u.includes('/storage/v1/object/sign/')) {
    return res({ signedURL: '/object/sign/x?token=t' });
  }
  if (u.includes('/storage/v1/object/')) {
    const schluessel = u.split('/storage/v1/object/')[1].split('?')[0];
    if (method === 'POST' || method === 'PUT') {
      storage[schluessel] = opts.body ? (opts.body.length || opts.body.byteLength || 1) : 0;
      return res({ Key: schluessel });
    }
    if (method === 'DELETE') { delete storage[schluessel]; return res({}); }
    if (schluessel in storage) return res('bytes');
    return res('nicht gefunden', false, 404);
  }
  if (u.includes('/rest/v1/')) {
    const pfad = decodeURIComponent(u.split('/rest/v1/')[1]);
    const [tabelle] = pfad.split('?');
    if (!(tabelle in db)) return res(`relation "public.${tabelle}" does not exist`, false, 404);

    if (method === 'GET') return res(leseTabelle(pfad));
    if (method === 'POST') {
      const roh = JSON.parse(opts.body);
      const liste = Array.isArray(roh) ? roh : [roh];
      const neu = [];
      for (const r of liste) {
        const zeile = {
          id: r.id || `${tabelle}-${db[tabelle].length + 1}-${Math.random().toString(36).slice(2, 6)}`,
          created_at: new Date().toISOString(), ...r,
        };
        if (tabelle === 'gs_tagesrapporte') {
          const f = pruefeTagesrapport(zeile);
          if (f) return res(f, false, 400);
          const kollision = db.gs_tagesrapporte.find((x) => x.id !== zeile.id
            && x.datum === zeile.datum && x.techniker_user_id === zeile.techniker_user_id
            && zeile.projekt_id && x.projekt_id === zeile.projekt_id);
          if (kollision) return res('{"code":"23505","message":"duplicate key"}', false, 409);
        }
        // on_conflict=id + merge-duplicates: bestehende Zeile ersetzen
        const vorhanden = db[tabelle].findIndex((x) => x.id === zeile.id);
        if (vorhanden >= 0) db[tabelle][vorhanden] = { ...db[tabelle][vorhanden], ...zeile };
        else db[tabelle].push(zeile);
        neu.push(db[tabelle].find((x) => x.id === zeile.id));
      }
      return res(neu);
    }
    if (method === 'PATCH') {
      const treffer = leseTabelle(pfad);
      const patch = JSON.parse(opts.body);
      for (const r of treffer) {
        if (tabelle === 'gs_tagesrapporte') {
          const f = pruefeTagesrapport({ ...r, ...patch });
          if (f) return res(f, false, 400);
        }
        Object.assign(r, patch);
      }
      return res(treffer);
    }
    if (method === 'DELETE') {
      const treffer = leseTabelle(pfad);
      db[tabelle] = db[tabelle].filter((r) => !treffer.includes(r));
      return res(treffer);
    }
  }
  return res('unbekannter Aufruf: ' + u, false, 500);
};

// ═══════════════════════════════════════════════════════════════════════════
// Handler-Aufrufer
// ═══════════════════════════════════════════════════════════════════════════
const { default: cockpit } = await import('../api/cockpit.js');
const { sammleWochenrapport, buildWochenrapportPdf } = await import('../lib/wochenbericht.js');

async function ruf(body) {
  let out = { status: 0, body: null };
  const r = {
    setHeader() {}, status(s) { out.status = s; return this; },
    json(j) { out.body = j; return this; }, end() { return this; },
  };
  await cockpit({ method: 'POST', headers: {}, body }, r);
  return out;
}
const tech = (action, extra = {}) => ruf({ token: 'tokTech', mode: 'techniker', action, ...extra });

// Text aus dem unkomprimierten PDF-Inhaltsstrom (lib/pdf.js schreibt Text als
// reines latin1; nur Bilder sind Flate-kodiert).
function pdfText(bytes) {
  const roh = Buffer.from(bytes).toString('latin1');
  return [...roh.matchAll(/\(((?:\\.|[^()\\])*)\)\s*Tj/g)]
    .map((m) => m[1].replace(/\\([()\\])/g, '$1')).join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 — Abwesenheiten
// ═══════════════════════════════════════════════════════════════════════════
async function phase1() {
  abschnitt('Phase 1 · Abwesenheiten erweitert, Stunden getrennt');
  reset();

  // 1.1 Alle elf Kürzel durch — jedes an einem eigenen Tag, sonst kollidiert die
  // Zeile mit sich selbst.
  const { ABWESENHEIT_KATALOG } = await import('../lib/abwesenheit.js');
  ok(ABWESENHEIT_KATALOG.length === 11, `Katalog trägt 11 Gründe (${ABWESENHEIT_KATALOG.length})`);
  for (const neu of ['K', 'B', 'AR', 'S', 'UB', 'SW']) {
    ok(ABWESENHEIT_KATALOG.some((x) => x.code === neu), `Kürzel ${neu} im Katalog`);
  }

  let angenommen = 0;
  for (let i = 0; i < ABWESENHEIT_KATALOG.length; i++) {
    const tag = `2026-0${i < 3 ? '8' : '9'}-${String(i < 3 ? 29 + i : i - 2).padStart(2, '0')}`;
    const r = await tech('tech_tag_save', { datum: tag, abwesenheit: ABWESENHEIT_KATALOG[i].code, stunden: 8 });
    if (r.status === 200 && r.body && r.body.ok) angenommen++;
    else console.log(`      → ${ABWESENHEIT_KATALOG[i].code}: ${JSON.stringify(r.body).slice(0, 140)}`);
  }
  ok(angenommen === 11, `alle 11 Kürzel werden gespeichert (${angenommen}/11)`);

  const schrott = await tech('tech_tag_save', { datum: DO, abwesenheit: 'XX', stunden: 8 });
  ok(schrott.status >= 400 || (schrott.body && schrott.body.error),
    'ein unbekanntes Kürzel wird abgewiesen');

  // 1.2/1.3 Stundentotal: Arbeit und Abwesenheit getrennt.
  reset();
  const a = await tech('tech_tag_save', { datum: MO, projekt_id: P1, stunden: 8, start_zeit: '07:00', end_zeit: '16:00', spesen: 30 });
  ok(a.status === 200 && a.body.ok, 'Arbeitstag 8.00 h gespeichert');
  const b = await tech('tech_tag_save', { datum: DI, abwesenheit: 'K', abwesenheit_grund: 'Grippe', stunden: 8 });
  ok(b.status === 200 && b.body.ok, 'Krankheitstag K mit 8.00 h gespeichert');
  const c = await tech('tech_tag_save', { datum: MI, projekt_id: P2, stunden: 6.5, start_zeit: '07:00', end_zeit: '14:30' });
  ok(c.status === 200 && c.body.ok, 'zweiter Arbeitstag 6.50 h gespeichert');

  const w = await tech('tech_wochen_rapport', { jahr: JAHR, woche: WOCHE });
  ok(w.status === 200, 'Wochenblatt geladen');
  const d = w.body || {};
  ok(d.total_stunden === 14.5,
    `Total erfasste Stunden = 14.50 h — die 8 h Krankheit sind NICHT drin (ist: ${d.total_stunden})`);
  ok(d.total_abwesenheit_stunden === 8,
    `Abwesenheitsstunden laufen getrennt mit 8.00 h (ist: ${d.total_abwesenheit_stunden})`);
  ok(Array.isArray(d.abwesenheit_katalog) && d.abwesenheit_katalog.length === 11,
    'die Oberfläche bekommt den Katalog vom Server');
  const bl = d.abwesenheit_bloecke || [];
  ok(bl.length === 1 && bl[0].code === 'K' && bl[0].stunden === 8 && bl[0].tage === 1,
    'eigener Block je Grund: K · 1 Tag · 8.00 h');
  ok((bl[0] || {}).label === 'Krankheit', 'der Block trägt den Klartext "Krankheit"');

  // Gegenprobe: ohne die Abwesenheit wäre das Total dasselbe.
  db.gs_tagesrapporte = db.gs_tagesrapporte.filter((z) => !z.abwesenheit);
  const w2 = await tech('tech_wochen_rapport', { jahr: JAHR, woche: WOCHE });
  ok(w2.body.total_stunden === 14.5, 'ohne die Abwesenheitszeile steht dasselbe Total — sie hat nie mitgezählt');

  // 1.4 Stundenblatt-PDF: eigener Block mit eigener Summe.
  reset();
  await tech('tech_tag_save', { datum: MO, projekt_id: P1, stunden: 8, start_zeit: '07:00', end_zeit: '16:00' });
  await tech('tech_tag_save', { datum: DI, abwesenheit: 'K', abwesenheit_grund: 'Grippe', stunden: 8 });
  await tech('tech_tag_save', { datum: MI, abwesenheit: 'AR', abwesenheit_grund: 'Kontrolle', stunden: 2 });
  const daten = await sammleWochenrapport({ wochenrapportId: WR });
  ok(daten.summen.stunden === 8, `PDF-Daten: Arbeitsstunden 8.00 (ist: ${daten.summen.stunden})`);
  ok(daten.summen.abwesenheit_stunden === 10, `PDF-Daten: Abwesenheit 10.00 (ist: ${daten.summen.abwesenheit_stunden})`);
  ok(daten.summen.tage === 1, `PDF-Daten: 1 Arbeitstag (ist: ${daten.summen.tage})`);
  ok((daten.abwesenheiten || []).length === 2, 'zwei Abwesenheitsblöcke (K und AR)');

  const pdf = buildWochenrapportPdf(daten, {});
  const txt = pdfText(pdf);
  ok(/Abwesenheiten/.test(txt), 'das PDF trägt eine Überschrift "Abwesenheiten"');
  ok(/Krankheit/.test(txt) && /Arztbesuch/.test(txt), 'beide Gründe stehen im Klartext im PDF');
  ok(/Total Abwesenheit: 10\.00 h/.test(txt), 'das PDF nennt die eigene Summe 10.00 h');
  ok(/NICHT enthalten/.test(txt), 'das PDF sagt ausdrücklich, dass sie nicht im Stundentotal stecken');
  // Die Abwesenheitszeilen dürfen nicht ZUSÄTZLICH in der Stundentabelle stehen.
  ok(!/Abwesend:/.test(txt), 'in der Stundentabelle steht keine Abwesenheitszeile mehr');

  // 1.5 Ohne Migration: Klartext statt irreführender Meldung.
  reset();
  migriertAbwesenheit = false;
  const ohne = await tech('tech_tag_save', { datum: MO, abwesenheit: 'K', stunden: 8 });
  const msg = (ohne.body && (ohne.body.error || '')) || '';
  ok(/rapport_feld\.sql/.test(msg),
    `ohne Migration nennt der Server das fehlende Skript: "${msg.slice(0, 80)}"`);
  ok(!/Baustelle/.test(msg), 'und behauptet NICHT, es liege an einer Baustelle');
  const alt = await tech('tech_tag_save', { datum: DI, abwesenheit: 'F', stunden: 8 });
  ok(alt.status === 200 && alt.body.ok, 'die alten Kürzel gehen auch ohne Migration weiter (F)');
}

// ═══════════════════════════════════════════════════════════════════════════
await phase1();

console.log(`\n${'═'.repeat(70)}`);
console.log(fail ? `❌ ${fail} Prüfung(en) fehlgeschlagen, ${pass} grün` : `✅ alle ${pass} Prüfungen grün`);
process.exit(fail ? 1 : 0);
