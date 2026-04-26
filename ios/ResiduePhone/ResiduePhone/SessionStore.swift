//
//  SessionStore.swift
//  ResiduePhone
//
//  App-wide observable state. Holds:
//    - the current authenticated account (token + user) persisted in
//      `UserDefaults` (kept simple here; production should use Keychain).
//    - the active pairing (sessionId of the desktop session this phone is
//      bound to, plus a per-device id used as a tie-break on the desktop).
//    - lifecycle counters surfaced by the UI.
//

import Foundation
import UIKit
import os.log

private let log = Logger(subsystem: "com.residue.phone", category: "SessionStore")

@MainActor
final class SessionStore: ObservableObject {
    // Auth
    @Published var token: String?
    @Published var user: AuthUser?

    // Pairing
    @Published var pairedSessionId: String?
    @Published var sessionStart: Date?
    /// Timestamp at which the desktop ended the current session.
    /// Drives the "Session ended on desktop — generating report…"
    /// banner the user sees on the falling edge.
    @Published var sessionEndedAt: Date?

    // Live counters
    @Published var openCount: Int = 0
    @Published var totalDistractionMs: Double = 0
    @Published var lastOpenedAt: Date?
    @Published var activeSince: Date?

    // Report generation
    @Published var reportSummary: String?
    @Published var reportInProgress: Bool = false
    @Published var reportLatencyMs: Double = 0
    /// Set when `generateReport()` fails (e.g. Melange key missing,
    /// SDK not linked, network error). The SessionView surfaces it
    /// directly in the report section so the user understands why
    /// nothing rendered.
    @Published var reportError: String?

    @Published var statusMessage: String?

    private enum DefaultsKey {
        static let token = "residue.token"
        static let deviceId = "residue.deviceId"
        static let sessionStart = "residue.sessionStart"
        static let openCount = "residue.openCount"
        static let totalDistractionMs = "residue.totalDistractionMs"
    }

    private let api = ResidueAPI()
    private let deviceId: String = {
        if let stored = UserDefaults.standard.string(forKey: "residue.deviceId") {
            return stored
        }
        let new = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        UserDefaults.standard.set(new, forKey: "residue.deviceId")
        return new
    }()

    private var monitor: AppLifecycleMonitor?
    private let melange = MelangeReportGenerator()
    private let activeSessionPoller = ActiveSessionPoller()

    func bootstrap() async {
        token = UserDefaults.standard.string(forKey: DefaultsKey.token)
        loadPersistedSessionState()
        if let t = token {
            do {
                user = try await api.me(token: t)
                // Intentionally do NOT default `sessionStart` here. It
                // is reset to the desktop's `studyStatus.startedAt` on
                // the rising edge of a desktop session (see
                // `bindToActiveSession`). Defaulting it on bootstrap
                // would make the SessionView show a stale "Started"
                // time that has nothing to do with the currently
                // running study session.
                //
                // Also do an immediate active-session check so a phone
                // that was already paired before the app was killed
                // reattaches to the in-progress desktop session within
                // ~one network round-trip rather than waiting for the
                // first poll tick.
                if let active = try? await api.activeSession(token: t),
                   active.currentlyStudying,
                   let sid = active.currentSessionId {
                    await bindToActiveSession(sessionId: sid, startedAt: active.startedAt)
                }
                startSessionTracking(sessionId: pairedSessionId)
                await startActiveSessionPolling(token: t)
            } catch {
                token = nil
                UserDefaults.standard.removeObject(forKey: DefaultsKey.token)
            }
        }
    }

    // MARK: - Auth

