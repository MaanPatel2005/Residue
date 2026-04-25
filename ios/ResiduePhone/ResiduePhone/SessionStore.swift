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

    // Report generation
    @Published var reportSummary: String?
    @Published var reportInProgress: Bool = false
    @Published var reportLatencyMs: Double = 0

    @Published var statusMessage: String?

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
        token = UserDefaults.standard.string(forKey: "residue.token")
        if let t = token {
            do {
                user = try await api.me(token: t)
            } catch {
                token = nil
                UserDefaults.standard.removeObject(forKey: "residue.token")
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
        UserDefaults.standard.removeObject(forKey: "residue.token")
    }

    private func persistAuth(_ resp: AuthResponse) {
        token = resp.token
        user = resp.user
        UserDefaults.standard.set(resp.token, forKey: "residue.token")
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
            reportSummary = nil
            statusMessage = "Paired with desktop session"
            startSessionTracking(sessionId: resp.sessionId)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    // MARK: - Lifecycle tracking

    private func startSessionTracking(sessionId: String) {
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

    private func handleLifecycle(event: AppLifecycleMonitor.Event, sessionId: String) async {
        guard let token else { return }
        switch event {
        case .opened(let timestamp):
            openCount += 1
            lastOpenedAt = timestamp
            let payload = PhoneEventPayload(
                sessionId: sessionId,
                type: .open,
                timestamp: timestamp.timeIntervalSince1970 * 1000,
                durationMs: nil,
                inference: nil
            )
            try? await api.postEvent(payload, token: token)

        case .closed(let durationMs, let timestamp):
            totalDistractionMs += durationMs
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

    // MARK: - Distraction report (on-device Melange LLM)

    /// Generates a natural-language distraction report fully on-device using
    /// `ZeticMLangeLLMModel(name: "Steve/Qwen3.5-2B")`. The phone never sends
    /// the raw event log to the cloud — only the rendered summary travels
    /// back to the desktop session for display.
    func generateReport() async {
        guard let token, let sessionId = pairedSessionId else {
            statusMessage = "Not paired"
            return
        }
        reportInProgress = true
        defer { reportInProgress = false }

        let usage = await ScreenTimeUsage.shared.snapshot()
        let durationMin = sessionStart.map { Date().timeIntervalSince($0) / 60 } ?? 0
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
            statusMessage = "Report sent to desktop"
        } catch {
            statusMessage = "Report failed: \(error.localizedDescription)"
        }
    }
}
