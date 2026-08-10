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
    `gs_projekte?id=eq.${projektId}&select=id,name,projektnummer,standort,kunde_id,projektleiter,ansprechperson,ansprech_email&limit=1`,
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
      bucket: x.bucket || MEDIEN_BUCKET,
      path: x.path,
      dateiname: x.dateiname || null,
      datum: datumVon[x.tagesrapport_id] || null,
      ort: [x.stockwerk, x.wohnung, x.raum, x.bauabschnitt].filter(Boolean).join(' · ') || null,
      notiz: x.notiz || null,
    }));
  }

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
        fotos: fotos.filter((f) => f.datum === datum).length,
      };
    });
    const s = (k) => r2(out.reduce((a, x) => a + x[k], 0));
    const d = new Date(`${datum}T00:00:00Z`);
    return {
      datum,
      wochentag: WOCHENTAG[d.getUTCDay()],
      zeilen: out,
      stunden: s('stunden'), uz25: s('uz25'), uz50: s('uz50'), uz100: s('uz100'), spesen: s('spesen'),
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
    tage: tage.length,
    zeilen: zeilen.length,
    techniker: new Set(zeilen.map((z) => z.techniker_user_id)).size,
  };
  if (!zeilen.length) hinweise.push('Für diese Kalenderwoche wurde auf dieses Projekt nichts gebucht.');
  if (!fotos.length) hinweise.push('Für diesen Zeitraum liegen keine Fotos vor.');
  if (!material.length) hinweise.push('Für diesen Zeitraum wurde kein Material erfasst.');

  return {
    quelle: 'projekt', kopf, tage, summen, material, fotos,
    fotos_vorhanden: fotos.length > 0,
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
      tage: eigene.length,
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
      jahr, woche, von, bis,
    },
    tage: [],
    summen: { stunden: 0, uz25: 0, uz50: 0, uz100: 0, spesen: 0, tage: 0, zeilen: 0, techniker: 0 },
    material: [], fotos: [], fotos_vorhanden: false, material_vorhanden: false,
    einreichstatus: [], hinweise: hinweise || [],
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
