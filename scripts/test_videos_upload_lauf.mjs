// scripts/test_videos_upload_lauf.mjs — der Upload-Weg der Videos-Kachel,
// einmal komplett durchgespielt.
//
//   node scripts/test_videos_upload_lauf.mjs
//
// Die echten Funktionen aus gs-intern.html werden herausgeschnitten und gegen
// eine Attrappe von document/fetch/api ausgeführt. Geprüft wird, was am Ende
// wirklich rausgeht: welche Action mit welchen Feldern, ob die Datei per PUT
// an die signierte Adresse geht, und ob eine Ablehnung VOR dem Übertragen
// passiert — ein 300-MB-Clip darf das Handy gar nicht erst verlassen.
//
// Kein Netz, keine Zugangsdaten: der Server ist in dieser Runde unverändert,
// geprüft wird die Oberfläche.

import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../gs-intern.html', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

function funktion(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Funktion ${name} nicht gefunden`);
  let tiefe = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') tiefe++;
    else if (src[j] === '}') { tiefe--; if (tiefe === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`Funktion ${name} nicht geschlossen`);
}

// ── Attrappen ───────────────────────────────────────────────────────────────
// Ein <video>, das sich wie eines auf einem Gerät verhält: Metadaten kommen
// asynchron, danach lässt sich ein Frame greifen.
function machDom(dauer, breite = 1920, hoehe = 1080, kaputt = false) {
  return {
    createElement(tag) {
      if (tag === 'video') {
        const v = { preload: '', muted: false, playsInline: false, videoWidth: breite, videoHeight: hoehe };
        Object.defineProperty(v, 'src', {
          set() {
            setTimeout(() => {
              if (kaputt) { v.onerror && v.onerror(); return; }
              v.duration = dauer;
              v.onloadedmetadata && v.onloadedmetadata();
            }, 0);
          },
        });
        Object.defineProperty(v, 'currentTime', { set() { setTimeout(() => v.onseeked && v.onseeked(), 0); } });
        return v;
      }
      if (tag === 'canvas') {
        return { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,STANDBILD' };
      }
      if (tag === 'input') return { click() {} };
      throw new Error('unerwartetes Element ' + tag);
    },
  };
}

function lauf({ file, dauer = 30, kaputtesVideo = false, signAntwort, registerAntwort, putOk = true }) {
  const geschickt = [];
  const fetches = [];
  const api = (action, params) => { geschickt.push({ action, params }); 
    if (action === 'medien_sign_upload') return Promise.resolve(signAntwort ?? { ok: true, path: 'P1/medien/1-clip.mov', uploadUrl: 'https://sb/storage/v1/upload/sign/x' });
    if (action === 'medien_register') return Promise.resolve(registerAntwort ?? { ok: true, medien: { id: 'm1' }, standbild: true, hinweis: null });
    return Promise.resolve({});
  };
  const fetchStub = (u, o) => { fetches.push({ u, o }); return Promise.resolve({ ok: putOk }); };
  const bau = new Function('document', 'URL', 'fetch', 'api', 'setTimeout', `
    var PM_VIDEO_MAX_BYTES=${(src.match(/var PM_VIDEO_MAX_BYTES=([^;]+);/) || [])[1]};
    var PM_VIDEO_MAX_SEK=${(src.match(/var PM_VIDEO_MAX_SEK=(\d+);/) || [])[1]};
    ${funktion('pmVideoDauer')}
    ${funktion('pmVideoPruefen')}
    ${funktion('pmVideoStandbild')}
    ${funktion('pmVideoHochladen')}
    return pmVideoHochladen;
  `)(machDom(dauer, 1920, 1080, kaputtesVideo), { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, fetchStub, api, setTimeout);
  return new Promise((res) => {
    bau(file, { projekt_id: 'P1', stockwerk: '1.OG' }, (text, erfolg) => res({ text, erfolg, geschickt, fetches }));
  });
}

const datei = (name, type, size) => ({ name, type, size });

console.log('\n══ VIDEO-UPLOAD, KOMPLETT DURCHGESPIELT ══\n');

console.log('Guter Fall — mov vom iPhone, 45 s, 40 MB:');
{
  const r = await lauf({ file: datei('IMG_0042.mov', 'video/quicktime', 40 * 1024 * 1024), dauer: 45 });
  ok(r.erfolg === true, 'meldet Erfolg');
  ok(r.text === 'Video gespeichert', `Meldung im Klartext („${r.text}")`);
  const sign = r.geschickt.find((g) => g.action === 'medien_sign_upload');
  const reg = r.geschickt.find((g) => g.action === 'medien_register');
  ok(!!sign && !!reg, 'genau der bestehende Weg: medien_sign_upload → medien_register');
  ok(sign.params.projekt_id === 'P1' && sign.params.stockwerk === '1.OG', 'Projekt und Stockwerk fahren mit');
  ok(sign.params.medientyp === 'video' && sign.params.contentType === 'video/quicktime', 'als Video und mit dem echten Typ angemeldet');
  ok(sign.params.dauer_sekunden === 45 && sign.params.groesse === 40 * 1024 * 1024, 'Dauer und Grösse werden vorab gemeldet');
  ok(r.fetches.length === 1 && r.fetches[0].o.method === 'PUT', 'die Datei geht per PUT direkt in den Bucket');
  ok(r.fetches[0].u === 'https://sb/storage/v1/upload/sign/x', 'an die signierte Adresse, nicht an /api');
  ok(r.fetches[0].o.body && r.fetches[0].o.body.name === 'IMG_0042.mov', 'die Datei selbst ist der Body (kein base64)');
  ok(r.fetches[0].o.headers['Content-Type'] === 'video/quicktime', 'der Content-Type am PUT ist der des Videos');
  ok(reg.params.path === 'P1/medien/1-clip.mov', 'registriert wird der vom Server vergebene Pfad');
  ok(String(reg.params.thumbnail || '').startsWith('data:image/jpeg'), 'das Standbild fährt mit');
  ok(reg.params.dauer_sekunden === 45, 'die Dauer steht auf der Zeile');
}

console.log('\nAbgelehnt VOR dem Übertragen:');
{
  const r = await lauf({ file: datei('clip.avi', 'video/x-msvideo', 1024), dauer: 10 });
  ok(r.erfolg === false && /Erlaubt sind mp4 und mov/.test(r.text), `falsches Format: „${r.text}"`);
  ok(r.geschickt.length === 0 && r.fetches.length === 0, 'nichts wurde geschickt, nichts übertragen');
}
{
  const r = await lauf({ file: datei('gross.mp4', 'video/mp4', 300 * 1024 * 1024), dauer: 30 });
  ok(r.erfolg === false && /300\.0 MB gross/.test(r.text) && /höchstens 100 MB/.test(r.text), `zu gross: „${r.text}"`);
  ok(r.fetches.length === 0, 'der 300-MB-Clip verlässt das Handy nicht');
}
{
  const r = await lauf({ file: datei('lang.mp4', 'video/mp4', 5 * 1024 * 1024), dauer: 185 });
  ok(r.erfolg === false && /185 Sekunden/.test(r.text) && /2 Minuten/.test(r.text), `zu lang: „${r.text}"`);
  ok(r.fetches.length === 0, 'nichts übertragen');
}
{
  const r = await lauf({ file: datei('grenzfall.mp4', 'video/mp4', 100 * 1024 * 1024), dauer: 120 });
  ok(r.erfolg === true, 'genau 100 MB und genau 120 s sind erlaubt (Grenze inklusiv, wie im Server)');
}
{
  // Manche Geräte liefern für .mov einen leeren type — dann zählt die Endung.
  const r = await lauf({ file: datei('IMG_1.MOV', '', 3 * 1024 * 1024), dauer: 12 });
  ok(r.erfolg === true, 'leerer MIME-Typ, aber Endung .MOV → wird angenommen');
}

console.log('\nWenn etwas schiefgeht, wird es benannt statt verschluckt:');
{
  const r = await lauf({ file: datei('a.mp4', 'video/mp4', 1024), dauer: 5, signAntwort: { error: 'Keine Berechtigung' } });
  ok(r.erfolg === false && r.text === 'Keine Berechtigung', 'der Servertext wird durchgereicht');
  ok(r.fetches.length === 0, 'ohne Upload-Adresse wird nichts übertragen');
}
{
  const r = await lauf({ file: datei('a.mp4', 'video/mp4', 1024), dauer: 5, putOk: false });
  ok(r.erfolg === false && /nicht übertragen werden/.test(r.text), `PUT scheitert: „${r.text}"`);
  ok(!r.geschickt.find((g) => g.action === 'medien_register'), 'ohne Datei keine Zeile');
}
{
  const r = await lauf({ file: datei('a.mp4', 'video/mp4', 1024), dauer: 5, registerAntwort: { error: 'Stockwerk ist bei Projekt-Medien erforderlich' } });
  ok(r.erfolg === false && /Stockwerk/.test(r.text), 'Registrierfehler im Klartext');
}
{
  const r = await lauf({
    file: datei('a.mp4', 'video/mp4', 1024), dauer: 5,
    registerAntwort: { ok: true, standbild: false, hinweis: 'Das Video ist gespeichert, ein Standbild konnte nicht erzeugt werden. In der Galerie fehlt die Vorschau.' },
  });
  ok(r.erfolg === true && /Standbild konnte nicht erzeugt werden/.test(r.text),
    'fehlendes Standbild wird gesagt — das Video gilt trotzdem als gespeichert');
}
{
  // Video, dessen Metadaten das Gerät nicht liefert: Dauer unbekannt, kein
  // Standbild — der Upload läuft trotzdem, der Server prüft die Dauer nach.
  const r = await lauf({ file: datei('a.mp4', 'video/mp4', 1024), kaputtesVideo: true });
  ok(r.erfolg === true, 'ohne lesbare Metadaten wird trotzdem hochgeladen');
  const sign = r.geschickt.find((g) => g.action === 'medien_sign_upload');
  ok(sign.params.dauer_sekunden === null, 'die Dauer wird als unbekannt gemeldet, nicht geraten');
  ok(!r.geschickt.find((g) => g.action === 'medien_register').params.thumbnail, 'kein erfundenes Standbild');
}

console.log(`\n── ${pass} bestanden, ${fail} fehlgeschlagen ──\n`);
process.exit(fail ? 1 : 0);
