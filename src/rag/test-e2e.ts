import path from 'node:path';
import 'dotenv/config';
import { GeminiEmbeddingProvider } from '../infrastructure/integrations/ai/gemini-embedding.provider.js';
import { RagPipelineService } from './rag-pipeline.service.js';
import { RagQueryService } from './rag-query.service.js';

async function runE2E() {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY no configurada. Saliendo del test E2E.');
    process.exit(1);
  }

  const ragKnowledgeDir = path.join(process.cwd(), 'data', 'ai-context');
  const ragStoragePath = path.join(process.cwd(), 'data', 'vectores', 'test_vector_store.json');
  const ragStatePath = path.join(process.cwd(), 'data', 'vectores', 'test_sync_state.json');

  console.log('--- Iniciando Test E2E del RAG ---');
  
  const embeddingProvider = new GeminiEmbeddingProvider(apiKey);
  
  // 1. Indexación
  const pipeline = new RagPipelineService(ragKnowledgeDir, ragStatePath, ragStoragePath, embeddingProvider);
  console.log('\n1. Ejecutando Pipeline (Indexación)...');
  await pipeline.runSync(true); // forceAll para probar todo
  
  const status = await pipeline.getStatus();
  console.log(`\nEstado post-indexación: ${status.files} archivos, ${status.totalVectors} vectores, ${status.failed} fallidos.`);

  // 2. Búsqueda
  const queryService = new RagQueryService(ragStoragePath, embeddingProvider);
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
    } else {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const pageInfo = r.pageNumber ? `(Página ${r.pageNumber})` : '';
        const weakInfo = r.weak ? '[DÉBIL]' : '[FUERTE]';
        console.log(`  -> ${i+1}. Score: ${r.score.toFixed(3)} ${weakInfo} | Doc: ${r.sourceFile} ${pageInfo}`);
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
