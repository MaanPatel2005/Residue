"""
Residue — Run All Agents

Starts all four agents (Perception, Correlation, Intervention, Orchestrator)
in separate processes. The Orchestrator also exposes an HTTP API on port 8765
for the Next.js frontend.

Usage:
    python scripts/agents/run_all.py             # Set 0 (default)
    python scripts/agents/run_all.py --set 1      # Set 1 (unique seeds/ports)
    python scripts/agents/run_all.py --set 2      # Set 2

Each set uses different seeds and ports so multiple users can have unique agents.
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


def main():
    parser = argparse.ArgumentParser(description="Run Residue agents")
    parser.add_argument("--set", type=int, default=0, choices=list(AGENT_SETS.keys()),
                        help="Agent set index (0, 1, or 2). Each set has unique seeds and ports.")
    args = parser.parse_args()

    set_idx = args.set
    agent_set = AGENT_SETS[set_idx]
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
    print(f"  Residue Multi-Agent System — Set {set_idx}")
    print("=" * 60)
    print()

    for role in ["perception", "correlation", "intervention", "orchestrator"]:
        cfg = agent_set[role]
        port = str(cfg["port"])
        seed = cfg["seed"]

        env[PORT_ENV_VARS[role]] = port
        env[SEED_ENV_VARS[role]] = seed

        script = str(AGENTS_DIR / AGENT_SCRIPTS[role])
        print(f"Starting {role.title()} Agent (set {set_idx}, port {port})...")

        proc = subprocess.Popen(
            [sys.executable, script],
            env=env,
            cwd=str(PROJECT_ROOT),
        )
        processes.append(proc)
        agent_names.append(role.title())
        time.sleep(1)

    print()
    print("=" * 60)
    print(f"  All Set {set_idx} agents started!")
    print(f"  HTTP API: http://localhost:{env.get('ORCHESTRATOR_HTTP_PORT', '8765')}")
    print()
    for role in ["perception", "correlation", "intervention", "orchestrator"]:
        cfg = agent_set[role]
        print(f"  {role.title():15s} seed={cfg['seed'][-10:]}... port={cfg['port']}")
    print("=" * 60)
    print()
    print("Press Ctrl+C to stop all agents.")
    print()

    try:
        while True:
            for i, p in enumerate(processes):
                ret = p.poll()
                if ret is not None:
                    print(f"WARNING: {agent_names[i]} Agent exited with code {ret}")
            time.sleep(2)
    except KeyboardInterrupt:
        cleanup()


if __name__ == "__main__":
    main()
