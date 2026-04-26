"""
Residue — CorrelationAgent (Fetch.ai uAgents + ASI1-Mini)

Long-running agent that consumes session data, builds the user's
personal acoustic-to-state model, and uses ASI1-Mini to generate
insights about the user's acoustic preferences.

This agent also persists profiles to MongoDB and participates in
cross-agent matching: it can query MongoDB Atlas Vector Search for
users with similar acoustic profiles and exchange profiles directly
with their CorrelationAgents to confirm bidirectional compatibility.

Runs on a 5-minute interval AND on demand via message.
"""

import os
import json
import math
import requests
from datetime import datetime, timezone
from uuid import uuid4
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from uagents import Agent, Context, Model, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

# Load .env from project root so ASI1_API_KEY / MONGODB_URI are available
load_dotenv(Path(__file__).parent.parent.parent / ".env")

# pymongo is optional at import-time; we degrade gracefully when missing or
# when MONGODB_URI is not configured.
try:
    from pymongo import MongoClient, ASCENDING, ReturnDocument  # type: ignore
    from pymongo.collection import Collection  # type: ignore
except ImportError:  # pragma: no cover — pymongo is in requirements but keep robust
    MongoClient = None  # type: ignore
    ASCENDING = 1  # type: ignore
    ReturnDocument = None  # type: ignore
    Collection = Any  # type: ignore


# ── Data Models ──────────────────────────────────────────────────────────────

class CorrelationRequest(Model):
    user_id: str
    sessions: str  # JSON-serialized list of session data
    # Optional metadata used by the matching algorithm. These are not produced
    # by build_optimal_profile() but are required by compute_compatibility().
    preferred_sounds: Optional[list[str]] = None
    study_hours: Optional[str] = None
    focus_score_avg: Optional[float] = None
    location: Optional[str] = None

class CorrelationResponse(Model):
    user_id: str
    optimal_db: float
    db_range: list[float]
    eq_gains: list[float]  # 7-band
    preferred_bands: list[str]
    confidence: float
    insight: str  # ASI1-Mini generated insight
    data_points: int

class ProfileQueryRequest(Model):
    user_id: str

class ProfileQueryResponse(Model):
    user_id: str
    has_profile: bool
    profile_json: str  # JSON-serialized profile or empty


# Cross-agent matching models (typed agent-to-agent messages, not chat)

class FindMatchesRequest(Model):
    user_id: str
    top_k: int = 5  # how many matches to return

class FindMatchesResponse(Model):
    user_id: str
    matches_json: str  # JSON array of match dicts (see _serialize_match)

class ProfileExchangeRequest(Model):
    requester_user_id: str
    requester_profile_json: str  # JSON of the requester's acoustic profile
    requester_agent_address: str

class ProfileExchangeResponse(Model):
    responder_user_id: str
    responder_profile_json: str
    compatibility_json: str  # JSON of compatibility scores
    reasoning: str


# Optional metadata update message — lets a client populate the matching
# fields (preferred_sounds, study_hours, focus_score_avg, location) without
# rerunning the full correlation pipeline.

class UpdateProfileMetadata(Model):
    user_id: str
    preferred_sounds: Optional[list[str]] = None
    study_hours: Optional[str] = None
    focus_score_avg: Optional[float] = None
    location: Optional[str] = None

class UpdateProfileMetadataAck(Model):
    user_id: str
    ok: bool
    message: str = ""


# ── ASI1-Mini Integration ────────────────────────────────────────────────────

ASI1_API_URL = "https://api.asi1.ai/v1/chat/completions"
BAND_LABELS = ["Sub-bass", "Bass", "Low-mid", "Mid", "Upper-mid", "Presence", "Brilliance"]

def call_asi1_mini(system_prompt: str, user_prompt: str) -> str:
    api_key = os.environ.get("ASI1_API_KEY", "")
    if not api_key:
        return ""
    try:
        response = requests.post(
            ASI1_API_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={
                "model": "asi1-mini",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.4,
                "max_tokens": 200,
            },
            timeout=15,
        )
        if response.status_code == 200:
            return response.json()["choices"][0]["message"]["content"]
    except Exception:
        pass
    return ""


