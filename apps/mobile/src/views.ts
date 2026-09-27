import {
  abbreviatePos,
  canonicalPos,
  formatPronunciationLine,
  formatVocabLangPair,
  saveLemma,
  stripGlossText,
  type Definition,
  type DictionaryResult,
  type Pronunciation,
  type VocabEntry,
  type WikipediaResult,
} from '@phevere/core';

export type Tab = 'lookup' | 'notebook' | 'settings';
export type ResultTab = 'lexicon' | 'translation' | 'wikipedia' | 'etymology';

const FAMILY_LABELS: Record<string, string> = {
  forms: 'Forms',
  lemma: 'Lemma',
  derived: 'Derived',
  phrases: 'Phrases',
  related: 'Related',
  alternatives: 'Alternative forms',
  affixes: 'Affixes',
  roots: 'Roots',
  seeAlso: 'See also',
};

export function esc(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ICO = {
  back: '<svg viewBox="0 0 24 24"><path d="M15.5 19.5 8 12l7.5-7.5 1.5 1.5L11 12l6 6z"/></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M8.5 4.5 16 12l-7.5 7.5-1.5-1.5 6-6-6-6z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M12 17.5A3.5 3.5 0 1 0 8.5 14 3.5 3.5 0 0 0 12 17.5zM9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.7-4.3-9.3-8.1C.7 10.2 1.2 6.6 4 5.1 6.1 4 8.6 4.6 12 7.4 15.4 4.6 17.9 4 20 5.1c2.8 1.5 3.3 5.1 1.3 7.8C18.7 16.7 12 21 12 21z"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M3 10v4h3l4 4V6L6 10zm13.5 2A4.5 4.5 0 0 0 14 8.1v7.8A4.5 4.5 0 0 0 16.5 12z"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M6 4h11a3 3 0 0 1 3 3v13H8a2 2 0 0 0-2 2V4zm2 2v12h10V7a1 1 0 0 0-1-1H8z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.7 7.7 0 0 0 .1-2l2-1.5-2-3.5-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3h-6l-.4 3a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.7 7.7 0 0 0 .1 2l-2 1.5 2 3.5 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 3h6l.4-3a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.5zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z"/></svg>',
};

export function navHtml(tab: Tab): string {
  const item = (id: Tab, label: string, svg: string) => `
    <button type="button" data-act="tab" data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>
      <span class="ico">${svg}</span>${label}
    </button>`;
  return `<nav class="nav" aria-label="Primary">${item('lookup', 'Lookup', ICO.search)}${item('notebook', 'Notebook', ICO.book)}${item('settings', 'Settings', ICO.gear)}</nav>`;
}

export function searchHtml(query: string, canBack: boolean, canFwd: boolean, strip: boolean): string {
  const tools = strip
    ? `<div class="hist">
        <button type="button" class="linkish" data-act="expand-strip">Open app</button>
        <button type="button" class="icon-btn" data-act="close-strip" aria-label="Close">${ICO.close}</button>
      </div>`
    : `<div class="hist">
        <button type="button" class="icon-btn" data-act="back" ${canBack ? '' : 'disabled'} aria-label="Previous lookup">${ICO.back}</button>
        <button type="button" class="icon-btn" data-act="fwd" ${canFwd ? '' : 'disabled'} aria-label="Next lookup">${ICO.fwd}</button>
      </div>`;
  return `
    <div class="top">
      <div class="brand-row">
        <h1>Phevere</h1>
        ${tools}
      </div>
      <form class="search">
        <input id="q" type="search" enterkeyhint="search" placeholder="Look up a word or phrase" value="${esc(query)}" autocomplete="off" />
        ${strip ? '' : `<button type="button" class="icon-btn" data-act="ocr" aria-label="Scan text">${ICO.cam}</button>`}
        <button type="submit" class="go">Look up</button>
      </form>
    </div>`;
}

function ipaChips(list?: Pronunciation[]): string {
  const chips = (list || []).filter((p) => p.ipa);
  if (!chips.length) return '';
  return `<div class="ipa-chips">${chips
    .map(
      (p, i) => `<span class="ipa-chip">${p.accent ? `${esc(p.accent.toUpperCase())} ` : ''}/${esc(p.ipa)}/<button type="button" data-act="speak-ipa" data-i="${list!.indexOf(p)}" aria-label="Speak IPA">${ICO.speaker}</button></span>`,
    )
    .join('')}</div>`;
}

function exampleKey(s: string): string {
  return stripGlossText(s)
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function uniqueExamples(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ex of list || []) {
    const k = exampleKey(ex);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(ex);
  }
  return out;
}

function sourceName(src: string): string {
  const s = (src || '').trim();
  const key = s.toLowerCase();
  if (!s || key === 'freedictionaryapi' || key === 'free dictionary api') return 'Free Dictionary';
  if (key === 'wiktionary') return 'Wiktionary';
  if (key === 'datamuse') return 'Datamuse';
  if (key.includes('oxford')) return 'Oxford';
  if (key.includes('wordnet')) return 'WordNet';
  if (key.includes('webster') || key.includes('gcide')) return 'Webster 1913';
  if (key.includes('cedict')) return 'CC-CEDICT';
  if (key.includes('freedict')) return 'FreeDict';
  if (key.includes('wordsapi') || key === 'wordsapi') return 'WordsAPI';
  if (key.includes('collins')) return 'Collins';
  if (key.includes('youdao')) return 'Youdao';
  if (key.includes('tatoeba')) return 'Tatoeba';
  return s;
}

function usableDef(d: Definition): boolean {
  if (!d || d.source === 'Fallback' || d.source === 'Timeout') return false;
  const m = stripGlossText(d.meaning || '');
  if (!m || m === 'No definition available.') return false;
  if (/lookup timed out/i.test(m)) return false;
  return true;
}

function railTab(id: string, label: string, active: string): string {
  const on = id === active;
  return `<button type="button" class="lexicon-pos-tab${on ? ' is-active' : ''}" role="tab" data-act="lex-pos" data-pos="${esc(id)}" aria-selected="${on}">${esc(label)}</button>`;
}

function railBlock(sections: Array<{ id: string; label: string }>, active: string): string {
  if (!sections.length) return '';
  return `<div class="lexicon-rail-block">${sections.map((s) => railTab(s.id, s.label, active)).join('')}</div>`;
}

function wrapGroup(id: string, label: string, inner: string): string {
  return `<div class="lexicon-pos-group" data-pos="${esc(id)}"><div class="lexicon-pos-heading">${esc(label)}</div>${inner}</div>`;
}

function wrapPane(inner: string, extra = ''): string {
  return `<div class="card lexicon-pane${extra ? ` ${extra}` : ''}">${inner}</div>`;
}

function renderSenses(senses: Definition[], shown: Set<string>): string {
  const sorted = senses.slice().sort((a, b) => stripGlossText(b.meaning || '').length - stripGlossText(a.meaning || '').length);
  return sorted
    .map((d, i) => {
      const examples = uniqueExamples(d.examples || []);
      examples.forEach((ex) => shown.add(exampleKey(ex)));
      const cite =
        Array.isArray(d.sources) && d.sources.length
          ? d.sources
          : String(d.source || '')
              .split(/\s*·\s*/)
              .filter(Boolean);
      const badges = (cite.length ? cite : ['Unknown'])
        .map((s) => `<span class="definition-source-badge">${esc(sourceName(s))}</span>`)
        .join('');
      const exHtml = examples.length
        ? `<div class="definition-examples">${examples
            .map((ex) => `<div class="definition-example">${esc(stripGlossText(ex))}</div>`)
            .join('')}</div>`
        : '';
      return `<div class="definition-item">
        <div class="definition-sense-row">
          <div class="definition-sense-num">${i + 1}.</div>
          <div class="definition-sense-body">
            <div class="definition-text">${esc(stripGlossText(d.meaning))}</div>
            ${exHtml}
            <div class="definition-source-badges">${badges}</div>
          </div>
        </div>
      </div>`;
    })
    .join('');
}

function lexiconPane(result: DictionaryResult, activePos: string): string {
  const defs = (result.definitions || []).filter(usableDef);
  if (!defs.length) return `<div class="card empty">No definitions yet.</div>`;

  const groups = new Map<string, Definition[]>();
  const order: string[] = [];
  for (const d of defs) {
    const pos = canonicalPos(d.partOfSpeech);
    if (!groups.has(pos)) {
      groups.set(pos, []);
      order.push(pos);
    }
    groups.get(pos)!.push(d);
  }

  const shown = new Set<string>();
  let posInner = '';
  const posSections = order.map((pos) => {
    posInner += wrapGroup(pos, pos, renderSenses(groups.get(pos) || [], shown));
    return { id: pos, label: abbreviatePos(pos) };
  });
  let allInner = wrapPane(posInner, 'lexicon-pane--pos');

  const globalExamples = uniqueExamples(result.examples || [])
    .filter((ex) => !shown.has(exampleKey(ex)))
    .slice(0, 8);
  const syn = result.synonyms || [];
  const ant = result.antonyms || [];
  const family = result.wordFamily || [];

  const exampleSections: Array<{ id: string; label: string }> = [];
  if (globalExamples.length) {
    exampleSections.push({ id: 'examples', label: 'examples' });
    allInner += wrapPane(
      wrapGroup(
        'examples',
        'examples',
        globalExamples.map((ex) => `<div class="example-item">${esc(stripGlossText(ex))}</div>`).join(''),
      ),
    );
  }

  const relatedSections: Array<{ id: string; label: string }> = [];
  let relatedInner = '';
  if (syn.length) {
    relatedSections.push({ id: 'synonyms', label: 'synonyms' });
    relatedInner += wrapGroup('synonyms', 'synonyms', `<div class="example-item">${esc(syn.join(', '))}</div>`);
  }
  if (ant.length) {
    relatedSections.push({ id: 'antonyms', label: 'antonyms' });
    relatedInner += wrapGroup('antonyms', 'antonyms', `<div class="example-item">${esc(ant.join(', '))}</div>`);
  }
  if (relatedInner) allInner += wrapPane(relatedInner);

  const familySections: Array<{ id: string; label: string }> = [];
  let familyInner = '';
  for (const g of family) {
    const rel = String(g.relation || 'related');
    const id = `fam:${rel}`;
    const label = FAMILY_LABELS[rel] || rel;
    const items = g.items || [];
    const chips = items
      .map((it) => {
        const word = String(it.word || '').trim();
        if (!word) return '';
        const banner = String(it.label || '').trim();
        const tag = banner && banner.toLowerCase() !== word.toLowerCase()
          ? `<span class="word-family-banner">${esc(banner)}</span>`
          : '';
        return `<span class="word-family-item"><button type="button" class="word-family-chip" data-act="lookup" data-q="${esc(word)}">${esc(word)}</button>${tag}</span>`;
      })
      .join('');
    if (!chips) continue;
    familySections.push({ id, label: label.toLowerCase() });
    familyInner += `<div class="word-family-row" data-pos="${esc(id)}"><span class="word-family-label">${esc(label)}</span><div class="word-family-chips">${chips}</div></div>`;
  }
  if (familyInner) {
    allInner += wrapPane(`<div class="lexicon-pos-heading">word family</div>${familyInner}`);
  }

  const tocIds = [
    ...posSections.map((s) => s.id),
    ...exampleSections.map((s) => s.id),
    ...relatedSections.map((s) => s.id),
    ...familySections.map((s) => s.id),
  ];
  const active = activePos && tocIds.includes(activePos) ? activePos : tocIds[0] || '';
  const tabs = [
    railBlock(posSections, active),
    railBlock(exampleSections, active),
    railBlock(relatedSections, active),
    railBlock(familySections, active),
  ].join('');

  return `<div class="lexicon-block--senses">
    <div class="lexicon-pos-layout">
      <nav class="lexicon-pos-tabs" role="tablist" aria-label="Lexicon sections">
        <div class="lexicon-rail-inner">${tabs}</div>
      </nav>
      <div class="lexicon-pos-panel">${allInner}</div>
    </div>
  </div>`;
}

function translationPane(
  result: DictionaryResult,
  langs: { code: string; name: string; nativeName: string }[],
  sourceLang: string,
  targetLang: string,
): string {
  const opts = (includeAuto: boolean, selected: string) =>
    langs
      .filter((l) => includeAuto || l.code !== 'auto')
      .map((l) => `<option value="${esc(l.code)}" ${l.code === selected ? 'selected' : ''}>${esc(l.nativeName)} (${esc(l.name)})</option>`)
      .join('');
  const rows = (result.translations || [])
    .map(
      (t) => `<div class="t-row">
        <span class="t-lang">${esc(t.language)}</span>
        <span class="t-text">${esc(t.text)}</span>
        <button type="button" class="icon-btn" data-act="speak-text" data-text="${esc(t.text)}" data-lang="${esc(t.language)}" aria-label="Speak translation">${ICO.speaker}</button>
      </div>`,
    )
    .join('');
  return `
    <div class="pair">
      <div><label for="from">From</label><select id="from" data-act="from">${opts(true, sourceLang)}</select></div>
      <button type="button" class="swap" data-act="swap" aria-label="Swap languages">⇄</button>
      <div><label for="to">To</label><select id="to" data-act="to">${opts(false, targetLang)}</select></div>
    </div>
    <section class="card">
      <h2>Translation</h2>
      ${rows || '<p class="empty">No translation yet.</p>'}
    </section>`;
}

export type WikiArticle = { title: string; url: string; html: string; lang: string };

function wikiPane(
  items: WikipediaResult[],
  wikiLang: string,
  article: WikiArticle | null,
  loading: boolean,
  error: string,
): string {
  if (article) {
    return `<section class="wikipedia-card wikipedia-reader">
      <div class="wikipedia-reader__bar">
        <button type="button" class="wikipedia-reader__back" data-act="wiki-back">← Back</button>
        <div class="wikipedia-reader__title">${esc(article.title)}</div>
        <button type="button" class="wikipedia-reader__ext" data-act="wiki-ext" data-url="${esc(article.url)}">Open in browser</button>
      </div>
      ${loading ? `<p class="status"><span class="md-spinner"></span> Loading article…</p>` : ''}
      ${error ? `<p class="status">${esc(error)}</p>` : ''}
      <iframe id="wiki-frame" class="wikipedia-reader__frame" title="${esc(article.title)}" referrerpolicy="no-referrer" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>
    </section>`;
  }
  const list = items
    .map(
      (it, i) => `<button type="button" class="wikipedia-item" data-act="wiki-open" data-i="${i}">
        <div class="wikipedia-item__title">
          ${it.thumbnail ? `<img src="${esc(it.thumbnail)}" alt="" loading="lazy" />` : ''}
          <span class="wikipedia-item__name">${esc(it.title)}</span>
        </div>
        <div class="wikipedia-item__extract">${esc(it.extract || '')}</div>
      </button>`,
    )
    .join('');
  return `<section class="wikipedia-card">
    <div class="wikipedia-card__header">
      <span>Wikipedia</span>
      <span class="wikipedia-card__lang">${esc(wikiLang)}</span>
    </div>
    <div class="wikipedia-card__body">
      ${loading ? `<p class="status"><span class="md-spinner"></span> Searching Wikipedia…</p>` : ''}
      ${list || '<p class="empty">No Wikipedia articles found.</p>'}
    </div>
  </section>`;
}

function splitEtymologySources(etymologyText: string): Array<{ label: string; body: string }> {
  if (!etymologyText) return [];
  return etymologyText
    .split(/\n\n--- Alternative etymology ---\n\n/)
    .map((chunk, i) => {
      let body = chunk.trim();
      const labelMatch = body.match(/^\[([^\]]+)\]\s*\n([\s\S]*)$/);
      let label = i === 0 ? 'Primary' : `Alt ${i + 1}`;
      if (labelMatch) {
        label = labelMatch[1].trim() || label;
        body = labelMatch[2].trim();
      }
      return { label, body: stripGlossText(body) };
    })
    .filter((s) => {
      if (!s.body) return false;
      if (/go-to source|internet'?s go-to|quick and reliable accounts of the origin/i.test(s.body)) return false;
      return true;
    });
}

function formatEtymologyBody(body: string): string {
  const plain = stripGlossText(body || '');
  const sentences = plain.split(/(?<=[.!?。！？])\s+/).filter((s) => s.trim().length > 2);
  const paint = (sentence: string): string =>
    esc(sentence)
      .replace(
        /\b(From|Derived from|Borrowed from|Inherited from|Root|Origin|Etymology|Cognate with|Doublet of|来自|引申|词源)\b/gi,
        '<span class="etymology-keyword">$1</span>',
      )
      .replace(
        /\b(Latin|Greek|French|German|Old English|Middle English|Anglo-Saxon|Proto-Germanic|Proto-Indo-European|Ancient Greek|Sanskrit|Gothic|Old Norse|Old French|Proto-Italic|Proto-Hellenic|Proto-Celtic)\b/gi,
        '<span class="etymology-language">$1</span>',
      )
      .replace(/\*[\w\u0300-\u036f\-]+/g, '<span class="etymology-reconstructed">$&</span>')
      .replace(/(\d+)(st|nd|rd|th)\s+century/gi, '<span class="etymology-century">$&</span>')
      .replace(/\b(BCE?|CE|AD|BC)\b/g, '<span class="etymology-era">$1</span>');
  const inner = (sentences.length ? sentences : [plain])
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `<div class="etymology-sentence">${paint(s)}</div>`)
    .join('');
  return `<div class="etymology-text">${inner}</div>`;
}

