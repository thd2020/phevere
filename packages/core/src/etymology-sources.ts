export interface EtymologySource {
  source: string;
  language: string;
  label: string;
  body: string;
}

/** Youdao transports contributions from several authors and dictionaries. */
export function groupYoudaoEtymologies(etyms: unknown): EtymologySource[] {
  if (!etyms || typeof etyms !== 'object' || Array.isArray(etyms)) return [];
  const entries = etyms as Record<string, unknown>;
  const order = ['zh', 'en', ...Object.keys(entries).filter((k) => k !== 'zh' && k !== 'en')];
  const groups = new Map<string, { source: string; language: string; texts: string[]; seen: Set<string> }>();
  for (const language of order) {
    const rows = entries[language];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const item = row as Record<string, unknown>;
      const value = typeof item.value === 'string' ? item.value.trim() : '';
      if (value.length < 8) continue;
      const attribution = typeof item.source === 'string' ? item.source.trim() : '';
      const source = !attribution || /^(有道|youdao)$/i.test(attribution)
        ? 'Youdao'
        : /^wiktionary$/i.test(attribution) ? 'Wiktionary'
        : attribution.replace(/[\r\n]+/g, ' ').replace(/\[/g, '［').replace(/\]/g, '］');
      const key = `${source}\u0000${language}`;
      let group = groups.get(key);
      if (!group) {
        group = { source, language, texts: [], seen: new Set<string>() };
        groups.set(key, group);
      }
      // Compare the complete text. Different continuations of the same opening remain.
      const textKey = value.replace(/\s+/g, ' ');
      if (group.seen.has(textKey)) continue;
      group.seen.add(textKey);
      group.texts.push(value);
    }
  }
  return Array.from(groups.values(), ({ source, language, texts }) => ({
    source,
    language,
    label: `${source} · ${language === 'zh' ? '中文' : language === 'en' ? 'English' : language}`,
    body: texts.join('\n\n'),
  }));
}

export function serializeEtymologySources(sources: EtymologySource[]): string | undefined {
  return sources.length
    ? sources.map(({ label, body }) => `[${label}]\n${body}`).join('\n\n--- Alternative etymology ---\n\n')
    : undefined;
}
