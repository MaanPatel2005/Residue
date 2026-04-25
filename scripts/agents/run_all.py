"""
Residue — Run All Agents

Starts all four agents (Perception, Correlation, Intervention, Orchestrator)
in separate processes. The Orchestrator also exposes an HTTP API on port 8765
for the Next.js frontend.

Usage:
    cd scripts/agents
    python run_all.py

Or from project root:
    python scripts/agents/run_all.py
"""

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

AGENTS = [
    {
        "name": "PerceptionAgent",
        "script": str(AGENTS_DIR / "perception_agent.py"),
        "port_env": "PERCEPTION_AGENT_PORT",
        "default_port": "8770",
    },
    {
        "name": "CorrelationAgent",
        "script": str(AGENTS_DIR / "correlation_agent.py"),
        "port_env": "CORRELATION_AGENT_PORT",
        "default_port": "8771",
    },
    {
        "name": "InterventionAgent",
        "script": str(AGENTS_DIR / "intervention_agent.py"),
        "port_env": "INTERVENTION_AGENT_PORT",
        "default_port": "8772",
    },
    {
        "name": "OrchestratorAgent",
        "script": str(AGENTS_DIR / "orchestrator_agent.py"),
        "port_env": "ORCHESTRATOR_AGENT_PORT",
        "default_port": "8773",
    },
]


def main():
    processes: list[subprocess.Popen] = []

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
    print("  Residue Multi-Agent System (Fetch.ai uAgents + ASI1-Mini)")
    print("=" * 60)
    print()

    # Start each agent
    for agent_config in AGENTS:
        port = env.get(agent_config["port_env"], agent_config["default_port"])
        env[agent_config["port_env"]] = port

        print(f"Starting {agent_config['name']} on port {port}...")

        proc = subprocess.Popen(
            [sys.executable, agent_config["script"]],
            env=env,
            cwd=str(PROJECT_ROOT),
        )
        processes.append(proc)
        time.sleep(1)  # stagger startup

    # After all agents start, print their addresses
    print()
    print("=" * 60)
    print("  All agents started!")
    print(f"  HTTP API: http://localhost:{env.get('ORCHESTRATOR_HTTP_PORT', '8765')}")
    print()
    print("  Endpoints:")
    print("    POST /orchestrate  — Full pipeline (perception → correlation → intervention)")
    print("    POST /perceive     — Perception only")
    print("    POST /correlate    — Correlation only")
    print("    POST /intervene    — Intervention only")
    print("    GET  /health       — Agent system status")
    print("=" * 60)
    print()
    print("Press Ctrl+C to stop all agents.")
    print()

    # Wait for all processes
    try:
        while True:
            for i, p in enumerate(processes):
                ret = p.poll()
                if ret is not None:
                    print(f"WARNING: {AGENTS[i]['name']} exited with code {ret}")
            time.sleep(2)
    except KeyboardInterrupt:
        cleanup()


if __name__ == "__main__":
    main()
