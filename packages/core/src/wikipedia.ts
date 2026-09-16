export interface WikipediaResult {
  title: string;
  extract: string;
  url: string;
  language: string;
  pageId: number;
  thumbnail?: string;
}

import { BaseService, DictionaryError } from './base';
import { getHttp } from './runtime';
import { bytesToBase64 } from './http';

export interface WikipediaSearchResult {
  query: string;
  results: WikipediaResult[];
  totalResults: number;
}

const WIKI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Phevere/1.0';

function attrEsc(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function wrapWikipediaDocument(html: string, language: string, title: string): string {
  const cleaned = String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  const slug = encodeURIComponent(String(title || '').replace(/ /g, '_'));
  const origin = `https://${language}.wikipedia.org`;
  const base = `${origin}/wiki/${slug}`;
  return `<!DOCTYPE html><html lang="${attrEsc(language)}"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="referrer" content="no-referrer"/>
<base href="${attrEsc(base)}"/>
<style>
  html, body { margin: 0; background: #fffdf9; color: #1c1917; }
  body { padding: 12px 14px 28px; font: 17px/1.55 Georgia, "Times New Roman", serif; }
  img, video, audio { max-width: 100%; height: auto; }
  table { max-width: 100%; font-size: 0.88em; }
  a { color: #0f6e71; }
  .mw-empty-elt, .noprint { display: none; }
  figure { margin: 12px 0; }
  h1, h2, h3 { font-weight: 650; letter-spacing: -0.02em; line-height: 1.2; }
</style>
</head><body>${cleaned}</body></html>`;
}

export class WikipediaService extends BaseService {
  private cache = new Map<string, { result: WikipediaSearchResult; timestamp: number }>();
  private cacheTimeout = 60 * 60 * 1000; // 1 hour
  private thumbCache = new Map<string, string>();

  /**
   * Search Wikipedia for a term
   */
  async search(term: string, language: string = 'en', limit: number = 5): Promise<WikipediaSearchResult> {
    const cacheKey = `${term.toLowerCase()}_${language}_${limit}`;

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.result;
    }

    try {
      const url = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`;

      const response = await this.request<{
        title: string;
        extract: string;
        content_urls: { desktop: { page: string } };
        pageid: number;
        thumbnail?: { source: string };
      }>(url);

      const thumbnail = await this.toEmbeddableThumb(response.thumbnail?.source, language);

      const result: WikipediaSearchResult = {
        query: term,
        results: [
          {
            title: response.title,
            extract: response.extract,
            url: response.content_urls.desktop.page,
            language,
            pageId: response.pageid,
            thumbnail,
          },
        ],
        totalResults: 1,
      };

      this.cache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    } catch {
      return this.searchAPI(term, language, limit);
    }
  }

  /**
   * Use Wikipedia search API as fallback
   */
  private async searchAPI(term: string, language: string = 'en', limit: number = 5): Promise<WikipediaSearchResult> {
    try {
      const url = `https://${language}.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(term)}&srlimit=${limit}&origin=*`;

      const response = await this.request<{
        query: {
          search: Array<{
            title: string;
            snippet: string;
            pageid: number;
          }>;
          searchinfo: { totalhits: number };
        };
      }>(url);

      const results: WikipediaResult[] = await Promise.all(
        response.query.search.map(async (item) => {
          const pageInfo = await this.getPageInfoByTitle(item.title, language);
          return {
            title: item.title,
            extract: pageInfo.extract || this.stripWikiHtml(item.snippet),
            url: pageInfo.url || `https://${language}.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
            language,
            pageId: item.pageid,
            thumbnail: pageInfo.thumbnail,
          };
        }),
      );

      const result: WikipediaSearchResult = {
        query: term,
        results,
        totalResults: response.query.searchinfo.totalhits,
      };

      this.cache.set(`${term.toLowerCase()}_${language}_${limit}`, { result, timestamp: Date.now() });
      return result;
    } catch (error) {
      console.warn('Wikipedia search failed:', error);
      return {
        query: term,
        results: [],
        totalResults: 0,
      };
    }
  }

  private async getPageInfoByTitle(
    title: string,
    language: string,
  ): Promise<{
    extract: string;
    url: string;
    thumbnail?: string;
  }> {
    try {
      const url = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

      const response = await this.request<{
        extract: string;
        content_urls: { desktop: { page: string } };
        thumbnail?: { source: string };
      }>(url);

      const thumbnail =
        (await this.toEmbeddableThumb(response.thumbnail?.source, language)) ||
        (await this.fetchPageImageThumb(title, language));

      return {
        extract: response.extract,
        url: response.content_urls.desktop.page,
        thumbnail,
      };
    } catch {
      const thumb = await this.fetchPageImageThumb(title, language);
      return {
        extract: '',
        url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        thumbnail: thumb,
      };
    }
  }

  private async fetchPageImageThumb(title: string, language: string): Promise<string | undefined> {
    try {
      const url =
        `https://${language}.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=thumbnail&pithumbsize=160` +
        `&titles=${encodeURIComponent(title)}&origin=*`;
      const response = await this.request<{
        query?: { pages?: Record<string, { thumbnail?: { source?: string } }> };
      }>(url);
      const pages = response.query?.pages || {};
      const first = Object.values(pages)[0];
      return this.toEmbeddableThumb(first?.thumbnail?.source, language);
    } catch {
      return undefined;
    }
  }

  /**
   * Fetch Wikimedia thumb into a data URL so the popup <img> does not depend on
   * renderer hotlink / Referer policy (common cause of broken placeholders).
   */
  private async toEmbeddableThumb(source: string | undefined, language: string): Promise<string | undefined> {
    if (!source) return undefined;
    if (source.startsWith('data:')) return source;
    const cached = this.thumbCache.get(source);
    if (cached) return cached;

    try {
      const response = await getHttp().requestBytes(source, {
        headers: {
          'User-Agent': WIKI_UA,
          Accept: 'image/*,*/*;q=0.8',
          Referer: `https://${language}.wikipedia.org/`,
        },
        timeoutMs: 8000,
      });
      if (!response.ok) return undefined;
      const ctype = response.contentType || 'image/jpeg';
      if (!ctype.startsWith('image/')) return undefined;
      const dataUrl = `data:${ctype};base64,${bytesToBase64(response.bytes)}`;
      if (this.thumbCache.size > 200) this.thumbCache.clear();
      this.thumbCache.set(source, dataUrl);
      return dataUrl;
    } catch (error) {
      console.warn('Wikipedia thumb fetch failed', source, error);
      return undefined;
    }
  }

  private stripWikiHtml(html: string): string {
    return (html || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
  }

  async getRandomArticle(language: string = 'en'): Promise<WikipediaResult | null> {
    try {
      const url = `https://${language}.wikipedia.org/api/rest_v1/page/random/summary`;

      const response = await this.request<{
        title: string;
        extract: string;
        content_urls: { desktop: { page: string } };
        pageid: number;
        thumbnail?: { source: string };
      }>(url);

      return {
        title: response.title,
        extract: response.extract,
        url: response.content_urls.desktop.page,
        language,
        pageId: response.pageid,
        thumbnail: await this.toEmbeddableThumb(response.thumbnail?.source, language),
      };
    } catch (error) {
      console.warn('Failed to get random Wikipedia article:', error);
      return null;
    }
  }

  async getCategories(pageId: number, language: string = 'en'): Promise<string[]> {
    try {
      const url = `https://${language}.wikipedia.org/w/api.php?action=query&format=json&prop=categories&pageids=${pageId}&cllimit=10&origin=*`;

      const response = await this.request<{
        query: {
          pages: {
            [key: string]: {
              categories?: Array<{ title: string }>;
            };
          };
        };
      }>(url);

      const page = response.query.pages[pageId];
      return page.categories?.map((cat) => cat.title.replace('Category:', '')) || [];
    } catch (error) {
      console.warn('Failed to get categories:', error);
      return [];
    }
  }

  async getRelatedArticles(pageId: number, language: string = 'en', limit: number = 5): Promise<WikipediaResult[]> {
    try {
      const url = `https://${language}.wikipedia.org/w/api.php?action=query&format=json&prop=links&pageids=${pageId}&pllimit=${limit}&origin=*`;

      const response = await this.request<{
        query: {
          pages: {
            [key: string]: {
              links?: Array<{ title: string }>;
            };
          };
        };
      }>(url);

      const page = response.query.pages[pageId];
      if (!page.links) return [];

      const related: WikipediaResult[] = [];
      for (const link of page.links.slice(0, limit)) {
        const info = await this.getPageInfoByTitle(link.title, language);
        related.push({
          title: link.title,
          extract: info.extract,
          url: info.url,
          language,
          pageId: 0,
          thumbnail: info.thumbnail,
        });
      }
      return related;
    } catch (error) {
      console.warn('Failed to get related articles:', error);
      return [];
    }
  }

  /**
   * Title search (multiple hits). `search()` prefers an exact REST summary and
   * often returns a single card; the Wikipedia tab wants a list like desktop.
   */
  async searchHits(term: string, language: string = 'en', limit: number = 5): Promise<WikipediaSearchResult> {
    const q = (term || '').trim();
    if (!q) return { query: term, results: [], totalResults: 0 };
    return this.searchAPI(q, language, limit);
  }

  /**
   * Parsoid HTML for an in-app article reader (Wikipedia refuses iframe embedding).
   */
  async fetchArticleHtml(title: string, language: string = 'en'): Promise<string> {
    const slug = encodeURIComponent(String(title || '').trim().replace(/ /g, '_'));
    if (!slug) throw new DictionaryError('No Wikipedia title', 'WIKI_TITLE', false);
    const url = `https://${language}.wikipedia.org/api/rest_v1/page/html/${slug}`;
    const response = await getHttp().requestText(url, {
      headers: {
        Accept: 'text/html; charset=utf-8; profile="https://www.mediawiki.org/wiki/Specs/HTML/2.1.0"',
        'Api-User-Agent': 'Phevere/1.5 (https://github.com/thd2020/phevere)',
        'User-Agent': WIKI_UA,
      },
      timeoutMs: 20_000,
    });
    if (!response.ok || !response.text) {
      throw new DictionaryError(
        `Wikipedia article HTTP ${response.status}`,
        `HTTP_${response.status}`,
        response.status >= 500,
      );
    }
    return wrapWikipediaDocument(response.text, language, title);
  }

  clearCache(): void {
    this.cache.clear();
    this.thumbCache.clear();
  }

  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }
}

export const wikipediaService = new WikipediaService();
