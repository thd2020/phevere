/**
 * One voice per press: the recorded clip when the word has one, otherwise the synthetic voice,
 * never both. Each shell supplies the four calls below; `singleVoice` wraps them so that a newer
 * request (a tap on ▶ while a listening question is still playing its word, a repaint, the next
 * question) stops the older one, and the older one never starts a voice after that. A recording
 * that fails to load falls back to the synthetic voice only after the recording is stopped, so a
 * clip that arrives late cannot follow it.
 */
export interface VoiceBackend {
  /** Recorded clip URLs for the word, best first; empty when it has none. */
  recordings(word: string): Promise<string[]>;
  /** Plays one clip; rejects when it cannot be loaded or played. */
  playRecording(url: string): Promise<void>;
  /** Says the word with the synthetic voice. */
  speak(word: string): Promise<void>;
  /** Stops whatever is playing or loading. */
  stop(): void;
}

export type VoiceOutcome = 'recording' | 'speech' | 'stale';

export function singleVoice(backend: VoiceBackend): (word: string) => Promise<VoiceOutcome> {
  let generation = 0;
  return async (word: string) => {
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
        await backend.playRecording(url);
        return current() ? 'recording' : 'stale';
      } catch {
        // A newer request stopped this clip: that request plays, this one is done.
        if (!current()) return 'stale';
      }
    }
    if (!current()) return 'stale';
    if (urls.length) backend.stop();
    await backend.speak(word);
    return current() ? 'speech' : 'stale';
  };
}
