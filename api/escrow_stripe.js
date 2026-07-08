// api/escrow_stripe.js — Escrow-/Auszahlungs-Stub (KEINE echten Stripe-Calls)
// ─────────────────────────────────────────────────────────────────────────
// TODO Stripe Connect + delayed payout, CH-Variante, echte Anbindung spaeter.
//   Aktuell reine Stub-Logik: es fliesst KEIN Geld, es wird KEIN Key genutzt.
//   Die Funktionen setzen nur die Status-/Ledger-Felder auf gs_escrow + gs_steps
//   und hinterlegen Dummy-IDs ("STUB-..."), damit der Status-Automat und die
//   Cockpit-Anzeige den echten Escrow-Fluss schon vollstaendig abbilden.
//
//   DB-Zugriff wird injiziert (sb = { get, write } aus api/cockpit.js, service_role),
//   damit hier kein zweiter Supabase-Client / Key noetig ist. Signatur bleibt
//   bewusst stepId-zentriert (escrowHinterlegen(stepId), escrowFreigeben(stepId)).
// ─────────────────────────────────────────────────────────────────────────

// Kleine, gut erkennbare Dummy-Referenz. Kein Zufalls-/Krypto-Anspruch — nur
// damit man im UI/Ledger sieht "hier stuende spaeter die echte Stripe-ID".
function stubId(prefix) {
  return `STUB-${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// Escrow-Hinterlegung (Stub): "Geld ist im Escrow".
//   offen -> hinterlegt. Setzt stripe_payment_intent_id = STUB-...
//   Step-Status: aktiv -> hinterlegt.
export async function escrowHinterlegen(stepId, sb, opts = {}) {
  const rows = await sb.get(`gs_escrow?step_id=eq.${stepId}&select=*&limit=1`);
  const esc = rows && rows[0];
  if (!esc) throw new Error('Kein Escrow-Datensatz zu diesem Step');
  if (esc.escrow_status !== 'offen') throw new Error('Escrow nicht im Status offen');
  const pi = stubId('pi'); // stripe_payment_intent_id (Platzhalter)
  await sb.write('PATCH', `gs_escrow?id=eq.${esc.id}`, {
    escrow_status: 'hinterlegt',
    stripe_payment_intent_id: pi,
  }, 'return=minimal');
  await sb.write('PATCH', `gs_steps?id=eq.${stepId}`, { status: 'hinterlegt' }, 'return=minimal');
  return { ok: true, escrow_status: 'hinterlegt', stripe_payment_intent_id: pi };
}

// Escrow-Freigabe/Auszahlung (Stub): "Geld ist an GS ausgezahlt".
//   Verlangt Doppelbestaetigung (gs_bestaetigt_at UND kunde_bestaetigt_at gesetzt).
//   hinterlegt -> freigegeben. Setzt stripe_transfer_id = STUB-... + freigegeben_at.
//   Step-Status -> freigegeben.
export async function escrowFreigeben(stepId, sb, opts = {}) {
  const rows = await sb.get(`gs_escrow?step_id=eq.${stepId}&select=*&limit=1`);
  const esc = rows && rows[0];
  if (!esc) throw new Error('Kein Escrow-Datensatz zu diesem Step');
  if (esc.escrow_status !== 'hinterlegt') throw new Error('Escrow nicht hinterlegt');
  if (!esc.gs_bestaetigt_at || !esc.kunde_bestaetigt_at) {
    throw new Error('Doppelbestaetigung fehlt (GS + Kunde noetig)');
  }
  const tr = stubId('tr'); // stripe_transfer_id (Platzhalter fuer delayed payout)
  await sb.write('PATCH', `gs_escrow?id=eq.${esc.id}`, {
    escrow_status: 'freigegeben',
    stripe_transfer_id: tr,
    freigegeben_at: new Date().toISOString(),
  }, 'return=minimal');
  await sb.write('PATCH', `gs_steps?id=eq.${stepId}`, { status: 'freigegeben' }, 'return=minimal');
  return { ok: true, escrow_status: 'freigegeben', stripe_transfer_id: tr };
}
