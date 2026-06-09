# Changelog

Todas las modificaciones notables de este proyecto serán documentadas en este archivo.

## [2.1.0-alpha.3] - Unreleased

### Agregado
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

### Corregido
- **Aislamiento de Contexto entre Comisiones (BUG-002)**: Corrección del error por el cual el comando `!semana` y las consultas de agenda vía IA mezclaban los cronogramas de distintas comisiones en un mismo grupo. El bot ahora valida la comisión del usuario antes de responder sobre agendas, aulas o enlaces de cursado. Si no puede determinar la comisión, solicita al alumno que se identifique antes de continuar.
  - `AIQueryService`: clasificador de consultas sensibles a comisión con bloqueo preventivo.
  - `AcademicCalendarService`: filtrado por `commission_id` del usuario en `formatDay`, `formatWeekEvents` y comandos rápidos.
  - `KnowledgeContextService`: inyección del contexto de comisión en `buildContext` para consultas IA.
  - Tests: 6 pruebas nuevas en `prompt-leakage.spec.ts` validando el bloqueo y aislamiento.
- **Errores de compilación TypeScript (4 errores)**:
  - `private-chat-workflow.service.ts:2517` — TS2322: conversión de `entry_year` (`number | null`) a `string` con fallback `'General'`.
  - `academic-calendar.service.ts:412` — TS2448/TS2454/TS2345: variable `menuTree` usada antes de su declaración; se movió la declaración al inicio de `handleMenuInput`.

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

## [2.1.0-alpha.2] - 2026-06-01

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

## [2.1.0-alpha.1] - 2026-05-29

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