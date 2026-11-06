import {
  ankiTextFromBook,
  decodeBookFile,
  exportBookFile,
  isBookFile,
  isZip,
  parseAnkiPackage,
  parseAnkiText,
  type BookPayload,
  type BookScope,
} from '@phevere/core';
import { openSqliteBytes } from './sqljs-vocab-db';
import type { VocabAddInput, VocabEntry } from '@phevere/core';
import { addVocab, listVocab, t } from '@phevere/core';
import { hasNativeBridge, nativeCall } from './native';

export function vocabEntriesToCsv(entries: VocabEntry[]): string {
  const cols = [
    'lemma',
    'reading',
    'partOfSpeech',
    'sourceLang',
    'targetLang',
    'definition',
    'note',
    'sources',
    'createdAt',
    'updatedAt',
  ] as const;
  const esc = (value: unknown): string => {
    const s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const rows = entries.map((entry) =>
    cols
      .map((col) => {
        if (col === 'sources') return esc((entry.sources || []).join('|'));
        return esc(entry[col]);
      })
      .join(','),
  );
  return [cols.join(','), ...rows].join('\r\n');
}

function parseCsvRecords(raw: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  let closedQuote = false;
  let recordStarted = false;
  const endField = () => {
    row.push(cur);
    cur = '';
    closedQuote = false;
  };
  const endRecord = () => {
    // Ignore physical blank lines, but retain explicitly empty CSV fields.
    if (recordStarted) {
      endField();
      records.push(row);
    }
    row = [];
    recordStarted = false;
  };
  const text = raw.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
        closedQuote = true;
      } else cur += ch;
    } else if (ch === ',') {
      endField();
      recordStarted = true;
    } else if (ch === '\r' || ch === '\n') {
      endRecord();
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
    } else {
      if (closedQuote || (ch === '"' && cur.length > 0)) {
        throw new Error(t('mobile.import.csv.badQuote', { record: records.length + 1 }));
      }
      recordStarted = true;
      if (ch === '"') inQuotes = true;
      else cur += ch;
    }
  }
  if (inQuotes) throw new Error(t('mobile.import.csv.unterminated'));
  endRecord();
  return records;
}

function vocabRowToInput(row: Record<string, unknown>): VocabAddInput {
  const sourcesRaw = row.sources;
  let sources: string[] | undefined;
  if (Array.isArray(sourcesRaw)) sources = sourcesRaw.map(String);
  else if (typeof sourcesRaw === 'string' && sourcesRaw.trim()) {
    sources = sourcesRaw.split(/[|,]/).map((s) => s.trim()).filter(Boolean);
  }
  return {
    lemma: String(row.lemma || '').trim(),
    reading: row.reading ? String(row.reading) : undefined,
    definition: row.definition ? String(row.definition) : undefined,
    partOfSpeech: row.partOfSpeech ? String(row.partOfSpeech) : undefined,
    sourceLang: row.sourceLang ? String(row.sourceLang) : undefined,
    targetLang: row.targetLang ? String(row.targetLang) : undefined,
    sources,
    note: row.note ? String(row.note) : undefined,
  };
}

export function vocabEntriesFromJson(raw: string): VocabAddInput[] {
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : parsed?.entries;
  if (!Array.isArray(list)) throw new Error(t('mobile.import.json.notArray'));
  return list.map((row: Record<string, unknown>) => vocabRowToInput(row));
}

export function vocabEntriesFromCsv(raw: string): VocabAddInput[] {
  const records = parseCsvRecords(raw);
  if (!records.length) return [];
  const headers = records[0].map((h) => h.trim());
  if (!headers.includes('lemma') || headers.some((h) => !h) || new Set(headers).size !== headers.length) {
    throw new Error(t('mobile.import.csv.headers'));
  }
  const out: VocabAddInput[] = [];
  for (let i = 1; i < records.length; i++) {
    const cols = records[i];
    if (cols.length !== headers.length) {
      throw new Error(t('mobile.import.csv.columns', { record: i + 1 }));
    }
    const row: Record<string, string> = Object.create(null);
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? '';
    });
    out.push(vocabRowToInput(row));
  }
  return out;
}

export async function importNotebookText(name: string, raw: string): Promise<{ imported: number; skipped: number }> {
  const rows = name.toLowerCase().endsWith('.csv') ? vocabEntriesFromCsv(raw) : vocabEntriesFromJson(raw);
  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      if (!row.lemma?.trim()) {
        skipped += 1;
        continue;
      }
      await addVocab(row);
      imported += 1;
    } catch {
      skipped += 1;
    }
  }
  return { imported, skipped };
}

/* ------------------------------------------------------ word book files */

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function saveBytes(name: string, bytes: Uint8Array | null, text: string | null, mime: string): Promise<void> {
  if (hasNativeBridge()) {
    await nativeCall('saveFile', bytes ? { name, mime, b64: bytesToB64(bytes) } : { name, mime, text: text || '' });
    return;
  }
  const blob = new Blob([bytes ? (bytes as BlobPart) : text || ''], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** The book being viewed as one .pvbook, or as Anki's text format. Returns the file name. */
export async function exportBook(scope: BookScope, anki: boolean): Promise<string> {
  const file = await exportBookFile(scope, 'Phevere');
  if (anki) {
    const name = file.fileName.replace(/\.pvbook$/, ' (Anki).txt');
    await saveBytes(name, null, ankiTextFromBook(await decodeBookFile(file.bytes)), 'text/plain');
    return name;
  }
  await saveBytes(file.fileName, file.bytes, null, 'application/octet-stream');
  return file.fileName;
}

/** A picked file as a book: .pvbook, Anki .apkg or .txt. Null for an older .json or .csv export. */
export async function bookPayloadFromPicked(name: string, b64: string, text: string): Promise<BookPayload | null> {
  const bytes = b64 ? b64ToBytes(b64) : new TextEncoder().encode(text);
  if (isBookFile(bytes)) return decodeBookFile(bytes);
  if (isZip(bytes)) return parseAnkiPackage(bytes, openSqliteBytes, name);
  if (/\.txt$/i.test(name)) return parseAnkiText(text || new TextDecoder().decode(bytes), name);
  return null;
}
