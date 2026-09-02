// lib/datum.js — Plausibilitätsprüfung für das Datum einer Tageszeile.
//
// Anlass: in der Live-Datenbank steht eine Tageszeile mit dem Datum 2099-03-02
// auf Projekt 60133.00 — ein Vertipper, der als KW 10/2099 durch alle Listen,
// Summen und Wochenräder läuft und dort nicht mehr aufzufinden ist.
//
// Die Regel ist bewusst eng: aktuelles Jahr minus 1 bis plus 1. Rückwirkend
// erfassen ist im Feld normal (die Woche wird oft erst am Freitag getippt),
// ein Rapport für 2031 ist es nicht. Weiter als ein Jahr zurück kommt niemand
// legitim — und wenn doch, korrigiert der Master die Zeile, statt dass die
// Erfassungsmaske jeden Tippfehler durchwinkt.
//
// Die Prüfung gehört auf den SERVER, nicht nur ins Formular: das Wochenblatt
// speichert per Autosave über die API, und die API ist auch ohne Formular
// erreichbar. Ein zusätzliches Netz steht als CHECK-Constraint in der
// Datenbank (scripts/rapport_feld.sql, 2000–2100) — das fängt den groben
// Unfug ab, die genaue Regel steht hier.
//
// ESM wie jede andere Datei in lib/ — kein import.meta.

export const DATUM_JAHRE_ZURUECK = 1;
export const DATUM_JAHRE_VORAUS = 1;

// Gibt { ok:true, datum, jahr } oder { ok:false, error } zurück.
// `jetzt` ist nur für den Test da; im Betrieb bleibt es leer.
export function pruefeTagesdatum(roh, jetzt) {
  const datum = String(roh || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    return { ok: false, error: 'Bitte ein Datum im Format JJJJ-MM-TT angeben.' };
  }
  // Echter Kalendertag? '2026-02-31' passt auf das Muster, gibt es aber nicht.
  const d = new Date(datum + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== datum) {
    return { ok: false, error: `Den ${datum.slice(8, 10)}.${datum.slice(5, 7)}.${datum.slice(0, 4)} gibt es im Kalender nicht.` };
  }
  const jahr = Number(datum.slice(0, 4));
  const heuteJahr = (jetzt ? new Date(jetzt) : new Date()).getUTCFullYear();
  const min = heuteJahr - DATUM_JAHRE_ZURUECK;
  const max = heuteJahr + DATUM_JAHRE_VORAUS;
  if (jahr < min || jahr > max) {
    return {
      ok: false,
      error: `Das Jahr ${jahr} liegt ausserhalb des zulässigen Bereichs (${min} bis ${max}). `
        + 'Es wurde nichts gespeichert — bitte das Datum prüfen.',
    };
  }
  return { ok: true, datum, jahr };
}
