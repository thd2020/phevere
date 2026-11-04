/**
 * Notebook sync through the Holarky account ('phevere/vocab').
 *
 * Every row is a record { id, updatedAt, deleted, data }. A sync pushes rows and tombstones
 * changed since the last push, then pulls everything newer than the stored cursor. Both sides
 * keep the newest updatedAt per id; on a tie the server's copy wins, so devices converge.
 * The same word saved on two devices gets two ids; after each pull, rows sharing a lemma are
 * merged into the smallest id and the others become tombstones, the same way on every device.
 *
 * A record carries `context` (where the word was saved: page title, URL, sentence) only inside
 * this account's own namespace; nothing else ever sees it.
 * Records carry words only. Review progress (due date, interval, ease, FSRS memory state) is never
 * sent, and the server strips it from records an older app sends. A pulled record therefore keeps
 * the progress this device already has for the row. Progress itself syncs as the answer history in
 * 'phevere/progress' for Plus accounts (progress-sync.ts).
 */

import type { SyncChange, SyncResult } from './holarky-account';
import type { HttpClient } from './http';
import { getHttp, getVocabDb, isCoreConfigured } from './runtime';
import { ensureVocabReady, notifyVocabChanged, registerLemmaMigration, rowToEntry, type VocabEntry } from './vocab-store';
import { plainPluralOf, stripGlossText } from './lookup-policy';
import { normalizeVocabLemma, typoDistance } from './vocab-lemma';
import { formOfGlossLemma, formOfLemmaFromGlosses, isRegularInflection, resolveFormOf, stripCitationLines } from './form-of';
import { foldLookupKey, latinLemmasByPos } from './text-normalize';
import { normalizeSourceContext, sourceContextFromJson, sourceContextToJson } from './source-context';

export const VOCAB_SYNC_NAMESPACE = 'phevere/vocab';
const PAGE = 500;

type SyncRecord = SyncChange<Partial<VocabEntry>>;

/** Review progress fields of a notebook row: kept on the device, never sent in 'phevere/vocab'. */
export const VOCAB_PROGRESS_KEYS = ['reviewDue', 'reviewInterval', 'ease', 'reps', 'stability', 'difficulty', 'state', 'lapses', 'lastReview', 'learningSteps'] as const;
type Progress = Pick<VocabEntry, (typeof VOCAB_PROGRESS_KEYS)[number]>;

function progressOf(e: Partial<VocabEntry>): Partial<Progress> {
  const out: Partial<Progress> = {};
  for (const k of VOCAB_PROGRESS_KEYS) if (e[k] != null) out[k] = e[k] as number;
  return out;
}

function withoutProgress(e: Partial<VocabEntry>): Partial<VocabEntry> {
  const out: Partial<VocabEntry> = { ...e };
  for (const k of VOCAB_PROGRESS_KEYS) delete out[k];
  return out;
}

function hasProgress(e: Partial<VocabEntry>): boolean {
  return Number(e.reps) > 0 || e.lastReview != null || Number(e.state) > 0;
}

/** The part of HolarkyAccount sync needs, so tests can pass a fake. */
export interface VocabSyncAccount {
  getUser(): Promise<{ id: string } | null>;
  sync<T>(namespace: string, cursor: number, changes: SyncChange<T>[]): Promise<SyncResult<T>>;
}

export interface VocabSyncResult {
  /** Local rows and deletions sent. */
  pushed: number;
  /** Remote edits and deletions applied here. */
  received: number;
  /** Duplicate rows for one word folded into one. */
  merged: number;
  at: number;
}

let running: Promise<VocabSyncResult> | null = null;

/** Runs one sync; concurrent calls share it. */
export function syncVocab(account: VocabSyncAccount, now: () => number = Date.now): Promise<VocabSyncResult> {
  if (!running) {
    running = runSync(account, now).finally(() => {
      running = null;
    });
  }
  return running;
}

async function readState(key: string): Promise<string | null> {
  const row = await getVocabDb().queryOne(`SELECT value FROM sync_state WHERE key = ?`, [key]);
  return row && row.value != null ? String(row.value) : null;
}

async function writeState(key: string, value: string): Promise<void> {
  await getVocabDb().runWrite(`INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)`, [key, value]);
}

