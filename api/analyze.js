export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!apiKey) return res.status(500).json({ error: 'API Key fehlt' });

  const { messages, system, action, data } = req.body;

  if (action === 'save_request' && supabaseUrl && supabaseKey) {
    try {
      await fetch(`${supabaseUrl}/rest/v1/anfragen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
        body: JSON.stringify(data)
      });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(200).json({ success: false });
    }
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system, messages })
    });
    const responseData = await response.json();
    if (!response.ok) return res.status(response.status).json(responseData);

    if (supabaseUrl && supabaseKey) {
      try {
        const raw = responseData.content.filter(c => c.type === 'text').map(c => c.text).join('').trim();
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch(e) { const m = raw.match(/\{[\s\S]*\}/); if(m) try { parsed = JSON.parse(m[0]); } catch(e2) {} }
        if (parsed) {
          fetch(`${supabaseUrl}/rest/v1/scans`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
            body: JSON.stringify({ problem_titel: parsed.titel||'', problem_beschreibung: parsed.beschreibung||'', kategorie: parsed.kategorie||'', fachmann: parsed.fachmann||'', dringlichkeit: parsed.dringlichkeit||'', kosten: parsed.kosten||'', zeitraum: parsed.zeitraum||'' })
          }).catch(() => {});
        }
      } catch(e) {}
    }
    return res.status(200).json(responseData);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
