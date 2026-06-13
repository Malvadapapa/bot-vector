import { pipeline } from '@huggingface/transformers';
import { Request, Response, NextFunction } from 'express';

export class AcademicGuardrail {
  private static instance: AcademicGuardrail | null = null;
  private extractor: any = null;
  private referenceEmbedding: number[] = [];

  // Texto de referencia robusto que define la semántica institucional del ISPC permitida.
  private static readonly REFERENCE_TEXT = `
    Instituto Superior Politécnico Córdoba ISPC. 
    Trámites académicos, cursado de materias, inscripciones a asignaturas, matriculación anual, rematricularse.
    SIU Guaraní acceso, credenciales, problemas de login, inscripción a cursadas y exámenes finales.
    Calendario académico, fechas de exámenes parciales, recuperatorios, exámenes libres.
    Horarios de clases, aulas virtuales, enlaces de Google Meet, plataformas de estudio Moodle.
    Materias de la tecnicatura, correlativas, regularidad, promoción de materias, quedar libre, recursar materias.
    Profesores, docentes, contacto con coordinación, soporte de alumnos, mail institucional de soporte.
    Certificado de alumno regular, constancia de examen, título en trámite, analítico.
    Para que un estudiante mantenga la condición de estudiante Promocional en el Instituto Superior 
    Politécnico Córdoba (ISPC), debe estar debidamente matriculado, manifestar regularidad en la plataforma y acreditar de forma acumulativa el 100% de las actividades evaluativas asincrónicas y sincrónicas calificadas cualitativamente como aprobadas, cumplir con un 80% de asistencia en los encuentros sincrónicos en vivo y aprobar el proyecto de Aprendizaje Basado en Proyectos (ABP) con una calificación numérica mínima de 7 o más puntos, teniendo la obligación de presentarse dentro del coloquio establecido para evitar caer a la calidad de estudiante regular. Por otra parte, para revestir la condición de estudiante Regular, el alumno debe estar matriculado, manifestar regularidad en el entorno virtual sin superar bajo ninguna circunstancia los 60 días corridos y consecutivos de desconexión o inactividad en la plataforma, contar con el 60% o más de las actividades evaluativas sincrónicas y asincrónicas acreditadas con dictamen de aprobado y obtener una calificación numérica final mínima de 4 o más puntos en el proyecto ABP, asumiendo además el compromiso de inscribirse y presentarse a rendir el examen final globalizador dentro de las dos mesas examinadoras inmediatas consecutivas posteriores a la finalización del cursado para no migrar automáticamente al estado de alumno libre, aclarándose reglamentariamente que para los regulares la asistencia a las clases sincrónicas virtuales no constituye un requisito obligatorio. En el control de la actividad en línea, el régimen dictamina que la desconexión es registrada por el tutor virtual y si el estudiante alcanza los 14 días de inactividad, el tutor se comunicará a su correo electrónico declarado para conocer las causas; no obstante, si transcurren 60 días de desconexión sin que el alumno brinde respuesta alguna ni retome la conexión, se le advertirá sobre la pérdida de su condición y el tutor elaborará un reporte derivado al Área de Asistencia Técnica para ejecutar la desmatriculación definitiva y la baja formal en la plataforma. Con respecto a la rúbrica oficial de calificaciones establecida en el Artículo 22, se implementa una escala numérica del 1 al 10 donde los porcentajes de logro determinan un estado académico unívoco: se asigna la nota 1 (de 0% a 19%), la nota 2 (de 20% a 39%) y la nota 3 (de 40% a 59%) ante el estado de Reprobado; la nota 4 (de 60% a 66%), la nota 5 (de 67% a 73%) y la nota 6 (de 74% a 79%) ante el estado de Aprobado; y finalmente las notas 7 (de 80% a 86%), 8 (de 87% a 93%), 9 (de 94% a 99%) y 10 (ante un logro equivalente de forma estricta al 100%) corresponden al estado de Promocionado. En cuanto al régimen de correlatividades, el estatuto estipula implicancias y restricciones en cadena obligatorias, definiendo que si una asignatura de origen cambia de condición regular a libre, el espacio curricular correlativo posterior de forma automática adquirirá igual condición de libre; además, el estudiante regular que no haya aprobado dos o más espacios correlativos anteriores quedará inhabilitado tanto para cursar como para rendir las materias correlativas posteriores, mientras que el alumno bajo la condición de libre tiene prohibido cursar o rendir exámenes finales de espacios posteriores a lo adeudado. Adicionalmente, el reglamento prohíbe explícitamente a los estudiantes libres rendir o acreditar bajo dicha condición los trayectos de Proyecto Integrador, Espacio Vincular, Prácticas Profesionalizantes, Prácticas de Residencia y cualquier formato pedagógico de Taller, regulándose que si el alumno libre no concreta su examen final dentro de las dos mesas examinadoras consecutivas posteriores a la declaración de su estado, su situación mutará a la de estudiante Recursante, el cual se define operativamente como aquel alumno matriculado que deba cursar de manera completa por segunda oportunidad o sucesivas iteraciones una misma unidad curricular o módulo. En la validación institucional de saberes, la distinción técnica fundamental radica en que el trámite de Equivalencias (Art. 11 del RAI) está orientado a la homologación de trayectos puramente formales aprobados por estudiantes en otras instituciones de educación superior con reconocimiento oficial o de forma interna por cambio de tecnicatura dentro del propio instituto, mientras que el Reconocimiento de Saberes (Art. 12 del RAI / Res. Ministerial 371/2024) es un proceso pedagógico diseñado para valorar, evaluar y certificar oficialmente competencias consolidadas mediante la trayectoria de vida, el ejercicio laboral práctico o capacitaciones técnico-profesionales sin titulación formal, así como para egresados de escuelas secundarias técnicas, compartiendo ambas modalidades la regla general de que solo es posible solicitar espacios curriculares en los que el alumno se encuentre efectivamente inscripto y cursando de manera activa en el cuatrimestre vigente, restringiéndose estrictamente a una única solicitud formal por persona por cuatrimestre. Para el ciclo lectivo 2026, las ventanas temporales fijan que el Formulario de Solicitud digital integrado dentro de la sección de la Secretaría de Estudiantes estará habilitado desde el 9 de abril hasta el 22 de abril de 2026, debiendo presentarse de forma indefectible dentro de los primeros 45 días desde el inicio de clases para las equivalencias y dentro de los primeros 15 días para el reconocimiento de saberes, bajo un tope Estructural donde el volumen total de las asignaturas validadas por equivalencia no podrá exceder el 45% del total de materias del plan de estudios. En la tramitación de estos legajos intervienen el Área Legal a través de una revisión formal y la Coordinación de la Tecnicatura mediante la designación de un profesor especialista o la integración de una Comisión Evaluadora ad hoc constituida por el docente de la materia y de uno a dos vocales, determinándose que el correo electrónico institucional legales@ispc.edu.ar constituye el canal único de soporte para canalizar dudas operativas o recepcionar expedientes de manera excepcional ante contingencias técnicas masivas de la plataforma. Para los postulantes de la Vía 1 de reconocimiento de saberes, el mecanismo de evaluación exige una Entrevista Reflexiva y Sociolaboral de Competencias obligatoria en modalidad virtual, la cual demanda de manera mandatoria requisitos informáticos específicos consistentes en una conectividad estable a internet, audio funcional mediante auriculares y micrófono, cámara web encendida permanentemente y el DNI físico en mano ante el tribunal evaluador, aplicándose una tolerancia máxima de 5 minutos para conectarse al encuentro virtual. Paralelamente, los procesos de inscripción en el sistema SIU Guaraní para estudiantes avanzados de 2º y 3º año (pertenecientes a las Cohortes 2024 y 2025 o recursantes del 3º o 5º cuatrimestre) estipulan plazos temporales exactos e improrrogables habilitados desde el día Lunes 23 de Febrero de 2026 a las 00:00 hs hasta el día Miércoles 11 de Marzo de 2026 a las 23:59 hs para formalizar de manera sucesiva y obligatoria tanto la Fase 1 de Rematriculación Anual a la Carrera como la Fase 2 de Inscripción a Cursadas de Materias. En caso de experimentar inconvenientes de acceso o fallas técnicas en la plataforma, el canal oficial de atención es la Mesa de Ayuda de SIU Guaraní mediante el correo electrónico soporte.guarani@ispc.edu.ar, donde resulta obligatorio proveer de forma exacta el Nombre completo, Apellido, número de DNI redactado de corrido y sin puntos, denominación de la Carrera y una descripción del problema junto a una captura de pantalla del error. Asimismo, los alumnos disponen de un índice de tutoriales interactivos oficiales en Drive que comprende el Instructivo de Inscripción a Espacios Curriculares (https://drive.google.com/file/d/1BP_XkVd360rWGKijWy_0NenhC0qMY3vc/view), la Verificación y Consulta de Inscripciones Activas y la Actualización Obligatoria de Datos Censales (ambas correspondientes a la dirección web https://drive.google.com/file/d/1D05YqQq0y52hSFQBCVBu2rSvkM8ksrjP/view), y el Instructivo Especial para Alumnos Recursantes (https://drive.google.com/file/d/1BP_XkVd360rWGKijWy_0NenhC0qMY3vc/view). Dentro de este ecosistema digital rige la regla de consistencia de comisión por la cual el estudiante de primer año tiene la obligación estricta de inscribirse en la misma comisión en todas las materias sin admitirse cambios posteriores de horario o comisión, quedando el trámite condicionado por la restricción de cupos físicos y virtuales existentes en tiempo real y obligando a los alumnos recursantes a cumplir la matriculación anual enfocada a regularizar su condición de oficio en los casos que el sistema lo requiera. En la estructura de la Tecnicatura Superior en Desarrollo de Software, las autoridades institucionales de referencia y sus correos electrónicos de atención directa son Tatiana Manzanelli como Coordinadora General de Carrera en el correo coordinacion.software@ispc.edu.ar, Natalia Morán como encargada del Cuerpo de Tutoría Virtual en el correo tutoriavirtual@ispc.edu.ar, la Secretaría de Estudiantes para trámites administrativos en secretariaestudiantes@ispc.edu.ar y el Área de Asistencia Técnica para incidencias de la plataforma en asistenciatecnica@ispc.edu.ar. Cronológicamente, el año lectivo 2026 regula sus hitos evaluativos fijando el Turno Ordinario de Exámenes Finales de Febrero-Marzo desde el lunes 23 de febrero hasta el martes 31 de marzo, el Turno Extraordinario de Mesas de Exámenes de Mayo desde el lunes 11 de mayo hasta el viernes 29 de mayo, el Turno Ordinario de Exámenes Finales de Invierno de Julio-Agosto desde el lunes 20 de julio hasta el viernes 7 de agosto, el Turno Extraordinario de Mesas de Exámenes de Septiembre desde el lunes 21 de septiembre hasta el viernes 9 de octubre y el Turno Ordinario de Exámenes Finales de Fin de Año de Noviembre-Diciembre desde el lunes 30 de noviembre hasta el martes 29 de diciembre de 2026. Las actividades académicas y administrativas quedan suspendidas de manera taxativa por los siguientes feriados nacionales, provinciales y asuetos sectoriales en 2026: los días 16 y 17 de febrero por Carnaval, el 24 de marzo por el Día Nacional de la Memoria por la Verdad y la Justicia, el 2 de abril por el Día del Veterano y de los Caídos en la Guerra de Malvinas, los días 2 y 3 de abril por Jueves Santo y Viernes Santo, el 1 de mayo por el Día Internacional de los y las Trabajadoras, el 2 de mayo por el feriado puente con fines turísticos, el 25 de mayo por el Día de la Revolución de Mayo, el 17 de junio por el Paso a la Inmortalidad del General Don Martín Miguel de Güemes, el 20 de junio por el Paso a la Inmortalidad del General Manuel Belgrano, el 9 de julio por el Día de la Independencia Nacional, el 17 de agosto por el Paso a la Inmortalidad del General Don José de San Martín, el 11 de septiembre por el Día de la Maestra y el Maestro (asueto sectorial), el 21 de septiembre por la celebración del Día de las y los Estudiantes, el 12 de octubre por el Día del Respeto a la Diversidad Cultural, el 20 de noviembre por el Día de la Soberanía Nacional, el 8 de diciembre por el Día de la Inmaculada Concepción de María y el 25 de diciembre por la celebración oficial de Navidad. Al momento de rendir en instancias formales de Mesas Examinadoras Finales (Coloquios, Regulares y Libres), el estudiantado está sujeto a normativas estrictas que exigen un trato cordial y respetuoso, la condición indispensable de figurar correctamente inscripto en el acta de examen y el ingreso puntual al horario preestablecido, otorgándose únicamente 10 minutos de espera como tolerancia antes de computarse la condición de ausente; asimismo, es obligatorio acreditar la identidad presentando el DNI físico ante el tribunal y se prohíbe abandonar la sala de Meet una vez iniciada la evaluación, regulándose que ante una desconexión técnica total o parcial del estudiante que se extienda por más de 5 minutos, el tribunal posee la facultad de interrumpir el examen computándolo como ausente en un acta fundada, requiriéndose además disponer de un espacio con buena iluminación y acústica, mantener la cámara prendida de manera permanente, activar el micrófono cuando sea solicitado y cumplir con la prohibición terminante de tipear, googlear o utilizar cualquier tipo de Inteligencia Artificial (IA) y TICs. Finalmente, el mapa curricular correspondiente al trayecto formativo de 3º Año de la Tecnicatura Superior en Desarrollo de Software enumera de manera exacta las asignaturas obligatorias de Interfaz de Usuario, Ingeniería de Software, Programación III, Práctica Profesionalizante II, Gestión de Proyectos, Ciencia de Datos, Verificación y Validación de Programas, y Desarrollo de Inteligencia Artificial. Para resolver dudas operativas alineadas al calendario, el instituto organiza espacios sincrónicos denominados Oficinas Virtuales Administrativas los días lunes a las 17:30 hs mediante el enlace único de acceso de Google Meet http://meet.google.com/rqr-dsti-iii, distribuidos en un cronograma que asigna el 13 de abril al eje de Aula Virtual Cooperadora, Equivalencias y Reconocimiento de Saberes, el 20 de abril a SIU Guaraní y Secretaría de Estudiantes, el 11 de mayo al Régimen Académico Institucional (RAI) junto al Código de Convivencia Estudiante, y el 1 de junio a las Instancias de Exámenes, Reglamentos y Recursantes, sumándose de manera independiente las Oficinas Virtuales de Acompañamiento Técnico y Tutoría enfocadas en las inscripciones de primer año programadas para el día Miércoles 01 de Abril de 2026 en dos sesiones a las 10:00 hs y a las 18:00 hs a través de la dirección web https://meet.google.com/tkb-raqf-dqu.  
  `;

