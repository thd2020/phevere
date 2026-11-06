/**
 * The English catalogue, the source every translation follows. Each area of the app keeps its
 * strings in its own file; keys start with the file's name ("settings.language", "popup.save").
 *
 * A value is a string, or for a count an object of CLDR plural forms that English needs
 * (`one`, `other`), with `{count}` in each. `{name}` is a placeholder the code fills in.
 */
import common from './common';
import settings from './settings';
import desktop from './desktop';
import main from './main';
import popup from './popup';
import notebook from './notebook';
import lexicon from './lexicon';
import mobile from './mobile';

export const EN = {
  ...common,
  ...settings,
  ...desktop,
  ...main,
  ...popup,
  ...notebook,
  ...lexicon,
  ...mobile,
};

export type MessageKey = keyof typeof EN;
