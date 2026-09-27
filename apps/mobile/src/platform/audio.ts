import {
  accentToBcp47,
  ipaToEspeakPhonemes,
  recordedPronunciationUrls,
  type DictionaryResult,
  type Pronunciation,
} from '@phevere/core';
import { hasNativeBridge, nativeCall } from './native';
import type { MobilePrefs } from './prefs';

let clip: HTMLAudioElement | null = null;

export function recordedUrls(result: DictionaryResult | null): string[] {
  return recordedPronunciationUrls(result?.pronunciations);
}

function waitClipEnd(el: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('ended', done);
      el.removeEventListener('error', done);
      resolve();
    };
    el.addEventListener('ended', done);
    el.addEventListener('error', done);
  });
}

function rate(prefs: MobilePrefs): number {
  return prefs.audioSpeed || 1;
}

function volume(prefs: MobilePrefs): number {
  const v = Number(prefs.audioVolume);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

async function playUrl(url: string, prefs: MobilePrefs): Promise<void> {
  if (!prefs.audioEnabled || !url) return;
  if (hasNativeBridge()) {
    await nativeCall('playUrl', { url, rate: rate(prefs), volume: volume(prefs) });
    return;
  }
  if (!clip) clip = new Audio();
  clip.playbackRate = rate(prefs);
  clip.volume = volume(prefs);
  clip.src = url;
  const ended = waitClipEnd(clip);
  await clip.play();
  await ended;
}

export async function playRecorded(result: DictionaryResult | null, prefs: MobilePrefs): Promise<void> {
  if (!prefs.audioEnabled) return;
  const urls = recordedUrls(result);
  if (!urls.length) {
    await speakText(result?.word || '', prefs);
    return;
  }
  for (const url of urls) {
    try {
      await playUrl(url, prefs);
      return;
    } catch {
      /* try next */
    }
  }
  await speakText(result?.word || '', prefs);
}

export async function speakText(text: string, prefs: MobilePrefs, lang?: string): Promise<void> {
  if (!prefs.audioEnabled || !text) return;
  if (hasNativeBridge()) {
    await nativeCall('speak', { text, lang: lang || 'en-US', rate: rate(prefs), volume: volume(prefs) });
    return;
  }
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate(prefs);
  u.volume = volume(prefs);
  if (lang) u.lang = lang;
  await new Promise<void>((resolve) => {
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

/**
 * Chip speaker: the mechanical voice reads the chip's own IPA (eSpeak [[phonemes]]),
 * as on desktop. The headword button is the one that plays the recorded human clip.
 */
export async function speakIpa(p: Pronunciation, prefs: MobilePrefs, word?: string): Promise<void> {
  if (!prefs.audioEnabled) return;
  const lang = accentToBcp47(p.accent);
  const phonemes = ipaToEspeakPhonemes(p.ipa);
  if (hasNativeBridge() && phonemes) {
    await nativeCall('speak', { text: phonemes, lang, rate: rate(prefs), volume: volume(prefs), phonemes: true });
    return;
  }
  // Browser preview: speechSynthesis cannot read IPA, so say the headword in that accent.
  await speakText(word || '', prefs, lang);
}

export function stopAudio(): void {
  try {
    clip?.pause();
  } catch {
    /* ignore */
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  if (hasNativeBridge()) void nativeCall('stopAudio', {}).catch(() => undefined);
}
