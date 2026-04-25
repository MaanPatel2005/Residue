"""
Residue — Agent Mesh Launcher

Starts all three ASI:One-compatible agents and registers them with each other:
  1. Gateway Agent      (port 8780) — user-facing, coordinates matching
  2. Study Buddy User   (port 8781) — represents the current user
  3. Study Buddy Peer   (port 8782) — represents a potential study partner

After startup, the launcher tells each buddy agent about the other
so they can negotiate compatibility through real ChatMessages.

Usage:
    python scripts/agents/run_agent_mesh.py

Environment:
    ASI1_API_KEY        — Required for ASI1-Mini reasoning
    AGENTVERSE_API_KEY  — Optional for Agentverse mailbox registration
"""

import os
import sys
import time
import json
import subprocess
import signal
from pathlib import Path

# Load .env
project_root = Path(__file__).parent.parent.parent
env_file = project_root / ".env"
if env_file.exists():
    from dotenv import load_dotenv
    load_dotenv(env_file)

SCRIPTS_DIR = Path(__file__).parent
processes: list[subprocess.Popen] = []


def start_agent(script: str, env_overrides: dict | None = None) -> subprocess.Popen:
    """Start an agent as a subprocess."""
    env = os.environ.copy()
    if env_overrides:
        env.update(env_overrides)

    proc = subprocess.Popen(
        [sys.executable, str(SCRIPTS_DIR / script)],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    return proc


def read_agent_address(proc: subprocess.Popen, timeout: float = 15.0) -> str:
    """Read the agent address from process output."""
    import select
    start = time.time()
    address = ""
    while time.time() - start < timeout:
        if proc.stdout and proc.stdout.readable():
            line = proc.stdout.readline()
            if line:
                print(f"  {line.rstrip()}")
                if "Agent address:" in line or "address:" in line.lower():
                    # Extract agent1q... address
                    for word in line.split():
                        if word.startswith("agent1q"):
                            address = word.strip()
                            break
                if address and ("Starting server" in line or "Starting mailbox" in line):
                    break
        else:
            time.sleep(0.1)
    return address


def cleanup(signum=None, frame=None):
    """Clean up all agent processes."""
    print("\nShutting down all agents...")
    for proc in processes:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
    print("All agents stopped.")
    sys.exit(0)


signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)


def main():
    print("=" * 60)
    print("Residue Agent Mesh — Starting 3 ASI:One Agents")
    print("=" * 60)

    # Step 1: Start Study Buddy User agent
    print("\n[1/3] Starting Study Buddy User Agent (port 8781)...")
    buddy_user = start_agent("study_buddy_agent.py", {"BUDDY_ROLE": "user"})
    processes.append(buddy_user)
    user_addr = read_agent_address(buddy_user)
    print(f"  -> User agent address: {user_addr or 'reading...'}")

    # Step 2: Start Study Buddy Peer agent
    print("\n[2/3] Starting Study Buddy Peer Agent (port 8782)...")
    buddy_peer = start_agent("study_buddy_agent.py", {"BUDDY_ROLE": "peer"})
    processes.append(buddy_peer)
    peer_addr = read_agent_address(buddy_peer)
    print(f"  -> Peer agent address: {peer_addr or 'reading...'}")

    # Step 3: Start Gateway Agent with buddy addresses
    buddy_addrs = ",".join(filter(None, [user_addr, peer_addr]))
    print(f"\n[3/3] Starting Gateway Agent (port 8780)...")
    print(f"  Buddy addresses: {buddy_addrs}")
    gateway = start_agent("gateway_agent.py", {"BUDDY_AGENT_ADDRESSES": buddy_addrs})
    processes.append(gateway)
    gateway_addr = read_agent_address(gateway)
    print(f"  -> Gateway agent address: {gateway_addr or 'reading...'}")

    # Print summary
    print("\n" + "=" * 60)
    print("AGENT MESH RUNNING")
    print("=" * 60)
    print(f"Gateway Agent:     {gateway_addr}")
    print(f"  Port: 8780 | Mailbox: enabled")
    print(f"  Chat: https://asi1.ai/chat")
    print(f"Study Buddy User:  {user_addr}")
    print(f"  Port: 8781 | Role: user")
    print(f"Study Buddy Peer:  {peer_addr}")
    print(f"  Port: 8782 | Role: peer")
    print("=" * 60)

    # Write addresses to a file for the Next.js app to read
    addresses_file = project_root / "agent-addresses.json"
    addresses = {
        "gateway": {
            "address": gateway_addr,
            "port": 8780,
            "name": "Residue Gateway",
            "role": "gateway",
            "chat_url": "https://asi1.ai/chat",
        },
        "buddy_user": {
            "address": user_addr,
            "port": 8781,
            "name": "Your Study Buddy",
            "role": "user",
        },
        "buddy_peer": {
            "address": peer_addr,
            "port": 8782,
            "name": "Peer Study Buddy (Alex K.)",
            "role": "peer",
        },
    }
    with open(addresses_file, "w") as f:
        json.dump(addresses, f, indent=2)
    print(f"\nAgent addresses written to: {addresses_file}")

    print("\nPress Ctrl+C to stop all agents.")
    print("Streaming agent logs...\n")

    # Stream output from all agents using select for non-blocking I/O
    import select

    labels = ["[buddy-user]", "[buddy-peer]", "[gateway]  "]

    while True:
        alive = [p for p in processes if p.poll() is None]
        if not alive:
            print("All agents have exited.")
            break

        readable_fds = [p.stdout for p in alive if p.stdout]
        if not readable_fds:
            time.sleep(0.1)
            continue

        ready, _, _ = select.select(readable_fds, [], [], 0.5)
        for fd in ready:
            line = fd.readline()
            if line:
                idx = next(
                    (i for i, p in enumerate(processes) if p.stdout is fd),
                    0,
                )
                print(f"{labels[idx]} {line.rstrip()}")

        if not ready:
            time.sleep(0.05)


if __name__ == "__main__":
    main()
