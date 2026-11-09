import AppKit
import SwiftUI

/// Menu-bar (LSUIElement) apps often fail to surface SwiftUI `Settings` / `Window` scenes.
/// Keep a real NSWindow we can order front from Preferences… and first-run setup.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    static weak var shared: AppDelegate?
    private var preferencesWindow: NSWindow?
    var engine: MothershipEngine?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Self.shared = self
        NotificationCenter.default.addObserver(
            forName: .openMothershipPreferences,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.showPreferences() }
        }
    }

    func showPreferences() {
        guard let engine else { return }
        if preferencesWindow == nil {
            let root = PreferencesView().environmentObject(engine)
            let hosting = NSHostingController(rootView: root)
            let window = NSWindow(contentViewController: hosting)
            window.title = "PhoneHome Mothership"
            window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            window.setContentSize(NSSize(width: 560, height: 680))
            window.minSize = NSSize(width: 520, height: 560)
            window.backgroundColor = NSColor(red: 0xf0 / 255, green: 0xf7 / 255, blue: 0xf3 / 255, alpha: 1)
            window.isReleasedWhenClosed = false
            window.center()
            preferencesWindow = window
        }
        NSApp.activate(ignoringOtherApps: true)
        preferencesWindow?.makeKeyAndOrderFront(nil)
        preferencesWindow?.orderFrontRegardless()
    }
}
