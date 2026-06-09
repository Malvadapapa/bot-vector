import sqlite3 from 'sqlite3';
import {
  AdminUser,
  UserProfile,
  WhatsAppGroup,
} from '../../../domain/models.js';
import { run, get, all } from '../../../shared/db/db-utils.js';

export class UserProfileRepository {
  constructor(private db: sqlite3.Database) {}

  async upsert(userId: string, name: string, birthdayDayMonth: string, email = '', userCommissionId?: number): Promise<void> {
    await run(
      this.db,
      `INSERT INTO user_profiles(user_id, name, birthday_day_month, email, user_commission_id, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         name=excluded.name,
         birthday_day_month=excluded.birthday_day_month,
         email=excluded.email,
         user_commission_id=excluded.user_commission_id,
         updated_at=CURRENT_TIMESTAMP`,
      [userId, name, birthdayDayMonth, email, userCommissionId ?? null]
    );
  }

  async get(userId: string): Promise<UserProfile | null> {
    const row = await get<any>(this.db, 'SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
    if (!row) return null;
    return {
      user_id: String(row.user_id),
      name: String(row.name),
      birthday_day_month: String(row.birthday_day_month),
      email: String(row.email || ''),
      user_commission_id: row.user_commission_id ? Number(row.user_commission_id) : undefined,
    };
  }

  async listUsersWithBirthday(dayMonth: string): Promise<UserProfile[]> {
    const rows = await all<any>(this.db, 'SELECT * FROM user_profiles WHERE birthday_day_month = ?', [dayMonth]);
    return rows.map((row) => ({
      user_id: String(row.user_id),
      name: String(row.name),
      birthday_day_month: String(row.birthday_day_month),
      email: String(row.email || ''),
      user_commission_id: row.user_commission_id ? Number(row.user_commission_id) : undefined,
    }));
  }

  async countTotal(): Promise<number> {
    const row = await get<any>(this.db, 'SELECT COUNT(*) as count FROM user_profiles');
    return Number(row?.count ?? 0);
  }

  async listAll(): Promise<UserProfile[]> {
    const rows = await all<any>(this.db, 'SELECT * FROM user_profiles ORDER BY user_id');
    return rows.map((row) => ({
      user_id: String(row.user_id),
      name: String(row.name),
      birthday_day_month: String(row.birthday_day_month),
      email: String(row.email || ''),
      user_commission_id: row.user_commission_id ? Number(row.user_commission_id) : undefined,
    }));
  }
}

export class AdminRepository {
  constructor(private db: sqlite3.Database) {}

  async register(userId: string): Promise<void> {
    await run(
      this.db,
      `INSERT INTO admin_users(user_id, is_authenticated, updated_at)
       VALUES (?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET is_authenticated=1, updated_at=CURRENT_TIMESTAMP`,
      [userId]
    );
  }

  async isRegistered(userId: string): Promise<boolean> {
    const row = await get<any>(this.db, 'SELECT user_id FROM admin_users WHERE user_id = ?', [userId]);
    if (row) return true;
    const phone = userId.split('@')[0]?.split(':')[0] || '';
    if (!phone) return false;
    const allRows = await all<any>(this.db, 'SELECT user_id FROM admin_users');
    return allRows.some((r) => String(r.user_id).split('@')[0]?.split(':')[0] === phone);
  }

  async setAuthenticated(userId: string, value: boolean): Promise<void> {
    await run(this.db, 'UPDATE admin_users SET is_authenticated = ?, updated_at=CURRENT_TIMESTAMP WHERE user_id = ?', [
      value ? 1 : 0,
      userId,
    ]);
  }

  async setSuperAdmin(userId: string, value: boolean): Promise<void> {
    await run(this.db, 'UPDATE admin_users SET is_super_admin = ?, updated_at=CURRENT_TIMESTAMP WHERE user_id = ?', [
      value ? 1 : 0,
      userId,
    ]);
  }

  async isAuthenticated(userId: string): Promise<boolean> {
    const row = await get<any>(this.db, 'SELECT is_authenticated FROM admin_users WHERE user_id = ?', [userId]);
    if (row) return Number(row.is_authenticated) === 1;
    const phone = userId.split('@')[0]?.split(':')[0] || '';
    if (!phone) return false;
    const allRows = await all<any>(this.db, 'SELECT user_id, is_authenticated FROM admin_users');
    const match = allRows.find((r) => String(r.user_id).split('@')[0]?.split(':')[0] === phone);
    return !!match && Number(match.is_authenticated) === 1;
  }

