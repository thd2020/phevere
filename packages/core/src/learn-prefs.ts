/**
 * Learn options that sit in Settings on each device: the countdown on choice questions and
 * whether speaking questions are asked. Each shell keeps them as JSON in its own local storage
 * (desktop `phevere-learn-prefs`, phone `phevere.learnPrefs`) and passes them to Learn through
 * `ReviewRenderOptions`. The daily goals for new words are stored elsewhere: My words' goal as a
 * number beside these, and each word book's goal on its subscription (wordbook-store.ts).
 */

export interface LearnPrefs {
  /** Seconds to answer a choice question before it counts as not known; 0 means no countdown. */
  countdown: number;
  /** Ask the learner to say the word aloud. Only offered when the device has a microphone. */
  speaking: boolean;
}

/** The countdown Settings offers runs from 5 to 30 seconds; 0 is Off. */
export const COUNTDOWN_MIN = 5;
export const COUNTDOWN_MAX = 30;

export const DEFAULT_LEARN_PREFS: LearnPrefs = { countdown: 0, speaking: true };

/** Stored JSON back to prefs; anything missing or malformed falls back to the default. */
export function readLearnPrefs(raw: string | null | undefined): LearnPrefs {
  let data: Partial<LearnPrefs> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') data = parsed;
  } catch {
    /* keep the default */
  }
  const n = Math.round(Number(data.countdown));
  return {
    countdown: Number.isFinite(n) && n > 0 ? Math.max(COUNTDOWN_MIN, Math.min(COUNTDOWN_MAX, n)) : 0,
    speaking: typeof data.speaking === 'boolean' ? data.speaking : DEFAULT_LEARN_PREFS.speaking,
  };
}

export function writeLearnPrefs(p: LearnPrefs): string {
  return JSON.stringify({ countdown: p.countdown, speaking: p.speaking });
}

/**
 * True when the device lists a microphone the app may use: an audio input is present and
 * microphone access has not been refused. Browsers list inputs before access is granted (without
 * their names), so this asks for nothing.
 */
export async function microphoneAvailable(): Promise<boolean> {
  try {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    const media = nav?.mediaDevices;
    if (!nav || !media?.enumerateDevices || !media.getUserMedia) return false;
    try {
      const status = await nav.permissions?.query({ name: 'microphone' as PermissionName });
      if (status?.state === 'denied') return false;
    } catch {
      /* the permission is not queryable here; the device list decides */
    }
    const devices = await media.enumerateDevices();
    return devices.some((d) => d.kind === 'audioinput');
  } catch {
    return false;
  }
}

/** Calls `onChange` with the new answer when a microphone is plugged in or removed. */
export function watchMicrophone(onChange: (available: boolean) => void): void {
  const media = (globalThis as { navigator?: Navigator }).navigator?.mediaDevices;
  media?.addEventListener?.('devicechange', () => {
    void microphoneAvailable().then(onChange);
  });
}
