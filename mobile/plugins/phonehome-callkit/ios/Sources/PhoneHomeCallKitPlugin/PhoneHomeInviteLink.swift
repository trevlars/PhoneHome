import Foundation

/// `phonehome://connect?url=<https share link>` from the Mothership page's "Open in the app" handoff.
/// Held until JS consumes it so a cold launch (or a WebView hop between hubs) never drops or replays it.
public enum PhoneHomeInviteLink {
    private static var pending: String?
    static weak var plugin: PhoneHomeCallKitPlugin?

    @discardableResult
    public static func receive(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "phonehome",
              url.host?.lowercased() == "connect",
              let raw = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "url" })?.value,
              let share = URL(string: raw),
              share.scheme?.lowercased() == "https",
              !(share.host ?? "").isEmpty
        else { return false }
        DispatchQueue.main.async {
            pending = share.absoluteString
            plugin?.notifyListeners("inviteLink", data: [:])
        }
        return true
    }

    static func consume() -> String {
        let url = pending ?? ""
        pending = nil
        return url
    }
}