  async isGlobalAdmin(userId: string): Promise<boolean> {
    const isAuth = await this.isAuthenticated(userId);
    const isSuper = await this.isSuperAdmin(userId);
    return isAuth && !isSuper;
  }

  async get(userId: string): Promise<AdminUser | null> {
    const row = await get<any>(this.db, 'SELECT * FROM admin_users WHERE user_id = ?', [userId]);
    if (!row) return null;
    return {
      user_id: String(row.user_id),
      is_authenticated: Number(row.is_authenticated) === 1,
      is_super_admin: Number(row.is_super_admin ?? 0) === 1,
    };
  }

  async isSuperAdmin(userId: string): Promise<boolean> {
    const row = await get<any>(this.db, 'SELECT is_super_admin FROM admin_users WHERE user_id = ?', [userId]);
    if (row) return Number(row.is_super_admin) === 1;
    const phone = userId.split('@')[0]?.split(':')[0] || '';
    if (!phone) return false;
    const allRows = await all<any>(this.db, 'SELECT user_id, is_super_admin FROM admin_users');
    const match = allRows.find((r) => String(r.user_id).split('@')[0]?.split(':')[0] === phone);
    return !!match && Number(match.is_super_admin) === 1;
  }

  async listAllAdminIds(): Promise<string[]> {
    const rows = await all<any>(this.db, 'SELECT user_id FROM admin_users WHERE is_authenticated = 1');
    return rows.map((r) => String(r.user_id));
  }

  async listSuperAdminIds(): Promise<string[]> {
    const rows = await all<any>(this.db, 'SELECT user_id FROM admin_users WHERE is_super_admin = 1');
    return rows.map((r) => String(r.user_id));
  }

  async listGroupAdmins(groupId: string): Promise<Array<{ user_id: string }>> {
    const rows = await all<any>(this.db, 'SELECT user_id FROM group_admins WHERE group_id = ? ORDER BY created_at ASC', [groupId]);
    return rows.map((r) => ({ user_id: String(r.user_id) }));
  }

  async listAdminGroups(userId: string): Promise<string[]> {
    const rows = await all<any>(this.db, 'SELECT group_id FROM group_admins WHERE user_id = ? ORDER BY created_at ASC', [userId]);
    return rows.map((r) => String(r.group_id));
  }

  async assignGroupAdmin(userId: string, groupId: string): Promise<void> {
    await run(this.db, 'INSERT OR IGNORE INTO group_admins(user_id, group_id) VALUES (?, ?)', [userId, groupId]);
  }

  async removeGroupAdmin(userId: string, groupId: string): Promise<void> {
    await run(this.db, 'DELETE FROM group_admins WHERE user_id = ? AND group_id = ?', [userId, groupId]);
  }

  async removeAllGroupAdmins(groupId: string): Promise<number> {
    const result = await run(this.db, 'DELETE FROM group_admins WHERE group_id = ?', [groupId]);
    return result.changes;
  }

  async isGroupAdmin(userId: string, groupId: string): Promise<boolean> {
    const row = await get<any>(this.db, 'SELECT 1 FROM group_admins WHERE user_id = ? AND group_id = ? LIMIT 1', [userId, groupId]);
    if (row) return true;
    const phone = userId.split('@')[0]?.split(':')[0] || '';
    if (!phone) return false;
    const rows = await all<any>(this.db, 'SELECT user_id FROM group_admins WHERE group_id = ?', [groupId]);
    return rows.some((r) => String(r.user_id).split('@')[0]?.split(':')[0] === phone);
  }

  async getAdminLevel(userId: string, groupId?: string): Promise<'super' | 'global' | 'group' | null> {
    if (await this.isSuperAdmin(userId)) return 'super';
    if (await this.isAuthenticated(userId)) return 'global';
    if (groupId && (await this.isGroupAdmin(userId, groupId))) return 'group';
    return null;
  }
}

export class AdminVerificationCodeRepository {
  constructor(private db: sqlite3.Database) {}

  async addCode(code: string): Promise<void> {
    await run(this.db, 'INSERT OR IGNORE INTO admin_verification_codes(code) VALUES (?)', [code]);
  }

  async deleteIfUnconsumed(code: string): Promise<void> {
    await run(this.db, 'DELETE FROM admin_verification_codes WHERE code = ? AND consumed_by IS NULL', [code]);
  }

