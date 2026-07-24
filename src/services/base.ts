import fetch, { RequestInit } from 'node-fetch';
import { net } from 'electron';

export class DictionaryError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'DictionaryError';
  }
}

export abstract class BaseService {
  protected async request<T>(url: string, options?: RequestInit): Promise<T> {
    try {
      const response = await net.fetch(url, {
        ...options, // Spread first to prevent overwriting custom headers
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ...(options?.headers as Record<string, string>),
        },
      } as any); // <-- 'as any' resolves the SharedArrayBuffer vs ArrayBuffer DOM clash

      if (!response.ok) {
        throw new DictionaryError(
          `HTTP ${response.status}: ${response.statusText}`,
          `HTTP_${response.status}`,
          response.status >= 500
        );
      }

      return await response.json() as T;
    } catch (error) {
      if (error instanceof DictionaryError) {
        throw error;
      }
      throw new DictionaryError(
        `Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NETWORK_ERROR',
        true
      );
    }
  }

  protected handleError(error: any): never {
    console.error('Service error:', error);
    throw error;
  }
} 