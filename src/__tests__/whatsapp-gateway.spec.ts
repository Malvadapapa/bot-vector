import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectoritoWhatsAppGateway } from '../interfaces/whatsapp/vectorito-whatsapp-gateway.js';

// Mock del modulo de baileys
vi.mock('@whiskeysockets/baileys', () => {
  const mockSocket = {
    ev: {
      on: vi.fn(),
    },
    user: {
      id: 'bot123@s.whatsapp.net',
    },
    readMessages: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };

  return {
    default: vi.fn().mockReturnValue(mockSocket),
    Browsers: {
      ubuntu: vi.fn(),
    },
    useMultiFileAuthState: vi.fn().mockResolvedValue({
      state: { creds: {}, keys: {} },
      saveCreds: vi.fn(),
    }),
    DisconnectReason: {
      loggedOut: 401,
      restartRequired: 515,
      connectionReplaced: 440,
    },
    fetchLatestBaileysVersion: vi.fn().mockResolvedValue({ version: [2, 3000, 0] }),
    makeCacheableSignalKeyStore: vi.fn(),
  };
});

describe('VectoritoWhatsAppGateway - Filtrado de estados y broadcast', () => {
  let mockRouter: any;
  let mockPrivateChatWorkflow: any;
  let mockUserProfileRepo: any;
  let mockAdminRepo: any;
  let mockRateLimitService: any;
  let mockModerationService: any;
  let mockGroupRepo: any;
  let mockGroupMembershipRepo: any;
  let gateway: VectoritoWhatsAppGateway;
  let socketInstance: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockRouter = {
      route: vi.fn().mockResolvedValue('reply'),
      hasActiveMenuState: vi.fn().mockReturnValue(false),
    };
    mockPrivateChatWorkflow = {
      handlePrivateMessage: vi.fn().mockResolvedValue('private_reply'),
      getGroupCommissionMissingWarning: vi.fn().mockResolvedValue(null),
      handleGroupAdminLink: vi.fn().mockResolvedValue(null),
      startGroupContextConfiguration: vi.fn().mockResolvedValue('config_reply'),
    };
    mockUserProfileRepo = {
      get: vi.fn().mockResolvedValue({ name: 'User Test', birthday_day_month: '01/01', email: 'user@test.com' }),
    };
    mockAdminRepo = {
      isAuthenticated: vi.fn().mockResolvedValue(false),
      isRegistered: vi.fn().mockResolvedValue(false),
      isSuperAdmin: vi.fn().mockResolvedValue(false),
      isGlobalAdmin: vi.fn().mockResolvedValue(false),
      isGroupAdmin: vi.fn().mockResolvedValue(false),
      get: vi.fn().mockResolvedValue(null),
    };
    mockRateLimitService = {
      approveNextPendingRequest: vi.fn(),
    };
    mockModerationService = {
      evaluate: vi.fn().mockResolvedValue({ warningMessage: null, blocked: false }),
    };
    mockGroupRepo = {
      isActive: vi.fn().mockResolvedValue(true),
      findByGroupId: vi.fn().mockResolvedValue({ group_id: 'g@g.us', display_name: 'Group' }),
      findAll: vi.fn().mockResolvedValue([]),
    };
    mockGroupMembershipRepo = {
      addMembership: vi.fn(),
    };

    gateway = new VectoritoWhatsAppGateway(
      mockRouter,
      mockPrivateChatWorkflow,
      mockUserProfileRepo,
      mockAdminRepo,
      mockRateLimitService,
      mockModerationService,
      mockGroupRepo,
      mockGroupMembershipRepo,
    );

    // Obtener la instancia simulada de makeWASocket
    const baileys = await import('@whiskeysockets/baileys');
    socketInstance = (baileys.default as any)();

    // Limpiar espías de eventos
    socketInstance.ev.on.mockClear();
  });

  it('debería registrar el callback de messages.upsert al iniciar conexión', async () => {
    await gateway.startConnection();
    expect(socketInstance.ev.on).toHaveBeenCalledWith('messages.upsert', expect.any(Function));
  });

  it('debería ignorar los mensajes con remoteJid de status@broadcast', async () => {
    await gateway.startConnection();

    // Buscar el callback registrado para messages.upsert
    const upsertCall = socketInstance.ev.on.mock.calls.find((call: any) => call[0] === 'messages.upsert');
    expect(upsertCall).toBeDefined();
    const upsertCallback = upsertCall[1];

    // Simular un mensaje recibido desde status@broadcast (actualización de estado/historia)
    const event = {
      type: 'notify',
      messages: [
        {
          key: {
            remoteJid: 'status@broadcast',
            id: 'msg_status_123',
            fromMe: false,
          },
          message: {
            conversation: 'Este es mi estado de WhatsApp',
          },
        },
      ],
    };

    await upsertCallback(event);

    // Verificar que NO se enruta ni al router de grupos ni al workflow privado
    expect(mockRouter.route).not.toHaveBeenCalled();
    expect(mockPrivateChatWorkflow.handlePrivateMessage).not.toHaveBeenCalled();
  });

  it('debería procesar mensajes normales de chat privado', async () => {
    await gateway.startConnection();

    const upsertCall = socketInstance.ev.on.mock.calls.find((call: any) => call[0] === 'messages.upsert');
    const upsertCallback = upsertCall[1];

    const event = {
      type: 'notify',
      messages: [
        {
          key: {
            remoteJid: '5493517881027@s.whatsapp.net',
            id: 'msg_private_123',
            fromMe: false,
          },
          message: {
            conversation: '!registrarse',
          },
        },
      ],
    };

    await upsertCallback(event);

    // Debería enviarse al workflow de chat privado (puesto que remoteJid es un chat de persona)
    expect(mockPrivateChatWorkflow.handlePrivateMessage).toHaveBeenCalledWith(
      '5493517881027@s.whatsapp.net',
      '!registrarse'
    );
  });

  it('debería procesar mensajes de grupo que tengan comandos o menciones', async () => {
    await gateway.startConnection();

    const upsertCall = socketInstance.ev.on.mock.calls.find((call: any) => call[0] === 'messages.upsert');
    const upsertCallback = upsertCall[1];

    const event = {
      type: 'notify',
      messages: [
        {
          key: {
            remoteJid: '12345678@g.us',
            id: 'msg_group_123',
            fromMe: false,
          },
          message: {
            conversation: '!ayuda',
          },
        },
      ],
    };

    await upsertCallback(event);

    // Debería enrutarse al router de mensajes grupales
    expect(mockRouter.route).toHaveBeenCalled();
  });
});
