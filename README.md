# 🤖 Bot Cabezón

**Asistente académico automatizado para WhatsApp orientado a estudiantes del ISPC**

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5%2B-blue?logo=typescript)](https://www.typescriptlang.org/)
[![RAG](https://img.shields.io/badge/Architecture-RAG-orange)](https://en.wikipedia.org/wiki/Retrieval-augmented_generation)
[![License](https://img.shields.io/badge/License-MIT-gray)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Alpha%202.1.0-alpha.1-yellow)](CHANGELOG.md)

Bot Cabezón es un asistente académico automatizado diseñado para centralizar y simplificar el acceso a la información de cursada para los estudiantes de la Tecnicatura Superior en Desarrollo de Software del ISPC (Instituto Superior Politécnico Córdoba).

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

**La solución:** Bot Cabezón integra en WhatsApp un asistente académico automatizado que centraliza información clave de cursada y reduce fricción en el acceso a datos importantes.

El objetivo del bot es acercar la información académica al entorno donde mas interactúan los alumnos, simplificando el acceso a clases compartiendo los enlaces, avisos institucionales, avisos de exámenes y consultas frecuentes mediante automatización e IA contextualizada.

El asistente permite:
- 📚 Centralizar información académica relevante en un único canal.
- 🔔 Automatizar recordatorios, avisos y notificaciones importantes.
- 🧠 Responder consultas con IA contextualizada usando datos reales del calendario y la base académica.
- 🔍 Recuperar información desde documentos institucionales mediante arquitectura RAG.
- 💬 Reducir la dependencia de mensajes perdidos en grupos o foros extensos.
- ⚡ Brindar respuestas rápidas desde una interfaz cotidiana y accesible como WhatsApp.

Más que un bot de comandos, Cabezón actúa como un asistente académico automatizado orientado a mejorar la experiencia diaria de estudiantes del ISPC en una modalidad educativa distribuida y asincrónica.

---

## ✨ Características Principales

| Característica | Descripción |
| --- | --- |
| 🤖 **Respuestas con IA** | Generación de respuestas con contexto académico + RAG sobre PDFs institucionales. |
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
| **Runtime & Lenguaje** | Node.js 20+ / TypeScript 5+ | Entorno de ejecución y tipado estático |
| **Interfaz** | Baileys | Conexión a WhatsApp vía Web Socket |
| **Persistencia** | SQLite | Almacenamiento ágil de datos e índices RAG |
| **IA & Embeddings** | Gemini 2.5 (Groq fallback) / Google Embeddings | Generación de respuestas y vectorización |
| **Automatización** | node-cron | Tareas programadas e indexación incremental |
| **Integraciones** | IMAP, RSS | Lectura de correos institucionales y noticias |

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
└── scheduler/                      # ── TAREAS EN SEGUNDO PLANO ──
    └── scheduler-service.ts        # Cron jobs del sistema
```

**Flujo de una consulta con IA:**
1. Mensaje recibido → `WhatsAppGateway` valida permisos.
2. `MessageRouterService` (features/messages) deriva a `AIQueryService` (features/ai).
3. Se verifica moderación (features/moderation) y rate limit (features/ai).
4. Se ensambla el contexto uniendo datos de SQLite y búsqueda RAG (features/ai/rag).
5. El modelo de IA genera la respuesta contextualizada y se envía al grupo.

---

## ⚙️ Instalación y Configuración

### Requisitos Previos
* Node.js 20.x+ y npm 10.x+
* Git
* Cuenta de WhatsApp (cualquier número)
* API Key de Gemini (Google AI Studio)

### Pasos

1. **Clonar e instalar dependencias:**
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd bot-cabezon
   npm install
   ```
2. **Configurar entorno: **
   Copia `.env.example` a `.env` y completa las variables clave:
   ```env
   ADMIN_PASSWORD=tu_password_fuerte
   ADMIN_SEED_CODES=123456,654321
   GEMINI_API_KEY=tu_gemini_api_key
   SQLITE_PATH=data/chatbot.db
   ```
3. **Compilar e iniciar:**
   ```bash
   npm run build
   npm start # Para desarrollo: npm run dev
   ```
4. **Vincular WhatsApp:** Escanea el código QR que aparecerá en la terminal desde `Dispositivos vinculados` en tu app de WhatsApp. Escribe `!menu` en el grupo para verificar.

## Configuración de grupos

Los grupos se gestionan automáticamente en la base de datos SQLite. Ya no se configuran en el archivo `.env`.

### Agregar un grupo nuevo

1. Un admin global agrega el bot al grupo de WhatsApp
2. El bot se registra automáticamente y envía un mensaje privado al admin con instrucciones de configuración
3. El admin asigna el contexto académico con el comando:
!config-grupo [groupId] año:[N] turno:[mañana|tarde|noche]

Ejemplo:
!config-grupo 120123456789-1234567890@g.us año:2 turno:tarde

4. El bot confirma la configuración dentro del grupo

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

**Mencionar al bot (@cabezon):** Si quieres forzar una respuesta con IA en un contexto específico, menciona al bot con `@cabezon` seguido de tu pregunta:
- `@cabezon ¿Cuáles son las fechas de los exámenes finales?`
- `@cabezon Necesito correlativas de Algoritmos`

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

## 📖 Desarrollo y Decisiones Técnicas

### Scripts Útiles
```bash
npm run dev           # Hot reload con recompilación automática
npm run build         # Compilación TypeScript
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

---

## ❓ FAQ

* **En desarrollo**

---

**Hecho para estudiantes del ISPC.**
