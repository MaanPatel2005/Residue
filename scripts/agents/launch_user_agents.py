"""
Residue — Launch Agents for a Specific User

Reads a user's unique agent seeds from MongoDB and starts all 4 agents
with the correct seeds and ports. Each agent connects to Agentverse with
a mailbox so it's reachable on ASI:One.

Usage:
    python scripts/agents/launch_user_agents.py <email>
    python scripts/agents/launch_user_agents.py --list

Examples:
    python scripts/agents/launch_user_agents.py maanvpatel@gmail.com
    python scripts/agents/launch_user_agents.py --list
    python scripts/agents/launch_user_agents.py --all
"""

import argparse
import os
import sys
import subprocess
import signal
import time
from pathlib import Path

AGENTS_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = AGENTS_DIR.parent.parent

# Load .env
env_file = PROJECT_ROOT / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ[key.strip()] = value.strip()

AGENT_SCRIPTS = {
    "orchestrator": "orchestrator_agent.py",
    "perception":   "perception_agent.py",
    "correlation":  "correlation_agent.py",
    "intervention": "intervention_agent.py",
}

SEED_ENV = {
    "orchestrator": "ORCHESTRATOR_AGENT_SEED",
    "perception":   "PERCEPTION_AGENT_SEED",
    "correlation":  "CORRELATION_AGENT_SEED",
    "intervention": "INTERVENTION_AGENT_SEED",
}

PORT_ENV = {
    "orchestrator": "ORCHESTRATOR_AGENT_PORT",
    "perception":   "PERCEPTION_AGENT_PORT",
    "correlation":  "CORRELATION_AGENT_PORT",
    "intervention": "INTERVENTION_AGENT_PORT",
}


def get_mongo_db():
    from pymongo import MongoClient
    uri = os.environ.get("MONGODB_URI", "")
    if not uri:
        print("ERROR: MONGODB_URI not set in .env")
        sys.exit(1)
    return MongoClient(uri)["residue"]


def list_users():
    db = get_mongo_db()
    print("\nRegistered users with agent assignments:\n")
    print(f"{'Email':<35} {'User ID':<45} {'Handle':<18} {'Orchestrator Address'}")
    print("-" * 140)
    for rec in db["user_agents"].find():
        email = rec.get("email", "?")
        uid = rec.get("userId", "?")
        handle = rec.get("handle", "?")
        orch_addr = rec.get("orchestrator", {}).get("address", "?")
        print(f"{email:<35} {uid:<45} {handle:<18} {orch_addr[:30]}...")
    print()


def load_user_agents(email: str) -> dict | None:
    db = get_mongo_db()
    rec = db["user_agents"].find_one({"email": email})
    if not rec:
        # Try by userId
        rec = db["user_agents"].find_one({"userId": email})
    if not rec:
        print(f"ERROR: No agent record found for '{email}'")
        print("Run --list to see registered users, or register via the web app first.")
        return None
    return rec


def load_all_users() -> list[dict]:
    db = get_mongo_db()
    return list(db["user_agents"].find())


def launch_agents(records: list[dict]):
    processes: list[subprocess.Popen] = []
    labels: list[str] = []

    def cleanup(sig=None, frame=None):
        print("\nShutting down all agents...")
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

    base_env = os.environ.copy()

    for rec in records:
        email = rec.get("email", "unknown")
        handle = rec.get("handle", "?")
        print(f"\n{'=' * 60}")
        print(f"  Launching agents for: {email} ({handle})")
        print(f"{'=' * 60}")

        for role in ["orchestrator", "perception", "correlation", "intervention"]:
            agent_data = rec.get(role, {})
            seed = agent_data.get("seed", "")
            port = agent_data.get("port", 0)
            address = agent_data.get("address", "?")

            if not seed or not port:
                print(f"  WARNING: Missing seed/port for {role}, skipping")
                continue

            agent_env = base_env.copy()
            agent_env[SEED_ENV[role]] = seed
            agent_env[PORT_ENV[role]] = str(port)

            script = str(AGENTS_DIR / AGENT_SCRIPTS[role])
            print(f"  Starting {role.title():15s} port={port}  address={address[:25]}...")

            proc = subprocess.Popen(
                [sys.executable, script],
                env=agent_env,
                cwd=str(PROJECT_ROOT),
            )
            processes.append(proc)
            labels.append(f"{email}/{role}")
            time.sleep(1)

    print(f"\n{'=' * 60}")
    print(f"  All agents running! ({len(processes)} processes)")
    print(f"  Chat with them at: https://asi1.ai/chat")
    print(f"{'=' * 60}")
    print("\nPress Ctrl+C to stop all agents.\n")

    try:
        while True:
            for i, p in enumerate(processes):
                ret = p.poll()
                if ret is not None:
                    print(f"WARNING: {labels[i]} exited with code {ret}")
            time.sleep(2)
    except KeyboardInterrupt:
        cleanup()


def main():
    parser = argparse.ArgumentParser(
        description="Launch Residue agents for a specific user",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s maanvpatel@gmail.com      Launch agents for this user
  %(prog)s --list                    Show all registered users
  %(prog)s --all                     Launch agents for ALL users
        """,
    )
    parser.add_argument("email", nargs="?", help="User email to launch agents for")
    parser.add_argument("--list", action="store_true", help="List all registered users")
    parser.add_argument("--all", action="store_true", help="Launch agents for all users")
    args = parser.parse_args()

    if args.list:
        list_users()
        return

    if args.all:
        records = load_all_users()
        if not records:
            print("No users registered. Register via the web app first.")
            sys.exit(1)
        launch_agents(records)
        return

    if not args.email:
        parser.print_help()
        sys.exit(1)

    rec = load_user_agents(args.email)
    if not rec:
        sys.exit(1)
    launch_agents([rec])


if __name__ == "__main__":
    main()