async function runSync(account: VocabSyncAccount, now: () => number): Promise<VocabSyncResult> {
  await ensureVocabReady();
  const user = await account.getUser();
  if (!user) throw new Error('Not signed in');

  // Sync state belongs to one account. A different account starts over and receives this
  // device's notebook as new entries.
  if ((await readState('vocab.user')) !== user.id) {
    await writeState('vocab.user', user.id);
    await writeState('vocab.cursor', '0');
    await writeState('vocab.pushedAt', '0');
  }
  let cursor = Number(await readState('vocab.cursor')) || 0;
  const pushedAt = Number(await readState('vocab.pushedAt')) || 0;

  const startedAt = now();
  const outgoing = await localChangesSince(pushedAt);
  let received = 0;
  // Progress of rows a remote tombstone deletes, by lemma, for the row that replaces them.
  const carried = new Map<string, Partial<VocabEntry>>();
  const exchange = async (changes: SyncRecord[]) => {
    let offset = 0;
    let more = true;
    while (more || offset < changes.length) {
      const res = await account.sync<Partial<VocabEntry>>(VOCAB_SYNC_NAMESPACE, cursor, changes.slice(offset, offset + PAGE));
      offset += PAGE;
      for (const change of res.changes) if (await applyRemote(change, carried)) received += 1;
      cursor = res.cursor;
      await writeState('vocab.cursor', String(cursor));
      more = res.more;
    }
  };

  await exchange(outgoing);
  await writeState('vocab.pushedAt', String(startedAt));

  await settleCarriedProgress(carried);
  // Folding duplicates edits rows here; send those edits now rather than on the next sync.
  const mergeAt = now();
  const merged = await mergeDuplicateLemmas(mergeAt);
  let pushed = outgoing.length;
  if (merged) {
    const followUp = await localChangesSince(mergeAt - 1);
    pushed += followUp.length;
    await exchange(followUp);
  }
  return { pushed, received, merged, at: now() };
}

async function localChangesSince(since: number): Promise<SyncRecord[]> {
  const db = getVocabDb();
  const rows = await db.queryAll(`SELECT * FROM vocab WHERE updated_at > ?`, [since]);
  const tombs = await db.queryAll(`SELECT id, deleted_at FROM vocab_deleted WHERE deleted_at > ?`, [since]);
  return [
    ...rows.map((row) => {
      const entry = rowToEntry(row);
      return { id: entry.id, updatedAt: entry.updatedAt, deleted: false, data: withoutProgress(entry) };
    }),
    ...tombs.map((t) => ({ id: String(t.id), updatedAt: Number(t.deleted_at), deleted: true, data: null as Partial<VocabEntry> | null })),
  ];
}

/** Applies one record from the server unless this device holds something newer. */
async function applyRemote(
  change: { id: string; updatedAt: number; deleted: boolean; data: Partial<VocabEntry> | null },
  carried: Map<string, Partial<VocabEntry>> = new Map(),
): Promise<boolean> {
  const db = getVocabDb();
  const local = await db.queryOne(`SELECT * FROM vocab WHERE id = ?`, [change.id]);
  if (local && Number(local.updated_at) > change.updatedAt) return false;

  if (change.deleted) {
    if (local) {
      // Another device folded this row into another id. Keep its progress for that row.
      const mine = rowToEntry(local);
      const key = mine.lemma.trim().toLowerCase();
      const prev = carried.get(key);
      if (hasProgress(mine) && (!prev || Number(mine.reps) > Number(prev.reps))) carried.set(key, progressOf(mine));
      await db.runWrite(`DELETE FROM vocab WHERE id = ?`, [change.id]);
    }
    await db.runWrite(`INSERT OR REPLACE INTO vocab_deleted (id, deleted_at) VALUES (?, ?)`, [change.id, change.updatedAt]);
    return true;
  }

  const tomb = await db.queryOne(`SELECT deleted_at FROM vocab_deleted WHERE id = ?`, [change.id]);
  if (tomb && Number(tomb.deleted_at) > change.updatedAt) return false;
  const e = change.data;
  if (!e || typeof e.lemma !== 'string' || !e.lemma.trim()) return false;
  // An older app sends no device; keep the one this device already knows.
  const device = (e as VocabEntry).device || (local?.device ? String(local.device) : undefined);
  // Progress stays local: a stripped record never resets this device's schedule. A row first seen
  // here takes whatever progress the record carries (only stored records from before stripping do).
  const progress = local ? progressOf(rowToEntry(local)) : progressOf(e);
  // The same for where the word was saved, which older apps neither know nor send.
  const context = normalizeSourceContext((e as VocabEntry).context) || sourceContextFromJson(local?.context) || undefined;
  await writeRow({ ...(withoutProgress(e) as VocabEntry), ...progress, device, context, id: change.id, updatedAt: change.updatedAt });
  if (tomb) await db.runWrite(`DELETE FROM vocab_deleted WHERE id = ?`, [change.id]);
  return true;
}

