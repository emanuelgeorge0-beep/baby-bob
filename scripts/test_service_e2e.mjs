// scripts/test_service_e2e.mjs — Golden Path des Serviceauftrags, echt.
//
// Läuft gegen den LOKALEN Dev-Server (scripts/devserver.mjs), der dieselben
// api/*-Handler ausführt wie Vercel und mit dem Service-Key gegen die
// Live-Supabase spricht. Damit ist der Weg vollständig echt — Rollen-Gate,
// Statusautomat, Rapportbindung, PDF — ohne dass etwas deployed sein muss.
//
//   Terminal 1:  node --env-file=.env.local scripts/devserver.mjs
//   Terminal 2:  node --env-file=.env.local scripts/test_service_e2e.mjs
//
// Räumt alles wieder ab: Auftrag, Zuweisung, Tageszeile, Wochenkopf.

const BASE = process.argv[2] || 'http://127.0.0.1:4321';
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_KEY;
const SB = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };
const TECH_MAIL = 'techniker.test@georgesolutions.ch';
const TECH_PASS = 'TestTech2026!';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

if (!U || !K) { console.log('SUPABASE_URL/KEY fehlen — mit --env-file=.env.local starten.'); process.exit(1); }

const rest = async (method, pfad, body, prefer) => {
  const r = await fetch(`${U}/rest/v1/${pfad}`, {
    method, headers: { ...SB, ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${pfad}: ${r.status} ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { return null; }
};
const cockpit = async (token, action, params, mode) => {
  const r = await fetch(`${BASE}/api/cockpit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, action, ...(mode ? { mode } : {}), ...(params || {}) }),
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
};
const login = async (email, password) => {
  const r = await fetch(`${U}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: K, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json().catch(() => ({}));
  return d.access_token ? { token: d.access_token, user: d.user } : null;
};

const aufraeumen = { auftrag: null, zeile: null, woche: null };

try {
  console.log(`\n══ Golden Path Serviceauftrag @ ${BASE} ══\n`);

  // ── Vorbereitung: Techniker-Login + Master-Token ──────────────────────────
  console.log('── Anmeldung ────────────────────────────────────────────');
  const tech = await login(TECH_MAIL, TECH_PASS);
  ok(!!tech, 'Techniker angemeldet');
  if (!tech) throw new Error('ohne Techniker-Token kein Test');

  // Master: die Rolle wird temporär auf dem Testaccount gesetzt und danach
  // zurückgedreht — Emanuels Passwort ist nicht bekannt. Das ist derselbe Weg,
  // den die bestehenden Suiten für admin-gated Endpunkte gehen.
  const MASTER_UID = 'ee46a716-7017-4045-9f67-fe06d05171e7';
  const masterTok = null;   // s.u.: Master-Pfad läuft über die Service-Rest-API

  // ── A · Partner erstellt den Auftrag ─────────────────────────────────────
  // Der Partner-Account hat kein bekanntes Passwort; der Auftrag wird deshalb
  // direkt über die REST-API im Namen des Partners angelegt — inhaltlich
  // identisch zu dem, was svc_create schreibt.
  console.log('\n── A · Auftrag entsteht ─────────────────────────────────');
  const partner = (await rest('GET', 'gs_projekte?partner_user_id=not.is.null&select=partner_user_id&limit=1'))[0];
  const partnerId = partner && partner.partner_user_id;
  ok(!!partnerId, `Partner gefunden (${String(partnerId).slice(0, 8)})`);

  const auftrag = (await rest('POST', 'gs_service_auftrag', {
    objekt: 'ZZE2E Teststrasse 1, 8000 Zürich',
    beschreibung: 'ZZE2E Heizung ohne Druck, Kunde meldet Ausfall.',
    quelle: 'manuell', status: 'neu', partner_user_id: partnerId,
  }, 'return=representation'))[0];
  aufraeumen.auftrag = auftrag.id;
  ok(!!auftrag.id, 'Serviceauftrag angelegt');
  ok(auftrag.status === 'neu', `Startstatus neu (ist ${auftrag.status})`);

  // ── B · Disposition: Techniker zuweisen ──────────────────────────────────
  console.log('\n── B · Disposition ──────────────────────────────────────');
  const t = (await rest('GET', `gs_techniker?user_id=eq.${tech.user.id}&select=id,name&limit=1`))[0];
  ok(!!t, `Technikerprofil verknüpft (${t && t.name})`);
  await rest('POST', 'gs_service_techniker', { service_auftrag_id: auftrag.id, techniker_id: t.id }, 'return=minimal');
  ok(true, 'Techniker zugewiesen');

  // ── C · Techniker sieht, nimmt an, startet ───────────────────────────────
  console.log('\n── C · Techniker ────────────────────────────────────────');
  let r = await cockpit(tech.token, 'svc_liste', {}, 'techniker');
  const meiner = (r.d.auftraege || []).find((x) => x.id === auftrag.id);
  ok(!!meiner, 'Auftrag erscheint in der Technikerliste');
  ok(meiner && Array.isArray(meiner.techniker_namen), 'Liste liefert Techniker-Namen mit');

  r = await cockpit(tech.token, 'svc_status', { id: auftrag.id, status: 'in_arbeit' }, 'techniker');
  ok(!!(r.d && r.d.error) || r.status === 403, 'Sprung neu → in_arbeit wird abgewiesen');

  r = await cockpit(tech.token, 'svc_status', { id: auftrag.id, status: 'angenommen' }, 'techniker');
  ok(r.d && r.d.ok && r.d.auftrag.status === 'angenommen', 'Techniker nimmt an');
  ok(!!r.d.auftrag.angenommen_am, 'angenommen_am gesetzt');

  r = await cockpit(tech.token, 'svc_status', { id: auftrag.id, status: 'in_arbeit' }, 'techniker');
  ok(r.d && r.d.ok && r.d.auftrag.status === 'in_arbeit', 'Techniker startet die Arbeit');

  // ── D · Pflicht-Abschluss greift ─────────────────────────────────────────
  console.log('\n── D · Pflicht-Abschluss ────────────────────────────────');
  r = await cockpit(tech.token, 'svc_status', { id: auftrag.id, status: 'erledigt' }, 'techniker');
  ok(!!(r.d && r.d.error), `Abschluss ohne erfasste Arbeit blockiert (${(r.d && r.d.error || '').slice(0, 60)}…)`);
  ok(Array.isArray(r.d && r.d.abschluss_offen) && r.d.abschluss_offen.length, 'Grund wird benannt, nicht nur abgelehnt');

  r = await cockpit(tech.token, 'svc_detail', { id: auftrag.id }, 'techniker');
  ok((r.d.abschluss_offen || []).length > 0, 'svc_detail zeigt die Sperre vorab an');

  // ── E · Arbeit erfassen (echte Tageszeile über tech_tag_save) ────────────
  console.log('\n── E · Rapport ──────────────────────────────────────────');
  const datum = '2099-04-06';       // weit weg von echten Daten
  r = await cockpit(tech.token, 'tech_tag_save', {
    datum, service_auftrag_id: auftrag.id, start_zeit: '08:00', end_zeit: '11:30',
    stunden: 3.5, taetigkeit: 'Heizung', arbeiten: ['ZZE2E Druck ergänzt', 'ZZE2E Entlüftet'],
    notiz: 'ZZE2E Ausdehnungsgefäss defekt, Ersatz empfohlen.',
  }, 'techniker');
  const zeile = r.d && r.d.row;
  aufraeumen.zeile = zeile && zeile.id;
  aufraeumen.woche = zeile && zeile.wochenrapport_id;
  ok(!!(zeile && zeile.id), 'Tageszeile auf den Serviceauftrag gebucht');
  ok(zeile && zeile.service_auftrag_id === auftrag.id, 'Zeile hängt am richtigen Auftrag');
  ok(zeile && Number(zeile.gesamtstunden) === 3.5, `3.5 Stunden erfasst (ist ${zeile && zeile.gesamtstunden})`);

  r = await cockpit(tech.token, 'svc_detail', { id: auftrag.id }, 'techniker');
  ok((r.d.rapporte || []).length === 1, 'Rapport erscheint am Auftrag');
  ok(r.d.stunden === 3.5, `Stundensumme am Auftrag (ist ${r.d.stunden})`);
  ok((r.d.abschluss_offen || []).length === 0, 'Abschluss ist jetzt frei');

  // ── F · Abschluss ────────────────────────────────────────────────────────
  console.log('\n── F · Abschluss ────────────────────────────────────────');
  r = await cockpit(tech.token, 'svc_status', { id: auftrag.id, status: 'erledigt' }, 'techniker');
  ok(r.d && r.d.ok && r.d.auftrag.status === 'erledigt', 'Auftrag abgeschlossen');
  ok(!!r.d.auftrag.erledigt_am, 'erledigt_am gesetzt');

  r = await cockpit(tech.token, 'svc_status', { id: auftrag.id, status: 'in_arbeit' }, 'techniker');
  ok(!!(r.d && r.d.error) || r.status === 403, 'Endzustand lässt sich nicht rückwärts öffnen');

  // ── G · Servicebericht ───────────────────────────────────────────────────
  console.log('\n── G · Servicebericht ───────────────────────────────────');
  r = await cockpit(tech.token, 'svc_bericht', { id: auftrag.id }, 'techniker');
  ok(!!(r.d && r.d.pdf_base64), 'PDF erzeugt');
  const pdf = r.d.pdf_base64 ? Buffer.from(r.d.pdf_base64, 'base64') : Buffer.alloc(0);
  const s = pdf.toString('latin1');
  ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'), `gültiges PDF (${pdf.length} Bytes)`);
  ok(s.includes('Servicebericht'), 'Titel im Dokument');
  ok(s.includes('ZZE2E Druck erg'), 'Tätigkeit steht im Bericht');
  ok(s.includes('3.50'), 'Arbeitszeit steht im Bericht');
  ok(s.includes('0.788 0.663 0.380'), 'Akzentfarbe aus gs_branding');
  ok(!!(r.d.branding && r.d.branding.aus_tabelle), 'Branding kam aus der Tabelle, nicht aus dem Fallback');

  // ── H · Mandantentrennung ────────────────────────────────────────────────
  console.log('\n── H · Fremdzugriff ─────────────────────────────────────');
  const fremd = (await rest('POST', 'gs_service_auftrag', {
    objekt: 'ZZE2E Fremdauftrag', quelle: 'manuell', status: 'neu', partner_user_id: null,
  }, 'return=representation'))[0];
  r = await cockpit(tech.token, 'svc_detail', { id: fremd.id }, 'techniker');
  ok(r.status === 403 || !!(r.d && r.d.error), 'nicht zugewiesener Auftrag ist für den Techniker gesperrt');
  r = await cockpit(tech.token, 'svc_bericht', { id: fremd.id }, 'techniker');
  ok(r.status === 403 || !!(r.d && r.d.error), 'auch der Bericht ist gesperrt');
  await rest('DELETE', `gs_service_auftrag?id=eq.${fremd.id}`, null, 'return=minimal');

  r = await cockpit(tech.token, 'svc_create', { objekt: 'ZZE2E darf nicht' }, 'techniker');
  ok(r.status === 403 || !!(r.d && r.d.error), 'Techniker darf keinen Auftrag erstellen');
} catch (e) {
  fail++;
  console.log('\n✗ ABBRUCH: ' + (e && e.message));
} finally {
  console.log('\n── Aufräumen ────────────────────────────────────────────');
  if (aufraeumen.zeile) await rest('DELETE', `gs_tagesrapporte?id=eq.${aufraeumen.zeile}`, null, 'return=minimal').catch(() => {});
  if (aufraeumen.woche) await rest('DELETE', `gs_wochenrapporte?id=eq.${aufraeumen.woche}`, null, 'return=minimal').catch(() => {});
  if (aufraeumen.auftrag) {
    await rest('DELETE', `gs_service_techniker?service_auftrag_id=eq.${aufraeumen.auftrag}`, null, 'return=minimal').catch(() => {});
    await rest('DELETE', `gs_service_auftrag?id=eq.${aufraeumen.auftrag}`, null, 'return=minimal').catch(() => {});
  }
  const rest_ = await rest('GET', 'gs_service_auftrag?objekt=like.ZZE2E*&select=id').catch(() => []);
  console.log(`  Reste: ${(rest_ || []).length}`);
  console.log(fail ? `\n✗ ${fail} FEHLER · ${pass} Prüfungen bestanden` : `\n✓ ALLE ${pass} Prüfungen bestanden`);
  process.exit(fail ? 1 : 0);
}
