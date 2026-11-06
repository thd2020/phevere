/**
 * Entry for the OCR region picker. The drag logic lives inline in ocr-overlay.html; this file
 * loads the interface language and translates the page's hint. A language change while a capture
 * is open translates the hint in place, since a reload would lose the capture.
 */
import { windowLanguageReady } from './ui-language';

void windowLanguageReady(() => {
  /* windowLanguageReady has already translated the page's data-i18n text. */
});

export {};
