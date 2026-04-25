//
//  PairView.swift
//  ResiduePhone
//

import SwiftUI

struct PairView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var code: String = ""
    @State private var busy: Bool = false

    var body: some View {
        Form {
            Section {
                Text(
                    "Open Residue on your computer, start a study session, and tap "
                    + "“Generate pairing code”. Type the 6-digit code below."
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            Section {
                TextField("000000", text: $code)
                    .keyboardType(.numberPad)
                    .font(.system(size: 28, weight: .bold, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .onChange(of: code) { newValue in
                        let digits = newValue.filter { $0.isNumber }
                        code = String(digits.prefix(6))
                    }
            }
            Section {
                Button {
                    Task {
                        busy = true
                        await session.claim(code: code)
                        busy = false
                    }
                } label: {
                    HStack {
                        Spacer()
                        if busy { ProgressView() } else { Text("Pair with desktop") }
                        Spacer()
                    }
                }
                .disabled(code.count != 6 || busy)
            }

            Section {
                Button("Authorise Screen Time access") {
                    Task { await ScreenTimeUsage.shared.requestAuthorization() }
                }
                .font(.footnote)
                Text(
                    "Optional. Lets the on-device Melange model see per-category app "
                    + "usage so the report can name what specifically distracted you."
                )
                .font(.caption2)
                .foregroundStyle(.secondary)
            }

            Section {
                Button("Sign out", role: .destructive) { session.logout() }
            }

            if let msg = session.statusMessage {
                Section { Text(msg).font(.footnote).foregroundStyle(.secondary) }
            }
        }
    }
}