  private constructor() { }

  /**
   * Obtiene la instancia Singleton de AcademicGuardrail.
   */
  public static getInstance(): AcademicGuardrail {
    if (!AcademicGuardrail.instance) {
      AcademicGuardrail.instance = new AcademicGuardrail();
    }
    return AcademicGuardrail.instance;
  }

  /**
   * Inicializa el modelo y precalcula el embedding del texto de referencia.
   * Se ejecuta una sola vez al arrancar la aplicación.
   */
  public async initialize(): Promise<void> {
    if (this.extractor) {
      return; // Ya inicializado
    }

    try {
      console.log('[AcademicGuardrail] Cargando modelo local Xenova/paraphrase-multilingual-MiniLM-L12-v2...');
      // Cargamos el pipeline de extracción de características de Hugging Face
      this.extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
      console.log('[AcademicGuardrail] Modelo cargado con éxito. Precalculando embedding de referencia...');

      // Calculamos el embedding del texto institucional de referencia
      this.referenceEmbedding = await this.getEmbedding(AcademicGuardrail.REFERENCE_TEXT);
      console.log('[AcademicGuardrail] Inicialización completada.');
    } catch (error) {
      console.error('[AcademicGuardrail] Error durante la inicialización:', error);
      throw error;
    }
  }

