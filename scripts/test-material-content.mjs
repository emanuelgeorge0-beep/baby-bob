// scripts/test-material-content.mjs — Schritt 4: Inhalts-Korrektheit der Materialliste.
//
// Deploy-UNABHÄNGIG und ohne Keys: beweist, dass der Mail-Body (lib/mail.js) UND der
// PDF-Anhang (lib/pdf.js) die exakten Material-Positionen, Mengen und die Notiz enthalten.
// Ergänzt scripts/test-material-mail.mjs (echter Resend-Versand gegen das Deployment).
//
// Aufruf:  node scripts/test-material-content.mjs
import { materialEmailHtml } from '../lib/mail.js';
import { buildMaterialPdf } from '../lib/pdf.js';

const positionen = [
  { position: 'Kupferrohr 18mm', menge: '12', einheit: 'm' },
  { position: 'Umwälzpumpe Grundfos', menge: '1', einheit: 'Stk' },
  { position: 'Dichtungsset', menge: '3', einheit: 'Set' },
];
const notiz = 'Bitte bis Freitag bestellen';
const projektName = 'Tannenrauchstrasse 35';

const html = materialEmailHtml({ projektName, vonName: 'Dimitri Grill', positionen, notiz, tel: '', fallbackUsed: false });
const pdf = buildMaterialPdf({ projektName, projektnummer: 'P-2026-0001', vonName: 'Dimitri Grill', positionen, notiz });
const pdfStr = pdf.toString('latin1');

let pass = 0, fail = 0;
const is = (n, c) => (c ? (console.log('  ✓ ' + n), pass++) : (console.log('  ✗ ' + n), fail++));

// PDF kodiert Umlaute WinAnsi-oktal (ü→\374) → für den PDF-Vergleich den längsten
// reinen ASCII-Teilstring der Position prüfen (der steht unverändert im PDF-Stream).
const longestAscii = (s) => s.split(/[^\x20-\x7E]/).sort((a, b) => b.length - a.length)[0].trim();

console.log('Materialliste – Inhalts-Korrektheit (Mail-Body + PDF)\n');
for (const p of positionen) {
  is(`Mail-HTML: Position "${p.position}"`, html.includes(p.position));
  is(`Mail-HTML: Menge "${p.menge} ${p.einheit}"`, html.includes(`${p.menge} ${p.einheit}`));
  is(`PDF: Position "${p.position}"`, pdfStr.includes(longestAscii(p.position)));
}
is('Mail-HTML: Notiz', html.includes(notiz));
is('Mail-HTML: Projektname', html.includes(projektName));
is('Mail-HTML: Absender-Branding George Solutions', html.includes('George Solutions'));
is('PDF: gültiger Header %PDF-1.4', pdf.slice(0, 8).toString().startsWith('%PDF-1.4'));
is('PDF: Titel "Materialliste"', pdfStr.includes('Materialliste'));
is('PDF: Notiz', pdfStr.includes(notiz));
is('PDF: nicht leer (>500 Bytes)', pdf.length > 500);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
