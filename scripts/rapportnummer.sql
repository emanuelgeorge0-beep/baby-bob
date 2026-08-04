-- ═══════════════════════════════════════════════════════════════════════════
-- RAPPORTNUMMER PRO KUNDE (Rapport Feinschliff II, ZIEL 3)
--   + pg_trgm-Vorbereitung für den Katalog-Duplikatschutz (ZIEL 8a–d)
--   + Entscheidungsprotokoll gs_katalog_entscheidung (ZIEL 8e)
-- ═══════════════════════════════════════════════════════════════════════════
-- Format: R-{KUNDENKUERZEL}-{JAHR}-{4-stellig}   →   z.B. R-NIE-2026-0007
-- Zähler PRO KUNDE UND JAHR, nicht global. Eine Nummer wird NIE wiederverwendet,
-- auch nicht, nachdem der Wochenrapport gelöscht wurde (ZIEL 2) — deshalb steht
-- der Zähler in einer EIGENEN Tabelle (gs_rapport_nummernkreis) und nicht als
-- MAX()-Abfrage auf gs_wochenrapporte. Löschen eines Rapports lässt den Zähler
-- unangetastet, die Lücke bleibt bewusst bestehen.
--
-- Zählerschlüssel ist das KÜRZEL, nicht die kunde_id: das Kürzel ist genau das,
-- was in der Nummer sichtbar wird. Wird ein Kunde später gelöscht oder mit einem
-- anderen zusammengelegt, bleibt der Nummernkreis trotzdem korrekt fortlaufend
-- und kollisionsfrei. Dass zwei Kunden dasselbe Kürzel tragen, verhindert der
-- UNIQUE-Index auf gs_kunden.kuerzel weiter unten.
--
-- NAMENSPRÜFUNG (Eiserne Regel 7) — vor dem Schreiben dieser Datei geprüft:
--   gs_rapport_nummernkreis  → kommt in KEINER .js/.html/.sql/.mjs des Repos vor
--   gs_katalog_entscheidung  → kommt in KEINER .js/.html/.sql/.mjs des Repos vor
--   gs_kunden.kuerzel        → Spaltenname kommt nirgends im Repo vor
--   gs_rapport_nr_next()     → Funktionsname kommt nirgends im Repo vor
-- Es wird KEINE bestehende Tabelle angefasst ausser additiv per ADD COLUMN.
-- KEIN DROP TABLE, KEIN DROP COLUMN, kein Datenverlust möglich.
--
-- Re-run-fest: alles IF NOT EXISTS / CREATE OR REPLACE / DO-Block gegen
-- pg_constraint. Mehrfaches Ausführen ändert nichts.
-- Run ONCE im Supabase SQL-Editor (DDL geht nicht über die PostgREST-Data-API).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Vorprüfung — bricht sauber ab, BEVOR irgendeine DDL läuft ────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='gs_kunden'
  ) THEN
    RAISE EXCEPTION 'ABBRUCH: Tabelle gs_kunden existiert nicht — Skript gestoppt, nichts angelegt.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='gs_wochenrapporte'
  ) THEN
    RAISE EXCEPTION 'ABBRUCH: Tabelle gs_wochenrapporte existiert nicht — scripts/wochenrapport_migration.sql zuerst laufen lassen.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='gs_wochenrapporte' AND column_name='rapport_nr'
  ) THEN
    RAISE EXCEPTION 'ABBRUCH: gs_wochenrapporte.rapport_nr fehlt — scripts/wochenrapport_migration.sql zuerst laufen lassen.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='gs_kunden'
      AND column_name='id' AND data_type='uuid'
  ) THEN
    RAISE EXCEPTION 'ABBRUCH: gs_kunden.id ist kein uuid — Fremdschlüssel würde fehlschlagen. Skript gestoppt.';
  END IF;
END $$;

-- ── 1. Kundenkürzel (3 Zeichen, Master pflegt es) ──────────────────────────
-- NULL erlaubt: Bestandskunden haben noch keines. Der Server fällt dann auf das
-- Haus-Kürzel 'GSO' zurück (siehe api/cockpit.js), damit ein Rapport nie ohne
-- Nummer bleibt, nur weil das Kürzel noch nicht gepflegt ist.
ALTER TABLE gs_kunden ADD COLUMN IF NOT EXISTS kuerzel TEXT;

