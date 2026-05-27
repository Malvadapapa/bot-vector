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
exports.PDFExtractor = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
class PDFExtractor {
    /**
     * Extrae texto de un PDF usando pdf-parse v2.
     * La v2 expone una clase `PDFParse` que se instancia con {data: Buffer},
     * luego se llama load() y se itera página por página con getTextContent().
     */
    async extractText(filePath) {
        const dataBuffer = await promises_1.default.readFile(filePath);
        try {
            const { PDFParse } = await Promise.resolve().then(() => __importStar(require('pdf-parse')));
            const parser = new PDFParse({ data: dataBuffer });
            await parser.load();
            const numPages = parser.doc.numPages;
            const pages = [];
            for (let i = 1; i <= numPages; i++) {
                const page = await parser.doc.getPage(i);
                const content = await page.getTextContent();
                const pageText = content.items.map((item) => item.str).join(' ');
                pages.push({ pageNumber: i, text: pageText });
            }
            parser.destroy();
            return pages;
        }
        catch (error) {
            console.error(`[PDFExtractor] Error leyendo el archivo ${filePath}:`, error);
            throw error;
        }
    }
}
exports.PDFExtractor = PDFExtractor;
