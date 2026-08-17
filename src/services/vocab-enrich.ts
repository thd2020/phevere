/**
 * Background notebook fill: independent of the popup window.
 * Heart-save writes the lemma immediately; this queue looks the word up in
 * main and silently patches empty rows (including ones saved in earlier sessions).
 */

import { BrowserWindow } from 'electron';
import { dictionaryService, type DictionaryResult } from './dictionary';
import { formatPronunciationLine } from './pronunciation';
import * as vocabStore from './vocab-store';
import { wrapConsole } from '../logger';

const console = wrapConsole('vocab-enrich');

const MAX_ATTEMPTS = 4;
const SCAN_MS = 120_000;
const BETWEEN_JOBS_MS = 400;
const SAVE_GRACE_MS = 2500;

type Job = { lemma: string; attempts: number };

const queue: Job[] = [];
const queued = new Set<string>();
let pumping = false;
let started = false;
let scanTimer: ReturnType<typeof setInterval> | null = null;

function keyOf(lemma: string): string {
  return lemma.trim().toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempts: number): number {
  return Math.min(180_000, 15_000 * Math.pow(2, Math.max(0, attempts - 1)));
}

function stripHtmlToText(s: string): string {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableDef(d: { source?: string; meaning?: string } | undefined): boolean {
  if (!d || d.source === 'Fallback' || d.source === 'Timeout') return false;
  const m = stripHtmlToText(d.meaning || '');
  if (!m || m === 'No definition available.' || /lookup timed out/i.test(m)) return false;
  return true;
}

export function payloadFromDictionaryResult(result?: DictionaryResult | null): vocabStore.VocabAddInput | null {
  if (!result) return null;
  const defs = (result.definitions || []).filter(isUsableDef);
  const substantive = defs.filter((d) => {
    const m = stripHtmlToText(d.meaning || '').toLowerCase();
    return !/^(plural|past(?:\s+tense)?|present(?:\s+participle)?|gerund|participle|form)\s+of\b/.test(m) || m.length > 64;
  });
  const useDefs = substantive.length ? substantive : defs;
  const defJoined = useDefs
    .slice(0, 4)
    .map((d) => stripHtmlToText(d.meaning || ''))
    .filter(Boolean)
    .join('\n');
  const tx = result.translations && result.translations[0];
  const definition = defJoined || (tx && tx.text ? String(tx.text) : '');
  const reading = formatPronunciationLine(result.pronunciations) || result.pronunciation || '';
  if (!definition && !reading) return null;
  const sourceList: string[] = [];
  useDefs.slice(0, 6).forEach((d) => {
    if (Array.isArray(d.sources)) d.sources.forEach((s: string) => { if (s) sourceList.push(s); });
    else if (d.source) String(d.source).split(/\s*·\s*/).forEach((s) => { if (s) sourceList.push(s); });
  });
  const sources = Array.from(new Set(sourceList.length ? sourceList : result.sources || [])).slice(0, 6);
  return {
    lemma: (result.metadata?.lemma || result.word || '').trim() || result.word,
    reading: reading || undefined,
    definition: definition || undefined,
    partOfSpeech: useDefs[0]?.partOfSpeech,
    sourceLang: result.detectedLanguage,
    targetLang: (tx && tx.language) || result.language,
    sources: sources.length ? sources : undefined,
  };
}

function lemmaCandidates(result: DictionaryResult, extra?: string): string[] {
  return [
    extra,
    result.metadata?.lemma,
    result.word,
    result.metadata?.queriedAs,
    result.metadata?.matchedQuery,
    result.metadata?.originalSelection,
  ].filter((x): x is string => typeof x === 'string' && !!x.trim());
}

function notifyVocabUpdated(entry: vocabStore.VocabEntry): void {
  const payload = { id: entry.id, lemma: entry.lemma };
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    try {
      w.webContents.send('vocab-updated', payload);
    } catch {
      /* ignore */
    }
  }
}

