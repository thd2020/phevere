import UIKit
import WebKit
import UniformTypeIdentifiers
import Vision
import PhotosUI

final class PhevereViewController: UIViewController, WKScriptMessageHandler, WKURLSchemeHandler, UIDocumentPickerDelegate, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
  var stripMode = false
  private var web: WKWebView!
  private var pendingJsId: String?
  private var pendingSaveText: String = ""
  private var pendingOcrId: String?
  private var exportingFile = false

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
    web = WKWebView(frame: view.bounds, configuration: conf)
    web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    web.scrollView.contentInsetAdjustmentBehavior = .never
    view.addSubview(web)
    let page = stripMode ? "app://localhost/index.html?mode=strip" : "app://localhost/index.html"
    web.load(URLRequest(url: URL(string: page)!))
  }

  func injectPending() {
    guard let text = IncomingStore.text else { return }
    let origin = IncomingStore.origin ?? "share"
    IncomingStore.text = nil
    let js = "window.__pvIncoming && window.__pvIncoming(\(Self.jsonString(text)), \(Self.jsonString(origin)))"
    web?.evaluateJavaScript(js, completionHandler: nil)
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
          "notificationsGranted": ok
        ])
      }
    case "requestOverlayPermission":
      resolve(id, ["ok": true])
    case "requestNotifications":
      Notify.request { ok in
        self.resolve(id, ["ok": true, "granted": ok])
      }
    case "openNotificationSettings":
      Notify.openSettings()
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
    guard let cg = image?.cgImage else {
      fail(pendingOcrId, "No image")
      return
    }
    let req = VNRecognizeTextRequest { request, error in
      if let error = error {
        self.fail(self.pendingOcrId, error.localizedDescription)
        return
      }
      let obs = (request.results as? [VNRecognizedTextObservation]) ?? []
      let text = obs.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
      self.resolve(self.pendingOcrId, ["text": text])
    }
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["en-US", "zh-Hans", "zh-Hant"]
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    DispatchQueue.global(qos: .userInitiated).async {
      try? handler.perform([req])
    }
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

  private func pushInsets() {
    let t = view.safeAreaInsets.top
    let b = view.safeAreaInsets.bottom
    let js = "window.__pvInsets={top:\(t),bottom:\(b),left:0,right:0};document.documentElement.style.setProperty('--pv-inset-top','\(t)px');document.documentElement.style.setProperty('--pv-inset-bottom','\(b)px');"
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
    default: return "application/octet-stream"
    }
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
        done(.success(["status": status, "contentType": ct, "text": String(data: bytes, encoding: .utf8) ?? ""]))
      }
    }.resume()
  }
}
