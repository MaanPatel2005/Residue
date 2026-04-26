//
//  SessionView.swift
//  ResiduePhone
//

import SwiftUI

struct SessionView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var now = Date()

    var body: some View {
        Form {
            // Banner: desktop just ended the session and the on-device
            // Melange report is generating. Pinned at the top so the
            // user sees it before scrolling. Hides automatically as
            // soon as `reportSummary` becomes non-nil OR `reportError`
            // is set.
            if session.sessionEndedAt != nil, session.reportSummary == nil, session.reportError == nil {
                Section {
                    HStack(spacing: 12) {
                        ProgressView()
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Session ended on desktop")
                                .font(.subheadline.weight(.semibold))
                            Text("Generating distraction report on-device…")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Section(session.pairedSessionId == nil ? "Local session" : "Paired session") {
                LabeledContent("Session", value: session.pairedSessionId ?? "Local only")
                LabeledContent("Started", value: session.sessionStart.map(formatted) ?? "—")
                if let endedAt = session.sessionEndedAt {
                    LabeledContent("Ended", value: formatted(endedAt))
                }
            }

            Section("Distractions this session") {
                LabeledContent("Phone unlocks") { Text("\(session.openCount)") }
                LabeledContent("Time on phone") {
                    Text(formatDuration(currentTotalDistractionMs(now: now)))
                }
                if let last = session.lastOpenedAt {
                    // While a session is live, render with SwiftUI's
                    // relative-date style so it ticks every second
                    // ("3s ago", "4s ago", …). Once `sessionEndedAt`
                    // is set the desktop session has ended, so freeze
                    // the row at "X ago" computed against the end
                    // timestamp — same freeze pattern as the main
                    // "Time on phone" counter (which also stops
                    // because `activeSince` is closed out in
                    // handleDesktopStopped).
                    LabeledContent("Last unlock") {
                        if let endedAt = session.sessionEndedAt {
                            Text(formatRelative(from: last, to: endedAt))
                        } else {
                            Text(last, style: .relative)
                        }
                    }
                }
            }

            Section("On-device distraction report") {
                if session.reportInProgress {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Running Zetic Melange (Steve/Qwen3.5-2B) on-device…")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                } else if let summary = session.reportSummary {
                    Text(summary)
                        .font(.callout)
                    Text(
                        "Generated on Apple Neural Engine via Zetic Melange "
                        + "(Steve/Qwen3.5-2B). \(Int(session.reportLatencyMs))ms."
                    )
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                } else if let err = session.reportError {
                    Text("Report failed: \(err)")
                        .font(.footnote)
                        .foregroundStyle(.red)
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
                            Text(session.reportError != nil ? "Retry distraction report" : "Generate distraction report")
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
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { now = $0 }
    }

    private func formatted(_ d: Date) -> String {
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return f.string(from: d)
    }

    private func currentTotalDistractionMs(now: Date) -> Double {
        totalDistractionMsWithActiveSegment(now: now)
    }

    private func totalDistractionMsWithActiveSegment(now: Date) -> Double {
        session.totalDistractionMs + (session.activeSince.map { now.timeIntervalSince($0) * 1000 } ?? 0)
    }

    /// Frozen "X ago" label used for the Last-unlock row after the
    /// desktop session ends. We compute the elapsed seconds between
    /// `from` (the unlock timestamp) and `to` (the session-end
    /// timestamp) and render in the same coarse units SwiftUI's
    /// `.relative` style produces, so the row's appearance is
    /// continuous between live and frozen states.
    private func formatRelative(from earlier: Date, to later: Date) -> String {
        let seconds = max(0, later.timeIntervalSince(earlier))
        if seconds < 60 { return "\(Int(seconds))s ago" }
        if seconds < 3600 {
            let m = Int(seconds / 60)
            return "\(m) min ago"
        }
        let h = Int(seconds / 3600)
        return "\(h) hr ago"
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
