/**
 * Now-playing / media session (docs/OCR_CONTEXT_CAPTURE.md Phase 5).
 * Windows: GlobalSystemMediaTransportControls via PowerShell WinRT helper.
 * macOS: Music.app / Spotify via AppleScript (same Title<TAB>Artist<TAB>Album line).
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

function resolveScript(fileName: string): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'scripts', fileName),
    path.join(process.resourcesPath || '', fileName),
    path.join(process.resourcesPath || '', 'scripts', fileName),
    path.join(app.getAppPath(), 'scripts', fileName),
    path.join(process.cwd(), 'scripts', fileName),
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

function runOsascript(scriptPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('osascript', [scriptPath], { windowsHide: true });
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
        reject(new Error(stderr.trim() || `osascript exit ${code}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function parseNowPlayingLine(line: string): NowPlayingInfo | null {
  if (!line) return null;
  const [title, artist, album] = line.split('\t').map((s) => (s || '').trim());
  if (!title) return null;
  return {
    title,
    artist: artist || '',
    album: album || undefined,
  };
}

/**
 * Returns current media title/artist when a session exists (Spotify, browser, …).
 */
export async function getNowPlaying(): Promise<NowPlayingInfo | null> {
  try {
    if (process.platform === 'win32') {
      const script = resolveScript('media_now_playing.ps1');
      if (!fs.existsSync(script)) {
        console.warn('media_now_playing.ps1 missing', script);
        return null;
      }
      return parseNowPlayingLine(await runPs(script));
    }
    if (process.platform === 'darwin') {
      const script = resolveScript('media_now_playing.applescript');
      if (!fs.existsSync(script)) {
        console.warn('media_now_playing.applescript missing', script);
        return null;
      }
      return parseNowPlayingLine(await runOsascript(script));
    }
    return null;
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
