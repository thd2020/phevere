import type { Catalog } from '../runtime';

export default {
  // Tray menu
  'main.tray.open': '打开 Phevere',
  'main.tray.selectionMode': '划词模式',
  'main.tray.selectionMode.shortcut': '快捷键（按住触发键）',
  'main.tray.hoverLookup': '悬停取词',
  'main.tray.scanRegion': '扫描区域…',
  'main.tray.scanUnderPointer': '扫描指针处',
  'main.tray.scanActiveWindow': '扫描活动窗口',
  'main.tray.scanClipboardImage': '扫描剪贴板图片',
  'main.tray.lookUpNowPlaying': '查询正在播放的内容',
  'main.tray.clipboardHistory': '剪贴板历史',
  'main.tray.macAccessibilitySettings': '打开辅助功能设置…',
  'main.tray.macScreenRecordingSettings': '打开屏幕录制设置…',
  'main.tray.quit': '退出 Phevere',
  'main.tray.update.restart': '重新启动以更新到 {version}',
  'main.tray.update.install': '更新到 {version}',
  'main.tray.update.download': '下载 Phevere {version}…',

  // Menu item that opens the Settings window (tray and the macOS app menu)
  'main.menu.settings': '设置…',

  // macOS app menu; {app} is the app's name
  'main.appMenu.about': '关于 {app}',
  'main.appMenu.services': '服务',
  'main.appMenu.hide': '隐藏 {app}',
  'main.appMenu.hideOthers': '隐藏其他',
  'main.appMenu.showAll': '全部显示',
  'main.appMenu.quit': '退出 {app}',
  'main.appMenu.edit': '编辑',
  'main.appMenu.undo': '撤销',
  'main.appMenu.redo': '重做',
  'main.appMenu.cut': '剪切',
  'main.appMenu.copy': '拷贝',
  'main.appMenu.paste': '粘贴',
  'main.appMenu.pasteAndMatchStyle': '粘贴并匹配样式',
  'main.appMenu.delete': '删除',
  'main.appMenu.selectAll': '全选',
  'main.appMenu.speech': '语音',
  'main.appMenu.startSpeaking': '开始朗读',
  'main.appMenu.stopSpeaking': '停止朗读',
  'main.appMenu.window': '窗口',
  'main.appMenu.minimize': '最小化',
  'main.appMenu.zoom': '缩放',
  'main.appMenu.front': '前置全部窗口',

  // Notifications (Windows tray balloons, macOS and Linux notifications)
  'main.notify.hoverOn': '悬停取词已开启（{shortcut}）',
  'main.notify.hoverOff': '悬停取词已关闭（{shortcut}）',
  'main.notify.translateFailed': '无法翻译选中的文字。',
  'main.notify.noClipboardImage': '剪贴板中没有图片。按 {keys} 截取一张。',
  'main.notify.noClipboardImage.linux': '剪贴板中没有图片。请先用 Print Screen 复制一个区域。',
  'main.notify.clipboardImageReady': '图片已复制。按 {keys} 扫描。',
  'main.notify.noTray.gnome': '没有托盘图标：请开启 AppIndicator 扩展。再次运行 Phevere 即可重新打开窗口。',
  'main.notify.noTray': '没有托盘图标：此桌面环境没有系统托盘。再次运行 Phevere 即可重新打开窗口。',
  'main.notify.updateReady': 'Phevere {version} 已就绪，将在退出 Phevere 时安装。',
  'main.notify.updateAvailable': 'Phevere {version} 现已推出。',

  // Shortcut errors shown in Settings
  'main.shortcuts.mustDiffer': '每个快捷键都必须不同。',
  'main.shortcuts.allRequired': '所有快捷键都必须填写。',
  'main.shortcuts.invalid': '此快捷键无效。',

  // The small progress window shown while text is captured and recognised
  'main.progress.working': '正在处理…',
  'main.progress.recognizing': '正在识别文字…',
  'main.progress.capturingRegion': '正在截取屏幕区域',
  'main.progress.captureFailed': '截取失败',
  'main.progress.tryLargerRegion': '请尝试更大的区域',
  'main.progress.readingText': '正在读取文字',
  'main.progress.stillWorking': '仍在处理… {seconds} 秒',
  'main.progress.lookingUp': '正在查询…',
  'main.progress.regionTooSmall': '区域太小',
  'main.progress.selectLargerArea': '请选择更大的区域。',
  'main.progress.scanningUnderPointer': '正在扫描指针处…',
  'main.progress.capturingNearby': '正在截取附近的文字',
  'main.progress.scanningWindow': '正在扫描窗口…',
  'main.progress.capturingWindow': '正在截取前台窗口',
  'main.progress.scanningClipboard': '正在扫描剪贴板图片…',
  'main.progress.scanningImage': '正在扫描图片…',
  'main.progress.nowPlaying': '正在播放…',
  'main.progress.checkingNowPlaying': '正在检查播放内容',

  // What the pop-up shows when a scan has nothing to look up
  'main.scan.noText': '（未找到文字）',
  'main.scan.needsPack': '（需要 OCR 组件）',
  'main.scan.unavailable': '（文字识别不可用：{reason}）',
  'main.scan.engineFailedToLoad': '内置引擎加载失败',
  'main.scan.engineFailed': '内置引擎出错',
  'main.scan.windowFailed': '（无法扫描此窗口）',
  'main.scan.nothingPlaying': '（没有正在播放的内容）',
  'main.scan.imageLoadFailed': '无法加载图片',
  'main.scan.imageDecodeFailed': '无法解码图片',

  // Word book files: export, import and the questions an import asks
  'main.books.exportTitle': '导出词书',
  'main.books.exportAnkiTitle': '导出到 Anki',
  'main.books.fileType.ankiText': 'Anki 文本',
  'main.books.fileType.book': 'Phevere 词书',
  'main.books.fileType.books': '词书',
  'main.books.fileType.olderExport': '旧版 Phevere 导出文件',
  'main.books.importTitle': '导入词书',
  'main.books.openFailed': '无法打开这本词书。',
  'main.books.sqliteMissing': '没有可用的 SQLite，无法读取此 Anki 文件。',
  'main.books.myWords': '生词本',
  'main.books.replace': '替换',
  'main.books.keepBoth': '全部保留',
  'main.books.nameTaken': '你已有一本名为“{title}”的词书。',
  'main.books.nameTakenDetail':
    '“替换”会用此文件的单词表覆盖原词书。“全部保留”会将此文件添加为“{title} (2)”。无论选哪一项，学习进度都会合并。',
  'main.books.mergeProgress': '合并进度',
  'main.books.alreadyAdded': '你已添加过“{title}”。',
  'main.books.alreadyAddedDetail': '此文件中的进度会合并进去。',

  // Offline dictionaries: file dialogs and download progress in Settings
  'main.offline.importPackTitle': '导入词典包',
  'main.offline.importCedictTitle': '导入 CC-CEDICT 文件',
  'main.offline.fileType.json': '词典 JSON',
  'main.offline.fileType.all': '所有文件',
  'main.offline.progress.downloading': '正在下载…',
  'main.offline.progress.downloadingOf': '正在下载 {done}/{total} MB',
  'main.offline.progress.downloadingSize': '正在下载 {done} MB',
  'main.offline.progress.importing': '正在导入…',
  'main.offline.progress.importingCount': { other: '正在导入 {count} 个词条' },
  'main.offline.progress.unpacking': '正在解压…',
  'main.offline.downloadFailed': '下载失败：{reason}',

  // Text recognition (OCR) models in Settings
  'main.ocr.chooseFolderTitle': '选择 OCR 模型文件夹',
  'main.ocr.profile.custom': '自定义模型文件夹…',
  'main.ocr.unknownProfile': '未知的 OCR 配置',
  'main.ocr.folderHasNoModel': '此文件夹中没有 OCR 模型。',
  'main.ocr.using': '正在使用 {model}',
  'main.ocr.rapidReady': 'RapidOCR 已就绪',
  'main.ocr.embeddedReady': '内置 OCR 已就绪',
  'main.ocr.couldNotStart': '文字识别无法启动（模型：{path}）',

  'main.ocrPack.downloadFailed': '无法下载 OCR 组件。请检查网络连接后重试。',

  // The scanned-text window
  'main.ocrResult.title': '扫描文字',
  'main.ocrResult.fileName': '扫描文字',
  'main.ocrResult.fileType.png': 'PNG 图片',

  // Updates
  'main.update.rollBack': '回退到 {version}',
  'main.update.rollBackQuestion': '要将 Phevere {from} 替换为 {to} 吗？',
  'main.update.rollBackDetail':
    '你的生词本会先复制到备份文件夹，原文件保持不动。对于 {to} 改动过的单词，它可能丢弃只有 {from} 才记录的信息，例如复习历史。在更新的版本发布之前，自动更新会跳过 {from}。',
  'main.update.noInstaller': '此版本没有适用于这台电脑的安装程序。',
  'main.update.noChecksum': 'GitHub 没有列出 {file} 的校验和，因此未安装。',
  'main.update.interrupted': '下载中断了。下次检查时会从中断处继续。',
  'main.update.checksumMismatch': '{file} 与 GitHub 上的校验和不符，已删除。',
  'main.update.unreachable': '无法连接 GitHub。{reason}',

  // macOS permission dialogs; {app} is Phevere, or Electron in a development build
  'main.mac.accessibility.title': '需要辅助功能权限',
  'main.mac.accessibility.message': '{app} 需要辅助功能权限才能读取选中的文字。',
  'main.mac.accessibility.detail': '在“系统设置”中打开“隐私与安全性”，再打开“辅助功能”，然后开启 {app}。',
  'main.mac.screenRecording.title': '需要屏幕录制权限',
  'main.mac.screenRecording.message': '{app} 需要屏幕录制权限才能读取屏幕上的文字。',
  'main.mac.screenRecording.detail': '在“系统设置”中打开“隐私与安全性”，再打开“屏幕录制”，然后开启 {app}。',
  'main.mac.openSystemSettings': '打开系统设置',
  'main.mac.notNow': '以后',

  // Speech voices in Settings, Audio
  'main.speech.voice.mechanical': '机械',
  'main.speech.voice.builtIn': '内置',
  'main.speech.voice.neuralStandard': '神经（标准）',
  'main.speech.voice.neuralHigh': '神经（高品质）',
  'main.speech.downloadFailed': '下载失败（HTTP {status}）',
  'main.speech.verifyFailed': '下载校验失败，请重试。',

  // Account sign-in: the page the browser shows after sign-in, and sign-in errors
  'main.account.signedIn.title': '已登录 Phevere',
  'main.account.signedIn.message': '你可以关闭此标签页并返回 Phevere。',
  'main.account.signInFailed.title': '登录未完成',
  'main.account.signInFailed.message': '请返回 Phevere 再试一次。',
  'main.account.timedOut': '登录超时，请重试。',
  'main.account.cancelled': '登录已取消。',
  'main.account.portsBusy':
    '登录需要使用本地端口 {ports} 中的一个，但它们都已被占用。请关闭占用这些端口的程序后重试。',
} satisfies Partial<Catalog>;
