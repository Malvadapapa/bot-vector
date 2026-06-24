import { DatabaseConnection } from '../dist/shared/db/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('[Migrations] Iniciando conexión y aplicando migraciones...');
  const dbConn = new DatabaseConnection();
  await dbConn.waitUntilReady();
  console.log('[Migrations] Migraciones aplicadas con éxito.');
  dbConn.close();
}

main().catch(console.error);
