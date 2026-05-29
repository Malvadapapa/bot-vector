import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { SyncStateDict } from './models.js';

export class SyncState {
  constructor(private stateFilePath: string) {}

  public async getFileHash(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  }

  public async loadState(): Promise<SyncStateDict> {
    try {
      const data = await fs.readFile(this.stateFilePath, 'utf8');
      return JSON.parse(data) as SyncStateDict;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  public async saveState(state: SyncStateDict): Promise<void> {
    const dir = path.dirname(this.stateFilePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.stateFilePath, JSON.stringify(state, null, 2), 'utf8');
  }
}
