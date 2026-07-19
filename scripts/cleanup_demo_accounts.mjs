// scripts/cleanup_demo_accounts.mjs
// Entfernt den kompletten Demo-Satz (Accounts + Datensatz) restlos.
//   node --env-file=.env.local scripts/cleanup_demo_accounts.mjs
import { DEMO } from './seed_demo_accounts.mjs';
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY;
if (!URL || !KEY) { console.error('SUPABASE_URL/KEY fehlen (--env-file=.env.local?)'); process.exit(1); }
const SB = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const g = async (p) => { const r = await fetch(`${URL}/rest/v1/${p}`, { headers: SB }); return r.ok ? r.json() : []; };
const del = async (p) => { await fetch(`${URL}/rest/v1/${p}`, { method: 'DELETE', headers: { ...SB, Prefer: 'return=minimal' } }).catch(() => {}); };
async function findUser(email) { const r = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: SB }); const j = await r.json(); const u = Array.isArray(j) ? j : (j.users || []); return u.find((x) => (x.email || '').toLowerCase() === email.toLowerCase()) || null; }

(async () => {
  console.log('── Demo-Cleanup ──');
  // Projekte DEMO-* (cascade räumt Zuweisung/Stockwerk/Medien/Rapporte mit)
  const projs = await g(`gs_projekte?projektnummer=like.${DEMO.projektPrefix}*&select=id`);
  for (const p of projs) await del(`gs_projekte?id=eq.${p.id}`);
  // Service-Aufträge (Objekt beginnt mit "DEMO ")
  const svc = await g(`gs_service_auftrag?objekt=like.DEMO*&select=id`);
  for (const s of svc) await del(`gs_service_auftrag?id=eq.${s.id}`);
  // Demo-Accounts + deren gs_techniker-Zeilen
  for (const email of [DEMO.partnerEmail, DEMO.techEmail]) {
    const u = await findUser(email);
    if (u) {
      await del(`gs_techniker?user_id=eq.${u.id}`);
      await del(`gs_partner_entitlements?partner_user_id=eq.${u.id}`);
      await fetch(`${URL}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: SB }).catch(() => {});
    }
  }
  console.log(`✅ Cleanup fertig (${projs.length} Projekte, ${svc.length} Service-Aufträge, 2 Accounts).`);
})().catch((e) => { console.error('💥 Cleanup-Fehler:', e.message); process.exit(1); });
