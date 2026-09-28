import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    handleShare()
  }

  private func handleShare() {
    guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
      finish(); return
    }
    let providers = item.attachments ?? []
    let textType = UTType.plainText.identifier
    guard let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(textType) }) ?? providers.first else {
      finish(); return
    }
    provider.loadItem(forTypeIdentifier: textType, options: nil) { data, _ in
      let text: String
      if let s = data as? String {
        text = s
      } else if let url = data as? URL {
        text = url.absoluteString
      } else {
        text = ""
      }
      DispatchQueue.main.async {
        self.openLookup(text)
      }
    }
  }

  private func openLookup(_ raw: String) {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty,
          let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
          let url = URL(string: "phevere://lookup?q=\(encoded)") else {
      finish()
      return
    }
    openURL(url)
    finish()
  }

  /**
   * Extensions cannot call UIApplication.open directly, so find the application in the
   * responder chain. iOS 18 ignores the old one-argument openURL:, so call
   * openURL:options:completionHandler: first and keep the old selector for iOS 14 to 17.
   */
  private func openURL(_ url: URL) {
    typealias OpenWithOptions = @convention(c) (AnyObject, Selector, URL, NSDictionary, Any?) -> Void
    let modern = NSSelectorFromString("openURL:options:completionHandler:")
    let legacy = NSSelectorFromString("openURL:")
    var responder: UIResponder? = self
    while let current = responder {
      if current is UIApplication {
        if current.responds(to: modern) {
          let call = unsafeBitCast(current.method(for: modern), to: OpenWithOptions.self)
          call(current, modern, url, NSDictionary(), nil)
          return
        }
        if current.responds(to: legacy) {
          current.perform(legacy, with: url)
          return
        }
      }
      responder = current.next
    }
  }

  private func finish() {
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }
}
