# Changelog

Todas las modificaciones notables de este proyecto serán documentadas en este archivo.

## [0.2.1-alpha.3] - Unreleased

### Agregado
- **Sistema de Avisos Cohesivo, Autorización por Email y Frecuencias**:
  - Unificación del sistema de avisos institucionales para admitir creación tanto desde correos electrónicos (con asunto que contenga la palabra "aviso") como desde el chat privado de WhatsApp de administradores.
  - Creación de la tabla `authorized_emails` y del repositorio `AuthorizedEmailRepository` para gestionar remitentes autorizados personalizados, con submenú interactivo en WhatsApp para listar, agregar y remover correos.
  - Optimización de la plantilla de WhatsApp para avisos, mostrando el ID autoincremental del aviso, nombre del emisor (resuelto desde profesores, administradores o remitentes personalizados) y correo.
  - Respuestas automáticas por correo explicativas con la plantilla estructurada de aviso y la lista dinámica de grupos/camadas disponibles cuando el email recibido no posee formato estructurado.
  - Emisión de recordatorios recurrentes según frecuencia en días programada para el aviso, controlados por una tarea periódica del planificador (`SchedulerService`).
  - Comando administrativo `!responderid` para que los superadministradores de WhatsApp puedan responder al emisor de un aviso vía correo electrónico directamente desde el chat.
- **Visualización Depurada de Calendario y Avisos**:
  - El comando `!semana` ahora muestra los avisos únicamente en su fecha exacta de inicio (marcado como `Inicio:`) y finalización (marcado como `Límite:`).
  - El comando `!avisos` resalta dinámicamente la fecha de vencimiento del aviso con una advertencia `⚠️ Tienes hasta el [end_date] para realizar esta actividad`.
- **Modo Simulación Alumno para Administradores**:
  - Incorporación de una nueva funcionalidad que permite a los Administradores y Super-Administradores simular ser alumnos desde el chat privado y probar de forma idéntica todas las features del bot en grupos y privado (como cuotas, agendas y comisiones).
  - Creación del submenú de simulación interactivo (`submenu_impersonation`) accesible desde el menú de Super-Admin (Opción 4) y el menú de Admin normal/scoped (Opción 9).
  - Opciones de simulación interactiva: Activar/desactivar simulación, cambiar comisión simulada, personalizar el límite diario de consultas, reiniciar la cuota diaria en base de datos para pruebas rápidas y ver la información del perfil simulado.
  - Intercepción a nivel de Gateway de WhatsApp para anular los privilegios de administración (`isSuperAdmin`, `isGlobalAdmin`, `isGroupAdmin`) cuando la simulación está activa para el usuario emisor.
  - Adaptación de `RateLimitService`, `AIQueryService`, `KnowledgeContextService` y `AcademicCalendarService` para usar la comisión y límites diarios simulados en lugar de los reales del usuario.
  - Suite de pruebas unitarias (`impersonation.spec.ts`) cubriendo la persistencia de simulación, la aplicación de límites personalizados y reinicio de cuotas.
- **Protección contra Prompt Leakage (BUG-001)**:
  - Implementación de un filtro por expresiones regulares a nivel de código (`AIQueryService.answer`) que intercepta intentos maliciosos de extraer directivas, instrucciones, system prompts o configuraciones internas del bot, retornando un mensaje neutral de fallback sin consumir cuota de API ni llamar al modelo.
  - Consolidación y robustecimiento de las instrucciones del sistema (`DEFAULT_BOT_INSTRUCTIONS`) en un único archivo compartido (`src/shared/config/instructions.ts`), agregando guardrails restrictivos para evitar la divulgación de las directivas ante solicitudes indirectas o juegos de rol.
  - Creación de un nuevo archivo de pruebas unitarias (`prompt-leakage.spec.ts`) para validar y certificar el bloqueo de inyecciones maliciosas y la correcta continuidad de consultas académicas legítimas.
- **Detección Dinámica de Datos Ausentes**: Monitoreo de consultas (vía IA) sobre clases, exámenes o profesores cuando no hay registros en la base de datos para el grupo. El Gateway de WhatsApp ahora intercepta estas consultas, notifica de manera privada a los administradores del grupo (o superadmins como fallback) e informa públicamente en el grupo solicitando su carga.
- **Alertas de Configuración Faltante**: El Gateway de WhatsApp ahora notifica de forma proactiva y privada a los administradores del grupo cuando un usuario intenta usar comandos rápidos (`!hoy`, `!examenes`, etc.) en un grupo sin configuración académica.
- **Onboarding de Grupo Extendido (Profesores y Emails)**:
  - En la configuración de materias (`!config-grupo`), el bot ahora solicita secuencialmente el nombre y correo del profesor asignado para cada materia/comisión (permitiendo saltear con `skip`).
  - Al terminar las materias, solicita registrar la lista de emails de clase de la cohorte en formato `etiqueta|email` separados por comas (salteable con `skip` o `mas tarde`).
