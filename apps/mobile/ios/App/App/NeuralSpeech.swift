import Foundation
import CryptoKit
import UIKit

/**
 * The Neural voices: Kokoro v1.0 through sherpa-onnx, as on Android. Both variants are
 * opt-in downloads; while none is installed and selected, the Apple voices keep speaking.
 */
enum NeuralVariant: String, CaseIterable {
  /// Same voices; the compact one stores weights as int8 (about a third of the size).
  case compact, full

  var dir: String { self == .compact ? "kokoro-int8-v1-sherpa-1.13.3" : "kokoro-v1-sherpa-1.13.3" }
  var archiveDir: String { self == .compact ? "kokoro-int8-multi-lang-v1_0" : "kokoro-multi-lang-v1_0" }
  var model: String { self == .compact ? "model.int8.onnx" : "model.onnx" }
  var sha: String {
    self == .compact
      ? "4c3052abaa60943a341f193888cf6abd68787dae6ab8ae5c925a706caa247e4e"
      : "c5f7e2d2caf082bc1d20fb70334a61d99d20b484500aad32e7cf84c128ea3298"
  }
  var downloadMb: Int64 { self == .compact ? 132 : 350 }
  var freeMb: Int64 { self == .compact ? 500 : 1000 }
  var url: URL {
    URL(string: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/\(archiveDir).tar.bz2")!
  }
}

struct NeuralSpeechError: LocalizedError {
  let message: String
  /// Retrying cannot help, so the download stops at once.
  var fatal = false
  init(_ message: String, fatal: Bool = false) {
    self.message = message
    self.fatal = fatal
  }
  var errorDescription: String? { message }
}

/** Downloads, verifies and installs the voices; the state feeds Settings, Audio. */
enum NeuralModels {
  private static let lock = NSLock()
  private static var downloading: NeuralVariant?
  private static var cancelled = false
  private static var progress = ""
  private static var doneMb: Int64 = 0
  private static let fm = FileManager.default

  /// Application Support/speech, kept out of iCloud backups like Android's no-backup folder.
  static var base: URL {
    var dir = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("speech", isDirectory: true)
    try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? dir.setResourceValues(values)
    return dir
  }

  static func root(_ v: NeuralVariant) -> URL { base.appendingPathComponent(v.dir, isDirectory: true) }

  static func ready(_ v: NeuralVariant) -> Bool {
    let root = root(v)
    return [".ready", v.model, "voices.bin"].allSatisfy { fm.fileExists(atPath: root.appendingPathComponent($0).path) }
  }

  /// The selected Neural voice when it is installed; nil means the Apple voices speak.
  static func active() -> NeuralVariant? {
    guard let v = NeuralVariant(rawValue: CapturePrefs.speechVoice), ready(v) else { return nil }
    return v
  }

  /// The download fields of the voice status, in Android's shape.
  static func status() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    return [
      "downloading": downloading?.rawValue ?? "",
      "progress": progress,
      "doneMb": downloading == nil ? 0 : doneMb,
      "variants": NeuralVariant.allCases.map { ["id": $0.rawValue, "mb": $0.downloadMb, "ready": ready($0)] as [String: Any] },
    ]
  }

  /// A Neural voice that is not installed yet downloads first and is selected once ready.
  static func choose(_ id: String) {
    if let v = NeuralVariant(rawValue: id), !ready(v) {
      start(v)
    } else {
      CapturePrefs.speechVoice = id
    }
  }

  static func cancel() {
    lock.lock()
    cancelled = true
    lock.unlock()
  }

