import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';

sqlite3.verbose();

function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const dbArgIndex = args.findIndex((value) => value === '--db');
  const profileArgIndex = args.findIndex((value) => value === '--profile');

  return {
    dbPath: dbArgIndex >= 0 && args[dbArgIndex + 1] ? args[dbArgIndex + 1] : path.join(process.cwd(), 'data', 'chatbot.db'),
    profile: profileArgIndex >= 0 && args[profileArgIndex + 1] ? args[profileArgIndex + 1] : 'onboarding',
    execute: args.includes('--yes') || args.includes('--confirm') || args.includes('--execute'),
    dryRun: args.includes('--dry-run') || args.includes('--dryrun') || args.includes('--preview') || (!args.includes('--yes') && !args.includes('--confirm') && !args.includes('--execute')),
  };
}

const TABLE_PROFILES = {
  onboarding: [
    'class_commission_schedule',
    'class_notifications',
    'group_context_commissions',
    'group_context',
    'group_admins',
    'group_memberships',
    'whatsapp_groups',
    'managed_classes',
    'managed_teachers',
    'managed_exams',
    'cohort_configs',
    'admin_verification_codes',
    'admin_users',
    'user_profiles',
  ],
  onboarding_private_only: ['admin_verification_codes', 'admin_users', 'user_profiles'],
};

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function onRun(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

async function main() {
  const { dbPath, profile, execute, dryRun } = parseArgs(process.argv);

  if (!fs.existsSync(dbPath)) {
    console.error(`[reset-onboarding-data] No existe el archivo de BD en: ${dbPath}`);
    process.exit(1);
  }

  const tables = TABLE_PROFILES[profile];
  if (!tables) {
    console.error(`[reset-onboarding-data] Perfil desconocido: ${profile}`);
    console.error(`[reset-onboarding-data] Perfiles disponibles: ${Object.keys(TABLE_PROFILES).join(', ')}`);
    process.exit(1);
  }

  console.log(`[reset-onboarding-data] BD: ${dbPath}`);
  console.log(`[reset-onboarding-data] Perfil: ${profile}`);
  console.log(`[reset-onboarding-data] Modo: ${dryRun ? 'dry-run' : 'ejecución'}`);
  console.log('');
  console.log('[reset-onboarding-data] Tablas que se limpiarían:');
  for (const table of tables) {
    console.log(`- ${table}`);
  }

  if (!execute) {
    console.log('\n[reset-onboarding-data] Dry-run activo. Para ejecutar de verdad, vuelve a correr con --yes o --confirm.');
    return;
  }

  const backupPath = `${dbPath}.bak-${nowStamp()}`;
  console.log(`\n[reset-onboarding-data] Creando backup: ${backupPath}`);
  fs.copyFileSync(dbPath, backupPath);

  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
      console.error('[reset-onboarding-data] No se pudo abrir la base de datos:', err.message);
      process.exit(1);
    }
  });

  try {
    await run(db, 'BEGIN TRANSACTION');
    for (const table of tables) {
      await run(db, `DELETE FROM ${quoteIdentifier(table)}`);
      await run(db, `DELETE FROM sqlite_sequence WHERE name = '${table.replace(/'/g, "''")}'`);
    }
    await run(db, 'COMMIT');
    console.log('[reset-onboarding-data] Limpieza completada. Backup disponible en:', backupPath);
  } catch (error) {
    await run(db, 'ROLLBACK').catch(() => {});
    console.error('[reset-onboarding-data] No se pudo limpiar la base de datos:', error?.message || error);
    console.log('[reset-onboarding-data] Podés restaurar la copia desde:', backupPath);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('[reset-onboarding-data] Error fatal:', error);
  process.exit(1);
});