export class StreamInterceptor {
  private originalStdoutWrite: typeof process.stdout.write;
  private originalStderrWrite: typeof process.stderr.write;
  private isWriting = false;
  private isIntercepting = false;

  constructor(private onLog: (text: string) => void) {
    this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
    this.originalStderrWrite = process.stderr.write.bind(process.stderr);
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

  public start(): void {
    if (this.isIntercepting) return;
    this.isIntercepting = true;

    // Interceptar stdout
    process.stdout.write = ((chunk: any, encoding?: any, callback?: any): boolean => {
      const text = chunk.toString();
      
      // Si ya estamos escribiendo un cambio de Blessed en consola, redirigir directo
      if (this.isWriting) {
        return this.originalStdoutWrite(chunk, encoding, callback);
      }

      this.isWriting = true;
      try {
        const cleanText = this.stripAnsi(text);
        if (cleanText.trim().length > 0) {
          this.onLog(cleanText);
        }
      } finally {
        this.isWriting = false;
      }
      return true;
    }) as any;

    // Interceptar stderr
    process.stderr.write = ((chunk: any, encoding?: any, callback?: any): boolean => {
      const text = chunk.toString();

      if (this.isWriting) {
        return this.originalStderrWrite(chunk, encoding, callback);
      }

      this.isWriting = true;
      try {
        const cleanText = this.stripAnsi(text);
        if (cleanText.trim().length > 0) {
          this.onLog(`{red-fg}[ERROR] ${cleanText}{/red-fg}`);
        }
      } finally {
        this.isWriting = false;
      }
      return true;
    }) as any;
  }

  public stop(): void {
    if (!this.isIntercepting) return;
    process.stdout.write = this.originalStdoutWrite;
    process.stderr.write = this.originalStderrWrite;
    this.isIntercepting = false;
  }
}
