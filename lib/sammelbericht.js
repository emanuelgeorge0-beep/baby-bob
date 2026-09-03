// lib/sammelbericht.js — EIN Wochenbericht über MEHRERE Projekte einer KW.
//
// Der bestehende Weg (ein PDF je Projekt, lib/wochenbericht.js:erzeugeBericht)
// bleibt unverändert und ist weiterhin der Normalfall. Dies hier ist der
// ZWEITE Weg daneben: aus allen angehakten Projekten einer Kalenderwoche wird
// ein einziges Dokument mit Deckblatt, Projektabschnitten und Gesamtsumme.
//
// ── Warum diese Datei KEINE eigene Tabelle anlegt ──────────────────────────
// gs_wochenberichte trägt den CHECK gs_wochenberichte_bindung_chk: genau EINE
// Bindung je Zeile (projekt_id ODER service_auftrag_id). Ein Kopf für „vier
// Projekte" passt dort nicht hinein, und eine Schemaänderung ist in dieser
// Runde ausgeschlossen. Also wird der Sammelbericht NICHT als eigener Kopf
// abgelegt, sondern als das, was er ist: eine Zusammenstellung der vorhandenen
// Einzelberichte.
//
// Beim Versand bekommt deshalb JEDER enthaltene Einzelbericht
//   • seinen Snapshot eingefroren (wie beim Einzelversand),
//   • status='versendet' (nur bei Erfolg),
//   • einen Eintrag in versand_protokoll mit typ:'sammelbericht' und der
//     Sammel-Nummer.
// Das hat einen zweiten, willkommenen Nutzen: die Versandhistorie (Phase 2)
// kann jeden Vorgang einem Projekt zuordnen und damit serverseitig auf den
// Partner scopen. Ein projektloser Sammelkopf könnte das nicht.
//
// pdf_path der Zeile wird BEWUSST nicht überschrieben — dort steht der Pfad
// des Einzel-PDFs. Der Pfad des Sammel-PDFs steht im Protokolleintrag.
//
// Fotos sind hier ausdrücklich NICHT enthalten (die Fotodokumentation bleibt
// ein eigenes Dokument), deshalb bleibt das PDF klein und passt bequem unter
// die 4.5-MB-Grenze einer Vercel-Antwort.
//
// VIDEO-STANDBILDER sind die eine Ausnahme, und zwar aus einem anderen Grund
// als die Fotos: ein Video lässt sich nicht ausdrucken. Ohne das Standbild mit
// seinem Verweis gäbe es im Sammelbericht überhaupt keinen Weg zu einem Video —
// der Bauleiter wüsste nicht einmal, dass eines existiert. Deshalb stehen sie
// drin, aber scharf gedeckelt (SAMMEL_VIDEOS_JE_PROJEKT / SAMMEL_VIDEOS_MAX,
// siehe unten): ein Sammelbericht darf über 40 Projekte gehen, und 40 × 4
// Standbilder wären wieder ein Dokument, das durch keine Antwort passt.
//
// HIER KEIN `import.meta` — lib/*.js wird auf Vercel als CommonJS geladen
// (siehe die Warnung in lib/wochenbericht.js), das wäre ein Ladefehler.

import { buildPdf, ladeBranding } from './pdf.js';
import {
  sammleWochendaten, berichtNummer, isoWochenBereich, ladeLogo,
  holeOderErstelleBericht, empfaengerFuer, protokolliere, arbeitenText,
  ladeFotoBytes, fotoQuelle, videoCaption,
} from './wochenbericht.js';
import { videoLink } from './videotoken.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const MEDIEN_BUCKET = 'projektdateien';
const MAIL_ABSENDER = 'George Solutions <info@george-solutions.ch>';

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const h = (n) => Number(n || 0).toFixed(2);
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '–');

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SB });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
const sbSoft = (path, fallback) => sbGet(path).catch(() => fallback);

// ═══════════════════════════════════════════════════════════════════════════
// Nummer — SB-{KUERZEL}-{JAHR}-{KW}, gleiches Schema wie WB-…
// ═══════════════════════════════════════════════════════════════════════════
// Eigener Präfix, damit ein Sammelbericht nie mit einem Einzelbericht
// verwechselt wird. Die Nummern der Einzelberichte bleiben unberührt — diese
// Datei schreibt bericht_nr niemals um.
export function sammelNummer({ kuerzel, jahr, woche }) {
  return berichtNummer({ kuerzel: kuerzel || 'SAMMEL', nummer: null, jahr, woche, praefix: 'SB' });
}

