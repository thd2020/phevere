/**
 * Now-playing / media session (docs/OCR_CONTEXT_CAPTURE.md Phase 5).
 * Windows: GlobalSystemMediaTransportControls via PowerShell WinRT helper.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { wrapConsole } from '../logger';

const console = wrapConsole('media-session');

export interface NowPlayingInfo {
  title: string;
  artist: string;
  album?: string;
}

function resolveScript(): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'scripts', 'media_now_playing.ps1'),
    path.join(process.resourcesPath || '', 'media_now_playing.ps1'),
    path.join(process.resourcesPath || '', 'scripts', 'media_now_playing.ps1'),
    path.join(app.getAppPath(), 'scripts', 'media_now_playing.ps1'),
    path.join(process.cwd(), 'scripts', 'media_now_playing.ps1'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

function runPs(scriptPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('media session timeout'));
    }, 8000);
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.trim() || `powershell exit ${code}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Returns current media title/artist when a session exists (Spotify, browser, …).
 */
export async function getNowPlaying(): Promise<NowPlayingInfo | null> {
  if (process.platform !== 'win32') {
    return null;
  }
  const script = resolveScript();
  if (!fs.existsSync(script)) {
    console.warn('media_now_playing.ps1 missing', script);
    return null;
  }
  try {
    const line = await runPs(script);
    if (!line) return null;
    const [title, artist, album] = line.split('\t').map((s) => (s || '').trim());
    if (!title) return null;
    return {
      title,
      artist: artist || '',
      album: album || undefined,
    };
  } catch (error) {
    console.warn('getNowPlaying failed', error);
    return null;
  }
}

/** Best single lookup string from now-playing metadata. */
export function formatNowPlayingQuery(info: NowPlayingInfo): string {
  const title = info.title.trim();
  const artist = (info.artist || '').trim();
  if (title && artist) return `${title} ${artist}`;
  return title || artist;
}
