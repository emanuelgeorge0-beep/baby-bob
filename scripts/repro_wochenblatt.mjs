// ═══════════════════════════════════════════════════════════════════════════
// WOCHENBLATT — Regressionstest im echten Browser
// ═══════════════════════════════════════════════════════════════════════════
// Baut aus app.html eine eigenständige Seite (echtes CSS, echtes JS, gestubbte
// API) und fährt sie in Chrome headless. Prüft die Regression, wegen der die
// Tageskarten leer wirkten, UND dass das Wochen-Rad weiterhin funktioniert.
//
// Szenario A — der gemeldete Fehler:
//   Projekt in einer leeren Tageskarte wählen, danach über dem Rad-Bereich
//   wischen. Vorher fing das offene Rad die Geste ab, wechselte die Woche und
//   lud neu — die noch nicht gespeicherte Zeile war weg und die Karte wirkte
//   leer. Jetzt muss die Auswahl stehenbleiben.
//
// Szenario B — das Rad tut noch, was es soll:
//   Rad öffnen, eine andere KW antippen, prüfen dass genau diese geladen wird.
//
// Lauf:  node scripts/repro_wochenblatt.mjs
// Braucht Google Chrome (macOS-Standardpfad) und sonst nichts.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const src = readFileSync('app.html', 'utf8');
const style = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const script = [...src.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1]).find((s) => s.includes('function tcRenderWoche'));
if (!script) { console.log('✗ tcRenderWoche nicht in app.html gefunden'); process.exit(1); }

// Sieben Tageszeilen der Zielwoche, Form wie tech_wochen_rapport sie liefert.
const MONTAG = '2026-08-10';                       // KW33/2026
const tage = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 7, 10 + i));
  return d.toISOString().slice(0, 10);
});
const zeilen = tage.slice(0, 5).map((datum, i) => ({
  id: 'Z' + i, datum, projekt_id: 'P1', taetigkeit: 'Sanitär',
  start_zeit: '07:00:00', end_zeit: '16:15:00', pause_minuten: 75,
  gesamtstunden: 8, spesen: 30, arbeiten: [], taetigkeiten: [], medien_anzahl: 0,
  ueberzeit_25: 0, ueberzeit_50: 0, ueberzeit_100: 0, status: 'entwurf',
}));

function seite(szenario) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style></head>
<body><div id="tech-cockpit" class="tech-screen" style="display:block">
<div id="tc-content"></div><div class="tc-nav" id="tc-nav"></div></div>
<pre id="ergebnis"></pre>
<script>
var FEHLER=[];
window.onerror=function(m,u,l,c){ FEHLER.push('JS-Fehler: '+m+' @'+l+':'+c); };
window.addEventListener('unhandledrejection',function(e){ FEHLER.push('Rejection: '+(e.reason&&e.reason.message||e.reason)); });
var ZEILEN=${JSON.stringify(zeilen)};
var GELADEN=[], authTechName='Testtechniker';
function toast(){} function showScreen(){} function gsAuthApi(){ return Promise.resolve({}); }
function stubApi(a,b){
  if(a==='tech_wochen_rapport'){
    GELADEN.push(b.jahr+'/'+b.woche);
    var eigene=(b.jahr===2026&&b.woche===33)?ZEILEN:[];
    return Promise.resolve({kopf:{jahr:b.jahr,woche:b.woche,status:'entwurf'},zeilen:eigene,
      total_stunden:0,total_uz25:0,total_uz50:0,total_uz100:0,total_spesen:0});
  }
  if(a==='tech_projekte') return Promise.resolve({projekte:[{id:'P1',name:'Langstrasse 149',projektnummer:'25-001',standort:'Zürich',kunde_name:'Muster AG'}]});
  if(a==='svc_liste') return Promise.resolve({auftraege:[]});
  if(a==='tech_taetigkeitenkatalog') return Promise.resolve({items:[]});
  if(a==='tech_tag_save') return Promise.resolve({ok:true,row:{id:'NEU',datum:b.datum,projekt_id:b.projekt_id}});
  return Promise.resolve({});
}
</script>
<script>${script}</script>
<script>
techApi=stubApi;
var AUS=[];
function sag(s){ AUS.push(s); document.getElementById('ergebnis').textContent=AUS.join('\\n'); }
function pruef(bed,text){ sag((bed?'✓':'✗ ')+'  '+text); if(!bed) FEHLER.push('FEHLGESCHLAGEN: '+text); }
function leereZeile(){
  // Samstag/Sonntag haben keine gespeicherte Zeile → dort steht eine leere.
  var alle=document.querySelectorAll('.tc-row');
  for(var i=0;i<alle.length;i++){ if(!alle[i].getAttribute('data-id')) return alle[i]; }
  return null;
}
function felderSichtbar(r){
  var b=r&&r.querySelector('.rc-body');
  return !!(b&&getComputedStyle(b).display!=='none'
    &&r.querySelectorAll('.rc-gewerk-chips .tc-chip').length===5
    &&r.querySelector('.f-start')&&r.querySelector('.f-ende')&&r.querySelector('.f-pause')
    &&r.querySelector('.f-std')&&r.querySelectorAll('.rc-spesen-chips .tc-chip').length===4);
}
function ende(){ sag(FEHLER.length?('\\n✗ '+FEHLER.length+' Fehler:\\n   '+FEHLER.join('\\n   ')):'\\n✓ Szenario bestanden'); sag('FERTIG'); }

