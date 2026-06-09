import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiService } from '../providers/gemini.service.js';
import fs from 'node:fs/promises';

// Mock dependencies to avoid actual network or disk activity
vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => {
      return {
        getGenerativeModel: vi.fn().mockImplementation(() => {
          return {
            startChat: vi.fn().mockImplementation(() => {
              return {
                sendMessage: vi.fn().mockResolvedValue({
                  response: {
                    text: () => 'Respuesta Simulada',
                  },
                }),
              };
            }),
          };
        }),
      };
    }),
  };
});

vi.mock('@google/generative-ai/server', () => {
  return {
    GoogleAIFileManager: vi.fn().mockImplementation(() => {
      return {
        getFile: vi.fn().mockResolvedValue({ state: 'ACTIVE', uri: 'http://uri-mock' }),
        uploadFile: vi.fn(),
      };
    }),
  };
});

vi.mock('node:fs/promises', () => {
  return {
    default: {
      mkdir: vi.fn(),
      readdir: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
      writeFile: vi.fn(),
    },
  };
});

describe('Aislamiento de Memoria Conversacional (BUG-003) - Pruebas', () => {
  let geminiService: GeminiService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'mock-api-key';
    geminiService = new GeminiService();
  });

  it('debería guardar únicamente el prompt limpio del usuario en el historial y no el prompt enriquecido', async () => {
    // 1. Ejecutar generateContent con un prompt enriquecido (que simula RAG/system instructions)
    //    y un rawPrompt (que representa la pregunta del estudiante limpia)
    const userId = 'user-student-123';
    const enrichedPrompt = 'INSTRUCCIONES DE SISTEMA:\n...\n\nCONTEXTO RAG:\n...\n\nPregunta del alumno: ¿A qué hora rindo hoy?';
    const cleanPrompt = '¿A qué hora rindo hoy?';

    const response = await geminiService.generateContent(userId, enrichedPrompt, cleanPrompt);
    expect(response).toBe('Respuesta Simulada');

    // 2. Inspeccionar la sesión interna
    const session = (geminiService as any).sessions.get(userId);
    expect(session).toBeDefined();
    expect(session.turns).toHaveLength(1);
    
    // Assert: Debe guardar la pregunta limpia ("¿A qué hora rindo hoy?") y no las instrucciones del sistema
    expect(session.turns[0].user).toBe(cleanPrompt);
    expect(session.turns[0].model).toBe('Respuesta Simulada');
    expect(session.turns[0].timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('debería filtrar y eliminar los turnos del historial que superen las 12 horas de antigüedad', async () => {
    const userId = 'user-student-456';
    
    // Inicializamos una sesión directamente inyectando dos turnos:
    // Uno viejo (hace 13 horas) y uno nuevo (hace 2 horas)
    const now = Date.now();
    const thirteenHoursAgo = now - 13 * 60 * 60 * 1000;
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;

    const session = {
      turns: [
        { user: 'pregunta vieja', model: 'respuesta vieja', timestamp: thirteenHoursAgo },
        { user: 'pregunta nueva', model: 'respuesta nueva', timestamp: twoHoursAgo },
      ],
      lastActivity: twoHoursAgo,
    };
    (geminiService as any).sessions.set(userId, session);

    // Ejecutamos una nueva consulta para gatillar la limpieza y construcción del nuevo historial
    const enrichedPrompt = '¿Cómo me contacto con el profesor?';
    const cleanPrompt = '¿Cómo me contacto con el profesor?';

    await geminiService.generateContent(userId, enrichedPrompt, cleanPrompt);

    // Inspeccionar la sesión interna actualizada
    const updatedSession = (geminiService as any).sessions.get(userId);
    expect(updatedSession).toBeDefined();
    
    // El turno viejo de 13 horas debe haber sido eliminado, quedando solo el de hace 2 horas y el nuevo turno actual.
    // Total de turnos esperados: 2 (pregunta nueva + pregunta actual)
    expect(updatedSession.turns).toHaveLength(2);
    expect(updatedSession.turns[0].user).toBe('pregunta nueva');
    expect(updatedSession.turns[1].user).toBe(cleanPrompt);
  });
});
