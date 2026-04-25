//
//  ScreenTimeUsage.swift
//  ResiduePhone
//
//  Wrapper around Apple's FamilyControls + DeviceActivity APIs. When the user
//  authorises Family Controls (entitlement
//  `com.apple.developer.family-controls`), iOS exposes per-category usage
//  data via `DeviceActivityReport`. We project that into a fixed-size
//  category share vector that feeds the on-device Zetic Melange classifier.
//
//  In a production build this file pairs with a `DeviceActivityMonitor`
//  extension target that runs scheduled events during the desktop study
//  session window. The extension target is intentionally kept stubbed in
//  this repo — it requires the Family Controls entitlement which is a
//  per-developer provisioning step.
//

import Foundation
#if canImport(FamilyControls)
import FamilyControls
#endif

/// Order matches the model's `categoryShare` input slots.
enum AppCategorySlot: Int, CaseIterable {
    case productivity = 0
    case social
    case entertainment
    case games
    case communication
    case other
}

struct UsageSnapshot {
    /// Share of session time spent in each category (sums to ≤ 1.0).
    let shareVector: [Double]
    let totalMinutes: Double
    /// Same data, keyed by category name — convenient for prompt building.
    let perCategoryMinutes: [String: Double]

    static let empty = UsageSnapshot(
        shareVector: Array(repeating: 0.0, count: AppCategorySlot.allCases.count),
        totalMinutes: 0,
        perCategoryMinutes: [:]
    )
}

@MainActor
final class ScreenTimeUsage {
    static let shared = ScreenTimeUsage()
    private init() {}

    private(set) var authorized: Bool = false

    func requestAuthorization() async {
        #if canImport(FamilyControls)
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            authorized = AuthorizationCenter.shared.authorizationStatus == .approved
        } catch {
            authorized = false
        }
        #else
        authorized = false
        #endif
    }

    /// Pull the latest per-category share vector. The actual `DeviceActivityReport`
    /// extension is provisioned per-developer; this entry point is what the
    /// classifier feature builder calls. When the extension is not yet wired
    /// up we return an empty snapshot so the on-device classifier still runs
    /// (it falls back to the lifecycle-only signal).
    func snapshot() async -> UsageSnapshot {
        // TODO(family-controls): wire DeviceActivityReport extension and
        // populate this from ManagedSettings/DeviceActivity tokens.
        return .empty
    }
}
