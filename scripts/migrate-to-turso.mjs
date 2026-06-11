import sqlite3 from 'sqlite3';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
const sqlitePath = process.env.SQLITE_PATH || 'data/chatbot.db';

if (!tursoUrl || !tursoToken) {
  console.error('ERROR: Por favor configura TURSO_DATABASE_URL y TURSO_AUTH_TOKEN en tu archivo .env antes de ejecutar este script.');
  process.exit(1);
}

const localDbPath = path.resolve(sqlitePath);
if (!fs.existsSync(localDbPath)) {
  console.error(`ERROR: No se encontró la base de datos local en: ${localDbPath}`);
  process.exit(1);
}

console.log('--- Iniciando Migración a Turso ---');
console.log('BD Local:', localDbPath);
console.log('Turso URL:', tursoUrl);

// 1. Abrir base de datos local
const localDb = new sqlite3.Database(localDbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Error al abrir la base de datos local:', err);
    process.exit(1);
  }
});

// 2. Conectar a Turso
const tursoClient = createClient({ url: tursoUrl, authToken: tursoToken });

// Promisificar las consultas de sqlite3
const localAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    localDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const TABLES = [
  'commissions',
  'whatsapp_groups',
  'user_profiles',
  'admin_users',
  'admin_verification_codes',
  'managed_exams',
  'managed_classes',
  'class_notifications',
  'managed_teachers',
  'user_daily_greetings',
  'user_moderation_state',
  'group_context',
  'group_context_commissions',
  'class_commission_schedule',
  'group_admins',
  'group_memberships',
  'cohort_configs',
  'inbound_email_rejections',
  'reminders',
  'rate_limit',
  'confirmaciones',
  'institutional_notices',
  'scheduler_runs',
  'outbox_dedup',
  'schema_migrations'
];

async function runMigration() {
  try {
    console.log('\n1. Aplicando/Verificando esquema en la base de datos remota...');
    const { applyMigrations } = await import('../dist/shared/db/migrations.js');
    
    const wrappedTursoDb = {
      run(sql, params, callback) {
        let actualParams = params;
        let actualCallback = callback;
        if (typeof params === 'function') {
          actualCallback = params;
          actualParams = [];
        }
        if (sql.trim().toUpperCase().startsWith('PRAGMA ')) {
          if (actualCallback) actualCallback(null);
          return;
        }
        tursoClient.execute({ sql, args: actualParams })
          .then(() => { if (actualCallback) actualCallback(null); })
          .catch((err) => { if (actualCallback) actualCallback(err); });
      },
      all(sql, params, callback) {
        let actualParams = params;
        let actualCallback = callback;
        if (typeof params === 'function') {
          actualCallback = params;
          actualParams = [];
        }
        if (sql.trim().toUpperCase().startsWith('PRAGMA ')) {
          if (actualCallback) actualCallback(null, []);
          return;
        }
        tursoClient.execute({ sql, args: actualParams })
          .then((res) => { if (actualCallback) actualCallback(null, res.rows); })
          .catch((err) => { if (actualCallback) actualCallback(err); });
      }
    };

    await applyMigrations(wrappedTursoDb);
    console.log('✅ Esquema y migraciones verificadas en Turso.');

    console.log('\n2. Limpiando datos existentes en Turso en orden inverso de dependencias...');
    const REVERSE_TABLES = TABLES.slice().reverse();
    for (const table of REVERSE_TABLES) {
      try {
        await tursoClient.execute(`DELETE FROM ${table}`);
      } catch (e) {
        // En caso de que falle porque la tabla no existe en Turso todavía
      }
    }
    console.log('✅ Base de datos remota limpia.');

    console.log('\n3. Transfiriendo datos tabla por tabla...');

    for (const table of TABLES) {
      // Verificar si la tabla existe localmente
      const checkTable = await localAll(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, [table]);
      if (checkTable.length === 0) {
        console.log(`- Tabla "${table}" no existe localmente. Omitiendo.`);
        continue;
      }

      const rows = await localAll(`SELECT * FROM ${table}`);
      if (rows.length === 0) {
        console.log(`- Tabla "${table}" está vacía localmente. Omitiendo.`);
        continue;
      }

      // Obtener columnas de la tabla remota para filtrar las columnas locales
      const remoteInfo = await tursoClient.execute(`PRAGMA table_info(${table})`);
      const remoteColumns = new Set(remoteInfo.rows.map(r => String(r.name)));

      console.log(`- Migrando tabla "${table}" (${rows.length} filas)...`);

      // Agrupar los inserts en batches
      const batchSize = 100;
      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        const statements = chunk.map(row => {
          const localColumns = Object.keys(row);
          const columnsToInsert = localColumns.filter(col => remoteColumns.has(col));
          const valuesToInsert = columnsToInsert.map(col => row[col]);
          const placeholders = columnsToInsert.map(() => '?').join(', ');
          return {
            sql: `INSERT INTO ${table} (${columnsToInsert.join(', ')}) VALUES (${placeholders})`,
            args: valuesToInsert
          };
        });

        await tursoClient.batch(statements, "write");
      }
    }

    console.log('\n🎉 ¡Migración de datos completada con éxito!');
  } catch (err) {
    console.error('\n❌ Ocurrió un error durante la migración:', err);
  } finally {
    localDb.close();
    tursoClient.close();
  }
}

runMigration();
