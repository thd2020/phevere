/**
 * Minimal webpack entry for the selection popup / full-lookup window.
 *
 * Do NOT import renderer.ts or index.css here. Those belong to the main window;
 * bundling them into popup-new.html overrides popup styles (e.g. `.loading {
 * display: flex }`) and can leave a dead, infinitely-spinning, unexpandable UI.
 *
 * Behavior lives in popup-new.html (+ preload). This file only bundles the fonts the
 * phone app uses, so the pop-up renders the same offline and where Google Fonts is blocked.
 */
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource-variable/source-serif-4/opsz.css';
import '@fontsource-variable/source-serif-4/opsz-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
// Phone fonts lack IPA letters (ɪ ʌ ɒ ˈ); Charis SIL covers them.
import '@fontsource/charis-sil/latin-400.css';
import '@fontsource/charis-sil/latin-ext-400.css';

export {};
