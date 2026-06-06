// api/stripe-checkout.js – Stripe Checkout for the GS booking flow (Task 2)
// Uses the Stripe REST API directly (no SDK dependency). Test mode via
// STRIPE_SECRET_KEY (sk_test_…). Degrades gracefully to {configured:false}
// so the booking flow falls back to "auf Rechnung" until keys are set.

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_KEY;
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

  const { action } = req.body || {};

  if (action === 'status_check') {
    return res.status(200).json({ configured: !!STRIPE_SECRET });
  }

  if (!STRIPE_SECRET) {
    // Not configured yet → frontend uses the invoice path.
    return res.status(200).json({ configured: false, message: 'Online-Zahlung noch nicht aktiviert – Buchung läuft auf Rechnung.' });
  }

  try {
    if (action === 'create') return await createSession(req, res);
    if (action === 'verify') return await verify(req, res);
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Stripe Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function createSession(req, res) {
  const { amount_chf, beschreibung, email, anfrage_id, origin } = req.body || {};
  const amount = Math.round(Number(amount_chf) * 100);
  if (!(amount > 0)) return res.status(400).json({ error: 'amount_chf erforderlich' });
  const base = origin || `https://${req.headers.host}`;

  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', `${base}/?stripe=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${base}/?stripe=cancel`);
  // Kreditkarte + TWINT (CHF). "Banküberweisung" = the invoice option in the UI.
  form.append('payment_method_types[]', 'card');
  form.append('payment_method_types[]', 'twint');
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', 'chf');
  form.set('line_items[0][price_data][unit_amount]', String(amount));
  form.set('line_items[0][price_data][product_data][name]', (beschreibung || 'George Solutions – Einsatz').slice(0, 250));
  if (email) form.set('customer_email', email);
  if (anfrage_id) form.set('client_reference_id', String(anfrage_id));
  if (anfrage_id) form.set('metadata[anfrage_id]', String(anfrage_id));

  const post = (f) => fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_SECRET}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: f.toString(),
  });
  let r = await post(form);
  let session = await r.json();
  // If TWINT isn't enabled on the account, retry card-only.
  if (!r.ok && /twint/i.test(session.error?.message || '')) {
    const f2 = new URLSearchParams(form);
    f2.delete('payment_method_types[]');
    f2.append('payment_method_types[]', 'card');
    r = await post(f2);
    session = await r.json();
  }
  if (!r.ok) return res.status(400).json({ error: session.error?.message || 'Stripe-Session fehlgeschlagen' });

  // Mark the anfrage as awaiting payment (best-effort).
  if (anfrage_id && SUPABASE_URL) await updateAnfrage(anfrage_id, 'zahlung_ausstehend', session.id);
  return res.status(200).json({ configured: true, url: session.url, id: session.id });
}

async function verify(req, res) {
  const { session_id } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id erforderlich' });
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, { headers: { Authorization: `Bearer ${STRIPE_SECRET}` } });
  const s = await r.json();
  if (!r.ok) return res.status(400).json({ error: 'Session nicht gefunden' });
  const paid = s.payment_status === 'paid';
  const anfrageId = s.metadata?.anfrage_id || s.client_reference_id;
  if (paid && anfrageId && SUPABASE_URL) await updateAnfrage(anfrageId, 'bezahlt', session_id);
  return res.status(200).json({ paid, payment_status: s.payment_status, amount_total: s.amount_total });
}

async function updateAnfrage(id, zahlungsstatus, ref) {
  try {
    // Store payment status in notiz (no schema change needed); set status if paid.
    const body = { notiz: `[Zahlung: ${zahlungsstatus} · ${ref}]` };
    await fetch(`${SUPABASE_URL}/rest/v1/gs_anfragen?id=eq.${id}`, { method: 'PATCH', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
  } catch (e) { console.error('updateAnfrage', e.message); }
}
