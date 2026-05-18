-- ============================================================
-- VoluntariadoUPB — seed.sql
--
-- ⚠️  Do NOT use this file to create auth users.
--    Inserting directly into auth.users is unreliable — Supabase
--    GoTrue requires internal columns that plain SQL does not set.
--
-- ✅  Use the TypeScript seed script instead:
--       cd gemini-backend
--       npx ts-node seed.ts
--
-- This file is kept as a reference / manual override.
-- It assumes the three auth users already exist with the fixed UUIDs
-- created by seed.ts.
-- ============================================================

BEGIN;

-- ─── public.users profiles ──────────────────────────────────────────────────
INSERT INTO public.users (
  id, nombre, email, role, campus,
  telefono, intereses, bio, carrera, semestre,
  monthly_goal, notifications_enabled
) VALUES
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'Carlos Mendoza', 'admin@upb.edu.bo', 'admin', 'La Paz',
    '+59171234567',
    ARRAY['social','educativo','ambiental'],
    'Coordinador del programa de voluntariado UPB La Paz.',
    'Administración de Empresas', 8, 10, true
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000002',
    'Laura Sánchez', 'organizador@upb.edu.bo', 'organizer', 'Cochabamba',
    '+59172345678',
    ARRAY['salud','educativo'],
    'Organizadora de actividades comunitarias en la Facultad de Medicina.',
    'Medicina', 10, 5, true
  ),
  (
    'cccccccc-0000-0000-0000-000000000003',
    'Miguel Torres', 'estudiante@upb.edu.bo', 'student', 'La Paz',
    '+59173456789',
    ARRAY['ambiental','social','cultural'],
    'Estudiante de Ingeniería apasionado por el medioambiente.',
    'Ingeniería de Sistemas', 5, 3, true
  )
ON CONFLICT (id) DO UPDATE SET
  nombre               = EXCLUDED.nombre,
  role                 = EXCLUDED.role,
  campus               = EXCLUDED.campus,
  telefono             = EXCLUDED.telefono,
  intereses            = EXCLUDED.intereses,
  bio                  = EXCLUDED.bio,
  carrera              = EXCLUDED.carrera,
  semestre             = EXCLUDED.semestre,
  monthly_goal         = EXCLUDED.monthly_goal,
  notifications_enabled = EXCLUDED.notifications_enabled;

