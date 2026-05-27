"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
require("dotenv/config");
const rag_pipeline_service_js_1 = require("./rag-pipeline.service.js");
const gemini_embedding_provider_js_1 = require("../infrastructure/integrations/ai/gemini-embedding.provider.js");
const KNOWLEDGE_DIR = node_path_1.default.join(process.cwd(), 'data', 'ai-context');
const STATE_FILE = node_path_1.default.join(process.cwd(), 'data', 'vectores', 'sync_state.json');
const STORAGE_FILE = node_path_1.default.join(process.cwd(), 'data', 'vectores', 'vector_store.json');
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'status';
    const embeddingProvider = new gemini_embedding_provider_js_1.GeminiEmbeddingProvider(process.env.GEMINI_API_KEY || '');
    const pipeline = new rag_pipeline_service_js_1.RagPipelineService(KNOWLEDGE_DIR, STATE_FILE, STORAGE_FILE, embeddingProvider);
    try {
        switch (command) {
            case 'index':
            case 'reindex':
                console.log('Forzando indexación completa (reindexando todo)...');
                await pipeline.runSync(true);
                break;
            case 'check':
                console.log('Verificando si hay cambios (indexación parcial)...');
                await pipeline.runSync(false);
                break;
            case 'status':
                const status = await pipeline.getStatus();
                console.log('\n=== Estado del Índice RAG ===');
                console.log(`Documentos procesados: ${status.files}`);
                console.log(`Vectores generados (chunks): ${status.totalVectors}`);
                console.log('=============================\n');
                break;
            case 'test':
                const query = args.slice(1).join(' ') || '¿Cómo son las correlatividades de Desarrollo de Software?';
                await pipeline.testSearch(query);
                break;
            default:
                console.log('Comando no reconocido. Opciones: index | check | reindex | status | test "tu pregunta"');
                process.exit(1);
        }
    }
    catch (error) {
        console.error('Error ejecutando RAG CLI:', error);
        process.exit(1);
    }
}
main();
