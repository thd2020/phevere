/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/latest/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import './fonts';
import './index.css';
import { captureNextShortcut, isLinux, isMac } from './shortcut-capture';
import { wireGlobalSearch } from './global-search';
import '@phevere/core/notebook-views.css';
import '@phevere/core/notebook-families.css';
import '@phevere/core/notebook-cards.css';
import '@phevere/core/notebook-map.css';
import '@phevere/core/wordbook-views.css';
import '@phevere/core/popover-menu.css';
import '@phevere/core/learn-views.css';
import '@phevere/core/settings-kit.css';
import '@phevere/core/settings-sources.css';
import '@phevere/core/settings-about.css';
import '@phevere/core/settings-offline.css';
import '@phevere/core/settings-keys.css';
import {
  accountButtonHtml,
  accountPanelHtml,
  plusNoticeHtml,
  HOLARKY_ACCOUNT,
  analyzeNotebook,
  attachNotebookMap,
  attachFamilies,
  attachCardTable,
  cardLayoutIn,
  readCardLayouts,
  withCardLayout,
  cardsHtml,
  disposeNotebookMaps,
  deleteEmailMatches,
  familiesHtml,
  familiesTraceProgress,
  traceNotebookFamilies,
  fetchWordImage,
  fillWordImages,
  type WordImageFetcher,
  formatVocabLangPair,
  mapHtml,
  notebookViewSwitchHtml,
  filterRecentLookups,
  recentListHtml,
  vocabCopyText,
  flashCopied,
  learnHtml,
  attachLearnCharts,
  revealQuestion,
  reviewArmed,
  markKnownInReview,
  primeBookLevels,
  ROUND_WORDS,
  memoryLevel,
  readNotebookView,
  reviewAnswerDetails,
  scopeBookFor,
  type AnswerRecord,
  type LearnPage,
  type LearnerModel,
  type StudyPace,
  learnerModel,
  studyPace,
  hintReview,
  keepDraft,
  placeTile,
  returnTile,
  tileKey,
  armCountdown,
  markHeard,
  singleVoice,
  startReview,
  startExtraRound,
  extraNewCount,
  answerReview,
  overrideReview,
  advanceReview,
  isNewWord,
  previewReview,
  formatReviewGap,
  vocabEntryGroup,
  groupCatalogByLanguage,
  vocabListHtml,
  API_PROVIDERS,
  SOURCE_INFO,
  TRANSLATION_ENGINES,
  apiKeysPanelHtml,
  patchApiKeyCard,
  offlineShelvesHtml,
  packCardHtml,
  packInspectorHtml,
  sourcesPanelHtml,
  type KeyCardState,
  type KeyStatus,
  type PackDetails,
  type PackProgress,
  type PackView,
  type SourceRowInput,
  type AccountState,
  type CardLayout,
  type FamilyGrouping,
  type MorphKind,
  type NotebookView,
  type RecentLookup,
  type ReviewState,
  BOOK_LIST_PAGE,
  bookEntry,
  buildWordsContext,
  learnListsLeft,
  dropCurrentReview,
  isBookOnlyId,
  loadWordbook,
  reviewNeedsMeaning,
  scopeEntries,
  startScopeReview,
  wordbookHeaderHtml,
  wordbookLibraryHtml,
  wordbookListHtml,
  wordbookMeta,
  wordsScopeSwitchHtml,
  sourcesHtml,
  sourceGroups,
  sourceBookTitle,
  isUserBookId,
  type WordsContext,
  type WordsScope,
  type BookSort,
} from '@phevere/core';
import { choiceRowHtml, enhanceSelect, keycapsHtml, rangeRowHtml, segRowHtml, switchRowHtml } from '@phevere/core';
import { filterVocabByLang, parseGoal, vocabLangChipsHtml, vocabLanguages, savedForSpelling } from '@phevere/core';
import { aboutSettingsHtml, flashAboutCopied, type AboutPlatform } from '@phevere/core';
import { learnPickValue, learnSettingsHtml, microphoneAvailable, readLearnPrefs, syncLearnPick, watchMicrophone, writeLearnPrefs, type LearnPrefs } from '@phevere/core';
import { peekSuggestions, suggestWords, warmSuggestions } from '@phevere/core';
import { AZ_INDEX, compareAz, followIndexRail, vocabAzLetter, wireIndexRail } from '@phevere/core';
import { bookMenuItems, bookPickItems, bookRemovalPrompt, openMenu } from '@phevere/core';
import { languageRowHtml, asUiLanguagePref, t, tHtml, formatNumber, formatPercent, formatMegabytes, formatDate, formatList, languageDisplayName, uiLocale, UI_LANGUAGE_SELECT_ID } from '@phevere/core';
import { setUiLanguagePref, uiLanguagePref, windowLanguageReady } from './ui-language';

const rlog = (...args: unknown[]) => {
  if (!__PHEVERE_DEV__) return;
  console.log(...args);
};

rlog('🚀 Phevere renderer started');

document.getElementById('clearSelectionsBtn')?.addEventListener('click', () => {
  const before = loadRecentLookups();
  saveRecentLookups([]);
  renderRecentLookups();
  showUndoToast(t('desktop.recent.cleared'), () => {
    // Lookups made while the toast was up stay on top of the restored ones.
    const now = loadRecentLookups();
    const seen = new Set(now.map((e) => e.q.toLowerCase()));
    saveRecentLookups([...now, ...before.filter((e) => !seen.has(e.q.toLowerCase()))]);
    renderRecentLookups();
  });
});

/** A snackbar with one Undo action, as Gmail and Material show after a destructive action. */
function showUndoToast(message: string, undo: () => void): void {
  document.querySelector('.undo-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'undo-toast__action';
  button.textContent = t('common.undo');
  toast.append(text, button);
  const timer = setTimeout(() => toast.remove(), 8000);
  button.addEventListener('click', () => {
    clearTimeout(timer);
    toast.remove();
    undo();
  });
  document.body.appendChild(toast);
}

// Wait for DOM to be ready
// Each window loads its interface language before it builds any markup.
document.addEventListener('DOMContentLoaded', () => void windowLanguageReady().then(startWindow));

function startWindow(): void {
  const hash = window.location.hash;
  const path = window.location.pathname || '';

  // If we're on the dedicated popup bundle (/popup_window), DO NOT rebuild DOM.
  // The markup and behavior come from popup-new.html itself.
  if (path.includes('popup_window')) {
    rlog('[POPUP-RENDERER] Detected /popup_window. Skipping initializePopup() to use popup-new.html. hash=', hash);
  } else if (hash === '#settings' || hash.startsWith('#settings/')) {
    // Settings window functionality
    initializeSettingsWindow();
  } else if (hash === '#clipboard') {
    initializeClipboardWindow();
  } else {
    // Main window functionality
    initializeMainWindow();
  }
}

// Also try immediate execution if DOM is already ready
// IMPORTANT: Avoid double init. We rely solely on DOMContentLoaded above
function initializeSettingsWindow() {
  rlog('🚀 Initializing settings window...');

  document.body.className = 'settings-page';

  const settingsHTML = `
    <div class="settings-app">
      <header class="settings-titlebar">
        <div class="settings-titlebar__lead">
          <span class="settings-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 1024 1024" width="22" height="22" focusable="false">
              <defs>
              <linearGradient id="pvSettingsTile" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#F2EFE9"/><stop offset="1" stop-color="#F2EFE9"/>
              </linearGradient>
              <mask id="pvSettingsTwin" maskUnits="userSpaceOnUse" x="-40" y="-10" width="180" height="130">
              <path d="M30 55 C34 48 43 45 51 45 C63 45 71 53 71 64 C71 76 63 84 51 84 C43 84 35 81 30 75" stroke="#fff" stroke-width="12" fill="none"/>
              <polygon points="24,51 36,45 36,106 24,106" fill="#000"/>
              </mask>
              </defs>
              <rect width="1024" height="1024" rx="228" fill="url(#pvSettingsTile)"/>
              <rect x="1.5" y="1.5" width="1021" height="1021" rx="226.5" fill="none" stroke="#5E3A8C" stroke-opacity="0.12" stroke-width="3"/>
              <g transform="scale(8.53333) translate(10 10) translate(50 50) scale(1.1) translate(-46 -72.5) translate(14 0) skewX(-12)">
              <rect x="-40" y="-10" width="180" height="130" fill="#2A9D84" mask="url(#pvSettingsTwin)"/>
              <polygon points="24,51 36,45 36,106 24,106" fill="#5E3A8C"/>
              </g>
            </svg>
          </span>
          <div class="settings-titlebar__text">
            <h1 class="settings-titlebar__heading">Phevere</h1>
            <span class="settings-titlebar__sub">${tHtml('settings.title')}</span>
          </div>
        </div>
        <button type="button" id="settings-close" class="settings-close-btn" title="${tHtml('common.close')}" aria-label="${tHtml('common.close')}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
          </svg>
        </button>
      </header>
      <div class="settings-shell">
        <nav class="settings-nav" aria-label="${tHtml('settings.sections')}">
          <button type="button" class="settings-nav__item is-active" data-section="shortcuts">${tHtml('settings.section.shortcuts')}</button>
          <button type="button" class="settings-nav__item" data-section="capture">${tHtml('settings.section.capture')}</button>
          <button type="button" class="settings-nav__item" data-section="learn">${tHtml('settings.section.learn')}</button>
          <button type="button" class="settings-nav__item" data-section="notifications">${tHtml('settings.section.notifications')}</button>
          <button type="button" class="settings-nav__item" data-section="sources">${tHtml('settings.section.sources')}</button>
          <button type="button" class="settings-nav__item" data-section="offline">${tHtml('settings.section.offline')}</button>
          <button type="button" class="settings-nav__item" data-section="api">${tHtml('settings.section.api')}</button>
          <button type="button" class="settings-nav__item" data-section="audio">${tHtml('settings.section.audio')}</button>
          <button type="button" class="settings-nav__item" data-section="about">${tHtml('settings.section.about')}</button>
        </nav>
        <main class="settings-main">
          <section class="settings-panel is-active" data-panel="shortcuts" aria-labelledby="settings-monitor-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-monitor-heading" class="settings-panel__title">${tHtml('settings.section.shortcuts')}</h2>
            </div>
            <div class="sv sv-page">
              ${languageRowHtml(asUiLanguagePref(uiLanguagePref()))}
              <div class="sv-ledger">
                <div class="sv-row sv-row--keys">
                  <span class="sv-row__text"><span id="label-monitor-cycle" class="sv-row__label">${tHtml('desktop.settings.shortcuts.selectionMode')}</span></span>
                  <div class="sv-keycaps sv-keyfield" id="monitor-cycle-shortcut-keys"></div>
                  <input type="text" id="monitor-cycle-shortcut" readonly class="sv-vh" spellcheck="false" autocomplete="off" tabindex="-1" aria-labelledby="label-monitor-cycle" />
                  <button type="button" class="sv-btn" id="monitor-cycle-set">${tHtml('desktop.settings.shortcuts.set')}</button>
                </div>
                <div class="sv-row sv-row--keys">
                  <span class="sv-row__text"><span id="label-monitor-trigger" class="sv-row__label">${tHtml('desktop.settings.shortcuts.popupTrigger')}</span><span class="sv-row__sub">${tHtml('desktop.settings.shortcuts.popupTriggerHint')}</span></span>
                  <div class="sv-keycaps sv-keyfield" id="monitor-trigger-shortcut-keys"></div>
                  <input type="text" id="monitor-trigger-shortcut" readonly class="sv-vh" spellcheck="false" autocomplete="off" tabindex="-1" aria-labelledby="label-monitor-trigger" />
                  <button type="button" class="sv-btn" id="monitor-trigger-set">${tHtml('desktop.settings.shortcuts.set')}</button>
                </div>
                <div class="sv-row sv-row--keys">
                  <span class="sv-row__text"><span id="label-ocr-shortcut" class="sv-row__label">${tHtml('desktop.settings.shortcuts.scanRegion')}</span></span>
                  <div class="sv-keycaps sv-keyfield" id="ocr-shortcut-keys"></div>
                  <input type="text" id="ocr-shortcut" readonly class="sv-vh" spellcheck="false" autocomplete="off" tabindex="-1" aria-labelledby="label-ocr-shortcut" />
                  <button type="button" class="sv-btn" id="ocr-shortcut-set">${tHtml('desktop.settings.shortcuts.set')}</button>
                </div>
                <div class="sv-row sv-row--keys">
                  <span class="sv-row__text"><span id="label-hover-shortcut" class="sv-row__label">${tHtml('desktop.settings.shortcuts.hoverLookup')}</span></span>
                  <div class="sv-keycaps sv-keyfield" id="hover-shortcut-keys"></div>
                  <input type="text" id="hover-shortcut" readonly class="sv-vh" spellcheck="false" autocomplete="off" tabindex="-1" aria-labelledby="label-hover-shortcut" />
                  <button type="button" class="sv-btn" id="hover-shortcut-set">${tHtml('desktop.settings.shortcuts.set')}</button>
                </div>
                <div class="sv-ledger__foot">
                  <span id="monitor-shortcuts-status" class="sv-actions__status" role="status" aria-live="polite"></span>
                  <button type="button" id="monitor-save-shortcuts" class="sv-btn sv-btn--accent">${tHtml('common.save')}</button>
                </div>
              </div>
              <header class="sv-head"><h3 class="sv-head__title">${tHtml('desktop.settings.shortcuts.builtIn')}</h3></header>
              <ul class="sv-ledger" id="builtin-shortcuts">
                <li class="sv-row sv-row--keys is-fixed"><span class="sv-row__label">${tHtml('desktop.settings.shortcuts.scanUnderPointer')}</span><span class="sv-keycaps" data-accel="CommandOrControl+Shift+G"></span></li>
                <li class="sv-row sv-row--keys is-fixed"><span class="sv-row__label">${tHtml('desktop.settings.shortcuts.scanActiveWindow')}</span><span class="sv-keycaps" data-accel="CommandOrControl+Shift+W"></span></li>
                <li class="sv-row sv-row--keys is-fixed"><span class="sv-row__label">${tHtml('desktop.settings.shortcuts.scanClipboardImage')}</span><span class="sv-keycaps" data-accel="CommandOrControl+Shift+I"></span></li>
                <li class="sv-row sv-row--keys is-fixed"><span class="sv-row__label">${tHtml('desktop.settings.shortcuts.lookUpNowPlaying')}</span><span class="sv-keycaps" data-accel="CommandOrControl+Shift+P"></span></li>
              </ul>
              <div id="qt-section" class="sv-section" hidden>
                <header class="sv-head"><h3 class="sv-head__title">${tHtml('desktop.settings.quickTranslation.title')}</h3></header>
                <div class="sv-ledger">
                  <label class="sv-row">
                    <span class="sv-row__text"><span class="sv-row__label" id="qt-enabled-label">${tHtml('desktop.settings.quickTranslation.enabled')}</span></span>
                    <span class="sv-ctl"><input type="checkbox" role="switch" class="sv-switch" id="qt-enabled" aria-labelledby="qt-enabled-label" /></span>
                  </label>
                  <div class="sv-row sv-row--keys" data-qt>
                    <span class="sv-row__text"><span id="label-qt-replace" class="sv-row__label">${tHtml('desktop.settings.quickTranslation.replace')}</span></span>
                    <div class="sv-keycaps sv-keyfield" id="qt-replace-keys"></div>
                    <input type="text" id="qt-replace" readonly class="sv-vh" spellcheck="false" autocomplete="off" tabindex="-1" aria-labelledby="label-qt-replace" />
                    <button type="button" class="sv-btn" id="qt-replace-set">${tHtml('desktop.settings.shortcuts.set')}</button>
                  </div>
                  <div class="sv-row sv-row--keys" data-qt>
                    <span class="sv-row__text"><span id="label-qt-panel" class="sv-row__label">${tHtml('desktop.settings.quickTranslation.panel')}</span></span>
                    <div class="sv-keycaps sv-keyfield" id="qt-panel-keys"></div>
                    <input type="text" id="qt-panel" readonly class="sv-vh" spellcheck="false" autocomplete="off" tabindex="-1" aria-labelledby="label-qt-panel" />
                    <button type="button" class="sv-btn" id="qt-panel-set">${tHtml('desktop.settings.shortcuts.set')}</button>
                  </div>
                  <div class="sv-row" data-qt>
                    <span class="sv-row__text"><label for="qt-from" class="sv-row__label">${tHtml('desktop.settings.quickTranslation.from')}</label></span>
                    <select id="qt-from" class="sv-select"></select>
                  </div>
                  <div class="sv-row" data-qt>
                    <span class="sv-row__text"><label for="qt-to" class="sv-row__label">${tHtml('desktop.settings.quickTranslation.to')}</label></span>
                    <select id="qt-to" class="sv-select"></select>
                  </div>
                </div>
                <div class="sv-actions"><span id="qt-status" class="sv-actions__status" role="status" aria-live="polite"></span></div>
              </div>
            </div>
          </section>

          <section class="settings-panel" data-panel="capture" aria-labelledby="settings-capture-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-capture-heading" class="settings-panel__title">${tHtml('settings.section.capture')}</h2>
            </div>
            <div class="sv sv-page">
              <div class="sv-ledger">
                <div class="sv-row" role="group" aria-labelledby="enable-hover-label">
                  <span class="sv-row__text">
                    <span id="enable-hover-label" class="sv-row__label">${tHtml('desktop.settings.capture.hoverLookup')}</span>
                    <span id="hover-ocr-status" class="sv-row__status" role="status" aria-live="polite" hidden></span>
                  </span>
                  <span class="sv-row__end">
                    <button type="button" id="hover-ocr-install" class="sv-btn" hidden>${tHtml('desktop.settings.capture.install')}</button>
                    <label class="sv-ctl"><input type="checkbox" role="switch" class="sv-switch" id="enable-hover" checked aria-labelledby="enable-hover-label" aria-describedby="hover-ocr-status" /></label>
                  </span>
                  <div id="hover-ocr-progress" class="sv-progress" hidden><span></span></div>
                </div>
                <div class="sv-row">
                  <span class="sv-row__text"><label for="lookup-opens" class="sv-row__label">${tHtml('desktop.settings.capture.openLookupsAs')}</label></span>
                  <select id="lookup-opens" class="sv-select">
                    <option value="strip">${tHtml('desktop.settings.capture.openAsStrip')}</option>
                    <option value="panel">${tHtml('desktop.settings.capture.openAsPanel')}</option>
                  </select>
                </div>
                <div class="sv-row">
                  <span class="sv-row__text"><span id="remember-sources-label" class="sv-row__label">${tHtml('desktop.settings.capture.rememberSources')}</span></span>
                  <label class="sv-ctl"><input type="checkbox" role="switch" class="sv-switch" id="remember-sources" checked aria-labelledby="remember-sources-label" /></label>
                </div>
              </div>
              <div class="sv-drop" id="settings-dropzone" tabindex="0" role="button" aria-label="${tHtml('desktop.settings.capture.dropLabel')}">
                <strong>${tHtml('desktop.settings.capture.dropTitle')}</strong>
                <span>${tHtml('desktop.settings.capture.dropFormats')}</span>
                <input type="file" id="settings-dropzone-file" accept="image/png,image/jpeg,image/webp" hidden />
              </div>
              <header class="sv-head"><h3 class="sv-head__title">${tHtml('desktop.settings.ocr.title')}</h3></header>
              <div class="sv-ledger">
                <div class="sv-row">
                  <span class="sv-row__text">
                    <label for="ocr-profile-select" class="sv-row__label">${tHtml('desktop.settings.ocr.model')}</label>
                    <span id="ocr-status" class="sv-row__sub" role="status" aria-live="polite">${tHtml('desktop.settings.ocr.checking')}</span>
                  </span>
                  <select id="ocr-profile-select" class="sv-select"></select>
                </div>
                <div class="sv-ledger__foot">
                  <button type="button" id="ocr-refresh-status" class="sv-btn">${tHtml('desktop.settings.ocr.refresh')}</button>
                  <button type="button" id="ocr-upload-models" class="sv-btn">${tHtml('desktop.settings.ocr.chooseFolder')}</button>
                  <button type="button" id="ocr-apply-profile" class="sv-btn sv-btn--accent">${tHtml('desktop.settings.ocr.apply')}</button>
                </div>
              </div>
            </div>
          </section>

          <section class="settings-panel" data-panel="learn" aria-labelledby="settings-learn-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-learn-heading" class="settings-panel__title">${tHtml('settings.section.learn')}</h2>
            </div>
            <div id="learn-settings-host"></div>
          </section>

          <section class="settings-panel" data-panel="notifications" aria-labelledby="settings-notifications-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-notifications-heading" class="settings-panel__title">${tHtml('settings.section.notifications')}</h2>
            </div>
            <div class="sv sv-page">
              <div class="sv-ledger">
                ${switchRowHtml({ label: t('desktop.settings.notifications.imageCopied'), on: true, attrs: 'id="notify-clipboard-image"' })}
                ${switchRowHtml({ label: t('desktop.settings.notifications.hoverToggled'), on: true, attrs: 'id="notify-hover-toggle"' })}
                ${switchRowHtml({ label: t('desktop.settings.notifications.updates'), on: true, attrs: 'id="notify-updates"' })}
              </div>
            </div>
          </section>

          <section class="settings-panel" data-panel="sources" aria-labelledby="settings-sources-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-sources-heading" class="settings-panel__title">${tHtml('settings.section.sources')}</h2>
            </div>
            <div id="sources-host"></div>
          </section>

          <section class="settings-panel" data-panel="offline" aria-labelledby="settings-offline-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-offline-heading" class="settings-panel__title">${tHtml('desktop.settings.offline.title')}</h2>
            </div>
            <p id="offline-status" class="settings-inline-status" role="status" aria-live="polite"></p>
            <div id="offline-catalog"></div>
            <h3 class="settings-subhead">${tHtml('desktop.settings.offline.import')}</h3>
            <button type="button" id="offline-import-json" class="nav-row">
              <span class="nav-row__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
              <span class="nav-row__label">${tHtml('desktop.settings.offline.importPack')}<span class="nav-row__sub">${tHtml('desktop.settings.offline.importPackFormats')}</span></span>
              <span class="nav-row__chevron"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            </button>
            <button type="button" id="offline-import-cedict" class="nav-row">
              <span class="nav-row__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
              <span class="nav-row__label">${tHtml('desktop.settings.offline.importCedict')}<span class="nav-row__sub" translate="no">cedict_ts.u8</span></span>
              <span class="nav-row__chevron"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            </button>
          </section>

          <section class="settings-panel" data-panel="api" aria-labelledby="settings-api-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-api-heading" class="settings-panel__title">${tHtml('settings.section.api')}</h2>
            </div>
            <div id="api-keys-host"></div>
          </section>


          <section class="settings-panel" data-panel="audio" aria-labelledby="settings-audio-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-audio-heading" class="settings-panel__title">${tHtml('settings.section.audio')}</h2>
            </div>
            <div class="sv sv-page">
              <div class="sv-ledger">
                ${switchRowHtml({ label: t('desktop.settings.audio.pronunciation'), on: true, attrs: 'id="enable-audio"' })}
              </div>
              <div class="sv-section" id="voice-section" hidden>
                <header class="sv-head"><h3 class="sv-head__title">${tHtml('desktop.settings.audio.voice')}</h3></header>
                <div class="sv-ledger" id="voice-list" role="radiogroup" aria-label="${tHtml('desktop.settings.audio.voice')}"></div>
              </div>
              <header class="sv-head"><h3 class="sv-head__title">${tHtml('desktop.settings.audio.playback')}</h3></header>
              <div class="sv-ledger">
                ${rangeRowHtml({ label: t('desktop.settings.audio.speed'), id: 'audio-speed', min: 0.5, max: 2, step: 0.1, value: 1, valueId: 'speed-value', valueText: t('desktop.settings.audio.speedValue', { speed: formatNumber(1, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) })}
                ${rangeRowHtml({ label: t('desktop.settings.audio.volume'), id: 'audio-volume', min: 0, max: 100, step: 5, value: 100, valueId: 'volume-value', valueText: formatPercent(1) })}
              </div>
            </div>
          </section>

          <section class="settings-panel" data-panel="about" aria-labelledby="settings-about-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-about-heading" class="settings-panel__title">${tHtml('settings.section.about')}</h2>
            </div>
            <div id="about-host"></div>
          </section>
        </main>
      </div>
      <div id="pack-inspector-host"></div>
    </div>
  `;
  document.body.innerHTML = settingsHTML;

  document.querySelectorAll('.settings-nav__item').forEach((btn) => {
    btn.addEventListener('click', () => showSettingsSection((btn as HTMLElement).dataset.section || ''));
  });
  // "#settings/offline" opens on that page, from the main window's search.
  const showSectionFromHash = () => {
    const section = location.hash.split('/')[1];
    if (section) showSettingsSection(section);
  };
  showSectionFromHash();
  window.addEventListener('hashchange', showSectionFromHash);

  // Native selects get the app's menu; their code keeps using the select.
  document.querySelectorAll<HTMLSelectElement>('.settings-main select.sv-select').forEach(enhanceSelect);
  // Language: every window follows; this one reloads in the new language on the same page.
  document.getElementById(UI_LANGUAGE_SELECT_ID)?.addEventListener('change', (e) => {
    void setUiLanguagePref((e.target as HTMLSelectElement).value);
  });
  wireSettingsLibraryLinks();
  void wireSourcesPanel();
  void wireApiKeysPanel();
  wireLearnSettings();
  void wireAboutSettings();
  wireInAppTextSelectionLookup();
  setupAudioSettings();
  void wireNotificationSettings();
  wireSettingsImageDrop();
  void wireOfflineSettingsPanel();
  void wireOcrSettingsPanel();
  void wireHoverOcrPack();
  void wireMonitorSettingsFields().then(({ stopCapture }) => {
    document.getElementById('settings-close')?.addEventListener('click', () => {
      stopCapture();
      window.close();
    });
    window.addEventListener('pagehide', () => stopCapture());
  });
  wireLiveResizeClass();
}

/** Settings → About's Updates rows: status, the install mode, Check now and Roll back. */
function updatesRowsHtml(): string {
  return `
    <div class="sv-ledger">
      <div class="sv-row">
        <span class="sv-row__text">
          <span class="sv-row__label">${tHtml('settings.section.updates')}</span>
          <span id="update-status" class="sv-row__sub" role="status" aria-live="polite"></span>
        </span>
        <button type="button" id="update-action" class="sv-btn sv-btn--accent" hidden></button>
        <div id="update-progress" class="sv-progress" hidden><span></span></div>
      </div>
      ${segRowHtml({ label: t('desktop.settings.updates.install'), name: 'update-mode', value: 'auto', options: [{ value: 'auto', label: t('desktop.settings.updates.modeAuto') }, { value: 'ask', label: t('desktop.settings.updates.modeAsk') }, { value: 'off', label: t('desktop.settings.updates.modeOff') }] })}
      <div class="sv-ledger__foot">
        <button type="button" id="update-rollback" class="sv-btn" hidden></button>
        <button type="button" id="update-check" class="sv-btn">${tHtml('desktop.settings.updates.checkNow')}</button>
      </div>
    </div>`;
}

/** Settings → About: the version comes from the main process, so it is never out of date. */
async function wireAboutSettings(): Promise<void> {
  const host = document.getElementById('about-host');
  if (!host) return;
  const names: Record<string, AboutPlatform> = { win32: 'windows', darwin: 'macos', linux: 'linux' };
  const systemNames: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  let info: { version: string; platform: string; arch: string; systemVersion: string } | null = null;
  try {
    info = (await window.electronAPI?.getAppInfo?.()) || null;
  } catch {
    info = null;
  }
  const platform = names[info?.platform || window.electronAPI?.platform || ''] || 'windows';
  const system = info ? [systemNames[info.platform] || info.platform, info.systemVersion, info.arch].filter(Boolean).join(' ') : '';
  host.innerHTML = aboutSettingsHtml({ version: info?.version || '', platform, system }, updatesRowsHtml());
  void wireUpdatesPanel();
  host.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-act="about-copy"]');
    if (!btn) return;
    void navigator.clipboard.writeText(btn.dataset.copy || '').then(() => flashAboutCopied(btn));
  });
}

