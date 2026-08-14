/**
 * Consent-download catalog for Settings → Offline.
 *
 * Living Oxford / Merriam-Webster Collegiate / Collins cannot be redistributed
 * as dumps (publisher copyright). Phevere already has Oxford Dictionaries API
 * for keyed online lookup; licensed JSON dumps can still be imported by file.
 */

export type OfflineDirection = 'en→en' | 'zh→en' | 'en→zh';

export interface OfflineCatalogItem {
  id: string;
  name: string;
  direction: OfflineDirection;
  /** Headword language stored on rows (lookup filter). */
  language: string;
  license: string;
  summary: string;
  sizeHint: string;
  consent: string;
}

export const OFFLINE_CATALOG: OfflineCatalogItem[] = [
  {
    id: 'wordnet-3.1',
    name: 'Princeton WordNet 3.1',
    direction: 'en→en',
    language: 'en',
    license: 'WordNet License (Princeton University)',
    summary: 'Academic English glosses and synonym sets — the standard computational lexicon.',
    sizeHint: '~16 MB download',
    consent:
      'Download Princeton WordNet 3.1 from wordnetcode.princeton.edu?\n\n' +
      'WordNet License (free use with attribution). This product includes WordNet® data developed by Princeton University. Import may take a minute.',
  },
  {
    id: 'webster-1913',
    name: "Webster's Unabridged 1913 (GCIDE)",
    direction: 'en→en',
    language: 'en',
    license: 'GPL-3+ (GNU GCIDE; 1913 Webster text is public domain)',
    summary: "Paper Webster's Revised Unabridged Dictionary (1913), as published by the GNU Collaborative International Dictionary of English.",
    sizeHint: '~18 MB download',
    consent:
      "Download GNU GCIDE (Webster's Revised Unabridged Dictionary, 1913) from ftp.gnu.org?\n\n" +
      'GNU GPL v3 or later. Definitions are a century old. File is large; import may take a few minutes.',
  },
  {
    id: 'cc-cedict',
    name: 'CC-CEDICT',
    direction: 'zh→en',
    language: 'zh',
    license: 'CC BY-SA 4.0',
    summary: 'Community Chinese–English dictionary (simplified and traditional headwords).',
    sizeHint: 'large; import may take a minute',
    consent:
      'Download free CC-CEDICT from mdbg.net?\n\nCreative Commons Attribution-ShareAlike 4.0. File is large; import may take a minute.',
  },
  {
    id: 'freedict-eng-zho',
    name: 'FreeDict English–Chinese',
    direction: 'en→zh',
    language: 'en',
    license: 'GPL (FreeDict)',
    summary: 'Bilingual English headwords with Chinese glosses from the FreeDict project.',
    sizeHint: '~2 MB download',
    consent:
      'Download FreeDict English–Chinese from download.freedict.org?\n\nGNU GPL. About 26k headwords. Import is usually quick.',
  },
];

export function getCatalogItem(id: string): OfflineCatalogItem | undefined {
  return OFFLINE_CATALOG.find((p) => p.id === id);
}
