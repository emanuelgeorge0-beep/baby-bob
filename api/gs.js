// api/gs.js – George Solutions Submission Handler (Server-Side)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('GS: Supabase env vars missing');
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    const { kunden, anfrage } = req.body || {};

    if (!kunden?.name) {
      return res.status(400).json({ error: 'Name ist ein Pflichtfeld' });
    }

    const headers = {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    };

    // ── 1. Kunden speichern / upsert on email ──
    let kundeId = null;
    try {
      const kundenPayload = {
        name: kunden.name,
        firma: kunden.firma || null,
        telefon: kunden.telefon || null,
        email: kunden.email || null,
      };

      const onConflict = kunden.email ? '?on_conflict=email' : '';
      const kundenRes = await fetch(
        `${SUPABASE_URL}/rest/v1/gs_kunden${onConflict}`,
        {
          method: 'POST',
          headers: {
            ...headers,
            Prefer: kunden.email
              ? 'return=representation,resolution=merge-duplicates'
              : 'return=representation',
          },
          body: JSON.stringify(kundenPayload),
        }
      );

      if (kundenRes.ok) {
        const rows = await kundenRes.json();
        kundeId = Array.isArray(rows) && rows[0] ? rows[0].id : null;
      } else {
        const errText = await kundenRes.text();
        console.error('gs_kunden insert error:', kundenRes.status, errText);
      }
    } catch (kundeErr) {
      console.error('gs_kunden exception:', kundeErr.message);
    }

    // ── 2. Anfrage speichern ──
    const anfragenPayload = {
      kunde_id: kundeId,
      projekt_name: anfrage?.projekt_name || null,
      bereich: anfrage?.bereich || null,
      objekttyp: anfrage?.objekttyp || null,
      beschreibung: anfrage?.beschreibung || null,
      dringlichkeit: anfrage?.dringlichkeit || 'Normal',
      tarif: anfrage?.tarif || null,
      tarif_preis: anfrage?.tarif_preis || null,
      geschaetzte_stunden: anfrage?.geschaetzte_stunden || null,
      umfang: anfrage?.umfang || null,
      gewuenschter_start: anfrage?.gewuenschter_start || null,
      notiz: anfrage?.notiz || null,
      status: 'neu',
    };

    const anfragenRes = await fetch(`${SUPABASE_URL}/rest/v1/gs_anfragen`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(anfragenPayload),
    });

    if (!anfragenRes.ok) {
      const errText = await anfragenRes.text();
      throw new Error(`gs_anfragen ${anfragenRes.status}: ${errText}`);
    }

    return res.status(200).json({ success: true, kunde_id: kundeId });

  } catch (err) {
    console.error('GS Submit Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
