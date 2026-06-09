-- ============================================================================
-- NACHT-T3 / BLOCK 2 — Techniker-Account für DIMITRI GRILL (Team 1)
-- ============================================================================
-- IM SUPABASE SQL EDITOR EINMAL AUSFÜHREN (Projekt baby-bob).
--
-- Legt den Login-Account für Dimitri Grill an, damit er in der User-Verwaltung
-- erscheint (mit "Passwort neu" + "Deaktivieren") und sich einloggen kann —
-- analog zu Patrick Notter / Vasil Ignatov.
--
-- ALTERNATIVE (empfohlen, ohne SQL): Im Admin-Dashboard → "Benutzer anlegen"
--   Rolle: Techniker, Name: Dimitri Grill, E-Mail siehe unten. Danach NUR
--   den Abschnitt (3) unten ausführen, um den gs_techniker-Eintrag zu verknüpfen.
--
-- Idempotent: mehrfaches Ausführen ist gefahrlos (legt nichts doppelt an).
-- ----------------------------------------------------------------------------
-- ↓↓↓ Bei Bedarf E-Mail / Startpasswort anpassen ↓↓↓
--   E-Mail-Schema laut Auftrag: vorname.nachname@georgesolutions.ch
--   (Hinweis: Lead-Mails laufen über george-solutions.ch MIT Bindestrich –
--    falls die Techniker-Mails dieselbe Domain nutzen sollen, hier anpassen.)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_email    text := 'dimitri.grill@georgesolutions.ch';
  v_password text := 'StartGS2026!';   -- Dimitri muss es beim 1. Login ändern (must_change_password)
  v_name     text := 'Dimitri Grill';
  v_user_id  uuid;
BEGIN
  -- pgcrypto für crypt()/gen_salt() sicherstellen.
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  -- (1) Auth-User anlegen (falls noch nicht vorhanden).
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_email, crypt(v_password, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'name', v_name,
        'must_change_password', true,
        'profile_complete', false,
        'active', true
      ),
      false
    );

    -- Zugehörige E-Mail-Identity (für Passwort-Login nötig).
    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_user_id, v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      'email', now(), now(), now()
    );
  END IF;

  -- (2) Rolle = techniker (idempotenter Upsert).
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'techniker')
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

  -- (3) Mit bestehendem gs_techniker-Verzeichniseintrag verknüpfen
  --     (Name aus scripts/seed_techniker.mjs) → Techniker-Name wird im Login aufgelöst.
  UPDATE public.gs_techniker
     SET user_id = v_user_id
   WHERE name = v_name
     AND (user_id IS NULL OR user_id = v_user_id);

  RAISE NOTICE 'Dimitri-Account bereit: user_id=%, email=%', v_user_id, v_email;
END $$;

-- Kontrolle:
-- SELECT u.email, r.role, t.name, t.user_id
--   FROM auth.users u
--   JOIN public.user_roles r ON r.user_id = u.id
--   LEFT JOIN public.gs_techniker t ON t.user_id = u.id
--  WHERE u.email = 'dimitri.grill@georgesolutions.ch';
