// lib/servicebericht.js — Servicebericht (ein Serviceauftrag) als PDF.
//
// Baut NICHTS neu. Der Bericht entsteht aus denselben Bausteinen wie der
// Wochenbericht:
//   • Gestaltung  → buildPdf({ style:'brief' }) aus lib/pdf.js
//   • Marke       → ladeBranding() aus gs_branding
//   • Zeiten      → gs_tagesrapporte (service_auftrag_id)
//   • Fotos       → gs_projekt_medien (service_auftrag_id)
// Es gibt bewusst keine zweite PDF-Engine, keine zweite Branding-Quelle und
// keine zweite Rapport-Tabelle.
//
// Kein import.meta: ohne package.json lädt Vercel lib/*.js als CJS, und
// import.meta lässt das Modul schon beim Laden abstürzen.

import { buildPdf, ladeBranding } from './pdf.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

const FOTOS_IM_PDF = 6;
const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
const h2 = (n) => Number(n || 0).toFixed(2);
const dmy = (iso) => (iso ? `${String(iso).slice(8, 10)}.${String(iso).slice(5, 7)}.${String(iso).slice(0, 4)}` : '–');
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

async function sbGet(pfad) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pfad}`, { headers: SB });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
// Wie im Wochenbericht: fehlende Tabelle/Spalte darf den Bericht nicht kippen.
async function sbSoft(pfad, fallback) {
  try { return await sbGet(pfad); } catch (_) { return fallback; }
}

const STATUS_TEXT = {
  neu: 'Neu',
  angenommen: 'Angenommen',
  in_arbeit: 'In Arbeit',
  erledigt: 'Abgeschlossen',
  abgelehnt: 'Abgelehnt',
};

// ═══════════════════════════════════════════════════════════════════════════
// Daten einsammeln
// ═══════════════════════════════════════════════════════════════════════════
export async function sammleServicedaten(serviceAuftragId) {
  const hinweise = [];
  const a = (await sbGet(`gs_service_auftrag?id=eq.${serviceAuftragId}&select=*&limit=1`))[0];
  if (!a) throw new Error('Serviceauftrag nicht gefunden');

  // Einsätze: dieselben Tageszeilen, die der Techniker im Wochenblatt erfasst.
  const zeilen = await sbSoft(
    `gs_tagesrapporte?service_auftrag_id=eq.${serviceAuftragId}`
    + '&select=id,datum,techniker_user_id,start_zeit,end_zeit,pause_minuten,gesamtstunden,'
    + 'ueberzeit_25,ueberzeit_50,ueberzeit_100,spesen,taetigkeit,arbeiten,besonderheiten,material,material_positionen'
    + '&order=datum.asc', [],
  ) || [];

  // Namen auflösen — über gs_techniker.user_id, wie überall sonst auch.
  const uids = [...new Set(zeilen.map((z) => z.techniker_user_id).filter(Boolean))];
  const namen = {};
  if (uids.length) {
    const ts = await sbSoft(`gs_techniker?user_id=in.(${uids.join(',')})&select=user_id,name`, []) || [];
    for (const t of ts) namen[t.user_id] = t.name;
  }
  // Zusätzlich die zugewiesenen Techniker — auch die, die (noch) nichts gebucht haben.
  const asg = await sbSoft(`gs_service_techniker?service_auftrag_id=eq.${serviceAuftragId}&select=techniker_id`, []) || [];
  const tIds = [...new Set(asg.map((x) => x.techniker_id).filter(Boolean))];
  let zugewiesen = [];
  if (tIds.length) {
    const ts = await sbSoft(`gs_techniker?id=in.(${tIds.join(',')})&select=id,name`, []) || [];
    zugewiesen = ts.map((t) => t.name).filter(Boolean);
  }

  const einsaetze = zeilen.map((z) => ({
    id: z.id,
    datum: z.datum,
    techniker: namen[z.techniker_user_id] || (z.techniker_user_id ? 'Unbekannter Techniker' : '—'),
    von: hhmm(z.start_zeit),
    bis: hhmm(z.end_zeit),
    pause_minuten: z.pause_minuten == null ? null : num(z.pause_minuten),
    stunden: num(z.gesamtstunden),
    ueberzeit: Math.round((num(z.ueberzeit_25) + num(z.ueberzeit_50) + num(z.ueberzeit_100)) * 100) / 100,
    spesen: num(z.spesen),
    gewerk: z.taetigkeit || null,
    arbeiten: Array.isArray(z.arbeiten) ? z.arbeiten.filter(Boolean) : [],
    notiz: z.besonderheiten || null,
  }));

  // Material aus den Tageszeilen — dieselbe Quelle wie im Wochenbericht.
  const material = [];
  for (const z of zeilen) {
    const wer = namen[z.techniker_user_id] || '—';
    for (const mp of (Array.isArray(z.material_positionen) ? z.material_positionen : [])) {
      if (mp && mp.bezeichnung) material.push({ bezeichnung: String(mp.bezeichnung), menge: mp.menge ?? null, datum: z.datum, techniker: wer });
    }
    for (const mt of (Array.isArray(z.material) ? z.material : [])) {
      if (mt) material.push({ bezeichnung: String(mt), menge: null, datum: z.datum, techniker: wer });
    }
  }

  const fotos = await sbSoft(
    `gs_projekt_medien?service_auftrag_id=eq.${serviceAuftragId}&medientyp=eq.foto`
    + '&select=id,bucket,path,dateiname,notiz,raum,created_at&order=created_at.asc', [],
  ) || [];

  const summen = {
    stunden: Math.round(einsaetze.reduce((s, e) => s + e.stunden, 0) * 100) / 100,
    ueberzeit: Math.round(einsaetze.reduce((s, e) => s + e.ueberzeit, 0) * 100) / 100,
    spesen: Math.round(einsaetze.reduce((s, e) => s + e.spesen, 0) * 100) / 100,
    einsaetze: einsaetze.length,
    techniker: new Set(einsaetze.map((e) => e.techniker)).size,
  };

  if (!einsaetze.length) hinweise.push('Zu diesem Auftrag wurde noch keine Arbeitszeit erfasst.');
  if (!material.length) hinweise.push('Zu diesem Auftrag wurde kein Material erfasst.');
  if (!fotos.length) hinweise.push('Zu diesem Auftrag liegen keine Fotos vor.');

  return { auftrag: a, einsaetze, material, fotos, summen, zugewiesen, hinweise };
}

// Nummer für Anzeige und Dateiname. Aufträge aus der Zeit vor der
// Nummernvergabe haben keine — dann die Kurz-ID, damit nie „undefined" im
// Dokument steht.
export function serviceNummer(auftrag) {
  return (auftrag && auftrag.auftragsnummer) || `SA-${String((auftrag && auftrag.id) || '').slice(0, 8)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PDF
// ═══════════════════════════════════════════════════════════════════════════
export function buildServiceberichtPdf(daten, { branding, fotos } = {}) {
  const a = daten.auftrag;
  const marke = branding || null;
  const nr = serviceNummer(a);
  const blocks = [];

  // ── Zwei Kacheln: wo und wer/wann. Gleiche Sprache wie der Wochenbericht.
  const objekt = [a.objekt || '–'];
  if (a.beschreibung) objekt.push(String(a.beschreibung).slice(0, 300));

  const ausfuehrung = [];
  const daten_ = daten.einsaetze.map((e) => e.datum).filter(Boolean);
  if (daten_.length) {
    ausfuehrung.push(daten_[0] === daten_[daten_.length - 1]
      ? dmy(daten_[0])
      : `${dmy(daten_[0])} – ${dmy(daten_[daten_.length - 1])}`);
  } else {
    ausfuehrung.push('noch kein Einsatz erfasst');
  }
  const wer = daten.zugewiesen.length ? daten.zugewiesen : [...new Set(daten.einsaetze.map((e) => e.techniker))];
  if (wer.length) ausfuehrung.push(wer.join(' · '));
  ausfuehrung.push(`Status: ${STATUS_TEXT[a.status] || a.status}`);

  blocks.push({ t: 'tiles', items: [
    { label: 'Objekt', value: objekt.join('\n') },
    { label: 'Ausführung', value: ausfuehrung.join('\n') },
  ] });

  // ── Aufwand ──
  const s = daten.summen;
  blocks.push({ t: 'sp', size: 14 });
  blocks.push({ t: 'h1', text: 'Aufwand' });
  blocks.push({
    t: 'table',
    cols: [
      { w: 100, label: 'Stunden', align: 'right' }, { w: 80, label: 'Überzeit', align: 'right' },
      { w: 90, label: 'Spesen CHF', align: 'right' }, { w: 80, label: 'Einsätze', align: 'right' },
      { w: 90, label: 'Techniker', align: 'right' },
    ],
    rows: [[
      { text: h2(s.stunden), bold: true, size: 18, align: 'right' },
      { text: h2(s.ueberzeit), align: 'right' },
      { text: h2(s.spesen), bold: true, size: 14, align: 'right' },
      { text: String(s.einsaetze), align: 'right' },
      { text: String(s.techniker), align: 'right' },
    ]],
  });

  // ── Einsätze ──
  blocks.push({ t: 'h1', text: 'Ausgeführte Arbeiten' });
  if (!daten.einsaetze.length) {
    blocks.push({ t: 'text', text: 'Zu diesem Auftrag wurde noch keine Arbeitszeit erfasst.', size: 9, lead: 13 });
  }
  for (const e of daten.einsaetze) {
    blocks.push({ t: 'need', h: 90 });
    blocks.push({ t: 'h2', text: `${dmy(e.datum)} · ${e.techniker}` });
    blocks.push({
      t: 'table', size: 8.5, gap: 4,
      cols: [{ w: 70, label: 'Zeit' }, { w: 46, label: 'Std', align: 'right' },
        { w: 42, label: 'ÜZ', align: 'right' }, { w: 60, label: 'Gewerk' },
        { w: 263, label: 'Tätigkeiten' }],
      rows: [[
        e.von && e.bis ? `${e.von}–${e.bis}` : '—',
        { text: h2(e.stunden), align: 'right' },
        { text: e.ueberzeit ? h2(e.ueberzeit) : '—', align: 'right' },
        (e.stunden || e.ueberzeit) ? (e.gewerk || '—') : '—',
        e.arbeiten.join(' · ') || '—',
      ]],
    });
    if (e.notiz) blocks.push({ t: 'text', text: `Notiz: ${e.notiz}`, size: 8.5, lead: 12 });
  }

  // ── Material — bedingt, keine leere Überschrift ──
  if (daten.material.length) {
    blocks.push({ t: 'need', h: 90 });
    blocks.push({ t: 'h1', text: 'Material' });
    blocks.push({
      t: 'table', size: 8.5,
      cols: [{ w: 220, label: 'Bezeichnung' }, { w: 60, label: 'Menge', align: 'right' },
        { w: 73, label: 'Datum' }, { w: 130, label: 'Erfasst von' }],
      rows: daten.material.map((m) => [
        m.bezeichnung,
        { text: m.menge == null ? '—' : String(m.menge), align: 'right' },
        dmy(m.datum), m.techniker,
      ]),
    });
  }

  // ── Fotodokumentation — 2×2, steht auch ohne Bilder ──
  const bilder = (fotos || []).filter((f) => f && f.buf);
  blocks.push({ t: 'need', h: 120 });
  blocks.push({ t: 'h1', text: 'Fotodokumentation' });
  if (bilder.length) {
    const n = daten.fotos.length;
    blocks.push({ t: 'text', text: n > FOTOS_IM_PDF ? `${n} erfasst, ${FOTOS_IM_PDF} in diesem Bericht abgebildet` : `${n} erfasst`, size: 8.5, lead: 13 });
    blocks.push({
      t: 'imgrow', perRow: 2, maxH: 168, gap: 14,
      images: bilder.map((f) => f.buf),
      captions: bilder.map((f) => f.caption || ''),
    });
  } else {
    blocks.push({ t: 'text', text: 'Zu diesem Auftrag liegen keine Fotos vor.', size: 9, lead: 13 });
  }

  // ── Abschluss ──
  blocks.push({ t: 'need', h: 60 });
  blocks.push({ t: 'h1', text: 'Abschluss' });
  blocks.push({ t: 'kv', label: 'Status', value: STATUS_TEXT[a.status] || a.status });
  if (a.angenommen_am) blocks.push({ t: 'kv', label: 'Angenommen', value: dmy(String(a.angenommen_am).slice(0, 10)) });
  if (a.erledigt_am) blocks.push({ t: 'kv', label: 'Abgeschlossen', value: dmy(String(a.erledigt_am).slice(0, 10)) });
  if (a.ablehn_grund) blocks.push({ t: 'kv', label: 'Begründung', value: a.ablehn_grund });

  // ── Hinweise: was der Bericht NICHT weiss, steht drin ──
  const relevant = (daten.hinweise || []).filter((x) => !/keine Fotos/.test(x));
  if (relevant.length) {
    blocks.push({ t: 'h2', text: 'Hinweise zur Datenlage' });
    blocks.push({ t: 'sp', size: 2 });
    for (const x of relevant) blocks.push({ t: 'text', text: `• ${x}`, size: 8.5, lead: 14 });
  }

  blocks.push({ t: 'sp', size: 10 });
  blocks.push({
    t: 'text',
    text: `Erstellt ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${(marke && marke.firmenname) || 'George Solutions'} · automatisch aus dem Serviceauftrag erzeugt`,
    size: 7.5, lead: 11,
  });

  return buildPdf({
    style: 'brief',
    balance: true,
    branding: marke || undefined,
    title: 'Servicebericht',
    subtitle: `${nr} · ${a.objekt || ''}`.trim(),
    logo: (marke && marke.logo) || undefined,
    footer: nr,
    blocks,
  });
}

// Fotobytes laden — gleiche Deckelung und gleiche Fehlertoleranz wie im
// Wochenbericht: ein nicht ladbares Foto darf den Bericht nicht verhindern.
export async function ladeServiceFotos(fotos, max = FOTOS_IM_PDF) {
  const out = [];
  for (const f of (fotos || []).slice(0, max)) {
    try {
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${f.bucket || 'projektdateien'}/${f.path}`,
        { method: 'POST', headers: SB, body: JSON.stringify({ expiresIn: 300 }) });
      if (!r.ok) continue;
      const d = await r.json();
      const b = await fetch(SUPABASE_URL + '/storage/v1' + d.signedURL);
      if (!b.ok) continue;
      const buf = Buffer.from(await b.arrayBuffer());
      if (buf.length > 3 * 1024 * 1024) continue;
      const teile = [f.raum, f.notiz].filter(Boolean);
      out.push({ buf, caption: teile.join(' · ') || f.dateiname || '' });
    } catch (_) { /* nächstes Foto */ }
  }
  return out;
}

// Ein Aufruf, alles drin — so wie erzeugeBericht() beim Wochenbericht.
export async function erzeugeServicebericht(serviceAuftragId) {
  const daten = await sammleServicedaten(serviceAuftragId);
  const marke = await ladeBranding({ partnerId: daten.auftrag.partner_user_id || null });
  const fotos = await ladeServiceFotos(daten.fotos);
  const pdf = buildServiceberichtPdf(daten, { branding: marke, fotos });
  return {
    daten,
    pdf,
    nummer: serviceNummer(daten.auftrag),
    fotos_im_pdf: fotos.length,
    branding: { firmenname: marke.firmenname, akzentfarbe: marke.akzentfarbe, aus_tabelle: marke.aus_tabelle },
  };
}