- **Enrutamiento de Avisos de Profesor Multi-Grupo**: Un profesor puede estar registrado para dictar en múltiples grupos/camadas con un único correo. El monitor IMAP valida y restringe la publicación del aviso estrictamente a los grupos autorizados para el remitente, permitiendo enviar a todos sus grupos por defecto o filtrar según selector de camada.
- **Conexión de Profesores y Avisos en Contexto IA**: En `buildContext`, se vinculan los avisos institucionales con el profesor emisor basándose en su correo para inyectar la relación a la IA, permitiendo responder a preguntas como *"¿el profesor de programación dejó algún aviso?"* de forma natural.
  - **Tablero de Supervisión TUI (Interfaz de Consola Dividida)**:
    - Implementación de una interfaz gráfica de terminal (TUI) autocontenida basada en `neo-blessed` que se activa mediante `TUI_ENABLED=true` en `.env`.
    - División vertical de la pantalla al 50% en dos visualizadores continuos: el **Panel Izquierdo** para el flujo de conversaciones de WhatsApp y trazas del proceso RAG/IA (incluyendo validación de comisiones, hits de contexto y llamadas al LLM), y el **Panel Derecho** para logs generales de infraestructura y errores del sistema.
    - Implementación de un interceptor de stream seguro (`StreamInterceptor`) que intercepta directamente el objeto `console` global con control de recursión (`activeInterceptions`) y limpiador de códigos ANSI (`stripAnsi`), evitando interferencias con el motor de dibujo de Blessed.
    - Integración de barras de scroll visuales e independientes para cada panel (amarillo/cian).
    - Soporte de scroll independiente por mouse "hover" (sin necesidad de hacer foco previo) y foco alternado vía teclado (tecla `Tab`) para navegar el historial completo (scrollback de 10k líneas).
    - Forzado automático de codificación UTF-8 (`chcp 65001`) en entornos Windows para la correcta renderización de emojis y bordes de paneles.
    - Extracción automática de números de teléfono de estudiantes y representación de contextos de grupo (nombre y camada) en el flujo del chat.
    - **Refinamiento y Colores del Tablero TUI**:
      - **Filtro de Logs Redundantes**: Supresión completa del flujo de mensajes en bruto (`📩` y `📤`) en el panel derecho de infraestructura cuando la TUI está activa, evitando logs duplicados.
      - **Resolución de JID/LID a Teléfono Real**: Extracción automática de JIDs telefónicos alternativos (`participantAlt` / `remoteJidAlt`) proporcionados por Baileys. Las consultas a la base de datos de perfiles ahora buscan tanto por el JID de envío (que puede ser un Linked ID `@lid`) como por el JID real de teléfono, mostrando siempre `Nombre del Estudiante (Teléfono Real)` o el teléfono real en su defecto en el panel de conversación.
      - **Colores Semánticos y Accesibles**: Aplicación de colores automáticos mediante Blessed en el panel derecho de logs (Verde para éxitos y conexiones, Amarillo/Naranja para advertencias, bloqueos y reintentos, Rojo para excepciones y errores graves).
      - **Identificación de Origen (Tags)**: Las etiquetas bracketed al inicio de las líneas de log (ej. `[BD]`, `[RAG]`, `[IA]`, `[WhatsApp]`, `[Scheduler]`, etc.) se colorean de manera independiente con su propio tono visual persistente para identificar de un vistazo el origen de los flujos.
      - **Trazabilidad Completa del Flujo**: Nuevas trazas de depuración interna (`⚙️ [PROCESO RAG]`) en el panel izquierdo que documentan intentos de Prompt Leakage bloqueados, consultas poco claras (`unclear`), clasificaciones off-topic con su acción de moderación, bloqueos a usuarios baneados y control de cuotas diarias de IA consumidas o denegadas (con conteo de preguntas restantes).

### Corregido
- **Corrección en Consulta de Perfiles de Usuario**: Corrección del error `no such column: display_name` en las consultas de la tabla `user_profiles`. Se cambió el campo a `name` para alinearlo con la definición de esquema real del sistema.
- **Publicación Inmediata de Avisos Futuros**: Corrección de la lógica de publicación para que los avisos con fecha de inicio en el futuro se publiquen inmediatamente por WhatsApp al ser recibidos o creados (sirviendo como primer anuncio), delegando la periodicidad al planificador Scheduler.
- **Respuestas Especulativas y Falta de Rigidez (BUG-013)**:
  - Mitigación del comportamiento especulativo, giros subjetivos corporativos y simulación de autoconciencia o antropomorfismo en el chatbot.
  - Actualización de las directivas en `src/shared/config/instructions.ts` (`DEFAULT_BOT_INSTRUCTIONS`) para prohibir terminantemente emitir opiniones personales, juicios de valor, o simular emociones/características humanas.
  - Modificación del trato por nombre del usuario para ser **estrictamente obligatorio** en todas las respuestas cuando el nombre esté disponible en el perfil del usuario del contexto.
  - Creación de pruebas unitarias en `src/features/ai/__tests__/domain-guardrails.spec.ts` para verificar la presencia de estas restricciones y la obligatoriedad de la inyección del nombre.
