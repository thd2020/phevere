import './platform/configure-core';
import { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, Tray, Menu, nativeImage, dialog, nativeTheme, Notification } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from './logger';
import { installDesktopDiagnostics } from './services/desktop-diagnostics';
import { provisionInstallerAudio } from './services/installer-provisioning';
import { installerAudioModelArgument, runInstallerAudioCommand } from './services/installer-audio-cli';
import { INSTALL_OCR_PACK_FLAG, runInstallerOcrCommand } from './services/installer-ocr-cli';
import { getOcrPackState, installOcrPack, onOcrPackChange } from './services/ocr-pack';
import { clipboardService } from './services/clipboard';
import { dictionaryService } from './services/dictionary';
import { wikipediaService } from './services/wikipedia';
import { searchService } from './services/search';
import { createNativeSelectionService, SelectionEvent, type NativeSelectionService } from './services/native-selection';
import {
  openMacAccessibilitySettings,
  promptOpenMacAccessibilitySettings,
} from './services/mac-accessibility';
import {
  openMacScreenRecordingSettings,
} from './services/mac-screen-recording';
import { contextCaptureHub, ContextEvent, selectionToContext } from './services/context-capture';
import { captureScreenRegion, captureAroundPoint, canCaptureWithoutPrompt } from './services/screen-capture';
import { ocrEngine, textNearPoint, ensureOcrDeps, getOcrStatus, setOcrProfile, resetOcrEngine } from './services/ocr-engine';
import { isLookupWorthy } from './services/text-normalize';
import { HoverLookupService, phevereWindowFocused } from './services/hover-lookup';
import { placePopupNearPoint, eventCoordSpace, physicalToDip, setWindowBounds, type ScreenCoordSpace } from './services/popup-placement';
import { popupSize } from './services/popup-size';
import { showWorkProgress, updateWorkProgress, closeWorkProgress } from './services/work-progress';
import { isAcceleratorPhysicallyHeld, isPrimaryMouseDown, primaryMousePressedSinceLastPoll } from './services/accelerator-key-state';
import { getForegroundWindowBoundsDip } from './services/foreground-window';
import { getNowPlaying, formatNowPlayingQuery } from './services/media-session';
import { probeTrayHost, watchTrayHost, linuxSessionInfo } from './services/linux-tray-host';
import { speakIpa, cancelIpaSpeak, fetchPronunciationAudio, prefetchPronunciationUrls, installPronunciationAudioProtocol } from './services/ipa-speak';
import {
  getAudioPrefs,
  setAudioPrefs,
  listVoices,
  selectVoice,
  cancelVoiceDownload,
  synthesize,
  startSpeechStream,
  speechStreamChunk,
  stopSpeech,
  isCancelled,
  stopSpeechWorker,
  warmSpeech,
  type AudioPrefs,
  type SpeakRequest,
  type VoiceId,
} from './services/speech';
import {
  fetchSenseImages,
  prefetchSenseImages,
  recordedPronunciationUrls,
  cacheBookWordMeaning,
  listAnswerHistory,
  listBookProgress,
  listWordbookSubs,
  listUserBooks,
  createUserBook,
  renameUserBook,
  addUserBookWords,
  removeUserBookWord,
  deleteUserBook,
  reviewBookWord,
  saveBookWord,
  setBookWordKnown,
  setWordbookGoal,
  subscribeWordbook,
  unsubscribeWordbook,
  vocabPayloadFromResult,
  examplesFromResult,
  type AnswerDetails,
} from '@phevere/core';
import {
  ankiTextFromBook,
  BOOK_FILE_EXTENSION,
  BookLockedError,
  decodeBookFile,
  exportBookFile,
  findBookConflict,
  importBookPayload,
  isBookFile,
  isZip,
  parseAnkiPackage,
  parseAnkiText,
  type BookPayload,
  type BookScope,
} from '@phevere/core';
import { readClipboardImage, loadImageFileAsPng, pngFromBase64 } from './services/clipboard-image';
import {
  loadMonitorSettings,
  saveMonitorSettingsFile,
  mergeMonitorSettings,
  monitorDefaults,
  MonitorMode,
  MonitorSettings,
} from './services/monitor-settings-store';
import {
  loadTranslationPrefs,
  saveTranslationPrefs,
  parseTranslationProvider,
  TranslationPrefs,
} from './services/translation-prefs-store';
import { loadApiKeys, saveApiKey } from './services/api-key-store';
import { loadSourcePrefs, saveSourcePref } from './services/source-prefs-store';
import {
  loadNotificationPrefs,
  mergeNotificationPrefs,
  NotificationKind,
  NotificationPrefs,
} from './services/notification-prefs-store';
import { getLocalDb, flushPersist as persistLocalDb, closeLocalDb, resolveSqlAsmPath, localDbPath } from './services/local-db';
import {
  checkForUpdates,
  getUpdateState,
  installPendingOnQuit,
  installUpdateNow,
  noteSessionEnding,
  rollBack,
  setUpdateMode,
  startUpdater,
} from './services/updater';
import type { UpdateMode } from './services/update-prefs-store';
import * as vocabStore from './services/vocab-store';
import { clearLookupSources, disposeSourceCapture, noteLookupSource, sourceForSavedWord } from './services/source-capture';
import { canSynthesizeKeys, focusWindowHandle, foregroundWindowHandle } from './services/key-synth';
import {
  copySelection,
  loadQuickTranslatePrefs,
  pasteText,
  saveQuickTranslatePrefs,
  shapeLike,
  type QuickTranslatePrefs,
} from './services/quick-translate';
import * as accountService from './services/account';
import * as offlineDict from './services/offline-dict-store';
import {
  applyDictionaryResultToNotebook,
  cancelVocabEnrich,
  enqueueVocabEnrich,
  startVocabEnricher,
  stopVocabEnricher,
} from './services/vocab-enrich';
// This allows TypeScript to pick up the magic constants that's auto-generated by Forge's Webpack
// plugin that tells the Electron app where to look for the Webpack-bundled app code (depending on
// whether you're running in development or production).
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const POPUP_WINDOW_WEBPACK_ENTRY: string;
declare const OCR_OVERLAY_WEBPACK_ENTRY: string;
declare const OCR_OVERLAY_PRELOAD_WEBPACK_ENTRY: string;
declare const QUICK_PANEL_WEBPACK_ENTRY: string;
declare const QUICK_PANEL_PRELOAD_WEBPACK_ENTRY: string;

const installerAudioModel = installerAudioModelArgument(process.argv);
const installerOcrPack = process.argv.includes(INSTALL_OCR_PACK_FLAG);
/** Setup frontend subprocess: run one download command, no windows or tray. */
const installerCommand = installerAudioModel !== undefined || installerOcrPack;
if (!installerCommand) {
  // Designed as light ink/paper. Win11 "dark" app mode otherwise tints Mica/Acrylic
  // near-black while CSS keeps dark text.
  nativeTheme.themeSource = 'light';
  installDesktopDiagnostics();
}

// Register ASAP — timed-out Promise.race fetches used to crash Electron via
// unhandledRejection (Forge then relaunched → looked like a frozen toolstrip).
process.on('unhandledRejection', (reason) => {
  try {
    // logger may not be ready yet
    const { log: earlyLog } = require('./logger');
    earlyLog.error('main', 'unhandledRejection (kept alive)', {
      err: reason instanceof Error ? reason.stack || reason.message : String(reason),
    });
  } catch {
    console.error('[unhandledRejection]', reason);
  }
});

/**
 * Optional: create `%APPDATA%/phevere/.disable-gpu` (empty file) if popup/GPU
 * fails on a machine (common with some laptop iGPU drivers). Must run before ready.
 */
try {
  const disableGpuFlag = path.join(app.getPath('userData'), '.disable-gpu');
  if (fs.existsSync(disableGpuFlag)) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    log.info('main', 'Hardware acceleration disabled (.disable-gpu present)');
  }
} catch (e) {
  /* ignore — path may be unavailable in odd launch contexts */
}

/** Only one packaged Phevere process. Dev/Forge must allow relaunch or the
 *  webpack restart exits immediately and leaves a wedged first instance. */
const gotSingleInstanceLock = app.isPackaged && !installerCommand ? app.requestSingleInstanceLock() : true;
if (app.isPackaged && !gotSingleInstanceLock) {
  app.exit(0);
}

