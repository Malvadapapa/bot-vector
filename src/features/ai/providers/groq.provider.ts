import 'dotenv/config';
import { AIProvider } from './ai-provider.interface.js';

export class GroqProvider implements AIProvider {
  private readonly apiKey = process.env.GROQ_API_KEY || '';
  private readonly apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
  private readonly modelsUrl = 'https://api.groq.com/openai/v1/models';
  private readonly defaultModel = 'llama-3.3-70b-versatile';
  private initialized = false;

  constructor(private systemInstructions: string) {}

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.apiKey) return;

    try {
      const response = await fetch(this.modelsUrl, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      if (response.ok) {
        const data: any = await response.json();
        const models = data.data.map((m: any) => m.id);
        console.log(`[IA] Modelos disponibles en Groq: ${models.slice(0, 10).join(', ')}${models.length > 10 ? '...' : ''}`);
      }
    } catch (e) {
      console.warn('[IA] No se pudieron obtener los modelos de Groq.', e);
    }
    this.initialized = true;
  }

  public async generateContent(userId: string, prompt: string, rawPrompt?: string): Promise<string> {
    await this.initialize();
    
    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY no configurada.');
    }

    const payload = {
      model: this.defaultModel,
      messages: [
        { role: 'system', content: this.systemInstructions },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 1024
    };

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw {
        status: response.status,
        message: `Error Groq API: ${response.statusText}`,
        details: errorData
      };
    }

    const data: any = await response.json();
    return data.choices[0]?.message?.content?.trim() || '';
  }

  public getModelName(): string {
    return `Groq (${this.defaultModel})`;
  }

  public isQuotaError(error: any): boolean {
    const status = error?.status || error?.details?.error?.code;
    const msg = String(error?.message || '').toLowerCase();
    return status === 429 || msg.includes('rate limit');
  }
}
