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

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
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
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const out: VocabAddInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
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