def build_optimal_profile(sessions_json: str) -> dict:
    """Analyze session data and build optimal acoustic profile."""
    try:
        sessions = json.loads(sessions_json)
    except json.JSONDecodeError:
        return {"error": "Invalid session data"}

    if len(sessions) < 2:
        return {"error": "Need at least 2 sessions", "data_points": len(sessions)}

    # Bucket by dB level
    db_buckets: dict[int, dict] = {}
    for s in sessions:
        acoustic = s.get("acoustic", {})
        productivity = s.get("productivity_score", 50)
        db = acoustic.get("overall_db", 50)
        bucket = round(db / 5) * 5
        if bucket not in db_buckets:
            db_buckets[bucket] = {"total_prod": 0, "count": 0}
        db_buckets[bucket]["total_prod"] += productivity
        db_buckets[bucket]["count"] += 1

    # Find best dB
    best_db = 50
    best_avg = 0
    for db, data in db_buckets.items():
        avg = data["total_prod"] / data["count"]
        if avg > best_avg:
            best_avg = avg
            best_db = db

    # Build EQ gains from high-productivity sessions
    good_sessions = [s for s in sessions if s.get("productivity_score", 0) >= 60]
    eq_gains = [0.0] * 7
    eq_counts = [0] * 7
    for s in good_sessions:
        bands = s.get("acoustic", {}).get("frequency_bands", [])
        for i, mag in enumerate(bands[:7]):
            eq_gains[i] += mag
            eq_counts[i] += 1

    for i in range(7):
        eq_gains[i] = eq_gains[i] / eq_counts[i] if eq_counts[i] > 0 else 0.0

    avg_gain = sum(eq_gains) / 7 if any(eq_gains) else 0
    preferred_bands = [BAND_LABELS[i] for i in range(7) if eq_gains[i] > avg_gain]

    confidence = min(len(sessions) / 20, 1.0)

    # Get ASI1-Mini insight
    insight = generate_profile_insight(best_db, eq_gains, preferred_bands, len(sessions), confidence)

    return {
        "optimal_db": best_db,
        "db_range": [max(0, best_db - 5), best_db + 5],
        "eq_gains": [round(g, 4) for g in eq_gains],
        "preferred_bands": preferred_bands,
        "confidence": round(confidence, 2),
        "insight": insight,
        "data_points": len(sessions),
    }


def generate_profile_insight(optimal_db: float, eq_gains: list, preferred_bands: list, n_sessions: int, confidence: float) -> str:
    """Use ASI1-Mini to generate a human-readable insight about the user's profile."""
    system_prompt = """You are Residue's Correlation Agent. Given a user's optimal acoustic profile 
data, generate a brief, insightful explanation of their acoustic preferences and how it relates 
to their cognitive performance. Be specific about frequency ranges and dB levels.
Keep it to 2-3 sentences max."""

    band_desc = ", ".join(f"{BAND_LABELS[i]}: {eq_gains[i]:.2f}" for i in range(7))

    user_prompt = f"""User's learned acoustic profile (from {n_sessions} sessions, {confidence:.0%} confidence):
- Optimal dB: {optimal_db}
- EQ gains: {band_desc}
- Preferred bands: {', '.join(preferred_bands) if preferred_bands else 'none identified yet'}

Generate a brief insight about this user's acoustic preferences."""

    result = call_asi1_mini(system_prompt, user_prompt)
    return result if result else f"Your optimal environment is around {optimal_db} dB with emphasis on {', '.join(preferred_bands) if preferred_bands else 'balanced frequencies'}."


# ── Compatibility Computation ────────────────────────────────────────────────
# Ported from study_buddy_agent.py so CorrelationAgents can compute
# compatibility between two acoustic profiles directly.

