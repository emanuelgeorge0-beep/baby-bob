-- ═══════════════════════════════════════════════════════════════════════════
-- ENTITLEMENT-NACHTRAG · neuer Feature-Key 'zahlungssystem'
-- scripts/entitlement_zahlungssystem.sql | Stand 08.07.2026
--
-- Fuegt den Baustein "Zahlungssystem (Escrow)" zum Feature-Katalog hinzu, damit
-- er in der Master-Cockpit-Matrix je Partner freischaltbar ist. Master hat den
-- Key im Code IMMER (api/cockpit.js → requireZahlungssystem); Partner nur, wenn
-- hier bzw. per Matrix eine Freischaltung existiert.
--
-- Voraussetzung: scripts/entitlements.sql wurde bereits ausgefuehrt (Tabellen
-- gs_features + gs_partner_entitlements existieren). gs_partner_entitlements.
-- feature_key hat einen FK auf gs_features(key) — DESHALB muss der Key zuerst
-- im Katalog stehen, bevor ein Partner ihn zugewiesen bekommen kann.
--
-- Sicher & idempotent (mehrfach ausfuehrbar). KEINE Partner-Freischaltung wird
-- automatisch gesetzt — der Admin schaltet einzeln in der Matrix frei (Opt-in).
--
-- AUSFUEHREN: Supabase → SQL Editor → dieses Skript einfuegen → Run.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO gs_features (key, label) VALUES
  ('zahlungssystem', 'Zahlungssystem (Escrow)')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label;
