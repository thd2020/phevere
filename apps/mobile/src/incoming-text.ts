import { App } from '@capacitor/app';
import { ProcessText } from './plugins/process-text';

export type IncomingHandler = (text: string, origin: 'share' | 'process-text' | 'search') => void;

function queryFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const q = parsed.searchParams.get('q') || parsed.searchParams.get('text');
    return q ? decodeURIComponent(q).trim() : null;
  } catch {
    const m = url.match(/[?&]q=([^&]+)/);
    return m ? decodeURIComponent(m[1]).trim() : null;
  }
}

export function extractLookupQuery(raw: string): string {
  return (raw || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

export async function startIncomingText(onText: IncomingHandler): Promise<void> {
  const hashQ = queryFromUrl(window.location.href);
  if (hashQ) onText(extractLookupQuery(hashQ), 'search');

  App.addListener('appUrlOpen', (event) => {
    const q = queryFromUrl(event.url);
    if (q) onText(extractLookupQuery(q), 'share');
  });

  App.addListener('appStateChange', async ({ isActive }) => {
    if (!isActive) return;
    try {
      const pending = await ProcessText.getPendingText();
      if (pending.text) onText(extractLookupQuery(pending.text), 'process-text');
    } catch {
      /* web or plugin missing */
    }
  });

  try {
    const pending = await ProcessText.getPendingText();
    if (pending.text) onText(extractLookupQuery(pending.text), 'process-text');
  } catch {
    /* web */
  }

  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) {
      const q = queryFromUrl(launch.url);
      if (q) onText(extractLookupQuery(q), 'share');
    }
  } catch {
    /* web */
  }
}