-- ─── oportunidades ───────────────────────────────────────────────────────────
INSERT INTO public.oportunidades (
  id, titulo, title_lower, descripcion,
  organizacion, organizacion_id,
  campus, ciudad, categoria, modalidad,
  horas_semana, deadline, cupos, cupos_disponibles,
  ubicacion, habilidades, status, created_by
) VALUES
  (
    '11111111-0000-0000-0000-000000000001',
    'Apoyo a Adultos Mayores en Hogares',
    'apoyo a adultos mayores en hogares',
    'Acompañamiento y actividades recreativas para adultos mayores en hogares de la ciudad de La Paz.',
    'Fundación Vivir Bien', 'org-001',
    'La Paz', 'La Paz', 'social', 'presencial',
    4, NOW() + INTERVAL '60 days', 10, 10,
    '{"lat":-16.5,"lng":-68.15,"direccion":"Av. Arce 2345, La Paz"}'::jsonb,
    ARRAY['empatía','comunicación','paciencia'],
    'open', 'bbbbbbbb-0000-0000-0000-000000000002'
  ),
  (
    '22222222-0000-0000-0000-000000000002',
    'Reforestación Parque Urbano Laikakota',
    'reforestación parque urbano laikakota',
    'Plantado de árboles nativos y educación ambiental en el Parque Laikakota.',
    'Municipio de La Paz - Medio Ambiente', 'org-002',
    'La Paz', 'La Paz', 'ambiental', 'hibrido',
    3, NOW() + INTERVAL '30 days', 20, 20,
    '{"lat":-16.51,"lng":-68.12,"direccion":"Parque Laikakota, La Paz"}'::jsonb,
    ARRAY['trabajo en equipo','educación ambiental','resistencia física'],
    'open', 'aaaaaaaa-0000-0000-0000-000000000001'
  ),
  (
    '33333333-0000-0000-0000-000000000003',
    'Tutoría Virtual para Estudiantes de Secundaria',
    'tutoría virtual para estudiantes de secundaria',
    'Apoyo académico en matemáticas y ciencias a estudiantes de colegios públicos de Cochabamba.',
    'ONG Educación para Todos', 'org-003',
    'Cochabamba', 'Cochabamba', 'educativo', 'remoto',
    5, NOW() + INTERVAL '45 days', 15, 15,
    NULL,
    ARRAY['matemáticas','comunicación','paciencia','docencia'],
    'open', 'bbbbbbbb-0000-0000-0000-000000000002'
  ),
  (
    '44444444-0000-0000-0000-000000000004',
    'Museo Interactivo UPB — Guías Voluntarios',
    'museo interactivo upb guías voluntarios',
    'Guía de visitantes en el Museo Interactivo de la UPB Cochabamba.',
    'UPB Cochabamba — Extensión Cultural', 'org-004',
    'Cochabamba', 'Cochabamba', 'cultural', 'presencial',
    6, NOW() + INTERVAL '90 days', 2, 2,
    '{"lat":-17.3935,"lng":-66.1568,"direccion":"Campus UPB Cochabamba"}'::jsonb,
    ARRAY['historia','oratoria','atención al público'],
    'open', 'aaaaaaaa-0000-0000-0000-000000000001'
  ),
  (
    '55555555-0000-0000-0000-000000000005',
    'Campaña de Salud Preventiva — Comunidades Rurales',
    'campaña de salud preventiva comunidades rurales',
    'Brigadas de salud para comunidades del altiplano con capacitación virtual y jornadas presenciales.',
    'Ministerio de Salud — Programa Voluntario', 'org-005',
    'La Paz', 'La Paz', 'salud', 'hibrido',
    8, NOW() + INTERVAL '75 days', 8, 8,
    '{"lat":-16.49,"lng":-68.13,"direccion":"Sede Central Ministerio de Salud, La Paz"}'::jsonb,
    ARRAY['primeros auxilios','trabajo en equipo','resistencia física','empatía'],
    'open', 'bbbbbbbb-0000-0000-0000-000000000002'
  )
ON CONFLICT (id) DO NOTHING;

-- ─── postulaciones ───────────────────────────────────────────────────────────
-- The trigger trg_postulaciones_cupos fires on INSERT and decrements
-- cupos_disponibles automatically. ON CONFLICT DO NOTHING = idempotent.
INSERT INTO public.postulaciones (
  id,
  estudiante_id, estudiante_nombre, estudiante_email, estudiante_avatar,
  oportunidad_id, oportunidad_titulo,
  motivacion, disponibilidad, telefono,
  estado, confirmado
) VALUES
  (
    'aaaabbbb-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000003',
    'Miguel Torres', 'estudiante@upb.edu.bo', NULL,
    '11111111-0000-0000-0000-000000000001',
    'Apoyo a Adultos Mayores en Hogares',
    'Tengo experiencia trabajando con adultos mayores en mi familia y me apasiona contribuir.',
    'fin_de_semana', '+59173456789',
    'submitted', false
  ),
  (
    'aaaabbbb-0000-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000003',
    'Miguel Torres', 'estudiante@upb.edu.bo', NULL,
    '22222222-0000-0000-0000-000000000002',
    'Reforestación Parque Urbano Laikakota',
    'Soy miembro del club de medioambiente de la UPB y hemos realizado campañas similares.',
    'flexible', '+59173456789',
    'under_review', false
  ),
  (
    'aaaabbbb-0000-0000-0000-000000000003',
    'cccccccc-0000-0000-0000-000000000003',
    'Miguel Torres', 'estudiante@upb.edu.bo', NULL,
    '33333333-0000-0000-0000-000000000003',
    'Tutoría Virtual para Estudiantes de Secundaria',
    'Fui monitor de matemáticas durante dos semestres y domino las materias requeridas.',
    'entre_semana', '+59173456789',
    'accepted', true
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;