// Check administrator privileges for UIAutomation
function checkAdminPrivileges(): boolean {
  if (process.platform !== 'win32') return true;
  try {
    const { execSync } = require('child_process');
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

// Global variables
let mainWindow: BrowserWindow | null = null;
let popupWindows: BrowserWindow[] = [];
/** Popups in the order they last had focus; the end is the foreground one. */
let popupFocusOrder: BrowserWindow[] = [];

function trackPopupFocus(win: BrowserWindow): void {
  win.on('focus', () => {
    popupFocusOrder = popupFocusOrder.filter((w) => w !== win && !w.isDestroyed());
    popupFocusOrder.push(win);
  });
  win.on('closed', () => {
    popupFocusOrder = popupFocusOrder.filter((w) => w !== win);
  });
}

/**
 * An outside click closed the foreground popup. The popups behind it are not
 * focused, so they get no blur of their own. Until one of them is focused
 * again, watch the mouse: each later press outside every popup closes the
 * popup that is now in front, one per click.
 */
let outsideClickWatch: ReturnType<typeof setInterval> | null = null;

function stopOutsideClickWatch(): void {
  if (outsideClickWatch) clearInterval(outsideClickWatch);
  outsideClickWatch = null;
}

function frontPopup(): BrowserWindow | undefined {
  const live = popupWindows.filter((w) => !w.isDestroyed() && w.isVisible());
  const ordered = [...popupFocusOrder].reverse().find((w) => live.includes(w));
  return ordered || live[live.length - 1];
}

function closePopupForOutsideClick(win: BrowserWindow): void {
  win.close();
  stopOutsideClickWatch();
  // Clear the press that closed the front popup before watching for the next one.
  primaryMousePressedSinceLastPoll();
  let wasDown = true;
  outsideClickWatch = setInterval(() => {
    const front = frontPopup();
    const focused = BrowserWindow.getFocusedWindow();
    if (!front || (focused && popupWindows.includes(focused))) {
      stopOutsideClickWatch();
      return;
    }
    const down = primaryMousePressedSinceLastPoll();
    if (down && !wasDown) {
      const p = screen.getCursorScreenPoint();
      const inside = popupWindows.some((w) => {
        if (w.isDestroyed() || !w.isVisible()) return false;
        const b = w.getBounds();
        return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
      });
      if (!inside) {
        log.debug('main', 'Close background popup on outside click');
        front.close();
      }
    }
    wasDown = down && isPrimaryMouseDown();
  }, 30);
}
let settingsWindow: BrowserWindow | null = null;
let externalWindows: BrowserWindow[] = []; // Track external windows opened by the app
let tray: Tray | null = null;
let appIsQuitting = false;
/** Native UIA hook is running (needed for both "on" and "shortcut" modes). */
let nativeSelectionActive = false;
let monitorSettings: MonitorSettings = { ...monitorDefaults };
let registeredCycleAccelerator: string | null = null;
let registeredTriggerAccelerator: string | null = null;
let registeredOcrAccelerator: string | null = null;
let registeredHoverAccelerator: string | null = null;
let registeredGrabAccelerator: string | null = null;
let registeredReadWindowAccelerator: string | null = null;
let registeredClipboardOcrAccelerator: string | null = null;
let registeredMediaAccelerator: string | null = null;
let registeredQuickReplaceAccelerator: string | null = null;
let registeredQuickPanelAccelerator: string | null = null;
let lastClipboardImageHash: string | null = null;
let clipboardImageWatchTimer: NodeJS.Timeout | null = null;
/** Max age of last selection for "select text, then press trigger" (ms). */
const TRIGGER_AFTER_SELECTION_MAX_MS = 60_000;
let nativeSelectionHandlerRegistered = false;
let lastSelectedText = '';
let lastSelectionEvent: ContextEvent | null = null;

/** Keep selection timestamps strictly increasing so a late getLastSelection cannot beat a newer popup-text. */
function setLastSelectionEvent(event: ContextEvent): void {
  const prev = lastSelectionEvent && lastSelectionEvent.timestamp ? lastSelectionEvent.timestamp : 0;
  const raw = typeof event.timestamp === 'number' && event.timestamp > 0 ? event.timestamp : Date.now();
  lastSelectionEvent = { ...event, timestamp: Math.max(raw, prev + 1) };
  lastSelectedText = event.text || '';
  if (event.origin === 'selection' || event.origin === 'manual') hoverLookup?.holdForSelection();
}

/** A selection, or the pop-up it opened, outranks hover until the user clicks elsewhere. */
function hoverYieldsToSelection(): boolean {
  if (hoverLookup?.isHeldBySelection()) return true;
  const ev = lastSelectionEvent;
  if (!ev || (ev.origin !== 'selection' && ev.origin !== 'manual')) return false;
  return popupWindows.some((win) => !win.isDestroyed() && win.isVisible());
}

/** Windows tray balloon; macOS / Linux Notification (displayBalloon is Win32-only). */
/** A null kind always shows: it answers a shortcut that could not do its job. */
function notifyUser(content: string, kind: NotificationKind | null, title = 'Phevere'): void {
  if (kind && !loadNotificationPrefs()[kind]) return;
  try {
    if (process.platform === 'win32') {
      if (tray && !tray.isDestroyed()) {
        tray.displayBalloon?.({ title, content });
      }
      return;
    }
    if (Notification.isSupported()) {
      new Notification({ title, body: content }).show();
    }
  } catch {
    /* optional */
  }
}

function clipboardOcrHint(): string {
  if (process.platform === 'darwin') return 'No image on the clipboard. Press ⌘⌃⇧4 to capture one.';
  if (process.platform === 'linux') return 'No image on the clipboard. Copy a region with Print Screen first.';
  return 'No image on the clipboard. Press Win+Shift+S to capture one.';
}

function clipboardOcrReadyHint(): string {
  return process.platform === 'darwin'
    ? 'Image copied. Press ⌘⇧I to scan it.'
    : 'Image copied. Press Ctrl+Shift+I to scan it.';
}
let lastPopupText: string = '';
let lastPopupAt: number = 0;
/** Latest strip still loading or collapsed — retarget here instead of spawning another. */
let inFlightPopup: BrowserWindow | null = null;
/** Where each strip was last asked to open, and for which word. */
const stripTargets = new WeakMap<BrowserWindow, { x: number; y: number; space: ScreenCoordSpace; text: string }>();
/** Popups that started closing; they are still in popupWindows until 'closed'. */
const closingPopups = new WeakSet<BrowserWindow>();
let ocrOverlayWindow: BrowserWindow | null = null;
let contextHubWired = false;
let hoverLookup: HoverLookupService | null = null;

// Native selection service
const nativeSelectionService: NativeSelectionService = !installerCommand ? createNativeSelectionService() : {
  start: async () => {},
  stop: async () => {},
  onSelection: () => {},
  isSupported: () => false,
  getStatus: () => ({ isRunning: false, platform: process.platform, method: 'installer' }),
};
let macAxPromptOpen = false;
let macAxPollTimer: ReturnType<typeof setInterval> | null = null;

function broadcastMonitorMode(): void {
  try {
    mainWindow?.webContents.send('monitor-mode-changed', { mode: monitorSettings.mode });
  } catch {
    /* ignore */
  }
}

function setMonitoringMode(mode: MonitorMode): void {
  if (monitorSettings.mode === mode) {
    return;
  }
  monitorSettings = mergeMonitorSettings({ mode }, monitorSettings);
  saveMonitorSettingsFile(monitorSettings);
  applyMonitoringFromMode();
  syncGlobalMonitorShortcuts();
  broadcastMonitorMode();
  updateTrayContextMenu();
}

function cycleMonitoringMode(): void {
  const order: MonitorMode[] = ['off', 'on', 'shortcut'];
  const i = order.indexOf(monitorSettings.mode);
  const next = order[(i + 1) % order.length];
  
  // Defer state change to prevent re-entrancy crash during globalShortcut callback
  setTimeout(() => {
    setMonitoringMode(next);
  }, 0);
}

function unregisterCycleMonitorShortcut(): void {
  if (registeredCycleAccelerator) {
    try {
      globalShortcut.unregister(registeredCycleAccelerator);
    } catch {
      /* ignore */
    }
    registeredCycleAccelerator = null;
  }
}

function unregisterTriggerShortcut(): void {
  if (registeredTriggerAccelerator) {
    try {
      globalShortcut.unregister(registeredTriggerAccelerator);
    } catch {
      /* ignore */
    }
    registeredTriggerAccelerator = null;
  }
}

/** Re-register cycle shortcut (always) and trigger shortcut (shortcut mode only). */
function syncGlobalMonitorShortcuts(): void {
  unregisterCycleMonitorShortcut();
  unregisterTriggerShortcut();

  const acc = monitorSettings.cycleShortcut;
  const ok = globalShortcut.register(acc, () => {
    cycleMonitoringMode();
  });
  if (ok) {
    registeredCycleAccelerator = acc;
  } else {
    log.warn('main', 'Failed to register cycle monitor shortcut', { acc });
  }

  if (monitorSettings.mode === 'shortcut') {
    const accTrigger = monitorSettings.triggerShortcut;
    const okTrigger = globalShortcut.register(accTrigger, () => {
      onTriggerShortcutAfterSelection();
    });
    if (okTrigger) {
      registeredTriggerAccelerator = accTrigger;
    } else {
      log.warn('main', 'Failed to register trigger shortcut', { acc: accTrigger });
    }
  }
}

function onTriggerShortcutAfterSelection(): void {
  if (monitorSettings.mode !== 'shortcut') {
    return;
  }
  const now = Date.now();
  const ev = lastSelectionEvent;
  // A stored hover word is only what the user means while the pointer is still on it.
  // Hovering A and then pressing the trigger over B must look up B at B, the way
  // modifier-key scan pop-ups (GoldenDict, Eudic) read the word under the pointer at the
  // key press. Reopening A at A looked like a stuck strip, then like a strip that drifts.
  // A selection counts the same way once a click has released its hold on hover: the
  // click usually cleared it, and the pointer now rests somewhere else.
  const hover = hoverLookup && hoverLookup.isRunning() ? hoverLookup : null;
  let readUnderPointer = !!hover && !ev;
  if (hover && ev) {
    const at = eventCoordSpace(ev) === 'physical' ? physicalToDip(ev.x, ev.y) : { x: ev.x, y: ev.y };
    const left = !hover.pointerNear(at.x, at.y);
    if (ev.origin === 'hover') {
      // Resting on a word longer than the selection window still means that word.
      readUnderPointer = left || now - ev.timestamp > TRIGGER_AFTER_SELECTION_MAX_MS;
    } else if (ev.origin === 'selection' || ev.origin === 'manual') {
      readUnderPointer = left && !hover.isHeldBySelection();
    }
  }
  if (readUnderPointer && hover) {
    // The word comes back through the context hub marked `requested`, which opens it.
    hover.requestNow();
    log.debug('main', 'Trigger shortcut: reading the word under the pointer');
    return;
  }
  if (!ev || !String(ev.text || '').trim()) {
    log.debug('main', 'Trigger shortcut: no stored selection');
    return;
  }
  const age = now - ev.timestamp;
  if (age > TRIGGER_AFTER_SELECTION_MAX_MS) {
    log.debug('main', 'Trigger shortcut: selection too old', { ageMs: age });
    return;
  }
  createPopupWindow(ev.x, ev.y, eventCoordSpace(ev), true);
}

/** Linux desktop shortcut → `phevere --lookup-selection`: look up PRIMARY now, whatever the mode. */
const LOOKUP_SELECTION_FLAG = '--lookup-selection';

async function lookupSelectionFromCli(): Promise<void> {
  if (typeof nativeSelectionService.readCurrentSelection !== 'function') return;
  wireContextCaptureHubOnce();
  const ev = await nativeSelectionService.readCurrentSelection();
  if (!ev) {
    log.info('main', 'lookup-selection: nothing selected');
    return;
  }
  setLastSelectionEvent(ev);
  createPopupWindow(ev.x, ev.y, eventCoordSpace(ev), true);
}

function unregisterAccel(current: string | null): void {
  if (!current) return;
  try {
    globalShortcut.unregister(current);
  } catch {
    /* ignore */
  }
}

function registerOrWarn(acc: string, handler: () => void, label: string): string | null {
  try {
    const ok = globalShortcut.register(acc, handler);
    if (ok) return acc;
    log.warn('main', 'Failed to register shortcut', { label, acc });
  } catch (error) {
    log.warn('main', 'Exception registering shortcut', { label, acc, err: String(error) });
  }
  return null;
}

/** OCR / hover / grab / media shortcuts from settings + fixed clipboard-history. */
function syncFixedAppShortcuts(): void {
  unregisterAccel(registeredOcrAccelerator);
  unregisterAccel(registeredHoverAccelerator);
  unregisterAccel(registeredGrabAccelerator);
  unregisterAccel(registeredReadWindowAccelerator);
  unregisterAccel(registeredClipboardOcrAccelerator);
  unregisterAccel(registeredMediaAccelerator);
  registeredOcrAccelerator = null;
  registeredHoverAccelerator = null;
  registeredGrabAccelerator = null;
  registeredReadWindowAccelerator = null;
  registeredClipboardOcrAccelerator = null;
  registeredMediaAccelerator = null;

  registeredOcrAccelerator = registerOrWarn(
    monitorSettings.ocrShortcut,
    () => {
      if (ocrOverlayWindow && !ocrOverlayWindow.isDestroyed()) {
        closeOcrOverlay();
        log.info('main', 'OCR ROI overlay cancelled via shortcut');
        return;
      }
      void startOcrRegionCapture();
    },
    'ocr',
  );

  registeredHoverAccelerator = registerOrWarn(
    monitorSettings.hoverShortcut,
    () => setHoverEnabled(!monitorSettings.hoverEnabled),
    'hover',
  );

  registeredGrabAccelerator = registerOrWarn(
    'CommandOrControl+Shift+G',
    () => void grabOcrUnderCursor(),
    'grab',
  );

  registeredReadWindowAccelerator = registerOrWarn(
    'CommandOrControl+Shift+W',
    () => void readForegroundWindowOcr(),
    'read-window',
  );

  registeredClipboardOcrAccelerator = registerOrWarn(
    'CommandOrControl+Shift+I',
    () => void ocrClipboardImage(),
    'clipboard-ocr',
  );

  registeredMediaAccelerator = registerOrWarn(
    'CommandOrControl+Shift+P',
    () => void lookupNowPlaying(),
    'media',
  );

  syncQuickTranslateShortcuts();

  // Clipboard history panel (fixed; not settings-editable)
  try {
    globalShortcut.unregister('CommandOrControl+Shift+V');
  } catch {
    /* ignore */
  }
  try {
    globalShortcut.register('CommandOrControl+Shift+V', () => {
      if (mainWindow) {
        mainWindow.webContents.send('show-clipboard-history');
      }
    });
  } catch {
    /* ignore */
  }
}

function registerFixedAppShortcuts(): void {
  syncFixedAppShortcuts();
}

function setHoverEnabled(enabled: boolean): void {
  monitorSettings = mergeMonitorSettings({ hoverEnabled: enabled }, monitorSettings);
  saveMonitorSettingsFile(monitorSettings);
  applyHoverFromSettings();
  updateTrayContextMenu();
  try {
    mainWindow?.webContents.send('monitor-hover-changed', { hoverEnabled: enabled });
  } catch {
    /* ignore */
  }
  log.info('main', enabled ? 'Hover lookup enabled' : 'Hover lookup disabled');
  notifyUser(
    enabled
      ? `Hover lookup on (${monitorSettings.hoverShortcut})`
      : `Hover lookup off (${monitorSettings.hoverShortcut})`,
    'hoverToggle',
  );
}

function applyHoverFromSettings(): void {
  const hover = ensureHoverLookup();
  if (monitorSettings.hoverEnabled) {
    if (!hover.isRunning()) hover.start();
  } else if (hover.isRunning()) {
    hover.stop();
  }
}

/* ---------------------------------------------------------- quick translation */

let quickPrefs: QuickTranslatePrefs = loadQuickTranslatePrefs();
let quickBusy = false;
let quickPanel: BrowserWindow | null = null;
let quickSession: { text: string; backup: Awaited<ReturnType<typeof copySelection>>['backup']; hwnd: number | bigint | null } | null = null;

const QUICK_ENGINE_LABEL: Record<string, string> = {
  google: 'Google Translate',
  mymemory: 'MyMemory',
  deepl: 'DeepL',
  youdao: 'Youdao',
};

/** Both quick translation shortcuts, registered only while the feature is on. */
function syncQuickTranslateShortcuts(): void {
  unregisterAccel(registeredQuickReplaceAccelerator);
  unregisterAccel(registeredQuickPanelAccelerator);
  registeredQuickReplaceAccelerator = null;
  registeredQuickPanelAccelerator = null;
  if (!quickPrefs.enabled || !canSynthesizeKeys()) return;
  registeredQuickReplaceAccelerator = registerOrWarn(quickPrefs.replaceShortcut, () => void runQuickReplace(), 'quick-replace');
  registeredQuickPanelAccelerator = registerOrWarn(quickPrefs.panelShortcut, () => void openQuickPanel(), 'quick-panel');
}

/** The engines for the panel, the Translation engine from Settings first. */
function quickEngines(): Array<{ id: string; label: string }> {
  const available: string[] = dictionaryService.availableTranslationProviders();
  const preferred: string = loadTranslationPrefs().provider;
  const ordered = preferred !== 'auto' && available.includes(preferred) ? [preferred, ...available.filter((p) => p !== preferred)] : available;
  return ordered.map((id) => ({ id, label: QUICK_ENGINE_LABEL[id] || id }));
}

/** Translate and replace: copy, translate with the defaults, paste. */
async function runQuickReplace(): Promise<void> {
  if (quickBusy) return;
  quickBusy = true;
  clipboardService.pauseFor(4000);
  try {
    const { text, backup } = await copySelection();
    if (!text) return;
    const hit = await dictionaryService.translateText(text, quickPrefs.to, quickPrefs.from, loadTranslationPrefs().provider);
    if (!hit?.text) {
      notifyUser('Could not translate the selection.', null);
      return;
    }
    clipboardService.pauseFor(2000);
    await pasteText(shapeLike(text, hit.text), backup);
  } catch (error) {
    log.warn('main', 'Quick translation failed', { err: String(error) });
  } finally {
    quickBusy = false;
  }
}

function quickPanelWindow(): BrowserWindow {
  if (quickPanel && !quickPanel.isDestroyed()) return quickPanel;
  quickPanel = new BrowserWindow(withWin11Chrome({
    width: 440,
    height: 260,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    webPreferences: {
      preload: QUICK_PANEL_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
    },
  }, 'solid'));
  quickPanel.on('blur', () => closeQuickPanel(false));
  quickPanel.on('closed', () => {
    quickPanel = null;
  });
  void quickPanel.loadURL(QUICK_PANEL_WEBPACK_ENTRY);
  return quickPanel;
}

/** Choose a translation: copy the selection, then show the panel near the pointer. */
async function openQuickPanel(): Promise<void> {
  if (quickBusy) return;
  quickBusy = true;
  clipboardService.pauseFor(4000);
  try {
    const hwnd = foregroundWindowHandle();
    const { text, backup } = await copySelection();
    if (!text) return;
    quickSession = { text, backup, hwnd };
    const win = quickPanelWindow();
    const cur = screen.getCursorScreenPoint();
    const [w, h] = win.getSize();
    const placed = placePopupNearPoint(cur.x, cur.y, w, h, { space: 'dip' });
    win.setPosition(placed.x, placed.y);
    const payload = {
      text,
      from: quickPrefs.from,
      to: quickPrefs.to,
      providers: quickEngines(),
      languages: dictionaryService.getSupportedLanguages().map((l) => ({ code: l.code, name: l.name })),
    };
    const send = () => {
      if (win.isDestroyed()) return;
      win.webContents.send('quick-panel-open', payload);
      win.show();
      win.focus();
    };
    if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', send);
    else send();
  } catch (error) {
    log.warn('main', 'Quick translation panel failed', { err: String(error) });
  } finally {
    quickBusy = false;
  }
}

/** Hide the panel, give focus back to the app the text came from, and paste when one was chosen. */
function closeQuickPanel(paste: string | false): void {
  const session = quickSession;
  quickSession = null;
  if (quickPanel && !quickPanel.isDestroyed() && quickPanel.isVisible()) quickPanel.hide();
  if (!session) return;
  focusWindowHandle(session.hwnd);
  if (process.platform === 'darwin') app.hide();
  if (paste === false) return;
  clipboardService.pauseFor(2000);
  setTimeout(() => void pasteText(shapeLike(session.text, paste), session.backup), 120);
}

ipcMain.handle('quick-panel-translate', async (_e, req: { from?: string; to?: string; provider?: string }) => {
  if (!quickSession) return null;
  const provider = (req?.provider || 'auto') as Parameters<typeof dictionaryService.translateText>[3];
  const hit = await dictionaryService.translateText(quickSession.text, req?.to || 'auto', req?.from || 'auto', provider);
  return hit?.text ? { text: hit.text, language: hit.language, detected: hit.detectedSourceLanguage } : null;
});
ipcMain.on('quick-panel-choose', (_e, text: string) => closeQuickPanel(String(text || '')));
ipcMain.on('quick-panel-cancel', () => closeQuickPanel(false));
ipcMain.on('quick-panel-resize', (_e, height: number) => {
  if (!quickPanel || quickPanel.isDestroyed() || !Number.isFinite(height)) return;
  const [w] = quickPanel.getSize();
  quickPanel.setSize(w, Math.max(120, Math.min(560, Math.round(height))));
});

ipcMain.handle('quick-translate-get', () => ({
  prefs: quickPrefs,
  supported: canSynthesizeKeys(),
  languages: dictionaryService.getSupportedLanguages().map((l) => ({ code: l.code, name: l.name })),
}));

ipcMain.handle('quick-translate-set', (_e, patch: Partial<QuickTranslatePrefs>) => {
  const next = { ...quickPrefs, ...(patch || {}) };
  if (next.enabled) {
    const replace = (next.replaceShortcut || '').trim();
    const panel = (next.panelShortcut || '').trim();
    const taken = [monitorSettings.cycleShortcut, monitorSettings.triggerShortcut, monitorSettings.ocrShortcut, monitorSettings.hoverShortcut];
    if (!replace || !panel || replace === panel || taken.includes(replace) || taken.includes(panel)) {
      return { success: false, error: 'Each shortcut must be different.', prefs: quickPrefs };
    }
  }
  // Save even when another app holds a shortcut, so the reader can pick a different one.
  quickPrefs = saveQuickTranslatePrefs(next, quickPrefs);
  syncQuickTranslateShortcuts();
  const inUse: string[] = [];
  if (quickPrefs.enabled && !registeredQuickReplaceAccelerator) inUse.push('replace');
  if (quickPrefs.enabled && !registeredQuickPanelAccelerator) inUse.push('panel');
  return { success: true, prefs: quickPrefs, taken: inUse };
});

function tryRegisterAccelerator(accelerator: string): boolean {
  if (!accelerator || !accelerator.trim()) {
    return false;
  }
  // If it's already the currently registered accelerator, it's valid by default
  if (
    accelerator === registeredCycleAccelerator ||
    accelerator === registeredTriggerAccelerator ||
    accelerator === registeredOcrAccelerator ||
    accelerator === registeredHoverAccelerator ||
    accelerator === registeredGrabAccelerator ||
    accelerator === registeredReadWindowAccelerator ||
    accelerator === registeredClipboardOcrAccelerator ||
    accelerator === registeredMediaAccelerator ||
    accelerator === registeredQuickReplaceAccelerator ||
    accelerator === registeredQuickPanelAccelerator
  ) {
    return true;
  }
  try {
    const ok = globalShortcut.register(accelerator, () => {});
    if (ok) {
      globalShortcut.unregister(accelerator);
    }
    return ok;
  } catch {
    return false;
  }
}

function applyMonitoringFromMode(): void {
  if (monitorSettings.mode === 'off') {
    void stopSelectionMonitoring();
  } else {
    startSelectionMonitoring();
  }
}

/** Resolve tray/window icon — __dirname can differ when webpack moves the main bundle. */
function resolveTrayIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tray-icon.png');
  }
  const candidates = [
    path.join(__dirname, '../../resources/tray-icon.png'),
    path.join(app.getAppPath(), 'resources', 'tray-icon.png'),
    path.join(process.cwd(), 'resources', 'tray-icon.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return p;
      }
    } catch {
      /* ignore */
    }
  }
  return candidates[0];
}

function resolveAppIconPath(): string | null {
  const darwinPackaged = [
    path.join(process.resourcesPath, `${app.getName()}.icns`),
    path.join(process.resourcesPath, 'phevere.icns'),
    path.join(process.resourcesPath, 'Phevere.icns'),
    path.join(process.resourcesPath, 'icon.icns'),
    path.join(process.resourcesPath, 'icon.png'),
    path.join(process.resourcesPath, 'tray-icon.png'),
  ];
  const darwinDev = [
    path.join(process.cwd(), 'packaging', 'icon.icns'),
    path.join(process.cwd(), 'packaging', 'icon.png'),
    path.join(process.cwd(), 'resources', 'tray-icon.png'),
  ];
  // Linux: nativeImage cannot decode .ico; ship and prefer the PNG.
  const linuxPackaged = [
    path.join(process.resourcesPath, 'icon.png'),
    path.join(process.resourcesPath, 'tray-icon.png'),
  ];
  const linuxDev = [
    path.join(process.cwd(), 'packaging', 'icon.png'),
    path.join(process.cwd(), 'resources', 'tray-icon.png'),
  ];
  const otherPackaged = [
    path.join(process.resourcesPath, 'icon.ico'),
    path.join(process.resourcesPath, 'tray-icon.png'),
    path.join(path.dirname(process.execPath), 'icon.ico'),
  ];
  const otherDev = [
    path.join(process.cwd(), 'packaging', 'icon.ico'),
    path.join(process.cwd(), 'packaging', 'icon.png'),
    path.join(process.cwd(), 'resources', 'tray-icon.png'),
  ];
  const candidates = app.isPackaged
    ? process.platform === 'darwin'
      ? darwinPackaged
      : process.platform === 'linux'
        ? linuxPackaged
        : otherPackaged
    : process.platform === 'darwin'
      ? darwinDev
      : process.platform === 'linux'
        ? linuxDev
        : otherDev;
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function getTrayIconPath(): string {
  return resolveTrayIconPath();
}

/** macOS Dock ignores BrowserWindow `icon`; set it after ready. */
function applyDockIcon(): void {
  if (process.platform !== 'darwin') return;
  try {
    if (!app.dock) return;
    const p = resolveAppIconPath();
    if (!p) return;
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      app.dock.setIcon(img);
    }
  } catch (e) {
    log.warn('main', 'dock.setIcon failed', { err: String(e) });
  }
}

