// api/tagesrapport.js – Daily rapport: capture, media, week view, status, auto PDF+invoice
import { buildRapportPdf, buildRechnungPdf } from '../lib/pdf.js';
import { isEntitled } from '../lib/entitlements.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Nicht authentifiziert' });
  const user = await getUser(token);
  if (!user) return res.status(401).json({ error: 'Ungültiger Token' });
  const role = await getRole(user.id);

  try {
    const { action } = req.body || {};
    // Feature-Durchsetzung (nur gs_partner; Techniker erfasst ungehindert):
    //  • Rapporte/Berichte ansehen  → 'reporting'
    //  • Rapport selbst erfassen    → 'rapport'
    // Fail-open, solange die Entitlements-Tabelle fehlt.
    if (role === 'gs_partner') {
      if ((action === 'list' || action === 'get' || action === 'week') && !(await isEntitled(user.id, 'reporting'))) {
        return res.status(403).json({ error: 'Berichte & Rapporte sind für Ihren Zugang nicht freigeschaltet.', locked: 'reporting' });
      }
      if (action === 'save' && !(await isEntitled(user.id, 'rapport'))) {
        return res.status(403).json({ error: 'Rapport-Erfassung ist für Ihren Zugang nicht freigeschaltet.', locked: 'rapport' });
      }
    }
    switch (action) {
      case 'list':            return await list(res, user, role, req.body);
      case 'get':             return await getOne(res, user, role, req.body);
      case 'today':           return await today(res, user, role, req.body);
      case 'save':            return await save(res, user, role, req.body);
      case 'week':            return await week(res, user, role, req.body);
      case 'status_overview': return await statusOverview(res, role);
      default:                return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Tagesrapport Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

const SELECT = '*';

async function list(res, user, role, body) {
  const f = [];
  if (body.projekt_id) f.push(`projekt_id=eq.${body.projekt_id}`);
  if (body.jahr) f.push(`jahr=eq.${body.jahr}`);
  if (body.woche) f.push(`woche=eq.${body.woche}`);
  if (role === 'techniker') f.push(`techniker_user_id=eq.${user.id}`);
  else if (role === 'gs_partner') {
    // Nur nicht-gelöschte Projekte: Soft-Delete setzt geloescht_at, status bleibt
    // 'aktiv' — ohne diesen Filter tauchen Rapporte gelöschter Projekte weiter auf.
    // Bewusst NUR hier, nicht in partnerProjektIds(): das ist die Zugriffsprüfung.
    const ids = await partnerProjektIds(user.id, true);
    if (!ids.length) return res.status(200).json({ rapporte: [] });
    f.push(`projekt_id=in.(${ids.join(',')})`);
  } else if (role !== 'gs_admin') return res.status(403).json({ error: 'Keine Berechtigung' });
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?${f.join('&')}&select=${SELECT}&order=datum.desc`, { headers: SB }));
  const list = Array.isArray(rows) ? rows : [];
  // Techniker-Namen anreichern (für Partner-Ansicht; sonst nur user_id verfügbar).
  const ids = [...new Set(list.map((r) => r.techniker_user_id).filter(Boolean))];
  if (ids.length) {
    const techs = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?user_id=in.(${ids.join(',')})&select=user_id,name`, { headers: SB }));
    const nameById = {}; (Array.isArray(techs) ? techs : []).forEach((t) => { if (t.user_id) nameById[t.user_id] = t.name; });
    for (const r of list) r.techniker_name = nameById[r.techniker_user_id] || null;
  }
  return res.status(200).json({ rapporte: list });
}

