import path from 'node:path';
import 'dotenv/config';
import { RagPipelineService } from './rag-pipeline.service.js';
import { GeminiEmbeddingProvider } from '../providers/gemini-embedding.provider.js';

const KNOWLEDGE_DIR = path.join(process.cwd(), 'data', 'ai-context');
const STATE_FILE = path.join(process.cwd(), 'data', 'vectores', 'sync_state.json');
const STORAGE_FILE = path.join(process.cwd(), 'data', 'vectores', 'vector_store.json');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  const embeddingProvider = new GeminiEmbeddingProvider(process.env.GEMINI_API_KEY || '');
  const pipeline = new RagPipelineService(KNOWLEDGE_DIR, STATE_FILE, STORAGE_FILE, embeddingProvider);

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
  } catch (error) {
    console.error('Error ejecutando RAG CLI:', error);
    process.exit(1);
  }
}

main();
