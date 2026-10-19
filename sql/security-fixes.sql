-- ============================================================
-- VoluntariadoUPB — security-fixes.sql
--
-- NON-DESTRUCTIVE migration for a database that was created with an older
-- sql/schema.sql. It only replaces RLS policies, storage bucket settings,
-- three functions and one column grant; it never drops tables or data.
--
-- Run it once in Supabase -> SQL Editor (paste + Run). It is idempotent:
-- running it again leaves the same end state. Everything runs in a single
-- transaction, so either all fixes apply or none.
--
-- What it fixes (details in the comments of each block and in schema.sql):
--   1. postulaciones: students could insert an already 'accepted' /
--      confirmed application; organizers could read and update EVERY
--      application (emails, phones) and rewrite any column.
--   2. users: organizers could read every profile (email, phone, push
--      tokens); client INSERT could set role = 'admin' if the profile row
--      was missing; role trigger hardened against NULL roles.
--   3. oportunidades: organizers could create listings "as" another user
--      (created_by spoofing); demoted users kept edit rights.
--   4. storage: anyone (even anon) could LIST every file of every bucket;
--      any organizer could overwrite/delete other organizers' covers; no
--      size / MIME limits (SVG allowed).
--   5. chat_histories: clients could insert/update rows directly with the
--      anon key (only the backend should write them).
--   6. Applications to closed/finished oportunidades are rejected.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Functions (CREATE OR REPLACE keeps the triggers that use them)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_role_self_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() IS NOT NULL
     AND COALESCE(public.get_my_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'role_change_forbidden'
      USING HINT = 'Only admins can change a user role';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_postulacion_cupos()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.oportunidades
    SET
      cupos_disponibles = cupos_disponibles - 1,
      status = CASE
                 WHEN cupos_disponibles - 1 <= 0 THEN 'waitlist'
                 ELSE status
               END
    WHERE id = NEW.oportunidad_id
      AND cupos_disponibles > 0
      -- closed/finished listings no longer accept applications
      AND status IN ('open', 'waitlist');

    IF NOT FOUND THEN
      RAISE EXCEPTION 'no_cupos_disponibles'
        USING HINT = 'No hay cupos disponibles para esta oportunidad';
    END IF;

    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.oportunidades
    SET
      cupos_disponibles = cupos_disponibles + 1,
      status = CASE
                 WHEN status = 'waitlist' AND cupos_disponibles + 1 > 0 THEN 'open'
                 ELSE status
               END
    WHERE id = OLD.oportunidad_id;

    RETURN OLD;
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- chat_histories
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can read own chat history" ON public.chat_histories;
DROP POLICY IF EXISTS "Users can insert own chat history" ON public.chat_histories;
DROP POLICY IF EXISTS "Users can update own chat history" ON public.chat_histories;
DROP POLICY IF EXISTS "Users can delete own chat history" ON public.chat_histories;

-- Only the backend (service_role, bypasses RLS) writes chat histories; it
-- enforces ownership in code. Clients may read/delete their own rows but
-- may NOT insert/update them directly, otherwise a user could plant fake
-- "model" turns or pre-claim chat ids with the anon key.
CREATE POLICY "Users can read own chat history"
  ON public.chat_histories FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own chat history"
  ON public.chat_histories FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- users
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.users;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.users;

CREATE POLICY "Users can read own profile"
  ON public.users FOR SELECT TO authenticated USING (auth.uid() = id);

-- The handle_new_user trigger normally creates the row. If a client ever
-- inserts it, it can only be its own row and only as a student (the role
-- trigger only guards UPDATE, so INSERT must pin the role here).
CREATE POLICY "Users can insert own profile"
  ON public.users FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id AND role = 'student');

-- Self-update: row-scoped here; the prevent_role_self_escalation trigger
-- handles the column-level protection on `role`.
CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admins only: profiles hold email, phone and push tokens. Organizers get
-- applicant contact data only through their own oportunidades'
-- postulaciones (see section 8).
CREATE POLICY "Admins can read all profiles"
  ON public.users FOR SELECT TO authenticated
  USING (public.get_my_role() = 'admin');

CREATE POLICY "Admins can update any profile"
  ON public.users FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- ------------------------------------------------------------
-- storage (buckets + storage.objects policies)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Public read for ai-images" ON storage.objects;
DROP POLICY IF EXISTS "Public read for profile-images" ON storage.objects;
DROP POLICY IF EXISTS "Public read for oportunidad-covers" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own profile images" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own profile images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own profile images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own profile images" ON storage.objects;
DROP POLICY IF EXISTS "Organizers can read own oportunidad covers" ON storage.objects;
DROP POLICY IF EXISTS "Organizers can upload oportunidad covers" ON storage.objects;
DROP POLICY IF EXISTS "Organizers can update oportunidad covers" ON storage.objects;
DROP POLICY IF EXISTS "Organizers can delete oportunidad covers" ON storage.objects;

-- All three buckets are PUBLIC: objects are served by URL
-- (/storage/v1/object/public/...) without any SELECT policy. A SELECT policy
-- on storage.objects is only needed to LIST or download through the API, so
-- none is granted to anon (it would let anyone enumerate every file).
-- Each bucket also enforces a size cap and an image-only MIME allow-list
-- (no SVG, which can carry scripts).
--
-- Object names are flat keys and storage.foldername(name) splits them on
-- '/'. A key like '<uid>/../<victim>/x' is just a different literal key
-- (not a path traversal) and its first segment is still '<uid>'.

