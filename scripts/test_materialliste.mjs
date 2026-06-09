// scripts/test_materialliste.mjs — Tasks 3+4: Techniker materialliste → Partner inbox.
import { readFileSync } from 'node:fs';
const BASE = process.argv[2] || 'https://baby-bob.vercel.app';
let SUPABASE_URL, SUPABASE_KEY;
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m?.[1] === 'SUPABASE_URL') SUPABASE_URL = m[2].trim();
  if (m?.[1] === 'SUPABASE_KEY') SUPABASE_KEY = m[2].trim();
}
const SBH = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const ACC = { email: 'techniker.test@georgesolutions.ch', password: 'TestTech2026!' };
const UID = '730172f2-c8a9-4cc4-90f7-98a96d283b48';
const pEmail = `ml.partner.${Date.now()}@demo.georgesolutions.ch`;
let pass = 0, fail = 0;
const is = (n, c, d) => (c ? (console.log('  ✓ ' + n), pass++) : (console.log('  ✗ ' + n + (d ? ' — ' + d : '')), fail++));
const login = async (e, p) => (await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: SBH, body: JSON.stringify({ email: e, password: p }) })).json());
const setRole = (r) => fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${UID}`, { method: 'PATCH', headers: { ...SBH, Prefer: 'return=minimal' }, body: JSON.stringify({ role: r }) });
const api = async (ep, body, tok) => { const r = await fetch(`${BASE}/api/${ep}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const delUser = async (email) => { const l = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: SBH })).json(); const u = (Array.isArray(l) ? l : l.users || []).find((x) => (x.email || '').toLowerCase() === email); if (u) { await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${u.id}`, { method: 'DELETE', headers: SBH }); await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: SBH }); } };

console.log(`Materialliste flow @ ${BASE}\n`);
let projektId, partnerId;
try {
  await delUser(pEmail);
  await setRole('gs_admin');
  const adminTok = (await login(ACC.email, ACC.password)).access_token;
  const cu = (await api('admin', { action: 'create_user', name: 'ML Partner', email: pEmail, firma: 'ML AG', role: 'gs_partner' }, adminTok)).body;
  partnerId = cu?.user?.id; const partnerTok = (await login(pEmail, cu.temp_password)).access_token;
  is('partner created + login', !!partnerId && !!partnerTok);
  const proj = (await api('projekte', { action: 'create', name: 'ML Projekt', projektnummer: `ML-${Date.now()}`, partner_user_id: partnerId, stundensatz: 67.9 }, adminTok)).body;
  projektId = proj?.projekt?.id;
  await api('projekte', { action: 'assign', projekt_id: projektId, techniker_user_ids: [UID] }, adminTok);
  is('project owned by partner', !!projektId);

  // Techniker sends materialliste
  await setRole('techniker');
  const techTok = (await login(ACC.email, ACC.password)).access_token;
  const send = await api('nachrichten', { action: 'send', typ: 'materialliste', projekt_id: projektId, empfaenger_email: pEmail, projekt_name: 'ML Projekt', inhalt: { positionen: [{ position: 'Kupferrohr 18mm', menge: '5', einheit: 'm' }], notiz: 'Bitte bestellen', von_name: 'Dimitri Grill' } }, techTok);
  is('techniker send materialliste → 200', send.status === 200 && send.body?.ok, JSON.stringify(send.body));
  is('routed to partner (an_id)', send.body?.nachricht?.an_id === partnerId, send.body?.nachricht?.an_id);
  is('typ materialliste', send.body?.nachricht?.typ === 'materialliste');
  const msgId = send.body?.nachricht?.id;

  // Partner sees it
  const inbox = await api('nachrichten', { action: 'inbox' }, partnerTok);
  is('partner inbox shows materialliste', (inbox.body?.nachrichten || []).some((n) => n.id === msgId));
  const uc = await api('nachrichten', { action: 'unread_count' }, partnerTok);
  is('partner unread ≥ 1', (uc.body?.unread || 0) >= 1, JSON.stringify(uc.body));
  const inh = (inbox.body?.nachrichten || []).find((n) => n.id === msgId)?.inhalt;
  is('inhalt carries positions', inh?.positionen?.[0]?.position === 'Kupferrohr 18mm');
  // Partner confirms
  const st = await api('nachrichten', { action: 'set_status', id: msgId, status: 'bestaetigt' }, partnerTok);
  is('partner bestätigt', st.status === 200 && st.body?.nachricht?.status === 'bestaetigt');
  // Techniker can NOT set status (not recipient)
  is('techniker cannot set status (404)', (await api('nachrichten', { action: 'set_status', id: msgId, status: 'gelesen' }, techTok)).status === 404);
} catch (e) { is('no exception', false, e.message); }
finally {
  await setRole('gs_admin');
  if (projektId) { await fetch(`${SUPABASE_URL}/rest/v1/gs_nachrichten?an_id=eq.${partnerId}`, { method: 'DELETE', headers: SBH }); await fetch(`${SUPABASE_URL}/rest/v1/gs_projekt_techniker?projekt_id=eq.${projektId}`, { method: 'DELETE', headers: SBH }); await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?id=eq.${projektId}`, { method: 'DELETE', headers: SBH }); }
  await delUser(pEmail);
  await setRole('techniker');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