def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two EQ vectors."""
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def compute_compatibility(my_profile: dict, their_profile: dict) -> dict:
    """Compute compatibility between two acoustic profiles."""
    # EQ vector similarity (7 bands)
    eq_sim = cosine_similarity(
        my_profile.get("eq_gains", []),
        their_profile.get("eq_gains", []),
    )

    # dB range overlap
    my_range = my_profile.get("db_range", [40, 60])
    their_range = their_profile.get("db_range", [40, 60])
    overlap = max(0, min(my_range[1], their_range[1]) - max(my_range[0], their_range[0]))
    total_range = max(my_range[1] - my_range[0], their_range[1] - their_range[0], 1)
    db_overlap = overlap / total_range

    # Shared preferred sounds
    my_sounds = set(my_profile.get("preferred_sounds", []) or [])
    their_sounds = set(their_profile.get("preferred_sounds", []) or [])
    sound_overlap = len(my_sounds & their_sounds) / max(len(my_sounds | their_sounds), 1)

    # Weighted compatibility score
    score = (eq_sim * 0.5) + (db_overlap * 0.3) + (sound_overlap * 0.2)

    return {
        "compatibility_score": round(score, 3),
        "eq_similarity": round(eq_sim, 3),
        "db_overlap": round(db_overlap, 3),
        "sound_preference_overlap": round(sound_overlap, 3),
        "shared_sounds": sorted(my_sounds & their_sounds),
        "shared_bands": sorted(
            set(my_profile.get("preferred_bands", []) or [])
            & set(their_profile.get("preferred_bands", []) or [])
        ),
    }


def get_asi1_compatibility_reasoning(my_profile: dict, their_profile: dict, scores: dict) -> str:
    """Use ASI1-Mini to generate a natural-language explanation of compatibility."""
    system_prompt = (
        "You are a Residue matching agent. Two users' acoustic profiles "
        "have been compared. Explain in 2-3 sentences WHY they are compatible "
        "(or not), referencing specific acoustic preferences (frequency bands, "
        "dB ranges, shared sounds). Be friendly, concise, and specific."
    )
    user_prompt = (
        f"User A: {json.dumps(my_profile, default=str)}\n"
        f"User B: {json.dumps(their_profile, default=str)}\n"
        f"Scores: {json.dumps(scores, default=str)}"
    )
    result = call_asi1_mini(system_prompt, user_prompt)
    if result:
        return result
    shared = scores.get("shared_sounds") or ["none"]
    return (
        f"Compatibility score: {scores.get('compatibility_score', 0):.0%}. "
        f"Shared preferences: {', '.join(shared)}."
    )


# ── MongoDB Persistence ──────────────────────────────────────────────────────
#
# We share the canonical `profiles` collection used by the rest of the app
# (src/lib/mongodb.ts -> getProfilesCollection). The TS routes write the
# doc with this shape:
#
#   {
#     userId: str,
#     optimalProfile: { targetDb, dbRange, eqGains, preferredBands, confidence },
#     dataPoints, lastUpdated,                # from /api/agents/correlation
#     eqVector, optimalDbRange,               # from /api/correlations
#     currentlyStudying, lastActive,          # real-time studying signals
#   }
#
# Our agent contributes the optimalProfile sub-doc (the long-term learned
# acoustic profile) plus matching metadata (agentAddress, preferredSounds,
# studyHours, focusScoreAvg, location, insight). We stay out of the way of
# the real-time fields (currentlyStudying, lastActive, eqVector) so concurrent
# writers from /api/correlations don't conflict with us.
#
# Internally the rest of this module uses snake_case (eq_gains, db_range)
# because that's what build_optimal_profile() and compute_compatibility()
# operate on. Translation happens at the read/write boundary only.

MONGO_DB_NAME = os.environ.get("MONGODB_DB", "residue")
PROFILES_COLLECTION = "profiles"
VECTOR_INDEX_NAME = "acoustic_profile_vector_index"
VECTOR_INDEX_PATH = "optimalProfile.eqGains"

_mongo_client: Optional[Any] = None


def _get_mongo_client():
    """Lazily create and cache a MongoClient. Returns None if unavailable."""
    global _mongo_client
    if _mongo_client is not None:
        return _mongo_client
    if MongoClient is None:
        return None
    uri = os.environ.get("MONGODB_URI", "")
    if not uri:
        return None
    try:
        _mongo_client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        return _mongo_client
    except Exception:
        return None


def _get_profiles_collection():
    """Return the canonical `profiles` collection or None when unavailable."""
    client = _get_mongo_client()
    if client is None:
        return None
    try:
        return client[MONGO_DB_NAME][PROFILES_COLLECTION]
    except Exception:
        return None


def _epoch_ms() -> int:
    """Match the `Date.now()` ms-epoch convention used by the TS routes."""
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _to_canonical_doc(
    user_id: str,
    profile: dict,
    agent_address: str,
    extra: Optional[dict] = None,
) -> dict:
    """Translate our internal snake_case profile into the canonical
    camelCase + nested-optimalProfile shape that lives in `profiles`.
    Only includes fields we want to write — never None.
    """
    optimal: dict[str, Any] = {}
    if profile.get("optimal_db") is not None:
        optimal["targetDb"] = profile["optimal_db"]
    if profile.get("db_range") is not None:
        optimal["dbRange"] = profile["db_range"]
    if profile.get("eq_gains") is not None:
        optimal["eqGains"] = profile["eq_gains"]
    if profile.get("preferred_bands") is not None:
        optimal["preferredBands"] = profile["preferred_bands"]
    if profile.get("confidence") is not None:
        optimal["confidence"] = profile["confidence"]

    doc: dict[str, Any] = {"userId": user_id}
    if optimal:
        doc["optimalProfile"] = optimal
    if profile.get("data_points") is not None:
        doc["dataPoints"] = profile["data_points"]
    if profile.get("insight") is not None:
        doc["insight"] = profile["insight"]
    if agent_address:
        doc["agentAddress"] = agent_address
    doc["lastUpdated"] = _epoch_ms()

    # Matching metadata. preferred_sounds/etc. on the in-memory profile
    # take precedence; the `extra` kwarg is a secondary source.
    metadata_keys = {
        "preferred_sounds": "preferredSounds",
        "study_hours": "studyHours",
        "focus_score_avg": "focusScoreAvg",
        "location": "location",
    }
    for snake, camel in metadata_keys.items():
        val = profile.get(snake)
        if val is None and extra:
            val = extra.get(snake)
        if val is not None:
            doc[camel] = val
    return doc


def _from_canonical_doc(doc: Optional[dict]) -> Optional[dict]:
    """Translate a canonical `profiles` doc back into the internal
    snake_case shape that compute_compatibility() and the rest of this
    module expect. Falls back to top-level eqVector / optimalDbRange when
    optimalProfile sub-doc is absent (matches /api/agents/matching's
    precedence rule).
    """
    if not doc:
        return None
    optimal = doc.get("optimalProfile") or {}
    out: dict[str, Any] = {
        "user_id": doc.get("userId") or doc.get("user_id"),
        "agent_address": doc.get("agentAddress") or doc.get("agent_address"),
        "data_points": doc.get("dataPoints") or doc.get("data_points"),
        "confidence": optimal.get("confidence") or doc.get("confidence"),
        "insight": doc.get("insight"),
        "preferred_sounds": doc.get("preferredSounds") or doc.get("preferred_sounds"),
        "study_hours": doc.get("studyHours") or doc.get("study_hours"),
        "focus_score_avg": doc.get("focusScoreAvg") or doc.get("focus_score_avg"),
        "location": doc.get("location"),
    }
    # eq_gains: optimalProfile.eqGains preferred, fall back to eqVector
    out["eq_gains"] = (
        optimal.get("eqGains")
        or doc.get("eqVector")
        or doc.get("eq_gains")
    )
    # db_range: optimalProfile.dbRange preferred, fall back to optimalDbRange
    out["db_range"] = (
        optimal.get("dbRange")
        or doc.get("optimalDbRange")
        or doc.get("db_range")
    )
    # optimal_db: prefer targetDb, derive from db_range midpoint as fallback
    if optimal.get("targetDb") is not None:
        out["optimal_db"] = optimal["targetDb"]
    elif out.get("db_range"):
        rng = out["db_range"]
        out["optimal_db"] = (rng[0] + rng[1]) / 2
    out["preferred_bands"] = (
        optimal.get("preferredBands") or doc.get("preferred_bands") or []
    )
    # Strip Nones for cleaner downstream serialization
    return {k: v for k, v in out.items() if v is not None}


def upsert_profile(
    user_id: str,
    profile: dict,
    agent_address: str,
    extra: Optional[dict] = None,
) -> bool:
    """Upsert into the canonical `profiles` collection. Filters on userId
    and excludes the Bayesian variant (type: 'bayesian') so agent writes
    never corrupt the Bayesian profile schema.

    Returns True on success.
    """
    coll = _get_profiles_collection()
    if coll is None:
        return False
    set_doc = _to_canonical_doc(user_id, profile, agent_address, extra=extra)
    try:
        coll.update_one(
            {"userId": user_id, "type": {"$ne": "bayesian"}},
            {
                "$set": set_doc,
                "$setOnInsert": {"createdAt": _epoch_ms(), "type": "agent"},
            },
            upsert=True,
        )
        return True
    except Exception:
        return False


def fetch_profile(user_id: str) -> Optional[dict]:
    """Read the canonical profile doc for `user_id` and return it in our
    internal snake_case shape. Excludes the Bayesian variant (type: 'bayesian')
    to avoid reading the wrong schema. Returns None when not found / unavailable.
    """
    coll = _get_profiles_collection()
    if coll is None:
        return None
    try:
        doc = coll.find_one({"userId": user_id, "type": {"$ne": "bayesian"}})
    except Exception:
        return None
    return _from_canonical_doc(doc)


def upsert_agent_address(user_id: str, agent_address: str) -> bool:
    """Set agentAddress on the user's canonical (non-Bayesian) profile doc;
    insert minimal doc if missing. Returns True on success.
    """
    coll = _get_profiles_collection()
    if coll is None:
        return False
    try:
        coll.update_one(
            {"userId": user_id, "type": {"$ne": "bayesian"}},
            {
                "$set": {
                    "agentAddress": agent_address,
                    "lastUpdated": _epoch_ms(),
                },
                "$setOnInsert": {
                    "userId": user_id,
                    "type": "agent",
                    "createdAt": _epoch_ms(),
                },
            },
            upsert=True,
        )
        return True
    except Exception:
        return False


def _serialize_profile_doc(doc: dict) -> dict:
    """Translate a raw Mongo doc (canonical shape) into the internal shape
    plus a JSON-safe vector_score. Used by vector_search_similar consumers.
    """
    raw = {k: v for k, v in doc.items() if k != "_id"}
    score = raw.get("score")
    out = _from_canonical_doc(raw) or {}
    if score is not None:
        out["score"] = score
    return out


def vector_search_similar(
    query_vector: list[float],
    exclude_user_id: str,
    top_k: int,
) -> list[dict]:
    """Run Atlas Vector Search against the canonical profiles collection,
    excluding the requesting user and Bayesian profile variants (type: 'bayesian').

    Falls back to a manual Python-side cosine similarity search when
    Atlas Vector Search is not configured (common in dev / community tier).
    """
    coll = _get_profiles_collection()
    if coll is None or not query_vector:
        return []

    # Try Atlas Vector Search first
    try:
        pipeline = [
            {
                "$vectorSearch": {
                    "index": VECTOR_INDEX_NAME,
                    "path": VECTOR_INDEX_PATH,
                    "queryVector": query_vector,
                    "numCandidates": max(top_k * 10, 50),
                    "limit": top_k,
                    "filter": {"userId": {"$ne": exclude_user_id}},
                }
            },
            {"$match": {"type": {"$ne": "bayesian"}}},
            {
                "$project": {
                    "userId": 1,
                    "optimalProfile": 1,
                    "eqVector": 1,
                    "optimalDbRange": 1,
                    "preferredSounds": 1,
                    "agentAddress": 1,
                    "studyHours": 1,
                    "focusScoreAvg": 1,
                    "location": 1,
                    "dataPoints": 1,
                    "score": {"$meta": "vectorSearchScore"},
                }
            },
        ]
        results = list(coll.aggregate(pipeline))
        if results:
            return [_serialize_profile_doc(r) for r in results]
    except Exception:
        # Atlas Vector Search not available — fall through to manual search
        pass

    # Manual fallback: load all other profiles and rank by cosine similarity.
    # Use the same precedence as /api/agents/matching: prefer
    # optimalProfile.eqGains, fall back to top-level eqVector.
    try:
        docs = list(coll.find({"userId": {"$ne": exclude_user_id}, "type": {"$ne": "bayesian"}}).limit(500))
    except Exception:
        return []

    scored: list[tuple[float, dict]] = []
    for doc in docs:
        eq = (doc.get("optimalProfile") or {}).get("eqGains") or doc.get("eqVector")
        if not eq:
            continue
        sim = cosine_similarity(query_vector, eq)
        clean = _serialize_profile_doc(doc)
        clean["score"] = sim
        scored.append((sim, clean))

    scored.sort(key=lambda t: t[0], reverse=True)
    return [d for _, d in scored[:top_k]]


def _serialize_match(candidate: dict, scores: dict, reasoning: str) -> dict:
    """Build a single match entry returned by FindMatchesResponse."""
    return {
        "user_id": candidate.get("user_id"),
        "compatibility_score": scores.get("compatibility_score", 0.0),
        "eq_similarity": scores.get("eq_similarity", 0.0),
        "db_overlap": scores.get("db_overlap", 0.0),
        "sound_overlap": scores.get("sound_preference_overlap", 0.0),
        "shared_sounds": scores.get("shared_sounds", []),
        "shared_bands": scores.get("shared_bands", []),
        "agent_address": candidate.get("agent_address"),
        "vector_score": candidate.get("score"),
        "reasoning": reasoning,
        "candidate_profile": {
            k: candidate.get(k)
            for k in (
                "optimal_db",
                "db_range",
                "eq_gains",
                "preferred_bands",
                "preferred_sounds",
                "confidence",
                "study_hours",
                "focus_score_avg",
                "location",
            )
        },
    }


def find_matches_for_user(user_id: str, top_k: int = 5) -> list[dict]:
    """Synchronous match computation: load my profile, vector-search similar
    profiles, score each, return ranked matches. Used by the orchestrator's
    HTTP fallback when no agent message is in flight.
    """
    my_profile = fetch_profile(user_id)
    if not my_profile or not my_profile.get("eq_gains"):
        return []

    candidates = vector_search_similar(
        query_vector=my_profile["eq_gains"],
        exclude_user_id=user_id,
        top_k=top_k,
    )
    matches: list[dict] = []
    for cand in candidates:
        scores = compute_compatibility(my_profile, cand)
        reasoning = get_asi1_compatibility_reasoning(my_profile, cand, scores)
        matches.append(_serialize_match(cand, scores, reasoning))
    matches.sort(key=lambda m: m["compatibility_score"], reverse=True)
    return matches


# ── Agent Setup ──────────────────────────────────────────────────────────────

def create_agent():
    AGENT_PORT = int(os.environ.get("CORRELATION_AGENT_PORT", "8771"))
    AGENT_SEED = os.environ.get("CORRELATION_AGENT_SEED", "residue-correlation-agent-seed-phrase-v1")
    AGENTVERSE_API_KEY = os.environ.get("AGENTVERSE_API_KEY", "").strip()

    # In-memory cache (write-through to MongoDB)
    profiles: dict[str, dict] = {}

    agent_kwargs = {
        "name": "residue_correlation_agent",
        "port": AGENT_PORT,
        "seed": AGENT_SEED,
        "endpoint": [f"http://localhost:{AGENT_PORT}/submit"],
        "publish_agent_details": True,
    }
    if AGENTVERSE_API_KEY:
        agent_kwargs["mailbox"] = True

    _agent = Agent(**agent_kwargs)
    protocol = Protocol(spec=chat_protocol_spec)

    print(f"CorrelationAgent address: {_agent.address}")

    @_agent.on_event("startup")
    async def startup(ctx: Context):
        ctx.logger.info(f"CorrelationAgent started on port {AGENT_PORT}")
        ctx.logger.info(f"Address: {_agent.address}")

        # Register this agent's address for any user_id we already have a
        # profile cached for (so other agents can reach us). The configured
        # USER_ID env var is also published so cross-agent peers can find us
        # before any correlation has run.
        configured_user_id = os.environ.get("CORRELATION_USER_ID", "")
        if configured_user_id:
            ok = upsert_agent_address(configured_user_id, str(_agent.address))
            ctx.logger.info(
                f"Registered agent_address for user_id={configured_user_id}: {ok}"
            )
        for uid in list(profiles.keys()):
            upsert_agent_address(uid, str(_agent.address))

    @_agent.on_message(CorrelationRequest)
    async def handle_correlation(ctx: Context, sender: str, msg: CorrelationRequest):
        ctx.logger.info(f"Correlation request from {sender} for user {msg.user_id}")

        result = build_optimal_profile(msg.sessions)

        if "error" not in result:
            # Merge optional matching metadata from the request
            extra = {
                "preferred_sounds": msg.preferred_sounds,
                "study_hours": msg.study_hours,
                "focus_score_avg": msg.focus_score_avg,
                "location": msg.location,
            }
            cached = dict(result)
            for k, v in extra.items():
                if v is not None:
                    cached[k] = v
            profiles[msg.user_id] = cached

            persisted = upsert_profile(
                user_id=msg.user_id,
                profile=cached,
                agent_address=str(_agent.address),
                extra=extra,
            )
            ctx.logger.info(
                f"Profile cached in-memory; MongoDB persisted={persisted}"
            )

        response = CorrelationResponse(
            user_id=msg.user_id,
            optimal_db=result.get("optimal_db", 50),
            db_range=result.get("db_range", [45, 55]),
            eq_gains=result.get("eq_gains", [0]*7),
            preferred_bands=result.get("preferred_bands", []),
            confidence=result.get("confidence", 0),
            insight=result.get("insight", result.get("error", "")),
            data_points=result.get("data_points", 0),
        )

        await ctx.send(sender, response)
        ctx.logger.info(f"Sent correlation update: {result.get('optimal_db', 'N/A')} dB optimal")

    @_agent.on_message(ProfileQueryRequest)
    async def handle_profile_query(ctx: Context, sender: str, msg: ProfileQueryRequest):
        ctx.logger.info(f"Profile query from {sender} for user {msg.user_id}")

        # MongoDB is the source of truth; fall back to in-memory cache.
        profile = fetch_profile(msg.user_id)
        if profile is None:
            profile = profiles.get(msg.user_id)

        response = ProfileQueryResponse(
            user_id=msg.user_id,
            has_profile=profile is not None,
            profile_json=json.dumps(profile, default=str) if profile else "",
        )
        await ctx.send(sender, response)

    @protocol.on_message(ChatMessage)
    async def handle_chat_message(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(
            sender,
            ChatAcknowledgement(timestamp=datetime.now(), acknowledged_msg_id=msg.msg_id),
        )

        text = ""
        for item in msg.content:
            if isinstance(item, TextContent):
                text += item.text

        # Optional structured chat path for agent-to-agent usage.
        try:
            payload = json.loads(text)
            action = payload.get("action")
            if action == "correlate":
                user_id = payload.get("user_id", "unknown")
                sessions = payload.get("sessions", [])
                result = build_optimal_profile(json.dumps(sessions))
                response_text = json.dumps(
                    {
                        "action": "correlate_result",
                        "user_id": user_id,
                        "result": result,
                    }
                )
            elif action == "profile_query":
                user_id = payload.get("user_id", "")
                profile = profiles.get(user_id)
                response_text = json.dumps(
                    {
                        "action": "profile_result",
                        "user_id": user_id,
                        "has_profile": profile is not None,
                        "profile": profile if profile else {},
                    }
                )
            else:
                response_text = (
                    "I am the Correlation Agent. Send `{\"action\":\"correlate\", ...}` with session data "
                    "or `{\"action\":\"profile_query\", \"user_id\":\"...\"}`."
                )
        except (json.JSONDecodeError, TypeError):
            response_text = (
                "I am the Correlation Agent. I learn optimal dB/EQ preferences from historical sessions "
                "and return a personalized acoustic profile with confidence and insights."
            )

        await ctx.send(
            sender,
            ChatMessage(
                timestamp=datetime.utcnow(),
                msg_id=uuid4(),
                content=[
                    TextContent(type="text", text=response_text),
                    EndSessionContent(type="end-session"),
                ],
            ),
        )

    @protocol.on_message(ChatAcknowledgement)
    async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        _ = (ctx, sender, msg)
        return

    _agent.include(protocol, publish_manifest=True)
    @_agent.on_message(UpdateProfileMetadata)
    async def handle_update_metadata(ctx: Context, sender: str, msg: UpdateProfileMetadata):
        ctx.logger.info(f"Metadata update from {sender} for user {msg.user_id}")

        meta = {
            "preferred_sounds": msg.preferred_sounds,
            "study_hours": msg.study_hours,
            "focus_score_avg": msg.focus_score_avg,
            "location": msg.location,
        }
        # Merge into in-memory cache too
        cached = profiles.get(msg.user_id, {})
        for k, v in meta.items():
            if v is not None:
                cached[k] = v
        if cached:
            profiles[msg.user_id] = cached

        coll = _get_profiles_collection()
        ok = False
        if coll is not None:
            camel_map = {
                "preferred_sounds": "preferredSounds",
                "study_hours": "studyHours",
                "focus_score_avg": "focusScoreAvg",
                "location": "location",
            }
            set_doc: dict[str, Any] = {
                camel_map[k]: v for k, v in meta.items() if v is not None
            }
            set_doc["agentAddress"] = str(_agent.address)
            set_doc["lastUpdated"] = _epoch_ms()
            try:
                coll.update_one(
                    {"userId": msg.user_id, "type": {"$ne": "bayesian"}},
                    {
                        "$set": set_doc,
                        "$setOnInsert": {
                            "userId": msg.user_id,
                            "createdAt": _epoch_ms(),
                            "type": "agent",
                        },
                    },
                    upsert=True,
                )
                ok = True
            except Exception as e:
                ctx.logger.error(f"Failed to update metadata: {e}")

        await ctx.send(
            sender,
            UpdateProfileMetadataAck(
                user_id=msg.user_id,
                ok=ok,
                message="updated" if ok else "mongo unavailable",
            ),
        )

    @_agent.on_message(FindMatchesRequest)
    async def handle_find_matches(ctx: Context, sender: str, msg: FindMatchesRequest):
        ctx.logger.info(
            f"FindMatches from {sender}: user={msg.user_id} top_k={msg.top_k}"
        )

        my_profile = fetch_profile(msg.user_id) or profiles.get(msg.user_id)
        if not my_profile or not my_profile.get("eq_gains"):
            await ctx.send(
                sender,
                FindMatchesResponse(user_id=msg.user_id, matches_json=json.dumps([])),
            )
            return

        candidates = vector_search_similar(
            query_vector=my_profile["eq_gains"],
            exclude_user_id=msg.user_id,
            top_k=msg.top_k,
        )

        matches: list[dict] = []
        for cand in candidates:
            scores = compute_compatibility(my_profile, cand)
            reasoning = get_asi1_compatibility_reasoning(my_profile, cand, scores)
            matches.append(_serialize_match(cand, scores, reasoning))

            # Bidirectional confirmation: ask the candidate's agent to confirm
            # compatibility from their side. We don't block on the response —
            # it'll arrive as a ProfileExchangeResponse and update our cache.
            cand_addr = cand.get("agent_address")
            if cand_addr and cand_addr != str(_agent.address):
                try:
                    await ctx.send(
                        cand_addr,
                        ProfileExchangeRequest(
                            requester_user_id=msg.user_id,
                            requester_profile_json=json.dumps(my_profile, default=str),
                            requester_agent_address=str(_agent.address),
                        ),
                    )
                except Exception as e:
                    ctx.logger.error(
                        f"ProfileExchangeRequest to {cand_addr[:20]}... failed: {e}"
                    )

        matches.sort(key=lambda m: m["compatibility_score"], reverse=True)

        await ctx.send(
            sender,
            FindMatchesResponse(
                user_id=msg.user_id,
                matches_json=json.dumps(matches, default=str),
            ),
        )
        ctx.logger.info(f"Returned {len(matches)} matches for user {msg.user_id}")

    @_agent.on_message(ProfileExchangeRequest)
    async def handle_profile_exchange(
        ctx: Context, sender: str, msg: ProfileExchangeRequest
    ):
        ctx.logger.info(
            f"ProfileExchange from {sender} (user={msg.requester_user_id})"
        )

        try:
            their_profile = json.loads(msg.requester_profile_json or "{}")
        except json.JSONDecodeError:
            their_profile = {}

        # Identify our own user_id by reverse-looking up the agent_address in
        # MongoDB. If unavailable, fall back to env-configured user_id.
        my_user_id = os.environ.get("CORRELATION_USER_ID", "")
        my_profile: Optional[dict] = None
        coll = _get_profiles_collection()
        if coll is not None:
            try:
                doc = coll.find_one({"agentAddress": str(_agent.address)})
                if doc:
                    my_user_id = doc.get("userId", my_user_id)
                    my_profile = _serialize_profile_doc(doc)
            except Exception:
                pass
        if my_profile is None and my_user_id:
            my_profile = fetch_profile(my_user_id) or profiles.get(my_user_id)

        if not my_profile:
            await ctx.send(
                sender,
                ProfileExchangeResponse(
                    responder_user_id=my_user_id or "unknown",
                    responder_profile_json="",
                    compatibility_json=json.dumps({}),
                    reasoning="No local profile available for compatibility check.",
                ),
            )
            return

        scores = compute_compatibility(my_profile, their_profile)
        reasoning = get_asi1_compatibility_reasoning(my_profile, their_profile, scores)

        await ctx.send(
            sender,
            ProfileExchangeResponse(
                responder_user_id=my_user_id or my_profile.get("user_id", "unknown"),
                responder_profile_json=json.dumps(my_profile, default=str),
                compatibility_json=json.dumps(scores, default=str),
                reasoning=reasoning,
            ),
        )
        ctx.logger.info(
            f"Sent ProfileExchangeResponse "
            f"(compatibility={scores.get('compatibility_score', 0):.0%})"
        )

    @_agent.on_message(ProfileExchangeResponse)
    async def handle_profile_exchange_response(
        ctx: Context, sender: str, msg: ProfileExchangeResponse
    ):
        # We don't block on these — just log them for traceability. Future
        # work: cache bidirectional confirmations and surface them in the
        # next FindMatchesResponse.
        ctx.logger.info(
            f"ProfileExchangeResponse from {sender[:20]}... "
            f"user={msg.responder_user_id}"
        )

    return _agent


if __name__ == "__main__":
    agent = create_agent()
    agent.run()
