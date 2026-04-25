//
//  SessionView.swift
//  ResiduePhone
//

import SwiftUI

struct SessionView: View {
    @EnvironmentObject private var session: SessionStore

    var body: some View {
        Form {
            Section("Paired session") {
                LabeledContent("Session", value: session.pairedSessionId ?? "—")
                LabeledContent("Started", value: session.sessionStart.map(formatted) ?? "—")
            }

            Section("Distractions this session") {
                LabeledContent("Phone unlocks") { Text("\(session.openCount)") }
                LabeledContent("Time on phone") {
                    Text(formatDuration(session.totalDistractionMs))
                }
                if let last = session.lastOpenedAt {
                    LabeledContent("Last unlock") { Text(last, style: .relative) }
                }
            }

            Section("On-device distraction report") {
                if let summary = session.reportSummary {
                    Text(summary)
                        .font(.callout)
                    Text(
                        "Generated on Apple Neural Engine via Zetic Melange "
                        + "(Steve/Qwen3.5-2B). \(Int(session.reportLatencyMs))ms."
                    )
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                } else {
                    Text(
                        "Tap below to run the on-device LLM and generate a "
                        + "personalised distraction report. Your data stays "
                        + "on the phone — only the rendered summary is sent to "
                        + "the desktop."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
                Button {
                    Task { await session.generateReport() }
                } label: {
                    HStack {
                        Spacer()
                        if session.reportInProgress { ProgressView() } else {
                            Text("Generate distraction report")
                        }
                        Spacer()
                    }
                }
                .disabled(session.reportInProgress)
            }

            Section {
                Button("Unpair", role: .destructive) {
                    session.logout()
                }
            }

            if let msg = session.statusMessage {
                Section { Text(msg).font(.footnote).foregroundStyle(.secondary) }
            }
        }
    }

    private func formatted(_ d: Date) -> String {
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return f.string(from: d)
    }

    private func formatDuration(_ ms: Double) -> String {
        if ms < 1_000 { return "0s" }
        let s = Int(ms / 1_000)
        if s < 60 { return "\(s)s" }
        let m = s / 60
        let rs = s % 60
        return "\(m)m \(rs)s"
    }
}