  private static var isCancelled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelled
  }

  private static func checkCancelled() throws {
    if isCancelled { throw NeuralSpeechError("Cancelled") }
  }

  private static func report(_ text: String, mb: Int64? = nil) {
    lock.lock()
    progress = text
    if let mb = mb { doneMb = mb }
    lock.unlock()
  }

  private static func start(_ v: NeuralVariant) {
    lock.lock()
    if downloading != nil || ready(v) {
      lock.unlock()
      return
    }
    downloading = v
    cancelled = false
    doneMb = 0
    progress = "Connecting…"
    lock.unlock()
    // A worker outside the view controller lets closing Settings leave the download running.
    DispatchQueue.global(qos: .utility).async { install(v) }
  }

  private static func install(_ v: NeuralVariant) {
    let background = BackgroundTime()
    let archive = base.appendingPathComponent(v.dir + ".download")
    let staging = base.appendingPathComponent(v.dir + ".staging", isDirectory: true)
    var message: String
    do {
      let free = (try? base.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?
        .volumeAvailableCapacityForImportantUsage ?? Int64.max
      if free < v.freeMb * 1_000_000 { throw NeuralSpeechError("Free \(v.freeMb) MB of storage, then try again.") }
      remove(staging)
      try fetch(v, to: archive)
      report("Verifying…")
      if try sha256(archive) != v.sha {
        remove(archive)
        throw NeuralSpeechError("Download verification failed. Please retry.")
      }
      report("Installing voice…")
      try TarBz2.extract(archive, into: staging, check: checkCancelled)
      let model = staging.appendingPathComponent(v.archiveDir, isDirectory: true)
      for name in [v.model, "voices.bin", "tokens.txt", "lexicon-us-en.txt", "lexicon-zh.txt", "LICENSE"]
      where !fm.fileExists(atPath: model.appendingPathComponent(name).path) {
        throw NeuralSpeechError("Incomplete voice download.")
      }
      try checkCancelled()
      // The ready marker is written only after the complete, verified folder is in place.
      remove(root(v))
      try fm.moveItem(at: model, to: root(v))
      try Data([1]).write(to: root(v).appendingPathComponent(".ready"))
      CapturePrefs.speechVoice = v.rawValue
      message = "Voice downloaded"
      remove(archive)
    } catch {
      // A dropped connection keeps the partial archive, so the next try resumes it.
      if isCancelled { remove(archive) }
      message = isCancelled ? "Download cancelled." : "Could not download voice: \(error.localizedDescription)"
    }
    remove(staging)
    lock.lock()
    downloading = nil
    progress = message
    lock.unlock()
    background.end()
  }

  /**
   * Downloads the archive, resuming with an HTTP range after a dropped connection.
   * Phones on slow or filtered networks rarely fetch a few hundred MB in one go.
   */
  private static func fetch(_ v: NeuralVariant, to archive: URL) throws {
    var last: Error = NeuralSpeechError("Download failed")
    for attempt in 1...8 {
      try checkCancelled()
      let have = ((try? fm.attributesOfItem(atPath: archive.path))?[.size] as? NSNumber)?.int64Value ?? 0
      var request = URLRequest(url: v.url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
      if have > 0 { request.setValue("bytes=\(have)-", forHTTPHeaderField: "Range") }
      let transfer = ArchiveTransfer(
        file: archive, have: have, limit: (v.downloadMb + 50) * 1_000_000,
        isCancelled: { isCancelled },
        onProgress: { total in
          let mb = total / 1_000_000
          report("Downloading: \(mb) / \(v.downloadMb) MB", mb: mb)
        })
      do {
        try transfer.run(request)
        return
      } catch {
        if isCancelled || (error as? NeuralSpeechError)?.fatal == true { throw error }
        last = error
        lock.lock()
        progress = "Reconnecting: \(doneMb) / \(v.downloadMb) MB"
        lock.unlock()
        var waited = 0.0
        while waited < min(30, 2 * Double(attempt * attempt)) {
          try checkCancelled()
          Thread.sleep(forTimeInterval: 0.5)
          waited += 0.5
        }
      }
    }
    throw last
  }

  private static func sha256(_ file: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: file)
    defer { handle.closeFile() }
    var hash = SHA256()
    while true {
      try checkCancelled()
      let chunk = autoreleasepool { handle.readData(ofLength: 1 << 20) }
      if chunk.isEmpty { break }
      hash.update(data: chunk)
    }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
  }

  private static func remove(_ url: URL) {
    try? fm.removeItem(at: url)
  }
}

/** Asks iOS for extra running time so a short trip out of the app does not drop the download. */
private final class BackgroundTime {
  private var task = UIBackgroundTaskIdentifier.invalid

  init() {
    DispatchQueue.main.async {
      self.task = UIApplication.shared.beginBackgroundTask(withName: "voice-download") { self.end() }
    }
  }

  func end() {
    DispatchQueue.main.async {
      guard self.task != .invalid else { return }
      UIApplication.shared.endBackgroundTask(self.task)
      self.task = .invalid
    }
  }
}

