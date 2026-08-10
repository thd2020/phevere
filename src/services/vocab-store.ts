/**
 * Vocabulary notebook — Anki-light local saves for retrospect.
 * AI card enrichment is optional later (note field reserved).
 */

import { randomUUID } from 'crypto';
import { getLocalDb, getLocalDbInitError, queryAll, queryOne, runWrite } from './local-db';

export interface VocabEntry {
  id: string;
  lemma: string;
  reading?: string;
  definition?: string;
  partOfSpeech?: string;
  sourceLang?: string;
  targetLang?: string;
  sources?: string[];
  note?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  reviewDue?: number;
  reviewInterval?: number;
  ease?: number;
  reps?: number;
}

export interface VocabAddInput {
  lemma: string;
  reading?: string;
  definition?: string;
  partOfSpeech?: string;
  sourceLang?: string;
  targetLang?: string;
  sources?: string[];
  note?: string;
  tags?: string[];
}

function rowToEntry(row: Record<string, unknown>): VocabEntry {
  return {
    id: String(row.id),
    lemma: String(row.lemma || ''),
    reading: row.reading ? String(row.reading) : undefined,
    definition: row.definition ? String(row.definition) : undefined,
    partOfSpeech: row.part_of_speech ? String(row.part_of_speech) : undefined,
    sourceLang: row.source_lang ? String(row.source_lang) : undefined,
    targetLang: row.target_lang ? String(row.target_lang) : undefined,
    sources: row.sources ? JSON.parse(String(row.sources)) : undefined,
    note: row.note ? String(row.note) : undefined,
    tags: row.tags ? JSON.parse(String(row.tags)) : undefined,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    reviewDue: row.review_due != null ? Number(row.review_due) : undefined,
    reviewInterval: row.review_interval != null ? Number(row.review_interval) : undefined,
    ease: row.ease != null ? Number(row.ease) : undefined,
    reps: row.reps != null ? Number(row.reps) : undefined,
  };
}

export async function ensureVocabReady(): Promise<void> {
  try {
    await getLocalDb();
  } catch (error) {
    const detail = getLocalDbInitError() || (error instanceof Error ? error.message : String(error));
    throw new Error(`Notebook database unavailable: ${detail}`);
  }
}

function newId(): string {
  try {
    return randomUUID();
  } catch {
    return `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export async function addVocab(input: VocabAddInput): Promise<VocabEntry> {
  await ensureVocabReady();
  const lemma = (input.lemma || '').trim();
  if (!lemma) throw new Error('lemma required');

  const existing = queryOne(
    `SELECT * FROM vocab WHERE lower(lemma) = lower(?) ORDER BY updated_at DESC LIMIT 1`,
    [lemma],
  );
  const now = Date.now();

  if (existing) {
    const id = String(existing.id);
    runWrite(
      `UPDATE vocab SET definition = COALESCE(?, definition), part_of_speech = COALESCE(?, part_of_speech),
       sources = COALESCE(?, sources), note = COALESCE(?, note), updated_at = ? WHERE id = ?`,
      [
        input.definition || null,
        input.partOfSpeech || null,
        input.sources ? JSON.stringify(input.sources) : null,
        input.note || null,
        now,
        id,
      ],
    );
    const updated = getVocab(id);
    if (!updated) throw new Error('Failed to reload saved entry');
    return updated;
  }

  const id = newId();
  runWrite(
    `INSERT INTO vocab (id, lemma, reading, definition, part_of_speech, source_lang, target_lang, sources, note, tags, created_at, updated_at, review_due, review_interval, ease, reps)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 2.5, 0)`,
    [
      id,
      lemma,
      input.reading || null,
      input.definition || null,
      input.partOfSpeech || null,
      input.sourceLang || null,
      input.targetLang || null,
      input.sources ? JSON.stringify(input.sources) : null,
      input.note || null,
      input.tags ? JSON.stringify(input.tags) : null,
      now,
      now,
      now,
    ],
  );
  const created = getVocab(id);
  if (!created) throw new Error('Failed to reload saved entry');
  return created;
}

export function getVocab(id: string): VocabEntry | null {
  const row = queryOne(`SELECT * FROM vocab WHERE id = ?`, [id]);
  return row ? rowToEntry(row) : null;
}

export async function findByLemma(lemma: string): Promise<VocabEntry | null> {
  await ensureVocabReady();
  const q = (lemma || '').trim();
  if (!q) return null;
  const row = queryOne(`SELECT * FROM vocab WHERE lower(lemma) = lower(?) ORDER BY updated_at DESC LIMIT 1`, [q]);
  return row ? rowToEntry(row) : null;
}

export async function listVocab(limit = 200): Promise<VocabEntry[]> {
  await ensureVocabReady();
  const rows = queryAll(`SELECT * FROM vocab ORDER BY updated_at DESC LIMIT ?`, [limit]);
  return rows.map(rowToEntry);
}

export async function removeVocab(id: string): Promise<boolean> {
  await ensureVocabReady();
  runWrite(`DELETE FROM vocab WHERE id = ?`, [id]);
  return true;
}

export async function updateVocabNote(id: string, note: string): Promise<VocabEntry | null> {
  await ensureVocabReady();
  runWrite(`UPDATE vocab SET note = ?, updated_at = ? WHERE id = ?`, [note, Date.now(), id]);
  return getVocab(id);
}

/** Simple SM-2–ish grade: 1 again, 2 hard, 3 good, 4 easy. */
export async function reviewVocab(id: string, grade: 1 | 2 | 3 | 4): Promise<VocabEntry | null> {
  await ensureVocabReady();
  const row = queryOne(`SELECT * FROM vocab WHERE id = ?`, [id]);
  if (!row) return null;
  let ease = Number(row.ease) || 2.5;
  let interval = Number(row.review_interval) || 0;
  let reps = Number(row.reps) || 0;

  if (grade <= 1) {
    reps = 0;
    interval = 0;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 3;
    else interval = Math.max(1, Math.round(interval * ease));
    ease = Math.max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  }

  const due = Date.now() + interval * 24 * 60 * 60 * 1000;
  runWrite(
    `UPDATE vocab SET review_due = ?, review_interval = ?, ease = ?, reps = ?, updated_at = ? WHERE id = ?`,
    [due, interval, ease, reps, Date.now(), id],
  );
  return getVocab(id);
}
