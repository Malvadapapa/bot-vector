import 'dotenv/config';
import { DEFAULT_BOT_INSTRUCTIONS } from '../../../shared/config/instructions.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';

const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_KNOWLEDGE_DIR = path.join(process.cwd(), 'data', 'ai-context');
const DEFAULT_CACHE_FILE = path.join(DEFAULT_KNOWLEDGE_DIR, '.gemini-upload-cache.json');
const MAX_CHAT_TURNS = Number(process.env.MAX_CHAT_TURNS || 12);
const MAX_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas máximo
const SESSION_TTL_MS = Math.min(
  Number(process.env.SESSION_TTL_MINUTES || 120) * 60_000,
  MAX_SESSION_TTL_MS
);
const UPLOAD_DELAY_MS = 1500;
const POLL_DELAY_MS = 1500;
const MAX_POLL_ATTEMPTS = 30;

// Cadena de prioridad de modelos — ordenada por calidad para chat conversacional.
// El servicio probará en orden, saltando los que no estén disponibles o estén en cooldown.
const MODEL_PRIORITY_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash',
  'gemma-3-27b-it',
  'gemma-4-26b-it',
  'gemma-4-31b-it',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemma-3-12b-it',
  'gemma-3-4b-it',
];

const RATE_LIMIT_COOLDOWN_MS = 60_000;
const SERVER_ERROR_COOLDOWN_MS = 30_000;
const RETRY_BASE_DELAY_MS = 1_000;
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60_000;
// Las instrucciones se importan desde ../../../shared/config/instructions.js

type UploadedFile = { name: string; uri: string; mimeType: string };
type SessionTurn = { user: string; model: string; timestamp: number };
type PromptPart = { text: string } | { fileData: { fileUri: string; mimeType: string } };
type PromptMessage = { role: 'user' | 'model'; parts: PromptPart[] };

interface ModelEntry {
  name: string;
  isGemma: boolean;
  instance: any;
  cooldownUntil: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detectMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.txt') return 'text/plain';
  if (ext === '.md') return 'text/markdown';
  if (ext === '.json') return 'application/json';
  if (ext === '.csv') return 'text/csv';
  return 'application/octet-stream';
}

function sanitizeBotText(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/\*/g, '').trim();
}

function buildHistory(turns: SessionTurn[]): PromptMessage[] {
  const out: PromptMessage[] = [];
  const now = Date.now();
  const twelveHoursAgo = now - 12 * 60 * 60 * 1000;
  for (const t of turns) {
    if (t.timestamp >= twelveHoursAgo) {
      out.push({ role: 'user', parts: [{ text: t.user }] });
      out.push({ role: 'model', parts: [{ text: t.model }] });
    }
  }
  return out;
}

function isRetryableError(error: any): boolean {
  const status = error?.status ?? error?.httpStatusCode ?? error?.code;
  const msg = String(error?.message || '').toLowerCase();
  if (status === 429 || status === 503 || status === 500) return true;
  if (msg.includes('rate limit') || msg.includes('quota') || msg.includes('resource exhausted')) return true;
  if (msg.includes('overloaded') || msg.includes('unavailable') || msg.includes('internal')) return true;
  return false;
}

function isRateLimitError(error: any): boolean {
  const status = error?.status ?? error?.httpStatusCode ?? error?.code;
  const msg = String(error?.message || '').toLowerCase();
  return status === 429 || msg.includes('rate limit') || msg.includes('quota') || msg.includes('resource exhausted');
}

/** Detecta errores de facturación/créditos — cambiar de modelo no ayuda. */
function isBillingError(error: any): boolean {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('credits are depleted') || msg.includes('billing') || msg.includes('payment') || msg.includes('prepayment');
}

/** Intenta encontrar un modelo disponible cuyo nombre coincida con el patrón dado. */
function matchModel(available: Set<string>, pattern: string): string | null {
  if (available.has(pattern)) return pattern;
  for (const suffix of ['-preview', '-latest']) {
    if (available.has(`${pattern}${suffix}`)) return `${pattern}${suffix}`;
  }
  for (const model of available) {
    if (model.startsWith(pattern)) return model;
  }
  return null;
}

import { AIProvider } from './ai-provider.interface.js';

