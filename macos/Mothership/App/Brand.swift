import AppKit
import SwiftUI

/// PhoneHome web storefront palette (trial/buy pages).
enum PhoneHomeBrand {
    static let ink = Color(red: 0x14 / 255, green: 0x20 / 255, blue: 0x1a / 255)
    static let muted = Color(red: 0x4a / 255, green: 0x5c / 255, blue: 0x52 / 255)
    static let accent = Color(red: 0x1f / 255, green: 0x6b / 255, blue: 0x4a / 255)
    static let accentInk = Color(red: 0xf4 / 255, green: 0xff / 255, blue: 0xfb / 255)
    static let paper = Color(red: 0xf0 / 255, green: 0xf7 / 255, blue: 0xf3 / 255)
    static let card = Color.white
    static let line = Color(red: 0xc5 / 255, green: 0xd9 / 255, blue: 0xce / 255)
    static let mint = Color(red: 0xb8 / 255, green: 0xe0 / 255, blue: 0xc8 / 255)
    static let sky = Color(red: 0xd4 / 255, green: 0xe8 / 255, blue: 0xf0 / 255)
    static let ok = Color(red: 0x1f / 255, green: 0x6b / 255, blue: 0x4a / 255)
    static let warn = Color(red: 0x8b / 255, green: 0x4a / 255, blue: 0x2e / 255)

    static var atmosphere: some View {
        ZStack {
            paper
            RadialGradient(
                colors: [mint.opacity(0.85), .clear],
                center: .topLeading,
                startRadius: 20,
                endRadius: 340
            )
            RadialGradient(
                colors: [sky.opacity(0.7), .clear],
                center: .topTrailing,
                startRadius: 10,
                endRadius: 280
            )
        }
        .ignoresSafeArea()
    }
}

struct PhoneHomeBrandMark: View {
    var compact = false

    var body: some View {
        HStack(spacing: compact ? 8 : 12) {
            Group {
                if let icon = NSApplication.shared.applicationIconImage {
                    Image(nsImage: icon)
                        .resizable()
                        .interpolation(.high)
                } else {
                    Image("MenuBarIcon")
                        .resizable()
                        .interpolation(.high)
                        .padding(8)
                        .background(PhoneHomeBrand.accent.opacity(0.12))
                }
            }
            .frame(width: compact ? 36 : 48, height: compact ? 36 : 48)
            .clipShape(RoundedRectangle(cornerRadius: compact ? 9 : 12, style: .continuous))
            .shadow(color: PhoneHomeBrand.accent.opacity(0.22), radius: 8, y: 3)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 0) {
                    Text("Phone")
                        .foregroundColor(PhoneHomeBrand.ink)
                    Text("Home")
                        .foregroundColor(PhoneHomeBrand.accent)
                }
                .font(.system(size: compact ? 22 : 28, weight: .bold, design: .serif))
                .tracking(-0.6)

                Text("Mothership")
                    .font(.system(size: compact ? 11 : 12, weight: .semibold, design: .rounded))
                    .foregroundColor(PhoneHomeBrand.muted)
                    .textCase(.uppercase)
                    .tracking(0.8)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("PhoneHome Mothership")
    }
}

struct BrandCard<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(PhoneHomeBrand.card)
                .shadow(color: PhoneHomeBrand.ink.opacity(0.06), radius: 10, y: 4)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(PhoneHomeBrand.line, lineWidth: 1)
        )
    }
}

struct BrandPrimaryButtonStyle: ButtonStyle {
    var enabled = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .bold, design: .rounded))
            .foregroundColor(PhoneHomeBrand.accentInk)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(PhoneHomeBrand.accent.opacity(enabled ? (configuration.isPressed ? 0.85 : 1) : 0.45))
            )
    }
}

struct BrandGhostButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold, design: .rounded))
            .foregroundColor(PhoneHomeBrand.accent)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(PhoneHomeBrand.line, lineWidth: 1)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(PhoneHomeBrand.card.opacity(configuration.isPressed ? 0.7 : 1))
                    )
            )
    }
}
