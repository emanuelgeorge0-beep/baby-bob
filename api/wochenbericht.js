// api/wochenbericht.js — Wochenbericht (Projekt × KW) für den Bauleiter.
//
// Zweites, eigenes Dokument neben dem Wochenrapport (Techniker × Woche). Der
// Wochenrapport wird hier NICHT angefasst; gs_tagesrapporte wird ausschliesslich
// gelesen, insbesondere bleibt das Altfeld gs_tagesrapporte.status unberührt.
//
// Aktionen:
//   vorschau  — Daten einsammeln, nichts schreiben (Cockpit-Ansicht)
//   pdf       — PDF erzeugen, Kopf anlegen falls nötig, als base64 zurück
//   versenden — PDF + Begleitmail an die Empfänger, Snapshot einfrieren,
//               Versand protokollieren
//   liste     — bisherige Berichte eines Projekts
//
// Alle DB-Zugriffe laufen über den Service-Key; die Rollenprüfung erzwingt
// diese API in der Anwendungsschicht (RLS ist Defense-in-Depth, siehe
// scripts/wochenbericht.sql).
import { sendResendEmail, wochenberichtEmailHtml } from '../lib/mail.js';
import {
  sammleWochendaten, erzeugeBericht, versendeBericht, isoWocheVonDatum,
  erzeugeFotodoku, fotodokuVorschau,
} from '../lib/wochenbericht.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const b = req.body || {};
  try {
    // Zeitraum: entweder jahr+woche direkt, oder ein Datum, aus dem die ISO-KW
    // abgeleitet wird (bequemer fürs Cockpit, gleiche Wahrheit).
    const { jahr, woche, fehler } = zeitraum(b);
    if (b.action !== 'liste' && fehler) return res.status(400).json({ error: fehler });

    const projektId = String(b.projekt_id || '').trim();
    if (!UUID_RE.test(projektId)) return res.status(400).json({ error: 'projekt_id (UUID) erforderlich' });

    // Serviceabteilung ist nicht gebaut — ehrlich ablehnen statt leer liefern.
    if (b.quelle === 'service') {
      return res.status(400).json({ error: 'Die Serviceabteilung ist noch nicht gebaut. Wochenberichte gibt es derzeit nur für Projekte.' });
    }

    const darf = await darfProjekt(projektId, user.id, role);
    if (!darf) return res.status(403).json({ error: 'Keine Berechtigung für dieses Projekt' });

    switch (b.action) {
      case 'vorschau': {
        const daten = await sammleWochendaten({ quelle: 'projekt', projektId, jahr, woche });
        return res.status(200).json({ ok: true, daten });
      }
      case 'pdf': {
        const r = await erzeugeBericht({ projektId, jahr, woche, userId: user.id });
        return res.status(200).json({
          ok: true,
          bericht: ohnePdfDaten(r.bericht),
          filename: `${r.bericht.bericht_nr}.pdf`.replace(/[^\w.-]+/g, '_'),
          pdf_base64: Buffer.from(r.pdf).toString('base64'),
          aus_snapshot: r.aus_snapshot,
          fotos_im_pdf: r.fotos_im_pdf,
          hinweise: r.daten.hinweise,
        });
      }
      case 'versenden': {
        // Versenden ist Chefsache: es verlässt das Haus und friert den Bericht ein.
        if (role !== 'gs_admin' && role !== 'master') {
          return res.status(403).json({ error: 'Nur Master/Admin darf einen Wochenbericht versenden.' });
        }
        const r = await versendeBericht({
          projektId, jahr, woche, userId: user.id,
          empfaenger: b.empfaenger,
          sendMail: sendResendEmail,
          mailHtml: wochenberichtEmailHtml,
          betreff: b.betreff,
        });
        return res.status(200).json({
          ok: r.ok, versendet: r.versendet,
          bericht: ohnePdfDaten(r.bericht),
          empfaenger: r.empfaenger, empfaenger_herkunft: r.empfaenger_herkunft,
          pdf_path: r.pdf_path, fotos_im_pdf: r.fotos_im_pdf,
          protokolliert: r.protokolliert, protokoll_hinweis: r.protokoll_hinweis,
          hinweise: r.daten ? r.daten.hinweise : [],
          error: r.error,
        });
      }
      // ── Fotodokumentation ──────────────────────────────────────────────
      // Eigenes Dokument, gleicher Motor: beide bauen auf sammleWochendaten
      // auf, es gibt keine zweite Medienabfrage. 'fotodoku_vorschau' liefert
      // nur die Liste (keine Bytes), damit vor dem Erzeugen sichtbar ist, was
      // hineinkommt — ohne Editor und ohne Umsortieren.
      case 'fotodoku_vorschau': {
        const v = await fotodokuVorschau({ projektId, jahr, woche });
        return res.status(200).json({ ok: true, vorschau: v });
      }
      case 'fotodoku': {
        const r = await erzeugeFotodoku({ projektId, jahr, woche });
        return res.status(200).json({
          ok: true,
          filename: `Fotodokumentation_${r.nr}.pdf`.replace(/[^\w.-]+/g, '_'),
          pdf_base64: Buffer.from(r.pdf).toString('base64'),
          abgebildet: r.abgebildet,
          erfasst: (r.daten.fotos || []).length + (r.daten.fotos_ohne_tag || []).length,
          hinweise: r.daten.hinweise,
        });
      }
      case 'liste': {
        const rows = await sbGet(
          `gs_wochenberichte?projekt_id=eq.${projektId}&select=id,jahr,woche,bericht_nr,status,versendet_am,empfaenger,pdf_path,created_at`
          + '&order=jahr.desc,woche.desc&limit=104',
        );
        return res.status(200).json({ ok: true, berichte: rows });
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    // Migration noch nicht gelaufen → klare Ansage statt 500 (Muster wie überall).
    if (/gs_wochenberichte|kuerzel|PGRST205|schema cache|does not exist/i.test(err.message || '')) {
      return res.status(200).json({
        error: 'Wochenbericht-Tabellen noch nicht migriert – scripts/wochenbericht.sql im Supabase-SQL-Editor ausführen.',
        notMigrated: true,
      });
    }
    console.error('Wochenbericht error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// Der Snapshot in `daten` ist gross und gehört nicht in jede Antwort.
function ohnePdfDaten(row) {
  if (!row) return row;
  const { daten, ...rest } = row;
  return { ...rest, hat_snapshot: !!daten };
}

function zeitraum(b) {
  if (b.datum) {
    const { woche, jahr } = isoWocheVonDatum(String(b.datum).slice(0, 10));
    if (!woche) return { fehler: 'datum ungültig (YYYY-MM-DD)' };
    return { jahr, woche };
  }
  const jahr = Number(b.jahr), woche = Number(b.woche);
  if (!Number.isInteger(jahr) || jahr < 2000 || jahr > 2999) return { fehler: 'jahr erforderlich' };
  if (!Number.isInteger(woche) || woche < 1 || woche > 53) return { fehler: 'woche (1–53) erforderlich' };
  return { jahr, woche };
}

// Master/Admin dürfen alles. Ein Partner nur seine eigenen Projekte —
// gs_projekte.partner_user_id ist die Eigentümerspalte, dieselbe, auf der auch
// das Partner-Cockpit scoped. Techniker haben hier nichts verloren: der
// Wochenbericht ist die Projektsicht auf ALLE Kollegen, nicht die eigene Woche.
async function darfProjekt(projektId, userId, role) {
  if (role === 'gs_admin' || role === 'master') return true;
  if (role !== 'gs_partner') return false;
  const rows = await sbGet(`gs_projekte?id=eq.${projektId}&select=partner_user_id&limit=1`).catch(() => []);
  return !!(rows[0] && rows[0].partner_user_id === userId);
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SB });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function getUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}
async function getRole(userId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&select=role&limit=1`, { headers: SB });
  if (!r.ok) return 'bob_user';
  return (await r.json())[0]?.role || 'bob_user';
}
