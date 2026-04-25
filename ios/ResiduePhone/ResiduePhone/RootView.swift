//
//  RootView.swift
//  ResiduePhone
//

import SwiftUI

struct RootView: View {
    @EnvironmentObject private var session: SessionStore

    var body: some View {
        NavigationStack {
            Group {
                if session.user == nil {
                    AuthView()
                } else if session.pairedSessionId == nil {
                    PairView()
                } else {
                    SessionView()
                }
            }
            .navigationTitle("Residue")
        }
        .tint(.purple)
    }
}
