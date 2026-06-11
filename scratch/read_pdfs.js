import fs from 'node:fs';
import { PDFParse } from 'pdf-parse';

const filePath = 'data/ai-context/general/guia_siu_guarani_rag_ispc.pdf';
const dataBuffer = fs.readFileSync(filePath);

async function dump() {
  try {
    const parser = new PDFParse({ data: dataBuffer });
    await parser.load();
    const numPages = parser.doc.numPages;
    for (let i = 1; i <= numPages; i++) {
      console.log(`\n--- PAGE ${i} ---`);
      const page = await parser.doc.getPage(i);
      const content = await page.getTextContent();
      console.log(content.items.map(item => item.str).join(' '));
    }
    parser.destroy();
  } catch (e) {
    console.error(e);
  }
}

dump();
