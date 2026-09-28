import UIKit
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  var window: UIWindow?

  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    if let url = launchOptions?[.url] as? URL {
      capture(url)
    }
    return true
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    if #available(iOS 14.0, *) {
      completionHandler([.banner, .sound, .list])
    } else {
      completionHandler([.alert, .sound])
    }
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

final class RootHostController: UIViewController, UIPopoverPresentationControllerDelegate {
  private var full: PhevereViewController?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0.957, green: 0.941, blue: 0.918, alpha: 1)
    showFull()
    NotificationCenter.default.addObserver(self, selector: #selector(onIncoming), name: .phevereIncoming, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(onExpand), name: .phevereExpand, object: nil)
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    if IncomingStore.text != nil, presentedViewController == nil {
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

  /**
   * The pop-up, as on Android: with "Floating pop-up" on, a compact card beside the selected
   * word (centred when the position is unknown, e.g. text from the share sheet); otherwise a
   * bottom sheet. Each new selection replaces the card so it moves next to that word.
   */
  func presentStrip(anchor: CGRect? = nil, in source: UIView? = nil) {
    if let open = presentedViewController as? PhevereViewController {
      if !CapturePrefs.floatingStrip || anchor == nil {
        open.injectPending()
        return
      }
      open.dismiss(animated: false)
    }
    let strip = PhevereViewController()
    strip.stripMode = true
    if CapturePrefs.floatingStrip {
      strip.modalPresentationStyle = .popover
      let bounds = view.bounds
      strip.preferredContentSize = CGSize(width: min(360, bounds.width - 16), height: min(460, bounds.height * 0.6))
      if let pop = strip.popoverPresentationController {
        pop.delegate = self
        if let anchor = anchor, let source = source {
          pop.sourceView = source
          pop.sourceRect = anchor
          pop.permittedArrowDirections = [.up, .down]
        } else {
          pop.sourceView = view
          pop.sourceRect = CGRect(x: bounds.midX, y: bounds.midY, width: 1, height: 1)
          pop.permittedArrowDirections = []
        }
      }
    } else {
      strip.modalPresentationStyle = .pageSheet
      if #available(iOS 15.0, *), let sheet = strip.sheetPresentationController {
        sheet.detents = [.medium(), .large()]
        sheet.prefersGrabberVisible = true
      }
    }
    present(strip, animated: true)
  }

  /** Keep the floating card a popover on iPhone instead of turning it into a sheet. */
  func adaptivePresentationStyle(for controller: UIPresentationController, traitCollection: UITraitCollection) -> UIModalPresentationStyle {
    .none
  }

  @objc private func onIncoming() {
    presentStrip()
  }

  @objc private func onExpand() {
    showFull()
    full?.injectPending()
  }
}
