// lib/wochenbericht.js — Datensammel-Schicht für den Wochenbericht (Projekt × KW).
//
// Sammelt alles, was Techniker in einer Kalenderwoche auf EIN Projekt gebucht
// haben: Stunden, Tätigkeiten, Freitext/Diktat, Material, Fotos — plus die
// Frage, wer die Woche schon eingereicht hat und wer nicht.
//
// Getrennt vom Wochenrapport (Techniker × Woche, gs_wochenrapporte). Der bleibt
// unangetastet; hier wird nur GELESEN.
//
// ── Zwei Entwurfsentscheidungen, die später Arbeit sparen ──────────────────
//
// 1. ABFRAGE ÜBER `datum`, NICHT über `woche`/`jahr`.
//    In der Live-DB stehen zwei Tageszeilen (2026-07-13/14) mit woche IS NULL
//    UND jahr IS NULL — Altzeilen aus der Zeit vor dem Wochenblatt. Ein Filter
//    auf woche/jahr würde sie stillschweigend verschlucken. Der Datumsbereich
//    Montag–Sonntag findet sie. Die Altzeilen werden bewusst NICHT repariert.
//
// 2. DAS AUSGABE-VOKABULAR IST QUELLENNEUTRAL.
//    `kopf` spricht von titel/nummer/adresse/kunde, nicht von projekt_name oder
//    projektnummer. Ein Serviceauftrag hat `objekt` und `auftragsnummer` statt
//    Projektname und Projektnummer — würde das Vokabular hier „Projekt" heissen,
//    müsste die PDF-Erzeugung beim Bau der Serviceabteilung angefasst werden.
//    So kostet der zweite Zweig genau einen `case` in dieser Datei und null
//    Zeilen im PDF. Die Serviceabteilung ist NICHT gebaut: quelle:'service'
//    liefert heute bewusst leere Listen.

import { buildPdf, ladeBranding, clipText, textWidth } from './pdf.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

const MEDIEN_BUCKET = 'projektdateien';
const WOCHENTAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
// Abwesenheitskürzel aus gs_tagesrapporte.abwesenheit (wochenrapport_migration.sql).
const ABWESENHEIT = { G: 'Gleitzeit', F: 'Ferien', M: 'Militär', U: 'Unfall', A: 'Absenz' };

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SB });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
// Lesen darf den Bericht nie zum Absturz bringen: fehlt eine Tabelle oder eine
// Spalte (Migration noch nicht gelaufen), fehlt eben der Abschnitt.
const sbSoft = (path, fallback) => sbGet(path).catch(() => fallback);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;

// ── ISO-Kalenderwoche → Datumsbereich Montag..Sonntag ──────────────────────
// ISO 8601: Woche 1 ist die Woche, die den 4. Januar enthält.
export function isoWochenBereich(jahr, woche) {
  const jan4 = Date.UTC(jahr, 0, 4);
  const dow = new Date(jan4).getUTCDay() || 7;                 // Mo=1 … So=7
  const montagKw1 = jan4 - (dow - 1) * 86400000;
  const montag = new Date(montagKw1 + (woche - 1) * 7 * 86400000);
  const sonntag = new Date(montag.getTime() + 6 * 86400000);
  return { von: montag.toISOString().slice(0, 10), bis: sonntag.toISOString().slice(0, 10) };
}

export function isoWocheVonDatum(datum) {
  const t = new Date(`${datum}T00:00:00Z`);
  if (isNaN(t)) return { woche: null, jahr: null };
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { woche: Math.ceil((((t - yearStart) / 86400000) + 1) / 7), jahr: t.getUTCFullYear() };
}