function formatEtymologyChain(result: DictionaryResult): string {
  const chain = result.etymologyChain || [];
  if (!chain.length) return '';
  const parts = chain.slice(0, 8).map((link) => {
    const lang = esc(link.language || '');
    const term = esc(link.term || '');
    const rel = esc(link.relation || '');
    return `<span class="etymology-chain__rel">${rel}</span><span class="etymology-chain__node">${lang}${term ? ` · ${term}` : ''}</span>`;
  });
  return `<div class="etymology-chain">${parts.join('<span aria-hidden="true">←</span>')}</div>`;
}

function etymPane(result: DictionaryResult): string {
  const sources = splitEtymologySources(result.etymology || '');
  const pending = !!(result.metadata && result.metadata.pendingEtymology);
  if (pending) {
    return `<p class="status"><span class="md-spinner"></span> Fetching etymology…</p>`;
  }
  if (!sources.length) return `<p class="empty">No etymology found.</p>`;
  const tabs = sources
    .map(
      (s, i) =>
        `<button type="button" class="etymology-tab${i === 0 ? ' is-active' : ''}" data-act="ety-tab" data-i="${i}">${esc(s.label)}</button>`,
    )
    .join('');
  const panels = sources
    .map(
      (s, i) =>
        `<div class="etymology-panel-body" data-ety-panel="${i}" ${i === 0 ? '' : 'hidden'}>${formatEtymologyBody(s.body)}</div>`,
    )
    .join('');
  return `<section class="card etymology-card">
    ${formatEtymologyChain(result)}
    <div class="etymology-layout">
      <nav class="etymology-tabs" aria-label="Etymology sources">${tabs}</nav>
      <div class="etymology-panel">${panels}</div>
    </div>
  </section>`;
}