- **Alucinación Creativa ante Prompts de Engaño (BUG-009)**:
  - Mitigación de la vulnerabilidad ante solicitudes de generación creativa (ej. historias de ficción, poemas, cuentos, chistes, juegos de rol) disfrazadas como ayuda de materias académicas.
  - Reducción de la temperatura del modelo a `0.1` tanto en Gemini (`GeminiService`) como en Groq (`GroqProvider`) para propiciar respuestas estructuradas, lógicas y no creativas.
  - Refuerzo en las directivas de comportamiento del sistema (`DEFAULT_BOT_INSTRUCTIONS`) con reglas prioritarias de restricción de dominio y no-creatividad.
  - Corrección de la importación y tipado de `ParsedMessage` en las pruebas unitarias de conversación (`conversation.spec.ts`).
  - Creación de un suite de pruebas de guardrails de dominio (`domain-guardrails.spec.ts`) para verificar la configuración de temperaturas y directivas.
  - Intercepción de `console.info` en `vectorito-whatsapp-gateway.ts` para silenciar el volcado de sesiones (`SessionEntry`) de `libsignal` que ensuciaba la consola TUI.
  - Eliminación de la advertencia `console.warn` para mensajes de grupo sin texto reconocible (como stickers o reacciones), reduciendo ruido visual.
- **Bypass e Inconsistencia en el Contador del Límite Diario (BUG-005)**:
  - Se resolvió la condición de carrera en solicitudes simultáneas serializando las consultas y actualizaciones del límite por cada usuario mediante un mecanismo de cola/bloqueo basado en promesas en `RateLimitService`.
  - Se movió el descuento de la cuota (`checkAndConsume`) al inicio del proceso de generación en `AIQueryService.generateAnswer` para evitar el procesamiento innecesario de prompts e inyecciones a la IA cuando el cupo ya está agotado.
  - Se eliminó la fuga de respuestas al retornar únicamente el mensaje de bloqueo (sin concatenar el texto generado por la IA) cuando la cuota no es aprobada.
  - Se refactorizaron y personalizaron los mensajes del bot para cada uno de los estados posibles de la cuota (tope diario alcanzado, solicitud pendiente por primera vez, consulta en espera, cuota extra agotada, etc.) y se implementó una notificación proactiva y privada a los administradores del grupo/superadmins cuando se registra un nuevo pedido de aprobación, identificando al estudiante y el grupo de origen.
  - Se agregaron nuevas pruebas unitarias cubriendo la atomicidad concurrente y los textos dinámicos de cuota.
- **Vulnerabilidad de Ingeniería Social en el Límite de Preguntas (BUG-004)**: Corrección de la vulnerabilidad por la cual un usuario con cupo de preguntas agotado podía obtener respuestas académicas del bot o engañar al modelo. Se implementó una comprobación dura (cláusula guarda) que intercepta el mensaje y bloquea la llamada al LLM si el contador del usuario en la base de datos es 0.
  - `RateLimitService`: Implementación de `isQuotaExhausted` para verificar si la cuota de consultas diarias y de bonus de un usuario está completamente agotada para el día sin consumir recursos.
  - `AIQueryService`: Inserción de una cláusula guarda en `answer` para verificar `isQuotaExhausted` y denegar el acceso devolviendo directamente el mensaje de bloqueo sin consultar la API de la IA.
  - Tests: Mockeo de `isQuotaExhausted` y adición de pruebas unitarias en `prompt-leakage.spec.ts` para validar el bloqueo de usuarios sin cuota y el acceso a administradores.
- **Aislamiento de Contexto entre Comisiones (BUG-002)**: Corrección del error por el cual el comando `!semana` y las consultas de agenda vía IA mezclaban los cronogramas de distintas comisiones en un mismo grupo. El bot ahora valida la comisión del usuario antes de responder sobre agendas, aulas o enlaces de cursado. Si no puede determinar la comisión, solicita al alumno que se identifique antes de continuar.
  - `AIQueryService`: clasificador de consultas sensibles a comisión con bloqueo preventivo.
  - `AcademicCalendarService`: filtrado por `commission_id` del usuario en `formatDay`, `formatWeekEvents` y comandos rápidos.
  - `KnowledgeContextService`: inyección del contexto de comisión en `buildContext` para consultas IA.
  - Tests: 6 pruebas nuevas en `prompt-leakage.spec.ts` validando el bloqueo y aislamiento.
