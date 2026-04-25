//
//  ResiduePhoneApp.swift
//  ResiduePhone
//
//  Native iOS companion for the Residue desktop session.
//
//  The phone tracks distraction events (UIApplication lifecycle and, when the
//  user authorises Family Controls, ScreenTime app-usage tallies) during an
//  active Residue desktop study session. A Zetic Melange model classifies
//  each unlock + per-app-category usage block on-device using the Apple
//  Neural Engine, and the resulting label/score is POSTed back to the
//  Residue desktop backend so the desktop session productivity score
//  reflects real-world phone use in real time.
//

import SwiftUI

@main
struct ResiduePhoneApp: App {
    @StateObject private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .task { await session.bootstrap() }
        }
    }
}
