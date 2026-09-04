import SwiftUI

@main
struct MothershipApp: App {
    @StateObject private var engine = MothershipEngine()

    var body: some Scene {
        MenuBarExtra {
            Text(engine.statusText)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)

            if engine.showSetup {
                Button("Finish setup…") {
                    NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
                }
                Divider()
            }

            Button("Open dashboard…") { engine.openDashboard() }
            Button("Preferences…") {
                NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
            }
            Button("Open config folder") { engine.openDataFolder() }
            Divider()
            Toggle("Start at login", isOn: Binding(
                get: { engine.startAtLogin },
                set: { engine.setStartAtLogin($0) }
            ))
            Divider()
            Button("Quit PhoneHome Mothership") { NSApp.terminate(nil) }
        } label: {
            Image("MenuBarIcon")
        }
        .menuBarExtraStyle(.menu)

        Settings {
            PreferencesView()
                .environmentObject(engine)
        }
    }
}
