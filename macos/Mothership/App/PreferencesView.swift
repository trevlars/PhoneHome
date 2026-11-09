import SwiftUI

struct PreferencesView: View {
    @EnvironmentObject var engine: MothershipEngine
    @State private var duckDnsStatus = ""
    @State private var duckDnsBusy = false
    @State private var showOtherHttps = false
    @State private var saveFlash = ""

    private var statusTone: Color {
        if engine.statusText.localizedCaseInsensitiveContains("ready")
            || engine.statusText.localizedCaseInsensitiveContains("running") {
            return PhoneHomeBrand.ok
        }
        if engine.statusText.localizedCaseInsensitiveContains("stopped")
            || engine.statusText.localizedCaseInsensitiveContains("failed")
            || engine.statusText.localizedCaseInsensitiveContains("127") {
            return PhoneHomeBrand.warn
        }
        return PhoneHomeBrand.muted
    }

    var body: some View {
        ZStack {
            PhoneHomeBrand.atmosphere

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header

                    BrandCard {
                        Label {
                            Text("Reachable hostname for softphones")
                                .font(.system(size: 15, weight: .semibold, design: .rounded))
                                .foregroundColor(PhoneHomeBrand.ink)
                        } icon: {
                            Image(systemName: "antenna.radiowaves.left.and.right")
                                .foregroundColor(PhoneHomeBrand.accent)
                        }
                        Text("Set DuckDNS (or another HTTPS URL), save, then open the dashboard to claim this Mothership with your setup code — not the phone product tour.")
                            .font(.system(size: 13, weight: .regular, design: .rounded))
                            .foregroundColor(PhoneHomeBrand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    duckDnsCard
                    otherHttpsCard
                    loginCard
                    actionsRow

                    if !saveFlash.isEmpty {
                        Text(saveFlash)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundColor(PhoneHomeBrand.accent)
                    }
                }
                .padding(22)
            }
        }
        .frame(minWidth: 540, idealWidth: 560, minHeight: 620, idealHeight: 680)
        .onAppear {
            showOtherHttps = engine.duckDnsDomain.isEmpty && !engine.publicBaseURL.isEmpty
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            PhoneHomeBrandMark()
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Text("Server")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundColor(PhoneHomeBrand.muted)
                    .textCase(.uppercase)
                    .tracking(0.6)
                HStack(spacing: 6) {
                    Circle()
                        .fill(statusTone)
                        .frame(width: 8, height: 8)
                    Text(engine.statusText)
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundColor(PhoneHomeBrand.ink)
                        .lineLimit(2)
                        .multilineTextAlignment(.trailing)
                }
            }
        }
    }

    private var duckDnsCard: some View {
        BrandCard {
            HStack {
                Text("DuckDNS")
                    .font(.system(size: 16, weight: .bold, design: .serif))
                    .foregroundColor(PhoneHomeBrand.ink)
                Text("Recommended")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundColor(PhoneHomeBrand.accent)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(PhoneHomeBrand.mint.opacity(0.65)))
            }
            Text("Free hostname that follows your home IP. Create a name at duckdns.org, then paste it here.")
                .font(.system(size: 12.5, weight: .regular, design: .rounded))
                .foregroundColor(PhoneHomeBrand.muted)

            VStack(alignment: .leading, spacing: 8) {
                fieldLabel("Subdomain")
                HStack(spacing: 8) {
                    TextField("myfamily", text: $engine.duckDnsDomain)
                        .textFieldStyle(.plain)
                        .padding(10)
                        .background(fieldBackground)
                    Text(".duckdns.org")
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .foregroundColor(PhoneHomeBrand.muted)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                fieldLabel("Token")
                SecureField("from duckdns.org", text: $engine.duckDnsToken)
                    .textFieldStyle(.plain)
                    .padding(10)
                    .background(fieldBackground)
            }

            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    fieldLabel("HTTPS port")
                    TextField("8443", text: $engine.duckDnsHttpsPort)
                        .textFieldStyle(.plain)
                        .padding(10)
                        .frame(width: 100)
                        .background(fieldBackground)
                }
                Text("Forward that port on your router to this Mac. Terminate TLS (Caddy / Let’s Encrypt) in front of :8787 — softphones need HTTPS.")
                    .font(.system(size: 12, weight: .regular, design: .rounded))
                    .foregroundColor(PhoneHomeBrand.muted)
                    .padding(.top, 22)
            }

            HStack(spacing: 10) {
                Button(duckDnsBusy ? "Checking…" : "Test & apply DuckDNS") {
                    Task { await testDuckDns() }
                }
                .buttonStyle(BrandPrimaryButtonStyle(enabled: !duckDnsBusy && !engine.duckDnsDomain.trimmingCharacters(in: .whitespaces).isEmpty))
                .disabled(duckDnsBusy || engine.duckDnsDomain.trimmingCharacters(in: .whitespaces).isEmpty)
                .keyboardShortcut(.defaultAction)

                Link(destination: URL(string: "https://www.duckdns.org")!) {
                    Text("Open duckdns.org")
                }
                .buttonStyle(BrandGhostButtonStyle())
            }

            if !duckDnsStatus.isEmpty {
                Text(duckDnsStatus)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundColor(duckDnsStatus.hasPrefix("OK") ? PhoneHomeBrand.ok : PhoneHomeBrand.warn)
            }
            if !engine.publicBaseURL.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Phones will use")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundColor(PhoneHomeBrand.muted)
                    Text(engine.publicBaseURL)
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundColor(PhoneHomeBrand.ink)
                        .textSelection(.enabled)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(PhoneHomeBrand.mint.opacity(0.35))
                )
            }
        }
    }

    private var otherHttpsCard: some View {
        BrandCard {
            DisclosureGroup(isExpanded: $showOtherHttps) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Paste a tunnel or custom HTTPS URL if you are not using DuckDNS. Overrides the DuckDNS-derived URL when set.")
                        .font(.system(size: 12, weight: .regular, design: .rounded))
                        .foregroundColor(PhoneHomeBrand.muted)
                        .padding(.top, 6)
                    TextField("https://….trycloudflare.com", text: $engine.publicBaseURL)
                        .textFieldStyle(.plain)
                        .padding(10)
                        .background(fieldBackground)
                }
            } label: {
                Text("Other HTTPS URL")
                    .font(.system(size: 15, weight: .bold, design: .serif))
                    .foregroundColor(PhoneHomeBrand.ink)
            }
            .accentColor(PhoneHomeBrand.accent)
        }
    }

    private var loginCard: some View {
        BrandCard {
            Toggle(isOn: Binding(
                get: { engine.startAtLogin },
                set: { engine.setStartAtLogin($0) }
            )) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Start at login")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundColor(PhoneHomeBrand.ink)
                    Text("Keep the family server running after reboot.")
                        .font(.system(size: 12, weight: .regular, design: .rounded))
                        .foregroundColor(PhoneHomeBrand.muted)
                }
            }
            .accentColor(PhoneHomeBrand.accent)
        }
    }

    private var actionsRow: some View {
        HStack(spacing: 10) {
            Button("Save & restart") {
                engine.applySetupAndRestart()
                saveFlash = "Saved — server restarting…"
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                    if saveFlash.hasPrefix("Saved") { saveFlash = "" }
                }
            }
            .buttonStyle(BrandPrimaryButtonStyle())

            Button("Open dashboard") { engine.openDashboard() }
                .buttonStyle(BrandGhostButtonStyle())

            Button("Config folder") { engine.openDataFolder() }
                .buttonStyle(BrandGhostButtonStyle())

            Spacer(minLength: 0)
        }
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .bold, design: .rounded))
            .foregroundColor(PhoneHomeBrand.muted)
            .textCase(.uppercase)
            .tracking(0.5)
    }

    private var fieldBackground: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(PhoneHomeBrand.paper)
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(PhoneHomeBrand.line, lineWidth: 1)
            )
    }

    @MainActor
    private func testDuckDns() async {
        duckDnsBusy = true
        duckDnsStatus = ""
        defer { duckDnsBusy = false }
        duckDnsStatus = await engine.testAndApplyDuckDns()
    }
}
