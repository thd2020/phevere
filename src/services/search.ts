export interface SearchSuggestion {
  text: string;
  type: 'suggestion' | 'related' | 'autocomplete';
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

import { BaseService } from './base';

export interface SearchResponse {
  query: string;
  suggestions: SearchSuggestion[];
  results: SearchResult[];
  totalResults: number;
}

export class SearchService extends BaseService {
  private cache = new Map<string, { result: SearchResponse; timestamp: number }>();
  private cacheTimeout = 30 * 60 * 1000; // 30 minutes

  /**
   * Get search suggestions for a query
   */
  async getSuggestions(query: string): Promise<SearchSuggestion[]> {
    if (!query.trim()) return [];

    try {
      // Use Google's autocomplete API
      const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`;
      
      const response = await this.request<[string, string[], any[], any[]]>(url);
      
      if (response && response[1]) {
        return response[1].map((suggestion: string) => ({
          text: suggestion,
          type: 'suggestion' as const
        }));
      }
      
      return [];
    } catch (error) {
      console.warn('Failed to get search suggestions:', error);
      return this.generateMockSuggestions(query);
    }
  }

  /**
   * Search for a query and get results
   */
  async search(query: string, limit: number = 5): Promise<SearchResponse> {
    const cacheKey = `${query.toLowerCase()}_${limit}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.result;
    }

    try {
      // Get suggestions
      const suggestions = await this.getSuggestions(query);
      
      // For now, return mock results since Google Search API requires API key
      const results = this.generateMockResults(query, limit);
      
      const response: SearchResponse = {
        query,
        suggestions,
        results,
        totalResults: results.length
      };

      // Cache the result
      this.cache.set(cacheKey, { result: response, timestamp: Date.now() });
      
      return response;
    } catch (error) {
      console.warn('Search failed:', error);
      return {
        query,
        suggestions: [],
        results: [],
        totalResults: 0
      };
    }
  }

  /**
   * Get related searches for a query
   */
  async getRelatedSearches(query: string): Promise<SearchSuggestion[]> {
    try {
      // Get suggestions and filter for related terms
      const suggestions = await this.getSuggestions(query);
      
      return suggestions
        .filter(s => s.text.toLowerCase() !== query.toLowerCase())
        .slice(0, 5)
        .map(s => ({ ...s, type: 'related' as const }));
    } catch (error) {
      console.warn('Failed to get related searches:', error);
      return [];
    }
  }

  /**
   * Generate mock search suggestions for development
   */
  private generateMockSuggestions(query: string): SearchSuggestion[] {
    const mockSuggestions: Record<string, string[]> = {
      'hello': ['hello world', 'hello kitty', 'hello fresh', 'hello neighbor'],
      'world': ['world war', 'world cup', 'world map', 'world news'],
      'python': ['python programming', 'python tutorial', 'python download', 'python examples'],
      'javascript': ['javascript tutorial', 'javascript examples', 'javascript array', 'javascript functions'],
      'rust': ['rust programming', 'rust tutorial', 'rust vs go', 'rust game'],
      'electron': ['electron app', 'electron tutorial', 'electron vs react', 'electron security']
    };

    const lowerQuery = query.toLowerCase();
    const suggestions = mockSuggestions[lowerQuery] || [
      `${query} tutorial`,
      `${query} examples`,
      `${query} guide`,
      `${query} documentation`
    ];

    return suggestions.map(suggestion => ({
      text: suggestion,
      type: 'suggestion' as const
    }));
  }

  /**
   * Generate mock search results for development
   */
  private generateMockResults(query: string, limit: number): SearchResult[] {
    const mockResults: Record<string, SearchResult[]> = {
      'hello': [
        {
          title: 'Hello - Wikipedia',
          url: 'https://en.wikipedia.org/wiki/Hello',
          snippet: 'Hello is a salutation or greeting in the English language. It is first attested in writing from 1826.',
          source: 'wikipedia.org'
        },
        {
          title: 'Hello World - Wikipedia',
          url: 'https://en.wikipedia.org/wiki/Hello_world',
          snippet: 'A "Hello, World!" program is a computer program that outputs or displays "Hello, World!" to a user.',
          source: 'wikipedia.org'
        }
      ],
      'python': [
        {
          title: 'Python (programming language) - Wikipedia',
          url: 'https://en.wikipedia.org/wiki/Python_(programming_language)',
          snippet: 'Python is a high-level, interpreted programming language. Its design philosophy emphasizes code readability.',
          source: 'wikipedia.org'
        },
        {
          title: 'Welcome to Python.org',
          url: 'https://www.python.org/',
          snippet: 'The official home of the Python Programming Language. Download Python, learn Python tutorials.',
          source: 'python.org'
        }
      ],
      'javascript': [
        {
          title: 'JavaScript - Wikipedia',
          url: 'https://en.wikipedia.org/wiki/JavaScript',
          snippet: 'JavaScript, often abbreviated as JS, is a programming language that is one of the core technologies.',
          source: 'wikipedia.org'
        },
        {
          title: 'JavaScript Tutorial - W3Schools',
          url: 'https://www.w3schools.com/js/',
          snippet: 'JavaScript is the programming language of the Web. JavaScript is easy to learn.',
          source: 'w3schools.com'
        }
      ]
    };

    const lowerQuery = query.toLowerCase();
    const results = mockResults[lowerQuery] || [
      {
        title: `${query} - Search Results`,
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        snippet: `Search results for "${query}". Click to view more information about this topic.`,
        source: 'google.com'
      },
      {
        title: `${query} - Wikipedia`,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`,
        snippet: `Wikipedia article about ${query}. Learn more about this topic from the free encyclopedia.`,
        source: 'wikipedia.org'
      }
    ];

    return results.slice(0, limit);
  }

  /**
   * Get trending searches (mock implementation)
   */
  async getTrendingSearches(): Promise<SearchSuggestion[]> {
    const trending = [
      'artificial intelligence',
      'climate change',
      'space exploration',
      'renewable energy',
      'quantum computing',
      'blockchain technology',
      'machine learning',
      'virtual reality',
      'cybersecurity',
      'sustainable development'
    ];

    return trending.map(term => ({
      text: term,
      type: 'suggestion' as const
    }));
  }

  /**
   * Get search statistics for a query
   */
  async getSearchStats(query: string): Promise<{
    estimatedResults: number;
    searchTime: number;
    relatedQueries: string[];
  }> {
    try {
      const suggestions = await this.getSuggestions(query);
      
      return {
        estimatedResults: Math.floor(Math.random() * 1000000) + 1000,
        searchTime: Math.random() * 2 + 0.1,
        relatedQueries: suggestions.slice(0, 5).map(s => s.text)
      };
    } catch (error) {
      return {
        estimatedResults: 0,
        searchTime: 0,
        relatedQueries: []
      };
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
export const searchService = new SearchService(); 