/** Taskbar / window chrome — prefer .ico in packaged builds. */
function loadWindowIcon(): Electron.NativeImage | undefined {
  try {
    const p = resolveAppIconPath() || resolveTrayIconPath();
    if (!p || !fs.existsSync(p)) {
      log.warn('main', 'App icon file missing', { p });
      return undefined;
    }
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      return img;
    }
    log.warn('main', 'App icon image empty', { p });
  } catch (e) {
    log.warn('main', 'App icon load failed', { err: String(e) });
  }
  return undefined;
}

function withPopupDevFlag(entryUrl: string): string {
  const sep = entryUrl.includes('?') ? '&' : '?';
  return `${entryUrl}${sep}phevere_dev=${app.isPackaged ? '0' : '1'}`;
}

function showOrRestoreMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  try {
    if (process.platform === 'win32' || process.platform === 'linux') {
      mainWindow.setSkipTaskbar(false);
    }
  } catch {
    /* ignore */
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}

/** Hide a window to tray (main window only — uses concrete BrowserWindow from IPC sender when global ref is stale). */
function hideMainToTray(target: BrowserWindow): void {
  if (!target || target.isDestroyed()) {
    return;
  }
  try {
    if (process.platform === 'win32' || process.platform === 'linux') {
      target.setSkipTaskbar(true);
    }
  } catch {
    /* ignore */
  }
  target.hide();
}

/** "Restart to update" once a release is downloaded; "Update to …" when one waits for the user. */
function updateTrayItems(): Electron.MenuItemConstructorOptions[] {
  const state = getUpdateState();
  if (!state.available || state.status === 'installing') return [];
  const label =
    state.status === 'ready'
      ? `Restart to update to ${state.available.version}`
      : state.canInstall
        ? `Update to ${state.available.version}`
        : `Download Phevere ${state.available.version}…`;
  return [{ label, click: () => void installUpdateNow() }, { type: 'separator' }];
}

function buildTrayContextMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    ...updateTrayItems(),
    {
      label: 'Open Phevere',
      click: () => showOrRestoreMainWindow(),
    },
    {
      label: 'Settings…',
      click: () => {
        createSettingsWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Selection mode',
      submenu: [
        {
          label: 'Off',
          type: 'radio',
          checked: monitorSettings.mode === 'off',
          click: () => setMonitoringMode('off'),
        },
        {
          label: 'On',
          type: 'radio',
          checked: monitorSettings.mode === 'on',
          click: () => setMonitoringMode('on'),
        },
        {
          label: 'Shortcut (hold the trigger key)',
          type: 'radio',
          checked: monitorSettings.mode === 'shortcut',
          click: () => setMonitoringMode('shortcut'),
        },
      ],
    },
    {
      label: 'Hover lookup',
      type: 'checkbox',
      checked: !!monitorSettings.hoverEnabled,
      accelerator: monitorSettings.hoverShortcut,
      click: (item) => setHoverEnabled(!!item.checked),
    },
    {
      label: 'Scan region…',
      accelerator: monitorSettings.ocrShortcut,
      click: () => {
        if (ocrOverlayWindow && !ocrOverlayWindow.isDestroyed()) {
          closeOcrOverlay();
        } else {
          void startOcrRegionCapture();
        }
      },
    },
    {
      label: 'Scan under pointer',
      accelerator: 'CommandOrControl+Shift+G',
      click: () => void grabOcrUnderCursor(),
    },
    {
      label: 'Scan active window',
      accelerator: 'CommandOrControl+Shift+W',
      click: () => void readForegroundWindowOcr(),
    },
    {
      label: 'Scan clipboard image',
      accelerator: 'CommandOrControl+Shift+I',
      click: () => void ocrClipboardImage(),
    },
    {
      label: 'Look up now playing',
      accelerator: 'CommandOrControl+Shift+P',
      click: () => void lookupNowPlaying(),
    },
    {
      label: 'Clipboard history',
      accelerator: 'CommandOrControl+Shift+V',
      click: () => {
        showOrRestoreMainWindow();
        try {
          mainWindow?.webContents.send('show-clipboard-history');
        } catch {
          /* ignore */
        }
      },
    },
    { type: 'separator' },
    ...(process.platform === 'darwin'
      ? [
          {
            label: 'Open Accessibility Settings…',
            click: () => {
              nativeSelectionService.requestAccessibilityPrompt?.();
              void openMacAccessibilitySettings()
                .then(() => pollMacAccessibilityThenStart())
                .catch((err) => log.warn('main', 'Open Accessibility settings failed', { err: String(err) }));
            },
          } as Electron.MenuItemConstructorOptions,
          {
            label: 'Open Screen Recording Settings…',
            click: () => {
              void openMacScreenRecordingSettings().catch((err) =>
                log.warn('main', 'Open Screen Recording settings failed', { err: String(err) }),
              );
            },
          } as Electron.MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'Quit Phevere',
      click: () => {
        void quitPhevere();
      },
    },
  ]);
}

/** Orderly shutdown so UIA / OCR / Python child trees do not become zombies. */
async function quitPhevere(): Promise<void> {
  if (appIsQuitting) return;
  appIsQuitting = true;
  log.info('main', 'Quit Phevere (orderly)');
  await installPendingOnQuit();

  try {
    hoverLookup?.stop();
  } catch {
    /* ignore */
  }
  stopMacAxPoll();
  try {
    closeWorkProgress();
  } catch {
    /* ignore */
  }

  const hideWin = (win: BrowserWindow | null | undefined) => {
    try {
      if (win && !win.isDestroyed()) win.hide();
    } catch {
      /* ignore */
    }
  };
  hideWin(ocrOverlayWindow);
  popupWindows.forEach((w) => hideWin(w));
  hideWin(settingsWindow);
  externalWindows.forEach((w) => hideWin(w));
  hideWin(mainWindow);

  const bounded = (p: Promise<unknown>, ms: number) =>
    Promise.race([p, new Promise<void>((resolve) => setTimeout(resolve, ms))]);

  try {
    clipboardService.stopMonitoring();
  } catch {
    /* ignore */
  }
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
  try {
    ocrEngine.dispose?.();
  } catch (e) {
    log.warn('main', 'ocr dispose on quit', { err: String(e) });
  }
  try {
    stopVocabEnricher();
  } catch {
    /* ignore */
  }

  // UIA join() used to block the main thread 10s+ (Promise.race never fired) and ghost the tray.
  await Promise.allSettled([
    bounded(stopSelectionMonitoring().catch((): undefined => undefined), 800),
    bounded(closeLocalDb().catch((): undefined => undefined), 700),
  ]);

  const closeWin = (win: BrowserWindow | null | undefined) => {
    try {
      if (win && !win.isDestroyed()) win.destroy();
    } catch {
      /* ignore */
    }
  };
  closeWin(ocrOverlayWindow);
  ocrOverlayWindow = null;
  popupWindows.forEach((w) => closeWin(w));
  popupWindows = [];
  closeWin(settingsWindow);
  settingsWindow = null;
  externalWindows.forEach((w) => closeWin(w));
  externalWindows = [];
  closeWin(mainWindow);
  mainWindow = null;

  if (tray && !tray.isDestroyed()) {
    try {
      tray.destroy();
    } catch {
      /* ignore */
    }
    tray = null;
  }

  try {
    app.exit(0);
  } catch {
    process.exit(0);
  }
  setTimeout(() => {
    process.exit(0);
  }, 400);
}

if (!app.isPackaged) {
  const stopFromCli = () => {
    void quitPhevere();
  };
  process.once('SIGINT', stopFromCli);
  process.once('SIGTERM', stopFromCli);
}

function updateTrayContextMenu(): void {
  if (!tray || tray.isDestroyed()) return;
  // macOS: setContextMenu makes a left-click open the menu. We pop up on right-click.
  if (process.platform === 'darwin') return;
  tray.setContextMenu(buildTrayContextMenu());
}

/** 1×1 PNG fallback so Tray never receives an empty image on Windows. */
const TRAY_FALLBACK_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function createTray(): void {
  if (tray && !tray.isDestroyed()) {
    return;
  }
  let image: Electron.NativeImage;
  try {
    image = nativeImage.createFromPath(getTrayIconPath());
    if (image.isEmpty()) {
      throw new Error('tray image empty');
    }
  } catch {
    try {
      image = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_FALLBACK_PNG}`);
    } catch {
      image = nativeImage.createEmpty();
    }
  }
  // Menu bar extras are ~16pt. Passing a 44px bitmap without scaleFactor made
  // Electron treat it as 44pt — twice as tall as Clock / Control Centre.
  if (!image.isEmpty()) {
    const { width, height } = image.getSize();
    if (process.platform === 'darwin') {
      const px = 32;
      const square = image.resize({ width: px, height: px, quality: 'best' });
      image = nativeImage.createFromBuffer(square.toPNG(), { scaleFactor: 2 });
    } else if (width > 32 || height > 32) {
      image = image.resize({ width: 32, height: 32, quality: 'best' });
    }
  }
  tray = new Tray(image);
  tray.setToolTip('Phevere');
  try {
    tray.setIgnoreDoubleClickEvents(true);
  } catch {
    /* older Electron */
  }
  // Left-click: main window. Right-click: menu only (some builds also emit `click`).
  let ignoreNextClick = false;
  tray.on('right-click', () => {
    ignoreNextClick = true;
    if (process.platform === 'darwin') {
      tray?.popUpContextMenu(buildTrayContextMenu());
    }
    setTimeout(() => {
      ignoreNextClick = false;
    }, 400);
  });
  tray.on('click', () => {
    if (ignoreNextClick) return;
    showOrRestoreMainWindow();
  });
  if (process.platform !== 'darwin') {
    tray.setContextMenu(buildTrayContextMenu());
  }
}

/**
 * Linux: Electron picks the tray backend once, in `new Tray`. With no
 * StatusNotifier host on the bus yet (panel still starting at login, or GNOME
 * without AppIndicator) it falls back to an XEmbed icon, which Wayland panels
 * never show. Probe first, and rebuild the Tray when a host appears.
 */
async function initTray(): Promise<void> {
  if (process.platform !== 'linux') {
    createTray();
    return;
  }
  const session = linuxSessionInfo();
  let state: Awaited<ReturnType<typeof probeTrayHost>> = 'unknown';
  try {
    state = await probeTrayHost();
  } catch {
    /* treat as unknown */
  }
  createTray();
  if (state === 'ready') {
    log.info('main', 'Tray: StatusNotifier host ready', session);
    return;
  }
  if (state === 'unknown') {
    log.warn('main', 'Tray: no gdbus, busctl or dbus-send; cannot check for a StatusNotifier host', session);
    return;
  }
  log.warn('main', 'Tray: no StatusNotifier host yet; waiting for one', session);
  watchTrayHost({
    onReady: () => {
      log.info('main', 'Tray: StatusNotifier host appeared; recreating tray', session);
      if (tray && !tray.isDestroyed()) {
        try {
          tray.destroy();
        } catch {
          /* ignore */
        }
      }
      tray = null;
      createTray();
    },
    onSlow: () => {
      log.error('main', 'Tray: still no StatusNotifier host; tray icon is not visible', session);
      // X11 panels with a legacy system tray still show the XEmbed fallback.
      const xembedHidden = session.sessionType === 'wayland' || /gnome/i.test(session.desktop);
      if (!xembedHidden) return;
      try {
        if (Notification.isSupported()) {
          new Notification({
            title: 'Phevere',
            body: /gnome/i.test(session.desktop)
              ? 'No tray icon: turn on the AppIndicator extension. Run Phevere again to reopen its window.'
              : 'No tray icon: this desktop has no system tray. Run Phevere again to reopen its window.',
          }).show();
        }
      } catch {
        /* optional */
      }
    },
  });
}

// Open custom wiki window in standalone web window (not inside dictionary popup)
ipcMain.on('open-wiki', (_e, term: string) => {
  try {
    if (!term || typeof term !== 'string' || term.trim().length === 0) {
      log.warn('main', 'Invalid Wikipedia term', { term: String(term) });
      return;
    }

    const cleanTerm = term.trim();
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(cleanTerm)}`;
    log.info('main', 'Open Wikipedia', { term: cleanTerm });
    createWebWindow(url);
  } catch (error) {
    log.error('main', 'Error opening Wikipedia', { err: String(error) });
  }
});

/** Win11 is NT 10.0 build 22000+. Mica/Acrylic on Win10 leaves a fully transparent hole. */
function supportsWin11Material(): boolean {
  if (process.platform !== 'win32') return false;
  const parts = os.release().split('.').map((n) => parseInt(n, 10) || 0);
  return parts[0] === 10 && (parts[2] || 0) >= 22000;
}

/** Win11 Fluent: opaque durable windows (native caption overlay); pop-ups are solid paper.
 *  macOS durable windows: hiddenInset traffic lights (same 40px caption as Windows WCO). */
function withWin11Chrome(
  opts: Electron.BrowserWindowConstructorOptions,
  material: 'mica' | 'acrylic' | 'none' | 'solid' = 'mica',
): Electron.BrowserWindowConstructorOptions {
  // Pop-ups paint their own paper background. A backgrounded material on a frameless window
  // adds a strip of non-client frame below the page (14 px at 125 %), seen as a grey margin.
  if (material === 'solid') return { backgroundColor: '#F4F0EA', ...opts };
  if (process.platform === 'darwin' && material === 'none') {
    const { frame: _frame, titleBarOverlay: _overlay, ...rest } = opts;
    return {
      backgroundColor: '#F4F0EA',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 12 },
      ...rest,
    };
  }
  if (process.platform === 'win32' && material === 'none') {
    const { frame: _frame, ...rest } = opts;
    return {
      backgroundColor: '#F4F0EA',
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#F4F0EA',
        symbolColor: '#1c1917',
        height: 40,
      },
      ...rest,
    };
  }
  if (process.platform !== 'win32' || material === 'none' || !supportsWin11Material()) {
    return { backgroundColor: '#F4F0EA', ...opts };
  }
  return {
    backgroundMaterial: material,
    ...opts,
    // Fully transparent + OS-dark Mica reads as a black hole. Light themeSource
    // keeps DWM on the light material; paper-tinted 0-alpha avoids a black first paint.
    backgroundColor: opts.backgroundColor ?? 'rgba(244, 240, 234, 0)',
  };
}

function markWin32CaptionOverlay(win: BrowserWindow): void {
  if (process.platform !== 'win32') return;
  const inject = (): void => {
    if (win.isDestroyed()) return;
    void win.webContents
      .executeJavaScript(`document.documentElement.classList.add('has-wco')`)
      .catch((): undefined => undefined);
  };
  win.webContents.on('dom-ready', inject);
}

function markDarwinInsetChrome(win: BrowserWindow): void {
  if (process.platform !== 'darwin') return;
  const inject = (): void => {
    if (win.isDestroyed()) return;
    void win.webContents
      .executeJavaScript(`document.documentElement.classList.add('has-inset-chrome')`)
      .catch((): undefined => undefined);
  };
  win.webContents.on('dom-ready', inject);
}

/**
 * Show a window created with show:false on its first paint. ready-to-show can
 * be skipped when that first load is interrupted (a rebuild, a reload), which
 * left the main or settings window existing but invisible; the page finishing
 * its load shows it too.
 */
function showWhenLoaded(win: BrowserWindow): void {
  const reveal = (): void => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  };
  win.once('ready-to-show', reveal);
  win.webContents.once('did-finish-load', () => setTimeout(reveal, 400));
}

function markDurableWindowChrome(win: BrowserWindow): void {
  markWin32CaptionOverlay(win);
  markDarwinInsetChrome(win);
}

/** CSS blur off while the user drags an edge. Durable windows do not use Mica. */
function wireLiveResizeLite(win: BrowserWindow): void {
  let live = false;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  const begin = (): void => {
    if (win.isDestroyed()) return;
    if (!live) {
      live = true;
      try {
        win.webContents.send('main-window-resizing', true);
      } catch {
        /* loading */
      }
    }
    if (endTimer) clearTimeout(endTimer);
    endTimer = setTimeout(finish, 160);
  };
  const finish = (): void => {
    endTimer = null;
    if (!live || win.isDestroyed()) {
      live = false;
      return;
    }
    live = false;
    try {
      win.webContents.send('main-window-resizing', false);
    } catch {
      /* ignore */
    }
  };
  win.on('will-resize', begin);
  win.on('resize', begin);
  win.on('resized', () => {
    if (endTimer) clearTimeout(endTimer);
    finish();
  });
}

const createMainWindow = (): void => {
  const windowIcon = loadWindowIcon();
  // Create the browser window.
  mainWindow = new BrowserWindow(withWin11Chrome({
    height: 600,
    width: 800,
    minWidth: 560,
    minHeight: 420,
    frame: false,
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      // Allow text selection and copying in the main window
      webSecurity: true,
    },
    show: false, // Don't show main window by default
  }, 'none'));

  // and load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  showWhenLoaded(mainWindow);

  mainWindow.on('close', (event) => {
    if (!appIsQuitting) {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        hideMainToTray(mainWindow);
      }
    }
  });

  // REMOVED: This is dangerous and bypasses proper cleanup.
  // Tray Quit goes through quitPhevere(); do not app.exit from window closed.
  // mainWindow.on('closed', () => {
  //   console.log('[DEBUG] Main window closed, quitting app...');
  //   setTimeout(() => {
  //     console.log('[DEBUG] Force quitting app...');
  //     app.exit(0);
  //   }, 100);
  // });

  if (mainWindow) {
    markDurableWindowChrome(mainWindow);
    wireLiveResizeLite(mainWindow);
  }
};