async function getOne(res, user, role, body) {
  const { id } = body || {};
  if (!id) return res.status(400).json({ error: 'id erforderlich' });
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?id=eq.${id}&select=${SELECT}`, { headers: SB }));
  const r = (Array.isArray(rows) ? rows : [])[0];
  if (!r) return res.status(404).json({ error: 'Rapport nicht gefunden' });
  if (!(await canAccess(user, role, r))) return res.status(403).json({ error: 'Keine Berechtigung' });
  // Signed URLs for media
  r.fotos_signed = await Promise.all((r.foto_urls || []).map((p) => signUrl('rapport-photos', p)));
  r.unterschrift_signed = r.unterschrift_url ? await signUrl('rapport-signatures', r.unterschrift_url) : null;
  r.pdf_signed = r.pdf_url ? await signUrl('rapport-pdfs', r.pdf_url) : null;
  return res.status(200).json({ rapport: r });
}

async function today(res, user, role, body) {
  if (role !== 'techniker' && role !== 'gs_admin') return res.status(403).json({ error: 'Nur für Techniker' });
  const datum = body.datum || isoDate(new Date());
  const f = [`techniker_user_id=eq.${user.id}`, `datum=eq.${datum}`];
  if (body.projekt_id) f.push(`projekt_id=eq.${body.projekt_id}`);
  // order ist Pflicht, nicht Kosmetik: ohne projekt_id kann ein Kalendertag
  // mehrere Zeilen tragen, und `limit=1` ohne Sortierung greift dann eine
  // beliebige heraus — genau die, mit der die Maske danach vorbefuellt wird.
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?${f.join('&')}&select=${SELECT}&order=created_at.asc&limit=1`, { headers: SB }));
  const existing = (Array.isArray(rows) ? rows : [])[0] || null;
  return res.status(200).json({ datum, rapport: existing, suggestions: await suggestArbeiten(user.id, body.projekt_id) });
}