-- Genau 3 Zeichen, nur Grossbuchstaben/Ziffern. NULL bleibt erlaubt.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gs_kunden_kuerzel_chk') THEN
    ALTER TABLE gs_kunden DROP CONSTRAINT gs_kunden_kuerzel_chk;
  END IF;
  ALTER TABLE gs_kunden
    ADD CONSTRAINT gs_kunden_kuerzel_chk
    CHECK (kuerzel IS NULL OR kuerzel ~ '^[A-Z0-9]{3}$');
END $$;

-- Zwei Kunden dürfen nie dasselbe Kürzel tragen (sonst laufen ihre Nummernkreise
-- ineinander). Partiell, damit beliebig viele Kunden ohne Kürzel erlaubt bleiben.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gs_kunden_kuerzel_uniq
  ON gs_kunden (kuerzel) WHERE kuerzel IS NOT NULL;

-- ── 2. Wochenrapport: Kunde + laufende Nummer festhalten ───────────────────
-- kunde_id ist der Kunde, zu dem die Nummer gezogen wurde (aus dem Hauptprojekt
-- der Woche). Er wird beim Anlegen EINMAL gesetzt und danach nicht mehr geändert
-- — sonst würde die bereits vergebene Nummer nachträglich unstimmig.
-- rapport_seq ist der reine Zählerstand (7 in R-NIE-2026-0007), für Sortierung
-- und Nachvollziehbarkeit; rapport_nr bleibt der angezeigte Text.
ALTER TABLE gs_wochenrapporte
  ADD COLUMN IF NOT EXISTS kunde_id    UUID REFERENCES gs_kunden(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rapport_seq INT;

CREATE INDEX IF NOT EXISTS idx_gs_wochenrapporte_kunde ON gs_wochenrapporte(kunde_id);

-- Keine zwei Rapporte mit derselben Nummer. Partiell auf das NEUE Format (R-…),
-- damit bestehende Zeilen im Altformat (WR-2026-29-Emanuel) den Index nicht
-- blockieren — die bleiben unangetastet gültig.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gs_wochenrapporte_rapport_nr_uniq
  ON gs_wochenrapporte (rapport_nr) WHERE rapport_nr LIKE 'R-%';

-- ── 3. Nummernkreis — der eigentliche Zähler ───────────────────────────────
-- Eine Zeile je (Kürzel, Jahr). letzte_nr ist die zuletzt VERGEBENE Nummer.
-- Bewusst KEIN Fremdschlüssel auf gs_kunden: der Zähler muss ein Löschen oder
-- Zusammenlegen von Kunden überleben, sonst könnte eine Nummer erneut vergeben
-- werden. Genau das soll nie passieren.
CREATE TABLE IF NOT EXISTS gs_rapport_nummernkreis (
  kuerzel         TEXT NOT NULL,
  jahr            INT  NOT NULL,
  letzte_nr       INT  NOT NULL DEFAULT 0,
  aktualisiert_am TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (kuerzel, jahr)
);

ALTER TABLE gs_rapport_nummernkreis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON gs_rapport_nummernkreis;
CREATE POLICY service_all ON gs_rapport_nummernkreis FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS admin_all ON gs_rapport_nummernkreis;
CREATE POLICY admin_all ON gs_rapport_nummernkreis FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('gs_admin','master'))
);
-- Bewusst KEINE Techniker-Policy: der Zähler wird ausschliesslich serverseitig
-- (service_role) gezogen, nie vom Client.

