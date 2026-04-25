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
                } else {
                    SessionView()
                }
            }
            .navigationTitle("Residue")
        }
        .tint(.purple)
    }
}