  async listAvailableCodes(limit = 10): Promise<string[]> {
    const rows = await all<any>(
      this.db,
      'SELECT code FROM admin_verification_codes WHERE consumed_by IS NULL ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return rows.map((row) => String(row.code));
  }

  async consumeIfValid(code: string, consumedBy: string): Promise<boolean> {
    const row = await get<any>(
      this.db,
      'SELECT code FROM admin_verification_codes WHERE code = ? AND consumed_by IS NULL',
      [code]
    );
    if (!row) return false;

    await run(
      this.db,
      'UPDATE admin_verification_codes SET consumed_by = ?, consumed_at = CURRENT_TIMESTAMP WHERE code = ?',
      [consumedBy, code]
    );
    return true;
  }
}

export class SchedulerRunRepository {
  constructor(private db: sqlite3.Database) {}

  async log(jobName: string, status: 'ok' | 'error', message: string): Promise<void> {
    await run(this.db, 'INSERT INTO scheduler_runs(job_name, status, message) VALUES (?, ?, ?)', [jobName, status, message]);
  }
}

export class GroupMembershipRepository {
  constructor(private db: sqlite3.Database) {}

  async addMembership(groupId: string, userId: string, role: string = 'member'): Promise<number> {
    const result = await run(
      this.db,
      `INSERT INTO group_memberships(group_id, user_id, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, group_id) DO UPDATE SET role = excluded.role, is_active = 1, updated_at = CURRENT_TIMESTAMP`,
      [groupId, userId, role]
    );
    return result.lastID;
  }

  async removeMembership(groupId: string, userId: string): Promise<boolean> {
    const result = await run(this.db, 'DELETE FROM group_memberships WHERE group_id = ? AND user_id = ?', [groupId, userId]);
    return result.changes > 0;
  }

  async listByGroup(groupId: string): Promise<Array<{ user_id: string; role: string; is_active: boolean; commission_id?: number | null }>> {
    const rows = await all<any>(this.db, 'SELECT user_id, role, is_active, commission_id FROM group_memberships WHERE group_id = ? ORDER BY created_at ASC', [groupId]);
    return rows.map((r) => ({
      user_id: String(r.user_id),
      role: String(r.role),
      is_active: Number(r.is_active) === 1,
      commission_id: r.commission_id !== undefined && r.commission_id !== null ? Number(r.commission_id) : null
    }));
  }

  async listByUser(userId: string): Promise<Array<{ group_id: string; role: string; is_active: boolean }>> {
    const rows = await all<any>(this.db, 'SELECT group_id, role, is_active FROM group_memberships WHERE user_id = ? ORDER BY created_at ASC', [userId]);
    return rows.map((r) => ({ group_id: String(r.group_id), role: String(r.role), is_active: Number(r.is_active) === 1 }));
  }

  async getMembership(groupId: string, userId: string): Promise<{ user_id: string; role: string; is_active: boolean; commission_id?: number | null } | null> {
    const row = await get<any>(this.db, 'SELECT user_id, role, is_active, commission_id FROM group_memberships WHERE group_id = ? AND user_id = ? LIMIT 1', [groupId, userId]);
    if (!row) return null;
    return {
      user_id: String(row.user_id),
      role: String(row.role),
      is_active: Number(row.is_active) === 1,
      commission_id: row.commission_id !== undefined && row.commission_id !== null ? Number(row.commission_id) : null
    };
  }

  async setRole(groupId: string, userId: string, role: string): Promise<void> {
    await run(this.db, 'UPDATE group_memberships SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ? AND user_id = ?', [role, groupId, userId]);
  }

  async setCommission(groupId: string, userId: string, commissionId: number | null): Promise<void> {
    await run(this.db, 'UPDATE group_memberships SET commission_id = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ? AND user_id = ?', [commissionId, groupId, userId]);
  }

  async isMember(groupId: string, userId: string): Promise<boolean> {
    const row = await get<any>(this.db, 'SELECT 1 FROM group_memberships WHERE group_id = ? AND user_id = ? AND is_active = 1 LIMIT 1', [groupId, userId]);
    return !!row;
  }

  async deleteAllByGroupId(groupId: string): Promise<number> {
    const result = await run(this.db, 'DELETE FROM group_memberships WHERE group_id = ?', [groupId]);
    return result.changes;
  }
}

export class GroupRepository {
  constructor(private db: sqlite3.Database) {}

