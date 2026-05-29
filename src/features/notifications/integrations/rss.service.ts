import Parser from 'rss-parser';

export class RssParserService {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
  }

  public async fetchFeed(url: string): Promise<any[]> {
    try {
      const feed = await this.parser.parseURL(url);
      return feed.items;
    } catch (error) {
      console.error(`Error fetching RSS feed from ${url}:`, error);
      return [];
    }
  }
}
