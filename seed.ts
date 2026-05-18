/**
 * VoluntariadoUPB — Database Seed Script
 *
 * Usage (from gemini-backend/ folder):
 *   npx ts-node seed.ts
 *
 * Requirements:
 *   - gemini-backend/.env must contain SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *
 * This script is idempotent — safe to run multiple times.
 * Auth users are created via the Admin API (the only correct way to seed
 * Supabase auth users; direct auth.users SQL inserts are unreliable because
 * GoTrue requires extra internal columns that the JS client sets automatically).
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// Service-role client — bypasses RLS and exposes auth.admin.*
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Seed definitions ─────────────────────────────────────────────────────────

const USERS = [
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    email: 'admin@upb.edu.bo',
    password: 'Password123!',
    nombre: 'Carlos Mendoza',
    role: 'admin',
    campus: 'La Paz',
    telefono: '+59171234567',
    intereses: ['social', 'educativo', 'ambiental'],
    bio: 'Coordinador del programa de voluntariado UPB La Paz.',
    carrera: 'Administración de Empresas',
    semestre: 8,
    monthly_goal: 10,
  },
  {
    id: 'bbbbbbbb-0000-0000-0000-000000000002',
    email: 'organizador@upb.edu.bo',
    password: 'Password123!',
    nombre: 'Laura Sánchez',
    role: 'organizer',
    campus: 'Cochabamba',
    telefono: '+59172345678',
    intereses: ['salud', 'educativo'],
    bio: 'Organizadora de actividades comunitarias en la Facultad de Medicina.',
    carrera: 'Medicina',
    semestre: 10,
    monthly_goal: 5,
  },
  {
    id: 'cccccccc-0000-0000-0000-000000000003',
    email: 'estudiante@upb.edu.bo',
    password: 'Password123!',
    nombre: 'Miguel Torres',
    role: 'student',
    campus: 'La Paz',
    telefono: '+59173456789',
    intereses: ['ambiental', 'social', 'cultural'],
    bio: 'Estudiante de Ingeniería apasionado por el medioambiente.',
    carrera: 'Ingeniería de Sistemas',
    semestre: 5,
    monthly_goal: 3,
  },
];

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

const OPORTUNIDADES = [
  {
    id: '11111111-0000-0000-0000-000000000001',
    titulo: 'Apoyo a Adultos Mayores en Hogares',
    title_lower: 'apoyo a adultos mayores en hogares',
    descripcion:
      'Acompañamiento y actividades recreativas para adultos mayores en hogares de la ciudad de La Paz. Se trabajará con grupos reducidos los fines de semana.',
    organizacion: 'Fundación Vivir Bien',
    organizacion_id: 'org-001',
    campus: 'La Paz',
    ciudad: 'La Paz',
    categoria: 'social',
    modalidad: 'presencial',
    horas_semana: 4,
    deadline: daysFromNow(60),
    cupos: 10,
    cupos_disponibles: 10,
    ubicacion: { lat: -16.5, lng: -68.15, direccion: 'Av. Arce 2345, La Paz' },
    habilidades: ['empatía', 'comunicación', 'paciencia'],
    status: 'open',
    created_by: 'bbbbbbbb-0000-0000-0000-000000000002',
  },
  {
    id: '22222222-0000-0000-0000-000000000002',
    titulo: 'Reforestación Parque Urbano Laikakota',
    title_lower: 'reforestación parque urbano laikakota',
    descripcion:
      'Plantado de árboles nativos y educación ambiental en el Parque Laikakota. Incluye sesiones virtuales de capacitación previas a la jornada presencial.',
    organizacion: 'Municipio de La Paz - Medio Ambiente',
    organizacion_id: 'org-002',
    campus: 'La Paz',
    ciudad: 'La Paz',
    categoria: 'ambiental',
    modalidad: 'hibrido',
    horas_semana: 3,
    deadline: daysFromNow(30),
    cupos: 20,
    cupos_disponibles: 20,
    ubicacion: { lat: -16.51, lng: -68.12, direccion: 'Parque Laikakota, La Paz' },
    habilidades: ['trabajo en equipo', 'educación ambiental', 'resistencia física'],
    status: 'open',
    created_by: 'aaaaaaaa-0000-0000-0000-000000000001',
  },
  {
    id: '33333333-0000-0000-0000-000000000003',
    titulo: 'Tutoría Virtual para Estudiantes de Secundaria',
    title_lower: 'tutoría virtual para estudiantes de secundaria',
    descripcion:
      'Apoyo académico en matemáticas y ciencias a estudiantes de colegios públicos de Cochabamba a través de videollamadas semanales.',
    organizacion: 'ONG Educación para Todos',
    organizacion_id: 'org-003',
    campus: 'Cochabamba',
    ciudad: 'Cochabamba',
    categoria: 'educativo',
    modalidad: 'remoto',
    horas_semana: 5,
    deadline: daysFromNow(45),
    cupos: 15,
    cupos_disponibles: 15,
    ubicacion: null,
    habilidades: ['matemáticas', 'comunicación', 'paciencia', 'docencia'],
    status: 'open',
    created_by: 'bbbbbbbb-0000-0000-0000-000000000002',
  },
  {
    id: '44444444-0000-0000-0000-000000000004',
    titulo: 'Museo Interactivo UPB — Guías Voluntarios',
    title_lower: 'museo interactivo upb guías voluntarios',
    descripcion:
      'Guía de visitantes en el Museo Interactivo de la UPB Cochabamba. Se requiere disponibilidad entre semana en horario de mañana.',
    organizacion: 'UPB Cochabamba — Extensión Cultural',
    organizacion_id: 'org-004',
    campus: 'Cochabamba',
    ciudad: 'Cochabamba',
    categoria: 'cultural',
    modalidad: 'presencial',
    horas_semana: 6,
    deadline: daysFromNow(90),
    cupos: 2,
    cupos_disponibles: 2,
    ubicacion: { lat: -17.3935, lng: -66.1568, direccion: 'Campus UPB Cochabamba' },
    habilidades: ['historia', 'oratoria', 'atención al público'],
    status: 'open',
    created_by: 'aaaaaaaa-0000-0000-0000-000000000001',
  },
  {
    id: '55555555-0000-0000-0000-000000000005',
    titulo: 'Campaña de Salud Preventiva — Comunidades Rurales',
    title_lower: 'campaña de salud preventiva comunidades rurales',
    descripcion:
      'Brigadas de salud para comunidades del altiplano. Incluye capacitación virtual en primeros auxilios y jornadas presenciales mensuales.',
    organizacion: 'Ministerio de Salud — Programa Voluntario',
    organizacion_id: 'org-005',
    campus: 'La Paz',
    ciudad: 'La Paz',
    categoria: 'salud',
    modalidad: 'hibrido',
    horas_semana: 8,
    deadline: daysFromNow(75),
    cupos: 8,
    cupos_disponibles: 8,
    ubicacion: {
      lat: -16.49,
      lng: -68.13,
      direccion: 'Sede Central Ministerio de Salud, La Paz',
    },
    habilidades: ['primeros auxilios', 'trabajo en equipo', 'resistencia física', 'empatía'],
    status: 'open',
    created_by: 'bbbbbbbb-0000-0000-0000-000000000002',
  },
];

// Inserted individually so the DB trigger fires per row and adjusts cupos_disponibles.
const POSTULACIONES = [
  {
    id: 'aaaabbbb-0000-0000-0000-000000000001',
    estudiante_id: 'cccccccc-0000-0000-0000-000000000003',
    estudiante_nombre: 'Miguel Torres',
    estudiante_email: 'estudiante@upb.edu.bo',
    estudiante_avatar: null,
    oportunidad_id: '11111111-0000-0000-0000-000000000001',
    oportunidad_titulo: 'Apoyo a Adultos Mayores en Hogares',
    motivacion:
      'Tengo experiencia trabajando con adultos mayores en mi familia y me apasiona contribuir a su bienestar.',
    disponibilidad: 'fin_de_semana',
    telefono: '+59173456789',
    estado: 'submitted',
    confirmado: false,
  },
  {
    id: 'aaaabbbb-0000-0000-0000-000000000002',
    estudiante_id: 'cccccccc-0000-0000-0000-000000000003',
    estudiante_nombre: 'Miguel Torres',
    estudiante_email: 'estudiante@upb.edu.bo',
    estudiante_avatar: null,
    oportunidad_id: '22222222-0000-0000-0000-000000000002',
    oportunidad_titulo: 'Reforestación Parque Urbano Laikakota',
    motivacion:
      'Soy miembro del club de medioambiente de la UPB y hemos realizado campañas similares.',
    disponibilidad: 'flexible',
    telefono: '+59173456789',
    estado: 'under_review',
    confirmado: false,
  },
  {
    id: 'aaaabbbb-0000-0000-0000-000000000003',
    estudiante_id: 'cccccccc-0000-0000-0000-000000000003',
    estudiante_nombre: 'Miguel Torres',
    estudiante_email: 'estudiante@upb.edu.bo',
    estudiante_avatar: null,
    oportunidad_id: '33333333-0000-0000-0000-000000000003',
    oportunidad_titulo: 'Tutoría Virtual para Estudiantes de Secundaria',
    motivacion:
      'Fui monitor de matemáticas durante dos semestres y domino las materias requeridas.',
    disponibilidad: 'entre_semana',
    telefono: '+59173456789',
    estado: 'accepted',
    confirmado: true,
  },
];

// ─── Steps ────────────────────────────────────────────────────────────────────

async function seedAuthAndProfiles() {
  console.log('1. Auth users + profiles');

  for (const u of USERS) {
    // auth.admin.createUser accepts a custom `id` so our UUIDs stay stable
    // across runs — FK references in oportunidades/postulaciones always match.
    const { data, error } = await supabase.auth.admin.createUser({
      // `id` is a valid field in Supabase JS v2 admin API
      ...(({ id: u.id }) as any),
      id: u.id,
      email: u.email,
      password: u.password,
      email_confirm: true, // skip email verification for dev seeds
      user_metadata: { full_name: u.nombre },
    });

    if (error) {
      const isDupe =
        error.message.toLowerCase().includes('already registered') ||
        error.message.toLowerCase().includes('already exists') ||
        error.message.toLowerCase().includes('duplicate') ||
        (error as any).status === 422;

      if (isDupe) {
        console.log(`  ↺  ${u.email}  (auth user exists — skipping create)`);
      } else {
        console.error(`  ✗  ${u.email}: ${error.message}`);
        continue;
      }
    } else {
      console.log(`  ✓  auth created: ${u.email}  id=${data.user?.id}`);
    }

    // Upsert the full public profile.
    // The handle_new_user trigger creates a minimal row on signup;
    // we overwrite it with complete data here.
    const { error: profileError } = await supabase.from('users').upsert(
      {
        id: u.id,
        nombre: u.nombre,
        email: u.email,
        role: u.role,
        campus: u.campus,
        telefono: u.telefono,
        intereses: u.intereses,
        bio: u.bio,
        carrera: u.carrera,
        semestre: u.semestre,
        monthly_goal: u.monthly_goal,
        notifications_enabled: true,
      },
      { onConflict: 'id' },
    );

    if (profileError) {
      console.error(`  ✗  profile ${u.email}: ${profileError.message}`);
    } else {
      console.log(`  ✓  profile upserted: ${u.email}  (${u.role})`);
    }
  }
}

async function seedOportunidades() {
  console.log('\n2. Oportunidades');
  const { error } = await supabase
    .from('oportunidades')
    .upsert(OPORTUNIDADES, { onConflict: 'id' });
  if (error) {
    console.error(`  ✗  ${error.message}`);
  } else {
    console.log(`  ✓  ${OPORTUNIDADES.length} rows upserted`);
  }
}

async function seedPostulaciones() {
  console.log('\n3. Postulaciones');
  for (const p of POSTULACIONES) {
    // ignoreDuplicates: true — skip if the row already exists so the cupos
    // trigger does not fire twice on repeated runs.
    const { error } = await supabase
      .from('postulaciones')
      .upsert(p, { onConflict: 'id', ignoreDuplicates: true });
    if (error) {
      console.error(`  ✗  ${p.id}: ${error.message}`);
    } else {
      console.log(`  ✓  ${p.oportunidad_titulo} → ${p.estado}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('VoluntariadoUPB — seeding\n');
  await seedAuthAndProfiles();
  await seedOportunidades();
  await seedPostulaciones();
  console.log('\n✅  Done! Credentials (all use Password123!):');
  console.log('  admin@upb.edu.bo');
  console.log('  organizador@upb.edu.bo');
  console.log('  estudiante@upb.edu.bo');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
