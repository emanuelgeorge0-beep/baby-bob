// lib/pdf.js — dependency-free PDF generator (hand-rolled, valid PDF 1.4).
// No npm deps → zero build/deploy risk. Produces clean A4 documents with
// Helvetica (WinAnsi), used for rapport + invoice PDFs.
//
// Kann seit der Wochenbericht-Runde zusätzlich:
//   • mehrere Seiten mit echtem Seitenumbruch (vorher: einseitig, Text
//     überdruckte sich am Fussrand)
//   • Zeilenumbruch nach gemessener Textbreite (Helvetica-AFM)
//   • Tabellengitter mit Kopfzeile, die auf Folgeseiten wiederholt wird
//   • JPEG-Bilder als XObject (/DCTDecode — die Bytes wandern unverändert in
//     den Stream, kein Decoder nötig)
//   • Logo im Kopf + goldene Trennlinie (Eiserne Regel 6)
//
// Bestehende Aufrufer (buildRapportPdf, buildMaterialPdf, buildBlockadePdf,
// buildBlockadenReportPdf, buildRechnungPdf, api/cockpit.js) bleiben unverändert
// gültig: ohne `logo` gilt exakt die alte Kopfgeometrie, die neuen Blocktypen
// sind rein additiv.

const WIN = {
  'ä':'\\344','ö':'\\366','ü':'\\374','Ä':'\\304','Ö':'\\326','Ü':'\\334','ß':'\\337',
  'é':'\\351','è':'\\350','à':'\\340','ç':'\\347','£':'\\243','€':'\\200','°':'\\260',
  // WinAnsi (CP1252) belegt 0x80–0x9F mit typografischen Zeichen. Ohne diese Zeilen
  // landete jedes '–' als '?' im PDF — und der Code ist voll davon (allein
  // buildRapportPdf setzt es als Platzhalter für jedes leere Feld).
  '–':'\\226','—':'\\227','‘':'\\221','’':'\\222','‚':'\\202','“':'\\223','”':'\\224',
  '„':'\\204','•':'\\225','…':'\\205','†':'\\206','‡':'\\207','‰':'\\211','‹':'\\213',
  '›':'\\233','™':'\\231','ƒ':'\\203','ˆ':'\\210','˜':'\\230','Š':'\\212','š':'\\232',
  'Ž':'\\216','ž':'\\236','Œ':'\\214','œ':'\\234','Ÿ':'\\237',
};

// Zeichen, für die WinAnsi überhaupt keinen Platz hat, die im Code aber vorkommen.
// Ersatz statt '?' — ein Häkchen als Fragezeichen zu drucken ist schlechter als
// gar keins. Alles NICHT hier Aufgeführte bleibt bewusst '?': bei fremder Schrift
// (z.B. Chinesisch) ist ein sichtbarer Platzhalter ehrlicher als stilles Löschen.
const TRANSLIT = {
  '✓': '', '✔': '',                  // Haken — WinAnsi hat keinen
  '✗': 'x', '✘': 'x',
  '→': '->', '←': '<-', '≤': '<=', '≥': '>=',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', // geschützte/schmale Leerzeichen
};

