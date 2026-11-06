/**
 * One voice per press: the recorded clip when the word has one, otherwise the synthetic voice,
 * never both. Each shell supplies the four calls below; `singleVoice` wraps them so that a newer
 * request (a tap on ▶ while a listening question is still playing its word, a repaint, the next
 * question) stops the older one, and the older one never starts a voice after that. A recording
 * that fails to load falls back to the synthetic voice only after the recording is stopped, so a
 * clip that arrives late cannot follow it.
 *
 * `playRecording` and `speak` get `alive`, which turns false as soon as a newer request or
 * `cancel` comes in. A backend that waits for anything before it makes a sound (synthesising the
 * voice, fetching a clip) checks it after the wait and stays silent when it is false; otherwise an
 * older press that was still synthesising would speak over the newer one.
 */
import { budgetMs } from './net';
import { recordedPronunciationUrls, type Pronunciation } from './pronunciation';

/** A lookup result, as far as the voice needs it. */
export interface RecordingSource {
  pronunciations?: Pronunciation[];
  metadata?: { pendingPronunciation?: boolean } | Record<string, any>;
}

/**
 * How long a press waits for the word's lookup to say whether it has a recording, before the
 * synthetic voice speaks instead. It stretches on a slow connection with the dictionaries' round
 * trips (`budgetMs`).
 */
export const RECORDING_WAIT_MS = 8000;

/** The dictionaries are still out for this result, so a recording may yet arrive. */
export function recordingPending(r: RecordingSource | null | undefined): boolean {
  return !!(r?.metadata as { pendingPronunciation?: boolean } | undefined)?.pendingPronunciation;
}

/** The wait for a recording, stretched for the dictionaries' hosts on a slow connection. */
export function recordingWaitMs(): number {
  return budgetMs(RECORDING_WAIT_MS, ['api.dictionaryapi.dev', 'en.wiktionary.org'], 2);
}

/**
 * The word's recorded clips once its lookup knows them. `start` runs the lookup, hands each later
 * version of the result to `onUpdate`, and resolves with the first version. This resolves with the
 * clips as soon as any version has one, with none once a version says no pronunciation data is
 * still coming, and with none when `waitMs` runs out first. So a press before the data arrived
 * waits for the recording instead of taking the synthetic voice.
 */
export function awaitRecordings(
  start: (onUpdate: (r: RecordingSource) => void) => Promise<RecordingSource | null | undefined>,
  waitMs = recordingWaitMs(),
): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    let done = false;
    const finish = (urls: string[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(urls);
    };
    const timer = setTimeout(() => finish([]), waitMs);
    const take = (r: RecordingSource | null | undefined) => {
      const urls = recordedPronunciationUrls(r?.pronunciations);
      if (urls.length) finish(urls);
      else if (!recordingPending(r)) finish([]);
    };
    start((r) => take(r))
      .then((r) => take(r))
      .catch(() => finish([]));
  });
}

export interface VoiceBackend {
  /** Recorded clip URLs for the word, best first; empty when it has none. */
  recordings(word: string): Promise<string[]>;
  /**
   * Plays one clip; rejects only when it cannot be loaded or started. A clip that started and then
   * failed has been heard, so it resolves.
   */
  playRecording(url: string, alive: () => boolean): Promise<void>;
  /** Says the word with the synthetic voice, unless `alive()` has turned false by the time it is ready. */
  speak(word: string, alive: () => boolean): Promise<void>;
  /** Stops whatever is playing or loading. */
  stop(): void;
}

export type VoiceOutcome = 'recording' | 'speech' | 'stale';

export interface SayOptions {
  /** Told true while the word's recordings are still being found, and false once they are. */
  onLoading?: (loading: boolean) => void;
}

export interface SingleVoice {
  (word: string, opts?: SayOptions): Promise<VoiceOutcome>;
  /** Stops the word playing or loading, and keeps any request still loading from making a sound. */
  cancel(): void;
}

export function singleVoice(backend: VoiceBackend): SingleVoice {
  let generation = 0;
  const say = (async (word: string, opts: SayOptions = {}) => {
    const mine = ++generation;
    const current = () => mine === generation;
    backend.stop();
    let urls: string[] = [];
    opts.onLoading?.(true);
    try {
      urls = await backend.recordings(word);
    } catch {
      urls = [];
    } finally {
      opts.onLoading?.(false);
    }
    if (!current()) return 'stale';
    for (const url of urls) {
      try {
        await backend.playRecording(url, current);
        return current() ? 'recording' : 'stale';
      } catch {
        // A newer request stopped this clip: that request plays, this one is done.
        if (!current()) return 'stale';
      }
    }
    if (!current()) return 'stale';
    if (urls.length) backend.stop();
    await backend.speak(word, current);
    return current() ? 'speech' : 'stale';
  }) as SingleVoice;
  say.cancel = () => {
    generation += 1;
    backend.stop();
  };
  return say;
}
