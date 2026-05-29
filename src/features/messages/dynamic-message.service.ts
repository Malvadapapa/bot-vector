import * as fs from 'fs';
import * as path from 'path';
import { ManagedExam, Reminder } from '../../domain/models.js';
import { InstitutionalNotice } from '../notifications/notifications.models.js';
import { InstitutionalNoticeRepository } from '../notifications/notifications.repository.js';
import { ManagedExamRepository, ReminderRepository } from '../../infrastructure/persistence/db/repositories.js';
import { RssParserService } from '../notifications/integrations/rss.service.js';

interface NewsCache {
  items: Array<{ title: string; link: string }>;
  updatedAt: string;
}

const DEFAULT_NEWS_URL = 'https://xataka.substack.com/feed';

export class DynamicMessageService {
  private newsCacheItems: Array<{ title: string; link: string }> = [];
  private newsCacheAtUtc: Date | null = null;
  private pendingNewsRotation: number[] = [];
  private cachePath: string;

  constructor(
    private reminderRepository: ReminderRepository,
    private noticeRepository: InstitutionalNoticeRepository,
    private examRepository: ManagedExamRepository,
    private rssService: RssParserService,
  ) {
    this.cachePath = path.join(process.cwd(), 'data', 'news_cache.json');
    this.loadNewsCache();
  }

  public async getValidNotices(limit = 10): Promise<InstitutionalNotice[]> {
    const notices = await this.noticeRepository.listRecent(limit);
    const now = new Date();
    const today = new Date(now.toISOString().slice(0, 10));

    return notices.filter((n) => {
      if (n.end_date) {
        const end = new Date(n.end_date.toISOString().slice(0, 10));
        return end >= today;
      }
      if (n.start_date) {
        const start = new Date(n.start_date.toISOString().slice(0, 10));
        const expiration = new Date(start);
        expiration.setDate(expiration.getDate() + 7);
        return expiration >= today;
      }
      return true;
    });
  }

  public async getUpcomingExams(limit = 10): Promise<ManagedExam[]> {
    return this.examRepository.listUpcoming(new Date(), limit);
  }

  public async getUserExamList(userId: string, limit = 10): Promise<Reminder[]> {
    const exams = await this.reminderRepository.listRegisteredExams(userId);
    return exams.slice(0, limit);
  }

  public async getNews(limit = 5, forceRefresh = false): Promise<string> {
    const now = new Date();
    if (!forceRefresh && this.newsCacheItems.length > 0 && this.newsCacheAtUtc) {
      const ageHours = (now.getTime() - this.newsCacheAtUtc.getTime()) / 36e5;
      if (ageHours <= 12) {
        return this.formatNewsBatch(Math.min(limit, 3));
      }
    }

    try {
      const items = await this.rssService.fetchFeed(DEFAULT_NEWS_URL);
      const top = items.slice(0, 30);
      if (!top.length) {
        return '- No hay noticias disponibles en este momento.';
      }

      this.newsCacheItems = top.map((item: any) => ({
        title: String(item.title || 'Sin titulo'),
        link: String(item.link || ''),
      }));
      this.newsCacheAtUtc = now;
      this.resetNewsRotation();
      this.saveNewsCache();
      return this.formatNewsBatch(Math.min(limit, 3));
    } catch {
      if (this.newsCacheItems.length > 0) {
        return this.formatNewsBatch(Math.min(limit, 3));
      }
      return '- No fue posible actualizar noticias ahora.';
    }
  }

  private formatNewsBatch(limit: number): string {
    const selected = this.pickNewsWithoutRepetition(limit);
    if (!selected.length) {
      return '- No hay noticias disponibles en este momento.';
    }

    const items: string[] = [];
    for (const item of selected) {
      items.push(`📰 ${item.title}\n👉 ${item.link}`);
    }
    return ['📰 Noticias de software:', ...items].join('|||SPLIT|||');
  }

  private pickNewsWithoutRepetition(limit: number): Array<{ title: string; link: string }> {
    if (!this.newsCacheItems.length) return [];

    const uniqueCount = Math.min(limit, this.newsCacheItems.length);
    const picked: Array<{ title: string; link: string }> = [];

    while (picked.length < uniqueCount) {
      if (this.pendingNewsRotation.length === 0) {
        this.resetNewsRotation();
      }

      const nextIndex = this.pendingNewsRotation.shift();
      if (nextIndex === undefined) break;
      picked.push(this.newsCacheItems[nextIndex]);
    }

    return picked;
  }

  private resetNewsRotation(): void {
    this.pendingNewsRotation = Array.from({ length: this.newsCacheItems.length }, (_, idx) => idx);
    for (let i = this.pendingNewsRotation.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.pendingNewsRotation[i], this.pendingNewsRotation[j]] = [this.pendingNewsRotation[j], this.pendingNewsRotation[i]];
    }
  }

  private loadNewsCache(): void {
    try {
      if (!fs.existsSync(this.cachePath)) return;
      const raw = fs.readFileSync(this.cachePath, 'utf-8');
      const payload = JSON.parse(raw) as NewsCache;
      if (!payload.updatedAt) return;
      this.newsCacheItems = Array.isArray((payload as any).items)
        ? (payload as any).items
            .filter((it: any) => it && typeof it.title === 'string' && typeof it.link === 'string')
            .map((it: any) => ({ title: String(it.title), link: String(it.link) }))
        : [];
      this.newsCacheAtUtc = new Date(payload.updatedAt);
      this.resetNewsRotation();
    } catch {
      this.newsCacheItems = [];
      this.newsCacheAtUtc = null;
      this.pendingNewsRotation = [];
    }
  }

  private saveNewsCache(): void {
    if (!this.newsCacheItems.length || !this.newsCacheAtUtc) return;

    const dataDir = path.dirname(this.cachePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const payload: NewsCache = {
      items: this.newsCacheItems,
      updatedAt: this.newsCacheAtUtc.toISOString(),
    };

    fs.writeFileSync(this.cachePath, JSON.stringify(payload, null, 2), 'utf-8');
  }
}
