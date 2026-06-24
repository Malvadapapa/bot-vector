// ============================================================
// StorageService — Typed wrapper over localStorage
// ============================================================

const PREFIX = 'vectorito_';

export const StorageService = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  set<T>(key: string, value: T): void {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  },

  remove(key: string): void {
    localStorage.removeItem(PREFIX + key);
  },

  has(key: string): boolean {
    return localStorage.getItem(PREFIX + key) !== null;
  },

  clear(): void {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
  },

  /** Get all keys with the prefix (returns unprefixed keys) */
  keys(): string[] {
    return Object.keys(localStorage)
      .filter(k => k.startsWith(PREFIX))
      .map(k => k.slice(PREFIX.length));
  },
};
