/**
 * Fails when interface text is written into the code instead of the catalogue
 * (packages/core/src/i18n/en). It reads every desktop window, the shared core and the phone app
 * and flags English words in:
 *
 *  - markup built in strings and templates: text between tags, and the title, aria-label,
 *    placeholder and alt attributes;
 *  - text handed to the places a person reads it: textContent, innerText, title, placeholder,
 *    setAttribute('aria-label' | 'title' | ...), toasts, status lines, notifications, dialogs,
 *    and object properties such as label, title, message and detail;
 *  - strings returned by functions whose name ends in Text, Label, Title or Message;
 *  - static HTML pages, unless the element carries data-i18n or data-i18n-attr.
 *
 * Names that stay as written in every language (Phevere, GitHub, Wiktionary) are allowed below.
 * Anything else that must stay in English (data, the user's text, a language's own name) gets a
 * `// i18n-ignore` comment on its line or the line above, with the reason.
 *
 * Run: node scripts/test-i18n-strings.js            (fails on any finding)
 *      node scripts/test-i18n-strings.js src/renderer.ts packages/core/src/settings-kit.ts
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.join(__dirname, '..');

/** Proper names and symbols that read the same in every language. */
const ALLOW_WORDS = new Set(
  `Phevere GitHub Google DeepL Youdao Wiktionary Wikipedia Wikimedia Commons Wikidata LSPosed Xposed LSPatch Kokoro eSpeak NG
  MyMemory Datamuse Oxford Collins Merriam Webster WordsAPI Kaikki Jisho JMdict CEDICT CC-CEDICT FreeDict Kengdic WordNet GCIDE
  Etymonline Tatoeba OpenRussian ECDICT NGSL CMUdict PP-OCR PaddleOCR OCR Anki Holarky Plus IPA API TEI JSON TSV CSV PDF PNG URL
  Windows macOS Linux Android iOS MB KB GB TOEIC CET Ctrl Shift Alt Cmd Esc Fn Win Option Command Control Enter Tab
  Electron Outfit Source Serif Charis SIL IBM Plex Mono MIT BY SA Apple Microsoft Neural sherpa onnx Free Dictionary`.split(/\s+/),
);

const SINK_PROPS = new Set(['textContent', 'innerText', 'title', 'placeholder', 'ariaLabel', 'alt', 'innerHTML', 'outerHTML']);
const SINK_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'aria-description', 'aria-valuetext', 'aria-roledescription']);
const SINK_KEYS = new Set([
  'label', 'title', 'sub', 'hint', 'message', 'detail', 'body', 'placeholder', 'ariaLabel', 'tooltip', 'caption', 'buttons',
  'checkboxLabel', 'description', 'heading', 'empty', 'cta', 'okLabel', 'cancelLabel', 'confirmLabel', 'note', 'subtitle', 'toolTip',
  'meta', 'action', 'status', 'lead',
]);
const SINK_CALL = /^(alert|confirm|prompt|toast|showToast|showUndoToast|showNotification|notify|notifyUser|setStatus|setToolTip|showError|showMessage|announce|setTitle|showErrorBox)$/;
const TEXT_FN = /(Text|Label|Title|Message|Caption)$/;

const SKIP_FILES = [
  /[\\/]i18n[\\/]/,
  /\.d\.ts$/,
  /wordbook-catalog\.ts$/,
  /sense-frequency-data\.ts$/,
  /[\\/]src[\\/]popup\.html$/, // the old pop-up, no longer built (forge.config.js loads popup-new.html)
  /[\\/]src[\\/]logger\.ts$/,
  /[\\/]src[\\/]services[\\/]local-db-worker\.cjs$/,
];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

function defaultFiles() {
  const files = [
    ...walk(path.join(root, 'src'), []),
    ...walk(path.join(root, 'packages', 'core', 'src'), []),
    ...walk(path.join(root, 'apps', 'mobile', 'src'), []),
  ];
  return files.filter((f) => !SKIP_FILES.some((re) => re.test(f)));
}

