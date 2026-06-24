import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'chatbot.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

db.all('SELECT * FROM notice_replies', [], (err, rows) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('\n--- notice_replies ---');
    console.log(rows);
  }
  db.close();
});

