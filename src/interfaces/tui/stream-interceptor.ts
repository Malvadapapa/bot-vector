import util from 'util';

export class StreamInterceptor {
  private originalLog!: typeof console.log;
  private originalError!: typeof console.error;
  private originalWarn!: typeof console.warn;
  private originalInfo!: typeof console.info;
  private isIntercepting = false;
  private activeInterceptions = 0;

  constructor(private onLog: (text: string) => void) {
    this.originalLog = console.log.bind(console);
    this.originalError = console.error.bind(console);
    this.originalWarn = console.warn.bind(console);
    this.originalInfo = console.info.bind(console);
  }

  /**
   * Limpia los códigos de escape de color ANSI para evitar corrupción visual en Blessed
   */
  private stripAnsi(str: string): string {
    const pattern = [
      '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*)?\\u0007)',
      '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))'
    ].join('|');
    const regex = new RegExp(pattern, 'g');
    return str.replace(regex, '');
  }

  private formatArgs(args: any[]): string {
    return args
      .map((arg) => (typeof arg === 'string' ? arg : util.inspect(arg, { colors: false })))
      .join(' ');
  }

  public start(): void {
    if (this.isIntercepting) return;
    this.isIntercepting = true;

    console.log = (...args: any[]) => {
      if (this.activeInterceptions > 0) {
        this.originalLog(...args);
        return;
      }
      this.activeInterceptions++;
      try {
        const text = this.formatArgs(args);
        const cleanText = this.stripAnsi(text);
        if (cleanText.trim().length > 0) {
          this.onLog(cleanText);
        }
      } finally {
        this.activeInterceptions--;
      }
    };

    console.info = (...args: any[]) => {
      if (this.activeInterceptions > 0) {
        this.originalInfo(...args);
        return;
      }
      this.activeInterceptions++;
      try {
        const text = this.formatArgs(args);
        const cleanText = this.stripAnsi(text);
        if (cleanText.trim().length > 0) {
          this.onLog(cleanText);
        }
      } finally {
        this.activeInterceptions--;
      }
    };

    console.warn = (...args: any[]) => {
      if (this.activeInterceptions > 0) {
        this.originalWarn(...args);
        return;
      }
      this.activeInterceptions++;
      try {
        const text = this.formatArgs(args);
        const cleanText = this.stripAnsi(text);
        if (cleanText.trim().length > 0) {
          this.onLog(`{yellow-fg}[WARN] ${cleanText}{/yellow-fg}`);
        }
      } finally {
        this.activeInterceptions--;
      }
    };

    console.error = (...args: any[]) => {
      if (this.activeInterceptions > 0) {
        this.originalError(...args);
        return;
      }
      this.activeInterceptions++;
      try {
        const text = this.formatArgs(args);
        const cleanText = this.stripAnsi(text);
        if (cleanText.trim().length > 0) {
          this.onLog(`{red-fg}[ERROR] ${cleanText}{/red-fg}`);
        }
      } finally {
        this.activeInterceptions--;
      }
    };
  }

  public stop(): void {
    if (!this.isIntercepting) return;
    console.log = this.originalLog;
    console.info = this.originalInfo;
    console.warn = this.originalWarn;
    console.error = this.originalError;
    this.isIntercepting = false;
  }
}