/**
 * Settings → Learn: new words a day for My words and each subscribed book, the countdown on choice
 * questions, and speaking questions once a microphone is there. Each number is a wheel
 * (number-wheel.ts) that sends `change` once it settles. My words' goal and the options go to
 * local storage, which the main window watches; a book's goal goes to the word-book store, and a
 * bump of LEARN_BOOKS_KEY tells the main window to reload the books. A settled wheel already
 * shows its value, so saving it does not repaint the panel.
 */
function wireLearnSettings(): void {
  const host = document.getElementById('learn-settings-host');
  if (!host) return;
  let microphone = false;
  let books: Array<{ id: string; title: string; goal: number; left?: number }> = [];
  let mineLeft: number | undefined;
  let pace: StudyPace | null = null;
  const paint = () => {
    // A repaint (books reloaded on focus, a microphone plugged in) keeps keyboard focus where it was.
    const focused = document.activeElement as HTMLInputElement | null;
    const key = host.contains(focused) && focused ? `${focused.name || ''}|${focused.dataset.book ?? ''}|${focused.dataset.value ?? 'field'}` : '';
    host.innerHTML = learnSettingsHtml({
      goal: Number(readPref(NB_GOAL_KEY, '10')) || 10,
      books,
      prefs: readLearnPrefs(readPref(LEARN_PREFS_KEY, '')),
      microphone,
      mineLeft,
      pace,
    });
    if (key) {
      const [name, book, value] = key.split('|');
      const back = [...host.querySelectorAll<HTMLInputElement>('input[data-act]')].find(
        (el) => (el.name || '') === name && (el.dataset.book ?? '') === book && (el.dataset.value ?? 'field') === value,
      );
      back?.focus();
    }
  };
  // The plan lines need each list's words not started yet and the learner's pace; both load once
  // and again when Settings comes forward, since words are learned in the main window meanwhile.
  const loadLists = async () => {
    try {
      const api = wordbookApi();
      const vocab = (window as any).vocabAPI;
      const [state, mine, history] = await Promise.all([api?.state?.(), vocab?.list?.(5000), vocab?.history?.()]);
      const made: Array<{ bookId: string; title: string }> = state?.userBooks || [];
      const subs: Array<{ bookId: string; dailyNew: number }> = state?.subs || [];
      const loaded = new Map<string, string[]>();
      for (const s of subs) if (!isUserBookId(s.bookId)) loaded.set(s.bookId, await loadWordbook(s.bookId));
      const progress = new Map((state?.progress || []).map((p: any) => [p.lemma, p]));
      const ctx = buildWordsContext(mine || [], progress as any, subs as any, loaded, made as any);
      const left = learnListsLeft(ctx);
      mineLeft = left.mine;
      pace = studyPace(history || []);
      books = subs.map((s) => ({
        id: s.bookId,
        title: wordbookMeta(s.bookId)?.title || made.find((b) => b.bookId === s.bookId)?.title || s.bookId,
        goal: s.dailyNew,
        left: left.books.get(s.bookId),
      }));
    } catch {
      /* the choices still work; the plan lines leave out what they could not count */
    }
    paint();
  };
  const setGoal = async (book: string, goal: number) => {
    if (book) {
      await wordbookApi()?.setGoal?.(book, goal);
      writePref(LEARN_BOOKS_KEY, String(Date.now()));
      books = books.map((b) => (b.id === book ? { ...b, goal } : b));
    } else {
      writePref(NB_GOAL_KEY, String(goal));
    }
  };
  host.addEventListener('change', (ev) => {
    const el = ev.target as HTMLElement;
    const act = el.dataset.act;
    if (act === 'learn-goal') {
      const goal = parseGoal(learnPickValue(el));
      if (goal == null) return;
      syncLearnPick(el, goal);
      void setGoal(el.dataset.book || '', goal);
    } else if (act === 'learn-countdown') {
      const seconds = Number(learnPickValue(el)) || 0;
      syncLearnPick(el, seconds);
      const prefs = readLearnPrefs(readPref(LEARN_PREFS_KEY, ''));
      writePref(LEARN_PREFS_KEY, writeLearnPrefs({ ...prefs, countdown: seconds }));
    } else if (act === 'learn-speaking') {
      const prefs = readLearnPrefs(readPref(LEARN_PREFS_KEY, ''));
      writePref(LEARN_PREFS_KEY, writeLearnPrefs({ ...prefs, speaking: (el as HTMLInputElement).checked }));
    }
  });
  // Enter in the number field saves it at once, as leaving the field does.
  host.addEventListener('keydown', (ev) => {
    const el = ev.target as HTMLInputElement;
    if (ev.key === 'Enter' && el.classList?.contains('sv-pick__field')) el.blur();
  });
  const onMicrophone = (on: boolean) => {
    if (on === microphone) return;
    microphone = on;
    paint();
  };
  paint();
  void loadLists();
  void microphoneAvailable().then(onMicrophone);
  watchMicrophone(onMicrophone);
  window.addEventListener('focus', () => void loadLists());
  window.addEventListener('storage', (e) => {
    if (e.key === NB_GOAL_KEY) paint();
  });
}

type OcrPackView = { installed: boolean; installing: boolean; progress: number; error: string | null; needsPack: boolean };

/** Hover lookup row in Capture: one status line and an Install button while the OCR pack is missing. */
async function wireHoverOcrPack(): Promise<void> {
  const api = (window as any).ocrAPI;
  const status = document.getElementById('hover-ocr-status');
  const install = document.getElementById('hover-ocr-install') as HTMLButtonElement | null;
  const bar = document.getElementById('hover-ocr-progress');
  if (!api?.getPackState || !status || !install || !bar) return;
  const fill = bar.firstElementChild as HTMLElement | null;
  let failed = false;
  const paint = (s: OcrPackView) => {
    const show = s.installing || s.needsPack;
    status.hidden = !show;
    status.classList.toggle('is-error', failed && !s.installing);
    if (s.installing) {
      status.textContent = t('desktop.settings.ocrPack.installing', { percent: formatPercent(s.progress) });
    } else if (failed && s.needsPack) {
      status.textContent = t('desktop.settings.ocrPack.failed');
    } else {
      status.textContent = t('desktop.settings.ocrPack.needed', { size: formatMegabytes(14) });
    }
    install.hidden = !s.needsPack || s.installing;
    install.textContent = failed ? t('desktop.settings.ocrPack.retry') : t('desktop.settings.capture.install');
    bar.hidden = !s.installing;
    if (fill) fill.style.width = `${Math.round(s.progress * 100)}%`;
  };
  install.addEventListener('click', async () => {
    failed = false;
    install.disabled = true;
    try {
      const r = await api.installPack();
      failed = !r?.ok;
      paint(r);
    } finally {
      install.disabled = false;
    }
  });
  api.onPackChanged?.((s: OcrPackView) => paint(s));
  paint(await api.getPackState());
}

async function wireOcrSettingsPanel(): Promise<void> {
  const api = (window as any).ocrAPI;
  const statusEl = document.getElementById('ocr-status');
  const selectEl = document.getElementById('ocr-profile-select') as HTMLSelectElement | null;
  const setStatus = (msg: string) => {
    if (statusEl) statusEl.textContent = msg;
  };

  const fillSelect = (s: any) => {
    if (!selectEl) return;
    const profiles = Array.isArray(s?.profiles) ? s.profiles : [];
    const active = String(s?.activeProfileId || 'bundled-pp-ocrv4');
    selectEl.innerHTML = profiles
      .map((p: any) => {
        const name = p.installed || p.kind !== 'download' ? escapeHtmlSelection(p.label) : tHtml('desktop.settings.ocr.profileToDownload', { name: String(p.label) });
        return `<option value="${escapeHtmlSelection(p.id)}"${p.id === active ? ' selected' : ''}>${name}</option>`;
      })
      .join('');
    if (!profiles.length) {
      selectEl.innerHTML = `<option value="bundled-pp-ocrv4">PP-OCRv4 mobile</option>`; // i18n-ignore: the model's name
    }
  };

  const refresh = async () => {
    if (!api?.getStatus) {
      setStatus(t('desktop.settings.ocr.unavailable'));
      return;
    }
    try {
      const s = await api.getStatus();
      fillSelect(s);
      const label =
        (s.profiles || []).find((p: any) => p.id === s.activeProfileId)?.label || s.activeProfileId || 'OCR';
      if (s.available === true) {
        setStatus(t('desktop.settings.ocr.ready', { model: String(label) }));
      } else if (s.needsPack) {
        setStatus(t('desktop.settings.ocr.needsPack'));
      } else if (s.available === false) {
        setStatus(t('desktop.settings.ocr.failed', { model: String(label), error: String(s.lastError || t('desktop.settings.ocr.unavailableShort')) }));
      } else {
        setStatus(t('desktop.settings.ocr.modelChecking', { model: String(label) }));
      }
    } catch (e: any) {
      setStatus(t('desktop.settings.ocr.checkFailed', { error: String(e?.message || e) }));
    }
  };

  document.getElementById('ocr-refresh-status')?.addEventListener('click', () => {
    void refresh();
  });
  api?.onPackChanged?.((s: OcrPackView) => {
    if (!s.installing) void refresh();
  });

  document.getElementById('ocr-apply-profile')?.addEventListener('click', async () => {
    if (!api?.setProfile || !selectEl) return;
    const id = selectEl.value;
    const switchFailed = (detail: unknown) => t('desktop.settings.ocr.switchFailed', { error: String(detail || t('desktop.settings.ocr.unknownError')) });
    if (id === 'custom') {
      setStatus(t('desktop.settings.ocr.chooseModelFolder'));
      const picked = await api.pickCustomFolder?.();
      if (!picked || picked.cancelled || !picked.path) {
        setStatus(t('desktop.settings.ocr.cancelled'));
        return;
      }
      setStatus(t('desktop.settings.ocr.loadingCustom'));
      const r = await api.setProfile('custom', picked.path);
      setStatus(r?.ok ? r.detail : switchFailed(r?.detail));
      await refresh();
      return;
    }
    setStatus(id.startsWith('pp-ocr') && id !== 'bundled-pp-ocrv4' ? t('desktop.settings.ocr.downloadingModels') : t('desktop.settings.ocr.switching'));
    try {
      const r = await api.setProfile(id);
      setStatus(r?.ok ? r.detail : switchFailed(r?.detail));
    } catch (e: any) {
      setStatus(switchFailed(e?.message || e));
    }
    await refresh();
  });

  document.getElementById('ocr-upload-models')?.addEventListener('click', async () => {
    if (!api?.setProfile) return;
    const picked = await api.pickCustomFolder?.();
    if (!picked || picked.cancelled || !picked.path) return;
    setStatus(t('desktop.settings.ocr.loadingCustom'));
    const r = await api.setProfile('custom', picked.path);
    setStatus(r?.ok ? r.detail : t('desktop.settings.ocr.switchFailed', { error: String(r?.detail || t('desktop.settings.ocr.unknownError')) }));
    await refresh();
  });

  await refresh();
}

/** Title-bar account button and the popover under it (Holarky sign-in, sync, sign-out, delete). */
function wireAccountMenu(): void {
  const api = (window as any).accountAPI;
  const slot = document.getElementById('accountSlot');
  const menu = document.getElementById('accountMenu');
  if (!api?.getState || !slot || !menu) return;
  let state: AccountState | null = null;
  let open = false;
  let deleting = false;

  let deleteBusy = false;
  let buttonShown: string | null = null;
  const render = () => {
    // Replace the button only when it changes, and keep keyboard focus on it.
    const buttonHtml = accountButtonHtml(state, open);
    if (buttonShown !== buttonHtml) {
      buttonShown = buttonHtml;
      const hadFocus = slot.contains(document.activeElement);
      slot.innerHTML = buttonHtml;
      if (hadFocus) slot.querySelector<HTMLButtonElement>('.hx-account-btn')?.focus();
    }
    const live = document.getElementById('account-delete-email') as HTMLInputElement | null;
    const typed = live?.value || '';
    const keepFocus = !!(live && document.activeElement === live);
    const caret = keepFocus ? live!.selectionStart : null;
    menu.hidden = !open || !state?.configured;
    menu.innerHTML = open ? accountPanelHtml(state, { deleting, device: 'computer' }) : '';
    const input = document.getElementById('account-delete-email') as HTMLInputElement | null;
    if (input && typed) input.value = typed;
    if (input && keepFocus) {
      input.focus();
      if (typeof caret === 'number') input.setSelectionRange(caret, caret);
    }
    const confirm = menu.querySelector<HTMLButtonElement>('[data-act="account-delete-confirm"]');
    if (confirm) confirm.disabled = deleteBusy || !deleteEmailMatches(state, input?.value || '');
  };
  const setOpen = (next: boolean, focusButton = false) => {
    open = next;
    if (!next) deleting = false;
    render();
    if (focusButton) slot.querySelector<HTMLButtonElement>('.hx-account-btn')?.focus();
  };

  slot.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-act="account-open"]')) setOpen(!open);
  });
  menu.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
    if (!btn || btn.disabled) return;
    switch (btn.dataset.act) {
      case 'account-sign-in': void api.signIn(); break;
      case 'account-cancel': void api.cancelSignIn(); break;
      case 'account-sync': void api.syncNow(); break;
      case 'account-sign-out':
        setOpen(false);
        void api.signOut();
        break;
      case 'account-delete-start':
        deleting = true;
        render();
        (document.getElementById('account-delete-email') as HTMLInputElement | null)?.focus();
        break;
      case 'account-delete-cancel':
        deleting = false;
        render();
        break;
      case 'account-delete-confirm': {
        if (deleteBusy) break;
        deleteBusy = true;
        btn.disabled = true;
        const typed = (document.getElementById('account-delete-email') as HTMLInputElement | null)?.value || '';
        try {
          if (await api.deleteAccount(typed)) setOpen(false);
        } finally {
          deleteBusy = false;
          render();
        }
        break;
      }
    }
  });
  menu.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.id !== 'account-delete-email') return;
    const confirm = menu.querySelector<HTMLButtonElement>('[data-act="account-delete-confirm"]');
    if (confirm) confirm.disabled = deleteBusy || !deleteEmailMatches(state, el.value);
  });
  document.addEventListener('mousedown', (e) => {
    if (!open) return;
    const t = e.target as Node;
    if (!menu.contains(t) && !slot.contains(t)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') setOpen(false, true);
  });
  api.onState?.((next: AccountState) => {
    state = next;
    render();
    setLearnAccountState(next);
  });
  // Keeps "Synced N min ago" current while the popover is open.
  window.setInterval(() => {
    if (open && state?.user && !state.syncing && !deleting) render();
  }, 60_000);
  void api.getState().then((next: AccountState | null): void => {
    state = next;
    render();
    setLearnAccountState(next);
  }).catch((): void => undefined);
}

