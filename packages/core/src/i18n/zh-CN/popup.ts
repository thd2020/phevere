import type { Catalog } from '../runtime';

export default {
  // Lookup pop-up: window and options panel
  'popup.windowTitle': 'Phevere 词典',
  'popup.options.preload': '展开前先查询',
  'popup.options.openLinksExternally': '在浏览器中打开链接',
  'popup.options.images': '图片',

  // Lookup pop-up: toolbar
  'popup.toolbar.history': '查词记录',
  'popup.toolbar.backTitle': '后退（Alt+Left）',
  'popup.toolbar.forward': '前进',
  'popup.toolbar.forwardTitle': '前进（Alt+Right）',
  'popup.toolbar.views': '视图',
  'popup.tab.lexicon': '词典',
  'popup.tab.translation': '翻译',
  'popup.tab.etymology': '词源',
  'popup.playPronunciation': '播放发音',
  'popup.toolbar.searchWeb': '网上搜索',
  'popup.toolbar.saveToNotebook': '存入生词本',
  'popup.saveToMyWords': '存入生词本',
  'popup.removeFromMyWords': '从生词本移除',
  'popup.addToWordBook': '加入词书',
  'popup.toolbar.settings': '弹窗设置',
  'popup.toolbar.closeTitle': '关闭（Esc）',

  // Lookup pop-up: Translation view's language row
  'popup.translate.from': '从',
  'popup.translate.to': '到',
  'popup.translate.detectLanguage': '检测语言',
  'popup.translate.swap': '互换语言',
  'popup.translate.languageOption': '{native}（{name}）',
  'popup.translate.detected': '检测到：{language}',

  // Lookup pop-up: loading
  'popup.loading.lookingUp': '正在查询…',
  'popup.loading.querying': '正在查询词典来源',
  'popup.loading.detecting': '正在检测语言并获取来源',
  'popup.loading.wikipedia': '维基百科…',
  'popup.loading.wikipediaSummary': '正在获取条目摘要',
  'popup.error.timedOut': '查词超时。',
  'popup.error.lookupFailed': '无法查询“{word}”。',
  'popup.error.unknown': '未知错误',
  'popup.results.none': '没有结果。',

  // Lookup pop-up: Etymology view
  'popup.etymology.loading': '正在加载词源',
  'popup.etymology.sources': '词源来源',
  'popup.etymology.none': '未找到词源。',
  'popup.etymology.blocked': 'Etymonline 拦截了此请求。',
  'popup.etymology.unavailable': 'Etymonline 不可用。',
  'popup.etymology.openOnEtymonline': '在 Etymonline 上打开',
  'popup.etymology.primary': '主要',
  'popup.etymology.alternative': '其他 {n}',
  'popup.etymology.chain': '词源演变，从古到今',
  'popup.etymology.relation.inherited': '继承',
  'popup.etymology.relation.borrowed': '借入',
  'popup.etymology.relation.learnedBorrowing': '书面借入',
  'popup.etymology.relation.derived': '派生',
  'popup.etymology.relation.calque': '仿译',
  'popup.etymology.relation.root': '词根',

  // Lookup pop-up: Translation view
  'popup.translation.translating': '正在翻译',
  'popup.translation.none': '未找到翻译。',
  'popup.translation.via': '来自 {provider}',
  'popup.translation.source': '原文',
  'popup.translation.playSource': '播放原文',
  'popup.translation.playTranslation': '播放译文',

  // Lookup pop-up: pronunciation
  'popup.audio.failed': '无法播放发音',
  'popup.audio.off': '发音已关闭',
  'popup.ipa.none': '此单词没有国际音标',
  'popup.ipa.failed': '无法播放此音标',
  'popup.ipa.playUs': '播放美式发音',
  'popup.ipa.playUk': '播放英式发音',

  // Lookup pop-up: Lexicon view
  'popup.lexicon.noDefinitions': '未找到释义。',
  'popup.lexicon.noDefinition': '没有释义。',
  'popup.lexicon.noDefinitionsFrom': '{source} 中没有释义。',
  'popup.lexicon.sections': '词典分区',
  'popup.lexicon.section.other': '其他',
  'popup.lexicon.section.senses': '义项',
  'popup.lexicon.section.forms': '词形',
  'popup.lexicon.section.examples': '例句',
  'popup.lexicon.section.synonyms': '同义词',
  'popup.lexicon.section.antonyms': '反义词',
  'popup.lexicon.section.phrases': '短语',
  'popup.lexicon.section.family': '词族',
  'popup.lexicon.section.wordFamily': '词族',

  // Lookup pop-up: My words and word books
  'popup.save.notebookUnavailable': '生词本不可用',
  'popup.save.nothing': '没有可保存的内容',
  'popup.save.saved': '已存入生词本',
  'popup.save.removed': '已从生词本移除',
  'popup.save.unavailable': '无法保存，生词本不可用。',
  'popup.save.failed': '无法保存：{reason}',
  'popup.bookAdd.added': '已加入“{book}”',
  'popup.bookAdd.removed': '已从“{book}”移除',

  // Lookup pop-up: Wikipedia view
  'popup.wiki.unavailable': '维基百科不可用。',
  'popup.wiki.nothingToSearch': '没有可搜索的内容。',
  'popup.wiki.none': '未找到维基百科条目。',
  'popup.wiki.failed': '维基百科查询失败。',
  'popup.wiki.back': '返回结果',
  'popup.wiki.openInBrowser': '在浏览器中打开',

  // Quick translation panel
  'popup.quick.windowTitle': '快速翻译',
  'popup.quick.from': '源语言',
  'popup.quick.to': '目标语言',
  'popup.quick.swap': '互换语言',
  'popup.quick.translations': '译文',
  'popup.quick.detectLanguage': '检测语言',
  'popup.quick.autoTarget': '自动',
  'popup.quick.translating': '正在翻译…',
  'popup.quick.noTranslation': '无译文',
  'popup.quick.keys.engine': '引擎',
  'popup.quick.keys.replace': '替换',

  // Region picker for a scan
  'popup.scanRegion.windowTitle': '扫描区域',
  'popup.scanRegion.hint': '拖动以选择区域。按 Esc 取消。',

  // Scanned-text window
  'popup.scanText.windowTitle': '扫描文字',
  'popup.scanText.picture': '扫描的图片',
  'popup.scanText.saved': '已保存',
} satisfies Partial<Catalog>;
