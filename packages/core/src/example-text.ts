/**
 * Example sentences compared and shown the same way everywhere (the core's merge, the phone and
 * the desktop pop-up), with no other imports so the pop-up bundle stays small.
 */

/**
 * The same sentence from two sources compares equal: tags, entities, quotes, dashes, case,
 * spacing (including a space before punctuation) and the closing punctuation are ignored, so
 * "Four employees were made redundant." and "Four employees were made redundant ." are one.
 */
export function exampleKey(s: string): string {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/["'\u201C\u201D\u2018\u2019\u201E\u00AB\u00BB\u2039\u203A`]/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+([.,;:!?)\]}%])/g, '$1')
    .replace(/([(\[{])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.,;:!?\u2026]+$/, '')
    .toLowerCase();
}

/** An example as shown: runs of spaces collapsed and no space before . , ; : ! ? or a closing bracket. */
export function tidyExample(s: string): string {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/(\S)\s+(?=[.,;:!?)\]}](?:\s|$|<))/g, '$1')
    .trim();
}
