import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { run, get, all, formatLocalDateOnly, formatLocalTime } from '../db-utils.js';

describe('db-utils', () => {
  let db: sqlite3.Database;

  beforeEach(() => {
    return new Promise<void>((resolve, reject) => {
      db = new sqlite3.Database(':memory:', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  afterEach(() => {
    return new Promise<void>((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  it('debería ejecutar comandos run, get y all correctamente', async () => {
    await run(db, 'CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
    
    const insertResult = await run(db, 'INSERT INTO test (name) VALUES (?)', ['Vectorito']);
    expect(insertResult.lastID).toBe(1);
    expect(insertResult.changes).toBe(1);

    const getResult = await get<{ id: number; name: string }>(db, 'SELECT * FROM test WHERE id = ?', [1]);
    expect(getResult).toBeDefined();
    expect(getResult?.name).toBe('Vectorito');

    const allResult = await all<{ id: number; name: string }>(db, 'SELECT * FROM test');
    expect(allResult.length).toBe(1);
    expect(allResult[0].name).toBe('Vectorito');
  });

  it('debería formatear fechas locales correctamente', () => {
    // 29 de Mayo de 2026 04:30:00 en zona horaria America/Argentina/Cordoba (UTC-3)
    const testDate = new Date('2026-05-29T04:30:00-03:00');
    expect(formatLocalDateOnly(testDate)).toBe('2026-05-29');
    expect(formatLocalTime(testDate)).toBe('04:30:00');
  });
});
