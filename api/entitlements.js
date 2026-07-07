// api/entitlements.js – Feature-Freischaltung pro Partner-Account.
//   • mine (jeder eingeloggte Partner) → eigene freigeschaltete Features
//   • list (gs_admin) → alle Partner × Features (Matrix fürs Master-Cockpit)
//   • set  (gs_admin) → ein Entitlement an/aus (Upsert)
// Datentrennung: 'mine' liest IMMER nur die Features des aufrufenden Users.
import { FEATURES, FEATURE_KEYS, getEnabledFeatures } from '../lib/entitlements.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Nicht authentifiziert' });
  const me = await getUser(token);
  if (!me) return res.status(401).json({ error: 'Ungültiger Token' });
  const myRole = await getRole(me.id);

  try {
    const { action } = req.body || {};
    // Verwaltung nur für Admin.
    if ((action === 'list' || action === 'set') && myRole !== 'gs_admin') {
      return res.status(403).json({ error: 'Nur für Administratoren' });
    }
    switch (action) {
      case 'mine': return await mine(res, me);
      case 'list': return await list(res);
      case 'set':  return await setEntitlement(res, req.body);
      default:     return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Entitlements Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── Selbstauskunft: eigene freigeschaltete Features ──
// IMMER frisch aus der DB (kein Cache); no-store-Header ist oben gesetzt. Gibt die
// eigene user_id/email zurück → Master & Partner können abgleichen, ob die
// Freischaltung auf DIESELBE partner_user_id geschrieben wurde (Fehlerquelle Nr. 1).
async function mine(res, me) {
  const { features, tableMissing } = await getEnabledFeatures(me.id);
  return res.status(200).json({
    features: [...features],           // freigeschaltete Keys
    all: await featureCatalog(),       // Katalog (key + label) für Upgrade-Hinweise
    tableMissing,
    user_id: me.id,
    email: me.email || null,
  });
}

// ── Admin: Matrix aller Partner × Features ──
async function list(res) {
  const [partners, entRows, catalog] = await Promise.all([
    loadPartners(),
    loadAllEntitlements(),
    featureCatalog(),
  ]);
  // Map: user_id → { feature_key → enabled }
  const byUser = {};
  for (const row of entRows.rows) {
    (byUser[row.partner_user_id] = byUser[row.partner_user_id] || {})[row.feature_key] = !!row.enabled;
  }
  const out = partners.map((p) => ({
    user_id: p.user_id,
    name: p.name,
    firma: p.firma,
    email: p.email,
    entitlements: byUser[p.user_id] || {},   // fehlender Key ⇒ nicht freigeschaltet
  }));
  return res.status(200).json({ features: catalog, partners: out, tableMissing: entRows.tableMissing });
}

// ── Admin: ein Entitlement setzen (Upsert) ──
async function setEntitlement(res, body) {
  const { partner_user_id, feature_key, enabled } = body || {};
  if (!partner_user_id) return res.status(400).json({ error: 'partner_user_id erforderlich' });
  if (!FEATURE_KEYS.includes(feature_key)) return res.status(400).json({ error: 'Unbekanntes Feature' });
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (bool) erforderlich' });

  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_partner_entitlements?on_conflict=partner_user_id,feature_key`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ partner_user_id, feature_key, enabled, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    if (/PGRST205|find the table|does not exist|42P01/i.test(JSON.stringify(err))) {
      return res.status(409).json({ error: 'Tabelle fehlt – bitte scripts/entitlements.sql in Supabase ausführen.' });
    }
    return res.status(400).json({ error: err.message || 'Speichern fehlgeschlagen' });
  }
  return res.status(200).json({ ok: true, partner_user_id, feature_key, enabled });
}

// ── Helpers ──

// Feature-Katalog: bevorzugt gs_features (DB-Labels), sonst statischer Fallback.
async function featureCatalog() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_features?select=key,label&order=key`, { headers: SB });
    if (r.ok) {
      const rows = await r.json().catch(() => []);
      if (Array.isArray(rows) && rows.length) {
        // Reihenfolge des statischen Katalogs beibehalten (fachlich sortiert).
        const map = {}; rows.forEach((x) => { map[x.key] = x.label; });
        return FEATURES.map((f) => ({ key: f.key, label: map[f.key] || f.label }));
      }
    }
  } catch { /* Fallback unten */ }
  return FEATURES.map((f) => ({ key: f.key, label: f.label }));
}

async function loadAllEntitlements() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_partner_entitlements?select=partner_user_id,feature_key,enabled`, { headers: SB });
  if (!r.ok) return { rows: [], tableMissing: true };
  const rows = await r.json().catch(() => []);
  return { rows: Array.isArray(rows) ? rows : [], tableMissing: false };
}

// Alle gs_partner-Accounts (= "Kunden") – gleiche Logik wie api/projekte.js partners().
async function loadPartners() {
  const roleRows = await sbJson(await fetch(`${SUPABASE_URL}/rest/v1/user_roles?role=eq.gs_partner&select=user_id`, { headers: SB }));
  const ids = (Array.isArray(roleRows) ? roleRows : []).map((r) => r.user_id);
  if (!ids.length) return [];
  const listRes = await sbJson(await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: SB }));
  const users = Array.isArray(listRes) ? listRes : listRes.users || [];
  return users
    .filter((u) => ids.includes(u.id))
    .map((u) => ({
      user_id: u.id,
      email: u.email,
      name: u.user_metadata?.name || u.email,
      firma: u.user_metadata?.firma || null,
    }))
    .sort((a, b) => (a.firma || a.name || '').localeCompare(b.firma || b.name || ''));
}

async function getUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}
async function getRole(userId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&select=role&limit=1`, { headers: SB });
  if (!r.ok) return null;
  return (await r.json())[0]?.role || null;
}
async function sbJson(r) { try { return await r.json(); } catch { return null; } }
