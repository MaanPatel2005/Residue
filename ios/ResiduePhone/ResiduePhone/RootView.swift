//
//  RootView.swift
//  ResiduePhone
//
//  Top-level router. Two routes only:
//    - signed out → AuthView (6-digit pairing code from the desktop;
//      the desktop is now the source of auth via Auth0 Universal
//      Login, so the phone never types an account password).
//    - signed in  → SessionView (live counters + on-device Melange
//      distraction report).
//
//  PairView is retained as a manual fallback path used after sign-in
//  to re-pair to a different desktop session.
//

import SwiftUI

struct RootView: View {
    @EnvironmentObject private var session: SessionStore

    init() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithTransparentBackground()
        appearance.backgroundColor = UIColor(BrandTheme.background)
        appearance.titleTextAttributes = [
            .foregroundColor: UIColor.white,
            .font: UIFont.systemFont(ofSize: 17, weight: .semibold),
        ]
        appearance.largeTitleTextAttributes = [
            .foregroundColor: UIColor.white,
            .font: UIFont.systemFont(ofSize: 32, weight: .heavy),
        ]
        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        UINavigationBar.appearance().tintColor = UIColor(BrandTheme.accent)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                BrandBackground()
                Group {
                    if session.user == nil {
                        AuthView()
                    } else {
                        SessionView()
                    }
                }
            }
            .navigationTitle("Residue")
            .toolbarBackground(BrandTheme.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .tint(BrandTheme.accent)
        .preferredColorScheme(.dark)
    }
}

// MARK: - Brand theme

/// Mirrors the web app's palette (`src/components/AuthPage.tsx` and
/// `src/app/layout.tsx`). The dark navy base + cyan/purple radial
/// gradient is the signature Residue look; the brand purple
/// `#8c52ff` is reused for the wordmark and primary accents.
enum BrandTheme {
    static let background = Color(red: 0x0a / 255, green: 0x0a / 255, blue: 0x1a / 255)
    static let accent = Color(red: 0x8c / 255, green: 0x52 / 255, blue: 0xff / 255)
    static let cyan = Color(red: 0x06 / 255, green: 0xb6 / 255, blue: 0xd4 / 255)
    static let purple = Color(red: 0x93 / 255, green: 0x33 / 255, blue: 0xea / 255)
    static let cardBackground = Color.white.opacity(0.04)
    static let cardBorder = Color.white.opacity(0.08)

    static let buttonGradient = LinearGradient(
        colors: [cyan, purple],
        startPoint: .leading,
        endPoint: .trailing
    )
}

/// Full-screen dark navy + dual radial gradient that matches the web
/// auth page (`bg-[radial-gradient(circle_at_top_left,…),radial-gradient(circle_at_bottom_right,…)]`).
struct BrandBackground: View {
    var body: some View {
        ZStack {
            BrandTheme.background.ignoresSafeArea()
            GeometryReader { proxy in
                let size = max(proxy.size.width, proxy.size.height)
                ZStack {
                    RadialGradient(
                        colors: [BrandTheme.cyan.opacity(0.18), .clear],
                        center: .topLeading,
                        startRadius: 0,
                        endRadius: size * 0.7
                    )
                    RadialGradient(
                        colors: [BrandTheme.purple.opacity(0.22), .clear],
                        center: .bottomTrailing,
                        startRadius: 0,
                        endRadius: size * 0.75
                    )
                }
                .ignoresSafeArea()
            }
        }
    }
}

/// Reusable card container used across the app's sections.
struct BrandCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(BrandTheme.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(BrandTheme.cardBorder, lineWidth: 1)
        )
    }
}

/// Cyan→purple gradient button matching the web auth CTA.
struct BrandPrimaryButtonStyle: ButtonStyle {
    var disabled: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(BrandTheme.buttonGradient)
            )
            .opacity(disabled ? 0.5 : (configuration.isPressed ? 0.85 : 1))
    }
}

/// Residue glasses logo from `public/icon.png`, bundled via
/// `Assets.xcassets/Logo.imageset`.
struct ResidueLogoView: View {
    var size: CGFloat = 56

    var body: some View {
        Image("Logo")
            .resizable()
            .renderingMode(.original)
            .interpolation(.high)
            .aspectRatio(contentMode: .fit)
            .frame(width: size, height: size)
    }
}
