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

    // Live counters
    @Published var openCount: Int = 0
    @Published var totalDistractionMs: Double = 0
    @Published var lastOpenedAt: Date?
    @Published var activeSince: Date?

    // Report generation
    @Published var reportSummary: String?
    @Published var reportInProgress: Bool = false
    @Published var reportLatencyMs: Double = 0

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

    func bootstrap() async {
        token = UserDefaults.standard.string(forKey: DefaultsKey.token)
        loadPersistedSessionState()
        if let t = token {
            do {
                user = try await api.me(token: t)
                if sessionStart == nil {
                    sessionStart = Date()
                }
                startSessionTracking(sessionId: pairedSessionId)
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
            persistAuth(resp)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func register(email: String, password: String) async {
        do {
            let resp = try await api.register(email: email, password: password)
            persistAuth(resp)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func logout() {
        stopSessionTracking()
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

    private func persistAuth(_ resp: AuthResponse) {
        token = resp.token
        user = resp.user
        UserDefaults.standard.set(resp.token, forKey: DefaultsKey.token)
        if sessionStart == nil {
            sessionStart = Date()
        }
        startSessionTracking(sessionId: pairedSessionId)
        persistSessionState()
        statusMessage = nil
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
                        completionTokens: result.completionTokens
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
            statusMessage = "Report failed: \(error.localizedDescription)"
        }
    }
}