async function save(res, user, role, body) {
  if (role !== 'techniker' && role !== 'gs_admin') return res.status(403).json({ error: 'Nur für Techniker' });
  const { projekt_id, datum } = body || {};
  if (!projekt_id) return res.status(400).json({ error: 'projekt_id erforderlich' });
  if (!datum) return res.status(400).json({ error: 'datum erforderlich' });
  const submit = body.status === 'eingereicht';

  const gesamt = body.gesamtstunden != null ? Number(body.gesamtstunden) : computeHours(body.zeit_von, body.zeit_bis);
  if (submit && !(gesamt > 0)) return res.status(400).json({ error: 'Arbeitszeit (Von/Bis) erforderlich' });

  // Find existing (unique projekt+techniker+datum) to update.
  const existRows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?projekt_id=eq.${projekt_id}&techniker_user_id=eq.${user.id}&datum=eq.${datum}&select=id,foto_urls&limit=1`, { headers: SB }));
  const existing = (Array.isArray(existRows) ? existRows : [])[0] || null;
  const rapportId = existing?.id || crypto.randomUUID();

  // Media uploads
  let fotoPaths = existing?.foto_urls || [];
  if (Array.isArray(body.fotos) && body.fotos.length) {
    fotoPaths = [];
    for (let i = 0; i < body.fotos.length; i++) {
      const buf = decodeB64(body.fotos[i]);
      if (!buf) continue;
      const path = `${rapportId}/foto-${i}.jpg`;
      if (await uploadObject('rapport-photos', path, buf, 'image/jpeg')) fotoPaths.push(path);
    }
  }
  let sigPath = null;
  if (body.unterschrift) {
    const buf = decodeB64(body.unterschrift);
    if (buf) { sigPath = `${rapportId}/signature.png`; if (!(await uploadObject('rapport-signatures', sigPath, buf, 'image/png'))) sigPath = null; }
  }

  const row = {
    id: rapportId, projekt_id, techniker_user_id: user.id, datum,
    zeit_von: body.zeit_von || null, zeit_bis: body.zeit_bis || null, gesamtstunden: gesamt || 0,
    team: arr(body.team), arbeiten: arr(body.arbeiten), material: arr(body.material),
    besonderheiten: body.besonderheiten || null, foto_urls: fotoPaths,
    empfaenger: arr(body.empfaenger), status: submit ? 'eingereicht' : 'entwurf',
    woche: isoWeek(datum), jahr: new Date(datum).getFullYear(),
    eingereicht_am: submit ? new Date().toISOString() : null,
  };
  if (sigPath) row.unterschrift_url = sigPath;

  // on_conflict=id ist der PRIMAERSCHLUESSEL, nicht der fachliche Schluessel.
  // Ein Verstoss gegen UNIQUE(projekt_id, techniker_user_id, datum) wird davon
  // NICHT aufgeloest — er kommt als 409 zurueck. Bis hierher fiel das in den
  // generischen 500-Text und der Techniker las "Rapport konnte nicht
  // gespeichert werden", ohne zu erfahren, was kollidiert.
  //
  // Der Konfliktschluessel bleibt bewusst id: `resolution=merge-duplicates` auf
  // dem fachlichen Schluessel wuerde eine FREMDE bestehende Zeile stillschweigend
  // ueberschreiben — genau der Datenverlust, gegen den api/cockpit.js
  // saveTechTag abgesichert wurde. Gemeldet statt ueberschrieben.
  const up = await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?on_conflict=id`, {
    method: 'POST', headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row),
  });
  const upText = up.ok ? null : await up.text().catch(() => '');
  const saved = up.ok ? (await sbJson(up))?.[0] : null;
  if (!up.ok || !saved) {
    // 23505 unique_violation / 23514 check_violation sind Aussagen, keine
    // Stoerungen — sie gehoeren als Klartext an den Techniker, ohne ids,
    // Tabellen- oder Spaltennamen. 409 ist der Status, den PostgREST fuer 23505
    // liefert, 400 der fuer 23514.
    const code = (upText || '').match(/"code"\s*:\s*"(\w+)"/)?.[1]
      || (/duplicate key/i.test(upText || '') ? '23505' : null)
      || (/violates check constraint/i.test(upText || '') ? '23514' : null);
    if (code === '23505') {
      return res.status(409).json({
        error: 'Für dieses Projekt besteht an diesem Tag bereits ein Rapport. Er wurde nicht überschrieben — '
          + 'bitte den bestehenden Rapport ergänzen oder ein anderes Projekt wählen.',
      });
    }
    if (code === '23514') {
      return res.status(400).json({
        error: 'Dieser Eintrag darf nicht gleichzeitig eine Abwesenheit und ein Projekt tragen. Es wurde nichts gespeichert.',
      });
    }
    console.error('tagesrapport save fail', up.status, (upText || '').slice(0, 300));
    return res.status(500).json({ error: 'Rapport konnte nicht gespeichert werden' });
  }

  // Block 1: weitere Positionen (mehrere Projekte pro Tag) → gs_rapport_positionen.
  // Best-effort: scheitert die Tabelle (Migration noch nicht ausgeführt), bleibt der Rapport gespeichert.
  if (Array.isArray(body.positionen) && body.positionen.length) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/gs_rapport_positionen?rapport_id=eq.${rapportId}`, { method: 'DELETE', headers: { ...SB, Prefer: 'return=minimal' } });
      const posRows = body.positionen.map((p, i) => ({
        rapport_id: rapportId, projekt_id: p.projekt_id || null, projektnummer: p.projektnummer || null,
        zeit_von: p.zeit_von || null, zeit_bis: p.zeit_bis || null, stunden: Number(p.stunden) || 0,
        arbeiten: arr(p.arbeiten), material: arr(p.material), notiz: p.notiz || null, sortierung: i,
      }));
      await fetch(`${SUPABASE_URL}/rest/v1/gs_rapport_positionen`, { method: 'POST', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(posRows) });
    } catch (e) { console.error('rapport positionen insert failed (migration run?):', e.message); }
  }

  let invoice = null;
  if (submit) {
    const projekt = await getProjekt(projekt_id);
    // PDF
    const pdf = buildRapportPdf({ ...saved, projekt_name: projekt?.name, projektnummer: projekt?.projektnummer, standort: projekt?.standort, techniker_name: await techName(user.id) });
    const pdfPath = `${rapportId}.pdf`;
    if (await uploadObject('rapport-pdfs', pdfPath, pdf, 'application/pdf')) {
      await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?id=eq.${rapportId}`, { method: 'PATCH', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify({ pdf_url: pdfPath }) });
      saved.pdf_url = pdfPath;
    }
    // Auto-invoice
    if (projekt?.stundensatz && gesamt > 0) invoice = await generateInvoice(saved, projekt, gesamt);
  }
  return res.status(200).json({ ok: true, rapport: saved, invoice });
}

