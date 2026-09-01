import SwiftUI

struct PreferencesView: View {
    @EnvironmentObject var engine: MothershipEngine

    var body: some View {
        Form {
            Section {
                Text("PhoneHome Mothership runs in your menu bar and keeps the family server on this Mac.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Section("Phones & invites") {
                TextField("Public HTTPS URL", text: $engine.publicBaseURL, prompt: Text("https://….trycloudflare.com"))
                    .textFieldStyle(.roundedBorder)
                Text("Parents open this on their phones. Use Cloudflare Tunnel if you don’t have a domain yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                Toggle("Start at login", isOn: Binding(
                    get: { engine.startAtLogin },
                    set: { engine.setStartAtLogin($0) }
                ))
            }

            HStack {
                Button("Save & restart") {
                    engine.applySetupAndRestart()
                }
                .keyboardShortcut(.defaultAction)
                Spacer()
                Button("Open dashboard") { engine.openDashboard() }
                Button("Open config folder") { engine.openDataFolder() }
            }
        }
        .padding(20)
        .frame(width: 480, height: 280)
    }
}