tcLoadWoche(2026,33,function(){ setTimeout(los,250); });

function los(){
  ${szenario}
}
</script></body></html>`;
}

const SZENARIO_A = `
  sag('SZENARIO A — Auswahl übersteht das Wischen über dem Rad');
  var r=leereZeile();
  pruef(!!r,'leere Tageskarte vorhanden');
  if(!r) return ende();
  var sel=r.querySelector('.rc-ziel');
  sel.value='p:P1'; tcRowZielChange(sel);
  pruef(felderSichtbar(r),'nach Projektauswahl sind alle Felder da (Gewerk, Start/Ende, Pause, Std, Spesen)');
  // Genau die Geste, die vorher alles verschluckt hat.
  var trig=document.getElementById('tc-wheel-trigger');
  pruef(!!trig,'Rad ist zugeklappt (kein offener Scroll-Container im Seitenfluss)');
  pruef(!document.getElementById('tc-wheel'),'kein Rad im Lesefluss, das eine Wischgeste abfangen kann');
  window.scrollTo(0,300);
  setTimeout(function(){
    pruef(felderSichtbar(r),'nach dem Wischen sind die Felder IMMER NOCH da');
    pruef(tcWocheState.woche===33,'Kalenderwoche unverändert (33), kein ungewollter Wechsel');
    pruef(GELADEN.length===1,'genau ein Ladevorgang — kein Neuladen im Rücken des Nutzers  ['+GELADEN.join(', ')+']');
    ende();
  },600);
`;

const SZENARIO_B = `
  sag('SZENARIO B — das Rad wählt weiterhin Wochen aus');
  tcWheelOeffnen();
  var rad=document.getElementById('tc-wheel');
  pruef(!!rad,'Rad öffnet sich als Overlay');
  var spalten=document.querySelectorAll('.tc-wheel-col');
  pruef(spalten.length===2,'zwei Spalten (Jahr, Kalenderwoche)');
  var opts=document.querySelectorAll('#tc-wheel-woche .tc-wheel-opt');
  pruef(opts.length===53,'2026 bietet 53 Kalenderwochen an, nicht 52  (bekommen: '+opts.length+')');
  var beschriftet=opts.length&&/\\d{2}\\.\\d{2}\\.–\\d{2}\\.\\d{2}\\./.test(opts[32].textContent);
  pruef(beschriftet,'KW-Zeilen tragen die Datumsspanne  ("'+(opts[32]?opts[32].textContent:'')+'")');
  var sel=document.querySelector('#tc-wheel-woche .tc-wheel-opt.sel');
  pruef(sel&&sel.getAttribute('data-v')==='33','aktuelle Woche 33 ist vorausgewählt und hervorgehoben');
  // Echte Berührung + Tap auf KW35.
  rad.dispatchEvent(new Event('pointerdown'));
  tcWheelTap(opts[34]);
  setTimeout(function(){
    pruef(tcWocheState.woche===35,'Antippen von KW35 lädt genau diese Woche (bekommen: '+tcWocheState.woche+')');
    pruef(!document.getElementById('tc-wheel'),'Rad schliesst sich nach der Wahl');
    pruef(GELADEN.length===2,'genau zwei Ladevorgänge  ['+GELADEN.join(', ')+']');
    ende();
  },700);
