import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('data/chatbot.db', (err) => {
  if (err) {
    console.error('Error connecting to DB:', err);
    return;
  }

  db.all('SELECT * FROM inbound_email_rejections ORDER BY id DESC LIMIT 5', [], (err, rows) => {
    if (err) {
      console.error('Error running query:', err);
      return;
    }
    console.log('Rejections:', JSON.stringify(rows, null, 2));
    db.close();
  });
});
