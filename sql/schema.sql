-- ============================================================
-- VoluntariadoUPB — Supabase PostgreSQL Schema
-- Run this in the Supabase SQL Editor for your project.
-- Idempotent: drops everything, then re-creates from scratch.
-- WARNING: DESTRUCTIVE, it deletes all data. To apply only the security
-- hardening to an existing database run sql/security-fixes.sql instead.
--
-- Definition order matters: `get_my_role()` is LANGUAGE SQL, which strict-
-- resolves references at CREATE time, so `public.users` must already exist
-- before that function is defined. The order below honors that and the
-- other inter-object dependencies.
-- ============================================================

-- ============================================================
-- 0. TEARDOWN — drop everything so this script is idempotent
-- ============================================================

-- Storage policies first — drop ALL storage.objects policies dynamically.
-- Must run BEFORE dropping tables because orphaned policy expressions that
-- reference public.users cause 42P01 errors on subsequent runs.
DO $$
DECLARE r record;
BEGIN
  FOR r IN (
    SELECT policyname
    FROM   pg_policies
    WHERE  schemaname = 'storage' AND tablename = 'objects'
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END;
$$;

-- Drop the trigger on auth.users separately — auth.users is owned by Supabase
-- and won't be dropped by CASCADE on our tables.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Tables — DROP ... CASCADE removes triggers, indexes, policies, and foreign
-- keys automatically. Do NOT use DROP TRIGGER ... ON table separately:
-- that statement throws 42P01 when the table does not exist yet, even with
-- IF EXISTS (the guard applies to the trigger, not to the table reference).
DROP TABLE IF EXISTS public.postulaciones  CASCADE;
DROP TABLE IF EXISTS public.oportunidades  CASCADE;
DROP TABLE IF EXISTS public.users          CASCADE;
DROP TABLE IF EXISTS public.chat_histories CASCADE;

-- Functions (drop after tables so CASCADE above doesn't complain)
DROP FUNCTION IF EXISTS public.set_updated_at()                CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user()               CASCADE;
DROP FUNCTION IF EXISTS public.handle_postulacion_cupos()      CASCADE;
DROP FUNCTION IF EXISTS public.get_my_role()                   CASCADE;
DROP FUNCTION IF EXISTS public.prevent_role_self_escalation()  CASCADE;

-- ============================================================
-- Enable required extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- pg_trgm enables GIN-indexed ILIKE '%substring%' search on title_lower.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- 1. UTILITY FUNCTION — set_updated_at()
--    No dependencies, defined first so it can be referenced by every trigger.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ============================================================
-- 2. CHAT HISTORIES
--    Independent of public.users (links straight to auth.users). Defined
--    before public.users because it has no role-based RLS.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_histories (
  chat_id    UUID        PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  messages   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_histories_user_id
  ON public.chat_histories (user_id);

CREATE TRIGGER trg_chat_histories_updated_at
  BEFORE UPDATE ON public.chat_histories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.chat_histories ENABLE ROW LEVEL SECURITY;

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

-- ============================================================
-- 3. USER PROFILES
--    Defined BEFORE get_my_role() because that SQL function selects from
--    this table and would otherwise fail with 42P01 at CREATE time.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id                        UUID        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  nombre                    TEXT        NOT NULL,
  email                     TEXT        NOT NULL,
  role                      TEXT        NOT NULL DEFAULT 'student',
  campus                    TEXT        NOT NULL DEFAULT '',
  telefono                  TEXT,
  intereses                 TEXT[]      NOT NULL DEFAULT '{}',
  -- `avatar` is the public Supabase Storage URL we render.
  -- `avatar_path` is the storage object path used for deletion on replace.
  avatar                    TEXT,
  avatar_path               TEXT,
  background_image          TEXT,
  background_image_path     TEXT,
  bio                       TEXT,
  carrera                   TEXT,
  semestre                  INTEGER,
  favoritos                 TEXT[]      NOT NULL DEFAULT '{}',
  push_tokens               TEXT[]      NOT NULL DEFAULT '{}',
  notifications_enabled     BOOLEAN     NOT NULL DEFAULT false,
  last_token_update         TIMESTAMPTZ,
  monthly_goal              INTEGER     NOT NULL DEFAULT 5 CHECK (monthly_goal >= 1 AND monthly_goal <= 100),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_users_role CHECK (role IN ('student', 'organizer', 'admin'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. ROLE HELPERS — defined after public.users so SQL resolution works.
-- ============================================================

-- get_my_role(): used in RLS policies to read the caller's role. SECURITY
-- DEFINER bypasses RLS on public.users to avoid 42P17 recursion (a policy
-- on users that queries users would otherwise re-evaluate itself).
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

-- prevent_role_self_escalation(): blocks any non-admin user from changing
-- their own role column. The RLS UPDATE policy on users restricts WHICH
-- rows you can update; this trigger restricts WHICH COLUMNS — RLS does not
-- have column-level WITH CHECK, so a trigger is the right tool here.
-- auth.uid() IS NULL means a trusted server-side caller (service_role from
-- the seed/backend, or the SQL editor): those may set roles. Any request
-- carrying a user JWT must come from an admin; COALESCE makes a missing
-- profile row count as "not admin" instead of slipping through as NULL.
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

CREATE TRIGGER trg_users_prevent_role_escalation
  BEFORE UPDATE OF role ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_self_escalation();

-- ============================================================
-- 5. USERS RLS POLICIES — depend on get_my_role()
-- ============================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

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

-- ============================================================
-- 6. STORAGE BUCKETS — created after get_my_role() so the cover policies
--    that reference it resolve cleanly.
-- ============================================================

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

-- ============================================================
-- 7. OPORTUNIDADES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.oportunidades (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  titulo            TEXT        NOT NULL,
  title_lower       TEXT        NOT NULL,
  descripcion       TEXT        NOT NULL,
  organizacion      TEXT        NOT NULL,
  organizacion_id   TEXT        NOT NULL DEFAULT '',
  cover             TEXT,
  cover_path        TEXT,
  campus            TEXT        NOT NULL,
  ciudad            TEXT        NOT NULL,
  categoria         TEXT        NOT NULL,
  modalidad         TEXT        NOT NULL,
  horas_semana      INTEGER     NOT NULL DEFAULT 0,
  deadline          TIMESTAMPTZ NOT NULL,
  cupos             INTEGER     NOT NULL DEFAULT 0,
  cupos_disponibles INTEGER     NOT NULL DEFAULT 0,
  ubicacion         JSONB,
  habilidades       TEXT[]      NOT NULL DEFAULT '{}',
  status            TEXT        NOT NULL DEFAULT 'open',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID        REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT chk_oportunidades_status    CHECK (status    IN ('open', 'waitlist', 'closed', 'finished')),
  CONSTRAINT chk_oportunidades_modalidad CHECK (modalidad IN ('presencial', 'remoto', 'hibrido')),
  CONSTRAINT chk_oportunidades_categoria CHECK (categoria IN ('social', 'ambiental', 'educativo', 'cultural', 'salud'))
);

CREATE INDEX IF NOT EXISTS idx_oportunidades_status     ON public.oportunidades (status);
CREATE INDEX IF NOT EXISTS idx_oportunidades_campus     ON public.oportunidades (campus);
CREATE INDEX IF NOT EXISTS idx_oportunidades_categoria  ON public.oportunidades (categoria);
CREATE INDEX IF NOT EXISTS idx_oportunidades_created_at ON public.oportunidades (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oportunidades_deadline   ON public.oportunidades (deadline);
-- Trigram GIN replaces a plain B-tree: scales ILIKE '%term%' from O(n) to ~O(log n).
CREATE INDEX IF NOT EXISTS idx_oportunidades_title_lower_trgm
  ON public.oportunidades USING gin (title_lower gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_oportunidades_habilidades
  ON public.oportunidades USING gin (habilidades);

CREATE TRIGGER trg_oportunidades_updated_at
  BEFORE UPDATE ON public.oportunidades
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.oportunidades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read oportunidades"
  ON public.oportunidades FOR SELECT TO authenticated USING (true);

CREATE POLICY "Anon users can read oportunidades"
  ON public.oportunidades FOR SELECT TO anon USING (status IN ('open', 'waitlist'));

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

-- ============================================================
-- 8. POSTULACIONES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.postulaciones (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  estudiante_id      UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  estudiante_nombre  TEXT        NOT NULL,
  estudiante_email   TEXT,
  estudiante_avatar  TEXT,
  oportunidad_id     UUID        NOT NULL REFERENCES public.oportunidades (id) ON DELETE CASCADE,
  oportunidad_titulo TEXT        NOT NULL,
  motivacion         TEXT        NOT NULL,
  disponibilidad     TEXT        NOT NULL,
  telefono           TEXT,
  estado             TEXT        NOT NULL DEFAULT 'submitted',
  confirmado         BOOLEAN     NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_postulacion_estudiante_oportunidad UNIQUE (estudiante_id, oportunidad_id),
  CONSTRAINT chk_postulaciones_estado         CHECK (estado         IN ('submitted', 'under_review', 'accepted', 'rejected', 'waitlisted')),
  CONSTRAINT chk_postulaciones_disponibilidad CHECK (disponibilidad IN ('fin_de_semana', 'entre_semana', 'flexible'))
);

CREATE INDEX IF NOT EXISTS idx_postulaciones_estudiante_id  ON public.postulaciones (estudiante_id);
CREATE INDEX IF NOT EXISTS idx_postulaciones_oportunidad_id ON public.postulaciones (oportunidad_id);
CREATE INDEX IF NOT EXISTS idx_postulaciones_estado         ON public.postulaciones (estado);

CREATE TRIGGER trg_postulaciones_updated_at
  BEFORE UPDATE ON public.postulaciones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.postulaciones ENABLE ROW LEVEL SECURITY;

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

-- ============================================================
-- 9. TRIGGER: manage cupos_disponibles atomically
--    SECURITY DEFINER is required because this trigger is fired by an
--    INSERT on postulaciones (which students can do) but it has to UPDATE
--    public.oportunidades (which RLS restricts to admins/organizers).
--    Without SECURITY DEFINER, RLS would silently filter the UPDATE to
--    zero rows for a student caller, the trigger would see NOT FOUND, and
--    raise `no_cupos_disponibles` even when cupos exist.
--    `SET search_path = public` is the standard hardening for SECURITY
--    DEFINER functions so the resolved identifiers can't be hijacked.
-- ============================================================
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

CREATE TRIGGER trg_postulaciones_cupos
  AFTER INSERT OR DELETE ON public.postulaciones
  FOR EACH ROW EXECUTE FUNCTION public.handle_postulacion_cupos();

-- ============================================================
-- 10. TRIGGER: auto-create user profile on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, nombre, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Usuario'),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 11. BACKFILL — create public.users rows for any auth.users that already
--      exist (e.g. seed users created before this schema was applied). The
--      AFTER INSERT trigger above only fires on NEW inserts, so it can't
--      catch pre-existing accounts on its own.
-- ============================================================
INSERT INTO public.users (id, nombre, email)
SELECT
  au.id,
  COALESCE(au.raw_user_meta_data->>'full_name',
           au.raw_user_meta_data->>'name',
           'Usuario'),
  au.email
FROM auth.users au
ON CONFLICT (id) DO NOTHING;
