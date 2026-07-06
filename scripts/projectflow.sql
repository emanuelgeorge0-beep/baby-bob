-- scripts/projectflow.sql — Feature projectflow (Fernwärmezentrale-Workflow)
-- NICHT automatisch ausführen. Im Supabase SQL-Editor als service_role laufen lassen.
-- Kontext: Der Workflow WIEDERVERWENDET bestehende Tabellen/Buckets. Neu ist nur der
-- Storage-Bucket 'plans' für Plan-Uploads. Die restlichen Bausteine existieren bereits:
--   • Projekte           → gs_projekte (+ gs_projekt_techniker für Zuweisung)   [vorhanden]
--   • Rapport+Unterschrift+PDF → gs_tagesrapporte (unterschrift_url, pdf_url)   [vorhanden]
--     Buckets rapport-signatures / rapport-pdfs / rapport-photos                [vorhanden]
--   • Materiallisten-Mail → gs_nachrichten (typ 'materialliste') + Resend/PDF   [vorhanden]

-- ── 1. Storage-Bucket 'plans' (privat; Zugriff nur serverseitig via service_role, signierte URLs) ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('plans', 'plans', false)
ON CONFLICT (id) DO NOTHING;

-- api/projectflow.js schreibt/liest ausschliesslich mit dem service_role-Key (umgeht RLS).
-- Falls du direkten Client-Zugriff möchtest, hier zusätzlich Policies definieren – für den
-- aktuellen Flow NICHT nötig (der Endpunkt prüft die Projektzugehörigkeit selbst).

-- ── 2. Optionale Rapport-Tabelle laut Spez. (id, project_id, technician, signature_url, pdf_url)
-- Der Live-Flow nutzt gs_tagesrapporte (voll ausgestattet, inkl. Wochen-/Status-Logik & Auto-PDF).
-- Diese schlanke Tabelle wird als Spez-Konformität/Backup mitgeliefert; sie ist im Code NICHT
-- Pflicht. Wer sie befüllen will, kann api/projectflow.js entsprechend erweitern.
CREATE TABLE IF NOT EXISTS rapporte (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id    UUID REFERENCES gs_projekte(id) ON DELETE CASCADE,
  technician    TEXT,
  signature_url TEXT,
  pdf_url       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rapporte_project ON rapporte(project_id);
ALTER TABLE rapporte ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_rapporte" ON rapporte;
CREATE POLICY "service_all_rapporte" ON rapporte FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3. Hinweis: gs_projekte.notiz wird vom Workflow für "Kunde: …" genutzt (best-effort).
-- Spalte anlegen, falls noch nicht vorhanden (der Endpunkt fällt sonst sauber zurück).
ALTER TABLE gs_projekte ADD COLUMN IF NOT EXISTS notiz TEXT;
