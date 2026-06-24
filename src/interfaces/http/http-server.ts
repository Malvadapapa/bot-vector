import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sqlite3 from 'sqlite3';
import { spawn } from 'node:child_process';
import { OnboardingTokenRepository } from '../../features/onboarding/onboarding-token.repository.js';
import { WebOtpRepository } from '../../features/onboarding/web-otp.repository.js';
import {
  GroupRepository,
  GroupContextRepository,
  CommissionRepository,
  ManagedClassRepository,
  ClassCommissionScheduleRepository,
  ManagedExamRepository,
  InstitutionalNoticeRepository,
  AdminRepository,
  UserProfileRepository,
  ManagedTeacherRepository,
  AuthorizedEmailRepository
} from '../../infrastructure/persistence/db/repositories.js';
import { OutboundEmailService } from '../../features/notifications/integrations/email.service.js';
import { VectoritoWhatsAppGateway } from '../whatsapp/vectorito-whatsapp-gateway.js';
import { run, get, all, formatLocalDateOnly } from '../../shared/db/db-utils.js';
import { BanWarningSystem } from '../../features/moderation/ban-warning-system.js';
import { PrivateChatWorkflowService } from '../../application/admin/private-chat-workflow.service.js';

// ── JWT Utilities (Pure Node/TypeScript - No External Dependencies) ─────────────────
export class JwtUtils {
  private static SECRET = process.env.JWT_SECRET || 'vectorito-secret-key-123456';

  public static sign(payload: any, expiresInSeconds = 2 * 60 * 60): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const fullPayload = { ...payload, exp };
    const base64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
    
    const signature = crypto
      .createHmac('sha256', this.SECRET)
      .update(`${base64Header}.${base64Payload}`)
      .digest('base64url');
      
    return `${base64Header}.${base64Payload}.${signature}`;
  }

  public static verify(token: string): any | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      const [base64Header, base64Payload, signature] = parts;
      const expectedSignature = crypto
        .createHmac('sha256', this.SECRET)
        .update(`${base64Header}.${base64Payload}`)
        .digest('base64url');
        
      if (signature !== expectedSignature) return null;
      
      const payload = JSON.parse(Buffer.from(base64Payload, 'base64url').toString('utf8'));
      if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
        return null; // Expired
      }
      return payload;
    } catch {
      return null;
    }
  }
}

// ── Spanish Days Map for Class Schedules ──────────────────────────────────────────
const DAYS_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function getEndTime(startTime: string): string {
  const parts = startTime.split(':');
  if (parts.length < 2) return '20:00';
  const hours = (parseInt(parts[0], 10) + 2) % 24;
  return `${String(hours).padStart(2, '0')}:${parts[1]}`;
}

