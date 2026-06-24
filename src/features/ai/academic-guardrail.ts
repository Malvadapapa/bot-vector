import { env, pipeline } from '@huggingface/transformers';
import path from 'path';
import fs from 'fs';

export class AcademicGuardrail {
  private static instance: AcademicGuardrail | null = null;
  private extractor: any = null;
  private referenceEmbeddings: number[][] = [];

  /**
 * Anchor texts cortos y temáticos optimizados para el pipeline RAG.
 * El modelo paraphrase-multilingual-MiniLM-L12-v2 tiene un límite estricto de ~128 tokens.
 * Cada string se mantiene conciso y saturado de palabras clave semánticas para evitar truncamiento.
 */
  private static readonly ANCHOR_TEXTS: string[] = [
    // --- Institucional general ---
    'Instituto Superior Politécnico Córdoba ISPC Dirección General de Educación Técnica Formación Profesional Ministerio de Educación de la Provincia de Córdoba',

    // --- Autoridades Académicas y Canales de Contacto ---
    'Tatiana Manzanelli Coordinación General de Carrera Tecnicatura Superior en Desarrollo de Software coordinacion.software@ispc.edu.ar',
    'Natalia Morán Cuerpo de Tutoría Virtual acompañamiento pedagógico seguimiento de estudiantes tutoriavirtual@ispc.edu.ar',
    'Secretaría de Estudiantes trámites administrativos inscripciones formales certificaciones analíticas legajos estudiantiles secretariaestudiantes@ispc.edu.ar',
    'Área de Asistencia Técnica soporte técnico incidencias matriculación visualización de contenidos aulas virtuales asistenciatecnica@ispc.edu.ar',

    // --- Procesos e Inscripciones en SIU Guaraní (Avanzados) ---
    'Rematriculación Anual a la Carrera Fase 1 Inscripción a Cursadas de Materias 3º y 5° Cuatrimestre Fase 2 estudiantes avanzados Cohortes 2024 y 2025 del 23 de febrero al 11 de marzo',
    'Inscripción a Cursadas primer año ingresantes materias anuales primer cuatrimestre del 1 de abril al 6 de abril plazos temporales improrrogables',
    'Regla de Consistencia de Comisión inscripción obligatoria en la misma comisión restricción de cupos cambio de horario o de comisión',
    'Mesa de Ayuda de SIU Guaraní soporte.guarani@ispc.edu.ar enviar Nombre Apellido DNI de corrido sin puntos carrera captura de pantalla del error técnico',

    // --- Plan de Estudios: 1º Año ---
    'Materias primer año Elementos de matemática y lógica Sistemas y organizaciones Programación I Base de datos Inglés I Competencias Comunicacionales I Ética y deontología profesional Arquitectura de las computadoras Competencias Comunicacionales II Aproximación al mundo del trabajo',

    // --- Plan de Estudios: 2º Año ---
    'Materias segundo año Inglés II Estadística y probabilidad aplicadas Modelado y Arquitectura de Software Programación II Práctica Profesionalizante I Sistemas operativos Redes',

    // --- Plan de Estudios: 3º Año ---
    'Materias tercer año Interfaz de usuario Ingeniería de software Programación III Práctica Profesionalizante II Gestión de proyectos Ciencia de Datos Verificación y Validación de programas Desarrollo de Inteligencia Artificial',

    // --- Turnos de Exámenes Finales (Calendario 2026) ---
    'Turno Ordinario de Exámenes Finales Febrero Marzo de febrero al 31 de marzo Turno Ordinario de Invierno Julio Agosto del 20 de julio al 7 de agosto',
    'Turno Ordinario de Exámenes Finales de Fin de Año Noviembre Diciembre del 30 de noviembre al 29 de diciembre mesas examinadoras',
    'Turno Extraordinario de Mesas de Exámenes Mayo del 11 al 29 de mayo Turno Extraordinario de Septiembre del 21 de septiembre al 9 de octubre materias adeudadas planes que caducan',

    // --- Hitos del Calendario Académico 2026 ---
    'Trayecto de Ingreso Ser Técnico de Nivel Superior SIES módulo introductorio Apertura Primer Cuatrimestre Cursos Avanzados 16 de marzo Cursos Iniciales 6 de abril',
    'Cierre del Ciclo del Primer Cuatrimestre 3 de julio Receso Escolar de Invierno vacaciones del 6 al 17 de julio Apertura Segundo Cuatrimestre 10 de agosto Cierre del Segundo Cuatrimestre 27 de noviembre',

    // --- Feriados y Asuetos ---
    'Feriados no laborables suspensión actividades Carnaval Memoria Verdad Justicia Malvinas Jueves Santo Viernes Santo Día de los Trabajadores feriado puente turístico Revolución de Mayo Güemes Belgrano Independencia San Martín Día de la Maestra y el Maestro asueto Día de las y los Estudiantes Diversidad Cultural Soberanía Nacional Inmaculada Concepción Navidad',

    // --- Condición de Estudiante y RAI (Artículo 13) ---
    'Estudiante Promocional 100 por ciento actividades evaluativas asincrónicas sincrónicas aprobadas proyecto ABP nota 7 8 9 10 asistencia 80 por ciento encuentros sincrónicos coloquio final',
    'Estudiante Regular 60 por ciento actividades evaluativas acreditadas aprobado proyecto ABP nota 4 5 6 límite sesenta días de desconexión examen final globalizador',
    'Estudiante Libre pérdida de regularidad menos de 59 por ciento entregas reprobar proyecto ABP examen especial libre estudiante recursante cursar por segunda vez espacio curricular',
    'Restricciones estudiante libre prohibido acreditar Proyecto Integrador Espacio Vincular Prácticas Profesionalizantes Prácticas de Residencia formato Taller',

    // --- Alertas y Baja por Desconexión ---
    'Desconexión de plataforma inactividad del alumno 14 días alerta de tutor virtual correo electrónico declarado 60 días de desconexión reporte de baja asistencia técnica desmatriculación',

    // --- Correlatividades y Cursado ---
    'Régimen de correlatividades relación epistemológica cursada habilitada cursada inhabilitada examen inhabilitado regular o libre materia correlativa anterior posterior adeudada',

    // --- Prácticas Profesionalizantes ---
    'Prácticas profesionalizantes pasantías no rentadas formato presencial virtual mixto geolocalización residencia del estudiante obligatorias título Técnico Superior',

    // --- Equivalencias (Artículo 11 del RAI) ---
    'Trámite de Equivalencias externas internas universidades institutos estudios previos certificado analítico programas legalizados Nota de Solicitud oficiales tope del 45 por ciento plan de estudios',

    // --- Reconocimiento de Saberes (Artículo 12 del RAI) ---
    'Reconocimiento de Saberes Resolución Ministerial 371/2024 experiencia laboral trayectoria de vida capacitaciones no formales egresados de escuela secundaria técnica de Córdoba',
    'Mecanismo de evaluación vía 1 comisión ad hoc entrevista reflexiva sociolaboral competencias conectividad audio cámara encendida DNI físico nota mínima de 7 puntos',
    'Reconocimiento de Saberes Inglés I Inglés II exención de idioma competencias lingüísticas avanzadas escala C1 C2 MCER Marco Común Europeo',
    'Área Legal trámite de equivalencias y saberes legales@ispc.edu.ar formulario digital ventanilla del 9 de abril al 22 de abril primeros 15 días de clases',

    // --- Regulaciones de Mesas Examinadoras Finales ---
    'Regulaciones para el estudiantado instancias examinadoras finales coloquios regulares libres actas de examen horario puntualidad tolerancia de 10 minutos de espera ausente',
    'Normas técnicas de examen Google Meet cámara prendida permanente micrófono activo espacio ameno iluminación acústica desconexión de 5 minutos ausente prohibido tipear googlear usar IA TICs',

    // --- Oficinas Virtuales y Enlaces de Apoyo ---
    'Oficinas virtuales administrativas cronograma encuentros sincrónicos canal de tutoría link de acceso meet google com rqr dsti iii Cooperadora SIU Guaraní Código de Convivencia Estudiante',
    'Repositorio documental instructivos tutoriales interactivos en Drive guías de navegación SIU Guaraní actualización obligatoria de datos censales verificación de inscripciones activas',
  ];

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
   * Resetea la instancia Singleton (solo para testing).
   * @internal
   */
  public static resetInstance(): void {
    AcademicGuardrail.instance = null;
  }