export function lookupBody(opts: {
  looking: boolean;
  status: string;
  result: DictionaryResult | null;
  saved: VocabEntry | null;
  resultTab: ResultTab;
  langs: { code: string; name: string; nativeName: string }[];
  sourceLang: string;
  targetLang: string;
  wiki: WikipediaResult[];
  wikiLang: string;
  wikiArticle: WikiArticle | null;
  wikiLoading: boolean;
  wikiError: string;
  lexiconPos: string;
}): string {
  if (opts.looking && !opts.result) {
    return `<p class="status"><span class="md-spinner"></span> Looking up…</p>`;
  }
  if (opts.status && !opts.result) return `<p class="status">${esc(opts.status)}</p>`;
  if (!opts.result) {
    return `<div class="empty">
      <p>Type a word, or select text in another app.</p>
    </div>`;
  }
  const chips = ipaChips(opts.result.pronunciations);
  const ipa = formatPronunciationLine(opts.result.pronunciations) || opts.result.pronunciation || '';
  const lemma = saveLemma(opts.result);
  const tabs: ResultTab[] = ['lexicon', 'translation', 'wikipedia', 'etymology'];
  const labels: Record<ResultTab, string> = {
    lexicon: 'Lexicon',
    translation: 'Translation',
    wikipedia: 'Wikipedia',
    etymology: 'Etymology',
  };
  const pane =
    opts.resultTab === 'translation'
      ? translationPane(opts.result, opts.langs, opts.sourceLang, opts.targetLang)
      : opts.resultTab === 'wikipedia'
        ? wikiPane(opts.wiki, opts.wikiLang, opts.wikiArticle, opts.wikiLoading, opts.wikiError)
        : opts.resultTab === 'etymology'
          ? etymPane(opts.result)
          : lexiconPane(opts.result, opts.lexiconPos);
  return `
    <div class="lookup-flow">
    <header class="head">
      <div class="word">
        <h2 class="lemma">${esc(opts.result.word || lemma)}</h2>
        ${chips || (ipa ? `<p class="ipa-line">${esc(ipa)}</p>` : '')}
      </div>
      <div class="head-actions">
        <button type="button" class="tonal" data-act="speak" aria-label="Play recorded pronunciation">${ICO.speaker}</button>
        <button type="button" class="tonal ${opts.saved ? 'saved' : ''}" data-act="save" aria-label="${opts.saved ? 'Saved' : 'Save to notebook'}">${ICO.heart}</button>
      </div>
    </header>
    <div class="chips" role="tablist">
      ${tabs.map((t) => `<button type="button" class="chip" role="tab" data-act="result-tab" data-tab="${t}" aria-selected="${opts.resultTab === t}">${labels[t]}</button>`).join('')}
    </div>
    ${opts.looking ? `<p class="status"><span class="md-spinner"></span> Updating…</p>` : ''}
    ${pane}
    </div>`;
}