`;

// Szenario C — die übrigen Ziele der Runde überleben den Fix.
const SZENARIO_C = `
  sag('SZENARIO C — Ziele der Runde weiterhin wirksam');
  // ZIEL 5 — Unterschriftfeld doppelt so hoch, CSS und Canvas gleich.
  var pad=document.getElementById('tc-sign-technik');
  pruef(!!pad&&pad.height===240,'ZIEL 5: Unterschrift-Canvas ist 240 px hoch (bekommen: '+(pad?pad.height:'-')+')');
  pruef(!!pad&&Math.round(pad.getBoundingClientRect().height)===240,'ZIEL 5: CSS-Höhe stimmt mit dem Canvas überein');
  // ZIEL 5 — Wochentag ausgeschrieben.
  var wd=document.querySelector('.tc-day-wd');
  pruef(!!wd&&wd.textContent==='Montag','ZIEL 5: Wochentag ausgeschrieben ("'+(wd?wd.textContent:'')+'")');
  pruef(!!wd&&parseFloat(getComputedStyle(wd).fontSize)>=18,'ZIEL 5: Wochentag deutlich grösser (>=18px)');
  // ZIEL 1 — jeder Eintrag hat ein eigenes Löschen, auch der ungespeicherte.
  var leer=leereZeile();
  pruef(!!leer&&!!leer.querySelector('.rc-del'),'ZIEL 1: auch die ungespeicherte Zeile hat einen Löschknopf');
  // ZIEL 1 — "+ weiterer Eintrag" zeigt die Rückgängig-Pille, Tap nimmt zurück.
  var tag=leer.getAttribute('data-date');
  var vorher=document.querySelectorAll('.tc-row[data-date="'+tag+'"]').length;
  tcAddRow(tag);
  var nachher=document.querySelectorAll('.tc-row[data-date="'+tag+'"]').length;
  pruef(nachher===vorher+1,'ZIEL 1: Eintrag hinzugefügt');
  var pille=document.getElementById('tc-undo');
  pruef(!!pille&&pille.classList.contains('show'),'ZIEL 1: Rückgängig-Pille erscheint');
  pruef(!!pille&&parseInt(getComputedStyle(pille).bottom,10)>=60,'ZIEL 1: Pille sitzt über der Bottom-Navigation');
  tcUndoRun();
  setTimeout(function(){
    var jetzt=document.querySelectorAll('.tc-row[data-date="'+tag+'"]').length;
    pruef(jetzt===vorher,'ZIEL 1: Rückgängig entfernt den Eintrag wieder (bekommen: '+jetzt+')');
    pruef(!document.getElementById('tc-undo').classList.contains('show'),'ZIEL 1: Pille schliesst nach dem Tap');
    // ZIEL 4 — ISO-Rechnung: 2026 hat 53 Wochen, KW33 beginnt am 10.08.
    pruef(tcISOWeeksInYear(2026)===53,'ZIEL 4: 2026 hat 53 Kalenderwochen');
    pruef(tcWeekDates(2026,33)[0]==='2026-08-10','ZIEL 4: KW33/2026 beginnt am 10.08.');
    pruef(tcWeekDates(2027,1)[0]==='2027-01-04','ZIEL 4: KW1/2027 beginnt am 04.01. (alter Fehler behoben)');
    ende();
  },250);
`;

const dir = mkdtempSync(join(tmpdir(), 'wochenblatt-'));
let fehler = 0;
for (const [name, sz] of [['A', SZENARIO_A], ['B', SZENARIO_B], ['C', SZENARIO_C]]) {
  const datei = join(dir, `szenario_${name}.html`);
  writeFileSync(datei, seite(sz));
  const dom = execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox',
    '--window-size=390,844', '--virtual-time-budget=8000', '--dump-dom', `file://${datei}`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  const m = dom.match(/<pre id="ergebnis">([\s\S]*?)<\/pre>/);
  const text = m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') : '(keine Ausgabe)';
  console.log(text.trim().replace(/\nFERTIG$/, ''));
  console.log('');
  if (/✗/.test(text)) fehler++;
}
console.log('─'.repeat(60));
console.log(fehler ? `✗ ${fehler} von 3 Szenarien fehlgeschlagen` : "✓ alle 3 Szenarien bestanden");
process.exit(fehler ? 1 : 0);
