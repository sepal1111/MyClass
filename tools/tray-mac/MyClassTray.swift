// MyClass 選單列程式（macOS）
// 在背景隱藏啟動伺服器（system/MyClassV* --background），並在螢幕右上角選單列顯示圖示與選單。
// 對應 Windows 版的 tools/tray/MyClassTray.cs，功能相同。以 macOS 內建的 swiftc 編譯，不需要 Xcode。
//
// 參數：
//   (無)         開啟選單列程式；第一次啟動時自動開啟瀏覽器
//   --autostart  登入時自動啟動用：只在背景執行，不開瀏覽器
import AppKit
import Foundation

// MARK: - 路徑

/// 資料夾最上層：MyClass.app 所在的資料夾（bin/ 與 system/ 都在這裡）。
let baseDir: URL = Bundle.main.bundleURL.deletingLastPathComponent()
let binDir = baseDir.appendingPathComponent("bin")
let logDir = binDir.appendingPathComponent("logs")
let autostart = CommandLine.arguments.contains("--autostart")

// MARK: - 伺服器資訊（bin/runtime.json）

struct RuntimeInfo {
    var pid: Int32
    var port: Int
    var token: String
    var localURL: String
    var lanURL: String
}

enum Runtime {
    static func read() -> RuntimeInfo? {
        guard let data = try? Data(contentsOf: binDir.appendingPathComponent("runtime.json")),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let pid = obj["pid"] as? Int, let port = obj["port"] as? Int,
              let token = obj["token"] as? String, let local = obj["local_url"] as? String
        else { return nil }
        return RuntimeInfo(pid: Int32(pid), port: port, token: token, localURL: local, lanURL: (obj["lan_url"] as? String) ?? "")
    }

    static func isAlive(_ pid: Int32) -> Bool { kill(pid, 0) == 0 || errno == EPERM }

    static func openBrowser(_ url: String) {
        if let u = URL(string: url) { NSWorkspace.shared.open(u) }
    }

    /// 請伺服器自己收尾（只連 127.0.0.1 的自簽憑證，所以略過憑證檢查）。
    static func requestShutdown(_ info: RuntimeInfo) {
        guard let url = URL(string: "https://127.0.0.1:\(info.port)/api/system/shutdown") else { return }
        var req = URLRequest(url: url, timeoutInterval: 3)
        req.httpMethod = "POST"
        req.setValue(info.token, forHTTPHeaderField: "x-myclass-token")
        let sem = DispatchSemaphore(value: 0)
        let session = URLSession(configuration: .ephemeral, delegate: TrustLocalhost(), delegateQueue: nil)
        session.dataTask(with: req) { _, _, _ in sem.signal() }.resume()
        _ = sem.wait(timeout: .now() + 4)
        session.invalidateAndCancel()
    }

    /// 安全關閉伺服器：先請它自己收尾，等不到再強制結束。
    static func stopServer() {
        guard let info = read() else { return }
        requestShutdown(info)
        for _ in 0..<20 where isAlive(info.pid) { Thread.sleep(forTimeInterval: 0.25) }
        if isAlive(info.pid) { kill(info.pid, SIGKILL) }
    }
}

final class TrustLocalhost: NSObject, URLSessionDelegate {
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}

// MARK: - 開機（登入）自動啟動：~/Library/LaunchAgents

enum Autostart {
    static let label = "tw.myclass.tray"
    static var plistURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/\(label).plist")
    }
    static var command: [String] { [Bundle.main.executablePath ?? "", "--autostart"] }

    static var isEnabled: Bool { FileManager.default.fileExists(atPath: plistURL.path) }

    static func write() {
        let plist: [String: Any] = ["Label": label, "ProgramArguments": command, "RunAtLoad": true]
        guard let data = try? PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0) else { return }
        try? FileManager.default.createDirectory(at: plistURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: plistURL)
    }

    static func toggle() {
        if isEnabled { try? FileManager.default.removeItem(at: plistURL) } else { write() }
    }

    /// 可攜版的更新方式是「換一個新資料夾、把 bin 複製過去」。登入自動啟動若還指向舊資料夾，
    /// 下次登入就會跑舊版。所以老師手動開啟這一份時，若已設定自動啟動但指向別處，就改成指向自己。
    static func repoint() {
        guard isEnabled,
              let data = try? Data(contentsOf: plistURL),
              let obj = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              let args = obj["ProgramArguments"] as? [String], args != command else { return }
        write()
    }
}

// MARK: - 選單列

