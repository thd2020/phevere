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

  @objc private func openURL(_ url: URL) {
    var responder: UIResponder? = self
    let selector = NSSelectorFromString("openURL:")
    while let current = responder {
      if current.responds(to: selector) {
        current.perform(selector, with: url)
        return
      }
      responder = current.next
    }
  }

  private func finish() {
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }
}
