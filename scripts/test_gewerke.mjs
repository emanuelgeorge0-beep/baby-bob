// Automatischer Test für das GEWERKE-STEP-FRAMEWORK.
// Teil A: reine Logik (kein DB/Netz nötig) – Templates, Gates, Fortschritt, Bericht.
// Teil B (optional): API-Smoke-Test gegen die Live-Endpunkte, wenn GW_TOKEN gesetzt ist.
//   GW_TOKEN=<access_token> GW_BASE=https://<deploy> GW_PROJEKT=<uuid> node scripts/test_gewerke.mjs
import {
  TEMPLATES, buildStepsForTemplate, validateStatusChange, computeProgress,
  buildStatusReport, resolveRange, isoWeek, isoWeekRange, maskCustomer,
} from '../api/gewerke.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', name); } }
function eq(name, a, b) { ok(`${name} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b)); }

console.log('── A. Templates ──');
eq('4 Gewerke vorhanden', Object.keys(TEMPLATES).length, 4);
eq('Sanitär 10 Steps', TEMPLATES.sanitaer.steps.length, 10);
eq('Heizung 9 Steps', TEMPLATES.heizung.steps.length, 9);
eq('Splitklima 8 Steps', TEMPLATES.splitklima.steps.length, 8);
eq('Industriekälte 8 Steps', TEMPLATES.industriekaelte.steps.length, 8);
ok('Sanitär feste Sequenz', TEMPLATES.sanitaer.editierbar === false);
ok('Splitklima editierbar', TEMPLATES.splitklima.editierbar === true);
// Reihenfolge lückenlos 1..n je Template
for (const t of Object.values(TEMPLATES)) {
  const nrs = t.steps.map((s) => s.nr);
  eq(`${t.key} Reihenfolge 1..${t.steps.length}`, nrs, Array.from({ length: t.steps.length }, (_, i) => i + 1));
}

console.log('── B. buildStepsForTemplate ──');
const san = buildStepsForTemplate('sanitaer');
eq('Sanitär erzeugt 10 Steps', san.length, 10);
eq('Step 1 kein Vorgänger', san[0].pflicht_vorgaenger_nr, null);
eq('Step 4 Vorgänger = 3', san[3].pflicht_vorgaenger_nr, 3);
eq('Step 4 (Druckprobe) Foto-Gate', san[3].foto_gate, true);
eq('Step 2 kein Foto-Gate', san[1].foto_gate, false);
eq('Alle Steps starten offen', [...new Set(san.map((s) => s.status))], ['offen']);
eq('Unbekanntes Gewerk → null', buildStepsForTemplate('quatsch'), null);

console.log('── C. validateStatusChange (Vorgänger-Gate) ──');
const spur = san.map((s, i) => ({ id: 's' + i, reihenfolge_nr: s.reihenfolge_nr, titel: s.titel, status: 'offen' }));
// Step 2 starten, während Vorgänger (1) offen → blockiert
ok('Start ohne Vorgänger-Abschluss verboten', validateStatusChange(san[1], 'in_arbeit', spur, false).ok === false);
// Vorgänger 1 abgeschlossen → Step 2 darf starten
spur[0].status = 'abgeschlossen';
ok('Start nach Vorgänger-Abschluss erlaubt', validateStatusChange(san[1], 'in_arbeit', spur, false).ok === true);
// Step 1 hat Foto-Gate → Abschluss ohne Foto verboten, mit Foto erlaubt
ok('Abschluss Foto-Gate ohne Foto verboten', validateStatusChange(san[0], 'abgeschlossen', spur, false).ok === false);
ok('Abschluss Foto-Gate mit Foto erlaubt', validateStatusChange(san[0], 'abgeschlossen', spur, true).ok === true);
// blockiert ist jederzeit erlaubt
ok('blockiert immer erlaubt', validateStatusChange(san[5], 'blockiert', spur, false).ok === true);
ok('Ungültiger Status verboten', validateStatusChange(san[0], 'quatsch', spur, false).ok === false);

console.log('── D. computeProgress ──');
const mix = [{ status: 'abgeschlossen' }, { status: 'abgeschlossen' }, { status: 'in_arbeit' }, { status: 'offen' }, { status: 'blockiert' }];
const pr = computeProgress(mix);
eq('total', pr.total, 5); eq('done', pr.done, 2); eq('prozent', pr.prozent, 40);
eq('leer → 0%', computeProgress([]).prozent, 0);

console.log('── E. ISO-Woche ──');
eq('KW 1. Jan 2024 (Mo)', isoWeek(new Date('2024-01-01')), 1);
const wr = isoWeekRange(2024, 1);
ok('KW1/2024 beginnt Montag', wr.von.getUTCDay() === 1);
ok('KW1/2024 endet Sonntag', wr.bis.getUTCDay() === 0);
const rg = resolveRange('kw', 26, 2026);
ok('resolveRange kw hat Label', /KW 26\/2026/.test(rg.label));
ok('resolveRange gesamt ohne Grenzen', resolveRange('gesamt').von === null);

console.log('── F. maskCustomer (Demo-Modus) ──');
ok('Geiger maskiert', maskCustomer('Geiger AG') !== 'Geiger AG' && /^G•/.test(maskCustomer('Geiger AG')));
eq('leer bleibt leer', maskCustomer(''), '');

console.log('── G. buildStatusReport ──');
const projekt = { id: 'p1', name: 'Geiger AG', projektnummer: 'P-2026-0001', standort: 'Zürich' };
const haeuser = [{ id: 'h1', name: 'Haus A' }];
const einheiten = [{ id: 'e1', haus_id: 'h1', name: 'Wohnung 1' }];
const steps = san.map((s, i) => ({ id: 'st' + i, einheit_id: 'e1', gewerk: 'sanitaer', reihenfolge_nr: s.reihenfolge_nr, titel: s.titel, status: i < 3 ? 'abgeschlossen' : (i === 3 ? 'in_arbeit' : 'offen'), completed_at: i < 3 ? new Date().toISOString() : null, blockiert_grund: null }));
const rep = buildStatusReport({ projekt, haeuser, einheiten, steps, zeitraum: 'gesamt', range: resolveRange('gesamt'), demo: false });
eq('Bericht Gesamt 3/10 = 30%', rep.gesamt.prozent, 30);
ok('Bericht-Text nennt Projekt', rep.text.includes('Geiger AG'));
ok('Bericht-Text nennt Prozent', rep.text.includes('30 Prozent'));
ok('Bericht-Text nennt Haus A', rep.text.includes('Haus A'));
ok('nächste Schritte vorhanden', rep.haeuser[0].naechste.length > 0);
const repDemo = buildStatusReport({ projekt, haeuser, einheiten, steps, zeitraum: 'gesamt', range: resolveRange('gesamt'), demo: true });
ok('Demo-Modus maskiert Projektname', !repDemo.text.includes('Geiger AG') && repDemo.projekt.name.startsWith('G•'));
// blockierter Step erscheint im Bericht
const steps2 = steps.map((s, i) => (i === 5 ? { ...s, status: 'blockiert', blockiert_grund: 'Material fehlt' } : s));
const rep2 = buildStatusReport({ projekt, haeuser, einheiten, steps: steps2, zeitraum: 'gesamt', range: resolveRange('gesamt'), demo: false });
ok('Blockade im Text', rep2.text.includes('blockiert') && rep2.text.includes('Material fehlt'));

console.log(`\n${fail === 0 ? '✅' : '❌'} Logik-Tests: ${pass} pass, ${fail} fail`);

// ── Teil B: End-to-End gegen Live-API (nur wenn GW_TOKEN gesetzt) ──
// Legt ein Test-Haus an, prüft Gates + Statusbericht und räumt sich selbst auf.
//   GW_TOKEN=<access_token> [GW_BASE=https://<deploy>] [GW_PROJEKT=<uuid>] node scripts/test_gewerke.mjs
if (process.env.GW_TOKEN) {
  const BASE = process.env.GW_BASE || 'http://localhost:3000';
  const call = (action, body) => fetch(`${BASE}/api/gewerke`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GW_TOKEN}` },
    body: JSON.stringify({ action, ...body }),
  }).then((r) => r.json().then((j) => ({ status: r.status, j })).catch(() => ({ status: r.status, j: {} })));

  console.log('\n── H. API End-to-End ──');
  const t = await call('templates', {});
  ok('templates liefert 4', t.j.templates && t.j.templates.length === 4);

  const p = await call('projekte', {});
  ok('projekte erreichbar', p.status === 200 && Array.isArray(p.j.projekte));
  const projektId = process.env.GW_PROJEKT || (p.j.projekte && p.j.projekte[0] && p.j.projekte[0].id);

  if (!projektId) {
    console.log('  (ℹ️  Kein Projekt verfügbar → E2E-Aufbau übersprungen.)');
  } else {
    let hausId = null;
    try {
      const HAUS = 'E2E-Test ' + new Date().toISOString().slice(11, 19);
      const su = await call('setup', { projekt_id: projektId, haus_name: HAUS, gewerke: ['sanitaer'], einheiten: ['Testwohnung'] });
      ok('setup erzeugt Haus', su.status === 200 && su.j.ok);
      ok('setup erzeugt 10 Steps', su.j.steps === 10);
      hausId = su.j.haus && su.j.haus.id;

      const tr = await call('tree', { projekt_id: projektId });
      ok('tree erreichbar', tr.status === 200);
      const haus = (tr.j.haeuser || []).find((h) => h.id === hausId);
      ok('Test-Haus im Baum', !!haus);
      const spur = haus && haus.einheiten[0].gewerke[0].steps;
      ok('Spur hat 10 Steps, 0%', spur && spur.length === 10 && haus.progress.prozent === 0);

      const step1 = spur[0], step2 = spur[1];
      // Step 2 starten, während Vorgänger offen → Gate blockiert (409)
      const g1 = await call('step_update', { step_id: step2.id, status: 'in_arbeit' });
      ok('Vorgänger-Gate blockt Step 2 (409)', g1.status === 409 && g1.j.gate);
      // Step 1 (Foto-Gate) abschließen ohne Foto → Gate blockiert
      const g2 = await call('step_update', { step_id: step1.id, status: 'abgeschlossen' });
      ok('Foto-Gate blockt Abschluss ohne Foto', g2.status === 409 && g2.j.gate);
      // Step 1 mit Foto abschließen → ok
      const g3 = await call('step_update', { step_id: step1.id, status: 'abgeschlossen', foto_url: 'e2e-foto' });
      ok('Step 1 mit Foto abgeschlossen', g3.status === 200 && g3.j.step.status === 'abgeschlossen');
      // Jetzt darf Step 2 starten
      const g4 = await call('step_update', { step_id: step2.id, status: 'in_arbeit' });
      ok('Step 2 startet nach Vorgänger-Abschluss', g4.status === 200);

      // Statusbericht Gesamt
      const br = await call('statusbericht', { projekt_id: projektId, haus_id: hausId, zeitraum: 'gesamt' });
      ok('Statusbericht 200', br.status === 200);
      ok('Statusbericht-Text vorhanden', br.j.text && br.j.text.includes('Statusbericht'));
      ok('Statusbericht Fortschritt 10%', br.j.gesamt && br.j.gesamt.prozent === 10);
      // Demo-Maskierung
      const brD = await call('statusbericht', { projekt_id: projektId, haus_id: hausId, zeitraum: 'gesamt', demo: true });
      ok('Demo-Statusbericht 200', brD.status === 200);
    } finally {
      if (hausId) { const del = await call('haus_delete', { haus_id: hausId }); ok('Cleanup: Test-Haus gelöscht', del.status === 200); }
    }
  }
} else {
  console.log('\n(ℹ️  Kein GW_TOKEN → API-E2E übersprungen. Die 42 Logik-Tests decken alle Kernregeln ab.)');
  console.log('   Nach der SQL-Migration: GW_TOKEN=<access_token> GW_BASE=https://<deploy> node scripts/test_gewerke.mjs');
}

console.log(`\n${fail === 0 ? '✅ ALLE TESTS GRÜN' : '❌ ' + fail + ' Test(s) rot'}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
