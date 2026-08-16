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
const L_LEFT = 56, L_RIGHT = 539;          // Satzspiegel der fünf Altdokumente
const BOTTOM_ALT = 56;                     // unterste Textgrundlinie, alter Stil
const GOLD = '0.788 0.663 0.380';          // #C9A961 — vorher stand hier 0.79 0.63 0 (kein Gold)
const GRID = '0.76 0.76 0.76';
const HEADBG = '0.945 0.945 0.945';
const MUTED = '0.42 0.42 0.42';

// ── Dokumentstil 'brief' (Wochenbericht & Nachfolger) ─────────────────────
// Breiterer Rand, schwarzer randabfallender Kopfbalken, Tabellen ohne Gitter,
// Fusszeile mit Logo. Der alte Stil bleibt Bit für Bit, wo `style` fehlt —
// Rapport, Materialliste, Blockade, Blockadenreport und Rechnung sind nicht
// Teil dieser Runde und dürfen sich nicht verändern.
const B_LEFT = 62, B_RIGHT = 533;          // Satzbreite 471
const B_BOTTOM = 94;                       // darüber endet der Text, darunter der Fuss
const HAIR = '0.87 0.87 0.87';             // Trennlinien in Tabellen
const TILEBG = '0.965 0.965 0.965';        // Füllung der Info-Kacheln
const LABELCOL = '0.35 0.35 0.35';         // Tabellenköpfe, Kachel-Labels
const BAR1_H = 106, BAR2_H = 60;           // Kopfbalken Seite 1 / Folgeseiten