- **Exposición y Persistencia Excesiva de Memoria Conversacional (BUG-003)**: Corrección del problema de fuga y persistencia excesiva de memoria. Se aisló el historial estrictamente por el identificador de usuario y se guardó únicamente el prompt original limpio en lugar del prompt enriquecido (que incluía directivas, RAG e información de BD). Se inyectó una marca de tiempo a cada turno y se limitó su vigencia a un máximo de 12 horas.
  - `AIProvider`, `GeminiService`, `GroqProvider`, `FallbackAIService`: Se añadió el parámetro opcional `rawPrompt` para almacenar la consulta limpia del estudiante en la memoria.
  - `GeminiService`: Filtrado activo de turnos que superen las 12 horas y limitación del TTL general de inactividad de la sesión a un máximo de 12 horas.
  - `AIQueryService`: Envío de la consulta limpia (`prompt`) como `rawPrompt` al proveedor de IA.
  - Tests: Creación de `conversational-memory.spec.ts` para certificar el almacenamiento del prompt limpio y la expiración en 12 horas.
- **Errores de compilación TypeScript (4 errores)**:
  - `private-chat-workflow.service.ts:2517` — TS2322: conversión de `entry_year` (`number | null`) a `string` con fallback `'General'`.
  - `academic-calendar.service.ts:412` — TS2448/TS2454/TS2345: variable `menuTree` usada antes de su declaración; se movió la declaración al inicio de `handleMenuInput`.
- **Manejo Incorrecto de Fechas Relativas y Timezones (BUG-007)**:
  - Localización de todas las consultas y cálculos de fecha y hora a la zona horaria del cursado (`America/Argentina/Cordoba` por defecto o la configurada en `getSettings().timezone`), mitigando el error donde el bot interpretaba incorrectamente el día actual o el cronograma semanal en base al huso horario UTC del servidor.
  - Implementación de formateadores de fechas localizados utilizando `Intl.DateTimeFormat` con la configuración `sv-SE` (para obtener formatos estandarizados `YYYY-MM-DD` y `HH:MM:SS` sin desvíos de zona horaria) y `es-AR` para los nombres de días de la semana y respuestas amigables al usuario.
  - Reemplazo de las llamadas directas a métodos nativos de `Date` (como `.getDay()`, `.getDate()`) por `getLocalDateParts` en `academic-calendar.service.ts` para asegurar que las comparaciones del día civil correspondan siempre a la hora local.
  - Ajuste de los triggers de cron de tareas recurrentes en `SchedulerService` y el cálculo de recordatorios en `class-notification.service.ts` y `exam-notification.service.ts` para alinearlos con el huso horario local.
  - Corrección de la base de datos de pruebas unitarias (`db-utils.spec.ts`) para normalizar las fechas de prueba e independizarlas del timezone del sistema donde se ejecutan los tests.

### Modificado
- **Refactorización y limpieza de logs de consola**:
  - Eliminación de etiquetas obsoletas como `[PHASE-1]` y `(PHASE 5: ...)` en los logs de arranque de `main.ts` y `scheduler-service.ts`.
  - Traducción de todos los mensajes de administración y arranque en `main.ts` al español.
  - Corrección del log contradictorio en RAG que mostraba 'pendiente de carga' cuando no había vectores.
  - Eliminación del mensaje de QR engañoso en `vectorito-whatsapp-gateway.ts` cuando la sesión ya estaba registrada.
  - Eliminación del log verboso `MentionDebug` y de la advertencia de 'Número ignorado fuera de menú' para evitar spam en la consola de WhatsApp.
  - Limpieza de comentarios legacy `PHASE N` en todo el código fuente de los archivos `academic-calendar.service.ts`, `institutional-email-monitor.ts`, `private-chat-workflow.service.ts` y `models.ts` reemplazándolos con explicaciones funcionales claras en español.

### Eliminado
- **Limpieza de código muerto post-modularización**:
  - `repositories.ts`: eliminadas ~1000 líneas de repositorios comentados que ya fueron migrados a `features/academic-calendar/`, `features/notifications/` y `features/messages/`. Re-exports conservados.
  - `domain/models.ts`: eliminadas ~175 líneas de interfaces comentadas (`Reminder`, `InstitutionalNotice`, `ManagedExam`, `ManagedClass`, `ManagedTeacher`, `Comision`, `Commission`, `GroupContext`, `CohortConfig`, `ClassCommissionSchedule`) ya migradas a `academic-calendar.models.ts` y `notifications.models.ts`. Re-exports conservados.
  - `migration-helper.ts`: archivo huérfano eliminado (solo contenía un comentario legacy, sin imports).

## [0.2.1-alpha.2] - 2026-06-01

### Agregado
- **Comisiones Independientes por Grupo**: Se añadió la columna `commission_id` a la tabla `group_memberships` (migración versión 27) y se adaptaron los repositorios para guardar la comisión de los estudiantes por cada grupo de forma autónoma.
- **Flujo Conversacional de Onboarding de Estudiantes**: Rediseño completo en fases estructuradas:
  - *Paso 0*: Bienvenida formal con opciones explícitas (`sí`/`cancelar`).
  - *Paso 1*: Validación estricta del nombre (2 a 40 caracteres, sin números ni caracteres especiales).
  - *Paso 2*: Cumpleaños (`DD/MM`) con límite de **4 intentos**.
  - *Paso 3*: Email institucional con límite de **5 intentos** y recomendación de soporte al 3er intento fallido.
  - *Paso 4*: Selección dinámica de comisiones del grupo.
  - *Paso 4.5*: Resumen final de confirmación (`sí`/`no`).
