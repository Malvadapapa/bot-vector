import blessed from 'neo-blessed';
import { execSync } from 'child_process';
import { StreamInterceptor } from './stream-interceptor.js';

export class TerminalTui {
  private screen!: blessed.Widgets.Screen;
  private chatPanel!: blessed.Widgets.Log;
  private logPanel!: blessed.Widgets.Log;
  private interceptor!: StreamInterceptor;

  constructor() {
    // Forzar codificación de página de códigos de consola UTF-8 en Windows antes de iniciar Blessed
    if (process.platform === 'win32') {
      try {
        execSync('chcp 65001', { stdio: 'ignore' });
      } catch {
        // Ignorado si falla en algún entorno restringido
      }
    }
    this.initLayout();
    this.initInterceptor();
  }

  private initLayout(): void {
    // 1. Inicializar Pantalla
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Vectorito - Tablero de Supervisión',
      dockBorders: true,
      forceUnicode: true,
      mouse: true, // Habilitar soporte de captura de eventos de mouse y rueda de scroll
    });

    const borderStyle = { type: 'line' as const };
    const labelStyle = { fg: 'cyan', bold: true };

    // 2. Panel Izquierdo: Conversaciones y Trazas RAG (50% Ancho)
    this.chatPanel = blessed.log({
      parent: this.screen,
      left: 0,
      top: 0,
      width: '50%',
      height: '100%',
      border: borderStyle,
      label: ' 💬 FLUJO DE CONVERSACIONES Y PROCESO RAG ',
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      scrollback: 10000,
      scrollbar: {
        ch: ' ',
        track: {
          bg: 'black',
        },
        style: {
          bg: 'yellow',
        },
      },
      style: {
        border: { fg: 'green' },
        focus: {
          border: { fg: 'yellow' },
        },
        label: labelStyle,
      },
    });

    // 3. Panel Derecho: Logs del Sistema (50% Ancho)
    this.logPanel = blessed.log({
      parent: this.screen,
      left: '50%',
      top: 0,
      width: '50%',
      height: '100%',
      border: borderStyle,
      label: ' ⚙️ LOGS Y ERRORES DE INFRAESTRUCTURA ',
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      scrollback: 10000,
      scrollbar: {
        ch: ' ',
        track: {
          bg: 'black',
        },
        style: {
          bg: 'cyan',
        },
      },
      style: {
        border: { fg: 'magenta' },
        focus: {
          border: { fg: 'cyan' },
        },
        label: labelStyle,
      },
    });

    // 4. Eventos de scroll con rueda del mouse (capturados vía evento genérico 'mouse')
    this.chatPanel.on('mouse', (data: any) => {
      if (data.action === 'wheelup') {
        this.chatPanel.scroll(-2);
        this.screen.render();
      } else if (data.action === 'wheeldown') {
        this.chatPanel.scroll(2);
        this.screen.render();
      }
    });

    this.logPanel.on('mouse', (data: any) => {
      if (data.action === 'wheelup') {
        this.logPanel.scroll(-2);
        this.screen.render();
      } else if (data.action === 'wheeldown') {
        this.logPanel.scroll(2);
        this.screen.render();
      }
    });

    // 5. Navegación e intercambio de foco con la tecla Tab
    this.screen.key(['tab'], () => {
      if (this.screen.focused === this.chatPanel) {
        this.logPanel.focus();
      } else {
        this.chatPanel.focus();
      }
      this.screen.render();
    });

    // 6. Adaptabilidad a cambios de tamaño de consola
    this.screen.on('resize', () => {
      this.chatPanel.emit('resize');
      this.logPanel.emit('resize');
      this.screen.render();
    });

    // 7. Atajos de salida limpia (Escape, q, Ctrl+C)
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.destroy();
      process.exit(0);
    });

    // Foco inicial por defecto
    this.chatPanel.focus();

    // Renderizado Inicial
    this.screen.render();
  }

  private initInterceptor(): void {
    this.interceptor = new StreamInterceptor((text) => {
      const cleaned = text.replace(/\n$/, '');
      if (cleaned.length > 0) {
        this.logPanel.log(cleaned);
      }
    });
    this.interceptor.start();
  }

  /**
   * Imprime un mensaje de WhatsApp en el panel de conversación
   */
  public appendChatMessage(sender: string, text: string, type: 'user' | 'bot', contextLabel?: string): void {
    const time = new Date().toLocaleTimeString();
    const color = type === 'user' ? 'cyan' : 'green';
    const tag = type === 'user' ? '👤 STUDENT' : '🤖 BOT';
    const contextStr = contextLabel ? ` {yellow-fg}${contextLabel}{/yellow-fg}` : '';

    this.chatPanel.log(
      `[{white-fg}${time}{/white-fg}]${contextStr} {${color}-fg}{bold}${tag} (${sender}){/bold}{/${color}-fg}: ${text}`
    );
  }

  /**
   * Imprime una traza de depuración interna del proceso RAG/IA
   */
  public appendProcessTrace(trace: string): void {
    const time = new Date().toLocaleTimeString();
    // Sangrado e indentación para diferenciar del chat y color amarillo suave
    this.chatPanel.log(
      `  [{white-fg}${time}{/white-fg}] {yellow-fg}⚙️ [PROCESO RAG]: ${trace}{/yellow-fg}`
    );
  }

  /**
   * Apaga los interceptores y restaura la consola
   */
  public destroy(): void {
    this.interceptor.stop();
    this.screen.destroy();
  }
}
