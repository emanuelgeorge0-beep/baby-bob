// scripts/test_videos_kachel.mjs — die Videos-Kachel im Master-Cockpit.
//
//   node scripts/test_videos_kachel.mjs
//
// Geprüft wird die Oberfläche, nicht der Server: die vierte Kachel steht neben
// Bilder/Pläne/Dateien, sie liest aus gs_projekt_medien (medien_list) statt aus
// der Storage-Auflistung, sie zeigt das Standbild als Vorschau — und der
// Dateidialog trägt einen accept-Wert, mit dem iOS Mediathek UND Kamera
// anbietet, also Video-Typen und KEIN capture.
//
// Der accept-Wert ist der eigentliche Befund dieser Runde: die drei bestehenden
// Kacheln tragen nur image/* bzw. */*, deshalb bot iOS nie ein Video an.

import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../gs-intern.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

// Die Kachel-Funktionen aus der Seite herausschneiden und in einer kleinen
// Attrappe ausführen. So wird die echte Zeichenlogik getestet, nicht eine Kopie.
function funktion(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return null;
  let i = src.indexOf('{', start), tiefe = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') tiefe++;
    else if (src[j] === '}') { tiefe--; if (tiefe === 0) return src.slice(start, j + 1); }
  }
  return null;
}

console.log('\n══ VIDEOS-KACHEL ══\n');

console.log('Die Kachel steht im Projekt-Detail:');
ok(/id="pm-video-box"/.test(src), 'eigener Kasten #pm-video-box im Projekt-Detail');
ok(src.indexOf('id="pm-datei-box"') < src.indexOf('id="pm-video-box"'),
  'sie steht NACH den drei bestehenden Kacheln (danebengestellt, nicht dazwischen)');
ok(/pmVideosReload\(\);/.test(src), 'sie wird beim Öffnen des Projekts geladen');
// Die bestehenden drei sind unverändert: derselbe eine Aufruf, dieselben Labels.
ok(/katBlock\('bilder','Bilder','🖼️'\)\+katBlock\('plaene','Pläne','📐'\)\+katBlock\('dateien','Dateien','📄'\)/.test(src),
  'die drei bestehenden Kacheln sind unverändert');

