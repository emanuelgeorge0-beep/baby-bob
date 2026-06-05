// api/bob-learn.js – BOB daily learning job (Final item 3)
// Runs via Vercel Cron (03:00 Zurich ≈ 01:00 UTC). Reviews the last 24h of
// bob_scans + bob_unbekannt, asks Claude to extract reusable knowledge, and
// inserts confident entries into bob_knowledge. Uncertain ones are tagged
// 'zur_pruefung' for Emanuel. Also callable manually (GET/POST).

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // If a CRON_SECRET is configured, require it (Vercel Cron sends it as Bearer).
  if (CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [scans, unbekannt] = await Promise.all([
      sbJson(await fetch(`${SUPABASE_URL}/rest/v1/bob_scans?created_at=gte.${since}&select=bob_antwort,kategorie,user_feedback,user_korrektur&limit=200`, { headers: SB })),
      sbJson(await fetch(`${SUPABASE_URL}/rest/v1/bob_unbekannt?created_at=gte.${since}&select=bob_antwort,user_korrektur,kategorie_vorschlag&limit=200`, { headers: SB })),
    ]);
    const scanArr = Array.isArray(scans) ? scans : [];
    const unbArr = Array.isArray(unbekannt) ? unbekannt : [];

    if (!scanArr.length && !unbArr.length) {
      return res.status(200).json({ ok: true, reviewed: 0, learned: 0, flagged: 0, message: 'Keine neuen Daten in den letzten 24h.' });
    }
    if (!ANTHROPIC_KEY) {
      return res.status(200).json({ ok: true, reviewed: scanArr.length + unbArr.length, learned: 0, flagged: 0, message: 'ANTHROPIC_API_KEY fehlt – nur gezählt.' });
    }

    // Ask Claude to distill reusable knowledge-base entries.
    const proposals = await distill(scanArr, unbArr);
    let learned = 0, flagged = 0;
    const toInsert = [];
    for (const p of proposals) {
      if (!p || !p.titel || !p.inhalt) continue;
      const confident = p.confidence !== 'low';
      toInsert.push({
        kategorie: p.kategorie || 'Diagnose',
        unterkategorie: p.unterkategorie || 'Auto-Learning',
        titel: confident ? p.titel : `[PRÜFEN] ${p.titel}`,
        inhalt: p.inhalt,
        tags: Array.isArray(p.tags) ? (confident ? p.tags : [...p.tags, 'zur_pruefung']) : (confident ? [] : ['zur_pruefung']),
        quelle: 'BOB Auto-Learning',
      });
      confident ? learned++ : flagged++;
    }
    if (toInsert.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/bob_knowledge`, { method: 'POST', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(toInsert) });
    }
    const message = `Learned ${learned} new entries today${flagged ? `, ${flagged} flagged for review` : ''}.`;
    console.log('[bob-learn]', message);
    return res.status(200).json({ ok: true, reviewed: scanArr.length + unbArr.length, learned, flagged, message });
  } catch (err) {
    console.error('bob-learn error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function distill(scans, unbekannt) {
  const system = `Du bist BOBs Lern-Engine. Aus Nutzer-Feedback und unbekannten Anfragen destillierst du wiederverwendbare Wissensdatenbank-Einträge für Schweizer Handwerk.
Gib NUR JSON zurück: {"entries":[{"kategorie","unterkategorie","titel","inhalt","tags":[],"confidence":"high|medium|low"}]}.
- inhalt: 1–3 prägnante Sätze, faktisch, Schweiz-Kontext, CHF wo sinnvoll.
- Nur Einträge mit echtem, allgemein nützlichem Wissen. Bei Unsicherheit confidence:"low".
- Max 10 Einträge. Keine Duplikate trivialer Art.`;
  const user = `KORREKTUREN/FEEDBACK (bob_scans):\n${JSON.stringify(scans).slice(0, 6000)}\n\nUNBEKANNT (bob_unbekannt):\n${JSON.stringify(unbekannt).slice(0, 6000)}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error('Claude API: ' + r.status);
  const d = await r.json();
  const raw = d.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try { return JSON.parse(m[0]).entries || []; } catch { return []; }
}

async function sbJson(r) { try { return await r.json(); } catch { return null; } }
