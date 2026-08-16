-- ============================================================
-- George Solutions — Fusszeile der Dokumente um die E-Mail ergaenzen
-- scripts/branding_fusszeile_update.sql | MANUELL im Supabase SQL Editor.
-- Aendert genau EIN Feld einer bestehenden Zeile. Idempotent.
-- ============================================================
--
-- Getroffen wird die Standard-Zeile ueber partner_id IS NULL, nicht ueber eine
-- hart kodierte id: die id ist je Umgebung eine andere, partner_id IS NULL ist
-- die fachliche Kennung ("gilt fuer alle"). Der Teilindex
-- idx_gs_branding_standard sorgt dafuer, dass es davon nur eine aktive gibt —
-- dieses UPDATE kann also nie mehr als eine Zeile treffen.

update gs_branding
   set fusszeile  = 'George Solutions · Sanitaer, Heizung, Klima · Zuerich · george-solutions.ch · info@george-solutions.ch',
       updated_at = now()
 where partner_id is null
   and aktiv;

-- Kontrolle nach dem Lauf:
--   select firmenname, fusszeile, updated_at from gs_branding where partner_id is null;