function esc(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    if (ch === '(') out += '\\(';
    else if (ch === ')') out += '\\)';
    else if (ch === '\\') out += '\\\\';
    else if (WIN[ch]) out += WIN[ch];
    else if (TRANSLIT[ch] != null) out += esc(TRANSLIT[ch]);
    else {
      const code = ch.charCodeAt(0);
      out += code >= 32 && code < 127 ? ch : (code <= 255 ? '\\' + code.toString(8).padStart(3, '0') : '?');
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Zeichenbreiten (Adobe-AFM, 1/1000 em). Ohne die kann man nicht umbrechen,
// nicht rechtsbündig setzen und keine Tabellenzelle sauber kürzen.
// ═══════════════════════════════════════════════════════════════════════════
// Codes 32–126 in Reihenfolge.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
// Zeichen oberhalb 126, deren Laufweite NICHT der eines Grundbuchstabens
// entspricht. Akzentbuchstaben stehen bewusst nicht drin — in Helvetica läuft
// 'é' genau so breit wie 'e', das erledigt die NFD-Zerlegung in charW().
const W_EXTRA_REG = {
  'ß':611,'æ':889,'Æ':1000,'œ':944,'Œ':1000,'ø':611,'Ø':778,'ð':556,'þ':556,'Þ':667,
  'µ':556,'·':278,'«':556,'»':556,'°':400,'§':556,'©':737,'®':737,'±':584,'¬':584,
  '¼':834,'½':834,'¾':834,'¡':333,'¿':611,'×':584,'÷':584,'¢':556,'£':556,'¥':556,
  '¤':556,'€':556,'¦':260,'¨':333,'ª':370,'º':365,'¯':333,'´':333,'¶':537,'¸':333,
  '–':556,'—':1000,'‘':222,'’':222,'‚':222,'“':333,'”':333,'„':333,'•':350,'…':1000,
  '†':556,'‡':556,'‰':1000,'‹':333,'›':333,'™':1000,'ƒ':556,'ˆ':333,'˜':333,
  'Š':667,'š':500,'Ž':611,'ž':500,'Ÿ':667,
};
const W_EXTRA_BLD = {
  'ß':611,'æ':889,'Æ':1000,'œ':611,'Œ':1000,'ø':611,'Ø':778,'ð':611,'þ':611,'Þ':667,
  'µ':611,'·':278,'«':556,'»':556,'°':400,'§':556,'©':737,'®':737,'±':584,'¬':584,
  '¼':834,'½':834,'¾':834,'¡':333,'¿':611,'×':584,'÷':584,'¢':556,'£':556,'¥':556,
  '¤':556,'€':556,'¦':280,'¨':333,'ª':370,'º':365,'¯':333,'´':333,'¶':556,'¸':333,
  '–':556,'—':1000,'‘':278,'’':278,'‚':278,'“':500,'”':500,'„':500,'•':350,'…':1000,
  '†':556,'‡':556,'‰':1000,'‹':333,'›':333,'™':1000,'ƒ':556,'ˆ':333,'˜':333,
  'Š':667,'š':556,'Ž':611,'ž':500,'Ÿ':667,
};

function charW(ch, bold) {
  const T = bold ? W_BLD : W_REG;
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) return T[code - 32];
  const ex = (bold ? W_EXTRA_BLD : W_EXTRA_REG)[ch];
  if (ex) return ex;
  // TRANSLIT-Zeichen messen wie ihr Ersatz (✓ → nichts, → → '->').
  const tr = TRANSLIT[ch];
  if (tr != null) { let w = 0; for (const c of tr) w += charW(c, bold); return w; }
  // Akzentbuchstabe → Grundbuchstabe. 'é' läuft in Helvetica so breit wie 'e'.
  const base = ch.normalize('NFD').charCodeAt(0);
  if (base >= 32 && base <= 126) return T[base - 32];
  return T[31]; // '?' — genau das rendert esc() hier auch
}

export function textWidth(s, size, bold) {
  let w = 0;
  for (const ch of String(s == null ? '' : s)) w += charW(ch, bold);
  return (w * size) / 1000;
}

// Umbruch nach gemessener Breite. Wörter, die allein zu breit sind, werden hart
// zerlegt (sonst läuft z.B. eine lange Projektnummer aus der Spalte).
export function wrapText(s, maxW, size, bold) {
  const src = String(s == null ? '' : s).replace(/\r/g, '');
  const out = [];
  for (const para of src.split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const probe = line ? line + ' ' + word : word;
      if (textWidth(probe, size, bold) <= maxW) { line = probe; continue; }
      if (line) { out.push(line); line = ''; }
      if (textWidth(word, size, bold) <= maxW) { line = word; continue; }
      let chunk = '';
      for (const ch of word) {
        if (textWidth(chunk + ch, size, bold) > maxW && chunk) { out.push(chunk); chunk = ''; }
        chunk += ch;
      }
      line = chunk;
    }
    if (line) out.push(line);
  }
  return out.length ? out : [''];
}

// Einzeiliges Kürzen mit Ellipse — für Tabellenzellen, die nicht wachsen dürfen.
export function clipText(s, maxW, size, bold) {
  const str = String(s == null ? '' : s);
  if (textWidth(str, size, bold) <= maxW) return str;
  let out = '';
  for (const ch of str) {
    if (textWidth(out + ch + '…', size, bold) > maxW) break;
    out += ch;
  }
  return out + '…';
}

