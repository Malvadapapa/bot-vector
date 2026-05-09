import sqlite3 from 'sqlite3';
import path from 'path';
import * as fs from 'fs';
import { applyMigrations } from './db/migrations.js';

export class DatabaseConnection {
  private db!: sqlite3.Database;
  private ready: Promise<void>;

  constructor(dbFilePath?: string) {
    const dataDir = path.join(process.cwd(), 'data');
    const finalPath = dbFilePath || path.join(dataDir, 'chatbot.db');

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log(`[BD] Directorio de datos creado: ${dataDir}`);
    }

    this.ready = new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(finalPath, async (err) => {
        if (err) {
          console.error(`[BD] No se pudo abrir la base de datos: ${err.message}`);
          reject(err);
          return;
        }

        try {
          console.log(`[BD] Conectado a: ${finalPath}`);
          await applyMigrations(this.db);
          console.log('[BD] Esquema verificado y migraciones aplicadas');
          resolve();
        } catch (migrationErr) {
          const msg = (migrationErr as any)?.message || 'error desconocido';
          console.error(`[BD] Error aplicando migraciones: ${msg}`);
          reject(migrationErr);
        }
      });

      this.db?.on('error', (dbErr) => {
        console.error(`[BD] Error de base de datos: ${dbErr.message}`);
      });
    });
  }

  public async waitUntilReady(): Promise<void> {
    await this.ready;
  }

  public getDb(): sqlite3.Database {
    return this.db;
  }

  public close(): void {
    this.db.close((err) => {
      if (err) {
        console.error(`[BD] Error al cerrar la base de datos: ${err.message}`);
      } else {
        console.log('[BD] Base de datos cerrada');
      }
    });
  }
}
