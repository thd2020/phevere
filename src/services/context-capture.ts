/**
 * Shared context-capture contract (docs/OCR_CONTEXT_CAPTURE.md Phase 0).
 *
 * Selection, OCR, media-session, and clipboard producers all emit ContextEvent.
 * The main process hub decides whether to open the lookup popup.
 */

export type ContextOrigin = 'selection' | 'ocr' | 'media' | 'clipboard' | 'manual';

export interface ContextBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContextEvent {
  text: string;
  x: number;
  y: number;
  timestamp: number;
  origin: ContextOrigin;
  /** OCR / fuzzy confidence in [0, 1]. */
  confidence?: number;
  bounds?: ContextBounds;
  /** Cache key for captured bitmaps. */
  imageHash?: string;
}

/** @deprecated Prefer ContextEvent; kept for gradual migration. */
export type SelectionEvent = ContextEvent & {
  origin: 'selection' | 'manual';
  /** Legacy alias used by older call sites. */
  source?: 'native' | 'manual';
};

export type ContextHandler = (event: ContextEvent) => void;

export function selectionToContext(
  text: string,
  x: number,
  y: number,
  source: 'native' | 'manual' = 'native'
): ContextEvent {
  return {
    text,
    x,
    y,
    timestamp: Date.now(),
    origin: source === 'manual' ? 'manual' : 'selection',
  };
}

/**
 * Fan-in hub: producers call `emit`, orchestration registers one (or more) handlers.
 */
export class ContextCaptureHub {
  private handlers: ContextHandler[] = [];
  private lastEvent: ContextEvent | null = null;

  onContext(handler: ContextHandler): void {
    this.handlers.push(handler);
  }

  emit(event: ContextEvent): void {
    this.lastEvent = event;
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[context-capture] handler error:', error);
      }
    }
  }

  getLastEvent(): ContextEvent | null {
    return this.lastEvent;
  }

  clear(): void {
    this.lastEvent = null;
  }
}

export const contextCaptureHub = new ContextCaptureHub();
