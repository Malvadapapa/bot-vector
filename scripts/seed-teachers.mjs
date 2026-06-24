import sqlite3 from 'sqlite3';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

let db;

if (tursoUrl && tursoToken) {
  console.log('[Seed] Conectando a Turso...');
  db = createClient({ url: tursoUrl, authToken: tursoToken });
} else {
  console.log('[Seed] Conectando a SQLite local...');
  const dbPath = path.join(process.cwd(), 'data', 'chatbot.db');
  db = new sqlite3.Database(dbPath);
}

async function runQuery(sql, params = []) {
  if (tursoUrl && tursoToken) {
    await db.execute({ sql, args: params });
  } else {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }
}

async function dbAll(sql, params = []) {
  if (tursoUrl && tursoToken) {
    const res = await db.execute({ sql, args: params });
    return res.rows;
  } else {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
}

async function seed() {
  const teachers = [
    {
      email: 'profe.gestion@ispc.edu.ar',
      name: 'Profe de Gestión',
      subject: 'Gestión de Proyectos',
      group_id: '120363426054239699@g.us',
      phone: '+5493512345678'
    },
    {
      email: 'profe.programacion3@ispc.edu.ar',
      name: 'Profe de Programación III',
      subject: 'Programación III',
      group_id: '120363426054239699@g.us',
      phone: '+5493518765432'
    }
  ];

  for (const t of teachers) {
    console.log(`[Seed] Procesando docente: ${t.name} (${t.subject})...`);
    
    // 1. Insert/Update user_profiles
    await runQuery(
      `INSERT INTO user_profiles (user_id, name, birthday_day_month, email)
       VALUES (?, ?, '01/01', ?)
       ON CONFLICT(user_id) DO UPDATE SET name=excluded.name, email=excluded.email`,
      [t.email, t.name, t.email]
    );

    // 2. Insert/Update managed_teachers
    const existing = await dbAll(
      `SELECT id FROM managed_teachers WHERE LOWER(email) = LOWER(?) AND subject = ?`,
      [t.email, t.subject]
    );

    if (existing.length === 0) {
      console.log(`[Seed] Registrando nueva materia para el docente...`);
      await runQuery(
        `INSERT INTO managed_teachers (name, email, subject, group_id, phone, notify_email, notify_whatsapp)
         VALUES (?, ?, ?, ?, ?, 1, 1)`,
        [t.name, t.email, t.subject, t.group_id, t.phone]
      );
    } else {
      console.log(`[Seed] Actualizando materia existente para el docente...`);
      await runQuery(
        `UPDATE managed_teachers 
         SET name = ?, group_id = ?, phone = ? 
         WHERE LOWER(email) = LOWER(?) AND subject = ?`,
        [t.name, t.group_id, t.phone, t.email, t.subject]
      );
    }
  }

  console.log('[Seed] Carga de docentes seed finalizada con éxito.');
  if (!tursoUrl) {
    db.close();
  }
}

seed().catch(console.error);
