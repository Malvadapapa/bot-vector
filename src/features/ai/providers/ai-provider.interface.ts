export interface AIProvider {
  /** Genera contenido a partir de un prompt. */
  generateContent(userId: string, prompt: string, rawPrompt?: string): Promise<string>;
  
  /** Devuelve el nombre del proveedor y del modelo activo. */
  getModelName(): string;
  
  /** Indica si el error se debe a límite de cuota (rate limit) o error temporal (503). */
  isQuotaError(error: any): boolean;
}