// ═══════════════════════════════════════════════════════════════════════════
// Hauptfunktion
// ═══════════════════════════════════════════════════════════════════════════
export async function sammleWochendaten({ quelle = 'projekt', projektId = null, serviceAuftragId = null, jahr, woche }) {
  const j = Number(jahr), w = Number(woche);
  if (!Number.isInteger(j) || j < 2000 || j > 2999) throw new Error('Ungültiges Jahr');
  if (!Number.isInteger(w) || w < 1 || w > 53) throw new Error('Ungültige Kalenderwoche');
  const { von, bis } = isoWochenBereich(j, w);
  const hinweise = [];

  // ── Serviceabteilung: vorbereitet, nicht gebaut ──────────────────────────
  if (quelle === 'service') {
    if (!serviceAuftragId) throw new Error('service_auftrag_id erforderlich');
    return leeresErgebnis({
      quelle, jahr: j, woche: w, von, bis, zielId: serviceAuftragId,
      hinweise: ['Die Serviceabteilung ist noch nicht gebaut — für Serviceaufträge liegen keine Wochendaten vor.'],
    });
  }
  if (!projektId) throw new Error('projekt_id erforderlich');

  // ── 1. Kopf (neutrales Vokabular) ────────────────────────────────────────
  const projekte = await sbGet(
    `gs_projekte?id=eq.${projektId}&select=id,name,projektnummer,standort,kunde_id,projektleiter,ansprechperson,ansprech_email,partner_user_id&limit=1`,
  );
  const p = projekte[0];
  if (!p) throw new Error('Projekt nicht gefunden');
  // kuerzel kommt aus scripts/wochenbericht.sql — getrennt lesen, damit ein
  // fehlendes Feld nicht den ganzen Kopf scheitern lässt.
  let kuerzel = null;
  try { const k = await sbGet(`gs_projekte?id=eq.${projektId}&select=kuerzel&limit=1`); kuerzel = (k[0] || {}).kuerzel || null; }
  catch (_) { hinweise.push('Spalte gs_projekte.kuerzel fehlt — Berichtsnummer fällt auf die Projektnummer zurück.'); }

  let kunde = null;
  if (p.kunde_id) {
    const kd = await sbSoft(`gs_kunden?id=eq.${p.kunde_id}&select=firma&limit=1`, []);
    kunde = (kd[0] || {}).firma || null;
  }

  const kopf = {
    quelle: 'projekt',
    ziel_id: p.id,
    titel: p.name || null,
    nummer: p.projektnummer || null,
    kuerzel,
    adresse: p.standort || null,
    kunde,
    projektleiter: p.projektleiter || null,
    ansprechperson: p.ansprechperson || null,
    ansprech_email: p.ansprech_email || null,
    // Nur fürs Branding: entscheidet, ob das PDF im GS-Auftritt oder im
    // Auftritt des Partners erscheint (gs_branding.partner_id).
    partner_id: p.partner_user_id || null,
    jahr: j, woche: w, von, bis,
  };

  // ── 2. Tageszeilen — über datum, NICHT über woche/jahr ───────────────────
  const zeilen = await sbGet(
    `gs_tagesrapporte?projekt_id=eq.${projektId}&datum=gte.${von}&datum=lte.${bis}`
    + '&select=id,datum,techniker_user_id,erfasst_von,wochenrapport_id,taetigkeit,'
    + 'start_zeit,end_zeit,pause_minuten,stunden_manuell,gesamtstunden,'
    + 'ueberzeit_25,ueberzeit_50,ueberzeit_100,spesen,projektnummer_erfasst,'
    + 'abwesenheit,abwesenheit_grund,material,material_positionen,arbeiten,besonderheiten,'
    + 'woche,jahr&order=datum.asc,created_at.asc',
  );
  // Zeilen ohne woche/jahr sind genau die Altzeilen aus der Diagnose. Sie kommen
  // über den Datumsfilter herein — das wird benannt, nicht versteckt.
  const altzeilen = zeilen.filter((z) => z.woche == null || z.jahr == null).length;
  if (altzeilen) hinweise.push(`${altzeilen} Tageszeile(n) stammen aus der Zeit vor dem Wochenblatt (ohne KW-Feld). Sie sind über das Datum erfasst und vollständig enthalten.`);

  const zeilenIds = zeilen.map((z) => z.id).filter(Boolean);
  const userIds = [...new Set(zeilen.map((z) => z.techniker_user_id).filter(Boolean))];

  // ── 3. Namen ─────────────────────────────────────────────────────────────
  // Kanonische Kette: gs_tagesrapporte.techniker_user_id → gs_techniker.user_id.
  // 8 von 14 gs_techniker haben KEIN user_id — für die gibt es hier bewusst
  // keinen stillen Treffer, sondern einen benannten Unbekannten.
  const namen = {};
  if (userIds.length) {
    const t = await sbSoft(`gs_techniker?user_id=in.(${userIds.join(',')})&select=id,name,user_id`, []);
    for (const x of t) if (x.user_id) namen[x.user_id] = { id: x.id, name: x.name || null };
  }
  const technikerName = (uid) => {
    if (!uid) return 'Unbekannt (kein Benutzer hinterlegt)';
    const n = namen[uid];
    if (n && n.name) return n.name;
    return `Unbekannt (Benutzer ${String(uid).slice(0, 8)})`;
  };

  // ── 4. Tätigkeiten je Tageszeile (Katalog + Detailfelder) ────────────────
  const taetMap = {};
  if (zeilenIds.length) {
    const rows = await sbSoft(
      `gs_tagesrapport_taetigkeitenkatalog?tagesrapport_id=in.(${zeilenIds.join(',')})`
      + '&select=tagesrapport_id,taetigkeit_id,bezeichnung_snapshot,details,sortierung&order=sortierung.asc',
      null,
    );
    if (rows === null) hinweise.push('Tätigkeiten-Katalog nicht lesbar — der Abschnitt bleibt leer.');
    for (const r of rows || []) {
      (taetMap[r.tagesrapport_id] = taetMap[r.tagesrapport_id] || []).push({
        bezeichnung: r.bezeichnung_snapshot || null,
        details: r.details && typeof r.details === 'object' ? r.details : {},
      });
    }
  }

  // ── 5. Fotos — über die Tageszeilen, nicht über created_at ───────────────
  // gs_projekt_medien hat kein Datum; die Zuordnung zur KW läuft ausschliesslich
  // über tagesrapport_id → gs_tagesrapporte.datum. Fotos, die ihre Tagesbindung
  // verloren haben (ON DELETE SET NULL beim Löschen einer Zeile), erscheinen
  // deshalb bewusst nicht.
  let fotos = [];
  if (zeilenIds.length) {
    const m = await sbSoft(
      `gs_projekt_medien?tagesrapport_id=in.(${zeilenIds.join(',')})&medientyp=eq.foto`
      + '&select=id,tagesrapport_id,bucket,path,dateiname,stockwerk,wohnung,raum,bauabschnitt,notiz,created_at'
      + '&order=created_at.asc',
      [],
    );
    const datumVon = {};
    for (const z of zeilen) datumVon[z.id] = z.datum;
    fotos = (m || []).map((x) => ({
      id: x.id,
      // tagesrapport_id bleibt erhalten: die Foto-Zaehlung haengt an der
      // einzelnen Tageszeile, nicht am Kalendertag (zwei Techniker am selben
      // Tag sind zwei Zeilen mit getrennten Fotos).
      tagesrapport_id: x.tagesrapport_id || null,
      bucket: x.bucket || MEDIEN_BUCKET,
      path: x.path,
      dateiname: x.dateiname || null,
      datum: datumVon[x.tagesrapport_id] || null,
      ort: [x.stockwerk, x.wohnung, x.raum, x.bauabschnitt].filter(Boolean).join(' · ') || null,
      notiz: x.notiz || null,
    }));
  }

  // ── 5b. AUFFANGNETZ — Fotos ohne Tagesbindung ────────────────────────────
  // Drei Wege erzeugen Medienzeilen OHNE tagesrapport_id:
  //   • Projektdateien-Kachel im Master (pm_datei_upload, Kategorie 'bilder')
  //   • Foto-Knopf im Projekt-/Service-Detail des Technikers (app.html:9768)
  //   • Tageszeile gelöscht → ON DELETE SET NULL kappt die Bindung
  // Ohne diesen Block wären sie im Bericht unsichtbar. Sie erscheinen deshalb
  // in einem eigenen Abschnitt, klar getrennt von den tagesgenauen Fotos.
  //
  // ACHTUNG, bewusste Ungenauigkeit: mangels Datumsspalte ist created_at der
  // einzige Anker — das ist der HOCHLADE-Zeitpunkt, nicht der Aufnahmetag. Ein
  // am Montag nachgereichtes Freitagsfoto fällt in die Folgewoche. Genau
  // deshalb steht es in einem eigenen Abschnitt und nicht im Tagesverlauf.
  const fotosOhneTag = (await sbSoft(
    `gs_projekt_medien?projekt_id=eq.${projektId}&tagesrapport_id=is.null&medientyp=eq.foto`
    + `&created_at=gte.${von}T00:00:00&created_at=lte.${bis}T23:59:59.999`
    + '&select=id,bucket,path,dateiname,stockwerk,wohnung,raum,bauabschnitt,notiz,created_at'
    + '&order=created_at.asc',
    [],
  ) || []).map((x) => ({
    id: x.id,
    bucket: x.bucket || MEDIEN_BUCKET,
    path: x.path,
    dateiname: x.dateiname || null,
    datum: null,
    hochgeladen: x.created_at ? String(x.created_at).slice(0, 10) : null,
    ort: [x.stockwerk, x.wohnung, x.raum, x.bauabschnitt].filter(Boolean).join(' · ') || null,
    notiz: x.notiz || null,
  }));

  // ── 6. Tage aufbauen, chronologisch; im Tag die Techniker als Zeilen ─────
  const tageMap = new Map();
  for (const z of zeilen) {
    if (!tageMap.has(z.datum)) tageMap.set(z.datum, []);
    tageMap.get(z.datum).push(z);
  }
  const tage = [...tageMap.keys()].sort().map((datum) => {
    const rows = tageMap.get(datum);
    const out = rows.map((z) => {
      const abw = z.abwesenheit ? (ABWESENHEIT[z.abwesenheit] || z.abwesenheit) : null;
      return {
        id: z.id,
        techniker: technikerName(z.techniker_user_id),
        techniker_user_id: z.techniker_user_id || null,
        techniker_bekannt: !!(z.techniker_user_id && namen[z.techniker_user_id]),
        gewerk: z.taetigkeit || null,
        von: z.start_zeit ? String(z.start_zeit).slice(0, 5) : null,
        bis: z.end_zeit ? String(z.end_zeit).slice(0, 5) : null,
        pause_minuten: z.pause_minuten == null ? null : num(z.pause_minuten),
        stunden: num(z.gesamtstunden),
        stunden_manuell: !!z.stunden_manuell,
        uz25: num(z.ueberzeit_25), uz50: num(z.ueberzeit_50), uz100: num(z.ueberzeit_100),
        spesen: num(z.spesen),
        abwesenheit: abw,
        abwesenheit_grund: z.abwesenheit_grund || null,
        // Der Tätigkeiten-Katalog ist die strukturierte Quelle; `arbeiten` ist das
        // ältere Freitext-Array aus dem Arbeitsrapport. Beides wird gezeigt.
        taetigkeiten: taetMap[z.id] || [],
        arbeiten: Array.isArray(z.arbeiten) ? z.arbeiten.filter(Boolean) : [],
        notiz: z.besonderheiten || null,
        projektnummer_erfasst: z.projektnummer_erfasst || null,
        // War: fotos.filter((f) => f.datum === datum).length — das ist die
        // Zahl aller Fotos des TAGES und stand damit identisch in jeder Zeile
        // dieses Tages. Bei zwei Technikern behauptete jeder die Fotos des
        // anderen mit. Gezaehlt wird jetzt, was an DIESER Zeile haengt.
        fotos: fotos.filter((f) => f.tagesrapport_id === z.id).length,
      };
    });
    const s = (k) => r2(out.reduce((a, x) => a + x[k], 0));
    const d = new Date(`${datum}T00:00:00Z`);
    return {
      datum,
      wochentag: WOCHENTAG[d.getUTCDay()],
      zeilen: out,
      stunden: s('stunden'), uz25: s('uz25'), uz50: s('uz50'), uz100: s('uz100'), spesen: s('spesen'),
      fotos: s('fotos'),
    };
  });

  // ── 7. Material ──────────────────────────────────────────────────────────
  // Quelle sind die Tageszeilen, NICHT gs_material: dort hängt Material nur am
  // Projekt (kein Techniker, kein Verbautag) und liesse sich einer Woche gar
  // nicht zuordnen. `material_positionen` (strukturiert) und `material` (altes
  // Freitext-Array aus dem Arbeitsrapport) werden beide gelesen.
  const material = [];
  for (const z of zeilen) {
    const wer = technikerName(z.techniker_user_id);
    for (const mp of (Array.isArray(z.material_positionen) ? z.material_positionen : [])) {
      if (mp && mp.bezeichnung) material.push({ bezeichnung: String(mp.bezeichnung), menge: mp.menge ?? null, datum: z.datum, techniker: wer, strukturiert: true });
    }
    for (const mt of (Array.isArray(z.material) ? z.material : [])) {
      if (mt) material.push({ bezeichnung: String(mt), menge: null, datum: z.datum, techniker: wer, strukturiert: false });
    }
  }

  // ── 8. Einreichstatus ────────────────────────────────────────────────────
  const einreichstatus = await ermittleEinreichstatus({ projektId, userIds, zeilen, namen, jahr: j, woche: w, hinweise });

  // ── 9. Summen + ehrliche Kennzeichnung ───────────────────────────────────
  const summe = (k) => r2(tage.reduce((a, t) => a + t[k], 0));
  const summen = {
    stunden: summe('stunden'), uz25: summe('uz25'), uz50: summe('uz50'), uz100: summe('uz100'),
    spesen: summe('spesen'),
    // Gleicher Fehler wie oben, nur eine Ebene hoeher: tage.length zaehlte
    // JEDEN angelegten Kalendertag, auch Sa/So mit 0.00 h. Die Spalte "Tage"
    // im PDF meldete deshalb 7 statt 5.
    tage: tage.filter((t) => t.stunden > 0).length,
    zeilen: zeilen.length,
    // .filter(Boolean) fehlte: eine Zeile ohne techniker_user_id legte `null`
    // in das Set und wurde als eigener Techniker mitgezaehlt.
    techniker: new Set(zeilen.map((z) => z.techniker_user_id).filter(Boolean)).size,
  };
  if (!zeilen.length) hinweise.push('Für diese Kalenderwoche wurde auf dieses Projekt nichts gebucht.');
  if (!fotos.length && !fotosOhneTag.length) hinweise.push('Für diesen Zeitraum liegen keine Fotos vor.');
  if (!material.length) hinweise.push('Für diesen Zeitraum wurde kein Material erfasst.');

  return {
    quelle: 'projekt', kopf, tage, summen, material, fotos,
    fotos_ohne_tag: fotosOhneTag,
    fotos_vorhanden: fotos.length > 0 || fotosOhneTag.length > 0,
    material_vorhanden: material.length > 0,
    einreichstatus, hinweise,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Einreichstatus — wer hat die Woche eingereicht, wer nicht, wer ist unklar
// ═══════════════════════════════════════════════════════════════════════════
// gs_tagesrapporte.status wird hier bewusst NICHT gelesen. Das Feld ist ein
// Altfeld und live nachweislich unzuverlässig: in KW30/2026 stehen alle sieben
// Tageszeilen auf 'eingereicht', während der Wochenkopf 'entwurf' ist. Wahrheit
// ist gs_wochenrapporte.status je (techniker_user_id, jahr, woche).
//
// Drei Ergebnisse:
//   'eingereicht'  — Wochenkopf sagt eingereicht
//   'entwurf'      — Wochenkopf sagt entwurf
//   'unbekannt'    — kein Wochenkopf auffindbar oder keine Benutzerzuordnung.
//                    NIE stillschweigend weglassen: eine fehlende Zeile liest
//                    sich wie „alles erledigt", und genau das wäre gelogen.
async function ermittleEinreichstatus({ projektId, userIds, zeilen, namen, jahr, woche, hinweise }) {
  const out = [];

  // (a) Techniker, die tatsächlich gebucht haben
  let koepfe = [];
  if (userIds.length) {
    koepfe = await sbSoft(
      `gs_wochenrapporte?techniker_user_id=in.(${userIds.join(',')})&jahr=eq.${jahr}&woche=eq.${woche}`
      + '&select=id,techniker_user_id,status,eingereicht_am,rapport_nr',
      [],
    ) || [];
  }
  const kopfVon = {};
  for (const k of koepfe) kopfVon[k.techniker_user_id] = k;

  for (const uid of userIds) {
    const k = kopfVon[uid];
    const eigene = zeilen.filter((z) => z.techniker_user_id === uid);
    const ohneKopf = eigene.filter((z) => !z.wochenrapport_id).length;
    const bekannt = !!namen[uid];
    let status = 'unbekannt';
    let grund = null;
    if (k) {
      status = k.status === 'eingereicht' ? 'eingereicht' : 'entwurf';
      if (ohneKopf) grund = `${ohneKopf} Tageszeile(n) hängen an keinem Wochenrapport (Altzeile) und sind vom Status nicht abgedeckt.`;
    } else {
      grund = 'Kein Wochenrapport-Kopf für diese Kalenderwoche gefunden — Einreichung nicht feststellbar.';
    }
    out.push({
      techniker: bekannt ? namen[uid].name : `Unbekannt (Benutzer ${String(uid).slice(0, 8)})`,
      techniker_user_id: uid,
      techniker_bekannt: bekannt,
      hat_gebucht: true,
      // War: eigene.length — das ist die Zahl der ZEILEN, nicht der Tage. Eine
      // Woche mit sieben angelegten Zeilen, davon fuenf gearbeitet, meldete
      // "7 Tage". Gezaehlt werden jetzt die verschiedenen Kalendertage mit
      // Stunden > 0.
      tage: new Set(eigene.filter((z) => num(z.gesamtstunden) > 0).map((z) => z.datum)).size,
      stunden: r2(eigene.reduce((a, z) => a + num(z.gesamtstunden), 0)),
      status, grund,
      eingereicht_am: k ? k.eingereicht_am : null,
      rapport_nr: k ? k.rapport_nr : null,
    });
  }

  // (b) Zugewiesene Techniker, die NICHTS gebucht haben.
  // gs_projekt_techniker ist gespalten: live trägt 1 von 8 Zeilen techniker_user_id,
  // 7 von 8 nur techniker_id. Beide Wege werden gegangen. Ein Techniker ohne
  // user_id lässt sich grundsätzlich keiner Buchung zuordnen — der erscheint als
  // 'unbekannt' mit genau dieser Begründung, statt als „hat nichts gebucht".
  const zuord = await sbSoft(`gs_projekt_techniker?projekt_id=eq.${projektId}&select=techniker_id,techniker_user_id,taetigkeit`, null);
  if (zuord === null) {
    hinweise.push('Projekt-Techniker-Zuordnung nicht lesbar — die Liste zeigt nur, wer gebucht hat.');
    return out;
  }
  const tIds = [...new Set(zuord.map((z) => z.techniker_id).filter(Boolean))];
  let stamm = [];
  if (tIds.length) stamm = await sbSoft(`gs_techniker?id=in.(${tIds.join(',')})&select=id,name,user_id`, []) || [];
  const stammVon = {};
  for (const s of stamm) stammVon[s.id] = s;

  const gesehen = new Set(userIds);
  for (const z of zuord) {
    const s = z.techniker_id ? stammVon[z.techniker_id] : null;
    const uid = z.techniker_user_id || (s && s.user_id) || null;
    if (uid && gesehen.has(uid)) continue;        // hat gebucht, steht schon oben
    if (uid) gesehen.add(uid);
    const name = (s && s.name) || (uid ? `Unbekannt (Benutzer ${String(uid).slice(0, 8)})` : null);
    if (!uid) {
      out.push({
        techniker: name || `Unbekannt (Techniker ${String(z.techniker_id || '').slice(0, 8)})`,
        techniker_user_id: null, techniker_bekannt: !!name, hat_gebucht: false,
        tage: 0, stunden: 0, status: 'unbekannt',
        grund: 'Dieser Techniker hat keine Benutzerzuordnung (gs_techniker.user_id fehlt) — ob er erfasst hat, lässt sich nicht feststellen.',
        eingereicht_am: null, rapport_nr: null,
      });
      continue;
    }
    out.push({
      techniker: name, techniker_user_id: uid, techniker_bekannt: !!(s && s.name), hat_gebucht: false,
      tage: 0, stunden: 0, status: 'nichts erfasst',
      grund: 'Dem Projekt zugewiesen, aber in dieser Kalenderwoche keine Tageszeile gebucht.',
      eingereicht_am: null, rapport_nr: null,
    });
  }

  return out;
}

// Leeres, aber vollständig geformtes Ergebnis — damit Aufrufer (und die
// PDF-Erzeugung) nie auf undefined stossen.
function leeresErgebnis({ quelle, jahr, woche, von, bis, zielId, hinweise }) {
  return {
    quelle,
    kopf: {
      quelle, ziel_id: zielId, titel: null, nummer: null, kuerzel: null, adresse: null,
      kunde: null, projektleiter: null, ansprechperson: null, ansprech_email: null,
      partner_id: null,
      jahr, woche, von, bis,
    },
    tage: [],
    summen: { stunden: 0, uz25: 0, uz50: 0, uz100: 0, spesen: 0, tage: 0, zeilen: 0, techniker: 0 },
    material: [], fotos: [], fotos_ohne_tag: [], fotos_vorhanden: false, material_vorhanden: false,
    einreichstatus: [], hinweise: hinweise || [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Berichtsnummer — WB-{KUERZEL}-{JAHR}-{KW}
// ═══════════════════════════════════════════════════════════════════════════
// Kein Zähler. Die Nummer ist durch (Projekt, Jahr, KW) vollständig bestimmt;
// eine laufende Nummer käme im Format gar nicht vor. Eindeutigkeit und
// Race-Sicherheit liefert der partielle UNIQUE-Index auf
// (projekt_id, jahr, woche) — zwei gleichzeitige Erzeugungen: eine gewinnt,
// die andere bekommt 23505 und liest den bestehenden Kopf.
//
// Fallback-Kette wie festgelegt: kuerzel → projektnummer → 'GSO'.
export function berichtNummer({ kuerzel, nummer, jahr, woche, praefix = 'WB' }) {
  const roh = String(kuerzel || nummer || 'GSO');
  const teil = roh.toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')       // Leerzeichen/Sonderzeichen → Bindestrich
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20) || 'GSO';
  return `${praefix}-${teil}-${jahr}-${String(woche).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Logo für den Dokumentkopf (Eiserne Regel 6)
// ═══════════════════════════════════════════════════════════════════════════
// HIER KEIN `import.meta` — sonst lädt die ganze Datei nicht mehr.
// Vercel hat lib/wochenbericht.js als CommonJS geladen ("Failed to load the ES
// module … set "type": "module" … or use the .mjs extension") und ist an
// `import.meta.url` gestorben, BEVOR api/wochenbericht.js überhaupt lief —
// jede Aktion endete im Cockpit als „Verbindungsfehler". Ein globales
// "type": "module" ist keine Option: das würde alle 26 laufenden Funktionen
// umstellen. lib/pdf.js und lib/mail.js laden seit jeher problemlos, weil sie
// ausser import/export nichts Modulspezifisches benutzen — dieselbe Zurückhaltung
// gilt ab hier auch hier.
//
// Zuerst aus dem Funktionsbündel über process.cwd() (auf Vercel /var/task),
// sonst über die öffentliche URL — lib/ wird dank vercel.json
// outputDirectory "." direkt ausgeliefert, genau wie das PNG, das lib/mail.js
// seit jeher so einbindet. Zwei Wege, weil das Logo laut Regel 6 zum Dokument
// gehört und nicht am Bundling scheitern soll.
const LOGO_URL_OEFFENTLICH = 'https://baby-bob.vercel.app/lib/logo-gs.jpg';
let _logoCache;
export async function ladeLogo() {
  if (_logoCache !== undefined) return _logoCache;
  try {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    _logoCache = readFileSync(join(process.cwd(), 'lib', 'logo-gs.jpg'));
    return _logoCache;
  } catch (_) { /* nächster Weg */ }
  try {
    const r = await fetch(LOGO_URL_OEFFENTLICH);
    _logoCache = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  } catch (_) { _logoCache = null; }
  if (!_logoCache) console.warn('[wochenbericht] Logo nicht ladbar — Bericht wird ohne Kopfbild erzeugt.');
  return _logoCache;
}

// ═══════════════════════════════════════════════════════════════════════════
// PDF — heller Dokumentstil nach Eiserner Regel 6
// ═══════════════════════════════════════════════════════════════════════════
// Weisser Grund, schwarze Schrift, Logo oben, dünne goldene Trennlinie, sonst
// neutral. Der dunkle Command-Center-Stil gehört in die Oberfläche, nie hier.
//
// Die Funktion kennt `quelle` NICHT. Sie liest ausschliesslich das neutrale
// Vokabular aus sammleWochendaten() — deshalb muss sie beim Bau der
// Serviceabteilung nicht angefasst werden.
const FOTOS_IM_PDF = 6;
// Eigenes, kleineres Budget fuer Fotos ohne Tagesbindung: sie sind der
// Auffangposten, nicht der Hauptinhalt — sie sollen den Bericht nicht fluten.
const FOTOS_OHNE_TAG_IM_PDF = 4;
const COCKPIT_URL = 'https://baby-bob.vercel.app/gs-intern.html';

function detailsText(details) {
  const d = details || {};
  const teile = [];
  if (d.DN) teile.push(`DN ${d.DN}`);
  if (d.STK) teile.push(`${d.STK} Stk`);
  if (d.M) teile.push(`${d.M} m`);
  if (d.M2) teile.push(`${d.M2} m²`);
  if (d.BAR) teile.push(`${d.BAR} bar`);
  if (d.TYP) teile.push(String(d.TYP));
  if (d.ORT) teile.push(String(d.ORT));
  // Unbekannte Detailfelder nicht verschlucken — lieber roh zeigen als verlieren.
  for (const [k, v] of Object.entries(d)) {
    if (['DN', 'STK', 'M', 'M2', 'BAR', 'TYP', 'ORT'].includes(k)) continue;
    if (v !== '' && v != null) teile.push(`${k} ${v}`);
  }
  return teile.join(' · ');
}

function arbeitenText(z) {
  const teile = [];
  for (const t of z.taetigkeiten || []) {
    const d = detailsText(t.details);
    teile.push(d ? `${t.bezeichnung} (${d})` : String(t.bezeichnung || ''));
  }
  for (const a of z.arbeiten || []) teile.push(String(a));
  return teile.filter(Boolean).join(' · ');
}

const dmy = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '–');
const h = (n) => Number(n || 0).toFixed(2);

// Kopfzeile des Balkens auf Seite 1. Rechtsbuendig gesetzt und von lib/pdf.js
// NICHT gekuerzt — eine zu lange Zeile liefe ins Logo. Gekuerzt wird deshalb
// hier, und zwar gezielt die Baustellenbezeichnung: Bericht-Nr, Projektnummer
// und KW bleiben immer vollstaendig, weil sie das Blatt identifizieren. Ein
// abgeschnittenes "K…" statt "KW 30/2026" waere genau der falsche Verlust.
const KOPFZEILE_MAX_W = 330;   // pt, freie Balkenbreite rechts neben dem Logo
function kopfzeile(k, nr) {
  const fest = [nr, k.nummer ? `Projekt ${k.nummer}` : null, `KW ${k.woche}/${k.jahr}`].filter(Boolean).join(' · ');
  if (!k.titel) return fest;
  const platz = KOPFZEILE_MAX_W - textWidth(`${fest} · `, 8.5, false);
  // Unter ~40 pt bleibt nur noch ein Stummel — dann lieber ganz weglassen,
  // die Baustelle steht auf Seite 1 ohnehin gross in der Objekt-Kachel.
  if (platz < 40) return fest;
  const teile = [nr, k.nummer ? `Projekt ${k.nummer}` : null, clipText(k.titel, platz, 8.5, false), `KW ${k.woche}/${k.jahr}`];
  return teile.filter(Boolean).join(' · ');
}

export function buildWochenberichtPdf(daten, { logo, fotos, fotosOhneTag, berichtNr, branding } = {}) {
  const k = daten.kopf;
  const blocks = [];
  const nr = berichtNr || berichtNummer({ kuerzel: k.kuerzel, nummer: k.nummer, jahr: k.jahr, woche: k.woche });
  const marke = branding || null;

  // Techniker gehören in den Kopf, nicht in jede Tagestabelle. Bei genau EINEM
  // Techniker fällt die Spalte unten weg — der Name stand sonst in jeder Zeile
  // jeder Tabelle. Bei mehreren bleibt die Spalte stehen: dann trägt sie
  // Information, die sich nicht in den Kopf verschieben lässt.
  const alleNamen = [];
  for (const tag of daten.tage || []) {
    for (const z of tag.zeilen || []) if (z.techniker && !alleNamen.includes(z.techniker)) alleNamen.push(z.techniker);
  }
  const einTechniker = alleNamen.length === 1 ? alleNamen[0] : null;

  // ── Zwei Info-Kacheln statt einer Liste aus zwölf Zeilen ──
  // Links WO gearbeitet wurde, rechts WANN und von WEM. Beides sind die
  // Angaben, die ein Bauleiter zuerst sucht; alles Weitere kommt danach.
  const objekt = [k.titel || '–'];
  if (k.adresse && k.adresse !== k.titel) objekt.push(k.adresse);
  if (k.nummer) objekt.push(`Projekt ${k.nummer}`);
  if (k.kunde) objekt.push(k.kunde);

  const ausfuehrung = [`KW ${k.woche}/${k.jahr} · ${dmy(k.von)} – ${dmy(k.bis)}`];
  if (alleNamen.length) ausfuehrung.push(alleNamen.join(' · '));
  const bl = [k.projektleiter, k.ansprechperson].filter(Boolean).join(' · ');
  if (bl) ausfuehrung.push(`Bauleitung: ${bl}`);

  blocks.push({
    t: 'tiles',
    items: [
      { label: 'Objekt', value: objekt.join('\n') },
      { label: 'Ausführung', value: ausfuehrung.join('\n') },
    ],
  });

  // ── Summen ──
  // Die Wochensumme ist die Zahl, die zuerst gesucht wird. Sie wird über GRÖSSE
  // hervorgehoben, nicht über Fettdruck: Normalstunden 18 pt, Spesen 14 pt, der
  // Rest bleibt bei 9 pt und ruhig. Würde man alles fetten, hübe sich nichts ab.
  // Zusätzlich bekommt dieser Abschnitt mehr Luft nach oben als jeder andere.
  const s = daten.summen;
  blocks.push({ t: 'sp', size: 14 });
  blocks.push({ t: 'h1', text: 'Wochenübersicht' });
  blocks.push({
    t: 'table',
    cols: [
      { w: 90, label: 'Normalstunden', align: 'right' }, { w: 70, label: 'ÜZ 25 %', align: 'right' },
      { w: 70, label: 'ÜZ 50 %', align: 'right' }, { w: 70, label: 'ÜZ 100 %', align: 'right' },
      { w: 80, label: 'Spesen CHF', align: 'right' }, { w: 50, label: 'Tage', align: 'right' },
      { w: 60, label: 'Techniker', align: 'right' },
    ],
    rows: [[{ text: h(s.stunden), bold: true, size: 18, align: 'right' }, { text: h(s.uz25), align: 'right' },
      { text: h(s.uz50), align: 'right' }, { text: h(s.uz100), align: 'right' },
      { text: h(s.spesen), bold: true, size: 14, align: 'right' }, { text: String(s.tage), align: 'right' },
      { text: String(s.techniker), align: 'right' }]],
  });

  // ── Aufwand je Techniker ──
  // Die Spalte "Status" ist hier RAUS. 'entwurf'/'eingereicht' ist unser interner
  // Bearbeitungsstand des Wochenrapports; im Kunden-/Bauleiter-Dokument hat er
  // nichts zu suchen und liest sich wie eine Aussage über die Bauleistung.
  // Der Stand bleibt in daten.einreichstatus und damit in der Cockpit-Vorschau.
  //
  // Die ehrliche Kennzeichnung bleibt trotzdem erhalten: 'unbekannt' und
  // 'nichts erfasst' sind Aussagen über die DATENLAGE, nicht über den
  // Bearbeitungsstand — sie wandern in die Bemerkung, statt zu verschwinden.
  if ((daten.einreichstatus || []).length) {
    blocks.push({ t: 'h2', text: 'Aufwand je Techniker' });
    blocks.push({
      t: 'table', size: 8.5,
      cols: [{ w: 110, label: 'Techniker' }, { w: 40, label: 'Tage', align: 'right' },
        { w: 45, label: 'Std', align: 'right' }, { w: 288, label: 'Bemerkung' }],
      rows: daten.einreichstatus.map((e) => {
        const offen = e.status === 'unbekannt' || e.status === 'nichts erfasst';
        const bem = e.grund || '';
        return [
          e.techniker,
          { text: String(e.tage), align: 'right' },
          { text: h(e.stunden), align: 'right' },
          { text: bem, bold: offen && !!bem },
        ];
      }),
    });
  }

  // ── Tage, chronologisch; im Tag die Techniker als Zeilen ──
  //
  // Tage ganz ohne Inhalt (0.00 h, keine Überzeit, keine Spesen, keine
  // Abwesenheit, kein Arbeitstext, keine Notiz, keine Fotos) bekommen KEINE
  // eigene Tabelle mehr. So entstehen sonst Samstag/Sonntag als vollwertige
  // Tagesblöcke mit "0.00 Std" — drei Zentimeter Papier für die Aussage
  // „nichts passiert". Sie werden unten zu einer Sammelzeile zusammengefasst,
  // aber nicht verschwiegen: weglassen liesse offen, ob der Tag fehlt oder leer ist.
  const tagLeer = (tag) => tag.stunden === 0
    && !(tag.uz25 + tag.uz50 + tag.uz100) && !tag.spesen
    && (tag.zeilen || []).every((z) => !z.abwesenheit && !arbeitenText(z) && !z.notiz && !z.fotos);
  const aktiveTage = (daten.tage || []).filter((t) => !tagLeer(t));
  const leereTage = (daten.tage || []).filter(tagLeer);

  blocks.push({ t: 'h1', text: 'Tagesverlauf' });
  if (!daten.tage.length) {
    blocks.push({ t: 'text', text: 'In dieser Kalenderwoche wurde auf dieses Projekt nichts gebucht.' });
  }
  for (const tag of aktiveTage) {
    blocks.push({ t: 'need', h: 96 });
    blocks.push({ t: 'h2', text: `${tag.wochentag}, ${dmy(tag.datum)}` });
    // Techniker-Spalte nur bei mehreren Köpfen (bei einem steht der Name im Kopf).
    // Std/ÜZ brauchen echte Breite: '10.00' brach in einer 34er-Spalte um und
    // stand als '10.0' über '0' — Zahlen müssen auf einer Zeile stehen bleiben.
    const cols = [];
    if (!einTechniker) cols.push({ w: 92, label: 'Techniker' });
    cols.push({ w: 58, label: 'Zeit' }, { w: 46, label: 'Std', align: 'right' },
      { w: 42, label: 'ÜZ', align: 'right' }, { w: 58, label: 'Gewerk' },
      { w: einTechniker ? 277 : 185, label: 'Ausgeführte Arbeiten' });
    blocks.push({
      t: 'table', size: 8.5, gap: 4, cols,
      rows: tag.zeilen.map((z) => {
        const uz = z.uz25 + z.uz50 + z.uz100;
        const zeit = z.abwesenheit ? '—' : (z.von && z.bis ? `${z.von}–${z.bis}` : '—');
        const arbeit = z.abwesenheit
          ? `Abwesend: ${z.abwesenheit}${z.abwesenheit_grund ? ' (' + z.abwesenheit_grund + ')' : ''}`
          : (arbeitenText(z) || '—');
        // Gewerk nur zeigen, wenn auch Zeit dahintersteht. Sonst behauptet eine
        // 0.00-h-Zeile ein Gewerk, das an dem Tag niemand ausgeführt hat — genau
        // die Inkonsistenz, bei der ein Tag „Sanitär" zeigte und der nächste nichts.
        const gewerk = (z.stunden || uz || z.abwesenheit) ? (z.gewerk || '—') : '—';
        const zeile = [];
        if (!einTechniker) zeile.push(z.techniker);
        zeile.push(zeit,
          { text: h(z.stunden), align: 'right' },
          { text: uz ? h(uz) : '—', align: 'right' },
          gewerk, arbeit);
        return zeile;
      }),
    });
    // Freitext/Diktat separat unter dem Gitter — dort darf er über die volle
    // Satzbreite laufen, statt eine Tabellenspalte zu sprengen.
    for (const z of tag.zeilen) {
      if (z.notiz) blocks.push({ t: 'text', text: einTechniker ? `Notiz: ${z.notiz}` : `Notiz ${z.techniker}: ${z.notiz}`, size: 8.5, lead: 12 });
    }
    const tsum = `Tagestotal: ${h(tag.stunden)} h`
      + (tag.uz25 + tag.uz50 + tag.uz100 ? ` · Überzeit ${h(tag.uz25 + tag.uz50 + tag.uz100)} h` : '')
      + (tag.spesen ? ` · Spesen CHF ${h(tag.spesen)}` : '');
    blocks.push({ t: 'text', text: tsum, size: 8.5, bold: true, lead: 13 });
    blocks.push({ t: 'sp', size: 4 });
  }
  if (leereTage.length) {
    const teile = leereTage.map((t) => `${t.wochentag} ${dmy(t.datum).slice(0, 6)}`);
    const liste = teile.length === 1 ? teile[0]
      : `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`;
    blocks.push({ t: 'text', text: `${liste}: keine Stunden erfasst.`, size: 8.5, lead: 13 });
    blocks.push({ t: 'sp', size: 4 });
  }

  // ── Material — BEDINGT. Keine leere Überschrift. ──
  if (daten.material_vorhanden) {
    blocks.push({ t: 'need', h: 90 });
    blocks.push({ t: 'h1', text: 'Material' });
    blocks.push({
      t: 'table', size: 8.5,
      cols: [{ w: 200, label: 'Bezeichnung' }, { w: 60, label: 'Menge', align: 'right' },
        { w: 73, label: 'Datum' }, { w: 150, label: 'Erfasst von' }],
      rows: daten.material.map((m) => [
        m.bezeichnung,
        { text: m.menge == null ? '—' : String(m.menge), align: 'right' },
        dmy(m.datum), m.techniker,
      ]),
    });
  }

  // ── Fotodokumentation — 2×2-Raster, höchstens sechs, Rest als Verweis ──
  // Der Abschnitt steht IMMER, auch ohne Bilder: ein Bauleiter, der keine
  // Fotoseite findet, weiss nicht, ob es keine gab oder ob sie fehlt.
  const bilder = (fotos || []).filter((f) => f && f.buf);
  const bilderOhneTag = (fotosOhneTag || []).filter((f) => f && f.buf);
  blocks.push({ t: 'need', h: 120 });
  blocks.push({ t: 'h1', text: 'Fotodokumentation' });
  if (bilder.length) {
    const n = (daten.fotos || []).length;
    blocks.push({ t: 'text', text: n > FOTOS_IM_PDF ? `${n} erfasst, ${FOTOS_IM_PDF} in diesem Bericht abgebildet` : `${n} erfasst`, size: 8.5, lead: 13 });
    blocks.push({
      t: 'imgrow', perRow: 2, maxH: 168, gap: 14,
      images: bilder.map((f) => f.buf),
      captions: bilder.map((f) => f.caption || ''),
    });
  } else if (!bilderOhneTag.length) {
    blocks.push({ t: 'text', text: 'Für diesen Zeitraum liegen keine Fotos vor.', size: 9, lead: 13 });
  } else {
    blocks.push({ t: 'text', text: 'Keinem einzelnen Tag zugeordnet — siehe unten.', size: 9, lead: 13 });
  }
  const rest = (daten.fotos || []).length - bilder.length;
  if (rest > 0) {
    blocks.push({ t: 'sp', size: 4 });
    blocks.push({ t: 'text', text: `Weitere ${rest} Foto(s) dieser Woche liegen in der Projektgalerie: Cockpit → Projekt „${k.titel || ''}" → Medien · ${COCKPIT_URL}`, size: 8.5 });
  }

  // ── Fotos ohne Tageszuordnung — der Auffangposten ──
  // Diese Bilder wurden nicht über eine Tageszeile hochgeladen, sondern über
  // die Projektgalerie oder das Projekt-Detail. Sie gehören zur Woche, aber
  // nicht zu einem Tag. Das steht hier ausdrücklich, statt sie stillschweigend
  // einem Tag zuzuschlagen, den niemand belegen kann.
  if (bilderOhneTag.length) {
    const nOhne = (daten.fotos_ohne_tag || []).length;
    blocks.push({ t: 'sp', size: 8 });
    blocks.push({ t: 'need', h: 120 });
    blocks.push({ t: 'h2', text: 'Ohne Tageszuordnung' });
    blocks.push({
      t: 'text',
      text: nOhne > FOTOS_OHNE_TAG_IM_PDF
        ? `${nOhne} Foto(s) über die Projektgalerie erfasst, ${FOTOS_OHNE_TAG_IM_PDF} abgebildet. Datum = Hochladezeitpunkt, nicht Aufnahmetag.`
        : `${nOhne} Foto(s) über die Projektgalerie erfasst. Datum = Hochladezeitpunkt, nicht Aufnahmetag.`,
      size: 8.5, lead: 13,
    });
    blocks.push({
      t: 'imgrow', perRow: 2, maxH: 168, gap: 14,
      images: bilderOhneTag.map((f) => f.buf),
      captions: bilderOhneTag.map((f) => f.caption || ''),
    });
  }

  // ── Hinweise: alles, was der Bericht NICHT weiss, steht drin ──
  const relevant = (daten.hinweise || []).filter((x) => !/keine Fotos/.test(x));
  if (relevant.length) {
    blocks.push({ t: 'need', h: 60 });
    blocks.push({ t: 'h2', text: 'Hinweise zur Datenlage' });
    blocks.push({ t: 'sp', size: 2 });
    for (const x of relevant) blocks.push({ t: 'text', text: `• ${x}`, size: 8.5, lead: 14 });
  }

  blocks.push({ t: 'sp', size: 10 });
  blocks.push({ t: 'text', text: `Erstellt ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${(marke && marke.firmenname) || 'George Solutions'} · automatisch aus den Tagesrapporten erzeugt`, size: 7.5, lead: 11 });

  return buildPdf({
    style: 'brief',
    balance: true,          // letzte Seite nicht fast leer stehen lassen
    branding: marke || undefined,
    title: 'Wochenbericht',
    // Bis hierher trug der Kopf nur die Bericht-Nr (die das KUNDEN-Kuerzel
    // kodiert, nicht das Projekt) und die KW. Die Projektnummer stand allein
    // in der Objekt-Kachel auf Seite 1.
    //   • subtitle wird nur auf Seite 1 gesetzt (lib/pdf.js:376) → dort steht
    //     jetzt Nummer UND Baustellenbezeichnung, rechtsbuendig und deshalb
    //     hart auf die freie Balkenbreite gekuerzt (der Balken kuerzt nicht
    //     selbst, eine zu lange Zeile liefe ins Logo).
    //   • footer traegt die Folgeseiten (lib/pdf.js:390) → dort die Nummer
    //     ohne Baustellenname, damit die Zeile kurz bleibt.
    subtitle: kopfzeile(k, nr),
    logo: logo || (marke && marke.logo) || undefined,
    footer: k.nummer ? `${nr} · Projekt ${k.nummer}` : nr,
    blocks,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// WOCHENRAPPORT — Stundenblatt eines Technikers, Techniker x Kalenderwoche
// ═══════════════════════════════════════════════════════════════════════════
// Nicht zu verwechseln mit dem Wochenbericht: der ist Projekt x KW und geht an
// den Bauleiter. Dieser hier ist das Stundenblatt, das der Techniker
// unterschreibt und die Buchhaltung ablegt — eine Zeile je Tag, quer ueber
// alle Projekte, mit beiden Unterschriften aus gs_wochenrapporte.
//
// Die Zeilen kommen ueber wochenrapport_id, nicht ueber ein Datumsfenster:
// dieses Dokument gehoert zu genau EINEM Wochenrapport-Kopf, und dessen
// Zeilen sind die Wahrheit. Altzeilen ohne Kopf tauchen hier bewusst nicht auf.
const UNTERSCHRIFT_BUCKET = 'projektdateien';
// Zeichen je Tätigkeitszelle im Stundenblatt. 150 sind rund drei Zeilen in der
// 147-pt-Spalte — genug, um den Tag wiederzuerkennen, kurz genug, dass eine
// Woche auf ein Blatt passt.
const TAETIGKEIT_KURZ = 150;

export async function sammleWochenrapport({ wochenrapportId }) {
  const kopfRows = await sbGet(`gs_wochenrapporte?id=eq.${wochenrapportId}&select=*&limit=1`);
  const kopf = kopfRows && kopfRows[0];
  if (!kopf) return null;

  const zeilen = await sbSoft(
    `gs_tagesrapporte?wochenrapport_id=eq.${wochenrapportId}`
    + '&select=id,datum,projekt_id,start_zeit,end_zeit,pause_minuten,gesamtstunden,stunden_manuell,'
    + 'ueberzeit_25,ueberzeit_50,ueberzeit_100,spesen,taetigkeit,arbeiten,besonderheiten,'
    + 'abwesenheit,abwesenheit_grund,abrechnung_status&order=datum.asc',
    [],
  ) || [];

  const projIds = [...new Set(zeilen.map((z) => z.projekt_id).filter(Boolean))];
  const projMap = {};
  if (projIds.length) {
    const pr = await sbSoft(`gs_projekte?id=in.(${projIds.join(',')})&select=id,name,projektnummer`, []) || [];
    for (const x of pr) projMap[x.id] = x;
  }

  let technikerName = 'Unbekannt';
  if (kopf.techniker_user_id) {
    const t = await sbSoft(`gs_techniker?user_id=eq.${kopf.techniker_user_id}&select=name&limit=1`, []) || [];
    if (t[0] && t[0].name) technikerName = t[0].name;
  }

  const { von, bis } = isoWochenBereich(kopf.jahr, kopf.woche);
  const r2s = (k) => r2(zeilen.reduce((a, z) => a + num(z[k]), 0));
  return {
    kopf: {
      id: kopf.id, rapport_nr: kopf.rapport_nr || null, status: kopf.status || null,
      jahr: kopf.jahr, woche: kopf.woche, von, bis,
      techniker: technikerName, techniker_user_id: kopf.techniker_user_id || null,
      unterschrift_technik_path: kopf.unterschrift_technik_path || null,
      unterschrift_technik_name: kopf.unterschrift_technik_name || null,
      unterschrift_technik_at: kopf.unterschrift_technik_at || null,
      unterschrift_kunde_path: kopf.unterschrift_kunde_path || null,
      unterschrift_kunde_name: kopf.unterschrift_kunde_name || null,
      unterschrift_kunde_at: kopf.unterschrift_kunde_at || null,
      unterschrift_kunde_status: kopf.unterschrift_kunde_status || null,
      unterschrift_kunde_grund: kopf.unterschrift_kunde_grund || null,
    },
    zeilen: zeilen.map((z) => ({
      ...z,
      wochentag: WOCHENTAG[new Date(`${z.datum}T00:00:00Z`).getUTCDay()],
      projektnummer: z.projekt_id ? (projMap[z.projekt_id] || {}).projektnummer || null : null,
      projekt_name: z.projekt_id ? (projMap[z.projekt_id] || {}).name || null : null,
    })),
    summen: {
      stunden: r2s('gesamtstunden'), uz25: r2s('ueberzeit_25'), uz50: r2s('ueberzeit_50'),
      uz100: r2s('ueberzeit_100'), spesen: r2s('spesen'),
      tage: new Set(zeilen.filter((z) => num(z.gesamtstunden) > 0).map((z) => z.datum)).size,
    },
  };
}

export function buildWochenrapportPdf(daten, { logo, unterschriften, branding } = {}) {
  const k = daten.kopf;
  const s = daten.summen;
  const blocks = [];
  const u = unterschriften || {};

  blocks.push({
    t: 'tiles',
    items: [
      { label: 'Techniker', value: [k.techniker, k.rapport_nr || '–'].filter(Boolean).join('\n') },
      { label: 'Zeitraum', value: `KW ${k.woche}/${k.jahr} · ${dmy(k.von)} – ${dmy(k.bis)}\n${s.tage} Arbeitstag(e)` },
    ],
  });

  blocks.push({ t: 'sp', size: 12 });
  blocks.push({ t: 'h1', text: 'Stunden' });

  const uzSum = (z) => num(z.ueberzeit_25) + num(z.ueberzeit_50) + num(z.ueberzeit_100);
  blocks.push({
    t: 'table', size: 8.5, gap: 4,
    cols: [
      { w: 66, label: 'Tag' }, { w: 78, label: 'Projekt' }, { w: 70, label: 'Zeit' },
      { w: 42, label: 'Std', align: 'right' }, { w: 38, label: 'ÜZ', align: 'right' },
      { w: 50, label: 'Spesen', align: 'right' }, { w: 147, label: 'Tätigkeit' },
    ],
    rows: (daten.zeilen || []).map((z) => {
      const zeit = z.abwesenheit ? '—'
        : (z.start_zeit && z.end_zeit ? `${String(z.start_zeit).slice(0, 5)}–${String(z.end_zeit).slice(0, 5)}` : '—');
      const uz = uzSum(z);
      // Der Tätigkeitstext wird hier GEKÜRZT. Das Stundenblatt ist ein
      // Zahlendokument; ein voller Tagesbericht sprengte die Zeile auf eine
      // halbe Seite und machte aus einer Woche drei Blätter. Der vollständige
      // Text steht im Wochenbericht — das ist das Dokument, das ihn tragen soll.
      const volltext = z.abwesenheit
        ? `Abwesend: ${ABWESENHEIT[z.abwesenheit] || z.abwesenheit}${z.abwesenheit_grund ? ' (' + z.abwesenheit_grund + ')' : ''}`
        : ((Array.isArray(z.arbeiten) ? z.arbeiten.filter(Boolean) : []).join(' · ') || '—');
      const was = volltext.length > TAETIGKEIT_KURZ ? `${volltext.slice(0, TAETIGKEIT_KURZ - 1).trimEnd()}…` : volltext;
      return [
        `${z.wochentag} ${dmy(z.datum).slice(0, 6)}`,
        z.projektnummer || (z.projekt_name ? String(z.projekt_name).slice(0, 18) : '—'),
        zeit,
        { text: h(z.gesamtstunden), align: 'right' },
        { text: uz ? h(uz) : '—', align: 'right' },
        { text: num(z.spesen) ? h(z.spesen) : '—', align: 'right' },
        was,
      ];
    }),
  });

  blocks.push({ t: 'sp', size: 10 });
  blocks.push({
    t: 'table',
    cols: [
      { w: 90, label: 'Normalstunden', align: 'right' }, { w: 70, label: 'ÜZ 25 %', align: 'right' },
      { w: 70, label: 'ÜZ 50 %', align: 'right' }, { w: 70, label: 'ÜZ 100 %', align: 'right' },
      { w: 80, label: 'Spesen CHF', align: 'right' }, { w: 60, label: 'Tage', align: 'right' },
    ],
    rows: [[
      { text: h(s.stunden), bold: true, size: 18, align: 'right' },
      { text: h(s.uz25), align: 'right' }, { text: h(s.uz50), align: 'right' }, { text: h(s.uz100), align: 'right' },
      { text: h(s.spesen), bold: true, size: 14, align: 'right' },
      { text: String(s.tage), align: 'right' },
    ]],
  });

  const gekuerzt = (daten.zeilen || []).some((z) => {
    const t = (Array.isArray(z.arbeiten) ? z.arbeiten.filter(Boolean) : []).join(' · ');
    return t.length > TAETIGKEIT_KURZ;
  });
  if (gekuerzt) {
    blocks.push({ t: 'sp', size: 4 });
    blocks.push({ t: 'text', text: 'Die Tätigkeitstexte sind in der Tabelle gekürzt. Vollständig stehen sie im Wochenbericht der jeweiligen Kalenderwoche.', size: 8, lead: 11 });
  }

  // ── Unterschriften ──
  // Fehlt eine, steht das ausdruecklich da. Ein leeres Feld liesse offen, ob
  // nicht unterschrieben wurde oder ob das Bild nur nicht geladen werden konnte.
  blocks.push({ t: 'sp', size: 16 });
  blocks.push({ t: 'need', h: 130 });
  blocks.push({ t: 'h2', text: 'Unterschriften' });
  const bilder = [], bu = [];
  if (u.technik) { bilder.push(u.technik); bu.push(`Technik · ${k.unterschrift_technik_name || k.techniker}${k.unterschrift_technik_at ? ' · ' + dmy(String(k.unterschrift_technik_at).slice(0, 10)) : ''}`); }
  if (u.kunde) { bilder.push(u.kunde); bu.push(`Kunde · ${k.unterschrift_kunde_name || 'signiert'}${k.unterschrift_kunde_at ? ' · ' + dmy(String(k.unterschrift_kunde_at).slice(0, 10)) : ''}`); }
  if (bilder.length) blocks.push({ t: 'imgrow', perRow: 2, maxH: 64, gap: 20, images: bilder, captions: bu });
  const fehlt = [];
  if (!u.technik) fehlt.push(k.unterschrift_technik_path ? 'Unterschrift Technik konnte nicht geladen werden.' : 'Technik: nicht unterschrieben.');
  if (!u.kunde) {
    fehlt.push(k.unterschrift_kunde_path ? 'Unterschrift Kunde konnte nicht geladen werden.'
      : `Kunde: ${k.unterschrift_kunde_status === 'verweigert' ? 'verweigert' : 'nicht unterschrieben'}${k.unterschrift_kunde_grund ? ' (' + k.unterschrift_kunde_grund + ')' : ''}.`);
  }
  for (const f of fehlt) blocks.push({ t: 'text', text: f, size: 8.5, lead: 12 });

  const nr = k.rapport_nr || `WR-${k.jahr}-${k.woche}`;
  return buildPdf({
    balance: true,
    branding: branding || undefined,
    style: 'brief',
    title: 'Wochenrapport',
    subtitle: clipText([nr, k.techniker, `KW ${k.woche}/${k.jahr}`].filter(Boolean).join(' · '), KOPFZEILE_MAX_W, 8.5, false),
    logo: logo || (branding && branding.logo) || undefined,
    footer: `${nr} · ${k.techniker}`,
    blocks,
  });
}

export async function erzeugeWochenrapport({ wochenrapportId }) {
  const daten = await sammleWochenrapport({ wochenrapportId });
  if (!daten) return null;
  const k = daten.kopf;
  const hole = async (pfad) => (pfad ? ladeFotoBytes({ bucket: UNTERSCHRIFT_BUCKET, path: pfad }) : null);
  const unterschriften = {
    technik: await hole(k.unterschrift_technik_path),
    kunde: await hole(k.unterschrift_kunde_path),
  };
  const marke = await ladeBranding({ partnerId: null });
  const pdf = buildWochenrapportPdf(daten, {
    logo: marke.logo || await ladeLogo(), unterschriften, branding: marke,
  });
  return { pdf, daten, nr: k.rapport_nr || `WR-${k.jahr}-${k.woche}` };
}

// ═══════════════════════════════════════════════════════════════════════════
// FOTODOKUMENTATION — eigenes Dokument, gleicher Motor
// ═══════════════════════════════════════════════════════════════════════════
// Bewusst KEIN zweiter Datenweg: die Bilder kommen aus sammleWochendaten(),
// derselben Sammlung, die auch der Wochenbericht benutzt. Was dort im Bericht
// als Anhang mit sechs Bildern erscheint, ist hier das ganze Dokument — mit
// mehr Bildern, nach Tagen gegliedert.
//
// Kein Editor, keine Umsortierung: die Reihenfolge ist Tag, dann created_at.
// Das ist die Reihenfolge, in der gearbeitet und fotografiert wurde.
const FOTOS_DOKU_MAX = 24;          // 2x3 je Seite -> hoechstens vier Fotoseiten

export function buildFotodokuPdf(daten, { logo, bilderJeTag, bilderOhneTag, berichtNr, branding } = {}) {
  const k = daten.kopf;
  const nr = berichtNr || berichtNummer({ kuerzel: k.kuerzel, nummer: k.nummer, jahr: k.jahr, woche: k.woche });
  const blocks = [];
  const marke = branding || null;

  const objekt = [k.titel || '–'];
  if (k.adresse && k.adresse !== k.titel) objekt.push(k.adresse);
  if (k.nummer) objekt.push(`Projekt ${k.nummer}`);
  if (k.kunde) objekt.push(k.kunde);
  const gesamt = (bilderJeTag || []).reduce((a, g) => a + g.bilder.length, 0) + (bilderOhneTag || []).length;

  blocks.push({
    t: 'tiles',
    items: [
      { label: 'Objekt', value: objekt.join('\n') },
      { label: 'Zeitraum', value: `KW ${k.woche}/${k.jahr} · ${dmy(k.von)} – ${dmy(k.bis)}\n${gesamt} Foto(s)` },
    ],
  });

  blocks.push({ t: 'sp', size: 12 });

  if (!gesamt) {
    blocks.push({ t: 'h1', text: 'Fotodokumentation' });
    blocks.push({ t: 'text', text: 'Für diesen Zeitraum liegen keine Fotos vor.', size: 9, lead: 13 });
  }

  // Je Tag ein Abschnitt. Der Tag steht als Ueberschrift, damit die Bilder
  // nicht nur eine Galerie sind, sondern ein Verlauf.
  for (const g of bilderJeTag || []) {
    if (!g.bilder.length) continue;
    blocks.push({ t: 'need', h: 150 });
    blocks.push({ t: 'h2', text: `${g.wochentag}, ${dmy(g.datum)}` });
    if (g.arbeiten) blocks.push({ t: 'text', text: g.arbeiten, size: 8.5, lead: 12 });
    blocks.push({
      t: 'imgrow', perRow: 2, maxH: 190, gap: 14,
      images: g.bilder.map((f) => f.buf),
      captions: g.bilder.map((f) => f.caption || ''),
    });
    blocks.push({ t: 'sp', size: 6 });
  }

  if ((bilderOhneTag || []).length) {
    blocks.push({ t: 'sp', size: 8 });
    blocks.push({ t: 'need', h: 150 });
    blocks.push({ t: 'h2', text: 'Ohne Tageszuordnung' });
    blocks.push({ t: 'text', text: 'Über die Projektgalerie erfasst. Datum = Hochladezeitpunkt, nicht Aufnahmetag.', size: 8.5, lead: 12 });
    blocks.push({
      t: 'imgrow', perRow: 2, maxH: 190, gap: 14,
      images: bilderOhneTag.map((f) => f.buf),
      captions: bilderOhneTag.map((f) => f.caption || ''),
    });
  }

  const rest = ((daten.fotos || []).length + (daten.fotos_ohne_tag || []).length) - gesamt;
  if (rest > 0) {
    blocks.push({ t: 'sp', size: 6 });
    blocks.push({ t: 'text', text: `Weitere ${rest} Foto(s) dieser Woche sind hier nicht abgebildet (Deckel ${FOTOS_DOKU_MAX}, oder kein einbettbares JPEG). Sie liegen in der Projektgalerie: ${COCKPIT_URL}`, size: 8.5 });
  }

  return buildPdf({
    balance: true,
    branding: marke || undefined,
    style: 'brief',
    title: 'Fotodokumentation',
    subtitle: kopfzeile(k, nr),
    logo: logo || (marke && marke.logo) || undefined,
    footer: k.nummer ? `${nr} · Projekt ${k.nummer}` : nr,
    blocks,
  });
}

// Sammelt Fotos + Bytes und baut das Dokument. Nutzt sammleWochendaten und
// ladeFotoBytes unveraendert mit — keine zweite Medienabfrage.
export async function erzeugeFotodoku({ projektId, jahr, woche }) {
  const daten = await sammleWochendaten({ quelle: 'projekt', projektId, jahr, woche });

  // Reihenfolge = Tagesverlauf. Innerhalb eines Tages die Sammelreihenfolge
  // (created_at.asc aus der Abfrage). Budget wird vom ersten Tag an vergeben,
  // damit der Anfang der Woche vollstaendig ist statt ueberall Luecken.
  let rest = FOTOS_DOKU_MAX;
  const bilderJeTag = [];
  for (const tag of daten.tage || []) {
    if (rest <= 0) break;
    const desTages = (daten.fotos || []).filter((f) => f.datum === tag.datum).slice(0, rest);
    if (!desTages.length) continue;
    const bilder = [];
    for (const f of desTages) {
      const buf = await ladeFotoBytes(f);
      if (buf) bilder.push({ buf, caption: fotoCaption(f) });
    }
    rest -= desTages.length;
    if (bilder.length) {
      const arbeiten = (tag.zeilen || []).map((z) => arbeitenText(z)).filter(Boolean).join(' · ');
      bilderJeTag.push({ datum: tag.datum, wochentag: tag.wochentag, arbeiten: arbeiten || null, bilder });
    }
  }
  const bilderOhneTag = [];
  for (const f of (daten.fotos_ohne_tag || []).slice(0, Math.max(0, rest))) {
    const buf = await ladeFotoBytes(f);
    if (buf) bilderOhneTag.push({ buf, caption: fotoCaption(f) });
  }

  const nr = berichtNummer({ kuerzel: daten.kopf.kuerzel, nummer: daten.kopf.nummer, jahr, woche });
  const marke = await ladeBranding({ partnerId: (daten.kopf && daten.kopf.partner_id) || null });
  const pdf = buildFotodokuPdf(daten, {
    logo: marke.logo || await ladeLogo(),
    bilderJeTag, bilderOhneTag, berichtNr: nr, branding: marke,
  });
  const abgebildet = bilderJeTag.reduce((a, g) => a + g.bilder.length, 0) + bilderOhneTag.length;
  return { pdf, daten, nr, abgebildet };
}

// Vorschau: was WUERDE im Dokument stehen. Keine Bytes, keine Bilder — nur die
// Liste, damit sichtbar ist, was kommt, bevor gerechnet wird. Bewusst ohne
// Editor und ohne Umsortieren.
export async function fotodokuVorschau({ projektId, jahr, woche }) {
  const daten = await sammleWochendaten({ quelle: 'projekt', projektId, jahr, woche });
  let rest = FOTOS_DOKU_MAX;
  const tage = [];
  for (const tag of daten.tage || []) {
    const desTages = (daten.fotos || []).filter((f) => f.datum === tag.datum);
    if (!desTages.length) continue;
    const drin = Math.max(0, Math.min(desTages.length, rest));
    rest -= drin;
    tage.push({
      datum: tag.datum, wochentag: tag.wochentag,
      anzahl: desTages.length, abgebildet: drin,
      dateien: desTages.map((f) => ({ dateiname: f.dateiname, ort: f.ort, notiz: f.notiz })),
    });
  }
  const ohneTag = (daten.fotos_ohne_tag || []);
  return {
    kopf: daten.kopf,
    tage,
    ohne_tag: { anzahl: ohneTag.length, abgebildet: Math.max(0, Math.min(ohneTag.length, rest)),
      dateien: ohneTag.map((f) => ({ dateiname: f.dateiname, hochgeladen: f.hochgeladen })) },
    gesamt: (daten.fotos || []).length + ohneTag.length,
    deckel: FOTOS_DOKU_MAX,
    hinweise: daten.hinweise,
  };
}

// Bildunterschrift eines Fotos: Tag + Ort, gekürzt auf das, was unter ein
// Drittel der Satzbreite passt.
export function fotoCaption(f) {
  // Tagesgebundene Fotos tragen ihr Datum. Fotos aus dem Auffangnetz haben
  // keines — dort steht das Hochladedatum, ausdruecklich als solches benannt,
  // damit niemand es fuer den Aufnahmetag haelt.
  const tag = f.datum ? dmy(f.datum) : (f.hochgeladen ? `hochgeladen ${dmy(f.hochgeladen)}` : '');
  return [tag, f.ort || f.notiz || ''].filter(Boolean).join(' · ');
}

// ═══════════════════════════════════════════════════════════════════════════
// Berichtskopf get-or-create — race-sicher über den UNIQUE-Index
// ═══════════════════════════════════════════════════════════════════════════
export async function holeOderErstelleBericht({ projektId, jahr, woche, userId, berichtNr }) {
  const suche = `gs_wochenberichte?projekt_id=eq.${projektId}&jahr=eq.${jahr}&woche=eq.${woche}&select=*&limit=1`;
  const vorhanden = await sbGet(suche);
  if (vorhanden[0]) return vorhanden[0];

  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_wochenberichte`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'return=representation' },
    body: JSON.stringify({ quelle: 'projekt', projekt_id: projektId, jahr, woche, bericht_nr: berichtNr, erstellt_von: userId || null }),
  });
  if (r.ok) { const j = await r.json(); return Array.isArray(j) ? j[0] : j; }

  // 23505 = der UNIQUE-Index hat zugeschlagen: ein paralleler Aufruf war
  // schneller. Genau dafür ist er da — bestehenden Kopf lesen statt scheitern.
  const txt = await r.text();
  if (/23505|duplicate key/i.test(txt)) {
    const nochmal = await sbGet(suche);
    if (nochmal[0]) return nochmal[0];
  }
  throw new Error(`Berichtskopf konnte nicht angelegt werden: ${txt.slice(0, 200)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Bericht erzeugen: Daten sammeln → Fotos laden → PDF bauen
// ═══════════════════════════════════════════════════════════════════════════
// `einfrieren` schreibt den Datenstand als Snapshot nach gs_wochenberichte.daten.
// Ein versendeter Bericht darf sich nicht rückwirkend ändern, nur weil jemand
// später eine Tageszeile korrigiert — deshalb wird beim Versand eingefroren und
// danach nur noch der Snapshot gerendert.
export async function erzeugeBericht({ projektId, jahr, woche, userId, einfrieren = false }) {
  // Erst LESEN, nicht anlegen: ein bereits versendeter Bericht wird aus seinem
  // Snapshot gerendert, dann muss gar nichts eingesammelt werden.
  const vorhanden = await sbGet(`gs_wochenberichte?projekt_id=eq.${projektId}&jahr=eq.${jahr}&woche=eq.${woche}&select=*&limit=1`);
  const bestehend = vorhanden[0] || null;
  const ausSnapshot = !!(bestehend && bestehend.status === 'versendet' && bestehend.daten && typeof bestehend.daten === 'object');

  const daten = ausSnapshot ? bestehend.daten : await sammleWochendaten({ quelle: 'projekt', projektId, jahr, woche });
  const nr = (bestehend && bestehend.bericht_nr)
    || berichtNummer({ kuerzel: daten.kopf.kuerzel, nummer: daten.kopf.nummer, jahr, woche });
  const kopfRow = bestehend || await holeOderErstelleBericht({ projektId, jahr, woche, userId, berichtNr: nr });

  // Fotos: höchstens sechs ins PDF, der Rest bleibt Verweis.
  const auswahl = (daten.fotos || []).slice(0, FOTOS_IM_PDF);
  const bilder = [];
  for (const f of auswahl) {
    const buf = await ladeFotoBytes(f);
    if (buf) bilder.push({ buf, caption: fotoCaption(f) });
  }
  // Auffangnetz: Fotos ohne Tagesbindung mit eigenem, kleinerem Budget.
  const auswahlOhneTag = (daten.fotos_ohne_tag || []).slice(0, FOTOS_OHNE_TAG_IM_PDF);
  const bilderOhneTag = [];
  for (const f of auswahlOhneTag) {
    const buf = await ladeFotoBytes(f);
    if (buf) bilderOhneTag.push({ buf, caption: fotoCaption(f) });
  }
  const fehlend = (auswahl.length - bilder.length) + (auswahlOhneTag.length - bilderOhneTag.length);
  if (fehlend > 0) {
    daten.hinweise = [...(daten.hinweise || []), `${fehlend} Foto(s) konnten nicht geladen werden und fehlen im Bericht.`];
  }

  // Branding aus gs_branding: Partner-Zeile schlägt Standard-Zeile. Logo, Farbe,
  // Firmenname und Fusszeile kommen von dort — ladeLogo() ist nur noch die
  // Reissleine, falls die Tabelle kein verwertbares Bild liefert.
  const marke = await ladeBranding({ partnerId: (daten.kopf && daten.kopf.partner_id) || null });
  const pdf = buildWochenberichtPdf(daten, {
    logo: marke.logo || await ladeLogo(),
    fotos: bilder, fotosOhneTag: bilderOhneTag, berichtNr: nr, branding: marke,
  });

  // Nummer nachtragen, falls der Kopf sie noch nicht hatte.
  const patch = {};
  if (!kopfRow.bericht_nr) patch.bericht_nr = nr;
  if (einfrieren && !ausSnapshot) patch.daten = daten;
  if (Object.keys(patch).length) {
    await fetch(`${SUPABASE_URL}/rest/v1/gs_wochenberichte?id=eq.${kopfRow.id}`, {
      method: 'PATCH', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(patch),
    }).catch(() => null);
  }

  return {
    bericht: { ...kopfRow, bericht_nr: nr }, daten, pdf,
    aus_snapshot: ausSnapshot, fotos_im_pdf: bilder.length + bilderOhneTag.length,
    // Nachweisbar machen, woher Farbe und Logo kamen — sonst lässt sich von
    // aussen nicht unterscheiden, ob gs_branding gelesen oder der Fallback
    // gegriffen hat (beide sehen identisch aus, solange GS die Zeile ist).
    branding: { firmenname: marke.firmenname, akzentfarbe: marke.akzentfarbe, logo_url: marke.logo_url, aus_tabelle: marke.aus_tabelle, partner_id: marke.partner_id },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Versand
// ═══════════════════════════════════════════════════════════════════════════
const MAIL_ABSENDER = 'George Solutions <info@george-solutions.ch>';
const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Empfänger je Projekt. Reihenfolge: ausdrücklich übergeben → am Berichtskopf
// hinterlegt → gs_projekte.ansprech_email.
//
// Bewusst KEIN Fallback auf die Bürosadresse: ein Wochenbericht, der mangels
// Adresse still im eigenen Postfach landet statt beim Bauleiter, sieht wie ein
// erfolgreicher Versand aus und ist keiner. Ohne Adresse gibt es einen Fehler.
export function empfaengerFuer({ angefragt, kopfRow, daten }) {
  const norm = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/))
    .map((x) => String(x || '').trim()).filter((x) => MAIL_RE.test(x)))];
  const ausAnfrage = norm(angefragt);
  if (ausAnfrage.length) return { liste: ausAnfrage, herkunft: 'angefragt' };
  const ausKopf = norm(kopfRow && kopfRow.empfaenger);
  if (ausKopf.length) return { liste: ausKopf, herkunft: 'berichtskopf' };
  const ausProjekt = norm(daten && daten.kopf && daten.kopf.ansprech_email);
  if (ausProjekt.length) return { liste: ausProjekt, herkunft: 'projekt-ansprechperson' };
  return { liste: [], herkunft: null };
}

// PDF im Storage ablegen, damit der versendete Stand später byte-gleich wieder
// vorliegt. Best-effort: schlägt der Upload fehl, geht die Mail trotzdem raus —
// der Bauleiter wartet nicht auf unser Archiv.
async function legePdfAb({ projektId, berichtNr, pdf }) {
  const pfad = `wochenberichte/${projektId}/${String(berichtNr).replace(/[^\w.-]+/g, '_')}.pdf`;
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${MEDIEN_BUCKET}/${pfad}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
      body: pdf,
    });
    return r.ok ? pfad : null;
  } catch (_) { return null; }
}

// Versand protokollieren. versendet_am/empfaenger/status spiegeln den LETZTEN
// Versand; die Historie steht in versand_protokoll (append-only).
//
// Fehlt die Spalte, weil scripts/wochenbericht_versand.sql noch nicht gelaufen
// ist, wird ohne sie geschrieben — der Versand darf an einer fehlenden
// Migration nicht scheitern. Gleiches Muster wie überall sonst hier.
//
// Bekannte Grenze: das Anhängen ist ein Read-Modify-Write in JS, kein
// jsonb-Append in SQL. Zwei GLEICHZEITIGE Versande desselben Berichts könnten
// sich einen Protokolleintrag überschreiben. Bewusst so belassen: Versenden ist
// eine manuelle Master-Aktion, kein Automatismus — der Apparat für eine RPC
// stünde in keinem Verhältnis. Der Bericht selbst ist davon nicht betroffen,
// dessen Eindeutigkeit sichert der UNIQUE-Index.
async function protokolliere({ kopfRow, eintrag, patch }) {
  const mitProtokoll = {
    ...patch,
    versand_protokoll: [...(Array.isArray(kopfRow.versand_protokoll) ? kopfRow.versand_protokoll : []), eintrag],
  };
  const schreibe = async (body) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_wochenberichte?id=eq.${kopfRow.id}`, {
      method: 'PATCH', headers: { ...SB, Prefer: 'return=representation' }, body: JSON.stringify(body),
    });
    return r.ok ? { ok: true, row: (await r.json())[0] } : { ok: false, text: await r.text() };
  };
  let res = await schreibe(mitProtokoll);
  if (res.ok) return { row: res.row, protokolliert: true };
  if (/versand_protokoll|PGRST204|schema cache|does not exist/i.test(res.text || '')) {
    res = await schreibe(patch);
    return { row: res.ok ? res.row : null, protokolliert: false, notMigrated: true };
  }
  throw new Error(`Versand konnte nicht protokolliert werden: ${(res.text || '').slice(0, 200)}`);
}

// Bericht erzeugen, einfrieren, mailen, protokollieren.
// `sendMail` und `mailHtml` werden hereingereicht, damit diese Datei nicht von
// api/-Modulen abhängt und im Test ohne echten Mailversand prüfbar bleibt.
export async function versendeBericht({
  projektId, jahr, woche, userId, empfaenger, sendMail, mailHtml, betreff,
}) {
  const { bericht, daten, pdf, aus_snapshot, fotos_im_pdf } = await erzeugeBericht({
    projektId, jahr, woche, userId, einfrieren: true,
  });

  const { liste, herkunft } = empfaengerFuer({ angefragt: empfaenger, kopfRow: bericht, daten });
  if (!liste.length) {
    return {
      ok: false, versendet: false, bericht, daten, pdf,
      error: 'Keine gültige Empfängeradresse. Bitte Empfänger angeben oder beim Projekt eine Ansprechperson mit E-Mail hinterlegen.',
    };
  }

  const nr = bericht.bericht_nr;
  const pdfPath = await legePdfAb({ projektId, berichtNr: nr, pdf });

  const betreffText = betreff
    || `Wochenbericht KW ${daten.kopf.woche}/${daten.kopf.jahr} · ${daten.kopf.titel || ''} · ${nr}`;
  const html = mailHtml({
    berichtNr: nr, kw: daten.kopf.woche, jahr: daten.kopf.jahr,
    projektName: daten.kopf.titel, von: daten.kopf.von, bis: daten.kopf.bis,
    summen: daten.summen, einreichstatus: daten.einreichstatus, hinweise: daten.hinweise,
  });

  const mail = await sendMail({
    to: liste,
    from: MAIL_ABSENDER,
    subject: betreffText,
    html,
    attachments: [{ filename: `${nr}.pdf`.replace(/[^\w.-]+/g, '_'), content: Buffer.from(pdf).toString('base64') }],
  });
  const erfolg = !!(mail && mail.ok);

  const eintrag = {
    am: new Date().toISOString(),
    an: liste,
    empfaenger_herkunft: herkunft,
    bericht_nr: nr,
    von: userId || null,
    ok: erfolg,
    fehler: erfolg ? null : ((mail && (mail.error || (mail.skipped ? 'RESEND_API_KEY fehlt' : null))) || 'unbekannt'),
    pdf_bytes: pdf.length,
    pdf_path: pdfPath,
  };
  // Nur ein GELUNGENER Versand setzt den Status. Sonst stünde der Bericht als
  // versendet in der Liste, obwohl beim Bauleiter nie etwas ankam.
  const patch = erfolg
    ? { status: 'versendet', versendet_am: eintrag.am, empfaenger: liste, ...(pdfPath ? { pdf_path: pdfPath } : {}) }
    : { empfaenger: liste, ...(pdfPath ? { pdf_path: pdfPath } : {}) };

  const prot = await protokolliere({ kopfRow: bericht, eintrag, patch });

  return {
    ok: erfolg, versendet: erfolg,
    bericht: prot.row || { ...bericht, ...patch },
    daten, pdf, aus_snapshot, fotos_im_pdf,
    empfaenger: liste, empfaenger_herkunft: herkunft,
    pdf_path: pdfPath,
    protokolliert: prot.protokolliert,
    protokoll_hinweis: prot.notMigrated
      ? 'Spalte versand_protokoll fehlt (scripts/wochenbericht_versand.sql noch nicht ausgeführt) — nur der letzte Versand ist festgehalten, keine Historie.'
      : null,
    error: erfolg ? null : eintrag.fehler,
  };
}

// Foto-Bytes für die PDF-Einbettung. Signierte URLs helfen hier nicht — der
// PDF-Bauer braucht die Datei selbst. Läuft über den Service-Key direkt am
// Storage. Fehlschläge sind kein Abbruch: ein fehlendes Foto ist kein Grund,
// den ganzen Bericht scheitern zu lassen.
export async function ladeFotoBytes(foto, maxBytes = 3 * 1024 * 1024) {
  if (!foto || !foto.path) return null;
  const bucket = foto.bucket || MEDIEN_BUCKET;
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${foto.path}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > maxBytes) return null;
    return buf;
  } catch (_) { return null; }
}