/** True when the text still has words a person reads once allowed names are taken out. */
function hasWords(text) {
  const plain = String(text)
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\u0001/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ');
  const words = plain.match(/[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]{2,}/g) || [];
  return words.some((w) => !ALLOW_WORDS.has(w) && !ALLOW_WORDS.has(w.replace(/[’']s$/, '')));
}

/** A CSS class, an id, a data value or a key: not text. */
function looksLikeCode(s) {
  const v = s.trim();
  if (!v) return true;
  if (/^[a-z0-9]+([-_.:/][a-z0-9]+)*$/.test(v)) return true; // sv-row, data-act, popup.save
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(v)) return true; // camelCase identifier
  if (/^[#.\[]/.test(v)) return true; // selectors
  if (/^(https?:|mailto:|data:|blob:)/.test(v)) return true;
  if (!/\s/.test(v) && /[=&?/\\]/.test(v)) return true; // a query string or a path
  return false;
}

/** Finds in a piece of markup (placeholders replaced by \u0001). */
function scanMarkup(src, report, ctx = {}) {
  let s = src.replace(/<svg[\s\S]*?<\/svg>/gi, (m) => m.replace(/[^\n]/g, ' '));
  s = s.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, ' '));
  s = s.replace(/<!--[\s\S]*?-->|<![a-z][^>]*>/gi, (m) => m.replace(/[^\n]/g, ' '));
  const re = /<\/?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let m;
  const stack = [];
  const checkText = (text, offset) => {
    const trimmed = text.trim();
    if (!trimmed || !hasWords(trimmed)) return;
    const parent = stack[stack.length - 1];
    if (parent && parent.i18n) return;
    if (parent && parent.ignore) return;
    report(offset, trimmed);
  };
  while ((m = re.exec(s))) {
    checkText(s.slice(last, m.index), last);
    last = re.lastIndex;
    const tag = m[0];
    const attrs = m[2] || '';
    const closing = tag.startsWith('</');
    if (closing) {
      stack.pop();
      continue;
    }
    const i18nAttr = /data-i18n-attr="([^"]*)"/.exec(attrs);
    const covered = new Set(i18nAttr ? i18nAttr[1].split(';').map((p) => p.split(':')[0].trim()) : []);
    const ignore = /\bdata-i18n-ignore\b|\btranslate="no"/.test(attrs);
    const attrRe = /([\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = attrRe.exec(attrs))) {
      const name = a[1].toLowerCase();
      const value = a[3] !== undefined ? a[3] : a[4];
      if (!SINK_ATTRS.has(name) || covered.has(name) || ignore) continue;
      if (hasWords(value) && !looksLikeCode(value.replace(/\u0001/g, ''))) report(m.index, `${name}="${value.trim()}"`);
    }
    const voidTag = /^(br|hr|img|input|meta|link|source|wbr|col|area|base|embed|param|track)$/i.test(m[1]) || tag.endsWith('/>');
    if (!voidTag) stack.push({ tag: m[1], i18n: /\bdata-i18n="/.test(attrs), ignore });
  }
  checkText(s.slice(last), last);
  void ctx;
}

const isMarkup = (s) => /<\/?[a-zA-Z][\w-]*[\s>/]/.test(s);

function scanTs(file, text, findings, lineOffset = 0) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const lines = text.split('\n');
  const ignored = (pos) => {
    const line = sf.getLineAndCharacterOfPosition(pos).line;
    return /i18n-ignore/.test(lines[line] || '') || /i18n-ignore/.test(lines[line - 1] || '');
  };
  const add = (pos, what) => {
    if (ignored(pos)) return;
    const line = sf.getLineAndCharacterOfPosition(pos).line + 1 + lineOffset;
    findings.push(`${path.relative(root, file)}:${line}: ${what.replace(/\u0001/g, '${…}').replace(/\s+/g, ' ').slice(0, 120)}`);
  };
  /** The literal text of a string or template, placeholders as \u0001, with each piece's position. */
  const literalText = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((sp) => '\u0001' + sp.literal.text).join('');
    return null;
  };
  /** Literal leaves of a value: through ?:, ||, ??, + and parentheses. */
  const leaves = (node, out = []) => {
    if (!node) return out;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return leaves(node.expression, out);
    if (ts.isConditionalExpression(node)) return leaves(node.whenFalse, leaves(node.whenTrue, out));
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(node.operatorToken.kind)) {
      return leaves(node.right, leaves(node.left, out));
    }
    if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((e) => leaves(e, out));
      return out;
    }
    if (literalText(node) !== null) out.push(node);
    return out;
  };
  const checkSinkValue = (node) => {
    for (const leaf of leaves(node)) {
      const s = literalText(leaf);
      if (s === null || isMarkup(s)) continue; // markup is checked on its own
      const plain = s.replace(/\u0001/g, '');
      if (!hasWords(s) || looksLikeCode(plain)) continue;
      add(leaf.getStart(), s);
    }
  };
  const visit = (node) => {
    const s = literalText(node);
    if (s !== null && isMarkup(s)) {
      const start = node.getStart();
      scanMarkup(s, (offset, what) => {
        const before = s.slice(0, offset);
        const nl = (before.match(/\n/g) || []).length;
        const line = sf.getLineAndCharacterOfPosition(start).line + nl;
        const pos = sf.getPositionOfLineAndCharacter(Math.min(line, lines.length - 1), 0);
        if (ignored(pos) || ignored(start)) return;
        findings.push(`${path.relative(root, file)}:${line + 1 + lineOffset}: ${what.replace(/\u0001/g, '${…}').replace(/\s+/g, ' ').slice(0, 120)}`);
      });
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && SINK_PROPS.has(node.left.name.text)) {
      checkSinkValue(node.right);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      if (name === 'setAttribute' && node.arguments.length >= 2) {
        const attr = literalText(node.arguments[0]);
        if (attr && SINK_ATTRS.has(attr)) checkSinkValue(node.arguments[1]);
      } else if (SINK_CALL.test(name)) {
        node.arguments.forEach((arg) => checkSinkValue(arg));
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const key = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : '';
      if (SINK_KEYS.has(key)) checkSinkValue(node.initializer);
    }
    if (ts.isReturnStatement(node) && node.expression) {
      let fn = node.parent;
      while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
      const fnName = fn && fn.name && ts.isIdentifier(fn.name) ? fn.name.text : fn && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : '';
      if (fnName && TEXT_FN.test(fnName)) checkSinkValue(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function scanHtml(file, text, findings) {
  // Inline scripts are code; the rest is markup.
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptRe.exec(text))) {
    if (/\bsrc=/.test(m[0].slice(0, m[0].indexOf('>')))) continue;
    const start = m.index + m[0].indexOf('>') + 1;
    const lineOffset = (text.slice(0, start).match(/\n/g) || []).length;
    scanTs(file.replace(/\.html$/, '.inline.js'), m[1], findings, lineOffset);
  }
  const lines = text.split('\n');
  scanMarkup(text, (offset, what) => {
    const line = (text.slice(0, offset).match(/\n/g) || []).length;
    if (/i18n-ignore/.test(lines[line] || '') || /i18n-ignore/.test(lines[line - 1] || '')) return;
    findings.push(`${path.relative(root, file)}:${line + 1}: ${what.replace(/\s+/g, ' ').slice(0, 120)}`);
  });
}

function scan(files) {
  const findings = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.html')) scanHtml(file, text, findings);
    else scanTs(file, text, findings);
  }
  // .inline.js names point back at the page.
  return findings.map((f) => f.replace('.inline.js', '.html'));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const files = args.length ? args.map((a) => path.resolve(root, a)) : defaultFiles();
  const findings = scan(files);
  if (findings.length) {
    console.error(findings.join('\n'));
    console.error(`\ntest-i18n-strings: ${findings.length} visible strings outside the catalogue`);
    process.exit(1);
  }
  console.log(`test-i18n-strings: ok (${files.length} files)`);
}

module.exports = { scan, scanMarkup, hasWords };
