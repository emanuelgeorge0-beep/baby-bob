// lib/entitlements.js – Feature-Freischaltungen pro Partner-Account.
// Tenant = gs_partner-User (partner_user_id). Genutzt von api/entitlements.js
// (Verwaltung + Selbstauskunft) und den Partner-Datenendpunkten (Durchsetzung).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

// Alle buchbaren Feature-Keys + deutsche Labels (Fallback, falls gs_features
// noch nicht eingespielt ist). Muss zu scripts/entitlements.sql passen.
export const FEATURES = [
  // ── Module & Fähigkeiten ──
  { key: 'projektmanagement',   label: 'Projektmanagement' },
  { key: 'zahlungssystem',      label: 'Zahlungssystem (Escrow)' },
  { key: 'disposition',         label: 'Techniker-Disposition' },
  { key: 'blockaden',           label: 'Blockaden-Management' },
  { key: 'material',            label: 'Materialverwaltung' },
  { key: 'material_order',      label: 'Materialbestellung' },
  { key: 'reporting',           label: 'Berichte & Rapporte' },
  { key: 'rapport',             label: 'Rapport-Erfassung' },
  { key: 'controlling',         label: 'Controlling' },
  { key: 'kalkulation',         label: 'Kalkulation' },
  { key: 'bob_scan',            label: 'Bob Scan' },
  { key: 'voice_memo',          label: 'Sprachnotiz' },
  // ── Bob als Assistent, granular pro Bereich ──
  { key: 'bob_assist_projekt',  label: 'Bob im Projektmanagement' },
  { key: 'bob_assist_rapport',  label: 'Bob bei Rapporten' },
  { key: 'bob_assist_material', label: 'Bob im Material' },
  { key: 'bob_assist_planung',  label: 'Bob in der Planung' },
  { key: 'bob_assist_admin',    label: 'Bob im Büro/Admin' },
];
export const FEATURE_KEYS = FEATURES.map((f) => f.key);

// Liefert die freigeschalteten Feature-Keys eines Partners als Set.
// Fail-open: fehlt die Tabelle (SQL noch nicht eingespielt), gelten ALLE Features
// als frei – damit vor der Migration nichts bricht. Existiert die Tabelle, gilt
// Opt-in: nur explizit gesetzte (enabled=true) Zeilen zählen.
export async function getEnabledFeatures(partnerUserId) {
  if (!partnerUserId) return { features: new Set(), tableMissing: false };
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/rest/v1/gs_partner_entitlements?partner_user_id=eq.${partnerUserId}&select=feature_key,enabled`, { headers: SB });
  } catch {
    return { features: new Set(FEATURE_KEYS), tableMissing: true };
  }
  if (!r.ok) {
    // Unbekannte Tabelle / Infra-Fehler → fail-open (Verfügbarkeit vor Strenge).
    // Die Datentrennung (partner_user_id-Filter je Endpunkt) bleibt davon unberührt.
    return { features: new Set(FEATURE_KEYS), tableMissing: true };
  }
  const rows = await r.json().catch(() => []);
  const set = new Set();
  for (const row of Array.isArray(rows) ? rows : []) if (row.enabled) set.add(row.feature_key);
  return { features: set, tableMissing: false };
}

// True, wenn der Partner das Feature nutzen darf.
export async function isEntitled(partnerUserId, key) {
  const { features } = await getEnabledFeatures(partnerUserId);
  return features.has(key);
}