  /**
   * Inicializa el modelo y precalcula los embeddings de TODOS los anchor texts.
   * Se ejecuta una sola vez al arrancar la aplicación.
   */
  public async initialize(): Promise<void> {
    if (this.extractor) {
      return; // Ya inicializado
    }

    const cachePath = path.join(process.cwd(), 'data', '.hf-cache');

    try {
      env.cacheDir = cachePath;

      const cacheExists = fs.existsSync(cachePath) && fs.readdirSync(cachePath).length > 0;
      if (!cacheExists) {
        console.log('[AcademicGuardrail] Primera ejecución: descargando modelo semántico local (~23MB)...');
      } else {
        console.log('[AcademicGuardrail] Inicializando guardrail local con modelo en caché...');
      }

      try {
        this.extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
          dtype: 'q8',  // Modelo cuantizado: ~4x más rápido y ligero que fp32
        });
      } catch (pipelineError) {
        console.warn('[AcademicGuardrail] Error al cargar el modelo. Limpiando caché y reintentando...', pipelineError);

        // Limpieza de caché local
        if (fs.existsSync(cachePath)) {
          try {
            fs.rmSync(cachePath, { recursive: true, force: true });
            console.log('[AcademicGuardrail] Carpeta de caché local eliminada.');
          } catch (rmError) {
            console.error('[AcademicGuardrail] No se pudo eliminar la carpeta de caché:', rmError);
          }
        }

        // Segundo intento
        console.log('[AcademicGuardrail] Reintentando descarga del modelo...');
        this.extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
          dtype: 'q8',
        });
      }

      // Precalcular un embedding por cada anchor text
      this.referenceEmbeddings = [];
      const total = AcademicGuardrail.ANCHOR_TEXTS.length;
      for (let i = 0; i < total; i++) {
        const anchor = AcademicGuardrail.ANCHOR_TEXTS[i];
        const embedding = await this.getEmbedding(anchor);
        this.referenceEmbeddings.push(embedding);
      }
      console.log(`[AcademicGuardrail] Inicialización completada. ${this.referenceEmbeddings.length} embeddings de referencia listos.`);
    } catch (error) {
      console.error('[AcademicGuardrail] Error durante la inicialización:', error);
      throw error;
    }
  }

  /**
   * Valida semánticamente si el prompt del usuario está relacionado con el ámbito institucional del ISPC.
   * Compara contra TODOS los anchor embeddings y toma la similitud MÁXIMA.
   * 
   * @param userPrompt Prompt ingresado por el usuario
   * @param threshold Umbral mínimo de similitud de coseno (por defecto 0.42)
   */
  public async validatePrompt(
    userPrompt: string,
    threshold: number = 0.42
  ): Promise<{ isValid: boolean; similarity: number }> {
    if (!this.extractor) {
      // Si el modelo no se cargó, permitir todo (degradación graceful)
      console.warn('[AcademicGuardrail] Modelo no inicializado. Permitiendo consulta sin filtrar.');
      return { isValid: true, similarity: 1 };
    }

    const cleanPrompt = userPrompt.trim();
    if (cleanPrompt.length === 0) {
      return { isValid: false, similarity: 0 };
    }

    try {
      // Generar el embedding del prompt del usuario
      const promptEmbedding = await this.getEmbedding(cleanPrompt);

      // Calcular similitud contra CADA anchor y tomar el máximo
      let maxSimilarity = -1;
      for (const refEmb of this.referenceEmbeddings) {
        const sim = this.cosineSimilarity(refEmb, promptEmbedding);
        if (sim > maxSimilarity) {
          maxSimilarity = sim;
        }
      }

      return {
        isValid: maxSimilarity >= threshold,
        similarity: maxSimilarity,
      };
    } catch (error) {
      console.error('[AcademicGuardrail] Error al validar el prompt:', error);
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

    // Convertir el Tensor retornado por Transformers.js a un array estándar de JS
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
