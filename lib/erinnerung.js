// lib/erinnerung.js — Unvollständige Rapporte erkennen und daran erinnern.
//
// Ein Rapport, dem Angaben fehlen, ist kein Rapport: er trägt weder eine
// Rechnung noch einen Wochenbericht. Bisher fiel das erst auf, wenn jemand am
// Freitag den Bericht bauen wollte — dann war die Woche vorbei und niemand
// wusste mehr, was am Dienstag war.
//
// Zwei Erinnerungen, nach 24 und nach 48 Stunden, an die Person, die erfasst
// hat. Danach nichts mehr: eine dritte Mail liest niemand, und die Liste im
// Master-Cockpit zeigt den Rückstand ohnehin.
//
// ESM wie alles in lib/ — kein import.meta.

// ═══════════════════════════════════════════════════════════════════════════
// Was heisst „unvollständig"?
// ═══════════════════════════════════════════════════════════════════════════
// Drei Fälle, und alle drei sind konkret nachbesserbar. Bewusst NICHT dabei:
// fehlende Fotos (nicht auf jeder Baustelle gibt es etwas zu fotografieren)
// und fehlendes Material (viele Tage verbrauchen keines). Eine Erinnerung, die
// etwas verlangt, das es nicht gibt, wird nach zwei Wochen weggeklickt.
export const GRUND_TEXT = {
  projekt_unvollstaendig: 'Die Baustelle wurde im Rapport schnell angelegt — Adresse, Ansprechperson oder E-Mail fehlen noch.',
  keine_zeit: 'Es ist keine Arbeitszeit erfasst (weder Stunden noch Start/Ende).',
  keine_beschreibung: 'Es steht nicht da, was an diesem Tag gemacht wurde.',
};

export function rapportLuecken(zeile, projekt) {
  const gruende = [];
  if (!zeile) return gruende;
  // Abwesenheitszeilen brauchen weder Zeit noch Tätigkeitstext — sie sagen
  // schon alles. Sie können also nie unvollständig sein.
  if (zeile.abwesenheit) return gruende;

  if (projekt && projekt.unvollstaendig) gruende.push('projekt_unvollstaendig');

  const stunden = Number(zeile.gesamtstunden || 0) || 0;
  const hatZeit = stunden > 0 || (!!zeile.start_zeit && !!zeile.end_zeit);
  if (!hatZeit) gruende.push('keine_zeit');

  const arbeiten = Array.isArray(zeile.arbeiten) ? zeile.arbeiten.filter((x) => String(x || '').trim()) : [];
  const katalog = Number(zeile.taetigkeiten_anzahl || 0) || 0;
  const notiz = String(zeile.besonderheiten || '').trim();
  if (!arbeiten.length && !katalog && !notiz) gruende.push('keine_beschreibung');

  return gruende;
}

export function istUnvollstaendig(zeile, projekt) {
  return rapportLuecken(zeile, projekt).length > 0;
}

// Alter in vollen Stunden seit dem Erfassen.
export function alterStunden(zeile, jetzt) {
  const t = Date.parse(zeile && zeile.created_at ? zeile.created_at : '');
  if (!Number.isFinite(t)) return 0;
  const now = jetzt ? new Date(jetzt).getTime() : Date.now();
  return Math.max(0, Math.floor((now - t) / 3600000));
}

// ═══════════════════════════════════════════════════════════════════════════
// Welche Stufe ist fällig?
// ═══════════════════════════════════════════════════════════════════════════
// 24 → erste Erinnerung, 48 → zweite, sonst null. Bereits versendete Stufen
// werden nicht wiederholt: die Zeitpunkte stehen auf der Zeile
// (erinnerung_24_am / erinnerung_48_am, scripts/rapport_feld.sql).
//
// Wird eine Zeile erst nach 50 Stunden gefunden, bekommt sie GENAU EINE Mail
// (die zweite Stufe) und nicht zwei hintereinander. Zwei Mails im selben
// Moment sind kein Nachdruck, sondern eine Panne.
export const STUFEN = [24, 48];