export class GeminiService implements AIProvider {
  private readonly apiKey = process.env.GEMINI_API_KEY || '';
  private readonly knowledgeDir = DEFAULT_KNOWLEDGE_DIR;
  private readonly cacheFilePath = DEFAULT_CACHE_FILE;
  private initialized = false;
  private genAI: GoogleGenerativeAI | null = null;
  private modelChain: ModelEntry[] = [];
  private baseHistoryGemini: PromptMessage[] = [];
  private baseHistoryGemma: PromptMessage[] = [];
  private sessions = new Map<string, { turns: SessionTurn[]; lastActivity: number }>();
  private uploadedFiles: UploadedFile[] = [];
  private cleanupTimer: NodeJS.Timeout | null = null;

  public async initialize(): Promise<{ uploadedCount: number; modelName: string }> {
    if (this.initialized && this.modelChain.length > 0) {
      return { uploadedCount: this.uploadedFiles.length, modelName: this.modelChain[0].name };
    }

    if (!this.apiKey) {
      throw new Error('Falta GEMINI_API_KEY. Define la variable de entorno antes de ejecutar.');
    }

    await fs.mkdir(this.knowledgeDir, { recursive: true });

    // 1. Subir archivos de conocimiento
    const fileManager = new GoogleAIFileManager(this.apiKey);
    this.uploadedFiles = await this.uploadKnowledgeFiles(fileManager, this.knowledgeDir, this.cacheFilePath);

    // 2. Resolver cadena de modelos disponibles
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    const available = await this.listAvailableModels();
    console.log(`[IA] Modelos disponibles en la API: ${available.size > 0 ? [...available].slice(0, 12).join(', ') : 'ninguno detectado'}`);

    // Construir cadena priorizada
    const preferredModel = process.env.GEMINI_MODEL || '';
    const priorityList = preferredModel ? [preferredModel, ...MODEL_PRIORITY_CHAIN.filter((m) => m !== preferredModel)] : MODEL_PRIORITY_CHAIN;

    for (const pattern of priorityList) {
      const resolved = available.size > 0 ? matchModel(available, pattern) : pattern;
      if (!resolved) continue;
      if (this.modelChain.some((m) => m.name === resolved)) continue;

      const isGemma = resolved.toLowerCase().includes('gemma');
      const opts: any = {
        model: resolved,
        generationConfig: {
          temperature: 0.1,
          topP: 0.95,
        },
      };
      if (!isGemma) {
        opts.systemInstruction = DEFAULT_BOT_INSTRUCTIONS;
      }

      try {
        const instance = this.genAI.getGenerativeModel(opts);
        this.modelChain.push({ name: resolved, isGemma, instance, cooldownUntil: 0 });
      } catch (err) {
        console.warn(`[IA] No se pudo crear instancia para ${resolved}: ${(err as any)?.message}`);
      }
    }

    if (this.modelChain.length === 0) {
      throw new Error('No se encontró ningún modelo disponible en la API de Gemini.');
    }

    console.log(`[IA] Cadena de modelos configurada (${this.modelChain.length}): ${this.modelChain.map((m) => m.name).join(' → ')}`);

    // 3. Construir historial base (con archivos de conocimiento)
    const contextParts: PromptPart[] = this.uploadedFiles.map((f) => ({
      fileData: { fileUri: f.uri, mimeType: f.mimeType },
    }));

    const baseUserText = 'Usa esta base de conocimiento como fuente principal cuando respondas.';
    this.baseHistoryGemini = [
      { role: 'user', parts: [{ text: baseUserText }, ...contextParts] },
      { role: 'model', parts: [{ text: 'Entendido. Base de conocimiento cargada y lista para usar.' }] },
    ];

    this.baseHistoryGemma = [
      {
        role: 'user',
        parts: [{ text: `Instrucciones del sistema:\n${DEFAULT_BOT_INSTRUCTIONS}\n\n${baseUserText}` }, ...contextParts],
      },
      { role: 'model', parts: [{ text: 'Entendido. Base de conocimiento cargada y lista para usar.' }] },
    ];

    // 4. Limpieza periódica de sesiones viejas
    if (!this.cleanupTimer) {
      this.cleanupTimer = setInterval(() => this.cleanExpiredSessions(), SESSION_CLEANUP_INTERVAL_MS);
      if (this.cleanupTimer.unref) this.cleanupTimer.unref();
    }

    this.initialized = true;
    return { uploadedCount: this.uploadedFiles.length, modelName: this.modelChain[0].name };
  }

