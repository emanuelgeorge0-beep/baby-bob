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
//   Phase 2 — Datumspruefung
//     2.1  eine Tageszeile mit Jahr 2099 wird SERVERSEITIG abgelehnt
//     2.2  die Meldung nennt Jahr und zulaessigen Bereich, nichts wird gespeichert
//     2.3  Jahr −1 / heute / Jahr +1 gehen durch, Jahr −2 und +2 nicht
//     2.4  auch der aeltere Weg api/tagesrapport.js weist 2099 ab
//     2.5  auch die Master-Korrektur darf kein 2099 setzen
//     2.6  ein Datum, das es im Kalender nicht gibt, wird abgelehnt
//   Phase 3 — Projekt im Rapport anlegen
//     3.1  Schnellanlage mit NUR einer Bezeichnung erzeugt ein echtes Projekt
//     3.2  es traegt Status "unvollstaendig" und eine LEERE Fremdnummer
//     3.3  es bekommt eine provisorische interne Nummer, keine erfundene
//     3.4  der Techniker ist sofort zugewiesen und kann darauf buchen
//     3.5  der vollstaendige Weg erzeugt ein Projekt OHNE den Marker
//     3.6  ohne Bezeichnung wird nichts angelegt
//     3.7  Nachtragen im Cockpit loescht den Marker von selbst
//     3.8  eine getippte Fremdnummer wird uebernommen, nie erzeugt
//   Phase 4 — Medien-Upload mit Video
//     4.1  ein Video ueber 100 MB wird abgelehnt, BEVOR es hochgeladen wird
//     4.2  ein Video ueber 2 Minuten wird abgelehnt
//     4.3  ein anderes Format als mp4/mov wird abgelehnt
//     4.4  ein zulaessiges Video wird angenommen und bekommt ein Standbild
//     4.5  ohne Standbild wird das Video gespeichert, der Mangel aber benannt
//     4.6  ein am Client umgangenes Limit faellt beim Registrieren auf und
//          die bereits abgelegte Datei wird wieder entfernt
//     4.7  der Fotoupload bleibt unveraendert funktionsfaehig
//   Phase 5 — Berichtsauswahl umkehren
//     5.1  die Maske startet mit ALLEN Projekten der Woche angehakt
//     5.2  sie startet auch beim zweiten Oeffnen wieder mit allen
//     5.3  der Server liefert je Projekt Stunden, Fotos und Videos
//     5.4  die Zusammenfassungszeile stimmt vor und nach dem Abwaehlen
//     5.5  Abwesenheitsstunden stehen nicht in der Wochensumme

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
// PHASE 2 — Datumspruefung
// ═══════════════════════════════════════════════════════════════════════════
async function phase2() {
  abschnitt('Phase 2 · Jahresschranke fuer Tageszeilen');
  reset();
  const HEUTE = new Date().getUTCFullYear();

  // 2.1/2.2 — der konkrete Fall aus der Live-DB.
  const r = await tech('tech_tag_save', { datum: '2099-03-02', projekt_id: P1, stunden: 8, start_zeit: '07:00', end_zeit: '16:15' });
  const msg = (r.body && (r.body.error || '')) || '';
  ok(r.status >= 400 || msg, 'Tageszeile mit Jahr 2099 wird abgewiesen');
  ok(/2099/.test(msg) && new RegExp(String(HEUTE - 1)).test(msg) && new RegExp(String(HEUTE + 1)).test(msg),
    `die Meldung nennt Jahr und Bereich: "${msg.slice(0, 90)}"`);
  ok(db.gs_tagesrapporte.length === 0, 'es wurde NICHTS gespeichert');
  ok(db.gs_wochenrapporte.length === 1, 'und es entstand auch kein Wochenkopf fuer 2099');

  // 2.3 — der zulaessige Bereich, an beiden Kanten.
  reset();
  const erlaubt = [
    [`${HEUTE - 1}-06-15`, true, `Jahr ${HEUTE - 1} (minus 1)`],
    [`${HEUTE}-06-15`, true, `Jahr ${HEUTE} (aktuell)`],
    [`${HEUTE + 1}-06-15`, true, `Jahr ${HEUTE + 1} (plus 1)`],
    [`${HEUTE - 2}-06-15`, false, `Jahr ${HEUTE - 2} (minus 2)`],
    [`${HEUTE + 2}-06-15`, false, `Jahr ${HEUTE + 2} (plus 2)`],
  ];
  for (const [datum, sollGehen, was] of erlaubt) {
    const x = await tech('tech_tag_save', { datum, projekt_id: P1, stunden: 4 });
    const ging = !!(x.status === 200 && x.body && x.body.ok);
    ok(ging === sollGehen, `${was} → ${sollGehen ? 'angenommen' : 'abgewiesen'}`);
  }

  // 2.4 — derselbe Riegel im aelteren Weg api/tagesrapport.js.
  const { default: tagesrapport } = await import('../api/tagesrapport.js');
  const rufTr = async (body) => {
    let out = { status: 0, body: null };
    const rr = { setHeader() {}, status(sx) { out.status = sx; return this; }, json(j) { out.body = j; return this; }, end() { return this; } };
    await tagesrapport({ method: 'POST', headers: { authorization: 'Bearer tokTech' }, body }, rr);
    return out;
  };
  reset();
  const alt = await rufTr({ action: 'save', projekt_id: P1, datum: '2099-03-02', gesamtstunden: 8 });
  ok(alt.status === 400 && /2099/.test(alt.body.error || ''), 'api/tagesrapport.js weist 2099 ebenfalls ab');
  ok(db.gs_tagesrapporte.length === 0, 'auch dort wurde nichts geschrieben');
  const altOk = await rufTr({ action: 'save', projekt_id: P1, datum: `${HEUTE}-06-15`, gesamtstunden: 8 });
  ok(altOk.status === 200 && altOk.body.ok, 'ein gueltiges Datum geht dort weiterhin durch');

  // 2.5 — Master-Korrektur.
  reset();
  await tech('tech_tag_save', { datum: MO, projekt_id: P1, stunden: 8 });
  const zid = db.gs_tagesrapporte[0].id;
  const m = await ruf({ token: 'tokMaster', mode: 'master', action: 'pm_wochenrapport_update', id: zid, patch: { datum: '2099-03-02' } });
  const mmsg = (m.body && (m.body.error || '')) || '';
  ok(/2099/.test(mmsg), `die Master-Korrektur weist 2099 ebenfalls ab: "${mmsg.slice(0, 70)}"`);
  ok(db.gs_tagesrapporte[0].datum === MO, 'das Datum der Zeile blieb unveraendert');

  // 2.6 — Kalender-Unsinn.
  reset();
  const feb = await tech('tech_tag_save', { datum: `${HEUTE}-02-31`, projekt_id: P1, stunden: 8 });
  ok((feb.body && feb.body.error) && /Kalender/.test(feb.body.error), 'den 31. Februar gibt es nicht — abgelehnt');
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — Projekt im Rapport anlegen
// ═══════════════════════════════════════════════════════════════════════════
async function phase3() {
  abschnitt('Phase 3 · Projekt direkt aus dem Rapport anlegen');
  reset();
  const vorher = db.gs_projekte.length;

  // 3.1–3.4 Schnellanlage
  const r = await tech('tech_projekt_neu', { name: 'Umbau Bahnhofplatz' });
  ok(r.status === 200 && r.body.ok, 'Schnellanlage mit nur einer Bezeichnung geht durch');
  const p = (r.body || {}).projekt || {};
  ok(db.gs_projekte.length === vorher + 1, 'es entstand GENAU ein echtes Projekt');
  const roh = db.gs_projekte.find((x) => x.id === p.id) || {};
  ok(roh.name === 'Umbau Bahnhofplatz', 'die Bezeichnung steht drin');
  ok(roh.unvollstaendig === true, 'Status: unvollstaendig');
  ok(roh.fremdnummer === null, 'die Fremdnummer ist LEER — nichts erfunden');
  ok(/^NEU-\d{4}-\d{3}$/.test(roh.projektnummer || ''),
    `provisorische interne Nummer vergeben: ${roh.projektnummer}`);
  ok(r.body.unvollstaendig === true, 'die Antwort sagt es dem Techniker');
  ok(/unvoll/i.test(r.body.hinweis || ''), `mit Klartext: "${(r.body.hinweis || '').slice(0, 70)}"`);
  ok(r.body.zugewiesen === true, 'der Techniker ist dem Projekt zugewiesen');
  ok(db.gs_projekt_techniker.some((a2) => a2.projekt_id === p.id && a2.techniker_id === TECHID),
    'die Zuweisung steht auch wirklich in der Tabelle');

  // 3.4 — und er kann sofort darauf buchen (das ist der eigentliche Zweck).
  const buchung = await tech('tech_tag_save', { datum: MO, projekt_id: p.id, stunden: 8, start_zeit: '07:00', end_zeit: '16:00' });
  ok(buchung.status === 200 && buchung.body.ok, 'der Tag laesst sich sofort auf das neue Projekt buchen');

  // Und es taucht in seiner Projektliste auf.
  const liste = await tech('tech_projekte');
  ok((liste.body.projekte || []).some((x) => x.id === p.id), 'das Projekt steht in seiner Projektliste');

  // 3.5 Vollstaendiger Weg
  reset();
  const v = await tech('tech_projekt_neu', {
    name: 'Neubau Seestrasse', adresse: 'Seestrasse 4, 8002 Zürich',
    ansprechperson: 'Bauleiter Eins', ansprech_email: 'bauleiter@example.invalid',
    fremdnummer: 'AG-2026-777',
  });
  ok(v.status === 200 && v.body.ok, 'vollstaendige Anlage geht durch');
  const rv = db.gs_projekte.find((x) => x.id === v.body.projekt.id) || {};
  ok(rv.unvollstaendig === false, 'kein Marker: alle Pflichtangaben da');
  ok(rv.projektadresse === 'Seestrasse 4, 8002 Zürich', 'die Adresse ist gespeichert');
  ok(rv.ansprech_email === 'bauleiter@example.invalid', 'die Mail ist gespeichert');
  ok(rv.fremdnummer === 'AG-2026-777', '3.8 — eine getippte Fremdnummer wird uebernommen');
  ok(/^NEU-\d{4}-\d{3}$/.test(rv.projektnummer || ''), 'auch hier eine provisorische interne Nummer');

  // 3.6 Ohne Bezeichnung
  reset();
  const leer = await tech('tech_projekt_neu', { name: '   ' });
  ok(!!(leer.body || {}).error, 'ohne Bezeichnung: Fehlermeldung');
  ok(db.gs_projekte.length === 2, 'und kein Projekt angelegt');
  const krummeMail = await tech('tech_projekt_neu', { name: 'X', ansprech_email: 'keine-mail' });
  ok(!!(krummeMail.body || {}).error, 'eine offensichtlich falsche E-Mail wird abgewiesen');

  // 3.7 Nachtragen im Cockpit
  reset();
  const s2 = await tech('tech_projekt_neu', { name: 'Halle Nord' });
  const pid = s2.body.projekt.id;
  ok(db.gs_projekte.find((x) => x.id === pid).unvollstaendig === true, 'frisch angelegt: unvollstaendig');
  const nach = await ruf({
    token: 'tokMaster', mode: 'master', action: 'pm_projekt_save',
    id: pid, name: 'Halle Nord', projektadresse: 'Industriestrasse 9',
    ansprechperson: 'Frau Muster', ansprech_email: 'muster@example.invalid',
  });
  ok(nach.status === 200 && nach.body.ok, 'Master traegt die Angaben nach');
  ok(db.gs_projekte.find((x) => x.id === pid).unvollstaendig === false,
    'der Marker verschwindet von selbst — kein Haken zum Wegklicken');

  // Zwei Anlagen hintereinander duerfen nicht dieselbe Nummer bekommen.
  reset();
  const a1 = await tech('tech_projekt_neu', { name: 'Erste' });
  const a2 = await tech('tech_projekt_neu', { name: 'Zweite' });
  ok(a1.body.nummer !== a2.body.nummer, `zwei Anlagen, zwei Nummern (${a1.body.nummer} / ${a2.body.nummer})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 — Medien-Upload mit Video
// ═══════════════════════════════════════════════════════════════════════════
async function phase4() {
  abschnitt('Phase 4 · Video: mp4/mov, 100 MB, 2 Minuten, Standbild');
  reset();
  // Eine Tageszeile, an die die Medien haengen.
  await tech('tech_tag_save', { datum: MO, projekt_id: P1, stunden: 8 });
  const trId = db.gs_tagesrapporte[0].id;
  const basis = { projekt_id: P1, tagesrapport_id: trId, stockwerk: 'EG' };

  // 4.1 zu gross — die Upload-URL wird gar nicht erst herausgegeben
  const zuGross = await tech('medien_sign_upload', {
    ...basis, filename: 'baustelle.mp4', contentType: 'video/mp4',
    groesse: 150 * 1024 * 1024, dauer_sekunden: 30,
  });
  ok(!!(zuGross.body || {}).error, 'Video mit 150 MB: abgelehnt');
  ok(/100 MB/.test((zuGross.body || {}).error || ''), `Meldung nennt die Grenze: "${((zuGross.body || {}).error || '').slice(0, 80)}"`);
  ok(!(zuGross.body || {}).uploadUrl, 'es gibt KEINE Upload-URL — die Datei verlaesst das Handy nicht');
  ok(Object.keys(storage).length === 0, 'und im Speicher liegt nichts');

  // 4.2 zu lang
  const zuLang = await tech('medien_sign_upload', {
    ...basis, filename: 'lang.mp4', contentType: 'video/mp4',
    groesse: 20 * 1024 * 1024, dauer_sekunden: 185,
  });
  ok(/2 Minuten|120/.test((zuLang.body || {}).error || ''), 'Video mit 3:05 min: abgelehnt mit Begruendung');
  ok(!(zuLang.body || {}).uploadUrl, 'auch hier keine Upload-URL');

  // 4.3 falsches Format
  const falsch = await tech('medien_sign_upload', {
    ...basis, filename: 'clip.avi', contentType: 'video/x-msvideo',
    groesse: 5 * 1024 * 1024, dauer_sekunden: 20, medientyp: 'video',
  });
  ok(/mp4 und mov/.test((falsch.body || {}).error || ''), 'avi: abgelehnt, mp4/mov genannt');

  // 4.4 gutes Video: Upload-URL, Ablage, Registrierung, Standbild
  const gut = await tech('medien_sign_upload', {
    ...basis, filename: 'steigzone.mov', contentType: 'video/quicktime',
    groesse: 42 * 1024 * 1024, dauer_sekunden: 95,
  });
  ok(gut.status === 200 && gut.body.ok && gut.body.uploadUrl, 'mov, 42 MB, 95 s: Upload-URL erteilt');
  const pfad = gut.body.path;
  ok(String(pfad).startsWith(P1 + '/'), 'der Pfad liegt unter dem eigenen Projekt');
  storage[`${PM_BUCKET}/${pfad}`] = 42 * 1024 * 1024;             // Direktupload nachstellen

  const standbild = 'data:image/jpeg;base64,' + Buffer.from('STANDBILD-BYTES').toString('base64');
  const reg = await tech('medien_register', {
    ...basis, path: pfad, filename: 'steigzone.mov', contentType: 'video/quicktime',
    medientyp: 'video', groesse: 42 * 1024 * 1024, dauer_sekunden: 95, thumbnail: standbild,
  });
  ok(reg.status === 200 && reg.body.ok, 'das Video wird registriert');
  const m = reg.body.medien || {};
  ok(m.medientyp === 'video', 'es ist als Video gespeichert');
  ok(m.dauer_sekunden === 95, 'die Dauer steht in der Zeile (95 s)');
  ok(m.groesse === 42 * 1024 * 1024, 'die Groesse steht in der Zeile');
  ok(!!m.thumbnail_path, `ein Standbild ist gespeichert: ${m.thumbnail_path}`);
  ok(reg.body.standbild === true, 'die Antwort bestaetigt das Standbild');
  ok(!!storage[`${PM_BUCKET}/${m.thumbnail_path}`], 'das Standbild liegt wirklich im Speicher');
  ok(m.tagesrapport_id === trId, 'das Video haengt an der Tageszeile');

  // 4.5 kein Standbild erzeugbar → Video trotzdem da, Mangel benannt
  const gut2 = await tech('medien_sign_upload', { ...basis, filename: 'zweites.mp4', contentType: 'video/mp4', groesse: 5e6, dauer_sekunden: 20 });
  storage[`${PM_BUCKET}/${gut2.body.path}`] = 5e6;
  const ohne = await tech('medien_register', {
    ...basis, path: gut2.body.path, filename: 'zweites.mp4', contentType: 'video/mp4',
    medientyp: 'video', groesse: 5e6, dauer_sekunden: 20,
  });
  ok(ohne.body.ok && ohne.body.standbild === false, 'ohne Standbild wird das Video trotzdem gespeichert');
  ok(/Standbild/.test(ohne.body.hinweis || ''), `und der Mangel wird benannt: "${(ohne.body.hinweis || '').slice(0, 60)}"`);

  // 4.6 Client umgangen: beim Registrieren faellt es auf, die Datei fliegt raus
  const schmuggel = `${P1}/medien/${Date.now()}-riesig.mp4`;
  storage[`${PM_BUCKET}/${schmuggel}`] = 300 * 1024 * 1024;
  const abgewiesen = await tech('medien_register', {
    ...basis, path: schmuggel, filename: 'riesig.mp4', contentType: 'video/mp4',
    medientyp: 'video', groesse: 300 * 1024 * 1024, dauer_sekunden: 30,
  });
  ok(!!(abgewiesen.body || {}).error, 'ein am Client vorbeigeschmuggeltes Video wird abgewiesen');
  ok(!storage[`${PM_BUCKET}/${schmuggel}`], 'und die bereits abgelegte Datei wird wieder entfernt');
  ok(!db.gs_projekt_medien.some((x) => x.path === schmuggel), 'es entsteht keine Medienzeile dafuer');

  // 4.7 Fotoupload unveraendert
  const fotoVorher = db.gs_projekt_medien.filter((x) => x.medientyp === 'foto').length;
  const foto = await tech('medien_upload', {
    ...basis, filename: 'wand.jpg', contentType: 'image/jpeg',
    data: 'data:image/jpeg;base64,' + Buffer.from('FOTO-BYTES').toString('base64'),
  });
  ok(foto.status === 200 && foto.body.ok, 'der Fotoupload funktioniert unveraendert');
  ok((foto.body.medien || {}).medientyp === 'foto', 'und wird als Foto gespeichert');
  ok(db.gs_projekt_medien.filter((x) => x.medientyp === 'foto').length === fotoVorher + 1, 'genau ein Foto dazu');
  ok(foto.body.standbild === null, 'bei einem Foto ist von Standbild keine Rede');
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5 — Berichtsauswahl umkehren
// ═══════════════════════════════════════════════════════════════════════════
// Die Vorbelegung selbst ist Oberflaeche (gs-intern.html, wrBerichtKlick). Was
// hier geprueft wird, ist beides: dass der Code die Auswahl bei JEDEM Oeffnen
// neu auf "alle" setzt, und dass der Server die Zahlen liefert, aus denen die
// Zusammenfassungszeile gebildet wird. Die Zeile selbst wird mit derselben
// Rechnung nachgestellt wie in der Oberflaeche.
async function phase5() {
  abschnitt('Phase 5 · Alles angehakt, Zusammenfassung ueber dem Knopf');
  reset();
  const { readFileSync } = await import('node:fs');
  const cockpitHtml = readFileSync(new URL('../gs-intern.html', import.meta.url), 'utf8');

  // 5.1/5.2 — die Vorbelegung steht bedingungslos im Code.
  ok(/_wrSammel\[i\]=\{\};\s*ps\.forEach\(function\(p\)\{\s*_wrSammel\[i\]\[p\.id\]=true;/.test(cockpitHtml),
    'die Maske hakt beim Oeffnen alle Projekte an');
  ok(!/if\(!_wrSammel\[i\]\)\{\s*_wrSammel\[i\]=\{\}/.test(cockpitHtml),
    'und zwar bei JEDEM Oeffnen, nicht nur beim ersten');
  ok(/data-wrsamzsfg/.test(cockpitHtml), 'die Zusammenfassungszeile ist gerendert');
  ok(cockpitHtml.indexOf('data-wrsamzsfg') < cockpitHtml.indexOf('data-wrsamgo'),
    'sie steht ÜBER dem Erzeugen-Knopf');

  // 5.3 — Serverdaten: Stunden, Fotos, Videos je Projekt.
  await tech('tech_tag_save', { datum: MO, projekt_id: P1, stunden: 8, start_zeit: '07:00', end_zeit: '16:00' });
  await tech('tech_tag_save', { datum: DI, projekt_id: P2, stunden: 6.5 });
  await tech('tech_tag_save', { datum: MI, abwesenheit: 'K', stunden: 8 });
  const z1 = db.gs_tagesrapporte.find((z) => z.projekt_id === P1).id;
  const z2 = db.gs_tagesrapporte.find((z) => z.projekt_id === P2).id;
  // Drei Fotos und ein Video auf P1, ein Foto auf P2, dazu ein Medium ohne Tag.
  db.gs_projekt_medien.push(
    { id: 'm1', projekt_id: P1, tagesrapport_id: z1, medientyp: 'foto', path: 'a.jpg', bucket: PM_BUCKET },
    { id: 'm2', projekt_id: P1, tagesrapport_id: z1, medientyp: 'foto', path: 'b.jpg', bucket: PM_BUCKET },
    { id: 'm3', projekt_id: P1, tagesrapport_id: z1, medientyp: 'foto', path: 'c.jpg', bucket: PM_BUCKET },
    { id: 'm4', projekt_id: P1, tagesrapport_id: z1, medientyp: 'video', path: 'd.mp4', bucket: PM_BUCKET },
    { id: 'm5', projekt_id: P2, tagesrapport_id: z2, medientyp: 'foto', path: 'e.jpg', bucket: PM_BUCKET },
    { id: 'm6', projekt_id: P1, tagesrapport_id: null, medientyp: 'foto', path: 'f.jpg', bucket: PM_BUCKET },
  );

  const { default: wb } = await import('../api/wochenbericht.js');
  const rufWb = async (body) => {
    let out = { status: 0, body: null };
    const rr = { setHeader() {}, status(sx) { out.status = sx; return this; }, json(j) { out.body = j; return this; }, end() { return this; } };
    await wb({ method: 'POST', headers: { authorization: 'Bearer tokMaster' }, body }, rr);
    return out;
  };
  const wp = await rufWb({ action: 'wochen_projekte', wochenrapport_id: WR });
  ok(wp.status === 200 && wp.body.ok, 'die Projekte der Woche werden geliefert');
  const ps = wp.body.projekte || [];
  ok(ps.length === 2, `zwei Projekte in der Woche (${ps.length})`);
  const pp1 = ps.find((x) => x.id === P1) || {}, pp2 = ps.find((x) => x.id === P2) || {};
  ok(pp1.fotos === 3 && pp1.videos === 1, `Projekt 1: 3 Fotos, 1 Video (${pp1.fotos}/${pp1.videos})`);
  ok(pp2.fotos === 1 && pp2.videos === 0, `Projekt 2: 1 Foto, 0 Videos (${pp2.fotos}/${pp2.videos})`);
  ok(pp1.medien_ohne_tag === 1, 'ein Medium ohne Tageszuordnung wird mitgezaehlt');

  // 5.5 — Abwesenheit nicht in der Wochensumme.
  ok(wp.body.summen.stunden === 14.5,
    `Wochensumme 14.50 h ohne die 8 h Krankheit (ist: ${wp.body.summen.stunden})`);
  ok(wp.body.summen.fotos === 4 && wp.body.summen.videos === 1, 'Wochensumme Medien: 4 Fotos, 1 Video');

  // 5.4 — die Zeile, mit derselben Rechnung wie die Oberflaeche.
  const zeile = (gewaehlt, woche) => {
    const s2 = gewaehlt.reduce((a, p) => ({
      std: a.std + Number(p.stunden || 0), fotos: a.fotos + Number(p.fotos || 0), videos: a.videos + Number(p.videos || 0),
    }), { std: 0, fotos: 0, videos: 0 });
    const n = gewaehlt.length;
    return `KW ${woche} · ${n} Projekt${n === 1 ? '' : 'e'} · ${(Math.round(s2.std * 10) / 10).toFixed(1)} h · `
      + `${s2.fotos} Foto${s2.fotos === 1 ? '' : 's'} · ${s2.videos} Video${s2.videos === 1 ? '' : 's'}`;
  };
  const alle = zeile(ps, wp.body.woche);
  ok(alle === `KW ${WOCHE} · 2 Projekte · 14.5 h · 4 Fotos · 1 Video`, `alle angehakt: "${alle}"`);
  const nurEins = zeile(ps.filter((x) => x.id === P1), wp.body.woche);
  ok(nurEins === `KW ${WOCHE} · 1 Projekt · 8.0 h · 3 Fotos · 1 Video`, `eines abgewaehlt: "${nurEins}"`);
  const keines = zeile([], wp.body.woche);
  ok(keines === `KW ${WOCHE} · 0 Projekte · 0.0 h · 0 Fotos · 0 Videos`, `keines angehakt: "${keines}"`);
}

// ═══════════════════════════════════════════════════════════════════════════
await phase1();
await phase2();
await phase3();
await phase4();
await phase5();

console.log(`\n${'═'.repeat(70)}`);
console.log(fail ? `❌ ${fail} Prüfung(en) fehlgeschlagen, ${pass} grün` : `✅ alle ${pass} Prüfungen grün`);
process.exit(fail ? 1 : 0);
