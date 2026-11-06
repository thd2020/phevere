import type { Catalog } from '../runtime';
import common from './common';
import settings from './settings';
import desktop from './desktop';
import main from './main';
import popup from './popup';
import notebook from './notebook';
import lexicon from './lexicon';
import mobile from './mobile';

const messages: Catalog = { ...common, ...settings, ...desktop, ...main, ...popup, ...notebook, ...lexicon, ...mobile };
export default messages;
