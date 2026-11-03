/**
 * Display names for word books: the shipped catalog, plus the books the learner made, which the
 * Words context registers whenever it is rebuilt. Kept apart from wordbooks.ts so list rows can
 * name a book without loading the word lists.
 */
import { WORDBOOK_CATALOG } from './wordbook-catalog';

export interface BookName {
  title: string;
  short: string;
}

const CATALOG = new Map<string, BookName>(WORDBOOK_CATALOG.map((b) => [b.id, { title: b.title, short: b.short }]));
const made = new Map<string, BookName>();

/** A short label for a switcher chip or a badge. */
export function shortBookTitle(title: string): string {
  const t = String(title || '').trim();
  return t.length > 18 ? `${t.slice(0, 17).trimEnd()}…` : t;
}

export function setMadeBookNames(books: Array<{ bookId: string; title: string; deleted?: boolean }>): void {
  made.clear();
  for (const b of books) if (!b.deleted) made.set(b.bookId, { title: b.title, short: shortBookTitle(b.title) });
}

export function bookName(id: string): BookName | undefined {
  return CATALOG.get(id) || made.get(id);
}
