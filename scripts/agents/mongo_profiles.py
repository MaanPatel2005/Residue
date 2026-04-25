"""
MongoDB Profile Loader — Pulls real acoustic profiles for agent matching.

Connects to MongoDB Atlas and aggregates session data from `sessions_ts`,
`user_data`, and `user_agents` to build real acoustic profiles for each user.

Used by Study Buddy agents to replace hardcoded profiles with live data.
"""

import os
import math
from pathlib import Path
from typing import Any

# Load .env
project_root = Path(__file__).parent.parent.parent
env_file = project_root / ".env"
if env_file.exists():
    from dotenv import load_dotenv
    load_dotenv(env_file)

try:
    from pymongo import MongoClient
except ImportError:
    MongoClient = None  # type: ignore


def _get_db():
    """Get a handle to the residue database."""
    uri = os.environ.get("MONGODB_URI", "")
    if not uri or MongoClient is None:
        return None
    client = MongoClient(uri)
    return client["residue"]


def _extract_magnitude(band: Any) -> float:
    """Extract a numeric magnitude from a frequency band entry.

    Handles both formats found in the DB:
      - Plain float: [0.3, 0.5, ...]
      - Object: {"label": "Sub-bass", "range": [20, 60], "magnitude": 0.25}
    """
    if isinstance(band, (int, float)):
        return float(band)
    if isinstance(band, dict):
        return float(band.get("magnitude", 0))
    return 0.0


def load_user_profile(user_id: str) -> dict | None:
    """Load a real acoustic profile for a user from MongoDB.

    Aggregates data from:
      - sessions_ts: acoustic features (EQ bands, dB, spectral centroid)
      - user_data: display name, goals, preferred mode
      - user_agents: agent handle and address

    Returns a profile dict compatible with the Study Buddy agent format,
    or None if no data is available.
    """
    db = _get_db()
    if db is None:
        return None

    # ── Fetch user metadata ──────────────────────────────────────────────
    user_doc = db["users"].find_one({"_id": user_id})
    user_data = db["user_data"].find_one({"userId": user_id})
    user_agent = db["user_agents"].find_one({"userId": user_id})

    name = "Unknown"
    if user_data and user_data.get("profile", {}).get("displayName"):
        name = user_data["profile"]["displayName"]
    elif user_doc and user_doc.get("email"):
        name = user_doc["email"].split("@")[0]

    preferred_mode = "focus"
    if user_data and user_data.get("profile", {}).get("preferredMode"):
        preferred_mode = user_data["profile"]["preferredMode"]

    handle = None
    if user_agent:
        handle = user_agent.get("handle")

    # ── Aggregate acoustic data from sessions ────────────────────────────
    sessions = list(
        db["sessions_ts"]
        .find({"user_id": user_id})
        .sort("timestamp", -1)
        .limit(50)
    )

    if not sessions:
        # Check if there's bed data as fallback
        bed = db["beds"].find_one({"userId": user_id})
        if bed and bed.get("eqVector"):
            return {
                "user_id": user_id,
                "name": name,
                "handle": handle,
                "location": "Unknown",
                "optimal_db": 50.0,
                "db_range": [40, 60],
                "eq_gains": bed["eqVector"],
                "preferred_bands": [],
                "study_hours": "Unknown",
                "preferred_sounds": [bed.get("mode", "focus")],
                "focus_score_avg": 0,
                "session_count": 0,
                "source": "beds_fallback",
            }
        return None

    # Compute averages across sessions
    db_levels = []
    eq_band_sums = [0.0] * 7
    eq_band_counts = 0
    productivity_scores = []
    spectral_centroids = []
    dominant_freqs = []
    states: dict[str, int] = {}
    goals: dict[str, int] = {}

    for sess in sessions:
        af = sess.get("acoustic_features")
        if af:
            if af.get("overallDb") is not None:
                db_levels.append(float(af["overallDb"]))
            if af.get("spectralCentroid") is not None:
                spectral_centroids.append(float(af["spectralCentroid"]))
            if af.get("dominantFrequency") is not None:
                dominant_freqs.append(float(af["dominantFrequency"]))

            bands = af.get("frequencyBands", [])
            if bands and len(bands) >= 7:
                for i in range(7):
                    eq_band_sums[i] += _extract_magnitude(bands[i])
                eq_band_counts += 1

        ps = sess.get("productivity_score")
        if ps is not None:
            productivity_scores.append(float(ps))

        state = sess.get("state", "unknown")
        states[state] = states.get(state, 0) + 1

        goal = sess.get("goal", "focus")
        goals[goal] = goals.get(goal, 0) + 1

    # Compute averages
    avg_db = sum(db_levels) / len(db_levels) if db_levels else 50.0
    db_min = min(db_levels) if db_levels else 40.0
    db_max = max(db_levels) if db_levels else 60.0
    avg_productivity = (
        sum(productivity_scores) / len(productivity_scores)
        if productivity_scores else 0
    )
    avg_centroid = (
        sum(spectral_centroids) / len(spectral_centroids)
        if spectral_centroids else 0
    )

    eq_gains = [0.0] * 7
    if eq_band_counts > 0:
        eq_gains = [round(eq_band_sums[i] / eq_band_counts, 4) for i in range(7)]

    # Determine preferred bands (top 2 by magnitude)
    band_labels = [
        "Sub-bass (20-60Hz)",
        "Bass (60-250Hz)",
        "Low-mid (250-500Hz)",
        "Mid (500-2kHz)",
        "Upper-mid (2-4kHz)",
        "Presence (4-6kHz)",
        "Brilliance (6-20kHz)",
    ]
    sorted_bands = sorted(
        enumerate(eq_gains), key=lambda x: x[1], reverse=True
    )
    preferred_bands = [band_labels[i] for i, _ in sorted_bands[:2]]

    # Determine preferred sounds from goals/modes
    mode_to_sounds: dict[str, list[str]] = {
        "focus": ["brown noise", "rain"],
        "calm": ["forest sounds", "ocean waves"],
        "creative": ["cafe ambience", "lo-fi"],
        "social": ["cafe ambience", "park sounds"],
    }
    top_goal = max(goals, key=goals.get) if goals else "focus"  # type: ignore[arg-type]
    preferred_sounds = mode_to_sounds.get(top_goal, ["brown noise"])

    return {
        "user_id": user_id,
        "name": name,
        "handle": handle,
        "location": "On Campus",
        "optimal_db": round(avg_db, 1),
        "db_range": [round(db_min, 1), round(db_max, 1)],
        "eq_gains": eq_gains,
        "preferred_bands": preferred_bands,
        "study_hours": "Available",
        "preferred_sounds": preferred_sounds,
        "focus_score_avg": round(avg_productivity),
        "session_count": len(sessions),
        "avg_spectral_centroid": round(avg_centroid, 1),
        "dominant_state": max(states, key=states.get) if states else "unknown",  # type: ignore[arg-type]
        "preferred_mode": top_goal,
        "source": "mongodb_sessions",
    }