function sendPopupText(win: BrowserWindow, text: string): void {
  const t = (text || '').trim();
  if (!t || !win || win.isDestroyed()) return;
  const ev = lastSelectionEvent;
  const same = ev && (ev.text || '').trim() === t;
  const ts = same && ev.timestamp ? ev.timestamp : Date.now();
  try {
    // Always send, even while the frame is loading — Chromium queues IPC for the
    // renderer. Skipping here dropped a correction until did-finish-load, which
    // may already have run with the previous word.
    win.webContents.send('popup-text', t, ts);
  } catch {
    /* renderer may not be ready; did-finish-load retries */
  }
}

/** Mouse X1/X2 (browser-backward / browser-forward) would otherwise walk Chromium page history. */
function interceptPopupHistoryKeys(win: BrowserWindow): void {
  win.on('app-command', (event, cmd) => {
    if (cmd !== 'browser-backward' && cmd !== 'browser-forward') return;
    event.preventDefault();
    try {
      if (!win.isDestroyed()) win.webContents.send('popup-app-command', cmd);
    } catch {
      /* ignore */
    }
  });
}

const createPopupWindow = (x: number, y: number, space: ScreenCoordSpace = 'dip', explicitTrigger = false): void => {
  // Slim strip: ten 28px icons (four views, then audio, copy, search, save, options, close)
  // with 2px gaps, a divider and 4px padding. Keep in sync with the collapsed toolbar
  // in popup-new.html, which measures itself and corrects this after load.
  const POPUP_STRIP_ICON = 28;
  const POPUP_STRIP_GAP = 2;
  const POPUP_STRIP_PAD = 4;
  const POPUP_STRIP_ICONS = 10;
  const POPUP_STRIP_DIVIDER = 7;
  const popupWidth =
    POPUP_STRIP_PAD * 2 +
    POPUP_STRIP_ICONS * POPUP_STRIP_ICON +
    POPUP_STRIP_ICONS * POPUP_STRIP_GAP +
    POPUP_STRIP_DIVIDER;
  const popupHeight = POPUP_STRIP_ICON + POPUP_STRIP_PAD * 2;

  // Multi-monitor safe: convert physical UIA points only. DIP hover/OCR/cursor
  // must not go through screenToDipPoint (that pins HiDPI home PCs to one corner).
  const placed = placePopupNearPoint(x, y, popupWidth, popupHeight, { space });
  const popupX = placed.x;
  const popupY = placed.y;
  log.debug('main', 'Popup bounds', { popupX, popupY, popupWidth, popupHeight, displayId: placed.displayId, space });

  // Coalesce duplicate requests for the same text within a short period
  const textForPopup = (lastSelectionEvent && (lastSelectionEvent.text || '').trim()) || lastSelectedText || '';
  log.debug('main', 'Create popup window', { x, y, textLen: textForPopup.length });
  const nowTs = Date.now();
  const STRIP_MAX_H = 64;
  // A strip whose auto-close or blur already called close() is still in popupWindows
  // until 'closed'. Handing it the next word lost that word with the window.
  const isLivePopup = (win: BrowserWindow): boolean =>
    !!win && !win.isDestroyed() && !closingPopups.has(win);
  const isCollapsedStrip = (win: BrowserWindow): boolean => {
    try {
      if (!isLivePopup(win)) return false;
      const [, h] = win.getSize();
      return h <= STRIP_MAX_H;
    } catch {
      return false;
    }
  };
  const reusableStrip = popupWindows.find((win) => isCollapsedStrip(win));
  const hasExpandedLookup = popupWindows.some(
    (win) => isLivePopup(win) && !isCollapsedStrip(win),
  );

  const applyStripTarget = (
    win: BrowserWindow,
    px: number,
    py: number,
    text: string,
    showIfReady: boolean,
    stripSpace: ScreenCoordSpace = space,
  ): void => {
    try {
      if (!win || win.isDestroyed()) return;
      // The load handlers below place the strip at this target, never at whatever
      // event came in last; a hover stored meanwhile in shortcut mode is not a request.
      stripTargets.set(win, { x: px, y: py, space: stripSpace, text });
      const stillStrip = isCollapsedStrip(win);
      if (!stillStrip) return;
      const placed = placePopupNearPoint(px, py, popupWidth, popupHeight, { space: stripSpace });
      setWindowBounds(win, { x: placed.x, y: placed.y, width: popupWidth, height: popupHeight });
      if (showIfReady) {
        try {
          if (!win.webContents.isLoadingMainFrame()) win.show();
        } catch {
          /* not ready */
        }
        try { win.focus(); } catch {}
      }
      if (text) sendPopupText(win, text);
    } catch (e) {
      log.warn('main', 'Popup retarget failed', { err: String(e) });
    }
  };

  // An open lookup panel must stay put. Explicit shortcuts can immediately
  // reopen the selected word, while any loading strip still handles only one request.
  if (!hasExpandedLookup || explicitTrigger) {
    const live =
      (inFlightPopup && isCollapsedStrip(inFlightPopup) ? inFlightPopup : null)
      || reusableStrip
      || null;
    // Only a strip that is still open makes a repeat redundant. Once it has closed,
    // the same word must open it again.
    if (live && !explicitTrigger && textForPopup && lastPopupText === textForPopup && nowTs - lastPopupAt < 1000) {
      log.debug('main', 'Skip duplicate popup (same text, 1s)');
      return;
    }
    if (live) {
      lastPopupAt = nowTs;
      lastPopupText = textForPopup;
      applyStripTarget(live, x, y, textForPopup, true);
      log.debug('main', 'Retarget popup to latest selection');
      return;
    }
  }

  // Commit immediately — do not wait for did-finish-load. Otherwise shortcut mode can
  // double-open: selection (keys held) + global trigger fire almost together, both pass
  // cooldown because lastPopupAt was still unset from the async popup path.
  lastPopupAt = nowTs;
  lastPopupText = textForPopup;

                const newPopupWindow = new BrowserWindow(withWin11Chrome({
                width: popupWidth,
                height: popupHeight,
                x: popupX,
                y: popupY,
                frame: false,
                resizable: true,
                alwaysOnTop: true,
                skipTaskbar: true, // Hide from taskbar as requested
                focusable: true,
                show: false,
                transparent: false,
                minWidth: 160,
                minHeight: 32,
                maxWidth: 1200,
                maxHeight: 900,
                movable: true, // Make window draggable
                webPreferences: {
                  preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
                  nodeIntegration: false,
                  contextIsolation: true,
                  webviewTag: true,
                  // Some GPU / sandbox combos fail to load the popup bundle on certain PCs.
                  sandbox: false,
                  backgroundThrottling: false,
                },
              }, 'solid'));
  inFlightPopup = newPopupWindow;
  stripTargets.set(newPopupWindow, { x, y, space, text: textForPopup });
  interceptPopupHistoryKeys(newPopupWindow);
  trackPopupFocus(newPopupWindow);
  // Close on blur to match intended UX (give clicks time to land on icons)
  newPopupWindow.on('blur', () => {
    setTimeout(() => {
      try {
        if (newPopupWindow.isDestroyed()) return;

        const focused = BrowserWindow.getFocusedWindow();
        const isPopupFocused = focused === newPopupWindow;

        if (!isPopupFocused && (!focused || !popupWindows.includes(focused))) {
          log.debug('main', 'Close popup on blur');
          closePopupForOutsideClick(newPopupWindow);
        } else {
          log.debug('main', 'Keep popup (focus)');
        }
      } catch (e) {
        log.warn('main', 'Popup blur check failed', { err: String(e) });
      }
    }, 150);
  });
// (moved) wiki handler registered at top-level below

  const popupUrl = withPopupDevFlag(POPUP_WINDOW_WEBPACK_ENTRY);
  let popupLoadRetries = 0;

  const loadPopupBundle = () => {
    newPopupWindow.loadURL(popupUrl).catch((error) => {
      log.error('main', 'Popup loadURL failed', { err: String(error) });
    });
  };

  newPopupWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    log.error('main', 'Popup load failed', { errorCode, errorDescription, validatedURL, isMainFrame });
    if (!isMainFrame) return;
    // ERR_ABORTED (-3) often from intentional navigation; skip.
    if (errorCode === -3) return;
    if (popupLoadRetries < 1 && !newPopupWindow.isDestroyed()) {
      popupLoadRetries += 1;
      log.warn('main', 'Retrying popup load once', { attempt: popupLoadRetries });
      setTimeout(() => {
        if (!newPopupWindow.isDestroyed()) loadPopupBundle();
      }, 250);
    } else {
      log.error(
        'main',
        'Popup still failed after retry. If this persists, create an empty file at userData/.disable-gpu and restart Phevere.',
        { userData: app.getPath('userData') },
      );
    }
  });

  newPopupWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('main', 'Popup render process gone', { reason: details?.reason, exitCode: details?.exitCode });
    if (popupLoadRetries < 1 && !newPopupWindow.isDestroyed()) {
      popupLoadRetries += 1;
      setTimeout(() => {
        if (!newPopupWindow.isDestroyed()) loadPopupBundle();
      }, 300);
    }
  });

  loadPopupBundle();

  // After the popup finishes loading, send the selected text to the renderer
  newPopupWindow.webContents.on('did-finish-load', () => {
    try {
      const target = stripTargets.get(newPopupWindow) || { x, y, space, text: textForPopup };
      const textToSend = target.text;
      applyStripTarget(newPopupWindow, target.x, target.y, textToSend, false, target.space);
      if (!newPopupWindow.isDestroyed() && !newPopupWindow.isVisible()) {
        newPopupWindow.show();
      }
      sendPopupText(newPopupWindow, textToSend);
      lastPopupText = textToSend;
    } catch (e) {
      log.warn('main', 'Send popup-text failed', { err: String(e) });
    }
    if (inFlightPopup === newPopupWindow) inFlightPopup = null;
  });

  // Show popup when ready
  newPopupWindow.once('ready-to-show', () => {
    const target = stripTargets.get(newPopupWindow);
    if (target) applyStripTarget(newPopupWindow, target.x, target.y, target.text, false, target.space);
    newPopupWindow.show();
    try { newPopupWindow.focus(); } catch {}
  });

  newPopupWindow.on('close', () => {
    closingPopups.add(newPopupWindow);
    if (inFlightPopup === newPopupWindow) inFlightPopup = null;
  });

                newPopupWindow.on('closed', () => {
                if (inFlightPopup === newPopupWindow) inFlightPopup = null;
                popupWindows = popupWindows.filter(win => win !== newPopupWindow);
                // Hovering the word this strip showed may open a strip again.
                hoverLookup?.forgetLastEmit();

                // Keep the selected text available for an immediate explicit relookup.
                // Selection expiry is checked by the shortcut handler.
              });

  popupWindows.push(newPopupWindow);
};

/** Open Settings, or bring it forward; `section` ("offline", "api") picks the page shown. */
const createSettingsWindow = (section?: string): void => {
  const target = section && /^[a-z]+$/.test(section) ? section : '';
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (target) void settingsWindow.webContents.executeJavaScript(`location.hash = '#settings/${target}'`).catch((): void => undefined);
    // A window that never painted stays hidden; focus() alone would leave the
    // gear doing nothing until restart.
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    if (!settingsWindow.isVisible()) settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  const windowIcon = loadWindowIcon();
  settingsWindow = new BrowserWindow(withWin11Chrome({
    width: 800,
    height: 600,
    minWidth: 640,
    minHeight: 480,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
    frame: false,
    ...(windowIcon ? { icon: windowIcon } : {}),
  }, 'none'));

  const settingsUrl = MAIN_WINDOW_WEBPACK_ENTRY + '#settings' + (target ? `/${target}` : '');
  settingsWindow.loadURL(settingsUrl);

  showWhenLoaded(settingsWindow);

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  // Allow ESC to close via IPC from renderer
  settingsWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'Escape') {
      settingsWindow?.close();
    }
  });
  if (settingsWindow) {
    markDurableWindowChrome(settingsWindow);
    wireLiveResizeLite(settingsWindow);
  }
};

/**
 * Phase 0 fan-in: every ContextEvent (selection, OCR, …) goes through here.
 */
function wireContextCaptureHubOnce(): void {
  if (contextHubWired) {
    return;
  }
  contextHubWired = true;

  contextCaptureHub.onContext((event: ContextEvent) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && focused === ocrOverlayWindow) {
      return;
    }

    // Hover must not replace the selected word, or the trigger and the strip show it instead.
    if (event.origin === 'hover' && hoverYieldsToSelection()) {
      return;
    }

    setLastSelectionEvent(event);

    // Shortcut mode: store selection/hover for select-then-trigger, but only open the
    // popup while the trigger chord is physically held. Hover must not bypass this
    // (dwell after a drag-select was opening the popup and made shortcut mode look broken).
    if (
      monitorSettings.mode === 'shortcut' &&
      (event.origin === 'selection' || event.origin === 'hover')
    ) {
      try {
        mainWindow?.webContents.send('selection-changed', event.text);
      } catch (e) {
        log.warn('main', 'selection-changed IPC failed', { err: String(e) });
      }
      const asked = event.origin === 'hover' && event.requested === true;
      if (asked || isAcceleratorPhysicallyHeld(monitorSettings.triggerShortcut)) {
        rememberLookupSource(event);
        createPopupWindow(event.x, event.y, eventCoordSpace(event), asked);
      }
      return;
    }

    if (monitorSettings.mode === 'off' && event.origin === 'selection') {
      return;
    }

    // OCR / hover work even if the user only opened the overlay while mode was on;
    // region OCR shortcut is always registered regardless of monitor mode.
    if (monitorSettings.mode === 'off' && event.origin === 'hover') {
      return;
    }

    try {
      mainWindow?.webContents.send('selection-changed', event.text);
    } catch (e) {
      log.warn('main', 'selection-changed IPC failed', { err: String(e) });
    }
    rememberLookupSource(event);
    createPopupWindow(event.x, event.y, eventCoordSpace(event));
  });
}

/**
 * Notes the window a selection or hover lookup came from, before the pop-up takes the
 * foreground, so a save from that pop-up can say where the word was met (source-capture.ts).
 */
function rememberLookupSource(event: ContextEvent): void {
  if (!monitorSettings.rememberSources) return;
  if (event.origin !== 'selection' && event.origin !== 'hover') return;
  try {
    noteLookupSource(event.text);
  } catch (error) {
    log.warn('main', 'source capture failed', { err: String(error) });
  }
}

/** Attaches where the word was met once capture finishes; the save itself never waits. */
async function attachLookupSource(entry: vocabStore.VocabEntry): Promise<void> {
  if (!monitorSettings.rememberSources || entry.context) return;
  const context = await sourceForSavedWord(entry.lemma);
  if (!context) return;
  const updated = await vocabStore.setVocabContextIfEmpty(entry.id, context);
  if (updated) broadcastToWindows('vocab-updated', { id: updated.id, lemma: updated.lemma });
}

function registerNativeSelectionHandlerOnce(): void {
  if (nativeSelectionHandlerRegistered) {
    return;
  }
  nativeSelectionHandlerRegistered = true;
  wireContextCaptureHubOnce();

  nativeSelectionService.onSelection((event: SelectionEvent) => {
    contextCaptureHub.emit({
      ...event,
      origin: event.origin || 'selection',
      source: event.source || 'native',
    } as SelectionEvent);
  });
}

function closeOcrOverlay(): void {
  if (ocrOverlayWindow && !ocrOverlayWindow.isDestroyed()) {
    ocrOverlayWindow.close();
  }
  ocrOverlayWindow = null;
}

async function startOcrRegionCapture(): Promise<void> {
  wireContextCaptureHubOnce();

  if (ocrOverlayWindow && !ocrOverlayWindow.isDestroyed()) {
    ocrOverlayWindow.focus();
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);

  ocrOverlayWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: OCR_OVERLAY_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  ocrOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  ocrOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  ocrOverlayWindow.setIgnoreMouseEvents(false);

  ocrOverlayWindow.on('closed', () => {
    ocrOverlayWindow = null;
  });

  try {
    await ocrOverlayWindow.loadURL(OCR_OVERLAY_WEBPACK_ENTRY);
    ocrOverlayWindow.show();
    ocrOverlayWindow.focus();
    log.info('main', 'OCR region overlay opened');
  } catch (error) {
    log.error('main', 'Failed to open OCR overlay', { err: String(error) });
    closeOcrOverlay();
  }
}

