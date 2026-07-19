// scripts/seed_demo_accounts.mjs
// Vorführ-/Demo-Accounts + isolierter Demo-Datensatz (Build-in-Public-Videos).
// Erstellt: 1 Demo-Partner + 1 Demo-Techniker (echte Logins) und einen sauber
// markierten Demo-Datensatz (Projekte DEMO-###, Zuweisung, Rapporte, Service-Auftrag).
// Der Master zeigt die Master-Ansicht mit SEINEM echten Login auf genau diesen Daten.
// Idempotent (mehrfach ausführbar). Cleanup: scripts/cleanup_demo_accounts.mjs
//   node --env-file=.env.local scripts/seed_demo_accounts.mjs
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY;
if (!URL || !KEY) { console.error('SUPABASE_URL/KEY fehlen (--env-file=.env.local?)'); process.exit(1); }
const SB = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

export const DEMO = {
  partnerEmail: 'demo.partner@demo.felix.app',
  techEmail:    'demo.techniker@demo.felix.app',
  password:     'FelixDemo2026!',
  projektPrefix: 'DEMO-',
};

async function rest(method, path, body, prefer) {
  const h = { ...SB }; if (prefer) h.Prefer = prefer;
  const r = await fetch(`${URL}/rest/v1/${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${t.slice(0, 160)}`);
  try { return JSON.parse(t); } catch { return null; }
}
async function findUser(email) {
  const r = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: SB });
  const j = await r.json(); const users = Array.isArray(j) ? j : (j.users || []);
  return users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}
async function ensureUser(email, meta) {
  const ex = await findUser(email);
  if (ex) {
    // Passwort/Metadata auffrischen (Demo bleibt vorführbar).
    await fetch(`${URL}/auth/v1/admin/users/${ex.id}`, { method: 'PUT', headers: SB, body: JSON.stringify({ password: DEMO.password, user_metadata: { ...(ex.user_metadata || {}), ...meta } }) }).catch(() => {});
    return ex.id;
  }
  const r = await fetch(`${URL}/auth/v1/admin/users`, { method: 'POST', headers: SB, body: JSON.stringify({ email, password: DEMO.password, email_confirm: true, user_metadata: meta }) });
  const j = await r.json(); if (!r.ok || !j.id) throw new Error(`create ${email}: ${JSON.stringify(j).slice(0, 160)}`);
  return j.id;
}
async function ensureRole(userId, role) {
  await rest('POST', 'user_roles?on_conflict=user_id', { user_id: userId, role }, 'resolution=merge-duplicates,return=minimal').catch(async () => {
    await rest('DELETE', `user_roles?user_id=eq.${userId}`, null, 'return=minimal').catch(() => {});
    await rest('POST', 'user_roles', { user_id: userId, role }, 'return=minimal');
  });
}
async function ensureEntitlements(partnerId, keys) {
  for (const k of keys) {
    await rest('POST', 'gs_partner_entitlements?on_conflict=partner_user_id,feature_key', { partner_user_id: partnerId, feature_key: k, enabled: true }, 'resolution=merge-duplicates,return=minimal').catch(() => {});
  }
}

const PROJEKTE = [
  { nr: 'DEMO-001', name: 'DEMO · Fernwärmezentrale MFH Seefeld', standort: 'Zürich', bereich: 'Heizung', stundensatz: 92 },
  { nr: 'DEMO-002', name: 'DEMO · Sanitär-Sanierung Wohnblock Aarau', standort: 'Aarau', bereich: 'Sanitär', stundensatz: 88 },
  { nr: 'DEMO-003', name: 'DEMO · Splitklima Büro Baar', standort: 'Baar', bereich: 'Kälte', stundensatz: 96 },
];