/** Settings → Offline: one shelf per headword language, catalogue cards, an inspector drawer and live progress. */
async function wireOfflineSettingsPanel(): Promise<void> {
  const api = (window as any).offlineDictAPI;
  const statusEl = document.getElementById('offline-status');
  const catalogEl = document.getElementById('offline-catalog');
  const inspectorEl = document.getElementById('pack-inspector-host');
  const setStatus = (msg: string) => {
    if (statusEl) statusEl.textContent = msg;
  };
  let packs: PackView[] = [];
  let progress: PackProgress | null = null;
  let inspecting: string | null = null;
  const details = new Map<string, PackDetails>();

  /** Repaints the drawer's contents in place, so its slide-in plays only when it opens. */
  const renderInspector = () => {
    if (!inspectorEl) return;
    const p = inspecting ? packs.find((x) => x.id === inspecting) : undefined;
    if (!p) {
      inspectorEl.innerHTML = '';
      return;
    }
    const open = inspectorEl.querySelector('.sv-inspector') as HTMLElement | null;
    const fresh = !open || open.dataset.id !== p.id;
    const progressFor = progress && progress.id === p.id ? progress : null;
    const html = packInspectorHtml(p, details.get(p.id), progressFor, !!progress, fresh);
    if (fresh) {
      inspectorEl.innerHTML = html;
      return;
    }
    const next = document.createElement('div');
    next.innerHTML = html;
    open!.innerHTML = (next.querySelector('.sv-inspector') as HTMLElement).innerHTML;
  };
  const render = () => {
    if (!catalogEl) return;
    catalogEl.innerHTML = offlineShelvesHtml({ groups: groupCatalogByLanguage(packs), progress });
    renderInspector();
  };
  /** Progress ticks repaint only the card being downloaded and the open inspector. */
  const renderProgress = () => {
    if (!progress || !catalogEl) return;
    const p = packs.find((x) => x.id === progress!.id);
    const card = catalogEl.querySelector(`.sv-pack[data-id="${CSS.escape(progress.id)}"]`);
    if (p && card) card.outerHTML = packCardHtml(p, progress, true);
    if (inspecting === progress.id) renderInspector();
  };

  const loadDetails = async (id: string) => {
    const p = packs.find((x) => x.id === id);
    if (!p?.installed || !api?.packDetails) return;
    try {
      const d = await api.packDetails(id);
      if (d) details.set(id, d);
      if (inspecting === id) renderInspector();
    } catch (error) {
      console.error(error);
    }
  };

  const refresh = async () => {
    if (!catalogEl) return;
    if (!api?.listCatalog) {
      catalogEl.innerHTML = `<p class="settings-hint">${tHtml('desktop.settings.offline.unavailable')}</p>`;
      return;
    }
    try {
      const [catalog, installed] = await Promise.all([api.listCatalog(), api.listPacks ? api.listPacks() : []]);
      const catalogIds = new Set<string>((catalog || []).map((c: any) => String(c.id)));
      const installedById = new Map<string, any>((installed || []).map((p: any) => [String(p.id), p]));
      packs = [
        ...(catalog || []).map((c: any) => ({ ...c, createdAt: installedById.get(String(c.id))?.createdAt })),
        ...(installed || [])
          .filter((p: any) => !catalogIds.has(String(p.id)))
          .map((p: any) => ({
            id: String(p.id),
            name: String(p.name),
            language: String(p.language || 'en'),
            installed: true,
            entryCount: Number(p.entryCount) || 0,
            createdAt: p.createdAt,
            source: p.source,
            imported: true,
          })),
      ];
      details.clear();
      render();
    } catch (error) {
      console.error(error);
      catalogEl.innerHTML = `<p class="settings-hint">${tHtml('desktop.settings.offline.catalogFailed')}</p>`;
    }
  };

  const download = async (id: string) => {
    const p = packs.find((x) => x.id === id);
    if (!p || !api?.downloadPack || progress) return;
    if (!confirm(p.consent || t('desktop.settings.offline.downloadConfirm'))) return;
    progress = { id, fraction: null, label: t('desktop.settings.offline.starting') };
    setStatus('');
    render();
    try {
      const r = await api.downloadPack(id);
      setStatus(r?.success ? t('desktop.settings.offline.installed', { name: p.name, count: Number(r.count) || 0 }) : t('desktop.settings.offline.downloadFailed'));
    } catch (e: any) {
      setStatus(t('desktop.settings.offline.downloadFailedWith', { error: String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }));
    } finally {
      progress = null;
      await refresh();
      if (inspecting === id) void loadDetails(id);
    }
  };

  const remove = async (id: string) => {
    const p = packs.find((x) => x.id === id);
    if (!p || !api?.removePack) return;
    if (!confirm(t('desktop.settings.offline.removeConfirm', { name: p.name }))) return;
    await api.removePack(id);
    setStatus(t('desktop.settings.offline.removed', { name: p.name }));
    await refresh();
  };

  api?.onPackProgress?.((p: PackProgress) => {
    if (!progress || progress.id !== p.id) return;
    progress = p;
    renderProgress();
  });

  const onClick = (e: Event) => {
    const t = (e.target as HTMLElement | null)?.closest?.('[data-act]') as HTMLElement | null;
    if (!t) return;
    const id = t.dataset.id || '';
    switch (t.dataset.act) {
      case 'pack-open':
        inspecting = id;
        renderInspector();
        void loadDetails(id);
        (inspectorEl?.querySelector('[data-act="pack-close"].sv-icon') as HTMLElement | null)?.focus();
        break;
      case 'pack-close': {
        const was = inspecting || '';
        inspecting = null;
        renderInspector();
        (catalogEl?.querySelector(`.sv-pack__open[data-id="${CSS.escape(was)}"]`) as HTMLElement | null)?.focus();
        break;
      }
      case 'pack-dl':
        void download(id);
        break;
      case 'pack-rm':
        void remove(id);
        break;
      default:
        break;
    }
  };
  catalogEl?.addEventListener('click', onClick);
  inspectorEl?.addEventListener('click', onClick);

  document.getElementById('offline-import-json')?.addEventListener('click', async () => {
    if (!api?.importJson) return;
    setStatus(t('desktop.settings.offline.chooseJson'));
    try {
      const r = await api.importJson();
      if (r?.cancelled) {
        setStatus(t('desktop.settings.offline.importCancelled'));
        return;
      }
      setStatus(r?.success ? t('desktop.settings.offline.imported', { count: Number(r.count) || 0 }) : t('desktop.settings.offline.importFailed'));
      await refresh();
    } catch (e: any) {
      setStatus(t('desktop.settings.offline.importFailedWith', { error: String(e?.message || e) }));
    }
  });
  document.getElementById('offline-import-cedict')?.addEventListener('click', async () => {
    if (!api?.importCedictFile) return;
    setStatus(t('desktop.settings.offline.chooseCedict'));
    try {
      const r = await api.importCedictFile();
      if (r?.cancelled) {
        setStatus(t('desktop.settings.offline.importCancelled'));
        return;
      }
      setStatus(r?.success ? t('desktop.settings.offline.importedCedict', { count: Number(r.count) || 0 }) : t('desktop.settings.offline.importFailed'));
      await refresh();
    } catch (e: any) {
      setStatus(t('desktop.settings.offline.importFailedWith', { error: String(e?.message || e) }));
    }
  });

  await refresh();
}

function wireSettingsImageDrop(): void {
  const zone = document.getElementById('settings-dropzone');
  const api = window.electronAPI as {
    ocrImageFile?: (path: string) => Promise<{ success: boolean; error?: string }>;
    ocrImageData?: (data: string) => Promise<{ success: boolean; error?: string }>;
  };
  if (!zone || (!api.ocrImageFile && !api.ocrImageData)) return;

  const setBusy = (busy: boolean) => {
    zone.classList.toggle('is-busy', busy);
  };

  const scanFile = async (file: File) => {
    setBusy(true);
    try {
      const anyFile = file as File & { path?: string };
      if (anyFile.path && api.ocrImageFile) {
        await api.ocrImageFile(anyFile.path);
      } else if (api.ocrImageData) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        await api.ocrImageData(dataUrl);
      }
    } finally {
      setBusy(false);
    }
  };

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('is-dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) void scanFile(file);
  });

  // A click, Enter or Space opens the file picker.
  const picker = document.getElementById('settings-dropzone-file') as HTMLInputElement | null;
  if (picker) {
    const open = () => {
      if (!zone.classList.contains('is-busy')) picker.click();
    };
    zone.addEventListener('click', (e) => {
      if (e.target !== picker) open();
    });
    zone.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      open();
    });
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      picker.value = '';
      if (file) void scanFile(file);
    });
  }

  zone.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items || !api.ocrImageData) return;
    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/')) continue;
      e.preventDefault();
      const blob = item.getAsFile();
      if (!blob) return;
      setBusy(true);
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        await api.ocrImageData(dataUrl);
      } finally {
        setBusy(false);
      }
      return;
    }
  });
}

function acceleratorParts(acc: string): string[] {
  const mac = isMac();
  return (acc || '')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (/^(CommandOrControl|CmdOrCtrl)$/i.test(p)) return mac ? '⌘' : 'Ctrl';
      if (/^(Control|Ctrl)$/i.test(p)) return mac ? '⌃' : 'Ctrl';
      if (/^(Command|Cmd)$/i.test(p)) return '⌘';
      if (/^Shift$/i.test(p)) return mac ? '⇧' : 'Shift';
      if (/^(Alt|Option)$/i.test(p)) return mac ? '⌥' : 'Alt';
      if (/^(Super|Meta|Windows|Win)$/i.test(p)) return mac ? '⌘' : isLinux() ? 'Super' : 'Win';
      if (/^Plus$/i.test(p)) return '+';
      return p.length === 1 ? p.toUpperCase() : p;
    });
}

function keycapsInnerHtml(acc: string): string {
  return keycapsHtml(acceleratorParts(acc));
}

function paintShortcutKeycaps(input: HTMLInputElement): void {
  const host = document.getElementById(`${input.id}-keys`);
  if (host) host.innerHTML = keycapsInnerHtml(input.value);
}

function paintStaticCheatKeycaps(): void {
  document.querySelectorAll<HTMLElement>('#builtin-shortcuts [data-accel]').forEach((el) => {
    el.innerHTML = keycapsInnerHtml(el.dataset.accel || '');
  });
}

/** Settings → Shortcuts → Quick translation. Every change saves at once. */
async function wireQuickTranslateSettings(
  replaceEl: HTMLInputElement | null,
  panelEl: HTMLInputElement | null,
  bind: (input: HTMLInputElement, btn: HTMLButtonElement, onSet: () => void) => void,
  buttons: Array<HTMLButtonElement | null>,
): Promise<void> {
  const api = window.electronAPI as any;
  const section = document.getElementById('qt-section');
  const enabledEl = document.getElementById('qt-enabled') as HTMLInputElement | null;
  const fromEl = document.getElementById('qt-from') as HTMLSelectElement | null;
  const toEl = document.getElementById('qt-to') as HTMLSelectElement | null;
  const statusEl = document.getElementById('qt-status');
  if (!api?.getQuickTranslate || !section || !enabledEl || !replaceEl || !panelEl || !fromEl || !toEl) return;
  let state: Awaited<ReturnType<typeof api.getQuickTranslate>>;
  try {
    state = await api.getQuickTranslate();
  } catch {
    return;
  }
  // Without a way to paste into other apps (Linux without xdotool) the section is left out.
  if (!state?.supported) return;
  section.hidden = false;
  const langs: Array<{ code: string; name: string }> = state.languages || [];
  const options = (auto: string) => langs.map((l) => `<option value="${escapeHtmlSelection(l.code)}">${escapeHtmlSelection(l.code === 'auto' ? auto : l.name)}</option>`).join('');
  fromEl.innerHTML = options(t('desktop.settings.quickTranslation.detect'));
  toEl.innerHTML = options(t('desktop.settings.quickTranslation.auto'));
  const paint = (prefs: any) => {
    enabledEl.checked = !!prefs.enabled;
    replaceEl.value = prefs.replaceShortcut;
    panelEl.value = prefs.panelShortcut;
    fromEl.value = prefs.from;
    toEl.value = prefs.to;
    paintShortcutKeycaps(replaceEl);
    paintShortcutKeycaps(panelEl);
    section.querySelectorAll<HTMLElement>('[data-qt]').forEach((row) => (row.hidden = !prefs.enabled));
  };
  paint(state.prefs);
  const save = async () => {
    const r = await api.setQuickTranslate({
      enabled: enabledEl.checked,
      replaceShortcut: replaceEl.value.trim(),
      panelShortcut: panelEl.value.trim(),
      from: fromEl.value,
      to: toEl.value,
    });
    const taken: string[] = r?.taken || [];
    const note = !r?.success
      ? r?.error || t('desktop.settings.shortcuts.saveFailed')
      : taken.length
        ? t('desktop.settings.quickTranslation.taken', {
            names: formatList(taken.map((which) => (which === 'replace' ? t('desktop.settings.quickTranslation.replace') : t('desktop.settings.quickTranslation.panel')))),
          })
        : '';
    if (statusEl) {
      statusEl.textContent = note;
      statusEl.classList.toggle('is-error', !!note);
    }
    if (r?.prefs) paint(r.prefs);
  };
  enabledEl.addEventListener('change', () => void save());
  fromEl.addEventListener('change', () => void save());
  toEl.addEventListener('change', () => void save());
  const [replaceBtn, panelBtn] = buttons;
  if (replaceBtn) bind(replaceEl, replaceBtn, () => void save());
  if (panelBtn) bind(panelEl, panelBtn, () => void save());
}

async function wireMonitorSettingsFields(): Promise<{ stopCapture: () => void }> {
  const noop = (): void => {};
  const api = window.electronAPI as {
    getMonitorState?: () => Promise<{
      cycleShortcut: string;
      triggerShortcut: string;
      ocrShortcut?: string;
      hoverShortcut?: string;
      hoverEnabled?: boolean;
    }>;
    setMonitorShortcuts?: (p: {
      cycleShortcut: string;
      triggerShortcut: string;
      ocrShortcut?: string;
      hoverShortcut?: string;
      hoverEnabled?: boolean;
    }) => Promise<{ success: boolean; error?: string }>;
  };
  if (!api?.getMonitorState || !api?.setMonitorShortcuts) {
    return { stopCapture: noop };
  }
  const cycleEl = document.getElementById('monitor-cycle-shortcut') as HTMLInputElement | null;
  const triggerEl = document.getElementById('monitor-trigger-shortcut') as HTMLInputElement | null;
  const ocrEl = document.getElementById('ocr-shortcut') as HTMLInputElement | null;
  const hoverEl = document.getElementById('hover-shortcut') as HTMLInputElement | null;
  const hoverToggle = document.getElementById('enable-hover') as HTMLInputElement | null;
  const rememberToggle = document.getElementById('remember-sources') as HTMLInputElement | null;
  rememberToggle?.addEventListener('change', () => {
    void (window.electronAPI as { setRememberSources?: (on: boolean) => Promise<unknown> }).setRememberSources?.(rememberToggle.checked);
  });
  const lookupOpensSelect = document.getElementById('lookup-opens') as HTMLSelectElement | null;
  lookupOpensSelect?.addEventListener('change', () => {
    const value = lookupOpensSelect.value === 'panel' ? 'panel' : 'strip';
    void (window.electronAPI as { setLookupOpens?: (v: 'strip' | 'panel') => Promise<unknown> }).setLookupOpens?.(value);
  });
  const cycleSetBtn = document.getElementById('monitor-cycle-set') as HTMLButtonElement | null;
  const triggerSetBtn = document.getElementById('monitor-trigger-set') as HTMLButtonElement | null;
  const ocrSetBtn = document.getElementById('ocr-shortcut-set') as HTMLButtonElement | null;
  const hoverSetBtn = document.getElementById('hover-shortcut-set') as HTMLButtonElement | null;
  const qtReplaceEl = document.getElementById('qt-replace') as HTMLInputElement | null;
  const qtPanelEl = document.getElementById('qt-panel') as HTMLInputElement | null;
  const qtReplaceSetBtn = document.getElementById('qt-replace-set') as HTMLButtonElement | null;
  const qtPanelSetBtn = document.getElementById('qt-panel-set') as HTMLButtonElement | null;

  const setBtns = [cycleSetBtn, triggerSetBtn, ocrSetBtn, hoverSetBtn, qtReplaceSetBtn, qtPanelSetBtn].filter(Boolean) as HTMLButtonElement[];
  let cancelCapture: (() => void) | null = null;

  function stopCaptureUi(): void {
    cancelCapture?.();
    cancelCapture = null;
    for (const b of setBtns) {
      b.textContent = t('desktop.settings.shortcuts.set');
      b.classList.remove('is-recording');
    }
  }

  function bindCapture(input: HTMLInputElement, setBtn: HTMLButtonElement, onSet?: () => void): void {
    const start = (): void => {
      stopCaptureUi();
      setBtn.textContent = t('desktop.settings.shortcuts.recording');
      setBtn.classList.add('is-recording');
      cancelCapture = captureNextShortcut((acc) => {
        cancelCapture = null;
        setBtn.textContent = t('desktop.settings.shortcuts.set');
        setBtn.classList.remove('is-recording');
        if (acc) {
          input.value = acc;
          paintShortcutKeycaps(input);
          onSet?.();
        }
      });
    };
    setBtn.addEventListener('click', (e) => {
      e.preventDefault();
      start();
    });
    input.addEventListener('dblclick', (e) => {
      e.preventDefault();
      start();
    });
    document.getElementById(`${input.id}-keys`)?.addEventListener('click', (e) => {
      e.preventDefault();
      start();
    });
  }

  if (cycleEl && cycleSetBtn) bindCapture(cycleEl, cycleSetBtn);
  if (triggerEl && triggerSetBtn) bindCapture(triggerEl, triggerSetBtn);
  if (ocrEl && ocrSetBtn) bindCapture(ocrEl, ocrSetBtn);
  if (hoverEl && hoverSetBtn) bindCapture(hoverEl, hoverSetBtn);
  void wireQuickTranslateSettings(qtReplaceEl, qtPanelEl, (input, btn, onSet) => bindCapture(input, btn, onSet), [qtReplaceSetBtn, qtPanelSetBtn]);

  try {
    const st = await api.getMonitorState();
    if (cycleEl) cycleEl.value = st.cycleShortcut || '';
    if (triggerEl) triggerEl.value = st.triggerShortcut || '';
    if (ocrEl) ocrEl.value = st.ocrShortcut || 'CommandOrControl+Shift+O';
    if (hoverEl) hoverEl.value = st.hoverShortcut || 'CommandOrControl+Shift+H';
    if (hoverToggle) hoverToggle.checked = st.hoverEnabled !== false;
    if (rememberToggle) rememberToggle.checked = (st as { rememberSources?: boolean }).rememberSources !== false;
    if (lookupOpensSelect) lookupOpensSelect.value = (st as { lookupOpens?: string }).lookupOpens === 'panel' ? 'panel' : 'strip';
    if (cycleEl) paintShortcutKeycaps(cycleEl);
    if (triggerEl) paintShortcutKeycaps(triggerEl);
    if (ocrEl) paintShortcutKeycaps(ocrEl);
    if (hoverEl) paintShortcutKeycaps(hoverEl);
  } catch {
    /* ignore */
  }
  paintStaticCheatKeycaps();

  const btn = document.getElementById('monitor-save-shortcuts');
  const statusEl = document.getElementById('monitor-shortcuts-status');
  btn?.addEventListener('click', async () => {
    if (!cycleEl || !triggerEl || !ocrEl || !hoverEl || !statusEl) return;
    statusEl.textContent = '';
    const r = await api.setMonitorShortcuts({
      cycleShortcut: cycleEl.value.trim(),
      triggerShortcut: triggerEl.value.trim(),
      ocrShortcut: ocrEl.value.trim(),
      hoverShortcut: hoverEl.value.trim(),
      hoverEnabled: hoverToggle ? hoverToggle.checked : true,
    });
    statusEl.textContent = r.success ? t('desktop.settings.shortcuts.saved') : (r.error || t('desktop.settings.shortcuts.saveFailed'));
    statusEl.classList.toggle('is-error', !r.success);
  });

  hoverToggle?.addEventListener('change', async () => {
    if (!cycleEl || !triggerEl || !ocrEl || !hoverEl) return;
    await api.setMonitorShortcuts({
      cycleShortcut: cycleEl.value.trim(),
      triggerShortcut: triggerEl.value.trim(),
      ocrShortcut: ocrEl.value.trim(),
      hoverShortcut: hoverEl.value.trim(),
      hoverEnabled: hoverToggle.checked,
    });
  });

  return { stopCapture: stopCaptureUi };
}