def load_all_user_profiles() -> list[dict]:
    """Load profiles for ALL users that have session data."""
    db = _get_db()
    if db is None:
        return []

    # Get distinct user_ids from sessions_ts
    user_ids = db["sessions_ts"].distinct("user_id")

    profiles = []
    for uid in user_ids:
        profile = load_user_profile(uid)
        if profile:
            profiles.append(profile)

    return profiles


def load_profile_by_agent_id(agent_id: int) -> dict | None:
    """Load a profile using the agent ID (maps to user via user_agents)."""
    db = _get_db()
    if db is None:
        return None

    agent_doc = db["user_agents"].find_one({"agentId": agent_id})
    if not agent_doc:
        # Try users collection
        user_doc = db["users"].find_one({"agentId": agent_id})
        if user_doc:
            return load_user_profile(user_doc["_id"])
        return None

    return load_user_profile(agent_doc["userId"])


if __name__ == "__main__":
    """Test the profile loader."""
    print("Loading all user profiles from MongoDB...\n")
    profiles = load_all_user_profiles()

    if not profiles:
        print("No profiles found. Make sure MONGODB_URI is set and sessions exist.")
    else:
        for p in profiles:
            print(f"User: {p['name']} ({p['user_id']})")
            print(f"  Handle: {p.get('handle', 'N/A')}")
            print(f"  Optimal dB: {p['optimal_db']} (range: {p['db_range']})")
            print(f"  EQ gains: {p['eq_gains']}")
            print(f"  Preferred bands: {p['preferred_bands']}")
            print(f"  Focus score avg: {p['focus_score_avg']}")
            print(f"  Sessions: {p['session_count']}")
            print(f"  Source: {p['source']}")
            print()
