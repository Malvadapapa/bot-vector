"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RssParserService = void 0;
const rss_parser_1 = __importDefault(require("rss-parser"));
class RssParserService {
    constructor() {
        this.parser = new rss_parser_1.default();
    }
    async fetchFeed(url) {
        try {
            const feed = await this.parser.parseURL(url);
            return feed.items;
        }
        catch (error) {
            console.error(`Error fetching RSS feed from ${url}:`, error);
            return [];
        }
    }
}
exports.RssParserService = RssParserService;
