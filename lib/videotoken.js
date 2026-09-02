// lib/videotoken.js — signierte, befristete Verweise auf EIN Video.
//
// Der Wochenbericht geht an Bauleiter, die keinen Zugang zur Software haben.
// Ein Link im PDF muss also ohne Anmeldung funktionieren — und darf trotzdem
// nicht zum Generalschlüssel werden. Deshalb:
//
//   • der Token nennt GENAU EIN Medium (medien_id), nichts sonst
//   • er läuft nach 30 Tagen ab
//   • er ist mit HMAC-SHA256 signiert; ein geändertes Zeichen macht ihn
//     ungültig, und aus einem gültigen Token lässt sich kein zweiter für ein
//     anderes Video ableiten
//
// Das Geheimnis kommt aus VIDEO_TOKEN_SECRET. Fehlt die Variable, wird der
// Supabase-Service-Key benutzt — nicht schön, aber besser als ein fest
// eingebautes Geheimnis, und es funktioniert ohne neue Env-Variable. Wird
// VIDEO_TOKEN_SECRET später gesetzt, werden alle bis dahin verteilten Links
// ungültig; das ist gewollt und steht hier, damit es niemanden überrascht.
//
// ESM wie alles in lib/ — kein import.meta.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const VIDEO_TOKEN_TAGE = 30;

function geheimnis() {
  return process.env.VIDEO_TOKEN_SECRET
    || process.env.SUPABASE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || '';
}

const b64u = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uDec = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function signatur(rumpf) {
  return b64u(createHmac('sha256', geheimnis()).update(rumpf).digest());
}

// medienId → Token. `jetzt` nur für Tests.
export function videoTokenErzeugen(medienId, jetzt) {
  if (!medienId) throw new Error('medien_id nötig');
  const basis = jetzt ? new Date(jetzt).getTime() : Date.now();
  const nutz = { m: String(medienId), exp: Math.floor((basis + VIDEO_TOKEN_TAGE * 86400000) / 1000) };
  const rumpf = b64u(JSON.stringify(nutz));
  return `${rumpf}.${signatur(rumpf)}`;
}

// Token → { ok:true, medien_id, exp } oder { ok:false, grund }.
// `grund` ist absichtlich grob ('ungueltig' / 'abgelaufen'): eine genauere
// Auskunft hülfe nur beim Probieren.
export function videoTokenPruefen(token, jetzt) {
  const t = String(token || '');
  const teile = t.split('.');
  if (teile.length !== 2 || !teile[0] || !teile[1]) return { ok: false, grund: 'ungueltig' };
  const [rumpf, sig] = teile;

  // Zeitkonstanter Vergleich: ein Vergleich mit === verrät über die Laufzeit,
  // wie viele Zeichen stimmen.
  const soll = Buffer.from(signatur(rumpf));
  const ist = Buffer.from(sig);
  if (soll.length !== ist.length || !timingSafeEqual(soll, ist)) return { ok: false, grund: 'ungueltig' };

  let nutz;
  try { nutz = JSON.parse(b64uDec(rumpf).toString('utf8')); } catch { return { ok: false, grund: 'ungueltig' }; }
  if (!nutz || !nutz.m || !nutz.exp) return { ok: false, grund: 'ungueltig' };

  const now = Math.floor((jetzt ? new Date(jetzt).getTime() : Date.now()) / 1000);
  if (now > Number(nutz.exp)) return { ok: false, grund: 'abgelaufen', medien_id: String(nutz.m) };

  return { ok: true, medien_id: String(nutz.m), exp: Number(nutz.exp) };
}

// Der Link, der im PDF steht. Die Basis-URL steht in GS_BASE_URL, sonst die
// bekannte Adresse — ein relativer Link taugt in einem PDF nicht.
export function videoLink(medienId, jetzt) {
  const basis = (process.env.GS_BASE_URL || 'https://baby-bob.vercel.app').replace(/\/+$/, '');
  return `${basis}/v/${videoTokenErzeugen(medienId, jetzt)}`;
}
