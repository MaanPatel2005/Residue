//
//  ActiveSessionPoller.swift
//  ResiduePhone
//
//  Polls `/api/phone/active-session` on a fixed interval while the user
//  is signed in and surfaces transitions in `currentlyStudying` to the
//  `SessionStore`. Two transitions matter:
//
//    false → true  : the user just clicked "Start Session" on the
//                    desktop. The phone auto-binds (via /api/pair/auto)
//                    and starts the existing AppLifecycleMonitor — no
//                    6-digit code required.
//    true  → false : the user just clicked "End Session" on the
//                    desktop. The phone stops tracking and triggers the
//                    on-device Zetic Melange report generator
//                    automatically (same flow as today's manual
//                    "Generate distraction report" button — the button
//                    stays as a fallback).
//
//  The poller is intentionally stupid: a `Task.sleep` loop driven by an
//  actor. No background fetch, no SSE — just a plain REST poll that the
//  desktop's existing rate limit handles fine.
//

import Foundation
import os.log

private let log = Logger(subsystem: "com.residue.phone", category: "ActiveSessionPoller")

actor ActiveSessionPoller {
    enum Transition {
        /// Desktop session has just started for this account. The
        /// `startedAt` value is the millisecond timestamp the desktop
        /// stamped onto `studyStatus` — it lets the phone display the
        /// exact same "Started" time the desktop is showing instead
        /// of "right now (when the phone happened to notice)".
        case sessionStarted(sessionId: String, startedAt: Double?)
        /// Desktop session has just stopped for this account.
        case sessionEnded(sessionId: String)
    }

    private let api: ResidueAPI
    private let intervalSeconds: Double
    private var pollTask: Task<Void, Never>?
    private var lastSeenSessionId: String?
    private var lastSeenStudying: Bool = false

    init(
        api: ResidueAPI = ResidueAPI(),
        intervalSeconds: Double = Config.activeSessionPollIntervalSeconds
    ) {
        self.api = api
        self.intervalSeconds = intervalSeconds
    }

    /// Begin polling on behalf of the given token. Calling `start` while
    /// already polling cancels the previous task and starts a fresh one
    /// with the new token (e.g. after a re-login).
    func start(
        token: String,
        onTransition: @escaping @Sendable (Transition) async -> Void
    ) {
        pollTask?.cancel()
        pollTask = Task { [weak self, intervalSeconds] in
            guard let self else { return }
            log.info("Polling /api/phone/active-session every \(intervalSeconds, privacy: .public)s")
            while !Task.isCancelled {
                await self.tick(token: token, onTransition: onTransition)
                try? await Task.sleep(nanoseconds: UInt64(intervalSeconds * 1_000_000_000))
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
        lastSeenSessionId = nil
        lastSeenStudying = false
    }

    private func tick(
        token: String,
        onTransition: @escaping @Sendable (Transition) async -> Void
    ) async {
        let response: ActiveSessionResponse
        do {
            response = try await api.activeSession(token: token)
        } catch {
            // Transient network errors are normal during a network blip;
            // the next tick retries. Log at debug so we don't spam.
            log.debug("active-session poll failed: \(error.localizedDescription, privacy: .public)")
            return
        }

        let nowStudying = response.currentlyStudying
        let nowSessionId = response.currentSessionId
        let nowStartedAt = response.startedAt

        // Rising edge: either a true false→true transition for this
        // tick, OR a "late-bind" case where we just booted up / signed
        // in while a desktop session was already active. The two
        // conditions are merged into a single guard so we never fire
        // the same `.sessionStarted` transition twice on the same
        // tick (the previous "fire both" version forced the
        // SessionStore's bind-and-reset logic to run twice and
        // deduplicate; doing it here is cleaner).
        let isRisingEdge = nowStudying && !lastSeenStudying
        let isLateBind = nowStudying && lastSeenSessionId == nil
        if (isRisingEdge || isLateBind), let sid = nowSessionId {
            if isRisingEdge {
                log.info("session started: \(sid, privacy: .public)")
            } else {
                log.info("late-binding to in-progress session: \(sid, privacy: .public)")
            }
            await onTransition(.sessionStarted(sessionId: sid, startedAt: nowStartedAt))
        }

        // true → false: the desktop session just ended. We resolve the
        // sessionId from either the latest snapshot or the previous tick
        // so a late-arriving "endedAt" still triggers the report.
        if !nowStudying, lastSeenStudying {
            let sid = nowSessionId ?? lastSeenSessionId
            if let sid {
                log.info("session ended: \(sid, privacy: .public)")
                await onTransition(.sessionEnded(sessionId: sid))
            }
        }

        lastSeenStudying = nowStudying
        lastSeenSessionId = nowSessionId
    }
}
