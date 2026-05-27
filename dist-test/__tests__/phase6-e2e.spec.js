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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sqlite3_1 = __importDefault(require("sqlite3"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
describe('Fase 6 E2E - !config-grupo flow', () => {
    let db;
    let userProfileRepo;
    let adminRepo;
    let adminCodeRepo;
    let noticeRepo;
    let examRepo;
    let classRepo;
    let teacherRepo;
    let moderationRepo;
    let groupContextRepo;
    let commissionRepo;
    let svc;
    beforeAll(async () => {
        db = new sqlite3_1.default.Database(':memory:');
        // Dynamic imports to avoid ESM resolver issues in the test runner
        const baseDir = path_1.default.dirname((0, url_1.fileURLToPath)(import.meta.url));
        const migrationsModule = await Promise.resolve(`${path_1.default.join(baseDir, '..', 'infrastructure', 'persistence', 'db', 'migrations.ts')}`).then(s => __importStar(require(s)));
        const reposModule = await Promise.resolve(`${path_1.default.join(baseDir, '..', 'infrastructure', 'persistence', 'db', 'repositories.ts')}`).then(s => __importStar(require(s)));
        const workflowModule = await Promise.resolve(`${path_1.default.join(baseDir, '..', 'application', 'admin', 'private-chat-workflow.service.ts')}`).then(s => __importStar(require(s)));
        const { applyMigrations } = migrationsModule;
        const { UserProfileRepository, AdminRepository, AdminVerificationCodeRepository, InstitutionalNoticeRepository, ManagedExamRepository, ManagedClassRepository, ManagedTeacherRepository, UserModerationRepository, GroupContextRepository, CommissionRepository, } = reposModule;
        const { PrivateChatWorkflowService } = workflowModule;
        await applyMigrations(db);
        userProfileRepo = new UserProfileRepository(db);
        adminRepo = new AdminRepository(db);
        adminCodeRepo = new AdminVerificationCodeRepository(db);
        noticeRepo = new InstitutionalNoticeRepository(db);
        examRepo = new ManagedExamRepository(db);
        classRepo = new ManagedClassRepository(db);
        teacherRepo = new ManagedTeacherRepository(db);
        moderationRepo = new UserModerationRepository(db);
        groupContextRepo = new GroupContextRepository(db);
        commissionRepo = new CommissionRepository(db);
        // Ensure admin has a minimal profile to avoid profile completion flow
        await userProfileRepo.upsert('admin1@s.whatsapp.net', 'Admin', '01/01', 'admin@ispc.edu.ar', 1);
        svc = new PrivateChatWorkflowService(userProfileRepo, adminRepo, adminCodeRepo, noticeRepo, examRepo, classRepo, teacherRepo, moderationRepo, {}, 'test-pass', groupContextRepo, commissionRepo);
        // Prepare admin user
        await adminRepo.register('admin1@s.whatsapp.net');
    });
    afterAll(() => {
        db.close();
    });
    test('admin can configure group context end-to-end', async () => {
        const starter = await svc.startGroupContextConfiguration('admin1@s.whatsapp.net', '12345-67890@g.us');
        expect(starter).toMatch(/Configuración del grupo/);
        expect(starter).toMatch(/Grupo ID: 12345-67890@g.us/);
        // send year
        const step2 = await svc.handlePrivateMessage('admin1@s.whatsapp.net', '2026');
        expect(step2).toMatch(/Ahora, ¿a qué comisión/);
        // send commission
        const step3 = await svc.handlePrivateMessage('admin1@s.whatsapp.net', 'A');
        expect(step3).toMatch(/Contexto del grupo actualizado exitosamente/);
        const ctx = await groupContextRepo.getByGroupId('12345-67890@g.us');
        expect(ctx).not.toBeNull();
        expect(ctx.year).toBe(2026);
        // commission should exist
        expect(ctx.commission_id).toBeGreaterThan(0);
        const comm = await commissionRepo.getById(ctx.commission_id);
        expect(comm).not.toBeNull();
        expect(comm.name).toBe('A');
    });
    // ensure jest has enough time for slow CI environments
    beforeAll(() => {
        jest.setTimeout(20000);
    });
});