async function handleOcrRegionSelected(region: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<void> {
  const overlayBounds = ocrOverlayWindow?.getBounds();
  closeOcrOverlay();

  // Overlay uses client/DIP coords relative to its window; map to screen DIP.
  const screenRegion = {
    x: Math.round((overlayBounds?.x || 0) + region.x),
    y: Math.round((overlayBounds?.y || 0) + region.y),
    width: Math.round(region.width),
    height: Math.round(region.height),
  };

  const progressX = screenRegion.x + Math.floor(screenRegion.width / 2);
  const progressY = screenRegion.y + screenRegion.height;

  log.info('main', 'OCR region selected', screenRegion);

  showWorkProgress(progressX, progressY, {
    title: 'Recognizing text…',
    subtitle: 'Capturing screen region',
  });

  const capture = await captureScreenRegion(screenRegion);
  if (!capture) {
    closeWorkProgress();
    log.warn('main', 'Screen capture failed for OCR region');
    showWorkProgress(progressX, progressY, {
      title: 'Capture failed',
      subtitle: 'Try a larger region',
    });
    setTimeout(() => closeWorkProgress(), 1600);
    return;
  }

  updateWorkProgress({
    title: 'Recognizing text…',
    subtitle: 'Reading text',
  });

  const started = Date.now();
  const tick = setInterval(() => {
    const secs = Math.round((Date.now() - started) / 1000);
    updateWorkProgress({
      title: 'Recognizing text…',
      subtitle: `Still working… ${secs}s`,
    });
  }, 800);

  let ocr;
  try {
    ocr = await ocrEngine.recognize(capture.png);
  } finally {
    clearInterval(tick);
  }

  const text = (ocr.text || '').trim();

  if (!text || !isLookupWorthy(text)) {
    closeWorkProgress();
    log.warn('main', 'OCR produced no lookup-worthy text', {
      engine: ocr.engine,
      language: ocr.language,
      rawLen: (ocr.text || '').length,
    });
    const available = await ocrEngine.isAvailable().catch(() => false);
    const status = getOcrStatus();
    const hint = available
      ? '(No text found)'
      : status.needsPack
        ? '(Needs the OCR pack)'
        : `(Text recognition unavailable: ${status.lastError || 'embedded engine failed to load'})`;
    contextCaptureHub.emit({
      text: hint,
      x: progressX,
      y: progressY,
      timestamp: Date.now(),
      origin: 'ocr',
      confidence: 0,
      bounds: screenRegion,
      imageHash: capture.imageHash,
    });
    return;
  }

  updateWorkProgress({
    title: 'Looking up…',
    subtitle: text.length > 48 ? text.slice(0, 48) + '…' : text,
  });

  // Brief beat so the user sees the transition, then hand off to the popup.
  setTimeout(() => closeWorkProgress(), 180);

  contextCaptureHub.emit({
    text,
    x: progressX,
    y: progressY,
    timestamp: Date.now(),
    origin: 'ocr',
    confidence: ocr.confidence,
    bounds: screenRegion,
    imageHash: capture.imageHash,
  });
}

ipcMain.on('ocr-overlay-complete', (_event, region) => {
  void handleOcrRegionSelected(region);
});

ipcMain.on('ocr-overlay-cancel', (_event, reason?: string) => {
  log.debug('main', 'OCR overlay cancelled', { reason: reason || '' });
  closeOcrOverlay();
  if (reason === 'too-small') {
    const cursor = screen.getCursorScreenPoint();
    showWorkProgress(cursor.x, cursor.y, {
      title: 'Region too small',
      subtitle: 'Select a larger area.',
    });
    setTimeout(() => closeWorkProgress(), 1600);
  }
});

async function emitOcrFromPng(opts: {
  png: Buffer;
  x: number;
  y: number;
  bounds?: { x: number; y: number; width: number; height: number };
  imageHash?: string;
  origin: ContextEvent['origin'];
  progressTitle?: string;
  emptyMessage?: string;
}): Promise<void> {
  wireContextCaptureHubOnce();
  showWorkProgress(opts.x, opts.y, {
    title: opts.progressTitle || 'Recognizing text…',
    subtitle: 'Reading text',
  });

  const started = Date.now();
  const tick = setInterval(() => {
    const secs = Math.round((Date.now() - started) / 1000);
    updateWorkProgress({
      title: opts.progressTitle || 'Recognizing text…',
      subtitle: `Still working… ${secs}s`,
    });
  }, 800);

  let ocr;
  try {
    ocr = await ocrEngine.recognize(opts.png);
  } finally {
    clearInterval(tick);
  }

  const text = (ocr.text || '').trim();
  if (!text || !isLookupWorthy(text)) {
    closeWorkProgress();
    const available = await ocrEngine.isAvailable().catch(() => false);
    contextCaptureHub.emit({
      text:
        opts.emptyMessage ||
        (available
          ? '(No text found)'
          : getOcrStatus().needsPack
            ? '(Needs the OCR pack)'
            : `(Text recognition unavailable: ${getOcrStatus().lastError || 'embedded engine failed'})`),
      x: opts.x,
      y: opts.y,
      timestamp: Date.now(),
      origin: opts.origin,
      confidence: 0,
      bounds: opts.bounds,
      imageHash: opts.imageHash,
    });
    return;
  }

  updateWorkProgress({
    title: 'Looking up…',
    subtitle: text.length > 48 ? text.slice(0, 48) + '…' : text,
  });
  setTimeout(() => closeWorkProgress(), 180);

  contextCaptureHub.emit({
    text,
    x: opts.x,
    y: opts.y,
    timestamp: Date.now(),
    origin: opts.origin,
    confidence: ocr.confidence,
    bounds: opts.bounds,
    imageHash: opts.imageHash,
  });
}

async function grabOcrUnderCursor(): Promise<void> {
  const cur = screen.getCursorScreenPoint();
  log.info('main', 'Grab OCR under cursor', { x: cur.x, y: cur.y });
  showWorkProgress(cur.x, cur.y + 24, {
    title: 'Scanning under pointer…',
    subtitle: 'Capturing nearby text',
  });
  const capture = await captureAroundPoint(cur.x, cur.y, 160, 64);
  if (!capture) {
    closeWorkProgress();
    log.warn('main', 'Grab capture failed');
    return;
  }
  await emitOcrFromPng({
    png: capture.png,
    x: cur.x,
    y: cur.y + 24,
    bounds: capture.bounds,
    imageHash: capture.imageHash,
    origin: 'ocr',
    progressTitle: 'Scanning under pointer…',
  });
}

async function readForegroundWindowOcr(): Promise<void> {
  const bounds = getForegroundWindowBoundsDip();
  const cur = screen.getCursorScreenPoint();
  if (!bounds) {
    log.warn('main', 'Foreground window bounds unavailable');
    contextCaptureHub.emit({
      text: '(Could not scan this window)',
      x: cur.x,
      y: cur.y,
      timestamp: Date.now(),
      origin: 'ocr',
    });
    return;
  }

  // Avoid OCR of Phevere chrome when it is focused.
  if (phevereWindowFocused(mainWindow, popupWindows, settingsWindow, ocrOverlayWindow, externalWindows)) {
    log.info('main', 'Read-window skipped — Phevere focused');
    return;
  }

  log.info('main', 'Read foreground window OCR', { ...bounds });
  showWorkProgress(bounds.x + Math.floor(bounds.width / 2), bounds.y + 40, {
    title: 'Scanning window…',
    subtitle: 'Capturing foreground window',
  });
  const capture = await captureScreenRegion(bounds);
  if (!capture) {
    closeWorkProgress();
    return;
  }
  await emitOcrFromPng({
    png: capture.png,
    x: bounds.x + Math.floor(bounds.width / 2),
    y: bounds.y + 40,
    bounds,
    imageHash: capture.imageHash,
    origin: 'ocr',
    progressTitle: 'Scanning window…',
  });
}

async function ocrClipboardImage(): Promise<void> {
  const cur = screen.getCursorScreenPoint();
  const img = readClipboardImage();
  if (!img) {
    log.info('main', 'No clipboard image to OCR');
    notifyUser(clipboardOcrHint(), null);
    return;
  }
  lastClipboardImageHash = img.imageHash;
  await emitOcrFromPng({
    png: img.png,
    x: cur.x,
    y: cur.y,
    imageHash: img.imageHash,
    origin: 'clipboard',
    progressTitle: 'Scanning clipboard image…',
  });
}

async function lookupNowPlaying(): Promise<void> {
  wireContextCaptureHubOnce();
  const cur = screen.getCursorScreenPoint();
  showWorkProgress(cur.x, cur.y, {
    title: 'Now playing…',
    subtitle: 'Checking what is playing',
  });
  const info = await getNowPlaying();
  closeWorkProgress();
  if (!info) {
    contextCaptureHub.emit({
      text: '(Nothing is playing)',
      x: cur.x,
      y: cur.y,
      timestamp: Date.now(),
      origin: 'media',
    });
    return;
  }
  const query = formatNowPlayingQuery(info);
  contextCaptureHub.emit({
    text: query,
    x: cur.x,
    y: cur.y,
    timestamp: Date.now(),
    origin: 'media',
  });
}

function startClipboardImageWatcher(): void {
  if (clipboardImageWatchTimer) return;
  clipboardImageWatchTimer = setInterval(() => {
    const img = readClipboardImage();
    if (!img) return;
    if (img.imageHash === lastClipboardImageHash) return;
    lastClipboardImageHash = img.imageHash;
    notifyUser(clipboardOcrReadyHint(), 'clipboardImage');
  }, 2000);
}

ipcMain.handle('ocr-image-file', async (_event, filePath: string) => {
  const cur = screen.getCursorScreenPoint();
  const img = loadImageFileAsPng(String(filePath || ''));
  if (!img) return { success: false, error: 'Could not load image' };
  await emitOcrFromPng({
    png: img.png,
    x: cur.x,
    y: cur.y,
    imageHash: img.imageHash,
    origin: 'ocr',
    progressTitle: 'OCR dropped image…',
  });
  return { success: true };
});

ipcMain.handle('ocr-image-data', async (_event, dataUrl: string) => {
  const cur = screen.getCursorScreenPoint();
  const img = pngFromBase64(String(dataUrl || ''));
  if (!img) return { success: false, error: 'Could not decode image' };
  await emitOcrFromPng({
    png: img.png,
    x: cur.x,
    y: cur.y,
    imageHash: img.imageHash,
    origin: 'clipboard',
    progressTitle: 'OCR pasted image…',
  });
  return { success: true };
});

/** Plasma Wayland: KWin reports the pointer; Electron's freezes over Wayland windows. */
function linuxHoverCursor(): { point: () => { x: number; y: number }; start: () => void; stop: () => void } | undefined {
  if (process.platform !== 'linux' || !process.env.WAYLAND_DISPLAY) return undefined;
  let addon: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    addon = require('../native-addon');
  } catch {
    return undefined;
  }
  if (typeof addon.watchCursor !== 'function') return undefined;
  return {
    start: () => {
      addon.watchCursor(true);
    },
    stop: () => {
      addon.watchCursor(false);
    },
    point: () => addon.getWatchedCursor() || screen.getCursorScreenPoint(),
  };
}

function ensureHoverLookup(): HoverLookupService {
  if (!hoverLookup) {
    hoverLookup = new HoverLookupService({
      cursor: linuxHoverCursor(),
      getWordAtPoint: (x, y) => {
        if (typeof nativeSelectionService.getWordAtPoint === 'function') {
          return nativeSelectionService.getWordAtPoint(x, y);
        }
        return { text: '', x, y };
      },
      isMouseDown: isPrimaryMouseDown,
      isBlocked: () =>
        isPrimaryMouseDown() ||
        hoverYieldsToSelection() ||
        phevereWindowFocused(mainWindow, popupWindows, settingsWindow, ocrOverlayWindow, externalWindows),
      skipOcr: () => {
        if (getOcrStatus().needsPack) return true;
        // Wayland without KWin capture: each OCR would open the screencast picker.
        if (!canCaptureWithoutPrompt()) return true;
        const ev = lastSelectionEvent;
        if (!ev || !(ev.text || '').trim()) return false;
        if (ev.origin !== 'selection' && ev.origin !== 'manual') return false;
        return Date.now() - ev.timestamp < 2500;
      },
    });
  }
  return hoverLookup;
}

function stopMacAxPoll(): void {
  if (macAxPollTimer) {
    clearInterval(macAxPollTimer);
    macAxPollTimer = null;
  }
}

function pollMacAccessibilityThenStart(): void {
  stopMacAxPoll();
  const deadline = Date.now() + 120_000;
  macAxPollTimer = setInterval(() => {
    if (Date.now() > deadline) {
      stopMacAxPoll();
      log.warn('main', 'Timed out waiting for Accessibility grant');
      return;
    }
    if (!nativeSelectionService.isAccessibilityTrusted?.(false)) return;
    stopMacAxPoll();
    log.info('main', 'Accessibility granted; starting selection monitor');
    startSelectionMonitoring();
  }, 1500);
}

async function offerMacAccessibilityAndRetry(): Promise<void> {
  if (process.platform !== 'darwin' || macAxPromptOpen) return;
  macAxPromptOpen = true;
  try {
    nativeSelectionService.requestAccessibilityPrompt?.();
    const opened = await promptOpenMacAccessibilitySettings();
    if (opened) pollMacAccessibilityThenStart();
  } catch (err) {
    log.warn('main', 'Accessibility prompt failed', { err: String(err) });
  } finally {
    macAxPromptOpen = false;
  }
}

function startSelectionMonitoring(): void {
  log.debug('main', 'Start native selection monitoring');

  if (nativeSelectionActive) {
    return;
  }

  const isAdmin = checkAdminPrivileges();

  if (process.platform === 'win32' && !isAdmin) {
    log.warn('main', 'Not running as administrator; UIAutomation may be limited');
  }

  nativeSelectionActive = true;

  try {
    registerNativeSelectionHandlerOnce();

    nativeSelectionService
      .start()
      .then(() => {
        log.info('main', 'Native selection service started');
        updateTrayContextMenu();
      })
      .catch((error) => {
        nativeSelectionActive = false;
        log.error('main', 'Failed to start native selection', { err: String(error) });
        if (process.platform === 'darwin') {
          log.error(
            'main',
            'Grant Accessibility to Electron (dev) or Phevere (packaged) — use the prompt or tray “Open Accessibility Settings…”',
          );
          void offerMacAccessibilityAndRetry();
        } else if (!isAdmin) {
          log.error('main', 'Try running as Administrator for UIAutomation');
        }
        updateTrayContextMenu();
      });
  } catch (error: any) {
    log.error('main', 'Start selection monitoring failed', { err: String(error), stack: error?.stack });
    nativeSelectionActive = false;
  }
}

async function stopSelectionMonitoring(): Promise<void> {
  if (!nativeSelectionActive) {
    return;
  }

  try {
    nativeSelectionActive = false;
    log.debug('main', 'Stopping selection monitoring');

    await nativeSelectionService.stop();
    log.info('main', 'Native selection service stopped');
  } catch (error) {
    log.error('main', 'Stop selection monitoring failed', { err: String(error) });
  }
  updateTrayContextMenu();
}

// IPC handlers
ipcMain.handle('start-monitoring', () => {
  setMonitoringMode('on');
  return { success: true };
});

// Manual test for text selection
ipcMain.handle('test-text-selection', () => {
  log.debug('main', 'Manual text selection test');
  
  // Reset last selected text to allow testing same text
  lastSelectedText = '';
  
  // Simulate a text selection
  const testText = 'hello world';
  
  // Get cursor position
  const cursorPosition = screen.getCursorScreenPoint();
  log.debug('main', 'Test selection cursor', { x: cursorPosition.x, y: cursorPosition.y });
  
  // Create popup with test text
  createPopupWindow(cursorPosition.x, cursorPosition.y);
  try { mainWindow?.webContents.send('selection-changed', testText); } catch {}
  
  return { success: true, text: testText };
});

// Reset selection state for testing
ipcMain.handle('reset-selection-state', () => {
  log.debug('main', 'Reset selection state');
  lastSelectedText = '';
  return { success: true };
});

ipcMain.handle('stop-monitoring', () => {
  setMonitoringMode('off');
  return { success: true };
});

ipcMain.handle('monitor-get-state', () => {
  return {
    mode: monitorSettings.mode,
    cycleShortcut: monitorSettings.cycleShortcut,
    triggerShortcut: monitorSettings.triggerShortcut,
    hoverEnabled: monitorSettings.hoverEnabled,
    ocrShortcut: monitorSettings.ocrShortcut,
    hoverShortcut: monitorSettings.hoverShortcut,
    rememberSources: monitorSettings.rememberSources,
  };
});

ipcMain.handle('monitor-set-hover', (_event, enabled: boolean) => {
  setHoverEnabled(!!enabled);
  return { success: true, hoverEnabled: monitorSettings.hoverEnabled };
});

ipcMain.handle('monitor-set-remember-sources', (_event, enabled: boolean) => {
  monitorSettings = mergeMonitorSettings({ rememberSources: !!enabled }, monitorSettings);
  saveMonitorSettingsFile(monitorSettings);
  if (!monitorSettings.rememberSources) clearLookupSources();
  return { success: true, rememberSources: monitorSettings.rememberSources };
});

ipcMain.handle('monitor-toggle-hover', () => {
  setHoverEnabled(!monitorSettings.hoverEnabled);
  return { success: true, hoverEnabled: monitorSettings.hoverEnabled };
});

ipcMain.handle('start-ocr-region', () => {
  if (ocrOverlayWindow && !ocrOverlayWindow.isDestroyed()) {
    closeOcrOverlay();
    return { success: true, open: false };
  }
  void startOcrRegionCapture();
  return { success: true, open: true };
});

ipcMain.handle('monitor-set-mode', (_event, mode: MonitorMode) => {
  if (mode !== 'off' && mode !== 'on' && mode !== 'shortcut') {
    return { success: false, error: 'Invalid mode' };
  }
  setMonitoringMode(mode);
  return { success: true };
});