-- 6a. ai-images — server-generated images from the Gemini endpoint.
--     Written only by the backend (service_role). No client policies.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ai-images', 'ai-images', true, 10485760, ARRAY['image/png'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 6b. profile-images — user avatars and profile backgrounds.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('profile-images', 'profile-images', true, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path layout: <userId>/<folder>/<filename>. The first segment is the auth
-- uid so users can only touch their own subtree. SELECT on the own subtree
-- is required by `upload(..., { upsert: true })`.
CREATE POLICY "Users can read own profile images"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can upload own profile images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can update own profile images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'profile-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own profile images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 6c. oportunidad-covers — cover images for opportunity listings.
--     Same <userId>/covers/<file> layout: organizers manage only their own
--     uploads (before, any organizer could overwrite/delete any cover);
--     admins may also read/delete any cover (e.g. when editing others').
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('oportunidad-covers', 'oportunidad-covers', true, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Organizers can read own oportunidad covers"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'oportunidad-covers'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.get_my_role() = 'admin'
    )
  );

CREATE POLICY "Organizers can upload oportunidad covers"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'oportunidad-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.get_my_role() IN ('admin', 'organizer')
  );

CREATE POLICY "Organizers can update oportunidad covers"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'oportunidad-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.get_my_role() IN ('admin', 'organizer')
  )
  WITH CHECK (
    bucket_id = 'oportunidad-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.get_my_role() IN ('admin', 'organizer')
  );

CREATE POLICY "Organizers can delete oportunidad covers"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'oportunidad-covers'
    AND (
      (
        (storage.foldername(name))[1] = auth.uid()::text
        AND public.get_my_role() IN ('admin', 'organizer')
      )
      OR public.get_my_role() = 'admin'
    )
  );

-- ------------------------------------------------------------
-- oportunidades (SELECT policies are unchanged)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Organizers can create oportunidades" ON public.oportunidades;
DROP POLICY IF EXISTS "Organizers can update own oportunidades" ON public.oportunidades;
DROP POLICY IF EXISTS "Admins can delete oportunidades" ON public.oportunidades;

-- created_by must be the caller: no creating listings "as" someone else.
CREATE POLICY "Organizers can create oportunidades"
  ON public.oportunidades FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() IN ('admin', 'organizer')
    AND created_by = auth.uid()
  );

-- The owner must still be an organizer/admin (a demoted user loses edit
-- rights) and WITH CHECK stops an organizer from handing a listing over to
-- another user. Admins can edit any listing.
CREATE POLICY "Organizers can update own oportunidades"
  ON public.oportunidades FOR UPDATE TO authenticated
  USING (
    (created_by = auth.uid() AND public.get_my_role() IN ('admin', 'organizer'))
    OR public.get_my_role() = 'admin'
  )
  WITH CHECK (
    (created_by = auth.uid() AND public.get_my_role() IN ('admin', 'organizer'))
    OR public.get_my_role() = 'admin'
  );

-- Explicit DELETE policy — admins only. Without this, no client can delete.
CREATE POLICY "Admins can delete oportunidades"
  ON public.oportunidades FOR DELETE TO authenticated
  USING (public.get_my_role() = 'admin');

-- ------------------------------------------------------------
-- postulaciones
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Students can read own postulaciones" ON public.postulaciones;
DROP POLICY IF EXISTS "Students can create postulaciones" ON public.postulaciones;
DROP POLICY IF EXISTS "Admins can read all postulaciones" ON public.postulaciones;
DROP POLICY IF EXISTS "Admins can update postulaciones" ON public.postulaciones;

CREATE POLICY "Students can read own postulaciones"
  ON public.postulaciones FOR SELECT TO authenticated
  USING (estudiante_id = auth.uid());

-- A new application always starts as 'submitted' and not confirmed. Before,
-- a student could insert an already 'accepted' / confirmed postulación.
CREATE POLICY "Students can create postulaciones"
  ON public.postulaciones FOR INSERT TO authenticated
  WITH CHECK (
    estudiante_id = auth.uid()
    AND estado = 'submitted'
    AND confirmado = false
  );

-- Admins see/manage every application; organizers only the applications to
-- oportunidades they created (these rows include the applicant's email and
-- phone).
CREATE POLICY "Admins can read all postulaciones"
  ON public.postulaciones FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'organizer'
      AND EXISTS (
        SELECT 1 FROM public.oportunidades o
        WHERE o.id = postulaciones.oportunidad_id
          AND o.created_by = auth.uid()
      )
    )
  );

CREATE POLICY "Admins can update postulaciones"
  ON public.postulaciones FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'organizer'
      AND EXISTS (
        SELECT 1 FROM public.oportunidades o
        WHERE o.id = postulaciones.oportunidad_id
          AND o.created_by = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'organizer'
      AND EXISTS (
        SELECT 1 FROM public.oportunidades o
        WHERE o.id = postulaciones.oportunidad_id
          AND o.created_by = auth.uid()
      )
    )
  );

-- Column-level privilege: through the API, staff may only change the review
-- fields. Identity/contact columns (estudiante_id, oportunidad_id, email,
-- telefono, ...) are immutable for clients. service_role and SECURITY
-- DEFINER triggers are not affected.
REVOKE UPDATE ON public.postulaciones FROM anon, authenticated;
GRANT UPDATE (estado, confirmado) ON public.postulaciones TO authenticated;

COMMIT;