final class TrayController: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let statusLine = NSMenuItem(title: "啟動中…", action: nil, keyEquivalent: "")
    private let autostartItem = NSMenuItem(title: "登入時自動啟動", action: nil, keyEquivalent: "")
    private var timer: Timer?
    private var server: Process?
    private var info: RuntimeInfo?
    private var quitting = false
    private var firstOpenDone = false
    private var gaveUp = false
    private var restartCount = 0
    private var restartWindow = Date.distantPast
    private let logQueue = DispatchQueue(label: "myclass.log")

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        if !autostart { Autostart.repoint() }
        startServer()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        // 登出、關機時也一併關閉伺服器
        if !quitting { Runtime.stopServer() }
    }

    // MARK: 選單

    private func buildMenu() {
        let menu = NSMenu()
        menu.delegate = self
        statusLine.isEnabled = false
        menu.addItem(statusLine)
        menu.addItem(.separator())
        menu.addItem(item("開啟 MyClass", #selector(openApp), bold: true))
        menu.addItem(item("複製學生連線網址（區網）", #selector(copyLanURL)))
        menu.addItem(.separator())
        menu.addItem(item("開啟檔案資料夾（學生上傳的檔案）", #selector(openUploads)))
        menu.addItem(item("開啟資料資料夾（bin）", #selector(openBin)))
        menu.addItem(item("開啟執行記錄", #selector(openLogs)))
        menu.addItem(item("開啟資料庫備份資料夾（升級前自動備份）", #selector(openBackups)))
        menu.addItem(.separator())
        autostartItem.target = self
        autostartItem.action = #selector(toggleAutostart)
        menu.addItem(autostartItem)
        menu.addItem(item("重新啟動伺服器", #selector(restartServer)))
        menu.addItem(.separator())
        menu.addItem(item("結束 MyClass", #selector(quit)))
        statusItem.menu = menu

        if let button = statusItem.button {
            if let path = Bundle.main.path(forResource: "MyClass", ofType: "icns"), let img = NSImage(contentsOfFile: path) {
                img.size = NSSize(width: 18, height: 18)
                button.image = img
            } else {
                button.title = "MyClass"
            }
            button.toolTip = "MyClass 啟動中…"
        }
    }

    private func item(_ title: String, _ action: Selector, bold: Bool = false) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: action, keyEquivalent: "")
        it.target = self
        if bold { it.attributedTitle = NSAttributedString(string: title, attributes: [.font: NSFont.boldSystemFont(ofSize: NSFont.systemFontSize)]) }
        return it
    }

    func menuWillOpen(_ menu: NSMenu) {
        if let i = info { statusLine.title = "● 執行中　\(i.localURL)" } else { statusLine.title = gaveUp ? "○ 已停止" : "… 啟動中" }
        autostartItem.state = Autostart.isEnabled ? .on : .off
    }

    // MARK: 記錄

    private func log(_ line: String) {
        logQueue.async {
            try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
            let path = logDir.appendingPathComponent("server.log")
            if let size = (try? FileManager.default.attributesOfItem(atPath: path.path))?[.size] as? Int, size > 2 * 1024 * 1024 {
                let old = logDir.appendingPathComponent("server.1.log")
                try? FileManager.default.removeItem(at: old)
                try? FileManager.default.moveItem(at: path, to: old)
            }
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd HH:mm:ss"
            let text = "\(f.string(from: Date()))  \(line)\n"
            if let h = try? FileHandle(forWritingTo: path) {
                h.seekToEndOfFile()
                h.write(text.data(using: .utf8)!)
                try? h.close()
            } else {
                try? text.write(to: path, atomically: false, encoding: .utf8)
            }
        }
    }

    // MARK: 伺服器

    /// 伺服器執行檔放在 system/ 裡（MyClassV<版本>）。
    private func findServerExe() -> URL? {
        let dir = baseDir.appendingPathComponent("system")
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey, .isDirectoryKey])) ?? []
        return files
            .filter { $0.lastPathComponent.hasPrefix("MyClassV") && !((try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false) }
            .sorted {
                let a = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                let b = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                return a > b
            }.first
    }

    private func alert(_ message: String) {
        let a = NSAlert()
        a.messageText = "MyClass"
        a.informativeText = message
        a.alertStyle = .warning
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }

    private func startServer() {
        gaveUp = false
        guard let exe = findServerExe() else {
            alert("找不到伺服器程式（system 資料夾裡的 MyClassV*）。請確認 MyClass 和 system 資料夾放在同一個資料夾，或重新下載 MyClass。")
            NSApp.terminate(nil)
            return
        }

        // 資料夾裡已經有另一個伺服器在跑（例如先前沒關乾淨）：沿用它，不重複啟動
        if let existing = Runtime.read(), Runtime.isAlive(existing.pid) {
            info = existing
            server = nil
            log("沿用既有的伺服器 pid=\(existing.pid)")
            return
        }

        // 從網路下載或 AirDrop 的檔案會帶隔離屬性，先清掉才不會被 Gatekeeper 擋下
        let x = Process()
        x.executableURL = URL(fileURLWithPath: "/usr/bin/xattr")
        x.arguments = ["-dr", "com.apple.quarantine", baseDir.appendingPathComponent("system").path]
        x.standardError = FileHandle.nullDevice
        try? x.run()
        x.waitUntilExit()

        let p = Process()
        p.executableURL = exe
        p.arguments = ["--background"]
        p.currentDirectoryURL = baseDir
        let out = Pipe(), err = Pipe()
        p.standardOutput = out
        p.standardError = err
        out.fileHandleForReading.readabilityHandler = { [weak self] h in
            let d = h.availableData
            if d.isEmpty { h.readabilityHandler = nil; return }
            String(decoding: d, as: UTF8.self).split(whereSeparator: \.isNewline).forEach { self?.log(String($0)) }
        }
        err.fileHandleForReading.readabilityHandler = { [weak self] h in
            let d = h.availableData
            if d.isEmpty { h.readabilityHandler = nil; return }
            String(decoding: d, as: UTF8.self).split(whereSeparator: \.isNewline).forEach { self?.log("[stderr] \($0)") }
        }
        do {
            info = nil
            try p.run()
            server = p
            log("啟動伺服器 \(exe.lastPathComponent) pid=\(p.processIdentifier)")
        } catch {
            log("啟動失敗：\(error.localizedDescription)")
            gaveUp = true
            alert("伺服器無法啟動：\(error.localizedDescription)")
        }
    }

    private func tick() {
        if quitting { return }

        if info == nil, let r = Runtime.read(), (server == nil ? Runtime.isAlive(r.pid) : r.pid == server!.processIdentifier) {
            info = r
            statusItem.button?.toolTip = "MyClass 執行中（埠 \(r.port)）"
            if !firstOpenDone {
                firstOpenDone = true
                if !autostart { Runtime.openBrowser(r.localURL) }
            }
        }

        let dead = server != nil ? !server!.isRunning : (info != nil && !Runtime.isAlive(info!.pid))
        if dead && !gaveUp {
            log("伺服器已結束，準備重新啟動")
            info = nil
            let now = Date()
            if now.timeIntervalSince(restartWindow) > 60 { restartWindow = now; restartCount = 0 }
            restartCount += 1
            if restartCount > 3 {
                gaveUp = true
                statusItem.button?.toolTip = "MyClass 已停止"
                alert("伺服器反覆結束，已停止自動重啟。請從選單查看執行記錄，或選「重新啟動伺服器」。")
                return
            }
            server = nil
            startServer()
        }
    }

    // MARK: 選單動作

    @objc private func openApp() {
        if let i = info { Runtime.openBrowser(i.localURL) }
    }

    @objc private func copyLanURL() {
        guard let i = info, !i.lanURL.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(i.lanURL, forType: .string)
    }

    private func openFolder(_ url: URL) {
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        NSWorkspace.shared.open(url)
    }
    @objc private func openUploads() { openFolder(binDir.appendingPathComponent("uploads")) }
    @objc private func openBin() { openFolder(binDir) }
    @objc private func openLogs() { openFolder(logDir) }
    @objc private func openBackups() { openFolder(binDir.appendingPathComponent("backups")) }

    @objc private func toggleAutostart() { Autostart.toggle() }

    @objc private func restartServer() {
        log("使用者要求重新啟動伺服器")
        quitting = true
        DispatchQueue.global().async {
            Runtime.stopServer()
            DispatchQueue.main.async {
                self.info = nil
                self.server = nil
                self.quitting = false
                self.firstOpenDone = true
                self.restartCount = 0
                self.startServer()
            }
        }
    }

    @objc private func quit() {
        quitting = true
        timer?.invalidate()
        statusItem.button?.toolTip = "MyClass 正在結束…"
        DispatchQueue.global().async {
            Runtime.stopServer()
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }
}

// MARK: - 進入點

// 每個 MyClass 資料夾只允許一個選單列程式；再次開啟時只開啟瀏覽器
try? FileManager.default.createDirectory(at: binDir, withIntermediateDirectories: true)
let lockFd = open(binDir.appendingPathComponent(".tray.lock").path, O_CREAT | O_RDWR, 0o644)
if lockFd >= 0 && flock(lockFd, LOCK_EX | LOCK_NB) != 0 {
    if !autostart, let info = Runtime.read() { Runtime.openBrowser(info.localURL) }
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = TrayController()
app.delegate = controller

// 被 kill（SIGTERM）時也走一般的結束流程，才會連伺服器一起關閉
signal(SIGTERM, SIG_IGN)
let termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
termSource.setEventHandler { NSApp.terminate(nil) }
termSource.resume()
app.run()