// ═══════════════════════════════════════════════════════════════════════════
// JPEG — Kopf auslesen. PDF braucht Breite/Höhe/Komponenten, um das Bild als
// XObject einzubetten; die komprimierten Bytes selbst gehen unverändert durch
// (/DCTDecode). Kein Decoder, keine Abhängigkeit.
// ═══════════════════════════════════════════════════════════════════════════
const SOF = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);

export function jpegInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null; // kein SOI → kein JPEG
  let p = 2;
  while (p + 3 < buf.length) {
    if (buf[p] !== 0xFF) { p++; continue; }        // Füllbytes überspringen
    const marker = buf[p + 1];
    if (marker === 0xFF) { p++; continue; }
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { p += 2; continue; }
    if (marker === 0xD9 || marker === 0xDA) break; // EOI / Start of Scan
    const len = buf.readUInt16BE(p + 2);
    if (len < 2 || p + 2 + len > buf.length) return null;
    if (SOF.has(marker)) {
      if (p + 9 > buf.length) return null;
      return {
        height: buf.readUInt16BE(p + 5),
        width: buf.readUInt16BE(p + 7),
        components: buf[p + 9],
        // Progressive JPEG (SOF2) ist von /DCTDecode NICHT gedeckt. Wir melden es,
        // statt eine Datei zu erzeugen, die manche Reader stumm leer anzeigen.
        progressive: marker === 0xC2 || marker === 0xC6 || marker === 0xCA || marker === 0xCE,
      };
    }
    p += 2 + len;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Seitengeometrie und Farben.
// Eiserne Regel 6: Dokument = weisser Grund, schwarze Schrift, dünne goldene
// Trennlinie #C9A961 unter dem Kopf, sonst neutral.
// ═══════════════════════════════════════════════════════════════════════════
const PAGE_W = 595, PAGE_H = 842;
const LEFT = 56, RIGHT = 539;              // wie bisher
const CONTENT_W = RIGHT - LEFT;            // 483
const BOTTOM = 56;                         // unterste Textgrundlinie
const GOLD = '0.788 0.663 0.380';          // #C9A961 — vorher stand hier 0.79 0.63 0 (kein Gold)
const GRID = '0.76 0.76 0.76';
const HEADBG = '0.945 0.945 0.945';
const MUTED = '0.42 0.42 0.42';

// Kopfgeometrie OHNE Logo — Bit für Bit die bisherige, damit die fünf
// bestehenden Dokumente unverändert aussehen.
const PLAIN_TITLE_Y = PAGE_H - 64 - 26;    // 752
const PLAIN_RULE_Y = PLAIN_TITLE_Y - 8;    // 744
const PLAIN_TOP = PLAIN_RULE_Y - 10;       // 734

// Kopfgeometrie MIT Logo (Regel 6: Logo oben, goldene Linie darunter).
const LOGO_H = 30;
const LOGO_TOP = PAGE_H - 48;              // 794
const LOGO_BOTTOM = LOGO_TOP - LOGO_H;     // 764
const HEAD_RULE_Y = LOGO_BOTTOM - 12;      // 752
const HEAD_TOP = HEAD_RULE_Y - 16;         // 736

export function buildPdf({ title, subtitle, blocks, logo, footer }) {
  // ── Bilder sammeln: Logo + alle img/imgrow-Blöcke → XObjects ──
  const images = [];                       // [{buf, info}]
  const imgRef = (buf) => {
    if (!Buffer.isBuffer(buf)) return null;
    const info = jpegInfo(buf);
    if (!info || info.progressive || !(info.width > 0) || !(info.height > 0)) return null;
    if (info.components !== 1 && info.components !== 3 && info.components !== 4) return null;
    const found = images.findIndex((x) => x.buf.equals(buf));
    if (found >= 0) return { name: `Im${found}`, info };
    images.push({ buf, info });
    return { name: `Im${images.length - 1}`, info };
  };
  const logoImg = logo ? imgRef(logo) : null;
  const hasHead = !!logoImg;

  // ── Seitenzustand ──
  const pages = [];                        // [[op, …], …]
  let ops = null;
  let y = 0;

  const drawHead = () => {
    if (hasHead) {
      const w = LOGO_H * (logoImg.info.width / logoImg.info.height);
      ops.push(`q ${w.toFixed(2)} 0 0 ${LOGO_H} ${LEFT} ${LOGO_BOTTOM} cm /${logoImg.name} Do Q`);
      if (title) {
        const tw = textWidth(title, 13, true);
        ops.push(`BT /F1 13 Tf ${(RIGHT - tw).toFixed(2)} ${LOGO_BOTTOM + 17} Td (${esc(title)}) Tj ET`);
      }
      if (subtitle) {
        const sw = textWidth(subtitle, 9, false);
        ops.push(`${MUTED} rg BT /F2 9 Tf ${(RIGHT - sw).toFixed(2)} ${LOGO_BOTTOM + 4} Td (${esc(subtitle)}) Tj ET 0 0 0 rg`);
      }
      ops.push(`${GOLD} RG 1 w ${LEFT} ${HEAD_RULE_Y} m ${RIGHT} ${HEAD_RULE_Y} l S`);
      y = HEAD_TOP;
      return;
    }
    // Alter Pfad: Titel gross, goldene Linie darunter.
    if (title) {
      ops.push(`BT /F1 20 Tf ${LEFT} ${PLAIN_TITLE_Y} Td (${esc(title)}) Tj ET`);
      ops.push(`${GOLD} RG 2 w ${LEFT} ${PLAIN_RULE_Y} m ${RIGHT} ${PLAIN_RULE_Y} l S`);
      y = PLAIN_TOP;
    } else {
      y = PAGE_H - 64;
    }
  };
  const newPage = () => { ops = []; pages.push(ops); drawHead(); };
  // Passt `h` noch auf die Seite? Sonst umbrechen.
  const need = (h) => { if (y - h < BOTTOM) newPage(); };

  const put = (txt, x, baseline, size, bold) =>
    ops.push(`BT /${bold ? 'F1' : 'F2'} ${size} Tf ${x.toFixed(2)} ${baseline.toFixed(2)} Td (${esc(txt)}) Tj ET`);

  // Mehrzeiliger Absatz ab der aktuellen Höhe, mit Umbruch über Seitengrenzen.
  const paragraph = (txt, size, bold, x, maxW, lead) => {
    const lh = lead || size * 1.45;
    for (const ln of wrapText(txt, maxW, size, bold)) {
      need(lh);
      y -= lh;
      if (ln) put(ln, x, y, size, bold);
    }
  };

  newPage();

  for (const b of blocks || []) {
    if (!b) continue;

    if (b.t === 'sp') { y -= (b.size || 10); if (y < BOTTOM) newPage(); continue; }

    if (b.t === 'pb') { newPage(); continue; }

    // Platzreservierung: bricht um, wenn der angeforderte Block nicht mehr
    // ganz auf die Seite passt. Damit bleibt ein Tagesblock zusammen.
    if (b.t === 'need') { need(b.h || 100); continue; }

    if (b.t === 'h1') { need(30); y -= 24; put(b.text, LEFT, y, 15, true); continue; }

    if (b.t === 'h2') { need(26); y -= 20; put(b.text, LEFT, y, 12, true); continue; }

    if (b.t === 'rule') {
      need(12); y -= 8;
      const col = b.gold ? GOLD : GRID;
      ops.push(`${col} RG ${b.gold ? 1 : 0.5} w ${LEFT} ${y.toFixed(2)} m ${RIGHT} ${y.toFixed(2)} l S`);
      y -= 4;
      continue;
    }

    if (b.t === 'kv') {
      const vx = LEFT + 150;
      const lines = wrapText(b.value, RIGHT - vx, 10, false);
      need(16 + (lines.length - 1) * 14);
      y -= 16;
      put(b.label, LEFT, y, 10, true);
      put(lines[0], vx, y, 10, false);
      for (let i = 1; i < lines.length; i++) { need(14); y -= 14; put(lines[i], vx, y, 10, false); }
      continue;
    }

    if (b.t === 'table') { drawTable(b); continue; }

    if (b.t === 'img' || b.t === 'imgrow') { drawImages(b); continue; }

    // 'text' und alles Unbekannte: normaler Fliesstext mit Umbruch.
    paragraph(b.text, b.size || 10, !!b.bold, LEFT, CONTENT_W, b.lead || 15);
  }

  // ── Tabelle mit Gitter; Kopfzeile wiederholt sich auf Folgeseiten ──────────
  function drawTable(b) {
    const cols = (b.cols || []).map((c) => ({ w: Number(c.w) || 0, label: c.label || '', align: c.align || 'left' }));
    if (!cols.length) return;
    const total = cols.reduce((s, c) => s + c.w, 0) || 1;
    const scale = CONTENT_W / total;                 // Spalten immer auf Satzbreite normieren
    cols.forEach((c) => { c.w *= scale; });
    const size = b.size || 9;
    const lh = size * 1.35;
    const padX = 4, padY = 4;

    const cellOf = (raw) => (raw && typeof raw === 'object' && !Array.isArray(raw))
      ? { text: raw.text == null ? '' : String(raw.text), bold: !!raw.bold, align: raw.align }
      : { text: raw == null ? '' : String(raw), bold: false, align: undefined };

    const layout = (cells) => {
      const per = cells.map((c, i) => wrapText(cellOf(c).text, cols[i].w - 2 * padX, size, cellOf(c).bold));
      const rows = Math.max(1, ...per.map((l) => l.length));
      return { per, h: rows * lh + 2 * padY };
    };

    const rowOut = (cells, h, per, bold, fill) => {
      const top = y, bot = y - h;
      if (fill) ops.push(`${HEADBG} rg ${LEFT} ${bot.toFixed(2)} ${CONTENT_W.toFixed(2)} ${h.toFixed(2)} re f 0 0 0 rg`);
      let x = LEFT;
      cells.forEach((raw, i) => {
        const c = cellOf(raw);
        const align = c.align || cols[i].align;
        const isB = bold || c.bold;
        per[i].forEach((ln, k) => {
          if (!ln) return;
          const by = top - padY - (k + 1) * lh + lh * 0.28;
          const tw = textWidth(ln, size, isB);
          const tx = align === 'right' ? x + cols[i].w - padX - tw
            : align === 'center' ? x + (cols[i].w - tw) / 2
              : x + padX;
          put(ln, tx, by, size, isB);
        });
        x += cols[i].w;
      });
      // Gitter: Rahmen + Spaltentrenner
      ops.push(`${GRID} RG 0.5 w`);
      ops.push(`${LEFT} ${top.toFixed(2)} ${CONTENT_W.toFixed(2)} ${(-h).toFixed(2)} re S`);
      let vx = LEFT;
      for (let i = 0; i < cols.length - 1; i++) {
        vx += cols[i].w;
        ops.push(`${vx.toFixed(2)} ${top.toFixed(2)} m ${vx.toFixed(2)} ${bot.toFixed(2)} l S`);
      }
      y = bot;
    };

    const head = () => {
      const labels = cols.map((c) => ({ text: c.label, bold: true }));
      const L = layout(labels);
      need(L.h);
      rowOut(labels, L.h, L.per, true, true);
    };

    y -= (b.gap == null ? 8 : b.gap);
    if (y < BOTTOM) newPage();
    if (cols.some((c) => c.label)) head();

    for (const r of (b.rows || [])) {
      const cells = Array.isArray(r) ? r : [r];
      while (cells.length < cols.length) cells.push('');
      const L = layout(cells);
      if (y - L.h < BOTTOM) { newPage(); if (cols.some((c) => c.label)) head(); }
      rowOut(cells, L.h, L.per, false, false);
    }
  }

  // ── Bilder: einzeln oder als Raster (Fotoseite) ───────────────────────────
  function drawImages(b) {
    const list = (b.t === 'img' ? [b.data] : (b.images || [])).filter(Buffer.isBuffer);
    if (!list.length) return;
    const perRow = Math.max(1, b.perRow || (b.t === 'img' ? 1 : 3));
    const gap = b.gap == null ? 8 : b.gap;
    const cellW = (CONTENT_W - gap * (perRow - 1)) / perRow;
    const maxH = b.maxH || (b.t === 'img' ? 220 : 120);
    const captions = Array.isArray(b.captions) ? b.captions : [];

    for (let i = 0; i < list.length; i += perRow) {
      const chunk = list.slice(i, i + perRow);
      const drawn = chunk.map((buf) => {
        const ref = imgRef(buf);
        if (!ref) return null;
        const ratio = ref.info.width / ref.info.height;
        let w = cellW, h = w / ratio;
        if (h > maxH) { h = maxH; w = h * ratio; }
        return { ref, w, h };
      });
      const rowH = Math.max(0, ...drawn.map((d) => (d ? d.h : 14)));
      const capH = captions.length ? 12 : 0;
      need(rowH + capH + gap);
      y -= gap;
      const top = y;
      drawn.forEach((d, k) => {
        const x = LEFT + k * (cellW + gap);
        if (!d) {
          // Kein verwertbares JPEG (z.B. progressiv oder kaputt) — ehrlich
          // benennen statt eine leere Fläche zu zeigen.
          ops.push(`${MUTED} rg`);
          put('Bild nicht darstellbar', x, top - 12, 8, false);
          ops.push('0 0 0 rg');
          return;
        }
        ops.push(`q ${d.w.toFixed(2)} 0 0 ${d.h.toFixed(2)} ${x.toFixed(2)} ${(top - d.h).toFixed(2)} cm /${d.ref.name} Do Q`);
        const cap = captions[i + k];
        if (cap) {
          ops.push(`${MUTED} rg`);
          // Bildunterschriften auf EINE Grundlinie je Reihe, nicht unter das
          // jeweilige Bild: bei gemischten Seitenverhältnissen (Hoch- neben
          // Querformat) tanzten sie sonst auf drei Höhen.
          put(clipText(cap, cellW, 7.5, false), x, top - rowH - 9, 7.5, false);
          ops.push('0 0 0 rg');
        }
      });
      y = top - rowH - capH;
    }
  }

  // ── Fusszeile: nur bei mehreren Seiten oder auf Wunsch ────────────────────
  const wantFooter = !!footer || pages.length > 1;
  if (wantFooter) {
    pages.forEach((pg, i) => {
      const txt = `${footer ? footer + ' · ' : ''}Seite ${i + 1} von ${pages.length}`;
      const w = textWidth(txt, 8, false);
      pg.push(`${MUTED} rg BT /F2 8 Tf ${(RIGHT - w).toFixed(2)} 32 Td (${esc(txt)}) Tj ET 0 0 0 rg`);
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Objekte zusammensetzen, Byte-genaue xref.
  // 1 Catalog · 2 Pages · 3 F1 · 4 F2 · 5… Bilder · dann je Seite Page+Content.
  // ═════════════════════════════════════════════════════════════════════════
  const imgBase = 5;
  const pageBase = imgBase + images.length;
  const kids = pages.map((_, i) => `${pageBase + i * 2} 0 R`).join(' ');
  const xobj = images.length
    ? `/XObject<<${images.map((_, i) => `/Im${i} ${imgBase + i} 0 R`).join('')}>>`
    : '';
  const resources = `<</Font<</F1 3 0 R/F2 4 0 R>>${xobj}>>`;

  const objs = [];
  objs.push({ head: `<</Type/Catalog/Pages 2 0 R>>` });
  objs.push({ head: `<</Type/Pages/Kids[${kids}]/Count ${pages.length}>>` });
  objs.push({ head: '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>' });
  objs.push({ head: '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>' });
  for (const im of images) {
    const cs = im.info.components === 1 ? '/DeviceGray' : im.info.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    // Adobe-CMYK-JPEGs liegen invertiert vor — ohne Decode-Array käme ein Negativ.
    const dec = im.info.components === 4 ? '/Decode[1 0 1 0 1 0 1 0]' : '';
    objs.push({
      head: `<</Type/XObject/Subtype/Image/Width ${im.info.width}/Height ${im.info.height}`
        + `/ColorSpace ${cs}${dec}/BitsPerComponent 8/Filter/DCTDecode/Length ${im.buf.length}>>`,
      stream: im.buf,
    });
  }
  for (const pg of pages) {
    const content = pg.join('\n');
    objs.push({ head: `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PAGE_W} ${PAGE_H}]/Resources ${resources}/Contents ${objs.length + 2} 0 R>>` });
    objs.push({ head: `<</Length ${Buffer.byteLength(content, 'latin1')}>>`, stream: Buffer.from(content, 'latin1') });
  }

  const parts = [];
  let pos = 0;
  const push = (chunk) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'latin1');
    parts.push(buf); pos += buf.length;
  };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');   // Binär-Marker: sagt Werkzeugen, dass Bytes >127 vorkommen
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pos);
    push(`${i + 1} 0 obj\n${o.head}\n`);
    if (o.stream) { push('stream\n'); push(o.stream); push('\nendstream\n'); }
    push('endobj\n');
  });
  const xrefStart = pos;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { xref += `${String(o).padStart(10, '0')} 00000 n \n`; });
  xref += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  push(xref);

  return Buffer.concat(parts);
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

