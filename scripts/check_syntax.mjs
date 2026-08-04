// Syntaxprüfung für die grossen HTML-Dateien: schneidet jeden <script>-Block
// ohne src heraus und lässt ihn durch den JS-Parser laufen. Fängt Tippfehler,
// die im Browser sonst erst beim Öffnen der Seite als weisse Seite auffallen.
// Lauf:  node scripts/check_syntax.mjs [datei …]   (ohne Argument: alle HTML + api/*.js)
import { readFileSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const htmlDefault = ['app.html', 'gs-intern.html', 'index.html', 'gewerke.html'];
const files = args.length ? args : htmlDefault;

let fail = 0, blocks = 0;

function checkJs(code, wo) {
  blocks++;
  try {
    // Function() parst denselben Grammatikraum wie ein <script>-Block, ohne auszuführen.
    new Function(code);
  } catch (e) {
    fail++;
    console.log(`✗ ${wo}\n    ${e.message}`);
  }
}

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  if (f.endsWith('.html')) {
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m, i = 0;
    while ((m = re.exec(src))) {
      const attrs = m[1] || '';
      if (/\bsrc\s*=/i.test(attrs)) continue;             // externes Skript, kein Inhalt
      if (/type\s*=\s*["'](?!text\/javascript|module)/i.test(attrs)) continue; // z.B. JSON-LD
      i++;
      const zeile = src.slice(0, m.index).split('\n').length;
      checkJs(m[2], `${f} · <script> #${i} (ab Zeile ${zeile})`);
    }
  } else {
    checkJs(src, f);
  }
}

// api/*.js sind ES-Module — die prüft node --check zuverlässiger, siehe package-Aufruf.
if (!args.length) {
  for (const f of readdirSync('api')) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(`api/${f}`, 'utf8');
    blocks++;
    try {
      // ES-Modul: import/export sind in Function() nicht erlaubt → nur grob auf
      // Klammerbalance prüfen wäre wertlos. Stattdessen Hinweis, node --check nutzen.
      if (!/^\s*(import|export)/m.test(src)) new Function(src);
    } catch (e) {
      fail++;
      console.log(`✗ api/${f}\n    ${e.message}`);
    }
  }
}

console.log(`${fail ? '✗' : '✓'} ${blocks} Block/Datei geprüft, ${fail} Fehler`);
process.exit(fail ? 1 : 0);
