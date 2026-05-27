"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
require("dotenv/config");
const gemini_service_js_1 = require("../infrastructure/integrations/ai/gemini.service.js");
const embedding_generator_js_1 = require("./embedding-generator.js");
const vector_storage_js_1 = require("./vector-storage.js");
const generative_ai_1 = require("@google/generative-ai");
const KNOWLEDGE_DIR = node_path_1.default.join(process.cwd(), 'data', 'ai-context');
const STATE_FILE = node_path_1.default.join(process.cwd(), 'data', 'vectores', 'sync_state.json');
const STORAGE_FILE = node_path_1.default.join(process.cwd(), 'data', 'vectores', 'vector_store.json');
async function main() {
    const query = process.argv.slice(2).join(' ') || 'Si quedé libre en Desarrollo de Software, ¿puedo cursar Práctica Profesionalizante?';
    console.log(`\n======================================================`);
    console.log(`🔍 PREGUNTA: "${query}"`);
    console.log(`======================================================\n`);
    // 1. OBTENER CONTEXTO POR RAG
    console.log('⏳ Inicializando RAG local...');
    const vectorStorage = new vector_storage_js_1.VectorStorage(STORAGE_FILE);
    await vectorStorage.load();
    const embeddingGenerator = new embedding_generator_js_1.EmbeddingGenerator(process.env.GEMINI_API_KEY);
    const queryVector = await embeddingGenerator.generateEmbedding(query);
    const ragResults = await vectorStorage.searchSimilar(queryVector, 4); // top 4 chunks
    const ragContextText = ragResults.map((r, i) => `[Fragmento ${i + 1} de ${r.record.metadata.sourceFile}]:\n${r.record.text}`).join('\n\n');
    console.log('✅ Contexto RAG recuperado. Fragmentos encontrados:');
    ragResults.forEach(r => console.log(`   - ${r.record.metadata.sourceFile} (similitud: ${r.score.toFixed(3)})`));
    // Generar respuesta usando RAG
    console.log('\n⏳ Generando respuesta RAG con Gemini...');
    const genAI = new generative_ai_1.GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const ragPrompt = `Sos el asistente del ISPC. Respondé a la siguiente pregunta usando EXCLUSIVAMENTE los fragmentos de reglamento provistos a continuación. Si la respuesta no está en los fragmentos, decí que no tenés esa información.\n\nFRAGMENTOS:\n${ragContextText}\n\nPREGUNTA:\n${query}`;
    const ragStartTime = Date.now();
    const ragResponse = await model.generateContent(ragPrompt);
    const ragTime = Date.now() - ragStartTime;
    const ragAnswer = ragResponse.response.text();
    // 2. OBTENER RESPUESTA POR CACHÉ NATIVA DE GEMINI
    console.log('\n⏳ Inicializando GeminiService (Contexto Nativo/File API)...');
    const geminiService = new gemini_service_js_1.GeminiService();
    await geminiService.initialize();
    console.log('⏳ Generando respuesta Nativa con Gemini...');
    const nativeStartTime = Date.now();
    // El GeminiService ya tiene los archivos PDF inyectados en su history base
    const nativeAnswer = await geminiService.generateContent('user-test-rag', query);
    const nativeTime = Date.now() - nativeStartTime;
    // 3. COMPARAR RESULTADOS
    console.log(`\n======================================================`);
    console.log(`🤖 RESULTADO 1: RAG LOCAL (Tiempo: ${ragTime}ms)`);
    console.log(`======================================================`);
    console.log(ragAnswer);
    console.log(`\n======================================================`);
    console.log(`🤖 RESULTADO 2: GEMINI NATIVE API (Tiempo: ${nativeTime}ms)`);
    console.log(`======================================================`);
    console.log(nativeAnswer);
    console.log(`\n`);
}
main().catch(console.error);
