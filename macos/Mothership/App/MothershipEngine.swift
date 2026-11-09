import AppKit
import Foundation
import ServiceManagement
@MainActor
final class MothershipEngine: ObservableObject {
    @Published var isRunning = false
    @Published var statusText = "Starting…"
    @Published var publicBaseURL = ""
    @Published var duckDnsDomain = ""
    @Published var duckDnsToken = ""
    @Published var duckDnsHttpsPort = "8443"
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
        // Always offer first-run mothership setup until PUBLIC_BASE_URL or DuckDNS is set.
        if publicBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && duckDnsDomain.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            showSetup = true
            // Delay so MenuBarExtra is mounted and can receive openWindow.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                NSApp.activate(ignoringOtherApps: true)
                NotificationCenter.default.post(name: .openMothershipPreferences, object: nil)
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
            } else if trimmed.hasPrefix("DUCKDNS_DOMAIN=") {
                duckDnsDomain = String(trimmed.dropFirst("DUCKDNS_DOMAIN=".count))
            } else if trimmed.hasPrefix("DUCKDNS_TOKEN=") {
                duckDnsToken = String(trimmed.dropFirst("DUCKDNS_TOKEN=".count))
            } else if trimmed.hasPrefix("DUCKDNS_HTTPS_PORT=") {
                duckDnsHttpsPort = String(trimmed.dropFirst("DUCKDNS_HTTPS_PORT=".count))
            }
        }
    }

    /// Normalize subdomain the same way deploy/duckdns.mjs does.
    func normalizedDuckDnsDomain(_ raw: String) -> String {
        var d = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if d.hasPrefix("https://") { d = String(d.dropFirst(8)) }
        if d.hasPrefix("http://") { d = String(d.dropFirst(7)) }
        if let slash = d.firstIndex(of: "/") { d = String(d[..<slash]) }
        if let colon = d.firstIndex(of: ":") { d = String(d[..<colon]) }
        if d.hasSuffix(".duckdns.org") {
            d = String(d.dropLast(".duckdns.org".count))
        }
        let ok = d.range(of: #"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$"#, options: .regularExpression) != nil
        return ok ? d : ""
    }

    func applyDuckDnsDerivedURL() {
        let domain = normalizedDuckDnsDomain(duckDnsDomain)
        guard !domain.isEmpty else { return }
        let port = duckDnsHttpsPort.trimmingCharacters(in: .whitespacesAndNewlines)
        let p = port.isEmpty ? "8443" : port
        let host = "\(domain).duckdns.org"
        publicBaseURL = p == "443" ? "https://\(host)" : "https://\(host):\(p)"
    }

    /// Calls DuckDNS update API (never logs the token). On success, fills PUBLIC_BASE_URL.
    func testAndApplyDuckDns() async -> String {
        let domain = normalizedDuckDnsDomain(duckDnsDomain)
        let token = duckDnsToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !domain.isEmpty else { return "Enter a DuckDNS subdomain." }
        guard !token.isEmpty else { return "Paste your DuckDNS token from duckdns.org." }

        var comps = URLComponents(string: "https://www.duckdns.org/update")!
        comps.queryItems = [
            URLQueryItem(name: "domains", value: domain),
            URLQueryItem(name: "token", value: token),
            URLQueryItem(name: "ip", value: ""),
            URLQueryItem(name: "verbose", value: "true"),
        ]
        guard let url = comps.url else { return "Could not build update URL." }

        do {
            let (data, resp) = try await URLSession.shared.data(from: url)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let body = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard code == 200, body.uppercased().hasPrefix("OK") else {
                return "DuckDNS said no — check subdomain + token. (\(body.prefix(40)))"
            }
            duckDnsDomain = domain
            applyDuckDnsDerivedURL()
            saveConfig()
            return "OK — \(domain).duckdns.org updated. Forward HTTPS port \(duckDnsHttpsPort.isEmpty ? "8443" : duckDnsHttpsPort) to this Mac, then Save & restart."
        } catch {
            return "Network error: \(error.localizedDescription)"
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
        let domain = normalizedDuckDnsDomain(duckDnsDomain)
        if !domain.isEmpty && publicBaseURL.trimmingCharacters(in: .whitespaces).isEmpty {
            applyDuckDnsDerivedURL()
        }
        upsert("PUBLIC_BASE_URL", publicBaseURL)
        upsert("DUCKDNS_DOMAIN", domain)
        upsert("DUCKDNS_TOKEN", duckDnsToken.trimmingCharacters(in: .whitespacesAndNewlines))
        let port = duckDnsHttpsPort.trimmingCharacters(in: .whitespacesAndNewlines)
        upsert("DUCKDNS_HTTPS_PORT", port.isEmpty ? "8443" : port)
        if !domain.isEmpty {
            upsert("SIP_PUBLIC_HOST", "\(domain).duckdns.org")
        } else if let host = URL(string: publicBaseURL)?.host, !host.isEmpty {
            upsert("SIP_PUBLIC_HOST", host)
        }
        upsert("PORT", "8787")
        upsert("DATA_DIR", dataDir.path)
        upsert("NODE_ENV", "production")
        upsert("SIP_SERVER", "127.0.0.1")
        upsert("BRIDGE_URL", "http://127.0.0.1:8790")
        // Softphone-only on Mac by default — SIP bridge needs FreePBX/ARI and must not kill the hub.
        upsert("ATA_LAN_PUSH", "0")
        upsert("SKIP_BRIDGE", "1")
        upsert("BRIDGE_REQUIRED", "0")
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
        // ?host=1 routes the web UI into Mothership operator onboarding (not phone tour).
        NSWorkspace.shared.open(URL(string: "http://127.0.0.1:8787/?host=1")!)
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
