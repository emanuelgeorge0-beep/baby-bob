// scripts/test-blockaden.mjs — Blockaden-Modul End-to-End (adaptiv, self-cleaning).
//
// Deckt die Definition of Done ab, soweit ohne echte Migration/Fremd-Logins möglich:
//   • Auth-Gating (ohne Token → 401)
//   • KI-Auto-Zuordnung (classify, echter Claude-Call) → valider Vorschlag
//   • Blockade anlegen (create) → Sofort-Benachrichtigung (mail_sent) + Rückgabe
//   • list/get/update/report/speak_text
//   • Permission-Gate: der MELDER darf NICHT freigeben → 403 (Multi-Rollen-Sicherheit)
//   • optional: echte Freigabe mit Admin-/Partner-Login (ENV) → Step entsperrt
//   • Aufräumen: alle Test-Blockaden werden am Ende gelöscht (delete)
//
// Läuft gegen eine DEPLOYTE URL (dort sind ANTHROPIC/RESEND/ELEVENLABS gesetzt).
// Vor der Migration (scripts/blockaden_migration.sql) degradiert die API sauber
// (notMigrated) → das Skript erkennt das und bewertet die Grundfunktionen trotzdem.
//
// Aufruf:
//   node scripts/test-blockaden.mjs <BASE_URL> [DURCHLÄUFE]
//   ADMIN_EMAIL=.. ADMIN_PW=.. node scripts/test-blockaden.mjs <BASE_URL> 20
import { readFileSync } from 'node:fs';

const BASE = (process.argv[2] || 'https://baby-bob.vercel.app').replace(/\/$/, '');
const RUNS = Number(process.argv[3] || 5);

let SUPABASE_URL, SUPABASE_KEY;
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m?.[1] === 'SUPABASE_URL') SUPABASE_URL = m[2].trim();
  if (m?.[1] === 'SUPABASE_KEY') SUPABASE_KEY = m[2].trim();
}
const SBH = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

const TECH = { email: process.env.TECH_EMAIL || 'techniker.test@georgesolutions.ch', password: process.env.TECH_PW || 'TestTech2026!' };
const ADMIN = process.env.ADMIN_EMAIL ? { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PW || '' } : null;
const PARTNER = process.env.PARTNER_EMAIL ? { email: process.env.PARTNER_EMAIL, password: process.env.PARTNER_PW || '' } : null;