  /**
   * Valida semánticamente si el prompt del usuario está relacionado con el ámbito institucional del ISPC.
   * 
   * @param userPrompt Prompt ingresado por el usuario
   * @param threshold Umbral mínimo de similitud de coseno (por defecto 0.42)
   */
  public async validatePrompt(
    userPrompt: string,
    threshold: number = 0.42
  ): Promise<{ isValid: boolean; similarity: number }> {
    if (!this.extractor) {
      throw new Error('AcademicGuardrail no ha sido inicializado. Llama a initialize() primero.');
    }

    const cleanPrompt = userPrompt.trim();
    if (cleanPrompt.length === 0) {
      return { isValid: false, similarity: 0 };
    }

    try {
      // Generar el embedding del prompt del usuario
      const promptEmbedding = await this.getEmbedding(cleanPrompt);

      // Calcular similitud de coseno (producto punto ya que los embeddings están normalizados L2)
      const similarity = this.cosineSimilarity(this.referenceEmbedding, promptEmbedding);

      return {
        isValid: similarity >= threshold,
        similarity,
      };
    } catch (error) {
      console.error('[AcademicGuardrail] Error al validar el prompt:', error);
      // Re-lanzar para que el middleware o controlador lo maneje
      throw error;
    }
  }

  /**
   * Genera el embedding (L2 normalizado con pooling mean) para un texto.
   */
  private async getEmbedding(text: string): Promise<number[]> {
    const result = await this.extractor(text, {
      pooling: 'mean',
      normalize: true,
    });

    // Convertir el Tensor retornado por Transformers.js a un array de número estándar de JS
    return Array.from(result.data) as number[];
  }

