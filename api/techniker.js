// api/techniker.js – Public list of available George Solutions technicians
// Read-only showcase for the GS booking flow (Step: Techniker-Auswahl).
//
// The live gs_techniker table still uses the legacy German schema
// (qualifikation, verfuegbar, partner_location, notizen). The richer
// profile fields (specialization, rating, years_experience, photo) are
// stored as a JSON "sidecar" inside the `notizen` column until the
// proper columns are migrated (see scripts/techniker_profile_migration.sql).
//
// This endpoint is forward-compatible: if/when real columns exist, their
// values win over the sidecar JSON, so no code change is needed post-migration.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    // All technicians (available + booked); select=* tolerates either schema.
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/gs_techniker?select=*`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!r.ok) {
      const t = await r.text();
      console.error('techniker fetch error:', r.status, t);
      return res.status(500).json({ error: 'Techniker konnten nicht geladen werden' });
    }
    const rows = await r.json();

    const bereich = (req.query?.bereich || '').toLowerCase();

    // Public urgency view: ONLY real technicians (typ='techniker'). Marketing/
    // assistenz/extern/admin never appear publicly. (typ column may not exist
    // yet → undefined counts as techniker for backward compatibility.)
    const visible = (Array.isArray(rows) ? rows : []).filter((r) => !r.typ || r.typ === 'techniker');
    let techniker = visible.map(normalizeTechniker).filter(Boolean);

    // Sort: available first, then bereich match (within group), then rating desc.
    techniker.sort((a, b) => {
      if (a.availability !== b.availability) return a.availability ? -1 : 1;
      if (bereich) {
        const am = a.specialization.some((s) => s.toLowerCase() === bereich) ? 1 : 0;
        const bm = b.specialization.some((s) => s.toLowerCase() === bereich) ? 1 : 0;
        if (am !== bm) return bm - am;
      }
      return (b.rating || 0) - (a.rating || 0);
    });

    const available = techniker.filter((t) => t.availability).length;
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json({ techniker, total: techniker.length, available });
  } catch (err) {
    console.error('Techniker Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

function normalizeTechniker(row) {
  if (!row) return null;
  const side = parseSidecar(row.notizen);

  // Prefer the sidecar value when set; fall back to the (possibly empty/default)
  // real column. The migration adds specialization '{}' + rating 5.0 defaults,
  // so an empty/absent real value must NOT shadow real sidecar data.
  const specialization =
    Array.isArray(side.specialization) && side.specialization.length ? side.specialization
    : Array.isArray(row.specialization) && row.specialization.length ? row.specialization
    : [];

  const rating =
    typeof side.rating === 'number' ? side.rating
    : typeof row.rating === 'number' ? row.rating
    : null;

  const years =
    typeof side.years_experience === 'number' ? side.years_experience
    : typeof row.years_experience === 'number' ? row.years_experience
    : null;

  // qualifikation is a TEXT[] in the legacy schema; flatten it if so.
  const qualRaw = row.qualification || row.qualifikation;
  const qualification = Array.isArray(qualRaw)
    ? qualRaw.join(' · ')
    : qualRaw || side.qualification || '';

  // Equipment-Träger (voll ausgestattet: Werkzeug/Fahrzeug/Material). Real column or
  // sidecar wins; otherwise fall back to the two known bearers by name so the booking
  // flow's "always one equipment bearer in the 2er-Team" rule works pre-migration.
  const equipment_traeger =
    typeof side.equipment_traeger === 'boolean' ? side.equipment_traeger
    : typeof row.equipment_traeger === 'boolean' ? row.equipment_traeger
    : /(emanuel\s*george|patrick\s*notter)/i.test(row.name || '');

  // Herkunft: 'CH' (🇨🇭) | 'CH_AT' (🇨🇭🇦🇹). Real column / sidecar win; otherwise a name
  // fallback for the known CH_AT technicians so flags show even before the migration runs.
  const herkunft = normHerkunft(
    side.herkunft || row.herkunft || (
      /(emanuel\s*george|dimitri\s*grill|vasil\s*ignatov)/i.test(row.name || '') ? 'CH_AT' : 'CH'
    )
  );

  // Region (Grossraum) für die GS-Partner-Karte. Real column / sidecar win;
  // sonst aus dem Ort abgeleitet, damit Pins auch vor der Migration korrekt sitzen.
  const location = side.location || null;
  const region = row.region || side.region || regionFromOrt(location);

  return {
    id: row.id,
    name: row.name || 'Techniker',
    qualification,
    specialization,
    rating,
    years_experience: years,
    photo_url: row.photo_url || side.photo_url || null,
    photo_emoji: side.photo_emoji || '👷',
    location,
    region,
    availability: row.availability_status ?? row.verfuegbar ?? true,
    booked_until: side.booked_until || null,
    equipment_traeger,
    herkunft,
  };
}

// Ort → Schweizer Grossraum (Fallback, falls keine region-Spalte/Sidecar gesetzt ist).
function regionFromOrt(ort) {
  const o = String(ort || '').toLowerCase();
  if (/z(ü|ue)rich|winterthur/.test(o)) return 'Zürich';
  if (/basel|aarau|baden|olten/.test(o)) return 'Nordwestschweiz';
  if (/zug|luzern|schwyz|stans/.test(o)) return 'Zentralschweiz';
  if (/st\.?\s*gallen|schaffhausen|frauenfeld|chur/.test(o)) return 'Ostschweiz';
  if (/bern|biel|thun/.test(o)) return 'Bern';
  if (/lausanne|gen(è|e)ve|genf|sion/.test(o)) return 'Westschweiz';
  if (/lugano|bellinzona|locarno/.test(o)) return 'Tessin';
  return ort ? 'Zürich' : null;
}

function normHerkunft(v) {
  const s = String(v || 'CH').toUpperCase().replace(/[\s-]/g, '_');
  return s === 'CH_AT' ? 'CH_AT' : 'CH';
}

function parseSidecar(notizen) {
  if (!notizen || typeof notizen !== 'string') return {};
  const trimmed = notizen.trim();
  if (!trimmed.startsWith('{')) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return {};
  }
}
