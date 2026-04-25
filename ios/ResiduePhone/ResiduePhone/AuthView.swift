//
//  AuthView.swift
//  ResiduePhone
//

import SwiftUI

struct AuthView: View {
    enum Mode { case login, register }

    @EnvironmentObject private var session: SessionStore
    @State private var mode: Mode = .login
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var busy: Bool = false

    var body: some View {
        Form {
            Section {
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .autocapitalization(.none)
                SecureField("Password", text: $password)
                    .textContentType(mode == .login ? .password : .newPassword)
            } header: {
                Text(mode == .login ? "Sign in" : "Create an account")
            }

            Section {
                Button {
                    Task { await submit() }
                } label: {
                    HStack {
                        Spacer()
                        if busy { ProgressView() } else {
                            Text(mode == .login ? "Sign in" : "Create account")
                        }
                        Spacer()
                    }
                }
                .disabled(busy || email.isEmpty || password.count < 6)

                Button(mode == .login ? "Need an account?" : "Have one? Sign in") {
                    mode = mode == .login ? .register : .login
                }
                .font(.footnote)
            }

            if let msg = session.statusMessage {
                Section { Text(msg).foregroundStyle(.red).font(.footnote) }
            }
        }
    }

    private func submit() async {
        busy = true
        defer { busy = false }
        if mode == .login {
            await session.login(email: email, password: password)
        } else {
            await session.register(email: email, password: password)
        }
    }
}
