//
//  AuthView.swift
//  ResiduePhone
//
//  Sign-in screen for the iOS companion. The Residue web app moved
//  to Auth0 Universal Login as the only sign-in method, so phone
//  users no longer have an account password to type. Instead the
//  desktop (already authenticated via Auth0) mints a 6-digit
//  pairing code, and the phone hits `/api/pair/code-login` with it
//  — that single round-trip both authenticates the phone (mints a
//  fresh 30-day Residue JWT for the desktop user's `uid`) and binds
//  it to the in-progress study session, so no password ever leaves
//  the desktop.
//
//  The legacy email/password sign-in is still served by the
//  backend for older accounts but is no longer surfaced here,
//  because Auth0-provisioned users have no password and would hit
//  a confusing "invalid credentials" wall.
//

import SwiftUI

struct AuthView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var code: String = ""
    @State private var busy: Bool = false
    @FocusState private var codeFocused: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                hero
                codeCard
                stepsCard
                if let msg = session.statusMessage {
                    Text(msg)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.accent)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Spacer(minLength: 12)
            }
            .padding(.horizontal, 20)
            .padding(.top, 24)
            .padding(.bottom, 40)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - Sections

    private var hero: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                ResidueLogoView(size: 56)
                Text("RESIDUE")
                    .font(.system(size: 32, weight: .heavy, design: .serif))
                    .tracking(2)
                    .foregroundStyle(BrandTheme.accent)
            }
            Text("Pair with your desktop")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(.white)
            Text(
                "Authentication lives on the Residue desktop app. "
                + "Sign in there with Auth0, then enter the 6-digit "
                + "code below to bring this phone into the session."
            )
            .font(.callout)
            .foregroundStyle(.white.opacity(0.7))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var codeCard: some View {
        BrandCard {
            Text("Pairing code")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.85))

            CodeField(code: $code)
                .focused($codeFocused)

            Button {
                Task {
                    busy = true
                    await session.loginWithCode(code: code)
                    busy = false
                }
            } label: {
                HStack(spacing: 8) {
                    if busy { ProgressView().tint(.white) }
                    Text(busy ? "Pairing…" : "Pair with desktop")
                }
            }
            .buttonStyle(BrandPrimaryButtonStyle(disabled: !canSubmit))
            .disabled(!canSubmit)
        }
    }

    private var stepsCard: some View {
        BrandCard {
            Text("How to get a code")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.85))
            VStack(alignment: .leading, spacing: 10) {
                step(1, "Open Residue on your computer and sign in with Auth0.")
                step(2, "Start a study session, then tap “Generate pairing code”.")
                step(3, "Type the 6-digit code here. Codes expire after 10 minutes.")
            }
        }
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("\(n)")
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(Circle().fill(BrandTheme.accent.opacity(0.6)))
            Text(text)
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.75))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var canSubmit: Bool { code.count == 6 && !busy }
}

// MARK: - Code field

private struct CodeField: View {
    @Binding var code: String

    var body: some View {
        TextField("", text: $code, prompt: Text("000000").foregroundColor(.white.opacity(0.25)))
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
            .font(.system(size: 36, weight: .heavy, design: .monospaced))
            .tracking(8)
            .multilineTextAlignment(.center)
            .foregroundStyle(.white)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.black.opacity(0.35))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(BrandTheme.accent.opacity(0.4), lineWidth: 1)
            )
            .onChange(of: code) { newValue in
                let digits = newValue.filter { $0.isNumber }
                let trimmed = String(digits.prefix(6))
                if trimmed != code { code = trimmed }
            }
    }
}
