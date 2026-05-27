"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FallbackAIService = void 0;
class FallbackAIService {
    constructor(providers) {
        this.providers = providers;
        this.activeProviderIndex = 0;
        if (providers.length === 0) {
            throw new Error('FallbackAIService requiere al menos un proveedor.');
        }
    }
    async generateContent(userId, prompt) {
        let lastError = null;
        for (let i = 0; i < this.providers.length; i++) {
            // Intentamos con el proveedor activo actual, si falla probamos el siguiente (round-robin parcial)
            const attemptIndex = (this.activeProviderIndex + i) % this.providers.length;
            const provider = this.providers[attemptIndex];
            try {
                const response = await provider.generateContent(userId, prompt);
                // Si tuvo éxito, actualizamos el proveedor activo para seguir usándolo
                this.activeProviderIndex = attemptIndex;
                return response;
            }
            catch (error) {
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
    getModelName() {
        return this.providers[this.activeProviderIndex].getModelName();
    }
    isQuotaError(error) {
        return this.providers[this.activeProviderIndex].isQuotaError(error);
    }
}
exports.FallbackAIService = FallbackAIService;
