import { Database } from 'sqlite3';
import { GroupRepository } from './repositories.js';

/**
 * PHASE 1: Migration helper to move groups from .env to database
 * Ensures groups specified in WHATSAPP_GROUP_IDS are registered in the DB
 */
export class MigrationHelper {
  /**
   * Idempotent migration: register all .env groups in database if not already present
   * @param sqliteDb - Database connection
   * @param envGroupIds - Array of group IDs from .env WHATSAPP_GROUP_IDS setting
   */
  public static async migrateEnvGroupsToDb(sqliteDb: Database, envGroupIds: string[]): Promise<void> {
    if (!envGroupIds || envGroupIds.length === 0) {
      return; // No groups to migrate
    }

    const groupRepository = new GroupRepository(sqliteDb);

    for (const groupId of envGroupIds) {
      if (!groupId || typeof groupId !== 'string') {
        continue;
      }

      try {
        // Check if group already exists
        const existing = await groupRepository.findByGroupId(groupId);
        if (existing) {
          // Already registered; optionally activate if not active
          const isActive = await groupRepository.isActive(groupId);
          if (!isActive) {
            await groupRepository.setActive(groupId, true);
          }
          continue;
        }

        // Register new group from .env
        await groupRepository.register(groupId, `Grupo ${groupId}`, 'migration-env');
      } catch (err) {
        console.warn(`[MigrationHelper] Failed to migrate group ${groupId}:`, err);
      }
    }
  }
}
