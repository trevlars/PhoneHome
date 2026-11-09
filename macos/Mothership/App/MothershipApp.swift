import AppKit
import SwiftUI

extension Notification.Name {
    static let openMothershipPreferences = Notification.Name("com.phonehome.mothership.openPreferences")
}

@main
struct MothershipApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var engine = MothershipEngine()

    var body: some Scene {
        MenuBarExtra {
            MenuBarRoot(engine: engine)
                .task {
                    appDelegate.engine = engine
                    AppDelegate.shared?.engine = engine
                }
        } label: {
            Image("MenuBarIcon")
        }
        .menuBarExtraStyle(.menu)
    }
}

struct MenuBarRoot: View {
    @ObservedObject var engine: MothershipEngine

    var body: some View {
        Group {
            Text(engine.statusText)
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.horizontal, 8)

            if engine.showSetup {
                Button("Finish setup…") {
                    openPreferences()
                }
                Divider()
            }

            Button("Open dashboard…") { engine.openDashboard() }
            Button("Preferences…") { openPreferences() }
            Button("Open config folder") { engine.openDataFolder() }
            Divider()
            Toggle("Start at login", isOn: Binding(
                get: { engine.startAtLogin },
                set: { engine.setStartAtLogin($0) }
            ))
            Divider()
            Button("Quit PhoneHome Mothership") { NSApp.terminate(nil) }
        }
        .onAppear {
            AppDelegate.shared?.engine = engine
            if engine.showSetup {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    openPreferences()
                }
            }
        }
    }

    private func openPreferences() {
        AppDelegate.shared?.engine = engine
        if let delegate = AppDelegate.shared {
            delegate.showPreferences()
        } else {
            NotificationCenter.default.post(name: .openMothershipPreferences, object: nil)
        }
    }
}
