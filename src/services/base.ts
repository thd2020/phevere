import fetch, { RequestInit } from 'node-fetch';

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
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        ...options,
      });

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