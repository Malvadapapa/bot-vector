import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'chatbot.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function run() {
  try {
    console.log('=== SCHEMA MIGRATIONS ===');
    console.log(await query('SELECT * FROM schema_migrations'));
  } catch (err) {
    console.error('Error querying database:', err);
  } finally {
    db.close();
  }
}

run();