  /**
   * Genera contenido usando la cadena de modelos con fallback automático.
   */
  public async generateContent(userId: string, prompt: string, rawPrompt?: string): Promise<string> {
    await this.initialize();

    const now = Date.now();
    let lastError: Error | null = null;

    for (const entry of this.modelChain) {
      if (entry.cooldownUntil > now) continue;

      try {
        const result = await this.tryGenerateWithRetry(entry, userId, prompt, rawPrompt);
        return result;
      } catch (err: any) {
        lastError = err;

        if (isBillingError(err)) {
          console.error(`[IA] ⛔ Créditos de API agotados. No se puede usar ningún modelo. Revisá tu cuenta en https://ai.studio/projects`);
          throw new Error('Los créditos de la API de Gemini están agotados.');
        }

        if (this.isQuotaError(err)) {
          entry.cooldownUntil = now + RATE_LIMIT_COOLDOWN_MS;
          console.warn(`[IA] ${entry.name} rate-limited → cooldown 60s. Intentando siguiente modelo...`);
          continue;
        }

        if (isRetryableError(err)) {
          entry.cooldownUntil = now + SERVER_ERROR_COOLDOWN_MS;
          console.warn(`[IA] ${entry.name} error transitorio (${err.message}) → cooldown 30s. Intentando siguiente...`);
          continue;
        }

        console.error(`[IA] ${entry.name} error no retryable: ${err.message}`);
        continue;
      }
    }

    throw lastError || new Error('Todos los modelos de la cadena de Gemini están agotados o en cooldown.');
  }

  public getModelName(): string {
    const now = Date.now();
    const active = this.modelChain.find((m) => m.cooldownUntil <= now);
    return `Gemini (${active?.name || this.modelChain[0]?.name || 'desconocido'})`;
  }

  public isQuotaError(error: any): boolean {
    return isRateLimitError(error);
  }

  // ───── Métodos privados ─────

  private async tryGenerateWithRetry(entry: ModelEntry, userId: string, prompt: string, rawPrompt?: string): Promise<string> {
    const baseHistory = entry.isGemma ? this.baseHistoryGemma : this.baseHistoryGemini;
    const session = this.getOrCreateSession(userId);
    
    // Filtrar turnos viejos de más de 12 horas antes de construir el historial
    const nowMs = Date.now();
    const twelveHoursAgo = nowMs - 12 * 60 * 60 * 1000;
    session.turns = session.turns.filter((t) => t.timestamp >= twelveHoursAgo);

    const history = [...baseHistory, ...buildHistory(session.turns)];

    let lastErr: any = null;
    for (let attempt = 0; attempt < MAX_RETRIES_PER_MODEL; attempt++) {
      try {
        const chatSession = entry.instance.startChat({ history });
        const response = await chatSession.sendMessage(prompt);
        const text = sanitizeBotText(response.response.text());

        const finalUserPrompt = rawPrompt || prompt;
        session.turns.push({ user: finalUserPrompt, model: text, timestamp: nowMs });
        
        // Mantener filtro activo de 12 horas y límite de turnos
        session.turns = session.turns.filter((t) => t.timestamp >= twelveHoursAgo);
        if (session.turns.length > MAX_CHAT_TURNS) {
          session.turns = session.turns.slice(-MAX_CHAT_TURNS);
        }
        session.lastActivity = nowMs;

        return text;
      } catch (err: any) {
        lastErr = err;
        if (!isRetryableError(err) || attempt >= MAX_RETRIES_PER_MODEL - 1) throw err;
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
      }
    }

    throw lastErr;
  }

  private getOrCreateSession(userId: string): { turns: SessionTurn[]; lastActivity: number } {
    let session = this.sessions.get(userId);
    if (!session) {
      session = { turns: [], lastActivity: Date.now() };
      this.sessions.set(userId, session);
    }
    return session;
  }

