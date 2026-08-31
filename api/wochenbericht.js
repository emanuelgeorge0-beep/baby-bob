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
  erzeugeWochenrapport, isoWochenBereich,
  empfaengerFuer, EMPFAENGER_HERKUNFT_TEXT,
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
    //
    // NICHT jede Aktion wird über einen Zeitraum adressiert. 'liste' hängt am
    // Projekt, 'wochen_projekte' am Wochenrapport — und dessen Kopf TRÄGT Jahr
    // und Woche selbst, wochenProjekte() liest sie von dort und gibt sie zurück.
    // Solange die Pflichtprüfung auch für diese Aktion galt, scheiterte der
    // Knopf „Wochenbericht" in der Wochenrapport-Liste mit „jahr erforderlich",
    // bevor er den Wochenrapport überhaupt aufgeschlagen hatte. Die Angabe zu
    // verlangen, wäre eine Pflicht ohne Verwendung.
    const OHNE_ZEITRAUM = ['liste', 'wochen_projekte'];
    const { jahr, woche, fehler } = zeitraum(b);
    if (!OHNE_ZEITRAUM.includes(b.action) && fehler) return res.status(400).json({ error: fehler });

    // ── Sammelmaske: Kunde x KW ────────────────────────────────────────────
    // Diese beiden Aktionen haengen NICHT an einem Projekt und stehen deshalb
    // vor der projekt_id-Pruefung. Beide sind Master-Sache: die Sammelvorschau
    // zaehlt ueber alle Projekte eines Kunden, das Stundenblatt gehoert einem
    // Techniker. Ein Partner haette an beidem nichts verloren.
    // ── Fotodokumentation ──────────────────────────────────────────────────
    // Steht VOR der projekt_id-Pruefung: seit Ziel 4 ist die Fotodokumentation
    // wochenbezogen und laeuft ueber ALLE Projekte einer Woche
    // (wochenrapport_id). Ein einzelnes Projekt ist nur noch ein Zusatzfilter.
    //
    // Geliefert werden signierte URLs, KEIN base64: ein PDF mit zehn Fotos war
    // 6.72 MB, als base64 8.96 MB — Vercel deckelt den Antwortkoerper bei
    // 4.5 MB. Die Teile liegen unter projektdateien/fotodoku/.
    if (b.action === 'fotodoku' || b.action === 'fotodoku_vorschau') {
      const wrId = String(b.wochenrapport_id || '').trim();
      const pId = String(b.projekt_id || '').trim();
      if (!UUID_RE.test(wrId) && !UUID_RE.test(pId)) {
        return res.status(400).json({ error: 'wochenrapport_id oder projekt_id (UUID) erforderlich' });
      }
      // Rechte: der projektlose Weg (ganze Woche) ist Master-Sache, weil er
      // ueber mehrere Projekte hinweg sammelt. Mit projekt_id bleibt die
      // bestehende Projektpruefung massgeblich.
      if (!UUID_RE.test(pId)) {
        if (role !== 'gs_admin' && role !== 'master') return res.status(403).json({ error: 'Die wochenweite Fotodokumentation ist Master/Admin vorbehalten.' });
      } else if (!(await darfProjekt(pId, user.id, role))) {
        return res.status(403).json({ error: 'Keine Berechtigung für dieses Projekt' });
      }
      const args = {
        wochenrapportId: UUID_RE.test(wrId) ? wrId : null,
        projektId: UUID_RE.test(pId) ? pId : null,
        jahr, woche,
        nurProjekt: UUID_RE.test(String(b.nur_projekt || '')) ? String(b.nur_projekt) : null,
        nurTage: Array.isArray(b.nur_tage) && b.nur_tage.length ? b.nur_tage.map(String) : null,
      };
      if (b.action === 'fotodoku_vorschau') {
        return res.status(200).json({ ok: true, vorschau: await fotodokuVorschau(args) });
      }
      const r = await erzeugeFotodoku(args);
      return res.status(200).json({
        ok: true,
        nr: r.nr,
        erfasst: r.erfasst,
        abgebildet: r.abgebildet,
        // Fotos, die wegen der Wochenregel in keiner Woche erscheinen. Muss
        // durch, sonst zaehlt die Oberflaeche eine Zahl, die es nicht gibt.
        ohne_zuordnung: r.ohne_zuordnung,
        teile: r.dokumente.length,
        dokumente: r.dokumente.map((d) => ({
          teil: d.teil, von: d.von, filename: d.filename,
          bytes: d.bytes, seiten: d.seiten, bilder: d.bilder, url: d.url,
        })),
      });
    }

    // ── ZIEL 5: Sammelerzeugung direkt aus der Wochenrapport-Liste ─────────
    // Bisher fuehrte der einzige Weg zu "alle Projekte einer Woche" ueber die
    // Sammelmaske (Kunde x KW). Die traegt nicht, wenn die Projekte einer Woche
    // zu verschiedenen Kunden gehoeren oder gar keinen haben — 13 von 18
    // Projekten tragen kein kunde_id. Bezug ist hier der WOCHENRAPPORT
    // (Techniker x KW), also genau die Zeile, vor der der Master steht.
    if (b.action === 'wochen_projekte') {
      if (role !== 'gs_admin' && role !== 'master') {
        return res.status(403).json({ error: 'Nur Master/Admin.' });
      }
      const wrId = String(b.wochenrapport_id || '').trim();
      if (!UUID_RE.test(wrId)) return res.status(400).json({ error: 'wochenrapport_id (UUID) erforderlich' });
      return res.status(200).json({ ok: true, ...(await wochenProjekte(wrId)) });
    }

    if (b.action === 'sammel_vorschau' || b.action === 'wochenrapport_pdf') {
      if (role !== 'gs_admin' && role !== 'master') {
        return res.status(403).json({ error: 'Nur Master/Admin.' });
      }
      if (b.action === 'sammel_vorschau') {
        const kundeId = String(b.kunde_id || '').trim();
        // 'ohne' ist kein Notbehelf, sondern der Normalfall im Bestand: 13 von
        // 18 Projekten tragen kein kunde_id. Ohne diesen Fall waere die Maske
        // fuer den groesseren Teil der Projekte blind.
        if (kundeId !== 'ohne' && !UUID_RE.test(kundeId)) return res.status(400).json({ error: 'kunde_id (UUID) oder "ohne" erforderlich' });
        return res.status(200).json({ ok: true, ...(await sammelVorschau(kundeId, jahr, woche)) });
      }
      const wrId = String(b.wochenrapport_id || '').trim();
      if (!UUID_RE.test(wrId)) return res.status(400).json({ error: 'wochenrapport_id (UUID) erforderlich' });
      const r = await erzeugeWochenrapport({ wochenrapportId: wrId });
      if (!r) return res.status(404).json({ error: 'Wochenrapport nicht gefunden' });
      return res.status(200).json({
        ok: true,
        filename: `Wochenrapport_${r.nr}.pdf`.replace(/[^\w.-]+/g, '_'),
        pdf_base64: Buffer.from(r.pdf).toString('base64'),
        stunden: r.daten.summen.stunden,
        techniker: r.daten.kopf.techniker,
      });
    }

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
        // Empfaenger-Vorschlag ueber DIESELBE Kette wie der spaetere Versand
        // (empfaengerFuer), inklusive eines bereits angelegten Berichtskopfs.
        // Anzeige und Versand duerfen nie auseinanderlaufen: was hier steht,
        // ist genau das, was ohne Eingriff verschickt wuerde.
        const kopfRow = (await sbSoft(
          `gs_wochenberichte?projekt_id=eq.${projektId}&jahr=eq.${jahr}&woche=eq.${woche}&select=empfaenger&limit=1`, [],
        ))[0] || null;
        const vor = empfaengerFuer({ angefragt: null, kopfRow, daten });
        return res.status(200).json({
          ok: true, daten,
          empfaenger_vorschlag: vor.liste,
          empfaenger_herkunft: vor.herkunft,
          empfaenger_herkunft_text: vor.herkunft ? (EMPFAENGER_HERKUNFT_TEXT[vor.herkunft] || null) : null,
        });
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
// Ein Lesefehler darf die Vorschau nie zum Absturz bringen: fehlt der
// Berichtskopf noch (normal, solange kein PDF erzeugt wurde), faellt der
// Empfaenger-Vorschlag eben eine Stufe weiter zurueck.
const sbSoft = (path, fallback) => sbGet(path).catch(() => fallback);
async function getUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}
async function getRole(userId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&select=role&limit=1`, { headers: SB });
  if (!r.ok) return 'bob_user';
  return (await r.json())[0]?.role || 'bob_user';
}

// ═══════════════════════════════════════════════════════════════════════════
// Sammelmaske — was faellt fuer Kunde x KW an?
// ═══════════════════════════════════════════════════════════════════════════
// Die Auswahl "Kunde + KW" loest nicht von selbst auf drei Dokumente auf:
// Wochenbericht und Fotodokumentation haengen am PROJEKT, der Wochenrapport am
// TECHNIKER. Diese Funktion zaehlt beides aus den Tageszeilen aus, damit die
// Maske VOR dem Erzeugen sagen kann, wie viele PDFs es werden.
//
// Massgeblich sind die Tageszeilen, nicht die Projektliste des Kunden: ein
// Projekt ohne Buchung in dieser Woche erzeugt kein Dokument.
// Die Projekte EINER Woche eines Technikers, mit ihren Summen. Grundlage der
// Sammelerzeugung aus der Wochenrapport-Liste.
//
// Der Abrechnungsstatus wird MITGELIEFERT, aber er sperrt nichts: ein
// verrechneter Rapport muss weiterhin als Bericht abrufbar sein — die
// Rechnung ist gestellt, das Dokument dahinter bleibt.
//
// Wochen ganz ohne Projekt (reine Abwesenheitswochen wie Ferien) liefern eine
// leere Projektliste plus den Grund. Ein Wochenbericht ist Projekt x KW; ohne
// Projekt gibt es nichts zu berichten, und das gehoert gesagt statt als
// leeres Ergebnis serviert.
export async function wochenProjekte(wochenrapportId) {
  const kopf = (await sbGet(`gs_wochenrapporte?id=eq.${wochenrapportId}&select=id,jahr,woche,techniker_user_id,rapport_nr&limit=1`))[0];
  if (!kopf) return { jahr: null, woche: null, projekte: [], grund: 'Wochenrapport nicht gefunden.' };

  const zeilen = await sbGet(
    `gs_tagesrapporte?wochenrapport_id=eq.${wochenrapportId}`
    + '&select=id,datum,projekt_id,gesamtstunden,spesen,abwesenheit,abrechnung_status&order=datum.asc',
  ).catch(() => []);

  // Spesen je KALENDERTAG, nicht je Zeile — dieselbe Regel wie ueberall sonst.
  const spesenTag = {};
  for (const z of zeilen) {
    if (!z.datum) continue;
    const v = Number(z.spesen || 0);
    if (!(z.datum in spesenTag) || v > spesenTag[z.datum]) spesenTag[z.datum] = v;
  }
  const spesenWoche = Math.round(Object.values(spesenTag).reduce((a, v) => a + v, 0) * 100) / 100;
  const stundenWoche = Math.round(zeilen.reduce((a, z) => a + Number(z.gesamtstunden || 0), 0) * 100) / 100;

  const jeProjekt = {};
  for (const z of zeilen) {
    if (!z.projekt_id) continue;
    const p = jeProjekt[z.projekt_id] || (jeProjekt[z.projekt_id] = { zeilen: 0, stunden: 0, offen: 0, verrechnet: 0 });
    p.zeilen += 1;
    p.stunden += Number(z.gesamtstunden || 0);
    if ((z.abrechnung_status || 'offen') === 'verrechnet') p.verrechnet += 1; else p.offen += 1;
  }
  const ids = Object.keys(jeProjekt);
  const stamm = ids.length
    ? await sbGet(`gs_projekte?id=in.(${ids.join(',')})&select=id,name,projektnummer,kunde_id`).catch(() => [])
    : [];
  const nachId = {};
  for (const p of stamm) nachId[p.id] = p;

  const projekte = ids.map((id) => ({
    id,
    name: (nachId[id] || {}).name || 'Projekt',
    projektnummer: (nachId[id] || {}).projektnummer || null,
    zeilen: jeProjekt[id].zeilen,
    stunden: Math.round(jeProjekt[id].stunden * 100) / 100,
    abrechnung: jeProjekt[id].offen === 0 ? 'verrechnet' : (jeProjekt[id].verrechnet ? 'teilweise' : 'offen'),
  })).sort((a, b) => String(a.projektnummer || '').localeCompare(String(b.projektnummer || '')));

  let grund = null;
  if (!projekte.length) {
    const nurAbwesend = zeilen.length > 0 && zeilen.every((z) => z.abwesenheit);
    grund = nurAbwesend
      ? 'Diese Woche trägt ausschliesslich Abwesenheiten und keine Baustelle. Ein Wochenbericht ist Projekt × Kalenderwoche — ohne Projekt gibt es nichts zu berichten.'
      : (zeilen.length ? 'Keine der Tageszeilen dieser Woche hängt an einer Baustelle.' : 'Diese Woche hat keine Tageszeilen.');
  }

  return {
    wochenrapport_id: kopf.id, jahr: kopf.jahr, woche: kopf.woche, rapport_nr: kopf.rapport_nr || null,
    projekte, grund,
    summen: { stunden: stundenWoche, spesen: spesenWoche, zeilen: zeilen.length },
  };
}

async function sammelVorschau(kundeId, jahr, woche) {
  const { von, bis } = isoWochenBereich(jahr, woche);
  const ohneKunde = kundeId === 'ohne';
  const kd = ohneKunde ? [] : await sbGet(`gs_kunden?id=eq.${kundeId}&select=id,firma&limit=1`).catch(() => []);
  const kundeName = ohneKunde ? 'Ohne Kunde' : ((kd[0] || {}).firma || null);
  const projekte = await sbGet(
    `gs_projekte?kunde_id=${ohneKunde ? 'is.null' : `eq.${kundeId}`}&select=id,name,projektnummer`,
  ).catch(() => []);
  if (!projekte.length) {
    return { kunde: kundeName, jahr, woche, von, bis, projekte: [], rapporte: [], pdf_anzahl: 0 };
  }
  const ids = projekte.map((p) => p.id);
  const zeilen = await sbGet(
    `gs_tagesrapporte?projekt_id=in.(${ids.join(',')})&datum=gte.${von}&datum=lte.${bis}`
    + '&select=projekt_id,techniker_user_id,wochenrapport_id,gesamtstunden',
  ).catch(() => []);

  const jeProjekt = {}, jeRapport = {};
  for (const z of zeilen) {
    if (z.projekt_id) {
      const p = jeProjekt[z.projekt_id] || (jeProjekt[z.projekt_id] = { zeilen: 0, stunden: 0 });
      p.zeilen += 1; p.stunden += Number(z.gesamtstunden || 0);
    }
    // Ohne wochenrapport_id gibt es kein Stundenblatt — Altzeilen aus der Zeit
    // vor dem Wochenblatt haben keinen Kopf und werden hier benannt, nicht
    // stillschweigend uebergangen.
    if (z.wochenrapport_id) {
      const r = jeRapport[z.wochenrapport_id] || (jeRapport[z.wochenrapport_id] = { zeilen: 0, stunden: 0 });
      r.zeilen += 1; r.stunden += Number(z.gesamtstunden || 0);
    }
  }
  const ohneKopf = zeilen.filter((z) => !z.wochenrapport_id).length;

  const rapportIds = Object.keys(jeRapport);
  let rapporte = [];
  if (rapportIds.length) {
    const koepfe = await sbGet(`gs_wochenrapporte?id=in.(${rapportIds.join(',')})&select=id,rapport_nr,jahr,woche,techniker_user_id,status`).catch(() => []);
    const uids = [...new Set(koepfe.map((k) => k.techniker_user_id).filter(Boolean))];
    const namen = {};
    if (uids.length) {
      const t = await sbGet(`gs_techniker?user_id=in.(${uids.join(',')})&select=user_id,name`).catch(() => []);
      for (const x of t) namen[x.user_id] = x.name;
    }
    rapporte = koepfe.map((k) => ({
      id: k.id, rapport_nr: k.rapport_nr, status: k.status,
      techniker: namen[k.techniker_user_id] || 'Techniker',
      stunden: Math.round((jeRapport[k.id].stunden) * 100) / 100,
    })).sort((a, b) => String(a.techniker).localeCompare(String(b.techniker)));
  }

  const mitBuchung = projekte
    .filter((p) => jeProjekt[p.id])
    .map((p) => ({
      id: p.id, name: p.name, projektnummer: p.projektnummer,
      zeilen: jeProjekt[p.id].zeilen,
      stunden: Math.round(jeProjekt[p.id].stunden * 100) / 100,
    }))
    .sort((a, b) => String(a.projektnummer || '').localeCompare(String(b.projektnummer || '')));

  return {
    kunde: kundeName,
    jahr, woche, von, bis,
    projekte: mitBuchung,
    rapporte,
    // 2 PDFs je Projekt (Bericht + Fotodoku) + 1 je Wochenrapport
    pdf_anzahl: mitBuchung.length * 2 + rapporte.length,
    zeilen_ohne_wochenrapport: ohneKopf,
  };
}
