-- ════════════════════════════════════════════════════════════════════════
-- George Solutions — Rapport-Positionen (mehrere Projekte/Baustellen pro Tag)
-- ════════════════════════════════════════════════════════════════════════
-- Realität: ein Techniker arbeitet am selben Tag 2h auf Projekt A, 4h auf B, 3h auf C.
-- Diese Tabelle hält pro Tagesrapport mehrere Positionen (FK auf gs_tagesrapporte).
--
-- Manuell im Supabase SQL Editor ausführen. Idempotent (IF NOT EXISTS).
-- RLS analog zu gs_tagesrapporte: Techniker sieht/bearbeitet nur eigene Positionen
-- (über den Besitz des übergeordneten Rapports), Service-Role (API) hat vollen Zugriff.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS gs_rapport_positionen (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rapport_id    uuid NOT NULL REFERENCES gs_tagesrapporte(id) ON DELETE CASCADE,
  projekt_id    uuid REFERENCES gs_projekte(id),
  projektnummer text,
  zeit_von      text,
  zeit_bis      text,
  stunden       numeric DEFAULT 0,
  arbeiten      text[]  DEFAULT '{}',
  material      text[]  DEFAULT '{}',
  notiz         text,
  sortierung    int     DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rapport_positionen_rapport ON gs_rapport_positionen(rapport_id);

ALTER TABLE gs_rapport_positionen ENABLE ROW LEVEL SECURITY;

-- Techniker: eigene Positionen lesen (Rapport gehört ihm)
DROP POLICY IF EXISTS rp_select_own ON gs_rapport_positionen;
CREATE POLICY rp_select_own ON gs_rapport_positionen FOR SELECT
  USING (EXISTS (SELECT 1 FROM gs_tagesrapporte r
                 WHERE r.id = gs_rapport_positionen.rapport_id
                   AND r.techniker_user_id = auth.uid()));

-- Techniker: eigene Positionen anlegen
DROP POLICY IF EXISTS rp_insert_own ON gs_rapport_positionen;
CREATE POLICY rp_insert_own ON gs_rapport_positionen FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM gs_tagesrapporte r
                      WHERE r.id = gs_rapport_positionen.rapport_id
                        AND r.techniker_user_id = auth.uid()));

-- Techniker: eigene Positionen ändern/löschen
DROP POLICY IF EXISTS rp_update_own ON gs_rapport_positionen;
CREATE POLICY rp_update_own ON gs_rapport_positionen FOR UPDATE
  USING (EXISTS (SELECT 1 FROM gs_tagesrapporte r
                 WHERE r.id = gs_rapport_positionen.rapport_id
                   AND r.techniker_user_id = auth.uid()));
DROP POLICY IF EXISTS rp_delete_own ON gs_rapport_positionen;
CREATE POLICY rp_delete_own ON gs_rapport_positionen FOR DELETE
  USING (EXISTS (SELECT 1 FROM gs_tagesrapporte r
                 WHERE r.id = gs_rapport_positionen.rapport_id
                   AND r.techniker_user_id = auth.uid()));

-- Kontrolle
SELECT 'gs_rapport_positionen ready' AS status;
