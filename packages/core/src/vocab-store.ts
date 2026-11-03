/**
 * Vocabulary notebook — Anki-light local saves for retrospect.
 * AI card enrichment is optional later (note field reserved).
 */

import { getDeviceName, getNewId, getVocabDb } from './runtime';
import { normalizeVocabLemma } from './vocab-lemma';
import { scheduleReview, type ReviewGrade } from './review-schedule';
import { sourceContextFromJson, sourceContextToJson, type SourceContext } from './source-context';
import { logGradedAnswer, type AnswerDetails } from './answer-history';

type VocabChangeListener = () => void;
const changeListeners = new Set<VocabChangeListener>();

/** Called after any local notebook edit (not after sync applies remote edits). Returns an unsubscribe. */
export function onVocabChanged(listener: VocabChangeListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** Word book edits (wordbook-store.ts) use the same signal, so they sync and repaint too. */
export function notifyVocabChanged(): void {
  notifyChanged();
}

function notifyChanged(): void {
  for (const listener of changeListeners) {
    try {
      listener();
    } catch {
      /* a listener must not break a save */
    }
  }
}

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
  /** FSRS memory state (see review-schedule.ts). Absent on rows an older app wrote. */
  stability?: number;
  difficulty?: number;
  state?: number;
  lapses?: number;
  lastReview?: number;
  learningSteps?: number;
  /** The device the word was first saved on. */
  device?: string;
  /** Where the word was first saved: app, page or document, page number, sentence. */
  context?: SourceContext;
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
  /** Kept only when the word has no context yet; a later save never replaces it. */
  context?: SourceContext | null;
}

export function rowToEntry(row: Record<string, unknown>): VocabEntry {
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
    stability: row.stability != null ? Number(row.stability) : undefined,
    difficulty: row.difficulty != null ? Number(row.difficulty) : undefined,
    state: row.state != null ? Number(row.state) : undefined,
    lapses: row.lapses != null ? Number(row.lapses) : undefined,
    lastReview: row.last_review != null ? Number(row.last_review) : undefined,
    learningSteps: row.learning_steps != null ? Number(row.learning_steps) : undefined,
    device: row.device ? String(row.device) : undefined,
    context: sourceContextFromJson(row.context),
  };
}

export async function ensureVocabReady(): Promise<void> {
  const db = getVocabDb();
  try {
    await db.ready();
  } catch (error) {
    const detail = db.initError() || (error instanceof Error ? error.message : String(error));
    throw new Error(`Notebook database unavailable: ${detail}`);
  }
}

export async function addVocab(input: VocabAddInput): Promise<VocabEntry> {
  await ensureVocabReady();
  const db = getVocabDb();
  const lemma = normalizeVocabLemma(input.lemma || '', { pos: input.partOfSpeech, lang: input.sourceLang });
  if (!lemma) throw new Error('lemma required');

  const existing = await db.queryOne(
    `SELECT * FROM vocab WHERE lower(lemma) = lower(?) ORDER BY updated_at DESC LIMIT 1`,
    [lemma],
  );
  const now = Date.now();

  if (existing) {
    const id = String(existing.id);
    await db.runWrite(
      `UPDATE vocab SET lemma = ?, definition = COALESCE(NULLIF(definition, ''), NULLIF(?, ''), definition),
       part_of_speech = COALESCE(NULLIF(part_of_speech, ''), NULLIF(?, ''), part_of_speech),
       sources = COALESCE(NULLIF(sources, ''), NULLIF(?, ''), sources),
       note = COALESCE(NULLIF(note, ''), NULLIF(?, ''), note),
       reading = COALESCE(NULLIF(reading, ''), NULLIF(?, ''), reading),
       source_lang = COALESCE(NULLIF(?, ''), source_lang),
       target_lang = COALESCE(NULLIF(?, ''), target_lang),
       context = COALESCE(NULLIF(context, ''), ?),
       updated_at = ? WHERE id = ?`,
      [
        lemma,
        input.definition || null,
        input.partOfSpeech || null,
        input.sources ? JSON.stringify(input.sources) : null,
        input.note || null,
        input.reading || null,
        input.sourceLang || null,
        input.targetLang || null,
        sourceContextToJson(input.context),
        now,
        id,
      ],
    );
    const updated = await getVocab(id);
    if (!updated) throw new Error('Failed to reload saved entry');
    notifyChanged();
    return updated;
  }

  const id = getNewId();
  await db.runWrite(
    `INSERT INTO vocab (id, lemma, reading, definition, part_of_speech, source_lang, target_lang, sources, note, tags, created_at, updated_at, review_due, review_interval, ease, reps, device, context)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 2.5, 0, ?, ?)`,
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
      getDeviceName() || null,
      sourceContextToJson(input.context),
    ],
  );
  const created = await getVocab(id);
  if (!created) throw new Error('Failed to reload saved entry');
  notifyChanged();
  return created;
}

/** Fill notebook rows that were saved as lemma-only, or that still lack IPA. */
export async function fillEmptyDefinitions(
  lemmas: string[],
  input: Omit<VocabAddInput, 'lemma'> & { lemma?: string },
): Promise<VocabEntry | null> {
  const incomingDef = String(input.definition || '').trim();
  const incomingReading = String(input.reading || '').trim();
  if (!incomingDef && !incomingReading) return null;
  const seen = new Set<string>();
  for (const raw of lemmas) {
    const lemma = (raw || '').trim();
    if (!lemma) continue;
    const key = lemma.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = await findByLemma(lemma);
    if (!existing) continue;
    const needsDef = !existing.definition || !existing.definition.trim();
    const needsReading = !existing.reading || !existing.reading.trim();
    if (!needsDef && !needsReading) continue;
    if (needsDef && !incomingDef && !needsReading) continue;
    if (!needsDef && needsReading && !incomingReading) continue;
    return addVocab({
      lemma: existing.lemma,
      reading: incomingReading || undefined,
      definition: incomingDef || undefined,
      partOfSpeech: input.partOfSpeech,
      sourceLang: input.sourceLang,
      targetLang: input.targetLang,
      sources: input.sources,
    });
  }
  return null;
}

