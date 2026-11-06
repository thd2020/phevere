/**
 * Anki decks into Phevere books. Two inputs:
 *
 * - an .apkg package: a zip holding the collection as SQLite, `collection.anki21b` (zstd
 *   compressed, Anki 2.1.50 and later), `collection.anki21` or `collection.anki2` (older). A
 *   package from a new Anki also carries an anki2 stub whose only note says to update, so the
 *   newest collection in the zip wins.
 * - Anki's text export (.txt): one note per line, fields split by the separator its "#separator"
 *   header names (tab by default), with "#html", "#columns", "#deck" and "#tags" headers.
 *
 * The first field is taken as the word and the second as its meaning, as in Anki's Basic note
 * type. Each deck becomes a book the reader made, and the meanings fill the words' quiz answers.
 * Opening SQLite is the shell's job (sql.js on both), passed in as `openSqlite`.
 */
import { strFromU8, unzipSync } from 'fflate';
import { decompress as zstdDecompress } from 'fzstd';
import type { BookPayload, BookWord } from './book-file';
import { t } from './i18n/runtime';

export interface SqliteReader {
  all(sql: string): Array<Record<string, unknown>>;
  close(): void;
}

export type OpenSqlite = (bytes: Uint8Array) => Promise<SqliteReader>;

const FIELD_SEP = '\u001f';

/** Anki fields are HTML: keep the text, one space for each break. */
export function ankiFieldText(html: string): string {
  return String(html || '')
    .replace(/\[sound:[^\]]*\]/g, ' ')
    .replace(/<br\s*\/?>|<\/(div|p|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function toPayload(title: string, rows: Array<{ front: string; back: string }>, source: string): BookPayload {
  const seen = new Set<string>();
  const words: BookWord[] = [];
  for (const r of rows) {
    const lemma = ankiFieldText(r.front).slice(0, 120);
    const key = lemma.toLowerCase();
    if (!lemma || seen.has(key)) continue;
    seen.add(key);
    const definition = ankiFieldText(r.back).slice(0, 2000);
    words.push(definition ? { lemma, definition } : { lemma });
  }
  return {
    format: 'phevere-book',
    version: 1,
    exportedAt: Date.now(),
    app: 'Anki',
    book: { kind: 'user', id: '', title: title || t('notebook.books.ankiDeck'), source },
    words,
    answers: [],
  };
}

/** Anki's text export. `name` is the file name, used as the title when no deck is named. */
export function parseAnkiText(text: string, name = ''): BookPayload {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  let sep = '\t';
  let html = false;
  let deck = '';
  let deckCol = -1;
  let tagsCol = -1;
  const rows: Array<{ front: string; back: string }> = [];
  const SEPARATORS: Record<string, string> = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ', colon: ':' };
  for (const line of lines) {
    if (line.startsWith('#')) {
      const m = line.match(/^#([a-z ]+):(.*)$/i);
      if (!m) continue;
      const key = m[1].trim().toLowerCase();
      const val = m[2].trim();
      if (key === 'separator') sep = SEPARATORS[val.toLowerCase()] ?? (val.length === 1 ? val : sep);
      else if (key === 'html') html = val.toLowerCase() === 'true';
      else if (key === 'deck') deck = val;
      else if (key === 'deck column') deckCol = Number(val) - 1;
      else if (key === 'tags column') tagsCol = Number(val) - 1;
      continue;
    }
    if (!line.trim()) continue;
    const cells = splitLine(line, sep).filter((_, i) => i !== deckCol && i !== tagsCol);
    if (cells.length < 1) continue;
    const front = html ? cells[0] : escapeText(cells[0]);
    const back = html ? cells[1] || '' : escapeText(cells[1] || '');
    if (!deck && deckCol >= 0) deck = splitLine(line, sep)[deckCol] || '';
    rows.push({ front, back });
  }
  const title = deck.split('::').pop() || name.replace(/\.[^.]+$/, '');
  return toPayload(title, rows, 'anki');
}

function escapeText(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** One line of a delimited file, with double-quoted fields as Anki writes them. */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur === '') quoted = true;
    else if (c === sep) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** The collection bytes inside an .apkg, newest format first. */
export function ankiCollection(zip: Uint8Array): Uint8Array {
  const files = unzipSync(zip, { filter: (f) => /^collection\.anki2(1b?)?$/.test(f.name) });
  if (files['collection.anki21b']) return zstdDecompress(files['collection.anki21b']);
  if (files['collection.anki21']) return files['collection.anki21'];
  if (files['collection.anki2']) return files['collection.anki2'];
  throw new Error('No Anki collection in this file.');
}

/** The deck most notes sit in, by name, from either collection schema. */
function mainDeck(db: SqliteReader): string {
  let names = new Map<string, string>();
  try {
    for (const r of db.all('SELECT id, name FROM decks')) names.set(String(r.id), String(r.name));
  } catch {
    try {
      const col = db.all('SELECT decks FROM col')[0];
      const decks = JSON.parse(String(col?.decks || '{}'));
      names = new Map(Object.values(decks).map((d: any) => [String(d.id), String(d.name)]));
    } catch {
      /* no deck names */
    }
  }
  try {
    const top = db.all('SELECT did, COUNT(*) AS n FROM cards GROUP BY did ORDER BY n DESC LIMIT 1')[0];
    const raw = names.get(String(top?.did)) || '';
    // Newer collections separate nested deck names with \x1f, older ones with "::".
    return raw.split(/\u001f|::/).pop() || '';
  } catch {
    return '';
  }
}

/** An .apkg package as a Phevere book. */
export async function parseAnkiPackage(bytes: Uint8Array, openSqlite: OpenSqlite, name = ''): Promise<BookPayload> {
  const db = await openSqlite(ankiCollection(bytes));
  try {
    const notes = db.all('SELECT flds FROM notes ORDER BY id');
    const rows = notes.map((n) => {
      const fields = String(n.flds || '').split(FIELD_SEP);
      return { front: fields[0] || '', back: fields[1] || '' };
    });
    const title = mainDeck(db) || name.replace(/\.[^.]+$/, '');
    const payload = toPayload(title === 'Default' && name ? name.replace(/\.[^.]+$/, '') : title, rows, 'anki');
    if (!payload.words.length) throw new Error('This Anki deck has no notes.');
    return payload;
  } finally {
    db.close();
  }
}

/** True for a zip (an .apkg starts like any zip). */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export { strFromU8 as utf8FromBytes };

/**
 * A book as Anki's text import format: headers naming the separator, HTML and deck, then one
 * Basic note per word (the word on the front, its meaning on the back). Anki 2.1.55 and later
 * read the headers, so File, Import sets everything up.
 */
export function ankiTextFromBook(payload: BookPayload): string {
  const cell = (s: string) => {
    const v = String(s || '').replace(/\r?\n/g, '<br>');
    return /[\t"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const head = ['#separator:tab', '#html:true', '#notetype:Basic', `#deck:${payload.book.title.replace(/[\r\n]/g, ' ')}`, '#columns:Front\tBack'];
  const body = payload.words.map((w) => {
    const back = [w.reading ? `<i>${w.reading}</i>` : '', w.definition || ''].filter(Boolean).join('<br>');
    return `${cell(w.lemma)}\t${cell(back)}`;
  });
  return `${[...head, ...body].join('\n')}\n`;
}
