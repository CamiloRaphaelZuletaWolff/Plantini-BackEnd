-- ============================================================
-- VoluntariadoUPB — Supabase PostgreSQL Schema
-- Run this in the Supabase SQL Editor for your project.
-- Idempotent: drops everything, then re-creates from scratch.
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
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

CREATE POLICY "Users can read own chat history"
  ON public.chat_histories FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own chat history"
  ON public.chat_histories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own chat history"
  ON public.chat_histories FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own chat history"
  ON public.chat_histories FOR DELETE
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
CREATE OR REPLACE FUNCTION public.prevent_role_self_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND public.get_my_role() <> 'admin' THEN
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
  ON public.users FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.users FOR INSERT WITH CHECK (auth.uid() = id);

-- Self-update: row-scoped here; the prevent_role_self_escalation trigger
-- handles the column-level protection on `role`.
CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can read all profiles"
  ON public.users FOR SELECT
  USING (public.get_my_role() IN ('admin', 'organizer'));

CREATE POLICY "Admins can update any profile"
  ON public.users FOR UPDATE
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- ============================================================
-- 6. STORAGE BUCKETS — created after get_my_role() so the cover policies
--    that reference it resolve cleanly.
-- ============================================================

-- 6a. ai-images — server-generated images from the Gemini endpoint.
INSERT INTO storage.buckets (id, name, public)
VALUES ('ai-images', 'ai-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read for ai-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ai-images');

-- 6b. profile-images — user avatars and profile backgrounds.
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-images', 'profile-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read for profile-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'profile-images');

-- Path layout: <userId>/<folder>/<filename>. The first segment is the auth
-- uid so users can only write to their own subtree.
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
  );

CREATE POLICY "Users can delete own profile images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 6c. oportunidad-covers — cover images for opportunity listings.
INSERT INTO storage.buckets (id, name, public)
VALUES ('oportunidad-covers', 'oportunidad-covers', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read for oportunidad-covers"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'oportunidad-covers');

CREATE POLICY "Organizers can upload oportunidad covers"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'oportunidad-covers'
    AND public.get_my_role() IN ('admin', 'organizer')
  );

CREATE POLICY "Organizers can update oportunidad covers"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'oportunidad-covers'
    AND public.get_my_role() IN ('admin', 'organizer')
  );

CREATE POLICY "Organizers can delete oportunidad covers"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'oportunidad-covers'
    AND public.get_my_role() IN ('admin', 'organizer')
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

CREATE POLICY "Organizers can create oportunidades"
  ON public.oportunidades FOR INSERT
  WITH CHECK (public.get_my_role() IN ('admin', 'organizer'));

CREATE POLICY "Organizers can update own oportunidades"
  ON public.oportunidades FOR UPDATE
  USING (
    created_by = auth.uid()
    OR public.get_my_role() = 'admin'
  );

-- Explicit DELETE policy — admins only. Without this, no client can delete.
CREATE POLICY "Admins can delete oportunidades"
  ON public.oportunidades FOR DELETE
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
  ON public.postulaciones FOR SELECT
  USING (estudiante_id = auth.uid());

CREATE POLICY "Students can create postulaciones"
  ON public.postulaciones FOR INSERT
  WITH CHECK (estudiante_id = auth.uid());

CREATE POLICY "Admins can read all postulaciones"
  ON public.postulaciones FOR SELECT
  USING (public.get_my_role() IN ('admin', 'organizer'));

CREATE POLICY "Admins can update postulaciones"
  ON public.postulaciones FOR UPDATE
  USING (public.get_my_role() IN ('admin', 'organizer'));

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
      AND cupos_disponibles > 0;

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
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
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
