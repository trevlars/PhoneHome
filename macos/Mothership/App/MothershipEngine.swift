import AppKit
import Foundation
import ServiceManagement
@MainActor
final class MothershipEngine: ObservableObject {
    @Published var isRunning = false
    @Published var statusText = "Starting…"
    @Published var publicBaseURL = ""
    @Published var startAtLogin = false
    @Published var showSetup = false

    private var process: Process?
    private let dataDir: URL
    private let envFile: URL

    init() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        dataDir = home.appendingPathComponent(".phonehome", isDirectory: true)
        envFile = dataDir.appendingPathComponent("phonehome.env")
        try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
        loadConfig()
        startAtLogin = SMAppService.mainApp.status == .enabled
        if !FileManager.default.fileExists(atPath: envFile.path) {
            showSetup = true
            DispatchQueue.main.async { [weak self] in
                guard self?.showSetup == true else { return }
                NSApp.activate(ignoringOtherApps: true)
                NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
            }
        }
        Task { await startServer() }
    }

    func loadConfig() {
        guard let text = try? String(contentsOf: envFile, encoding: .utf8) else { return }
        for line in text.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("PUBLIC_BASE_URL=") {
                publicBaseURL = String(trimmed.dropFirst("PUBLIC_BASE_URL=".count))
            }
        }
    }

    func saveConfig() {
        var lines: [String] = []
        if let existing = try? String(contentsOf: envFile, encoding: .utf8) {
            lines = existing.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        }
        func upsert(_ key: String, _ value: String) {
            let prefix = "\(key)="
            if let idx = lines.firstIndex(where: { $0.hasPrefix(prefix) }) {
                lines[idx] = "\(prefix)\(value)"
            } else {
                lines.append("\(prefix)\(value)")
            }
        }
        upsert("PUBLIC_BASE_URL", publicBaseURL)
        upsert("PORT", "8787")
        upsert("DATA_DIR", dataDir.path)
        upsert("NODE_ENV", "production")
        upsert("SIP_SERVER", "127.0.0.1")
        upsert("BRIDGE_URL", "http://127.0.0.1:8790")
        upsert("ATA_LAN_PUSH", "0")
        if !lines.contains(where: { $0.hasPrefix("SIP_PUBLIC_HOST=") }) {
            lines.append("SIP_PUBLIC_HOST=phonehome.local")
        }
        let body = lines.joined(separator: "\n") + "\n"
        try? body.write(to: envFile, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: envFile.path)
        ensureBridgeEnv()
    }

    private func ensureBridgeEnv() {
        let bridge = dataDir.appendingPathComponent("bridge.env")
        guard !FileManager.default.fileExists(atPath: bridge.path) else { return }
        let secret = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let body = """
        BRIDGE_SECRET=\(secret)
        PHONEHOME_URL=http://127.0.0.1:8787
        PHONEHOME_WS=ws://127.0.0.1:8787/ws
        ARI_URL=http://127.0.0.1:8088
        ARI_USER=phonehome
        ARI_PASS=\(UUID().uuidString.prefix(16))
        ARI_APP=phonehome
        EXT_MEDIA_HOST=127.0.0.1
        EXT_MEDIA_PORT_BASE=14000
        BRIDGE_HTTP_PORT=8790
        BRIDGE_HTTP_BIND=0.0.0.0
        """
        try? body.write(to: bridge, atomically: true, encoding: .utf8)
    }

    func applySetupAndRestart() {
        saveConfig()
        showSetup = false
        Task { await restartServer() }
    }

    func setStartAtLogin(_ enabled: Bool) {
        startAtLogin = enabled
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            statusText = "Login item: \(error.localizedDescription)"
        }
    }

    func openDashboard() {
        NSWorkspace.shared.open(URL(string: "http://127.0.0.1:8787")!)
    }

    func openDataFolder() {
        NSWorkspace.shared.open(dataDir)
    }

    func restartServer() async {
        stopServer()
        await startServer()
    }

    func startServer() async {
        guard process == nil else { return }
        guard let paths = resolvePaths() else {
            statusText = "Missing bundled server — reinstall app"
            isRunning = false
            return
        }

        let proc = Process()
        proc.executableURL = paths.node
        proc.arguments = [paths.supervisor.path]
        proc.currentDirectoryURL = paths.root

        var env = ProcessInfo.processInfo.environment
        env["DATA_DIR"] = dataDir.path
        env["PATH"] = paths.node.deletingLastPathComponent().path + ":" + (env["PATH"] ?? "")
        proc.environment = env

        let outPipe = Pipe()
        proc.standardOutput = outPipe
        proc.standardError = outPipe

        proc.terminationHandler = { [weak self] p in
            Task { @MainActor in
                self?.process = nil
                self?.isRunning = false
                if p.terminationStatus != 0 {
                    self?.statusText = "Stopped (code \(p.terminationStatus))"
                } else {
                    self?.statusText = "Stopped"
                }
            }
        }

        do {
            try proc.run()
            process = proc
            isRunning = true
            statusText = "Running on :8787"
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            await pollHealth()
        } catch {
            statusText = "Failed to start: \(error.localizedDescription)"
            isRunning = false
        }
    }

    private func pollHealth() async {
        guard let url = URL(string: "http://127.0.0.1:8787/api/health") else { return }
        for _ in 0..<8 {
            if let (_, resp) = try? await URLSession.shared.data(from: url),
               (resp as? HTTPURLResponse)?.statusCode == 200 {
                statusText = "Running — ready"
                return
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
    }

    func stopServer() {
        process?.terminate()
        process = nil
        isRunning = false
    }

    private struct ResolvedPaths {
        let root: URL
        let node: URL
        let supervisor: URL
    }

    private func resolvePaths() -> ResolvedPaths? {
        if let dev = ProcessInfo.processInfo.environment["PHONEHOME_DEV_ROOT"] {
            let root = URL(fileURLWithPath: dev, isDirectory: true)
            let supervisor = root.appendingPathComponent("deploy/phonehome-supervisor.mjs")
            let nodePath = ProcessInfo.processInfo.environment["NODE_BINARY"] ?? "/opt/homebrew/bin/node"
            let node = URL(fileURLWithPath: nodePath)
            if FileManager.default.fileExists(atPath: supervisor.path) {
                return ResolvedPaths(root: root, node: node, supervisor: supervisor)
            }
        }

        guard let res = Bundle.main.resourceURL else { return nil }
        let root = res.appendingPathComponent("mothership", isDirectory: true)
        let node = res.appendingPathComponent("node/bin/node")
        let supervisor = root.appendingPathComponent("deploy/phonehome-supervisor.mjs")
        guard FileManager.default.fileExists(atPath: node.path),
              FileManager.default.fileExists(atPath: supervisor.path) else { return nil }
        return ResolvedPaths(root: root, node: node, supervisor: supervisor)
    }

    deinit {
        process?.terminate()
    }
}
