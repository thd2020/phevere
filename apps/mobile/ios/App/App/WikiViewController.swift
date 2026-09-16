import UIKit
import WebKit

final class WikiViewController: UIViewController, WKNavigationDelegate {
  private let startURL: URL
  private var web: WKWebView!

  init(url: URL) {
    startURL = url
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0.957, green: 0.941, blue: 0.918, alpha: 1)
    let bar = UINavigationBar()
    bar.translatesAutoresizingMaskIntoConstraints = false
    let item = UINavigationItem(title: "Wikipedia")
    item.leftBarButtonItem = UIBarButtonItem(title: "Close", style: .plain, target: self, action: #selector(close))
    bar.setItems([item], animated: false)
    web = WKWebView(frame: .zero)
    web.translatesAutoresizingMaskIntoConstraints = false
    web.navigationDelegate = self
    view.addSubview(bar)
    view.addSubview(web)
    NSLayoutConstraint.activate([
      bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      web.topAnchor.constraint(equalTo: bar.bottomAnchor),
      web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    web.load(URLRequest(url: startURL))
  }

  @objc private func close() { dismiss(animated: true) }
}