console.log('\nQuelle ist gs_projekt_medien, nicht die Storage-Auflistung:');
const reload = funktion('pmVideosReload');
ok(!!reload, 'pmVideosReload existiert');
ok(/api\('medien_list'/.test(reload || ''), 'liest über medien_list (bestehender Endpunkt)');
ok(/medientyp==='video'/.test(reload || ''), 'filtert auf medientyp === video');
ok(!/pm_datei_list/.test(reload || ''), 'nutzt NICHT pm_datei_list (dort steht kein Video)');
ok(/api\('stockwerk_list'/.test(reload || ''), 'holt die Stockwerke über den bestehenden Katalog');
ok(/_pmVidSwProj!==pid/.test(reload || ''), 'beim Projektwechsel wird die Stockwerkliste verworfen (sonst fremde Stockwerke)');

console.log('\nDie Zelle zeigt das Standbild und öffnet das Video:');
const zelle = funktion('pmVideoCellHtml');
const dauerFn = funktion('pmVidDauer');
const innerFn = funktion('pmVideoInnerHtml');
ok(!!zelle && !!dauerFn && !!innerFn, 'pmVideoCellHtml / pmVidDauer / pmVideoInnerHtml existieren');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sandbox = new Function('esc', '_pmVidSwListe', '_pmVidSw', 'migRow',
  `${dauerFn}\n${zelle}\n${innerFn}\nreturn {pmVideoCellHtml,pmVideoInnerHtml,pmVidDauer};`);
const F = sandbox(esc, [], '', () => '');

const mitStandbild = F.pmVideoCellHtml({
  id: 'v1', url: 'https://x/video.mp4', thumbnail_url: 'https://x/thumb.jpg',
  dateiname: 'clip.mov', dauer_sekunden: 95, stockwerk: '1.OG', raum: 'Bad',
});
ok(/<img src="https:\/\/x\/thumb\.jpg"/.test(mitStandbild), 'Standbild ist die Vorschau (img, nicht das Video)');
ok(/data-vurl="https:\/\/x\/video\.mp4"/.test(mitStandbild), 'die Videoadresse hängt an der Zelle (Antippen öffnet sie)');
ok(/class="vplay"/.test(mitStandbild), 'Abspielzeichen liegt über der Vorschau');
ok(/1:35/.test(mitStandbild), 'Dauer wird als 1:35 gezeigt, nicht als 95');
ok(/1\.OG · Bad/.test(mitStandbild), 'Stockwerk und Raum stehen an der Zelle');
ok(/data-delvid="v1"/.test(mitStandbild), 'Löschen ist möglich (medien_del)');

const ohneStandbild = F.pmVideoCellHtml({ id: 'v2', url: 'https://x/a.mp4', dateiname: 'a.mp4' });
ok(/ohne Standbild/.test(ohneStandbild), 'fehlendes Standbild wird gesagt statt leer gelassen');
ok(/data-vurl="https:\/\/x\/a\.mp4"/.test(ohneStandbild), 'das Video ist trotzdem abspielbar');

ok(F.pmVidDauer(0) === '' && F.pmVidDauer(null) === '', 'ohne Dauer keine Dauerangabe');
ok(F.pmVidDauer(7) === '0:07' && F.pmVidDauer(120) === '2:00', 'Dauer 7s → 0:07, 120s → 2:00');

const leer = F.pmVideoInnerHtml([]);
ok(/Noch kein Video/.test(leer) && /100 MB und 2 Minuten/.test(leer),
  'leere Kachel nennt die Grenzen im Klartext');
ok(/🎬 Videos \(0\)/.test(leer), 'Zähler in der Kopfzeile');
ok(/🎬 Videos \(2\)/.test(F.pmVideoInnerHtml([{ id: 'a' }, { id: 'b' }])), 'Zähler zählt mit');

console.log('\nAbspielen im iOS-Player-freien Weg:');
const play = funktion('pmVideoPlay');
ok(/playsinline/.test(play || ''), 'playsinline gesetzt (sonst reisst iOS den Clip ins Vollbild)');
ok(/controls/.test(play || '') && /autoplay/.test(play || ''), 'controls + autoplay beim Antippen');

// ── Ab hier: Upload aus der Kachel (Teilaufgabe 3) ──────────────────────────
const upload = funktion('openVideoUpload');
if (!upload) {
  console.log('\n(Upload aus der Kachel noch nicht gebaut — übersprungen)');
} else {
  console.log('\nUpload aus der Kachel — der accept-Wert ist der Befund dieser Runde:');
  const accept = (upload.match(/inp\.accept\s*=\s*'([^']*)'/) || [])[1] || '';
  ok(/video\/mp4/.test(accept), `accept nennt video/mp4 (${accept})`);
  ok(/video\/quicktime/.test(accept), 'accept nennt video/quicktime (mov)');
  ok(/\.mov/.test(accept) && /\.mp4/.test(accept), 'accept nennt zusätzlich die Endungen .mp4/.mov');
  ok(!/capture/.test(upload), 'KEIN capture — sonst springt iOS direkt in die Kamera und die Mediathek fehlt');
  ok(!/image\//.test(accept), 'keine Bildtypen in der Videokachel');
  ok(!/multiple/.test(upload), 'ein Video pro Vorgang (100 MB je Datei)');

  console.log('\nGrenzen werden VOR dem Upload geprüft und im Klartext gemeldet:');
  const pruef = funktion('pmVideoPruefen');
  const gr = src.match(/var PM_VIDEO_MAX_BYTES=([^;]+);/);
  const sek = src.match(/var PM_VIDEO_MAX_SEK=(\d+);/);
  ok(!!gr && /100\s*\*\s*1024\s*\*\s*1024/.test(gr[1]), '100 MB als Grenze (wie im Server)');
  ok(!!sek && sek[1] === '120', '120 Sekunden als Grenze (wie im Server)');
  ok(!!pruef, 'pmVideoPruefen existiert');
  ok(/Erlaubt sind mp4 und mov/.test(pruef || ''), 'Formatfehler im Klartext');
  ok(/Erlaubt sind höchstens 100 MB/.test(pruef || ''), 'Grössenfehler im Klartext');
  ok(/höchstens 2 Minuten/.test(pruef || ''), 'Dauerfehler im Klartext');
  ok(!/\b(error|Error|4\d\d|5\d\d)\b/.test((pruef || '').replace(/\/\*[\s\S]*?\*\//g, '')),
    'keine Fehlercodes in den Meldungen');

  console.log('\nDer bestehende Weg wird genutzt, kein neuer:');
  const hoch = funktion('pmVideoHochladen');
  ok(/medien_sign_upload/.test(hoch || ''), 'signierte Upload-URL über medien_sign_upload');
  ok(/medien_register/.test(hoch || ''), 'Zeile über medien_register');
  ok(/thumbnail:/.test(hoch || ''), 'Standbild fährt beim Registrieren mit');
  ok(/method:'PUT'/.test(hoch || ''), 'die Datei geht direkt in den Bucket (am Body-Limit vorbei)');
  const stand = funktion('pmVideoStandbild');
  ok(/toDataURL\('image\/jpeg'/.test(stand || ''), 'Standbild wird im Browser aus einem Frame erzeugt');
  ok(/Stockwerk/.test(upload), 'ohne Stockwerk kein Upload (der Server verlangt es)');
}

// Am Server darf diese Runde nichts geändert haben.
console.log('\nServerseitiger Upload-Weg unverändert:');
const cockpit = readFileSync(new URL('../api/cockpit.js', import.meta.url), 'utf8');
ok(/const VIDEO_MAX_BYTES = 100 \* 1024 \* 1024;/.test(cockpit), 'VIDEO_MAX_BYTES steht unverändert');
ok(/const VIDEO_MAX_SEKUNDEN = 120;/.test(cockpit), 'VIDEO_MAX_SEKUNDEN steht unverändert');
ok(/'medien_sign_upload', 'medien_register'/.test(cockpit), 'die Actions sind unverändert freigeschaltet');

console.log(`\n── ${pass} bestanden, ${fail} fehlgeschlagen ──\n`);
process.exit(fail ? 1 : 0);
