"""
Residue — MatchingAgent (Fetch.ai uAgents implementation)

This agent implements the Study Buddy Finder using the Fetch.ai uAgents
framework. It listens for match requests, computes cosine similarity
over acoustic EQ vectors, and returns ranked matches.

When AGENTVERSE_API_KEY is set, the agent registers on Agentverse for
cross-network discovery. Otherwise it runs locally on port 8765.

Usage:
    pip install -r requirements.txt
    python scripts/matching_agent.py

Environment variables:
    MONGODB_URI          — MongoDB connection string (optional, uses demo data if unset)
    AGENTVERSE_API_KEY   — Fetch.ai Agentverse API key (optional)
"""

import os
import math
import json
from typing import Optional

try:
    from uagents import Agent, Context, Model
    HAS_UAGENTS = True
except ImportError:
    HAS_UAGENTS = False
    print("Warning: uagents not installed. Running with HTTP fallback only.")

from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

# ── Data Models ──────────────────────────────────────────────────────────────

if HAS_UAGENTS:
    class MatchRequest(Model):
        user_id: str
        eq_vector: list[float]
        lat: Optional[float] = None
        lng: Optional[float] = None
        radius_km: float = 50.0
        active_only: bool = False

    class MatchResult(Model):
        user_id: str
        name: str
        similarity: float
        optimal_db_range: list[float]
        eq_vector: list[float]
        location: Optional[str] = None
        currently_studying: bool = False
        last_active: int = 0

    class MatchResponse(Model):
        matches: list[dict]
        source: str = "uagents"


# ── Demo Profiles ────────────────────────────────────────────────────────────

DEMO_PROFILES = [
    {
        "userId": "demo-alex", "name": "Alex K.",
        "eqVector": [0.3, 0.4, 0.5, 0.4, 0.3, 0.2, 0.1],
        "optimalDbRange": [40, 55],
        "location": {"lat": 34.0689, "lng": -118.4452, "label": "UCLA Library"},
        "currentlyStudying": True,
    },
    {
        "userId": "demo-sarah", "name": "Sarah M.",
        "eqVector": [0.2, 0.3, 0.6, 0.5, 0.4, 0.3, 0.2],
        "optimalDbRange": [45, 60],
        "location": {"lat": 34.0537, "lng": -118.4368, "label": "Starbucks - Westwood"},
        "currentlyStudying": True,
    },
    {
        "userId": "demo-james", "name": "James R.",
        "eqVector": [0.5, 0.4, 0.3, 0.3, 0.2, 0.1, 0.1],
        "optimalDbRange": [35, 50],
        "location": {"lat": 34.0700, "lng": -118.4400, "label": "Home"},
        "currentlyStudying": False,
    },
    {
        "userId": "demo-priya", "name": "Priya D.",
        "eqVector": [0.2, 0.3, 0.4, 0.6, 0.5, 0.4, 0.3],
        "optimalDbRange": [50, 65],
        "location": {"lat": 34.0195, "lng": -118.4912, "label": "Coffee Bean - Santa Monica"},
        "currentlyStudying": True,
    },
    {
        "userId": "demo-mike", "name": "Mike T.",
        "eqVector": [0.4, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1],
        "optimalDbRange": [42, 58],
        "location": {"lat": 34.0715, "lng": -118.4510, "label": "Dorm Room"},
        "currentlyStudying": False,
    },
]


# ── Math Utilities ───────────────────────────────────────────────────────────

def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or len(a) == 0:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (math.sin(d_lat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(d_lng / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def find_matches(request: dict, profiles: list[dict]) -> list[dict]:
    eq_vector = request.get("eq_vector", request.get("eqVector", []))
    user_id = request.get("user_id", request.get("userId", ""))
    location = request.get("location")
    lat = request.get("lat") or (location.get("lat") if location else None)
    lng = request.get("lng") or (location.get("lng") if location else None)
    radius_km = request.get("radius_km", request.get("radiusKm", 50))
    active_only = request.get("active_only", request.get("activeOnly", False))

    candidates = [p for p in profiles if p["userId"] != user_id]

    if active_only:
        candidates = [p for p in candidates if p.get("currentlyStudying")]

    if lat is not None and lng is not None:
        filtered = []
        for p in candidates:
            loc = p.get("location")
            if not loc:
                filtered.append(p)
                continue
            dist = haversine_km(lat, lng, loc["lat"], loc["lng"])
            if dist <= radius_km:
                filtered.append(p)
        candidates = filtered

    results = []
    for p in candidates:
        sim = cosine_similarity(eq_vector, p["eqVector"])
        results.append({
            "userId": p["userId"],
            "name": p["name"],
            "similarity": round(sim, 4),
            "optimalDbRange": p["optimalDbRange"],
            "eqVector": p["eqVector"],
            "location": p.get("location", {}).get("label"),
            "currentlyStudying": p.get("currentlyStudying", False),
            "lastActive": p.get("lastActive", 0),
        })

    results.sort(key=lambda x: x["similarity"], reverse=True)
    return results[:10]


# ── HTTP Fallback Server ────────────────────────────────────────────────────

class MatchHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/match":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            matches = find_matches(body, DEMO_PROFILES)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(matches).encode())
        else:
            self.send_error(404)

    def log_message(self, format, *args):
        pass  # suppress logs


def run_http_server(port: int = 8765):
    server = HTTPServer(("0.0.0.0", port), MatchHandler)
    print(f"MatchingAgent HTTP fallback running on port {port}")
    server.serve_forever()


# ── uAgents Setup ───────────────────────────────────────────────────────────

def main():
    port = int(os.environ.get("MATCHING_AGENT_PORT", "8765"))

    if not HAS_UAGENTS:
        print("Running HTTP-only mode (install uagents for Fetch.ai integration)")
        run_http_server(port)
        return

    agentverse_key = os.environ.get("AGENTVERSE_API_KEY")

    agent_kwargs = {
        "name": "residue_matching_agent",
        "port": port + 1,
        "endpoint": [f"http://localhost:{port + 1}/submit"],
    }

    if agentverse_key:
        agent_kwargs["mailbox"] = agentverse_key

    agent = Agent(**agent_kwargs)

    print(f"MatchingAgent address: {agent.address}")

    @agent.on_message(MatchRequest)
    async def handle_match(ctx: Context, sender: str, msg: MatchRequest):
        ctx.logger.info(f"Match request from {sender}")
        request_dict = {
            "user_id": msg.user_id,
            "eq_vector": msg.eq_vector,
            "lat": msg.lat,
            "lng": msg.lng,
            "radius_km": msg.radius_km,
            "active_only": msg.active_only,
        }
        matches = find_matches(request_dict, DEMO_PROFILES)
        await ctx.send(sender, MatchResponse(matches=matches))

    # Also run the HTTP fallback in a thread
    http_thread = threading.Thread(target=run_http_server, args=(port,), daemon=True)
    http_thread.start()

    print(f"MatchingAgent running (uAgents on port {port + 1}, HTTP on port {port})")
    if agentverse_key:
        print("Registered with Agentverse")
    else:
        print("No AGENTVERSE_API_KEY — running locally only")

    agent.run()


if __name__ == "__main__":
    main()
