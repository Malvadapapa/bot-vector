import { AIProvider } from './ai-provider.interface.js';

export class FallbackAIService implements AIProvider {
  private activeProviderIndex = 0;

  constructor(private providers: AIProvider[]) {
    if (providers.length === 0) {
      throw new Error('FallbackAIService requiere al menos un proveedor.');
    }
  }

  public async generateContent(userId: string, prompt: string, rawPrompt?: string): Promise<string> {
    let lastError: any = null;

    for (let i = 0; i < this.providers.length; i++) {
      // Intentamos con el proveedor activo actual, si falla probamos el siguiente (round-robin parcial)
      const attemptIndex = (this.activeProviderIndex + i) % this.providers.length;
      const provider = this.providers[attemptIndex];

      try {
        const response = await provider.generateContent(userId, prompt, rawPrompt);
        // Si tuvo éxito, actualizamos el proveedor activo para seguir usándolo
        this.activeProviderIndex = attemptIndex;
        return response;
      } catch (error: any) {
        lastError = error;
        const isQuota = provider.isQuotaError(error);
        const name = provider.getModelName();
        
        console.warn(`[FallbackAI] Error con proveedor ${name} (isQuota: ${isQuota}):`, error?.message || error);
        
        if (!isQuota) {
          // Si no es un error de cuota/rate limit, probamos el siguiente por las dudas,
          // pero típicamente los fallbacks se usan más para rate limits.
        }
      }
    }

    throw lastError || new Error('Todos los proveedores fallaron.');
  }

  public getModelName(): string {
    return this.providers[this.activeProviderIndex].getModelName();
  }

  public isQuotaError(error: any): boolean {
    return this.providers[this.activeProviderIndex].isQuotaError(error);
  }
}
