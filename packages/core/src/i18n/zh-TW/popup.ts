import type { Catalog } from '../runtime';

export default {
  // Lookup pop-up: window and options panel
  'popup.windowTitle': 'Phevere 字典',
  'popup.options.preload': '展開前先查詢',
  'popup.options.openLinksExternally': '在瀏覽器中開啟連結',
  'popup.options.images': '圖片',

  // Lookup pop-up: toolbar
  'popup.toolbar.history': '查詢記錄',
  'popup.toolbar.backTitle': '上一頁（Alt+Left）',
  'popup.toolbar.forward': '下一頁',
  'popup.toolbar.forwardTitle': '下一頁（Alt+Right）',
  'popup.toolbar.views': '檢視',
  'popup.tab.lexicon': '釋義',
  'popup.tab.translation': '翻譯',
  'popup.tab.etymology': '字源',
  'popup.playPronunciation': '播放發音',
  'popup.toolbar.searchWeb': '搜尋網路',
  'popup.toolbar.saveToNotebook': '存到單字本',
  'popup.saveToMyWords': '存到「我的單字」',
  'popup.removeFromMyWords': '從「我的單字」移除',
  'popup.addToWordBook': '加入單字書',
  'popup.toolbar.settings': '彈出視窗設定',
  'popup.toolbar.closeTitle': '關閉（Esc）',

  // Lookup pop-up: Translation view's language row
  'popup.translate.from': '從',
  'popup.translate.to': '翻譯成',
  'popup.translate.detectLanguage': '偵測語言',
  'popup.translate.swap': '交換語言',
  'popup.translate.languageOption': '{native}（{name}）',
  'popup.translate.detected': '偵測到：{language}',

  // Lookup pop-up: loading
  'popup.loading.lookingUp': '查詢中…',
  'popup.loading.querying': '正在查詢字典來源',
  'popup.loading.detecting': '正在偵測語言並取得來源',
  'popup.loading.wikipedia': '維基百科…',
  'popup.loading.wikipediaSummary': '正在取得條目摘要',
  'popup.error.timedOut': '查詢逾時。',
  'popup.error.lookupFailed': '無法查詢「{word}」。',
  'popup.error.unknown': '未知的錯誤',
  'popup.results.none': '沒有結果。',

  // Lookup pop-up: Etymology view
  'popup.etymology.loading': '正在載入字源',
  'popup.etymology.sources': '字源來源',
  'popup.etymology.none': '找不到字源。',
  'popup.etymology.blocked': 'Etymonline 封鎖了這個請求。',
  'popup.etymology.unavailable': '無法使用 Etymonline。',
  'popup.etymology.openOnEtymonline': '在 Etymonline 開啟',
  'popup.etymology.primary': '主要',
  'popup.etymology.alternative': '其他 {n}',
  'popup.etymology.chain': '字源演變，由古至今',
  'popup.etymology.relation.inherited': '承襲',
  'popup.etymology.relation.borrowed': '借用',
  'popup.etymology.relation.learnedBorrowing': '書面借用',
  'popup.etymology.relation.derived': '衍生',
  'popup.etymology.relation.calque': '仿譯',
  'popup.etymology.relation.root': '字根',

  // Lookup pop-up: Translation view
  'popup.translation.translating': '翻譯中',
  'popup.translation.none': '找不到翻譯。',
  'popup.translation.via': '由 {provider} 翻譯',
  'popup.translation.source': '原文',
  'popup.translation.playSource': '播放原文',
  'popup.translation.playTranslation': '播放譯文',

  // Lookup pop-up: pronunciation
  'popup.audio.failed': '無法播放發音',
  'popup.audio.off': '發音已關閉',
  'popup.ipa.none': '這個字沒有 IPA',
  'popup.ipa.failed': '無法播放這個 IPA',
  'popup.ipa.playUs': '播放美式發音',
  'popup.ipa.playUk': '播放英式發音',

  // Lookup pop-up: Lexicon view
  'popup.lexicon.noDefinitions': '找不到釋義。',
  'popup.lexicon.noDefinition': '沒有釋義。',
  'popup.lexicon.noDefinitionsFrom': '{source} 沒有釋義。',
  'popup.lexicon.sections': '釋義區段',
  'popup.lexicon.section.other': '其他',
  'popup.lexicon.section.senses': '詞義',
  'popup.lexicon.section.forms': '詞形',
  'popup.lexicon.section.examples': '例句',
  'popup.lexicon.section.synonyms': '同義詞',
  'popup.lexicon.section.antonyms': '反義詞',
  'popup.lexicon.section.phrases': '片語',
  'popup.lexicon.section.family': '字族',
  'popup.lexicon.section.wordFamily': '字族',

  // Lookup pop-up: My words and word books
  'popup.save.notebookUnavailable': '無法使用單字本',
  'popup.save.nothing': '沒有可儲存的內容',
  'popup.save.saved': '已存到「我的單字」',
  'popup.save.removed': '已從「我的單字」移除',
  'popup.save.unavailable': '無法儲存。「我的單字」目前無法使用。',
  'popup.save.failed': '無法儲存：{reason}',
  'popup.bookAdd.added': '已加入「{book}」',
  'popup.bookAdd.removed': '已從「{book}」移除',

  // Lookup pop-up: Wikipedia view
  'popup.wiki.unavailable': '無法使用維基百科。',
  'popup.wiki.nothingToSearch': '沒有可搜尋的內容。',
  'popup.wiki.none': '找不到維基百科條目。',
  'popup.wiki.failed': '維基百科查詢失敗。',
  'popup.wiki.back': '返回結果',
  'popup.wiki.openInBrowser': '在瀏覽器中開啟',

  // Quick translation panel
  'popup.quick.windowTitle': '快速翻譯',
  'popup.quick.from': '來源語言',
  'popup.quick.to': '目標語言',
  'popup.quick.swap': '交換語言',
  'popup.quick.translations': '譯文',
  'popup.quick.detectLanguage': '偵測語言',
  'popup.quick.autoTarget': '自動',
  'popup.quick.translating': '翻譯中…',
  'popup.quick.noTranslation': '沒有譯文',
  'popup.quick.keys.engine': '引擎',
  'popup.quick.keys.replace': '取代',

  // Region picker for a scan
  'popup.scanRegion.windowTitle': '掃描區域',
  'popup.scanRegion.hint': '拖曳以選取範圍。按 Esc 取消。',

  // Scanned-text window
  'popup.scanText.windowTitle': '掃描的文字',
  'popup.scanText.picture': '掃描的圖片',
  'popup.scanText.saved': '已儲存',
} satisfies Partial<Catalog>;