- **Control de Inactividad de Onboarding**: Límite de **15 minutos** de inactividad para descartar un registro incompleto y permitir reiniciarlo.
- **Auto-salida de Grupos sin Administradores**: El gateway de WhatsApp ahora abandona automáticamente los grupos en los que no hay ningún administrador registrado para resguardar la seguridad y operatividad.
- **Población Automática de Membresías**: Se automatizó la creación de membresías al recibir cualquier mensaje entrante o al añadir participantes.
- **Configuración de TLS para Email (IMAP)**: Soporte para ignorar la verificación TLS auto-firmada usando `IMAP_TLS_REJECT_UNAUTHORIZED=false` en entornos locales (Windows/Antivirus).

### Modificado
- **Acceso directo de Super-Admin**: Reemplazo de la palabra clave legacy `'mequetrefe'` por el término formal `'Admin'`. Ahora enviar `Admin` en chat privado a un administrador ya registrado despliega directamente el menú de administración sin requerir contraseña.
- **Depuración de Tono Conversacional**: Remoción integral de modismos excesivamente informales (`chango`, `máquina`, `che`, `querido`) y bromas internas de baneo, adoptando un tono profesional y académico (polite & professional) alineado al entorno del ISPC.
- **Simplificación de Errores de Conexión TLS**: Ajuste en `email.service.ts` para que, en caso de fallas de conexión TLS conocidas, muestre solo el mensaje simplificado de error en lugar del stack trace multilínea completo para evitar spam masivo en la consola.

## [0.2.1-alpha.1] - 2026-05-29

### Refactorización Arquitectónica: Vertical Slicing + Screaming Architecture

Migración completa de la arquitectura del proyecto desde un diseño hexagonal monolítico hacia **Vertical Slicing** y **Screaming Architecture**. El código se reorganizó en 7 fases incrementales con cobertura de tests unitarios (Vitest) en cada paso, siguiendo un protocolo estricto de: crear → comentar legacy → testear → verificar → eliminar código muerto.

### Agregado

#### Nueva estructura `src/features/` (Vertical Slices)

- **`features/moderation/`** — Slice autocontenido de moderación de usuarios
  - `moderation.models.ts`: Modelos `UserModerationState`, `BannedUserView`, `BannedUserRecord`, `InfractionRecord`
  - `moderation.repository.ts`: `UserModerationRepository` con acceso directo a SQLite
  - `user-moderation.service.ts`: Orquestación de advertencias, baneos y levantamiento de suspensiones
  - `ban-warning-system.ts`: Sistema progresivo de penalización
  - `infraction-detector.ts`: Detección de infracciones y off-topic
  - `moderation-admin-command.service.ts`: Comandos administrativos de moderación
  - Tests: `__tests__/moderation.test.ts`

- **`features/conversation/`** — Slice de estado de conversación
  - `conversation.models.ts`: Modelo `PendingConfirmation`
  - `conversation.repository.ts`: `ConfirmationRepository`
  - `conversation-state.service.ts`: Gestión de confirmaciones pendientes y expiración
  - Tests: `__tests__/conversation.test.ts`

- **`features/ai/`** — Slice de Inteligencia Artificial y RAG
  - `ai.models.ts`: Modelos de rate limit
  - `ai-query.service.ts`: Orquestación de consultas IA con contexto
  - `rate-limit.service.ts` / `rate-limit.repository.ts`: Control de cuota diaria por usuario
  - `knowledge-context.service.ts`: Construcción del contexto dinámico (SQLite + RAG)
  - `providers/`: Gemini, Groq, Fallback, Embeddings
  - `rag/`: Pipeline de indexación, consulta semántica y CLI
  - Tests: `__tests__/ai-rate-limit.test.ts`

- **`features/notifications/`** — Slice de notificaciones y recordatorios
  - `notifications.models.ts`: Modelos de avisos y recordatorios
  - `notifications.repository.ts`: `ReminderRepository`, `ClassNotificationRepository`, `DailyGreetingRepository`
  - `class-notification.service.ts`: Notificaciones de clase automáticas
  - `exam-notification.service.ts`: Alertas de exámenes (7d, 3d, 1d)
  - `scheduled-reminder.service.ts`: Recordatorios programados
  - `smart-notification.service.ts`: Servicio inteligente de notificaciones
  - `integrations/`: `EmailService`, `InstitutionalEmailMonitor`, `RssParserService`
  - Tests: `__tests__/notifications.test.ts`

