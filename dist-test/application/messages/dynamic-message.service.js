"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamicMessageService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DEFAULT_NEWS_URL = 'https://xataka.substack.com/feed';
class DynamicMessageService {
    constructor(reminderRepository, noticeRepository, examRepository, rssService) {
        this.reminderRepository = reminderRepository;
        this.noticeRepository = noticeRepository;
        this.examRepository = examRepository;
        this.rssService = rssService;
        this.newsCacheItems = [];
        this.newsCacheAtUtc = null;
        this.pendingNewsRotation = [];
        this.cachePath = path.join(process.cwd(), 'data', 'news_cache.json');
        this.loadNewsCache();
    }
    async getValidNotices(limit = 10) {
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
    async getUpcomingExams(limit = 10) {
        return this.examRepository.listUpcoming(new Date(), limit);
    }
    async getUserExamList(userId, limit = 10) {
        const exams = await this.reminderRepository.listRegisteredExams(userId);
        return exams.slice(0, limit);
    }
    async getNews(limit = 5, forceRefresh = false) {
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
            this.newsCacheItems = top.map((item) => ({
                title: String(item.title || 'Sin titulo'),
                link: String(item.link || ''),
            }));
            this.newsCacheAtUtc = now;
            this.resetNewsRotation();
            this.saveNewsCache();
            return this.formatNewsBatch(Math.min(limit, 3));
        }
        catch {
            if (this.newsCacheItems.length > 0) {
                return this.formatNewsBatch(Math.min(limit, 3));
            }
            return '- No fue posible actualizar noticias ahora.';
        }
    }
    formatNewsBatch(limit) {
        const selected = this.pickNewsWithoutRepetition(limit);
        if (!selected.length) {
            return '- No hay noticias disponibles en este momento.';
        }
        const items = [];
        for (const item of selected) {
            items.push(`📰 ${item.title}\n👉 ${item.link}`);
        }
        return ['📰 Noticias de software:', ...items].join('|||SPLIT|||');
    }
    pickNewsWithoutRepetition(limit) {
        if (!this.newsCacheItems.length)
            return [];
        const uniqueCount = Math.min(limit, this.newsCacheItems.length);
        const picked = [];
        while (picked.length < uniqueCount) {
            if (this.pendingNewsRotation.length === 0) {
                this.resetNewsRotation();
            }
            const nextIndex = this.pendingNewsRotation.shift();
            if (nextIndex === undefined)
                break;
            picked.push(this.newsCacheItems[nextIndex]);
        }
        return picked;
    }
    resetNewsRotation() {
        this.pendingNewsRotation = Array.from({ length: this.newsCacheItems.length }, (_, idx) => idx);
        for (let i = this.pendingNewsRotation.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.pendingNewsRotation[i], this.pendingNewsRotation[j]] = [this.pendingNewsRotation[j], this.pendingNewsRotation[i]];
        }
    }
    loadNewsCache() {
        try {
            if (!fs.existsSync(this.cachePath))
                return;
            const raw = fs.readFileSync(this.cachePath, 'utf-8');
            const payload = JSON.parse(raw);
            if (!payload.updatedAt)
                return;
            this.newsCacheItems = Array.isArray(payload.items)
                ? payload.items
                    .filter((it) => it && typeof it.title === 'string' && typeof it.link === 'string')
                    .map((it) => ({ title: String(it.title), link: String(it.link) }))
                : [];
            this.newsCacheAtUtc = new Date(payload.updatedAt);
            this.resetNewsRotation();
        }
        catch {
            this.newsCacheItems = [];
            this.newsCacheAtUtc = null;
            this.pendingNewsRotation = [];
        }
    }
    saveNewsCache() {
        if (!this.newsCacheItems.length || !this.newsCacheAtUtc)
            return;
        const dataDir = path.dirname(this.cachePath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        const payload = {
            items: this.newsCacheItems,
            updatedAt: this.newsCacheAtUtc.toISOString(),
        };
        fs.writeFileSync(this.cachePath, JSON.stringify(payload, null, 2), 'utf-8');
    }
}
exports.DynamicMessageService = DynamicMessageService;
