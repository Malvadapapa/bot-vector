# ðŸ¤– Bot Vectorito

**Asistente acadÃ©mico automatizado para WhatsApp orientado a estudiantes del ISPC**

[![Node.js](https://img.shields.io/badge/Node.js-24%2B-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6%2B-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://www.docker.com/)
[![RAG](https://img.shields.io/badge/Architecture-RAG-orange)](https://en.wikipedia.org/wiki/Retrieval-augmented_generation)
[![License](https://img.shields.io/badge/License-MIT-gray)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Alpha%200.2.1--alpha.3-yellow)](CHANGELOG.md)

> [!NOTE]
> ### 📢 Código Libre y Propósito de Apoyo Estudiantil
> Este proyecto ha sido desarrollado bajo una filosofía de código abierto y colaboración comunitaria. Su principal y único propósito es brindar soporte a nuestros compañeros/as de cursada, facilitando el acceso a la información y optimizando la experiencia académica diaria en la Tecnicatura Superior en Desarrollo de Software del ISPC.
> 
> Por lo tanto, **el código fuente es completamente libre**: tienes total libertad de copiar, estudiar, distribuir, modificar o utilizar esta base de código para adaptarla a tus propias necesidades o crear nuevos proyectos derivados. Invitamos a toda la comunidad estudiantil a colaborar y seguir mejorando estas herramientas de forma colectiva.
> 
> **Colaboradores Destacados:**
> - 👩‍💻 **Karina Del Valle Quinteros** ([@KaryQuinteros](https://github.com/KaryQuinteros)) - Collaborator
> - 👩‍💻 **Laura Zarate** ([@lauzarg](https://github.com/lauzarg)) - Collaborator
> 
> **Mención Especial:**
> - 👨‍🏫 **Ramiro Ceballes** ([@RamiroCeballes](https://github.com/RamiroCeballes)) - Collaborator y Tutor del proyecto en la Feria de Ciencias, quien impulsó esta iniciativa con su apoyo constante, valiosas sugerencias y una calidez excepcional.

Bot Vectorito es un asistente académico automatizado diseñado para centralizar y simplificar el acceso a la información de cursada para los estudiantes de la Tecnicatura Superior en Desarrollo de Software del ISPC (Instituto Superior Politécnico Córdoba).

## ðŸ“– Contenido

- [El Problema y la SoluciÃ³n](#-el-problema-y-la-soluciÃ³n)
- [CaracterÃ­sticas Principales](#-caracterÃ­sticas-principales)
- [Stack TecnolÃ³gico](#-stack-tecnolÃ³gico)
- [Arquitectura](#-arquitectura--diseÃ±o)
- [InstalaciÃ³n](#-instalaciÃ³n-y-configuraciÃ³n)
- [Comandos y Uso](#-comandos-y-uso)
- [Desarrollo y Decisiones TÃ©cnicas](#-desarrollo-y-decisiones-tÃ©cnicas)
- [FAQ](#-faq)

---

## ðŸ’¡ El Problema y la SoluciÃ³n

**El problema:** La Tecnicatura Superior en Desarrollo de Software del ISPC se desarrolla bajo una modalidad mayormente asincrÃ³nica, donde gran parte del contenido acadÃ©mico, avisos y actividades se publican en foros de Moodle y distintos canales institucionales.

En la prÃ¡ctica, esto genera varios problemas para los estudiantes:
- InformaciÃ³n dispersa entre mÃºltiples foros, mensajes y plataformas.
- Dificultad para encontrar avisos importantes o fechas relevantes.
- Publicaciones que quedan ocultas entre hilos extensos.
- Estudiantes que no tienen claro dÃ³nde consultar informaciÃ³n oficial.
- ComunicaciÃ³n reactiva y dependencia constante de grupos informales.
- SensaciÃ³n de desconexiÃ³n entre estudiantes, docentes y herramientas institucionales.

El resultado es una experiencia acadÃ©mica fragmentada, donde muchos estudiantes terminan perdiendo informaciÃ³n importante o recurriendo constantemente a otros estudiantes para resolver dudas administrativas o acadÃ©micas.

**La soluciÃ³n:** Bot Vectorito integra en WhatsApp un asistente acadÃ©mico automatizado que centraliza informaciÃ³n clave de cursada y reduce fricciÃ³n en el acceso a datos importantes.

El objetivo del bot es acercar la informaciÃ³n acadÃ©mica al entorno donde mas interactÃºan los alumnos, simplificando el acceso a clases compartiendo los enlaces, avisos institucionales, avisos de exÃ¡menes y consultas frecuentes mediante automatizaciÃ³n e IA contextualizada.

El asistente permite:
- ðŸ“š Centralizar informaciÃ³n acadÃ©mica relevante en un Ãºnico canal.
- ðŸ”” Automatizar recordatorios, avisos y notificaciones importantes.
- ðŸ§  Responder consultas con IA contextualizada usando datos reales del calendario y la base acadÃ©mica.
- ðŸ”� Recuperar informaciÃ³n desde documentos institucionales mediante arquitectura RAG.
- ðŸ’¬ Reducir la dependencia de mensajes perdidos en grupos o foros extensos.
- âš¡ Brindar respuestas rÃ¡pidas desde una interfaz cotidiana y accesible como WhatsApp.

MÃ¡s que un bot de comandos, Vectorito actÃºa como un asistente acadÃ©mico automatizado orientado a mejorar la experiencia diaria de estudiantes del ISPC en una modalidad educativa distribuida y asincrÃ³nica.

---

## ✨ Características Principales

| Característica | Descripción |
| --- | --- |
| 🤖 **Respuestas con IA** | Generación de respuestas con contexto académico + RAG. Rigurosa objetividad (sin especulaciones ni antropomorfismo) y trato personal obligatorio por nombre de usuario. |
| 🎪 **Modo Feria** | Modo configurable (`FERIA_MODE=true`) que amplía cuotas de preguntas (50/usuario), relaja filtros de moderación y responde consultas generales de tecnología/programación. |
| 🔑 **Multi-API & Modelos** | Gestión de múltiples API keys de Gemini/Groq y autodescubrimiento del modelo de inteligencia superior disponible. |
| 📢 **Avisos de Docentes** | Publicación de avisos desde el panel docente que se integran automáticamente en WhatsApp (`!avisos`, `!semana`) con expiración temporal semanal. |
| 🔄 **Sincronización** | Sincronización bidireccional local/global en cambios de docentes, horarios y enlaces de clases. |
| 🔔 **Automatización** | Recordatorios automáticos de clases, exámenes y avisos. |
| 🗂️ **Contexto dinámico** | Perfiles, comisiones, profesores y agenda almacenados en base de datos. |
| 🔑 **Gestión Privada** | Chat privado por código para completar perfiles y ejecutar flujos de administración. |
| ⚡ **Comandos Rápidos** | Accesos directos sin IA (`!hoy`, `!examenes`, `!avisos`) para respuestas inmediatas. |
| 🛡️ **Moderación** | Detección de off-topic, advertencias, bloqueos progresivos y rate limiting. |

## ðŸ›  Stack TecnolÃ³gico

| Capa | TecnologÃ­a | PropÃ³sito |
| --- | --- | --- |
| **Runtime & Lenguaje** | Node.js 24+ / TypeScript 6+ | Entorno de ejecuciÃ³n y tipado estÃ¡tico |
| **Interfaz WhatsApp** | Baileys | ConexiÃ³n a WhatsApp vÃ­a Web Socket |
| **Panel Web** | React 19 / Vite 8 / TailwindCSS 4 | Dashboard de administraciÃ³n SPA |
| **Persistencia** | SQLite | Almacenamiento Ã¡gil de datos e Ã­ndices RAG |
| **IA & Embeddings** | Gemini 2.5 (Groq fallback) / HuggingFace Transformers | GeneraciÃ³n de respuestas y vectorizaciÃ³n |
| **AutomatizaciÃ³n** | node-cron | Tareas programadas e indexaciÃ³n incremental |
| **Integraciones** | IMAP, SMTP, RSS | Correos institucionales, notificaciones y noticias |
| **Despliegue** | Docker / Docker Compose | ContenedorizaciÃ³n y despliegue portable |

---

## ðŸ�—ï¸� Arquitectura & DiseÃ±o

El sistema emplea una combinaciÃ³n de **Vertical Slicing**, **Screaming Architecture** y **Hexagonal (Ports & Adapters)** para lograr mÃ³dulos autocontenidos, alta cohesiÃ³n y bajo acoplamiento.

- **Screaming Architecture (nivel global):** La estructura de carpetas "grita" las capacidades de negocio (`academic-calendar`, `ai`, `moderation`) en vez de capas tÃ©cnicas genÃ©ricas.
- **Vertical Slicing (nivel de aplicaciÃ³n):** Cada carpeta en `features/` es un slice completo de principio a fin (Request â†’ Logic â†’ DB).
- **Hexagonal (nivel interno):** Dentro de cada slice, modelos y lÃ³gica de negocio permanecen aislados de la infraestructura concreta.

```text
src/
â”œâ”€â”€ main.ts                         # ComposiciÃ³n raÃ­z y bootstrap
â”œâ”€â”€ features/                       # â”€â”€ SLICES VERTICALES DE NEGOCIO â”€â”€
â”‚   â”œâ”€â”€ academic-calendar/          # Clases, exÃ¡menes, profesores, comisiones
â”‚   â”‚   â”œâ”€â”€ academic-calendar.models.ts
â”‚   â”‚   â”œâ”€â”€ academic-calendar.repository.ts
â”‚   â”‚   â”œâ”€â”€ academic-calendar.service.ts
â”‚   â”‚   â”œâ”€â”€ exam-menu.service.ts / edit-exam-menu.service.ts
â”‚   â”‚   â”œâ”€â”€ comision-management.service.ts
â”‚   â”‚   â””â”€â”€ __tests__/
â”‚   â”œâ”€â”€ ai/                         # IA conversacional, RAG, rate limiting
â”‚   â”‚   â”œâ”€â”€ ai-query.service.ts / knowledge-context.service.ts
â”‚   â”‚   â”œâ”€â”€ rate-limit.service.ts / rate-limit.repository.ts
â”‚   â”‚   â”œâ”€â”€ providers/              # Gemini, Groq, Fallback, Embeddings
â”‚   â”‚   â”œâ”€â”€ rag/                    # Pipeline, consulta semÃ¡ntica, CLI
â”‚   â”‚   â””â”€â”€ __tests__/
â”‚   â”œâ”€â”€ moderation/                 # Warnings, baneos, detecciÃ³n off-topic
â”‚   â”‚   â”œâ”€â”€ moderation.models.ts / moderation.repository.ts
â”‚   â”‚   â”œâ”€â”€ user-moderation.service.ts / ban-warning-system.ts
â”‚   â”‚   â””â”€â”€ __tests__/
â”‚   â”œâ”€â”€ conversation/               # Estado de conversaciÃ³n y confirmaciones
â”‚   â”‚   â”œâ”€â”€ conversation.models.ts / conversation.repository.ts
â”‚   â”‚   â”œâ”€â”€ conversation-state.service.ts
â”‚   â”‚   â””â”€â”€ __tests__/
â”‚   â”œâ”€â”€ notifications/              # Alertas, recordatorios, IMAP, RSS, email
â”‚   â”‚   â”œâ”€â”€ notifications.repository.ts / class-notification.service.ts
â”‚   â”‚   â”œâ”€â”€ exam-notification.service.ts / scheduled-reminder.service.ts
â”‚   â”‚   â”œâ”€â”€ integrations/           # EmailService, IMAP monitor, RSS parser
â”‚   â”‚   â””â”€â”€ __tests__/
â”‚   â””â”€â”€ messages/                   # Enrutamiento, intenciones, de-duplicaciÃ³n
â”‚       â”œâ”€â”€ message-router.service.ts / message-intent-parser.service.ts
â”‚       â”œâ”€â”€ dynamic-message.service.ts
â”‚       â””â”€â”€ __tests__/
â”œâ”€â”€ shared/                         # â”€â”€ COMPONENTES TRANSVERSALES â”€â”€
â”‚   â”œâ”€â”€ config/                     # ConfiguraciÃ³n de entorno
â”‚   â”œâ”€â”€ db/                         # SQLite: database, migrations, db-utils
â”‚   â””â”€â”€ logging/                    # Servicio de logs
â”œâ”€â”€ interfaces/                     # â”€â”€ ADAPTADORES DE ENTRADA/SALIDA â”€â”€
â”‚   â””â”€â”€ whatsapp/                   # Baileys gateway
â””â”€â”€ scheduler/                      # â## âš™ï¸� InstalaciÃ³n y ConfiguraciÃ³n

### Requisitos Previos
* Node.js 24.x+ y npm 10.x+
* Git
* Cuenta de WhatsApp (cualquier nÃºmero)
* API Key de Gemini (Google AI Studio)

### OpciÃ³n 1: InstalaciÃ³n Local

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
    GEMINI_API_KEY=tu_gemini_api_key_principal
    GEMINI_API_KEY_1=tu_gemini_api_key_secundaria_opcional
    GROQ_API_KEY=tu_groq_api_key_fallback
    FERIA_MODE=false
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
4. **Vincular WhatsApp:** Escanea el cÃ³digo QR que aparecerÃ¡ en la terminal desde `Dispositivos vinculados` en tu app de WhatsApp. Escribe `!menu` en el grupo para verificar.
5. **Acceder al panel web:** AbrÃ­ `http://localhost:3000` en tu navegador.

### OpciÃ³n 2: Despliegue con Docker ðŸ�³

La forma mÃ¡s simple y portable de desplegar el bot.

1. **Requisitos:** [Docker](https://docs.docker.com/get-docker/) y [Docker Compose](https://docs.docker.com/compose/install/) instalados.

2. **Clonar y configurar:**
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd bot-vectorito
   cp .env.example .env
   # Editar .env con tus claves y configuraciÃ³n
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

> **Nota:** La sesiÃ³n de WhatsApp y la base de datos se persisten automÃ¡ticamente en las carpetas `./session/` y `./data/` respectivamente. Estas carpetas sobreviven a reinicios y reconstrucciones del contenedor.

> **Nota:** La TUI (interfaz de consola dividida) está **habilitada por defecto** en Docker gracias a `stdin_open: true` y `tty: true` en el `docker-compose.yml`. Para ver la interfaz en tiempo real, usá `docker attach bot-vectorito`. Si preferís modo headless, cambiá `TUI_ENABLED=false` en el `docker-compose.yml`.
>
> **Tip:** Si los colores o bordes de la TUI se ven rotos, asegurate de tener `TERM=xterm-256color` configurado (ya incluido por defecto en el compose).

---

## ConfiguraciÃ³n de grupos

Los grupos se gestionan automÃ¡ticamente en la base de datos SQLite. Ya no se configuran en el archivo `.env`.

### Agregar un grupo nuevo

1. Un admin global agrega el bot al grupo de WhatsApp.
2. El bot se registra automÃ¡ticamente y envÃ­a un mensaje privado al admin con instrucciones de configuraciÃ³n.
3. El admin asigna el contexto acadÃ©mico inicial por privado con el comando:
   `!config-grupo [groupId] aÃ±o:[N] turno:[maÃ±ana|tarde|noche]`
   
   *Ejemplo:*
   `!config-grupo 120123456789-1234567890@g.us aÃ±o:2 turno:tarde`

4. El bot iniciarÃ¡ un asistente interactivo en el chat privado del administrador:
   - **Camada y comisiones**: Se crearÃ¡ el aÃ±o y nÃºmero de comisiones acadÃ©micas.
   - **Materias y Profesores**: Por cada materia ingresada, se solicitarÃ¡ su dÃ­a/hora y enlace de Meet, seguido del nombre y email de su profesor (`Nombre|email@ispc.edu.ar`). Estos pasos se pueden omitir ingresando `skip`.
   - **Emails de la cohorte**: Al finalizar las materias, se solicitarÃ¡ ingresar la lista de emails de clase de la cohorte separados por comas (`etiqueta|email, etiqueta|email`, ej: `TutorÃ­a|tutor@ispc.edu.ar, BedelÃ­a|bedelia@ispc.edu.ar`). Se puede omitir ingresando `skip` o `mas tarde`.

5. El bot confirma la configuraciÃ³n definitiva dentro del grupo.

### MigraciÃ³n desde versiÃ³n anterior

Si venÃ­as usando `WHATSAPP_GROUP_ID` o `WHATSAPP_GROUP_ID_2` en tu `.env`, el bot los migra automÃ¡ticamente a la BD en el primer arranque. PodÃ©s eliminar esas variables del `.env` despuÃ©s del primer inicio exitoso.

---

## ðŸ¤– Comandos y Uso

El bot soporta dos modos: **comandos rÃ¡pidos** (con `!`) y **consultas con IA contextualizada** (lenguaje natural o mediante menciÃ³n con `@`).

### ðŸ”¹ Consultas con IA

**En el grupo:** EscribÃ­ preguntas en lenguaje natural. El bot responde con contexto acadÃ©mico del calendario y documentos institucionales.

Ejemplos:
- *"Â¿CuÃ¡ndo es el examen de Estructuras?"*
- *"QuÃ© materias tengo que ver esta semana?"*
- *"Me falta CÃ¡lculo, Â¿cuÃ¡ndo se recupera?"*

**Mencionar al bot (@vectorito):** Si quieres forzar una respuesta con IA en un contexto especÃ­fico, menciona al bot con `@vectorito` seguido de tu pregunta:
- `@vectorito Â¿CuÃ¡les son las fechas de los exÃ¡menes finales?`
- `@vectorito Necesito correlativas de Algoritmos`

### ðŸ”¹ Comandos rÃ¡pidos (En Grupos)

| Comando | Alias | DescripciÃ³n |
| --- | --- | --- |
| `!menu` | `!m` | Abre el menÃº interactivo con opciones de navegaciÃ³n |
| `!config-grupo [groupId] aÃ±o:[N] turno:[turno]` | `!cg` | Asigna contexto acadÃ©mico a un grupo |
| `!hoy` | `!clases` | Muestra las clases/materias del dÃ­a (fecha, horario, profesor) |
| `!enlace` | `!e` | Devuelve el enlace de Meet/Zoom de la clase en curso o prÃ³xima (ventana 10 min antes) |
| `!examenes` | `!ex` | Lista los prÃ³ximos exÃ¡menes (fecha, hora, tipo, comisiÃ³n) |
| `!avisos` | `!av` | Avisos e informes institucionales vigentes |
| `!semana` | `!s` | Agenda acadÃ©mica de esta semana |
| `!semana-que-viene` | `!sv` | Agenda de la prÃ³xima semana |
| `!noticias` | `!n` | Ãšltimas noticias de tecnologÃ­a (RSS) |
| `!help` | `!he` | Muestra ayuda con todos los comandos disponibles |

### ðŸ”¹ Chat Privado (GestiÃ³n y AdministraciÃ³n)

**Registro de usuario:** El bot te pedirÃ¡ que completes tu perfil (nombre, cumpleaÃ±os, email, comisiÃ³n) en privado.

## Niveles de administrador

### Admin global
- Acceso completo a todas las funciones del bot
- Puede agregar el bot a grupos nuevos
- Puede asignar el contexto acadÃ©mico de cualquier grupo
- Puede designar admins de grupo
- Se registra con el cÃ³digo semilla definido en `ADMIN_SEED_CODES`

### Admin de grupo
- Acceso restringido a su grupo asignado
- Puede cargar exÃ¡menes y materias de su comisiÃ³n
- Puede subir PDFs al RAG de su grupo
- Puede gestionar avisos dirigidos a su grupo
- No puede configurar el contexto del grupo ni agregar el bot a nuevos grupos
- Es designado por un admin global

**Comandos administrativos:** Requieren autenticaciÃ³n previa con `!soyadmin [codigo]`:
- `!panel`: Panel de administraciÃ³n general
- `!agregarexamen`: Crear nuevo examen en el calendario
- `!editarexamen`: Editar examen existente
- `!eliminaravisos`: Limpiar avisos vencidos
- `!log-moderacion`: Ver estadÃ­sticas de moderaciÃ³n y bloqueos
- `!log-errores`: Ver log de errores del bot
- `!stats`: EstadÃ­sticas generales de uso
- `!rag-upload global`: Sube PDF al RAG global (enviar como adjunto con este caption)
- `!rag-upload [groupId]`: Sube PDF al RAG de un grupo especÃ­fico
- `!config-grupo [groupId] aÃ±o:[N] turno:[turno]`: Asigna contexto acadÃ©mico a un grupo

## RAG por grupo

Los documentos se organizan en dos niveles:

- **Global** (`data/ai-context/global/`): accesible desde cualquier grupo. Para informaciÃ³n institucional general como correlatividades o reglamentos.
- **Por grupo** (`data/ai-context/[group_id]/`): accesible solo desde ese grupo. Para informaciÃ³n especÃ­fica de un aÃ±o o comisiÃ³n.

Para subir documentos desde WhatsApp, enviÃ¡ el PDF en chat privado con el bot usando como caption:
!rag-upload global
!rag-upload 120123456789-1234567890@g.us

Los documentos que ya estaban en `data/ai-context/` antes de esta versiÃ³n se tratan automÃ¡ticamente como scope global.

---

## 🎪 Modo Feria de Ciencias

El bot incluye un **Modo Feria de Ciencias** especial, diseñado para cuando se expone el proyecto al público o a evaluadores, flexibilizando las restricciones habituales para permitir una interacción rápida, fluida y sin bloqueos.

### ¿Cómo se activa?
Se activa definiendo la variable de entorno `FERIA_MODE=true` en el archivo `.env`.

### Comportamiento del Bot en Modo Feria:
1. **Límites de Preguntas Ampliados**: La cuota diaria por usuario de WhatsApp se eleva automáticamente de 2 preguntas regulares a **50 preguntas**, permitiendo que los visitantes prueben el bot repetidamente.
2. **Relajación de Filtros y Moderación**: Se suspenden temporalmente el guardrail semántico local de desvío de tema (off-topic), la validación de comisión de cursado (cualquier usuario no registrado puede consultar) y las penalizaciones por spam o warnings.
3. **Instrucciones de IA Extendidas**: Se inyectan directivas dinámicas (`FERIA_BOT_INSTRUCTIONS`) para que el bot responda con solvencia preguntas generales sobre tecnología, lenguajes de programación, inteligencia artificial, RAG y ciencia de datos, vinculándolas al contexto académico del ISPC.
4. **Control del Saludo de Feria**: Para evitar que la IA mencione repetitivamente la feria en cada mensaje, el bot está instruido a saludar y dar la bienvenida a la feria únicamente en el primer mensaje de la sesión de chat del usuario.
5. **Respuestas Educadas ante Preguntas Inapropiadas**: En lugar de ignorar o bloquear silenciosamente las consultas con groserías o fuera de lugar, el bot responde directamente de manera educada que no puede contestar ese tipo de preguntas.
6. **Priorización de API Keys y Modelos**: Admite múltiples API keys (`GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`...) y consulta de forma dinámica los modelos autorizados en tu cuenta de Google AI Studio, seleccionando la versión más inteligente disponible en orden de prioridad de razonamiento (ej: Gemini 3.5 Pro -> Gemini 3.5 Flash -> fallback de Groq).

---

## ðŸŒ Panel Web de AdministraciÃ³n

El bot incluye un panel web embebido accesible en `http://localhost:3000` (o la URL configurada en `BASE_URL`).

### Acceso al Panel

El acceso se realiza mediante **autenticaciÃ³n OTP por correo electrÃ³nico**:
- **Super Administradores y Administradores**: Escriben `!panel` en el chat privado con el bot para recibir un enlace de login con cÃ³digo OTP.
- **Profesores**: Pueden enviar un email con asunto `panel` al correo institucional del bot, o escribir `!panel` en el chat privado. Si su WhatsApp no estÃ¡ vinculado, se les envÃ­a un cÃ³digo de verificaciÃ³n a su email institucional.
- **Acceso directo**: El enlace de login incluye el email y cÃ³digo OTP pre-completados para ingreso con un solo click.

### Roles y Funcionalidades

| Rol | Funcionalidades |
| --- | --- |
| ðŸ›¡ï¸� **Super Admin** | GestiÃ³n global de grupos, materias, profesores, comisiones, calendario acadÃ©mico, ciclo lectivo, administradores, emails autorizados, simulaciÃ³n de alumnos, ajustes y temas |
| ðŸ”‘ **Admin de Grupo** | Vista acotada a su grupo con lectura de calendario, administradores y horarios |
| ðŸ�« **Personal Institucional** | EdiciÃ³n de hitos del ciclo lectivo, feriados, horarios de clase, enlaces de Meet y datos docentes |
| ðŸ‘¨â€�ðŸ�« **Profesor** | Calendario de evaluaciones, registro/ediciÃ³n de exÃ¡menes propios, agenda de clases, mensajerÃ­a bidireccional con alumnos vÃ­a WhatsApp, verificaciÃ³n de telÃ©fono OTP |

### CompilaciÃ³n del Frontend

```bash
npm run install:web   # Instalar dependencias del frontend
npm run build:web     # Compilar el panel web (React/Vite/TailwindCSS)
```

El panel se sirve estÃ¡ticamente desde `web/dist/`. Si no estÃ¡ compilado, el servidor HTTP responde con un mensaje indicando ejecutar `npm run build:web`.

---

## ðŸ“– Desarrollo y Decisiones TÃ©cnicas

### Scripts Ãštiles
```bash
npm run dev           # Hot reload (Bot + Web) con recompilaciÃ³n automÃ¡tica
npm run build         # CompilaciÃ³n TypeScript del backend
npm run build:web     # CompilaciÃ³n del panel web (React/Vite)
npm run install:web   # Instalar dependencias del frontend
npm run test          # Ejecutar tests con Vitest (watch)
npm run test:vitest   # Ejecutar tests una sola vez
npm run rag:index     # Indexa PDFs nuevos en data/ai-context/
npm run rag:test      # Prueba interactiva del motor RAG
npm run rag:status    # Estado del Ã­ndice RAG
npm run rag:reindex   # Re-indexar todo el contenido RAG
npm run cleanup:data  # âš ï¸� Limpia la BD y vectores
```

### Â¿Por quÃ© esta arquitectura?
* **RAG vs Fine-tuning:** Se eligiÃ³ RAG porque permite actualizar fechas, manuales y PDF institucionales sin costos de reentrenamiento, garantizando respuestas explicables y referenciadas.
* **Contexto Mixto (RAG + SQLite):** RAG procesa documentos estÃ¡ticos, pero la BD maneja el conocimiento "caliente" (quÃ© alumno pregunta, de quÃ© comisiÃ³n es, quÃ© clase toca hoy).
* **Baileys vs API Oficial:** Para esta etapa Alpha, Baileys permite iterar rÃ¡pido y gratis en grupos estÃ¡ndar. La lÃ³gica estÃ¡ desacoplada para facilitar una futura migraciÃ³n a la WhatsApp Business API.
* **ModeraciÃ³n:** El sistema progresivo (warnings â†’ ban temporal) asegura el acceso democrÃ¡tico y educa al usuario antes de penalizarlo.
* **Panel Web Embebido:** El servidor HTTP nativo de Node.js sirve la API REST y la SPA sin necesidad de un reverse proxy adicional. Esto simplifica el despliegue y mantiene todo en un Ãºnico proceso.
* **Docker Multi-Stage:** La imagen de producciÃ³n excluye herramientas de compilaciÃ³n, reduciendo significativamente el tamaÃ±o final.

---

## â�“ FAQ

* **Â¿Necesito Docker para usar el bot?** No. Docker es opcional. PodÃ©s instalar Node.js y ejecutar el bot directamente con `npm start`.
* **Â¿CÃ³mo accedo al panel web?** AbrÃ­ `http://localhost:3000` y logueate con tu email usando el cÃ³digo OTP que recibÃ­s al escribir `!panel` al bot.
* **Â¿Puedo cambiar el puerto del servidor HTTP?** El puerto estÃ¡ hardcodeado en `3000`. Para cambiar el puerto, podÃ©s usar Docker Compose mapeando `"8080:3000"` en el archivo `docker-compose.yml`.

---

## ðŸ“¬ ConfiguraciÃ³n y AutorizaciÃ³n Avanzada de Avisos por Email

El bot incluye un flujo robusto para procesar correos electrÃ³nicos y publicarlos como avisos institucionales en los grupos correspondientes de WhatsApp.

### ðŸ“§ Asunto del Correo y Formato Estructurado
El monitor de correos procesa cualquier email que contenga la palabra **"aviso"** (de forma insensible a mayÃºsculas/minÃºsculas, ej: "aviso", "Aviso", "AVISO") en su asunto.
- Si el cuerpo del email posee formato estructurado con el campo `cuerpo:` o `mensaje:` obligatorio, se publica de inmediato en WhatsApp.
- Si el correo carece de estructura o tiene placeholders vacÃ­os, el bot responde de forma automÃ¡tica al emisor enviando una plantilla interactiva en **formato HTML y texto plano**. Dicha respuesta coloca la plantilla al inicio para fÃ¡cil copia, sugiere el uso de Inteligencia Artificial (ChatGPT, Gemini, Claude) para completarla y simplifica la lista de opciones para el campo `grupo:` mostrando Ãºnicamente las cohortes (camadas) y selectores generales disponibles para evitar ruido visual.

### ðŸ‘‘ AutorizaciÃ³n de Remitentes y Roles DinÃ¡micos
El bot valida y autoriza la publicaciÃ³n de avisos desde correos electrÃ³nicos o flujos de WhatsApp y asigna dinÃ¡micamente el rol del remitente (`super-admin`, `admin`, `profe`, o `colaborador`) en el mensaje final publicado en WhatsApp (ej: *El/La super-admin [Nombre] dejo un aviso...*):
1. El remitente es un **Superadministrador** definido en la variable de entorno `SUPERADMIN_EMAILS` (lista separada por comas) -> Rol: `super-admin`.
   ```env
   SUPERADMIN_EMAILS=admin@instituto.edu.ar, director@instituto.edu.ar
   ```
2. El remitente es un **Administrador** registrado en la base de datos (con email en su perfil de usuario) -> Rol: `admin`.
3. El remitente es un **Profesor** registrado en la base de datos (tabla `managed_teachers`) -> Rol: `profe`.
4. El remitente es un **Correo Autorizado Personalizado** registrado en la tabla `authorized_emails` -> Rol: `colaborador`. Los administradores pueden gestionar esta lista desde WhatsApp en el submenÃº de gestiÃ³n de avisos.

Todos los correos son normalizados (eliminando espacios y comparando en minÃºsculas) para una validaciÃ³n segura y robusta. Al crear avisos desde WhatsApp, el bot registra automÃ¡ticamente el correo del administrador como `source_email` para asegurar la correcta resoluciÃ³n de su rol y nombre en envÃ­os programados periÃ³dicos.

### ðŸ’¬ Respuesta a Avisos desde WhatsApp (`!responderid`)
Cuando un aviso es publicado en WhatsApp, se incluye su ID Ãºnico autoincremental en el mensaje (ej: `(ID: 42)`). Los superadministradores pueden responder al emisor original del aviso enviando el comando:
```text
!responderid[ID] [mensaje]
```
o
```text
!responderid [ID] [mensaje]
```
El bot enviarÃ¡ de inmediato un correo electrÃ³nico al emisor original del aviso conteniendo la respuesta del superadministrador junto con los datos de contexto del aviso original.

### ðŸ”’ SoluciÃ³n de Errores de Certificado TLS Auto-firmado (`SELF_SIGNED_CERT_IN_CHAIN`)
Si tu servidor de correo IMAP corporativo o proxy local utiliza certificados auto-firmados, **nunca deshabilites** la seguridad global de Node (`NODE_TLS_REJECT_UNAUTHORIZED=0`). En su lugar, el bot permite configurar una conexiÃ³n TLS segura y especÃ­fica para IMAP:

1. **Permitir certificados auto-firmados en el buzÃ³n IMAP:**
   Si confÃ­as plenamente en la red y deseas omitir la validaciÃ³n de la firma en la cadena de conexiÃ³n IMAP, puedes configurar:
   ```env
   IMAP_TLS_REJECT_UNAUTHORIZED=false
   ```
2. **Usar una CA corporativa/personalizada de forma segura:**
   Si cuentas con el archivo del certificado de la Autoridad de CertificaciÃ³n (`.pem` / `.crt`), puedes apuntar el bot al archivo para que sea validado y aceptado en el proceso de Handshake TLS:
   ```env
   IMAP_TLS_CA_PATH=C:/ruta/a/mi_ca_corporativa.pem
   IMAP_TLS_SERVERNAME=mi-servidor-imap.instituto.edu.ar
   ```
Esto mantendrÃ¡ el resto de las conexiones externas del bot (por ejemplo, llamadas a la API de WhatsApp, Gemini o integraciones externas) con la validaciÃ³n de certificados estÃ¡ndar y protegidas.

---

**Hecho para estudiantes del ISPC.**
