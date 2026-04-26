//
//  PairView.swift
//  ResiduePhone
//
//  Manual fallback for re-pairing an already-signed-in phone with a
//  different desktop session via `/api/pair/claim`. The default flow
//  is the code-login on AuthView (which auths AND pairs in one
//  round-trip), so this screen is rarely surfaced — it's kept for
//  diagnosing pairings against a desktop signed in as a different
//  account.
//

import SwiftUI

struct PairView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var code: String = ""
    @State private var busy: Bool = false

    var body: some View {
        ZStack {
            BrandBackground()
            ScrollView {
                VStack(spacing: 18) {
                    BrandCard {
                        Text("Re-pair with a desktop session")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.85))
                        Text(
                            "On your computer, start a study session and "
                            + "tap “Generate pairing code”. Type the "
                            + "6-digit code below."
                        )
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.65))

                        TextField(
                            "",
                            text: $code,
                            prompt: Text("000000").foregroundColor(.white.opacity(0.25))
                        )
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .font(.system(size: 32, weight: .heavy, design: .monospaced))
                        .tracking(8)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white)
                        .padding(.vertical, 12)
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

                        Button {
                            Task {
                                busy = true
                                await session.claim(code: code)
                                busy = false
                            }
                        } label: {
                            HStack(spacing: 8) {
                                if busy { ProgressView().tint(.white) }
                                Text(busy ? "Pairing…" : "Pair with desktop")
                            }
                        }
                        .buttonStyle(BrandPrimaryButtonStyle(disabled: code.count != 6 || busy))
                        .disabled(code.count != 6 || busy)
                    }

                    BrandCard {
                        Text("Screen Time access")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.85))
                        Text(
                            "Optional. Lets the on-device Melange model see "
                            + "per-category app usage so the report can name "
                            + "what specifically distracted you."
                        )
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.65))
                        Button {
                            Task { await ScreenTimeUsage.shared.requestAuthorization() }
                        } label: {
                            Text("Authorise Screen Time access")
                        }
                        .buttonStyle(BrandPrimaryButtonStyle())
                    }

                    BrandCard {
                        Button(role: .destructive) {
                            session.logout()
                        } label: {
                            HStack {
                                Image(systemName: "rectangle.portrait.and.arrow.right")
                                Text("Sign out")
                                Spacer()
                            }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.red.opacity(0.85))
                        }
                    }

                    if let msg = session.statusMessage {
                        Text(msg)
                            .font(.footnote)
                            .foregroundStyle(.white.opacity(0.6))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 40)
            }
        }
    }
}
