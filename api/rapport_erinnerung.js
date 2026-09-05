// api/rapport_erinnerung.js — Erinnerung an unvollständige Rapporte.
//
// Läuft stündlich als Cron (vercel.json). Sucht Tageszeilen, denen Angaben
// fehlen, und schickt der erfassenden Person nach 24 und nach 48 Stunden je
// eine Mail. Danach nichts mehr — eine dritte Mail liest niemand.
//
// Der Mailtext steht je Betrieb in gs_branding.rapport_erinnerung_text; fehlt
// er, gilt der neutrale Standard aus lib/erinnerung.js.
//
// SICHERHEIT: der Endpunkt schreibt nur Zeitstempel und verschickt Mails. Er
// ist wie api/blockaden.js für den Vercel-Cron offen; ein Aufruf von aussen
// kann nichts auslösen, was der Cron nicht ohnehin täte, und mehrfaches
// Aufrufen ist wirkungslos (die gesetzten Zeitstempel verhindern Wiederholung).
//
// Für Tests exportiert: `laufErinnerungen({ jetzt, sendMail })` — mit
// injizierbarer Uhr und injizierbarem Mailversand, damit der Ablauf offline
// und deterministisch prüfbar ist.
import { sendResendEmail } from '../lib/mail.js';
import {
  rapportLuecken, faelligeStufe, alterStunden, erinnerungText,
  STANDARD_ERINNERUNG_TEXT, GRUND_TEXT,
} from '../lib/erinnerung.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const ABSENDER = 'George Solutions <info@george-solutions.ch>';

// Weiter zurück als 14 Tage wird nicht erinnert. Was so lange liegt, ist ein
// Fall für das Cockpit und nicht mehr für eine Mail.
const MAX_ALTER_STUNDEN = 14 * 24;

