//
//  ResidueAPI.swift
//  ResiduePhone
//
//  Thin client for the Residue desktop backend. Mirrors the Next.js API
//  routes added under `src/app/api/{auth,pair,phone}/…` on the desktop side.
//

import Foundation

struct AuthUser: Codable, Equatable {
    let uid: String
    let email: String
}

struct AuthResponse: Codable {
    let token: String
    let user: AuthUser
}

struct PairClaimResponse: Codable {
    let sessionId: String
    let userId: String
    let claimedAt: Double?
}

/// Mirrors the on-device distraction classifier output produced by the Zetic
/// Melange model. Encodes 1:1 to the desktop's `PhoneStateInference` shape.
struct DistractionInference: Codable {
    enum Label: String, Codable, CaseIterable {
        case glance
        case offTask = "off_task"
        case breakNeeded = "break_needed"
        case unknown
    }

    let label: Label
    let probabilities: [String: Double]
    let penaltyScore: Double
    let inferenceMs: Double
    let executionProvider: String
    let modelVersion: String
}

enum PhoneEventType: String, Codable {
    case open
    case close
    case heartbeat
}

struct PhoneEventPayload: Codable {
    let sessionId: String
    let type: PhoneEventType
    let timestamp: Double
    let durationMs: Double?
    let inference: DistractionInference?
}

/// Mirrors the desktop's `/api/phone/report` body: the natural-language
/// distraction summary produced on-device by the Melange LLM.
struct ReportPayload: Codable {
    let sessionId: String
    let summary: String
    let perCategoryMinutes: [String: Double]
    let modelKey: String
    let inferenceMs: Double
    let promptTokens: Int
    let completionTokens: Int
}

enum APIError: LocalizedError {
    case http(Int, String?)
    case decoding(Error)
    case transport(Error)

    var errorDescription: String? {
        switch self {
        case .http(let code, let msg):
            return msg.map { "HTTP \(code): \($0)" } ?? "HTTP \(code)"
        case .decoding(let err): return "Decoding error: \(err.localizedDescription)"
        case .transport(let err): return err.localizedDescription
        }
    }
}

final class ResidueAPI {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        return e
    }()

    init(baseURL: URL = Config.baseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    // MARK: - Auth

    func login(email: String, password: String) async throws -> AuthResponse {
        try await postJSON(
            path: "/api/auth/login",
            body: ["email": email, "password": password]
        )
    }

    func register(email: String, password: String) async throws -> AuthResponse {
        try await postJSON(
            path: "/api/auth/register",
            body: ["email": email, "password": password]
        )
    }

    func me(token: String) async throws -> AuthUser {
        struct Wrapper: Decodable { let user: AuthUser }
        let wrapped: Wrapper = try await getJSON(path: "/api/auth/me", token: token)
        return wrapped.user
    }

    // MARK: - Pairing

    func claim(code: String, deviceId: String, token: String) async throws -> PairClaimResponse {
        try await postJSON(
            path: "/api/pair/claim",
            body: ["code": code, "phoneDeviceId": deviceId],
            token: token
        )
    }

    // MARK: - Phone events

    func postEvent(_ event: PhoneEventPayload, token: String) async throws {
        struct Empty: Decodable {}
        let _: Empty = try await postJSON(path: "/api/phone/event", body: event, token: token)
    }

    func postReport(_ report: ReportPayload, token: String) async throws {
        struct Empty: Decodable {}
        let _: Empty = try await postJSON(path: "/api/phone/report", body: report, token: token)
    }

    // MARK: - Internals

    private func postJSON<B: Encodable, R: Decodable>(
        path: String,
        body: B,
        token: String? = nil
    ) async throws -> R {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try encoder.encode(body)
        return try await perform(req)
    }

    private func postJSON<R: Decodable>(
        path: String,
        body: [String: String],
        token: String? = nil
    ) async throws -> R {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await perform(req)
    }

    private func getJSON<R: Decodable>(path: String, token: String) async throws -> R {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "GET"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return try await perform(req)
    }

    private func perform<R: Decodable>(_ req: URLRequest) async throws -> R {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.transport(error)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.http(0, "no response")
        }
        guard (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw APIError.http(http.statusCode, msg)
        }
        if R.self == EmptyResponse.self { return EmptyResponse() as! R }
        do {
            return try decoder.decode(R.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}

struct EmptyResponse: Decodable {}
