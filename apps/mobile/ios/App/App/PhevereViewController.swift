import UIKit
import WebKit
import UniformTypeIdentifiers
import Vision
import PhotosUI
import AVFoundation

/**
 * The page's web view, with Phevere in the text-selection menu, as Android lists Phevere on
 * its selection bar. iOS 16+ builds the edit menu through buildMenu(with:); older systems
 * read UIMenuController's custom items.
 */
final class PhevereWebView: WKWebView {
  var onLookup: (() -> Void)?

  override func buildMenu(with builder: UIMenuBuilder) {
    super.buildMenu(with: builder)
    if #available(iOS 16.0, *), builder.system == .context {
      let item = UICommand(title: "Phevere", action: #selector(phevereLookup(_:)))
      builder.insertChild(UIMenu(title: "", options: .displayInline, children: [item]), atStartOfMenu: .root)
    }
  }

  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    if action == #selector(phevereLookup(_:)) { return true }
    return super.canPerformAction(action, withSender: sender)
  }

  @objc func phevereLookup(_ sender: Any?) {
    onLookup?()
  }

  static func installLegacyMenuItem() {
    if #available(iOS 16.0, *) { return }
    UIMenuController.shared.menuItems = [UIMenuItem(title: "Phevere", action: #selector(phevereLookup(_:)))]
  }
}

final class PhevereViewController: UIViewController, WKScriptMessageHandler, WKURLSchemeHandler, WKNavigationDelegate, UIDocumentPickerDelegate, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate, AVSpeechSynthesizerDelegate {
  var stripMode = false
  private var web: PhevereWebView!
  private var pendingJsId: String?
  private var pendingSaveText: String = ""
  private var pendingOcrId: String?
  private var exportingFile = false
  private let synth = AVSpeechSynthesizer()
  private var player: AVPlayer?
  private var playerEnd: NSObjectProtocol?
  private var pendingSpeakId: String?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0.957, green: 0.941, blue: 0.918, alpha: 1)
    let conf = WKWebViewConfiguration()
    conf.setURLSchemeHandler(self, forURLScheme: "app")
    let shim = WKUserScript(
      source: """
      window.PhevereBridge = {
        call: function(method, id, params) {
          window.webkit.messageHandlers.PhevereBridge.postMessage({method: method, id: id, params: params});
        }
      };
      """,
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    )
    conf.userContentController.addUserScript(shim)
    conf.userContentController.add(self, name: "PhevereBridge")
    conf.allowsInlineMediaPlayback = true
    if #available(iOS 10.0, *) {
      conf.mediaTypesRequiringUserActionForPlayback = []
    }
    web = PhevereWebView(frame: view.bounds, configuration: conf)
    web.onLookup = { [weak self] in self?.lookUpSelection() }
    PhevereWebView.installLegacyMenuItem()
    web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    web.navigationDelegate = self
    web.scrollView.contentInsetAdjustmentBehavior = .never
    view.addSubview(web)
    let page = stripMode ? "app://localhost/index.html?mode=strip" : "app://localhost/index.html"
    web.load(URLRequest(url: URL(string: page)!))
    synth.delegate = self
  }

  func injectPending() {
    guard let text = IncomingStore.text else { return }
    let origin = IncomingStore.origin ?? "share"
    IncomingStore.text = nil
    let js = "window.__pvIncoming && window.__pvIncoming(\(Self.jsonString(text)), \(Self.jsonString(origin)))"
    web?.evaluateJavaScript(js, completionHandler: nil)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if stripMode { injectPending() }
    pushInsets()
  }

  /**
   * The edit menu's Phevere item. The page decides, as on Android: the pop-up and Scan look up
   * in place; anywhere else the pop-up opens beside the selection.
   */
  private func lookUpSelection() {
    let js = "window.__pvSelectionAction ? window.__pvSelectionAction() : null"
    web.evaluateJavaScript(js) { [weak self] value, _ in
      guard let self = self, let out = value as? [String: Any], let text = out["text"] as? String,
            out["inPlace"] as? Bool != true else { return }
      self.openPopup(text, rect: Self.rect(out["rect"] as? [String: Any]))
    }
  }

  /** Page rectangle in CSS px, which WKWebView lays out 1:1 in points. */
  private static func rect(_ box: [String: Any]?) -> CGRect? {
    guard let box = box, let l = box["left"] as? Double, let t = box["top"] as? Double,
          let r = box["right"] as? Double, let b = box["bottom"] as? Double else { return nil }
    return CGRect(x: l, y: t, width: max(1, r - l), height: max(1, b - t))
  }

  private func openPopup(_ text: String, rect: CGRect?) {
    IncomingStore.text = text
    IncomingStore.origin = "selection"
    (parent as? RootHostController)?.presentStrip(anchor: rect, in: web)
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    pushInsets()
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any],
          let method = body["method"] as? String,
          let id = body["id"] as? String else { return }
    let paramsStr = body["params"] as? String ?? "{}"
    let params = (try? JSONSerialization.jsonObject(with: Data(paramsStr.utf8))) as? [String: Any] ?? [:]
    handle(method: method, id: id, params: params)
  }

  private func handle(method: String, id: String, params: [String: Any]) {
    switch method {
    case "http":
      Self.http(params) { result in
        switch result {
        case .success(let obj): self.resolve(id, obj)
        case .failure(let err): self.fail(id, err.localizedDescription)
        }
      }
    case "readFile":
      let name = params["name"] as? String ?? "file"
      if let data = Self.readFile(name) {
        resolve(id, ["b64": data.base64EncodedString()])
      } else {
        resolve(id, ["b64": NSNull()])
      }
    case "writeFile":
      let name = params["name"] as? String ?? "file"
      let b64 = params["b64"] as? String ?? ""
      do {
        try Self.writeFile(name, Data(base64Encoded: b64) ?? Data())
        resolve(id, ["ok": true])
      } catch {
        fail(id, error.localizedDescription)
      }
    case "getPendingText":
      if (!stripMode) {
        resolve(id, ["text": NSNull(), "origin": NSNull()])
        return
      }
      let text = IncomingStore.text
      let origin = IncomingStore.origin
      IncomingStore.text = nil
      var payload: [String: Any] = [:]
      payload["text"] = text ?? NSNull()
      payload["origin"] = origin ?? NSNull()
      resolve(id, payload)
    case "openUrl":
      if let s = params["url"] as? String, let url = URL(string: s) {
        UIApplication.shared.open(url)
      }
      resolve(id, ["ok": true])
    case "openWikipedia":
      if let s = params["url"] as? String, let url = URL(string: s) {
        let wiki = WikiViewController(url: url)
        wiki.modalPresentationStyle = .fullScreen
        present(wiki, animated: true)
      }
      resolve(id, ["ok": true])
    case "copy":
      UIPasteboard.general.string = params["text"] as? String
      resolve(id, ["ok": true])
    case "share":
      let text = params["text"] as? String ?? ""
      present(UIActivityViewController(activityItems: [text], applicationActivities: nil), animated: true)
      resolve(id, ["ok": true])
    case "getClipboard":
      resolve(id, ["text": UIPasteboard.general.string ?? ""])
    case "scanOcr":
      pendingOcrId = id
      chooseOcr()
    case "pickFile":
      pendingJsId = id
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item])
      picker.delegate = self
      present(picker, animated: true)
    case "saveFile":
      pendingJsId = id
      pendingSaveText = params["text"] as? String ?? ""
      exportingFile = true
      let name = params["name"] as? String ?? "phevere.txt"
      let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(name)
      try? pendingSaveText.write(to: tmp, atomically: true, encoding: .utf8)
      let picker = UIDocumentPickerViewController(forExporting: [tmp])
      picker.delegate = self
      present(picker, animated: true)
    case "setFloatingStrip":
      CapturePrefs.floatingStrip = params["enabled"] as? Bool ?? false
      resolve(id, ["ok": true])
    case "getCapturePrefs":
      Notify.granted { ok in
        self.resolve(id, [
          "floatingStrip": CapturePrefs.floatingStrip,
          "canDrawOverlays": false,
          "platform": "ios",
          "notificationsGranted": ok,
          "autoPopup": CapturePrefs.autoPopup
        ])
      }
    case "setAutoPopup":
      CapturePrefs.autoPopup = params["enabled"] as? Bool ?? false
      resolve(id, ["ok": true])
    case "openPopup":
      let text = (params["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      if !text.isEmpty { openPopup(text, rect: Self.rect(params["rect"] as? [String: Any])) }
      resolve(id, ["ok": true])
    case "speechVoices", "cancelSpeechDownload":
      resolve(id, Self.voiceStatus())
    case "setSpeechVoice":
      CapturePrefs.speechVoice = params["id"] as? String ?? ""
      resolve(id, Self.voiceStatus())
    case "requestOverlayPermission":
      resolve(id, ["ok": true])
    case "requestNotifications":
      Notify.request { ok in
        self.resolve(id, ["ok": true, "granted": ok])
      }
    case "openNotificationSettings":
      Notify.openSettings()
      resolve(id, ["ok": true])
    case "speak":
      let text = (params["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      let lang = params["lang"] as? String ?? "en-US"
      let rate = params["rate"] as? Double ?? 1
      finishSpeak(ok: true)
      stopPlayback()
      synth.stopSpeaking(at: .immediate)
      let utterance: AVSpeechUtterance?
      if params["phonemes"] as? Bool == true {
        // IPA chip: Android's eSpeak reads [[phonemes]]; iOS speaks the chip's own IPA.
        utterance = Self.ipaUtterance(ipa: params["ipa"] as? String ?? "", word: params["word"] as? String ?? "")
      } else {
        utterance = text.isEmpty ? nil : AVSpeechUtterance(string: text)
      }
      if let u = utterance {
        pendingSpeakId = id
        u.voice = Self.voice(for: lang)
        u.rate = Float(min(1.0, max(0.35, rate * 0.5)))
        u.volume = Float(min(1, params["volume"] as? Double ?? 1))  // gain 0–2; AVSpeech tops out at 1
        synth.speak(u)
      } else {
        resolve(id, ["ok": true])
      }
    case "playUrl":
      finishSpeak(ok: true)
      stopPlayback()
      pendingSpeakId = id
      if let s = params["url"] as? String, let url = URL(string: s) {
        let item = AVPlayerItem(url: url)
        player = AVPlayer(playerItem: item)
        let rate = Float(params["rate"] as? Double ?? 1)
        playerEnd = NotificationCenter.default.addObserver(
          forName: .AVPlayerItemDidPlayToEndTime,
          object: item,
          queue: .main
        ) { [weak self] _ in
          self?.finishSpeak(ok: true)
        }
        player?.volume = Float(min(1, params["volume"] as? Double ?? 1))
        player?.play()
        if rate > 0 { player?.rate = rate }
      } else {
        finishSpeak(ok: true)
      }
    case "stopAudio":
      stopPlayback()
      synth.stopSpeaking(at: .immediate)
      finishSpeak(ok: true)
      resolve(id, ["ok": true])
    case "notify":
      Notify.post(title: params["title"] as? String ?? "Phevere", body: params["body"] as? String ?? "")
      resolve(id, ["ok": true])
    case "closeStrip":
      dismiss(animated: true)
      resolve(id, ["ok": true])
    case "expandStrip":
      if let q = params["q"] as? String, !q.isEmpty {
        IncomingStore.text = q
        IncomingStore.origin = "search"
      }
      dismiss(animated: true) {
        NotificationCenter.default.post(name: .phevereExpand, object: nil)
      }
      resolve(id, ["ok": true])
    default:
      fail(id, "Unknown method \(method)")
    }
  }

  private func chooseOcr() {
    let sheet = UIAlertController(title: "Scan text", message: nil, preferredStyle: .actionSheet)
    sheet.addAction(UIAlertAction(title: "Camera", style: .default) { _ in
      guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
        self.fail(self.pendingOcrId, "Camera not available")
        return
      }
      let picker = UIImagePickerController()
      picker.sourceType = .camera
      picker.delegate = self
      self.present(picker, animated: true)
    })
    sheet.addAction(UIAlertAction(title: "Photo", style: .default) { _ in
      var conf = PHPickerConfiguration()
      conf.filter = .images
      conf.selectionLimit = 1
      let picker = PHPickerViewController(configuration: conf)
      picker.delegate = self
      self.present(picker, animated: true)
    })
    sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
      self.fail(self.pendingOcrId, "Cancelled")
    })
    present(sheet, animated: true)
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else {
      fail(pendingOcrId, "No image")
      return
    }
    provider.loadObject(ofClass: UIImage.self) { obj, _ in
      DispatchQueue.main.async {
        self.recognize(obj as? UIImage)
      }
    }
  }

  func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
    picker.dismiss(animated: true)
    fail(pendingOcrId, "Cancelled")
  }

  func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
    picker.dismiss(animated: true)
    recognize(info[.originalImage] as? UIImage)
  }

  private func recognize(_ image: UIImage?) {
    guard let image = image else {
      fail(pendingOcrId, "No image")
      return
    }
    let work = Self.fitted(image, maxEdge: 1600)
    guard let cg = work.cgImage else {
      fail(pendingOcrId, "No image")
      return
    }
    let req = VNRecognizeTextRequest { request, error in
      if let error = error {
        self.fail(self.pendingOcrId, error.localizedDescription)
        return
      }
      let obs = (request.results as? [VNRecognizedTextObservation]) ?? []
      var words: [[String: Any]] = []
      // Vision reports lines; split each into words with their own boxes, as ML Kit does,
      // and number the lines so the page can rebuild spaces and line breaks.
      for (lineNo, o) in obs.enumerated() {
        guard let candidate = o.topCandidates(1).first else { continue }
        let line = candidate.string
        var found = false
        line.enumerateSubstrings(in: line.startIndex..<line.endIndex, options: .byWords) { word, range, _, _ in
          guard let word = word, let box = (try? candidate.boundingBox(for: range))?.boundingBox else { return }
          words.append(["t": word, "x": box.origin.x, "y": 1 - box.origin.y - box.height,
                        "w": box.width, "h": box.height, "l": lineNo])
          found = true
        }
        let whole = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if !found && !whole.isEmpty {
          let b = o.boundingBox
          words.append(["t": whole, "x": b.origin.x, "y": 1 - b.origin.y - b.height, "w": b.width, "h": b.height, "l": lineNo])
        }
      }
      let jpeg = work.jpegData(compressionQuality: 0.78)?.base64EncodedString() ?? ""
      self.resolve(self.pendingOcrId, [
        "jpeg": jpeg,
        "width": Int(work.size.width),
        "height": Int(work.size.height),
        "words": words
      ])
    }
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["en-US", "zh-Hans", "zh-Hant"]
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    DispatchQueue.global(qos: .userInitiated).async {
      try? handler.perform([req])
    }
  }

  private static func fitted(_ image: UIImage, maxEdge: CGFloat) -> UIImage {
    let w = image.size.width
    let h = image.size.height
    let edge = max(w, h)
    if edge <= maxEdge { return image }
    let s = maxEdge / edge
    let size = CGSize(width: w * s, height: h * s)
    UIGraphicsBeginImageContextWithOptions(size, true, 1)
    image.draw(in: CGRect(origin: .zero, size: size))
    let out = UIGraphicsGetImageFromCurrentImageContext() ?? image
    UIGraphicsEndImageContext()
    return out
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    fail(pendingJsId, "Cancelled")
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let url = urls.first else {
      fail(pendingJsId, "Cancelled")
      return
    }
    let _ = url.startAccessingSecurityScopedResource()
    defer { url.stopAccessingSecurityScopedResource() }
    if exportingFile {
      exportingFile = false
      pendingSaveText = ""
      resolve(pendingJsId, ["ok": true])
      return
    }
    do {
      let data = try Data(contentsOf: url)
      resolve(pendingJsId, ["name": url.lastPathComponent, "text": String(data: data, encoding: .utf8) ?? ""])
    } catch {
      fail(pendingJsId, error.localizedDescription)
    }
  }

  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    guard let url = urlSchemeTask.request.url else { return }
    var path = url.path
    if path.isEmpty || path == "/" { path = "/index.html" }
    guard let root = Bundle.main.resourceURL?.appendingPathComponent("public") else {
      urlSchemeTask.didFailWithError(NSError(domain: "phevere", code: 404))
      return
    }
    let file = root.appendingPathComponent(String(path.dropFirst()))
    guard let data = try? Data(contentsOf: file) else {
      urlSchemeTask.didFailWithError(NSError(domain: "phevere", code: 404))
      return
    }
    let mime = Self.mime(file.pathExtension)
    let resp = URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: "utf-8")
    urlSchemeTask.didReceive(resp)
    urlSchemeTask.didReceive(data)
    urlSchemeTask.didFinish()
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    finishSpeak(ok: true)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    finishSpeak(ok: true)
  }

  private func finishSpeak(ok: Bool) {
    guard let id = pendingSpeakId else { return }
    pendingSpeakId = nil
    resolve(id, ["ok": ok])
  }

  private func stopPlayback() {
    player?.pause()
    player = nil
    if let obs = playerEnd {
      NotificationCenter.default.removeObserver(obs)
      playerEnd = nil
    }
  }

  private func pushInsets() {
    let i = view.safeAreaInsets
    let t = stripMode ? 0 : i.top
    let js = "window.__pvInsets={top:\(t),bottom:\(i.bottom),left:\(i.left),right:\(i.right)};"
      + "var s=document.documentElement.style;s.setProperty('--pv-inset-top','\(t)px');"
      + "s.setProperty('--pv-inset-bottom','\(i.bottom)px');s.setProperty('--pv-inset-left','\(i.left)px');"
      + "s.setProperty('--pv-inset-right','\(i.right)px');"
    web?.evaluateJavaScript(js, completionHandler: nil)
  }

  private func resolve(_ id: String?, _ obj: [String: Any]) {
    guard let id = id else { return }
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let json = String(data: data, encoding: .utf8) else { return }
    let js = "window.__pvResolve && window.__pvResolve(\(Self.jsonString(id)), \(Self.jsonString(json)))"
    DispatchQueue.main.async { self.web.evaluateJavaScript(js, completionHandler: nil) }
  }

  private func fail(_ id: String?, _ msg: String) {
    resolve(id, ["error": msg])
  }

  private static func jsonString(_ s: String) -> String {
    let data = try? JSONSerialization.data(withJSONObject: s, options: .fragmentsAllowed)
    return String(data: data ?? Data("\"\"".utf8), encoding: .utf8) ?? "\"\""
  }

  private static func docs() -> URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
  }

  private static func safeName(_ name: String) -> String {
    name.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "..", with: "_")
  }

  private static func readFile(_ name: String) -> Data? {
    try? Data(contentsOf: docs().appendingPathComponent(safeName(name)))
  }

  private static func writeFile(_ name: String, _ data: Data) throws {
    try data.write(to: docs().appendingPathComponent(safeName(name)))
  }

  private static func mime(_ ext: String) -> String {
    switch ext.lowercased() {
    case "html": return "text/html"
    case "js": return "text/javascript"
    case "css": return "text/css"
    case "json": return "application/json"
    case "wasm": return "application/wasm"
    case "png": return "image/png"
    case "svg": return "image/svg+xml"
    case "woff2": return "font/woff2"
    case "woff": return "font/woff"
    default: return "application/octet-stream"
    }
  }

  /**
   * The word, pronounced as its IPA through AVSpeechSynthesisIPANotationAttribute. Slashes
   * and brackets are stripped; Apple's notation does not use them.
   */
  private static func ipaUtterance(ipa: String, word: String) -> AVSpeechUtterance? {
    let clean = ipa.trimmingCharacters(in: CharacterSet(charactersIn: "/[] \t\n"))
    let label = word.isEmpty ? clean : word
    if label.isEmpty { return nil }
    if clean.isEmpty { return AVSpeechUtterance(string: label) }
    let key = NSAttributedString.Key(rawValue: AVSpeechSynthesisIPANotationAttribute)
    return AVSpeechUtterance(attributedString: NSAttributedString(string: label, attributes: [key: clean]))
  }

  /** English voices installed on the phone, best quality first, novelty voices left out. */
  private static func englishVoices() -> [AVSpeechSynthesisVoice] {
    AVSpeechSynthesisVoice.speechVoices()
      .filter { $0.language == "en-US" || $0.language == "en-GB" }
      .filter { voice in
        if #available(iOS 17.0, *) { return !voice.voiceTraits.contains(.isNoveltyVoice) }
        return true
      }
      .sorted { a, b in
        a.quality.rawValue != b.quality.rawValue ? a.quality.rawValue > b.quality.rawValue : a.name < b.name
      }
  }

  /** The chosen voice when it speaks this accent; otherwise the best installed voice for it. */
  private static func voice(for lang: String) -> AVSpeechSynthesisVoice? {
    let chosen = CapturePrefs.speechVoice
    if !chosen.isEmpty, let v = AVSpeechSynthesisVoice(identifier: chosen), v.language == lang { return v }
    return englishVoices().first { $0.language == lang } ?? AVSpeechSynthesisVoice(language: lang)
  }

  private static func voiceStatus() -> [String: Any] {
    var rows: [[String: String]] = [["id": "", "name": "Automatic", "detail": "Best voice per accent"]]
    for v in englishVoices() {
      let accent = v.language == "en-GB" ? "UK" : "US"
      var quality = v.quality == .enhanced ? "Enhanced" : "Default"
      if #available(iOS 16.0, *), v.quality == .premium { quality = "Premium" }
      rows.append(["id": v.identifier, "name": v.name, "detail": "\(accent) · \(quality)"])
    }
    return ["selected": CapturePrefs.speechVoice, "downloading": "", "progress": "", "variants": [], "rows": rows]
  }

  /** Decode in the charset the server declared (GBK, Latin-1…); UTF-8 when it names none. */
  private static func decode(_ bytes: Data, charset: String?) -> String {
    var encoding = String.Encoding.utf8
    if let name = charset {
      let cf = CFStringConvertIANACharSetNameToEncoding(name as CFString)
      if cf != kCFStringEncodingInvalidId {
        encoding = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))
      }
    }
    return String(data: bytes, encoding: encoding) ?? String(decoding: bytes, as: UTF8.self)
  }

  private static func http(_ params: [String: Any], done: @escaping (Result<[String: Any], Error>) -> Void) {
    guard let urlStr = params["url"] as? String, let url = URL(string: urlStr) else {
      done(.failure(NSError(domain: "phevere", code: 400, userInfo: [NSLocalizedDescriptionKey: "bad url"])))
      return
    }
    var req = URLRequest(url: url)
    req.httpMethod = (params["method"] as? String) ?? "GET"
    let timeoutMs = (params["timeoutMs"] as? Double) ?? 8000
    req.timeoutInterval = timeoutMs / 1000.0
    if let headers = params["headers"] as? [String: String] {
      for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
    }
    if let body = params["body"] as? String, req.httpMethod != "GET" {
      req.httpBody = body.data(using: .utf8)
    }
    let asBytes = (params["responseType"] as? String) == "bytes"
    URLSession.shared.dataTask(with: req) { data, resp, err in
      if let err = err { done(.failure(err)); return }
      let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
      let ct = (resp as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? ""
      let bytes = data ?? Data()
      if asBytes {
        done(.success(["status": status, "contentType": ct, "b64": bytes.base64EncodedString()]))
      } else {
        done(.success(["status": status, "contentType": ct, "text": Self.decode(bytes, charset: resp?.textEncodingName)]))
      }
    }.resume()
  }
}