async function week(res, user, role, body) {
  if (role !== 'techniker' && role !== 'gs_admin') return res.status(403).json({ error: 'Nur für Techniker' });
  const jahr = body.jahr || new Date().getFullYear();
  const kw = body.woche || isoWeek(isoDate(new Date()));
  // Ein Kalendertag kann MEHRERE Tageszeilen tragen — je Baustelle eine.
  // Bis hierher stand hier `byDate[r.datum] = r`: eine Zuweisung, bei der nur
  // die zuletzt gelesene Zeile ueberlebte. Welche das war, war undefiniert, weil
  // die Abfrage kein `order` hatte. Montag 17.08.2026 (60060 Zuerich 2.00 h +
  // 60829 Thalwil 6.00 h) zeigte deshalb 2.00 statt 8.00 h, und der Fehler lief
  // ueber tsLoadWeek (app.html:6818) bis in die angezeigte Lohnsumme.
  // Jetzt wird je Kalendertag akkumuliert. Vorbild: hasOverdue() weiter unten.
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?techniker_user_id=eq.${user.id}&jahr=eq.${jahr}&woche=eq.${kw}&select=datum,status,gesamtstunden,ueberzeit_25,ueberzeit_50,ueberzeit_100,projekt_id&order=datum.asc,created_at.asc`, { headers: SB }));
  const byDate = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = byDate[r.datum] || (byDate[r.datum] = { stunden: 0, ueberzeit: 0, zeilen: 0, alleEingereicht: true });
    t.stunden += Number(r.gesamtstunden || 0);
    t.ueberzeit += Number(r.ueberzeit_25 || 0) + Number(r.ueberzeit_50 || 0) + Number(r.ueberzeit_100 || 0);
    t.zeilen += 1;
    // Ein Tag gilt erst als eingereicht, wenn ALLE seine Zeilen es sind. Vorher
    // entschied eine zufaellige Zeile darueber, was die Ampel zeigte.
    if (r.status !== 'eingereicht') t.alleEingereicht = false;
  }
  const dates = mondayToFriday(jahr, kw);
  const todayStr = isoDate(new Date());
  const days = dates.map((d) => {
    const t = byDate[d];
    let status = 'offen';
    if (t) status = t.alleEingereicht ? 'eingereicht' : 'entwurf';
    else if (d < todayStr) status = 'ueberfaellig';
    else if (d === todayStr) status = 'ausstehend';
    return {
      datum: d, status,
      stunden: t ? Math.round(t.stunden * 100) / 100 : 0,
      ueberzeit: t ? Math.round(t.ueberzeit * 100) / 100 : 0,
      zeilen: t ? t.zeilen : 0,
    };
  });
  return res.status(200).json({ jahr, woche: kw, days, eingereicht: days.filter((d) => d.status === 'eingereicht').length, total: 5 });
}

async function statusOverview(res, role) {
  if (role !== 'gs_admin') return res.status(403).json({ error: 'Nur für Administratoren' });
  const techs = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?user_id=not.is.null&select=user_id,name`, { headers: SB }));
  const todayStr = isoDate(new Date());
  const kw = isoWeek(todayStr), jahr = new Date().getFullYear();
  const list = Array.isArray(techs) ? techs : [];
  const out = await Promise.all(list.map(async (t) => {
    const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?techniker_user_id=eq.${t.user_id}&jahr=eq.${jahr}&woche=eq.${kw}&select=datum,status`, { headers: SB }));
    const arr2 = Array.isArray(rows) ? rows : [];
    // Auch hier gilt: ein Tag hat womoeglich mehrere Zeilen. `.find()` griff
    // eine davon heraus — bei zwei Baustellen, davon eine eingereicht und eine
    // im Entwurf, war die Ampelfarbe Zufall. Gruen ist ein Tag erst, wenn ALLE
    // seine Zeilen eingereicht sind.
    const heuteZeilen = arr2.filter((r) => r.datum === todayStr);
    const heuteFertig = heuteZeilen.length > 0 && heuteZeilen.every((r) => r.status === 'eingereicht');
    let ampel = 'gelb';
    if (heuteFertig) ampel = 'gruen';
    else if (arr2.some((r) => r.datum < todayStr && r.status !== 'eingereicht') || (!heuteZeilen.length && hasOverdue(arr2, todayStr, jahr, kw))) ampel = 'rot';
    // week_submitted zaehlte ZEILEN, wird aber als "x/5 Tage" angezeigt
    // (app.html:6369) — zwei Baustellen am Montag ergaben "6/5 Tage". Gezaehlt
    // werden jetzt die Kalendertage, an denen alle Zeilen eingereicht sind.
    const jeTag = {};
    for (const r of arr2) {
      if (!(r.datum in jeTag)) jeTag[r.datum] = true;
      if (r.status !== 'eingereicht') jeTag[r.datum] = false;
    }
    const tageEingereicht = Object.values(jeTag).filter(Boolean).length;
    return { user_id: t.user_id, name: t.name, ampel, week_submitted: tageEingereicht };
  }));
  return res.status(200).json({ techniker: out, datum: todayStr, woche: kw });
}

// ── invoice ──
async function generateInvoice(rapport, projekt, stunden) {
  const existing = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_rechnungen?rapport_id=eq.${rapport.id}&select=id&limit=1`, { headers: SB }));
  if ((Array.isArray(existing) ? existing : []).length) return null; // already invoiced
  const betrag = Math.round(stunden * Number(projekt.stundensatz) * 100) / 100;
  const rnr = await nextRechnungsnummer();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_rechnungen`, { method: 'POST', headers: { ...SB, Prefer: 'return=representation' },
    body: JSON.stringify({ rapport_id: rapport.id, projekt_id: projekt.id, rechnungsnummer: rnr, stunden, stundensatz: Number(projekt.stundensatz), betrag, status: 'erstellt' }) });
  const inv = (await sbJson(r))?.[0];
  if (!inv) return null;
  const pdf = buildRechnungPdf({ ...inv, projekt_name: projekt.name, projektnummer: projekt.projektnummer });
  const pdfPath = `${inv.id}.pdf`;
  if (await uploadObject('rapport-pdfs', pdfPath, pdf, 'application/pdf')) {
    await fetch(`${SUPABASE_URL}/rest/v1/gs_rechnungen?id=eq.${inv.id}`, { method: 'PATCH', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify({ pdf_url: pdfPath }) });
    inv.pdf_url = pdfPath;
  }
  return inv;
}

async function nextRechnungsnummer() {
  const year = new Date().getFullYear();
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_rechnungen?rechnungsnummer=like.R-${year}-*&select=rechnungsnummer&order=rechnungsnummer.desc&limit=1`, { headers: SB }));
  let n = 1; const last = (Array.isArray(rows) ? rows : [])[0]?.rechnungsnummer;
  if (last) { const m = last.match(/(\d+)$/); if (m) n = parseInt(m[1], 10) + 1; }
  return `R-${year}-${String(n).padStart(4, '0')}`;
}