  private cleanExpiredSessions(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [userId, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        this.sessions.delete(userId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[IA] Limpieza: ${cleaned} sesiones expiradas eliminadas (quedan ${this.sessions.size}).`);
    }
  }

  private async listAvailableModels(): Promise<Set<string>> {
    try {
      const response = await fetch(`${API_BASE_URL}/models?key=${encodeURIComponent(this.apiKey)}`);
      if (!response.ok) return new Set();
      const payload: any = await response.json();
      return new Set(
        (payload.models || [])
          .filter((m: any) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
          .map((m: any) => String(m.name || '').replace(/^models\//, '')),
      );
    } catch {
      return new Set();
    }
  }

  // ───── Upload de archivos de conocimiento ─────

  private async uploadKnowledgeFiles(fileManager: GoogleAIFileManager, dirPath: string, cacheFilePath: string): Promise<UploadedFile[]> {
    const fileNames = await this.getFilesFromDirectory(dirPath);
    if (fileNames.length === 0) return [];

    const cache = await this.loadUploadCache(cacheFilePath);
    const cacheFiles = cache.files || {};
    const uploaded: UploadedFile[] = [];

    for (let index = 0; index < fileNames.length; index += 1) {
      const fileName = fileNames[index];
      const fullPath = path.join(dirPath, fileName);
      const mimeType = detectMimeType(fileName);
      const fingerprint = await this.getLocalFileFingerprint(fullPath);
      const cachedEntry = cacheFiles[fileName];

      if (cachedEntry && cachedEntry.size === fingerprint.size && cachedEntry.mtimeMs === fingerprint.mtimeMs && cachedEntry.mimeType === mimeType && cachedEntry.resourceName) {
        try {
          const existing = await fileManager.getFile(cachedEntry.resourceName);
          const status = existing.state?.toUpperCase?.() ?? 'UNKNOWN';
          if (status === 'ACTIVE' && existing.uri) {
            uploaded.push({ name: fileName, uri: existing.uri, mimeType: existing.mimeType ?? mimeType });
            cacheFiles[fileName] = {
              ...cachedEntry,
              uri: existing.uri,
              mimeType: existing.mimeType ?? mimeType,
              lastVerifiedAt: new Date().toISOString(),
            };
            console.log(`[Cache] Reutilizando: ${fileName}`);
            continue;
          }
        } catch {
          // Re-upload when cache is stale.
        }
      }

      console.log(`[Upload] Subiendo: ${fileName} (${mimeType})...`);
      try {
        const result = await fileManager.uploadFile(fullPath, { mimeType, displayName: fileName });
        const uploadedFile = await this.waitUntilFileActive(fileManager, result.file.name);
        uploaded.push({ name: fileName, uri: uploadedFile.uri, mimeType: uploadedFile.mimeType ?? mimeType });
        cacheFiles[fileName] = {
          name: fileName,
          size: fingerprint.size,
          mtimeMs: fingerprint.mtimeMs,
          mimeType: uploadedFile.mimeType ?? mimeType,
          uri: uploadedFile.uri,
          resourceName: uploadedFile.name,
          updatedAt: new Date().toISOString(),
        };
      } catch (error) {
        console.error(`[Error] Falló al subir ${fileName}: ${(error as any)?.message}`);
      }

      if (index < fileNames.length - 1) {
        await sleep(UPLOAD_DELAY_MS);
      }
    }

    await this.saveUploadCache(cacheFilePath, { updatedAt: new Date().toISOString(), files: cacheFiles });
    return uploaded;
  }

  private async waitUntilFileActive(fileManager: GoogleAIFileManager, fileName: string): Promise<any> {
    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
      const current = await fileManager.getFile(fileName);
      const status = current.state?.toUpperCase?.() ?? 'UNKNOWN';
      if (status === 'ACTIVE') return current;
      if (status === 'FAILED') {
        throw new Error(`El archivo ${fileName} fallo su procesamiento en Gemini.`);
      }
      await sleep(POLL_DELAY_MS);
    }

    throw new Error(`Timeout esperando que ${fileName} quede ACTIVE.`);
  }

  private async getFilesFromDirectory(dirPath: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const allowedExtensions = new Set(['.pdf', '.txt', '.md', '.csv', '.json']);
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => {
          const lower = name.toLowerCase();
          return !lower.startsWith('.') && !lower.startsWith('readme') && allowedExtensions.has(path.extname(lower));
        })
        .sort((a, b) => a.localeCompare(b));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await fs.mkdir(dirPath, { recursive: true });
        return [];
      }
      throw error;
    }
  }

  private async loadUploadCache(cacheFilePath: string): Promise<{ updatedAt?: string; files: Record<string, any> }> {
    try {
      const raw = await fs.readFile(cacheFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed?.files || typeof parsed.files !== 'object') return { files: {} };
      return parsed;
    } catch {
      return { files: {} };
    }
  }

  private async saveUploadCache(cacheFilePath: string, cache: { updatedAt: string; files: Record<string, any> }): Promise<void> {
    await fs.writeFile(cacheFilePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
  }

  private async getLocalFileFingerprint(fullPath: string): Promise<{ size: number; mtimeMs: number }> {
    const stats = await fs.stat(fullPath);
    return { size: stats.size, mtimeMs: Math.round(stats.mtimeMs) };
  }
}

const MAX_RETRIES_PER_MODEL = 2;
