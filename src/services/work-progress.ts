/**
 * Slim always-on-top progress toast for long OCR / lookup work.
 * Frameless BrowserWindow with inline HTML — no Forge entry required.
 */

import { BrowserWindow, screen } from 'electron';
import { wrapConsole } from '../logger';

const console = wrapConsole('work-progress');

export interface WorkProgressState {
  title: string;
  subtitle?: string;
  /** 0–100, or omit for indeterminate shimmer. */
  percent?: number;
}

let progressWindow: BrowserWindow | null = null;

function buildHtml(state: WorkProgressState): string {
  const title = escapeHtml(state.title || 'Working…');
  const subtitle = escapeHtml(state.subtitle || '');
  const pct =
    typeof state.percent === 'number'
      ? Math.max(0, Math.min(100, Math.round(state.percent)))
      : null;
  const barInner =
    pct == null
      ? `<div class="bar indeterminate"></div>`
      : `<div class="bar determinate" style="width:${pct}%"></div>`;
  const pctLabel = pct == null ? '' : `<span class="pct">${pct}%</span>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  html,body{margin:0;height:100%;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
    background:rgba(15,23,42,.88);color:#f8fafc;user-select:none;-webkit-app-region:drag}
  .wrap{display:flex;flex-direction:column;justify-content:center;gap:8px;height:100%;padding:14px 16px;box-sizing:border-box}
  .row{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
  .title{font-size:13px;font-weight:600;letter-spacing:.01em}
  .pct{font-size:11px;color:#94a3b8;font-variant-numeric:tabular-nums}
  .sub{font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .track{height:3px;border-radius:999px;background:rgba(148,163,184,.25);overflow:hidden}
  .bar{height:100%;border-radius:999px;background:linear-gradient(90deg,#38bdf8,#818cf8,#c084fc)}
  .bar.determinate{transition:width .25s ease}
  .bar.indeterminate{width:42%;animation:slide 1.15s ease-in-out infinite}
  @keyframes slide{0%{transform:translateX(-120%)}100%{transform:translateX(280%)}}
</style></head>
<body><div class="wrap">
  <div class="row"><div class="title">${title}</div>${pctLabel}</div>
  <div class="track">${barInner}</div>
  ${subtitle ? `<div class="sub">${subtitle}</div>` : ''}
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function placeNear(x: number, y: number): { x: number; y: number } {
  const display = screen.getDisplayNearestPoint({ x, y });
  const { width, height } = display.workArea;
  const w = 280;
  const h = 72;
  const left = Math.max(display.workArea.x + 8, Math.min(x + 16, display.workArea.x + width - w - 8));
  const top = Math.max(display.workArea.y + 8, Math.min(y + 20, display.workArea.y + height - h - 8));
  return { x: left, y: top };
}

export function showWorkProgress(
  screenX: number,
  screenY: number,
  state: WorkProgressState
): void {
  const pos = placeNear(screenX, screenY);

  if (progressWindow && !progressWindow.isDestroyed()) {
    progressWindow.setPosition(pos.x, pos.y, false);
    void progressWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(state))}`);
    progressWindow.showInactive();
    return;
  }

  progressWindow = new BrowserWindow({
    width: 280,
    height: 72,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  progressWindow.setAlwaysOnTop(true, 'screen-saver');
  progressWindow.setIgnoreMouseEvents(true);
  progressWindow.on('closed', () => {
    progressWindow = null;
  });

  void progressWindow
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(state))}`)
    .then(() => {
      if (progressWindow && !progressWindow.isDestroyed()) {
        progressWindow.showInactive();
      }
    })
    .catch((err) => console.warn('progress window failed', err));
}

export function updateWorkProgress(state: WorkProgressState): void {
  if (!progressWindow || progressWindow.isDestroyed()) return;
  void progressWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(state))}`);
}

export function closeWorkProgress(): void {
  if (progressWindow && !progressWindow.isDestroyed()) {
    progressWindow.close();
  }
  progressWindow = null;
}