/**
 * Progress carried from rows that remote tombstones deleted goes to the surviving row with the same
 * lemma when that row has less of it (a row first seen here arrives without progress). The row's
 * updatedAt is left alone: progress is not part of the synced record.
 */
async function settleCarriedProgress(carried: Map<string, Partial<VocabEntry>>): Promise<void> {
  const db = getVocabDb();
  for (const [key, p] of carried) {
    const row = await db.queryOne(`SELECT * FROM vocab WHERE lower(lemma) = ? ORDER BY id ASC LIMIT 1`, [key]);
    if (!row) continue;
    const mine = rowToEntry(row);
    if (hasProgress(mine) && Number(mine.reps || 0) >= Number(p.reps || 0)) continue;
    await db.runWrite(
      `UPDATE vocab SET review_due = ?, review_interval = ?, ease = ?, reps = ?, stability = ?, difficulty = ?, state = ?, lapses = ?,
       last_review = ?, learning_steps = ? WHERE id = ?`,
      [
        p.reviewDue ?? null,
        p.reviewInterval ?? 0,
        p.ease ?? 2.5,
        p.reps ?? 0,
        p.stability ?? null,
        p.difficulty ?? null,
        p.state ?? null,
        p.lapses ?? 0,
        p.lastReview ?? null,
        p.learningSteps ?? 0,
        mine.id,
      ],
    );
  }
}

