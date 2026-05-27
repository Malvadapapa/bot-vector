"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
require("dotenv/config");
const gemini_embedding_provider_js_1 = require("../infrastructure/integrations/ai/gemini-embedding.provider.js");
const rag_pipeline_service_js_1 = require("./rag-pipeline.service.js");
const rag_query_service_js_1 = require("./rag-query.service.js");
async function runE2E() {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
        console.error('Error: GEMINI_API_KEY no configurada. Saliendo del test E2E.');
        process.exit(1);
    }
    const ragKnowledgeDir = node_path_1.default.join(process.cwd(), 'data', 'ai-context');
    const ragStoragePath = node_path_1.default.join(process.cwd(), 'data', 'vectores', 'test_vector_store.json');
    const ragStatePath = node_path_1.default.join(process.cwd(), 'data', 'vectores', 'test_sync_state.json');
    console.log('--- Iniciando Test E2E del RAG ---');
    const embeddingProvider = new gemini_embedding_provider_js_1.GeminiEmbeddingProvider(apiKey);
    // 1. Indexación
    const pipeline = new rag_pipeline_service_js_1.RagPipelineService(ragKnowledgeDir, ragStatePath, ragStoragePath, embeddingProvider);
    console.log('\n1. Ejecutando Pipeline (Indexación)...');
    await pipeline.runSync(true); // forceAll para probar todo
    const status = await pipeline.getStatus();
    console.log(`\nEstado post-indexación: ${status.files} archivos, ${status.totalVectors} vectores, ${status.failed} fallidos.`);
    // 2. Búsqueda
    const queryService = new rag_query_service_js_1.RagQueryService(ragStoragePath, embeddingProvider);
    console.log('\n2. Ejecutando Búsqueda...');
    const queries = [
        '¿Qué son las correlativas?',
        'Mencioná las materias de primer año',
        'Hola, ¿qué tal?' // Debería ser weak match o vacío
    ];
    for (const q of queries) {
        console.log(`\nConsulta: "${q}"`);
        const results = await queryService.search(q, 2);
        if (results.length === 0) {
            console.log('  -> Sin resultados.');
        }
        else {
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const pageInfo = r.pageNumber ? `(Página ${r.pageNumber})` : '';
                const weakInfo = r.weak ? '[DÉBIL]' : '[FUERTE]';
                console.log(`  -> ${i + 1}. Score: ${r.score.toFixed(3)} ${weakInfo} | Doc: ${r.sourceFile} ${pageInfo}`);
                console.log(`     "${r.text.substring(0, 150).replace(/\n/g, ' ')}..."`);
            }
        }
    }
    console.log('\n--- Fin del Test E2E del RAG ---');
}
runE2E().catch(err => {
    console.error('Error no controlado en Test E2E:', err);
    process.exit(1);
});
