import {
  accentToBcp47,
  recordedPronunciationUrls,
  type DictionaryResult,
  type Pronunciation,
} from '@phevere/core';
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

export async function playRecorded(result: DictionaryResult | null, prefs: MobilePrefs): Promise<void> {
  if (!prefs.audioEnabled) return;
  const urls = recordedUrls(result);
  if (!urls.length) {
    await speakText(result?.word || '', prefs);
    return;
  }
  if (!clip) clip = new Audio();
  clip.playbackRate = prefs.audioSpeed || 1;
  for (const url of urls) {
    try {
      clip.src = url;
      const ended = waitClipEnd(clip);
      await clip.play();
      await ended;
      return;
    } catch {
      /* try next */
    }
  }
  await speakText(result?.word || '', prefs);
}

export function speakText(text: string, prefs: MobilePrefs, lang?: string): Promise<void> {
  if (!prefs.audioEnabled || !text || !window.speechSynthesis) return Promise.resolve();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = prefs.audioSpeed || 1;
  if (lang) u.lang = lang;
  return new Promise((resolve) => {
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function speakIpa(p: Pronunciation, prefs: MobilePrefs): Promise<void> {
  if (!prefs.audioEnabled) return Promise.resolve();
  const lang = accentToBcp47(p.accent);
  const ipa = p.ipa || '';
  if (!ipa) return speakText(p.audioUrl || '', prefs, lang);
  return speakText(ipa, prefs, lang);
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
}
