import sqlite3 from 'sqlite3';
import { getSettings } from '../config/settings.js';


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
  const tz = getSettings().timezone || 'America/Argentina/Cordoba';
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

export function formatLocalTime(date: Date): string {
  const tz = getSettings().timezone || 'America/Argentina/Cordoba';
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return formatter.format(date);
}