- **`features/messages/`** — Slice de enrutamiento de mensajes
  - `messages.models.ts` / `messages.repository.ts`: Modelos y repositorio de de-duplicación (`OutboxDedupRepository`)
  - `message-router.service.ts`: Enrutador principal de mensajes entrantes
  - `message-intent-parser.service.ts`: Parser de intenciones y comandos
  - `dynamic-message.service.ts`: Servicio de mensajes dinámicos (avisos, noticias)
  - Tests: `__tests__/messages.test.ts`

- **`features/academic-calendar/`** — Slice del calendario académico (mayor y más complejo)
  - `academic-calendar.models.ts`: 11 entidades académicas (`ManagedExam`, `ManagedClass`, `ManagedTeacher`, `Commission`, etc.)
  - `academic-calendar.repository.ts`: `ManagedExamRepository`, `ManagedClassRepository`, `ManagedTeacherRepository`, `ReminderRepository` y más
  - `academic-calendar.service.ts`: Servicio principal de calendario con todos los flujos de agenda
  - `comision-management.service.ts`: Gestión de comisiones multi-horario
  - `exam-menu.service.ts`: Menú interactivo de exámenes
  - `edit-exam-menu.service.ts`: Menú de edición de exámenes existentes
  - `menu-persistence.service.ts`: Integración menús ↔ persistencia
  - `multi-comision-exam-menu.service.ts`: Soporte multi-comisión en carga de exámenes
  - `remove-notification-menu.service.ts`: Menú de eliminación de avisos/exámenes
  - Tests: `__tests__/calendar.test.ts`

#### Nueva estructura `src/shared/` (Componentes transversales)

- **`shared/db/`** — Utilidades de base de datos SQLite compartidas
  - `db-utils.ts`: Helpers `run()`, `get()`, `all()` y formateadores de fechas (`formatLocalDateOnly`, `formatLocalTime`)
  - `database.ts`: `DatabaseConnection` (reubicado desde `infrastructure/`)
  - `migrations.ts`: Migraciones de esquema SQLite (reubicado desde `infrastructure/`)
  - Tests: `__tests__/db-utils.test.ts`

- **`shared/config/`** — Configuración de entorno (reubicado desde `src/config/`)
- **`shared/logging/`** — Servicio de logging (reubicado desde `src/infrastructure/logging/`)

### Modificado

- **`src/main.ts`**: Todos los imports actualizados para apuntar a los nuevos módulos en `features/` y `shared/`. La composición raíz ahora instancia dependencias desde los slices verticales.
- **`src/domain/models.ts`**: Las interfaces migradas a sus respectivos slices se re-exportan desde este archivo para compatibilidad con legacy restante (admin, analysis).
- **`src/infrastructure/persistence/db/repositories.ts`**: Los repositorios migrados se re-exportan desde este archivo para compatibilidad. El código original fue eliminado.
- **`package.json`**: Scripts RAG actualizados para apuntar a `dist/features/ai/rag/`.

### Eliminado

- Código legacy de repositorios monolíticos: las clases `UserModerationRepository`, `ConfirmationRepository`, `RateLimitRepository`, `DailyGreetingRepository`, `OutboxDedupRepository`, `ManagedExamRepository`, `ManagedClassRepository`, `ManagedTeacherRepository`, `ReminderRepository`, `ClassNotificationRepository` y helpers de fecha fueron removidos de `repositories.ts`.
- Código legacy de modelos: las interfaces `UserModerationState`, `BannedUserView`, `PendingConfirmation`, `RateLimit`, `Reminder`, `ManagedExam`, `ManagedClass`, `ManagedTeacher` fueron removidas de `domain/models.ts`.
- Servicios legacy de `src/application/calendar/`: `academic-calendar.service.ts`, `edit-exam-menu.service.ts`, `exam-menu.service.ts`, `menu-persistence.service.ts`, `multi-comision-exam-menu.service.ts`, `remove-notification-menu.service.ts`, `comision-management.service.ts`.
- Servicios legacy de `src/application/ai/`: `ai-query.service.ts`, `rate-limit.service.ts`, `knowledge-context.service.ts`.
- Servicios legacy de `src/application/moderation/`: Código original de moderación.
- Servicios legacy de `src/application/messages/`: Enrutador y parser de intenciones originales.
- Servicios legacy de `src/application/notifications/`: Notificaciones y recordatorios originales.

### Tests

- Suite completa de tests unitarios con Vitest para cada slice migrado:
  - `src/features/moderation/__tests__/moderation.test.ts`
  - `src/features/conversation/__tests__/conversation.test.ts`
  - `src/features/ai/__tests__/ai-rate-limit.test.ts`
  - `src/features/messages/__tests__/messages.test.ts`
  - `src/features/notifications/__tests__/notifications.test.ts`
  - `src/features/academic-calendar/__tests__/calendar.test.ts`
  - `src/shared/db/__tests__/db-utils.test.ts`
