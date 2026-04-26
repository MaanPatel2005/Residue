"""
Residue — Run All Agents

Starts all four agents (Perception, Correlation, Intervention, Orchestrator)
in separate processes.

Usage:
    python scripts/agents/run_all.py                        # Set 0 (default)
    python scripts/agents/run_all.py --set 1                # Set 1
    python scripts/agents/run_all.py --user user-abc123     # Load seeds from MongoDB
    python scripts/agents/run_all.py --all-users            # Launch for all registered users

Each user gets dynamically generated unique agent seeds and addresses.
"""

import argparse
import os
import sys
import subprocess
import signal
import time
from pathlib import Path

# Resolve the agents directory
AGENTS_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = AGENTS_DIR.parent.parent

# Load .env from project root
env_file = PROJECT_ROOT / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ[key.strip()] = value.strip()

# Seeds and port offsets per set (matching pool.ts)
AGENT_SETS = {
    0: {
        "perception":   {"seed": "residue-perception-agent-seed-phrase-v1",   "port": 8770},
        "correlation":  {"seed": "residue-correlation-agent-seed-phrase-v1",  "port": 8771},
        "intervention": {"seed": "residue-intervention-agent-seed-phrase-v1", "port": 8772},
        "orchestrator": {"seed": "residue-orchestrator-agent-seed-phrase-v1", "port": 8773},
    },
    1: {
        "perception":   {"seed": "residue-perception-agent-seed-phrase-v2",   "port": 8780},
        "correlation":  {"seed": "residue-correlation-agent-seed-phrase-v2",  "port": 8781},
        "intervention": {"seed": "residue-intervention-agent-seed-phrase-v2", "port": 8782},
        "orchestrator": {"seed": "residue-orchestrator-agent-seed-phrase-v2", "port": 8783},
    },
    2: {
        "perception":   {"seed": "residue-perception-agent-seed-phrase-v3",   "port": 8790},
        "correlation":  {"seed": "residue-correlation-agent-seed-phrase-v3",  "port": 8791},
        "intervention": {"seed": "residue-intervention-agent-seed-phrase-v3", "port": 8792},
        "orchestrator": {"seed": "residue-orchestrator-agent-seed-phrase-v3", "port": 8793},
    },
}

AGENT_SCRIPTS = {
    "perception":   "perception_agent.py",
    "correlation":  "correlation_agent.py",
    "intervention": "intervention_agent.py",
    "orchestrator": "orchestrator_agent.py",
}

SEED_ENV_VARS = {
    "perception":   "PERCEPTION_AGENT_SEED",
    "correlation":  "CORRELATION_AGENT_SEED",
    "intervention": "INTERVENTION_AGENT_SEED",
    "orchestrator": "ORCHESTRATOR_AGENT_SEED",
}

PORT_ENV_VARS = {
    "perception":   "PERCEPTION_AGENT_PORT",
    "correlation":  "CORRELATION_AGENT_PORT",
    "intervention": "INTERVENTION_AGENT_PORT",
    "orchestrator": "ORCHESTRATOR_AGENT_PORT",
}


def load_user_agents_from_mongo(user_id: str) -> dict | None:
    """Load a user's agent seeds/ports from MongoDB."""
    try:
        from pymongo import MongoClient
        uri = os.environ.get("MONGODB_URI", "")
        if not uri:
            print(f"ERROR: MONGODB_URI not set, cannot load agents for {user_id}")
            return None
        client = MongoClient(uri)
        db = client["residue"]
        record = db["user_agents"].find_one({"userId": user_id})
        if not record:
            print(f"ERROR: No agent record found for user {user_id}")
            return None
        result = {}
        for role in ["perception", "correlation", "intervention", "orchestrator"]:
            agent_data = record.get(role, {})
            result[role] = {
                "seed": agent_data.get("seed", ""),
                "port": agent_data.get("port", 0),
            }
        return result
    except Exception as e:
        print(f"ERROR loading agents for {user_id}: {e}")
        return None


