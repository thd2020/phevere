import type { VocabAddInput, VocabEntry } from '@phevere/core';
import { addVocab, listVocab } from '@phevere/core';
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
        throw new Error('Invalid CSV: unexpected character or quote in record ' + (records.length + 1));
      }
      recordStarted = true;
      if (ch === '"') inQuotes = true;
      else cur += ch;
    }
  }
  if (inQuotes) throw new Error('Invalid CSV: unterminated quoted field');
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
  if (!Array.isArray(list)) throw new Error('JSON notebook must be an array (or { entries: [] })');
  return list.map((row: Record<string, unknown>) => vocabRowToInput(row));
}

export function vocabEntriesFromCsv(raw: string): VocabAddInput[] {
  const records = parseCsvRecords(raw);
  if (!records.length) return [];
  const headers = records[0].map((h) => h.trim());
  if (!headers.includes('lemma') || headers.some((h) => !h) || new Set(headers).size !== headers.length) {
    throw new Error('Invalid CSV: expected unique, non-empty headers including lemma');
  }
  const out: VocabAddInput[] = [];
  for (let i = 1; i < records.length; i++) {
    const cols = records[i];
    if (cols.length !== headers.length) {
      throw new Error('Invalid CSV: column count does not match headers in record ' + (i + 1));
    }
    const row: Record<string, string> = Object.create(null);
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? '';
    });
    out.push(vocabRowToInput(row));
  }
  return out;
}

export async function exportNotebook(format: 'json' | 'csv'): Promise<string> {
  const entries = await listVocab(10_000);
  const body = format === 'csv' ? vocabEntriesToCsv(entries) : JSON.stringify(entries, null, 2);
  const name = format === 'csv' ? 'phevere-notebook.csv' : 'phevere-notebook.json';
  const mime = format === 'csv' ? 'text/csv' : 'application/json';
  if (hasNativeBridge()) {
    await nativeCall('saveFile', { name, mime, text: body });
    return name;
  }
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return name;
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
