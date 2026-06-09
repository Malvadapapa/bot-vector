import blessed from 'neo-blessed';
import { StreamInterceptor } from './stream-interceptor.js';

export class TerminalTui {
  private screen!: blessed.Widgets.Screen;
  private chatPanel!: blessed.Widgets.Log;
  private logPanel!: blessed.Widgets.Log;
  private interceptor!: StreamInterceptor;

  constructor() {
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
      style: {
        border: { fg: 'green' },
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
      style: {
        border: { fg: 'magenta' },
        label: labelStyle,
      },
    });

    // 4. Adaptabilidad a cambios de tamaño de consola
    this.screen.on('resize', () => {
      this.chatPanel.emit('resize');
      this.logPanel.emit('resize');
      this.screen.render();
    });

    // 5. Atajos de salida limpia (Escape, q, Ctrl+C)
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.destroy();
      process.exit(0);
    });

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
  public appendChatMessage(sender: string, text: string, type: 'user' | 'bot'): void {
    const time = new Date().toLocaleTimeString();
    const color = type === 'user' ? 'cyan' : 'green';
    const tag = type === 'user' ? '👤 STUDENT' : '🤖 BOT';

    this.chatPanel.log(
      `[{gray-fg}${time}{/gray-fg}] {${color}-fg}{bold}${tag} (${sender}){/bold}{/${color}-fg}: ${text}`
    );
  }

  /**
   * Imprime una traza de depuración interna del proceso RAG/IA
   */
  public appendProcessTrace(trace: string): void {
    const time = new Date().toLocaleTimeString();
    // Sangrado e indentación para diferenciar del chat y color amarillo suave
    this.chatPanel.log(
      `  [{gray-fg}${time}{/gray-fg}] {yellow-fg}⚙️ [PROCESO RAG]: ${trace}{/yellow-fg}`
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
