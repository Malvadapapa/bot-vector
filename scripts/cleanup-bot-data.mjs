import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const dbPath = path.join(workspaceRoot, 'data', 'chatbot.db');

const tablesToClear = [
  'reminders',
  'confirmaciones',
  'institutional_notices',
  'scheduler_runs',
  'outbox_dedup',
  'user_profiles',
  'admin_users',
  'admin_verification_codes',
  'managed_exams',
  'managed_teachers',
  'class_notifications',
  'user_daily_greetings',
  'user_moderation_state',
  'rate_limit',
];

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function onRun(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function main() {
  const db = new sqlite3.Database(dbPath);

  try {
    await run(db, 'BEGIN TRANSACTION');

    for (const table of tablesToClear) {
      await run(db, `DELETE FROM ${table}`);
      await run(db, `DELETE FROM sqlite_sequence WHERE name = '${table}'`);
    }

    await run(db, 'COMMIT');
    console.log('[Cleanup] Datos limpiados. Se preservó managed_classes y schema_migrations.');
  } catch (error) {
    await run(db, 'ROLLBACK').catch(() => {});
    console.error('[Cleanup] No se pudo limpiar la base de datos:', error?.message || error);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();