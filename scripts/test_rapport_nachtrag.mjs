// scripts/test_rapport_nachtrag.mjs — Runde "Rapport Feld", Phasen 7 bis 9.
//
//   node scripts/test_rapport_nachtrag.mjs
//
// OFFLINE und deterministisch, gleiche Bauart wie scripts/test_rapport_feld.mjs:
// die ECHTEN Handler gegen ein gemocktes Supabase, mit einer injizierten Uhr,
// damit "nach 24 Stunden" pruefbar ist, ohne 24 Stunden zu warten. Es geht
// keine Mail raus, die Live-Datenbank wird nicht angefasst, der Lauf laesst
// sich beliebig oft wiederholen.
//
// Geprueft wird:
//   Phase 7 — Vervollstaendigung innert 48 Stunden
//     7.1  ein Rapport mit schnell angelegtem Projekt gilt als unvollstaendig
//     7.2  ebenso einer ohne Zeit oder ohne Beschreibung
//     7.3  eine Abwesenheitszeile gilt NIE als unvollstaendig
//     7.4  nach 24 Stunden geht genau EINE Erinnerung raus
//     7.5  nach 48 Stunden geht die zweite, danach keine weitere
//     7.6  wer nachtraegt, bekommt keine Erinnerung mehr
//     7.7  der Mailtext kommt aus gs_branding, sonst der neutrale Standard
//     7.8  ein Text, der Lohn an die Abgabe knuepft, wird abgelehnt
//     7.9  der unvollstaendige Rapport erscheint in der Masterliste
//   Phase 8 — Video-Link im Bericht
//     8.1  ein gueltiger Token gibt genau EIN Video frei
//     8.2  ein abgelaufener Token wird abgewiesen
//     8.3  ein manipulierter Token wird abgewiesen
//     8.4  ein angemeldeter Partner erreicht ueber /v/ kein fremdes Video
//     8.5  wer nicht angemeldet ist, wird nach der Anmeldung an DIESELBE
//          Stelle geleitet, nicht auf die Startseite
//     8.6  im PDF steht je Video das Standbild mit Link auf /v/<token>
//   Phase 9 — Downloadzeit
//     9.1  ein Bild, das mehrfach vorkommt, wird nur EINMAL eingebettet
//     9.2  die Bilder werden parallel geladen, nicht nacheinander
//     9.3  der Bericht mit 10 Fotos ist nachher kleiner als vorher

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
const OZ_FOTO = 'eeee1111-0000-0000-0000-000000000001';
// Winziges, gueltiges Baseline-JPEG (1x1 px) als Standbild-Attrappe.
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/'
  + 'wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
