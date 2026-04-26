//
//  SessionView.swift
//  ResiduePhone
//

import SwiftUI

struct SessionView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var now = Date()

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                // Banner: desktop just ended the session and the on-device
                // Melange report is generating. Pinned at the top so the
                // user sees it before scrolling. Hides automatically as
                // soon as `reportSummary` becomes non-nil OR `reportError`
                // is set.
                if session.sessionEndedAt != nil, session.reportSummary == nil, session.reportError == nil {
                    BrandCard {
                        HStack(spacing: 12) {
                            ProgressView().tint(BrandTheme.accent)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Session ended on desktop")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.white)
                                Text("Generating distraction report on-device…")
                                    .font(.caption)
                                    .foregroundStyle(.white.opacity(0.6))
                            }
                            Spacer()
                        }
                    }
                }

                pairingCard
                distractionsCard
                reportCard
                signOutCard

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
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { now = $0 }
    }

    // MARK: - Cards

    private var pairingCard: some View {
        BrandCard {
            HStack {
                Text(session.pairedSessionId == nil ? "Local session" : "Paired session")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.85))
                Spacer()
                if session.pairedSessionId != nil {
                    statusPill(text: "live", color: .green)
                }
            }
            row("Session", session.pairedSessionId ?? "Local only")
            row("Started", session.sessionStart.map(formatted) ?? "—")
            if let endedAt = session.sessionEndedAt {
                row("Ended", formatted(endedAt))
            }
        }
    }

    private var distractionsCard: some View {
        BrandCard {
            Text("Distractions this session")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.85))

            HStack(spacing: 12) {
                stat("\(session.openCount)", "phone unlocks")
                stat(formatDuration(currentTotalDistractionMs(now: now)), "on phone")
            }

            if let last = session.lastOpenedAt {
                lastUnlockRow(last: last)
            }
        }
    }

    @ViewBuilder
    private func lastUnlockRow(last: Date) -> some View {
        HStack {
            Text("Last unlock")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.55))
            Spacer()
            lastUnlockText(last: last)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.white.opacity(0.9))
        }
    }

    private var reportCard: some View {
        BrandCard {
            Text("On-device distraction report")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.85))

            if session.reportInProgress {
                HStack(spacing: 10) {
                    ProgressView().tint(BrandTheme.accent)
                    Text("Running Zetic Melange (Steve/Qwen3.5-2B) on-device…")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.65))
                }
            } else if let summary = session.reportSummary {
                Text(summary)
                    .font(.callout)
                    .foregroundStyle(.white.opacity(0.9))
                Text(
                    "Generated on Apple Neural Engine via Zetic Melange "
                    + "(Steve/Qwen3.5-2B). \(Int(session.reportLatencyMs))ms."
                )
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.5))
            } else if let err = session.reportError {
                Text("Report failed: \(err)")
                    .font(.footnote)
                    .foregroundStyle(.red.opacity(0.85))
            } else {
                Text(
                    "Tap below to run the on-device LLM and generate a "
                    + "personalised distraction report. Your data stays "
                    + "on the phone — only the rendered summary is sent to "
                    + "the desktop."
                )
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.65))
            }

            Button {
                Task { await session.generateReport() }
            } label: {
                HStack(spacing: 8) {
                    if session.reportInProgress { ProgressView().tint(.white) }
                    Text(session.reportError != nil ? "Retry distraction report" : "Generate distraction report")
                }
            }
            .buttonStyle(BrandPrimaryButtonStyle(disabled: session.reportInProgress))
            .disabled(session.reportInProgress)
        }
    }

    private var signOutCard: some View {
        BrandCard {
            Button(role: .destructive) {
                session.logout()
            } label: {
                HStack {
                    Image(systemName: "rectangle.portrait.and.arrow.right")
                    Text("Unpair this phone")
                    Spacer()
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.red.opacity(0.85))
            }
        }
    }

    // MARK: - Reusable bits

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.55))
            Spacer()
            Text(value)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.white.opacity(0.9))
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(.system(size: 28, weight: .heavy, design: .rounded))
                .foregroundStyle(BrandTheme.accent)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.55))
                .textCase(.uppercase)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.white.opacity(0.04))
        )
    }

    private func statusPill(text: String, color: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(text.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(color)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            Capsule().fill(color.opacity(0.12))
        )
    }

    @ViewBuilder
    private func lastUnlockText(last: Date) -> some View {
        // While a session is live, render with SwiftUI's
        // relative-date style so it ticks every second
        // ("3s ago", "4s ago", …). Once `sessionEndedAt`
        // is set the desktop session has ended, so freeze
        // the row at "X ago" computed against the end
        // timestamp — same freeze pattern as the main
        // "Time on phone" counter (which also stops
        // because `activeSince` is closed out in
        // handleDesktopStopped).
        if let endedAt = session.sessionEndedAt {
            Text(formatRelative(from: last, to: endedAt))
        } else {
            Text(last, style: .relative)
        }
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