/** One HTTP attempt, written straight to the partial archive; blocks the calling worker. */
private final class ArchiveTransfer: NSObject, URLSessionDataDelegate {
  private let file: URL
  private let have: Int64
  private let limit: Int64
  private let isCancelled: () -> Bool
  private let onProgress: (Int64) -> Void
  private var handle: FileHandle?
  private var total: Int64 = 0
  private var failure: Error?
  private var complete = false
  private let done = DispatchSemaphore(value: 0)

  init(file: URL, have: Int64, limit: Int64, isCancelled: @escaping () -> Bool, onProgress: @escaping (Int64) -> Void) {
    self.file = file
    self.have = have
    self.limit = limit
    self.isCancelled = isCancelled
    self.onProgress = onProgress
  }

  func run(_ request: URLRequest) throws {
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = 60
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.urlCache = nil
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    let session = URLSession(configuration: config, delegate: self, delegateQueue: queue)
    session.dataTask(with: request).resume()
    done.wait()
    session.invalidateAndCancel()
    handle?.closeFile()
    handle = nil
    if let failure = failure { throw failure }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                  completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    let code = (response as? HTTPURLResponse)?.statusCode ?? 0
    if have > 0 && code == 416 {
      complete = true  // already complete; the checksum decides
      completionHandler(.cancel)
      return
    }
    let append = have > 0 && code == 206
    guard code == 200 || append else {
      failure = NeuralSpeechError("HTTP \(code)")
      completionHandler(.cancel)
      return
    }
    if !append || !FileManager.default.fileExists(atPath: file.path) {
      FileManager.default.createFile(atPath: file.path, contents: nil)
    }
    do {
      let h = try FileHandle(forWritingTo: file)
      h.seekToEndOfFile()
      handle = h
      total = append ? have : 0
      completionHandler(.allow)
    } catch {
      failure = error
      completionHandler(.cancel)
    }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard failure == nil, let handle = handle else { return }
    if isCancelled() {
      failure = NeuralSpeechError("Cancelled")
      dataTask.cancel()
      return
    }
    total += Int64(data.count)
    if total > limit {
      try? FileManager.default.removeItem(at: file)
      failure = NeuralSpeechError("Unexpected download size.", fatal: true)
      dataTask.cancel()
      return
    }
    if #available(iOS 13.4, *) {
      do {
        try handle.write(contentsOf: data)
      } catch {
        failure = error
        dataTask.cancel()
        return
      }
    } else {
      handle.write(data)
    }
    onProgress(total)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if failure == nil, !complete, let error = error { failure = error }
    done.signal()
  }
}

/**
 * Unpacks a .tar.bz2 with libbz2 from the iOS SDK and a small ustar reader. Only regular
 * files and folders are accepted, and no path may leave the target folder.
 */
enum TarBz2 {
  static func extract(_ archive: URL, into target: URL, check: () throws -> Void) throws {
    let fm = FileManager.default
    try fm.createDirectory(at: target, withIntermediateDirectories: true)
    let inside = target.standardizedFileURL.path + "/"
    let input = try Bzip2Stream(archive)
    let size = 1 << 16
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: size)
    defer { buffer.deallocate() }

    func readFully(_ count: Int) throws {
      if try input.read(buffer, count) < count { throw NeuralSpeechError("The voice archive is truncated.") }
    }
    func skipPadding(_ count: Int64) throws {
      let pad = Int((512 - count % 512) % 512)
      if pad > 0 { try readFully(pad) }
    }
    func readData(_ count: Int64) throws -> Data {
      var out = Data()
      var left = count
      while left > 0 {
        let n = Int(min(left, Int64(size)))
        try readFully(n)
        out.append(buffer, count: n)
        left -= Int64(n)
      }
      try skipPadding(count)
      return out
    }

