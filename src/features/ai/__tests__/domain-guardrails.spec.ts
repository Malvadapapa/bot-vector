import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_BOT_INSTRUCTIONS } from '../../../shared/config/instructions.js';
import { GeminiService } from '../providers/gemini.service.js';
import { GroqProvider } from '../providers/groq.provider.js';

vi.mock('@google/generative-ai', () => {
  const mockGetGenerativeModel = vi.fn((opts) => {
    return {
      opts,
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
  });

  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => {
      return {
        getGenerativeModel: mockGetGenerativeModel,
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

describe('Domain Guardrails (BUG-009) - Pruebas', () => {
  it('debería contener instrucciones de sistema que prohíben la generación creativa e historias de ficción', () => {
    expect(DEFAULT_BOT_INSTRUCTIONS).toContain('prohibido responder a consultas que estén fuera del contexto del ISPC');
    expect(DEFAULT_BOT_INSTRUCTIONS).toContain('crear contenido creativo o de ficción');
    expect(DEFAULT_BOT_INSTRUCTIONS).toContain('cuentos, poemas, chistes, historias o juegos de rol');
  });

  it('debería configurar GeminiService con temperature 0.1 y topP 0.95', async () => {
    process.env.GEMINI_API_KEY = 'mock-api-key';
    const geminiService = new GeminiService();
    
    vi.spyOn(geminiService as any, 'listAvailableModels').mockResolvedValue(new Set(['gemini-2.5-flash']));
    
    await geminiService.initialize();
    
    const modelChain = (geminiService as any).modelChain;
    expect(modelChain).toBeDefined();
    expect(modelChain.length).toBeGreaterThan(0);
    
    const firstModel = modelChain[0];
    expect(firstModel.instance.opts).toBeDefined();
    expect(firstModel.instance.opts.generationConfig).toBeDefined();
    expect(firstModel.instance.opts.generationConfig.temperature).toBe(0.1);
    expect(firstModel.instance.opts.generationConfig.topP).toBe(0.95);
  });

  it('debería enviar la consulta a Groq con temperature 0.1', async () => {
    const groqProvider = new GroqProvider('instrucciones');
    
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/models')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'llama-3.3-70b-versatile' }]
          })
        } as any;
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Respuesta de Groq' } }]
        })
      } as any;
    });

    process.env.GROQ_API_KEY = 'mock-groq-key';
    await groqProvider.generateContent('user-1', '¿Cuáles son las correlativas de Programación 1?');
    
    expect(fetchSpy).toHaveBeenCalled();
    // find the call that post-ed to completions
    const completionCall = fetchSpy.mock.calls.find(call => String(call[0]).includes('/chat/completions'));
    expect(completionCall).toBeDefined();
    const body = JSON.parse(completionCall![1]?.body as string);
    expect(body.temperature).toBe(0.1);
  });
});