// Blockaden-PDF (Anhang der Sofort-Benachrichtigung). Ein Beleg pro Blockade.
export function buildBlockadePdf(b) {
  const b0 = b || {};
  const ort = [b0.haus, b0.einheit, b0.zone].filter(Boolean).join(' · ') || '–';
  const blocks = [
    { t: 'h1', text: 'Blockade-Meldung' },
    { t: 'kv', label: 'Dringlichkeit', value: (b0.urgency || 'MEDIUM') },
    { t: 'kv', label: 'Status', value: (b0.status || 'offen') },
    { t: 'kv', label: 'Projekt', value: b0.projekt_name || '–' },
    { t: 'kv', label: 'Ort (Haus/Einheit/Zone)', value: ort },
    { t: 'kv', label: 'Blockierter Step', value: b0.step_ref || '–' },
    { t: 'kv', label: 'Blockiert von (Rolle)', value: b0.blockiert_von_rolle || '–' },
    { t: 'kv', label: 'Gemeldet von', value: b0.reporter_name || '–' },
    { t: 'kv', label: 'Datum', value: (b0.created_at ? String(b0.created_at).slice(0, 16).replace('T', ' ') : new Date().toISOString().slice(0, 16).replace('T', ' ')) },
    { t: 'sp', size: 8 },
    { t: 'h2', text: 'Beschreibung' },
    { t: 'text', text: b0.beschreibung || '–' },
  ];
  if (Array.isArray(b0.fotos) && b0.fotos.length) blocks.push({ t: 'kv', label: 'Fotos', value: `${b0.fotos.length} angehängt` });
  if (b0.resolution) { blocks.push({ t: 'h2', text: 'Auflösung' }); blocks.push({ t: 'text', text: b0.resolution }); }
  blocks.push({ t: 'sp', size: 10 });
  blocks.push({ t: 'text', text: `Erstellt: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · George Solutions` });
  return buildPdf({ title: 'George Solutions', blocks });
}