    var overrideName: String?
    var total: Int64 = 0
    while true {
      try check()
      try readFully(512)
      let header = Data(bytes: buffer, count: 512)
      if header.allSatisfy({ $0 == 0 }) { break }  // end-of-archive blocks
      let type = header[156]
      let length = octal(header, 124, 12)
      let name = overrideName ?? headerName(header)
      overrideName = nil
      switch type {
      case UInt8(ascii: "L"), UInt8(ascii: "x"), UInt8(ascii: "g"):
        // GNU long names and pax headers describe the entry that follows.
        guard length < 1 << 20 else { throw NeuralSpeechError("Unsupported model entry.") }
        let body = try readData(length)
        if type == UInt8(ascii: "L") {
          overrideName = String(decoding: body.prefix { $0 != 0 }, as: UTF8.self)
        } else if type == UInt8(ascii: "x") {
          overrideName = paxPath(body)
        }
        continue
      case UInt8(ascii: "5"), 0, UInt8(ascii: "0"), UInt8(ascii: "7"):
        break
      default:
        throw NeuralSpeechError("Unsupported model entry.")
      }
      var relative = name
      while relative.hasPrefix("./") { relative.removeFirst(2) }
      if relative.isEmpty || relative == "." {
        if type != UInt8(ascii: "5") { _ = try readData(length) }
        continue
      }
      if relative.hasPrefix("/") || relative.split(separator: "/").contains("..") {
        throw NeuralSpeechError("Invalid model path.")
      }
      let dest = target.appendingPathComponent(relative)
      guard dest.standardizedFileURL.path.hasPrefix(inside) else { throw NeuralSpeechError("Invalid model path.") }
      if type == UInt8(ascii: "5") {
        try fm.createDirectory(at: dest, withIntermediateDirectories: true)
        continue
      }
      total += length
      if total > 600_000_000 { throw NeuralSpeechError("Unexpected model size.") }
      try fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
      guard fm.createFile(atPath: dest.path, contents: nil) else { throw NeuralSpeechError("Could not install voice.") }
      let out = try FileHandle(forWritingTo: dest)
      defer { out.closeFile() }
      var left = length
      while left > 0 {
        try check()
        let n = Int(min(left, Int64(size)))
        try readFully(n)
        autoreleasepool { out.write(Data(bytes: buffer, count: n)) }
        left -= Int64(n)
      }
      try skipPadding(length)
    }
  }

  private static func field(_ header: Data, _ offset: Int, _ count: Int) -> String {
    let bytes = header[offset..<(offset + count)].prefix { $0 != 0 }
    return String(decoding: bytes, as: UTF8.self)
  }

  private static func headerName(_ header: Data) -> String {
    let name = field(header, 0, 100)
    guard field(header, 257, 5) == "ustar" else { return name }
    let prefix = field(header, 345, 155)
    return prefix.isEmpty ? name : prefix + "/" + name
  }

  private static func octal(_ header: Data, _ offset: Int, _ count: Int) -> Int64 {
    var value: Int64 = 0
    for byte in header[offset..<(offset + count)] {
      if byte >= UInt8(ascii: "0") && byte <= UInt8(ascii: "7") {
        value = value * 8 + Int64(byte - UInt8(ascii: "0"))
      } else if byte == 0 || (byte == UInt8(ascii: " ") && value > 0) {
        break
      }
    }
    return value
  }

  /// The "path" record of a pax header ("<length> path=<name>\n").
  private static func paxPath(_ body: Data) -> String? {
    for line in String(decoding: body, as: UTF8.self).split(separator: "\n") {
      guard let space = line.firstIndex(of: " ") else { continue }
      let record = line[line.index(after: space)...]
      if record.hasPrefix("path=") { return String(record.dropFirst(5)) }
    }
    return nil
  }
}

/** Streams a bzip2 file, including several concatenated streams, through libbz2. */
private final class Bzip2Stream {
  private var stream = bz_stream()
  private let handle: FileHandle
  private let inputSize = 1 << 16
  private let input: UnsafeMutablePointer<CChar>
  private var open = false
  private var atEnd = false

  init(_ url: URL) throws {
    handle = try FileHandle(forReadingFrom: url)
    input = .allocate(capacity: inputSize)
    guard BZ2_bzDecompressInit(&stream, 0, 0) == BZ_OK else {
      input.deallocate()
      handle.closeFile()
      throw NeuralSpeechError("Could not open the voice archive.")
    }
    open = true
  }

  deinit {
    if open { BZ2_bzDecompressEnd(&stream) }
    input.deallocate()
    handle.closeFile()
  }