function wireLiveResizeClass(): void {
  window.electronAPI?.onMainWindowResizing?.((resizing) => {
    document.documentElement.classList.toggle('is-resizing', resizing);
  });
  const overlay = (
    navigator as Navigator & {
      windowControlsOverlay?: {
        visible?: boolean;
        getTitlebarAreaRect?: () => { x: number; width: number };
        addEventListener?: (type: string, fn: () => void) => void;
      };
    }
  ).windowControlsOverlay;
  const syncWco = (): void => {
    if (!overlay?.visible) return;
    document.documentElement.classList.add('has-wco');
    const rect = overlay.getTitlebarAreaRect?.();
    // A hidden or not-yet-laid-out window reports a zero-width title bar area,
    // which would turn the inset into the whole window width and push the gear
    // to the left. Keep the last good value (or the CSS default) instead.
    if (!rect || !(rect.width > 0) || !Number.isFinite(rect.x)) return;
    const inset = Math.round(window.innerWidth - rect.x - rect.width);
    if (inset <= 0 || inset > 320) return;
    document.documentElement.style.setProperty('--wco-inset-right', `${inset}px`);
  };
  syncWco();
  overlay?.addEventListener?.('geometrychange', syncWco);
  window.addEventListener('resize', syncWco);
  window.addEventListener('focus', syncWco);
  document.addEventListener('visibilitychange', syncWco);
}

function initializeMainWindow() {
  initializeMainWindowControls();
  wireAccountMenu();
  wireMainWindowImageIngest();
  wireInAppTextSelectionLookup();
  wireMainWorkspace();
  renderRecentLookups();
  void loadVocabNotebook();
  wireLiveResizeClass();
  const vocabApi = (window as any).vocabAPI;
  if (vocabApi?.onUpdated) {
    vocabApi.onUpdated(() => {
      void loadVocabNotebook();
    });
  }
  void attachSelectionChangeListenerOnly();
}

/** Select-to-lookup in any Phevere window — same path as UIA outside the app. */
function wireInAppTextSelectionLookup(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  document.addEventListener('mouseup', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('button, input, textarea, select, a, option, .titlebar, .settings-titlebar, .window-controls, .status-bar, .toolbar')) {
      return;
    }
    const text = (window.getSelection()?.toString() || '').trim();
    if (!text || text.length > 80) return;
    if (!/[\p{L}\p{N}]/u.test(text)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const still = (window.getSelection()?.toString() || '').trim();
      if (still !== text) return;
      const api = window.electronAPI as {
        showPopup?: (x: number, y: number, t: string) => void;
        getMonitorState?: () => Promise<{ mode?: string }>;
      };
      const open = () => {
        addToRecentSelections(text);
        if (api?.showPopup) api.showPopup(e.screenX || 0, e.screenY || 0, text);
      };
      if (!api?.getMonitorState) {
        open();
        return;
      }
      void api.getMonitorState().then((state) => {
        if (state?.mode === 'off') return;
        open();
      });
    }, 280);
  });
}

function initializeClipboardWindow() {
  document.body.className = 'clipboard-window main-window';
  initializeMainWindowControls();
  wireInAppTextSelectionLookup();
  wireLiveResizeClass();
  void showClipboardHistory();
}

let vocabNotebookCache: any[] = [];
const VOCAB_SORT_KEY = 'phevere-vocab-sort';
const NB_VIEW_KEY = 'phevere-notebook-view';
const NB_CARDS_LAYOUT_KEY = 'phevere-notebook-cards-layout';
const NB_GROUP_KEY = 'phevere-notebook-group';
const NB_MAP_KINDS_KEY = 'phevere-notebook-map-kinds';
const NB_GOAL_KEY = 'phevere-review-goal';
const LEARN_PREFS_KEY = 'phevere-learn-prefs';
/** Bumped by Settings → Learn after it changes a word book's goal, so the main window reloads the books. */
const LEARN_BOOKS_KEY = 'phevere-learn-books-changed';
const WS_TAB_KEY = 'phevere-main-tab';
type VocabSortMode = 'recent' | 'alpha';

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the choice lasts this session */
  }
}

// Review moved from the Words switcher to the Learn tab: a saved Review view opens Learn instead.
const savedNbView = readNotebookView(readPref(NB_VIEW_KEY, 'list'));
if (savedNbView.learn) {
  writePref(NB_VIEW_KEY, savedNbView.view);
  writePref(WS_TAB_KEY, 'learn');
}
let nbView: NotebookView = savedNbView.view;
let nbGroup = readPref(NB_GROUP_KEY, 'root') as FamilyGrouping;
let nbMapKinds = readPref(NB_MAP_KINDS_KEY, 'root,prefix,char').split(',').filter(Boolean) as MorphKind[];
let nbGoal = Number(readPref(NB_GOAL_KEY, '10')) || 10;
/* Settings → Learn writes these from its own window; the main window follows through storage events. */
let learnPrefs: LearnPrefs = readLearnPrefs(readPref(LEARN_PREFS_KEY, ''));
let learnMicrophone = false;
let nbReview: ReviewState | null = null;
const nbFlipped = new Set<string>();
// Expanded or not, per list; a single choice saved by an older version applies to every list.
let nbCardLayouts = readCardLayouts(readPref(NB_CARDS_LAYOUT_KEY, ''));
function saveCardLayout(layout: CardLayout, list: string): void {
  nbCardLayouts = withCardLayout(nbCardLayouts, list || 'mine', layout);
  writePref(NB_CARDS_LAYOUT_KEY, JSON.stringify(nbCardLayouts));
}
const nbExpanded = new Set<string>();
let vocabRenderToken = 0;
let nbGrading = false;
/** Appends the rest of a chunked list at once (A–Z jumps need every row present). */
let flushVocabChunks: (() => void) | null = null;
let nbAnalysis: { key: unknown; q: string; value: ReturnType<typeof analyzeNotebook> } | null = null;

/* Word books: which list the Words tab shows (My words, a book or All books) and its data. */
const WORDS_SCOPE_KEY = 'phevere-words-scope';
/** The language chip chosen above My words ('all' when none is). */
const WORDS_LANG_KEY = 'phevere-words-lang';
let wordsLang = readPref(WORDS_LANG_KEY, 'all');
let wbScope = readPref(WORDS_SCOPE_KEY, 'mine') as WordsScope;
let wbLibrary = false;
let wbLimit = BOOK_LIST_PAGE;
const WB_SORT_KEY = 'phevere.bookSort';
let wbSort = readBookSort(readPref(WB_SORT_KEY, 'book'));
let wbSubs: any[] = [];
let wbUserBooks: any[] = [];
let wbProgress = new Map<string, any>();
const wbBooks = new Map<string, string[]>();
let wbCtx: WordsContext | null = null;
let wbAnalysis: { key: unknown; q: string; view: string; value: ReturnType<typeof analyzeNotebook> } | null = null;
const wbMeaningInFlight = new Set<string>();
/** Book words opened on their brief definition, by lowercase headword. */
const wbOpen = new Set<string>();
/* Example sentences for the quiz's gap questions, looked up ahead for words already started. */
const reviewExamples = new Map<string, string[]>();
const examplesInFlight = new Set<string>();

async function prefetchExamples(wait = false): Promise<void> {
  const api = wordbookApi();
  if (!nbReview || !api?.examples) return;
  const pool: any[] = wbCtx && wbScope !== 'mine' ? scopeEntries(wbScope, wbCtx) : vocabNotebookCache;
  const byId = new Map(pool.map((e: any) => [e.id, e]));
  const lemmas: string[] = [];
  for (let i = nbReview.index + (wait ? 0 : 1); i < nbReview.queue.length && lemmas.length < 3; i++) {
    const e: any = byId.get(nbReview.queue[i]);
    const key = String(e?.lemma || '').toLowerCase();
    if (!e || !key || reviewExamples.has(key) || examplesInFlight.has(key) || memoryLevel(e) < 1) continue;
    lemmas.push(String(e.lemma));
  }
  const jobs = lemmas.map(async (lemma) => {
    const key = lemma.toLowerCase();
    examplesInFlight.add(key);
    try {
      const list = await api.examples(lemma);
      reviewExamples.set(key, Array.isArray(list) ? list : []);
    } catch {
      /* offline: no gap-fill from examples */
    } finally {
      examplesInFlight.delete(key);
    }
  });
  if (wait) await Promise.all(jobs);
}

function readBookSort(v: string): BookSort {
  return v === 'recent' || v === 'az' ? v : 'book';
}

function wordbookApi(): any {
  return (window as any).wordbookAPI;
}

/** Books the learner made or imported exist, so rows offer "Add to word book". */
function hasOwnBooks(): boolean {
  return wbUserBooks.some((b) => !b.deleted);
}

function setWordsScope(scope: WordsScope): void {
  wbScope = scope;
  wbLibrary = false;
  wbLimit = BOOK_LIST_PAGE;
  nbReview = null;
  writePref(WORDS_SCOPE_KEY, scope);
}

function rebuildWordsContext(): void {
  wbCtx = buildWordsContext(vocabNotebookCache, wbProgress, wbSubs, wbBooks, wbUserBooks);
  if (!['mine', 'all', 'sources'].includes(wbScope) && !wbSubs.some((s) => s.bookId === wbScope)) setWordsScope('mine');
  if (wbScope === 'all' && !wbSubs.length) setWordsScope('mine');
}

/** Subscriptions and progress from the main process; each subscribed book's words load once. */
async function refreshWords(): Promise<void> {
  const api = wordbookApi();
  if (!api?.state) return;
  try {
    const state = await api.state();
    wbSubs = state?.subs || [];
    wbUserBooks = state?.userBooks || [];
    wbProgress = new Map((state?.progress || []).map((p: any) => [p.lemma, p]));
    for (const s of wbSubs) if (!isUserBookId(s.bookId) && !wbBooks.has(s.bookId)) wbBooks.set(s.bookId, await loadWordbook(s.bookId));
    await primeBookLevels(wbSubs.map((s) => s.bookId));
  } catch (error) {
    console.warn('word books unavailable', error);
  }
  rebuildWordsContext();
}

/** Looks up a book word's meaning through the main process, which caches it with the word. */
async function fetchBookMeaning(lemma: string): Promise<void> {
  const api = wordbookApi();
  const key = lemma.toLowerCase();
  if (!api?.meaning || wbMeaningInFlight.has(key)) return;
  wbMeaningInFlight.add(key);
  try {
    const meaning = await api.meaning(lemma);
    if (meaning) wbProgress.set(key, { ...(wbProgress.get(key) || { lemma: key, known: false, updatedAt: 0 }), ...meaning });
  } catch {
    /* offline: an opened row says it has no definition */
  } finally {
    wbMeaningInFlight.delete(key);
  }
}

/** Looks up the next queued book words that have no meaning yet, so their quiz can ask it. */
async function prefetchMeanings(wait = false): Promise<void> {
  const api = wordbookApi();
  if (!nbReview || wbScope === 'mine' || !wbCtx || !api?.meaning) return;
  const lemmas = reviewNeedsMeaning(nbReview, scopeEntries(wbScope, wbCtx), wait ? ROUND_WORDS : 4).filter((l) => !wbMeaningInFlight.has(l.toLowerCase()));
  if (!lemmas.length) return;
  const done = Promise.all(
    lemmas.map((lemma) => fetchBookMeaning(lemma)),
  ).then(() => {
    rebuildWordsContext();
    if (!wait && mainTab === 'learn' && !nbReview?.answer) renderLearn();
  });
  if (wait) await done;
}

/** A word book or All books: the same views over the book's words. Returns false for My words. */
function renderBookScope(body: HTMLElement, wrap: HTMLElement, list: HTMLElement): boolean {
  if (!wbCtx || (wbScope === 'mine' && !wbLibrary)) return false;
  vocabRenderToken += 1;
  flushVocabChunks = null;
  list.innerHTML = '';
  wrap.hidden = true;
  body.hidden = false;
  document.getElementById('vocabSortGroup')?.setAttribute('hidden', '');
  document.querySelector<HTMLElement>('#paneNotebook .nb-bar')?.toggleAttribute('hidden', wbLibrary || wbScope === 'sources');
  if (wbLibrary) {
    disposeNotebookMaps(true);
    body.innerHTML = wordbookLibraryHtml(wbCtx);
    return true;
  }
  if (wbScope === 'sources') {
    disposeNotebookMaps(true);
    body.innerHTML = sourcesHtml(wbCtx);
    return true;
  }
  const q = ((document.getElementById('vocabSearch') as HTMLInputElement | null)?.value || '').trim().toLowerCase();
  const all = scopeEntries(wbScope, wbCtx);
  const shown = q ? all.filter((e) => e.lemma.toLowerCase().includes(q)) : all;
  if (nbView === 'list') {
    disposeNotebookMaps(true);
    body.innerHTML = wordbookListHtml(shown, { scope: wbScope, limit: wbLimit, filtered: !!q, sort: wbSort, expanded: wbOpen, loading: wbMeaningInFlight, bookPick: hasOwnBooks() });
    return true;
  }
  // The map always holds the whole book; the search flies to a word on it instead.
  const study = nbView === 'map' ? all : shown;
  const aq = nbView === 'map' ? '' : q;
  if (!wbAnalysis || wbAnalysis.key !== wbCtx || wbAnalysis.q !== aq || wbAnalysis.view !== nbView) {
    wbAnalysis = { key: wbCtx, q: aq, view: nbView, value: analyzeNotebook(study) };
  }
  const analysis = wbAnalysis.value;
  if (nbView === 'families') body.innerHTML = familiesHtml(analysis, nbGroup, { tracing: familiesTraceProgress() });
  else if (nbView === 'map') body.innerHTML = mapHtml(analysis, nbMapKinds, { query: q });
  else body.innerHTML = cardsHtml(study, analysis, nbFlipped, cardLayoutIn(nbCardLayouts, String(wbScope)), undefined, { list: String(wbScope) });
  attachNotebookMap(body);
  attachFamilies(body);
  const fetchImage = wordImageFetcher();
  attachCardTable(body, {
    onLayout: saveCardLayout,
    onCards: () => {
      if (fetchImage) fillWordImages(body, fetchImage);
    },
  });
  if (fetchImage) fillWordImages(body, fetchImage);
  return true;
}

/** New words first graded today, so the daily goal holds across visits to Review. */
function startedTodayKey(): string {
  const d = new Date();
  return `phevere-review-started-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function startedToday(): string[] {
  try {
    const list = JSON.parse(readPref(startedTodayKey(), '[]'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function getVocabSortMode(): VocabSortMode {
  return readPref(VOCAB_SORT_KEY, 'recent') === 'alpha' ? 'alpha' : 'recent';
}

function setVocabSortMode(mode: VocabSortMode): void {
  writePref(VOCAB_SORT_KEY, mode);
  document.getElementById('vocabSortRecent')?.classList.toggle('is-active', mode === 'recent');
  document.getElementById('vocabSortAlpha')?.classList.toggle('is-active', mode === 'alpha');
  document.getElementById('vocabSortRecent')?.setAttribute('aria-pressed', mode === 'recent' ? 'true' : 'false');
  document.getElementById('vocabSortAlpha')?.setAttribute('aria-pressed', mode === 'alpha' ? 'true' : 'false');
}

function sortVocabEntries(entries: any[]): any[] {
  const copy = [...entries];
  if (getVocabSortMode() === 'alpha') {
    copy.sort((a, b) => compareAz(String(a.lemma || ''), String(b.lemma || '')));
  } else {
    // Saved order: reviews and sync bump updatedAt, which must not move words.
    copy.sort((a, b) => Number(b.createdAt || b.updatedAt || 0) - Number(a.createdAt || a.updatedAt || 0));
  }
  return copy;
}

function ensureVocabAzIndex(): HTMLElement | null {
  const nav = document.getElementById('vocabAz');
  if (!nav) return null;
  if (!nav.dataset.ready) {
    nav.innerHTML = AZ_INDEX
      .map((letter) => `<button type="button" class="vocab-az__letter" data-letter="${letter}">${letter}</button>`)
      .join('');
    nav.dataset.ready = '1';
    wireIndexRail(nav, { jump: scrollVocabToLetter, hud: (key) => (key ? showVocabAzHud(key) : hideVocabAzHud()) });
  }
  return nav;
}

function scrollVocabToLetter(letter: string): void {
  const list = document.getElementById('vocabList');
  if (!list) return;
  flushVocabChunks?.();
  list.querySelector<HTMLElement>(`[data-az="${letter}"]`)?.scrollIntoView({ block: 'start' });
}

function showVocabAzHud(letter: string): void {
  const hud = document.getElementById('vocabAzHud');
  if (!hud) return;
  hud.textContent = letter;
  hud.hidden = false;
}

function hideVocabAzHud(): void {
  const hud = document.getElementById('vocabAzHud');
  if (hud) hud.hidden = true;
}

/* Timeline rail: the Recent list's counterpart to A to Z, by week or by month. */
let vocabTimeIndex = new Map<string, { id: string; label: string }>();

function vocabSavedAt(e: any): number {
  return Number(e.createdAt || e.updatedAt || 0);
}

/** Weeks when the notebook spans under four months, months beyond that. */
function vocabTimeBuckets(entries: any[]): Array<{ key: string; short: string; label: string; year: number; id: string }> {
  const times = entries.map(vocabSavedAt).filter((t) => t > 0);
  if (!times.length) return [];
  const span = (Math.max(...times) - Math.min(...times)) / 86_400_000;
  const byWeek = span <= 120;
  const out: Array<{ key: string; short: string; label: string; year: number; id: string }> = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const at = vocabSavedAt(e);
    if (!at) continue;
    const d = new Date(at);
    if (byWeek) {
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    } else d.setDate(1);
    const key = `${d.getFullYear()}-${d.getMonth()}-${byWeek ? d.getDate() : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      short: byWeek
        ? formatDate(d, { month: 'short', day: 'numeric' })
        : formatDate(d, { month: 'short' }),
      label: byWeek
        ? t('desktop.words.weekOf', { date: formatDate(d, { month: 'long', day: 'numeric' }) })
        : formatDate(d, { month: 'long', year: 'numeric' }),
      year: d.getFullYear(),
      id: String(e.id),
    });
  }
  return out;
}

function scrollVocabToTime(key: string): void {
  const hit = vocabTimeIndex.get(key);
  const list = document.getElementById('vocabList');
  if (!hit || !list) return;
  flushVocabChunks?.();
  const row = list.querySelector<HTMLElement>(`.vocab-item[data-id="${CSS.escape(hit.id)}"]`);
  const head = row?.previousElementSibling?.classList.contains('vocab-group') ? (row.previousElementSibling as HTMLElement) : row;
  head?.scrollIntoView({ block: 'start' });
}

