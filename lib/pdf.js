// lib/pdf.js — dependency-free PDF generator (hand-rolled, valid PDF 1.4).
// No npm deps → zero build/deploy risk. Produces clean A4 text documents with
// Helvetica (WinAnsi), used for rapport + invoice PDFs.

const WIN = { 'ä':'\\344','ö':'\\366','ü':'\\374','Ä':'\\304','Ö':'\\326','Ü':'\\334','ß':'\\337','é':'\\351','è':'\\350','à':'\\340','ç':'\\347','£':'\\243','€':'\\200','°':'\\260' };

function esc(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    if (ch === '(') out += '\\(';
    else if (ch === ')') out += '\\)';
    else if (ch === '\\') out += '\\\\';
    else if (WIN[ch]) out += WIN[ch];
    else {
      const code = ch.charCodeAt(0);
      out += code >= 32 && code < 127 ? ch : (code <= 255 ? '\\' + code.toString(8).padStart(3, '0') : '?');
    }
  }
  return out;
}

// blocks: [{t:'h1'|'h2'|'kv'|'text'|'sp', text, label, value}]
export function buildPdf({ title, blocks }) {
  const pageW = 595, pageH = 842, left = 56, right = 539;
  let y = pageH - 64;
  const ops = [];
  const line = (txt, size, font, dy) => {
    y -= dy;
    ops.push(`BT /${font} ${size} Tf ${left} ${y} Td (${esc(txt)}) Tj ET`);
  };
  // gold rule under title
  if (title) {
    line(title, 20, 'F1', 26);
    ops.push(`0.79 0.63 0 RG 2 w ${left} ${y - 8} m ${right} ${y - 8} l S`);
    y -= 18;
  }
  for (const b of blocks || []) {
    if (b.t === 'sp') { y -= (b.size || 10); continue; }
    if (b.t === 'h1') line(b.text, 15, 'F1', 24);
    else if (b.t === 'h2') line(b.text, 12, 'F1', 20);
    else if (b.t === 'kv') {
      y -= 16;
      ops.push(`BT /F2 10 Tf ${left} ${y} Td (${esc(b.label)}) Tj ET`);
      ops.push(`BT /F1 10 Tf ${left + 150} ${y} Td (${esc(b.value)}) Tj ET`);
    } else line(b.text, 10, 'F2', 15);
    if (y < 60) y = 60; // clamp (single page; rapports are short)
  }
  const content = ops.join('\n');

  // Assemble objects with byte-accurate xref.
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pageW} ${pageH}]/Resources<</Font<</F1 5 0 R/F2 6 0 R>>>>/Contents 4 0 R>>`,
    `<</Length ${Buffer.byteLength(content, 'latin1')}>>\nstream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

export function buildRapportPdf(r) {
  const blocks = [
    { t: 'h1', text: 'Tagesrapport' },
    { t: 'kv', label: 'Projekt', value: r.projekt_name || '–' },
    { t: 'kv', label: 'Projektnummer', value: r.projektnummer || '–' },
    { t: 'kv', label: 'Standort', value: r.standort || '–' },
    { t: 'kv', label: 'Datum', value: r.datum || '–' },
    { t: 'kv', label: 'Ausgeführt von', value: r.techniker_name || '–' },
    { t: 'kv', label: 'Team', value: (r.team || []).join(', ') || '–' },
    { t: 'kv', label: 'Arbeitszeit', value: `${(r.zeit_von || '').slice(0,5)} – ${(r.zeit_bis || '').slice(0,5)}` },
    { t: 'kv', label: 'Gesamtstunden', value: `${r.gesamtstunden ?? '–'} h` },
    { t: 'sp', size: 8 },
    { t: 'h2', text: 'Ausgeführte Arbeiten' },
    { t: 'text', text: (r.arbeiten || []).join(' · ') || '–' },
    { t: 'h2', text: 'Material / Besonderheiten' },
    { t: 'text', text: (r.material || []).join(' · ') || '–' },
    { t: 'text', text: r.besonderheiten || '' },
  ];
  if ((r.foto_urls || []).length) blocks.push({ t: 'kv', label: 'Fotos', value: `${r.foto_urls.length} angehängt` });
  blocks.push({ t: 'kv', label: 'Unterschrift', value: r.unterschrift_url ? 'digital erfasst ✓' : '–' });
  blocks.push({ t: 'sp', size: 10 });
  blocks.push({ t: 'text', text: `Erstellt: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · George Solutions` });
  return buildPdf({ title: 'George Solutions', blocks });
}

// Materiallisten-PDF (Anhang der Materiallisten-Mail). Eine Position pro Zeile.
export function buildMaterialPdf({ projektName, projektnummer, vonName, positionen, notiz }) {
  const pos = Array.isArray(positionen) ? positionen : [];
  const blocks = [
    { t: 'h1', text: 'Materialliste' },
    { t: 'kv', label: 'Projekt', value: projektName || '–' },
    { t: 'kv', label: 'Projektnummer', value: projektnummer || '–' },
    { t: 'kv', label: 'Erfasst von', value: vonName || '–' },
    { t: 'kv', label: 'Datum', value: new Date().toISOString().slice(0, 10) },
    { t: 'sp', size: 8 },
    { t: 'h2', text: `Positionen (${pos.length})` },
  ];
  if (pos.length) {
    for (const p of pos) {
      const menge = [p && p.menge, p && p.einheit].filter(Boolean).join(' ');
      blocks.push({ t: 'kv', label: (p && p.position) || '–', value: menge || '—' });
    }
  } else {
    blocks.push({ t: 'text', text: 'Keine Positionen erfasst.' });
  }
  if (notiz) { blocks.push({ t: 'sp', size: 6 }); blocks.push({ t: 'h2', text: 'Notiz' }); blocks.push({ t: 'text', text: notiz }); }
  blocks.push({ t: 'sp', size: 10 });
  blocks.push({ t: 'text', text: `Erstellt: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · George Solutions` });
  return buildPdf({ title: 'George Solutions', blocks });
}

export function buildRechnungPdf(inv) {
  const blocks = [
    { t: 'h1', text: 'Rechnung ' + (inv.rechnungsnummer || '') },
    { t: 'kv', label: 'Projekt', value: inv.projekt_name || '–' },
    { t: 'kv', label: 'Projektnummer', value: inv.projektnummer || '–' },
    { t: 'kv', label: 'Datum', value: new Date().toISOString().slice(0, 10) },
    { t: 'sp', size: 8 },
    { t: 'h2', text: 'Leistung' },
    { t: 'kv', label: 'Stunden', value: `${inv.stunden} h` },
    { t: 'kv', label: 'Stundensatz', value: `CHF ${Number(inv.stundensatz).toFixed(2)}` },
    { t: 'kv', label: 'Betrag', value: `CHF ${Number(inv.betrag).toFixed(2)}` },
    { t: 'sp', size: 10 },
    { t: 'text', text: 'Zahlbar innert 30 Tagen. Vielen Dank für Ihr Vertrauen.' },
    { t: 'text', text: `Erstellt: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · George Solutions` },
  ];
  return buildPdf({ title: 'George Solutions', blocks });
}