export function faelligeStufe(zeile, jetzt) {
  const alter = alterStunden(zeile, jetzt);
  if (alter >= 48 && !zeile.erinnerung_48_am) return 48;
  if (alter >= 24 && alter < 48 && !zeile.erinnerung_24_am) return 24;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Der Mailtext
// ═══════════════════════════════════════════════════════════════════════════
// Steht je Betrieb in gs_branding.rapport_erinnerung_text. Der Standard hier
// ist neutral: er erinnert, er droht nicht.
//
// Platzhalter, die ersetzt werden:
//   {name}     Vorname/Name der erfassenden Person
//   {anzahl}   Zahl der offenen Rapporte
//   {liste}    Datum · Baustelle · was fehlt, je Zeile
//   {stunden}  Alter des ältesten offenen Rapports in Stunden
export const STANDARD_ERINNERUNG_TEXT =
  'Hallo {name}\n\n'
  + 'Zu {anzahl} deiner Rapporte fehlen noch Angaben. Der älteste ist {stunden} Stunden alt.\n\n'
  + '{liste}\n\n'
  + 'Bitte trage die fehlenden Angaben im Wochenblatt nach, solange der Tag noch frisch ist. '
  + 'Ohne sie lässt sich für diese Baustelle kein Wochenbericht erstellen.\n\n'
  + 'Danke dir.';

// ── Was der Text NICHT sagen darf ────────────────────────────────────────
// Die Abgabe eines Rapports darf nicht an die Lohnzahlung geknüpft werden.
// Das ist keine Geschmacksfrage: Lohn ist für geleistete Arbeit geschuldet,
// nicht für Papier. Ein Text, der beides verbindet, wird beim Speichern
// abgelehnt — mit Begründung, nicht kommentarlos.
//
// Geprüft wird die VERBINDUNG, nicht das einzelne Wort: „Lohnbüro" allein ist
// harmlos, „kein Lohn ohne Rapport" ist es nicht.
const GELD = '(lohn|gehalt|salär|salaer|lohnzahlung|auszahlung|auszubezahlen|vergütung|verguetung|entlöhnung|entloehnung)';
const KOPPLUNG = [
  new RegExp(`kein[a-zä]*\\s+${GELD}`, 'i'),
  new RegExp(`${GELD}[^.\\n]{0,60}\\b(erst|nur|nicht)\\b`, 'i'),
  new RegExp(`\\b(erst|nur|nicht)\\b[^.\\n]{0,60}${GELD}`, 'i'),
  new RegExp(`${GELD}[^.\\n]{0,60}(zurückgehalten|zurueckgehalten|gekürzt|gekuerzt|gesperrt|einbehalten)`, 'i'),
  new RegExp(`(ohne|fehlend[a-zä]*)\\s+rapport[^.\\n]{0,60}${GELD}`, 'i'),
];

export function erinnerungTextPruefen(text) {
  const t = String(text || '');
  if (!t.trim()) return { ok: false, error: 'Der Erinnerungstext darf nicht leer sein.' };
  if (t.length > 4000) return { ok: false, error: 'Der Erinnerungstext ist zu lang (höchstens 4000 Zeichen).' };
  for (const re of KOPPLUNG) {
    if (re.test(t)) {
      return {
        ok: false,
        error: 'Der Text verknüpft die Abgabe des Rapports mit der Lohnzahlung. '
          + 'Das ist nicht zulässig — Lohn wird für geleistete Arbeit geschuldet, nicht für ein Formular. '
          + 'Bitte die Stelle umformulieren.',
      };
    }
  }
  return { ok: true, text: t };
}

// Platzhalter füllen. Unbekannte Platzhalter bleiben stehen, damit ein Tippfehler
// sichtbar wird und nicht still verschwindet.
export function erinnerungText({ vorlage, name, zeilen, jetzt }) {
  const liste = (zeilen || []).map((z) => {
    const was = (z.gruende || []).map((g) => GRUND_TEXT[g] || g).join(' ');
    const datum = String(z.datum || '').slice(0, 10);
    const tag = datum ? `${datum.slice(8, 10)}.${datum.slice(5, 7)}.${datum.slice(0, 4)}` : '—';
    return `• ${tag} · ${z.baustelle || 'Baustelle'} — ${was}`;
  }).join('\n');
  const aeltester = (zeilen || []).reduce((a, z) => Math.max(a, alterStunden(z, jetzt)), 0);
  return String(vorlage || STANDARD_ERINNERUNG_TEXT)
    .replace(/\{name\}/g, name || 'zusammen')
    .replace(/\{anzahl\}/g, String((zeilen || []).length))
    .replace(/\{liste\}/g, liste || '—')
    .replace(/\{stunden\}/g, String(aeltester));
}