    func login(email: String, password: String) async {
        do {
            let resp = try await api.login(email: email, password: password)
            await persistAuth(resp)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func register(email: String, password: String) async {
        do {
            let resp = try await api.register(email: email, password: password)
            await persistAuth(resp)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    /// Sign in via the 6-digit pairing code displayed on the desktop.
    /// In one round-trip this both mints the phone's auth token and
    /// binds it to the in-progress desktop study session — the user
    /// never has to type their account password on the phone.
    func loginWithCode(code: String) async {
        do {
            let resp = try await api.loginWithCode(code: code, deviceId: deviceId)
            token = resp.token
            user = resp.user
            UserDefaults.standard.set(resp.token, forKey: DefaultsKey.token)
            // Treat this exactly like a rising-edge auto-bind: the
            // pairing code references an active desktop session, so
            // counters reset and tracking starts immediately.
            pairedSessionId = resp.sessionId
            sessionStart = Date()
            sessionEndedAt = nil
            openCount = 0
            totalDistractionMs = 0
            activeSince = nil
            reportSummary = nil
            reportError = nil
            statusMessage = "Paired with desktop session"
            persistSessionState()
            stopSessionTracking()
            startSessionTracking(sessionId: resp.sessionId)
            await startActiveSessionPolling(token: resp.token)
            log.info("code-login bound to desktop session \(resp.sessionId, privacy: .public)")
        } catch {
            log.error("code-login failed: \(error.localizedDescription, privacy: .public)")
            statusMessage = error.localizedDescription
        }
    }

    func logout() {
        stopSessionTracking()
        Task { [activeSessionPoller] in await activeSessionPoller.stop() }
        token = nil
        user = nil
        pairedSessionId = nil
        sessionStart = nil
        openCount = 0
        totalDistractionMs = 0
        activeSince = nil
        reportSummary = nil
        UserDefaults.standard.removeObject(forKey: DefaultsKey.token)
        clearPersistedSessionState()
    }

    private func persistAuth(_ resp: AuthResponse) async {
        token = resp.token
        user = resp.user
        UserDefaults.standard.set(resp.token, forKey: DefaultsKey.token)
        statusMessage = nil
        persistSessionState()

        // Immediately check for an active desktop session and bind
        // synchronously, so SessionView's "Started" time + counters
        // already reflect the desktop session before the user sees
        // the next render. Without this the user signs in, sees
        // sessionStart="—" / counters at 0, and has to wait for the
        // 5-second polling interval before the screen updates.
        if let active = try? await api.activeSession(token: resp.token),
           active.currentlyStudying,
           let sid = active.currentSessionId {
            await bindToActiveSession(sessionId: sid, startedAt: active.startedAt)
        }

        startSessionTracking(sessionId: pairedSessionId)
        await startActiveSessionPolling(token: resp.token)
    }

    // MARK: - Pairing

    func claim(code: String) async {
        guard let token else {
            statusMessage = "Sign in first"
            return
        }
        do {
            let resp = try await api.claim(code: code, deviceId: deviceId, token: token)
            pairedSessionId = resp.sessionId
            sessionStart = Date()
            openCount = 0
            totalDistractionMs = 0
            activeSince = nil
            reportSummary = nil
            statusMessage = "Paired with desktop session"
            persistSessionState()
            startSessionTracking(sessionId: resp.sessionId)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    /// Auto-bind to a desktop session that the active-session poller
    /// just observed. No 6-digit code, no UI flow — the same end state
    /// as `claim(code:)` but driven by the backend signal that the
    /// same-account user just clicked "Start Session" on the laptop.
    ///
    /// `startedAt` is the millisecond timestamp the desktop stamped on
    /// `studyStatus.startedAt`. When supplied the SessionView's
    /// "Started" label exactly matches the desktop's session-start
    /// time; when absent we fall back to "now".
    func bindToActiveSession(sessionId: String, startedAt: Double? = nil) async {
        guard let token else { return }
        if pairedSessionId == sessionId {
            // Already bound to this session — nothing to do.
            return
        }
        do {
            let resp = try await api.autoPair(sessionId: sessionId, deviceId: deviceId, token: token)
            pairedSessionId = resp.sessionId
            sessionStart = startedAt.map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
            sessionEndedAt = nil
            openCount = 0
            totalDistractionMs = 0
            activeSince = nil
            reportSummary = nil
            reportError = nil
            statusMessage = "Paired with desktop session"
            persistSessionState()
            stopSessionTracking()
            startSessionTracking(sessionId: resp.sessionId)
            log.info("auto-bound to desktop session \(resp.sessionId, privacy: .public)")
        } catch {
            log.error("auto-bind failed: \(error.localizedDescription, privacy: .public)")
            statusMessage = "Auto-pair failed: \(error.localizedDescription)"
        }
    }

    // MARK: - Active session polling

    private func startActiveSessionPolling(token: String) async {
        await activeSessionPoller.stop()
        await activeSessionPoller.start(token: token) { [weak self] transition in
            guard let self else { return }
            switch transition {
            case .sessionStarted(let sessionId, let startedAt):
                await self.bindToActiveSession(sessionId: sessionId, startedAt: startedAt)
            case .sessionEnded(let sessionId):
                await self.handleDesktopStopped(sessionId: sessionId)
            }
        }
    }

    /// Hook fired by `ActiveSessionPoller` when the desktop session ends.
    ///
    /// Stops the lifecycle monitor (no further open/close events should
    /// be attributed to a session that no longer exists) and triggers the
    /// existing on-device Zetic Melange report flow automatically — the
    /// same `generateReport()` path the manual button still calls. The
    /// resulting summary is shown in the same `SessionView`
    /// "On-device distraction report" section and POSTed to
    /// `/api/phone/report` so the desktop can render it (and the server
    /// fires `feedReportIntoAgents()` to update the user's personal
    /// Fetch.ai correlation profile).
    func handleDesktopStopped(sessionId: String) async {
        log.info("desktop stopped session \(sessionId, privacy: .public)")
        // Make sure we attribute the report to the session that just
        // ended, not any session that might race in afterwards.
        if pairedSessionId == nil {
            pairedSessionId = sessionId
        }
        // Stamp the falling-edge time so SessionView can show a
        // visible "Session ended on desktop" banner the user can
        // see even before the report finishes generating.
        sessionEndedAt = Date()
        statusMessage = "Session ended on desktop — generating report…"
        reportError = nil
        stopSessionTracking()
        // Close out any open distraction segment so the live "Time
        // on phone" counter stops ticking the instant the desktop
        // session ends. Without this, if the phone happens to be in
        // the middle of a distraction period when the desktop hits
        // "End Session", the SessionView keeps incrementing
        // `currentTotalDistractionMs(now:)` forever.
        if let opened = activeSince {
            totalDistractionMs += Date().timeIntervalSince(opened) * 1000
            activeSince = nil
            persistSessionState()
        }
        // Avoid double-firing if the user already tapped the manual
        // "Generate distraction report" button while the session was
        // running.
        if reportInProgress { return }
        if reportSummary != nil { return }
        await generateReport()
    }

    // MARK: - Lifecycle tracking

    private func startSessionTracking(sessionId: String?) {
        guard monitor == nil else { return }
        let mon = AppLifecycleMonitor { [weak self] event in
            Task { await self?.handleLifecycle(event: event, sessionId: sessionId) }
        }
        monitor = mon
        mon.start()
    }

    private func stopSessionTracking() {
        monitor?.stop()
        monitor = nil
    }

    private func loadPersistedSessionState() {
        let defaults = UserDefaults.standard
        if let startInterval = defaults.object(forKey: DefaultsKey.sessionStart) as? Double {
            sessionStart = Date(timeIntervalSince1970: startInterval)
        }
        openCount = defaults.integer(forKey: DefaultsKey.openCount)
        totalDistractionMs = defaults.double(forKey: DefaultsKey.totalDistractionMs)
    }

    private func persistSessionState() {
        let defaults = UserDefaults.standard
        if let start = sessionStart {
            defaults.set(start.timeIntervalSince1970, forKey: DefaultsKey.sessionStart)
        }
        defaults.set(openCount, forKey: DefaultsKey.openCount)
        defaults.set(totalDistractionMs, forKey: DefaultsKey.totalDistractionMs)
    }

    private func clearPersistedSessionState() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: DefaultsKey.sessionStart)
        defaults.removeObject(forKey: DefaultsKey.openCount)
        defaults.removeObject(forKey: DefaultsKey.totalDistractionMs)
    }

    private func handleLifecycle(event: AppLifecycleMonitor.Event, sessionId: String?) async {
        guard let token else { return }
        switch event {
        case .opened(let timestamp):
            openCount += 1
            lastOpenedAt = timestamp
            activeSince = timestamp
            persistSessionState()
            if let sessionId {
                let payload = PhoneEventPayload(
                    sessionId: sessionId,
                    type: .open,
                    timestamp: timestamp.timeIntervalSince1970 * 1000,
                    durationMs: nil,
                    inference: nil
                )
                try? await api.postEvent(payload, token: token)
            }

        case .closed(let durationMs, let timestamp):
            totalDistractionMs += durationMs
            activeSince = nil
            persistSessionState()
            if let sessionId {
                let payload = PhoneEventPayload(
                    sessionId: sessionId,
                    type: .close,
                    timestamp: timestamp.timeIntervalSince1970 * 1000,
                    durationMs: durationMs,
                    inference: nil
                )
                try? await api.postEvent(payload, token: token)
            }
        }
    }

    // MARK: - Distraction report (on-device Melange LLM)

    /// Generates a natural-language distraction report fully on-device using
    /// `ZeticMLangeLLMModel(name: "Steve/Qwen3.5-2B")`. The phone never sends
    /// the raw event log to the cloud — only the rendered summary travels
    /// back to the desktop session for display.
    func generateReport() async {
        guard let token else {
            statusMessage = "Sign in first"
            return
        }
        reportInProgress = true
        reportError = nil
        defer { reportInProgress = false }

        let usage = await ScreenTimeUsage.shared.snapshot()
        let durationMin = sessionStart.map { Date().timeIntervalSince($0) / 60 } ?? 0
        log.info("[generateReport] Starting — session \(String(format: "%.1f", durationMin))min, \(self.openCount) unlocks, \(String(format: "%.1f", self.totalDistractionMs / 60_000))min on phone")
        let prompt = MelangeReportGenerator.buildPrompt(
            durationMinutes: durationMin,
            openCount: openCount,
            totalDistractionMinutes: totalDistractionMs / 60_000,
            perCategoryMinutes: usage.perCategoryMinutes
        )

        do {
            let result = try await melange.generate(prompt: prompt)
            reportSummary = result.text
            reportLatencyMs = result.inferenceMs
            log.info("[generateReport] Done — model=\(result.modelKey) prompt=\(result.promptTokens)tok completion=\(result.completionTokens)tok latency=\(String(format: "%.0f", result.inferenceMs))ms")
            if let sessionId = pairedSessionId {
                try await api.postReport(
                    ReportPayload(
                        sessionId: sessionId,
                        summary: result.text,
                        perCategoryMinutes: usage.perCategoryMinutes,
                        modelKey: result.modelKey,
                        inferenceMs: result.inferenceMs,
                        promptTokens: result.promptTokens,
                        completionTokens: result.completionTokens,
                        unlockCount: openCount,
                        totalDistractionMs: totalDistractionMs
                    ),
                    token: token
                )
                log.info("[generateReport] Report posted to desktop session \(sessionId)")
                statusMessage = "Report generated locally and sent to desktop"
            } else {
                statusMessage = "Local report generated"
            }
        } catch {
            log.error("[generateReport] Failed: \(error.localizedDescription)")
            reportError = error.localizedDescription
            statusMessage = "Report failed: \(error.localizedDescription)"
        }
    }
}
