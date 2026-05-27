import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
sqlite3.verbose();

function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}

async function main() {
  const args = process.argv.slice(2);
  const dbArgIndex = args.findIndex(a => a === '--db');
  const dbPath = dbArgIndex >= 0 && args[dbArgIndex+1] ? args[dbArgIndex+1] : path.join(process.cwd(), 'data', 'chatbot.db');
  const execute = args.includes('--yes') || args.includes('--confirm') || args.includes('--execute');

  if (!fs.existsSync(dbPath)) {
    console.error(`[clear-admins] No existe el archivo de BD en: ${dbPath}`);
    process.exit(1);
  }

  const backupPath = `${dbPath}.bak-${nowStamp()}`;
  console.log(`[clear-admins] Creando backup: ${backupPath}`);
  fs.copyFileSync(dbPath, backupPath);

  if (!execute) {
    console.log('\n[clear-admins] Backup creado. Para proceder con la eliminación de admins, vuelve a ejecutar este script con la opción --yes o --confirm:');
    console.log(`node ${process.argv[1]} --db "${dbPath}" --yes\n`);
    process.exit(0);
  }

  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
      console.error('[clear-admins] No se pudo abrir la base de datos:', err.message);
      process.exit(1);
    }
  });

  function runAsync(sql, params=[]) {
    return new Promise((resolve, reject) => db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve(this);
    }));
  }

  try {
    console.log('[clear-admins] Eliminando registros de group_admins...');
    await runAsync('DELETE FROM group_admins');
    console.log('[clear-admins] Eliminando registros de admin_users...');
    await runAsync('DELETE FROM admin_users');

    console.log('[clear-admins] Eliminación completada. Comprueba el backup en:', backupPath);
  } catch (e) {
    console.error('[clear-admins] Error durante la operación:', e?.message || e);
    console.log('[clear-admins] Se puede restaurar la copia desde', backupPath);
  } finally {
    db.close((err) => {
      if (err) console.error('[clear-admins] Error cerrando la DB:', err.message);
    });
  }
}

main().catch((e) => { console.error('[clear-admins] Error fatal:', e); process.exit(1); });
