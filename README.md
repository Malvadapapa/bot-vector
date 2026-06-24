# 🤖 Bot Vectorito

**Asistente académico automatizado para WhatsApp orientado a estudiantes del ISPC**

[![Node.js](https://img.shields.io/badge/Node.js-24%2B-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6%2B-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://www.docker.com/)
[![RAG](https://img.shields.io/badge/Architecture-RAG-orange)](https://en.wikipedia.org/wiki/Retrieval-augmented_generation)
[![License](https://img.shields.io/badge/License-MIT-gray)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Alpha%200.2.1--alpha.3-yellow)](CHANGELOG.md)

Bot Vectorito es un asistente académico automatizado diseñado para centralizar y simplificar el acceso a la información de cursada para los estudiantes de la Tecnicatura Superior en Desarrollo de Software del ISPC (Instituto Superior Politécnico Córdoba).

## 📖 Contenido

- [El Problema y la Solución](#-el-problema-y-la-solución)
- [Características Principales](#-características-principales)
- [Stack Tecnológico](#-stack-tecnológico)
- [Arquitectura](#-arquitectura--diseño)
- [Instalación](#-instalación-y-configuración)
- [Comandos y Uso](#-comandos-y-uso)
- [Desarrollo y Decisiones Técnicas](#-desarrollo-y-decisiones-técnicas)
- [FAQ](#-faq)

---

## 💡 El Problema y la Solución

**El problema:** La Tecnicatura Superior en Desarrollo de Software del ISPC se desarrolla bajo una modalidad mayormente asincrónica, donde gran parte del contenido académico, avisos y actividades se publican en foros de Moodle y distintos canales institucionales.

En la práctica, esto genera varios problemas para los estudiantes:
- Información dispersa entre múltiples foros, mensajes y plataformas.
- Dificultad para encontrar avisos importantes o fechas relevantes.
- Publicaciones que quedan ocultas entre hilos extensos.
- Estudiantes que no tienen claro dónde consultar información oficial.
- Comunicación reactiva y dependencia constante de grupos informales.
- Sensación de desconexión entre estudiantes, docentes y herramientas institucionales.

El resultado es una experiencia académica fragmentada, donde muchos estudiantes terminan perdiendo información importante o recurriendo constantemente a otros estudiantes para resolver dudas administrativas o académicas.

**La solución:** Bot Vectorito integra en WhatsApp un asistente académico automatizado que centraliza información clave de cursada y reduce fricción en el acceso a datos importantes.

El objetivo del bot es acercar la información académica al entorno donde mas interactúan los alumnos, simplificando el acceso a clases compartiendo los enlaces, avisos institucionales, avisos de exámenes y consultas frecuentes mediante automatización e IA contextualizada.

El asistente permite:
- 📚 Centralizar información académica relevante en un único canal.
- 🔔 Automatizar recordatorios, avisos y notificaciones importantes.
- 🧠 Responder consultas con IA contextualizada usando datos reales del calendario y la base académica.
- 🔍 Recuperar información desde documentos institucionales mediante arquitectura RAG.
- 💬 Reducir la dependencia de mensajes perdidos en grupos o foros extensos.
- ⚡ Brindar respuestas rápidas desde una interfaz cotidiana y accesible como WhatsApp.

Más que un bot de comandos, Vectorito actúa como un asistente académico automatizado orientado a mejorar la experiencia diaria de estudiantes del ISPC en una modalidad educativa distribuida y asincrónica.

---

## ✨ Características Principales

| Característica | Descripción |
| --- | --- |
| 🤖 **Respuestas con IA** | Generación de respuestas con contexto académico + RAG. Rigurosa objetividad (sin especulaciones ni antropomorfismo) y trato personal obligatorio por nombre de usuario. |
| 📅 **Automatización** | Recordatorios automáticos de clases, exámenes y avisos. |
| 🗂️ **Contexto dinámico** | Perfiles, comisiones, profesores y agenda almacenados en base de datos. |
| 🔐 **Gestión Privada** | Chat privado por código para completar perfiles y ejecutar flujos de administración. |
| ⚡ **Comandos Rápidos** | Accesos directos sin IA (`!hoy`, `!examenes`, `!avisos`) para respuestas inmediatas. |
| 🛡️ **Moderación** | Detección de off-topic, advertencias, bloqueos progresivos y rate limiting. |

---

**Nota de administración:** Ahora el panel admin permite *editar* una materia ya cargada (nombre, día/hora y enlace de Meet) desde el submenú de `Configurar avisos de clase` → `Editar materia/horario/enlace`.


## 🛠 Stack Tecnológico

| Capa | Tecnología | Propósito |
| --- | --- | --- |
| **Runtime & Lenguaje** | Node.js 24+ / TypeScript 6+ | Entorno de ejecución y tipado estático |
| **Interfaz WhatsApp** | Baileys | Conexión a WhatsApp vía Web Socket |
| **Panel Web** | React 19 / Vite 8 / TailwindCSS 4 | Dashboard de administración SPA |
| **Persistencia** | SQLite | Almacenamiento ágil de datos e índices RAG |
| **IA & Embeddings** | Gemini 2.5 (Groq fallback) / HuggingFace Transformers | Generación de respuestas y vectorización |
| **Automatización** | node-cron | Tareas programadas e indexación incremental |
| **Integraciones** | IMAP, SMTP, RSS | Correos institucionales, notificaciones y noticias |
| **Despliegue** | Docker / Docker Compose | Contenedorización y despliegue portable |

---

## 🏗️ Arquitectura & Diseño

El sistema emplea una combinación de **Vertical Slicing**, **Screaming Architecture** y **Hexagonal (Ports & Adapters)** para lograr módulos autocontenidos, alta cohesión y bajo acoplamiento.

- **Screaming Architecture (nivel global):** La estructura de carpetas "grita" las capacidades de negocio (`academic-calendar`, `ai`, `moderation`) en vez de capas técnicas genéricas.
- **Vertical Slicing (nivel de aplicación):** Cada carpeta en `features/` es un slice completo de principio a fin (Request → Logic → DB).
- **Hexagonal (nivel interno):** Dentro de cada slice, modelos y lógica de negocio permanecen aislados de la infraestructura concreta.

```text
src/
├── main.ts                         # Composición raíz y bootstrap
├── features/                       # ── SLICES VERTICALES DE NEGOCIO ──
│   ├── academic-calendar/          # Clases, exámenes, profesores, comisiones
│   │   ├── academic-calendar.models.ts
│   │   ├── academic-calendar.repository.ts
│   │   ├── academic-calendar.service.ts
│   │   ├── exam-menu.service.ts / edit-exam-menu.service.ts
│   │   ├── comision-management.service.ts
│   │   └── __tests__/
│   ├── ai/                         # IA conversacional, RAG, rate limiting
│   │   ├── ai-query.service.ts / knowledge-context.service.ts
│   │   ├── rate-limit.service.ts / rate-limit.repository.ts
│   │   ├── providers/              # Gemini, Groq, Fallback, Embeddings
│   │   ├── rag/                    # Pipeline, consulta semántica, CLI
│   │   └── __tests__/
│   ├── moderation/                 # Warnings, baneos, detección off-topic
│   │   ├── moderation.models.ts / moderation.repository.ts
│   │   ├── user-moderation.service.ts / ban-warning-system.ts
│   │   └── __tests__/
│   ├── conversation/               # Estado de conversación y confirmaciones
│   │   ├── conversation.models.ts / conversation.repository.ts
│   │   ├── conversation-state.service.ts
│   │   └── __tests__/
│   ├── notifications/              # Alertas, recordatorios, IMAP, RSS, email
│   │   ├── notifications.repository.ts / class-notification.service.ts
│   │   ├── exam-notification.service.ts / scheduled-reminder.service.ts
│   │   ├── integrations/           # EmailService, IMAP monitor, RSS parser
│   │   └── __tests__/
│   └── messages/                   # Enrutamiento, intenciones, de-duplicación
│       ├── message-router.service.ts / message-intent-parser.service.ts
│       ├── dynamic-message.service.ts
│       └── __tests__/
├── shared/                         # ── COMPONENTES TRANSVERSALES ──
│   ├── config/                     # Configuración de entorno
│   ├── db/                         # SQLite: database, migrations, db-utils
│   └── logging/                    # Servicio de logs
├── interfaces/                     # ── ADAPTADORES DE ENTRADA/SALIDA ──
│   └── whatsapp/                   # Baileys gateway
└── scheduler/                      # �## ⚙️ Instalación y Configuración

### Requisitos Previos
* Node.js 24.x+ y npm 10.x+
* Git
* Cuenta de WhatsApp (cualquier número)
* API Key de Gemini (Google AI Studio)

### Opción 1: Instalación Local

1. **Clonar e instalar dependencias:**
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd bot-vectorito
   npm install
   npm run install:web
   ```
2. **Configurar entorno:**
   Copia `.env.example` a `.env` y completa las variables clave:
   ```env
   ADMIN_PASSWORD=tu_password_fuerte
   ADMIN_SEED_CODES=123456,654321
   GEMINI_API_KEY=tu_gemini_api_key
   SQLITE_PATH=data/chatbot.db
   BASE_URL=http://localhost:3000
   ```
3. **Compilar e iniciar:**
   ```bash
   npm run build        # Compilar backend (TypeScript)
   npm run build:web    # Compilar panel web (React/Vite)
   npm start            # Iniciar en producción
   # Para desarrollo con hot-reload: npm run dev
   ```
4. **Vincular WhatsApp:** Escanea el código QR que aparecerá en la terminal desde `Dispositivos vinculados` en tu app de WhatsApp. Escribe `!menu` en el grupo para verificar.
5. **Acceder al panel web:** Abrí `http://localhost:3000` en tu navegador.

### Opción 2: Despliegue con Docker 🐳

La forma más simple y portable de desplegar el bot.

1. **Requisitos:** [Docker](https://docs.docker.com/get-docker/) y [Docker Compose](https://docs.docker.com/compose/install/) instalados.

2. **Clonar y configurar:**
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd bot-vectorito
   cp .env.example .env
   # Editar .env con tus claves y configuración
   ```

3. **Construir e iniciar:**
   ```bash
   docker compose up -d --build
   ```

4. **Ver logs en tiempo real:**
   ```bash
   docker compose logs -f
   ```

5. **Detener:**
   ```bash
   docker compose down
   ```

> **Nota:** La sesión de WhatsApp y la base de datos se persisten automáticamente en las carpetas `./session/` y `./data/` respectivamente. Estas carpetas sobreviven a reinicios y reconstrucciones del contenedor.

> **Nota:** La TUI (interfaz de consola) se deshabilita automáticamente en Docker (`TUI_ENABLED=false`). El bot funciona en modo headless.

---

## Configuración de grupos

Los grupos se gestionan automáticamente en la base de datos SQLite. Ya no se configuran en el archivo `.env`.

### Agregar un grupo nuevo

1. Un admin global agrega el bot al grupo de WhatsApp.
2. El bot se registra automáticamente y envía un mensaje privado al admin con instrucciones de configuración.
3. El admin asigna el contexto académico inicial por privado con el comando:
   `!config-grupo [groupId] año:[N] turno:[mañana|tarde|noche]`
   
   *Ejemplo:*
   `!config-grupo 120123456789-1234567890@g.us año:2 turno:tarde`

4. El bot iniciará un asistente interactivo en el chat privado del administrador:
   - **Camada y comisiones**: Se creará el año y número de comisiones académicas.
   - **Materias y Profesores**: Por cada materia ingresada, se solicitará su día/hora y enlace de Meet, seguido del nombre y email de su profesor (`Nombre|email@ispc.edu.ar`). Estos pasos se pueden omitir ingresando `skip`.
   - **Emails de la cohorte**: Al finalizar las materias, se solicitará ingresar la lista de emails de clase de la cohorte separados por comas (`etiqueta|email, etiqueta|email`, ej: `Tutoría|tutor@ispc.edu.ar, Bedelía|bedelia@ispc.edu.ar`). Se puede omitir ingresando `skip` o `mas tarde`.

5. El bot confirma la configuración definitiva dentro del grupo.

### Migración desde versión anterior

Si venías usando `WHATSAPP_GROUP_ID` o `WHATSAPP_GROUP_ID_2` en tu `.env`, el bot los migra automáticamente a la BD en el primer arranque. Podés eliminar esas variables del `.env` después del primer inicio exitoso.

---aterias, se solicitará ingresar la lista de emails de clase de la cohorte separados por comas (`etiqueta|email, etiqueta|email`, ej: `Tutoría|tutor@ispc.edu.ar, Bedelía|bedelia@ispc.edu.ar`). Se puede omitir ingresando `skip` o `mas tarde`.

5. El bot confirma la configuración definitiva dentro del grupo.

### Migración desde versión anterior

Si venías usando `WHATSAPP_GROUP_ID` o `WHATSAPP_GROUP_ID_2` en tu `.env`, el bot los migra automáticamente a la BD en el primer arranque. Podés eliminar esas variables del `.env` después del primer inicio exitoso.

---

## 🤖 Comandos y Uso

El bot soporta dos modos: **comandos rápidos** (con `!`) y **consultas con IA contextualizada** (lenguaje natural o mediante mención con `@`).

### 🔹 Consultas con IA

**En el grupo:** Escribí preguntas en lenguaje natural. El bot responde con contexto académico del calendario y documentos institucionales.

Ejemplos:
- *"¿Cuándo es el examen de Estructuras?"*
- *"Qué materias tengo que ver esta semana?"*
- *"Me falta Cálculo, ¿cuándo se recupera?"*

**Mencionar al bot (@vectorito):** Si quieres forzar una respuesta con IA en un contexto específico, menciona al bot con `@vectorito` seguido de tu pregunta:
- `@vectorito ¿Cuáles son las fechas de los exámenes finales?`
- `@vectorito Necesito correlativas de Algoritmos`

### 🔹 Comandos rápidos (En Grupos)

| Comando | Alias | Descripción |
| --- | --- | --- |
| `!menu` | `!m` | Abre el menú interactivo con opciones de navegación |
| `!config-grupo [groupId] año:[N] turno:[turno]` | `!cg` | Asigna contexto académico a un grupo |
| `!hoy` | `!clases` | Muestra las clases/materias del día (fecha, horario, profesor) |
| `!enlace` | `!e` | Devuelve el enlace de Meet/Zoom de la clase en curso o próxima (ventana 10 min antes) |
| `!examenes` | `!ex` | Lista los próximos exámenes (fecha, hora, tipo, comisión) |
| `!avisos` | `!av` | Avisos e informes institucionales vigentes |
| `!semana` | `!s` | Agenda académica de esta semana |
| `!semana-que-viene` | `!sv` | Agenda de la próxima semana |
| `!noticias` | `!n` | Últimas noticias de tecnología (RSS) |
| `!help` | `!he` | Muestra ayuda con todos los comandos disponibles |

### 🔹 Chat Privado (Gestión y Administración)

**Registro de usuario:** El bot te pedirá que completes tu perfil (nombre, cumpleaños, email, comisión) en privado.

## Niveles de administrador

### Admin global
- Acceso completo a todas las funciones del bot
- Puede agregar el bot a grupos nuevos
- Puede asignar el contexto académico de cualquier grupo
- Puede designar admins de grupo
- Se registra con el código semilla definido en `ADMIN_SEED_CODES`

### Admin de grupo
- Acceso restringido a su grupo asignado
- Puede cargar exámenes y materias de su comisión
- Puede subir PDFs al RAG de su grupo
- Puede gestionar avisos dirigidos a su grupo
- No puede configurar el contexto del grupo ni agregar el bot a nuevos grupos
- Es designado por un admin global

**Comandos administrativos:** Requieren autenticación previa con `!soyadmin [codigo]`:
- `!panel`: Panel de administración general
- `!agregarexamen`: Crear nuevo examen en el calendario
- `!editarexamen`: Editar examen existente
- `!eliminaravisos`: Limpiar avisos vencidos
- `!log-moderacion`: Ver estadísticas de moderación y bloqueos
- `!log-errores`: Ver log de errores del bot
- `!stats`: Estadísticas generales de uso
- `!rag-upload global`: Sube PDF al RAG global (enviar como adjunto con este caption)
- `!rag-upload [groupId]`: Sube PDF al RAG de un grupo específico
- `!config-grupo [groupId] año:[N] turno:[turno]`: Asigna contexto académico a un grupo

## RAG por grupo

Los documentos se organizan en dos niveles:

- **Global** (`data/ai-context/global/`): accesible desde cualquier grupo. Para información institucional general como correlatividades o reglamentos.
- **Por grupo** (`data/ai-context/[group_id]/`): accesible solo desde ese grupo. Para información específica de un año o comisión.

Para subir documentos desde WhatsApp, enviá el PDF en chat privado con el bot usando como caption:
!rag-upload global
!rag-upload 120123456789-1234567890@g.us

Los documentos que ya estaban en `data/ai-context/` antes de esta versión se tratan automáticamente como scope global.

---

## 🌐 Panel Web de Administración

El bot incluye un panel web embebido accesible en `http://localhost:3000` (o la URL configurada en `BASE_URL`).

### Acceso al Panel

El acceso se realiza mediante **autenticación OTP por correo electrónico**:
- **Super Administradores y Administradores**: Escriben `!panel` en el chat privado con el bot para recibir un enlace de login con código OTP.
- **Profesores**: Pueden enviar un email con asunto `panel` al correo institucional del bot, o escribir `!panel` en el chat privado. Si su WhatsApp no está vinculado, se les envía un código de verificación a su email institucional.
- **Acceso directo**: El enlace de login incluye el email y código OTP pre-completados para ingreso con un solo click.

### Roles y Funcionalidades

| Rol | Funcionalidades |
| --- | --- |
| 🛡️ **Super Admin** | Gestión global de grupos, materias, profesores, comisiones, calendario académico, ciclo lectivo, administradores, emails autorizados, simulación de alumnos, ajustes y temas |
| 🔑 **Admin de Grupo** | Vista acotada a su grupo con lectura de calendario, administradores y horarios |
| 🏫 **Personal Institucional** | Edición de hitos del ciclo lectivo, feriados, horarios de clase, enlaces de Meet y datos docentes |
| 👨‍🏫 **Profesor** | Calendario de evaluaciones, registro/edición de exámenes propios, agenda de clases, mensajería bidireccional con alumnos vía WhatsApp, verificación de teléfono OTP |

### Compilación del Frontend

```bash
npm run install:web   # Instalar dependencias del frontend
npm run build:web     # Compilar el panel web (React/Vite/TailwindCSS)
```

El panel se sirve estáticamente desde `web/dist/`. Si no está compilado, el servidor HTTP responde con un mensaje indicando ejecutar `npm run build:web`.

---

## 📖 Desarrollo y Decisiones Técnicas

### Scripts Útiles
```bash
npm run dev           # Hot reload (Bot + Web) con recompilación automática
npm run build         # Compilación TypeScript del backend
npm run build:web     # Compilación del panel web (React/Vite)
npm run install:web   # Instalar dependencias del frontend
npm run test          # Ejecutar tests con Vitest (watch)
npm run test:vitest   # Ejecutar tests una sola vez
npm run rag:index     # Indexa PDFs nuevos en data/ai-context/
npm run rag:test      # Prueba interactiva del motor RAG
npm run rag:status    # Estado del índice RAG
npm run rag:reindex   # Re-indexar todo el contenido RAG
npm run cleanup:data  # ⚠️ Limpia la BD y vectores
```

### ¿Por qué esta arquitectura?
* **RAG vs Fine-tuning:** Se eligió RAG porque permite actualizar fechas, manuales y PDF institucionales sin costos de reentrenamiento, garantizando respuestas explicables y referenciadas.
* **Contexto Mixto (RAG + SQLite):** RAG procesa documentos estáticos, pero la BD maneja el conocimiento "caliente" (qué alumno pregunta, de qué comisión es, qué clase toca hoy).
* **Baileys vs API Oficial:** Para esta etapa Alpha, Baileys permite iterar rápido y gratis en grupos estándar. La lógica está desacoplada para facilitar una futura migración a la WhatsApp Business API.
* **Moderación:** El sistema progresivo (warnings → ban temporal) asegura el acceso democrático y educa al usuario antes de penalizarlo.
* **Panel Web Embebido:** El servidor HTTP nativo de Node.js sirve la API REST y la SPA sin necesidad de un reverse proxy adicional. Esto simplifica el despliegue y mantiene todo en un único proceso.
* **Docker Multi-Stage:** La imagen de producción excluye herramientas de compilación, reduciendo significativamente el tamaño final.

---

## ❓ FAQ

* **¿Necesito Docker para usar el bot?** No. Docker es opcional. Podés instalar Node.js y ejecutar el bot directamente con `npm start`.
* **¿Cómo accedo al panel web?** Abrí `http://localhost:3000` y logueate con tu email usando el código OTP que recibís al escribir `!panel` al bot.
* **¿Puedo cambiar el puerto del servidor HTTP?** El puerto está hardcodeado en `3000`. Para cambiar el puerto, podés usar Docker Compose mapeando `"8080:3000"` en el archivo `docker-compose.yml`.

---

## 📬 Configuración y Autorización Avanzada de Avisos por Email

El bot incluye un flujo robusto para procesar correos electrónicos y publicarlos como avisos institucionales en los grupos correspondientes de WhatsApp.

### 📧 Asunto del Correo y Formato Estructurado
El monitor de correos procesa cualquier email que contenga la palabra **"aviso"** (de forma insensible a mayúsculas/minúsculas, ej: "aviso", "Aviso", "AVISO") en su asunto.
- Si el cuerpo del email posee formato estructurado con el campo `cuerpo:` o `mensaje:` obligatorio, se publica de inmediato en WhatsApp.
- Si el correo carece de estructura o tiene placeholders vacíos, el bot responde de forma automática al emisor enviando una plantilla interactiva en **formato HTML y texto plano**. Dicha respuesta coloca la plantilla al inicio para fácil copia, sugiere el uso de Inteligencia Artificial (ChatGPT, Gemini, Claude) para completarla y simplifica la lista de opciones para el campo `grupo:` mostrando únicamente las cohortes (camadas) y selectores generales disponibles para evitar ruido visual.

### 👑 Autorización de Remitentes y Roles Dinámicos
El bot valida y autoriza la publicación de avisos desde correos electrónicos o flujos de WhatsApp y asigna dinámicamente el rol del remitente (`super-admin`, `admin`, `profe`, o `colaborador`) en el mensaje final publicado en WhatsApp (ej: *El/La super-admin [Nombre] dejo un aviso...*):
1. El remitente es un **Superadministrador** definido en la variable de entorno `SUPERADMIN_EMAILS` (lista separada por comas) -> Rol: `super-admin`.
   ```env
   SUPERADMIN_EMAILS=admin@instituto.edu.ar, director@instituto.edu.ar
   ```
2. El remitente es un **Administrador** registrado en la base de datos (con email en su perfil de usuario) -> Rol: `admin`.
3. El remitente es un **Profesor** registrado en la base de datos (tabla `managed_teachers`) -> Rol: `profe`.
4. El remitente es un **Correo Autorizado Personalizado** registrado en la tabla `authorized_emails` -> Rol: `colaborador`. Los administradores pueden gestionar esta lista desde WhatsApp en el submenú de gestión de avisos.

Todos los correos son normalizados (eliminando espacios y comparando en minúsculas) para una validación segura y robusta. Al crear avisos desde WhatsApp, el bot registra automáticamente el correo del administrador como `source_email` para asegurar la correcta resolución de su rol y nombre en envíos programados periódicos.

### 💬 Respuesta a Avisos desde WhatsApp (`!responderid`)
Cuando un aviso es publicado en WhatsApp, se incluye su ID único autoincremental en el mensaje (ej: `(ID: 42)`). Los superadministradores pueden responder al emisor original del aviso enviando el comando:
```text
!responderid[ID] [mensaje]
```
o
```text
!responderid [ID] [mensaje]
```
El bot enviará de inmediato un correo electrónico al emisor original del aviso conteniendo la respuesta del superadministrador junto con los datos de contexto del aviso original.

### 🔒 Solución de Errores de Certificado TLS Auto-firmado (`SELF_SIGNED_CERT_IN_CHAIN`)
Si tu servidor de correo IMAP corporativo o proxy local utiliza certificados auto-firmados, **nunca deshabilites** la seguridad global de Node (`NODE_TLS_REJECT_UNAUTHORIZED=0`). En su lugar, el bot permite configurar una conexión TLS segura y específica para IMAP:

1. **Permitir certificados auto-firmados en el buzón IMAP:**
   Si confías plenamente en la red y deseas omitir la validación de la firma en la cadena de conexión IMAP, puedes configurar:
   ```env
   IMAP_TLS_REJECT_UNAUTHORIZED=false
   ```
2. **Usar una CA corporativa/personalizada de forma segura:**
   Si cuentas con el archivo del certificado de la Autoridad de Certificación (`.pem` / `.crt`), puedes apuntar el bot al archivo para que sea validado y aceptado en el proceso de Handshake TLS:
   ```env
   IMAP_TLS_CA_PATH=C:/ruta/a/mi_ca_corporativa.pem
   IMAP_TLS_SERVERNAME=mi-servidor-imap.instituto.edu.ar
   ```
Esto mantendrá el resto de las conexiones externas del bot (por ejemplo, llamadas a la API de WhatsApp, Gemini o integraciones externas) con la validación de certificados estándar y protegidas.

---

**Hecho para estudiantes del ISPC.**