// '#C9A961' → '0.788 0.663 0.380'. Ungültige Werte fallen auf Gold zurück,
// damit eine vertippte Farbe in gs_branding kein Dokument zerlegt.
function hexRgb(hex, fallback) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return `${(((n >> 16) & 255) / 255).toFixed(3)} ${(((n >> 8) & 255) / 255).toFixed(3)} ${((n & 255) / 255).toFixed(3)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Branding aus gs_branding
// ═══════════════════════════════════════════════════════════════════════════
// Farbe, Logo, Firmenname und Fusszeile stehen nicht mehr im Code, sondern in
// der Tabelle (scripts/branding_tabelle.sql). Eine Zeile mit passender
// partner_id gewinnt gegen die Zeile mit partner_id NULL (= Standard für alle).
//
// Der Fallback unten ist KEIN zweiter Ort für Gestaltung, sondern eine
// Reissleine: fehlt die Tabelle, die Zeile oder die Umgebung, wird trotzdem ein
// Bericht erzeugt, statt dass der Versand am Branding scheitert. Ob geladen
// oder gefallen, steht im Ergebnis (`aus_tabelle`) und ist damit prüfbar.
export const BRANDING_FALLBACK = {
  firmenname: 'George Solutions',
  akzentfarbe: '#C9A961',
  logo_url: 'lib/logo-gs.jpg',
  fusszeile: null,
};
const LOGO_BASIS_URL = 'https://baby-bob.vercel.app/';
const _brandingCache = new Map();

// Logo aus einem Repo-Pfad ODER einer absoluten URL. Reihenfolge wie bisher:
// lokale Datei zuerst (im Vercel-Bundle vorhanden), dann öffentlich über HTTP.
async function ladeLogoBytes(quelle) {
  const s = String(quelle || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    try {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      return readFileSync(join(process.cwd(), ...s.replace(/^\/+/, '').split('/')));
    } catch (_) { /* nächster Weg */ }
  }
  const url = /^https?:\/\//i.test(s) ? s : LOGO_BASIS_URL + s.replace(/^\/+/, '');
  try {
    const r = await fetch(url);
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  } catch (_) { return null; }
}

export async function ladeBranding({ partnerId = null } = {}) {
  const key = partnerId || '';
  if (_brandingCache.has(key)) return _brandingCache.get(key);
  const p = (async () => {
    const U = process.env.SUPABASE_URL;
    const K = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
    let row = null;
    if (U && K) {
      try {
        const filter = partnerId
          ? `&or=(partner_id.eq.${partnerId},partner_id.is.null)`
          : '&partner_id=is.null';
        const r = await fetch(`${U}/rest/v1/gs_branding?aktiv=is.true${filter}&select=*`,
          { headers: { apikey: K, Authorization: `Bearer ${K}` } });
        if (r.ok) {
          const rows = await r.json();
          const liste = Array.isArray(rows) ? rows : [];
          row = (partnerId && liste.find((x) => x.partner_id === partnerId)) || liste.find((x) => !x.partner_id) || null;
        }
      } catch (_) { /* Fallback greift */ }
    }
    const src = row || BRANDING_FALLBACK;
    return {
      firmenname: src.firmenname || BRANDING_FALLBACK.firmenname,
      akzentfarbe: src.akzentfarbe || BRANDING_FALLBACK.akzentfarbe,
      fusszeile: src.fusszeile || null,
      logo: await ladeLogoBytes(src.logo_url || BRANDING_FALLBACK.logo_url),
      logo_url: src.logo_url || BRANDING_FALLBACK.logo_url,
      aus_tabelle: !!row,
      partner_id: row ? row.partner_id : null,
    };
  })();
  _brandingCache.set(key, p);
  return p;
}

// Nur für Tests: erzwingt beim nächsten Aufruf ein frisches Lesen.
export function brandingCacheLeeren() { _brandingCache.clear(); }

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

export function buildPdf({ title, subtitle, blocks, logo, footer, branding, style, balance }) {
  // Satzspiegel und Farben hängen am Stil. Ohne `style` gelten exakt die alten
  // Werte — die fünf Bestandsdokumente rendern unverändert.
  const brief = style === 'brief';
  const LEFT = brief ? B_LEFT : L_LEFT;
  const RIGHT = brief ? B_RIGHT : L_RIGHT;
  const CONTENT_W = RIGHT - LEFT;
  const BOTTOM = brief ? B_BOTTOM : BOTTOM_ALT;
  const marke = branding || BRANDING_FALLBACK;
  const ACCENT = hexRgb(marke.akzentfarbe, GOLD);

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
  // `pages`, `ops`, `y` und `bottomEff` sind veränderlich, weil der Satz für den
  // Ausgleich (s. balance weiter unten) mehrfach durchlaufen wird. `images`
  // bleibt aussen: imgRef() dedupliziert über Buffer-Gleichheit, ein zweiter
  // Durchgang legt also nichts doppelt an.
  let pages = [];                          // [[op, …], …]
  let ops = null;
  let y = 0;
  let bottomEff = BOTTOM;                  // untere Grenze des laufenden Durchgangs

  // Text mit Sperrung (Tc). q/Q sichert Farbe UND Laufweite, weil Tc zum
  // Grafikzustand gehört und sonst in den nächsten Block durchschlagen würde.
  const putT = (txt, x, baseline, size, bold, tc, rgb) => {
    ops.push(`q ${rgb ? rgb + ' rg ' : ''}BT /${bold ? 'F1' : 'F2'} ${size} Tf`
      + `${tc ? ' ' + tc.toFixed(2) + ' Tc' : ''} ${x.toFixed(2)} ${baseline.toFixed(2)} Td (${esc(txt)}) Tj ET Q`);
  };
  // Breite inklusive Sperrung. Der letzte Zwischenraum zählt optisch nicht mit,
  // sonst steht rechtsbündig gesetzter Versaltext sichtbar zu weit links.
  const widthT = (s, size, bold, tc) =>
    textWidth(s, size, bold) + (tc ? tc * Math.max(0, [...String(s)].length - 1) : 0);

  // ── Kopfbalken im Stil 'brief' ───────────────────────────────────────────
  // Randabfallend über die volle Blattbreite, das einzige dunkle Element im
  // Dokument. Seite 1 trägt Logo und Berichtstyp, Folgeseiten einen schmalen
  // Balken mit kleinem Logo und der Berichtsnummer.
  //
  // Das Logo ist ein JPEG mit WEISSEM Grund (keine Freistellung, so beschlossen).
  // Auf Schwarz wird daraus zwangsläufig eine helle Fläche — also wird sie
  // bewusst gesetzt: eine weisse Plakette mit gleichmässigem Rand ringsum. So
  // liest sie sich als Gestaltung und nicht als Fehler.
  const drawHeadBrief = (ersteSeite) => {
    const barH = ersteSeite ? BAR1_H : BAR2_H;
    const barY = PAGE_H - barH;
    ops.push(`0.043 0.043 0.047 rg 0 ${barY.toFixed(2)} ${PAGE_W} ${barH.toFixed(2)} re f 0 0 0 rg`);
    ops.push(`${ACCENT} rg 0 ${(barY - 2.5).toFixed(2)} ${PAGE_W} 2.5 re f 0 0 0 rg`);

    if (logoImg) {
      const lh = ersteSeite ? 34 : 16;
      const lw = lh * (logoImg.info.width / logoImg.info.height);
      const pad = ersteSeite ? 9 : 5;
      const lx = LEFT, ly = barY + (barH - lh) / 2;
      ops.push(`1 1 1 rg ${(lx - pad).toFixed(2)} ${(ly - pad).toFixed(2)} ${(lw + 2 * pad).toFixed(2)} ${(lh + 2 * pad).toFixed(2)} re f 0 0 0 rg`);
      ops.push(`q ${lw.toFixed(2)} 0 0 ${lh.toFixed(2)} ${lx.toFixed(2)} ${ly.toFixed(2)} cm /${logoImg.name} Do Q`);
    }

    if (ersteSeite) {
      if (title) {
        // Berichtstyp in der Akzentfarbe — das einzige Gold auf dunklem Grund.
        // Nummer und KW darunter bleiben gedämpftes Weiss, damit die Hierarchie
        // im Balken eindeutig ist.
        const tw = widthT(title, 18, true, 0.8);
        putT(title, RIGHT - tw, barY + 58, 18, true, 0.8, ACCENT);
      }
      if (subtitle) {
        const sw = textWidth(subtitle, 8.5, false);
        putT(subtitle, RIGHT - sw, barY + 40, 8.5, false, 0, '0.72 0.72 0.72');
      }
      y = barY - 26;
    } else {
      const kennung = footer || title || '';
      if (kennung) {
        const kw = widthT(kennung, 8, false, 0.5);
        putT(kennung, RIGHT - kw, barY + 26, 8, false, 0.5, '0.78 0.78 0.78');
      }
      y = barY - 18;
    }
  };

  const drawHead = () => {
    if (brief) { drawHeadBrief(pages.length === 1); return; }
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
  // seitenEnde[i] = Höhe, auf der der Inhalt von Seite i aufhört. Nur für den
  // Seitenausgleich; an den gezeichneten Operatoren ändert das nichts.
  let seitenEnde = [];
  const newPage = () => { if (ops) seitenEnde.push(y); ops = []; pages.push(ops); drawHead(); };
  // Passt `h` noch auf die Seite? Sonst umbrechen.
  const need = (h) => { if (y - h < bottomEff) newPage(); };

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

  // Ein kompletter Satzdurchgang. `extra` hebt die Untergrenze an und schiebt
  // damit Inhalt von den vorderen Seiten nach hinten — das Werkzeug für den
  // Seitenausgleich weiter unten.
  const durchgang = (extra) => {
    bottomEff = BOTTOM + extra;
    pages = [];
    seitenEnde = [];
    ops = null;
    newPage();
    satz();
    seitenEnde.push(y);
    return pages;
  };

  // Füllgrad je Seite — IMMER gegen die natürliche Satzhöhe (BOTTOM ohne
  // Zuschlag) gemessen, nie gegen die künstlich angehobene. Sonst rechnet sich
  // der Ausgleich schön: mit grossem Zuschlag schrumpft der Nenner mit, und
  // zwei halbleere Seiten sähen "gleich voll" aus.
  const seitenTop = (i) => PAGE_H - (i === 0 ? BAR1_H + 26 : BAR2_H + 18);
  const fuellgrade = () => seitenEnde.map((ende, i) => (seitenTop(i) - ende) / (seitenTop(i) - BOTTOM));
  // Vordere Seiten müssen voll BLEIBEN. Eine letzte Seite, die früh aufhört,
  // liest sich als Dokumentende; eine MITTLERE Seite, die früh aufhört, liest
  // sich als Fehler. Deshalb nicht einfach die Spreizung minimieren (das käme
  // bei 0.66/0.72 heraus und liesse Seite 1 ein Drittel leer stehen), sondern:
  // die letzte Seite so voll wie möglich, solange keine vordere Seite unter
  // VOLL_GENUG fällt.
  const VOLL_GENUG = 0.75;
  const bewertung = () => {
    const f = fuellgrade();
    const vordere = f.slice(0, -1);
    if (vordere.some((x) => x < VOLL_GENUG)) return -1;   // untauglich
    return f[f.length - 1];
  };

  function satz() {
  for (const b of blocks || []) {
    if (!b) continue;

    if (b.t === 'sp') { y -= (b.size || 10); if (y < bottomEff) newPage(); continue; }

    if (b.t === 'pb') { newPage(); continue; }

    // Platzreservierung: bricht um, wenn der angeforderte Block nicht mehr
    // ganz auf die Seite passt. Damit bleibt ein Tagesblock zusammen.
    if (b.t === 'need') { need(b.h || 100); continue; }

    // Hierarchie über Grösse und Gewicht, nicht über Rahmen. h1 bekommt eine
    // Haarlinie in der Akzentfarbe, h2 gar nichts — der Weissraum trägt.
    if (b.t === 'h1') {
      if (brief) {
        need(46); y -= 30;
        put(b.text, LEFT, y, 13, true);
        y -= 7;
        ops.push(`${ACCENT} RG 0.9 w ${LEFT} ${y.toFixed(2)} m ${RIGHT} ${y.toFixed(2)} l S`);
        y -= 4;
        continue;
      }
      need(30); y -= 24; put(b.text, LEFT, y, 15, true); continue;
    }

    if (b.t === 'h2') {
      if (brief) { need(30); y -= 22; put(b.text, LEFT, y, 10.5, true); continue; }
      need(26); y -= 20; put(b.text, LEFT, y, 12, true); continue;
    }

    if (b.t === 'tiles') { drawTiles(b); continue; }

    if (b.t === 'rule') {
      need(12); y -= 8;
      const col = b.gold ? (brief ? ACCENT : GOLD) : (brief ? HAIR : GRID);
      ops.push(`${col} RG ${b.gold ? 1 : 0.5} w ${LEFT} ${y.toFixed(2)} m ${RIGHT} ${y.toFixed(2)} l S`);
      y -= 4;
      continue;
    }

    if (b.t === 'kv') {
      // Im Briefstil: Label als gesperrte Versalie in Grau, Wert in Schwarz —
      // gleiche Sprache wie die Tabellenköpfe, damit nichts zufällig aussieht.
      const vx = LEFT + (brief ? 132 : 150);
      const size = brief ? 9.5 : 10;
      const lead = brief ? 15 : 14;
      const lines = wrapText(b.value, RIGHT - vx, size, false);
      need((brief ? 17 : 16) + (lines.length - 1) * lead);
      y -= brief ? 17 : 16;
      if (brief) putT(String(b.label || '').toUpperCase(), LEFT, y, 7.5, true, 0.6, LABELCOL);
      else put(b.label, LEFT, y, 10, true);
      put(lines[0], vx, y, size, false);
      for (let i = 1; i < lines.length; i++) { need(lead); y -= lead; put(lines[i], vx, y, size, false); }
      continue;
    }

    if (b.t === 'table') { drawTable(b); continue; }

    if (b.t === 'img' || b.t === 'imgrow') { drawImages(b); continue; }

    // 'text' und alles Unbekannte: normaler Fliesstext mit Umbruch.
    paragraph(b.text, b.size || 10, !!b.bold, LEFT, CONTENT_W, b.lead || 15);
  }
  }

  // ── Info-Kacheln (Stil 'brief') ──────────────────────────────────────────
  // Sehr helles Grau als Füllung, dünner Rand in der Akzentfarbe. Gold bleibt
  // Linie und Rand, nie Fläche. Alle Kacheln einer Reihe sind gleich hoch.
  function drawTiles(b) {
    const items = (b.items || []).filter(Boolean).slice(0, 3);
    if (!items.length) return;
    const gap = 14;
    const w = (CONTENT_W - gap * (items.length - 1)) / items.length;
    const innen = w - 24;
    const zeilen = items.map((it) => wrapText(it.value || '—', innen, 9.5, false));
    const maxZ = Math.max(...zeilen.map((l) => l.length));
    const hBox = 42 + maxZ * 13;
    need(hBox + 20);
    y -= 12;
    const top = y;
    items.forEach((it, i) => {
      const x = LEFT + i * (w + gap);
      const bot = top - hBox;
      ops.push(`${TILEBG} rg ${x.toFixed(2)} ${bot.toFixed(2)} ${w.toFixed(2)} ${hBox.toFixed(2)} re f 0 0 0 rg`);
      ops.push(`${ACCENT} RG 0.7 w ${x.toFixed(2)} ${bot.toFixed(2)} ${w.toFixed(2)} ${hBox.toFixed(2)} re S`);
      putT(String(it.label || '').toUpperCase(), x + 12, top - 19, 7.5, true, 0.6, LABELCOL);
      zeilen[i].forEach((ln, k) => put(ln, x + 12, top - 36 - k * 13, 9.5, false));
    });
    y = top - hBox;
  }

  // ── Tabelle im Stil 'brief': keine Rahmen, keine Senkrechten ─────────────
  // Nur eine Akzentlinie unter dem Versal-Kopf und hellgraue Haarlinien unter
  // den Zeilen. Aussenkanten sitzen bündig auf dem Satzspiegel, damit die
  // Tabelle auf demselben Raster steht wie Überschrift und Fliesstext.
  function drawTableBrief(b) {
    const cols = (b.cols || []).map((c) => ({ w: Number(c.w) || 0, label: c.label || '', align: c.align || 'left' }));
    if (!cols.length) return;
    const total = cols.reduce((s, c) => s + c.w, 0) || 1;
    const scale = CONTENT_W / total;
    cols.forEach((c) => { c.w *= scale; });
    const size = b.size || 8.5;
    const padY = 6;
    const padL = (i) => (i === 0 ? 0 : 7);
    const padR = (i) => (i === cols.length - 1 ? 0 : 7);

    // Eine Zelle darf eine eigene Schriftgrösse tragen. Das ist der ganze Trick
    // hinter der herausgehobenen Wochensumme: nicht alles fett, sondern EINE
    // Zahl gross. Alle ersten Zeilen einer Reihe sitzen trotzdem auf derselben
    // Grundlinie, sonst tanzt die grosse Zahl neben den kleinen.
    const cellOf = (raw) => (raw && typeof raw === 'object' && !Array.isArray(raw))
      ? { text: raw.text == null ? '' : String(raw.text), bold: !!raw.bold, align: raw.align, size: Number(raw.size) || size }
      : { text: raw == null ? '' : String(raw), bold: false, align: undefined, size };

    const layout = (cells) => {
      const info = cells.map((c) => cellOf(c));
      const per = info.map((c, i) => wrapText(c.text, cols[i].w - padL(i) - padR(i), c.size, c.bold));
      const lhMax = Math.max(...info.map((c) => c.size * 1.5));
      const hoch = Math.max(...per.map((l, i) => (l.length - 1) * info[i].size * 1.5)) + lhMax;
      return { per, info, lhMax, hoch };
    };

    const kopf = () => {
      need(26);
      y -= 13;
      let x = LEFT;
      cols.forEach((c, i) => {
        const lbl = String(c.label || '').toUpperCase();
        if (lbl) {
          const tw = widthT(lbl, 7, true, 0.55);
          const tx = c.align === 'right' ? x + c.w - padR(i) - tw : x + padL(i);
          putT(lbl, tx, y, 7, true, 0.55, LABELCOL);
        }
        x += c.w;
      });
      y -= 7;
      ops.push(`${ACCENT} RG 0.9 w ${LEFT} ${y.toFixed(2)} m ${RIGHT} ${y.toFixed(2)} l S`);
    };

    y -= (b.gap == null ? 10 : b.gap);
    if (y < bottomEff) newPage();
    const hatKopf = cols.some((c) => c.label);
    if (hatKopf) kopf();

    for (const r of (b.rows || [])) {
      const cells = Array.isArray(r) ? r : [r];
      while (cells.length < cols.length) cells.push('');
      const L = layout(cells);
      const hoehe = L.hoch + 2 * padY;
      if (y - hoehe < bottomEff) { newPage(); if (hatKopf) kopf(); }
      const top = y;
      const grundlinie = top - padY - L.lhMax + L.lhMax * 0.3;   // gemeinsame erste Grundlinie
      let x = LEFT;
      cells.forEach((raw, i) => {
        const c = L.info[i];
        const align = c.align || cols[i].align;
        L.per[i].forEach((ln, k) => {
          if (!ln) return;
          const by = grundlinie - k * c.size * 1.5;
          const tw = textWidth(ln, c.size, c.bold);
          const tx = align === 'right' ? x + cols[i].w - padR(i) - tw
            : align === 'center' ? x + (cols[i].w - tw) / 2
              : x + padL(i);
          put(ln, tx, by, c.size, c.bold);
        });
        x += cols[i].w;
      });
      y = top - hoehe;
      ops.push(`${HAIR} RG 0.4 w ${LEFT} ${y.toFixed(2)} m ${RIGHT} ${y.toFixed(2)} l S`);
    }
  }

  // ── Tabelle mit Gitter; Kopfzeile wiederholt sich auf Folgeseiten ──────────
  function drawTable(b) {
    if (brief) return drawTableBrief(b);
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
    if (y < bottomEff) newPage();
    if (cols.some((c) => c.label)) head();

    for (const r of (b.rows || [])) {
      const cells = Array.isArray(r) ? r : [r];
      while (cells.length < cols.length) cells.push('');
      const L = layout(cells);
      if (y - L.h < bottomEff) { newPage(); if (cols.some((c) => c.label)) head(); }
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

  // ── Satz ausführen, bei Bedarf mit Seitenausgleich ───────────────────────
  // Eine letzte Seite, die nur zwei Tabellenzeilen und drei Zeilen Text trägt,
  // sieht aus wie ein Fehler. Statt den Umbruch von Hand zu setzen, wird die
  // Untergrenze schrittweise angehoben — dadurch rutscht Inhalt von vorne nach
  // hinten — und der Stand gewinnt, bei dem die letzte Seite am vollsten ist,
  // ohne dass eine vordere Seite dünn wird (s. bewertung()). Eine feste
  // Schwelle ("letzte Seite mindestens ein Drittel") war dafür zu grob: knapp
  // darüber blieb eine sichtbar halbleere Seite stehen.
  //
  // Abgebrochen wird, sobald ein Schritt eine ZUSÄTZLICHE Seite kosten würde —
  // lieber etwas Weissraum als eine Seite mehr. Der ganze Satz läuft dafür
  // mehrfach; das kostet nur Zeichenketten, keine Abhängigkeit und kein IO.
  durchgang(0);
  if (brief && balance && pages.length > 1) {
    const zielSeiten = pages.length;
    let besteExtra = 0, bester = bewertung();
    for (let extra = 10; extra <= 220; extra += 10) {
      durchgang(extra);
      if (pages.length !== zielSeiten) break;
      const s = bewertung();
      if (s > bester + 0.001) { bester = s; besteExtra = extra; }
    }
    durchgang(besteExtra);
  }

  // ── Fusszeile im Stil 'brief': Firmenzeile aus gs_branding und
  //    Seitenzählung, auf JEDER Seite. ──
  if (brief) {
    pages.forEach((pg, i) => {
      // KEIN Logo im Fuss. Bei lesbarer Grösse wäre es das zweite grosse
      // Farbelement der Seite und stünde gegen die Regel, dass die Logofarben
      // nicht ins Layout wandern; klein gesetzt war es nur ein unscharfer Fleck.
      // Die Marke steht im Kopfbalken — unten genügt die Textzeile.
      pg.push(`${HAIR} RG 0.5 w ${LEFT} 74 m ${RIGHT} 74 l S`);
      const mitte = (txt, size, baseline, rgb) => {
        const w = textWidth(txt, size, false);
        pg.push(`q ${rgb || LABELCOL} rg BT /F2 ${size} Tf ${((PAGE_W - w) / 2).toFixed(2)} ${baseline} Td (${esc(txt)}) Tj ET Q`);
      };
      if (marke.fusszeile) mitte(marke.fusszeile, 7.5, 56);
      // Berichtsnummer neben die Seitenzahl: eine einzeln ausgedruckte Seite
      // bleibt sonst nicht zuordenbar. Kleiner und heller als die Firmenzeile,
      // damit sie die Zeile darüber nicht bedrängt.
      const kennung = `${footer ? footer + ' · ' : ''}Seite ${i + 1} von ${pages.length}`;
      mitte(kennung, 6.8, 42, '0.55 0.55 0.55');
    });
  }

  // ── Fusszeile (Altstil): nur bei mehreren Seiten oder auf Wunsch ──────────
  const wantFooter = !brief && (!!footer || pages.length > 1);
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