(async () => {
  console.log('── Demo-Seed startet ──');
  const partnerId = await ensureUser(DEMO.partnerEmail, { demo: true, name: 'DEMO Hausverwaltung', firma: 'DEMO Immobilien AG', profile_complete: true, must_change_password: false, active: true });
  const techId    = await ensureUser(DEMO.techEmail,    { demo: true, name: 'DEMO Monteur', profile_complete: true, must_change_password: false, active: true });
  await ensureRole(partnerId, 'gs_partner');
  await ensureRole(techId, 'techniker');
  await ensureEntitlements(partnerId, ['projektmanagement', 'sub_akkord', 'partner_branding', 'zahlungssystem']);
  console.log(`  Partner=${partnerId.slice(0, 8)}  Techniker=${techId.slice(0, 8)}`);

  // gs_techniker-Profil für Demo-Techniker
  let techRow = (await rest('GET', `gs_techniker?user_id=eq.${techId}&select=id&limit=1`))[0];
  if (!techRow) techRow = (await rest('POST', 'gs_techniker', { name: 'DEMO Monteur', email: DEMO.techEmail, user_id: techId, qualifikation: ['Monteur HKLS (Demo)'] }, 'return=representation'))[0];
  console.log(`  gs_techniker=${techRow.id.slice(0, 8)}`);

  // Projekte (idempotent per projektnummer), Zuweisung, Stockwerke, Rapporte
  const projIds = [];
  for (const p of PROJEKTE) {
    let proj = (await rest('GET', `gs_projekte?projektnummer=eq.${p.nr}&select=id&limit=1`))[0];
    if (!proj) proj = (await rest('POST', 'gs_projekte', { projektnummer: p.nr, name: p.name, standort: p.standort, bereich: p.bereich, status: 'aktiv', stundensatz: p.stundensatz, partner_user_id: partnerId }, 'return=representation'))[0];
    projIds.push(proj.id);
    // gs_projekt_techniker (Live-Tabelle) hat KEIN UNIQUE(projekt_id,techniker_id) →
    // kein on_conflict; idempotent per prüfen-dann-einfügen.
    const asg = await rest('GET', `gs_projekt_techniker?projekt_id=eq.${proj.id}&techniker_id=eq.${techRow.id}&select=projekt_id&limit=1`);
    if (!asg[0]) await rest('POST', 'gs_projekt_techniker', { projekt_id: proj.id, techniker_id: techRow.id, taetigkeit: 'Monteur' }, 'return=minimal');
  }
  // Stockwerke + zwei rückdatierte Rapporte auf dem ersten Projekt
  for (const [i, nm] of ['UG', 'EG', '1.OG', '2.OG'].entries()) {
    await rest('POST', 'gs_projekt_stockwerk?on_conflict=projekt_id,name', { projekt_id: projIds[0], name: nm, reihenfolge: i, quelle: 'preset' }, 'resolution=merge-duplicates,return=minimal').catch(() => {});
  }
  for (const d of ['2026-07-13', '2026-07-14']) {
    await rest('POST', 'gs_tagesrapporte?on_conflict=projekt_id,techniker_user_id,datum', { projekt_id: projIds[0], techniker_user_id: techId, datum: d, gesamtstunden: 8, arbeiten: ['Steigzone montiert', 'Radiatoren angeschlossen'], material: ['4× Ventil DN15'], besonderheiten: 'Demo-Rapport', status: 'eingereicht' }, 'resolution=merge-duplicates,return=minimal').catch(() => {});
  }
  // Service-Auftrag (Demo) + Zuweisung
  let svc = (await rest('GET', `gs_service_auftrag?objekt=eq.${encodeURIComponent('DEMO · Notdienst Heizung Wetzikon')}&select=id&limit=1`))[0];
  if (!svc) svc = (await rest('POST', 'gs_service_auftrag', { objekt: 'DEMO · Notdienst Heizung Wetzikon', beschreibung: 'Heizung tropft, Kunde meldet Druckverlust.', quelle: 'manuell', status: 'angenommen', partner_user_id: partnerId }, 'return=representation'))[0];
  await rest('POST', 'gs_service_techniker?on_conflict=service_auftrag_id,techniker_id', { service_auftrag_id: svc.id, techniker_id: techRow.id }, 'resolution=merge-duplicates,return=minimal').catch(() => {});

  console.log('\n✅ Demo-Datensatz bereit.');
  console.log('   Partner-Login : ' + DEMO.partnerEmail + '   /   ' + DEMO.password);
  console.log('   Techniker-Login: ' + DEMO.techEmail + '   /   ' + DEMO.password);
  console.log('   Projekte: ' + PROJEKTE.map((p) => p.nr).join(', ') + ' + 1 Service-Auftrag (Demo).');
  console.log('   Master zeigt die Master-Ansicht mit deinem echten Login auf diesen DEMO-Daten.');
})().catch((e) => { console.error('💥 Seed-Fehler:', e.message); process.exit(1); });