// ═══════════════════════════════════════════════════════════════════════════
// Prüf-Ansicht als Pflicht, nicht als Bitte
// ═══════════════════════════════════════════════════════════════════════════
// Ein Dokument, das das Haus verlässt, muss vorher jemand gesehen haben. Beim
// Einzelbericht ist das eine Regel der Oberfläche (wbVersandForm); ein
// Sammelbericht geht an mehrere Bauleiter gleichzeitig und über MEHRERE
// Projekte — dort wäre eine reine UI-Regel zu wenig.
//
// Die Prüf-Ansicht gibt deshalb ein Kennzeichen aus, das der Versand
// vorzeigen muss. Es ist ein HMAC über (Jahr, Woche, sortierte Projekt-IDs,
// Benutzer) mit dem Service-Key als Schlüssel: niemand ausserhalb des Servers
// kann es erzeugen, und es passt auf genau diese Auswahl. Wer ein Projekt
// dazunimmt oder wegnimmt, muss erneut prüfen — sonst ginge etwas raus, das
// so nie auf dem Schirm stand.
//
// Bewusst zustandslos: kein Token-Tisch, keine Migration, nichts zum Aufräumen.
export async function sammelPruefId({ jahr, woche, projektIds, userId }) {
  const { createHmac } = await import('node:crypto');
  const ids = [...new Set((projektIds || []).map((x) => String(x)))].sort();
  const klar = `${Number(jahr)}|${Number(woche)}|${ids.join(',')}|${userId || ''}`;
  return createHmac('sha256', String(SUPABASE_KEY || 'kein-schluessel')).update(klar).digest('hex').slice(0, 32);
}

