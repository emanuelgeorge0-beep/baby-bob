// src/features/projectflow/material.js
// Materialliste + Materialrabatt. Preis-Modell konsistent zu gs_material (menge × einzelpreis);
// Rabatt-% pro Position → Netto = Brutto × (1 − rabatt/100). Rein clientseitig; der Versand
// nutzt das BESTEHENDE Mail-/PDF-Format (materialEmailHtml/buildMaterialPdf erwarten
// { position, menge, einheit }) – Preise/Rabatt wandern in die Notiz, damit die Mail 1:1 bleibt.

export const EINHEITEN = ['Stk', 'm', 'm²', 'lfm', 'kg', 'l', 'h', 'Pauschal'];

export function newPosition(init = {}) {
  return {
    id: init.id || uid(),
    bezeichnung: init.bezeichnung || '',
    menge: num(init.menge, 1),
    einheit: init.einheit || 'Stk',
    einzelpreis: num(init.einzelpreis, 0),
    rabatt: clampPct(init.rabatt),
  };
}

export function lineBrutto(p) { return round2(num(p.menge) * num(p.einzelpreis)); }
export function lineNetto(p)  { return round2(lineBrutto(p) * (1 - clampPct(p.rabatt) / 100)); }

export function totals(positionen) {
  const list = Array.isArray(positionen) ? positionen : [];
  const brutto = round2(list.reduce((s, p) => s + lineBrutto(p), 0));
  const netto = round2(list.reduce((s, p) => s + lineNetto(p), 0));
  const rabatt = round2(brutto - netto);
  const rabattPct = brutto > 0 ? round2((rabatt / brutto) * 100) : 0;
  return { brutto, rabatt, rabattPct, netto, anzahl: list.length };
}

// Positionen im Format, das materialEmailHtml/buildMaterialPdf erwarten (unverändert wiederverwendet).
export function toEmailPositionen(positionen) {
  return (positionen || []).map((p) => ({
    position: p.bezeichnung || '—',
    menge: fmtMenge(p.menge),
    einheit: p.einheit || '',
  }));
}

// Preis-/Rabattübersicht als Text – landet in der Notiz der bestehenden Materiallisten-Mail.
export function pricingNote(positionen, extra = '') {
  const t = totals(positionen);
  const lines = (positionen || [])
    .filter((p) => num(p.einzelpreis) > 0)
    .map((p) => `• ${p.bezeichnung || '—'}: ${fmtMenge(p.menge)} ${p.einheit} × CHF ${chf(p.einzelpreis)}${clampPct(p.rabatt) ? ` − ${fmtMenge(p.rabatt)}% Rabatt` : ''} = CHF ${chf(lineNetto(p))}`);
  const sum = `Summe: Brutto CHF ${chf(t.brutto)} − Rabatt CHF ${chf(t.rabatt)} (${fmtMenge(t.rabattPct)}%) = Netto CHF ${chf(t.netto)}`;
  return [extra && extra.trim(), lines.length ? lines.join('\n') : null, t.brutto > 0 ? sum : null]
    .filter(Boolean).join('\n');
}

export function toCsv(positionen) {
  const head = ['Bezeichnung', 'Menge', 'Einheit', 'Einzelpreis', 'Rabatt %', 'Brutto', 'Netto'];
  const rows = (positionen || []).map((p) => [
    p.bezeichnung || '', fmtMenge(p.menge), p.einheit || '', chf(p.einzelpreis),
    fmtMenge(clampPct(p.rabatt)), chf(lineBrutto(p)), chf(lineNetto(p)),
  ]);
  const t = totals(positionen);
  rows.push(['Summe', '', '', '', '', chf(t.brutto), chf(t.netto)]);
  return [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
}

// ── utils ──
export function chf(n) { return num(n).toFixed(2); }
export function fmtMenge(n) { const v = num(n); return Number.isInteger(v) ? String(v) : String(round2(v)); }
function csvCell(v) { const s = String(v == null ? '' : v); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function num(v, d = 0) { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v); return Number.isFinite(n) ? n : d; }
function clampPct(v) { const n = num(v, 0); return Math.min(100, Math.max(0, n)); }
function round2(n) { return Math.round((num(n) + Number.EPSILON) * 100) / 100; }
function uid() { return 'p' + Math.random().toString(36).slice(2, 9); }