// Wochen-Blockaden-Report: „Was hat uns diese Woche verzögert?" – alle Blockaden der KW.
export function buildBlockadenReportPdf({ kw, jahr, blockaden, projektName }) {
  const list = Array.isArray(blockaden) ? blockaden : [];
  const offen = list.filter((b) => b.status !== 'freigegeben').length;
  const eskaliert = list.filter((b) => b.eskaliert || b.status === 'eskaliert').length;
  const blocks = [
    { t: 'h1', text: `Blockaden-Wochenreport KW ${kw || '–'}/${jahr || '–'}` },
    projektName ? { t: 'kv', label: 'Projekt', value: projektName } : { t: 'kv', label: 'Umfang', value: 'alle Projekte' },
    { t: 'kv', label: 'Blockaden gesamt', value: String(list.length) },
    { t: 'kv', label: 'noch offen', value: String(offen) },
    { t: 'kv', label: 'eskaliert', value: String(eskaliert) },
    { t: 'sp', size: 8 },
    { t: 'h2', text: 'Blockaden im Detail' },
  ];
  if (!list.length) {
    blocks.push({ t: 'text', text: 'Keine Blockaden in dieser Kalenderwoche – reibungsloser Ablauf.' });
  } else {
    // Nach Dringlichkeit sortiert (CRITICAL zuerst). Seit dem Mehrseiten-Umbau
    // kein Kürzen mehr nötig — der Bericht bricht sauber um.
    const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const sorted = list.slice().sort((a, b) => (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9));
    sorted.forEach((b, i) => {
      const ort = [b.projekt_name, b.haus, b.einheit, b.zone].filter(Boolean).join(' · ');
      blocks.push({ t: 'need', h: 70 });
      blocks.push({ t: 'h2', text: `${i + 1}. [${b.urgency || 'MEDIUM'}] ${b.step_ref || 'Step'} – ${b.status || 'offen'}` });
      if (ort) blocks.push({ t: 'kv', label: 'Ort', value: ort });
      blocks.push({ t: 'text', text: b.beschreibung || '–' });
      if (b.resolution) blocks.push({ t: 'kv', label: 'Auflösung', value: b.resolution });
      blocks.push({ t: 'sp', size: 4 });
    });
  }
  blocks.push({ t: 'sp', size: 8 });
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
