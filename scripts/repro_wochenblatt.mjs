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

function seite(szenario, szenario2) {
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
var GELADEN=[], AUFRUFE=[], NETZ=[], authTechName='Testtechniker';
function toast(){} function showScreen(){} function gsAuthApi(){ return Promise.resolve({}); }
// Jede echte Netzwerkanfrage waere in diesem Aufbau ein Fehler - alles laeuft
// ueber den Stub. Wird mitgeschrieben statt still zu scheitern.
window.fetch=function(u){ NETZ.push(String(u)); return Promise.reject(new Error('Netzzugriff im Test: '+u)); };
// Bestaetigungsdialoge im Test immer bejahen.
window.confirm=function(){ return true; };
var KATALOG=[
  {id:'K1',gewerk:'heizung',slug:'heizkoerper_montiert',bezeichnung:'Heizkoerper montiert',kategorie:'Fertigmontage',detailfelder:{felder:['STK','DN']},sortierung:10,verwendet_anzahl:4,verwendet_zuletzt:'2026-07-30T10:00:00Z',verwendet_projekte:{P1:3}},
  {id:'K2',gewerk:'heizung',slug:'leitung_verlegt',bezeichnung:'Leitung verlegt',kategorie:'Leitungsbau',detailfelder:{felder:['M']},sortierung:20,verwendet_anzahl:2,verwendet_zuletzt:'2026-07-28T10:00:00Z'},
  {id:'K3',gewerk:'heizung',slug:'entlueftet',bezeichnung:'Anlage entlueftet',kategorie:'Inbetriebnahme',detailfelder:{felder:[]},sortierung:30,verwendet_anzahl:0,verwendet_zuletzt:null}
];
function stubApi(a,b){
  AUFRUFE.push({action:a,body:b||{}});
  if(a==='tech_wochen_rapport'){
    GELADEN.push(b.jahr+'/'+b.woche);
    var eigene=(b.jahr===2026&&b.woche===33)?ZEILEN:[];
    return Promise.resolve({kopf:{jahr:b.jahr,woche:b.woche,status:'entwurf'},zeilen:eigene,
      total_stunden:0,total_uz25:0,total_uz50:0,total_uz100:0,total_spesen:0});
  }
  if(a==='tech_projekte') return Promise.resolve({projekte:[{id:'P1',name:'Langstrasse 149',projektnummer:'25-001',standort:'Zürich',kunde_name:'Muster AG'}]});
  if(a==='svc_liste') return Promise.resolve({auftraege:[]});
  if(a==='tech_taetigkeitenkatalog') return Promise.resolve({items:KATALOG});
  if(a==='tech_tag_save') return Promise.resolve({ok:true,row:{id:'NEU',datum:b.datum,projekt_id:b.projekt_id}});
  if(a==='tech_tag_del') return Promise.resolve({ok:true});
  if(a==='tech_wochen_sign') return Promise.resolve({ok:true});
  if(a==='tech_wochen_einreichen') return Promise.resolve({ok:true});
  if(a==='tech_wochen_liste') return Promise.resolve({wochen:[]});
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
function touchEvt(typ,el,y){
  var t=new Touch({identifier:1,target:el,clientX:100,clientY:y});
  return new TouchEvent(typ,{bubbles:true,cancelable:true,touches:typ==='touchend'?[]:[t],
    targetTouches:typ==='touchend'?[]:[t],changedTouches:[t]});
}
function ende(){ sag(FEHLER.length?('\\n✗ '+FEHLER.length+' Fehler:\\n   '+FEHLER.join('\\n   ')):'\\n✓ Szenario bestanden'); sag('FERTIG'); }

tcLoadWoche(2026,33,function(){ setTimeout(los,250); });

function los(){
  ${szenario}
}
function teilZwei(r,tag){
  ${szenario2 || ''}
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

// Szenario D — ZUSATZ 1: Scroll-Isolation, echte Touch-Gesten, Body-Sperre.
const SZENARIO_D = `
  sag('SZENARIO D — Scroll-Isolation des Rades (echte Touch-Gesten)');
  // Seite erst nach unten bringen, damit die Rueckkehr messbar ist.
  document.body.style.minHeight='3000px';
  window.scrollTo(0,420);
  var vorher=window.scrollY;
  pruef(vorher===420,'Seite steht auf Position 420 (bekommen: '+vorher+')');

  tcWheelOeffnen();
  var rad=document.getElementById('tc-wheel');
  var col=document.getElementById('tc-wheel-woche');
  pruef(!!rad&&!!col,'Rad offen');
  setTimeout(function(){ weiter(rad,col,vorher); },150);
}
function weiter(rad,col,vorher){

  // (1) Seite hinter dem Rad gesperrt?
  pruef(getComputedStyle(document.body).position==='fixed','Body ist gesperrt, die Seite kann nicht mitscrollen');
  pruef(document.body.style.top==='-420px','Sperre haelt die Scrollposition fest (top='+document.body.style.top+')');

  // (2) Deklarative Isolation — genau das, was auf echtem Touch wirkt.
  pruef(getComputedStyle(col).overscrollBehaviorY==='contain','overscroll-behavior:contain auf der Rad-Spalte');
  pruef(getComputedStyle(col).touchAction==='pan-y','touch-action:pan-y nur innerhalb des Rades');
  var bd=document.getElementById('tc-wheel-backdrop');
  pruef(getComputedStyle(bd).touchAction==='none','Hintergrund nimmt keine Wischgeste an (touch-action:none)');
  pruef(getComputedStyle(document.querySelector('.tc-wheel-opt')).scrollSnapStop==='always','scroll-snap-stop:always — eine Geste, eine Rastung');

  // (3) Echte Touch-Geste im Rad: waehrend der Finger liegt, darf nichts einrasten.
  col.dispatchEvent(touchEvt('touchstart',col,300));
  pruef(tcWheelFinger===true,'touchstart wird erkannt (nicht nur Maus/Pointer)');
  pruef(tcWheelGeste===true,'Geste als echt markiert');
  var kwVorher=tcWocheState.woche;
  col.scrollTop=col.scrollTop+TC_WHEEL_ROW_H*2;
  col.dispatchEvent(new Event('scroll'));
  setTimeout(function(){
    pruef(tcWocheState.woche===kwVorher,'solange der Finger aufliegt, wechselt die Woche NICHT');
    // Loslassen -> jetzt darf eingerastet werden.
    col.dispatchEvent(touchEvt('touchend',col,300));
    setTimeout(function(){
      pruef(tcWocheState.woche===kwVorher+2,'nach dem Loslassen rastet es auf die gescrollte Woche ein (bekommen: '+tcWocheState.woche+')');
      pruef(!document.getElementById('tc-wheel'),'Rad schliesst nach der Wahl');
      // (4) Body wieder frei und exakt an derselben Stelle.
      pruef(getComputedStyle(document.body).position!=='fixed','Body-Sperre wieder aufgehoben');
      pruef(window.scrollY===420,'Seite steht wieder exakt auf 420 (bekommen: '+window.scrollY+')');
      // (5) Tap ausserhalb schliesst.
      tcWheelOeffnen();
      pruef(!!document.getElementById('tc-wheel'),'Rad erneut offen');
      var bd2=document.getElementById('tc-wheel-backdrop');
      bd2.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      pruef(!document.getElementById('tc-wheel'),'Tap auf den Hintergrund schliesst das Rad');
      pruef(window.scrollY===420,'auch danach steht die Seite wieder auf 420 (bekommen: '+window.scrollY+')');
      ende();
    },400);
  },400);
`;

// Szenario E — ZUSATZ 2a: jeder Weg im Wochenblatt einmal durchlaufen.
// Jeder Schritt muss MESSBAR etwas bewirken; blosses "kein Fehler" genügt nicht.
const SZENARIO_E = `
  sag('SZENARIO E — vollständiger Durchlauf aller Wege');
  var r=leereZeile(); if(!r) { pruef(false,'leere Zeile vorhanden'); return ende(); }
  var tag=r.getAttribute('data-date');

  // 1 Projekt wählen
  var sel=r.querySelector('.rc-ziel'); sel.value='p:P1'; tcRowZielChange(sel);
  pruef(felderSichtbar(r),'1  Projekt wählen blendet den Feldblock ein');
  pruef(tcCollectRow(r).projekt_id==='P1','1  Projekt landet in den Speicherdaten');

  // 2 Gewerk
  var gw=r.querySelectorAll('.rc-gewerk-chips .tc-chip');
  pruef(gw.length===5,'2  fünf Gewerk-Chips (Sanitär/Heizung/Klima/Lüftung/Divers)');
  tcRowGewerkPick(gw[1]);
  pruef(gw[1].classList.contains('sel'),'2  Gewerk-Chip wird als gewählt markiert');
  pruef(tcCollectRow(r).taetigkeit==='Heizung','2  Gewerk landet in den Speicherdaten');

  // 3 Start/Ende über die Schnellwahl-Chips
  var sc=r.querySelectorAll('.rc-timegrid .tc-chips')[0].querySelectorAll('.tc-chip');
  var ec=r.querySelectorAll('.rc-timegrid .tc-chips')[1].querySelectorAll('.tc-chip');
  tcTimeChipPick(sc[1],'start'); tcTimeChipPick(ec[2],'ende');
  pruef(r.querySelector('.f-start').value==='07:00','3  Start-Chip setzt 07:00');
  pruef(r.querySelector('.f-ende').value==='17:00','3  Ende-Chip setzt 17:00');

  // 4 Pause + berechnete Stunden  (17:00-07:00) - 1.25 = 8.75
  var pause=r.querySelector('.f-pause');
  pruef(Number(pause.value)===1.25,'4  Pause mit 1.25 h (75 min) vorbelegt');
  // (17:00-07:00) - 1.25 = 8.75, gerundet auf Halbstundenschritte = 9.00.
  // Die Rundung ist so vorgesehen (Uebergabe 01.08.: "Std-Feld in
  // Halbstundenschritten"), deshalb ist 9.00 der Sollwert, nicht 8.75.
  pruef(Number(r.querySelector('.f-std').value)===9,'4  Stunden = (Ende-Start)-Pause, auf Halbstunden gerundet = 9.00 (bekommen: '+r.querySelector('.f-std').value+')');
  pause.value='2'; tcRowTimeInput(pause);
  pruef(Number(r.querySelector('.f-std').value)===8,'4  Pause ändern rechnet die Stunden neu (8.00)');

  // 5 Stunden von Hand überschreiben -> als abweichend markiert
  var std=r.querySelector('.f-std'); std.value='7.5'; tcRowStdManualInput(std);
  pruef(std.getAttribute('data-manuell')==='1','5  manuelle Stunden werden als solche vermerkt');
  pruef(getComputedStyle(r.querySelector('.rc-std-flag')).display!=='none','5  Hinweis "abweichend von Start/Ende" erscheint');
  pruef(tcCollectRow(r).stunden_manuell===true,'5  Merkmal geht mit an den Server');

  // 6 Spesen
  var sp=r.querySelectorAll('.rc-spesen-chips .tc-chip');
  pruef(sp.length===4,'6  vier Spesen-Chips (15/30/35/45)');
  tcSpesenChipPick(sp[1]);
  pruef(Number(r.querySelector('.f-spesen').value)===30,'6  Spesen-Chip setzt CHF 30');

  // 7 Tätigkeits-Picker: Vorschläge (ZIEL 6) + Kategorien
  r.querySelector('.tc-taet-add').click();
  var picker=r.querySelector('.tc-taet-picker');
  pruef(picker.style.display!=='none','7  Picker öffnet');
  var vor=picker.querySelectorAll('.tc-chip-vorschlag');
  pruef(vor.length===2,'7  ZIEL 6: Vorschläge aus eigener Nutzung (bekommen: '+vor.length+')');
  pruef(vor[0].classList.contains('auf-projekt'),'7  ZIEL 6: auf diesem Projekt Genutztes steht vorn und ist hervorgehoben');
  pruef(picker.querySelectorAll('.tc-taet-kat-chips .tc-chip').length===3,'7  drei Kategorien des Gewerks');

  // 8 Tätigkeit hinzufügen
  tcTaetAdd(vor[0]);
  var items=r.querySelectorAll('.tc-taet-list .tc-taet-item');
  pruef(items.length===1,'8  Tätigkeit wird der Zeile hinzugefügt');
  pruef(tcCollectRow(r).taetigkeiten.length===1,'8  Tätigkeit geht mit an den Server');
  pruef(document.getElementById('tc-undo').classList.contains('show'),'8  Rückgängig-Pille erscheint');

  // 9 Tätigkeit löschen + Rückgängig
  tcTaetRemove(r.querySelector('.tc-taet-item button[onclick*="tcTaetRemove"]'));
  pruef(r.querySelectorAll('.tc-taet-item').length===0,'9  Tätigkeit gelöscht');
  tcUndoRun();
  pruef(r.querySelectorAll('.tc-taet-item').length===1,'9  Rückgängig holt die Tätigkeit zurück');

  // 10 Notiz  (liegt im Detailbereich)
  r.querySelector('.rc-icons button').click();
  var notiz=r.querySelector('.rc-notiz'); notiz.value='Steigzone geprüft'; tcRowInput(notiz);
  pruef(tcCollectRow(r).notiz==='Steigzone geprüft','10  Notiz landet in den Speicherdaten');

  // 11 Diktat
  pruef(!!r.querySelector('.tc-mic'),'11  Diktier-Knopf für die Tätigkeitsbeschreibung vorhanden');
  var arb=r.querySelector('.rc-arb'); arb.value='Radiatoren angeschlossen'; tcRowInput(arb);
  pruef(tcCollectRow(r).arbeiten[0]==='Radiatoren angeschlossen','11  Freitext landet in den Speicherdaten');

  setTimeout(function(){ teilZwei(r,tag); },900);   // Autosave (700 ms) abwarten
`;

const SZENARIO_E2 = `
  // 12 Autosave hat gefeuert
  var saves=AUFRUFE.filter(function(x){return x.action==='tech_tag_save';});
  pruef(saves.length>=1,'12  Autosave hat gespeichert ('+saves.length+' Aufrufe)');
  var letzte=saves[saves.length-1].body;
  pruef(letzte.taetigkeit==='Heizung'&&Number(letzte.spesen)===30&&Number(letzte.stunden)===7.5,
    '12  gespeicherte Werte stimmen (Gewerk/Spesen/Stunden)');
  pruef(getComputedStyle(r.querySelector('.rc-status')).display!=='none','12  Speicher-Anzeige der Zeile vorhanden');

  // 13 weiterer Eintrag / Eintrag löschen / Rückgängig
  var vorZahl=document.querySelectorAll('.tc-row[data-date="'+tag+'"]').length;
  tcAddRow(tag);
  pruef(document.querySelectorAll('.tc-row[data-date="'+tag+'"]').length===vorZahl+1,'13  "＋ weiterer Eintrag" fügt eine Zeile hinzu');
  var neu=document.querySelectorAll('.tc-row[data-date="'+tag+'"]')[vorZahl];
  pruef(!!neu.querySelector('.rc-del'),'13  auch die neue, ungespeicherte Zeile hat einen Löschknopf');
  tcRowDel(neu.querySelector('.rc-del'));
  pruef(document.querySelectorAll('.tc-row[data-date="'+tag+'"]').length===vorZahl,'13  Löschen entfernt sie wieder');
  tcUndoRun();
  pruef(document.querySelectorAll('.tc-row[data-date="'+tag+'"]').length===vorZahl+1,'13  Rückgängig setzt sie zurück');
  tcRowDel(document.querySelectorAll('.tc-row[data-date="'+tag+'"]')[vorZahl].querySelector('.rc-del'));

  // 14 Unterschrift zeichnen
  var cv=document.getElementById('tc-sign-technik');
  pruef(!!cv&&cv.height===240,'14  Unterschriftfeld 240 px hoch');
  function stift(typ,x,y){ cv.dispatchEvent(new PointerEvent(typ,{bubbles:true,clientX:x,clientY:y,pointerId:1,pointerType:'touch'})); }
  var box=cv.getBoundingClientRect();
  stift('pointerdown',box.left+20,box.top+40); stift('pointermove',box.left+80,box.top+90); stift('pointerup',box.left+80,box.top+90);
  pruef(tcSignState['tc-sign-technik'].has===true,'14  Zeichnen wird erkannt');
  pruef(!!tcSignDataUrl('tc-sign-technik'),'14  Unterschrift liefert ein Bild');
  var speichern=[].slice.call(document.querySelectorAll('#tc-sign-technik-wrap .tc-btn.gold'))[0];
  pruef(speichern&&speichern.classList.contains('tc-next'),'14  ZIEL 7: "Unterschrift speichern" bekommt den goldenen Schimmer');

  // 15 Unterschrift löschen + Rückgängig
  tcSignClear('tc-sign-technik');
  pruef(tcSignState['tc-sign-technik'].has===false,'15  Unterschrift gelöscht');
  pruef(document.getElementById('tc-undo').classList.contains('show'),'15  Rückgängig-Pille erscheint');
  tcUndoRun();
  setTimeout(function(){
    pruef(tcSignState['tc-sign-technik'].has===true,'15  Rückgängig holt die Unterschrift zurück');

    // 16 Einreichen
    tcSaveSign('technik');
    setTimeout(function(){
      var sig=AUFRUFE.filter(function(x){return x.action==='tech_wochen_sign';});
      pruef(sig.length===1&&!!sig[0].body.data,'16  Unterschrift wird mit Bilddaten gesendet');
      tcSubmitWoche();
      setTimeout(function(){
        pruef(AUFRUFE.some(function(x){return x.action==='tech_wochen_einreichen';}),'16  "Woche einreichen" ruft den Server');
        // 17 Nichts ist unterwegs ins echte Netz gegangen
        pruef(NETZ.length===0,'17  kein ungewollter Netzzugriff ('+NETZ.length+')');
        ende();
      },300);
    },300);
  },300);
`;

const dir = mkdtempSync(join(tmpdir(), 'wochenblatt-'));
let fehler = 0;
for (const [name, sz, sz2] of [['A', SZENARIO_A], ['B', SZENARIO_B], ['C', SZENARIO_C], ['D', SZENARIO_D], ['E', SZENARIO_E, SZENARIO_E2]]) {
  const datei = join(dir, `szenario_${name}.html`);
  writeFileSync(datei, seite(sz, sz2));
  const dom = execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox',
    '--window-size=390,844', '--touch-events=enabled', '--virtual-time-budget=9000', '--dump-dom', `file://${datei}`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  const m = dom.match(/<pre id="ergebnis">([\s\S]*?)<\/pre>/);
  const text = m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') : '(keine Ausgabe)';
  console.log(text.trim().replace(/\nFERTIG$/, ''));
  // WICHTIG: ein Szenario, das unterwegs stirbt, hat frueher stillschweigend
  // "bestanden" gemeldet, weil einfach kein ✗ ausgegeben wurde. Ohne die
  // FERTIG-Marke gilt der Lauf deshalb als fehlgeschlagen.
  if (!/FERTIG/.test(text)) {
    console.log(`✗  Szenario ${name} ist unterwegs abgebrochen — kein FERTIG erreicht.`);
    fehler++;
  } else if (/✗/.test(text)) { fehler++; }
  console.log('');
}
console.log('─'.repeat(60));
console.log(fehler ? `✗ ${fehler} von 5 Szenarien fehlgeschlagen` : "✓ alle 5 Szenarien bestanden");
process.exit(fehler ? 1 : 0);