function normalizeString(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function normalizeSubjectName(name: string): string {
  let normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  normalized = normalized.replace(/\biii\b/g, '3');
  normalized = normalized.replace(/\bii\b/g, '2');
  normalized = normalized.replace(/\bi\b/g, '1');
  if (normalized.includes('practica 2') || normalized.includes('practica profesionalizante 2') || normalized.includes('practica profesionalizante ii')) {
    return 'practica profesionalizante 2';
  }
  if (normalized.includes('practica 1') || normalized.includes('practica profesionalizante 1') || normalized.includes('practica profesionalizante i')) {
    return 'practica profesionalizante 1';
  }
  return normalized.replace(/[^a-z0-9]/g, '');
}

export class HttpServer {
  private server: http.Server;
  private tunnelProcess: any = null;
  private banWarningSystem = new BanWarningSystem();
  private lastBaseUrl: string | null = null;

  constructor(
    private onboardingTokenRepo: OnboardingTokenRepository,
    private webOtpRepository: WebOtpRepository,
    private groupRepository: GroupRepository,
    private groupContextRepository: GroupContextRepository,
    private commissionRepository: CommissionRepository,
    private managedClassRepository: ManagedClassRepository,
    private classCommissionScheduleRepository: ClassCommissionScheduleRepository,
    private managedExamRepository: ManagedExamRepository,
    private institutionalNoticeRepository: InstitutionalNoticeRepository,
    private adminRepository: AdminRepository,
    private userProfileRepository: UserProfileRepository,
    private managedTeacherRepository: ManagedTeacherRepository,
    private authorizedEmailRepository: AuthorizedEmailRepository,
    private outboundEmailService: OutboundEmailService,
    private vectoritoWhatsAppGateway: VectoritoWhatsAppGateway,
    private sqliteDb: sqlite3.Database,
    private port = 3000
  ) {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`[HTTP Server] Servidor corriendo en http://localhost:${this.port}`);
        
        // Spawn Tunnel automatically if enabled in env
        if (process.env.AUTO_TUNNEL === 'true' || process.env.AUTO_TUNNEL === 'localhost.run' || process.env.AUTO_TUNNEL === 'ngrok') {
          this.startTunnel();
        }

        resolve();
      });
    });
  }

  private startTunnel() {
    const autoTunnel = process.env.AUTO_TUNNEL;
    const baseUrl = process.env.BASE_URL || '';

    if (autoTunnel === 'ngrok' || (autoTunnel === 'true' && baseUrl.includes('ngrok'))) {
      this.startNgrokTunnel(baseUrl);
    } else {
      this.startSshTunnel();
    }
  }

  private startNgrokTunnel(baseUrl: string) {
    console.log('[Tunnel] Iniciando túnel ngrok seguro con dominio estático...');
    try {
      let domain = baseUrl.replace('https://', '').replace('http://', '').split('/')[0];
      if (!domain) {
        console.error('[Tunnel] No se pudo determinar el dominio de ngrok desde BASE_URL:', baseUrl);
        return;
      }

      const ngrokCmd = process.env.NGROK_PATH || 'ngrok';
      console.log(`[Tunnel] Ejecutando: ${ngrokCmd} http ${this.port} --url=${domain}`);
      this.tunnelProcess = spawn(ngrokCmd, [
        'http',
        String(this.port),
        `--url=${domain}`
      ], { shell: true });

      this.tunnelProcess.on('error', (err: any) => {
        console.error('\n┌────────────────────────────────────────────────────────┐');
        console.error('│  ⚠️  ERROR AL INICIAR EL TÚNEL NGROK                    │');
        console.error('│  No se pudo ejecutar el comando "ngrok".               │');
        console.error('│  Detalle: ' + String(err.message || err).padEnd(45, ' ') + '│');
        console.error('│  Para solucionarlo:                                    │');
        console.error('│  1. Instalá ngrok y agregalo al PATH de tu sistema, o  │');
        console.error('│  2. Definí NGROK_PATH=C:\\ruta\\a\\ngrok.exe en tu .env   │');
        console.error('└────────────────────────────────────────────────────────┘\n');
      });

      this.tunnelProcess.stdout.on('data', (data: any) => {
        const output = data.toString();
        console.log('[Tunnel stdout]:', output.trim());
        if (output.includes('Session Status') || output.includes('online') || output.includes('Active')) {
          console.log('[Tunnel] Túnel ngrok activo y online.');
        }
      });

      this.tunnelProcess.stderr.on('data', (data: any) => {
        const output = data.toString();
        console.error('[Tunnel stderr]:', output.trim());
      });

      this.tunnelProcess.on('close', (code: any) => {
        console.log(`[Tunnel] Túnel ngrok cerrado con código: ${code}`);
      });
    } catch (err) {
      console.error('[Tunnel] Error al iniciar el túnel ngrok:', err);
    }
  }

  private startSshTunnel() {
    console.log('[Tunnel] Iniciando túnel SSH seguro con localhost.run...');
    try {
      this.tunnelProcess = spawn('ssh', [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ServerAliveInterval=60',
        '-R', `80:localhost:${this.port}`,
        'nokey@localhost.run'
      ]);

      this.tunnelProcess.on('error', (err: any) => {
        console.error('[Tunnel] Error al ejecutar ssh. Verificá que OpenSSH esté instalado en tu sistema:', err);
      });

      this.tunnelProcess.stdout.on('data', async (data: any) => {
        const output = data.toString();
        const match = output.match(/https:\/\/[a-zA-Z0-9-.]+\.lhr\.life/);
        if (match) {
          const newUrl = match[0];
          process.env.BASE_URL = newUrl;
          console.log('\n┌────────────────────────────────────────────────────────┐');
          console.log(`│  🌐 PANEL WEB ACCESSIBLE PÚBLICAMENTE                  │`);
          console.log(`│  Enlace: ${newUrl.padEnd(46, ' ')}│`);
          console.log('└────────────────────────────────────────────────────────┘\n');

          if (newUrl !== this.lastBaseUrl) {
            this.lastBaseUrl = newUrl;
            await this.notifyAdminsOfUrlChange(newUrl);
          }
        }
      });

      this.tunnelProcess.on('close', (code: any) => {
        console.log(`[Tunnel] Túnel SSH cerrado con código: ${code}`);
      });
    } catch (err) {
      console.error('[Tunnel] Error al iniciar el túnel SSH:', err);
    }
  }

  private async notifyAdminsOfUrlChange(newUrl: string) {
    try {
      const rows = await all<any>(
        this.sqliteDb,
        `SELECT a.user_id, LOWER(p.email) as email
         FROM admin_users a
         JOIN user_profiles p ON a.user_id = p.user_id
         WHERE a.is_super_admin = 1 AND a.is_authenticated = 1 AND p.email IS NOT NULL AND p.email != ''`
      );

      for (const row of rows) {
        const jid = row.user_id;
        const email = row.email;
        if (!jid || !email) continue;

        const otpCode = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
        await this.webOtpRepository.createOtp(email, otpCode, jid, expiresAt);

        const redirectPath = '/super-admin/groups';
        const loginUrl = `${newUrl}/login?email=${encodeURIComponent(email)}&otp=${otpCode}&redirect=${encodeURIComponent(redirectPath)}`;

        const message = [
          `🌐 *Túnel del Panel Web Actualizado*`,
          ``,
          `Se ha restablecido la conexión del túnel. Hacé click en el siguiente enlace de acceso directo para ingresar al panel con tu sesión activa:`,
          ``,
          `${loginUrl}`,
          ``,
          `⚠️ *Nota:* Este enlace es de uso único y expirará en 15 minutos.`
        ].join('\n');

        try {
          await this.vectoritoWhatsAppGateway.sendTextMessage(jid, message);
          console.log(`[Tunnel] Notificación de cambio de URL enviada con éxito a ${jid} (${email})`);
        } catch (err) {
          console.error(`[Tunnel] Error al enviar notificación de cambio de URL a ${jid}:`, err);
        }
      }
    } catch (err) {
      console.error('[Tunnel] Error al notificar cambio de URL a admins:', err);
    }
  }

  public stop(): Promise<void> {
    if (this.tunnelProcess) {
      try {
        this.tunnelProcess.kill();
        console.log('[Tunnel] Proceso de túnel SSH terminado.');
      } catch (e) {
        // ignore
      }
    }
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '', `http://localhost:${this.port}`);
    const pathname = parsedUrl.pathname;

    try {
      // ── API ROUTES ──────────────────────────────────────────────────────────

      // 1. Onboarding Token Validation
      if (pathname === '/api/onboarding/validate' && req.method === 'GET') {
        const token = parsedUrl.searchParams.get('token');
        if (!token) {
          this.sendJson(res, 400, { success: false, error: 'Se requiere el parámetro token.' });
          return;
        }
        const groupId = await this.onboardingTokenRepo.validateToken(token);
        if (!groupId) {
          this.sendJson(res, 400, { success: false, error: 'Token inválido o expirado.' });
          return;
        }
        const matched = await get<any>(
          this.sqliteDb,
          'SELECT display_name FROM whatsapp_groups WHERE group_id = ? LIMIT 1',
          [groupId]
        );
        const groupName = matched?.display_name || groupId;
        this.sendJson(res, 200, { success: true, groupId, groupName });
        return;
      }

      // 2. Auth: Send OTP
      if (pathname === '/api/auth/send-otp' && req.method === 'POST') {
        const { email } = await this.getBodyJson(req);
        if (!email) {
          this.sendJson(res, 400, { success: false, error: 'Email requerido.' });
          return;
        }

        const normalizedEmail = email.trim().toLowerCase();
        
        // Check permissions/role
        const superadminEmailsEnv = process.env.SUPERADMIN_EMAILS || '';
        const superadmins = superadminEmailsEnv.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
        
        let isSuper = superadmins.includes(normalizedEmail);
        let isAdmin = false;
        let isTeacher = false;
        let isCollaborator = false;

        // Try Admin JID mapping
        let adminJid: string | null = null;
        const profile = await get<any>(
          this.sqliteDb,
          'SELECT user_id FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
          [normalizedEmail]
        );
        if (profile && profile.user_id) {
          adminJid = profile.user_id;
        }

        if (!isSuper) {
          const adminEmails = await this.adminRepository.listAdminEmails();
          if (adminEmails.map(e => e.toLowerCase()).includes(normalizedEmail)) {
            isAdmin = true;
          }
        }

        if (!isSuper && !isAdmin) {
          const teacher = await this.managedTeacherRepository.getByEmail(normalizedEmail);
          if (teacher) {
            isTeacher = true;
          }
        }

        if (!isSuper && !isAdmin && !isTeacher) {
          const collab = await this.authorizedEmailRepository.exists(normalizedEmail);
          if (collab) {
            isCollaborator = true;
          }
        }

        if (!isSuper && !isAdmin && !isTeacher && !isCollaborator) {
          this.sendJson(res, 403, { success: false, error: 'Email no registrado o no autorizado.' });
          return;
        }

        // Check if an OTP was recently generated (debounce: 1 minute)
        const existingSession = await this.webOtpRepository.getOtp(normalizedEmail);
        let otpCode: string;
        let expiresAt: Date;

        if (existingSession && existingSession.created_at) {
          const createdAtTime = new Date(existingSession.created_at + ' UTC').getTime();
          const oneMinuteAgo = Date.now() - (60 * 1000);
          if (createdAtTime > oneMinuteAgo) {
            // Debounce active, reuse existing OTP code
            otpCode = existingSession.code;
            expiresAt = new Date(existingSession.expires_at);
          } else {
            // Exceeds 1 minute, generate new OTP
            otpCode = String(Math.floor(100000 + Math.random() * 900000));
            expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
            await this.webOtpRepository.createOtp(normalizedEmail, otpCode, adminJid, expiresAt);
          }
        } else {
          // No existing session, generate new OTP
          otpCode = String(Math.floor(100000 + Math.random() * 900000));
          expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
          await this.webOtpRepository.createOtp(normalizedEmail, otpCode, adminJid, expiresAt);
        }

        // Deliver OTP
        if ((isSuper || isAdmin) && adminJid) {
          // Send via WhatsApp
          const redirectPath = isSuper ? '/super-admin/groups' : '/admin/calendar';
          const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
          const loginUrl = `${baseUrl}/login?email=${encodeURIComponent(normalizedEmail)}&redirect=${encodeURIComponent(redirectPath)}`;

          try {
            await this.vectoritoWhatsAppGateway.sendTextMessage(
              adminJid,
              `🔗 *Acceso al Panel de Control Web*\n\nHola. Hacé click en el enlace para ingresar al panel:\n${loginUrl}`
            );
            await this.vectoritoWhatsAppGateway.sendTextMessage(adminJid, otpCode);
            this.sendJson(res, 200, { success: true, method: 'whatsapp', debugCode: otpCode });
          } catch (e) {
            console.error('[HTTP Server] Falló envío WhatsApp OTP, reintentando por email:', e);
            // Fallback to email if WhatsApp gateway fails
            await this.sendOtpEmail(normalizedEmail, otpCode, isSuper ? '/super-admin/groups' : '/admin/calendar');
            this.sendJson(res, 200, { success: true, method: 'email', fallback: true, debugCode: otpCode });
          }
        } else {
          // Send via Email
          const redirectPath = isTeacher ? '/professor/messages' : '/institutional/notices';
          await this.sendOtpEmail(normalizedEmail, otpCode, redirectPath);
          this.sendJson(res, 200, { success: true, method: 'email', debugCode: otpCode });
        }
        return;
      }

      // 3. Auth: Verify OTP
      if (pathname === '/api/auth/verify-otp' && req.method === 'POST') {
        const { email, code } = await this.getBodyJson(req);
        if (!email || !code) {
          this.sendJson(res, 400, { success: false, error: 'Email y código OTP requeridos.' });
          return;
        }

        const normalizedEmail = email.trim().toLowerCase();
        const verifiedJidOrEmail = await this.webOtpRepository.validateOtp(normalizedEmail, code);
        
        if (!verifiedJidOrEmail) {
          this.sendJson(res, 401, { success: false, error: 'Código OTP inválido o expirado.' });
          return;
        }

        // Determine user details and role
        const superadminEmailsEnv = process.env.SUPERADMIN_EMAILS || '';
        const superadmins = superadminEmailsEnv.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
        
        let role = 'institutional';
        let name = normalizedEmail;

        if (superadmins.includes(normalizedEmail)) {
          role = 'super_admin';
          name = 'Super Admin';
        } else {
          const adminEmails = await this.adminRepository.listAdminEmails();
          if (adminEmails.map(e => e.toLowerCase()).includes(normalizedEmail)) {
            role = 'group_admin';
            name = 'Admin';
          } else {
            const teacher = await this.managedTeacherRepository.getByEmail(normalizedEmail);
            if (teacher) {
              role = 'professor';
              name = teacher.name;
            } else {
              role = 'institutional';
              name = 'Colaborador';
            }
          }
        }

        // Fetch display name from user profile if available
        const profile = await get<any>(
          this.sqliteDb,
          'SELECT name FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
          [normalizedEmail]
        );
        if (profile && profile.name) {
          name = profile.name;
        }

        const token = JwtUtils.sign({ email: normalizedEmail, role, name });
        this.sendJson(res, 200, {
          success: true,
          token,
          user: { id: normalizedEmail, email: normalizedEmail, name, role, groupIds: [] }
        });
        return;
      }

      // ── PROTECTED ROUTES (Require JWT validation) ──────────────────────────────────
      let authUser: any = null;
      if (pathname.startsWith('/api/') && pathname !== '/api/onboarding/complete') {
        authUser = await this.getAuthenticatedUser(req);
        if (!authUser) {
          this.sendJson(res, 401, { success: false, error: 'Autorización Bearer token inválida o expirada.' });
          return;
        }
      }

      // 4. GET /api/groups
      if (pathname === '/api/groups' && req.method === 'GET') {
        const groups = await this.groupRepository.getAllActiveGroupsWithEntryYear();
        const mappedGroups = [];

        for (const g of groups) {
          const context = await this.groupContextRepository.getByGroupId(g.group_id);
          const memberCountRow = await get<any>(
            this.sqliteDb,
            'SELECT COUNT(*) as count FROM group_memberships WHERE group_id = ? AND is_active = 1',
            [g.group_id]
          );
          const studentCount = memberCountRow ? Number(memberCountRow.count) : 0;

          // Check if onboarding is completed
          const onboardingRow = await get<any>(
            this.sqliteDb,
            'SELECT onboarding_completed FROM pending_group_onboarding WHERE group_id = ?',
            [g.group_id]
          );
          const onboardingCompleted = !onboardingRow || Number(onboardingRow.onboarding_completed) === 1;
          const isConfigured = !!(context?.year) && onboardingCompleted;

          // Count commissions linked to this group
          let commissionsCount = 1;
          if (context) {
            const commCountRow = await get<any>(
              this.sqliteDb,
              'SELECT COUNT(*) as count FROM group_context_commissions WHERE group_context_id = ?',
              [context.id]
            );
            commissionsCount = commCountRow ? Math.max(Number(commCountRow.count), 1) : 1;
          }

          // Get group admins
          const adminRows = await all<any>(
            this.sqliteDb,
            `SELECT ga.user_id, COALESCE(p.name, '') as name
             FROM group_admins ga
             JOIN admin_users a ON ga.user_id = a.user_id
             LEFT JOIN user_profiles p ON ga.user_id = p.user_id
             WHERE a.is_authenticated = 1 AND ga.group_id = ?`,
            [g.group_id]
          );
          const admins = adminRows.map((a: any) => ({
            name: a.name || 'Admin',
            phone: String(a.user_id).split('@')[0],
          }));

          mappedGroups.push({
            id: g.group_id,
            name: g.display_name || g.group_id,
            institutionName: 'ISPC',
            cohortIds: g.entry_year ? [`camada:${g.entry_year}`] : [],
            config: {
              silenceStartHour: 22,
              silenceEndHour: 7,
              dailyQueryLimit: 50,
              timezone: 'America/Argentina/Buenos_Aires',
              welcomeMessage: context?.label || 'Bienvenidos',
            },
            createdAt: new Date().toISOString(),
            type: context?.year ? 'cursada' : 'general',
            entryYear: context?.year || undefined,
            cohortYear: g.entry_year || undefined,
            studentCount,
            isConfigured,
            commissionsCount,
            admins,
          });
        }
        this.sendJson(res, 200, mappedGroups);
        return;
      }

      // PUT /api/groups/:id
      if (pathname.startsWith('/api/groups/') && req.method === 'PUT') {
        const groupId = pathname.substring('/api/groups/'.length);
        const { entryYear, cohortYear, name, config, commissionsCount } = await this.getBodyJson(req);

        // Update entry year in whatsapp_groups (which is cohortYear in the API / frontend payload)
        if (entryYear === undefined) {
          await this.groupRepository.updateEntryYear(groupId, null);
          await this.groupContextRepository.delete(groupId);
        } else {
          if (cohortYear !== undefined) {
            await this.groupRepository.updateEntryYear(groupId, cohortYear);
          }
          const welcomeMsg = config?.welcomeMessage || 'Bienvenidos';
          await this.groupContextRepository.upsert(groupId, entryYear, null, welcomeMsg, authUser.email);

          // Mark onboarding as completed when group gets configured
          try {
            const onboardingRow = await get<any>(
              this.sqliteDb,
              'SELECT onboarding_completed FROM pending_group_onboarding WHERE group_id = ?',
              [groupId]
            );
            if (onboardingRow && Number(onboardingRow.onboarding_completed) === 0) {
              await run(
                this.sqliteDb,
                'UPDATE pending_group_onboarding SET onboarding_completed = 1, step = ? WHERE group_id = ?',
                ['completed', groupId]
              );
              // Send confirmation message to the WhatsApp group
              try {
                const configuredMsg = [
                  '✅ *¡Todo listo! Ya estoy configurado y operativo.* 🎓',
                  '',
                  'A partir de ahora voy a enviarles:',
                  '📚 Recordatorios de clases',
                  '📝 Alertas de exámenes y evaluaciones',
                  '📢 Avisos institucionales',
                  '',
                  'Pueden consultar sus horarios con *!hoy* o *!semana*, ver exámenes con *!examenes* y mucho más.',
                  '',
                  '¡Buena cursada a todos! 🚀✨'
                ].join('\n');
                await this.vectoritoWhatsAppGateway.sendTextMessage(groupId, configuredMsg);
              } catch (msgErr) {
                console.warn('[HTTP Server] No se pudo enviar mensaje de configuración al grupo:', (msgErr as any)?.message || msgErr);
              }
            }
          } catch (e) {
            console.warn('[HTTP Server] Error al actualizar onboarding:', (e as any)?.message || e);
          }
        }
        
        if (name) {
          await run(this.sqliteDb, 'UPDATE whatsapp_groups SET display_name = ? WHERE group_id = ?', [name, groupId]);
        }

        // Handle commissions count and sync to global year configs
        const context = await this.groupContextRepository.getByGroupId(groupId);
        if (context) {
          const configRow = await get<any>(
            this.sqliteDb,
            'SELECT commission_count FROM year_commission_configs WHERE year = ?',
            [context.year]
          );
          const targetCount = configRow ? Math.min(Math.max(Number(configRow.commission_count), 1), 4) : 1;

          const existingComms = await all<any>(
            this.sqliteDb,
            'SELECT c.id, c.name FROM commissions c JOIN group_context_commissions gcc ON c.id = gcc.commission_id WHERE gcc.group_context_id = ?',
            [context.id]
          );
          const currentCount = existingComms.length;

          if (currentCount === 0 || (commissionsCount !== undefined && Number(commissionsCount) !== currentCount)) {
            const finalCount = commissionsCount !== undefined ? Math.min(Math.max(Number(commissionsCount), 1), 4) : targetCount;
            
            // Update global config for this year of study
            await run(
              this.sqliteDb,
              'INSERT INTO year_commission_configs (year, commission_count) VALUES (?, ?) ON CONFLICT(year) DO UPDATE SET commission_count = excluded.commission_count',
              [context.year, finalCount]
            );

            // Sync all groups of this year
            const groupsToSync = await all<any>(
              this.sqliteDb,
              'SELECT id, group_id FROM group_context WHERE year = ?',
              [context.year]
            );

            for (const gCtx of groupsToSync) {
              const gComms = await all<any>(
                this.sqliteDb,
                'SELECT c.id, c.name FROM commissions c JOIN group_context_commissions gcc ON c.id = gcc.commission_id WHERE gcc.group_context_id = ?',
                [gCtx.id]
              );
              const gCount = gComms.length;

              if (finalCount > gCount) {
                // Add missing commissions
                const commLabels = ['A', 'B', 'C', 'D'];
                const groupRow = await get<any>(
                  this.sqliteDb,
                  'SELECT entry_year FROM whatsapp_groups WHERE group_id = ? LIMIT 1',
                  [gCtx.group_id]
                );
                const cohortYearVal = groupRow?.entry_year || new Date().getFullYear();

                for (let i = gCount; i < finalCount; i++) {
                  const commName = `Comisión ${commLabels[i] || (i + 1)}`;
                  const result = await run(
                    this.sqliteDb,
                    'INSERT INTO commissions (name, year, shift) VALUES (?, ?, ?)',
                    [commName, cohortYearVal, 'General']
                  );
                  await run(
                    this.sqliteDb,
                    'INSERT OR IGNORE INTO group_context_commissions (group_context_id, commission_id) VALUES (?, ?)',
                    [gCtx.id, result.lastID]
                  );
                }
              } else if (finalCount < gCount) {
                // Remove excess commissions (from the end)
                const toRemove = gComms.slice(finalCount);
                for (const comm of toRemove) {
                  await run(this.sqliteDb, 'DELETE FROM group_context_commissions WHERE group_context_id = ? AND commission_id = ?', [gCtx.id, comm.id]);
                }
              }
            }
          }
        }

        // Handle global teachers automatic inheritance when configured
        if (entryYear !== undefined) {
          try {
            const context = await this.groupContextRepository.getByGroupId(groupId);
            if (context) {
              const groupCommissions = await all<any>(
                this.sqliteDb,
                'SELECT c.id, c.name FROM commissions c JOIN group_context_commissions gcc ON c.id = gcc.commission_id WHERE gcc.group_context_id = ?',
                [context.id]
              );
            
            const subjects = await all<any>(this.sqliteDb, 'SELECT name FROM academic_subjects WHERE year = ?', [entryYear]);
            const globalTeachers = await all<any>(
              this.sqliteDb,
              "SELECT * FROM managed_teachers WHERE group_id IS NULL OR group_id = ''"
            );

            for (const sub of subjects) {
              for (const comm of groupCommissions) {
                // Determine the commission letter/label from comm.name (e.g. "Comisión A" -> "A")
                let letter = 'A';
                if (comm.name.includes('B') || comm.name.includes('b')) letter = 'B';
                else if (comm.name.includes('C') || comm.name.includes('c')) letter = 'C';
                else if (comm.name.includes('D') || comm.name.includes('d')) letter = 'D';

                // Find global teacher for this subject and this commission letter
                let globalTeacher = globalTeachers.find(
                  (t: any) => normalizeSubjectName(t.subject) === normalizeSubjectName(sub.name) && t.commission_label === letter
                );
                // Fallback to commission 'A' or default if not found
                if (!globalTeacher && letter !== 'A') {
                  globalTeacher = globalTeachers.find(
                    (t: any) => normalizeSubjectName(t.subject) === normalizeSubjectName(sub.name) && (t.commission_label === 'A' || !t.commission_label)
                  );
                }

                if (globalTeacher) {
                  // Check if group already has this teacher mapping for this commission
                  const exists = await get<any>(
                    this.sqliteDb,
                    'SELECT id FROM managed_teachers WHERE group_id = ? AND subject = ? AND commission_id = ?',
                    [groupId, sub.name, comm.id]
                  );
                  if (!exists) {
                    await run(
                      this.sqliteDb,
                      'INSERT INTO managed_teachers (name, email, subject, group_id, commission_id, phone, notify_email, notify_whatsapp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                      [
                        globalTeacher.name,
                        globalTeacher.email,
                        sub.name,
                        groupId,
                        comm.id,
                        globalTeacher.phone || null,
                        globalTeacher.notify_email !== undefined ? globalTeacher.notify_email : 1,
                        globalTeacher.notify_whatsapp !== undefined ? globalTeacher.notify_whatsapp : 1,
                      ]
                    );
                    console.log(`[Inheritance] Inherited global teacher ${globalTeacher.name} for subject ${sub.name} in group ${groupId} commission ${comm.name}`);
                  }
                }
              }
            }
          }
        } catch (inheritanceErr) {
          console.error('[Inheritance] Error inheriting global teachers:', inheritanceErr);
        }
      }
        
        this.sendJson(res, 200, { success: true });
        return;
      }

      // DELETE /api/groups/:id - CASCADE DELETE
      if (pathname.startsWith('/api/groups/') && req.method === 'DELETE') {
        const groupId = pathname.substring('/api/groups/'.length);
        
        // Cascade delete all group-related data
        try {
          // 1. Delete group context
          await this.groupContextRepository.delete(groupId);
          
          // 2. Delete pending onboarding
          await run(this.sqliteDb, 'DELETE FROM pending_group_onboarding WHERE group_id = ?', [groupId]);
          

          // 4. Delete managed teachers for this group
          await run(this.sqliteDb, 'DELETE FROM managed_teachers WHERE group_id = ?', [groupId]);
          
          // 5. Delete managed classes for this group
          await run(this.sqliteDb, 'DELETE FROM managed_classes WHERE group_id = ?', [groupId]);
          
          // 6. Delete managed exams for this group
          await run(this.sqliteDb, 'DELETE FROM managed_exams WHERE group_id = ?', [groupId]);
          
          // 7. Delete group memberships
          await run(this.sqliteDb, 'DELETE FROM group_memberships WHERE group_id = ?', [groupId]);
          
          // 8. Remove group admins (unlink, don't delete admin accounts)
          await run(this.sqliteDb, 'DELETE FROM group_admins WHERE group_id = ?', [groupId]);
          
          // 9. Delete the group itself
          await this.groupRepository.delete(groupId);
          
          console.log(`[HTTP Server] Grupo ${groupId} eliminado en cascada con éxito.`);
        } catch (e) {
          console.error('[HTTP Server] Error en cascade delete:', (e as any)?.message || e);
        }
        
        this.sendJson(res, 200, { success: true });
        return;
      }

      // 5. GET /api/subjects/preseeded
      if (pathname === '/api/subjects/preseeded' && req.method === 'GET') {
        const yearParam = parsedUrl.searchParams.get('year');
        let sql = 'SELECT * FROM academic_subjects';
        const params: any[] = [];
        if (yearParam) {
          sql += ' WHERE year = ?';
          params.push(parseInt(yearParam, 10));
        }

        const rows = await all<any>(this.sqliteDb, sql, params);
        
        // Get global teachers (those not tied to a specific group)
        const globalTeachers = await all<any>(
          this.sqliteDb,
          'SELECT name, email, subject, meet_link, commission_label FROM managed_teachers WHERE group_id IS NULL OR group_id = ?',
          ['']
        );
        
        const currentYear = new Date().getFullYear();
        const mappedSubjects = rows.map((r) => {
          const matchingTeacherA = globalTeachers.find(
            (t: any) => normalizeSubjectName(t.subject) === normalizeSubjectName(r.name) && 
                        (t.commission_label === 'A' || !t.commission_label)
          );
          const matchingTeacherB = globalTeachers.find(
            (t: any) => normalizeSubjectName(t.subject) === normalizeSubjectName(r.name) && t.commission_label === 'B'
          );
          const matchingTeacherC = globalTeachers.find(
            (t: any) => normalizeSubjectName(t.subject) === normalizeSubjectName(r.name) && t.commission_label === 'C'
          );
          const matchingTeacherD = globalTeachers.find(
            (t: any) => normalizeSubjectName(t.subject) === normalizeSubjectName(r.name) && t.commission_label === 'D'
          );

          const commissions = {
            'A': {
              teacherName: matchingTeacherA?.name || '',
              teacherEmail: matchingTeacherA?.email || '',
              meetLink: matchingTeacherA?.meet_link || ''
            },
            'B': {
              teacherName: matchingTeacherB?.name || '',
              teacherEmail: matchingTeacherB?.email || '',
              meetLink: matchingTeacherB?.meet_link || ''
            },
            'C': {
              teacherName: matchingTeacherC?.name || '',
              teacherEmail: matchingTeacherC?.email || '',
              meetLink: matchingTeacherC?.meet_link || ''
            },
            'D': {
              teacherName: matchingTeacherD?.name || '',
              teacherEmail: matchingTeacherD?.email || '',
              meetLink: matchingTeacherD?.meet_link || ''
            }
          };

          return {
            id: String(r.id),
            name: String(r.name),
            code: String(r.id),
            year: Number(r.year),
            cohortId: `camada:${currentYear - r.year + 1}`,
            groupId: '',
            professorIds: matchingTeacherA ? [matchingTeacherA.email] : [],
            teacherName: matchingTeacherA?.name || '',
            teacherEmail: matchingTeacherA?.email || '',
            meetLink: matchingTeacherA?.meet_link || '',
            commissions,
            weeklySchedule: [],
            isAnnual: false
          };
        });

        this.sendJson(res, 200, mappedSubjects);
        return;
      }

      // PUT /api/subjects/:subjectId/teacher - Save/update global teacher assignment
      if (pathname.startsWith('/api/subjects/') && pathname.endsWith('/teacher') && req.method === 'PUT') {
        const subjectId = pathname.split('/')[3];
        const { teacherName, teacherEmail, meetLink, commissionLabel } = await this.getBodyJson(req);

        // Get subject name from academic_subjects
        const subject = await get<any>(this.sqliteDb, 'SELECT name FROM academic_subjects WHERE id = ?', [subjectId]);
        if (!subject) {
          this.sendJson(res, 404, { success: false, error: 'Materia no encontrada.' });
          return;
        }

        const labelToSave = commissionLabel || 'A';

        // Upsert global teacher (group_id = NULL or empty)
        let existing;
        if (labelToSave === 'A') {
          existing = await get<any>(
            this.sqliteDb,
            `SELECT id FROM managed_teachers 
             WHERE (group_id IS NULL OR group_id = ?) 
               AND subject = ? 
               AND (commission_label = 'A' OR commission_label IS NULL OR commission_label = '')`,
            ['', subject.name]
          );
        } else {
          existing = await get<any>(
            this.sqliteDb,
            `SELECT id FROM managed_teachers 
             WHERE (group_id IS NULL OR group_id = ?) 
               AND subject = ? 
               AND commission_label = ?`,
            ['', subject.name, labelToSave]
          );
        }

        if (existing) {
          await run(
            this.sqliteDb,
            'UPDATE managed_teachers SET name = ?, email = ?, meet_link = ?, commission_label = ? WHERE id = ?',
            [teacherName || '', teacherEmail || '', meetLink || '', labelToSave, existing.id]
          );
        } else {
          await run(
            this.sqliteDb,
            'INSERT INTO managed_teachers (name, email, subject, group_id, meet_link, commission_label) VALUES (?, ?, ?, ?, ?, ?)',
            [teacherName || '', teacherEmail || '', subject.name, '', meetLink || '', labelToSave]
          );
        }

        this.sendJson(res, 200, { success: true });
        return;
      }

      // GET /api/subjects/years-config
      if (pathname === '/api/subjects/years-config' && req.method === 'GET') {
        try {
          const rows = await all<any>(this.sqliteDb, 'SELECT year, commission_count as commissionCount FROM year_commission_configs');
          this.sendJson(res, 200, rows);
        } catch (err) {
          console.error('[HTTP Server] Error getting year commission configs:', err);
          this.sendJson(res, 500, { success: false, error: 'Error al obtener configuración de comisiones por año.' });
        }
        return;
      }

      // PUT /api/subjects/years-config
      if (pathname === '/api/subjects/years-config' && req.method === 'PUT') {
        try {
          const { year, commissionCount } = await this.getBodyJson(req);
          if (year === undefined || commissionCount === undefined) {
            this.sendJson(res, 400, { success: false, error: 'Parámetros inválidos.' });
            return;
          }
          const targetCount = Math.min(Math.max(Number(commissionCount), 1), 4);
          
          // Update global year config
          await run(
            this.sqliteDb,
            'INSERT INTO year_commission_configs (year, commission_count) VALUES (?, ?) ON CONFLICT(year) DO UPDATE SET commission_count = excluded.commission_count',
            [Number(year), targetCount]
          );

          // Sincronizar todos los grupos que tengan este año de cursada
          const groups = await all<any>(
            this.sqliteDb,
            'SELECT id, group_id FROM group_context WHERE year = ?',
            [Number(year)]
          );

          for (const context of groups) {
            const existingComms = await all<any>(
              this.sqliteDb,
              'SELECT c.id, c.name FROM commissions c JOIN group_context_commissions gcc ON c.id = gcc.commission_id WHERE gcc.group_context_id = ?',
              [context.id]
            );
            const currentCount = existingComms.length;

            if (targetCount > currentCount) {
              // Add missing commissions
              const commLabels = ['A', 'B', 'C', 'D'];
              const groupRow = await get<any>(
                this.sqliteDb,
                'SELECT entry_year FROM whatsapp_groups WHERE group_id = ? LIMIT 1',
                [context.group_id]
              );
              const cohortYear = groupRow?.entry_year || new Date().getFullYear();

              for (let i = currentCount; i < targetCount; i++) {
                const commName = `Comisión ${commLabels[i] || (i + 1)}`;
                const result = await run(
                  this.sqliteDb,
                  'INSERT INTO commissions (name, year, shift) VALUES (?, ?, ?)',
                  [commName, cohortYear, 'General']
                );
                await run(
                  this.sqliteDb,
                  'INSERT OR IGNORE INTO group_context_commissions (group_context_id, commission_id) VALUES (?, ?)',
                  [context.id, result.lastID]
                );
              }
            } else if (targetCount < currentCount) {
              // Remove excess commissions (from the end)
              const toRemove = existingComms.slice(targetCount);
              for (const comm of toRemove) {
                await run(this.sqliteDb, 'DELETE FROM group_context_commissions WHERE group_context_id = ? AND commission_id = ?', [context.id, comm.id]);
              }
            }
          }

          this.sendJson(res, 200, { success: true });
        } catch (err) {
          console.error('[HTTP Server] Error updating year commission configs:', err);
          this.sendJson(res, 500, { success: false, error: 'Error al actualizar configuración de comisiones por año.' });
        }
        return;
      }

      // GET subjects by group /api/groups/:id/subjects
      if (pathname.startsWith('/api/groups/') && pathname.endsWith('/subjects') && req.method === 'GET') {
        const parts = pathname.split('/');
        const groupId = parts[3]; // /api/groups/:id/subjects

        const context = await this.groupContextRepository.getByGroupId(groupId);
        const year = context?.year || 1;

        const groupRow = await get<any>(
          this.sqliteDb,
          'SELECT entry_year FROM whatsapp_groups WHERE group_id = ? LIMIT 1',
          [groupId]
        );
        const cohortYear = groupRow?.entry_year || (new Date().getFullYear() - year + 1);

        const rows = await all<any>(this.sqliteDb, 'SELECT * FROM academic_subjects WHERE year = ?', [year]);
        const teacherRows = await all<any>(
          this.sqliteDb,
          'SELECT LOWER(email) as email, subject FROM managed_teachers WHERE group_id = ?',
          [groupId]
        );
        const mappedSubjects = rows.map((r) => {
          const subjectTeachers = teacherRows.filter(t => normalizeSubjectName(t.subject) === normalizeSubjectName(r.name));
          return {
            id: String(r.id),
            name: String(r.name),
            code: String(r.id),
            cohortId: `camada:${cohortYear}`,
            groupId,
            professorIds: subjectTeachers.map(t => t.email),
            weeklySchedule: [],
            isAnnual: false
          };
        });

        this.sendJson(res, 200, mappedSubjects);
        return;
      }

      // GET commissions by group /api/groups/:id/commissions
      if (pathname.startsWith('/api/groups/') && pathname.endsWith('/commissions') && req.method === 'GET') {
        const parts = pathname.split('/');
        const groupId = parts[3];

        const context = await this.groupContextRepository.getByGroupId(groupId);
        const year = context?.year || 1;
        const groupRow = await get<any>(
          this.sqliteDb,
          'SELECT entry_year FROM whatsapp_groups WHERE group_id = ? LIMIT 1',
          [groupId]
        );
        const cohortYear = groupRow?.entry_year || (new Date().getFullYear() - year + 1);

        let rows = [];
        if (context) {
          rows = await all<any>(
            this.sqliteDb,
            `SELECT c.id, c.name, c.year, c.shift
             FROM commissions c
             JOIN group_context_commissions gcc ON c.id = gcc.commission_id
             WHERE gcc.group_context_id = ?
             ORDER BY c.name ASC`,
            [context.id]
          );
        }

        if (rows.length === 0) {
          rows = await all<any>(
            this.sqliteDb,
            'SELECT id, name, year, shift FROM commissions WHERE year = ? ORDER BY name ASC',
            [cohortYear]
          );
        }

        if (rows.length === 0) {
          rows = [
            { id: 1, name: 'Comisión A', year: cohortYear, shift: 'Mañana' },
            { id: 2, name: 'Comisión B', year: cohortYear, shift: 'Tarde' }
          ];
        }

        this.sendJson(res, 200, rows.map(r => ({
          id: String(r.id),
          name: r.name,
          year: r.year,
          shift: r.shift
        })));
        return;
      }

      // 6. Classes CRUD
      // GET /api/classes
      if (pathname === '/api/classes' && req.method === 'GET') {
        const groupId = parsedUrl.searchParams.get('groupId') || undefined;
        const classes = await this.managedClassRepository.listAll(groupId);
        const allSubjects = await all<any>(this.sqliteDb, 'SELECT id, name FROM academic_subjects');
        const mapped = [];

        for (const c of classes) {
          const normalizedClassSubject = normalizeSubjectName(c.subject);
          const subRow = allSubjects.find(s => normalizeSubjectName(s.name) === normalizedClassSubject);

          const dayIdx = DAYS_ES.findIndex(d => normalizeString(d) === normalizeString(c.schedule_day));

          // Fetch commission schedules
          const commSchedules = await this.classCommissionScheduleRepository.listByManagedClass(c.id!);
          const commSchedulesWithNames = [];
          
          let primaryCommId: number | null = null;
          if (commSchedules.length > 0) {
            const sortedComms = [];
            for (const cs of commSchedules) {
              const commRow = await get<any>(this.sqliteDb, 'SELECT name FROM commissions WHERE id = ?', [cs.commission_id]);
              sortedComms.push({ cs, name: commRow?.name || '' });
            }
            sortedComms.sort((a, b) => a.name.localeCompare(b.name));
            if (sortedComms.length > 0) {
              primaryCommId = sortedComms[0].cs.commission_id;
            }
          }

          // Fetch primary teacher (for fallback)
          const primaryTeacherRow = primaryCommId ? await get<any>(
            this.sqliteDb,
            'SELECT name, email FROM managed_teachers WHERE subject = ? AND group_id = ? AND commission_id = ? LIMIT 1',
            [c.subject, c.group_id || '', primaryCommId]
          ) : null;
          
          const fallbackTeacherRow = primaryTeacherRow || await get<any>(
            this.sqliteDb,
            'SELECT name, email FROM managed_teachers WHERE subject = ? AND group_id = ? LIMIT 1',
            [c.subject, c.group_id || '']
          );

          for (const cs of commSchedules) {
            const commRow = await get<any>(this.sqliteDb, 'SELECT name FROM commissions WHERE id = ?', [cs.commission_id]);
            
            let commTeacherRow = await get<any>(
              this.sqliteDb,
              'SELECT name, email FROM managed_teachers WHERE subject = ? AND group_id = ? AND commission_id = ? LIMIT 1',
              [c.subject, c.group_id || '', cs.commission_id]
            );

            if (!commTeacherRow || (!commTeacherRow.name && !commTeacherRow.email)) {
              commTeacherRow = fallbackTeacherRow;
            }

            const commMeetLink = cs.meet_link || c.meet_link || '';

            commSchedulesWithNames.push({
              id: cs.id,
              commissionId: String(cs.commission_id),
              commissionName: commRow ? commRow.name : `Comisión ${cs.commission_id}`,
              dayOfWeek: DAYS_ES.findIndex(d => normalizeString(d) === normalizeString(cs.schedule_day)),
              startTime: cs.schedule_time,
              endTime: getEndTime(cs.schedule_time),
              meetLink: commMeetLink,
              teacherName: commTeacherRow ? commTeacherRow.name : '',
              teacherEmail: commTeacherRow ? commTeacherRow.email : '',
            });
          }

          mapped.push({
            id: String(c.id),
            subjectId: subRow ? String(subRow.id) : `sub-${c.subject.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
            subjectName: c.subject,
            dayOfWeek: dayIdx >= 0 ? dayIdx : 1,
            startTime: c.schedule_time,
            endTime: getEndTime(c.schedule_time),
            meetLink: c.meet_link,
            classroom: '',
            commissions: commSchedulesWithNames,
            teacherName: fallbackTeacherRow ? fallbackTeacherRow.name : '',
            teacherEmail: fallbackTeacherRow ? fallbackTeacherRow.email : '',
          });
        }
        this.sendJson(res, 200, mapped);
        return;
      }

      // POST /api/classes
      if (pathname === '/api/classes' && req.method === 'POST') {
        const { subjectId, dayOfWeek, startTime, meetLink, classroom, groupId, commissionIds, teacherEmail, teacherName, commissionOverrides } = await this.getBodyJson(req);

        // Fetch subject name from db
        const subRow = await get<any>(
          this.sqliteDb,
          'SELECT name FROM academic_subjects WHERE id = ? LIMIT 1',
          [subjectId]
        );
        const subjectName = subRow ? subRow.name : subjectId;

        const dayName = DAYS_ES[dayOfWeek] || 'Lunes';

        const newId = await this.managedClassRepository.create({
          subject: subjectName,
          schedule_day: dayName,
          schedule_time: startTime,
          meet_link: meetLink || '',
          notifications_enabled: true,
          commission_count: 1,
          group_id: groupId || null
        });

        // Insert commission schedules
        if (Array.isArray(commissionIds) && commissionIds.length > 0) {
          for (const commId of commissionIds) {
            const override = commissionOverrides?.[commId];
            const finalDay = override?.dayOfWeek !== undefined ? DAYS_ES[override.dayOfWeek] : dayName;
            const finalTime = override?.startTime || startTime;
            const finalMeetLink = override?.meetLink !== undefined ? override.meetLink : (meetLink || '');

            await this.classCommissionScheduleRepository.create({
              managed_class_id: newId,
              commission_id: parseInt(commId, 10),
              schedule_day: finalDay,
              schedule_time: finalTime,
              meet_link: finalMeetLink
            });
          }
        }

        // Manage teacher mapping
        if (teacherEmail || commissionOverrides) {
          const finalCommIds = Array.isArray(commissionIds) && commissionIds.length > 0 ? commissionIds : [null];
          for (const commId of finalCommIds) {
            const parsedCommId = commId ? parseInt(commId, 10) : null;
            const override = commId ? commissionOverrides?.[commId] : null;

            const finalEmail = (override?.teacherEmail || teacherEmail || '').trim().toLowerCase();
            const finalName = (override?.teacherName || teacherName || 'Docente').trim();

            if (finalEmail) {
              await run(
                this.sqliteDb,
                'DELETE FROM managed_teachers WHERE subject = ? AND group_id = ? AND (commission_id = ? OR (commission_id IS NULL AND ? IS NULL))',
                [subjectName, groupId || '', parsedCommId, parsedCommId]
              );
              await run(
                this.sqliteDb,
                'INSERT INTO managed_teachers (name, email, subject, group_id, commission_id) VALUES (?, ?, ?, ?, ?)',
                [finalName, finalEmail, subjectName, groupId || null, parsedCommId]
              );
            }
          }
        }

        this.sendJson(res, 201, {
          success: true,
          data: {
            id: String(newId),
            subjectId,
            subjectName,
            dayOfWeek,
            startTime,
            endTime: getEndTime(startTime),
            meetLink,
            classroom,
          }
        });
        return;
      }

      // PUT /api/classes/:subjectId/:slotId
      if (pathname.startsWith('/api/classes/') && req.method === 'PUT') {
        const parts = pathname.split('/');
        const slotId = parseInt(parts[4], 10);
        const { meetLink, startTime, dayOfWeek, commissionIds, teacherEmail, teacherName, commissionOverrides } = await this.getBodyJson(req);

        if (!isNaN(slotId)) {
          if (meetLink !== undefined) {
            await this.managedClassRepository.updateMeetLink(slotId, meetLink);
          }
          if (startTime !== undefined && dayOfWeek !== undefined) {
            const dayName = DAYS_ES[dayOfWeek] || 'Lunes';
            await this.managedClassRepository.updateSchedule(slotId, dayName, startTime);
          }

          // Sync commission schedules
          if (commissionIds !== undefined) {
            await run(this.sqliteDb, 'DELETE FROM class_commission_schedule WHERE managed_class_id = ?', [slotId]);
            if (Array.isArray(commissionIds) && commissionIds.length > 0) {
              const managedClass = await this.managedClassRepository.getById(slotId);
              const defaultDayName = managedClass ? managedClass.schedule_day : (dayOfWeek !== undefined ? DAYS_ES[dayOfWeek] : 'Lunes');
              const defaultStartTime = managedClass ? managedClass.schedule_time : (startTime !== undefined ? startTime : '09:00');
              const defaultMeetLink = meetLink !== undefined ? meetLink : (managedClass ? managedClass.meet_link : '');

              for (const commId of commissionIds) {
                const override = commissionOverrides?.[commId];
                const finalDay = override?.dayOfWeek !== undefined ? DAYS_ES[override.dayOfWeek] : defaultDayName;
                const finalTime = override?.startTime || defaultStartTime;
                const finalMeetLink = override?.meetLink !== undefined ? override.meetLink : (defaultMeetLink || '');

                await this.classCommissionScheduleRepository.create({
                  managed_class_id: slotId,
                  commission_id: parseInt(commId, 10),
                  schedule_day: finalDay,
                  schedule_time: finalTime,
                  meet_link: finalMeetLink
                });
              }
            }
          }

          // Sync teacher mapping
          const managedClass = await this.managedClassRepository.getById(slotId);
          if (managedClass && (teacherEmail !== undefined || commissionOverrides !== undefined)) {
            const subjectName = managedClass.subject;
            const groupId = managedClass.group_id;
            await run(this.sqliteDb, 'DELETE FROM managed_teachers WHERE subject = ? AND group_id = ?', [subjectName, groupId || '']);

            const finalCommIds = Array.isArray(commissionIds) && commissionIds.length > 0 ? commissionIds : [null];
            for (const commId of finalCommIds) {
              const parsedCommId = commId ? parseInt(commId, 10) : null;
              const override = commId ? commissionOverrides?.[commId] : null;

              const finalEmail = (override?.teacherEmail || teacherEmail || '').trim().toLowerCase();
              const finalName = (override?.teacherName || teacherName || 'Docente').trim();

              if (finalEmail) {
                await run(
                  this.sqliteDb,
                  'INSERT INTO managed_teachers (name, email, subject, group_id, commission_id) VALUES (?, ?, ?, ?, ?)',
                  [finalName, finalEmail, subjectName, groupId || null, parsedCommId]
                );
              }
            }
          }

          this.sendJson(res, 200, { success: true });
        } else {
          this.sendJson(res, 400, { success: false, error: 'ID de horario inválido.' });
        }
        return;
      }

      // DELETE /api/classes/:subjectId/:slotId
      if (pathname.startsWith('/api/classes/') && req.method === 'DELETE') {
        const parts = pathname.split('/');
        const slotId = parseInt(parts[4], 10);

        if (!isNaN(slotId)) {
          await this.managedClassRepository.delete(slotId);
          this.sendJson(res, 200, { success: true });
        } else {
          this.sendJson(res, 400, { success: false, error: 'ID de horario inválido.' });
        }
        return;
      }

      // 7. Exams CRUD
      // GET /api/exams
      if (pathname === '/api/exams' && req.method === 'GET') {
        const groupId = parsedUrl.searchParams.get('groupId') || undefined;
        const examsList = await this.managedExamRepository.listWithIds(50, groupId);
        
        const mapped = [];
        for (const e of examsList) {
          const subRow = await get<any>(
            this.sqliteDb,
            'SELECT id FROM academic_subjects WHERE LOWER(name) = LOWER(?) LIMIT 1',
            [e.exam.subject]
          );

          const timings = (e.exam.frecuenciaAvisos || '7d,3d').split(',').map(s => s.trim()).filter(Boolean);

          mapped.push({
            id: String(e.id),
            subjectId: subRow ? String(subRow.id) : `sub-${e.exam.subject.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
            groupId: e.exam.group_id || '',
            type: e.exam.exam_type || 'evidence',
            title: e.exam.observations || 'Evaluación',
            startDate: new Date(e.exam.exam_date).toISOString(),
            endDate: e.exam.exam_date_end ? new Date(e.exam.exam_date_end).toISOString() : undefined,
            evidenceNumber: 1,
            alerts: {
              timings,
              notifyAtRangeStart: Number(e.exam.aviso_inicio_only) === 1,
              notifyBeforeDeadline: Number(e.exam.aviso_fin_pre_deadline) === 1,
            },
            createdBy: e.exam.created_by,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            commissionId: e.exam.exam_commission_id ? String(e.exam.exam_commission_id) : undefined,
          });
        }

        this.sendJson(res, 200, mapped);
        return;
      }

      // POST /api/exams
      if (pathname === '/api/exams' && req.method === 'POST') {
        const body = await this.getBodyJson(req);
        const { subjectId, type, title, startDate, endDate, alerts, groupId, createdBy, commissionId } = body;

        const subRow = await get<any>(
          this.sqliteDb,
          'SELECT name FROM academic_subjects WHERE id = ? LIMIT 1',
          [subjectId]
        );
        const subjectName = subRow ? subRow.name : subjectId;

        const timingsStr = alerts?.timings ? alerts.timings.join(',') : '7d,3d';

        const newId = await this.managedExamRepository.create({
          subject: subjectName,
          exam_date: new Date(startDate),
          exam_time: '18:00',
          exam_type: type,
          observations: title,
          created_by: createdBy || authUser?.email || 'admin',
          tipoDisponibilidad: endDate ? 'franja' : 'hora-especifica',
          frecuenciaAvisos: timingsStr,
          group_id: groupId || null,
          exam_date_end: endDate ? new Date(endDate) : undefined,
          aviso_inicio_only: alerts?.notifyAtRangeStart ? 1 : 0,
          aviso_fin_pre_deadline: alerts?.notifyBeforeDeadline ? 1 : 0,
          created_by_name: authUser?.name || 'Admin',
          created_by_role: authUser?.role || 'super_admin',
          exam_commission_id: commissionId ? Number(commissionId) : undefined
        });

        this.sendJson(res, 201, { success: true, id: String(newId) });
        return;
      }

      // PUT /api/exams/:id
      if (pathname.startsWith('/api/exams/') && req.method === 'PUT') {
        const id = parseInt(pathname.substring('/api/exams/'.length), 10);
        const { title, type, startDate, endDate, alerts, commissionId } = await this.getBodyJson(req);

        const updates: any = {};
        if (title !== undefined) updates.observations = title;
        if (type !== undefined) updates.exam_type = type;
        if (startDate !== undefined) updates.exam_date = new Date(startDate);
        if (endDate !== undefined) updates.exam_date_end = endDate ? new Date(endDate) : null;
        if (alerts?.timings !== undefined) updates.frecuenciaAvisos = alerts.timings.join(',');
        if (alerts?.notifyAtRangeStart !== undefined) updates.aviso_inicio_only = alerts.notifyAtRangeStart ? 1 : 0;
        if (alerts?.notifyBeforeDeadline !== undefined) updates.aviso_fin_pre_deadline = alerts.notifyBeforeDeadline ? 1 : 0;
        if (commissionId !== undefined) updates.exam_commission_id = commissionId ? Number(commissionId) : null;

        await this.managedExamRepository.update(id, updates);
        this.sendJson(res, 200, { success: true });
        return;
      }

      // DELETE /api/exams/:id
      if (pathname.startsWith('/api/exams/') && req.method === 'DELETE') {
        const id = parseInt(pathname.substring('/api/exams/'.length), 10);
        await this.managedExamRepository.deleteById(id);
        this.sendJson(res, 200, { success: true });
        return;
      }

      // 8. Notices CRUD
      // GET /api/notices
      if (pathname === '/api/notices' && req.method === 'GET') {
        const noticesList = await this.institutionalNoticeRepository.listWithIds(50);
        const mapped = await Promise.all(noticesList.map(async (n) => {
          let repliesCount = 0;
          let unreadRepliesCount = 0;
          try {
            const counts = await get<any>(
              this.sqliteDb,
              `SELECT COUNT(*) as total, SUM(CASE WHEN read_by_professor = 0 AND is_from_student = 1 THEN 1 ELSE 0 END) as unread
               FROM notice_replies WHERE notice_id = ?`,
              [n.id]
            );
            repliesCount = counts?.total || 0;
            unreadRepliesCount = counts?.unread || 0;
          } catch (e) {
            console.error('[HTTP Server] Error al contar replicas:', e);
          }

          let targetName = n.notice.grupo_selector || 'todos';
          if (targetName === 'todos') {
            targetName = 'Todos los grupos';
          } else if (targetName === 'general') {
            targetName = 'Grupos generales';
          } else if (targetName.startsWith('camada:')) {
            targetName = `Camada ${targetName.split(':')[1]}`;
          } else {
            try {
              const matched = await get<any>(
                this.sqliteDb,
                'SELECT display_name FROM whatsapp_groups WHERE group_id = ? LIMIT 1',
                [targetName]
              );
              if (matched?.display_name) {
                targetName = matched.display_name;
              }
            } catch (e) {
              console.error('[HTTP Server] Error al resolver targetName para web:', e);
            }
          }

          let authorName = n.notice.source_email || 'Sistema';
          if (n.notice.source_email) {
            const emailLower = n.notice.source_email.toLowerCase().trim();
            try {
              const profile = await get<any>(
                this.sqliteDb,
                'SELECT name FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
                [emailLower]
              );
              if (profile?.name) {
                authorName = profile.name;
              } else {
                const teacher = await get<any>(
                  this.sqliteDb,
                  'SELECT name FROM managed_teachers WHERE LOWER(email) = ? LIMIT 1',
                  [emailLower]
                );
                if (teacher?.name) {
                  authorName = teacher.name;
                }
              }
            } catch (e) {
              console.error('[HTTP Server] Error al resolver authorName para web:', e);
            }
          }

          return {
            id: String(n.id),
            groupId: n.notice.grupo_selector || 'todos',
            title: n.notice.title,
            body: n.notice.body,
            targetType: (n.notice.grupo_selector === 'todos' || n.notice.grupo_selector === 'general') ? 'all_groups' : 'single_group',
            targetId: n.notice.grupo_selector || 'todos',
            targetName,
            createdAt: n.notice.confirmed_at ? n.notice.confirmed_at.toISOString() : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            authorId: n.notice.source_email || 'API',
            authorName,
            active: !!n.notice.published_at,
            startDate: n.notice.start_date ? n.notice.start_date.toISOString() : undefined,
            endDate: n.notice.end_date ? n.notice.end_date.toISOString() : undefined,
            frecuencia: n.notice.frecuencia || 'unica',
            repliesCount,
            unreadRepliesCount,
          };
        }));

        this.sendJson(res, 200, mapped);
        return;
      }

      // POST /api/notices
      if (pathname === '/api/notices' && req.method === 'POST') {
        const { title, body, targetId, startDate, endDate, frecuencia } = await this.getBodyJson(req);

        const start = startDate ? new Date(startDate) : undefined;
        const end = endDate ? new Date(endDate) : undefined;

        const uniqueInput = [title, authUser.email, start?.toISOString() || '', body].join('|');
        const uniqueHash = crypto.createHash('sha256').update(uniqueInput).digest('hex');

        const success = await this.institutionalNoticeRepository.createIfNew({
          title,
          body,
          start_date: start,
          end_date: end,
          event_time: '18:00',
          source_email: authUser.email,
          unique_hash: uniqueHash,
          frecuencia: frecuencia || 'unica',
          grupo_selector: targetId || 'todos',
        });

        if (success) {
          const row = await this.institutionalNoticeRepository.getByUniqueHashWithId(uniqueHash);
          if (row) {
            // Mark confirmed & published
            await this.institutionalNoticeRepository.markConfirmed(row.id);
            await this.institutionalNoticeRepository.markPublished(row.id);

            // Resolve sender friendly name and role label
            let displayName = row.notice.source_email || 'Sistema';
            let senderLabel = 'profe'; // Default role label if not matched
            if (row.notice.source_email) {
              const emailLower = row.notice.source_email.toLowerCase().trim();
              const superadminEmailsEnv = process.env.SUPERADMIN_EMAILS || '';
              const superadmins = superadminEmailsEnv
                .split(',')
                .map((email) => email.trim().toLowerCase())
                .filter(Boolean);

              try {
                if (superadmins.includes(emailLower)) {
                  senderLabel = 'super-admin';
                  const profile = await get<any>(
                    this.sqliteDb,
                    'SELECT name FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
                    [emailLower]
                  );
                  if (profile?.name) {
                    displayName = profile.name;
                  }
                } else {
                  const profile = await get<any>(
                    this.sqliteDb,
                    'SELECT name FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
                    [emailLower]
                  );
                  if (profile) {
                    senderLabel = 'admin';
                    if (profile.name) {
                      displayName = profile.name;
                    }
                  } else {
                    const teacher = await get<any>(
                      this.sqliteDb,
                      'SELECT name FROM managed_teachers WHERE LOWER(email) = ? LIMIT 1',
                      [emailLower]
                    );
                    if (teacher) {
                      senderLabel = 'profe';
                      if (teacher.name) {
                        displayName = teacher.name;
                      }
                    } else {
                      const authorizedRow = await get<any>(
                        this.sqliteDb,
                        'SELECT description FROM authorized_emails WHERE LOWER(email) = ? LIMIT 1',
                        [emailLower]
                      );
                      if (authorizedRow) {
                        senderLabel = 'colaborador';
                        if (authorizedRow.description) {
                          displayName = authorizedRow.description;
                        }
                      }
                    }
                  }
                }
              } catch (e) {
                console.error('[HTTP Server] Error al resolver remitente:', e);
              }
            }

            const roleMap: Record<string, string> = {
              'super-admin': 'Super Admin',
              'admin': 'Admin',
              'profe': 'Profe',
              'colaborador': 'Colaborador'
            };
            const roleText = roleMap[senderLabel] || senderLabel;

            // Resolve group selector label
            let grupoName = targetId || 'todos';
            if (targetId === 'todos') {
              grupoName = 'todos los grupos de la técnicatura';
            } else if (targetId === 'general') {
              grupoName = 'los grupos generales';
            } else if (targetId && targetId.startsWith('camada:')) {
              grupoName = `la camada ${targetId.split(':')[1]}`;
            } else if (targetId) {
              try {
                const matched = await get<any>(
                  this.sqliteDb,
                  'SELECT display_name FROM whatsapp_groups WHERE group_id = ? LIMIT 1',
                  [targetId]
                );
                if (matched?.display_name) {
                  grupoName = matched.display_name;
                }
              } catch (e) {
                console.error('[HTTP Server] Error al resolver nombre del grupo:', e);
              }
            }

            // Broadcast notice to WhatsApp!
            let headerText = '📢 *AVISO INSTITUCIONAL*';
            if (senderLabel === 'super-admin') {
              headerText = '📢 *AVISO DEL SUPER ADMINISTRADOR*';
            } else if (senderLabel === 'admin') {
              headerText = '📢 *AVISO DEL ADMINISTRADOR*';
            } else if (senderLabel === 'profe') {
              headerText = '📢 *AVISO DE PROFESOR*';
            }

            const formattedMessage = `Hola! Vectorito reporrandose\u{1F63C}\n\n` +
              `${headerText}\n\n` +
              `*De:* ${displayName} (${roleText})\n` +
              `*Para:* ${grupoName}\n` +
              `*ID de mensaje:* ID: ${row.id}\n\n` +
              `*Título:* ${title}\n\n` +
              `*Mensaje:* \n` +
              `${body}\n\n` +
              `💡 *Para responder al profesor, escribí en este grupo:*\n` +
              `!rid${row.id} tu mensaje para responder al profesor`;

            try {
              const groups = await this.groupRepository.getAllActiveGroupsWithEntryYear();
              let resolvedGroupIds: string[] = [];
              const sel = (targetId || 'todos').trim().toLowerCase();

              if (sel === 'todos' || sel === 'all') {
                resolvedGroupIds = groups.map((g) => g.group_id);
              } else if (sel === 'general') {
                resolvedGroupIds = groups.filter((g) => g.entry_year === null).map((g) => g.group_id);
              } else if (sel === 'cursada') {
                resolvedGroupIds = groups.filter((g) => g.entry_year !== null).map((g) => g.group_id);
              } else if (sel.startsWith('camada:')) {
                const year = Number(sel.split(':')[1]);
                resolvedGroupIds = groups.filter((g) => g.entry_year === year).map((g) => g.group_id);
              } else {
                const matched = groups.find((g) => g.group_id.toLowerCase() === sel);
                if (matched) {
                  resolvedGroupIds = [matched.group_id];
                } else {
                  resolvedGroupIds = [targetId];
                }
              }

              for (const gid of resolvedGroupIds) {
                if (gid && (gid.endsWith('@g.us') || gid.endsWith('@s.whatsapp.net') || gid.endsWith('@lid'))) {
                  await this.vectoritoWhatsAppGateway.sendTextMessage(gid, formattedMessage);
                } else {
                  console.warn(`[HTTP Server] Saltando envío a destinatario no JID: "${gid}"`);
                }
              }
            } catch (e) {
              console.error('[HTTP Server] Falló publicación de aviso en WhatsApp:', e);
            }
          }
        }

        this.sendJson(res, 201, { success });
        return;
      }

      // PUT /api/notices/:id
      if (pathname.startsWith('/api/notices/') && req.method === 'PUT') {
        const id = Number(pathname.substring('/api/notices/'.length));
        if (Number.isNaN(id)) {
          this.sendJson(res, 400, { success: false, error: 'ID de aviso inválido.' });
          return;
        }

        const { title, body, active, targetId, startDate, endDate, frecuencia } = await this.getBodyJson(req);

        const existing = await this.institutionalNoticeRepository.getById(id);
        if (!existing) {
          this.sendJson(res, 404, { success: false, error: 'Aviso no encontrado.' });
          return;
        }

        const start = startDate ? new Date(startDate) : (existing.start_date ? new Date(existing.start_date) : null);
        const end = endDate ? new Date(endDate) : (existing.end_date ? new Date(existing.end_date) : null);
        
        let publishedAt: any = existing.published_at;
        if (active !== undefined) {
          publishedAt = active ? new Date() : null;
        }

        await run(
          this.sqliteDb,
          `UPDATE institutional_notices
           SET title = ?, body = ?, start_date = ?, end_date = ?, frecuencia = ?, grupo_selector = ?, published_at = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            title ?? existing.title,
            body ?? existing.body,
            start ? formatLocalDateOnly(start) : null,
            end ? formatLocalDateOnly(end) : null,
            frecuencia ?? existing.frecuencia ?? 'unica',
            targetId ?? existing.grupo_selector ?? 'todos',
            publishedAt ? (publishedAt instanceof Date ? publishedAt.toISOString() : String(publishedAt)) : null,
            id
          ]
        );

        this.sendJson(res, 200, { success: true });
        return;
      }

      // DELETE /api/notices/:id
      if (pathname.startsWith('/api/notices/') && req.method === 'DELETE') {
        const id = Number(pathname.substring('/api/notices/'.length));
        if (Number.isNaN(id)) {
          this.sendJson(res, 400, { success: false, error: 'ID de aviso inválido.' });
          return;
        }

        await this.institutionalNoticeRepository.deleteById(id);
        this.sendJson(res, 200, { success: true });
        return;
      }

      // GET /api/admins
      if (pathname === '/api/admins' && req.method === 'GET') {
        if (authUser.role !== 'super_admin') {
          this.sendJson(res, 403, { success: false, error: 'Acceso denegado.' });
          return;
        }

        const rows = await all<any>(
          this.sqliteDb,
          `SELECT a.user_id as id, a.is_super_admin as isSuperAdmin, p.name, p.email, ga.group_id as groupId, wg.display_name as groupName
           FROM admin_users a
           LEFT JOIN user_profiles p ON a.user_id = p.user_id
           LEFT JOIN group_admins ga ON a.user_id = ga.user_id
           LEFT JOIN whatsapp_groups wg ON ga.group_id = wg.group_id
           ORDER BY p.name ASC`
        );
        this.sendJson(res, 200, rows.map(r => ({
          id: r.id,
          name: r.name || r.id,
          email: r.email || '',
          isSuperAdmin: !!r.isSuperAdmin,
          groupId: r.groupId || null,
          groupName: r.groupName || null
        })));
        return;
      }

      // GET /api/admins/search-users
      if (pathname === '/api/admins/search-users' && req.method === 'GET') {
        if (authUser.role !== 'super_admin') {
          this.sendJson(res, 403, { success: false, error: 'Acceso denegado.' });
          return;
        }

        const q = parsedUrl.searchParams.get('q') || '';
        const param = `%${q}%`;
        const rows = await all<any>(
          this.sqliteDb,
          `SELECT user_id as id, name, email
           FROM user_profiles
           WHERE name LIKE ? OR email LIKE ? OR user_id LIKE ?
           LIMIT 20`,
          [param, param, param]
        );
        this.sendJson(res, 200, rows);
        return;
      }

      // POST /api/admins
      if (pathname === '/api/admins' && req.method === 'POST') {
        if (authUser.role !== 'super_admin') {
          this.sendJson(res, 403, { success: false, error: 'Acceso denegado.' });
          return;
        }

        const { userId, isSuperAdmin, groupId } = await this.getBodyJson(req);
        if (!userId) {
          this.sendJson(res, 400, { success: false, error: 'userId es requerido.' });
          return;
        }

        await run(
          this.sqliteDb,
          `INSERT INTO admin_users (user_id, is_super_admin, is_authenticated)
           VALUES (?, ?, 1)
           ON CONFLICT(user_id) DO UPDATE SET is_super_admin = excluded.is_super_admin, is_authenticated = 1`,
          [userId, isSuperAdmin ? 1 : 0]
        );

        // Sync group admin mappings
        await run(this.sqliteDb, 'DELETE FROM group_admins WHERE user_id = ?', [userId]);
        if (!isSuperAdmin && groupId) {
          await run(this.sqliteDb, 'INSERT INTO group_admins (user_id, group_id) VALUES (?, ?)', [userId, groupId]);
        }

        this.sendJson(res, 200, { success: true });
        return;
      }

      // DELETE /api/admins/:userId
      if (pathname.startsWith('/api/admins/') && req.method === 'DELETE') {
        if (authUser.role !== 'super_admin') {
          this.sendJson(res, 403, { success: false, error: 'Acceso denegado.' });
          return;
        }

        const userId = decodeURIComponent(pathname.substring('/api/admins/'.length));
        await run(this.sqliteDb, 'DELETE FROM admin_users WHERE user_id = ?', [userId]);
        await run(this.sqliteDb, 'DELETE FROM group_admins WHERE user_id = ?', [userId]);
        this.sendJson(res, 200, { success: true });
        return;
      }

      // GET /api/authorized-emails
      if (pathname === '/api/authorized-emails' && req.method === 'GET') {
        if (authUser.role !== 'super_admin') {
          this.sendJson(res, 403, { success: false, error: 'Acceso denegado.' });
          return;
        }

        const rows = await all<any>(this.sqliteDb, 'SELECT email, description FROM authorized_emails ORDER BY email ASC');
        this.sendJson(res, 200, rows);
        return;
      }

      // POST /api/authorized-emails
      if (pathname === '/api/authorized-emails' && req.method === 'POST') {
        if (authUser.role !== 'super_admin') {
          this.sendJson(res, 403, { success: false, error: 'Acceso denegado.' });
          return;
        }

        const { email, description } = await this.getBodyJson(req);
        if (!email) {
          this.sendJson(res, 400, { success: false, error: 'email es requerido.' });
          return;
        }

        await run(
          this.sqliteDb,
          `INSERT INTO authorized_emails (email, description)
           VALUES (?, ?)
           ON CONFLICT(email) DO UPDATE SET description = excluded.description`,
          [email.toLowerCase().trim(), description ?? '']
        );
        this.sendJson(res, 200, { success: true });
        return;
      }

      // DELETE /api/authorized-emails/:email
      if (pathname.startsWith('/api/authorized-emails/') && req.method === 'DELETE') {
        if (authUser.role !== 'super_admin') {
          this.sendJson(res, 403, { success: false, error: 'Acceso denegado.' });
          return;
        }

        const email = decodeURIComponent(pathname.substring('/api/authorized-emails/'.length)).toLowerCase().trim();
        await run(this.sqliteDb, 'DELETE FROM authorized_emails WHERE LOWER(email) = ?', [email]);
        this.sendJson(res, 200, { success: true });
        return;
      }

      // GET /api/academic-calendar/events
      if (pathname === '/api/academic-calendar/events' && req.method === 'GET') {
        if (authUser.role !== 'super_admin') {
          this.sendJson(res, 403, { success: false, error: 'Acceso denegado.' });
          return;
        }

        const year = Number(parsedUrl.searchParams.get('year')) || new Date().getFullYear();
        const rows = await all<any>(
          this.sqliteDb,
          `SELECT id, event_type, event_name, start_date, end_date, academic_year, confirmed
           FROM academic_calendar_events
           WHERE academic_year = ?
           ORDER BY start_date ASC`,
          [year]
        );
        this.sendJson(res, 200, rows.map(r => ({
          id: r.id,
          eventType: r.event_type,
          eventName: r.event_name,
          startDate: r.start_date,
          endDate: r.end_date,
          academicYear: r.academic_year,
          confirmed: !!r.confirmed
        })));
        return;
      }

      // POST /api/academic-calendar/events
      if (pathname === '/api/academic-calendar/events' && req.method === 'POST') {
        if (authUser.role !== 'super_admin') {
          this.sendJson(res, 403, { success: false, error: 'Acceso denegado.' });
          return;
        }

        const { year, events } = await this.getBodyJson(req);
        if (!year || !Array.isArray(events)) {
          this.sendJson(res, 400, { success: false, error: 'year y events array requeridos.' });
          return;
        }

        // Delete existing ones for this year and insert new ones
        await run(this.sqliteDb, 'DELETE FROM academic_calendar_events WHERE academic_year = ?', [year]);

        for (const ev of events) {
          await run(
            this.sqliteDb,
            `INSERT INTO academic_calendar_events (event_type, event_name, start_date, end_date, academic_year, confirmed)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [ev.eventType || ev.event_type, ev.eventName || ev.event_name, ev.startDate || ev.start_date, ev.endDate || ev.end_date || null, year]
          );
        }

        this.sendJson(res, 200, { success: true });
        return;
      }

      // GET /api/profile/me
      if (pathname === '/api/profile/me' && req.method === 'GET') {
        let groupIds: string[] = [];
        if (authUser.role === 'group_admin') {
          const adminRows = await all<any>(
            this.sqliteDb,
            `SELECT ga.group_id 
             FROM group_admins ga
             LEFT JOIN user_profiles p ON ga.user_id = p.user_id
             WHERE LOWER(p.email) = LOWER(?) OR ga.user_id = ?`,
            [authUser.email, authUser.email]
          );
          groupIds = adminRows.map(r => r.group_id);
        } else if (authUser.role === 'professor') {
          const teacherRows = await all<any>(this.sqliteDb, 'SELECT DISTINCT group_id FROM managed_teachers WHERE LOWER(email) = LOWER(?)', [authUser.email]);
          groupIds = teacherRows.map(r => r.group_id).filter(Boolean);
        }

        this.sendJson(res, 200, {
          id: authUser.email,
          email: authUser.email,
          name: authUser.name,
          role: authUser.role,
          groupIds
        });
        return;
      }

      // GET /api/profile/settings
      if (pathname === '/api/profile/settings' && req.method === 'GET') {
        const profile = await get<any>(
          this.sqliteDb,
          'SELECT name, email FROM user_profiles WHERE LOWER(email) = LOWER(?) LIMIT 1',
          [authUser.email]
        );

        if (!profile) {
          this.sendJson(res, 404, { success: false, error: 'Perfil de usuario no encontrado.' });
          return;
        }

        const result: any = {
          name: profile.name,
          email: profile.email
        };

        if (authUser.role === 'professor') {
          const teacher = await get<any>(
            this.sqliteDb,
            'SELECT phone, notify_email, notify_whatsapp FROM managed_teachers WHERE LOWER(email) = LOWER(?) LIMIT 1',
            [authUser.email]
          );
          if (teacher) {
            result.phone = teacher.phone || '';
            result.notifyEmail = teacher.notify_email !== 0;
            result.notifyWhatsapp = teacher.notify_whatsapp !== 0;
          } else {
            result.phone = '';
            result.notifyEmail = true;
            result.notifyWhatsapp = true;
          }
        }

        this.sendJson(res, 200, result);
        return;
      }

      // PUT /api/profile/settings
      if (pathname === '/api/profile/settings' && req.method === 'PUT') {
        const { name, email, phone, notifyEmail, notifyWhatsapp } = await this.getBodyJson(req);
        if (!name || !email) {
          this.sendJson(res, 400, { success: false, error: 'name y email requeridos.' });
          return;
        }

        const profile = await get<any>(
          this.sqliteDb,
          'SELECT user_id FROM user_profiles WHERE LOWER(email) = LOWER(?) LIMIT 1',
          [authUser.email]
        );

        if (!profile) {
          this.sendJson(res, 404, { success: false, error: 'Perfil de usuario no encontrado.' });
          return;
        }

        await run(
          this.sqliteDb,
          'UPDATE user_profiles SET name = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
          [name, email.toLowerCase().trim(), profile.user_id]
        );

        if (authUser.role === 'professor') {
          const teacher = await get<any>(
            this.sqliteDb,
            'SELECT id FROM managed_teachers WHERE LOWER(email) = LOWER(?) LIMIT 1',
            [authUser.email]
          );

          if (teacher) {
            await run(
              this.sqliteDb,
              `UPDATE managed_teachers 
               SET name = ?, email = ?, notify_email = ?, notify_whatsapp = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
              [
                name,
                email.toLowerCase().trim(),
                notifyEmail ? 1 : 0,
                notifyWhatsapp ? 1 : 0,
                teacher.id
              ]
            );
          } else {
            await run(
              this.sqliteDb,
              `INSERT INTO managed_teachers (name, email, notify_email, notify_whatsapp)
               VALUES (?, ?, ?, ?)`,
              [
                name,
                email.toLowerCase().trim(),
                notifyEmail ? 1 : 0,
                notifyWhatsapp ? 1 : 0
              ]
            );
          }
        }

        this.sendJson(res, 200, { success: true });
        return;
      }

      // GET /api/teachers/my-assignments
      if (pathname === '/api/teachers/my-assignments' && req.method === 'GET') {
        if (authUser.role !== 'professor' && authUser.role !== 'super_admin') {
          this.sendJson(res, 403, { success: false, error: 'Acceso denegado.' });
          return;
        }

        let teacherRows = [];
        if (authUser.role === 'super_admin') {
          const emailParam = parsedUrl.searchParams.get('email');
          const emailToFilter = emailParam ? emailParam.toLowerCase().trim() : authUser.email.toLowerCase().trim();
          teacherRows = await all<any>(
            this.sqliteDb,
            'SELECT id, name, email, subject, group_id, commission_id, commission_label FROM managed_teachers WHERE LOWER(email) = ?',
            [emailToFilter]
          );
        } else {
          teacherRows = await all<any>(
            this.sqliteDb,
            'SELECT id, name, email, subject, group_id, commission_id, commission_label FROM managed_teachers WHERE LOWER(email) = ?',
            [authUser.email.toLowerCase().trim()]
          );
        }

        this.sendJson(res, 200, teacherRows.map(t => ({
          id: String(t.id),
          name: t.name,
          email: t.email,
          subject: t.subject,
          groupId: t.group_id,
          commissionId: t.commission_id ? String(t.commission_id) : null,
          commissionLabel: t.commission_label
        })));
        return;
      }

      // POST /api/profile/send-phone-otp
      if (pathname === '/api/profile/send-phone-otp' && req.method === 'POST') {
        const { phone } = await this.getBodyJson(req);
        if (!phone) {
          this.sendJson(res, 400, { success: false, error: 'Teléfono requerido.' });
          return;
        }

        const phoneCleaned = phone.replace(/\D/g, '');
        if (!phoneCleaned) {
          this.sendJson(res, 400, { success: false, error: 'Número de teléfono inválido.' });
          return;
        }

        const jid = `${phoneCleaned}@s.whatsapp.net`;
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

        await run(
          this.sqliteDb,
          `INSERT INTO phone_otp_sessions (email, phone, code, expires_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(email, phone) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, created_at = CURRENT_TIMESTAMP`,
          [authUser.email.toLowerCase().trim(), jid, code, expiresAt.toISOString()]
        );

        try {
          const otpMessage = `🔑 *Código de Verificación de Teléfono*\n\nHola. Tu código de verificación para vincular este número al Panel de Vectorito es: *${code}*.\n\nIngresalo en el panel web para completar la vinculación.`;
          await this.vectoritoWhatsAppGateway.sendTextMessage(jid, otpMessage);
          this.sendJson(res, 200, { success: true, debugCode: code });
        } catch (e) {
          console.error('[HTTP Server] Falló envío de OTP a WhatsApp:', e);
          this.sendJson(res, 500, { success: false, error: 'No se pudo enviar el mensaje por WhatsApp. Verificá el número de teléfono.' });
        }
        return;
      }

      // POST /api/profile/verify-phone-otp
      if (pathname === '/api/profile/verify-phone-otp' && req.method === 'POST') {
        const { phone, code } = await this.getBodyJson(req);
        if (!phone || !code) {
          this.sendJson(res, 400, { success: false, error: 'Teléfono y código OTP requeridos.' });
          return;
        }

        const phoneCleaned = phone.replace(/\D/g, '');
        const jid = `${phoneCleaned}@s.whatsapp.net`;

        const row = await get<any>(
          this.sqliteDb,
          'SELECT expires_at FROM phone_otp_sessions WHERE LOWER(email) = ? AND phone = ? AND code = ? LIMIT 1',
          [authUser.email.toLowerCase().trim(), jid, code.trim()]
        );

        if (!row) {
          this.sendJson(res, 400, { success: false, error: 'Código de verificación inválido.' });
          return;
        }

        const expiresTime = new Date(row.expires_at).getTime();
        if (Date.now() > expiresTime) {
          await run(this.sqliteDb, 'DELETE FROM phone_otp_sessions WHERE LOWER(email) = ? AND phone = ?', [authUser.email.toLowerCase().trim(), jid]);
          this.sendJson(res, 400, { success: false, error: 'El código de verificación ha expirado.' });
          return;
        }

        // OTP is valid! Clean up
        await run(this.sqliteDb, 'DELETE FROM phone_otp_sessions WHERE LOWER(email) = ? AND phone = ?', [authUser.email.toLowerCase().trim(), jid]);

        // Link in user_profiles: delete any profile with this email that is not this JID
        await run(this.sqliteDb, 'UPDATE user_profiles SET email = "" WHERE LOWER(email) = ? AND user_id != ?', [authUser.email.toLowerCase().trim(), jid]);

        // Upsert user_profile
        await run(
          this.sqliteDb,
          `INSERT INTO user_profiles (user_id, name, birthday_day_month, email, user_commission_id)
           VALUES (?, ?, '01/01', ?, 1)
           ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, name = excluded.name`,
          [jid, authUser.name, authUser.email.toLowerCase().trim()]
        );

        // Update phone in managed_teachers
        await run(
          this.sqliteDb,
          'UPDATE managed_teachers SET phone = ? WHERE LOWER(email) = ?',
          [jid, authUser.email.toLowerCase().trim()]
        );

        this.sendJson(res, 200, { success: true });
        return;
      }

      // GET /api/groups/:id/students
      if (pathname.startsWith('/api/groups/') && pathname.endsWith('/students') && req.method === 'GET') {
        const parts = pathname.split('/');
        const groupId = parts[3];

        const groupRow = await get<any>(
          this.sqliteDb,
          'SELECT entry_year FROM whatsapp_groups WHERE group_id = ? LIMIT 1',
          [groupId]
        );
        const cohortId = groupRow?.entry_year ? `camada:${groupRow.entry_year}` : 'camada:2026';

        const rows = await all<any>(
          this.sqliteDb,
          `SELECT p.user_id as id, p.name, p.email, m.commission_id
           FROM group_memberships m
           JOIN user_profiles p ON m.user_id = p.user_id
           WHERE m.group_id = ? AND m.is_active = 1`,
          [groupId]
        );

        this.sendJson(res, 200, rows.map(r => ({
          id: r.id,
          name: r.name,
          phone: String(r.id).split('@')[0],
          email: r.email,
          cohortId,
          commissionId: r.commission_id ? String(r.commission_id) : undefined
        })));
        return;
      }

      // 9. Onboarding: Complete
      if (pathname === '/api/onboarding/complete' && req.method === 'POST') {
        const { groupId, token } = await this.getBodyJson(req);
        if (!groupId || !token) {
          this.sendJson(res, 400, { success: false, error: 'groupId y token requeridos.' });
          return;
        }

        const validatedGroupId = await this.onboardingTokenRepo.validateToken(token);
        if (validatedGroupId !== groupId) {
          this.sendJson(res, 400, { success: false, error: 'Token inválido o expirado.' });
          return;
        }

        // Upsert pending onboarding as completed
        await run(
          this.sqliteDb,
          `INSERT INTO pending_group_onboarding (group_id, super_admin_id, step, onboarding_completed)
           VALUES (?, ?, 'completed', 1)
           ON CONFLICT(group_id) DO UPDATE SET onboarding_completed = 1, step = 'completed'`,
          [groupId, authUser?.email || 'admin']
        );

        await this.onboardingTokenRepo.deleteToken(token);
        this.sendJson(res, 200, { success: true });
        return;
      }

      // 10. Teachers CRUD
      // GET /api/teachers
      if (pathname === '/api/teachers' && req.method === 'GET') {
        const groupId = parsedUrl.searchParams.get('groupId') || undefined;
        const list = await this.managedTeacherRepository.listAll(groupId);
        const mapped = list.map((t: any) => ({
          id: String(t.id),
          name: t.name,
          email: t.email,
          subject: t.subject || '',
          groupId: t.group_id || '',
        }));
        this.sendJson(res, 200, mapped);
        return;
      }

      // POST /api/teachers
      if (pathname === '/api/teachers' && req.method === 'POST') {
        const { name, email, subject, groupId, commissionId } = await this.getBodyJson(req);
        const newId = await this.managedTeacherRepository.create({
          name,
          email,
          subject,
          group_id: groupId || undefined,
          commission_id: commissionId ? Number(commissionId) : undefined,
        });
        this.sendJson(res, 201, { success: true, id: String(newId) });
        return;
      }

      // DELETE /api/teachers/:id
      if (pathname.startsWith('/api/teachers/') && req.method === 'DELETE') {
        const id = parseInt(pathname.substring('/api/teachers/'.length), 10);
        await this.managedTeacherRepository.delete(id);
        this.sendJson(res, 200, { success: true });
        return;
      }

      // 11. Moderation CRUD
      // GET /api/moderation/users
      if (pathname === '/api/moderation/users' && req.method === 'GET') {
        const groupId = parsedUrl.searchParams.get('groupId') || '';
        const banned = this.banWarningSystem.getBannedUsers();
        const mapped = await Promise.all(banned.map(async (u) => {
          let studentName = u.username;
          try {
            const profile = await get<any>(
              this.sqliteDb,
              'SELECT name FROM user_profiles WHERE user_id = ? LIMIT 1',
              [u.userId]
            );
            if (profile?.name) {
              studentName = profile.name;
            }
          } catch {}
          return {
            id: u.userId,
            phone: u.userId.split('@')[0],
            jid: u.userId,
            studentName,
            reason: u.reason,
            groupId,
            bannedAt: u.banDate ? new Date(u.banDate).toISOString() : new Date().toISOString(),
            bannedBy: 'system',
            bannedByName: 'Vectorito Guardrail'
          };
        }));
        this.sendJson(res, 200, mapped);
        return;
      }

      // POST /api/moderation/ban
      if (pathname === '/api/moderation/ban' && req.method === 'POST') {
        const { phone, reason } = await this.getBodyJson(req);
        if (!phone) {
          this.sendJson(res, 400, { success: false, error: 'Teléfono requerido.' });
          return;
        }
        const userJid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
        const username = phone.split('@')[0];
        this.banWarningSystem.adminBan(userJid, username, reason || 'Baneo por admin web');
        this.sendJson(res, 200, { success: true });
        return;
      }

      // POST /api/moderation/unban
      if (pathname === '/api/moderation/unban' && req.method === 'POST') {
        const { phone, userJid } = await this.getBodyJson(req);
        const jid = userJid || (phone ? (phone.includes('@') ? phone : `${phone}@s.whatsapp.net`) : null);
        if (!jid) {
          this.sendJson(res, 400, { success: false, error: 'Teléfono o JID requerido.' });
          return;
        }
        this.banWarningSystem.unbanUser(jid, authUser.email);
        this.sendJson(res, 200, { success: true });
        return;
      }

      // 12. Impersonation CRUD
      // GET /api/impersonation
      if (pathname === '/api/impersonation' && req.method === 'GET') {
        let adminJid = '';
        try {
          const profile = await get<any>(
            this.sqliteDb,
            'SELECT user_id FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
            [authUser.email.toLowerCase()]
          );
          if (profile && profile.user_id) {
            adminJid = profile.user_id;
          }
        } catch {}

        if (!adminJid) {
          this.sendJson(res, 200, { active: false });
          return;
        }

        const imp = PrivateChatWorkflowService.getImpersonation(adminJid);
        
        let commissionName = '';
        if (imp.commissionId) {
          try {
            const comm = await get<any>(
              this.sqliteDb,
              'SELECT name FROM commissions WHERE id = ? LIMIT 1',
              [imp.commissionId]
            );
            if (comm) {
              commissionName = comm.name;
            }
          } catch {}
        }

        let queriesUsed = 0;
        try {
          const limitRow = await get<any>(
            this.sqliteDb,
            'SELECT question_count FROM rate_limit WHERE user_id = ? LIMIT 1',
            [adminJid]
          );
          if (limitRow) {
            queriesUsed = Number(limitRow.question_count);
          }
        } catch {}

        this.sendJson(res, 200, {
          active: imp.isActive,
          studentName: authUser.name || 'Admin',
          studentPhone: adminJid.split('@')[0],
          cohortId: 'camada:2026',
          cohortName: 'Cohorte 2026',
          commissionId: imp.commissionId ? String(imp.commissionId) : undefined,
          commissionName: commissionName || undefined,
          dailyQueryLimit: imp.maxQuestions || 50,
          queriesUsed,
          subjectIds: []
        });
        return;
      }

      // POST /api/impersonation
      if (pathname === '/api/impersonation' && req.method === 'POST') {
        const body = await this.getBodyJson(req);
        const { active, commissionId, dailyQueryLimit } = body;

        let adminJid = '';
        try {
          const profile = await get<any>(
            this.sqliteDb,
            'SELECT user_id FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
            [authUser.email.toLowerCase()]
          );
          if (profile && profile.user_id) {
            adminJid = profile.user_id;
          }
        } catch {}

        if (!adminJid) {
          this.sendJson(res, 400, { success: false, error: 'No se encontró el JID de WhatsApp asociado a tu email.' });
          return;
        }

        const imp = PrivateChatWorkflowService.getImpersonation(adminJid);
        imp.isActive = !!active;
        if (commissionId !== undefined) {
          imp.commissionId = commissionId ? Number(commissionId) : null;
        }
        if (dailyQueryLimit !== undefined) {
          imp.maxQuestions = dailyQueryLimit ? Number(dailyQueryLimit) : null;
        }

        this.sendJson(res, 200, { success: true });
        return;
      }

      // POST /api/impersonation/reset-quota
      if (pathname === '/api/impersonation/reset-quota' && req.method === 'POST') {
        let adminJid = '';
        try {
          const profile = await get<any>(
            this.sqliteDb,
            'SELECT user_id FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
            [authUser.email.toLowerCase()]
          );
          if (profile && profile.user_id) {
            adminJid = profile.user_id;
          }
        } catch {}

        if (adminJid) {
          await run(this.sqliteDb, 'UPDATE rate_limit SET question_count = 0 WHERE user_id = ?', [adminJid]);
        }
        this.sendJson(res, 200, { success: true });
        return;
      }

      // 13. Teacher Messages & Replies CRUD
      // GET /api/messages
      if (pathname === '/api/messages' && req.method === 'GET') {
        const groupId = parsedUrl.searchParams.get('groupId') || '';
        const context = await this.groupContextRepository.getByGroupId(groupId);
        const groupRow = await get<any>(
          this.sqliteDb,
          'SELECT entry_year FROM whatsapp_groups WHERE group_id = ? LIMIT 1',
          [groupId]
        );
        const cohortYear = groupRow?.entry_year || (context?.year ? (new Date().getFullYear() - context.year + 1) : null);
        const cohortId = cohortYear ? `camada:${cohortYear}` : null;

        let query = 'SELECT * FROM teacher_messages WHERE target_id = ? OR target_id = ""';
        const params = [groupId];
        if (cohortId) {
          query += ' OR target_id = ?';
          params.push(cohortId);
        }
        query += ' ORDER BY timestamp DESC';

        const rows = await all<any>(this.sqliteDb, query, params);
        const mapped = await Promise.all(rows.map(async (r) => {
          let repliesCount = 0;
          let unreadRepliesCount = 0;
          try {
            const counts = await get<any>(
              this.sqliteDb,
              `SELECT COUNT(*) as total, SUM(CASE WHEN read_by_professor = 0 AND is_from_student = 1 THEN 1 ELSE 0 END) as unread
               FROM teacher_message_replies WHERE teacher_message_id = ?`,
              [r.id]
            );
            repliesCount = counts?.total || 0;
            unreadRepliesCount = counts?.unread || 0;
          } catch (e) {
            console.error('[HTTP Server] Error al contar replicas de mensaje:', e);
          }
          return {
            id: String(r.id),
            authorId: r.author_id,
            authorName: r.author_name,
            content: r.content,
            timestamp: r.timestamp,
            isFromStudent: false,
            targetType: r.target_type,
            targetId: r.target_id,
            targetName: r.target_name,
            repliesCount,
            unreadRepliesCount,
          };
        }));
        this.sendJson(res, 200, mapped);
        return;
      }

      // GET /api/messages/unread-count
      if (pathname === '/api/messages/unread-count' && req.method === 'GET') {
        const rowTeacher = await get<any>(
          this.sqliteDb,
          `SELECT COUNT(*) as count FROM teacher_message_replies tmr
           JOIN teacher_messages tm ON tmr.teacher_message_id = tm.id
           WHERE tmr.read_by_professor = 0 AND tmr.is_from_student = 1`
        );
        const rowNotice = await get<any>(
          this.sqliteDb,
          `SELECT COUNT(*) as count FROM notice_replies nr
           JOIN institutional_notices n ON nr.notice_id = n.id
           WHERE nr.read_by_professor = 0 AND nr.is_from_student = 1`
        );
        const count = Number(rowTeacher?.count ?? 0) + Number(rowNotice?.count ?? 0);
        this.sendJson(res, 200, { count });
        return;
      }

      // POST /api/messages
      if (pathname === '/api/messages' && req.method === 'POST') {
        const { content, targetId, targetType, targetName } = await this.getBodyJson(req);

        let authorName = authUser.name || 'Profesor';
        let authorId = authUser.email;

        // Insert message
        const result = await run(
          this.sqliteDb,
          `INSERT INTO teacher_messages (author_id, author_name, content, target_type, target_id, target_name)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [authorId, authorName, content, targetType, targetId, targetName]
        );
        const insertedId = result.lastID;

        // Broadcast to groups of cohort
        const formattedMsg = `🔔 *Mensaje del Profesor ${authorName}* 👨‍🏫\n\n` +
          `${content}\n\n` +
          `💡 *Para responder al profesor, escribí en este grupo:*\n` +
          `!rid${insertedId} tu mensaje para responder al profesor`;

        try {
          if (targetType === 'cohort') {
            // Find groups by entry year
            const yearStr = targetId.replace('camada:', '');
            const year = parseInt(yearStr, 10);
            if (!isNaN(year)) {
              const activeGroupIds = await this.groupRepository.getAllActiveIds();
              for (const gid of activeGroupIds) {
                // Check entry year of group
                const groupObj = await this.groupRepository.findByGroupId(gid);
                if (groupObj && groupObj.entry_year === year) {
                  await this.vectoritoWhatsAppGateway.sendTextMessage(gid, formattedMsg);
                }
              }
            }
          } else if (targetId) {
            await this.vectoritoWhatsAppGateway.sendTextMessage(targetId, formattedMsg);
          }
        } catch (e) {
          console.error('[HTTP Server] Falló difusión de mensaje de profesor:', e);
        }

        this.sendJson(res, 201, {
          success: true,
          data: {
            id: String(insertedId),
            timestamp: new Date().toISOString()
          }
        });
        return;
      }

      // DELETE /api/messages/:id
      if (pathname.startsWith('/api/messages/') && req.method === 'DELETE' && !pathname.endsWith('/replies') && !pathname.endsWith('/reply')) {
        const id = parseInt(pathname.substring('/api/messages/'.length), 10);
        await run(this.sqliteDb, 'DELETE FROM teacher_messages WHERE id = ?', [id]);
        this.sendJson(res, 200, { success: true });
        return;
      }

      // GET /api/messages/:id/replies
      if (pathname.startsWith('/api/messages/') && pathname.endsWith('/replies') && req.method === 'GET') {
        const parts = pathname.split('/');
        const messageId = parseInt(parts[3], 10);

        const rows = await all<any>(
          this.sqliteDb,
          'SELECT * FROM teacher_message_replies WHERE teacher_message_id = ? ORDER BY timestamp ASC',
          [messageId]
        );
        const mapped = rows.map((r) => ({
          id: String(r.id),
          authorId: r.author_id,
          authorName: r.author_name,
          authorPhone: r.author_phone,
          content: r.content,
          timestamp: r.timestamp,
          isFromStudent: Number(r.is_from_student) === 1,
          parentMessageId: String(r.teacher_message_id),
          readByProfessor: Number(r.read_by_professor) === 1,
        }));
        this.sendJson(res, 200, mapped);
        return;
      }

      // POST /api/messages/reply
      if (pathname === '/api/messages/reply' && req.method === 'POST') {
        const { parentMessageId, content } = await this.getBodyJson(req);

        let authorName = authUser.name || 'Profesor';
        let authorId = authUser.email;

        // Insert reply
        const result = await run(
          this.sqliteDb,
          `INSERT INTO teacher_message_replies (teacher_message_id, author_id, author_name, content, is_from_student, read_by_professor)
           VALUES (?, ?, ?, ?, 0, 1)`,
          [parentMessageId, authorId, authorName, content]
        );
        const insertedId = result.lastID;

        // Send WhatsApp reply back to students/group
        const parentMsg = await get<any>(
          this.sqliteDb,
          'SELECT * FROM teacher_messages WHERE id = ? LIMIT 1',
          [parentMessageId]
        );

        if (parentMsg) {
          const parentMsgSubject = parentMsg.content.length > 60
            ? parentMsg.content.substring(0, 60) + '...'
            : parentMsg.content;

          const roleLabels: Record<string, string> = {
            super_admin: 'Super Administrador',
            group_admin: 'Administrador de Grupo',
            professor: 'Profesor',
            institutional: 'Personal Institucional',
          };
          const roleEmojis: Record<string, string> = {
            super_admin: '🛡️',
            group_admin: '🔑',
            professor: '👨‍🏫',
            institutional: '🏫',
          };
          const roleKey = authUser.role || 'professor';
          const roleLabel = roleLabels[roleKey] || 'Profesor';
          const roleEmoji = roleEmojis[roleKey] || '👨‍🏫';

          const formattedReply = `${roleEmoji} *Respuesta del ${roleLabel}: ${authorName}*\n\n` +
            `En relación al aviso/tema:\n` +
            `📌 *"${parentMsgSubject}"*\n\n` +
            `💬 *Respuesta:*\n` +
            `${content}\n\n` +
            `---\n` +
            `💡 Para responder a este mensaje escribí: !rid${parentMessageId} tu mensaje\n` +
            `✉️ También puedes comunicarte con el ${roleLabel.toLowerCase()} enviando un email a ${authUser.email}`;

          try {
            if (parentMsg.target_type === 'cohort') {
              const year = parseInt(parentMsg.target_id.replace('camada:', ''), 10);
              if (!isNaN(year)) {
                const activeGroupIds = await this.groupRepository.getAllActiveIds();
                for (const gid of activeGroupIds) {
                  const groupObj = await this.groupRepository.findByGroupId(gid);
                  if (groupObj && groupObj.entry_year === year) {
                    await this.vectoritoWhatsAppGateway.sendTextMessage(gid, formattedReply);
                  }
                }
              }
            } else {
              await this.vectoritoWhatsAppGateway.sendTextMessage(parentMsg.target_id, formattedReply);
            }
          } catch (e) {
            console.error('[HTTP Server] Falló envío de réplica WhatsApp:', e);
          }
        }

        this.sendJson(res, 201, {
          success: true,
          id: String(insertedId),
          timestamp: new Date().toISOString(),
          isFromStudent: false,
          authorId,
          authorName,
          content
        });
        return;
      }

      // POST /api/messages/mark-read
      if (pathname === '/api/messages/mark-read' && req.method === 'POST') {
        const { messageIds } = await this.getBodyJson(req);
        if (Array.isArray(messageIds) && messageIds.length > 0) {
          const placeholders = messageIds.map(() => '?').join(',');
          await run(
            this.sqliteDb,
            `UPDATE teacher_message_replies SET read_by_professor = 1 WHERE id IN (${placeholders})`,
            messageIds.map((id) => parseInt(id, 10))
          );
        }
        this.sendJson(res, 200, { success: true });
        return;
      }

      // GET /api/notices/:id/replies
      if (pathname.startsWith('/api/notices/') && pathname.endsWith('/replies') && req.method === 'GET') {
        const parts = pathname.split('/');
        const noticeId = parseInt(parts[3], 10);

        const rows = await all<any>(
          this.sqliteDb,
          'SELECT * FROM notice_replies WHERE notice_id = ? ORDER BY timestamp ASC',
          [noticeId]
        );
        const mapped = rows.map((r) => ({
          id: String(r.id),
          authorId: r.author_id,
          authorName: r.author_name,
          authorPhone: r.author_phone,
          content: r.content,
          timestamp: r.timestamp,
          isFromStudent: Number(r.is_from_student) === 1,
          parentMessageId: String(r.notice_id),
          readByProfessor: Number(r.read_by_professor) === 1,
        }));
        this.sendJson(res, 200, mapped);
        return;
      }

      // POST /api/notices/reply
      if (pathname === '/api/notices/reply' && req.method === 'POST') {
        const { parentMessageId, content } = await this.getBodyJson(req);

        let authorName = authUser.name || 'Administración';
        let authorId = authUser.email;

        // Insert reply
        const result = await run(
          this.sqliteDb,
          `INSERT INTO notice_replies (notice_id, author_id, author_name, content, is_from_student, read_by_professor, email_sent)
           VALUES (?, ?, ?, ?, 0, 1, 1)`,
          [parentMessageId, authorId, authorName, content]
        );
        const insertedId = result.lastID;

        // Send WhatsApp reply back to students/group using the new designed template
        const parentNotice = await get<any>(
          this.sqliteDb,
          'SELECT * FROM institutional_notices WHERE id = ? LIMIT 1',
          [parentMessageId]
        );

        if (parentNotice) {
          const parentMsgSubject = parentNotice.title || 'Aviso Institucional';
          const roleLabels: Record<string, string> = {
            super_admin: 'Super Administrador',
            group_admin: 'Administrador de Grupo',
            professor: 'Profesor',
            institutional: 'Personal Institucional',
          };
          const roleEmojis: Record<string, string> = {
            super_admin: '🛡️',
            group_admin: '🔑',
            professor: '👨‍🏫',
            institutional: '🏫',
          };
          const roleKey = authUser.role || 'professor';
          const roleLabel = roleLabels[roleKey] || 'Profesor';
          const roleEmoji = roleEmojis[roleKey] || '👨‍🏫';

          const formattedReply = `${roleEmoji} *Respuesta del ${roleLabel}: ${authorName}*\n\n` +
            `En relación al aviso/tema:\n` +
            `📌 *"${parentMsgSubject}"*\n\n` +
            `💬 *Respuesta:*\n` +
            `${content}\n\n` +
            `---\n` +
            `💡 Para responder a este mensaje escribí: !rid${parentMessageId} tu mensaje\n` +
            `✉️ También puedes comunicarte con el ${roleLabel.toLowerCase()} enviando un email a ${authUser.email}`;

          try {
            // Find target groups
            const targetId = parentNotice.grupo_selector || 'todos';
            const groups = await this.groupRepository.getAllActiveGroupsWithEntryYear();
            let resolvedGroupIds: string[] = [];
            const sel = targetId.trim().toLowerCase();

            if (sel === 'todos' || sel === 'all') {
              resolvedGroupIds = groups.map((g) => g.group_id);
            } else if (sel === 'general') {
              resolvedGroupIds = groups.filter((g) => g.entry_year === null).map((g) => g.group_id);
            } else if (sel.startsWith('camada:')) {
              const year = Number(sel.split(':')[1]);
              resolvedGroupIds = groups.filter((g) => g.entry_year === year).map((g) => g.group_id);
            } else {
              const matched = groups.find((g) => g.group_id.toLowerCase() === sel);
              if (matched) {
                resolvedGroupIds = [matched.group_id];
              } else {
                resolvedGroupIds = [targetId];
              }
            }

            for (const gid of resolvedGroupIds) {
              if (gid && (gid.endsWith('@g.us') || gid.endsWith('@s.whatsapp.net') || gid.endsWith('@lid'))) {
                await this.vectoritoWhatsAppGateway.sendTextMessage(gid, formattedReply);
              }
            }
          } catch (e) {
            console.error('[HTTP Server] Falló envío de réplica aviso WhatsApp:', e);
          }
        }

        this.sendJson(res, 201, {
          success: true,
          id: String(insertedId),
          timestamp: new Date().toISOString(),
          isFromStudent: false,
          authorId,
          authorName,
          content
        });
        return;
      }

      // POST /api/simulation/trigger-alert
      if (pathname === '/api/simulation/trigger-alert' && req.method === 'POST') {
        if (authUser.role !== 'super_admin') {
          this.sendJson(res, 403, { success: false, error: 'Acceso denegado.' });
          return;
        }

        const { alertType, variant, timing, subjectId, groupId } = await this.getBodyJson(req);
        if (!alertType || !groupId) {
          this.sendJson(res, 400, { success: false, error: 'alertType y groupId son requeridos.' });
          return;
        }

        let subjectName = 'Materia de Prueba';
        if (subjectId) {
          const row = await get<any>(this.sqliteDb, 'SELECT name FROM academic_subjects WHERE id = ? LIMIT 1', [subjectId]);
          if (row) subjectName = row.name;
        }

        let message = '';
        if (alertType === 'clase') {
          if (timing === 'clase-feriado') {
            message = `🔔 *Sin clases por Feriado:* Hoy no se dictará la clase de *${subjectName}* debido a: *Feriado de Prueba*. ¡Que tengan un excelente descanso! ☀️`;
          } else {
            message = `⏰ Recordatorio: la clase de *${subjectName}* comienza en 10 minutos.\n\n📚 ${subjectName}\n🧩 Comisión: Unica\n🔗 Enlace: https://meet.google.com/abc-defg-hij`;
          }
        } else if (alertType === 'examen') {
          const variantNames: Record<string, string> = {
            evidence: 'Evidencia de Aprendizaje',
            abp: 'Defensa ABP',
            final: 'Examen Final',
            colloquium: 'Coloquio'
          };
          const varName = variantNames[variant] || 'Evaluación';

          if (timing === 'franja-start') {
            message = `🔔 El ${varName} de ${subjectName} comienza a las 18:00\n¡Prepara todo! Faltan 10 minutos para que comience.\n📝 Tenés hasta las 20:00 para realizar el intento (2 horas).`;
          } else if (timing === 'franja-end') {
            message = `⏳ El ${varName} de ${subjectName} termina a las 20:00\n¡Últimos minutos! Faltan 10 minutos para que cierre la franja.\n📝 Asegurate de que figure entregado en el foro.`;
          } else if (timing.startsWith('recordatorio-')) {
            const timeRemainingMap: Record<string, string> = {
              'recordatorio-7d': '7 días',
              'recordatorio-3d': '3 días',
              'recordatorio-1d': '1 día',
              'recordatorio-20m': '20 minutos'
            };
            const timeText = timeRemainingMap[timing] || 'tiempo configurado';
            message = `📢 Recordatorio: Quedan ${timeText} para el ${varName} de ${subjectName}\n⏰ 18:00\n📝 Disponible de 18:00 a 20:00 (2 horas)`;
          } else if (timing === 'carga-24h') {
            message = `🚨 Examen cargado con menos de 24 horas:\n📝 ${subjectName}\n⏰ 18:00\n📅 ${new Date().toLocaleDateString('es-AR')}\n\n¡Aviso urgente en el grupo!`;
          } else if (timing === 'carga-48h') {
            message = `⚠️ Examen cargado con menos de 48 horas:\n📝 ${subjectName}\n⏰ 18:00\n📅 ${new Date().toLocaleDateString('es-AR')}\n\n¡Todos atentos!`;
          } else {
            message = `📢 Recordatorio de examen de ${subjectName} en camino.`;
          }
        } else if (alertType === 'ciclo_lectivo') {
          if (timing === 'welcome') {
            message = `👋 ¡Les damos la bienvenida a un nuevo año académico en el ISPC! 🎓 Espero que tengan una cursada espectacular. Recuerden que estoy aquí para ayudarlos con horarios (!hoy, !semana), exámenes (!examenes) y avisos (!avisos). ¡Muchos éxitos! 🚀`;
          } else if (timing === 'winter_break') {
            message = `⛄ *¡Llegó el receso de invierno!* ❄️\n\nAprovechen estas semanas para descansar, desconectarse de las entregas y recargar energías. ¡Nos volvemos a encontrar a la vuelta! ¡Buenas vacaciones! ☕🎉`;
          } else if (timing === 'end_of_year') {
            message = `🎄 *¡Cierre de ciclo lectivo!* 🌟\n\nFelicitaciones a todos por el esfuerzo realizado a lo largo de este año. Disfruten de las fiestas, descansen y les deseo un excelente comienzo del nuevo año. ¡Felicidades! 🥂✨`;
          } else if (timing === 'graduation') {
            message = `🎓 *¡FELICITACIONES EGRESADOS!* 🎓\n\nHan completado su trayectoria de Tecnicatura Superior en Desarrollo de Software. Es un orgullo enorme verlos convertirse en profesionales de la tecnología y egresar del ISPC. ¡El mayor de los éxitos en su futuro laboral! 🚀💻`;
          } else if (timing === 'reinicio-7d') {
            message = `🔔 *Recordatorio:* Les recordamos que las clases se reanudarán el próximo *Lunes 10 de Agosto*. ¡Vayan preparando todo! 📚✨`;
          } else {
            message = `📢 Aviso de ciclo lectivo.`;
          }
        }

        try {
          await this.vectoritoWhatsAppGateway.sendTextMessage(groupId, message);
          this.sendJson(res, 200, { success: true, messageSent: message });
        } catch (err: any) {
          console.error('[Simulation Alert] Error sending WhatsApp message:', err);
          this.sendJson(res, 500, { success: false, error: `Error al enviar WhatsApp: ${err.message || err}` });
        }
        return;
      }

      // POST /api/notices/mark-read
      if (pathname === '/api/notices/mark-read' && req.method === 'POST') {
        const { messageIds } = await this.getBodyJson(req);
        if (Array.isArray(messageIds) && messageIds.length > 0) {
          const placeholders = messageIds.map(() => '?').join(',');
          await run(
            this.sqliteDb,
            `UPDATE notice_replies SET read_by_professor = 1 WHERE id IN (${placeholders})`,
            messageIds.map((id) => parseInt(id, 10))
          );
        }
        this.sendJson(res, 200, { success: true });
        return;
      }

      // ── SERVE WEB APP STATIC FILES ──────────────────────────────────────────
      if (pathname.startsWith('/api/')) {
        this.sendJson(res, 404, { success: false, error: 'Endpoint API no encontrado' });
        return;
      }
      this.serveWebStatic(pathname, res);

    } catch (err) {
      console.error('[HTTP Server] Error al procesar petición:', err);
      const msg = (err as any)?.message || 'Error del servidor';
      this.sendJson(res, 500, { success: false, error: msg });
    }
  }

  private async serveWebStatic(pathname: string, res: http.ServerResponse): Promise<void> {
    try {
      const webDistPath = path.resolve(process.cwd(), 'web', 'dist');
      let filePath = path.join(webDistPath, pathname);

      if (!filePath.startsWith(webDistPath)) {
        this.sendText(res, 403, 'Acceso denegado');
        return;
      }

      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        filePath = path.join(webDistPath, 'index.html');
        stat = await fs.stat(filePath);
      }

      if (stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentTypeMap: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.webp': 'image/webp',
      };

      const contentType = contentTypeMap[ext] || 'application/octet-stream';
      const content = await fs.readFile(filePath);

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (err) {
      if (pathname === '/') {
        this.sendText(res, 200, 'Vectorito HTTP Server activo. Servidor panel web no compilado. Ejecutá "npm run build:web" para compilar.');
      } else {
        this.sendText(res, 404, 'No encontrado');
      }
    }
  }

  private async sendOtpEmail(email: string, code: string, redirectPath: string): Promise<void> {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const loginUrl = `${baseUrl}/login?email=${encodeURIComponent(email)}&otp=${code}&redirect=${encodeURIComponent(redirectPath)}`;
    const subject = 'Acceso al Panel de Control Web';

    const plainBody = `Hola.\n\n` +
      `Para ingresar al panel de control de Vectorito, hacé click en el siguiente enlace de acceso directo:\n\n` +
      `${loginUrl}\n\n` +
      `O ingresá manualmente con tu email y el siguiente código temporal (OTP):\n\n` +
      `Código OTP: ${code}\n\n` +
      `Este código vencerá en 10 minutos.\n\n` +
      `¡Muchas gracias!\n` +
      `Equipo de Vectorito`;

    const htmlBody = `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #4f46e5; margin-top: 0; margin-bottom: 20px;">🔑 Acceso al Panel de Control Web</h2>
      <p>Hola,</p>
      <p>Hacé click en el botón de abajo para ingresar de forma directa a tu cuenta en el panel web:</p>
      <div style="text-align: center; margin: 25px 0;">
        <a href="${loginUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Ingresar al Panel</a>
      </div>
      <p>O copia y pega este enlace directo en tu navegador:</p>
      <p style="background-color: #f3f4f6; padding: 10px; border-radius: 4px; font-size: 0.9em; word-break: break-all;">
        <a href="${loginUrl}">${loginUrl}</a>
      </p>
      <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;">
      <p>Código de acceso manual (OTP):</p>
      <p style="font-size: 1.5em; font-weight: bold; color: #4f46e5; margin: 0 0 10px 0;">${code}</p>
      <p style="font-size: 0.9em; color: #6b7280; font-style: italic;">* Válido por 10 minutos.</p>
      <p style="margin-top: 25px; border-top: 1px solid #e5e7eb; padding-top: 15px; font-size: 0.9em; color: #4b5563;">
        Saludos,<br><strong>Vectorito Bot</strong>
      </p>
    </div>`;

    await this.outboundEmailService.send(email, subject, plainBody, htmlBody);
  }

  private async getAuthenticatedUser(req: http.IncomingMessage): Promise<any | null> {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    
    try {
      const decoded = JwtUtils.verify(token);
      if (decoded) {
        const simulateEmail = req.headers['x-simulate-user'];
        if (simulateEmail && decoded.role === 'super_admin') {
          const emailLower = String(simulateEmail).toLowerCase().trim();
          const profile = await get<any>(
            this.sqliteDb,
            'SELECT name, email FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
            [emailLower]
          );
          if (profile) {
            const superadminEmailsEnv = process.env.SUPERADMIN_EMAILS || '';
            const superadmins = superadminEmailsEnv.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
            
            let role = 'institutional';
            if (superadmins.includes(emailLower)) {
              role = 'super_admin';
            } else {
              const adminEmails = await this.adminRepository.listAdminEmails();
              if (adminEmails.map(e => e.toLowerCase()).includes(emailLower)) {
                role = 'group_admin';
              } else {
                const teacher = await this.managedTeacherRepository.getByEmail(emailLower);
                if (teacher) {
                  role = 'professor';
                } else {
                  const existsCollab = await this.authorizedEmailRepository.exists(emailLower);
                  if (existsCollab) {
                    role = 'institutional';
                  }
                }
              }
            }
            return {
              email: emailLower,
              role,
              name: profile.name,
              groupIds: []
            };
          }
        }
        return decoded;
      }
    } catch (e) {
      console.warn('[HTTP Server] Error verifying token or simulating user:', e);
    }

    try {
      const groupId = await this.onboardingTokenRepo.validateToken(token);
      if (groupId) {
        return {
          email: 'onboarding_temporary_admin@vectorito',
          role: 'group_admin',
          name: 'Temporary Group Admin',
          groupId
        };
      }
    } catch (err) {
      console.error('[HTTP Server] Error validating onboarding token as session:', err);
    }

    return null;
  }

  private getBodyJson(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  private sendJson(res: http.ServerResponse, statusCode: number, data: any): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }

  private sendText(res: http.ServerResponse, statusCode: number, text: string): void {
    res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  }
}