export async function applyDictionaryResultToNotebook(
  result?: DictionaryResult | null,
  extraLemma?: string,
): Promise<vocabStore.VocabEntry | null> {
  const payload = payloadFromDictionaryResult(result);
  if (!payload || !result) return null;
  const filled = await vocabStore.fillEmptyDefinitions(lemmaCandidates(result, extraLemma), payload);
  if (filled) {
    cancelVocabEnrich(filled.lemma);
    for (const lemma of lemmaCandidates(result, extraLemma)) cancelVocabEnrich(lemma);
    notifyVocabUpdated(filled);
  }
  return filled;
}

export function cancelVocabEnrich(lemma: string): void {
  const key = keyOf(lemma);
  if (!key) return;
  queued.delete(key);
  for (let i = queue.length - 1; i >= 0; i--) {
    if (keyOf(queue[i].lemma) === key) queue.splice(i, 1);
  }
}

export function stopVocabEnricher(): void {
  queued.clear();
  queue.length = 0;
}

export function enqueueVocabEnrich(lemma: string, delayMs = SAVE_GRACE_MS): void {
  const trimmed = (lemma || '').trim();
  if (!trimmed || trimmed.length > 80) return;
  const key = keyOf(trimmed);
  if (queued.has(key)) return;
  queued.add(key);
  const job: Job = { lemma: trimmed, attempts: 0 };
  if (delayMs > 0) {
    setTimeout(() => {
      if (!queued.has(key)) return;
      queue.push(job);
      void pump();
    }, delayMs);
  } else {
    queue.push(job);
    void pump();
  }
}

async function enrichOne(job: Job): Promise<boolean> {
  const existing = await vocabStore.findByLemma(job.lemma);
  if (!existing) return true;
  const hasDef = !!(existing.definition && existing.definition.trim());
  const hasReading = !!(existing.reading && existing.reading.trim());
  if (hasDef && hasReading) return true;

  const result = await dictionaryService.lookup(job.lemma, 'auto', undefined, {
    skipEtymology: true,
    onUpdate: (updated) => {
      void applyDictionaryResultToNotebook(updated, job.lemma).catch((): undefined => undefined);
    },
  });
  const filled = await applyDictionaryResultToNotebook(result, job.lemma);
  if (filled && filled.definition && filled.definition.trim()) {
    console.log('Filled notebook row', { lemma: filled.lemma, ipa: !!filled.reading });
    return true;
  }
  const still = await vocabStore.findByLemma(job.lemma);
  if (hasDef) return true;
  return !!(still && still.definition && still.definition.trim());
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      if (!job) break;
      queued.delete(keyOf(job.lemma));
      let ok = false;
      try {
        ok = await enrichOne(job);
      } catch (err) {
        console.warn('Background notebook lookup failed', { lemma: job.lemma, err: String(err) });
      }
      if (!ok && job.attempts + 1 < MAX_ATTEMPTS) {
        job.attempts += 1;
        const wait = backoffMs(job.attempts);
        console.log('Retry notebook fill later', { lemma: job.lemma, attempt: job.attempts, wait });
        setTimeout(() => enqueueVocabEnrich(job.lemma, 0), wait);
      }
      if (queue.length) await sleep(BETWEEN_JOBS_MS);
    }
  } finally {
    pumping = false;
    if (queue.length) void pump();
  }
}

let ipaScanDone = false;

export async function scanEmptyVocabForEnrich(): Promise<void> {
  try {
    const rows = await vocabStore.listEmptyDefinitions(80);
    for (const row of rows) enqueueVocabEnrich(row.lemma, 0);
    if (!ipaScanDone) {
      ipaScanDone = true;
      const missingIpa = await vocabStore.listEmptyReadings(80);
      for (const row of missingIpa) enqueueVocabEnrich(row.lemma, 0);
    }
  } catch (err) {
    console.warn('Empty-notebook scan skipped', { err: String(err) });
  }
}

export function startVocabEnricher(): void {
  if (started) return;
  started = true;
  void scanEmptyVocabForEnrich();
  scanTimer = setInterval(() => {
    void scanEmptyVocabForEnrich();
  }, SCAN_MS);
  if (typeof scanTimer.unref === 'function') scanTimer.unref();
}