export async function listEmptyDefinitions(limit = 80): Promise<VocabEntry[]> {
  await ensureVocabReady();
  const rows = await getVocabDb().queryAll(
    `SELECT * FROM vocab WHERE IFNULL(TRIM(definition), '') = '' ORDER BY updated_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(rowToEntry);
}

export async function listEmptyReadings(limit = 80): Promise<VocabEntry[]> {
  await ensureVocabReady();
  const rows = await getVocabDb().queryAll(
    `SELECT * FROM vocab WHERE IFNULL(TRIM(definition), '') != '' AND IFNULL(TRIM(reading), '') = '' ORDER BY updated_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(rowToEntry);
}

export async function getVocab(id: string): Promise<VocabEntry | null> {
  const row = await getVocabDb().queryOne(`SELECT * FROM vocab WHERE id = ?`, [id]);
  return row ? rowToEntry(row) : null;
}

export async function findByLemma(lemma: string): Promise<VocabEntry | null> {
  await ensureVocabReady();
  const q = (lemma || '').trim();
  if (!q) return null;
  const row = await getVocabDb().queryOne(
    `SELECT * FROM vocab WHERE lower(lemma) = lower(?) ORDER BY updated_at DESC LIMIT 1`,
    [q],
  );
  return row ? rowToEntry(row) : null;
}

let lemmaMigration: (() => Promise<unknown>) | null = null;
let lemmaMigrationRun: Promise<unknown> | null = null;

/** Registered by vocab-sync: puts saved headwords in dictionary form once per launch. */
export function registerLemmaMigration(fn: () => Promise<unknown>): void {
  lemmaMigration = fn;
}

export async function listVocab(limit = 200): Promise<VocabEntry[]> {
  if (lemmaMigration && !lemmaMigrationRun) {
    lemmaMigrationRun = lemmaMigration().catch((err) => console.warn('[vocab] lemma normalization skipped', err));
  }
  if (lemmaMigrationRun) await lemmaMigrationRun;
  await ensureVocabReady();
  const rows = await getVocabDb().queryAll(`SELECT * FROM vocab ORDER BY updated_at DESC LIMIT ?`, [limit]);
  return rows.map(rowToEntry);
}

export async function removeVocab(id: string): Promise<boolean> {
  await ensureVocabReady();
  const db = getVocabDb();
  await db.runWrite(`DELETE FROM vocab WHERE id = ?`, [id]);
  // The tombstone carries the deletion to other devices (see vocab-sync.ts).
  await db.runWrite(`INSERT OR REPLACE INTO vocab_deleted (id, deleted_at) VALUES (?, ?)`, [id, Date.now()]);
  notifyChanged();
  return true;
}

/**
 * Records where a saved word was met, when the row has no context yet. Desktop capture finishes
 * after the save (it never holds up the pop-up), so it lands here. Returns the row when it changed.
 */
export async function setVocabContextIfEmpty(id: string, context: SourceContext | null | undefined, now = Date.now()): Promise<VocabEntry | null> {
  const json = sourceContextToJson(context);
  if (!json) return null;
  await ensureVocabReady();
  const db = getVocabDb();
  const row = await db.queryOne(`SELECT context FROM vocab WHERE id = ?`, [id]);
  if (!row || (row.context != null && String(row.context) !== '')) return null;
  await db.runWrite(`UPDATE vocab SET context = ?, updated_at = ? WHERE id = ?`, [json, now, id]);
  notifyChanged();
  return getVocab(id);
}

export async function updateVocabNote(id: string, note: string): Promise<VocabEntry | null> {
  await ensureVocabReady();
  await getVocabDb().runWrite(`UPDATE vocab SET note = ?, updated_at = ? WHERE id = ?`, [note, Date.now(), id]);
  notifyChanged();
  return getVocab(id);
}

/**
 * One review graded 1 Again, 2 Hard, 3 Good or 4 Easy, scheduled with FSRS and recorded in the
 * answer history with what the shell knows about the question (`details`).
 */
export async function reviewVocab(id: string, grade: ReviewGrade, now = Date.now(), details: AnswerDetails = {}): Promise<VocabEntry | null> {
  await ensureVocabReady();
  const db = getVocabDb();
  const row = await db.queryOne(`SELECT * FROM vocab WHERE id = ?`, [id]);
  if (!row) return null;
  const before = rowToEntry(row);
  const next = scheduleReview(before, grade, now);
  await db.runWrite(
    `UPDATE vocab SET review_due = ?, review_interval = ?, ease = ?, reps = ?, stability = ?, difficulty = ?, state = ?, lapses = ?,
     last_review = ?, learning_steps = ?, updated_at = ? WHERE id = ?`,
    [
      next.reviewDue,
      next.reviewInterval,
      next.ease,
      next.reps,
      next.stability,
      next.difficulty,
      next.state,
      next.lapses,
      next.lastReview,
      next.learningSteps,
      now,
      id,
    ],
  );
  await logGradedAnswer(before.lemma, grade, now, before, details, id);
  notifyChanged();
  return getVocab(id);
}