ipcMain.handle('monitor-cycle-mode', () => {
  cycleMonitoringMode();
  return { success: true, mode: monitorSettings.mode };
});

ipcMain.handle(
  'monitor-set-shortcuts',
  (
    _event,
    payload: {
      cycleShortcut: string;
      triggerShortcut: string;
      ocrShortcut?: string;
      hoverShortcut?: string;
      hoverEnabled?: boolean;
    },
  ) => {
    const cycle = (payload?.cycleShortcut || '').trim();
    const trigger = (payload?.triggerShortcut || '').trim();
    const ocr = (payload?.ocrShortcut || monitorSettings.ocrShortcut).trim();
    const hover = (payload?.hoverShortcut || monitorSettings.hoverShortcut).trim();
    if (!cycle || !trigger || !ocr || !hover) {
      return { success: false, error: 'All shortcut fields are required.' };
    }
    const all = [cycle, trigger, ocr, hover];
    if (new Set(all).size !== all.length) {
      return { success: false, error: 'Each shortcut must be different.' };
    }
    if (
      !tryRegisterAccelerator(cycle) ||
      !tryRegisterAccelerator(trigger) ||
      !tryRegisterAccelerator(ocr) ||
      !tryRegisterAccelerator(hover)
    ) {
      return {
        success: false,
        error: 'This shortcut is not valid.',
      };
    }
    monitorSettings = mergeMonitorSettings(
      {
        cycleShortcut: cycle,
        triggerShortcut: trigger,
        ocrShortcut: ocr,
        hoverShortcut: hover,
        hoverEnabled:
          typeof payload?.hoverEnabled === 'boolean' ? payload.hoverEnabled : monitorSettings.hoverEnabled,
      },
      monitorSettings,
    );
    saveMonitorSettingsFile(monitorSettings);
    syncGlobalMonitorShortcuts();
    syncFixedAppShortcuts();
    applyHoverFromSettings();
    updateTrayContextMenu();
    return { success: true };
  },
);

/** Store last in-app selection without opening or moving a popup. */
function rememberSelection(x: number, y: number, text: string): boolean {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t || !isLookupWorthy(t)) return false;
  setLastSelectionEvent(selectionToContext(t, x, y, 'manual'));
  try {
    mainWindow?.webContents.send('selection-changed', t);
  } catch {
    /* ignore */
  }
  return true;
}

/** In-app select-to-lookup uses the same monitor mode as UIA. */
function rememberAndMaybeOpenPopup(x: number, y: number, text: string): void {
  if (!rememberSelection(x, y, text)) return;
  if (monitorSettings.mode === 'off') return;
  if (monitorSettings.mode === 'shortcut' && !isAcceleratorPhysicallyHeld(monitorSettings.triggerShortcut)) {
    return;
  }
  createPopupWindow(x, y);
}

ipcMain.on('remember-selection', (_event, { x, y, text }) => {
  rememberSelection(x, y, text);
});

ipcMain.on('show-popup', (_event, { x, y, text }) => {
  rememberAndMaybeOpenPopup(x, y, text);
});

ipcMain.on('hide-popup', () => {
  cancelIpaSpeak();
  popupWindows.forEach(win => {
    if (win && !win.isDestroyed()) {
      win.close();
    }
  });
  popupWindows = [];
});

ipcMain.handle('show-settings-window', (_event, section?: unknown) => {
  createSettingsWindow(typeof section === 'string' ? section : undefined);
});

// Clipboard service IPC handlers
ipcMain.handle('clipboard-start-monitoring', () => {
  clipboardService.startMonitoring();
  return { success: true };
});

ipcMain.handle('clipboard-stop-monitoring', () => {
  clipboardService.stopMonitoring();
  return { success: true };
});

ipcMain.handle('clipboard-get-history', () => {
  clipboardService.syncFromClipboard();
  return clipboardService.getHistory();
});

ipcMain.handle('clipboard-get-recent', (event, count: number = 10) => {
  return clipboardService.getRecentEntries(count);
});

ipcMain.handle('clipboard-search', (event, query: string) => {
  return clipboardService.searchHistory(query);
});

ipcMain.handle('clipboard-copy', (event, text: string) => {
  clipboardService.copyToClipboard(text);
  return { success: true };
});

ipcMain.handle('clipboard-clear', () => {
  clipboardService.clearHistory();
  return { success: true };
});

ipcMain.handle('clipboard-remove-entry', (event, id: string) => {
  return clipboardService.removeEntry(id);
});

ipcMain.handle('clipboard-get-stats', () => {
  return clipboardService.getStats();
});

ipcMain.handle('clipboard-export', () => {
  return clipboardService.exportHistory();
});

ipcMain.handle('clipboard-import', (event, jsonData: string) => {
  return clipboardService.importHistory(jsonData);
});

