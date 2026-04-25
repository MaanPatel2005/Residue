//
//  MelangeReportGenerator.swift
//  ResiduePhone
//
//  On-device distraction-report generator backed by the ZETIC Melange LLM
//  SDK (`ZeticMLangeLLMModel`, version 1.6.0+). The model executes
//  fully on-device (Apple Neural Engine via Melange's automatic NPU
//  acceleration) — no prompt or completion text leaves the phone except for
//  the final user-visible summary that the user explicitly chooses to send
//  back to the paired desktop session.
//
//  The Melange import is conditional on the Swift Package Manager dependency
//  being added to the Xcode project (per the user-supplied integration
//  steps). Until then the generator falls back to a deterministic, locally
//  rendered template so the rest of the app builds and demos cleanly.
//

import Foundation
#if canImport(ZeticMLange)
import ZeticMLange
#endif

struct GeneratedReport {
    let text: String
    let modelKey: String
    let inferenceMs: Double
    let promptTokens: Int
    let completionTokens: Int
}

enum MelangeError: LocalizedError {
    case missingPersonalKey
    case sdkUnavailable
    case modelLoadFailed(String)
    case inferenceFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingPersonalKey:
            return "MELANGE_PERSONAL_KEY missing in Info.plist"
        case .sdkUnavailable:
            return "ZeticMLange SDK not linked. Add the SPM package per README."
        case .modelLoadFailed(let m): return "Melange load failed: \(m)"
        case .inferenceFailed(let m): return "Melange inference failed: \(m)"
        }
    }
}

actor MelangeReportGenerator {

    #if canImport(ZeticMLange)
    private var model: ZeticMLangeLLMModel?
    #endif

    /// Loads the Qwen3.5-2B model lazily on first use. Subsequent calls reuse
    /// the same model instance to avoid reloading weights each session.
    func generate(prompt: String) async throws -> GeneratedReport {
        let modelKey = Config.distractionModelKey
        let personalKey = Config.melangePersonalKey

        #if canImport(ZeticMLange)
        guard !personalKey.isEmpty else { throw MelangeError.missingPersonalKey }

        if model == nil {
            do {
                // version: optional (nil = latest). modelMode controls the
                // latency/accuracy trade-off; .RUN_AUTO defers to Melange.
                model = try ZeticMLangeLLMModel(
                    personalKey: personalKey,
                    name: modelKey,
                    version: 1,
                    modelMode: LLMModelMode.RUN_AUTO,
                    onDownload: { _ in }
                )
            } catch {
                throw MelangeError.modelLoadFailed(error.localizedDescription)
            }
        }

        guard let model else { throw MelangeError.sdkUnavailable }

        let start = Date()
        do {
            try model.run(prompt)
        } catch {
            throw MelangeError.inferenceFailed(error.localizedDescription)
        }

        var buffer = ""
        var generated = 0
        while true {
            let waitResult = model.waitForNextToken()
            if waitResult.generatedTokens == 0 { break }
            buffer.append(waitResult.token)
            generated = waitResult.generatedTokens
        }

        let inferenceMs = Date().timeIntervalSince(start) * 1000
        return GeneratedReport(
            text: buffer.trimmingCharacters(in: .whitespacesAndNewlines),
            modelKey: modelKey,
            inferenceMs: inferenceMs,
            promptTokens: prompt.split(separator: " ").count,
            completionTokens: generated
        )
        #else
        // Fallback path used when the Xcode project hasn't yet had the
        // ZeticMLange Swift package added. Renders a deterministic summary so
        // the surrounding app remains testable without the SDK.
        let text = MelangeReportGenerator.fallbackTemplate(prompt: prompt)
        return GeneratedReport(
            text: text,
            modelKey: modelKey,
            inferenceMs: 0,
            promptTokens: prompt.split(separator: " ").count,
            completionTokens: text.split(separator: " ").count
        )
        #endif
    }

    nonisolated static func buildPrompt(
        durationMinutes: Double,
        openCount: Int,
        totalDistractionMinutes: Double,
        perCategoryMinutes: [String: Double]
    ) -> String {
        let categoryLines = perCategoryMinutes
            .sorted { $0.value > $1.value }
            .map { "- \($0.key): \(String(format: "%.1f", $0.value)) min" }
            .joined(separator: "\n")

        return """
        You are an empathetic study coach analysing a phone-distraction log
        captured during the user's most recent focus session. Be specific and
        constructive. Output 3–4 short sentences in plain English.

        Session length: \(String(format: "%.1f", durationMinutes)) minutes
        Phone unlocks during session: \(openCount)
        Total minutes spent on phone during session: \(String(format: "%.1f", totalDistractionMinutes))
        Per-category minutes:
        \(categoryLines.isEmpty ? "(no app-category data available)" : categoryLines)

        Write the report:
        """
    }

    private static func fallbackTemplate(prompt _: String) -> String {
        return """
        Distraction report unavailable: ZeticMLange SDK not linked yet.
        Add the package via Xcode → File → Add Packages with URL
        https://github.com/zetic-ai/ZeticMLangeiOS.git pinned to 1.6.0,
        then set MELANGE_PERSONAL_KEY in Info.plist.
        """
    }
}
