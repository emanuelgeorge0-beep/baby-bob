// api/bob-feedback.js – BOB self-learning capture (Task 7)
// Public, anonymous. Writes to bob_scans / bob_unbekannt with the service key.
// Degrades gracefully (200 {saved:false}) until the migration is run, so the
// B2C feedback UI never shows a hard error.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  try {
    const { action } = req.body || {};
    if (action === 'feedback') return await saveFeedback(res, req.body);
    if (action === 'unbekannt') return await saveUnbekannt(res, req.body);
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('BOB-Feedback Error:', err.message);
    return res.status(200).json({ ok: false, saved: false }); // never block the UI
  }
}

async function saveFeedback(res, body) {
  const fb = body.user_feedback;
  if (!['correct', 'wrong', 'corrected'].includes(fb)) {
    return res.status(400).json({ error: 'user_feedback must be correct|wrong|corrected' });
  }
  const row = {
    bild_hash: str(body.bild_hash),
    bob_antwort: str(body.bob_antwort),
    kategorie: str(body.kategorie),
    user_feedback: fb,
    user_korrektur: str(body.user_korrektur),
  };
  return await insert(res, 'bob_scans', row);
}

async function saveUnbekannt(res, body) {
  const row = {
    bild_hash: str(body.bild_hash),
    bob_antwort: str(body.bob_antwort),
    user_korrektur: str(body.user_korrektur),
    kategorie_vorschlag: str(body.kategorie_vorschlag),
  };
  if (!row.user_korrektur) return res.status(400).json({ error: 'user_korrektur erforderlich' });
  return await insert(res, 'bob_unbekannt', row);
}

async function insert(res, table, row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(row),
  });
  if (r.ok) return res.status(200).json({ ok: true, saved: true });
  const txt = await r.text();
  // Table not migrated yet → soft success so the UI still thanks the user.
  if (/PGRST205|not find the table|does not exist|relation/i.test(txt)) {
    console.warn(`${table} not migrated yet — feedback dropped`);
    return res.status(200).json({ ok: true, saved: false, pending_migration: true });
  }
  console.error(`${table} insert error:`, r.status, txt);
  return res.status(200).json({ ok: false, saved: false });
}

function str(v) {
  if (v == null) return null;
  return String(v).slice(0, 4000);
}
