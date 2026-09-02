// lib/abwesenheit.js — EIN Katalog der Abwesenheitsgründe für alle Stellen.
//
// Vorher stand die Liste dreimal im Code: api/cockpit.js (Prüfung beim
// Speichern), lib/wochenbericht.js (Beschriftung im PDF) und app.html
// (Auswahlfeld). Ein neuer Grund musste an drei Orten nachgezogen werden —
// wurde einer vergessen, liess sich der Grund erfassen und stand dann im PDF
// als nackter Buchstabe da. Deshalb hier EINE Quelle; app.html holt sie sich
// zusätzlich über die API (tech_wochen_rapport → abwesenheit_katalog), damit
// die Oberfläche nicht auseinanderlaufen kann.
//
// ESM (import/export) wie jede andere Datei in lib/ — KEIN import.meta, sonst
// stürzt die Funktion auf Vercel schon beim Laden ab.
//
// ACHTUNG: die Datenbank hat auf gs_tagesrapporte.abwesenheit einen
// CHECK-Constraint mit derselben Liste. Ein neuer Code hier OHNE
// scripts/rapport_feld.sql wird von Postgres abgelehnt (23514).

// Reihenfolge = Reihenfolge im Auswahlfeld. Die fünf alten Codes zuerst, damit
// niemand seine gewohnte Position sucht.
export const ABWESENHEIT_KATALOG = [
  { code: 'G',  label: 'Gesetzl. Feiertag' },
  { code: 'F',  label: 'Ferien' },
  { code: 'M',  label: 'Militär/Zivilschutz' },
  { code: 'U',  label: 'Unfall' },
  { code: 'A',  label: 'Absenz (Grund/Dauer)' },
  { code: 'K',  label: 'Krankheit' },
  { code: 'B',  label: 'Trauerfall' },
  { code: 'AR', label: 'Arztbesuch' },
  { code: 'S',  label: 'Schule/Kurs' },
  { code: 'UB', label: 'Unbezahlter Urlaub' },
  { code: 'SW', label: 'Schlechtwetter' },
];

export const ABWESENHEIT_CODES = new Set(ABWESENHEIT_KATALOG.map((x) => x.code));

export const ABWESENHEIT_LABEL = ABWESENHEIT_KATALOG
  .reduce((a, x) => { a[x.code] = x.label; return a; }, {});

// Unbekannter Code → der Code selbst. Ein Bericht soll lieber „XY" zeigen als
// eine leere Zelle: dann sieht man, dass etwas erfasst wurde.
export function abwesenheitLabel(code) {
  if (!code) return null;
  return ABWESENHEIT_LABEL[String(code).toUpperCase()] || String(code);
}

export function istAbwesenheit(zeile) {
  return !!(zeile && zeile.abwesenheit);
}

// ── Die eigentliche Trennung ──────────────────────────────────────────────
// Abwesenheitsstunden sind KEINE erfassten Arbeitsstunden. Sie stehen in
// derselben Spalte (gesamtstunden), weil eine Abwesenheit genauso einen Tag
// füllt — aber sie gehören in eine eigene Summe. Wer sie mitzählt, weist eine
// Woche mit drei Krankheitstagen als voll gearbeitet aus.
//
// `feld` ist der Spaltenname, weil dieselbe Trennung mit den rohen DB-Zeilen
// (gesamtstunden) und mit den aufbereiteten Berichtszeilen (stunden) gebraucht
// wird.
export function trenneStunden(zeilen, feld = 'gesamtstunden') {
  let arbeit = 0, abwesend = 0;
  for (const z of zeilen || []) {
    const v = Number((z && z[feld]) || 0) || 0;
    if (istAbwesenheit(z)) abwesend += v; else arbeit += v;
  }
  return {
    stunden: Math.round(arbeit * 100) / 100,
    abwesenheit_stunden: Math.round(abwesend * 100) / 100,
  };
}

// Abwesenheiten einer Woche verdichtet: je Grund die Tage und die Stunden.
// Genau das, was als eigener Block unter der Stundentabelle steht.
export function abwesenheitBloecke(zeilen) {
  const map = new Map();
  for (const z of zeilen || []) {
    if (!istAbwesenheit(z)) continue;
    const code = String(z.abwesenheit).toUpperCase();
    const b = map.get(code) || { code, label: abwesenheitLabel(code), tage: 0, stunden: 0, gruende: [] };
    b.tage += 1;
    b.stunden = Math.round((b.stunden + (Number(z.gesamtstunden || z.stunden || 0) || 0)) * 100) / 100;
    const g = z.abwesenheit_grund && String(z.abwesenheit_grund).trim();
    if (g && !b.gruende.includes(g)) b.gruende.push(g);
    map.set(code, b);
  }
  // Reihenfolge wie im Katalog, damit zwei Berichte derselben Woche gleich
  // aussehen.
  const rang = {}; ABWESENHEIT_KATALOG.forEach((x, i) => { rang[x.code] = i; });
  return [...map.values()].sort((a, b) => (rang[a.code] ?? 99) - (rang[b.code] ?? 99));
}
