-- Add a per-project notiz field (Projektdatenblatt). Idempotent. Nothing deleted.
ALTER TABLE gs_projekte ADD COLUMN IF NOT EXISTS notiz TEXT;
