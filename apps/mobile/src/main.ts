// Bundled like the desktop (src/fonts.ts), so the app renders the same offline and where
// Google Fonts is blocked.
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource-variable/source-serif-4/opsz.css';
import '@fontsource-variable/source-serif-4/opsz-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
// Phone fonts lack IPA letters; Charis SIL covers them.
import '@fontsource/charis-sil/latin-400.css';
import '@fontsource/charis-sil/latin-ext-400.css';
import '@phevere/core/notebook-views.css';
import '@phevere/core/notebook-families.css';
import '@phevere/core/notebook-cards.css';
import '@phevere/core/notebook-map.css';
import '@phevere/core/wordbook-views.css';
import '@phevere/core/popover-menu.css';
import '@phevere/core/learn-views.css';
import '@phevere/core/lexicon-parts.css';
import '@phevere/core/settings-kit.css';
import '@phevere/core/settings-sources.css';
import '@phevere/core/settings-offline.css';
import '@phevere/core/settings-keys.css';
import '@phevere/core/ocr-view.css';
import '@phevere/core/settings-about.css';
import './styles.css';
import { startApp } from './app';

void startApp();
