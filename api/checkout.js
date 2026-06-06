// api/checkout.js – Stripe Checkout (TEST MODE). Server-side prices.
// POST {product, email?} → {url}. Reports = one-time, Abos = subscription.
// Keys via env only (STRIPE_SECRET_KEY). Never hardcode. Test card 4242…

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_KEY;

// amount in Rappen (CHF cents).
const PRODUCTS = {
  report_klein:  { name: 'BOB Report – Klein',  amount: 4900,  type: 'one' }, // CHF 49
  report_mittel: { name: 'BOB Report – Mittel', amount: 9900,  type: 'one' }, // CHF 99
  report_gross:  { name: 'BOB Report – Gross',  amount: 14900, type: 'one' }, // CHF 149
  abo_basic:     { name: 'BOB Abo – Basic',     amount: 499,   type: 'sub' }, // CHF 4.99/Mt
  abo_plus:      { name: 'BOB Abo – Plus',      amount: 990,   type: 'sub' }, // CHF 9.90/Mt
  abo_pro:       { name: 'BOB Abo – Pro',       amount: 2900,  type: 'sub' }, // CHF 29/Mt
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { product, email } = req.body || {};
  const item = PRODUCTS[product];
  if (!item) return res.status(400).json({ error: 'Unbekanntes Produkt', products: Object.keys(PRODUCTS) });
  if (!STRIPE_SECRET) return res.status(503).json({ error: 'Zahlung noch nicht aktiviert (STRIPE_SECRET_KEY fehlt)', configured: false });

  const base = `https://${req.headers.host}`;
  const isSub = item.type === 'sub';
  const form = new URLSearchParams();
  form.set('mode', isSub ? 'subscription' : 'payment');
  form.set('success_url', `${base}/?bezahlt=ok&product=${encodeURIComponent(product)}&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${base}/?bezahlt=abbruch`);
  // TWINT only for one-time; subscriptions → card.
  form.append('payment_method_types[]', 'card');
  if (!isSub) form.append('payment_method_types[]', 'twint');
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', 'chf');
  form.set('line_items[0][price_data][unit_amount]', String(item.amount));
  form.set('line_items[0][price_data][product_data][name]', item.name);
  if (isSub) form.set('line_items[0][price_data][recurring][interval]', 'month');
  if (email) form.set('customer_email', email);
  form.set('metadata[product]', product);

  try {
    const post = (f) => fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRIPE_SECRET}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: f.toString(),
    });
    let r = await post(form);
    let session = await r.json();
    if (!r.ok && /twint/i.test(session.error?.message || '')) {
      const f2 = new URLSearchParams(form);
      f2.delete('payment_method_types[]'); f2.append('payment_method_types[]', 'card');
      r = await post(f2); session = await r.json();
    }
    if (!r.ok) return res.status(400).json({ error: session.error?.message || 'Stripe-Session fehlgeschlagen' });
    return res.status(200).json({ url: session.url, id: session.id, product, amount_chf: item.amount / 100 });
  } catch (err) {
    console.error('Checkout error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export { PRODUCTS };
