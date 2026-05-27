"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroqProvider = void 0;
require("dotenv/config");
class GroqProvider {
    constructor(systemInstructions) {
        this.systemInstructions = systemInstructions;
        this.apiKey = process.env.GROQ_API_KEY || '';
        this.apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
        this.modelsUrl = 'https://api.groq.com/openai/v1/models';
        this.defaultModel = 'llama-3.3-70b-versatile';
        this.initialized = false;
    }
    async initialize() {
        if (this.initialized)
            return;
        if (!this.apiKey)
            return;
        try {
            const response = await fetch(this.modelsUrl, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });
            if (response.ok) {
                const data = await response.json();
                const models = data.data.map((m) => m.id);
                console.log(`[IA] Modelos disponibles en Groq: ${models.slice(0, 10).join(', ')}${models.length > 10 ? '...' : ''}`);
            }
        }
        catch (e) {
            console.warn('[IA] No se pudieron obtener los modelos de Groq.', e);
        }
        this.initialized = true;
    }
    async generateContent(userId, prompt) {
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
            temperature: 0.7,
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
        const data = await response.json();
        return data.choices[0]?.message?.content?.trim() || '';
    }
    getModelName() {
        return `Groq (${this.defaultModel})`;
    }
    isQuotaError(error) {
        const status = error?.status || error?.details?.error?.code;
        const msg = String(error?.message || '').toLowerCase();
        return status === 429 || msg.includes('rate limit');
    }
}
exports.GroqProvider = GroqProvider;
