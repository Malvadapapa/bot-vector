import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcademicGuardrail } from '../academic-guardrail.js';

vi.mock('@huggingface/transformers', () => {
  return {
    env: {
      cacheDir: '',
      localModelPath: '',
      allowRemoteModels: true,
    },
    pipeline: vi.fn(async () => {
      /**
       * Mock del extractor que genera vectores deterministas.
       * 
       * Estrategia:
       * - Textos académicos → vector en dimensión 0 (one-hot en dim 0)
       * - Textos off-topic → vector en dimensión 1 (one-hot en dim 1, ortogonal al académico)
       * - Textos ambiguos → vector mixto con componentes iguales en dim 0 y dim 1
       * 
       * El cosine similarity entre:
       * - Académico vs Académico = 1.0 (máxima similitud)
       * - Off-topic vs Off-topic = 1.0
       * - Académico vs Off-topic = 0.0 (completamente ortogonal)
       * - Ambiguo vs Académico ≈ 0.707 (parcialmente similar)
       */
      const extractor = vi.fn(async (text: string) => {
        const lower = text.toLowerCase();
        const academicTerms = [
          'inscripci', 'inscribirme', 'guaraní', 'guarani', 'siu',
          'examen', 'rendir', 'materia', 'ispc', 'instituto', 'cursad',
          'matricul', 'correlativa', 'regularidad', 'promoci', 'libre',
          'moodle', 'meet', 'aula virtual', 'certificado', 'analítico',
          'profesor', 'docente', 'coordinaci', 'tutoría', 'secretaría',
          'notas', 'calificacion', 'abp', 'régimen', 'comisión', 'cohorte',
          'desconexión', 'inactividad', 'recuperatorio', 'coloquio',
          'tecnicatura', 'desarrollo de software', 'carrera',
          'equivalencia', 'reconocimiento de saberes', 'trámite',
          'soporte', 'mesa de ayuda', 'oficina virtual',
          'interfaz', 'ingeniería', 'programación', 'gestión', 'ciencia de datos',
          'verificación', 'inteligencia artificial',
        ];
        const offTopicTerms = [
          'pizza', 'película', 'deporte', 'cocinar', 'receta', 'fútbol',
          'clima', 'horóscopo', 'netflix', 'bitcoin', 'criptomoneda',
        ];

        const isAcademic = academicTerms.some((term) => lower.includes(term));
        const isOffTopic = offTopicTerms.some((term) => lower.includes(term));

        // Crear vector de 384 dimensiones
        const values = new Array(384).fill(0);
        if (isAcademic) {
          // Vector académico: alta energía en las primeras dimensiones pares
          for (let i = 0; i < 384; i += 2) values[i] = 1.0;
        } else if (isOffTopic) {
          // Vector off-topic: alta energía en las primeras dimensiones impares (ortogonal)
          for (let i = 1; i < 384; i += 2) values[i] = 1.0;
        } else {
          // Ambiguo: energía distribuida en dimensiones 100-200 (diferente subespacio)
          for (let i = 100; i < 200; i++) values[i] = 1.0;
        }

        // L2 normalización
        const len = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0)) || 1.0;
        const normalized = values.map((v) => v / len);

        return {
          data: Float32Array.from(normalized),
        };
      });
      return extractor;
    }),
  };
});

describe('AcademicGuardrail - Pruebas Unitarias (Multi-Anchor)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Resetear el singleton para cada test para evitar estado residual
    AcademicGuardrail.resetInstance();
  });

  it('debería retornar el mismo Singleton', () => {
    const inst1 = AcademicGuardrail.getInstance();
    const inst2 = AcademicGuardrail.getInstance();
    expect(inst1).toBe(inst2);
  });

  it('debería inicializar y precalcular múltiples anchor embeddings', async () => {
    const guardrail = AcademicGuardrail.getInstance();
    await guardrail.initialize();

    // Verificamos que un prompt académico genérico es aceptado
    const res = await guardrail.validatePrompt('inscribirme a cursar en el siu');
    expect(res.isValid).toBe(true);
    expect(res.similarity).toBeGreaterThanOrEqual(0.42);
  });

  it('debería aprobar consultas sobre SIU Guaraní', async () => {
    const guardrail = AcademicGuardrail.getInstance();
    await guardrail.initialize();

    const res = await guardrail.validatePrompt('me podes decir como me inscribo en guarani?');
    expect(res.isValid).toBe(true);
    expect(res.similarity).toBeGreaterThanOrEqual(0.42);
  });

  it('debería aprobar consultas sobre exámenes y mesas', async () => {
    const guardrail = AcademicGuardrail.getInstance();
    await guardrail.initialize();

    const res = await guardrail.validatePrompt('cuando es la mesa de examen final?');
    expect(res.isValid).toBe(true);
    expect(res.similarity).toBeGreaterThanOrEqual(0.42);
  });

  it('debería aprobar consultas sobre materias y correlativas', async () => {
    const guardrail = AcademicGuardrail.getInstance();
    await guardrail.initialize();

    const res = await guardrail.validatePrompt('cuales son las correlativas de programacion?');
    expect(res.isValid).toBe(true);
    expect(res.similarity).toBeGreaterThanOrEqual(0.42);
  });

  it('debería aprobar consultas sobre trámites administrativos', async () => {
    const guardrail = AcademicGuardrail.getInstance();
    await guardrail.initialize();

    const res = await guardrail.validatePrompt('como pido el certificado de alumno regular');
    expect(res.isValid).toBe(true);
    expect(res.similarity).toBeGreaterThanOrEqual(0.42);
  });

  it('debería aprobar consultas sobre contactos institucionales', async () => {
    const guardrail = AcademicGuardrail.getInstance();
    await guardrail.initialize();

    const res = await guardrail.validatePrompt('cual es el mail de coordinación docente?');
    expect(res.isValid).toBe(true);
    expect(res.similarity).toBeGreaterThanOrEqual(0.42);
  });

  it('debería aprobar consultas sobre regularidad y condición', async () => {
    const guardrail = AcademicGuardrail.getInstance();
    await guardrail.initialize();

    const res = await guardrail.validatePrompt('si quedo libre en una materia puedo rendir la correlativa?');
    expect(res.isValid).toBe(true);
    expect(res.similarity).toBeGreaterThanOrEqual(0.42);
  });

  it('debería invalidar consultas off-topic con baja similitud', async () => {
    const guardrail = AcademicGuardrail.getInstance();
    await guardrail.initialize();

    const res = await guardrail.validatePrompt('cómo cocinar una pizza napolitana');
    expect(res.isValid).toBe(false);
    expect(res.similarity).toBeLessThan(0.42);
  });

  it('debería invalidar consultas sobre entretenimiento', async () => {
    const guardrail = AcademicGuardrail.getInstance();
    await guardrail.initialize();

    const res = await guardrail.validatePrompt('recomiendame una película de netflix buena');
    expect(res.isValid).toBe(false);
    expect(res.similarity).toBeLessThan(0.42);
  });

  it('debería invalidar consultas sobre deportes', async () => {
    const guardrail = AcademicGuardrail.getInstance();
    await guardrail.initialize();

    const res = await guardrail.validatePrompt('cuando juega argentina de fútbol');
    expect(res.isValid).toBe(false);
    expect(res.similarity).toBeLessThan(0.42);
  });

  it('debería retornar isValid=false y similarity=0 para prompt vacío', async () => {
    const guardrail = AcademicGuardrail.getInstance();
    await guardrail.initialize();

    const res = await guardrail.validatePrompt('   ');
    expect(res.isValid).toBe(false);
    expect(res.similarity).toBe(0);
  });
});