export function notebookBody(
  entries: VocabEntry[],
  sort: 'recent' | 'az',
  filter: string,
  expanded: Set<string>,
): string {
  const q = filter.trim().toLowerCase();
  let list = [...entries];
  if (sort === 'az') list.sort((a, b) => a.lemma.localeCompare(b.lemma, undefined, { sensitivity: 'base' }));
  else list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  if (q) {
    list = list.filter((e) =>
      [e.lemma, e.reading, e.definition, e.partOfSpeech, e.note, ...(e.sources || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }
  const rows = list
    .map((e) => {
      const defRaw = stripGlossText(e.definition || '');
      const long = defRaw.length > 280 || defRaw.split(/\n/).length > 4;
      const defHtml = esc(defRaw).replace(/\n/g, '<br>');
      const badges = (e.sources || [])
        .slice(0, 4)
        .map((s) => `<span class="vocab-badge">${esc(s)}</span>`)
        .join('');
      const langLabel = formatVocabLangPair(e);
      const saved =
        e.updatedAt || e.createdAt ? new Date(Number(e.updatedAt || e.createdAt)).toLocaleString() : '';
      const ipa = String(e.reading || '').trim();
      const ipaHtml = ipa
        ? `<span class="vocab-reading">${ipa.includes('/') ? esc(ipa) : `/${esc(ipa)}/`}</span>`
        : '<span class="vocab-reading vocab-reading--empty">IPA pending</span>';
      const open = expanded.has(e.id);
      return `<article class="vocab-item ${open ? 'is-expanded' : 'is-collapsed'}" data-id="${esc(e.id)}">
        <div class="vocab-entry">
          <div class="vocab-entry__toggle" data-act="nb-toggle" data-id="${esc(e.id)}" role="button" tabindex="0" aria-expanded="${open}">
            <header class="vocab-entry__head">
              <h3 class="vocab-lemma">${esc(e.lemma)}</h3>
              ${ipaHtml}
              <button type="button" class="vocab-play" data-act="nb-play" data-lemma="${esc(e.lemma)}" aria-label="Play pronunciation">▶</button>
              <span class="vocab-expand-hint" aria-hidden="true"></span>
            </header>
            <div class="vocab-entry__meta">
              ${e.partOfSpeech ? `<span class="vocab-pos">${esc(e.partOfSpeech)}</span>` : ''}
              ${langLabel ? `<span class="vocab-langs">${esc(langLabel)}</span>` : ''}
              ${saved ? `<time class="vocab-saved">${esc(saved)}</time>` : ''}
            </div>
          </div>
          <div class="vocab-entry__details">
            ${defHtml ? `<div class="vocab-def${long ? ' is-clamped' : ''}">${defHtml}</div>${long ? `<button type="button" class="vocab-more" data-act="nb-more">Show more</button>` : ''}` : '<p class="vocab-note">No definition saved.</p>'}
            ${badges ? `<div class="vocab-badges">${badges}</div>` : ''}
            ${e.note ? `<p class="vocab-note">${esc(e.note)}</p>` : ''}
          </div>
        </div>
        <div class="vocab-actions">
          <button type="button" class="outlined" data-act="lookup" data-q="${esc(e.lemma)}">Open</button>
          <button type="button" class="outlined" data-act="nb-del" data-id="${esc(e.id)}">Remove</button>
        </div>
      </article>`;
    })
    .join('');
  return `
    <div class="nb-head">
      <input id="nbq" type="search" class="vocab-search" placeholder="Search notebook…" value="${esc(filter)}" autocomplete="off" aria-label="Search notebook" />
      <div class="vocab-sort" role="group" aria-label="Notebook sort">
        <button type="button" class="vocab-sort-btn${sort === 'recent' ? ' is-active' : ''}" data-act="nb-sort" data-sort="recent" aria-pressed="${sort === 'recent'}">Recent</button>
        <button type="button" class="vocab-sort-btn${sort === 'az' ? ' is-active' : ''}" data-act="nb-sort" data-sort="az" aria-pressed="${sort === 'az'}">A–Z</button>
      </div>
      <button type="button" class="outlined" data-act="nb-export" data-fmt="json">Export</button>
      <button type="button" class="outlined" data-act="nb-import">Import</button>
      <button type="button" class="outlined" data-act="nb-refresh">Refresh</button>
    </div>
    <div class="vocab-list">${rows || `<p class="empty">${q ? 'No notebook matches.' : 'No saved words yet.'}</p>`}</div>`;
}

export type ScanWord = { t: string; x: number; y: number; w: number; h: number };
export type ScanPage = { jpeg: string; width: number; height: number; words: ScanWord[] };

export function scanHtml(scan: ScanPage): string {
  const words = (scan.words || [])
    .filter((w) => w.t && w.w > 0 && w.h > 0)
    .map(
      (w) =>
        `<span class="scan-word" data-act="scan-word" data-q="${esc(w.t)}" style="left:${(w.x * 100).toFixed(2)}%;top:${(w.y * 100).toFixed(2)}%;width:${(w.w * 100).toFixed(2)}%;height:${(w.h * 100).toFixed(2)}%">${esc(w.t)}</span>`,
    )
    .join('');
  return `
    <header class="scan-bar">
      <button type="button" class="icon-btn" data-act="scan-close" aria-label="Back">${ICO.back}</button>
      <h1>Scan</h1>
    </header>
    <div class="scan-stage">
      <div class="scan-frame">
        <img src="data:image/jpeg;base64,${scan.jpeg}" alt="" />
        <div class="scan-layer">${words}</div>
      </div>
    </div>`;
}

export type { CaptureInfo, SettingsSection } from './settings-panels';
export { SETTINGS_SECTIONS, settingsBody } from './settings-panels';

