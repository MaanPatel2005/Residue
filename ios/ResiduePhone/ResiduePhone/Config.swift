//
//  Config.swift
//  ResiduePhone
//
//  Central configuration. Override these via Info.plist `RESIDUE_BASE_URL` and
//  `MELANGE_PERSONAL_KEY` / `MELANGE_DISTRACTION_MODEL_KEY` when deploying.
//

import Foundation

enum Config {
    /// Backend base URL of the Residue desktop web app (Next.js). Default is
    /// the local-network address of a typical `npm run dev` host. Override per
    /// build via the `RESIDUE_BASE_URL` Info.plist key.
    static var baseURL: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "RESIDUE_BASE_URL") as? String,
           let url = URL(string: raw) {
            return url
        }
        return URL(string: "http://residue.local:3000")!
    }

    /// ZETIC Melange Personal Key for this build. Provisioned via the Melange
    /// Dashboard (https://melange.zetic.ai/) and stored in Info.plist.
    static var melangePersonalKey: String {
        Bundle.main.object(forInfoDictionaryKey: "MELANGE_PERSONAL_KEY") as? String ?? ""
    }

    /// Melange model key for the distraction classifier — uploaded ONNX from
    /// `public/models/phone-distraction.onnx` via the Melange Dashboard.
    static var distractionModelKey: String {
        Bundle.main.object(forInfoDictionaryKey: "MELANGE_DISTRACTION_MODEL_KEY") as? String
            ?? "residue/phone-distraction-v1"
    }
}
