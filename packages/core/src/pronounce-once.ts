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

export interface SingleVoice {
  (word: string): Promise<VoiceOutcome>;
  /** Stops the word playing or loading, and keeps any request still loading from making a sound. */
  cancel(): void;
}

export function singleVoice(backend: VoiceBackend): SingleVoice {
  let generation = 0;
  const say = (async (word: string) => {
    const mine = ++generation;
    const current = () => mine === generation;
    backend.stop();
    let urls: string[] = [];
    try {
      urls = await backend.recordings(word);
    } catch {
      urls = [];
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
