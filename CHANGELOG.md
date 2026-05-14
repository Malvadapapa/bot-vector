# Changelog

Todas las modificaciones notables de este proyecto serán documentadas en este archivo.

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