/**
 * Now-playing / media session (docs/OCR_CONTEXT_CAPTURE.md Phase 5).
 * Windows: GlobalSystemMediaTransportControls via PowerShell WinRT helper.
 * macOS: Music.app / Spotify via AppleScript (same Title<TAB>Artist<TAB>Album line).
 * Linux: MPRIS2 over the session bus — playerctl when installed, else busctl.
 */

import { execFile, spawn } from 'child_process';
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

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 4000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout || ''));
    });
  });
}

interface MprisPlayer {
  status: string;
  title: string;
  artist: string;
  album: string;
}

/** Prefer a Playing player, else the first one with a title (SMTC's current session). */
function pickMpris(players: MprisPlayer[]): NowPlayingInfo | null {
  const withTitle = players.filter((p) => p.title.trim());
  const best = withTitle.find((p) => p.status === 'Playing') || withTitle[0];
  if (!best) return null;
  return { title: best.title.trim(), artist: best.artist.trim(), album: best.album.trim() || undefined };
}

async function mprisViaPlayerctl(): Promise<NowPlayingInfo | null> {
  const out = await run('playerctl', [
    '--all-players',
    'metadata',
    '--format',
    '{{status}}\t{{title}}\t{{artist}}\t{{album}}',
  ]);
  const players = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status = '', title = '', artist = '', album = ''] = line.split('\t');
      return { status, title, artist, album };
    });
  return pickMpris(players);
}

type BusValue = { type: string; data: unknown };

async function mprisViaBusctl(): Promise<NowPlayingInfo | null> {
  const list = JSON.parse(
    await run('busctl', ['--user', '--json=short', 'call', 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames']),
  ) as { data: string[][] };
  const names = (list.data?.[0] || []).filter((n) => n.startsWith('org.mpris.MediaPlayer2.'));
  const players: MprisPlayer[] = [];
  for (const name of names) {
    try {
      const lines = (
        await run('busctl', [
          '--user',
          '--json=short',
          'get-property',
          name,
          '/org/mpris/MediaPlayer2',
          'org.mpris.MediaPlayer2.Player',
          'PlaybackStatus',
          'Metadata',
        ])
      )
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as BusValue);
      const status = String(lines[0]?.data || '');
      const meta = (lines[1]?.data || {}) as Record<string, BusValue>;
      const str = (v?: BusValue) => (Array.isArray(v?.data) ? (v!.data as string[]).join(', ') : String(v?.data ?? ''));
      players.push({
        status,
        title: str(meta['xesam:title']),
        artist: str(meta['xesam:artist']),
        album: str(meta['xesam:album']),
      });
    } catch {
      /* player vanished mid-query */
    }
  }
  return pickMpris(players);
}

async function getNowPlayingLinux(): Promise<NowPlayingInfo | null> {
  try {
    return await mprisViaPlayerctl();
  } catch {
    return mprisViaBusctl();
  }
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
    if (process.platform === 'linux') {
      return await getNowPlayingLinux();
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