- Todos los tests pasan con `npx vitest run`.
- El proyecto compila sin errores con `npm run build`.

### Notas

- Las carpetas legacy `src/application/`, `src/domain/` y `src/infrastructure/` aún existen con archivos residuales que no forman parte de los slices migrados (admin workflows, analysis, persistence bridge). Estos pueden migrarse en futuras iteraciones.
- Los re-exports en `models.ts` y `repositories.ts` garantizan compatibilidad backward con módulos que aún importan desde las rutas legacy.
- El protocolo de migración (crear → comentar → testear → verificar → eliminar) evitó regresiones y pérdida de funcionalidad en las 7 fases.

---

## [Unreleased] - 2026-05-27

### Agregado
- Migración y tabla `cohort_configs` para configurar cohortes por `entry_year`.
- `CohortConfigRepository` con operaciones para listar, obtener y upsert por cohorte.
- Menú Super-Admin: gestión de cohortes (listar, crear/editar, seleccionar).
- Gestión de emails por cohorte (listar, agregar, quitar) con UI en privado.
- Flujo de promover/ despromover Admin de Grupo (promoción paginada, selección por número).
- Paginación de selección para listas largas (usuarios) en flujos privados.
- Gestión por cohorte de avisos y exámenes: CRUD básico para avisos y exámenes etiquetados por cohorte.
- Migración versión 24: nuevas columnas `frecuencia`, `grupo_selector` y `confirmed_at` en la tabla `institutional_notices`.
- Integración en `InstitutionalEmailMonitor` de resolución dinámica de grupos de WhatsApp: soporte para segmentar avisos por camada específica (ej: `camada: 2026`), canales generales o envío a todos los grupos activos.
- Validaciones de rango de fecha y vigencia temporal para avisos entrantes, con respuestas automáticas por e-mail informando al emisor sobre el éxito (procesado/confirmado) o error detallado del rechazo.

### Modificado
- `PrivateChatWorkflowService`: nuevos estados y handlers para cohortes, emails, avisos y examenes.
- Tests: migración a Vitest y nuevos tests para promotion/demotion y cohort-emails.
- `email-service.ts`: adaptación para habilitar soporte de emails de salida de confirmación/error en el flujo IMAP.

### Tests
- Se añadieron pruebas unitarias en `src/__tests__/promotion-demotion.spec.ts` y `src/__tests__/cohort-emails.spec.ts`.
- La suite `npm run test:vitest` pasa localmente tras estos cambios.
- Nuevas pruebas funcionales añadidas en `src/__tests__/institutional-notices.spec.ts` para cubrir las validaciones de fechas, resolución de grupos y envío de correos en avisos institucionales.

### Notas
- Los avisos creados por cohorte se prefijan con `[Cohorte <year>]` mientras no exista columna específica en la tabla para scoping.
- Futuras mejoras: añadir columna/cohort_id en tablas de avisos/exámenes y migración para soporte nativo a nivel DB.


## [2.0.0-alpha.1] - 2026-05-19

### Agregado
- Tabla `whatsapp_groups` en SQLite para persistir grupos autorizados sin límite de cantidad
- Tabla `commissions` como entidad master de comisiones académicas (reemplaza la interfaz `Comision` huérfana que no tenía tabla)
- Tabla `group_context` para mapear cada grupo de WhatsApp a su contexto académico: año, comisión y turno
- Tabla `class_commission_schedule` para registrar horarios específicos por comisión por materia
- Tabla `group_admins` para admins con permisos acotados a un grupo
- `GroupRepository` con operaciones: findAll, findById, register, setActive, getAllActiveIds
- `CommissionRepository` y `GroupContextRepository`
- Método `getAdminLevel(userId, groupId?)` en `AdminRepository` que retorna `'global' | 'group' | null`
- Campo `metadata.groupScope` en los chunks del RAG con valores `'global'` o el `group_id` correspondiente
- Estructura de carpetas del RAG: `data/ai-context/global/` para contenido compartido y `data/ai-context/[group_id]/` para contenido específico de cada grupo
- Filtrado por `groupScope` en `RagQueryService.search(query, groupId?)`
- Campo `target_scope` en `institutional_notices` para segmentar avisos por año, grupo específico o todos
- Flujo de onboarding para usuarios nuevos en grupos: el bot pregunta en privado si es alumno del año o está de visita
- Comando `!config-grupo` para que el admin global asigne el contexto académico a un grupo recién agregado
- Comando `!rag-upload global` y `!rag-upload [groupId]` para subir PDFs al RAG directamente desde WhatsApp
- Script de migración automática idempotente en el arranque: transfiere los IDs de grupos desde `.env` a la BD SQLite
- Interfaces nuevas en `models.ts`: `WhatsAppGroup`, `Commission`, `GroupContext`, `GroupAdmin`