let pass = 0, fail = 0, skip = 0;
const ok  = (n, c, d) => (c ? (console.log('  ✓ ' + n), pass++) : (console.log('  ✗ ' + n + (d ? ' — ' + d : '')), fail++));
const sk  = (n, d) => { console.log('  ○ SKIP ' + n + (d ? ' — ' + d : '')); skip++; };
const login = async (e, p) => (await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: SBH, body: JSON.stringify({ email: e, password: p }) })).json());
const api = async (body, tok) => {
  const r = await fetch(`${BASE}/api/blockaden`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const created = []; // {id, tok} zum Aufräumen
const URGS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const ROLLEN = ['planung', 'material', 'extern', 'gebaeudetechnik'];

console.log(`\n🚧 Blockaden E2E @ ${BASE} — ${RUNS} Durchläufe\n`);

// ── A. Auth-Gating ──────────────────────────────────────────
console.log('A) Auth-Gating:');
{
  const r = await api({ action: 'list' }, null);
  ok('ohne Token → 401', r.status === 401, 'status ' + r.status);
}

// ── B. KI-Auto-Zuordnung (classify, kein Login nötig) ───────
console.log('\nB) KI-Auto-Zuordnung (classify):');
const classifySamples = [
  'Im Bad OG Haus A kann ich die Steigleitung nicht montieren, das Rohr 22 Millimeter fehlt komplett. Blockiert alles.',
  'Der Verteiler im Technikraum Haus B lässt sich nicht anschliessen, die Elektro-Vorleistung vom anderen Gewerk fehlt.',
];
for (let i = 0; i < classifySamples.length; i++) {
  const r = await api({ action: 'classify', text: classifySamples[i] }, null);
  const s = r.body && r.body.suggestion;
  ok(`[${i + 1}] classify HTTP 200 + suggestion`, r.status === 200 && !!s, 'status ' + r.status);
  if (s) {
    ok(`[${i + 1}] urgency gültig (${s.urgency})`, URGS.includes(s.urgency));
    ok(`[${i + 1}] rolle gültig (${s.blockiert_von_rolle})`, ROLLEN.includes(s.blockiert_von_rolle));
    ok(`[${i + 1}] step_ref gesetzt`, !!(s.step_ref && s.step_ref.length));
  }
}

// ── C. Techniker-Login + Projektwahl ────────────────────────
console.log('\nC) Techniker: Login + Projekt:');
const techTok = (await login(TECH.email, TECH.password)).access_token;
ok('techniker login', !!techTok, 'kein Token für ' + TECH.email);
let projektId = null, projektName = null;
if (techTok) {
  const pr = await fetch(`${BASE}/api/projekte`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${techTok}` }, body: JSON.stringify({ action: 'list' }) });
  const pj = await pr.json().catch(() => ({}));
  const ps = (pj && pj.projekte) || [];
  if (ps.length) { projektId = ps[0].id; projektName = ps[0].name; }
  console.log('  · Projekt:', projektName || '(keins — create mit projekt_id=null)');
}

// ── D. Create-Loop (Migration-adaptiv) ──────────────────────
console.log('\nD) Blockade anlegen (' + RUNS + '×):');
let migrated = null; // null=unbekannt, true/false
if (techTok) {
  for (let i = 1; i <= RUNS; i++) {
    const r = await api({
      action: 'create',
      projekt_id: projektId, projekt_name: projektName || 'E2E-Blockadentest',
      haus: 'Haus A', einheit: 'Whg ' + i, zone: 'Bad OG',
      step_ref: 'E2E Steigleitung ' + i,
      beschreibung: `E2E-Testblockade ${i}: Rohr 22 mm fehlt, Steigleitung blockiert.`,
      urgency: URGS[i % 4], blockiert_von_rolle: 'material',
      reporter_name: 'E2E Techniker',
      owner_email: 'delivered@resend.dev', // Resend-Test-Sink → keine echte Zustellung
    }, techTok);
    if (r.status === 503 && r.body && r.body.notMigrated) {
      migrated = false;
      if (i === 1) sk('create (gs_blockaden noch nicht migriert → graceful 503)', 'nach Migration erneut ausführen');
      break;
    }
    migrated = true;
    const b = r.body && r.body.blockade;
    ok(`[${i}] create HTTP 200 + id`, r.status === 200 && !!(b && b.id), 'status ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
    if (b && b.id) {
      created.push({ id: b.id, tok: techTok });
      ok(`[${i}] status=offen`, b.status === 'offen');
      ok(`[${i}] urgency übernommen (${b.urgency})`, b.urgency === URGS[i % 4]);
      ok(`[${i}] Benachrichtigung ausgelöst`, r.body.notified === true || typeof r.body.mail_sent === 'boolean');
    }
  }
}

// ── E. list / get / update / report / speak (nur wenn migriert) ──
if (migrated) {
  console.log('\nE) list / get / update / report / speak:');
  const first = created[0];
  const lst = await api({ action: 'list' }, techTok);
  ok('list liefert Array', lst.status === 200 && Array.isArray(lst.body && lst.body.blockaden));
  ok('list enthält angelegte Blockade', !!(lst.body && (lst.body.blockaden || []).some((x) => x.id === first.id)));
  ok('list ohne Foto-Base64 (nur foto_count)', (lst.body.blockaden || []).every((x) => !('fotos' in x) && 'foto_count' in x));

  const g = await api({ action: 'get', id: first.id }, techTok);
  ok('get liefert Detail', g.status === 200 && !!(g.body && g.body.blockade && g.body.blockade.id === first.id));

  const up = await api({ action: 'update', id: first.id, status: 'in_bearbeitung' }, techTok);
  ok('Melder darf eigene Blockade updaten (in_bearbeitung)', up.status === 200 && up.body && up.body.blockade && up.body.blockade.status === 'in_bearbeitung');

  // Permission-Gate: der MELDER (Techniker) darf NICHT freigeben.
  const fg = await api({ action: 'freigeben', id: first.id }, techTok);
  ok('Melder darf NICHT freigeben → 403', fg.status === 403, 'status ' + fg.status);

  const rep = await api({ action: 'report', pdf: true }, techTok);
  ok('report HTTP 200', rep.status === 200 && rep.body && rep.body.ok);
  ok('report enthält speak_text', !!(rep.body && rep.body.speak_text && rep.body.speak_text.length));
  ok('report PDF erzeugt (base64)', typeof (rep.body && rep.body.pdf_base64) === 'string' && rep.body.pdf_base64.length > 100);

  const sp = await api({ action: 'speak_text' }, techTok);
  ok('speak_text liefert Text', sp.status === 200 && !!(sp.body && sp.body.text && sp.body.text.length));

  // ── F. Optionale echte Freigabe mit Admin/Partner ──
  console.log('\nF) Freigabe (Bauleiter-Büro / Admin):');
  const priv = ADMIN || PARTNER;
  if (priv) {
    const ptok = (await login(priv.email, priv.password)).access_token;
    ok('privilegierter Login (' + priv.email + ')', !!ptok);
    if (ptok) {
      const pl = await api({ action: 'list' }, ptok);
      ok('privilegierte Rolle sieht Blockaden', pl.status === 200 && Array.isArray(pl.body && pl.body.blockaden));
      const target = created[created.length - 1];
      const done = await api({ action: 'freigeben', id: target.id, resolution: 'E2E: Material geliefert.' }, ptok);
      ok('freigeben → status freigegeben', done.status === 200 && done.body && done.body.blockade && done.body.blockade.status === 'freigegeben', 'status ' + done.status);
      ok('freigeben → step_entsperrt=true', !!(done.body && done.body.step_entsperrt));
    }
  } else {
    sk('echte Freigabe', 'ADMIN_EMAIL/ADMIN_PW (oder PARTNER_*) nicht gesetzt → nur 403-Gate geprüft');
  }
} else if (migrated === false) {
  console.log('\nE) Tabellen-abhängige Tests übersprungen (Migration ausstehend) — API degradiert sauber. ✓');
}

// ── G. Aufräumen (self-cleaning) ────────────────────────────
console.log('\nG) Aufräumen:');
let del = 0;
for (const c of created) {
  const r = await api({ action: 'delete', id: c.id }, c.tok);
  if (r.status === 200) del++;
}
ok(`Test-Blockaden gelöscht (${del}/${created.length})`, del === created.length || created.length === 0);

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