-- ── 4. Nummer ziehen — atomar, race-fest ───────────────────────────────────
-- INSERT … ON CONFLICT DO UPDATE nimmt eine Zeilensperre auf (kuerzel, jahr).
-- Zwei parallel gespeicherte Wochen desselben Kunden bekommen dadurch garantiert
-- verschiedene Nummern — im Gegensatz zu SELECT MAX()+1, das genau hier reisst.
-- Aufruf vom Server per PostgREST-RPC:
--   POST /rest/v1/rpc/gs_rapport_nr_next  {"p_kuerzel":"NIE","p_jahr":2026}
CREATE OR REPLACE FUNCTION gs_rapport_nr_next(p_kuerzel TEXT, p_jahr INT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kuerzel TEXT := upper(coalesce(nullif(trim(p_kuerzel), ''), 'GSO'));
  v_nr      INT;
BEGIN
  IF p_jahr IS NULL OR p_jahr < 2000 OR p_jahr > 2999 THEN
    RAISE EXCEPTION 'gs_rapport_nr_next: ungültiges Jahr %', p_jahr;
  END IF;

  INSERT INTO gs_rapport_nummernkreis (kuerzel, jahr, letzte_nr, aktualisiert_am)
  VALUES (v_kuerzel, p_jahr, 1, NOW())
  ON CONFLICT (kuerzel, jahr)
  DO UPDATE SET letzte_nr       = gs_rapport_nummernkreis.letzte_nr + 1,
                aktualisiert_am = NOW()
  RETURNING letzte_nr INTO v_nr;

  RETURN v_nr;
END $$;

REVOKE ALL ON FUNCTION gs_rapport_nr_next(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gs_rapport_nr_next(TEXT, INT) TO service_role;

-- ── 5. ZIEL 8 — pg_trgm für den Katalog-Duplikatschutz (OPTIONAL) ──────────
-- Die Ähnlichkeitsprüfung beim Anlegen einer Tätigkeit läuft primär in JS
-- (Normalisierung + Levenshtein über die ~71 Katalogzeilen — bei der Grösse
-- schneller als ein Roundtrip). pg_trgm ist NICHT erforderlich; der Block hier
-- macht die DB-seitige Variante möglich, falls der Katalog später auf mehrere
-- Tausend Zeilen wächst. Fehlt die Extension, funktioniert ZIEL 8 vollständig.
-- CREATE EXTENSION braucht Superuser — in Supabase über den SQL-Editor ok.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='gs_taetigkeitenkatalog'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_gs_taetigkeitenkatalog_bez_trgm
      ON gs_taetigkeitenkatalog USING GIN (bezeichnung gin_trgm_ops);
  ELSE
    RAISE NOTICE 'gs_taetigkeitenkatalog fehlt — trgm-Index übersprungen (kein Fehler).';
  END IF;
END $$;

-- ── 6. ZIEL 8e — Entscheidungsprotokoll der Katalog-Anlage ─────────────────
-- Jeder Durchlauf des Anlegen-Dialogs schreibt genau EINE Zeile — auch der
-- Abbruch. Wer den Dialog wegklickt, hat etwas gesucht und nicht gefunden; das
-- ist ein Signal über die Qualität der Vorschläge, kein Nicht-Ereignis.
--
-- neue_taetigkeit_id ist NULL, ausser bei 'neu_angelegt' (bei 'abgebrochen'
-- entsteht nichts, bei 'bestehende_gewaehlt'/'reaktiviert' steht das Ergebnis in
-- gewaehlte_taetigkeit_id). Beide FKs mit ON DELETE SET NULL, damit das Protokoll
-- eine spätere Katalogbereinigung überlebt — es soll ja gerade zeigen, was mit
-- den Einträgen von damals passiert ist.
--
-- vorgeschlagene_aehnliche: Array der ANGEZEIGTEN Vorschläge mit Messwert, z.B.
--   [{"slug":"waschtisch_montiert","gewerk":"sanitaer","kategorie":"Fertigmontage",
--     "score":0.86,"aktiv":true}]
-- Bewusst als Snapshot in JSONB und nicht als Verweis: die Auswertung will wissen,
-- was in DEM Moment vorgeschlagen wurde, nicht was heute im Katalog steht.
--
-- NAMENSPRÜFUNG (Eiserne Regel 7): gs_katalog_entscheidung kommt in KEINER
-- .js/.html/.sql/.mjs des Repos vor — grep bestätigt, keine Kollision.
CREATE TABLE IF NOT EXISTS gs_katalog_entscheidung (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  neue_taetigkeit_id        UUID REFERENCES gs_taetigkeitenkatalog(id) ON DELETE SET NULL,
  vorgeschlagene_aehnliche  JSONB NOT NULL DEFAULT '[]'::jsonb,
  entscheidung              TEXT NOT NULL
                            CHECK (entscheidung IN ('neu_angelegt','bestehende_gewaehlt','reaktiviert','abgebrochen')),
  gewaehlte_taetigkeit_id   UUID REFERENCES gs_taetigkeitenkatalog(id) ON DELETE SET NULL,
  eingabe_bezeichnung       TEXT,   -- was getippt wurde (auch bei 'abgebrochen' auswertbar)
  eingabe_gewerk            TEXT,
  entschieden_von           UUID NOT NULL REFERENCES auth.users(id),
  entschieden_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gs_katalog_entscheidung_at   ON gs_katalog_entscheidung(entschieden_at DESC);
CREATE INDEX IF NOT EXISTS idx_gs_katalog_entscheidung_ent  ON gs_katalog_entscheidung(entscheidung);
CREATE INDEX IF NOT EXISTS idx_gs_katalog_entscheidung_neu  ON gs_katalog_entscheidung(neue_taetigkeit_id);

ALTER TABLE gs_katalog_entscheidung ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON gs_katalog_entscheidung;
CREATE POLICY service_all ON gs_katalog_entscheidung FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS admin_all ON gs_katalog_entscheidung;
CREATE POLICY admin_all ON gs_katalog_entscheidung FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('gs_admin','master'))
);
-- Bewusst KEINE Techniker-Policy: Katalogpflege ist Master-only.

-- Auswertung (die drei Fragen aus der Anforderung):
--   -- Vorschläge ignoriert trotz Treffer?  → Mass zu grosszügig/zu streng
--   SELECT entscheidung, count(*) FROM gs_katalog_entscheidung
--    WHERE jsonb_array_length(vorgeschlagene_aehnliche) > 0 GROUP BY 1;
--   -- Doppelt angelegt trotz Warnung — mit welchem Score?
--   SELECT eingabe_bezeichnung, v->>'slug' AS vorschlag, (v->>'score')::numeric
--     FROM gs_katalog_entscheidung, jsonb_array_elements(vorgeschlagene_aehnliche) v
--    WHERE entscheidung = 'neu_angelegt' ORDER BY 3 DESC;
--   -- Was wurde gesucht und nicht gefunden?
--   SELECT eingabe_gewerk, eingabe_bezeichnung, entschieden_at
--     FROM gs_katalog_entscheidung WHERE entscheidung = 'abgebrochen' ORDER BY 3 DESC;

-- ── 7. OPTIONAL: Altbestand auf das neue Format umstellen ──────────────────
-- Standardmässig AUSKOMMENTIERT. Bestehende Rapporte behalten ihr Altformat
-- (WR-2026-29-Emanuel) — das ist gültig und stört nichts. Erst ausführen, wenn
-- die Testrapporte per ZIEL 2 gelöscht sind und du wirklich alles vereinheitlichen
-- willst. Vergibt in KW-Reihenfolge je Kunde/Jahr neue Nummern und zieht den
-- Nummernkreis entsprechend hoch.
--
-- WITH ziel AS (
--   SELECT w.id,
--          upper(coalesce(k.kuerzel, 'GSO')) AS kuerzel,
--          w.jahr,
--          row_number() OVER (PARTITION BY upper(coalesce(k.kuerzel,'GSO')), w.jahr
--                             ORDER BY w.woche, w.created_at) AS seq
--     FROM gs_wochenrapporte w
--     LEFT JOIN gs_projekte p ON p.id = w.hauptprojekt_id
--     LEFT JOIN gs_kunden   k ON k.id = p.kunde_id
--    WHERE w.rapport_nr IS NULL OR w.rapport_nr NOT LIKE 'R-%'
-- ), upd AS (
--   UPDATE gs_wochenrapporte w
--      SET rapport_nr  = 'R-' || z.kuerzel || '-' || z.jahr || '-' || lpad(z.seq::text, 4, '0'),
--          rapport_seq = z.seq
--     FROM ziel z WHERE z.id = w.id
--   RETURNING z.kuerzel, z.jahr, z.seq
-- )
-- INSERT INTO gs_rapport_nummernkreis (kuerzel, jahr, letzte_nr, aktualisiert_am)
-- SELECT kuerzel, jahr, max(seq), NOW() FROM upd GROUP BY kuerzel, jahr
-- ON CONFLICT (kuerzel, jahr)
-- DO UPDATE SET letzte_nr = greatest(gs_rapport_nummernkreis.letzte_nr, EXCLUDED.letzte_nr),
--               aktualisiert_am = NOW();

-- ── 8. Kontrolle nach dem Lauf ─────────────────────────────────────────────
-- SELECT id, firma, kuerzel FROM gs_kunden ORDER BY firma;
-- SELECT * FROM gs_rapport_nummernkreis ORDER BY kuerzel, jahr;
-- SELECT gs_rapport_nr_next('TST', 2026);   -- Testzug: liefert 1, dann 2, …
-- DELETE FROM gs_rapport_nummernkreis WHERE kuerzel = 'TST';  -- Testzug aufräumen

SELECT 'rapportnummer ready' AS status;
