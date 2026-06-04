// api/dashboard.js – Master lead overview for gs_admin (all Säulen S1–S4)
//
// S1 = Baby BOB Scanner (B2C)  → table `anfragen`
// S2 = GS Modus (B2B bookings) → table `gs_anfragen`
// S3 = Future marketplace      → placeholder (no source yet)
// S4 = George Solutions direct → placeholder (no source yet)
//
// gs_admin only. Verifies the caller's bearer token → user → role.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;

const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  // ── Auth: require a valid token belonging to a gs_admin ──
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Nicht authentifiziert' });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Ungültiger Token' });
  const user = await userRes.json();

  const roleRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${user.id}&select=role&limit=1`,
    { headers: SB }
  );
  const role = roleRes.ok ? (await roleRes.json())[0]?.role : null;
  if (role !== 'gs_admin') return res.status(403).json({ error: 'Nur für Administratoren' });

  // ── Aggregate ──
  try {
    const [s1, s2] = await Promise.all([
      fetchRows('anfragen', 'id,created_at,name,problem_titel,fachmann,kategorie,status,ort'),
      fetchRows('gs_anfragen', 'id,erstellt_am,projekt_name,bereich,tarif,status,notiz,kunde_id'),
    ]);

    const s1Leads = s1.map((r) => ({
      id: r.id,
      source: 'S1',
      source_label: 'Baby BOB Scanner',
      date: r.created_at || null,
      title: r.problem_titel || r.kategorie || 'BOB-Anfrage',
      detail: [r.name, r.ort].filter(Boolean).join(' · '),
      status: r.status || 'neu',
      partner: r.fachmann || null,
    }));

    const s2Leads = s2.map((r) => ({
      id: r.id,
      source: 'S2',
      source_label: 'GS Modus',
      date: r.erstellt_am || null,
      title: r.projekt_name || r.bereich || 'GS-Projekt',
      detail: [r.bereich, r.tarif].filter(Boolean).join(' · '),
      status: r.status || 'neu',
      partner: extractPartner(r.notiz),
    }));

    const sources = {
      S1: { label: 'Baby BOB Scanner', sublabel: 'B2C Leads', count: s1Leads.length, leads: sortByDate(s1Leads) },
      S2: { label: 'GS Modus', sublabel: 'B2B Buchungen', count: s2Leads.length, leads: sortByDate(s2Leads) },
      S3: { label: 'Marketplace', sublabel: 'In Planung', count: 0, leads: [] },
      S4: { label: 'GS Direkt', sublabel: 'Direktkontakt', count: 0, leads: [] },
    };

    const all = sortByDate([...s1Leads, ...s2Leads]);
    const byStatus = {};
    for (const l of all) byStatus[l.status] = (byStatus[l.status] || 0) + 1;

    return res.status(200).json({
      generated_at: new Date().toISOString(),
      totals: { all: all.length, by_status: byStatus },
      sources,
      leads: all,
    });
  } catch (err) {
    console.error('Dashboard Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function fetchRows(table, select) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}&order=id`, { headers: SB });
  if (!r.ok) {
    console.error(`dashboard fetch ${table}:`, r.status, await r.text());
    return [];
  }
  return r.json();
}

function sortByDate(arr) {
  return arr.slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

// Preferred technician is stored as "Wunsch-Techniker: <name> · ..." in notiz.
function extractPartner(notiz) {
  if (!notiz || typeof notiz !== 'string') return null;
  const m = notiz.match(/Wunsch-Techniker:\s*([^·]+)/i);
  return m ? m[1].trim() : null;
}
