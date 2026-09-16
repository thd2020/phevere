import UIKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    if let url = launchOptions?[.url] as? URL {
      capture(url)
    }
    return true
  }

  func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    capture(url)
    NotificationCenter.default.post(name: .phevereIncoming, object: nil)
    return true
  }

  private func capture(_ url: URL) {
    guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
    let q = comps.queryItems?.first(where: { $0.name == "q" || $0.name == "text" })?.value
    if let q = q, !q.isEmpty {
      IncomingStore.text = q
      IncomingStore.origin = "share"
    }
  }
}

final class RootHostController: UIViewController {
  private var full: PhevereViewController?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0.957, green: 0.941, blue: 0.918, alpha: 1)
    if !(CapturePrefs.floatingStrip && IncomingStore.text != nil) {
      showFull()
    }
    NotificationCenter.default.addObserver(self, selector: #selector(onIncoming), name: .phevereIncoming, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(onExpand), name: .phevereExpand, object: nil)
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    if CapturePrefs.floatingStrip, IncomingStore.text != nil, presentedViewController == nil {
      presentStrip()
    }
  }

  private func showFull() {
    if full != nil { return }
    let vc = PhevereViewController()
    vc.stripMode = false
    addChild(vc)
    vc.view.frame = view.bounds
    vc.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(vc.view)
    vc.didMove(toParent: self)
    full = vc
  }

  private func presentStrip() {
    let strip = PhevereViewController()
    strip.stripMode = true
    strip.modalPresentationStyle = .pageSheet
    if #available(iOS 15.0, *) {
      if let sheet = strip.sheetPresentationController {
        if #available(iOS 16.0, *) {
          sheet.detents = [.medium(), .large()]
        }
        sheet.prefersGrabberVisible = true
      }
    }
    present(strip, animated: true)
  }

  @objc private func onIncoming() {
    if let strip = presentedViewController as? PhevereViewController {
      strip.injectPending()
      return
    }
    if CapturePrefs.floatingStrip {
      presentStrip()
    } else {
      full?.injectPending()
    }
  }

  @objc private func onExpand() {
    showFull()
    full?.injectPending()
  }
}