def load_all_user_agents_from_mongo() -> list[tuple[str, dict]]:
    """Load all users' agent configs from MongoDB."""
    try:
        from pymongo import MongoClient
        uri = os.environ.get("MONGODB_URI", "")
        if not uri:
            print("ERROR: MONGODB_URI not set")
            return []
        client = MongoClient(uri)
        db = client["residue"]
        results = []
        for record in db["user_agents"].find():
            user_id = record.get("userId", "unknown")
            agent_set = {}
            for role in ["perception", "correlation", "intervention", "orchestrator"]:
                agent_data = record.get(role, {})
                agent_set[role] = {
                    "seed": agent_data.get("seed", ""),
                    "port": agent_data.get("port", 0),
                }
            results.append((user_id, agent_set))
        return results
    except Exception as e:
        print(f"ERROR loading user agents: {e}")
        return []


def main():
    parser = argparse.ArgumentParser(description="Run Residue agents")
    parser.add_argument("--set", type=int, default=None, choices=list(AGENT_SETS.keys()),
                        help="Agent set index (0, 1, or 2). Each set has unique seeds and ports.")
    parser.add_argument("--user", type=str, default=None,
                        help="User ID to load agent seeds from MongoDB (e.g. user-abc123)")
    parser.add_argument("--all-users", action="store_true",
                        help="Launch agents for ALL registered users from MongoDB")
    args = parser.parse_args()

    # Determine which agent sets to launch
    sets_to_launch: list[tuple[str, dict]] = []

    if args.all_users:
        sets_to_launch = load_all_user_agents_from_mongo()
        if not sets_to_launch:
            print("No users found in MongoDB. Register users first.")
            sys.exit(1)
    elif args.user:
        user_agents = load_user_agents_from_mongo(args.user)
        if not user_agents:
            sys.exit(1)
        sets_to_launch = [(args.user, user_agents)]
    else:
        set_idx = args.set if args.set is not None else 0
        sets_to_launch = [(f"set-{set_idx}", AGENT_SETS[set_idx])]
    processes: list[subprocess.Popen] = []
    agent_names: list[str] = []

    def cleanup(sig=None, frame=None):
        print("\nShutting down agents...")
        for p in processes:
            try:
                p.terminate()
            except Exception:
                pass
        for p in processes:
            try:
                p.wait(timeout=5)
            except Exception:
                p.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    env = os.environ.copy()

    print("=" * 60)
    print(f"  Residue Multi-Agent System — {len(sets_to_launch)} agent set(s)")
    print("=" * 60)
    print()

    for label, agent_set in sets_to_launch:
        print(f"--- Launching agents for: {label} ---")
        for role in ["perception", "correlation", "intervention", "orchestrator"]:
            cfg = agent_set[role]
            port = str(cfg["port"])
            seed = cfg["seed"]

            agent_env = env.copy()
            agent_env[PORT_ENV_VARS[role]] = port
            agent_env[SEED_ENV_VARS[role]] = seed

            script = str(AGENTS_DIR / AGENT_SCRIPTS[role])
            print(f"  Starting {role.title()} Agent (port {port})...")

            proc = subprocess.Popen(
                [sys.executable, script],
                env=agent_env,
                cwd=str(PROJECT_ROOT),
            )
            processes.append(proc)
            agent_names.append(f"{label}/{role.title()}")
            time.sleep(1)

    print()
    print("=" * 60)
    print(f"  All agents started! ({len(processes)} processes)")
    print()
    for label, agent_set in sets_to_launch:
        print(f"  [{label}]")
        for role in ["perception", "correlation", "intervention", "orchestrator"]:
            cfg = agent_set[role]
            print(f"    {role.title():15s} seed=...{cfg['seed'][-15:]} port={cfg['port']}")
    print("=" * 60)
    print()
    print("Press Ctrl+C to stop all agents.")
    print()

    try:
        while True:
            for i, p in enumerate(processes):
                ret = p.poll()
                if ret is not None:
                    print(f"WARNING: {agent_names[i]} exited with code {ret}")
            time.sleep(2)
    except KeyboardInterrupt:
        cleanup()


if __name__ == "__main__":
    main()