/**
 * The rails are fixed to the window so they stay put while the list scrolls. Each one is kept
 * inside the list's box on screen, below the sticky header and above the status bar, so it never
 * sits beside the book row, the view switcher or the sort buttons, and never runs past a short
 * list. The box is measured again whenever something can move it: the list or the rows above it
 * change size (a book row filling in, fonts arriving late), the Words tab becomes visible after
 * rendering while hidden, the window resizes, or the list scrolls. Before 2026-11-06 the top was
 * measured once per render, which read a hidden or not yet laid out list as sitting right under
 * the header, so the rail ran from the book row down past the sort switch.
 */
const vocabRails = new Map<string, { place: () => void }>();

function followVocabRail(nav: HTMLElement): void {
  if (vocabRails.has(nav.id)) return;
  const shell = document.querySelector<HTMLElement>('.main-shell');
  const head = document.querySelector<HTMLElement>('.ws-head');
  vocabRails.set(
    nav.id,
    followIndexRail(nav, {
      list: () => document.getElementById('vocabList'),
      clip: () => ({
        top: head?.getBoundingClientRect().bottom ?? 0,
        bottom: shell?.getBoundingClientRect().bottom ?? window.innerHeight,
      }),
      watch: [shell, head, document.getElementById('paneNotebook'), document.getElementById('vocabList')],
      scroller: shell || window,
    }),
  );
}

function schedulePlaceVocabRails(): void {
  for (const id of ['vocabAz', 'vocabTimeline']) {
    const nav = document.getElementById(id);
    if (!nav) continue;
    followVocabRail(nav);
    vocabRails.get(id)?.place();
  }
}

function syncVocabTimeline(entries: any[]): void {
  const nav = document.getElementById('vocabTimeline');
  const wrap = document.getElementById('vocabListWrap');
  if (!nav) return;
  const buckets = nbView === 'list' && getVocabSortMode() !== 'alpha' ? vocabTimeBuckets(entries) : [];
  const on = buckets.length > 1;
  nav.hidden = !on;
  wrap?.classList.toggle('is-timeline', on);
  if (!on) return;
  vocabTimeIndex = new Map(buckets.map((b) => [b.key, { id: b.id, label: b.label }]));
  let year = buckets[0].year;
  nav.innerHTML = buckets
    .map((b, i) => {
      const mark = i > 0 && b.year !== year ? ` data-year="${b.year}"` : '';
      year = b.year;
      return `<button type="button" class="vocab-az__letter vocab-az__time"${mark} data-letter="${b.key}" aria-label="${escapeHtmlSelection(b.label)}">${escapeHtmlSelection(b.short)}</button>`;
    })
    .join('');
  if (!nav.dataset.ready) {
    nav.dataset.ready = '1';
    wireIndexRail(nav, { jump: scrollVocabToTime });
  }
  // The entries changed, so the number that fit may have too.
  schedulePlaceVocabRails();
}

function syncVocabAzAvailability(entries: any[]): void {
  const nav = ensureVocabAzIndex();
  const wrap = document.getElementById('vocabListWrap');
  const alpha = nbView === 'list' && getVocabSortMode() === 'alpha' && entries.length > 0;
  if (wrap) wrap.classList.toggle('is-alpha', alpha);
  if (!nav) return;
  nav.hidden = !alpha;
  if (!alpha) {
    hideVocabAzHud();
    return;
  }
  schedulePlaceVocabRails();
  const present = new Set(entries.map((e) => vocabAzLetter(String(e.lemma || ''))));
  nav.querySelectorAll<HTMLElement>('.vocab-az__letter').forEach((btn) => {
    const letter = btn.dataset.letter || '';
    btn.classList.toggle('is-empty', !present.has(letter));
  });
}

async function loadVocabNotebook(): Promise<void> {
  const list = document.getElementById('vocabList');
  if (!list) return;
  const api = (window as any).vocabAPI;
  if (!api?.list) {
    list.innerHTML = `<p class="empty-message">${tHtml('desktop.words.unavailable')}</p>`;
    return;
  }
  try {
    const entries = await api.list(5000);
    vocabNotebookCache = entries || [];
    await refreshWords();
    renderVocabNotebook(filterVocabEntries(vocabNotebookCache));
    renderLearn();
    renderRecentLookups();
  } catch (error) {
    console.error('vocab load failed', error);
    list.innerHTML = `<p class="empty-message">${tHtml('desktop.words.loadFailed')}</p>`;
  }
}

function filterVocabEntries(entries: any[]): any[] {
  const q = ((document.getElementById('vocabSearch') as HTMLInputElement | null)?.value || '')
    .trim()
    .toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => {
    const blob = [e.lemma, e.reading, e.definition, e.partOfSpeech, e.note, ...(e.sources || []), e.context?.doc, e.context?.title, e.context?.sentence]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return blob.includes(q);
  });
}

/** Card and review pictures follow the lookup pane's Images switch, stored by the pop-up. */
function wordImageFetcher(): WordImageFetcher | null {
  try {
    if (JSON.parse(localStorage.getItem('phevereSettings') || '{}').senseImages === false) return null;
  } catch {
    /* unreadable settings: images stay on, the default */
  }
  // Through the main process: it identifies itself to Wikimedia (anonymous clients get about
  // ten requests a minute, a deck of cards needs several per card) and caches on disk.
  const api = (window as any).dictionaryAPI;
  // The card's picture shows as soon as the first source finds it, and a card that scrolls away
  // stops its search in the main process too.
  if (api?.senseImages) {
    return (lemma, lang, gloss, pos, onPicture, signal, again) => {
      const g = String(gloss || '').trim();
      const sense = g ? { meaning: g, partOfSpeech: pos || '' } : { meaning: '' };
      const onUpdate = onPicture ? (list: any[]) => onPicture((Array.isArray(list) && list[0]) || null) : undefined;
      const onCancel = signal ? (cancel: () => void) => signal.addEventListener('abort', cancel, { once: true }) : undefined;
      return api.senseImages(lemma, [sense], { max: 1, lang, again, wordPicture: true }, onUpdate, onCancel).then((r: any[]) => (Array.isArray(r) && r[0]) || null);
    };
  }
  return (lemma, lang, gloss, pos, onPicture, signal, again) => fetchWordImage(lemma, { lang, gloss, pos, onUpdate: onPicture, signal, again });
}

