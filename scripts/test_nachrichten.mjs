// scripts/test_nachrichten.mjs — gs_nachrichten endpoint test (handles FK to gs_anfragen).
//   node scripts/test_nachrichten.mjs [baseUrl]
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
let pass = 0, fail = 0;
const is = (n, c, d) => (c ? (console.log('  ✓ ' + n), pass++) : (console.log('  ✗ ' + n + (d ? ' — ' + d : '')), fail++));
const login = async () => (await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: SBH, body: JSON.stringify(ACC) })).json()).access_token;
const api = async (body, token) => { const r = await fetch(`${BASE}/api/nachrichten`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };

console.log(`gs_nachrichten @ ${BASE}\n`);
const tok = await login();
is('no token → 401', (await api({ action: 'send' })).status === 401);

// send to self (an_id = own uid), typ nachricht
const s1 = await api({ action: 'send', an_id: UID, typ: 'nachricht', inhalt: { text: 'Test' } }, tok);
is('send → 200', s1.status === 200 && s1.body?.ok, JSON.stringify(s1.body));
const id1 = s1.body?.nachricht?.id;

// send with a gs_projekte id as projekt_id → must NOT fail (FK retry → projekt_id null)
const proj = await (await fetch(`${SUPABASE_URL}/rest/v1/gs_projekte?select=id&limit=1`, { headers: SBH })).json();
const s2 = await api({ action: 'send', an_id: UID, typ: 'materialliste', projekt_id: proj?.[0]?.id, inhalt: { positionen: [{ pos: 'Rohr', menge: 5 }] } }, tok);
is('send w/ gs_projekte id still 200 (FK-safe)', s2.status === 200 && s2.body?.ok, JSON.stringify(s2.body));
is('projekt_id dropped on FK mismatch', s2.body?.nachricht?.projekt_id == null);
is('typ coerced/kept materialliste', s2.body?.nachricht?.typ === 'materialliste');

// inbox + unread + set_status
const inbox = await api({ action: 'inbox' }, tok);
is('inbox returns messages', Array.isArray(inbox.body?.nachrichten) && inbox.body.nachrichten.length >= 2);
const uc = await api({ action: 'unread_count' }, tok);
is('unread_count ≥ 2', (uc.body?.unread || 0) >= 2, JSON.stringify(uc.body));
if (id1) { const st = await api({ action: 'set_status', id: id1, status: 'gelesen' }, tok); is('set_status gelesen', st.status === 200 && st.body?.nachricht?.status === 'gelesen'); }
is('set_status invalid → 400', (await api({ action: 'set_status', id: id1, status: 'xxx' }, tok)).status === 400);

// cleanup
await fetch(`${SUPABASE_URL}/rest/v1/gs_nachrichten?von_id=eq.${UID}`, { method: 'DELETE', headers: SBH });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