// Medien-ids muessen echte UUIDs sein — der Server prueft sie mit uuid().
const OZ1 = 'aaaa1111-0000-0000-0000-000000000001';
const OZ2 = 'aaaa1111-0000-0000-0000-000000000002';
const OZF = 'bbbb2222-0000-0000-0000-000000000001';
const OZX = 'cccc3333-0000-0000-0000-000000000001';
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
    gs_techniker: [{ id: TECHID, user_id: TECHU, name: 'Test Techniker', email: 'techniker@example.invalid' }],
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
    gs_branding: [{ id: 'br1', partner_id: null, firmenname: 'George Solutions', aktiv: true, rapport_erinnerung_text: null, logo_url: null, akzentfarbe: '#C9A961', fusszeile: null }],
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
const PM_BUCKET = 'projektdateien';   // wie PM_DATEI_BUCKET in api/cockpit.js
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
  // Signierte UPLOAD-URL (Direktupload grosser Dateien). Muss vor dem
  // allgemeinen Objekt-Zweig stehen — sonst faengt der den Aufruf ab und
  // liefert eine Ablage-Antwort statt einer URL.
  if (u.includes('/storage/v1/object/upload/sign/')) {
    const pfad = u.split('/storage/v1/object/upload/sign/')[1];
    return res({ url: `/object/upload/sign/${pfad}?token=t` });
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
          // Echte UUIDs: der Server prueft ids mit uuid() und wuerde eine
          // Bastel-id ("gs_tagesrapporte-1") als ungueltig abweisen — der Test
          // pruefte dann versehentlich die id-Pruefung statt der Fachregel.
          id: r.id || crypto.randomUUID(),
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
// PHASE 7 — Vervollstaendigung innert 48 Stunden
// ═══════════════════════════════════════════════════════════════════════════
const STUNDE = 3600000;

async function phase7() {
  abschnitt('Phase 7 · Unvollstaendige Rapporte, Erinnerung nach 24 und 48 h');
  const { rapportLuecken, erinnerungTextPruefen, STANDARD_ERINNERUNG_TEXT, erinnerungText } =
    await import('../lib/erinnerung.js');
  const { laufErinnerungen, sammleUnvollstaendige } = await import('../api/rapport_erinnerung.js');

  // ── 7.1–7.3 Was gilt als unvollstaendig? ──
  const voll = { gesamtstunden: 8, start_zeit: '07:00', end_zeit: '16:00', arbeiten: ['Steigzone montiert'] };
  ok(rapportLuecken(voll, { unvollstaendig: false }).length === 0, 'ein vollstaendiger Rapport hat keine Luecke');
  ok(rapportLuecken(voll, { unvollstaendig: true }).includes('projekt_unvollstaendig'),
    '7.1 — schnell angelegtes Projekt macht den Rapport unvollstaendig');
  ok(rapportLuecken({ ...voll, gesamtstunden: 0, start_zeit: null, end_zeit: null }, {}).includes('keine_zeit'),
    '7.2 — ohne Arbeitszeit: unvollstaendig');
  ok(rapportLuecken({ ...voll, arbeiten: [] }, {}).includes('keine_beschreibung'),
    '7.2 — ohne Beschreibung: unvollstaendig');
  ok(rapportLuecken({ ...voll, arbeiten: [], taetigkeiten_anzahl: 2 }, {}).length === 0,
    'Katalog-Taetigkeiten zaehlen als Beschreibung');
  ok(rapportLuecken({ ...voll, arbeiten: [], besonderheiten: 'Wasserschaden dokumentiert' }, {}).length === 0,
    'eine Notiz zaehlt als Beschreibung');
  ok(rapportLuecken({ abwesenheit: 'K', gesamtstunden: 8, arbeiten: [] }, {}).length === 0,
    '7.3 — eine Abwesenheitszeile gilt NIE als unvollstaendig');

  // ── 7.8 Der Text darf keinen Lohn an die Abgabe knuepfen ──
  ok(erinnerungTextPruefen(STANDARD_ERINNERUNG_TEXT).ok, 'der Standardtext ist zulaessig');
  ok(!/lohn|gehal|salär|salaer/i.test(STANDARD_ERINNERUNG_TEXT), 'und erwaehnt Lohn ueberhaupt nicht');
  const boese = [
    'Ohne Rapport kein Lohn.',
    'Der Lohn wird erst ausbezahlt, wenn alle Rapporte da sind.',
    'Fehlende Rapporte führen dazu, dass die Vergütung zurückgehalten wird.',
    'Bitte nachtragen, sonst wird der Lohn gekürzt.',
  ];
  let abgelehnt = 0;
  for (const t of boese) if (!erinnerungTextPruefen(t).ok) abgelehnt++;
  ok(abgelehnt === boese.length, `7.8 — alle ${boese.length} Kopplungen an den Lohn werden abgelehnt (${abgelehnt})`);
  ok(erinnerungTextPruefen('Bei Fragen meldet sich das Lohnbüro.').ok,
    'ein harmloses "Lohnbüro" bleibt erlaubt');
  ok(!erinnerungTextPruefen('').ok, 'ein leerer Text wird abgelehnt');

  // ── 7.4/7.5/7.6 Der Lauf ──
  reset();
  const T0 = Date.parse('2026-09-01T08:00:00.000Z');
  // Eine Zeile ohne Beschreibung und ohne Zeit.
  await tech('tech_tag_save', { datum: MO, projekt_id: P1, stunden: 0 });
  // Eine vollstaendige Zeile — sie darf nie erinnert werden.
  await tech('tech_tag_save', { datum: DI, projekt_id: P2, stunden: 8, start_zeit: '07:00', end_zeit: '16:00', arbeiten: ['Verteiler gesetzt'] });
  for (const z of db.gs_tagesrapporte) z.created_at = new Date(T0).toISOString();

  const mails = [];
  const attrappe = async (m) => { mails.push(m); return { ok: true, id: 'm' + mails.length }; };

  // Nach 10 Stunden: noch nichts.
  let r = await laufErinnerungen({ jetzt: T0 + 10 * STUNDE, sendMail: attrappe });
  ok(r.versendet === 0 && mails.length === 0, 'nach 10 Stunden geht keine Erinnerung raus');

  // Nach 25 Stunden: genau eine.
  r = await laufErinnerungen({ jetzt: T0 + 25 * STUNDE, sendMail: attrappe });
  ok(r.versendet === 1 && mails.length === 1, `7.4 — nach 24 Stunden genau EINE Erinnerung (${mails.length})`);
  ok(mails[0].to === 'techniker@example.invalid', 'sie geht an die erfassende Person');
  ok(/Erinnerung/.test(mails[0].subject) && !/Zweite/.test(mails[0].subject), `Betreff: "${mails[0].subject}"`);
  ok(/Arbeitszeit|gemacht/.test(mails[0].html), 'die Mail nennt, was fehlt');
  ok(!/Lohn|Gehalt/i.test(mails[0].html), 'und knuepft keine Lohnzahlung daran');
  ok(!/Verteiler gesetzt/.test(mails[0].html), 'die vollstaendige Zeile steht nicht drin');

  // Noch einmal in derselben Stufe: nichts Neues.
  r = await laufErinnerungen({ jetzt: T0 + 30 * STUNDE, sendMail: attrappe });
  ok(mails.length === 1, 'ein zweiter Lauf in derselben Stufe schickt nichts nach');

  // Nach 49 Stunden: die zweite und letzte.
  r = await laufErinnerungen({ jetzt: T0 + 49 * STUNDE, sendMail: attrappe });
  ok(mails.length === 2, `7.5 — nach 48 Stunden die zweite Erinnerung (${mails.length})`);
  ok(/Zweite Erinnerung/.test(mails[1].subject), `Betreff: "${mails[1].subject}"`);

  // Danach nie wieder.
  r = await laufErinnerungen({ jetzt: T0 + 100 * STUNDE, sendMail: attrappe });
  ok(mails.length === 2, 'nach der zweiten kommt keine dritte');

  // 7.6 — nachtragen beendet es.
  reset();
  await tech('tech_tag_save', { datum: MO, projekt_id: P1, stunden: 0 });
  for (const z of db.gs_tagesrapporte) z.created_at = new Date(T0).toISOString();
  const zid = db.gs_tagesrapporte[0].id;
  const mails2 = [];
  const attrappe2 = async (m) => { mails2.push(m); return { ok: true }; };
  await ruf({
    token: 'tokMaster', mode: 'master', action: 'pm_wochenrapport_update',
    id: zid, patch: { gesamtstunden: 8, start_zeit: '07:00', end_zeit: '16:00', arbeiten: ['Leitungen gespuelt'] },
  });
  await laufErinnerungen({ jetzt: T0 + 25 * STUNDE, sendMail: attrappe2 });
  ok(mails2.length === 0, '7.6 — wer nachtraegt, bekommt keine Erinnerung');

  // Eine Zeile, die erst nach 50 Stunden gefunden wird, bekommt GENAU EINE Mail.
  reset();
  await tech('tech_tag_save', { datum: MO, projekt_id: P1, stunden: 0 });
  for (const z of db.gs_tagesrapporte) z.created_at = new Date(T0).toISOString();
  const mails3 = [];
  await laufErinnerungen({ jetzt: T0 + 50 * STUNDE, sendMail: async (m) => { mails3.push(m); return { ok: true }; } });
  ok(mails3.length === 1, 'eine spaet gefundene Zeile bekommt genau eine Mail, nicht zwei');
  await laufErinnerungen({ jetzt: T0 + 60 * STUNDE, sendMail: async (m) => { mails3.push(m); return { ok: true }; } });
  ok(mails3.length === 1, 'und danach keine mehr');

  // ── 7.7 Der Text kommt aus gs_branding ──
  reset();
  await tech('tech_tag_save', { datum: MO, projekt_id: P1, stunden: 0 });
  for (const z of db.gs_tagesrapporte) z.created_at = new Date(T0).toISOString();
  const eigen = 'Servus {name}, es fehlen noch {anzahl} Rapporte. Bitte kurz nachtragen.';
  const gespeichert = await ruf({ token: 'tokMaster', mode: 'master', action: 'pm_erinnerung_text', text: eigen });
  ok(gespeichert.status === 200 && gespeichert.body.ok, 'der Master speichert einen eigenen Text');
  ok(db.gs_branding[0].rapport_erinnerung_text === eigen, 'er steht in gs_branding');
  const mails4 = [];
  await laufErinnerungen({ jetzt: T0 + 25 * STUNDE, sendMail: async (m) => { mails4.push(m); return { ok: true }; } });
  ok(/Servus Test/.test(mails4[0].html), `7.7 — die Mail benutzt den eigenen Text: "${(mails4[0].html.match(/Servus[^<]*/) || [''])[0]}"`);

  const boeseSave = await ruf({ token: 'tokMaster', mode: 'master', action: 'pm_erinnerung_text', text: 'Ohne Rapport kein Lohn.' });
  ok(!!(boeseSave.body || {}).error, 'ein Text mit Lohnkopplung wird beim Speichern abgelehnt');
  ok(db.gs_branding[0].rapport_erinnerung_text === eigen, 'und der alte Text bleibt unveraendert stehen');

  // Ohne eigenen Text: der neutrale Standard.
  db.gs_branding[0].rapport_erinnerung_text = null;
  const mails5 = [];
  db.gs_tagesrapporte.forEach((z) => { z.erinnerung_24_am = null; z.erinnerung_48_am = null; });
  await laufErinnerungen({ jetzt: T0 + 25 * STUNDE, sendMail: async (m) => { mails5.push(m); return { ok: true }; } });
  ok(/fehlen noch Angaben/.test(mails5[0].html), 'ohne eigenen Text gilt der neutrale Standard');

  // ── 7.9 Masterliste ──
  reset();
  const s3 = await tech('tech_projekt_neu', { name: 'Schnelle Baustelle' });
  const neuId = s3.body.projekt.id;
  await tech('tech_tag_save', { datum: MO, projekt_id: neuId, stunden: 8, start_zeit: '07:00', end_zeit: '16:00', arbeiten: ['Montage'] });
  for (const z of db.gs_tagesrapporte) z.created_at = new Date(T0).toISOString();
  const liste = await ruf({ token: 'tokMaster', mode: 'master', action: 'pm_rapporte_unvollstaendig' });
  ok(liste.status === 200 && liste.body.ok, 'die Masterliste laedt');
  ok(liste.body.anzahl === 1, `7.9 — der unvollstaendige Rapport steht drin (${liste.body.anzahl})`);
  const eintrag = liste.body.rapporte[0];
  ok(eintrag.person === 'Test Techniker', 'mit Person');
  ok(/Schnelle Baustelle/.test(eintrag.baustelle), 'mit Projekt');
  ok(typeof eintrag.alter_stunden === 'number', 'und mit Alter in Stunden');
  ok((eintrag.gruende || []).some((g) => /schnell angelegt/.test(g)), 'der Grund steht im Klartext dabei');
  // Ein Techniker darf die Liste nicht sehen.
  const techListe = await tech('pm_rapporte_unvollstaendig');
  ok(techListe.status === 403, 'ein Techniker kommt an die Liste nicht heran');
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8 — Video-Link im Bericht
// ═══════════════════════════════════════════════════════════════════════════
const VID1 = 'dddd1111-0000-0000-0000-000000000001';   // gehoert P1 (Master)
const VID2 = 'dddd2222-0000-0000-0000-000000000002';   // gehoert PB-Projekt
const PARTNER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PARTNER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const P_FREMD = '33333333-3333-3333-3333-333333333333';

async function phase8() {
  abschnitt('Phase 8 · Video-Link, signiert, 30 Tage, genau ein Video');
  process.env.VIDEO_TOKEN_SECRET = 'test-geheimnis-fuer-die-attrappe';
  const { videoTokenErzeugen, videoTokenPruefen, videoLink, VIDEO_TOKEN_TAGE } =
    await import('../lib/videotoken.js');
  const { videoAufloesen } = await import('../api/videolink.js');
  const { sammleWochendaten, buildWochenberichtPdf } = await import('../lib/wochenbericht.js');

  const T0 = Date.parse('2026-09-01T08:00:00.000Z');
  const TAG = 86400000;

  // ── Der Token selbst ──
  ok(VIDEO_TOKEN_TAGE === 30, 'der Token gilt 30 Tage');
  const t1 = videoTokenErzeugen(VID1, T0);
  const p1 = videoTokenPruefen(t1, T0 + 5 * TAG);
  ok(p1.ok && p1.medien_id === VID1, 'ein frischer Token nennt genau dieses Video');
  const p2 = videoTokenPruefen(t1, T0 + 31 * TAG);
  ok(!p2.ok && p2.grund === 'abgelaufen', '8.2 — nach 30 Tagen ist er abgelaufen');
  ok(videoTokenPruefen(t1, T0 + 29 * TAG).ok, 'am 29. Tag gilt er noch');
  // Manipulation
  const kaputt = t1.slice(0, -3) + 'xyz';
  ok(!videoTokenPruefen(kaputt, T0).ok, '8.3 — ein manipulierter Token wird abgewiesen');
  const t2 = videoTokenErzeugen(VID2, T0);
  const gemischt = t2.split('.')[0] + '.' + t1.split('.')[1];   // fremder Rumpf, gueltige Signatur
  ok(!videoTokenPruefen(gemischt, T0).ok, 'eine Signatur laesst sich nicht auf ein anderes Video umhaengen');
  ok(videoLink(VID1, T0).indexOf('/v/') > 0, 'der Link zeigt auf /v/<token>');

  // ── Die Aufloesung gegen die Attrappe ──
  reset();
  db.user_roles.push({ user_id: PARTNER_A, role: 'gs_partner' }, { user_id: PARTNER_B, role: 'gs_partner' });
  db.gs_techniker.push({ id: 'ta', user_id: PARTNER_A, name: 'Partner Anna' }, { id: 'tb', user_id: PARTNER_B, name: 'Partner Bruno' });
  db.gs_projekte.push({ id: P_FREMD, name: 'Werkhof Ost', projektnummer: '80010.00', partner_user_id: PARTNER_B, status: 'aktiv', geloescht_at: null });
  db.gs_projekte.find((p) => p.id === P1).partner_user_id = PARTNER_A;
  db.gs_projekt_medien.push(
    { id: VID1, projekt_id: P1, tagesrapport_id: null, medientyp: 'video', bucket: PM_BUCKET, path: 'p1/film.mp4', thumbnail_path: 'p1/thumbs/film.jpg', dateiname: 'film.mp4', dauer_sekunden: 42, mime: 'video/mp4', stockwerk: 'EG' },
    { id: VID2, projekt_id: P_FREMD, tagesrapport_id: null, medientyp: 'video', bucket: PM_BUCKET, path: 'pf/fremd.mp4', thumbnail_path: null, dateiname: 'fremd.mp4', dauer_sekunden: 20, mime: 'video/mp4', stockwerk: 'EG' },
  );
  TOKENS.tokPartnerA = PARTNER_A;
  TOKENS.tokPartnerB = PARTNER_B;

  // 8.1 gueltiger Token, KEINE Anmeldung
  const r1 = await videoAufloesen({ token: videoTokenErzeugen(VID1, T0), authToken: '', jetzt: T0 + TAG });
  ok(r1.video && r1.video.id === VID1, '8.1 — ein gueltiger Token gibt das Video frei, ohne Anmeldung');
  ok(r1.weg === 'token', 'und zwar ueber den Token, nicht ueber eine Anmeldung');
  ok(!!r1.video.url, 'es kommt eine signierte URL zurueck');
  ok(!!r1.video.thumbnail_url, 'und das Standbild dazu');
  ok(r1.video.projekt && /60060/.test(r1.video.projekt), 'die Baustelle steht dabei');

  // Genau EIN Video: der Token fuer VID1 oeffnet VID2 nicht.
  const r1b = await videoAufloesen({ token: videoTokenErzeugen(VID2, T0), authToken: '', jetzt: T0 + TAG });
  ok(r1b.video && r1b.video.id === VID2, 'ein eigener Token fuer das zweite Video oeffnet dieses');
  ok(r1.video.id !== r1b.video.id, 'ein Token gilt fuer genau EIN Video');

  // 8.2 abgelaufen, ohne Anmeldung
  const r2 = await videoAufloesen({ token: videoTokenErzeugen(VID1, T0), authToken: '', jetzt: T0 + 31 * TAG });
  ok(!!r2.error && r2.anmeldung_noetig, '8.2 — ein abgelaufener Token wird abgewiesen');
  ok(/abgelaufen/.test(r2.error), `mit klarer Begruendung: "${r2.error.slice(0, 60)}"`);
  ok(!r2.video, 'und ohne Video');

  // 8.5 abgelaufen, ABER angemeldet und berechtigt → dieselbe Stelle, jetzt mit Video
  const r3 = await videoAufloesen({ token: videoTokenErzeugen(VID1, T0), authToken: 'tokPartnerA', jetzt: T0 + 31 * TAG });
  ok(r3.video && r3.video.id === VID1, '8.5 — nach der Anmeldung laeuft dasselbe Video an derselben Stelle');
  ok(r3.weg === 'anmeldung', 'freigegeben ueber die Anmeldung');

  // 8.4 angemeldeter Partner erreicht kein FREMDES Video
  const r4 = await videoAufloesen({ token: videoTokenErzeugen(VID2, T0), authToken: 'tokPartnerA', jetzt: T0 + 31 * TAG });
  ok(!!r4.error && !r4.video, '8.4 — Partner A kommt an das Video von Partner B nicht heran');
  ok(/Berechtigung/.test(r4.error), `Meldung: "${r4.error.slice(0, 50)}"`);
  const r5 = await videoAufloesen({ token: videoTokenErzeugen(VID2, T0), authToken: 'tokPartnerB', jetzt: T0 + 31 * TAG });
  ok(r5.video && r5.video.id === VID2, 'Partner B erreicht sein eigenes Video');
  const r6 = await videoAufloesen({ token: videoTokenErzeugen(VID2, T0), authToken: 'tokMaster', jetzt: T0 + 31 * TAG });
  ok(r6.video && r6.video.id === VID2, 'der Master erreicht beide');
  const r7 = await videoAufloesen({ token: videoTokenErzeugen(VID2, T0), authToken: 'tokTech', jetzt: T0 + 31 * TAG });
  ok(!!r7.error, 'ein Techniker ohne Zuweisung auf das fremde Projekt kommt nicht heran');

  // Ein Verweis auf ein FOTO ist kein Videolink.
  db.gs_projekt_medien.push({ id: OZ_FOTO, projekt_id: P1, medientyp: 'foto', bucket: PM_BUCKET, path: 'p1/bild.jpg', dateiname: 'bild.jpg' });
  const rf = await videoAufloesen({ token: videoTokenErzeugen(OZ_FOTO, T0), authToken: '', jetzt: T0 + TAG });
  ok(!!rf.error && /nicht zu einem Video/.test(rf.error), 'ein Token auf ein Foto fuehrt nicht ins Leere, sondern zu einer Meldung');

  // Ein Token auf eine id, die es nicht gibt.
  const rx = await videoAufloesen({ token: videoTokenErzeugen('99999999-9999-9999-9999-999999999999', T0), authToken: '', jetzt: T0 + TAG });
  ok(!!rx.error, 'ein Token auf ein nicht vorhandenes Medium wird abgewiesen');
  ok(!/nicht gefunden|existiert/.test(rx.error), 'und verraet nicht, ob es die id gibt');

  // 8.6 Im PDF: Standbild mit Verweis
  reset();
  await tech('tech_tag_save', { datum: MO, projekt_id: P1, stunden: 8, start_zeit: '07:00', end_zeit: '16:00', arbeiten: ['Steigzone'] });
  const zid = db.gs_tagesrapporte[0].id;
  db.gs_projekt_medien.push({
    id: VID1, projekt_id: P1, tagesrapport_id: zid, medientyp: 'video', bucket: PM_BUCKET,
    path: 'p1/film.mp4', thumbnail_path: 'p1/thumbs/film.jpg', dateiname: 'film.mp4',
    dauer_sekunden: 42, mime: 'video/mp4', stockwerk: 'EG', created_at: '2026-09-01T09:00:00Z',
  });
  const daten = await sammleWochendaten({ quelle: 'projekt', projektId: P1, jahr: JAHR, woche: WOCHE });
  ok((daten.videos || []).length === 1, `die Wochendaten kennen das Video (${(daten.videos || []).length})`);
  ok(daten.videos[0].datum === MO, 'und ordnen es dem Montag zu');

  const pdf = buildWochenberichtPdf(daten, {
    videos: [{ buf: JPEG_1PX, caption: 'film.mp4 · 42 s', url: videoLink(VID1, T0) }],
  });
  const roh = Buffer.from(pdf).toString('latin1');
  ok(/\/Subtype\/Link/.test(roh), '8.6 — das PDF traegt eine Verweis-Annotation');
  ok(/\/URI\(https?:[^)]*\/v\/[^)]+\)/.test(roh), 'sie zeigt auf /v/<token>');
  const txt = pdfText(pdf);
  ok(/Videos/.test(txt), 'es gibt einen eigenen Abschnitt "Videos"');
  ok(/30 Tage/.test(txt), 'und der Bericht sagt, wie lange der Link gilt');
  ok(/film\.mp4/.test(txt), 'die Bildunterschrift nennt das Video');

  // Ohne Standbild wird das Video gezaehlt und benannt, nicht abgebildet.
  const pdf2 = buildWochenberichtPdf(daten, { videos: [] });
  const txt2 = pdfText(pdf2);
  ok(/ohne Standbild/.test(txt2), 'ein Video ohne Standbild wird ausdruecklich benannt');
  ok(!/\/Subtype\/Link/.test(Buffer.from(pdf2).toString('latin1')), 'und traegt dann keinen Verweis');
}

// ═══════════════════════════════════════════════════════════════════════════
await phase7();
await phase8();

console.log(`\n${'═'.repeat(70)}`);
console.log(fail ? `❌ ${fail} Pruefung(en) fehlgeschlagen, ${pass} gruen` : `✅ alle ${pass} Pruefungen gruen`);
process.exit(fail ? 1 : 0);