function renderVocabNotebook(entries: any[]): void {
  const list = document.getElementById('vocabList');
  const body = document.getElementById('nbViewBody');
  const wrap = document.getElementById('vocabListWrap');
  const sw = document.getElementById('nbViewSwitch');
  if (!list || !body || !wrap) return;
  if (sw) sw.innerHTML = notebookViewSwitchHtml(nbView);
  document.getElementById('vocabSortGroup')?.toggleAttribute('hidden', nbView !== 'list');
  document.querySelector<HTMLElement>('#paneNotebook .nb-bar')?.removeAttribute('hidden');
  const count = document.getElementById('vocabCount');
  if (count) count.textContent = vocabNotebookCache.length ? formatNumber(vocabNotebookCache.length) : '';
  const wbSwitch = document.getElementById('wbSwitch');
  if (wbSwitch) {
    wbSwitch.innerHTML = wbCtx ? wordsScopeSwitchHtml(wbScope, wbCtx, wbLibrary) : '';
    wbSwitch.querySelector<HTMLElement>('.wb-scope.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const wbHead = document.getElementById('wbHead');
  if (wbHead) wbHead.innerHTML = wbCtx && !wbLibrary ? wordbookHeaderHtml(wbScope, wbCtx) : '';
  const langHost = document.getElementById('vocabLangs');
  if (langHost) langHost.innerHTML = '';
  if (renderBookScope(body, wrap, list)) {
    syncVocabAzAvailability([]);
    syncVocabTimeline([]);
    return;
  }
  // Words saved in several languages: a chip per language, and every view shows the chosen one.
  const langs = vocabLanguages(vocabNotebookCache);
  if (langHost) langHost.innerHTML = vocabLangChipsHtml(langs, wordsLang, vocabNotebookCache.length, languageDisplayName);
  entries = filterVocabByLang(entries, wordsLang, langs);
  // My words rows carry a badge for each subscribed book that lists the word.
  const index = wbCtx?.index;
  const sorted = sortVocabEntries(index ? entries.map((e) => ({ ...e, books: index.get(String(e.lemma || '').trim().toLowerCase()) })) : entries);
  syncVocabAzAvailability(sorted);
  syncVocabTimeline(sorted);
  const isList = nbView === 'list';
  wrap.hidden = !isList;
  body.hidden = isList;
  if (!isList) {
    vocabRenderToken += 1;
    flushVocabChunks = null;
    list.innerHTML = '';
    // The analysis only changes when the notebook or the search does. The map always holds
    // every word in the chosen language; the search flies to a word on it instead.
    const search = (document.getElementById('vocabSearch') as HTMLInputElement | null)?.value || '';
    const isMap = nbView === 'map';
    const q = `${isMap ? '\0map' : search}|${wordsLang}`;
    if (!nbAnalysis || nbAnalysis.key !== vocabNotebookCache || nbAnalysis.q !== q) {
      nbAnalysis = { key: vocabNotebookCache, q, value: analyzeNotebook(isMap ? filterVocabByLang(vocabNotebookCache, wordsLang, langs) : sorted) };
    }
    const analysis = nbAnalysis.value;
    if (nbView === 'families') {
      body.innerHTML = familiesHtml(analysis, nbGroup, { tracing: familiesTraceProgress() });
      traceNotebookFamilies(
        vocabNotebookCache.map((e) => String(e.lemma || '')),
        () => document.getElementById('nbViewBody'),
        () => {
          // New origins and roots: repaint unless the reader has a family open.
          if (nbView === 'families' && !document.querySelector('#nbViewBody details[open]')) rerenderNotebook();
        },
      );
    }
    else if (nbView === 'map') body.innerHTML = mapHtml(analysis, nbMapKinds, { query: search.trim() });
    else body.innerHTML = cardsHtml(sorted, analysis, nbFlipped, cardLayoutIn(nbCardLayouts, 'mine'), undefined, { list: 'mine' });
    attachNotebookMap(body);
    attachFamilies(body);
    const fetchImage = wordImageFetcher();
    attachCardTable(body, {
      onLayout: saveCardLayout,
      onCards: () => {
        if (fetchImage) fillWordImages(body, fetchImage);
      },
    });
    if (fetchImage) fillWordImages(body, fetchImage);
    return;
  }
  body.innerHTML = '';
  disposeNotebookMaps(true);
  if (!sorted.length) {
    const q = ((document.getElementById('vocabSearch') as HTMLInputElement | null)?.value || '').trim();
    list.innerHTML = `<p class="empty-message">${q ? tHtml('desktop.words.noMatches') : tHtml('desktop.words.empty')}</p>`;
    return;
  }
  // Long notebooks: paint the first screenful now and append the rest in idle chunks, so
  // opening the list or typing in search never parses thousands of rows in one task.
  const sort = getVocabSortMode() === 'alpha' ? 'az' : 'recent';
  const token = ++vocabRenderToken;
  const CHUNK = 300;
  // Enough rows to cover where the reader is, so a re-render (a removal, a save from the
  // pop-up) keeps the scroll position instead of clamping it to the first screen.
  const shell = document.querySelector<HTMLElement>('.main-shell');
  const first = Math.max(120, Math.ceil(((shell?.scrollTop || 0) + (shell?.clientHeight || 800)) / 48) + 40);
  const scrollTop = shell?.scrollTop || 0;
  list.innerHTML = vocabListHtml(sorted.slice(0, first), { sort, expanded: nbExpanded, bookPick: hasOwnBooks() });
  if (shell && scrollTop) shell.scrollTop = scrollTop;
  let next = first;
  const appendChunk = (size: number) => {
    if (token !== vocabRenderToken || next >= sorted.length) return false;
    const afterGroup = sort === 'recent' ? vocabEntryGroup(sorted[next - 1]) : '';
    list.insertAdjacentHTML(
      'beforeend',
      vocabListHtml(sorted.slice(next, next + size), { sort, expanded: nbExpanded, afterGroup, bookPick: hasOwnBooks() }),
    );
    next += size;
    return next < sorted.length;
  };
  flushVocabChunks = () => {
    appendChunk(sorted.length);
    flushVocabChunks = null;
  };
  const step = () => {
    if (appendChunk(CHUNK)) setTimeout(step, 0);
    else if (token === vocabRenderToken) flushVocabChunks = null;
  };
  setTimeout(step, 0);
}


function rerenderNotebook(): void {
  renderVocabNotebook(filterVocabEntries(vocabNotebookCache));
}

/* Learn: Today or Progress, and the answer history Progress draws from (null until loaded). */
const LEARN_PAGE_KEY = 'phevere-learn-page';
let learnPage: LearnPage = readPref(LEARN_PAGE_KEY, 'today') === 'progress' ? 'progress' : 'today';
let answerHistory: AnswerRecord[] | null = null;
let answerHistoryLoading = false;

function loadAnswerHistory(): void {
  const api = (window as any).vocabAPI;
  if (answerHistoryLoading) return;
  answerHistoryLoading = true;
  Promise.resolve(api?.history ? api.history() : [])
    .catch((): AnswerRecord[] => [])
    .then((rows: AnswerRecord[]) => {
      answerHistory = rows || [];
      answerHistoryLoading = false;
      if (mainTab === 'learn' && learnPage === 'progress') renderLearn();
    });
}

/** What the answer history says about the learner, for choosing questions and today's new words; null until loaded. */
let learner: { model: LearnerModel; pace: StudyPace | null } | null = null;
let learnerLoading: Promise<void> | null = null;

function loadLearner(): Promise<void> {
  const api = (window as any).vocabAPI;
  if (learnerLoading) return learnerLoading;
  learnerLoading = Promise.resolve(api?.history ? api.history() : [])
    .catch((): AnswerRecord[] => [])
    .then((rows: AnswerRecord[]) => {
      const now = Date.now();
      learner = { model: learnerModel(rows || [], now), pace: studyPace(rows || [], now) };
      learnerLoading = null;
    });
  return learnerLoading;
}

/* The account, for the Plus line in Learn when progress sync is off. */
let learnNotice = '';

function setLearnAccountState(next: AccountState | null): void {
  const notice = plusNoticeHtml(next, HOLARKY_ACCOUNT.plusUrl, 'learn');
  if (notice === learnNotice) return;
  learnNotice = notice;
  renderLearn();
}

/** The Learn tab: today's review of the list chosen in Words (My words, a book or All books), or Progress. */
function renderLearn(): void {
  const pane = document.getElementById('paneLearn');
  if (!pane || pane.hidden) return;
  const scope = wbCtx ? wbScope : 'mine';
  const pace = learner?.pace ?? null;
  if (!nbReview && (scope !== 'mine' || vocabNotebookCache.length)) {
    nbReview = wbCtx
      ? startScopeReview(scope, wbCtx, { mineGoal: nbGoal, mineStartedToday: startedToday().length, pace })
      : startReview(vocabNotebookCache, nbGoal, Date.now(), startedToday().length, pace);
  }
  if (!learner) {
    // Today's plan waits for nothing; once the learner is known, a session not yet started plans again.
    void loadLearner().then(() => {
      if (nbReview && !nbReview.started) nbReview = null;
      if (mainTab === 'learn') renderLearn();
    });
  }
  pane.innerHTML = learnHtml({
    scope,
    ctx: wbCtx,
    mine: vocabNotebookCache,
    review: nbReview || startReview([], nbGoal),
    goal: nbGoal,
    options: {
      audio: true,
      preview: (e, g) => previewReview(e, g),
      formatGap: formatReviewGap,
      examples: (lemma) => reviewExamples.get(lemma.toLowerCase()),
      learner: learner?.model ?? null,
      pace,
      learnPrefs,
      microphone: learnMicrophone,
    },
    page: learnPage,
    history: answerHistory,
    notice: learnNotice,
  });
  markLoadingSpeakers(pane);
  pane.querySelector<HTMLElement>('.wb-scope.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const body = pane.querySelector<HTMLElement>('.lrn-body');
  if (!body) return;
  attachLearnCharts(body);
  if (learnPage === 'progress') {
    if (!answerHistory) loadAnswerHistory();
    return;
  }
  const fetchImage = wordImageFetcher();
  if (fetchImage) fillWordImages(body, fetchImage);
  focusReview(body);
  void prefetchMeanings();
  void prefetchExamples();
}

/** Repaints whichever of Words and Learn is showing. */
function rerenderActive(): void {
  if (mainTab === 'learn') renderLearn();
  else rerenderNotebook();
  markLoadingSpeakers();
}

/** After a Review render: put the cursor in the answer box, play a listening question once. */
let nbAutoplayed = '';
/** The word whose ▶ is waiting for its recording, so a repaint draws that button loading again. */
let loadingSpeakerLemma = '';
function focusReview(body: HTMLElement): void {
  // A new question starts with its progress bar and instruction below the sticky header.
  const header = [...document.querySelectorAll<HTMLElement>('.ws-head')].find((h) => h.offsetParent) || null;
  revealQuestion(body, header);
  const input = body.querySelector<HTMLInputElement>('#nbv-answer');
  if (input) {
    input.focus();
    // After a Hint the box holds the letters shown so far; typing goes on after them.
    input.setSelectionRange(input.value.length, input.value.length);
  }
  // Settings → Learn: the countdown on a choice question, answered as not known when it runs out.
  armCountdown(nbReview, learnPrefs.countdown, () => mainTab === 'learn' && learnPage === 'today', () => renderLearn());
  if (!input) {
    const next = body.querySelector<HTMLElement>('[data-act="nb-next"], [data-act="nb-start"], [data-act="nb-round"]');
    next?.focus({ preventScroll: true });
    if (next?.dataset.act === 'nb-next') body.querySelector('.nbv-quiz__grade')?.scrollIntoView({ block: 'nearest' });
  }
  const listen = body.querySelector<HTMLElement>('[data-autoplay]');
  const key = listen && nbReview ? `${nbReview.index}:${listen.dataset.autoplay}` : '';
  if (listen && key !== nbAutoplayed) {
    nbAutoplayed = key;
    const btn = listen.querySelector<HTMLElement>('[data-act="nb-play"]');
    if (btn) void playLemmaPronunciation(listen.dataset.autoplay || '', btn);
  }
}

/**
 * After a letter tile is placed or taken back the row is redrawn; the focus goes to the next
 * letter left (or the word built), so a keyboard or screen reader carries on from there.
 */
function refocusTile(root: ParentNode): void {
  if (nbReview?.answer) return;
  const next = root.querySelector<HTMLElement>('.nbv-tiles__bank button.nbv-tile') || root.querySelector<HTMLElement>('.nbv-tiles__built button.nbv-tile');
  next?.focus({ preventScroll: true });
}

/** Saves the answered question's grade and moves to the next one. */
async function commitReview(): Promise<void> {
  const api = (window as any).vocabAPI;
  const q = nbReview?.question;
  const a = nbReview?.answer;
  if (!nbReview || !q || !a || nbGrading) return;
  nbGrading = true;
  const entry = vocabNotebookCache.find((e) => e.id === q.id);
  if (entry && isNewWord(entry)) {
    writePref(startedTodayKey(), JSON.stringify([...new Set([...startedToday(), q.id])]));
  }
  let updated: any = null;
  const details = reviewAnswerDetails(nbReview, wbCtx ? wbScope : 'mine', wbCtx);
  try {
    if (isBookOnlyId(q.id)) {
      // A book word that is not in My words: progress goes to the book_words table.
      const p = await wordbookApi()?.review(q.lemma, a.grade, details);
      if (p) wbProgress.set(p.lemma, p);
      rebuildWordsContext();
      updated = wbCtx ? bookEntry(q.lemma, wbCtx) : null;
    } else {
      updated = api?.review ? await api.review(q.id, a.grade, details) : null;
      if (updated) {
        vocabNotebookCache = vocabNotebookCache.map((e) => (e.id === q.id ? { ...e, ...updated } : e));
        rebuildWordsContext();
      }
    }
  } catch (error) {
    console.error('review failed', error);
  }
  advanceReview(nbReview, updated);
  // The word of the question just left stops, and one still loading never plays over the next.
  sayLemma.cancel();
  // Today's answers count against the learner's usual day, so the next round plans fewer new words.
  if (learner?.pace) learner.pace.answersToday = (learner.pace.answersToday || 0) + 1;
  answerHistory = null;
  nbGrading = false;
  renderLearn();
}

function answerCurrentReview(input: { choice?: number; typed?: string; knew?: boolean }): void {
  if (!nbReview || !answerReview(nbReview, input)) return;
  renderLearn();
}

/** Review keys: 1 to 4 choose, Enter starts or continues. Typing goes to the answer box. */
function onReviewKey(ev: KeyboardEvent): void {
  if (mainTab !== 'learn' || !nbReview || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const body = document.querySelector<HTMLElement>('#paneLearn .lrn-body');
  if (!body) return;
  const target = ev.target as HTMLElement | null;
  if (target && target.id !== 'nbv-answer' && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  if (target?.id === 'nbv-answer') return;
  // Letter tiles from the keyboard: a letter places a tile, Backspace takes the last one back.
  if (body.querySelector('.nbv-tiles__bank') && !nbReview.answer && (ev.key === 'Backspace' || /^\p{L}$/u.test(ev.key))) {
    ev.preventDefault();
    if (reviewArmed(nbReview) && tileKey(nbReview, ev.key)) renderLearn();
    return;
  }
  if (ev.key === 'Enter') {
    const next = body.querySelector<HTMLElement>('[data-act="nb-next"], [data-act="nb-start"], [data-act="nb-reveal"], [data-act="nb-round"]');
    if (!next) return;
    ev.preventDefault();
    next.click();
    return;
  }
  if (/^[1-4]$/.test(ev.key)) {
    const n = Number(ev.key);
    const knew = body.querySelector<HTMLElement>(`[data-act="nb-knew"][data-knew="${n === 2 ? 1 : 0}"]`);
    const opt = body.querySelector<HTMLElement>(`[data-act="nb-choose"][data-choice="${n - 1}"]:not([disabled])`);
    const hit = opt || (n <= 2 ? knew : null);
    if (!hit) return;
    ev.preventDefault();
    hit.click();
  }
}

/** One click handler for both lists and every notebook view, keyed on `data-act`. */
function wireNotebookActions(root: HTMLElement): void {
  const run = async (el: HTMLElement, ev: Event) => {
    switch (el.dataset.act) {
      case 'lookup': {
        const q = el.dataset.q || el.dataset.lemma;
        if (q) {
          addToRecentSelections(q);
          // data-lang: a word saved in another language opens in it (the Danish "give").
          void openFullLookup(q, el.dataset.lang || undefined);
        }
        return;
      }
      case 'nb-play':
        ev.stopPropagation();
        if (el.dataset.lemma) void playLemmaPronunciation(el.dataset.lemma, el);
        return;
      case 'nb-copy': {
        // data-q: the word as saved; data-id: an opened row's word with its meaning.
        const entry = el.dataset.id ? vocabNotebookCache.find((x) => x?.id === el.dataset.id) : null;
        const text = entry ? vocabCopyText(entry) : (el.dataset.q || '').trim();
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          await (window as any).clipboardAPI?.copy?.(text);
        }
        flashCopied(el);
        return;
      }
      case 'nb-toggle': {
        const item = el.closest<HTMLElement>('.vocab-item');
        const id = item?.dataset.id;
        if (!item || !id) return;
        const open = !nbExpanded.has(id);
        if (open) nbExpanded.add(id);
        else nbExpanded.delete(id);
        item.classList.toggle('is-expanded', open);
        item.classList.toggle('is-collapsed', !open);
        el.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      case 'nb-more': {
        const def = el.previousElementSibling as HTMLElement | null;
        if (!def) return;
        def.classList.toggle('is-clamped');
        el.textContent = def.classList.contains('is-clamped') ? t('desktop.words.showMore') : t('desktop.words.showLess');
        return;
      }
      case 'nb-del': {
        const id = el.dataset.id;
        const api = (window as any).vocabAPI;
        if (!id || !api?.remove) return;
        await api.remove(id);
        nbExpanded.delete(id);
        void loadVocabNotebook();
        return;
      }
      case 'nb-view':
        nbView = (el.dataset.view as NotebookView) || 'list';
        writePref(NB_VIEW_KEY, nbView);
        rerenderNotebook();
        document.querySelector('.main-shell')?.scrollTo({ top: 0 });
        return;
      case 'vocab-lang':
        wordsLang = el.dataset.lang || 'all';
        writePref(WORDS_LANG_KEY, wordsLang);
        rerenderNotebook();
        document.querySelector('.main-shell')?.scrollTo({ top: 0 });
        return;
      case 'nb-group':
        nbGroup = (el.dataset.group as FamilyGrouping) || 'root';
        writePref(NB_GROUP_KEY, nbGroup);
        rerenderNotebook();
        return;
      case 'nb-map-kind': {
        const k = el.dataset.kind as MorphKind;
        nbMapKinds = nbMapKinds.includes(k) ? nbMapKinds.filter((x) => x !== k) : [...nbMapKinds, k];
        writePref(NB_MAP_KINDS_KEY, nbMapKinds.join(','));
        rerenderNotebook();
        return;
      }
      case 'nb-flip': {
        const id = el.dataset.id;
        if (!id) return;
        if (nbFlipped.has(id)) nbFlipped.delete(id);
        else nbFlipped.add(id);
        const open = nbFlipped.has(id);
        // The picture, the back of the card and the turn button all flip; the button shows the state.
        const card = el.closest<HTMLElement>('.nbv-card');
        card?.classList.toggle('is-flipped', open);
        const turn = card?.querySelector<HTMLElement>('.nbv-card__flip');
        if (turn) {
          turn.setAttribute('aria-pressed', open ? 'true' : 'false');
          turn.setAttribute('aria-label', open ? t('desktop.words.card.showWord') : t('desktop.words.card.showMeaning'));
          turn.title = open ? t('desktop.words.card.showWord') : t('desktop.words.card.showMeaning');
        }
        return;
      }
      case 'learn-settings':
        // The goal on Today opens where it is changed.
        void window.electronAPI?.showSettingsWindow?.('learn');
        return;
      case 'learn-use-goal': {
        // The start card's suggested number of new words a day, stored where Settings → Learn keeps it.
        const goal = parseGoal(el.dataset.goal);
        if (goal == null) return;
        const book = el.dataset.book || '';
        if (book) {
          await wordbookApi()?.setGoal?.(book, goal);
          writePref(LEARN_BOOKS_KEY, String(Date.now()));
          await refreshWords();
        } else {
          nbGoal = goal;
          writePref(NB_GOAL_KEY, String(goal));
        }
        if (!nbReview?.started) nbReview = null;
        rerenderActive();
        return;
      }
      case 'nb-review-exit':
        // Back to the Learn page. An answer on screen is saved first, as Continue would.
        if (nbReview?.answer) await commitReview();
        sayLemma.cancel();
        nbReview = null;
        renderLearn();
        document.querySelector('.main-shell')?.scrollTo({ top: 0 });
        return;
      case 'learn-more': {
        // Past today's plan: more new words, or reviews before they are due, from the list in Learn.
        const scope = wbCtx ? wbScope : 'mine';
        const pool = wbCtx ? scopeEntries(scope, wbCtx) : vocabNotebookCache;
        const kind = el.dataset.kind === 'ahead' ? 'ahead' : 'new';
        nbReview = startExtraRound(pool, kind, Date.now(), Number(el.dataset.count) || extraNewCount(nbGoal));
        await Promise.all([prefetchMeanings(true), prefetchExamples(true)]);
        renderLearn();
        document.querySelector('.main-shell')?.scrollTo({ top: 0 });
        return;
      }
      case 'nb-start':
      case 'nb-round':
        // A new round plans again from what is due now and from the answers so far; renderLearn starts it.
        if (el.dataset.act === 'nb-round') {
          learner = null;
          await loadLearner();
          nbReview = null;
          renderLearn();
        }
        // Book words get their meaning looked up before the first question is built.
        await Promise.all([prefetchMeanings(true), prefetchExamples(true)]);
        if (nbReview) nbReview.started = true;
        renderLearn();
        return;
      case 'wb-scope':
        setWordsScope((el.dataset.scope as WordsScope) || 'mine');
        rerenderActive();
        document.querySelector('.main-shell')?.scrollTo({ top: 0 });
        return;
      case 'learn-page':
        learnPage = el.dataset.page === 'progress' ? 'progress' : 'today';
        writePref(LEARN_PAGE_KEY, learnPage);
        if (learnPage === 'progress') answerHistory = null;
        renderLearn();
        document.querySelector('.main-shell')?.scrollTo({ top: 0 });
        return;
      case 'wb-library':
        wbLibrary = !wbLibrary;
        rerenderNotebook();
        document.querySelector('.main-shell')?.scrollTo({ top: 0 });
        return;
      case 'wb-sub': {
        const id = el.dataset.book || '';
        if (!wordbookMeta(id)) return;
        await wordbookApi()?.subscribe(id);
        await refreshWords();
        setWordsScope(id);
        rerenderNotebook();
        document.querySelector('.main-shell')?.scrollTo({ top: 0 });
        return;
      }
      case 'wb-menu': {
        // A list's own menu, from its chip: Export, Export for Anki, Remove or Delete.
        const items = bookMenuItems(el.dataset.scope || 'mine');
        if (!items.length) return;
        openMenu(el, {
          label: el.dataset.title || t('desktop.words.bookMenu'),
          items,
          onPick: (item) => {
            const pick = document.createElement('button');
            Object.assign(pick.dataset, item.data || {}, { act: item.act });
            return run(pick, ev);
          },
        });
        return;
      }
      case 'ub-pick': {
        // "Add to word book": the books you made or imported, ticked where the word is.
        const word = el.dataset.q || '';
        const items = bookPickItems(word, wbUserBooks);
        if (!word || !items.length) return;
        openMenu(el, {
          label: t('desktop.words.addToBook'),
          items,
          multi: true,
          onPick: async (item) => {
            const book = item.data?.book || '';
            if (item.checked) await wordbookApi()?.addBookWords(book, [word]);
            else await wordbookApi()?.removeBookWord(book, word);
            await refreshWords();
            rerenderNotebook();
            renderRecentLookups();
          },
        });
        return;
      }
      case 'wb-export':
        await exportWords(el.dataset.scope || 'mine', el.dataset.fmt === 'anki');
        return;
      case 'wb-import':
        await importWords();
        return;
      case 'wb-unsub': {
        const id = el.dataset.book || '';
        // Progress belongs to the word: it stays, and the confirmation says so.
        const ask = bookRemovalPrompt(id);
        const ok = await (window as any).vocabAPI?.confirm?.({ message: ask.title, detail: ask.detail, confirm: ask.confirm });
        if (!ok) return;
        if (isUserBookId(id)) await wordbookApi()?.deleteBook(id);
        else await wordbookApi()?.unsubscribe(id);
        if (wbScope === id) setWordsScope(isUserBookId(id) ? 'sources' : 'mine');
        await refreshWords();
        rerenderActive();
        return;
      }
      case 'src-book': {
        // A source becomes a word book: its words in the order they were saved.
        const g = wbCtx ? sourceGroups(wbCtx).find((x) => x.key === el.dataset.source) : null;
        if (!g) return;
        const book = await wordbookApi()?.createBook(sourceBookTitle(g.label), g.entries.map((e) => e.lemma), g.key);
        await refreshWords();
        if (book?.bookId) setWordsScope(book.bookId);
        rerenderNotebook();
        document.querySelector('.main-shell')?.scrollTo({ top: 0 });
        return;
      }
      case 'src-add': {
        const g = wbCtx ? sourceGroups(wbCtx).find((x) => x.key === el.dataset.source) : null;
        if (!g || !el.dataset.book) return;
        await wordbookApi()?.addBookWords(el.dataset.book, g.entries.map((e) => e.lemma));
        await refreshWords();
        rerenderNotebook();
        return;
      }
      case 'ub-drop':
        if (!el.dataset.book || !el.dataset.q) return;
        await wordbookApi()?.removeBookWord(el.dataset.book, el.dataset.q);
        await refreshWords();
        rerenderNotebook();
        return;
      case 'wb-more':
        wbLimit += BOOK_LIST_PAGE;
        rerenderNotebook();
        return;
      case 'wb-expand': {
        const word = el.dataset.q || '';
        const key = word.toLowerCase();
        if (!key) return;
        if (wbOpen.has(key)) wbOpen.delete(key);
        else wbOpen.add(key);
        const e = wbCtx ? bookEntry(word, wbCtx) : null;
        if (wbOpen.has(key) && e && !e.definition) {
          void fetchBookMeaning(word).then(() => {
            rebuildWordsContext();
            rerenderNotebook();
          });
        }
        rerenderNotebook();
        return;
      }
      case 'wb-sort':
        wbSort = readBookSort(el.dataset.sort || '');
        writePref(WB_SORT_KEY, wbSort);
        wbLimit = BOOK_LIST_PAGE;
        rerenderNotebook();
        return;
      case 'wb-known':
      case 'wb-known-review': {
        if (el.dataset.act === 'wb-known-review' && !reviewArmed(nbReview)) return;
        const lemma = el.dataset.q || '';
        const p = await wordbookApi()?.known(lemma, el.dataset.act === 'wb-known-review' || el.dataset.known === '1', scopeBookFor(wbScope, wbCtx, lemma));
        if (p) wbProgress.set(p.lemma, p);
        answerHistory = null;
        rebuildWordsContext();
        if (el.dataset.act === 'wb-known-review' && nbReview) markKnownInReview(nbReview, lemma);
        rerenderActive();
        return;
      }
      case 'wb-save': {
        const lemma = el.dataset.q || '';
        if (!lemma) return;
        el.setAttribute('disabled', '');
        try {
          await wordbookApi()?.save(lemma, !!wbProgress.get(lemma.toLowerCase())?.definition);
        } catch (error) {
          console.error('save book word failed', error);
        }
        await loadVocabNotebook();
        return;
      }
      case 'nb-reveal':
        if (nbReview) nbReview.revealed = true;
        renderLearn();
        return;
      case 'nb-choose':
        // Taps right after a question appears (a double tap on Continue) do not answer it.
        if (reviewArmed(nbReview)) answerCurrentReview({ choice: Number(el.dataset.choice) });
        return;
      case 'nb-knew':
        if (reviewArmed(nbReview)) answerCurrentReview({ knew: el.dataset.knew === '1' });
        return;
      case 'nb-skip':
        if (reviewArmed(nbReview)) answerCurrentReview({});
        return;
      case 'nb-tile':
        // Letter tiles: placing the last one answers the question.
        if (nbReview && reviewArmed(nbReview) && placeTile(nbReview, Number(el.dataset.tile))) {
          renderLearn();
          refocusTile(root);
        }
        return;
      case 'nb-tile-out':
        if (nbReview && returnTile(nbReview, Number(el.dataset.pos))) {
          renderLearn();
          refocusTile(root);
        }
        return;
      case 'nb-hint':
        // One more letter; what is typed stays, and the letter is added when it is the start of the word.
        if (nbReview && hintReview(nbReview, root.querySelector<HTMLInputElement>('#nbv-answer')?.value ?? undefined)) renderLearn();
        return;
      case 'nb-override':
        if (nbReview) overrideReview(nbReview, el.dataset.mode === 'easy' ? 'easy' : 'flip');
        renderLearn();
        return;
      case 'nb-next':
        await commitReview();
        return;
      default:
    }
  };
  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || !root.contains(el)) return;
    void run(el, ev);
  });
  // The answer box is kept on every keystroke, so a repaint of Learn (a word that finished
  // playing, a sync, a picture) puts back what was typed.
  root.addEventListener('input', (ev) => {
    const input = ev.target as HTMLElement;
    if (input instanceof HTMLInputElement && input.id === 'nbv-answer') keepDraft(nbReview, input.value);
  });
  // A made book: rename on change of its title, add a word from its form.
  root.addEventListener('change', (ev) => {
    const input = ev.target as HTMLElement;
    if (!(input instanceof HTMLInputElement) || input.name !== 'book-title' || !input.dataset.book) return;
    void (async () => {
      await wordbookApi()?.renameBook(input.dataset.book, input.value);
      await refreshWords();
      rerenderNotebook();
    })();
  });
  root.addEventListener('submit', (ev) => {
    const form = ev.target as HTMLElement;
    if (form instanceof HTMLFormElement && form.dataset.actForm === 'ub-add') {
      ev.preventDefault();
      const word = (form.querySelector<HTMLInputElement>('input[name="word"]')?.value || '').trim();
      if (!word) return;
      void (async () => {
        await wordbookApi()?.addBookWords(form.dataset.book || '', [word]);
        await refreshWords();
        rerenderNotebook();
        document.querySelector<HTMLInputElement>('form[data-act-form="ub-add"] input')?.focus();
      })();
      return;
    }
    if (!(form instanceof HTMLFormElement) || form.dataset.actForm !== 'nb-submit') return;
    ev.preventDefault();
    const typed = (form.querySelector('#nbv-answer') as HTMLInputElement | null)?.value || '';
    answerCurrentReview({ typed });
  });
  root.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const el = ev.target as HTMLElement;
    if (el.tagName === 'BUTTON' || !el.dataset?.act) return;
    ev.preventDefault();
    void run(el, ev);
  });
}

type MainTab = 'notebook' | 'learn' | 'recent';
let mainTab: MainTab = 'notebook';

function readMainTab(value: string | undefined | null): MainTab {
  return value === 'learn' || value === 'recent' ? value : 'notebook';
}

function setMainTab(tab: MainTab): void {
  mainTab = tab;
  writePref(WS_TAB_KEY, tab);
  document.querySelectorAll<HTMLElement>('.ws-tab').forEach((b) => {
    const on = b.dataset.ws === tab;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const nb = document.getElementById('paneNotebook');
  const rc = document.getElementById('paneRecent');
  const learn = document.getElementById('paneLearn');
  if (nb) nb.hidden = tab !== 'notebook';
  if (learn) learn.hidden = tab !== 'learn';
  if (rc) rc.hidden = tab !== 'recent';
  document.querySelector('.main-shell')?.scrollTo({ top: 0 });
  if (tab === 'learn') renderLearn();
}

function wireMainWorkspace(): void {
  window.addEventListener('storage', (e) => {
    if (e.key === RECENT_SELECTIONS_STORAGE_KEY) renderRecentLookups();
    // Settings → Learn, from the Settings window. A round under way keeps going.
    if (e.key === NB_GOAL_KEY || e.key === LEARN_BOOKS_KEY) {
      nbGoal = Number(readPref(NB_GOAL_KEY, '10')) || 10;
      if (!nbReview?.started) nbReview = null;
      if (e.key === LEARN_BOOKS_KEY) void refreshWords().then(rerenderActive);
      else renderLearn();
    }
    if (e.key === LEARN_PREFS_KEY) {
      learnPrefs = readLearnPrefs(e.newValue);
      renderLearn();
    }
  });
  const onMicrophone = (on: boolean) => {
    if (on === learnMicrophone) return;
    learnMicrophone = on;
    renderLearn();
  };
  void microphoneAvailable().then(onMicrophone);
  watchMicrophone(onMicrophone);
  document.querySelectorAll<HTMLElement>('.ws-tab').forEach((b) =>
    b.addEventListener('click', () => setMainTab(readMainTab(b.dataset.ws))),
  );
  setMainTab(readMainTab(readPref(WS_TAB_KEY, 'notebook')));
  const shell = document.querySelector<HTMLElement>('.main-shell');
  if (shell) wireNotebookActions(shell);
  const search = document.getElementById('vocabSearch') as HTMLInputElement | null;
  if (search) {
    wireGlobalSearch(search, {
      notebook: () => vocabNotebookCache,
      recent: () => loadRecentLookups(),
      lookup: (q) => {
        addToRecentSelections(q);
        void openFullLookup(q);
      },
      showNotebook: () => {
        setMainTab('notebook');
        if (nbView !== 'list') {
          nbView = 'list';
          writePref(NB_VIEW_KEY, nbView);
        }
        rerenderNotebook();
      },
      openSettings: (section) => void window.electronAPI?.showSettingsWindow?.(section),
      suggestions: (q) => peekSuggestions(q),
      loadSuggestions: (q) => suggestWords(q),
    });
    search.addEventListener('focus', () => void warmSuggestions(), { once: true });
    // Ctrl+F and Ctrl+K (Cmd on a Mac) go to the search box from anywhere in the window.
    document.addEventListener(
      'keydown',
      (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
        if (e.key.toLowerCase() !== 'f' && e.key.toLowerCase() !== 'k') return;
        e.preventDefault();
        search.focus();
        search.select();
      },
      true,
    );
  }
  document.addEventListener('keydown', onReviewKey);
  // Links in Words, Learn and the account popover (sources, licences, Get Plus) open in the browser.
  document.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement | null)?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null;
    if (!link?.href || !link.closest('.main-shell, #accountMenu')) return;
    e.preventDefault();
    window.electronAPI?.openExternal?.(link.href);
  });
}

