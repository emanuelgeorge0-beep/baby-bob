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
    const { kunden, anfrage, action, anfrage_id } = req.body || {};

    const headers0 = {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    };

    // Lead-Sicherung: Erstgespräch nachträglich anfordern (vom Success-Screen).
    if (action === 'erstgespraech') {
      if (!anfrage_id) return res.status(400).json({ error: 'anfrage_id fehlt' });
      const getR = await fetch(`${SUPABASE_URL}/rest/v1/gs_anfragen?id=eq.${anfrage_id}&select=notiz`, { headers: headers0 });
      const cur = (await getR.json().catch(() => []))?.[0] || {};
      const note = '🔔 ERSTGESPRÄCH ANGEFORDERT (Rückruf <2h, werktags). ' + (cur.notiz || '');
      const upd = await fetch(`${SUPABASE_URL}/rest/v1/gs_anfragen?id=eq.${anfrage_id}`, {
        method: 'PATCH', headers: { ...headers0, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'Erstgespräch angefordert', notiz: note }),
      });
      if (!upd.ok) return res.status(500).json({ error: 'Update fehlgeschlagen' });
      return res.status(200).json({ success: true });
    }

    if (!kunden?.vorname || !kunden?.nachname) {
      return res.status(400).json({ error: 'Vorname und Nachname sind Pflichtfelder' });
    }
    if (!kunden?.strasse || !kunden?.plz || !kunden?.ort) {
      return res.status(400).json({ error: 'Adresse (Strasse, PLZ, Ort) ist ein Pflichtfeld' });
    }
    if (!kunden?.email) {
      return res.status(400).json({ error: 'E-Mail ist ein Pflichtfeld' });
    }

    const headers = {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    };

    // ── 1. Kunden speichern ──
    let kundeId = null;
    try {
      const fullName = `${kunden.vorname} ${kunden.nachname}`.trim();
      const kundenPayload = {
        firma: kunden.firma || fullName || 'Privatkunde',  // NOT NULL in DB
        kontaktperson: fullName,
        telefon: kunden.telefon || null,
        email: kunden.email,
        adresse: kunden.strasse || null,
        plz: kunden.plz || null,
        ort: kunden.ort || null,
      };

      const kundenRes = await fetch(
        `${SUPABASE_URL}/rest/v1/gs_kunden`,
        {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=representation' },
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
      notiz: (anfrage?.erstgespraech ? '🔔 ERSTGESPRÄCH ANGEFORDERT (Rückruf <2h, werktags). ' : '') + (anfrage?.notiz || ''),
      status: anfrage?.erstgespraech ? 'Erstgespräch angefordert' : 'neu',
    };

    const anfragenRes = await fetch(`${SUPABASE_URL}/rest/v1/gs_anfragen`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(anfragenPayload),
    });

    if (!anfragenRes.ok) {
      const errText = await anfragenRes.text();
      throw new Error(`gs_anfragen ${anfragenRes.status}: ${errText}`);
    }
    const anfrageRows = await anfragenRes.json().catch(() => []);
    const anfrageId = Array.isArray(anfrageRows) && anfrageRows[0] ? anfrageRows[0].id : null;

    return res.status(200).json({ success: true, kunde_id: kundeId, anfrage_id: anfrageId });

  } catch (err) {
    console.error('GS Submit Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
