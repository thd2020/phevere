export interface WikipediaResult {
  title: string;
  extract: string;
  url: string;
  language: string;
  pageId: number;
  thumbnail?: string;
}

import { BaseService } from './base';

export interface WikipediaSearchResult {
  query: string;
  results: WikipediaResult[];
  totalResults: number;
}

export class WikipediaService extends BaseService {
  private cache = new Map<string, { result: WikipediaSearchResult; timestamp: number }>();
  private cacheTimeout = 60 * 60 * 1000; // 1 hour

  /**
   * Search Wikipedia for a term
   */
  async search(term: string, language: string = 'en', limit: number = 5): Promise<WikipediaSearchResult> {
    const cacheKey = `${term.toLowerCase()}_${language}_${limit}`;
    
    // Check cache first
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

      const result: WikipediaSearchResult = {
        query: term,
        results: [{
          title: response.title,
          extract: response.extract,
          url: response.content_urls.desktop.page,
          language,
          pageId: response.pageid,
          thumbnail: response.thumbnail?.source
        }],
        totalResults: 1
      };

      // Cache the result
      this.cache.set(cacheKey, { result, timestamp: Date.now() });
      
      return result;
    } catch (error) {
      // If direct page lookup fails, try search API
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
          // Get full page info for each result
          const pageInfo = await this.getPageInfo(item.pageid, language);
          return {
            title: item.title,
            extract: pageInfo.extract || item.snippet,
            url: pageInfo.url,
            language,
            pageId: item.pageid,
            thumbnail: pageInfo.thumbnail
          };
        })
      );

      const result: WikipediaSearchResult = {
        query: term,
        results,
        totalResults: response.query.searchinfo.totalhits
      };

      return result;
    } catch (error) {
      console.warn('Wikipedia search failed:', error);
      return {
        query: term,
        results: [],
        totalResults: 0
      };
    }
  }

  /**
   * Get detailed page information
   */
  private async getPageInfo(pageId: number, language: string): Promise<{
    extract: string;
    url: string;
    thumbnail?: string;
  }> {
    try {
      const url = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${pageId}`;
      
      const response = await this.request<{
        extract: string;
        content_urls: { desktop: { page: string } };
        thumbnail?: { source: string };
      }>(url);

      return {
        extract: response.extract,
        url: response.content_urls.desktop.page,
        thumbnail: response.thumbnail?.source
      };
    } catch (error) {
      return {
        extract: '',
        url: `https://${language}.wikipedia.org/wiki/Special:Search?search=${pageId}`,
        thumbnail: undefined
      };
    }
  }

  /**
   * Get random Wikipedia article
   */
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
        thumbnail: response.thumbnail?.source
      };
    } catch (error) {
      console.warn('Failed to get random Wikipedia article:', error);
      return null;
    }
  }

  /**
   * Get article categories
   */
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
      return page.categories?.map(cat => cat.title.replace('Category:', '')) || [];
    } catch (error) {
      console.warn('Failed to get categories:', error);
      return [];
    }
  }

  /**
   * Get related articles
   */
  async getRelatedArticles(pageId: number, language: string = 'en', limit: number = 5): Promise<WikipediaResult[]> {
    try {
      const url = `https://${language}.wikipedia.org/w/api.php?action=query&format=json&prop=links&pageids=${pageId}&pllimit=${limit}&origin=*`;
      
      const response = await this.request<{
        query: {
          pages: {
            [key: string]: {
              links?: Array<{ title: string; pageid: number }>;
            };
          };
        };
      }>(url);

      const page = response.query.pages[pageId];
      if (!page.links) return [];

      const results: WikipediaResult[] = [];
      for (const link of page.links.slice(0, limit)) {
        try {
          const pageInfo = await this.getPageInfo(link.pageid, language);
          results.push({
            title: link.title,
            extract: pageInfo.extract,
            url: pageInfo.url,
            language,
            pageId: link.pageid,
            thumbnail: pageInfo.thumbnail
          });
        } catch (error) {
          // Skip failed articles
          continue;
        }
      }

      return results;
    } catch (error) {
      console.warn('Failed to get related articles:', error);
      return [];
    }
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

// Export singleton instance
export const wikipediaService = new WikipediaService(); 