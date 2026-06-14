// E2E-Test Bug 2: Team in Kunden-Bestätigungsmail.
// Mockt fetch (Supabase + Resend), ruft den echten api/gs.js-Handler auf,
// prüft die abgefangene Resend-HTML auf das gewählte Team.
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_KEY = 'svc';
process.env.RESEND_API_KEY = 're_test';

const captured = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.includes('/rest/v1/gs_kunden')) return jsonRes([{ id: 'kunde-1' }]);
  if (u.includes('/rest/v1/gs_anfragen')) return jsonRes([{ id: 'anfrage-1' }]);
  if (u.includes('api.resend.com')) { captured.push(body); return jsonRes({ id: 'mail-1' }); }
  return jsonRes([]);
};
function jsonRes(obj, status = 200) {
  return { ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) };
}

const mod = await import('../api/gs.js');
const handler = mod.default;

const req = {
  method: 'POST',
  headers: {},
  body: {
    kunden: { vorname: 'Max', nachname: 'Muster', firma: 'Muster AG', strasse: 'Bahnhofstr. 1', plz: '8001', ort: 'Zürich', telefon: '+41 79 123 45 67', email: 'max@example.com' },
    anfrage: { projekt_name: 'Heizungsrevision', bereich: 'Heizung', tarif: 'Pilot', tarif_preis: 'CHF 60–65/h', beschreibung: 'Test' },
    team: { mode: 'team', name: 'Team 2', members: ['Patrick Notter', 'Vasil Ignatov'], stundensatz: 60, tarif: 'Pilot' },
  },
};
const res = {
  _s: 200,
  setHeader() {}, status(s) { this._s = s; return this; },
  json(o) { this.body = o; return this; }, end() { return this; },
};

await handler(req, res);

const customer = captured.find((m) => Array.isArray(m.to) ? m.to.includes('max@example.com') : m.to === 'max@example.com');
const lead = captured.find((m) => m !== customer);

let fail = 0;
function check(name, cond) { console.log((cond ? '✅' : '❌') + ' ' + name); if (!cond) fail++; }

check('Antwortstatus 200', res._s === 200);
check('Kunden-Bestätigungsmail wurde gesendet', !!customer);
check('Lead-Alarmmail wurde gesendet', !!lead);
if (customer) {
  check('Kundenmail enthält Block "Ihre Auswahl"', /Ihre Auswahl/.test(customer.html));
  check('Kundenmail enthält Team-Zeile', /Team<\/td>/.test(customer.html) || /2er-Team/.test(customer.html));
  check('Kundenmail nennt gewähltes Team "Team 2"', /Team 2/.test(customer.html));
  check('Kundenmail nennt Teammitglieder', /Patrick Notter/.test(customer.html) && /Vasil Ignatov/.test(customer.html));
}
if (lead) {
  check('Lead-Mail nennt Team 2', /Team 2/.test(lead.html));
}
console.log(fail === 0 ? '\nALLE TESTS BESTANDEN' : `\n${fail} TEST(S) FEHLGESCHLAGEN`);
process.exit(fail === 0 ? 0 : 1);
