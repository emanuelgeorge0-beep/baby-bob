// api/videolink.js — ein Video hinter /v/<token> ausliefern.
//
// Zwei Wege zu demselben Video, und beide enden auf derselben Seite:
//
//   1. MIT gültigem Token (aus dem PDF). Der Token nennt genau EIN Medium und
//      läuft nach 30 Tagen ab. Keine Anmeldung nötig — der Bauleiter, der den
//      Bericht bekommen hat, soll das Video ansehen können, ohne einen Zugang
//      zu haben.
//
//   2. OHNE gültigen Token (abgelaufen, verstümmelt, weitergeleitet). Dann
//      entscheidet die normale Berechtigung: Master sieht alles, ein Partner
//      nur Medien SEINER Projekte, ein Techniker nur Medien der ihm
//      zugewiesenen Projekte. Wer nicht angemeldet ist, meldet sich AUF DER
//      SEITE an (v.html) und bleibt dabei auf /v/<token> — es gibt keinen
//      Sprung auf die Startseite und keinen Rückweg, den man verlieren kann.
//
// Die bestehenden Sichtbarkeitsregeln gelten unverändert: dieser Endpunkt
// erfindet keine, er benutzt dieselbe Kette wie das Cockpit.
//
// Ausgeliefert wird NIE die Datei selbst, sondern eine signierte Storage-URL
// mit kurzer Laufzeit. Der Bucket ist privat (am 03.09.2026 geprüft: alle
// sechs Buckets stehen auf public=false).
import { videoTokenPruefen } from '../lib/videotoken.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Wie lange die ausgelieferte Storage-URL gilt. Kurz: sie ist zum Ansehen da,
// nicht zum Weitergeben. Der Token im PDF ist der lange Teil, nicht diese URL.
const SIGN_SEKUNDEN = 3600;

async function sbGet(pfad) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pfad}`, { headers: SB });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
const sbSoft = (pfad, fallback) => sbGet(pfad).catch(() => fallback);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  const b = req.body || {};
  const token = String(b.token || '').trim();
  const authToken = (req.headers.authorization || '').replace('Bearer ', '').trim();

  try {
    const r = await videoAufloesen({ token, authToken });
    if (r.error) return res.status(r.status || 403).json({ error: r.error, anmeldung_noetig: !!r.anmeldung_noetig });
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.error('Videolink:', e.message);
    return res.status(500).json({ error: 'Serverfehler' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Die Auflösung — für Tests exportiert.
// ═══════════════════════════════════════════════════════════════════════════
export async function videoAufloesen({ token, authToken, jetzt = null }) {
  const geprueft = videoTokenPruefen(token, jetzt);

  // Ohne gültigen Token brauchen wir eine Identität. Der Token nennt aber auch
  // im abgelaufenen Fall noch, WELCHES Video gemeint war — sonst könnte ein
  // Angemeldeter mit einem alten Link gar nichts mehr anfangen.
  let medienId = geprueft.medien_id || null;
  if (!geprueft.ok && !medienId) {
    return { error: 'Dieser Link ist ungültig.', status: 400, grund: 'ungueltig' };
  }
  if (!UUID_RE.test(String(medienId || ''))) {
    return { error: 'Dieser Link ist ungültig.', status: 400, grund: 'ungueltig' };
  }

  const rows = await sbSoft(`gs_projekt_medien?id=eq.${medienId}&select=*&limit=1`, []);
  const m = (rows || [])[0];
  // Bewusst dieselbe Meldung wie bei einem ungültigen Token: ob eine bestimmte
  // id existiert, geht einen Fremden nichts an.
  if (!m) return { error: 'Dieser Link ist ungültig.', status: 404, grund: 'ungueltig' };
  if (m.medientyp !== 'video') return { error: 'Dieser Link führt nicht zu einem Video.', status: 400 };

  let weg = 'token';
  if (!geprueft.ok) {
    // Abgelaufen (oder verstümmelt, aber mit lesbarer id) → jetzt entscheidet
    // die Anmeldung.
    const user = authToken ? await holeUser(authToken) : null;
    if (!user) {
      return {
        error: geprueft.grund === 'abgelaufen'
          ? 'Dieser Link ist abgelaufen (30 Tage). Bitte melde dich an, um das Video zu sehen.'
          : 'Dieser Link ist ungültig. Bitte melde dich an, um das Video zu sehen.',
        status: 401, anmeldung_noetig: true, grund: geprueft.grund,
      };
    }
    const darf = await darfMedium(user.id, m);
    if (!darf) return { error: 'Für dieses Video fehlt die Berechtigung.', status: 403 };
    weg = 'anmeldung';
  }

  const url = await signUrl(m.bucket || 'projektdateien', m.path);
  if (!url) return { error: 'Das Video konnte nicht geladen werden.', status: 502 };
  const thumb = m.thumbnail_path ? await signUrl(m.bucket || 'projektdateien', m.thumbnail_path) : null;

  const projekt = m.projekt_id
    ? ((await sbSoft(`gs_projekte?id=eq.${m.projekt_id}&select=name,projektnummer&limit=1`, []))[0] || null)
    : null;

  return {
    weg,
    video: {
      id: m.id,
      url,
      thumbnail_url: thumb,
      mime: m.mime || 'video/mp4',
      dateiname: m.dateiname || 'Video',
      dauer_sekunden: m.dauer_sekunden || null,
      ort: [m.stockwerk, m.wohnung, m.raum, m.bauabschnitt].filter(Boolean).join(' · ') || null,
      notiz: m.notiz || null,
      projekt: projekt ? [projekt.projektnummer, projekt.name].filter(Boolean).join(' · ') : null,
    },
  };
}

// ── Berechtigung: dieselbe Kette wie im Cockpit, nichts Neues ────────────
async function darfMedium(userId, m) {
  const rollen = new Set();
  for (const r of await sbSoft(`user_roles?user_id=eq.${userId}&select=role&limit=1`, [])) if (r.role) rollen.add(r.role);
  for (const r of await sbSoft(`user_extra_roles?user_id=eq.${userId}&select=role`, [])) if (r.role) rollen.add(r.role);
  if (rollen.has('master') || rollen.has('gs_admin')) return true;

  if (m.projekt_id) {
    // Partner: nur EIGENE Projekte (partner_user_id).
    if (rollen.has('gs_partner')) {
      const p = await sbSoft(`gs_projekte?id=eq.${m.projekt_id}&select=partner_user_id&limit=1`, []);
      if (p[0] && p[0].partner_user_id === userId) return true;
    }
    // Techniker: nur ZUGEWIESENE Projekte, über gs_techniker.id.
    if (rollen.has('techniker')) {
      const t = await sbSoft(`gs_techniker?user_id=eq.${userId}&select=id&limit=1`, []);
      const tid = t[0] && t[0].id;
      if (tid) {
        const z = await sbSoft(`gs_projekt_techniker?projekt_id=eq.${m.projekt_id}&techniker_id=eq.${tid}&select=projekt_id&limit=1`, []);
        if (z[0]) return true;
      }
    }
  }
  return false;
}

async function holeUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

async function signUrl(bucket, path) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, {
    method: 'POST', headers: SB, body: JSON.stringify({ expiresIn: SIGN_SEKUNDEN }),
  });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return d.signedURL ? SUPABASE_URL + '/storage/v1' + d.signedURL : null;
}