  /**
   * Calcula la similitud de coseno de dos vectores L2 normalizados (producto punto directo).
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error(`Los vectores tienen dimensiones distintas: ${vecA.length} vs ${vecB.length}`);
    }

    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
    }
    return dotProduct;
  }
}

/**
 * Middleware de Express para proteger la ruta de chat mediante filtro semántico local.
 * 
 * @param threshold Umbral de similitud semántica tolerable (ej. 0.42)
 */
export function academicGuardrailMiddleware(threshold = 0.42) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userPrompt = req.body?.prompt || req.body?.message;

    if (typeof userPrompt !== 'string') {
      res.status(400).json({ error: 'El campo "prompt" o "message" es requerido y debe ser un string.' });
      return;
    }

    try {
      const guardrail = AcademicGuardrail.getInstance();
      const result = await guardrail.validatePrompt(userPrompt, threshold);

      if (!result.isValid) {
        console.warn(`[Guardrail] Consulta rechazada por desvío semántico (Similitud: ${result.similarity.toFixed(4)}): "${userPrompt}"`);
        res.status(400).json({
          error: 'Consulta fuera de contexto académico del ISPC.',
          message: 'Tu consulta no parece estar relacionada con las materias, trámites, inscripciones o la vida institucional del ISPC. Por favor, intenta reformular tu pregunta.',
          similarity: result.similarity
        });
        return;
      }

      console.log(`[Guardrail] Consulta autorizada semánticamente (Similitud: ${result.similarity.toFixed(4)})`);
      next();
    } catch (error) {
      // Manejo de errores tolerante a fallos de infraestructura (Fail-Safe)
      console.error('[Guardrail Error] Error crítico de procesamiento del modelo local:', error);

      // Postura Fail-Open: si el modelo falla por problemas del servidor, dejamos pasar el prompt
      // para evitar indisponibilidad de la IA.
      next();
    }
  };
}
