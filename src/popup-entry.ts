/**
 * Minimal webpack entry for the selection popup / full-lookup window.
 *
 * Do NOT import renderer.ts or index.css here. Those belong to the main window;
 * bundling them into popup-new.html overrides popup styles (e.g. `.loading {
 * display: flex }`) and can leave a dead, infinitely-spinning, unexpandable UI.
 *
 * Behavior lives in popup-new.html (+ preload). This file bundles the fonts the phone app
 * uses, so the pop-up renders the same offline and where Google Fonts is blocked, the
 * shared Lexicon section builders, and the "Add to word book" menu.
 */
import './fonts';
import '@phevere/core/lexicon-parts.css';
import {
  definitionSourcesHtml,
  glossSectionLabel,
  splitByGlossLanguage,
  didYouMeanHtml,
  formLineHtml,
  inflectionsHtml,
  languageSwitchHtml,
  phrasesHtml,
  posGrammarHtml,
  senseLabelLead,
  senseNotesHtml,
  wordFamilyHtml,
  lookupNoticeText,
} from '@phevere/core/lexicon-parts';
import { linkHtml, linkText, pruneGlossLinks, wikiLinkLookup } from '@phevere/core/text-links';
import { exampleKey, tidyExample } from '@phevere/core/example-text';
import { morphemeOfferHtml, morphemeSections } from '@phevere/core/morpheme-view';
import { loadWordbook } from '@phevere/core/wordbooks';
import '@phevere/core/popover-menu.css';
import { openMenu } from '@phevere/core/popover-menu';
import { bookPickItems } from '@phevere/core/wordbook-views';
import { canAddToWordBook } from '@phevere/core/vocab-payload';
import {
  t,
  tHtml,
  formatNumber,
  formatPercent,
  formatDate,
  formatRelativeTime,
  formatList,
  languageDisplayName,
  translateDom,
  uiLocale,
} from '@phevere/core/i18n/runtime';
import { windowLanguageReady } from './ui-language';

// Interface strings for the page's own script (popup-new.html), which is not bundled. The page
// waits for `phevereI18n.ready` before it builds text; a language change reloads the pop-up.
(window as unknown as { phevereI18n: unknown }).phevereI18n = {
  ready: windowLanguageReady(),
  t,
  tHtml,
  formatNumber,
  formatPercent,
  formatDate,
  formatRelativeTime,
  formatList,
  languageDisplayName,
  translateDom,
  locale: uiLocale,
};

// The Lexicon's Forms, Word family and morpheme sections and its linked words, built by the
// same code as the phone's.
(window as unknown as { phevereLexicon: unknown }).phevereLexicon = {
  inflectionsHtml,
  wordFamilyHtml,
  formLineHtml,
  didYouMeanHtml,
  senseLabelLead,
  senseNotesHtml,
  posGrammarHtml,
  phrasesHtml,
  languageSwitchHtml,
  definitionSourcesHtml,
  splitByGlossLanguage,
  glossSectionLabel,
  lookupNoticeText,
  exampleKey,
  tidyExample,
  linkHtml,
  linkText,
  wikiLinkLookup,
  pruneGlossLinks,
  morphemeSections,
  morphemeOfferHtml,
  loadWordbook,
  openMenu,
  bookPickItems,
  canAddToWordBook,
};

export {};
