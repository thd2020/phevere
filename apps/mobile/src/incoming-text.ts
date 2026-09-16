export type IncomingOrigin = 'share' | 'process-text' | 'search' | 'ocr' | 'clipboard';
export type IncomingHandler = (text: string, origin: IncomingOrigin) => void;

export function extractLookupQuery(raw: string): string {
  return (raw || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function queryFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    const q = parsed.searchParams.get('q') || parsed.searchParams.get('text');
    return q ? decodeURIComponent(q).trim() : null;
  } catch {
    const m = url.match(/[?&]q=([^&]+)/);
    return m ? decodeURIComponent(m[1]).trim() : null;
  }
}

export function queryFromLocation(): string | null {
  const q = queryFromUrl(window.location.href);
  return q ? extractLookupQuery(q) : null;
}

export function startIncomingText(onText: IncomingHandler): void {
  window.__pvIncoming = (text, origin) => {
    const q = extractLookupQuery(text);
    if (q) onText(q, (origin as IncomingOrigin) || 'share');
  };
}
