/**
 * Minimal webpack entry for the selection popup / full-lookup window.
 *
 * Do NOT import renderer.ts or index.css here. Those belong to the main window;
 * bundling them into popup-new.html overrides popup styles (e.g. `.loading {
 * display: flex }`) and can leave a dead, infinitely-spinning, unexpandable UI.
 *
 * Behavior lives in popup-new.html (+ preload). This file bundles the fonts the phone app
 * uses, so the pop-up renders the same offline and where Google Fonts is blocked, and the
 * shared Lexicon section builders.
 */
import './fonts';
import '@phevere/core/lexicon-parts.css';
import { didYouMeanHtml, formLineHtml, inflectionsHtml, wordFamilyHtml } from '@phevere/core/lexicon-parts';
import { linkHtml, linkText, wikiLinkLookup } from '@phevere/core/text-links';
import { morphemeOfferHtml, morphemeSections } from '@phevere/core/morpheme-view';
import { loadWordbook } from '@phevere/core/wordbooks';

// The Lexicon's Forms, Word family and morpheme sections and its linked words, built by the
// same code as the phone's.
(window as unknown as { phevereLexicon: unknown }).phevereLexicon = {
  inflectionsHtml,
  wordFamilyHtml,
  formLineHtml,
  didYouMeanHtml,
  linkHtml,
  linkText,
  wikiLinkLookup,
  morphemeSections,
  morphemeOfferHtml,
  loadWordbook,
};

export {};