  async register(groupId: string, displayName?: string, addedBy?: string): Promise<number> {
    const result = await run(
      this.db,
      `INSERT INTO whatsapp_groups(group_id, display_name, is_active, added_by, updated_at)
       VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(group_id) DO UPDATE SET is_active=1, updated_at=CURRENT_TIMESTAMP`,
      [groupId, displayName ?? null, addedBy ?? null]
    );
    const existing = await get<any>(this.db, 'SELECT id FROM whatsapp_groups WHERE group_id = ?', [groupId]);
    return existing ? Number(existing.id) : result.lastID;
  }

  async findById(id: number): Promise<WhatsAppGroup | null> {
    const row = await get<any>(this.db, 'SELECT * FROM whatsapp_groups WHERE id = ?', [id]);
    return row ? rowToWhatsAppGroup(row) : null;
  }

  async findByGroupId(groupId: string): Promise<WhatsAppGroup | null> {
    const row = await get<any>(this.db, 'SELECT * FROM whatsapp_groups WHERE group_id = ?', [groupId]);
    return row ? rowToWhatsAppGroup(row) : null;
  }

  async findAll(): Promise<WhatsAppGroup[]> {
    const rows = await all<any>(this.db, 'SELECT * FROM whatsapp_groups ORDER BY created_at DESC');
    return rows.map(rowToWhatsAppGroup);
  }

  async getAllActiveIds(): Promise<string[]> {
    const rows = await all<any>(this.db, 'SELECT group_id FROM whatsapp_groups WHERE is_active = 1 ORDER BY created_at ASC');
    return rows.map((r) => String(r.group_id));
  }

  async getAllActiveGroupsWithEntryYear(): Promise<Array<{ group_id: string; display_name?: string; entry_year?: number | null }>> {
    const rows = await all<any>(this.db, 'SELECT group_id, display_name, entry_year FROM whatsapp_groups WHERE is_active = 1 ORDER BY created_at ASC');
    return rows.map((r) => ({ group_id: String(r.group_id), display_name: r.display_name ? String(r.display_name) : undefined, entry_year: r.entry_year !== null && r.entry_year !== undefined ? Number(r.entry_year) : null }));
  }

  async setActive(groupId: string, isActive: boolean): Promise<void> {
    await run(this.db, 'UPDATE whatsapp_groups SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ?', [
      isActive ? 1 : 0,
      groupId,
    ]);
  }

  async updateEntryYear(groupId: string, entryYear: number | null): Promise<void> {
    await run(this.db, 'UPDATE whatsapp_groups SET entry_year = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ?', [
      entryYear === null ? null : entryYear,
      groupId,
    ]);
  }

  async updateDisplayName(groupId: string, displayName: string): Promise<void> {
    await run(this.db, 'UPDATE whatsapp_groups SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ?', [
      displayName,
      groupId,
    ]);
  }

  async delete(groupId: string): Promise<boolean> {
    const result = await run(this.db, 'DELETE FROM whatsapp_groups WHERE group_id = ?', [groupId]);
    return result.changes > 0;
  }

  async isActive(groupId: string): Promise<boolean> {
    const row = await get<any>(this.db, 'SELECT is_active FROM whatsapp_groups WHERE group_id = ?', [groupId]);
    return !!row && Number(row.is_active) === 1;
  }

  async getActiveCount(): Promise<number> {
    const row = await get<any>(this.db, 'SELECT COUNT(*) as count FROM whatsapp_groups WHERE is_active = 1');
    return Number(row?.count ?? 0);
  }
}

function rowToWhatsAppGroup(row: any): WhatsAppGroup {
  return {
    id: Number(row.id),
    group_id: String(row.group_id),
    display_name: row.display_name ? String(row.display_name) : undefined,
    is_active: Number(row.is_active) === 1,
    added_by: row.added_by ? String(row.added_by) : undefined,
    entry_year: row.entry_year !== undefined && row.entry_year !== null ? Number(row.entry_year) : null,
    created_at: row.created_at ? new Date(String(row.created_at)) : undefined,
    updated_at: row.updated_at ? new Date(String(row.updated_at)) : undefined,
  };
}

export { InstitutionalNoticeRepository, ClassNotificationRepository, InboundEmailRejectionRepository } from '../../../features/notifications/notifications.repository.js';
export { DailyGreetingRepository, OutboxDedupRepository } from '../../../features/messages/messages.repository.js';
export { ReminderRepository, ManagedExamRepository, ManagedClassRepository, ManagedTeacherRepository, CommissionRepository, GroupContextRepository, ClassCommissionScheduleRepository, CohortConfigRepository } from '../../../features/academic-calendar/academic-calendar.repository.js';
