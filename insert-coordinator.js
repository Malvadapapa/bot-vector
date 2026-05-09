#!/usr/bin/env node

/**
 * Script para insertar coordinadora en managed_teachers
 * Esto permite que el bot acceda al email desde el contexto de IA
 */

import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, 'data', 'chatbot.db');

function log(msg) {
  console.log(`[Insert] ${msg}`);
}

function error(msg) {
  console.error(`[Insert ERROR] ${msg}`);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function main() {
  try {
    log(`Abriendo BD: ${dbPath}`);
    const db = new sqlite3.Database(dbPath);

    await new Promise((resolve, reject) => {
      db.serialize(resolve);
      db.on('error', reject);
    });

    // Verificar si Coordinadora ya existe
    log('Verificando si Coordinadora ya está en la BD...');
    const existingCoordinator = await get(db, `
      SELECT id FROM managed_teachers WHERE name = ? AND email = ?
    `, ['Tatiana Manzanelli', 'coordinacion.software@ispc.edu.ar']);

    if (existingCoordinator) {
      log(`✅ Coordinadora ya existe con ID ${existingCoordinator.id}`);
    } else {
      log('Coordinadora no existe. Insertando...');
      const result = await run(db, `
        INSERT INTO managed_teachers (name, email, subject)
        VALUES (?, ?, ?)
      `, ['Tatiana Manzanelli', 'coordinacion.software@ispc.edu.ar', 'Coordinación General']);
      log(`✅ Coordinadora Tatiana Manzanelli insertada (ID ${result.lastID})`);
    }

    // Listar todos los coordinadores/profesores para verificación
    log('Profesores/Coordinadores en la BD:');
    const teachers = await all(db, `
      SELECT id, name, email, subject FROM managed_teachers ORDER BY id
    `);
    
    if (teachers.length === 0) {
      log('  (ninguno)');
    } else {
      teachers.forEach(t => {
        const subject = t.subject ? ` (${t.subject})` : '';
        log(`  ID ${t.id}: ${t.name}${subject} - ${t.email}`);
      });
    }

    log('✅ Inserción completada exitosamente');
    db.close();
    process.exit(0);

  } catch (err) {
    error(`${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

main();