// Synthetic speech (eSpeak NG / Kokoro), same rules as the phone app.
ipcMain.handle('audio-prefs-get', () => getAudioPrefs());
ipcMain.handle('audio-prefs-set', (_event, patch: Partial<AudioPrefs>) => {
  const next = setAudioPrefs(patch || {});
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      if (!w.isDestroyed()) w.webContents.send('audio-prefs-changed', next);
    } catch {
      /* closing */
    }
  }
  return next;
});
ipcMain.handle('speech-voices', () => ({ voices: listVoices(), selected: getAudioPrefs().voice }));
ipcMain.handle('speech-select-voice', (_event, id: VoiceId) => {
  selectVoice(id);
  return { voices: listVoices(), selected: getAudioPrefs().voice };
});
ipcMain.handle('speech-cancel-download', (_event, id: VoiceId) => {
  cancelVoiceDownload(id);
  return { voices: listVoices(), selected: getAudioPrefs().voice };
});
ipcMain.handle('speech-synthesize', async (_event, req: SpeakRequest) => {
  try {
    const wav = await synthesize(req || {});
    return { ok: true as const, dataUrl: `data:audio/wav;base64,${Buffer.from(wav).toString('base64')}` };
  } catch (error) {
    log.warn('main', 'speech-synthesize failed', { err: String(error) });
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
});
// Long text: the renderer pulls sentence chunks one at a time (see startSpeechStream).
const speechOwners = new WeakSet<Electron.WebContents>();
function trackSpeechOwner(sender: Electron.WebContents): number {
  const id = sender.id;
  if (!speechOwners.has(sender)) {
    speechOwners.add(sender);
    sender.once('destroyed', () => stopSpeech(id));
  }
  return id;
}
ipcMain.handle('speech-stream-start', (event, req: { text?: string; lang?: string }) => {
  try {
    return { ok: true as const, ...startSpeechStream(trackSpeechOwner(event.sender), req || {}) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle('speech-stream-chunk', async (_event, req: { id: number; index: number }) => {
  try {
    const wav = await speechStreamChunk(Number(req?.id), Number(req?.index));
    return { ok: true as const, dataUrl: `data:audio/wav;base64,${Buffer.from(wav).toString('base64')}` };
  } catch (error) {
    if (isCancelled(error)) return { ok: false as const, cancelled: true, error: 'cancelled' };
    log.warn('main', 'speech-stream-chunk failed', { err: String(error) });
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle('speech-stop', (event) => {
  stopSpeech(event.sender.id);
  return { ok: true as const };
});
app.on('will-quit', () => stopSpeechWorker());
app.on('will-quit', () => disposeSourceCapture());

// Dictionary service IPC handlers
ipcMain.handle('speak-ipa', async (_event, payload?: { ipa?: string; accent?: string }) => {
  try {
    await speakIpa(String(payload?.ipa || ''), payload?.accent);
    return { ok: true as const };
  } catch (error) {
    log.warn('main', 'speak-ipa failed', { err: String(error) });
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('cancel-ipa-speak', () => {
  cancelIpaSpeak();
  return { ok: true as const };
});

function prefetchRecordedPronunciation(result: { pronunciations?: Parameters<typeof recordedPronunciationUrls>[0] }): void {
  prefetchPronunciationUrls(recordedPronunciationUrls(result?.pronunciations));
}

ipcMain.handle('fetch-pronunciation-audio', async (_event, url: string) => {
  return fetchPronunciationAudio(String(url || ''));
});

ipcMain.handle('dictionary-lookup', async (event, text: string, targetLanguage: string = 'auto', enabledSources?: string[], lookupOpts?: { translationProvider?: string; sourceLanguage?: string }) => {
  const t0 = Date.now();
  // A phrase opens the Translation tab, whose speakers use the neural voice when one is chosen.
  if (/\S\s+\S|[㐀-鿿]{2}/.test(String(text || ''))) warmSpeech();
  const translationProvider = parseTranslationProvider(
    lookupOpts?.translationProvider ?? loadTranslationPrefs().provider,
  );
  try {
    const result = await dictionaryService.lookup(text, targetLanguage, enabledSources, {
      translationProvider,
      sourceLanguage: lookupOpts?.sourceLanguage,
      onUpdate: (updated) => {
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send('dictionary-lookup-update', updated);
          }
        } catch {
          /* popup closed */
        }
        prefetchRecordedPronunciation(updated);
        void applyDictionaryResultToNotebook(updated).catch((err) =>
          log.debug('main', 'notebook opportunistic fill skipped', { err: String(err) }),
        );
      },
    });
    log.info('main', 'Dictionary lookup OK', {
      wordLen: (text || '').length,
      ms: Date.now() - t0,
      defs: result?.definitions?.length || 0,
      sources: result?.sources,
    });
    void applyDictionaryResultToNotebook(result).catch((err) =>
      log.debug('main', 'notebook opportunistic fill skipped', { err: String(err) }),
    );
    prefetchRecordedPronunciation(result);
    return result;
  } catch (error) {
    log.error('main', 'Dictionary lookup failed', { err: String(error), ms: Date.now() - t0 });
    throw error;
  }
});

ipcMain.handle('dictionary-set-api-key', (event, apiKey: string) => {
  dictionaryService.setApiKey(apiKey);
  saveApiKey('googleKey', apiKey);
  return { success: true };
});

ipcMain.handle('dictionary-set-deepl-api-key', (event, deeplApiKey: string) => {
  dictionaryService.setDeepLApiKey(deeplApiKey);
  saveApiKey('deeplKey', deeplApiKey);
  return { success: true };
});

// Premium dictionary credential handlers
ipcMain.handle('dictionary-set-oxford-credentials', (_event, appId: string, appKey: string) => {
  dictionaryService.setOxfordCredentials(appId, appKey);
  return { success: true };
});

ipcMain.handle('dictionary-set-youdao-credentials', (_event, appKey: string, appSecret: string) => {
  dictionaryService.setYoudaoCredentials(appKey, appSecret);
  return { success: true };
});

ipcMain.handle('dictionary-set-wordsapi-credentials', (_event, rapidApiKey: string, rapidApiHost?: string) => {
  dictionaryService.setWordsApiCredentials(rapidApiKey, rapidApiHost);
  return { success: true };
});

ipcMain.handle('dictionary-set-collins-credentials', (_event, rapidApiKey: string, rapidApiHost: string) => {
  dictionaryService.setCollinsApiCredentials(rapidApiKey, rapidApiHost);
  return { success: true };
});

// Settings → API keys. Values go straight to the service and are never logged.
ipcMain.handle('dictionary-set-api-credential', (_event, field: string, value: string) => {
  dictionaryService.setApiCredential(String(field || ''), String(value ?? ''));
  saveApiKey(String(field || ''), String(value ?? ''));
  return { success: true };
});
ipcMain.handle('dictionary-get-api-key-presence', () => dictionaryService.getApiKeyPresence());
ipcMain.handle('dictionary-verify-api-key', async (_event, provider: string) => {
  const result = await dictionaryService.verifyApiKey(provider as Parameters<typeof dictionaryService.verifyApiKey>[0]);
  log.info('main', 'API key test', { provider, ok: result.ok });
  return result;
});

ipcMain.handle('dictionary-load-cc-cedict', async (_event, url: string) => {
  const ok = await dictionaryService.loadCcCedictFromUrl(url);
  return { success: ok };
});

ipcMain.handle('dictionary-get-sources', () => {
  return dictionaryService.getAvailableSources();
});

ipcMain.handle('dictionary-get-source-stats', () => {
  return dictionaryService.getSourceStats();
});

ipcMain.handle('dictionary-clear-cache', () => {
  dictionaryService.clearCache();
  return { success: true };
});

ipcMain.handle('dictionary-get-cache-stats', () => {
  return dictionaryService.getCacheStats();
});

// Provide a cache-first recall for history lookups
ipcMain.handle('dictionary-recall', async (_event, text: string, targetLanguage: string = 'en') => {
  try {
    // First try cache
    const key = `${(text || '').toLowerCase()}_${targetLanguage}`;
    const stats = dictionaryService.getCacheStats();
    if (stats.entries.includes(key)) {
      // reuse existing regular lookup, which will return cache immediately
      return await dictionaryService.lookup(text, targetLanguage);
    }
    // If not cached, do a normal lookup (it will cache)
    return await dictionaryService.lookup(text, targetLanguage);
  } catch (e) {
    log.error('main', 'Dictionary recall failed', { err: String(e) });
    throw e;
  }
});

ipcMain.handle('dictionary-get-enabled-sources', () => {
  const list = dictionaryService.getEnabledSources();
  log.debug('main', 'getEnabledSources', { count: list.length });
  return list;
});

ipcMain.handle('dictionary-set-source-enabled', (event, sourceName: string, enabled: boolean) => {
  log.debug('main', 'setSourceEnabled', { sourceName, enabled });
  dictionaryService.setSourceEnabled(sourceName, enabled);
  try {
    saveSourcePref(sourceName, enabled);
  } catch (error) {
    log.warn('main', 'Could not save source switch', { err: String(error) });
  }
  return { success: true };
});

ipcMain.handle('dictionary-get-supported-languages', () => {
  return dictionaryService.getSupportedLanguages();
});

// Pictures for the pop-up's senses and the notebook's cards, fetched in the main process (Node
// HTTP, shared cache). With an `updateId`, the first pictures go to the window while slower
// sources still answer; a `cancellable` search (a card) stops when the card scrolls away.
const senseImageSearches = new Map<string, AbortController>();

ipcMain.on('dictionary-sense-images-cancel', (_event, updateId: string) => {
  senseImageSearches.get(String(updateId || ''))?.abort();
});

ipcMain.handle(
  'dictionary-sense-images',
  (
    event,
    lemma: string,
    senses: Array<{ meaning: string; partOfSpeech?: string }>,
    opts?: { max?: number; lang?: string; updateId?: string; cancellable?: boolean },
  ) => {
    const updateId = typeof opts?.updateId === 'string' ? opts.updateId : '';
    const ctl = updateId && opts?.cancellable ? new AbortController() : null;
    if (ctl) senseImageSearches.set(updateId, ctl);
    return fetchSenseImages(String(lemma || ''), Array.isArray(senses) ? senses.slice(0, 200) : [], {
      max: opts?.max,
      lang: opts?.lang,
      signal: ctl?.signal,
      onUpdate: updateId
        ? (list) => {
            try {
              if (!event.sender.isDestroyed()) event.sender.send('dictionary-sense-images-update', updateId, list);
            } catch {
              /* pop-up closed */
            }
          }
        : undefined,
    }).finally(() => {
      if (ctl) senseImageSearches.delete(updateId);
    });
  },
);

// The pictures of a submitted word start while the dictionaries answer.
ipcMain.on('dictionary-sense-images-prefetch', (_event, lemma: string, lang?: string) => {
  prefetchSenseImages(String(lemma || ''), { lang: typeof lang === 'string' && lang ? lang : 'en' });
});

ipcMain.handle('dictionary-get-translation-prefs', () => {
  return loadTranslationPrefs();
});

ipcMain.handle('dictionary-set-translation-prefs', (_event, prefs: Partial<TranslationPrefs>) => {
  const next = {
    provider: parseTranslationProvider(prefs?.provider ?? loadTranslationPrefs().provider),
  };
  saveTranslationPrefs(next);
  return next;
});

ipcMain.handle('get-notification-prefs', () => loadNotificationPrefs());

ipcMain.handle('set-notification-prefs', (_event, patch: Partial<NotificationPrefs>) => {
  return mergeNotificationPrefs(patch || {});
});

ipcMain.handle('updates-get-state', () => getUpdateState());
ipcMain.handle('updates-set-mode', (_event, mode: UpdateMode) => setUpdateMode(mode));
ipcMain.handle('updates-check', async () => {
  await checkForUpdates(true);
  return getUpdateState();
});
ipcMain.handle('updates-install', () => installUpdateNow());
ipcMain.handle('updates-rollback', () => rollBack());

/** Copy the notebook to userData/backups before another version replaces this one. Keeps the newest five. */
async function backUpNotebook(from: string, to: string): Promise<void> {
  await persistLocalDb();
  const source = localDbPath();
  if (!fs.existsSync(source)) return;
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  fs.copyFileSync(source, path.join(dir, `phevere-${from}-before-${to}-${stamp}.sqlite`));
  const old = fs
    .readdirSync(dir)
    .filter((name) => /^phevere-.*\.sqlite$/.test(name))
    .sort()
    .reverse()
    .slice(5);
  for (const name of old) fs.rmSync(path.join(dir, name), { force: true });
  log.info('updater', 'notebook backed up', { dir, from, to });
}

function startUpdates(): void {
  // Logoff or shutdown on Windows: do not start an installer the session will kill halfway.
  app.on('browser-window-created', (_event, win) => win.on('session-end', noteSessionEnding));
  for (const win of BrowserWindow.getAllWindows()) win.on('session-end', noteSessionEnding);
  startUpdater({
    notify: (text) => notifyUser(text, 'updates'),
    beforeInstall: backUpNotebook,
    quit: () => void quitPhevere(),
    changed: (state) => {
      broadcastToWindows('updates-changed', state);
      updateTrayContextMenu();
    },
    parentWindow: () => (settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null),
  });
}

function broadcastToWindows(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    try {
      w.webContents.send(channel, payload);
    } catch {
      /* ignore */
    }
  }
}

// Holarky account (sign-in and notebook sync)
ipcMain.handle('account-get-state', () => accountService.getAccountState());
ipcMain.handle('account-sign-in', () => accountService.signIn());
ipcMain.handle('account-cancel-sign-in', () => accountService.cancelSignIn());
ipcMain.handle('account-sign-out', () => accountService.signOut());
ipcMain.handle('account-sync-now', () => accountService.syncNow());
ipcMain.handle('account-delete', (_e, confirmEmail: string) => accountService.deleteAccount(String(confirmEmail || '')));

// Vocabulary notebook
ipcMain.handle('vocab-list', async (_e, limit?: number) => {
  try {
    return await vocabStore.listVocab(limit ?? 2000);
  } catch (error) {
    log.error('main', 'vocab-list failed', { err: String(error) });
    throw error;
  }
});
/* ------------------------------------------------- word book files (.pvbook, Anki) */

/** Anki packages hold SQLite; open it with the same sql.js build the local database uses. */
let sqlJsForImport: Promise<any> | null = null;
const openSqliteForImport = async (bytes: Uint8Array) => {
  if (!sqlJsForImport) {
    const asm = resolveSqlAsmPath();
    if (!asm) throw new Error('SQLite is not available to read this Anki file.');
    // eslint-disable-next-line no-eval
    const req = eval('require') as NodeRequire;
    sqlJsForImport = Promise.resolve(req(asm)()).catch((err: unknown) => {
      sqlJsForImport = null;
      throw err;
    });
  }
  const SQL = await sqlJsForImport;
  const db = new SQL.Database(bytes);
  return {
    all(sql: string) {
      const res = db.exec(sql)[0];
      return res ? res.values.map((v: unknown[]) => Object.fromEntries(res.columns.map((c: string, i: number) => [c, v[i]]))) : [];
    },
    close: () => db.close(),
  };
};

function notifyWordsChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    try {
      w.webContents.send('vocab-updated', { id: '', lemma: '' });
    } catch {
      /* closed */
    }
  }
}

/** Export the book being viewed as .pvbook, or as Anki's text format. */
ipcMain.handle('vocab-export', async (e, req?: { scope?: BookScope; anki?: boolean } | string) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    const scope: BookScope = (typeof req === 'object' && req?.scope) || { kind: 'mine' };
    const anki = typeof req === 'object' && !!req?.anki;
    const file = await exportBookFile(scope, `Phevere ${app.getVersion()}`);
    const payload = anki ? await decodeBookFile(file.bytes) : null;
    const defaultPath = anki ? file.fileName.replace(/\.pvbook$/, ' (Anki).txt') : file.fileName;
    const result = await dialog.showSaveDialog(win || undefined, {
      title: anki ? 'Export for Anki' : 'Export book',
      defaultPath,
      filters: anki ? [{ name: 'Anki text', extensions: ['txt'] }] : [{ name: 'Phevere book', extensions: [BOOK_FILE_EXTENSION] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    if (payload) fs.writeFileSync(result.filePath, ankiTextFromBook(payload), 'utf8');
    else fs.writeFileSync(result.filePath, file.bytes);
    return { cancelled: false, path: result.filePath, count: file.count };
  } catch (error) {
    log.error('main', 'vocab-export failed', { err: String(error) });
    throw error;
  }
});

/** A .pvbook, an Anki .apkg or .txt, or an older .json or .csv notebook export. */
async function bookPayloadFromFile(filePath: string): Promise<BookPayload | null> {
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  const name = path.basename(filePath);
  if (isBookFile(bytes)) return decodeBookFile(bytes);
  if (isZip(bytes)) return parseAnkiPackage(bytes, openSqliteForImport, name);
  if (/\.txt$/i.test(name)) return parseAnkiText(Buffer.from(bytes).toString('utf8'), name);
  return null;
}

ipcMain.handle('vocab-import', async (e) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    const picked = await dialog.showOpenDialog(win || undefined, {
      title: 'Import a book',
      filters: [
        { name: 'Books', extensions: [BOOK_FILE_EXTENSION, 'apkg', 'txt', 'json', 'csv'] },
        { name: 'Phevere book', extensions: [BOOK_FILE_EXTENSION] },
        { name: 'Anki', extensions: ['apkg', 'txt'] },
        { name: 'Older Phevere export', extensions: ['json', 'csv'] },
      ],
      properties: ['openFile'],
    });
    if (picked.canceled || !picked.filePaths[0]) return { cancelled: true };
    const filePath = picked.filePaths[0];
    let payload: BookPayload | null;
    try {
      payload = await bookPayloadFromFile(filePath);
    } catch (error) {
      if (error instanceof BookLockedError || error instanceof Error) {
        await dialog.showMessageBox(win || undefined, { type: 'warning', message: 'This book could not be opened.', detail: error.message });
        return { cancelled: true };
      }
      throw error;
    }
    if (!payload) {
      // An export from before word book files: rows of My words.
      const raw = fs.readFileSync(filePath, 'utf8');
      const rows = filePath.toLowerCase().endsWith('.csv') ? vocabEntriesFromCsv(raw) : vocabEntriesFromJson(raw);
      let imported = 0;
      for (const row of rows) {
        if (!row.lemma?.trim()) continue;
        await vocabStore.addVocab(row).then((): void => { imported += 1; }, (): void => undefined);
      }
      notifyWordsChanged();
      return { cancelled: false, kind: 'mine', title: 'My words', words: imported };
    }
    let mode: 'replace' | 'keep-both' = 'keep-both';
    const conflict = await findBookConflict(payload);
    if (conflict && payload.book.kind === 'user') {
      const r = await dialog.showMessageBox(win || undefined, {
        type: 'question',
        buttons: ['Replace', 'Keep both', 'Cancel'],
        defaultId: 1,
        cancelId: 2,
        message: `You already have a book named “${conflict.title}”.`,
        detail: `Replace overwrites its word list with this file's. Keep both adds this one as “${conflict.title} (2)”. Progress is merged either way.`,
      });
      if (r.response === 2) return { cancelled: true };
      mode = r.response === 0 ? 'replace' : 'keep-both';
    } else if (conflict) {
      const r = await dialog.showMessageBox(win || undefined, {
        type: 'question',
        buttons: ['Merge progress', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        message: `You already added “${conflict.title}”.`,
        detail: "This file's progress is merged into it.",
      });
      if (r.response === 1) return { cancelled: true };
    }
    const result = await importBookPayload(payload, mode);
    notifyWordsChanged();
    return { cancelled: false, ...result };
  } catch (error) {
    log.error('main', 'vocab-import failed', { err: String(error) });
    throw error;
  }
});
ipcMain.handle('vocab-find', async (_e, lemma: string) => {
  try {
    return await vocabStore.findByLemma(lemma);
  } catch (error) {
    log.error('main', 'vocab-find failed', { err: String(error) });
    throw error;
  }
});
ipcMain.handle('vocab-add', async (_e, payload: vocabStore.VocabAddInput) => {
  try {
    // resolveForm: the heart saves the word the lookup opens, even when tapped before the page turned to it.
    const entry = await vocabStore.addVocab({ ...payload, resolveForm: true });
    if (!entry.definition || !String(entry.definition).trim()) {
      enqueueVocabEnrich(entry.lemma);
    }
    void attachLookupSource(entry).catch((err) => log.warn('main', 'source attach failed', { err: String(err) }));
    return entry;
  } catch (error) {
    log.error('main', 'vocab-add failed', { err: String(error) });
    throw error;
  }
});
ipcMain.handle('vocab-remove', async (_e, id: string) => {
  try {
    await vocabStore.ensureVocabReady();
    const existing = await vocabStore.getVocab(id);
    const ok = await vocabStore.removeVocab(id);
    if (existing) cancelVocabEnrich(existing.lemma);
    return ok;
  } catch (error) {
    log.error('main', 'vocab-remove failed', { err: String(error) });
    throw error;
  }
});
ipcMain.handle('vocab-update-note', async (_e, id: string, note: string) => {
  return vocabStore.updateVocabNote(id, note);
});
/** The question facts the renderer sends with a grade, for the answer history; anything else is dropped. */
function answerDetailsFrom(raw: unknown): AnswerDetails {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kinds = ['meaning-choice', 'word-choice', 'listen-choice', 'recall', 'listen-type', 'cloze', 'flash'];
  return {
    kind: kinds.includes(String(d.kind)) ? (String(d.kind) as AnswerDetails['kind']) : undefined,
    correct: typeof d.correct === 'boolean' ? d.correct : undefined,
    ms: Number.isFinite(Number(d.ms)) ? Number(d.ms) : undefined,
    bookId: typeof d.bookId === 'string' ? d.bookId : null,
  };
}

ipcMain.handle('vocab-review', async (_e, id: string, grade: 1 | 2 | 3 | 4, details?: unknown) => {
  return vocabStore.reviewVocab(id, grade, Date.now(), answerDetailsFrom(details));
});
ipcMain.handle('vocab-history', async () => listAnswerHistory());
// A destructive step asks first, in the system's own dialog like the import questions.
ipcMain.handle('vocab-confirm', async (e, ask: { message?: unknown; detail?: unknown; confirm?: unknown }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const opts = {
    type: 'warning' as const,
    buttons: [String(ask?.confirm || 'OK'), 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: String(ask?.message || ''),
    detail: ask?.detail ? String(ask.detail) : undefined,
  };
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return r.response === 0;
});

// Word books (packages/core/src/wordbook-store.ts): subscriptions and progress live in the same
// database as the notebook; the word lists themselves ship with the renderer.
ipcMain.handle('wordbook-state', async () => {
  return { subs: await listWordbookSubs(), progress: await listBookProgress(), userBooks: await listUserBooks() };
});
// Books the learner made, usually from a source in the Words tab.
ipcMain.handle('wordbook-user-create', async (_e, title: string, words: string[], source?: string) =>
  createUserBook(String(title || ''), Array.isArray(words) ? words.map(String) : [], source ? String(source) : undefined),
);
ipcMain.handle('wordbook-user-rename', async (_e, bookId: string, title: string) => renameUserBook(String(bookId), String(title || '')));
ipcMain.handle('wordbook-user-add', async (_e, bookId: string, words: string[]) =>
  addUserBookWords(String(bookId), Array.isArray(words) ? words.map(String) : []),
);
ipcMain.handle('wordbook-user-remove', async (_e, bookId: string, word: string) => removeUserBookWord(String(bookId), String(word || '')));
ipcMain.handle('wordbook-user-delete', async (_e, bookId: string) => deleteUserBook(String(bookId)));
ipcMain.handle('wordbook-subscribe', async (_e, bookId: string, dailyNew?: number) => subscribeWordbook(String(bookId), dailyNew));
ipcMain.handle('wordbook-unsubscribe', async (_e, bookId: string) => unsubscribeWordbook(String(bookId)));
ipcMain.handle('wordbook-goal', async (_e, bookId: string, dailyNew: number) => setWordbookGoal(String(bookId), Number(dailyNew) || 10));
ipcMain.handle('wordbook-review', async (_e, lemma: string, grade: 1 | 2 | 3 | 4, details?: unknown) =>
  reviewBookWord(String(lemma), grade, Date.now(), answerDetailsFrom(details)),
);
ipcMain.handle('wordbook-known', async (_e, lemma: string, known: boolean, bookId?: unknown) =>
  setBookWordKnown(String(lemma), !!known, Date.now(), typeof bookId === 'string' ? bookId : null),
);

/** Looks a book word up for its quiz and caches the meaning; null when offline. */
async function lookupBookWord(lemma: string): Promise<vocabStore.VocabAddInput | null> {
  try {
    const result = await dictionaryService.lookup(lemma, 'auto');
    const payload = vocabPayloadFromResult(result, lemma);
    await cacheBookWordMeaning(lemma, { definition: payload.definition, reading: payload.reading, partOfSpeech: payload.partOfSpeech });
    return payload;
  } catch (error) {
    log.warn('main', 'wordbook lookup failed', { lemma, err: String(error) });
    return null;
  }
}
ipcMain.handle('wordbook-meaning', async (_e, lemma: string) => {
  const payload = await lookupBookWord(String(lemma));
  return payload ? { definition: payload.definition, reading: payload.reading, partOfSpeech: payload.partOfSpeech } : null;
});
/** Example sentences for a quiz word (its gap-fill question), from the cached lookup. */
ipcMain.handle('wordbook-examples', async (_e, lemma: string) => {
  try {
    return examplesFromResult(await dictionaryService.lookup(String(lemma), 'auto'));
  } catch {
    return [];
  }
});
ipcMain.handle('wordbook-save', async (_e, lemma: string, hasMeaning?: boolean) => {
  const payload = hasMeaning ? {} : (await lookupBookWord(String(lemma))) || {};
  const entry = await saveBookWord(String(lemma), payload);
  if (!entry.definition || !String(entry.definition).trim()) enqueueVocabEnrich(entry.lemma);
  return entry;
});

function vocabEntriesFromJson(raw: string): vocabStore.VocabAddInput[] {
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : parsed?.entries;
  if (!Array.isArray(list)) throw new Error('JSON notebook must be an array (or { entries: [] })');
  return list.map((row: Record<string, unknown>) => vocabRowToInput(row));
}

function vocabEntriesFromCsv(raw: string): vocabStore.VocabAddInput[] {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const out: vocabStore.VocabAddInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? '';
    });
    out.push(vocabRowToInput(row));
  }
  return out;
}

function vocabRowToInput(row: Record<string, unknown>): vocabStore.VocabAddInput {
  const sourcesRaw = row.sources;
  let sources: string[] | undefined;
  if (Array.isArray(sourcesRaw)) sources = sourcesRaw.map(String);
  else if (typeof sourcesRaw === 'string' && sourcesRaw.trim()) {
    sources = sourcesRaw.split(/[|,]/).map((s) => s.trim()).filter(Boolean);
  }
  return {
    lemma: String(row.lemma || '').trim(),
    reading: row.reading ? String(row.reading) : undefined,
    definition: row.definition ? String(row.definition) : undefined,
    partOfSpeech: row.partOfSpeech ? String(row.partOfSpeech) : undefined,
    sourceLang: row.sourceLang ? String(row.sourceLang) : undefined,
    targetLang: row.targetLang ? String(row.targetLang) : undefined,
    sources,
    note: row.note ? String(row.note) : undefined,
  };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// Offline dictionary packs
ipcMain.handle('offline-list-packs', async () => offlineDict.listPacks());
ipcMain.handle('offline-list-catalog', async () => offlineDict.listCatalogStatus());
ipcMain.handle('offline-remove-pack', async (_e, packId: string) => {
  await offlineDict.removePack(packId);
  return { success: true };
});
ipcMain.handle('offline-lookup', async (_e, headword: string, language?: string) => {
  return offlineDict.lookupOffline(headword, language);
});
ipcMain.handle('offline-import-json', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Import dictionary pack',
    filters: [
      { name: 'Dictionary JSON', extensions: ['json', 'jsonl', 'ndjson'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return { success: false, cancelled: true };
  const imported = await offlineDict.importJsonFile(result.filePaths[0]);
  return { success: true, ...imported };
});
ipcMain.handle('offline-import-cedict-file', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Import CC-CEDICT file',
    filters: [
      { name: 'CEDICT', extensions: ['txt', 'u8'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return { success: false, cancelled: true };
  const imported = await offlineDict.importCedictTextFile(result.filePaths[0]);
  dictionaryService.markOfflinePackAvailable('CC-CEDICT', true);
  return { success: true, ...imported };
});
ipcMain.handle('offline-pack-details', async (_e, packId: string) => offlineDict.packDetails(String(packId || '')));
ipcMain.handle('offline-download-pack', async (e, packId: string) => {
  const id = String(packId || '');
  const sender = e.sender;
  const imported = await offlineDict.downloadCatalogPack(id, (p) => {
    if (!sender.isDestroyed()) sender.send('offline-pack-progress', { id, ...p });
  });
  if (imported.packId === 'cc-cedict') {
    dictionaryService.markOfflinePackAvailable('CC-CEDICT', true);
  }
  return { success: true, ...imported };
});
ipcMain.handle('offline-download-cedict', async () => {
  const imported = await offlineDict.downloadAndImportCedict();
  dictionaryService.markOfflinePackAvailable('CC-CEDICT', true);
  return { success: true, ...imported };
});

ipcMain.handle('ocr-get-status', async () => {
  try {
    const available = await ocrEngine.isAvailable();
    return { ...getOcrStatus(), available };
  } catch (error) {
    return { ...getOcrStatus(), available: false, lastError: String(error) };
  }
});
/** Pack state plus whether the active OCR model is waiting on it (hover chip, Capture tab). */
function ocrPackView() {
  return { ...getOcrPackState(), needsPack: !!getOcrStatus().needsPack };
}
ipcMain.handle('ocr-pack-state', () => ocrPackView());
ipcMain.handle('ocr-pack-install', async () => {
  try {
    await installOcrPack();
    return { ok: true, ...ocrPackView() };
  } catch (error) {
    return { ok: false, ...ocrPackView(), error: error instanceof Error ? error.message : String(error) };
  }
});
onOcrPackChange((state) => {
  if (installerCommand) return;
  if (!state.installing) {
    // Drop the cached "models missing" result so hover and Scan pick the pack up.
    resetOcrEngine();
    if (state.installed) {
      void ocrEngine
        .isAvailable()
        .then((ok) => (ok && ocrEngine.warmUp ? ocrEngine.warmUp() : undefined))
        .catch((err) => log.warn('main', 'OCR warm-up after pack install failed', { err: String(err) }));
    }
  }
  const view = { ...state, needsPack: !!getOcrStatus().needsPack };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('ocr-pack-changed', view);
  }
});
ipcMain.handle('ocr-ensure-deps', async () => {
  log.info('main', 'OCR ensureDeps requested');
  return ensureOcrDeps();
});
ipcMain.handle('ocr-set-profile', async (_e, profileId: string, customPath?: string | null) => {
  log.info('main', 'OCR set profile', { profileId, customPath: customPath || null });
  return setOcrProfile(profileId, customPath);
});
ipcMain.handle('ocr-pick-custom-folder', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Choose OCR model folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { cancelled: true };
  }
  return { cancelled: false, path: result.filePaths[0] };
});

// Wikipedia service IPC handlers
ipcMain.handle('wikipedia-search', async (event, term: string, language: string = 'en', limit: number = 5) => {
  try {
    return await wikipediaService.search(term, language, limit);
  } catch (error) {
    log.error('main', 'Wikipedia search failed', { err: String(error) });
    throw error;
  }
});

ipcMain.handle('wikipedia-get-random', async (event, language: string = 'en') => {
  try {
    return await wikipediaService.getRandomArticle(language);
  } catch (error) {
    log.error('main', 'Wikipedia random failed', { err: String(error) });
    throw error;
  }
});

ipcMain.handle('wikipedia-get-categories', async (event, pageId: number, language: string = 'en') => {
  try {
    return await wikipediaService.getCategories(pageId, language);
  } catch (error) {
    log.error('main', 'Wikipedia categories failed', { err: String(error) });
    throw error;
  }
});

ipcMain.handle('wikipedia-get-related', async (event, pageId: number, language: string = 'en', limit: number = 5) => {
  try {
    return await wikipediaService.getRelatedArticles(pageId, language, limit);
  } catch (error) {
    log.error('main', 'Wikipedia related failed', { err: String(error) });
    throw error;
  }
});

ipcMain.handle('wikipedia-clear-cache', () => {
  wikipediaService.clearCache();
  return { success: true };
});

ipcMain.handle('wikipedia-get-cache-stats', () => {
  return wikipediaService.getCacheStats();
});

// Search service IPC handlers
ipcMain.handle('get-last-selection', () => {
  return lastSelectionEvent;
});

ipcMain.handle('search-get-suggestions', async (event, query: string) => {
  try {
    return await searchService.getSuggestions(query);
  } catch (error) {
    log.error('main', 'Search suggestions failed', { err: String(error) });
    throw error;
  }
});

ipcMain.handle('search-query', async (event, query: string, limit: number = 5) => {
  try {
    return await searchService.search(query, limit);
  } catch (error) {
    log.error('main', 'Search query failed', { err: String(error) });
    throw error;
  }
});

ipcMain.handle('search-get-related', async (event, query: string) => {
  try {
    return await searchService.getRelatedSearches(query);
  } catch (error) {
    log.error('main', 'Related searches failed', { err: String(error) });
    throw error;
  }
});

ipcMain.handle('search-get-trending', async () => {
  try {
    return await searchService.getTrendingSearches();
  } catch (error) {
    log.error('main', 'Trending searches failed', { err: String(error) });
    throw error;
  }
});

ipcMain.handle('search-get-stats', async (event, query: string) => {
  try {
    return await searchService.getSearchStats(query);
  } catch (error) {
    log.error('main', 'Search stats failed', { err: String(error) });
    throw error;
  }
});

ipcMain.handle('search-clear-cache', () => {
  searchService.clearCache();
  return { success: true };
});

ipcMain.handle('search-get-cache-stats', () => {
  return searchService.getCacheStats();
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('browser-window-created', (_event, win) => {
  if (!supportsWin11Material()) return;
  win.webContents.on('dom-ready', () => {
    void win.webContents.executeJavaScript(
      `document.documentElement.classList.add('win11-mica');document.documentElement.style.colorScheme='light'`,
    ).catch((): undefined => undefined);
  });
});

function installDarwinAppMenu(): void {
  if (process.platform !== 'darwin') return;
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CommandOrControl+,',
          click: () => createSettingsWindow(),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('ready', () => {
  if (installerAudioModel !== undefined) {
    void runInstallerAudioCommand(installerAudioModel).then((exitCode) => app.exit(exitCode), () => app.exit(1));
    return;
  }
  if (installerOcrPack) {
    void runInstallerOcrCommand().then((exitCode) => app.exit(exitCode), () => app.exit(1));
    return;
  }
  if (!gotSingleInstanceLock) return;
  // Settings → API keys saved in an earlier session (safeStorage needs the app ready).
  for (const [field, value] of loadApiKeys()) dictionaryService.setApiCredential(field, value);
  for (const [name, on] of Object.entries(loadSourcePrefs())) dictionaryService.setSourceEnabled(name, on);
  if (process.platform === 'win32') {
    // Must match electron-builder appId for correct taskbar icon grouping.
    app.setAppUserModelId('com.phevere.app');
    nativeTheme.themeSource = 'light';
  }
  applyDockIcon();
  installDarwinAppMenu();
  log.info('main', 'App ready');
  installPronunciationAudioProtocol();
  monitorSettings = loadMonitorSettings();
  createMainWindow();
  void initTray();
  startUpdates();
  registerFixedAppShortcuts();
  startClipboardImageWatcher();
  syncGlobalMonitorShortcuts();
  applyMonitoringFromMode();
  applyHoverFromSettings();
  clipboardService.startMonitoring();
  accountService.initAccount({
    onState: (state) => broadcastToWindows('account-state', state),
    onNotebookChanged: () => broadcastToWindows('vocab-updated', { id: '', lemma: '' }),
  });
  void getLocalDb()
    .then(async () => {
      log.info('main', 'Local SQLite (vocab + offline dict) ready');
      startVocabEnricher();
      try {
        const packs = await offlineDict.listPacks();
        if (packs.some((p) => p.id === 'cc-cedict' || /cedict/i.test(p.name || ''))) {
          dictionaryService.markOfflinePackAvailable('CC-CEDICT', true);
        }
      } catch {
        /* optional */
      }
    })
    .catch((err) => log.warn('main', 'Local DB init failed', { err: String(err) }));
  // Warm RapidOCR models in the background so Ctrl+Shift+O is responsive.
  void ocrEngine
    .isAvailable()
    .then((ok) => {
      if (ok && ocrEngine.warmUp) return ocrEngine.warmUp();
    })
    .catch((err) => log.warn('main', 'OCR warm-up skipped', { err: String(err) }));
  log.info('main', 'Initialization complete');
  if (process.argv.includes(LOOKUP_SELECTION_FLAG)) {
    setTimeout(() => void lookupSelectionFromCli(), 600);
  }
  void provisionInstallerAudio().catch((err) => log.warn('installer', 'audio provisioning failed', { err: String(err) }));
});

app.on('second-instance', (_event, argv) => {
  if (argv.includes(LOOKUP_SELECTION_FLAG)) {
    void lookupSelectionFromCli();
    return;
  }
  log.info('main', 'Second instance attempted — focusing existing window');
  showOrRestoreMainWindow();
  try {
    const existing = popupWindows.find((w) => w && !w.isDestroyed());
    if (existing) {
      existing.show();
      existing.focus();
    }
  } catch {
    /* ignore */
  }
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  log.debug('main', 'window-all-closed (tray resident; quitPhevere owns exit)');
});

app.on('activate', () => {
  if (installerCommand) return;
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  } else {
    showOrRestoreMainWindow();
  }
});

// Cleanup on app quit
ipcMain.on('open-external', (_event, url: string) => {
  try {
    log.debug('main', 'Open external', { host: new URL(url).hostname });
  } catch {
    log.debug('main', 'Open external');
  }
  shell.openExternal(url);
});

// Open URL inside Electron instead of external browser (user-toggle can call this)
ipcMain.on('open-in-app', (_event, url: string) => {
  createWebWindow(url);
});

// Open full dictionary window in-app for a given term
ipcMain.on('open-full-lookup', (_event, term: string) => {
  try {
    createDictionaryWindow(term);
  } catch (e) {
    log.error('main', 'Open full lookup failed', { err: String(e) });
  }
});

// New popup functionality handlers
ipcMain.on('search-wikipedia', (event, term: string) => {
  // Route to in-app web window or later embed panel; keep simple redirect working
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(term)}`;
  createWebWindow(url);
});

            ipcMain.on('search-web', (event, term: string) => {
              log.debug('main', 'Search web', { termLen: (term || '').length });
              const url = `https://www.google.com/search?q=${encodeURIComponent(term)}`;
              createWebWindow(url);
            });

            ipcMain.on('window-resize', (event, { width, height, x, y, mode, minWidth }) => {
              log.debug('main', 'Popup resize', { width, height, x, y });
              // Resize the sender window (selection strip OR history full-lookup) —
              // never assume popupWindows[0], which left history windows stuck
              // and could resize the wrong strip when both exist.
              const size = popupSize(width, height, { mode, minWidth });
              if (!size) return;
              const w = size.width;
              const h = size.height;
              const senderWin = BrowserWindow.fromWebContents(event.sender);
              const target = senderWin;
              if (!target || target.isDestroyed()) return;
              try { target.setMinimumSize(size.minWidth, size.minHeight); } catch { /* ignore */ }
              if (!size.strip) {
                if (inFlightPopup === target) inFlightPopup = null;
                try { target.setMaximumSize(1200, 900); } catch { /* ignore */ }
                try { target.setResizable(true); } catch { /* ignore */ }
              }
              if (Number.isFinite(x) && Number.isFinite(y)) {
                const placed = placePopupNearPoint(x, y, w, h, { space: 'dip' });
                setWindowBounds(target, { x: placed.x, y: placed.y, width: w, height: h });
                return;
              }
              target.setSize(w, h);
              // The pop-up grows to fit its content; keep it inside the screen.
              try {
                const b = target.getBounds();
                const wa = screen.getDisplayMatching(b).workArea;
                const bottom = wa.y + wa.height;
                if (b.y + b.height > bottom) {
                  target.setPosition(b.x, Math.max(wa.y, bottom - b.height));
                }
              } catch {
                /* ignore */
              }
            });

            ipcMain.on('open-clipboard', () => {
              log.debug('main', 'Open clipboard window');
              // Create a clipboard history window
              const clipboardWindow = new BrowserWindow(withWin11Chrome({
                width: 500,
                height: 600,
                frame: false,
                resizable: true,
                alwaysOnTop: true,
                webPreferences: {
                  preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
                  nodeIntegration: false,
                  contextIsolation: true,
                },
              }, 'none'));

              clipboardWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY + '#clipboard');
              markDurableWindowChrome(clipboardWindow);
              wireLiveResizeLite(clipboardWindow);

              clipboardWindow.on('closed', () => {
                log.debug('main', 'Clipboard window closed');
              });
            });

            ipcMain.on('show-settings', () => {
              log.debug('main', 'Open settings');
              createSettingsWindow();
            });

            ipcMain.on('create-new-popup', (event, text: string) => {
              log.debug('main', 'Create new popup', { textLen: text.length });
              // Get current mouse position for new popup
              const mousePosition = screen.getCursorScreenPoint();
              // Set last selection so popup can render the word immediately
              setLastSelectionEvent(selectionToContext(text, mousePosition.x, mousePosition.y, 'manual'));
              // Also broadcast to recent selections UI
              try { mainWindow?.webContents.send('selection-changed', text); } catch {}
              createPopupWindow(mousePosition.x, mousePosition.y);
            });

// Window control handlers
ipcMain.on('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on('window-maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window-hide-to-tray', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) {
    return { ok: false as const };
  }
  if (mainWindow && win.id !== mainWindow.id) {
    win.close();
    return { ok: true as const };
  }
  hideMainToTray(win);
  return { ok: true as const };
});

app.on('before-quit', (event) => {
  if (!appIsQuitting) {
    if (app.isPackaged) {
      // Tray / Cmd+Q: await UIA/OCR stop so helpers do not linger.
      event.preventDefault();
      void quitPhevere();
      return;
    }
    // `npm start`: Ctrl+C is delivered to Electron, Forge, and webpack-dev-server.
    // preventDefault() kept this process alive, so the terminal needed a second
    // interrupt after Forge had already handled the first.
    void quitPhevere();
    return;
  }
  accountService.disposeAccount();
  try {
    void persistLocalDb();
  } catch {
    /* ignore */
  }
});

app.on('will-quit', () => {
  log.info('main', 'Will quit');
  // quitPhevere already tore these down; keep as safety net for other quit paths.
  try {
    hoverLookup?.stop();
  } catch {
    /* ignore */
  }
  try {
    closeWorkProgress();
  } catch {
    /* ignore */
  }
  try {
    clipboardService.stopMonitoring();
  } catch {
    /* ignore */
  }
  try {
    ocrEngine.dispose?.();
  } catch {
    /* ignore */
  }
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
  if (tray && !tray.isDestroyed()) {
    try {
      tray.destroy();
    } catch {
      /* ignore */
    }
    tray = null;
  }
});

app.on('quit', () => {
  log.info('main', 'Quit');
});

// Function to open a URL in a new window
const openWebWindows: { [url: string]: BrowserWindow | null } = {};

function createWebWindow(url: string): void {
  // Do not de-duplicate by URL; users may search/open different targets rapidly
  // Use a per-URL map only to focus existing if identical URL is requested twice in a row
  if (openWebWindows[url] && !openWebWindows[url].isDestroyed()) {
    openWebWindows[url].focus();
    return;
  }

  let webWindow: BrowserWindow | null = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    parent: mainWindow || undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  webWindow.loadURL(url);

  openWebWindows[url] = webWindow;

  webWindow.once('ready-to-show', () => {
    if (webWindow && !webWindow.isDestroyed()) webWindow.show();
  });

  webWindow.on('focus', () => {
    if (webWindow && !webWindow.isDestroyed()) webWindow.moveTop();
  });

  webWindow.on('closed', () => {
    openWebWindows[url] = null;
    // Remove from external windows tracking
    externalWindows = externalWindows.filter(win => win !== webWindow);
    webWindow = null;
  });

  // Track external window for selection monitoring
  externalWindows.push(webWindow);

  // Allow multiple subsequent popups of different URLs without blocking by the map
  setTimeout(() => {
    openWebWindows[url] = null;
  }, 1000);
}


// Create a dedicated dictionary window that uses the same floating popup chrome
function createDictionaryWindow(term: string): void {
  const popupWidth = 560;
  const popupHeight = 500;
  const mb = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : undefined;
  const placed = placePopupNearPoint(
    (mb?.x ?? 80) + Math.round((mb?.width ?? 800) * 0.55),
    (mb?.y ?? 80) + Math.round((mb?.height ?? 600) * 0.35),
    popupWidth,
    popupHeight,
    { space: 'dip' },
  );

  setLastSelectionEvent(selectionToContext(term, 0, 0, 'manual'));

  const dictWindow = new BrowserWindow(withWin11Chrome({
    width: popupWidth,
    height: popupHeight,
    x: placed.x,
    y: placed.y,
    show: false,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    movable: true,
    minWidth: 160,
    minHeight: 32,
    maxWidth: 1200,
    maxHeight: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      sandbox: false,
      backgroundThrottling: false,
      webviewTag: true,
    },
  }, 'solid'));

  interceptPopupHistoryKeys(dictWindow);
  trackPopupFocus(dictWindow);

  dictWindow.on('blur', () => {
    setTimeout(() => {
      try {
        if (dictWindow.isDestroyed()) return;
        const focused = BrowserWindow.getFocusedWindow();
        if (focused === dictWindow) return;
        if (focused && popupWindows.includes(focused)) return;
        closePopupForOutsideClick(dictWindow);
      } catch (e) {
        log.warn('main', 'History lookup blur check failed', { err: String(e) });
      }
    }, 150);
  });

  const expandedUrl = withPopupDevFlag(POPUP_WINDOW_WEBPACK_ENTRY) + '#popup';
  dictWindow.loadURL(expandedUrl).catch((error) => {
    log.error('main', 'History lookup loadURL failed', { err: String(error) });
  });
  dictWindow.webContents.on('did-finish-load', () => {
    try {
      if (!dictWindow.isDestroyed() && term) {
        dictWindow.webContents.send('popup-text', term, Date.now());
      }
    } catch (e) {
      log.warn('main', 'History lookup send popup-text failed', { err: String(e) });
    }
  });

  dictWindow.once('ready-to-show', () => {
    if (!dictWindow.isDestroyed()) {
      dictWindow.show();
      try { dictWindow.focus(); } catch { /* ignore */ }
    }
  });

  dictWindow.on('closed', () => {
    popupWindows = popupWindows.filter((win) => win !== dictWindow);
  });
  popupWindows.push(dictWindow);
}