export async function pruefIdGueltig({ pruefId, jahr, woche, projektIds, userId }) {
  if (!pruefId) return false;
  const soll = await sammelPruefId({ jahr, woche, projektIds, userId });
  const ist = String(pruefId);
  if (ist.length !== soll.length) return false;
  // Zeitkonstanter Vergleich — kostet nichts und nimmt die Frage vorweg.
  let diff = 0;
  for (let i = 0; i < soll.length; i++) diff |= soll.charCodeAt(i) ^ ist.charCodeAt(i);
  return diff === 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Daten sammeln — je Projekt derselbe Einsammler wie beim Einzelbericht
// ═══════════════════════════════════════════════════════════════════════════
// Kein zweiter Datenweg: sammleWochendaten() ist die eine Wahrheit. Ein bereits
// VERSENDETER Einzelbericht wird aus seinem eingefrorenen Snapshot gelesen,
// exakt wie erzeugeBericht() es tut — sonst zeigte der Sammelbericht für
// dasselbe Projekt andere Zahlen als der Einzelbericht, den der Bauleiter
// schon in der Hand hält.
//
// Ein Projekt OHNE Tageszeilen bricht nichts ab: es erscheint mit Abschnitt,
// Erklärsatz und Zwischensumme 0.00. Weglassen liesse offen, ob es vergessen
// wurde oder nichts anfiel.
export async function sammleSammelbericht({ projektIds, jahr, woche }) {
  const j = Number(jahr), w = Number(woche);
  if (!Number.isInteger(j) || j < 2000 || j > 2999) throw new Error('Ungültiges Jahr');
  if (!Number.isInteger(w) || w < 1 || w > 53) throw new Error('Ungültige Kalenderwoche');
  const ids = [...new Set((projektIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) throw new Error('Kein Projekt ausgewählt — ein Sammelbericht braucht mindestens ein Projekt.');

  const { von, bis } = isoWochenBereich(j, w);
  const hinweise = [];
  const projekte = [];

  for (const id of ids) {
    const vorhanden = await sbSoft(`gs_wochenberichte?projekt_id=eq.${id}&jahr=eq.${j}&woche=eq.${w}&select=*&limit=1`, []);
    const bestehend = vorhanden[0] || null;
    const ausSnapshot = !!(bestehend && bestehend.status === 'versendet' && bestehend.daten && typeof bestehend.daten === 'object');
    const daten = ausSnapshot ? bestehend.daten : await sammleWochendaten({ quelle: 'projekt', projektId: id, jahr: j, woche: w });
    const s = daten.summen || {};
    projekte.push({
      projekt_id: id,
      nummer: (daten.kopf && daten.kopf.nummer) || null,
      titel: (daten.kopf && daten.kopf.titel) || 'Projekt',
      kuerzel: (daten.kopf && daten.kopf.kuerzel) || null,
      partner_id: (daten.kopf && daten.kopf.partner_id) || null,
      bericht_nr: (bestehend && bestehend.bericht_nr) || berichtNummer({
        kuerzel: (daten.kopf && daten.kopf.kuerzel) || null,
        nummer: (daten.kopf && daten.kopf.nummer) || null, jahr: j, woche: w,
      }),
      aus_snapshot: ausSnapshot,
      kopfRow: bestehend,
      daten,
      // Zwischensumme dieses Projekts. Sie ist die einzige Zahl, aus der die
      // Gesamtsumme gebildet wird — siehe unten.
      summen: {
        stunden: r2(s.stunden), uz25: r2(s.uz25), uz50: r2(s.uz50), uz100: r2(s.uz100),
        spesen: r2(s.spesen), tage: Number(s.tage || 0), zeilen: Number(s.zeilen || 0),
      },
    });
  }

  // Reihenfolge: nach Projektnummer, wie überall sonst in der Wochenansicht.
  projekte.sort((a, b) => String(a.nummer || '~').localeCompare(String(b.nummer || '~')));

  // GESAMTSUMME = SUMME DER ZWISCHENSUMMEN. Ausdrücklich so und nicht neu aus
  // den Tageszeilen gerechnet: ein Deckblatt, dessen Total nicht der Summe der
  // Abschnitte entspricht, ist ein kaputtes Dokument, egal wie richtig die
  // andere Zahl wäre.
  const summen = projekte.reduce((a, p) => ({
    stunden: r2(a.stunden + p.summen.stunden),
    uz25: r2(a.uz25 + p.summen.uz25), uz50: r2(a.uz50 + p.summen.uz50), uz100: r2(a.uz100 + p.summen.uz100),
    spesen: r2(a.spesen + p.summen.spesen),
    tage: a.tage + p.summen.tage, zeilen: a.zeilen + p.summen.zeilen,
  }), { stunden: 0, uz25: 0, uz50: 0, uz100: 0, spesen: 0, tage: 0, zeilen: 0 });

  // Sicherheitsnetz für die Spesen. sammleWochendaten() rechnet die
  // Tagespauschale bereits genau EINEM Projekt je Kalendertag zu (dem mit den
  // meisten Stunden, siehe `fuehrendesProjekt`) — deshalb ist die Summe der
  // Zwischensummen normalerweise exakt die Wochenpauschale, ohne Doppelzählung.
  // Sollten zwei Projekte denselben Tag doch beanspruchen, wird das GESAGT und
  // nicht weggerechnet: die Zwischensummen sind dieselben Zahlen, die auch im
  // Einzelbericht stehen, und die dürfen nicht wandern.
  const tageJeProjekt = projekte.map((p) => new Set((p.daten.tage || []).filter((t) => t.spesen).map((t) => t.datum)));
  const doppelt = new Set();
  for (let i = 0; i < tageJeProjekt.length; i++) {
    for (let k = i + 1; k < tageJeProjekt.length; k++) {
      for (const d of tageJeProjekt[i]) if (tageJeProjekt[k].has(d)) doppelt.add(d);
    }
  }
  if (doppelt.size) {
    hinweise.push(`An ${doppelt.size} Tag(en) wurde auf mehreren Projekten gebucht. Die Spesen stehen je Projekt in der Zwischensumme; die Gesamtspesen sind deren Summe und deshalb höher als die reine Tagespauschale.`);
  }
  const leer = projekte.filter((p) => !p.summen.zeilen);
  if (leer.length) {
    hinweise.push(`${leer.length} Projekt(e) ohne Buchung in dieser Woche: ${leer.map((p) => p.nummer || p.titel).join(', ')}. Sie stehen mit Zwischensumme 0.00 im Bericht.`);
  }

  return { jahr: j, woche: w, von, bis, projekte, summen, hinweise };
}

// ═══════════════════════════════════════════════════════════════════════════
// Empfänger — dieselbe Kette wie beim Einzelbericht, über alle Projekte
// ═══════════════════════════════════════════════════════════════════════════
// Je Projekt wird empfaengerFuer() gefragt (Berichtskopf → Ansprechperson →
// Kunde → Partnerprofil) und die Ergebnisse werden vereinigt. Wer den
// Einzelbericht seines Projekts bekommen hätte, bekommt auch den Sammelbericht.
// Eine Adresse zu erfinden oder auf die Büroadresse zurückzufallen, wäre hier
// wie dort falsch.
export function sammelEmpfaenger({ angefragt, projekte }) {
  const etwasEingetippt = Array.isArray(angefragt)
    ? angefragt.some((x) => String(x || '').trim())
    : !!String(angefragt || '').trim();
  if (etwasEingetippt) return empfaengerFuer({ angefragt, kopfRow: null, daten: null });

  const liste = [], herkunft = [];
  for (const p of projekte || []) {
    const v = empfaengerFuer({ angefragt: null, kopfRow: p.kopfRow, daten: p.daten });
    for (const a of v.liste) if (!liste.includes(a)) liste.push(a);
    if (v.herkunft && !herkunft.includes(v.herkunft)) herkunft.push(v.herkunft);
  }
  return { liste, herkunft: herkunft.join(' + ') || null, herkunft_liste: herkunft };
}

// ═══════════════════════════════════════════════════════════════════════════
// PDF — heller Dokumentstil nach Eiserner Regel 6
// ═══════════════════════════════════════════════════════════════════════════
// Weisser Grund, schwarze Schrift, Logo oben, goldene Haarlinie, sonst neutral.
// Dieselbe Vorlage (buildPdf style 'brief') und dasselbe gs_branding wie der
// Einzelbericht — der Sammelbericht ist kein neues Aussehen, nur ein anderer
// Zuschnitt.
//
// ── Die Zuordnung jeder Zeile zu ihrem Projekt ──
// Der Satzspiegel kennt nur EINE Fusszeile für das ganze Dokument; eine
// mitlaufende Kopfzeile je Abschnitt gäbe es nur, wenn lib/pdf.js umgebaut
// würde — und ein fertiges Modul wird nicht angefasst. Also trägt JEDE
// Tageszeile ihre Projektnummer in einer eigenen ersten Spalte. Das hält auch
// dann, wenn ein Abschnitt mitten in einer Seite beginnt oder über drei Seiten
// läuft: der Spaltenkopf wiederholt sich beim Umbruch (lib/pdf.js:735), die
// Nummer steht ohnehin in jeder Zeile.
// ═══════════════════════════════════════════════════════════════════════════
// VIDEOS — Standbild plus Verweis, wie im Einzelbericht
// ═══════════════════════════════════════════════════════════════════════════
// Zwei Deckel, und beide sind nötig. Je Projekt vier — dieselbe Zahl wie im
// Einzelbericht (VIDEOS_IM_PDF), damit ein Projekt in beiden Dokumenten
// dasselbe zeigt. Global sechzehn, weil ein Sammelbericht über bis zu 40
// Projekte gehen darf (api/wochenbericht.js) und 160 Standbilder in keine
// Vercel-Antwort passen: ein Standbild ist rund 60 KB, base64 bläht es auf
// das 1.37-fache — 16 Stück sind knapp 1.3 MB, 160 wären 13 MB.
//
// Was der Deckel abschneidet, wird GEZÄHLT und im Dokument benannt. Ein
// stillschweigend weggelassenes Video wäre schlimmer als eines, das nur als
// Zeile erscheint.
// Kurzname eines Projekts fuer Tabellenspalte, Zwischensumme und
// Video-Ueberschrift. Stand frueher lokal in buildSammelberichtPdf; seit dem
// Videoabschnitt braucht ihn auch der Ladeweg — also eine Ebene hoeher.
const kurz = (p) => String(p.nummer || p.kuerzel || p.titel || 'Projekt');

const SAMMEL_VIDEOS_JE_PROJEKT = 4;   // wie im Einzelbericht (VIDEOS_IM_PDF)
const SAMMEL_VIDEOS_MAX = 12;         // ueber ALLE Projekte zusammen
const SAMMEL_STANDBILD_MAX = 400 * 1024;        // je Standbild
const SAMMEL_BILD_BUDGET = 1.8 * 1024 * 1024;   // Summe aller Standbilder

// Lädt die Standbilder für alle Projekte. Rückgabe:
//   { bilder: {[projekt_id]: [{buf, caption, url}]}, erfasst, abgebildet,
//     ohne_standbild, alt_snapshots }
//
// REIHUM VERGEBEN, nicht der Reihe nach: erst das erste Video jedes Projekts,
// dann das zweite, und so fort. Bei 40 Projekten und zwölf Plätzen fräsen
// sonst die ersten drei Projekte alles auf und 37 Baustellen zeigen nichts.
export async function ladeSammelVideos(sammel) {
  const projekte = sammel.projekte || [];
  let erfasst = 0, ohneStandbild = 0, altSnapshots = 0;
  const reihen = [];
  for (const p of projekte) {
    // Alt-Snapshots aus der Zeit vor dem Video-Abschnitt tragen kein `videos`.
    // Das ist kein Fehler, aber es wird gesagt statt verschwiegen.
    const hatFeld = !!(p.daten && Array.isArray(p.daten.videos));
    if (!hatFeld && p.aus_snapshot) altSnapshots += 1;
    const alle = (p.daten && p.daten.videos) || [];
    erfasst += alle.length;
    // Ein Video ohne Standbild lässt sich nicht abbilden. Gezählt, nicht
    // verschwiegen — genau wie im Einzelbericht.
    const mitBild = alle.filter((v) => v.thumbnail_path);
    ohneStandbild += alle.length - mitBild.length;
    reihen.push({ projekt_id: p.projekt_id, kurz: kurz(p), rest: mitBild.slice(0, SAMMEL_VIDEOS_JE_PROJEKT) });
  }

  // Reihum einsammeln, bis der globale Deckel erreicht ist.
  const auswahl = [];
  for (let runde = 0; runde < SAMMEL_VIDEOS_JE_PROJEKT && auswahl.length < SAMMEL_VIDEOS_MAX; runde++) {
    for (const r of reihen) {
      if (auswahl.length >= SAMMEL_VIDEOS_MAX) break;
      if (runde < r.rest.length) auswahl.push({ projekt_id: r.projekt_id, kurz: r.kurz, v: r.rest[runde] });
    }
  }

  // Parallel laden, jede Datei nur einmal — dieselbe Regel wie im
  // Einzelbericht (Phase 9). Einzelcap je Standbild: SAMMEL_STANDBILD_MAX.
  const cache = new Map();
  const hol = (v) => {
    const schluessel = `${v.bucket || MEDIEN_BUCKET}/${v.thumbnail_path}`;
    if (!cache.has(schluessel)) {
      cache.set(schluessel, ladeFotoBytes({ bucket: v.bucket, path: v.thumbnail_path }, SAMMEL_STANDBILD_MAX));
    }
    return cache.get(schluessel);
  };
  const bytes = await Promise.all(auswahl.map((x) => hol(x.v)));

  // Laufendes Byte-Budget als Reissleine: die Deckelung haengt damit nicht an
  // einer Schaetzung der Bildgroesse. Die Antwort von sammel_pruefung traegt
  // das PDF als base64 (Faktor 1.37) und muss unter 4.5 MB bleiben.
  const bilder = {};
  let abgebildet = 0, verbraucht = 0;
  auswahl.forEach((x, i) => {
    const buf = bytes[i];
    if (!buf) return;
    if (verbraucht + buf.length > SAMMEL_BILD_BUDGET) return;
    verbraucht += buf.length;
    (bilder[x.projekt_id] || (bilder[x.projekt_id] = [])).push({
      buf, caption: videoCaption(x.v), url: videoLink(x.v.id),
    });
    abgebildet += 1;
  });
  return { bilder, erfasst, abgebildet, ohne_standbild: ohneStandbild, alt_snapshots: altSnapshots, bytes: verbraucht };
}

export function buildSammelberichtPdf(sammel, { logo, berichtNr, branding, empfaenger, videos } = {}) {
  const marke = branding || null;
  const nr = berichtNr || sammelNummer({ jahr: sammel.jahr, woche: sammel.woche });
  const blocks = [];
  const ps = sammel.projekte || [];
  const s = sammel.summen || {};

  // ── Deckblatt ────────────────────────────────────────────────────────────
  blocks.push({
    t: 'tiles',
    items: [
      { label: 'Zeitraum', value: `KW ${sammel.woche}/${sammel.jahr}\n${dmy(sammel.von)} – ${dmy(sammel.bis)}` },
      { label: 'Umfang', value: `${ps.length} Projekt${ps.length === 1 ? '' : 'e'}\n${h(s.stunden)} h\nSpesen CHF ${h(s.spesen)}` },
      { label: 'Empfänger', value: (empfaenger && empfaenger.length) ? empfaenger.join('\n') : 'noch nicht festgelegt' },
    ],
  });

  blocks.push({ t: 'h1', text: 'Enthaltene Projekte' });
  blocks.push({
    t: 'table', size: 9,
    cols: [
      { w: 92, label: 'Projekt-Nr' }, { w: 229, label: 'Bezeichnung' },
      { w: 75, label: 'Stunden', align: 'right' }, { w: 75, label: 'Spesen CHF', align: 'right' },
    ],
    rows: ps.map((p) => [
      p.nummer || '—', p.titel || 'Projekt',
      { text: h(p.summen.stunden), align: 'right' },
      { text: h(p.summen.spesen), align: 'right' },
    ]).concat([[
      { text: 'Gesamt', bold: true },
      { text: `${ps.length} Projekt${ps.length === 1 ? '' : 'e'}`, bold: true },
      { text: h(s.stunden), bold: true, size: 13, align: 'right' },
      { text: h(s.spesen), bold: true, size: 11, align: 'right' },
    ]]),
  });

  if ((sammel.hinweise || []).length) {
    blocks.push({ t: 'h2', text: 'Hinweise zur Datenlage' });
    blocks.push({ t: 'sp', size: 2 });
    for (const x of sammel.hinweise) blocks.push({ t: 'text', text: `• ${x}`, size: 8.5, lead: 14 });
  }

  blocks.push({ t: 'sp', size: 8 });
  blocks.push({ t: 'text', text: 'Auf den folgenden Seiten steht jedes Projekt in einem eigenen Abschnitt. Jede Tageszeile trägt ihre Projektnummer, damit die Zuordnung auch über Seitenumbrüche hinweg eindeutig bleibt.', size: 8.5, lead: 13 });

  // ── Je Projekt ein eigener Abschnitt ─────────────────────────────────────
  for (const p of ps) {
    blocks.push({ t: 'pb' });
    blocks.push({ t: 'h1', text: `${p.nummer ? p.nummer + ' · ' : ''}${p.titel || 'Projekt'}` });

    const k = (p.daten && p.daten.kopf) || {};
    const meta = [];
    if (k.adresse && k.adresse !== k.titel) meta.push(k.adresse);
    if (k.kunde) meta.push(k.kunde);
    const bl = [k.projektleiter, k.ansprechperson].filter(Boolean).join(' · ');
    if (bl) meta.push(`Bauleitung: ${bl}`);
    meta.push(`Einzelbericht ${p.bericht_nr}`);
    blocks.push({ t: 'text', text: meta.join(' · '), size: 8.5, lead: 13 });

    const zeilen = [];
    for (const tag of (p.daten && p.daten.tage) || []) {
      for (const z of tag.zeilen || []) {
        const uz = Number(z.uz25 || 0) + Number(z.uz50 || 0) + Number(z.uz100 || 0);
        const leerzeile = !z.stunden && !uz && !z.abwesenheit && !arbeitenText(z) && !z.notiz;
        if (leerzeile) continue;
        const arbeit = z.abwesenheit
          ? `Abwesend: ${z.abwesenheit}${z.abwesenheit_grund ? ' (' + z.abwesenheit_grund + ')' : ''}`
          : (arbeitenText(z) || '—');
        zeilen.push([
          kurz(p),
          `${(tag.wochentag || '').slice(0, 2)} ${dmy(tag.datum)}`,
          z.techniker || '—',
          z.notiz ? `${arbeit} · Notiz: ${z.notiz}` : arbeit,
          { text: h(z.stunden), align: 'right' },
          { text: uz ? h(uz) : '—', align: 'right' },
        ]);
      }
    }

    if (!zeilen.length) {
      blocks.push({ t: 'sp', size: 4 });
      blocks.push({ t: 'text', text: 'In dieser Kalenderwoche wurde auf dieses Projekt nichts gebucht.', size: 9, lead: 14 });
    } else {
      blocks.push({
        t: 'table', size: 8.5, gap: 8,
        // Spaltenbreiten sind gemessen, nicht geschätzt: '60586.00' braucht 35.4 pt,
        // 'Mo 17.08.2026' 56.7 pt, '10.00' 21.3 pt — dazu je 7 pt Innenabstand
        // links und rechts. Zu enge Zahlenspalten brechen um und stellen '10.00'
        // als '10.0' über '0' — derselbe Fehler, den der Wochenbericht schon
        // einmal hatte. Die Summe der Breiten ist genau die Satzbreite (471 pt).
        cols: [
          { w: 60, label: 'Projekt' }, { w: 76, label: 'Datum' }, { w: 76, label: 'Techniker' },
          { w: 189, label: 'Tätigkeit' }, { w: 40, label: 'Std', align: 'right' }, { w: 30, label: 'ÜZ', align: 'right' },
        ],
        rows: zeilen,
      });
    }

    // Zwischensumme — trägt die Projektnummer, damit sie auch losgelöst vom
    // Abschnittskopf lesbar ist.
    blocks.push({ t: 'sp', size: 2 });
    blocks.push({
      t: 'text', bold: true, size: 9.5, lead: 14,
      text: `Zwischensumme ${kurz(p)}: ${h(p.summen.stunden)} h`
        + ((p.summen.uz25 + p.summen.uz50 + p.summen.uz100) ? ` · Überzeit ${h(p.summen.uz25 + p.summen.uz50 + p.summen.uz100)} h` : '')
        + ` · Spesen CHF ${h(p.summen.spesen)}`,
    });

    // ── Videos dieses Projekts ─────────────────────────────────────────────
    // BEIM PROJEKT, nicht gesammelt am Dokumentende: derselbe Grund, aus dem
    // jede Tageszeile ihre Projektnummer trägt — die Zuordnung muss auch über
    // Seitenumbrüche hinweg eindeutig bleiben. Ein Block „Videos" am Schluss
    // mit vierzig Standbildern verschiedener Baustellen wäre unlesbar.
    const pVideos = (videos && videos[p.projekt_id]) || [];
    const pAlle = (p.daten && p.daten.videos) || [];
    if (pVideos.length) {
      blocks.push({ t: 'sp', size: 8 });
      blocks.push({ t: 'need', h: 140 });
      blocks.push({ t: 'h2', text: `Videos ${kurz(p)}` });
      blocks.push({
        t: 'text', size: 8.5, lead: 13,
        text: `${pAlle.length} Video(s) dieser Woche`
          + (pVideos.length < pAlle.length ? `, ${pVideos.length} abgebildet` : '')
          + '. Das Standbild antippen öffnet das Video im Browser; der Link gilt 30 Tage und braucht keine Anmeldung.',
      });
      blocks.push({
        t: 'imgrow', perRow: 2, maxH: 168, gap: 14,
        images: pVideos.map((v) => v.buf),
        captions: pVideos.map((v) => v.caption || ''),
        links: pVideos.map((v) => v.url || null),
      });
    } else if (pAlle.length) {
      // Videos vorhanden, aber keines abbildbar (kein Standbild oder Deckel
      // erreicht). Das gehört gesagt, sonst fehlen sie spurlos.
      blocks.push({ t: 'sp', size: 6 });
      blocks.push({
        t: 'text', size: 8.5, lead: 13,
        text: `${pAlle.length} Video(s) dieser Woche sind erfasst, lassen sich hier aber nicht abbilden `
          + '(kein Standbild). Zu finden im Cockpit unter Projekt → Medien.',
      });
    }
  }

  // ── Gesamtsumme ──────────────────────────────────────────────────────────
  blocks.push({ t: 'sp', size: 10 });
  blocks.push({ t: 'need', h: 130 });
  blocks.push({ t: 'h1', text: 'Gesamtsumme' });
  blocks.push({
    t: 'table', size: 9,
    cols: [
      { w: 92, label: 'Projekt-Nr' }, { w: 229, label: 'Zwischensumme' },
      { w: 75, label: 'Stunden', align: 'right' }, { w: 75, label: 'Spesen CHF', align: 'right' },
    ],
    rows: ps.map((p) => [
      p.nummer || '—', p.titel || 'Projekt',
      { text: h(p.summen.stunden), align: 'right' },
      { text: h(p.summen.spesen), align: 'right' },
    ]).concat([[
      { text: 'Gesamt', bold: true },
      { text: `Summe aus ${ps.length} Zwischensumme${ps.length === 1 ? '' : 'n'}`, bold: true },
      { text: h(s.stunden), bold: true, size: 18, align: 'right' },
      { text: h(s.spesen), bold: true, size: 14, align: 'right' },
    ]]),
  });

  blocks.push({ t: 'sp', size: 10 });
  blocks.push({
    t: 'text', size: 7.5, lead: 11,
    text: `Erstellt ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${(marke && marke.firmenname) || 'George Solutions'} · automatisch aus den Tagesrapporten erzeugt`,
  });

  return buildPdf({
    style: 'brief',
    balance: true,
    branding: marke || undefined,
    title: 'Sammelbericht',
    subtitle: `${nr} · Sammelbericht · KW ${sammel.woche}/${sammel.jahr}`,
    logo: logo || (marke && marke.logo) || undefined,
    footer: `${nr} · KW ${sammel.woche}/${sammel.jahr}`,
    blocks,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Erzeugen
// ═══════════════════════════════════════════════════════════════════════════
// Branding: der Sammelbericht kann Projekte mehrerer Partner enthalten. Ein
// fremdes Logo auf einem Dokument, das auch die Projekte eines anderen zeigt,
// wäre falsch — deshalb gilt der Partner-Auftritt nur, wenn ALLE enthaltenen
// Projekte demselben Partner gehören. Sonst der Standard-Auftritt.
export async function erzeugeSammelbericht({ projektIds, jahr, woche, kuerzel, empfaenger }) {
  const sammel = await sammleSammelbericht({ projektIds, jahr, woche });
  const nr = sammelNummer({ kuerzel, jahr: sammel.jahr, woche: sammel.woche });

  const partnerIds = [...new Set(sammel.projekte.map((p) => p.partner_id || null))];
  const marke = await ladeBranding({ partnerId: partnerIds.length === 1 ? partnerIds[0] : null });

  const empf = sammelEmpfaenger({ angefragt: empfaenger, projekte: sammel.projekte });

  // Video-Standbilder für alle Projekte, parallel und gedeckelt.
  const vids = await ladeSammelVideos(sammel);
  // Was der Deckel abgeschnitten hat, steht als Hinweis im Dokument — dort, wo
  // auch die übrigen Hinweise zur Datenlage stehen.
  // EIN Satz, nicht einer je Projekt: die Hinweise stehen auf dem Deckblatt
  // UND in der Versandmail — vierzig Zeilen waeren dort unlesbar.
  const nichtGezeigt = vids.erfasst - vids.abgebildet;
  if (nichtGezeigt > 0) {
    sammel.hinweise = [...(sammel.hinweise || []), `${vids.abgebildet} von ${vids.erfasst} Video(s) sind abgebildet`
      + (vids.ohne_standbild ? `; ${vids.ohne_standbild} davon ohne Standbild` : '')
      + `. Höchstens ${SAMMEL_VIDEOS_JE_PROJEKT} je Projekt und ${SAMMEL_VIDEOS_MAX} im ganzen Bericht — die übrigen stehen im Cockpit unter Projekt → Medien.`];
  }
  if (vids.alt_snapshots > 0) {
    sammel.hinweise = [...(sammel.hinweise || []), `Für ${vids.alt_snapshots} Projekt(e) stammt der Stand aus einem `
      + 'eingefrorenen Bericht, der noch keine Videos kannte. Dort fehlen sie deshalb, auch wenn welche erfasst sind.'];
  }

  const pdf = buildSammelberichtPdf(sammel, {
    logo: marke.logo || await ladeLogo(),
    berichtNr: nr, branding: marke, empfaenger: empf.liste,
    videos: vids.bilder,
  });

  return {
    nr, sammel, pdf, videos: { erfasst: vids.erfasst, abgebildet: vids.abgebildet, ohne_standbild: vids.ohne_standbild },
    empfaenger: empf.liste, empfaenger_herkunft: empf.herkunft,
    branding: {
      firmenname: marke.firmenname, akzentfarbe: marke.akzentfarbe,
      aus_tabelle: marke.aus_tabelle, partner_id: marke.partner_id,
    },
  };
}

// PDF ablegen. Best-effort wie beim Einzelbericht: schlägt der Upload fehl,
// geht die Mail trotzdem raus.
async function legeSammelPdfAb({ jahr, woche, nr, pdf }) {
  const pfad = `wochenberichte/sammel/${jahr}-KW${String(woche).padStart(2, '0')}/${String(nr).replace(/[^\w.-]+/g, '_')}.pdf`;
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${MEDIEN_BUCKET}/${pfad}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
      body: pdf,
    });
    return r.ok ? pfad : null;
  } catch (_) { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// Versand
// ═══════════════════════════════════════════════════════════════════════════
// Derselbe Weg wie beim Einzelbericht: Empfänger-Vorbelegung, Einfrieren,
// Statuswechsel nur bei Erfolg, Eintrag im versand_protokoll.
//
// Der Unterschied ist die Buchführung: EIN PDF geht raus, aber JEDER
// enthaltene Einzelbericht wird eingefroren und protokolliert. Anders liesse
// sich ein Vorgang später weder einem Projekt noch einem Partner zuordnen.
export async function versendeSammelbericht({
  projektIds, jahr, woche, userId, kuerzel, empfaenger, sendMail, mailHtml, betreff,
}) {
  const erz = await erzeugeSammelbericht({ projektIds, jahr, woche, kuerzel, empfaenger });
  const { nr, sammel, pdf } = erz;

  const empf = sammelEmpfaenger({ angefragt: empfaenger, projekte: sammel.projekte });
  if (!empf.liste.length) {
    return {
      ok: false, versendet: false, nr, sammel, pdf,
      error: empf.ungueltig
        ? 'Die eingetragene Empfängeradresse ist keine gültige E-Mail. Bitte korrigieren — es wurde nichts versendet.'
        : 'Keine gültige Empfängeradresse. Bitte Empfänger angeben — oder eine E-Mail bei einem der Projekte (Ansprechperson), beim Kunden oder im Partnerprofil hinterlegen.',
    };
  }

  const pdfPath = await legeSammelPdfAb({ jahr: sammel.jahr, woche: sammel.woche, nr, pdf });

  const nummern = sammel.projekte.map((p) => p.nummer || p.titel).join(', ');
  const betreffText = betreff
    || `Sammelbericht KW ${sammel.woche}/${sammel.jahr} · ${sammel.projekte.length} Projekte · ${nr}`;
  const html = mailHtml({
    berichtNr: nr, kw: sammel.woche, jahr: sammel.jahr,
    projektName: `${sammel.projekte.length} Projekte: ${nummern}`,
    von: sammel.von, bis: sammel.bis,
    summen: sammel.summen, einreichstatus: [], hinweise: sammel.hinweise,
  });

  const mail = await sendMail({
    to: empf.liste,
    from: MAIL_ABSENDER,
    subject: betreffText,
    html,
    attachments: [{ filename: `${nr}.pdf`.replace(/[^\w.-]+/g, '_'), content: Buffer.from(pdf).toString('base64') }],
  });
  const erfolg = !!(mail && mail.ok);
  const am = new Date().toISOString();
  const fehler = erfolg ? null : ((mail && (mail.error || (mail.skipped ? 'RESEND_API_KEY fehlt' : null))) || 'unbekannt');

  // Je enthaltenem Projekt: Kopf sichern, einfrieren, protokollieren.
  const protokolle = [];
  for (const p of sammel.projekte) {
    let kopfRow = p.kopfRow;
    try {
      if (!kopfRow) {
        kopfRow = await holeOderErstelleBericht({
          projektId: p.projekt_id, jahr: sammel.jahr, woche: sammel.woche, userId, berichtNr: p.bericht_nr,
        });
      }
    } catch (e) {
      protokolle.push({ projekt_id: p.projekt_id, bericht_nr: p.bericht_nr, protokolliert: false, fehler: e.message });
      continue;
    }

    const eintrag = {
      am, an: empf.liste, empfaenger_herkunft: empf.herkunft,
      typ: 'sammelbericht',
      bericht_nr: p.bericht_nr,
      sammel_nr: nr,
      sammel_projekte: sammel.projekte.length,
      projekt_stunden: p.summen.stunden,
      projekt_spesen: p.summen.spesen,
      von: userId || null,
      ok: erfolg,
      fehler,
      pdf_bytes: pdf.length,
      pdf_path: pdfPath,
    };
    // Nur ein GELUNGENER Versand setzt Status und friert ein. pdf_path der
    // Zeile bleibt unberührt — dort steht der Pfad des Einzel-PDFs.
    const patch = erfolg
      ? {
        status: 'versendet', versendet_am: am, empfaenger: empf.liste,
        ...(kopfRow.bericht_nr ? {} : { bericht_nr: p.bericht_nr }),
        ...(p.aus_snapshot ? {} : { daten: p.daten }),
      }
      : { empfaenger: empf.liste, ...(kopfRow.bericht_nr ? {} : { bericht_nr: p.bericht_nr }) };

    try {
      const prot = await protokolliere({ kopfRow, eintrag, patch });
      protokolle.push({
        projekt_id: p.projekt_id, bericht_nr: p.bericht_nr,
        protokolliert: prot.protokolliert, not_migrated: !!prot.notMigrated,
        status: (prot.row && prot.row.status) || (erfolg ? 'versendet' : (kopfRow.status || 'entwurf')),
      });
    } catch (e) {
      protokolle.push({ projekt_id: p.projekt_id, bericht_nr: p.bericht_nr, protokolliert: false, fehler: e.message });
    }
  }

  const ohneProtokoll = protokolle.filter((x) => x.not_migrated).length;

  return {
    ok: erfolg, versendet: erfolg,
    nr, sammel, pdf, pdf_path: pdfPath,
    empfaenger: empf.liste, empfaenger_herkunft: empf.herkunft,
    protokolle,
    protokolliert: protokolle.every((x) => x.protokolliert),
    protokoll_hinweis: ohneProtokoll
      ? 'Spalte versand_protokoll fehlt (scripts/wochenbericht_versand.sql noch nicht ausgeführt) — nur der letzte Versand ist festgehalten, keine Historie.'
      : null,
    error: erfolg ? null : fehler,
  };
}