let vocabSearchTimer: ReturnType<typeof setTimeout> | null = null;
document.getElementById('vocabSearch')?.addEventListener('input', () => {
  if (vocabSearchTimer) clearTimeout(vocabSearchTimer);
  vocabSearchTimer = setTimeout(() => {
    rerenderNotebook();
    renderRecentLookups();
  }, 120);
});

document.getElementById('vocabSortRecent')?.addEventListener('click', () => {
  setVocabSortMode('recent');
  rerenderNotebook();
});

document.getElementById('vocabSortAlpha')?.addEventListener('click', () => {
  setVocabSortMode('alpha');
  rerenderNotebook();
});

/** A list from its menu (My words, a made book or a catalog book), as an export scope. */
function exportScope(scope: string): { kind: 'mine' } | { kind: 'user' | 'catalog'; id: string } {
  if (!scope || scope === 'mine' || scope === 'all' || scope === 'sources') return { kind: 'mine' };
  return isUserBookId(scope) ? { kind: 'user', id: scope } : { kind: 'catalog', id: scope };
}

async function exportWords(scope: string, anki: boolean): Promise<void> {
  const api = (window as any).vocabAPI;
  if (!api?.exportNotebook) return;
  try {
    await api.exportNotebook({ scope: exportScope(scope), anki });
  } catch (error) {
    console.error('vocab export failed', error);
  }
}

/** Import, from the word book library: a .pvbook, an Anki deck or an older My words file. */
async function importWords(): Promise<void> {
  const api = (window as any).vocabAPI;
  if (!api?.importNotebook) return;
  try {
    const result = await api.importNotebook();
    if (result?.cancelled) return;
    await loadVocabNotebook();
    await refreshWords();
    // Open what came in: the imported book, or My words.
    if (result?.bookId && result.kind !== 'mine') setWordsScope(result.bookId);
    else setWordsScope('mine');
    rerenderActive();
  } catch (error) {
    console.error('vocab import failed', error);
  }
}

setVocabSortMode(getVocabSortMode());

async function openFullLookup(text: string, lang?: string): Promise<void> {
  try {
    // Open first; lookup runs inside the dictionary window. Awaiting recall here
    // froze history/saves behind a hung IPC with no visible window progress.
    window.electronAPI?.send?.('open-full-lookup', text, lang);
  } catch (error) {
    console.error(error);
  }
}

function wireMainWindowImageIngest(): void {
  const api = window.electronAPI as {
    ocrImageFile?: (path: string) => Promise<{ success: boolean; error?: string }>;
    ocrImageData?: (data: string) => Promise<{ success: boolean; error?: string }>;
  };
  if (!api.ocrImageFile && !api.ocrImageData) return;

  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
  });
  document.addEventListener('drop', async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    e.preventDefault();
    const anyFile = file as File & { path?: string };
    if (anyFile.path && api.ocrImageFile) {
      await api.ocrImageFile(anyFile.path);
    } else if (api.ocrImageData) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await api.ocrImageData(dataUrl);
    }
  });

  document.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items || !api.ocrImageData) return;
    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/')) continue;
      const blob = item.getAsFile();
      if (!blob) return;
      e.preventDefault();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      await api.ocrImageData(dataUrl);
      return;
    }
  });
}

function initializeMainWindowControls() {
  const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
  const selectionToggle = document.getElementById('selectionToggle') as HTMLButtonElement;
  const clipboardToggle = document.getElementById('clipboardToggle') as HTMLButtonElement;
  const hoverToggle = document.getElementById('hoverToggle') as HTMLButtonElement;
  const audioToggle = document.getElementById('audioToggle') as HTMLButtonElement;
  const ocrStatusBtn = document.getElementById('ocrStatusBtn') as HTMLButtonElement;
  const selectionStatus = document.getElementById('selectionStatus') as HTMLElement;
  const clipboardStatus = document.getElementById('clipboardStatus') as HTMLElement;
  const hoverStatus = document.getElementById('hoverStatus') as HTMLElement;
  const audioStatus = document.getElementById('audioStatus') as HTMLElement;

  const minimizeBtn = document.getElementById('minimize-btn') as HTMLButtonElement;
  const maximizeBtn = document.getElementById('maximize-btn') as HTMLButtonElement;
  const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;

  let isClipboardMonitoring = false;
  const AUDIO_KEY = 'phevereAudioEnabled';

  const selectionModeLabel = (mode: string): string =>
    mode === 'off' ? t('common.off') : mode === 'on' ? t('common.on') : mode === 'shortcut' ? t('desktop.status.selectionShortcut') : mode;

  function syncSelectionMonitorUi(mode: string): void {
    if (!selectionStatus || !selectionToggle) return;
    const label = selectionModeLabel(mode);
    selectionStatus.textContent = label;
    selectionStatus.className =
      mode === 'on'
        ? 'status-value running'
        : mode === 'shortcut'
          ? 'status-value shortcut'
          : 'status-value stopped';
    selectionToggle.setAttribute('aria-pressed', mode !== 'off' ? 'true' : 'false');
    selectionToggle.setAttribute('aria-label', t('desktop.status.selectionLabel', { state: label }));
  }

  function syncClipboardUi(running: boolean): void {
    if (!clipboardStatus || !clipboardToggle) return;
    clipboardStatus.textContent = running ? t('common.on') : t('common.off');
    clipboardStatus.className = running ? 'status-value running' : 'status-value stopped';
    clipboardToggle.setAttribute('aria-pressed', running ? 'true' : 'false');
  }

  let hoverEnabled = true;
  let hoverNeedsPack = false;
  function syncHoverUi(enabled: boolean = hoverEnabled): void {
    hoverEnabled = enabled;
    if (!hoverStatus || !hoverToggle) return;
    // Without the OCR pack hover cannot read text on screen; do not show it as On.
    const label = !enabled ? t('common.off') : hoverNeedsPack ? t('desktop.status.hoverNoOcr') : t('common.on');
    hoverStatus.textContent = label;
    hoverStatus.className = !enabled ? 'status-value stopped' : hoverNeedsPack ? 'status-value needs' : 'status-value running';
    hoverToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    hoverToggle.setAttribute('aria-label', t('desktop.status.hoverLabel', { state: label }));
    if (hoverNeedsPack && enabled) hoverToggle.title = t('desktop.status.hoverNeedsPack');
    else hoverToggle.removeAttribute('title');
  }
  {
    const ocr = (window as any).ocrAPI;
    const applyPack = (s: { needsPack?: boolean } | null | undefined) => {
      hoverNeedsPack = !!s?.needsPack;
      syncHoverUi();
    };
    void ocr?.getPackState?.().then(applyPack).catch((): undefined => undefined);
    ocr?.onPackChanged?.(applyPack);
    window.addEventListener('focus', () => void ocr?.getPackState?.().then(applyPack).catch((): undefined => undefined));
  }

  function syncAudioUi(enabled: boolean): void {
    if (!audioStatus || !audioToggle) return;
    audioStatus.textContent = enabled ? t('common.on') : t('common.off');
    audioStatus.className = enabled ? 'status-value running' : 'status-value stopped';
    audioToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    audioToggle.setAttribute('aria-label', t('desktop.status.audioLabel', { state: enabled ? t('common.on') : t('common.off') }));
  }

  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', () => {
      window.electronAPI?.minimizeWindow();
    });
  }

  if (maximizeBtn) {
    maximizeBtn.addEventListener('click', () => {
      window.electronAPI?.maximizeWindow();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      window.electronAPI?.closeWindow();
    });
  }

  if (selectionToggle && window.electronAPI?.cycleMonitorMode) {
    selectionToggle.addEventListener('click', async () => {
      try {
        await window.electronAPI.cycleMonitorMode();
        const st = await window.electronAPI.getMonitorState?.();
        if (st?.mode) {
          syncSelectionMonitorUi(st.mode);
        }
      } catch (error) {
        console.error('Selection monitor cycle failed:', error);
      }
    });
  }

  if (clipboardToggle && window.clipboardAPI) {
    clipboardToggle.addEventListener('click', async () => {
      try {
        if (isClipboardMonitoring) {
          await window.clipboardAPI.stopMonitoring();
          syncClipboardUi(false);
          isClipboardMonitoring = false;
        } else {
          await window.clipboardAPI.startMonitoring();
          syncClipboardUi(true);
          isClipboardMonitoring = true;
        }
      } catch (error) {
        console.error('Clipboard monitoring toggle failed:', error);
      }
    });
  }

  if (hoverToggle && window.electronAPI?.toggleHoverEnabled) {
    hoverToggle.addEventListener('click', async () => {
      try {
        const r = await window.electronAPI.toggleHoverEnabled!();
        if (typeof r?.hoverEnabled === 'boolean') syncHoverUi(r.hoverEnabled);
      } catch (error) {
        console.error('Hover toggle failed:', error);
      }
    });
  }

  if (audioToggle) {
    audioToggle.addEventListener('click', async () => {
      const api = window.electronAPI as any;
      const cur = api?.getAudioPrefs ? await api.getAudioPrefs() : { enabled: localStorage.getItem(AUDIO_KEY) !== '0' };
      const next = cur?.enabled === false;
      if (api?.setAudioPrefs) await api.setAudioPrefs({ enabled: next });
      localStorage.setItem(AUDIO_KEY, next ? '1' : '0');
      syncAudioUi(next);
    });
  }

  if (ocrStatusBtn) ocrStatusBtn.title = t('desktop.status.scanTitle', { shortcut: 'Ctrl+Shift+O' });
  if (ocrStatusBtn && window.electronAPI?.startOcrRegion) {
    ocrStatusBtn.addEventListener('click', () => {
      void window.electronAPI.startOcrRegion!();
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      window.electronAPI.showSettingsWindow();
    });
  }

  if (window.electronAPI) {
    window.electronAPI.onShowClipboardHistory(() => {
      showClipboardHistory();
    });
    window.electronAPI.onMonitorModeChanged?.((payload: { mode: string }) => {
      syncSelectionMonitorUi(payload.mode);
    });
    window.electronAPI.onMonitorHoverChanged?.((payload: { hoverEnabled: boolean }) => {
      syncHoverUi(!!payload.hoverEnabled);
    });
  }

  syncClipboardUi(true);
  isClipboardMonitoring = true;
  syncAudioUi(localStorage.getItem(AUDIO_KEY) !== '0');
  {
    const api = window.electronAPI as any;
    void api?.getAudioPrefs?.().then((p: any) => syncAudioUi(p?.enabled !== false));
    api?.onAudioPrefsChanged?.((p: any) => syncAudioUi(p?.enabled !== false));
  }

  void (async () => {
    try {
      const st = await window.electronAPI?.getMonitorState?.();
      if (st?.mode) {
        syncSelectionMonitorUi(st.mode);
      }
      if (typeof st?.hoverEnabled === 'boolean') {
        syncHoverUi(st.hoverEnabled);
      } else {
        syncHoverUi(true);
      }
    } catch {
      syncSelectionMonitorUi('on');
      syncHoverUi(true);
    }
  })();
}

async function attachSelectionChangeListenerOnly(): Promise<void> {
  try {
    if (window.electronAPI && !__selectionListenerAttached) {
      window.electronAPI.onSelectionChange((text: string) => {
        rlog('[DBG] renderer received selection-changed:', text);
        addToRecentSelections(text);
      });
      __selectionListenerAttached = true;
    }
    rlog('Selection listener attached');
  } catch (error) {
    console.error('Failed to attach selection listener:', error);
  }
}

let __selectionListenerAttached = false;

function escapeHtmlSelection(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const RECENT_SELECTIONS_STORAGE_KEY = 'phevereRecentSelections';
const MAX_RECENT_SELECTIONS = 60;

/** Stored newest first. Entries saved before 2.4 kept only a clock time, so they have no date. */
function loadRecentLookups(): RecentLookup[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_SELECTIONS_STORAGE_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .map((e: any) => ({ q: String(e?.q ?? e?.text ?? '').trim(), at: Number(e?.at) || 0 }))
      .filter((e) => e.q)
      .slice(0, MAX_RECENT_SELECTIONS);
  } catch {
    return [];
  }
}

function saveRecentLookups(items: RecentLookup[]): void {
  writePref(RECENT_SELECTIONS_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_RECENT_SELECTIONS)));
}

function renderRecentLookups(): void {
  const list = document.getElementById('selectionsList');
  if (!list) return;
  const all = loadRecentLookups();
  const clear = document.getElementById('clearSelectionsBtn');
  if (clear) clear.hidden = !all.length;
  // The header search filters whichever tab is open, Recent included.
  const items = filterRecentLookups(all, (document.getElementById('vocabSearch') as HTMLInputElement | null)?.value || '');
  if (!items.length) {
    list.innerHTML = `<p class="empty-message">${all.length ? tHtml('desktop.recent.noMatches') : tHtml('desktop.recent.empty')}</p>`;
    return;
  }
  // A spelling saved in two languages: the row stands for the word a plain lookup opens.
  list.innerHTML = recentListHtml(items, (q) => savedForSpelling(vocabNotebookCache, q), Date.now(), { bookPick: hasOwnBooks() });
}

function addToRecentSelections(text: string): void {
  const q = String(text || '').trim();
  if (!q) return;
  const key = q.toLowerCase();
  const items = loadRecentLookups().filter((e) => e.q.toLowerCase() !== key);
  saveRecentLookups([{ q, at: Date.now() }, ...items]);
  renderRecentLookups();
}

function escapeHtmlClipboard(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatClipboardTimestamp(ts: unknown): string {
  try {
    const d = ts instanceof Date ? ts : new Date(ts as string | number);
    if (Number.isNaN(d.getTime())) return '';
    return formatDate(d, { timeStyle: 'medium' });
  } catch {
    return '';
  }
}

function renderClipboardItemsHtml(entries: { id: string; text: string; timestamp: unknown }[]): string {
  if (entries.length === 0) {
    return `<p class="empty-state">${tHtml('desktop.clipboard.empty')}</p>`;
  }
  return entries
    .map(
      (entry) => `
        <div class="clipboard-item" data-id="${escapeHtmlClipboard(entry.id)}">
          <div class="clipboard-text">${escapeHtmlClipboard(entry.text.substring(0, 200))}${entry.text.length > 200 ? '…' : ''}</div>
          <div class="clipboard-meta">
            <span class="clipboard-time">${escapeHtmlClipboard(formatClipboardTimestamp(entry.timestamp))}</span>
            <button type="button" class="copy-btn" data-copy-id="${escapeHtmlClipboard(entry.id)}">${tHtml('common.copy')}</button>
            <button type="button" class="remove-btn" data-remove-id="${escapeHtmlClipboard(entry.id)}" aria-label="${tHtml('common.remove')}" title="${tHtml('common.remove')}">×</button>
          </div>
        </div>
      `
    )
    .join('');
}

async function showClipboardHistory() {
  if (!window.clipboardAPI) {
    console.error('Clipboard API not available');
    return;
  }

  try {
    const history = await window.clipboardAPI.getHistory();
    const stats = await window.clipboardAPI.getStats();

    const textById = new Map<string, string>();
    history.forEach((e) => textById.set(e.id, e.text));

    const popup = document.createElement('div');
    popup.className = 'clipboard-popup';
    popup.innerHTML = `
      <div class="popup-header">
        <h3>${tHtml('desktop.clipboard.title', { count: Number(stats.totalEntries) || 0 })}</h3>
        <div class="popup-controls">
          <button type="button" id="clear-clipboard" class="btn btn-danger">${tHtml('desktop.clipboard.clear')}</button>
          <button type="button" class="close-btn" data-close-clipboard aria-label="${tHtml('common.close')}">×</button>
        </div>
      </div>
      <div class="popup-content">
        <div class="clipboard-search">
          <input type="text" id="clipboard-search" placeholder="${tHtml('desktop.clipboard.search')}" class="search-input">
        </div>
        <div id="clipboard-list" class="clipboard-list">${renderClipboardItemsHtml(history)}</div>
      </div>
    `;

    document.body.appendChild(popup);

    const clipboardListEl = () => document.getElementById('clipboard-list');

    const setList = (entries: typeof history) => {
      entries.forEach((e) => textById.set(e.id, e.text));
      const el = clipboardListEl();
      if (el) {
        el.innerHTML = renderClipboardItemsHtml(entries);
      }
    };

    popup.addEventListener('click', async (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest('[data-close-clipboard]')) {
        if (document.body.classList.contains('clipboard-window')) {
          window.close();
        } else {
          popup.remove();
        }
        return;
      }
      const copyId = target.closest('[data-copy-id]')?.getAttribute('data-copy-id');
      if (copyId && window.clipboardAPI) {
        const text = textById.get(copyId);
        if (text !== undefined) {
          await window.clipboardAPI.copy(text);
          const notification = document.createElement('div');
          notification.className = 'copy-notification';
          notification.textContent = t('common.copied');
          document.body.appendChild(notification);
          setTimeout(() => notification.remove(), 2000);
        }
        return;
      }
      const removeId = target.closest('[data-remove-id]')?.getAttribute('data-remove-id');
      if (removeId && window.clipboardAPI) {
        await window.clipboardAPI.removeEntry(removeId);
        textById.delete(removeId);
        const next = await window.clipboardAPI.getHistory();
        next.forEach((e) => textById.set(e.id, e.text));
        setList(next);
      }
    });

    const searchInput = document.getElementById('clipboard-search') as HTMLInputElement;
    searchInput?.addEventListener('input', async (e) => {
      const query = (e.target as HTMLInputElement).value;
      if (query.trim()) {
        const results = await window.clipboardAPI.search(query);
        setList(results);
      } else {
        const allHistory = await window.clipboardAPI.getHistory();
        setList(allHistory);
      }
    });

    document.getElementById('clear-clipboard')?.addEventListener('click', async () => {
      if (confirm(t('desktop.clipboard.clearConfirm'))) {
        await window.clipboardAPI.clear();
        popup.remove();
      }
    });

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        popup.remove();
        document.removeEventListener('keydown', onKeydown);
      }
    };
    document.addEventListener('keydown', onKeydown);
  } catch (error) {
    console.error('Error loading clipboard history:', error);
  }
}

/** Switch the Settings window to a section; an API keys jump can name the provider card to bring forward. */
function showSettingsSection(section: string, provider?: string): void {
  if (!section) return;
  if (section === 'updates') section = 'about';
  document.querySelectorAll('.settings-nav__item').forEach((b) => {
    b.classList.toggle('is-active', (b as HTMLElement).dataset.section === section);
  });
  document.querySelectorAll('.settings-panel').forEach((p) => {
    p.classList.toggle('is-active', (p as HTMLElement).dataset.panel === section);
  });
  if (section === 'api') void renderApiKeysPanel(provider);
  if (section === 'sources') void renderSourcesPanel();
  if (section === 'about') checkUpdatesOnOpen?.();
}

/** Settings links open in the browser; "API key required" and similar jump to their tab. */
function wireSettingsLibraryLinks(): void {
  const root = document.querySelector('.settings-app');
  root?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const link = target?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null;
    if (link?.href) {
      e.preventDefault();
      window.electronAPI?.openExternal?.(link.href);
      return;
    }
    const jump = target?.closest?.('[data-act="goto-section"]') as HTMLElement | null;
    if (jump) showSettingsSection(jump.dataset.section || '', jump.dataset.provider);
  });
  // Keep disclosures open across repaints.
  root?.addEventListener(
    'toggle',
    (e) => {
      const d = e.target as HTMLDetailsElement | null;
      const key = d?.dataset?.key;
      if (!key) return;
      if (d!.open) settingsOpenDetails.add(key);
      else settingsOpenDetails.delete(key);
    },
    true,
  );
}

const settingsOpenDetails = new Set<string>();
/** Shown with the translation engines only; the dictionary list leaves them out. */
const TRANSLATION_ONLY_SOURCES = new Set(['DeepL API', 'Google Translate API']);

async function renderSourcesPanel(): Promise<void> {
  const host = document.getElementById('sources-host');
  const api = window.dictionaryAPI;
  if (!host || !api) return;
  try {
    const [stats, enabled, prefs, presence] = await Promise.all([
      api.getSourceStats(),
      api.getEnabledSources(),
      api.getTranslationPrefs ? api.getTranslationPrefs() : Promise.resolve({ provider: 'auto' }),
      api.getApiKeyPresence ? api.getApiKeyPresence() : Promise.resolve({} as Record<string, boolean>),
    ]);
    const current = (prefs && prefs.provider) || 'auto';
    const dictionary: SourceRowInput[] = (stats.sources || [])
      .filter((s) => !TRANSLATION_ONLY_SOURCES.has(s.name))
      .map((s) => ({
        control: 'switch',
        name: s.name,
        label: s.name,
        info: SOURCE_INFO[s.name],
        on: enabled.includes(s.name),
        blocked: (s as { isAvailable?: boolean }).isAvailable === false,
        open: settingsOpenDetails.has(`src:switch:${s.name}`),
      }));
    const engines: SourceRowInput[] = TRANSLATION_ENGINES.map((e) => ({
      control: 'radio',
      name: e.id,
      label: e.label,
      info: e,
      on: e.id === current,
      blocked: !!e.key && !presence[e.key],
      open: settingsOpenDetails.has(`src:radio:${e.id}`),
    }));
    host.innerHTML = sourcesPanelHtml({ dictionary, engines });
  } catch (error) {
    console.error('Failed to load sources:', error);
  }
}