  /// Returns false when the file has no more bytes.
  private func refill() -> Bool {
    let chunk = autoreleasepool { handle.readData(ofLength: inputSize) }
    if chunk.isEmpty { return false }
    chunk.copyBytes(to: UnsafeMutableRawPointer(input).assumingMemoryBound(to: UInt8.self), count: chunk.count)
    stream.next_in = input
    stream.avail_in = UInt32(chunk.count)
    return true
  }

  /// Reads up to count bytes; fewer only at the end of the data.
  func read(_ buffer: UnsafeMutablePointer<UInt8>, _ count: Int) throws -> Int {
    var produced = 0
    while produced < count && !atEnd {
      if stream.avail_in == 0 && !refill() { throw NeuralSpeechError("The voice archive is truncated.") }
      stream.next_out = UnsafeMutableRawPointer(buffer + produced).assumingMemoryBound(to: CChar.self)
      stream.avail_out = UInt32(count - produced)
      let rc = BZ2_bzDecompress(&stream)
      produced = count - Int(stream.avail_out)
      if rc == BZ_STREAM_END {
        // Another stream may follow; its first bytes can already sit in the input buffer.
        let leftover = stream.next_in
        let leftCount = stream.avail_in
        BZ2_bzDecompressEnd(&stream)
        open = false
        stream = bz_stream()
        guard BZ2_bzDecompressInit(&stream, 0, 0) == BZ_OK else { throw NeuralSpeechError("The voice archive is damaged.") }
        open = true
        if leftCount > 0 {
          stream.next_in = leftover
          stream.avail_in = leftCount
        } else if !refill() {
          atEnd = true
        }
      } else if rc != BZ_OK {
        throw NeuralSpeechError("The voice archive is damaged.")
      }
    }
    return produced
  }
}

/** Speaks with Kokoro through sherpa-onnx's official Swift wrapper; one engine stays loaded. */
final class KokoroVoice {
  static let shared = KokoroVoice()
  private let queue = DispatchQueue(label: "com.phevere.kokoro", qos: .userInitiated)
  private var engine: SherpaOnnxOfflineTtsWrapper?
  private var engineModel = ""
  private var lastWave: URL?

  /// Renders the text to a WAV file; nil when the engine could not voice it.
  func synthesize(_ text: String, lang: String, rate: Double, variant: NeuralVariant, done: @escaping (URL?) -> Void) {
    queue.async {
      let wave = self.render(text, lang: lang, rate: rate, variant: variant)
      DispatchQueue.main.async { done(wave) }
    }
  }

  private func render(_ text: String, lang: String, rate: Double, variant: NeuralVariant) -> URL? {
    let root = NeuralModels.root(variant)
    let model = root.appendingPathComponent(variant.model).path
    if engineModel != model { engine = nil }  // switched between compact and full
    if engine == nil {
      let kokoro = sherpaOnnxOfflineTtsKokoroModelConfig(
        model: model,
        voices: root.appendingPathComponent("voices.bin").path,
        tokens: root.appendingPathComponent("tokens.txt").path,
        dataDir: root.appendingPathComponent("espeak-ng-data").path,
        lexicon: root.appendingPathComponent("lexicon-us-en.txt").path + ","
          + root.appendingPathComponent("lexicon-zh.txt").path
      )
      let modelConfig = sherpaOnnxOfflineTtsModelConfig(kokoro: kokoro, numThreads: 2)
      var config = sherpaOnnxOfflineTtsConfig(model: modelConfig)
      let tts = SherpaOnnxOfflineTtsWrapper(config: &config)
      guard tts.tts != nil else { return nil }
      engine = tts
      engineModel = model
    }
    guard let engine = engine else { return nil }
    let chinese = lang.hasPrefix("zh") || text.unicodeScalars.contains { $0.value >= 0x3400 && $0.value <= 0x9fff }
    let speaker = chinese ? 45 : lang.caseInsensitiveCompare("en-GB") == .orderedSame ? 20 : 0
    let audio = engine.generate(text: text, sid: speaker, speed: Float(min(2, max(0.5, rate))))
    guard audio.n > 0 else { return nil }
    if let old = lastWave { try? FileManager.default.removeItem(at: old) }
    let wave = FileManager.default.temporaryDirectory.appendingPathComponent("speech-\(UUID().uuidString).wav")
    guard audio.save(filename: wave.path) == 1 else { return nil }
    lastWave = wave
    return wave
  }
}
