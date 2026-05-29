import sqlite3 from 'sqlite3';

export function run(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params as any[], function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID ?? 0, changes: this.changes ?? 0 });
    });
  });
}

export function get<T = any>(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params as any[], (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });
}

export function all<T = any>(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params as any[], (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

export function formatLocalDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatLocalTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}