### Modificado
- `AIQueryService.answer()` incorpora `groupId?: string` como quinto parámetro opcional; todos los callers fueron actualizados
- `RagQueryService.search()` incorpora `groupId?: string` como segundo parámetro para filtrar chunks por scope
- `KnowledgeContextService.buildContext()` recibe `groupId?` para filtrar avisos y agenda según el contexto del grupo
- `persistGroupIdInEnvIfMissing()` reemplazado por `GroupRepository.register()`; se eliminó el límite hardcodeado de 2 grupos
- `allowedGroupIds` ahora se carga desde la BD al arrancar en lugar de leerse desde `.env`
- El scheduler de notificaciones filtra los grupos destinatarios según el `target_scope` de cada aviso antes de enviar
- `DynamicMessageService.getValidNotices()` recibe `groupId?` y filtra por `target_scope`
- `AcademicCalendarService` filtra horarios por `commission_id` del usuario cuando está disponible; si no tiene comisión asignada, muestra la agenda general del año del grupo
- La interfaz `Comision` fue reemplazada por `Commission` con tabla real en la BD

### Deprecado
- Variables de entorno `WHATSAPP_GROUP_ID`, `WHATSAPP_GROUP_ID_2` y `WHATSAPP_GROUP_IDS` para definir grupos autorizados. El bot las migra automáticamente a la BD en el primer arranque. Pueden eliminarse del `.env` tras el primer inicio exitoso.

### Breaking Changes
- **Firma de `AIQueryService.answer()`**: se agrega `groupId` como quinto argumento. Código externo que invoque este método debe actualizarse (el parámetro es opcional, puede pasarse `undefined`).
- **Fuente de verdad de grupos**: el sistema ya no lee `.env` como fuente principal de grupos autorizados. Los deployments existentes deben arrancar una vez para ejecutar la migración automática.
- **Re-indexación del RAG requerida**: los chunks existentes no tienen `metadata.groupScope`. Mover el contenido de `data/ai-context/` a `data/ai-context/global/` y ejecutar el pipeline de sincronización tras el deploy.

### Limitaciones conocidas
- Los admins de grupo aún no tienen interfaz para ver qué PDFs están indexados en el RAG de su grupo.
- El filtrado por comisión en la agenda depende de que el admin haya cargado horarios en `class_commission_schedule`; mientras no existan esos registros, se muestra el horario general de la materia.
- Un usuario invitado (role='guest') tiene acceso de solo lectura a la agenda general del grupo; no puede registrar recordatorios ni consultar su perfil.

## [1.0.0-alpha.1] - 2026-05-14

### Added
- Bot de WhatsApp funcional con conexión, reconexión, lectura de mensajes y control de instancia única.
- Comandos activos: `!menu`, `!hola`, `!hoy` / `!clases`, `!enlace`, `!semana`, `!semana-que-viene`, `!examenes`, `!avisos`, `!noticias`, `!help`.
- Menú interactivo y navegación por respuestas numéricas.
- Flujo privado de registro y actualización de perfil.
- Asignación y uso de comisión de usuario.
- Gestión de exámenes con comisión asignada.
- Gestión de clases y horarios.
- Gestión de avisos institucionales.
- Gestión de noticias mediante RSS.
- Recordatorios y notificaciones automáticas.
- Notificaciones automáticas de clases, exámenes, cumpleaños y vencimientos de entregas.
- Moderación con detección de off-topic, warnings y bloqueo progresivo de usuarios.
- Rate limiting y control de cuota para consultas IA.
- IA conversacional con contexto dinámico de base de datos.
- Sistema RAG con indexación de PDFs, embeddings, búsqueda semántica y CLI de mantenimiento.
- Sincronización automática del índice RAG cuando cambian las fuentes.
- Paneles y flujos administrativos para aprobar usuarios, registrar datos y gestionar contenido.
- Gestión de comisiones y soporte para flujos por comisión en clases y exámenes.
- Persistencia SQLite con repositorios para perfiles, exámenes, clases, avisos, moderación y scheduler.

### Fixed
- Limpieza del contexto IA para evitar información institucional estática embebida fuera de RAG.
- Unificación del flujo de sincronización RAG para que no dependa de shell externo.
- Mantención del contexto dinámico de BD sin romper las respuestas de exámenes, avisos y perfil.
- Mensajes de fallback y error de RAG más neutros y consistentes.
- Ajustes para que la IA priorice evidencia documental y datos vivos antes que conocimiento implícito.
- Corrección de la lógica de respuesta para tolerar la ausencia de materias o documentos sin romper el bot.

### Known limitations
- La IA sigue dependiendo de que la base de conocimiento esté bien cargada para responder con precisión documental.
- Si el RAG no encuentra evidencia suficiente, el bot responde de forma conservadora.
- El clasificador off-topic y la moderación siguen activos, así que preguntas fuera de alcance pueden ser bloqueadas.
- Algunas funciones administrativas y de moderación siguen creciendo de forma incremental, por lo que esta alpha todavía puede cambiar en detalles de UX y mensajes.