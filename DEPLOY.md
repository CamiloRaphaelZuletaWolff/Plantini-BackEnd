# Guía de despliegue 100 % gratuito — VoluntariadoUPB + Plantini

Esta guía despliega **los dos repositorios** del proyecto sin pagar nada:

| Repositorio | Qué es | Dónde se despliega |
|---|---|---|
| [`Plantini-FrontEnd`](https://github.com/CamiloRaphaelZuletaWolff/Plantini-FrontEnd) | App Expo (React Native) exportada como **web** | **Vercel** (plan Hobby) |
| [`Plantini-BackEnd`](https://github.com/CamiloRaphaelZuletaWolff/Plantini-BackEnd) (este repo) | API NestJS del chatbot Plantini (Gemini) | **Render** (plan Free) |
| — | Base de datos Postgres, Auth y Storage | **Supabase** (plan Free) |
| — | Modelo de IA | **Google Gemini API** (capa gratuita) |

Está escrita para alguien que **nunca ha desplegado nada**: cada paso dice dónde hacer clic.
Sigue las secciones **en orden** (la 5 necesita datos de la 2 y la 3, y la 6 necesita la URL de la 5).

> Convención: lo que está entre `<ángulos>` lo reemplazas tú. Ejemplo: `<tu-proyecto>` → `voluntariado-upb`.

---

## Índice

0. [Arquitectura y costos](#0-arquitectura-y-costos)
1. [Cuentas que necesitas](#1-cuentas-que-necesitas)
2. [Supabase (base de datos, Auth, Storage)](#2-supabase)
3. [Clave de Gemini (Google AI Studio)](#3-clave-de-gemini)
4. [Cargar datos de demo (seed)](#4-cargar-datos-de-demo-seed)
5. [Backend en Render](#5-backend-en-render)
6. [Frontend en Vercel](#6-frontend-en-vercel)
7. [Integración continua (GitHub Actions) y badges](#7-integración-continua-github-actions)
8. [Checklist de verificación](#8-checklist-de-verificación)
9. [Solución de problemas](#9-solución-de-problemas)
10. [Nota sobre la app móvil](#10-nota-sobre-la-app-móvil)

---

## 0. Arquitectura y costos

```
                        ┌──────────────────────────────────────────┐
   Navegador del        │  Vercel (Hobby)                          │
   reclutador  ───────► │  https://<tu-proyecto>.vercel.app        │
                        │  Sitio estático: index.html + JS (Expo)  │
                        └───────────────┬──────────────────────────┘
                                        │ el JS corre en el navegador y llama a:
              ┌─────────────────────────┼──────────────────────────────┐
              │                         │                              │
              ▼                         ▼                              ▼
 ┌─────────────────────────┐  ┌──────────────────────────────┐  ┌──────────────────────┐
 │ Supabase (Free)         │  │ Render (Free)                │  │ OpenStreetMap        │
 │ - Auth (login email)    │  │ plantini-backend (NestJS)    │  │ (teselas del mapa,   │
 │ - Postgres (tablas)     │  │ https://<...>.onrender.com   │  │  sin API key)        │
 │ - Storage (imágenes)    │  │  /api/health                 │  └──────────────────────┘
 │                         │  │  /api/gemini/chat-stream     │
 │  anon key  ◄── frontend │  │  /api/gemini/basic-prompt    │
 │  service_role ◄─ backend│◄─┤ valida el JWT de Supabase y  │
 └─────────────────────────┘  │ guarda el historial del chat │
                              └──────────────┬───────────────┘
                                             │ GEMINI_API_KEY
                                             ▼
                              ┌──────────────────────────────┐
                              │ Google Gemini API (gratis)   │
                              └──────────────────────────────┘

 GitHub Actions: CI de ambos repos + workflow manual "Seed Supabase".
```

Flujo del chatbot: el navegador inicia sesión en Supabase → obtiene un **JWT** → llama a
`POST <Render>/api/gemini/chat-stream` con `Authorization: Bearer <JWT>` → el backend verifica
el JWT contra Supabase, llama a Gemini y devuelve el texto **en streaming** (trozos de texto plano).

### Costos y límites (todo $0)

> Los límites cambian con el tiempo; revisa la página de precios de cada servicio si algo no cuadra.

| Servicio | Plan | Costo | Límites que importan aquí |
|---|---|---|---|
| **Vercel** | Hobby | $0 | Solo uso personal / no comercial (un portafolio cumple). ~100 GB de transferencia al mes. Despliegue automático en cada push. No se duerme. |
| **Render** | Free (web service) | $0 | **512 MB RAM**, CPU compartida. **Se duerme tras 15 min sin tráfico**; la siguiente petición lo despierta en **~30–60 s** (la app muestra *"Despertando el servidor gratuito, ~1 min…"*). **750 horas de instancia al mes por workspace**, compartidas con **todos** tus otros servicios gratuitos del mismo workspace. Sin shell ni "jobs" → por eso el seed se ejecuta desde GitHub Actions. |
| **Supabase** | Free | $0 | 500 MB de base de datos, 1 GB de Storage, 50 000 usuarios activos/mes. **El proyecto se pausa tras 7 días sin actividad** (ver abajo cómo evitarlo y cómo restaurarlo). Máximo 2 proyectos gratuitos activos. |
| **Gemini API** | Capa gratuita (Google AI Studio) | $0 | Límite de peticiones por minuto y por día **por modelo** (el backend usa `gemini-3.1-flash-lite`). Consulta tus límites exactos en AI Studio → *Rate limits*. Al pasarte recibes **HTTP 429**. En la capa gratuita Google puede usar los prompts para mejorar sus productos: no envíes datos sensibles. |
| **GitHub Actions** | Free | $0 | Ilimitado en repos públicos; 2 000 min/mes en privados. |
| **OpenStreetMap** | Teselas públicas | $0 | Uso ligero con atribución (ya incluida en el mapa). |

**Sobre las 750 h de Render:** un mes tiene ~730–744 h. Un único servicio gratuito despierto 24/7
cabe justo, pero si tienes otros proyectos gratuitos en el **mismo workspace**, se reparten las 750 h.
Por eso **no** recomendamos mantener el backend despierto con "pings" (UptimeRobot, cron-job.org…):
deja que se duerma; la app ya avisa al usuario cuando está despertando.
Si quieres aislarlo, crea un workspace de Render solo para este proyecto.

**Sobre la pausa de Supabase (7 días sin actividad):**
- *Evitarla:* basta con que haya actividad real de la base de datos al menos una vez por semana
  (por ejemplo, abrir la app y loguearte). Si prefieres automatizarlo, puedes añadir un workflow
  programado de GitHub Actions que haga una consulta liviana semanal (ver
  [Troubleshooting → Supabase pausado](#supabase-pausado)).
- *Restaurarla:* Supabase te envía un correo. Entra a <https://supabase.com/dashboard>, abre el
  proyecto (aparece como **Paused**) y haz clic en **Restore project**. Tarda unos minutos. Los datos
  **no** se pierden (durante el periodo que indica Supabase, normalmente 90 días).

---

## 1. Cuentas que necesitas

Crea (o usa) estas cuentas. Ninguna pide tarjeta de crédito para lo que haremos:

1. **GitHub** — <https://github.com>. Debes tener acceso a `Plantini-FrontEnd` y `Plantini-BackEnd`.
2. **Supabase** — <https://supabase.com> → **Start your project** → *Continue with GitHub*.
3. **Google AI Studio** — <https://aistudio.google.com> con tu cuenta de Google.
4. **Render** — <https://render.com> → **Get Started** → *GitHub* (así Render ve tus repos).
5. **Vercel** — <https://vercel.com/signup> → plan **Hobby** → *Continue with GitHub*.

> Antes de empezar, asegúrate de que **todo el código está pusheado a `main`** en ambos repos
> (incluyendo `render.yaml`, `vercel.json` y la carpeta `.github/workflows`). Render y Vercel
> despliegan lo que hay en GitHub, no lo que hay en tu computadora.

---

## 2. Supabase

Si ya tienes un proyecto de Supabase funcionando con este esquema, puedes **reutilizarlo**:
salta a [2.4](#24-copia-la-url-y-las-claves) para copiar las claves y luego haz [2.5](#25-configura-las-url-de-auth-obligatorio-para-la-web).

### 2.1 Crear el proyecto

1. Entra a <https://supabase.com/dashboard> → **New project**.
2. **Organization:** la tuya (plan Free).
3. **Project name:** `voluntariado-upb`.
4. **Database Password:** clic en **Generate a password** y **guárdala** en un lugar seguro
   (no la necesita la app, pero sí tú si algún día te conectas con `psql`).
5. **Region:** la más cercana a tus usuarios (para Bolivia: *South America (São Paulo)*;
   `East US` también funciona bien y queda cerca de Render Oregon/Virginia).
6. Clic en **Create new project** y espera ~2 minutos.

### 2.2 Crear tablas, políticas y buckets (`sql/schema.sql`)

> ⚠️ **ADVERTENCIA — SCRIPT DESTRUCTIVO.** `sql/schema.sql` empieza **borrando** las tablas
> `users`, `oportunidades`, `postulaciones`, `chat_histories`, sus funciones/triggers y **todas
> las políticas de Storage**, y luego las vuelve a crear. Si lo ejecutas en un proyecto con datos
> reales, **perderás esos datos**. En un proyecto nuevo es seguro.

1. En el menú izquierdo del proyecto: **SQL Editor** (icono `>_`).
2. Clic en **+ New query** (o *New SQL snippet*).
3. Abre `sql/schema.sql` de este repo (en GitHub o en tu editor), **copia todo** y pégalo.
4. Clic en **Run** (o `Ctrl + Enter`). Si te muestra un aviso de "destructive operation",
   confirma con **Run this query**.
5. Debe terminar con *Success. No rows returned*.
6. Comprueba en **Table Editor** que existen `users`, `oportunidades`, `postulaciones` y `chat_histories`.

### 2.3 Buckets de Storage

El mismo `schema.sql` crea los tres buckets **públicos** con sus políticas:

| Bucket | Uso |
|---|---|
| `profile-images` | Avatares y fondos de perfil (cada usuario solo escribe en su carpeta). |
| `oportunidad-covers` | Portadas de oportunidades (solo admin/organizer escriben). |
| `ai-images` | Imágenes generadas por el backend. |

Compruébalo en **Storage** (menú izquierdo): deben aparecer los tres. No hay que crear nada a mano.

### 2.4 Copia la URL y las claves

Ve a **Project Settings** (engranaje abajo a la izquierda):

1. **Data API** (o **API**, según la versión del dashboard) → copia **Project URL**
   → algo como `https://abcdefghijklmn.supabase.co`. Este valor es `SUPABASE_URL` /
   `EXPO_PUBLIC_SUPABASE_URL`.
2. **API Keys**:
   - Pestaña **Legacy API keys** (anon / service_role):
     - **`anon` `public`** → es la clave **pública** del frontend (`EXPO_PUBLIC_SUPABASE_ANON_KEY`).
     - **`service_role` `secret`** → clic en **Reveal** → es la clave **secreta** del backend
       (`SUPABASE_SERVICE_ROLE_KEY`).
   - Si tu proyecto solo muestra las claves nuevas: **Publishable key** (`sb_publishable_…`) sirve
     como anon key y **Secret key** (`sb_secret_…`) sirve como service_role. Funcionan igual con este código.

> 🔒 La **service_role / secret key salta todas las políticas RLS**. Solo va en Render y en los
> *secrets* de GitHub. **Nunca** en el frontend, en Vercel, en un `.env` commiteado ni en un issue.

Guarda estos 3 valores en un bloc de notas temporal; los usarás en los pasos 4, 5 y 6.

### 2.5 Configura las URL de Auth (obligatorio para la web)

Supabase solo redirige (confirmación de correo, recuperación de contraseña, OAuth) a URLs permitidas.

1. **Authentication** (menú izquierdo) → **URL Configuration**.
2. **Site URL:** la URL de producción de Vercel, por ejemplo `https://<tu-proyecto>.vercel.app`.
   (Si aún no la tienes, vuelve aquí al terminar el paso 6.) → **Save**.
3. **Redirect URLs** → **Add URL** y añade, una por una:
   - `https://<tu-proyecto>.vercel.app/**`
   - `http://localhost:4000/**` (desarrollo web local: `npm run web` usa el puerto 4000)
   - `http://localhost:8081/**`
   - `voluntariadoupb://**` (esquema de la app móvil, definido en `app.json`)

**Cómo funciona el login en la web:**
- **Email + contraseña** funciona igual que en el móvil (la sesión se guarda en `localStorage`).
- **Confirmación de correo:** con la opción *Confirm email* activa (Authentication → Sign In / Providers → Email),
  un usuario nuevo debe hacer clic en el correo; el enlace lo lleva a la **Site URL** y luego inicia sesión normalmente.
  Para una demo sin fricción puedes **desactivar *Confirm email***; los usuarios demo del seed ya vienen confirmados.
- **Google:** la pantalla de login **no muestra** botón de Google (el hook `useGoogleSignIn` existe pero
  no está conectado a la UI), así que no hay nada que se rompa en la web. Si algún día lo activas,
  necesitarás habilitar el proveedor Google en Supabase y añadir el dominio de Vercel como
  *Authorized JavaScript origin* / *redirect URI* en Google Cloud Console.

---

## 3. Clave de Gemini

1. Entra a <https://aistudio.google.com/apikey> (Google AI Studio → **Get API key**).
2. Acepta los términos si es la primera vez.
3. Clic en **Create API key** → elige (o crea) un proyecto de Google Cloud → **Create**.
4. Copia la clave (empieza por `AIza…`). Es `GEMINI_API_KEY`.
5. (Opcional) En AI Studio → **Usage / Rate limits** puedes ver tu cuota gratuita por modelo.

> No necesitas activar facturación. Si en el futuro activas facturación en ese proyecto de Google
> Cloud, la clave deja de ser "gratis": mantenla en un proyecto **sin** facturación.

---

## 4. Cargar datos de demo (seed)

`seed.ts` crea (o actualiza, es idempotente) estos usuarios **ya confirmados**, más oportunidades y postulaciones de ejemplo:

| Email | Contraseña | Rol |
|---|---|---|
| `admin@upb.edu.bo` | `Password123!` | admin |
| `organizador@upb.edu.bo` | `Password123!` | organizer |
| `estudiante@upb.edu.bo` | `Password123!` | estudiante |

> Requisito: haber ejecutado `sql/schema.sql` (paso 2.2). El seed vuelve a escribir las filas demo
> (upsert) pero **no** borra otras filas.

### Opción A (recomendada): GitHub Actions — sin instalar nada

Render Free no tiene consola, así que las operaciones puntuales se hacen desde GitHub.

1. En GitHub abre **Plantini-BackEnd** → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret**:
   - *Name:* `SUPABASE_URL` · *Secret:* la Project URL del paso 2.4 → **Add secret**.
3. **New repository secret** otra vez:
   - *Name:* `SUPABASE_SERVICE_ROLE_KEY` · *Secret:* la service_role key → **Add secret**.
4. Ve a la pestaña **Actions** del repo. Si es la primera vez, clic en
   **I understand my workflows, go ahead and enable them**.
5. En la lista de la izquierda elige **Seed Supabase (manual)** → botón **Run workflow** (a la derecha).
6. Branch: `main`. En el cuadro *"Escribe SEED para confirmar…"* escribe exactamente `SEED`
   → **Run workflow**.
7. Abre la ejecución (aparece en ~10 s) → job **Run seed.ts** → paso **Seed database**.
   Debe terminar con `✅  Done!`. Si escribiste otra cosa en la confirmación, el job falla a propósito
   sin tocar la base de datos.

### Opción B: desde tu computadora

```bash
cd gemini-backend
npm ci
# Crea gemini-backend/.env (NO se commitea) con al menos:
#   SUPABASE_URL=https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<service_role>
npm run seed
```

---

## 5. Backend en Render

### 5.1 Crear el servicio con el Blueprint (`render.yaml`)

1. Entra a <https://dashboard.render.com>.
2. Arriba a la derecha: **+ New** → **Blueprint**.
3. **Connect a repository:** si no ves tus repos, clic en **Configure account** / *GitHub* y da acceso
   a `Plantini-BackEnd`. Luego clic en **Connect** junto a `Plantini-BackEnd`.
4. **Blueprint Name:** `plantini`. **Branch:** `main`. Render detecta `render.yaml` y muestra el
   servicio `plantini-backend` (Web Service · Free · Oregon).
5. Render pide los valores marcados `sync: false`. Rellénalos:

| Variable | Valor |
|---|---|
| `GEMINI_API_KEY` | La clave del paso 3 (`AIza…`). |
| `SUPABASE_URL` | Project URL del paso 2.4 (`https://<ref>.supabase.co`, sin `/` final). |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key del paso 2.4. |
| `CORS_ORIGINS` | Por ahora `http://localhost:4000`. **La cambiarás en el paso 6.5** por la URL de Vercel. |

   `NODE_VERSION=22` y `NODE_ENV=production` ya vienen en el archivo. `PORT` lo pone Render solo.
6. Clic en **Apply** (o *Deploy Blueprint*).
7. Ve a **Dashboard → plantini-backend → Events / Logs**. El primer build tarda 3–6 min:
   `npm ci --include=dev && npm run build` y luego `npm run start:prod`.
   Verás en el log `Listening on 0.0.0.0:10000` y el deploy pasará a **Live**.

> **Alternativa sin Blueprint:** **+ New → Web Service** → elige el repo → *Language:* Node,
> *Branch:* `main`, *Region:* Oregon, *Build Command:* `npm ci --include=dev && npm run build`,
> *Start Command:* `npm run start:prod`, *Instance Type:* **Free**. En **Advanced** → *Health Check Path:*
> `/api/health`. En **Environment Variables** añade las 4 de la tabla + `NODE_VERSION=22`. **Create Web Service**.

### 5.2 Verifica que responde

La URL está arriba en la página del servicio, por ejemplo `https://plantini-backend.onrender.com`
(si el nombre estaba ocupado, Render añade un sufijo: usa **tu** URL real).

```bash
curl https://plantini-backend.onrender.com/api/health
# → {"status":"ok","uptime":12.3,"timestamp":"2026-..."}

# Sin token debe responder 401 (eso es correcto: la ruta está protegida)
curl -i -X POST https://plantini-backend.onrender.com/api/gemini/basic-prompt -F prompt=hola
# → HTTP/1.1 401 ... "Token de autenticación requerido"
```

En Windows PowerShell usa `curl.exe` en lugar de `curl`, o abre la URL de `/api/health` en el navegador.

Si la primera llamada tarda ~1 minuto es normal: el servicio estaba dormido.

<details>
<summary>Prueba completa del chat con curl (opcional)</summary>

```bash
SUPABASE_URL=https://<ref>.supabase.co
ANON=<anon key>
API=https://plantini-backend.onrender.com

# 1) Login como usuario demo para obtener un JWT
TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"estudiante@upb.edu.bo","password":"Password123!"}' | jq -r .access_token)

# 2) Chat en streaming (chatId debe ser un UUID)
curl -N -X POST "$API/api/gemini/chat-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -F prompt="¿Cómo me postulo a una oportunidad?" \
  -F chatId=$(uuidgen | tr 'A-Z' 'a-z')

# 3) Respuesta no-streaming → {"text":"..."}
curl -X POST "$API/api/gemini/basic-prompt" -H "Authorization: Bearer $TOKEN" -F prompt="Hola"
```
</details>

### 5.3 Contrato de la API (lo que espera el frontend)

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /api/health` | — | JSON `{status, uptime, timestamp}` (sin auth, sin rate limit) |
| `POST /api/gemini/chat-stream` | `multipart/form-data`: `prompt` (texto, obligatorio), `chatId` (UUID), `files` (0–4 imágenes, máx. 10 MB c/u) | `text/plain` en streaming (trozos de texto crudo, **no** SSE) |
| `POST /api/gemini/basic-prompt` | `multipart/form-data`: `prompt`, `files` opcionales | JSON `{ "text": "..." }` |
| `GET/DELETE /api/gemini/chat-history/:chatId` | — | Historial del usuario autenticado |

Todas las rutas `/api/gemini/*` exigen `Authorization: Bearer <access_token de Supabase>`.
Límite global: **20 peticiones por minuto por IP** (`trust proxy` activado para ver la IP real detrás de Render).

---

## 6. Frontend en Vercel

### 6.1 Antes de importar

- El repo `Plantini-FrontEnd` ya incluye `vercel.json`:
  - *Install:* `npm ci` · *Build:* `npx expo export --platform web` · *Output:* `dist`
  - Reescritura de todas las rutas a `/index.html` (la app es una SPA: `app.json` no define
    `web.output`, así que Expo genera un único `index.html`).
- El repo tiene **dos lockfiles** (`package-lock.json` y `yarn.lock`). `vercel.json` fuerza `npm ci`,
  pero conviene **borrar `yarn.lock`** para que nadie (ni Vercel ni tú) use Yarn por error:
  ```bash
  git rm yarn.lock && git commit -m "chore: use npm only" && git push
  ```

### 6.2 Importar el proyecto

1. <https://vercel.com/new> (o Dashboard → **Add New…** → **Project**).
2. En **Import Git Repository**, si no aparece el repo: **Adjust GitHub App Permissions** → da acceso a
   `Plantini-FrontEnd`. Luego clic en **Import**.
3. **Project Name:** por ejemplo `voluntariado-upb` → tu URL será `https://voluntariado-upb.vercel.app`.
4. **Framework Preset:** `Other` (los comandos vienen de `vercel.json`; no cambies *Build and Output Settings*).
5. **Root Directory:** `./` (la raíz del repo).

### 6.3 Variables de entorno

Despliega la sección **Environment Variables** y añade (aplican a *Production*, *Preview* y *Development*):

| Name | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Project URL de Supabase (`https://<ref>.supabase.co`) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key (**nunca** la service_role) |
| `EXPO_PUBLIC_GEMINI_BASE_URL` | URL de Render **sin** `/api` y **sin** `/` final, p. ej. `https://plantini-backend.onrender.com` |

> Las variables `EXPO_PUBLIC_*` se **incrustan en el JavaScript durante el build**. Si cambias una,
> tienes que **volver a desplegar** (Deployments → ⋯ → **Redeploy**) para que tenga efecto.
> Por eso mismo son visibles para cualquiera: solo pon valores públicos.

### 6.4 Desplegar

1. Clic en **Deploy**. El build (instalar + `expo export`) tarda ~3–6 minutos.
2. Al terminar verás *Congratulations!* → **Continue to Dashboard** → la URL en **Domains**.
3. Abre la URL: deberías ver la app (onboarding / login).

### 6.5 Conecta CORS y Auth con la URL de Vercel

1. **Render** → `plantini-backend` → **Environment** → edita `CORS_ORIGINS`:
   `https://voluntariado-upb.vercel.app` (exactamente tu dominio: `https://`, sin `/` final).
   Si quieres seguir desarrollando en local, añade separado por coma: `https://voluntariado-upb.vercel.app,http://localhost:4000`.
   Clic en **Save, rebuild, and deploy** (o *Save and deploy*).
2. **Supabase** → Authentication → URL Configuration → pon la **Site URL** y la **Redirect URL**
   de Vercel (paso [2.5](#25-configura-las-url-de-auth-obligatorio-para-la-web)) si aún no lo hiciste.

> Las *Preview Deployments* de Vercel tienen otra URL (`voluntariado-upb-git-rama-usuario.vercel.app`);
> el chatbot dará error de CORS ahí salvo que añadas esa URL a `CORS_ORIGINS`. La URL de producción es la que importa.

---

## 7. Integración continua (GitHub Actions)

Cada repo tiene `.github/workflows/ci.yml`, que corre en cada push a `main` y en cada Pull Request con **Node 22**:

| Repo | Pasos |
|---|---|
| Plantini-BackEnd | `npm ci` → `npm run lint:check` (ESLint **sin** `--fix`) → `npm test` → `npm run build` → comprueba `dist/main.js` |
| Plantini-FrontEnd | `npm ci` → `npm run typecheck` → `npm test` → `npx expo export --platform web` → comprueba `dist/index.html` |

El CI del frontend usa valores ficticios de `EXPO_PUBLIC_*` (no contacta a nadie); los reales viven solo en Vercel.

Además, `Plantini-BackEnd` tiene `.github/workflows/seed.yml` (manual, ver paso 4).

Render y Vercel despliegan **por su cuenta** en cada push a `main` (no dependen del CI). Si quieres que
Render solo despliegue cuando el CI pasa: Render → servicio → **Settings → Build & Deploy → Auto-Deploy** → *After CI Checks Pass*.

### Badges para los README

Backend:
```markdown
[![CI](https://github.com/CamiloRaphaelZuletaWolff/Plantini-BackEnd/actions/workflows/ci.yml/badge.svg)](https://github.com/CamiloRaphaelZuletaWolff/Plantini-BackEnd/actions/workflows/ci.yml)
```
Frontend:
```markdown
[![CI](https://github.com/CamiloRaphaelZuletaWolff/Plantini-FrontEnd/actions/workflows/ci.yml/badge.svg)](https://github.com/CamiloRaphaelZuletaWolff/Plantini-FrontEnd/actions/workflows/ci.yml)
[![Demo](https://img.shields.io/badge/demo-vercel-black?logo=vercel)](https://voluntariado-upb.vercel.app)
```

---

## 8. Checklist de verificación

Hazlo en una ventana de incógnito, como lo vería un reclutador:

- [ ] `https://<render>/api/health` responde `{"status":"ok",...}`.
- [ ] La URL de Vercel carga la app; recargar la página en una ruta interna (p. ej. `/map`) **no** da 404.
- [ ] **Login** con `estudiante@upb.edu.bo` / `Password123!` entra a la app.
- [ ] La lista de **oportunidades** muestra las oportunidades del seed.
- [ ] Abrir una oportunidad muestra su detalle; postularse funciona (con otro usuario o una oportunidad nueva).
- [ ] Pestaña **Mapa**: se ve el mapa de OpenStreetMap con los pines por categoría; clic en un pin
      abre la tarjeta y clic en la tarjeta navega al detalle de la oportunidad. El zoom y arrastre funcionan.
- [ ] **Chatbot Plantini** (menú lateral → Chat): envía "Hola". Si Render dormía, aparece
      *"Despertando el servidor gratuito, ~1 min…"*; luego la respuesta llega **en streaming** (se va escribiendo).
- [ ] Un segundo mensaje responde rápido (el servidor ya está despierto) y recuerda el contexto.
- [ ] Login como `admin@upb.edu.bo` muestra las pantallas de administración.
- [ ] Los badges de CI de ambos repos están en verde.

---

## 9. Solución de problemas

### El build web falla (Vercel o local)
- **`Importing native-only module "react-native/Libraries/..." on web`**: algún archivo importa una
  librería solo-nativa. Para mapas, importa siempre desde `src/components/map/mapPrimitives`
  (en web usa Leaflet), **nunca** directamente `react-native-maps`. Para otras librerías, crea una
  variante `Archivo.web.tsx` o protege el uso con `Platform.OS !== 'web'`.
- **La web carga en blanco y la consola dice `Cannot use 'import.meta' outside a module`**: falta
  `babel.config.js` con `unstable_transformImportMeta: true` (ya está en el repo; si lo borras, vuelve el error).
- **`npm ci` falla con "package.json and package-lock.json are not in sync"**: ejecuta `npm install`
  en tu computadora, commitea `package-lock.json` y vuelve a pushear.
- **Build lento / sin memoria**: el plan Hobby da 8 GB para el build; el export tarda unos minutos. Reintenta con **Redeploy**.
- Reproducir localmente: `npm ci && npx expo export --platform web && npx serve dist --single`.

### El chatbot muestra error / la consola del navegador dice CORS
- Mensaje típico: `blocked by CORS policy: No 'Access-Control-Allow-Origin' header`.
- `CORS_ORIGINS` en Render debe ser **exactamente** el origen: `https://voluntariado-upb.vercel.app`
  (con `https://`, sin `/` final, sin rutas). Varias URLs separadas por coma.
- Tras cambiarla, espera a que Render termine el redeploy.
- Si `EXPO_PUBLIC_GEMINI_BASE_URL` apunta mal (p. ej. con `/api` al final o a `localhost`), corrige en
  Vercel y haz **Redeploy**. En las DevTools → *Network* verás a qué URL va la petición.

### 401 "Token inválido o expirado" / "Token de autenticación requerido"
- El backend valida el JWT con **su** `SUPABASE_URL`. Si el frontend usa otro proyecto de Supabase
  (`EXPO_PUBLIC_SUPABASE_URL` distinto), todos los tokens serán inválidos → usa el **mismo** proyecto en ambos.
- La sesión expiró: cierra sesión y vuelve a entrar.
- `SUPABASE_SERVICE_ROLE_KEY` incorrecta en Render → el backend no puede verificar usuarios (revisa los logs).

### Supabase pausado
- Síntomas: login falla, la app no carga datos, errores de red contra `*.supabase.co`.
- Arreglo: Dashboard → proyecto → **Restore project** y espera unos minutos.
- Prevención automática (opcional): crea en el repo del frontend `.github/workflows/keepalive.yml`
  con secrets `SUPABASE_URL` y `SUPABASE_ANON_KEY`:
  ```yaml
  name: Supabase keepalive
  on:
    schedule:
      - cron: '0 12 * * 1,4'   # lunes y jueves 12:00 UTC
    workflow_dispatch:
  jobs:
    ping:
      runs-on: ubuntu-latest
      steps:
        - run: |
            curl -fsS "${{ secrets.SUPABASE_URL }}/rest/v1/oportunidades?select=id&limit=1" \
              -H "apikey: ${{ secrets.SUPABASE_ANON_KEY }}" \
              -H "Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}" > /dev/null
  ```
  (GitHub desactiva los workflows programados tras 60 días sin commits en el repo; reactívalo desde la pestaña Actions si pasa.)

### Render: la primera respuesta tarda ~1 minuto
- Es el *cold start* del plan gratuito (se durmió tras 15 min). La app muestra el aviso y reintenta
  automáticamente si la conexión falla. No es un error.
- Si el deploy falla: Render → **Logs**. Causas típicas:
  - `Error: ... GEMINI_API_KEY should not be empty` (o `SUPABASE_URL must be a URL`) → falta/está mal una variable de entorno.
  - `Cannot find module '/opt/render/project/src/dist/main'` → el build no generó `dist/main.js`; revisa que el *Build Command* sea `npm ci --include=dev && npm run build`.
  - *Exceeded memory limit* → reduce el tamaño de las imágenes enviadas (límite: 4 archivos × 10 MB).

### Gemini: 429 / "quota exceeded" / "RESOURCE_EXHAUSTED"
- Superaste la cuota gratuita por minuto o por día del modelo. Espera (por minuto) o al día siguiente (por día).
- Revisa AI Studio → **Rate limits** / **Usage**.
- También existe el límite propio del backend: **20 peticiones/min por IP** → `429 ThrottlerException: Too Many Requests`.

### El mapa web sale gris o sin pines
- Gris: bloqueador de contenido o sin red hacia `tile.openstreetmap.org`.
- Sin pines: las oportunidades no tienen `ubicacion` (lat/lng) en la base de datos; asígnalas desde
  la pantalla de administración *Gestión de ubicaciones* (en web también funciona: clic en el mapa para colocar el pin).
- La "ruta" del detalle es una línea recta estimada (no usa Google Directions).

---

## 10. Nota sobre la app móvil

- Este despliegue cubre la **versión web** (lo que abre un reclutador en el navegador).
- Generar APK/IPA con **EAS Build** queda **fuera de alcance** de esta guía.
- **Demo móvil gratis con Expo Go:** instala *Expo Go* (Android/iOS) y, desde tu computadora:
  ```bash
  cd VoluntariadoUPB
  npx expo start --tunnel
  ```
  Escanea el QR con Expo Go (Android) o la cámara (iOS). Funciona mientras tu computadora esté encendida
  con ese comando corriendo. Pon `EXPO_PUBLIC_GEMINI_BASE_URL=https://<render>` en tu `.env` local para
  que el chat del móvil use el backend de Render. Limitación: las notificaciones push no funcionan en Expo Go.
