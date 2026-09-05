// api/smoke_wache.js — Taegliche Wache ueber die eigenen API-Funktionen.
//
// Laeuft als Cron (vercel.json). Prueft jeden Endpunkt aus lib/smoke.js mit
// OPTIONS und schickt EINE Mail — aber nur, wenn etwas rot ist. Ein gruener
// Lauf meldet sich nicht. Eine taegliche "alles in Ordnung"-Mail liest nach
// drei Tagen niemand mehr, und dann faellt die vierte auch nicht auf, wenn
// sie fehlt.
//
// Es ist derselbe Lauf wie `node scripts/smoke_api.mjs` — beide benutzen
// lib/smoke.js, es gibt keine zweite Pruefung mit eigenen Regeln.
//
// Empfaenger: SMOKE_MAIL_TO (Komma-Liste erlaubt). Ohne die Variable wird
// nicht verschickt, sondern nur berichtet — kein Empfaenger im Code.
// Versand: lib/mail.js (Resend), derselbe Weg wie ueberall sonst.
//
// SICHERHEIT: der Endpunkt schreibt nichts. Er verschickt eine Mail an eine
// fest konfigurierte Adresse — nicht an eine aus der Anfrage. Ist CRON_SECRET
// gesetzt, verlangt er es (wie api/bob-learn.js).
import { sendResendEmail } from '../lib/mail.js';
import { laufSmoke, berichtHtml, ENDPUNKTE } from '../lib/smoke.js';

const CRON_SECRET = process.env.CRON_SECRET;
const ABSENDER = 'George Solutions <info@george-solutions.ch>';
// Fallback nur, falls kein Host mitkommt (Cron liefert ihn).
const STANDARD_BASIS = 'https://baby-bob.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  // Methoden-Wache. OHNE sie wuerde der Smoke-Test sich beim Pruefen selbst
  // ausloesen — 30 Anfragen und womoeglich eine Mail, bei jedem Lauf.
  if (req.method === 'OPTIONS' || req.method === 'HEAD') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const r = await lauf({ basis: basisVon(req) });
    return res.status(200).json(r);
  } catch (e) {
    console.error('Smoke-Wache:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// Fuer Tests exportiert: injizierbarer Mailversand, damit der ganze Ablauf
// offline und ohne echte Mail pruefbar ist.
export async function lauf({ basis = STANDARD_BASIS, sendMail = null, empfaenger = null } = {}) {
  const senden = sendMail || sendResendEmail;
  const { zeilen, rot, ausgelassen } = await laufSmoke({ basis, timeoutMs: 8000 });

  const ergebnis = {
    ok: rot.length === 0,
    geprueft: zeilen.length,
    rot: rot.map((z) => ({ name: z.name, status: z.status, anmerkung: z.anmerkung })),
    ausgelassen: ausgelassen.map((a) => a.name),
    basis,
  };

  // Gruen = Ruhe. Keine Mail, kein Rauschen.
  if (!rot.length) return { ...ergebnis, gemeldet: false, grund: 'alles gruen' };

  const to = (empfaenger || process.env.SMOKE_MAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!to.length) {
    console.warn('[smoke_wache] rot, aber SMOKE_MAIL_TO ist nicht gesetzt — keine Meldung verschickt.');
    return { ...ergebnis, gemeldet: false, grund: 'SMOKE_MAIL_TO nicht gesetzt' };
  }

  const betreff = rot.length === 1
    ? `API-Wache: /api/${rot[0].name} antwortet nicht`
    : `API-Wache: ${rot.length} von ${zeilen.length} Funktionen antworten nicht`;
  const r = await senden({ to, from: ABSENDER, subject: betreff, html: berichtHtml({ basis, zeilen, rot, ausgelassen }) });
  const ok = !!(r && r.ok !== false);
  if (!ok) console.error('[smoke_wache] Meldung konnte nicht verschickt werden:', (r && r.error) || 'unbekannt');
  return { ...ergebnis, gemeldet: ok, empfaenger: to, betreff, grund: ok ? null : ((r && r.error) || 'Versand fehlgeschlagen') };
}

function basisVon(req) {
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return STANDARD_BASIS;
  const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${proto}://${host}`;
}

// Damit ein Blick in den Code reicht, um zu sehen, was geprueft wird.
export const GEPRUEFTE_ENDPUNKTE = ENDPUNKTE;
