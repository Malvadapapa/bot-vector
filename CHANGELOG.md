# Changelog

Todas las modificaciones notables de este proyecto serán documentadas en este archivo.

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