async function wireSourcesPanel(): Promise<void> {
  const host = document.getElementById('sources-host');
  const api = window.dictionaryAPI;
  if (!host || !api) return;
  host.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement | null;
    if (!input) return;
    // Update rows in place so open disclosures and the scroll position stay put.
    if (input.dataset.act === 'src') {
      const name = input.dataset.name || '';
      const enabled = input.checked;
      try {
        await api.setSourceEnabled(name, enabled);
        input.checked = (await api.getEnabledSources()).includes(name);
      } catch (err) {
        console.error('Toggle update failed:', err);
        input.checked = !enabled;
      }
      input.closest('.sv-src')?.classList.toggle('is-on', input.checked);
      const ledger = input.closest('.sv-ledger');
      const count = host.querySelector('.sv-head__count');
      if (ledger && count) {
        const all = ledger.querySelectorAll('input[data-act="src"]');
        const on = ledger.querySelectorAll('input[data-act="src"]:checked');
        count.textContent = t('desktop.settings.sources.countOn', { on: on.length, total: all.length });
      }
    } else if (input.dataset.act === 'engine' && input.checked) {
      await api.setTranslationPrefs?.({ provider: input.value });
      host.querySelectorAll('input[data-act="engine"]').forEach((r) => {
        (r as HTMLInputElement).closest('.sv-src')?.classList.toggle('is-on', (r as HTMLInputElement).checked);
      });
    }
  });
  await renderSourcesPanel();
}

/** Settings → API keys: per-session test results, typed values and revealed fields. */
const apiKeyResults = new Map<string, { status: KeyStatus; message?: string }>();
const apiKeyTyped = new Map<string, string>();
const apiKeyRevealed = new Set<string>();
const apiKeySaving = new Map<string, Promise<unknown>>();

async function renderApiKeysPanel(highlight?: string): Promise<void> {
  const host = document.getElementById('api-keys-host');
  const api = window.dictionaryAPI;
  if (!host || !api) return;
  const presence: Record<string, boolean> = api.getApiKeyPresence ? await api.getApiKeyPresence() : {};
  const focusId = (document.activeElement as HTMLElement | null)?.id || '';
  const states: Record<string, KeyCardState> = {};
  for (const p of API_PROVIDERS) {
    const result = apiKeyResults.get(p.id);
    const values: Record<string, string> = {};
    for (const f of p.fields) values[f.pref] = apiKeyTyped.get(f.pref) || '';
    states[p.id] = {
      status: result?.status || (presence[p.id] ? 'saved' : 'unset'),
      message: result?.message,
      values,
      revealed: apiKeyRevealed,
      savedHidden: !!presence[p.id],
      highlight: highlight === p.id,
    };
  }
  host.innerHTML = apiKeysPanelHtml(states);
  if (focusId) (document.getElementById(focusId) as HTMLElement | null)?.focus();
  if (highlight) {
    const card = host.querySelector(`.sv-key[data-provider="${CSS.escape(highlight)}"]`);
    card?.scrollIntoView({ block: 'center' });
    (card?.querySelector('input') as HTMLInputElement | null)?.focus();
  }
}

/** Refresh one card's status after a field change, leaving its fields and buttons in place. */
async function patchApiKeyStatus(provider: string): Promise<void> {
  const host = document.getElementById('api-keys-host');
  const card = host?.querySelector(`.sv-key[data-provider="${CSS.escape(provider)}"]`);
  const info = API_PROVIDERS.find((p) => p.id === provider);
  const api = window.dictionaryAPI;
  if (!card || !info || !api) return;
  const presence: Record<string, boolean> = api.getApiKeyPresence ? await api.getApiKeyPresence() : {};
  const result = apiKeyResults.get(provider);
  patchApiKeyCard(card, info, {
    status: result?.status || (presence[provider] ? 'saved' : 'unset'),
    message: result?.message,
    savedHidden: !!presence[provider],
  });
}

async function wireApiKeysPanel(): Promise<void> {
  const host = document.getElementById('api-keys-host');
  const api = window.dictionaryAPI;
  if (!host || !api?.setApiCredential) return;
  const save = (pref: string, value: string, provider: string) => {
    const v = value.trim();
    if (v) apiKeyTyped.set(pref, v);
    else apiKeyTyped.delete(pref);
    apiKeyResults.delete(provider);
    const p = api.setApiCredential!(pref, v);
    apiKeySaving.set(provider, p);
    return p;
  };
  host.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement | null;
    const pref = input?.dataset.pref;
    const provider = input?.dataset.provider;
    if (!input || !pref || !provider) return;
    // An empty field over a saved key leaves the key alone; Clear removes it.
    if (!input.value.trim() && !apiKeyTyped.has(pref)) return;
    await save(pref, input.value, provider);
    // Leaving a field fires this just before a click on Test or Show lands, so only
    // the status is patched here; replacing the buttons would swallow that click.
    await patchApiKeyStatus(provider);
  });
  host.addEventListener('click', async (e) => {
    const t = (e.target as HTMLElement | null)?.closest?.('[data-act]') as HTMLElement | null;
    const provider = t?.dataset.provider || '';
    const pref = t?.dataset.pref || '';
    switch (t?.dataset.act) {
      case 'key-reveal':
        if (apiKeyRevealed.has(pref)) apiKeyRevealed.delete(pref);
        else apiKeyRevealed.add(pref);
        await renderApiKeysPanel();
        (host.querySelector(`input[data-pref="${CSS.escape(pref)}"]`) as HTMLInputElement | null)?.focus();
        break;
      case 'key-clear':
        await save(pref, '', provider);
        await renderApiKeysPanel();
        break;
      case 'key-test': {
        // Save whatever is typed but not yet saved, then test what the service holds.
        const card = t!.closest('.sv-key');
        for (const input of Array.from(card?.querySelectorAll<HTMLInputElement>('input[data-pref]') || [])) {
          const v = input.value.trim();
          if (v && v !== apiKeyTyped.get(input.dataset.pref || '')) await save(input.dataset.pref || '', v, provider);
        }
        await apiKeySaving.get(provider);
        const presence: Record<string, boolean> = api.getApiKeyPresence ? await api.getApiKeyPresence() : {};
        if (!presence[provider]) {
          (card?.querySelector('input[data-pref]') as HTMLInputElement | null)?.focus();
          break;
        }
        apiKeyResults.set(provider, { status: 'testing' });
        await renderApiKeysPanel();
        try {
          const r = await api.verifyApiKey!(provider);
          apiKeyResults.set(provider, { status: r.ok ? 'verified' : 'failed', message: r.message });
        } catch (err: any) {
          apiKeyResults.set(provider, { status: 'failed', message: String(err?.message || err) });
        }
        await renderApiKeysPanel();
        break;
      }
      default:
        break;
    }
  });
  await renderApiKeysPanel();
}

async function wireNotificationSettings(): Promise<void> {
  const api = (window as any).electronAPI;
  if (!api?.getNotificationPrefs || !api?.setNotificationPrefs) return;
  const imageEl = document.getElementById('notify-clipboard-image') as HTMLInputElement | null;
  const hoverEl = document.getElementById('notify-hover-toggle') as HTMLInputElement | null;
  const updatesEl = document.getElementById('notify-updates') as HTMLInputElement | null;
  if (!imageEl || !hoverEl || !updatesEl) return;
  try {
    const prefs = await api.getNotificationPrefs();
    imageEl.checked = prefs.clipboardImage !== false;
    hoverEl.checked = prefs.hoverToggle !== false;
    updatesEl.checked = prefs.updates !== false;
  } catch {
    imageEl.checked = true;
    hoverEl.checked = true;
    updatesEl.checked = true;
  }
  const persist = () => {
    void api.setNotificationPrefs({
      clipboardImage: imageEl.checked,
      hoverToggle: hoverEl.checked,
      updates: updatesEl.checked,
    });
  };
  imageEl.addEventListener('change', persist);
  hoverEl.addEventListener('change', persist);
  updatesEl.addEventListener('change', persist);
}

interface UpdateView {
  current: string;
  mode: 'auto' | 'ask' | 'off';
  canInstall: boolean;
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error';
  upToDate: boolean;
  available: { version: string; page: string } | null;
  progress: number;
  error: string | null;
  rollback: string | null;
}

let checkUpdatesOnOpen: (() => void) | null = null;

/** The Updates rows on the About page: status, the install mode, Check now and Roll back. */
async function wireUpdatesPanel(): Promise<void> {
  const api = (window as any).updatesAPI;
  const status = document.getElementById('update-status');
  const action = document.getElementById('update-action') as HTMLButtonElement | null;
  const bar = document.getElementById('update-progress');
  const modes = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="update-mode"]'));
  const check = document.getElementById('update-check') as HTMLButtonElement | null;
  const rollback = document.getElementById('update-rollback') as HTMLButtonElement | null;
  if (!api?.getState || !status || !action || !bar || !modes.length || !check || !rollback) return;
  const fill = bar.firstElementChild as HTMLElement | null;
  const paint = (s: UpdateView) => {
    const busy = s.status === 'checking' || s.status === 'downloading' || s.status === 'installing';
    const next = s.available?.version;
    const v = String(next || '');
    status.classList.toggle('is-error', s.status === 'error');
    status.textContent =
      s.status === 'checking' ? t('desktop.settings.updates.checking')
      : s.status === 'downloading' ? t('desktop.settings.updates.downloading', { version: v, percent: formatPercent(s.progress) })
      : s.status === 'installing' ? t('desktop.settings.updates.installing', { version: v })
      : s.status === 'error' ? s.error || t('desktop.settings.updates.failed')
      : s.status === 'ready' ? t('desktop.settings.updates.ready', { version: v })
      : next ? t('desktop.settings.updates.available', { version: v })
      : s.upToDate ? t('desktop.settings.updates.upToDate')
      : '';
    action.hidden = !next || busy;
    action.textContent = s.status === 'ready' ? t('desktop.settings.updates.restart') : s.canInstall ? t('desktop.settings.updates.updateNow') : t('desktop.settings.updates.download');
    bar.hidden = s.status !== 'downloading';
    if (fill) fill.style.width = `${Math.round(s.progress * 100)}%`;
    const current = !s.canInstall && s.mode === 'auto' ? 'ask' : s.mode;
    for (const radio of modes) {
      if (radio.value === 'auto') (radio.parentElement as HTMLElement).hidden = !s.canInstall;
      radio.checked = radio.value === current;
    }
    rollback.hidden = !s.canInstall || !s.rollback;
    rollback.textContent = t('desktop.settings.updates.rollBack', { version: String(s.rollback || '') });
    rollback.disabled = busy;
    check.disabled = busy;
  };
  const run = async (call: () => Promise<UpdateView>) => paint(await call());
  action.addEventListener('click', () => void run(() => api.install()));
  rollback.addEventListener('click', () => void run(() => api.rollBack()));
  check.addEventListener('click', () => void run(() => api.check()));
  for (const radio of modes) {
    radio.addEventListener('change', () => {
      if (radio.checked) void run(() => api.setMode(radio.value));
    });
  }
  api.onChanged?.((s: UpdateView) => paint(s));
  paint(await api.getState());
  // The rollback version comes from the release list, so opening the page checks once.
  let checked = false;
  checkUpdatesOnOpen = () => {
    if (checked) return;
    checked = true;
    void run(() => api.check());
  };
  if (document.querySelector('.settings-panel.is-active')?.getAttribute('data-panel') === 'about') checkUpdatesOnOpen();
}

let lemmaAudio: HTMLAudioElement | null = null;

let lemmaAudioPrefs: { enabled?: boolean; speed?: number; volume?: number } = { enabled: true, speed: 1, volume: 1 };

function playLemmaSrc(src: string, recorded: boolean): Promise<void> {
  const prefs = lemmaAudioPrefs;
  const el = new Audio(src);
  el.volume = Math.max(0, Math.min(1, Number(prefs.volume ?? 1)));
  el.preservesPitch = true;
  el.playbackRate = recorded ? Math.max(0.5, Math.min(2, Number(prefs.speed) || 1)) : 1;
  lemmaAudio = el;
  // Resolves when the clip has played to its end or was stopped, so a listening question's
  // countdown starts after the word, not while it plays.
  return el.play().then(
    () =>
      new Promise<void>((resolve) => {
        if (el.ended || el.paused) return resolve();
        el.addEventListener('ended', () => resolve(), { once: true });
        el.addEventListener('pause', () => resolve(), { once: true });
        el.addEventListener('error', () => resolve(), { once: true });
      }),
  );
}

/**
 * Notebook and Learn ▶, same rule as the phone's playLemma: the recorded clip (US, UK, other)
 * from the word's lookup, usually cached, or else the voice chosen in Settings → Audio; never
 * both, and a newer press stops an older one (`singleVoice`). A press before the lookup has the
 * word's pronunciation data waits for it (`dictionary-recordings`), so an early press gets the
 * recording too. A clip is fetched before it counts as the word's recording, so one that cannot
 * be fetched leaves the synthetic voice.
 */
const sayLemma = singleVoice({
  recordings: async (lemma) => {
    const api = window.electronAPI as any;
    let urls: string[] = [];
    try {
      urls = (await window.dictionaryAPI?.recordings?.(lemma)) || [];
    } catch {
      urls = [];
    }
    for (const u of urls) {
      try {
        const got = await api?.fetchPronunciationAudio?.(u);
        const src = got && got.ok ? got.playUrl || got.dataUrl : '';
        if (src) return [src];
      } catch {
        /* next clip */
      }
    }
    return [];
  },
  playRecording: (src, alive) => (alive() ? playLemmaSrc(src, true) : Promise.resolve()),
  speak: async (lemma, alive) => {
    const api = window.electronAPI as any;
    const speech = await api?.synthesizeSpeech?.({ text: lemma, lang: 'en' });
    // A newer press (or the next question) came while the voice was being made: it stays silent.
    if (!alive()) return;
    if (speech?.ok && speech.dataUrl) await playLemmaSrc(speech.dataUrl, false);
    else showNotification(t('desktop.audio.playFailed'));
  },
  stop: () => {
    try {
      lemmaAudio?.pause();
    } catch {
      /* ignore */
    }
    lemmaAudio = null;
  },
});

function markLoadingSpeakers(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.vocab-play[data-act="nb-play"]').forEach((el) => {
    const on = !!loadingSpeakerLemma && el.dataset.lemma === loadingSpeakerLemma;
    el.classList.toggle('is-loading', on);
    if (on) el.setAttribute('aria-busy', 'true');
    else el.removeAttribute('aria-busy');
  });
}

function setSpeakerLoading(btn: HTMLElement | undefined, on: boolean): void {
  if (!btn) return;
  const lemma = btn.dataset.lemma || '';
  if (on) loadingSpeakerLemma = lemma;
  else if (loadingSpeakerLemma === lemma) loadingSpeakerLemma = '';
  btn.classList.toggle('is-loading', on);
  if (on) btn.setAttribute('aria-busy', 'true');
  else btn.removeAttribute('aria-busy');
  markLoadingSpeakers();
}

async function playLemmaPronunciation(lemma: string, btn?: HTMLElement): Promise<void> {
  try {
    const api = window.electronAPI as any;
    // The press counts from now: anything still loading or playing for an earlier one stops, even
    // while the audio settings are read.
    sayLemma.cancel();
    lemmaAudioPrefs = (await api?.getAudioPrefs?.()) || { enabled: true, speed: 1, volume: 1 };
    if (lemmaAudioPrefs.enabled === false) return;
    btn?.classList.add('is-speaking');
    try {
      // While the word's recording is still being found the button shows it is loading.
      await sayLemma(lemma, { onLoading: (on) => setSpeakerLoading(btn, on) });
    } finally {
      setSpeakerLoading(btn, false);
      setTimeout(() => btn?.classList.remove('is-speaking'), 500);
    }
  } finally {
    // A listening question's countdown starts once its word has played, failed to, or is off.
    if (markHeard(nbReview, lemma)) renderLearn();
  }
}

/** Playback speed as "1.0×" in the interface language's digits. */
function speedText(speed: number): string {
  return t('desktop.settings.audio.speedValue', { speed: formatNumber(speed, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
}

// Setup audio settings (stored in the main process; the pop-up and notebook read the same prefs)
function setupAudioSettings() {
  const api = window.electronAPI as any;
  const speed = document.getElementById('audio-speed') as HTMLInputElement | null;
  const speedValue = document.getElementById('speed-value');
  const volume = document.getElementById('audio-volume') as HTMLInputElement | null;
  const volumeValue = document.getElementById('volume-value');
  const enable = document.getElementById('enable-audio') as HTMLInputElement | null;
  const voiceSection = document.getElementById('voice-section');
  const voiceList = document.getElementById('voice-list');
  if (!api?.getAudioPrefs) return;

  const showPrefs = (p: { enabled: boolean; speed: number; volume: number }) => {
    if (enable) enable.checked = p.enabled !== false;
    if (speed) speed.value = String(p.speed ?? 1);
    if (speedValue) speedValue.textContent = speedText(Number(p.speed ?? 1));
    if (volume) volume.value = String(Math.round((p.volume ?? 1) * 100));
    if (volumeValue) volumeValue.textContent = formatPercent(Math.round((p.volume ?? 1) * 100) / 100);
  };
  void api.getAudioPrefs().then(showPrefs);
  api.onAudioPrefsChanged?.((p: any) => showPrefs(p));
  enable?.addEventListener('change', () => void api.setAudioPrefs({ enabled: enable.checked }));
  speed?.addEventListener('input', () => {
    if (speedValue) speedValue.textContent = speedText(Number(speed.value));
  });
  speed?.addEventListener('change', () => void api.setAudioPrefs({ speed: Number(speed.value) }));
  volume?.addEventListener('input', () => {
    if (volumeValue) volumeValue.textContent = formatPercent(Number(volume.value) / 100);
  });
  volume?.addEventListener('change', () => void api.setAudioPrefs({ volume: Number(volume.value) / 100 }));

  let poll: number | null = null;
  const renderVoices = (state: { voices: any[]; selected: string }) => {
    if (!voiceList || !voiceSection) return;
    // One built-in voice and nothing to download: no choice to offer.
    voiceSection.hidden = (state.voices || []).length < 2;
    voiceList.innerHTML = (state.voices || [])
      .map((v: any) => {
        const pct = Math.round((v.progress || 0) * 100);
        const id = escapeHtmlSelection(v.id);
        const detail = v.downloading
          ? t('desktop.settings.audio.voiceDownloading', { percent: formatPercent(pct / 100) })
          : v.error
            ? v.error
            : v.installed
              ? (v.id === 'mechanical' ? v.detail : t('desktop.settings.audio.voiceDownloaded'))
              : v.detail;
        return choiceRowHtml({
          name: v.name,
          meta: detail,
          badge: v.recommended ? t('desktop.settings.audio.voiceRecommended') : undefined,
          metaTone: v.downloading ? 'busy' : v.error ? 'error' : v.installed && v.id !== 'mechanical' ? 'installed' : undefined,
          on: v.id === state.selected,
          needsDownload: !v.installed,
          disabled: !!v.downloading,
          attrs: `data-voice="${id}"`,
          busy: v.downloading ? { pct, cancelAttrs: `data-cancel="${id}"` } : undefined,
        });
      })
      .join('');
    const busy = (state.voices || []).some((v: any) => v.downloading);
    if (busy && poll == null) {
      poll = window.setInterval((): void => void api.speechVoices().then(renderVoices), 600);
    } else if (!busy && poll != null) {
      window.clearInterval(poll);
      poll = null;
    }
  };
  voiceList?.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const cancel = t.closest('[data-cancel]') as HTMLElement | null;
    if (cancel) {
      void api.cancelSpeechDownload(cancel.dataset.cancel).then(renderVoices);
      return;
    }
    const row = t.closest('[data-voice]') as HTMLElement | null;
    if (row) void api.selectSpeechVoice(row.dataset.voice).then(renderVoices);
  });
  void api.speechVoices?.().then(renderVoices);
}

function showNotification(message: string) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 2000);
}