// ── helpers ──
async function suggestArbeiten(userId, projektId) {
  const f = [`techniker_user_id=eq.${userId}`];
  if (projektId) f.push(`projekt_id=eq.${projektId}`);
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?${f.join('&')}&select=arbeiten&order=datum.desc&limit=20`, { headers: SB }));
  const freq = {};
  for (const r of Array.isArray(rows) ? rows : []) for (const a of r.arbeiten || []) freq[a] = (freq[a] || 0) + 1;
  return Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 4);
}
// nurAktive=true → gelöschte Projekte (geloescht_at gesetzt) fallen raus. Nur für
// Listen; die Zugriffsprüfung canAccess() ruft ohne Flag, damit ein gelöschtes
// Projekt keine bestehende Berechtigung still verändert.
async function partnerProjektIds(userId, nurAktive) {
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?partner_user_id=eq.${userId}&select=id,geloescht_at`, { headers: SB }));
  return (Array.isArray(rows) ? rows : []).filter((r) => !(nurAktive && r.geloescht_at)).map((r) => r.id);
}
async function canAccess(user, role, r) {
  if (role === 'gs_admin') return true;
  if (role === 'techniker') return r.techniker_user_id === user.id;
  if (role === 'gs_partner') return (await partnerProjektIds(user.id)).includes(r.projekt_id);
  return false;
}
async function getProjekt(id) {
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?id=eq.${id}&select=*&limit=1`, { headers: SB }));
  return (Array.isArray(rows) ? rows : [])[0] || null;
}
async function techName(userId) {
  const rows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/gs_techniker?user_id=eq.${userId}&select=name&limit=1`, { headers: SB }));
  return (Array.isArray(rows) ? rows : [])[0]?.name || 'Techniker';
}
async function uploadObject(bucket, path, buffer, contentType) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' }, body: buffer,
  });
  if (!r.ok) console.error('upload fail', bucket, path, r.status, await r.text().catch(() => ''));
  return r.ok;
}
async function signUrl(bucket, path, expiresIn = 3600) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, { method: 'POST', headers: SB, body: JSON.stringify({ expiresIn }) });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return d.signedURL ? SUPABASE_URL + '/storage/v1' + d.signedURL : null;
}
function decodeB64(s) {
  if (!s || typeof s !== 'string') return null;
  const raw = s.includes(',') ? s.split(',')[1] : s;
  try { const b = Buffer.from(raw, 'base64'); return b.length ? b : null; } catch { return null; }
}
function computeHours(von, bis) {
  if (!von || !bis) return 0;
  const [h1, m1] = von.split(':').map(Number), [h2, m2] = bis.split(':').map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 10) / 10;
}
function arr(x) { return Array.isArray(x) ? x : []; }
function isoDate(d) { return d.toISOString().slice(0, 10); }
function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - ys) / 86400000) + 1) / 7);
}
// ZIEL 4 (Rapport Feinschliff II) — KORREKTUR. Die alte Fassung rechnete
// "1. Januar + (KW-1)*7, dann auf Montag zurück" und lag damit in jedem Jahr,
// dessen 1.1. auf Fr/Sa/So fällt, eine ganze Woche daneben (2027, 2028, …).
// Betrifft hier die Wochenübersicht (action 'week') und hasOverdue — eine
// falsche Woche hätte dort Rapporte als überfällig gemeldet, die es nicht sind.
// Jetzt nach ISO 8601: KW1 ist die Woche, die den 4. Januar enthält.
// Belegt für jeden Tag 2026–2030 in scripts/test_isowoche.mjs.
function mondayToFriday(jahr, kw) {
  const jan4 = new Date(Date.UTC(jahr, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() + 1 - dow);
  monday.setUTCDate(monday.getUTCDate() + (kw - 1) * 7);
  return Array.from({ length: 5 }, (_, i) => { const d = new Date(monday); d.setUTCDate(monday.getUTCDate() + i); return isoDate(d); });
}
function hasOverdue(rows, todayStr, jahr, kw) {
  const have = new Set(rows.filter((r) => r.status === 'eingereicht').map((r) => r.datum));
  return mondayToFriday(jahr, kw).some((d) => d < todayStr && !have.has(d));
}
async function getUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}
async function getRole(userId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&select=role&limit=1`, { headers: SB });
  if (!r.ok) return null;
  return (await r.json())[0]?.role || null;
}
async function sbJson(r) { try { return await r.json(); } catch { return null; } }
