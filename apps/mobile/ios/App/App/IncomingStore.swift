import UIKit
import UserNotifications

enum IncomingStore {
  static var text: String?
  static var origin: String?
}

enum CapturePrefs {
  static var floatingStrip: Bool {
    get { UserDefaults.standard.bool(forKey: "floatingStrip") }
    set { UserDefaults.standard.set(newValue, forKey: "floatingStrip") }
  }
  /** Selecting text inside Phevere opens the pop-up without the edit menu's Phevere item. */
  static var autoPopup: Bool {
    get { UserDefaults.standard.bool(forKey: "autoPopup") }
    set { UserDefaults.standard.set(newValue, forKey: "autoPopup") }
  }
  /** AVSpeechSynthesisVoice identifier; empty means the best installed voice per accent. */
  static var speechVoice: String {
    get { UserDefaults.standard.string(forKey: "speechVoice") ?? "" }
    set { UserDefaults.standard.set(newValue, forKey: "speechVoice") }
  }
}

enum Notify {
  static func granted(_ done: @escaping (Bool) -> Void) {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      let ok = settings.authorizationStatus == .authorized
        || settings.authorizationStatus == .provisional
        || settings.authorizationStatus == .ephemeral
      DispatchQueue.main.async { done(ok) }
    }
  }

  static func request(_ done: @escaping (Bool) -> Void) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { ok, _ in
      DispatchQueue.main.async { done(ok) }
    }
  }

  static func openSettings() {
    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
    UIApplication.shared.open(url)
  }

  static func post(title: String, body: String) {
    let c = UNMutableNotificationContent()
    c.title = title.isEmpty ? "Phevere" : title
    c.body = body
    let req = UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil)
    UNUserNotificationCenter.current().add(req)
  }
}

extension Notification.Name {
  static let phevereIncoming = Notification.Name("phevereIncoming")
  static let phevereExpand = Notification.Name("phevereExpand")
}