async function sbGet(pfad) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pfad}`, { headers: SB });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.json();
}
const sbSoft = (pfad, fallback) => sbGet(pfad).catch(() => fallback);

export default async function handler(req, res) {
  // Fingerabdruck unseres Handlers (gleich wie api/blockaden.js): der
  // Smoke-Test erkennt an Access-Control-Allow-Origin, dass wirklich unser
  // Code geantwortet hat und nicht ein Proxy oder eine Fehlerseite.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  // Methoden-Wache. OHNE sie wuerde schon der Smoke-Test (OPTIONS auf jeden
  // Endpunkt, scripts/smoke_api.mjs) einen echten Erinnerungslauf ausloesen
  // und Mails verschicken. Genau diese Falle steckt heute in api/bob-learn.js,
  // weshalb der Smoke-Test ihn ueberspringen muss.
  if (req.method === 'OPTIONS' || req.method === 'HEAD') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });
  try {
    const r = await laufErinnerungen({ sendMail: sendResendEmail });
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.error('Rapport-Erinnerung:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Die offenen Rapporte einsammeln — auch für die Master-Liste benutzt.
// ═══════════════════════════════════════════════════════════════════════════
// `nurUser` grenzt auf eine Person ein (wird von der Cockpit-Liste nicht
// gebraucht, hilft aber beim Nachstellen eines Einzelfalls).
export async function sammleUnvollstaendige({ jetzt = null, nurUser = null } = {}) {
  const grenze = new Date((jetzt ? new Date(jetzt).getTime() : Date.now()) - MAX_ALTER_STUNDEN * 3600000)
    .toISOString();
  const f = [`created_at=gte.${grenze}`, 'abwesenheit=is.null'];
  if (nurUser) f.push(`erfasst_von=eq.${nurUser}`);
  const zeilen = await sbSoft(
    `gs_tagesrapporte?${f.join('&')}&select=id,datum,projekt_id,service_auftrag_id,techniker_user_id,erfasst_von,`
    + 'gesamtstunden,start_zeit,end_zeit,arbeiten,besonderheiten,abwesenheit,created_at,'
    + 'erinnerung_24_am,erinnerung_48_am&order=created_at.asc',
    null,
  );
  // Fehlen die Erinnerungsspalten, ist scripts/rapport_feld.sql nicht gelaufen.
  // Dann wird das GESAGT statt „nichts gefunden" gemeldet.
  if (zeilen === null) {
    const roh = await sbSoft(
      'gs_tagesrapporte?select=id&limit=1', null,
    );
    return {
      offen: [], jeperson: [], notMigrated: roh !== null,
      hinweis: roh !== null
        ? 'Die Spalten erinnerung_24_am/erinnerung_48_am fehlen — scripts/rapport_feld.sql ist noch nicht gelaufen.'
        : 'Die Tageszeilen konnten nicht gelesen werden.',
    };
  }

  const projIds = [...new Set(zeilen.map((z) => z.projekt_id).filter(Boolean))];
  const projekte = {};
  if (projIds.length) {
    for (const p of await sbSoft(`gs_projekte?id=in.(${projIds.join(',')})&select=id,name,projektnummer,unvollstaendig`, [])) {
      projekte[p.id] = p;
    }
  }
  // Katalog-Tätigkeiten zählen als Beschreibung — ohne sie hielte eine Zeile,
  // die per Chips erfasst wurde, fälschlich für leer.
  const zIds = zeilen.map((z) => z.id);
  const katalog = {};
  if (zIds.length) {
    for (const t of await sbSoft(`gs_tagesrapport_taetigkeitenkatalog?tagesrapport_id=in.(${zIds.join(',')})&select=tagesrapport_id`, [])) {
      katalog[t.tagesrapport_id] = (katalog[t.tagesrapport_id] || 0) + 1;
    }
  }
  const uIds = [...new Set(zeilen.map((z) => z.erfasst_von || z.techniker_user_id).filter(Boolean))];
  const personen = {};
  if (uIds.length) {
    for (const t of await sbSoft(`gs_techniker?user_id=in.(${uIds.join(',')})&select=user_id,name,email`, [])) {
      personen[t.user_id] = t;
    }
  }

  const offen = [];
  for (const z of zeilen) {
    const p = z.projekt_id ? projekte[z.projekt_id] : null;
    const gruende = rapportLuecken({ ...z, taetigkeiten_anzahl: katalog[z.id] || 0 }, p);
    if (!gruende.length) continue;
    const uid = z.erfasst_von || z.techniker_user_id || null;
    const person = uid ? personen[uid] : null;
    offen.push({
      id: z.id,
      datum: z.datum,
      projekt_id: z.projekt_id,
      baustelle: p ? [p.projektnummer, p.name].filter(Boolean).join(' · ') : (z.service_auftrag_id ? 'Serviceauftrag' : 'Ohne Baustelle'),
      person_user_id: uid,
      person: (person && person.name) || 'Unbekannt',
      email: (person && person.email) || null,
      created_at: z.created_at,
      alter_stunden: alterStunden(z, jetzt),
      gruende,
      gruende_text: gruende.map((g) => GRUND_TEXT[g] || g),
      erinnerung_24_am: z.erinnerung_24_am || null,
      erinnerung_48_am: z.erinnerung_48_am || null,
      faellige_stufe: faelligeStufe(z, jetzt),
    });
  }
  offen.sort((a, b) => b.alter_stunden - a.alter_stunden);

  // Nach Person gruppiert — so wird auch versendet: EINE Mail je Person mit
  // allen ihren offenen Rapporten, nicht eine Mail je Zeile.
  const map = new Map();
  for (const o of offen) {
    const key = o.person_user_id || '?';
    const g = map.get(key) || { user_id: o.person_user_id, person: o.person, email: o.email, zeilen: [] };
    g.zeilen.push(o);
    map.set(key, g);
  }
  return { offen, jeperson: [...map.values()], notMigrated: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// Der eigentliche Lauf
// ═══════════════════════════════════════════════════════════════════════════
export async function laufErinnerungen({ jetzt = null, sendMail = null } = {}) {
  const senden = sendMail || sendResendEmail;
  const { offen, jeperson, notMigrated, hinweis } = await sammleUnvollstaendige({ jetzt });
  if (notMigrated) return { versendet: 0, uebersprungen: 0, offen: 0, notMigrated: true, hinweis };

  const vorlage = await ladeErinnerungVorlage();

  let versendet = 0, uebersprungen = 0;
  const protokoll = [];
  for (const g of jeperson) {
    // Nur die Zeilen, für die JETZT eine Stufe fällig ist. Die übrigen stehen
    // in der Master-Liste, aber sie lösen keine Mail aus.
    const faellig = g.zeilen.filter((z) => z.faellige_stufe);
    if (!faellig.length) continue;
    if (!g.email) {
      uebersprungen += faellig.length;
      protokoll.push({ person: g.person, stufe: null, ok: false, grund: 'keine E-Mail-Adresse hinterlegt' });
      continue;
    }
    // Die höchste fällige Stufe bestimmt den Betreff — 48 ist die zweite und
    // letzte Erinnerung, und das soll dranstehen.
    const stufe = faellig.some((z) => z.faellige_stufe === 48) ? 48 : 24;
    const text = erinnerungText({ vorlage, name: vornameVon(g.person), zeilen: faellig, jetzt });
    const betreff = stufe === 48
      ? `Zweite Erinnerung: ${faellig.length} Rapport${faellig.length === 1 ? '' : 'e'} unvollständig`
      : `Erinnerung: ${faellig.length} Rapport${faellig.length === 1 ? '' : 'e'} unvollständig`;

    const r = await senden({ to: g.email, from: ABSENDER, subject: betreff, html: alsHtml(text) });
    const ok = !!(r && r.ok !== false);
    protokoll.push({ person: g.person, email: g.email, stufe, anzahl: faellig.length, ok, grund: ok ? null : ((r && r.error) || 'Versand fehlgeschlagen') });
    if (!ok) { uebersprungen += faellig.length; continue; }
    versendet += 1;

    // Zeitstempel je Zeile setzen — und zwar genau die Stufe, die für DIESE
    // Zeile fällig war. Sonst bekäme eine Zeile, die erst bei 25 Stunden
    // gefunden wurde, ihre 48er-Erinnerung nie.
    const feld24 = faellig.filter((z) => z.faellige_stufe === 24).map((z) => z.id);
    const feld48 = faellig.filter((z) => z.faellige_stufe === 48).map((z) => z.id);
    const stempel = (jetzt ? new Date(jetzt) : new Date()).toISOString();
    if (feld24.length) await patch(feld24, { erinnerung_24_am: stempel });
    // Eine Zeile, die die 24er-Stufe übersprungen hat (erst nach 50 Stunden
    // gefunden), bekommt beide Stempel: die erste Erinnerung ist damit
    // erledigt, ohne dass je eine zweite Mail hinterherliefe.
    if (feld48.length) await patch(feld48, { erinnerung_24_am: stempel, erinnerung_48_am: stempel });
  }
  return { versendet, uebersprungen, offen: offen.length, protokoll };
}

async function patch(ids, felder) {
  await fetch(`${SUPABASE_URL}/rest/v1/gs_tagesrapporte?id=in.(${ids.join(',')})`, {
    method: 'PATCH', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(felder),
  }).catch(() => {});
}

export async function ladeErinnerungVorlage(partnerId = null) {
  const filter = partnerId ? `&or=(partner_id.eq.${partnerId},partner_id.is.null)` : '&partner_id=is.null';
  const rows = await sbSoft(`gs_branding?aktiv=is.true${filter}&select=partner_id,rapport_erinnerung_text`, []);
  const liste = Array.isArray(rows) ? rows : [];
  const treffer = (partnerId && liste.find((x) => x.partner_id === partnerId)) || liste.find((x) => !x.partner_id) || null;
  const text = treffer && String(treffer.rapport_erinnerung_text || '').trim();
  return text || STANDARD_ERINNERUNG_TEXT;
}

function vornameVon(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'zusammen';
}

// Klartext → schlichtes HTML. Kein Layout, keine Farben: das ist eine
// Erinnerung an einen Kollegen, kein Kundendokument.
function alsHtml(text) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#111">'
    + esc(text).split('\n').map((z) => (z.trim() ? `<p style="margin:0 0 10px">${z}</p>` : '<div style="height:8px"></div>')).join('')
    + '</div>';
}