async function writeRow(e: VocabEntry): Promise<void> {
  const list = (v: unknown) => (Array.isArray(v) && v.length ? JSON.stringify(v.map(String)) : null);
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  await getVocabDb().runWrite(
    `INSERT OR REPLACE INTO vocab (id, lemma, reading, definition, part_of_speech, source_lang, target_lang, sources, note, tags, created_at, updated_at, review_due, review_interval, ease, reps,
       stability, difficulty, state, lapses, last_review, learning_steps, device, context)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.id,
      e.lemma.trim(),
      text(e.reading),
      text(e.definition),
      text(e.partOfSpeech),
      text(e.sourceLang),
      text(e.targetLang),
      list(e.sources),
      text(e.note),
      list(e.tags),
      num(e.createdAt) ?? e.updatedAt,
      e.updatedAt,
      num(e.reviewDue),
      num(e.reviewInterval) ?? 0,
      num(e.ease) ?? 2.5,
      num(e.reps) ?? 0,
      // FSRS fields are optional: a record from an older app has none, and the next review
      // rebuilds them from the SM-2 fields above.
      num(e.stability),
      num(e.difficulty),
      num(e.state),
      num(e.lapses) ?? 0,
      num(e.lastReview),
      num(e.learningSteps) ?? 0,
      text(e.device),
      sourceContextToJson(e.context),
    ],
  );
}

/**
 * Folds rows that share a lemma (case-insensitive) into the row with the smallest id. Text fields
 * take the newest non-empty value, sources and tags are combined, and review progress comes from
 * the most-reviewed row. Returns how many rows were folded away.
 */
export async function mergeDuplicateLemmas(at: number): Promise<number> {
  const db = getVocabDb();
  const groups = await db.queryAll(`SELECT lower(lemma) AS k FROM vocab GROUP BY lower(lemma) HAVING COUNT(*) > 1`);
  let folded = 0;
  for (const g of groups) {
    const entries = (await db.queryAll(`SELECT * FROM vocab WHERE lower(lemma) = ?`, [g.k])).map(rowToEntry);
    if (entries.length < 2) continue;
    entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const keep = entries[0];
    const newest = [...entries].sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
    const pick = <K extends keyof VocabEntry>(key: K): VocabEntry[K] | undefined =>
      newest.find((e) => typeof e[key] === 'string' && String(e[key]).trim())?.[key];
    const union = (key: 'sources' | 'tags') => {
      const all = entries.flatMap((e) => e[key] || []);
      return all.length ? [...new Set(all)] : undefined;
    };
    const studied = [...newest].sort((a, b) => (b.reps || 0) - (a.reps || 0) || (b.lastReview || 0) - (a.lastReview || 0))[0];
    await writeRow({
      id: keep.id,
      lemma: keep.lemma,
      reading: pick('reading'),
      definition: pick('definition'),
      partOfSpeech: pick('partOfSpeech'),
      sourceLang: pick('sourceLang'),
      targetLang: pick('targetLang'),
      // Notes are kept side by side; one that another already contains is not repeated.
      note: joinNotes(entries),
      sources: union('sources'),
      tags: union('tags'),
      createdAt: Math.min(...entries.map((e) => e.createdAt || at)),
      updatedAt: at,
      reviewDue: studied.reviewDue,
      reviewInterval: studied.reviewInterval,
      ease: studied.ease,
      reps: studied.reps,
      stability: studied.stability,
      difficulty: studied.difficulty,
      state: studied.state,
      lapses: studied.lapses,
      lastReview: studied.lastReview,
      learningSteps: studied.learningSteps,
      device: [...entries].sort((a, b) => a.createdAt - b.createdAt).find((x) => x.device)?.device,
      // Where the word was first met: the earliest save that recorded one.
      context: [...entries].sort((a, b) => a.createdAt - b.createdAt).find((x) => x.context)?.context,
    });
    for (const e of entries.slice(1)) {
      await db.runWrite(`DELETE FROM vocab WHERE id = ?`, [e.id]);
      await db.runWrite(`INSERT OR REPLACE INTO vocab_deleted (id, deleted_at) VALUES (?, ?)`, [e.id, at]);
      folded += 1;
    }
  }
  return folded;
}

const LEMMA_NORMALIZED_KEY = 'lemma-normalized-v1';

/**
 * Saved headwords in dictionary form: "CODON" becomes "codon", "Bunny," becomes "bunny".
 * Runs once per notebook; changed rows get a new updatedAt so other devices take the
 * change, and words that now collide are merged like any duplicate.
 */
export async function normalizeStoredLemmas(): Promise<number> {
  await ensureVocabReady();
  const db = getVocabDb();
  const done = await db.queryOne(`SELECT value FROM sync_state WHERE key = ?`, [LEMMA_NORMALIZED_KEY]);
  if (done) return 0;
  const rows = await db.queryAll(`SELECT id, lemma, part_of_speech, source_lang FROM vocab`);
  const now = Date.now();
  let changed = 0;
  for (const row of rows) {
    const lemma = String(row.lemma || '');
    const next = normalizeVocabLemma(lemma, { pos: row.part_of_speech as string, lang: row.source_lang as string });
    if (!next || next === lemma) continue;
    await db.runWrite(`UPDATE vocab SET lemma = ?, updated_at = ? WHERE id = ?`, [next, now, row.id]);
    changed += 1;
  }
  if (changed) await mergeDuplicateLemmas(now);
  await db.runWrite(`INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)`, [LEMMA_NORMALIZED_KEY, String(now)]);
  return changed;
}

const PLURALS_FOLDED_KEY = 'plurals-folded-v1';

/** A regular English plural of `one`: -s, -es, or -y to -ies. Irregular ones are not trusted to a saved gloss. */
function isRegularPlural(many: string, one: string): boolean {
  const m = many.toLowerCase();
  const o = one.toLowerCase();
  return m === `${o}s` || m === `${o}es` || (o.endsWith('y') && m === `${o.slice(0, -1)}ies`);
}

/**
 * Saved plain plurals in their singular: "scraps", saved as "plural of scrap", becomes "scrap".
 * Its meaning and IPA are cleared so the singular's fill in, and it merges into "scrap" when that
 * is saved too, keeping the more studied schedule. Runs once per notebook.
 */
export async function foldStoredPlurals(): Promise<number> {
  await ensureVocabReady();
  const db = getVocabDb();
  const done = await db.queryOne(`SELECT value FROM sync_state WHERE key = ?`, [PLURALS_FOLDED_KEY]);
  if (done) return 0;
  const rows = await db.queryAll(`SELECT id, lemma, definition FROM vocab`);
  const now = Date.now();
  let changed = 0;
  for (const row of rows) {
    const lemma = String(row.lemma || '');
    const one = plainPluralOf(String(row.definition || '').split('\n'));
    if (!one || !isRegularPlural(lemma, one)) continue;
    await db.runWrite(`UPDATE vocab SET lemma = ?, definition = '', reading = '', updated_at = ? WHERE id = ?`, [one.toLowerCase(), now, row.id]);
    changed += 1;
  }
  if (changed) await mergeDuplicateLemmas(now);
  await db.runWrite(`INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)`, [PLURALS_FOLDED_KEY, String(now)]);
  if (changed) notifyVocabChanged();
  return changed;
}

/** Every distinct note of the rows, oldest first; a note another one contains is left out. */
function joinNotes(entries: VocabEntry[]): string | undefined {
  const notes = [...entries]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((e) => String(e.note || '').trim())
    .filter(Boolean);
  const kept = notes.filter((n, i) => notes.findIndex((m) => m === n) === i && !notes.some((m) => m !== n && m.includes(n)));
  return kept.length ? kept.join('\n') : undefined;
}

/* ------------------------------------------------- forms of other words (v2) */

const FORMS_FOLDED_KEY = 'lemma-normalized-v2';
const FORMS_CHECKED_KEY = 'lemma-forms-checked-v2';
const FORMS_ONLINE_DONE_KEY = 'lemma-forms-online-v2';

type StoredRow = { id: string; lemma: string; definition: string; pos: string; lang: string };

function isEnglishRow(r: { lang: string }): boolean {
  return !r.lang || r.lang.toLowerCase().split('-')[0] === 'en';
}

function wordSet(text: string): Set<string> {
  return new Set(
    stripGlossText(text)
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter((w) => w.length > 2),
  );
}

/** How much two saved meanings share (Jaccard, 0 to 1): "vicissitudes" saved with vicissitude's senses is near 1. */
function overlap(a: string, b: string): number {
  const x = wordSet(a);
  const y = wordSet(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / (x.size + y.size - shared);
}

/**
 * What a saved word should be saved as, decided without the network, or null. The saved senses
 * are all forms of one word that the spelling bears out ("lobotomized": simple past of lobotomize;
 * "idiosyncracy": alternative spelling of idiosyncrasy), or the word is a regular ending away from
 * a saved word whose meaning it was saved with ("vicissitudes" beside vicissitude).
 */
export function offlineFormTarget(row: StoredRow, saved: Map<string, StoredRow>): string | null {
  const w = row.lemma.trim();
  if (!w || /\s/.test(w) || !isEnglishRow(row)) return null;
  const lines = row.definition.split('\n').filter(Boolean);
  const named = formOfLemmaFromGlosses(lines, w);
  if (named && foldLookupKey(named) !== foldLookupKey(w)) {
    const spelling = lines.some((l) => /\b(?:spelling|misspelling|form)\s+of\b/i.test(stripGlossText(l)));
    const lemmas = Object.values(latinLemmasByPos(w)).map((x) => String(x).toLowerCase());
    if (
      isRegularInflection(w, named) ||
      lemmas.includes(named.toLowerCase()) ||
      (spelling && typoDistance(w, named) <= 2)
    ) {
      return named;
    }
  }
  for (const other of saved.values()) {
    if (other.id === row.id || !isRegularInflection(w, other.lemma)) continue;
    if (row.definition && other.definition && overlap(row.definition, other.definition) >= 0.5) return other.lemma;
  }
  return null;
}

/** Points the answer history, word-book progress and books you made at the new headword. */
async function moveLemmaRefs(pairs: Array<[string, string]>, now: number): Promise<void> {
  const db = getVocabDb();
  for (const [from, to] of pairs) {
    const a = from.trim().toLowerCase();
    const b = to.trim().toLowerCase();
    if (!a || !b || a === b) continue;
    await db.runWrite(`UPDATE answer_history SET lemma = ? WHERE lemma = ?`, [b, a]);
    const old = await db.queryOne(`SELECT reps FROM book_words WHERE lemma = ?`, [a]);
    if (old) {
      const cur = await db.queryOne(`SELECT reps FROM book_words WHERE lemma = ?`, [b]);
      if (cur && Number(cur.reps || 0) >= Number(old.reps || 0)) {
        await db.runWrite(`DELETE FROM book_words WHERE lemma = ?`, [a]);
      } else {
        if (cur) await db.runWrite(`DELETE FROM book_words WHERE lemma = ?`, [b]);
        await db.runWrite(`UPDATE book_words SET lemma = ?, updated_at = ? WHERE lemma = ?`, [b, now, a]);
      }
    }
    for (const book of await db.queryAll(`SELECT book_id, words FROM user_books WHERE words LIKE ?`, [`%${from.trim()}%`])) {
      let words: string[] = [];
      try {
        words = JSON.parse(String(book.words || '[]'));
      } catch {
        continue;
      }
      if (!Array.isArray(words) || !words.some((x) => String(x).toLowerCase() === a)) continue;
      const next: string[] = [];
      for (const x of words.map((x) => (String(x).toLowerCase() === a ? to : String(x)))) {
        if (!next.some((y) => y.toLowerCase() === x.toLowerCase())) next.push(x);
      }
      await db.runWrite(`UPDATE user_books SET words = ?, updated_at = ? WHERE book_id = ?`, [JSON.stringify(next), now, book.book_id]);
    }
  }
}

/**
 * Saves a row under `target`. Its meaning stays only when it is not just "form of" lines and the
 * target is not saved already (whose own meaning then wins); its IPA, which is the form's, goes.
 * The rows then merge like any duplicate, keeping the earlier save date, the more studied
 * schedule, every note and tag, and a tombstone for the row folded away.
 */
async function renameStored(row: StoredRow, target: string, saved: Map<string, StoredRow>, now: number): Promise<[string, string]> {
  const lemma = normalizeVocabLemma(target, { pos: row.pos, lang: row.lang });
  const onlyForms = row.definition.split('\n').filter(Boolean).every((l) => !!formOfGlossLemma(l));
  const keep = !saved.has(lemma.toLowerCase()) && !onlyForms ? row.definition : '';
  await getVocabDb().runWrite(`UPDATE vocab SET lemma = ?, definition = ?, reading = '', updated_at = ? WHERE id = ?`, [lemma, keep, now, row.id]);
  saved.delete(row.lemma.toLowerCase());
  if (!saved.has(lemma.toLowerCase())) saved.set(lemma.toLowerCase(), { ...row, lemma, definition: keep });
  return [row.lemma, lemma];
}

async function readStoredRows(): Promise<StoredRow[]> {
  const rows = await getVocabDb().queryAll(`SELECT id, lemma, definition, part_of_speech, source_lang FROM vocab`);
  return rows.map((r) => ({
    id: String(r.id),
    lemma: String(r.lemma || ''),
    definition: String(r.definition || ''),
    pos: String(r.part_of_speech || ''),
    lang: String(r.source_lang || ''),
  }));
}

/**
 * Once per notebook, without the network: reference lines leave saved meanings ("in
 * Dictionary.com Unabridged"), and saved forms of other words become those words where the
 * saved data decides it (see offlineFormTarget). Returns how many rows changed.
 */
export async function foldStoredForms(now = Date.now()): Promise<number> {
  await ensureVocabReady();
  const db = getVocabDb();
  if (await db.queryOne(`SELECT value FROM sync_state WHERE key = ?`, [FORMS_FOLDED_KEY])) return 0;
  const rows = await readStoredRows();
  let changed = 0;
  for (const row of rows) {
    const clean = stripCitationLines(row.definition);
    if (clean !== row.definition) {
      await db.runWrite(`UPDATE vocab SET definition = ?, updated_at = ? WHERE id = ?`, [clean, now, row.id]);
      row.definition = clean;
      changed += 1;
    }
  }
  const saved = new Map(rows.map((r) => [r.lemma.toLowerCase(), r] as [string, StoredRow]));
  const pairs: Array<[string, string]> = [];
  for (const row of rows) {
    if (saved.get(row.lemma.toLowerCase())?.id !== row.id) continue;
    const target = offlineFormTarget(row, saved);
    if (!target) continue;
    pairs.push(await renameStored(row, target, saved, now));
    changed += 1;
  }
  if (pairs.length) {
    await mergeDuplicateLemmas(now);
    await moveLemmaRefs(pairs, now);
  }
  await db.runWrite(`INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)`, [FORMS_FOLDED_KEY, String(now)]);
  if (changed) notifyVocabChanged();
  return changed;
}

/** Saved words worth asking Wiktionary about: an ending a form could have, no meaning, or a near-twin of another saved word. */
function mayBeStoredForm(row: StoredRow, saved: Map<string, StoredRow>): boolean {
  const w = row.lemma.trim();
  if (!w || /\s/.test(w) || !isEnglishRow(row) || w.length < 3) return false;
  if (/(?:s|ed|ing|er|est|i|ae|a|en)$/i.test(w) || !row.definition.trim()) return true;
  if (w.length < 6) return false;
  for (const other of saved.keys()) {
    if (other !== w.toLowerCase() && Math.abs(other.length - w.length) <= 2 && typoDistance(other, w) <= 2) return true;
  }
  return false;
}

let onlineRun: Promise<number> | null = null;

/**
 * The rest, through the network, in the background: each saved word that may be a form is
 * looked up on kaikki.org, the way a lookup decides (form-of.ts), and becomes its lemma when it is
 * only a form ("gleaned" becomes glean). Words already asked are remembered, so a later launch
 * only asks about the ones a failed request left. Returns how many rows changed.
 */
export function resolveStoredForms(http: HttpClient = getHttp(), opts: { pauseMs?: number; max?: number } = {}): Promise<number> {
  if (!onlineRun) {
    onlineRun = runResolveStoredForms(http, opts).finally(() => {
      onlineRun = null;
    });
  }
  return onlineRun;
}

async function runResolveStoredForms(http: HttpClient, opts: { pauseMs?: number; max?: number }): Promise<number> {
  await ensureVocabReady();
  const db = getVocabDb();
  if (await db.queryOne(`SELECT value FROM sync_state WHERE key = ?`, [FORMS_ONLINE_DONE_KEY])) return 0;
  const checkedRow = await db.queryOne(`SELECT value FROM sync_state WHERE key = ?`, [FORMS_CHECKED_KEY]);
  let checked: string[] = [];
  try {
    checked = checkedRow ? JSON.parse(String(checkedRow.value)) : [];
  } catch {
    checked = [];
  }
  const done = new Set(checked.map((w) => String(w).toLowerCase()));
  const rows = await readStoredRows();
  const saved = new Map(rows.map((r) => [r.lemma.toLowerCase(), r] as [string, StoredRow]));
  const todo = rows.filter((r) => !done.has(r.lemma.toLowerCase()) && mayBeStoredForm(r, saved));
  const max = opts.max ?? 200;
  const pause = opts.pauseMs ?? 250;
  const pairs: Array<[string, string]> = [];
  let failed = 0;
  let asked = 0;
  for (const row of todo) {
    if (asked >= max) break;
    if (saved.get(row.lemma.toLowerCase())?.id !== row.id) continue;
    asked += 1;
    let target: string | null = null;
    try {
      target = await resolveFormOf(http, row.lemma.toLowerCase(), 'en', 8000);
      failed = 0;
    } catch (err) {
      // Wiktionary has no page for the word: it is not a form of anything Wiktionary knows.
      if ((err as { code?: string })?.code === 'NO_PAGE') {
        done.add(row.lemma.toLowerCase());
        failed = 0;
        continue;
      }
      failed += 1;
      // Offline or the host is down (three failures in a row): stop and try again on a later launch.
      if (failed >= 3) break;
      continue;
    }
    done.add(row.lemma.toLowerCase());
    if (target && foldLookupKey(target) !== foldLookupKey(row.lemma)) {
      const now = Date.now();
      pairs.push(await renameStored(row, target, saved, now));
      await mergeDuplicateLemmas(now);
      await moveLemmaRefs(pairs.slice(-1), now);
      notifyVocabChanged();
    }
    if (pause) await new Promise((r) => setTimeout(r, pause));
  }
  await db.runWrite(`INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)`, [FORMS_CHECKED_KEY, JSON.stringify([...done])]);
  const left = todo.filter((r) => !done.has(r.lemma.toLowerCase())).length;
  if (!left) await db.runWrite(`INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)`, [FORMS_ONLINE_DONE_KEY, String(Date.now())]);
  return pairs.length;
}

registerLemmaMigration(async () => {
  await normalizeStoredLemmas();
  await foldStoredPlurals();
  await foldStoredForms();
  // The network part runs behind the list; rows it changes repaint through notifyVocabChanged.
  if (isCoreConfigured()) {
    void resolveStoredForms().catch((err) => console.warn('[vocab] forms check skipped', err));
  }
});
