import fs from 'node:fs/promises';

export class PDFExtractor {
  /**
   * Extrae texto de un PDF usando pdf-parse v2.
   * La v2 expone una clase `PDFParse` que se instancia con {data: Buffer},
   * luego se llama load() y se itera página por página con getTextContent().
   */
  public async extractText(filePath: string): Promise<Array<{ pageNumber: number, text: string }>> {
    const dataBuffer = await fs.readFile(filePath);

    try {
      const { PDFParse } = await import('pdf-parse');
      const parser: any = new PDFParse({ data: dataBuffer });
      await parser.load();

      const numPages = parser.doc.numPages;
      const pages: Array<{ pageNumber: number, text: string }> = [];

      for (let i = 1; i <= numPages; i++) {
        const page = await parser.doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((item: any) => item.str).join(' ');
        pages.push({ pageNumber: i, text: pageText });
      }

      parser.destroy();
      return pages;
    } catch (error) {
      console.error(`[PDFExtractor] Error leyendo el archivo ${filePath}:`, error);
      throw error;
    }
  }
}
