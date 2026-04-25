//
//  AppLifecycleMonitor.swift
//  ResiduePhone
//
//  Subscribes to UIApplication notifications and emits open/close events.
//
//  iOS does not let third-party apps observe the user's other apps directly
//  (privacy boundary). The closest legitimate signal is our companion app's
//  own foreground/background transitions — paired with ScreenTime
//  category-of-app reporting (see ScreenTimeUsage). This monitor handles the
//  former; in production the user has the Residue companion app open during
//  the study session, and any time they return to the home screen / unlock
//  to use another app is a meaningful "phone in use" signal.
//

import Foundation
import UIKit

final class AppLifecycleMonitor {
    enum Event {
        case opened(Date)
        case closed(durationMs: Double, at: Date)
    }

    private let handler: (Event) -> Void
    private var lastForegroundEnter: Date?
    private var observers: [NSObjectProtocol] = []

    init(handler: @escaping (Event) -> Void) {
        self.handler = handler
    }

    func start() {
        let nc = NotificationCenter.default
        observers.append(
            nc.addObserver(
                forName: UIApplication.didBecomeActiveNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                let now = Date()
                self?.lastForegroundEnter = now
                self?.handler(.opened(now))
            }
        )
        observers.append(
            nc.addObserver(
                forName: UIApplication.willResignActiveNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                let now = Date()
                let duration = self?.lastForegroundEnter.map { now.timeIntervalSince($0) * 1000 } ?? 0
                self?.handler(.closed(durationMs: duration, at: now))
            }
        )
    }

    func stop() {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers.removeAll()
    }
}
