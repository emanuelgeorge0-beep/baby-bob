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
    // Only available technicians; select=* tolerates either schema version.
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/gs_techniker?verfuegbar=eq.true&select=*`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!r.ok) {
      const t = await r.text();
      console.error('techniker fetch error:', r.status, t);
      return res.status(500).json({ error: 'Techniker konnten nicht geladen werden' });
    }
    const rows = await r.json();

    const bereich = (req.query?.bereich || '').toLowerCase();

    let techniker = rows.map(normalizeTechniker).filter(Boolean);

    // Sort: best match for requested bereich first, then rating desc.
    techniker.sort((a, b) => {
      if (bereich) {
        const am = a.specialization.some((s) => s.toLowerCase() === bereich) ? 1 : 0;
        const bm = b.specialization.some((s) => s.toLowerCase() === bereich) ? 1 : 0;
        if (am !== bm) return bm - am;
      }
      return (b.rating || 0) - (a.rating || 0);
    });

    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json({ techniker });
  } catch (err) {
    console.error('Techniker Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

function normalizeTechniker(row) {
  if (!row) return null;
  const side = parseSidecar(row.notizen);

  // Real columns (post-migration) win; otherwise fall back to sidecar JSON.
  const specialization = Array.isArray(row.specialization)
    ? row.specialization
    : Array.isArray(side.specialization)
    ? side.specialization
    : [];

  const rating =
    typeof row.rating === 'number' ? row.rating
    : typeof side.rating === 'number' ? side.rating
    : null;

  const years =
    typeof row.years_experience === 'number' ? row.years_experience
    : typeof side.years_experience === 'number' ? side.years_experience
    : null;

  // qualifikation is a TEXT[] in the legacy schema; flatten it if so.
  const qualRaw = row.qualification || row.qualifikation;
  const qualification = Array.isArray(qualRaw)
    ? qualRaw.join(' · ')
    : qualRaw || side.qualification || '';

  return {
    id: row.id,
    name: row.name || 'Techniker',
    qualification,
    specialization,
    rating,
    years_experience: years,
    photo_url: row.photo_url || side.photo_url || null,
    photo_emoji: side.photo_emoji || '👷',
    location: side.location || null,
    availability: row.availability_status ?? row.verfuegbar ?? true,
  };
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
