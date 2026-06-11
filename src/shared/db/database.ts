import sqlite3 from 'sqlite3';
import path from 'path';
import * as fs from 'fs';
import { createClient } from '@libsql/client';
import { applyMigrations } from './migrations.js';

class LibsqlDatabase {
  private client: any;
  private errorCallback?: (err: Error) => void;

  constructor(url: string, token: string) {
    this.client = createClient({ url, authToken: token });
  }

  run(sql: string, params: any, callback?: any) {
    let actualParams = params;
    let actualCallback = callback;
    if (typeof params === 'function') {
      actualCallback = params;
      actualParams = [];
    }

    if (sql.trim().toUpperCase().startsWith('PRAGMA ')) {
      if (actualCallback) {
        actualCallback.call({}, null);
      }
      return;
    }

    this.client.execute({ sql, args: actualParams })
      .then((res: any) => {
        if (actualCallback) {
          const context = {
            lastID: res.lastInsertRowid ? Number(res.lastInsertRowid) : 0,
            changes: Number(res.rowsAffected || 0)
          };
          actualCallback.call(context, null);
        }
      })
      .catch((err: any) => {
        if (this.errorCallback) this.errorCallback(err);
        if (actualCallback) actualCallback(err);
      });
  }

  get(sql: string, params: any, callback?: any) {
    let actualParams = params;
    let actualCallback = callback;
    if (typeof params === 'function') {
      actualCallback = params;
      actualParams = [];
    }

    if (sql.trim().toUpperCase().startsWith('PRAGMA ')) {
      if (actualCallback) {
        actualCallback(null, null);
      }
      return;
    }

    this.client.execute({ sql, args: actualParams })
      .then((res: any) => {
        if (actualCallback) {
          const row = res.rows[0];
          actualCallback(null, row || null);
        }
      })
      .catch((err: any) => {
        if (this.errorCallback) this.errorCallback(err);
        if (actualCallback) actualCallback(err);
      });
  }

  all(sql: string, params: any, callback?: any) {
    let actualParams = params;
    let actualCallback = callback;
    if (typeof params === 'function') {
      actualCallback = params;
      actualParams = [];
    }

    if (sql.trim().toUpperCase().startsWith('PRAGMA ')) {
      if (actualCallback) {
        actualCallback(null, []);
      }
      return;
    }

    this.client.execute({ sql, args: actualParams })
      .then((res: any) => {
        if (actualCallback) {
          actualCallback(null, res.rows);
        }
      })
      .catch((err: any) => {
        if (this.errorCallback) this.errorCallback(err);
        if (actualCallback) actualCallback(err);
      });
  }

  close(callback?: any) {
    try {
      this.client.close();
      if (callback) callback(null);
    } catch (err: any) {
      if (callback) callback(err);
    }
  }

  on(event: string, callback: any) {
    if (event === 'error') {
      this.errorCallback = callback;
    }
  }
}

export class DatabaseConnection {
  private db!: sqlite3.Database;
  private ready: Promise<void>;

  constructor(dbFilePath?: string) {
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    const tursoToken = process.env.TURSO_AUTH_TOKEN;

    if (tursoUrl && tursoToken) {
      console.log(`[BD] Iniciando conexión remota con Turso...`);
      this.ready = new Promise((resolve, reject) => {
        try {
          this.db = new LibsqlDatabase(tursoUrl, tursoToken) as any;
          this.db.run('PRAGMA foreign_keys = ON;', async (pragmaErr) => {
            try {
              console.log(`[BD] Conectado a Turso (URL: ${tursoUrl})`);
              console.log(`[BD] ☁️  ¡CONFIRMADO: USANDO BASE DE DATOS EN LA NUBE (TURSO)!`);
              await applyMigrations(this.db);
              console.log('[BD] Esquema verificado y migraciones aplicadas en Turso');
              resolve();
            } catch (migrationErr) {
              const msg = (migrationErr as any)?.message || 'error desconocido';
              console.error(`[BD] Error aplicando migraciones en Turso: ${msg}`);
              reject(migrationErr);
            }
          });
        } catch (err) {
          reject(err);
        }
      });
    } else {
      const dataDir = path.join(process.cwd(), 'data');
      const finalPath = dbFilePath || path.join(dataDir, 'chatbot.db');

      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log(`[BD] Directorio de datos creado: ${dataDir}`);
      }

      this.ready = new Promise((resolve, reject) => {
        this.db = new sqlite3.Database(finalPath, (err) => {
          if (err) {
            console.error(`[BD] No se pudo abrir la base de datos local: ${err.message}`);
            reject(err);
            return;
          }

          this.db.run('PRAGMA foreign_keys = ON;', async (pragmaErr) => {
            if (pragmaErr) {
              console.error(`[BD] Error al activar foreign_keys local: ${pragmaErr.message}`);
            }
            try {
              console.log(`[BD] Conectado localmente a: ${finalPath}`);
              console.log(`[BD] 💻 ¡ATENCIÓN: USANDO BASE DE DATOS LOCAL (SQLITE)!`);
              await applyMigrations(this.db);
              console.log('[BD] Esquema verificado y migraciones aplicadas localmente');
              resolve();
            } catch (migrationErr) {
              const msg = (migrationErr as any)?.message || 'error desconocido';
              console.error(`[BD] Error aplicando migraciones locales: ${msg}`);
              reject(migrationErr);
            }
          });
        });

        this.db?.on('error', (dbErr) => {
          console.error(`[BD] Error de base de datos local: ${dbErr.message}`);
        });
      });
    }
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

