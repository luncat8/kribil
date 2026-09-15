#!/usr/bin/env python3
"""
Cross-platform runner for the Next.js + bun project.

Usage:
    python run.py            # full dev startup (install, db push, dev server, mini-services)
    python run.py --no-db    # skip db push
    python run.py --no-mini  # skip mini-services
    python run.py --build    # production build then start
"""

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional


IS_WINDOWS = sys.platform.startswith("win")
PROJECT_DIR = Path(__file__).resolve().parent
PORT = 3000
HOST = "0.0.0.0"


def log(msg: str, emoji: str = "") -> None:
    line = f"{emoji} {msg}" if emoji else msg
    print(line, flush=True)


def find_bun() -> Optional[str]:
    """Return the path to bun if found in PATH, else None."""
    try:
        result = subprocess.run(
            ["bun", "--version"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            return "bun"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return None


def install_bun() -> bool:
    """Install bun using the official installer. Returns True on success."""
    log("bun not found. Installing via official installer...", "📦")

    # The official installer
    if IS_WINDOWS:
        cmd = [
            "powershell", "-Command",
            "iwr https://bun.sh/install.ps1 -UseBasicParsing | iex"
        ]
    else:
        cmd = ["sh", "-c", "curl -fsSL https://bun.sh/install | bash"]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except Exception as e:
        log(f"Failed to run installer: {e}", "❌")
        return False

    # bun is typically installed to ~/.bun or ~/.local/bin
    home = str(Path.home())
    candidate_paths = [
        Path(home) / ".bun" / "bin",
        Path(home) / ".local" / "share" / "bun" / "bin",
        Path(home) / ".deno" / "bin",  # sometimes deno bins bun
    ]

    # Try bun from newly installed location
    env_bun_path = None
    for p in candidate_paths:
        bun_bin = p / "bun"
        if bun_bin.exists():
            env_bun_path = str(bun_bin)
            break

    if env_bun_path:
        log(f"bun installed at {env_bun_path}", "✅")
        return True

    log("bun installed but could not locate the binary. Restart your shell.", "⚠️")
    return False


def run_command(cmd: list[str], cwd: Optional[Path] = None, env: Optional[dict] = None,
                check: bool = True) -> subprocess.CompletedProcess:
    """Run a command and stream output, optionally checking for errors."""
    env_full = os.environ.copy()
    if env:
        env_full.update(env)

    log(f"Running: {' '.join(cmd)}", "▶️ ")
    result = subprocess.run(cmd, cwd=str(cwd) if cwd else None, env=env_full)

    if check and result.returncode != 0:
        log(f"Command failed with code {result.returncode}: {' '.join(cmd)}", "❌")
        sys.exit(result.returncode)

    return result


def run_streamed(cmd: list[str], cwd: Optional[Path] = None) -> subprocess.Popen:
    """Start a long-running process, streaming its output to the console."""
    return subprocess.Popen(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=os.environ.copy(),
        stdout=None,
        stderr=None,
    )


def wait_for_port(host: str, port: int, timeout: int = 60) -> bool:
    """Poll until the given host:port responds, or timeout."""
    import socket

    log(f"Waiting for service at {host}:{port}...", "⏳")
    for _ in range(timeout):
        try:
            with socket.create_connection((host, port), timeout=2):
                log(f"Service at {host}:{port} is ready!", "✅")
                return True
        except (OSError, ConnectionRefusedError):
            time.sleep(1)
    log(f"Timed out waiting for {host}:{port}", "❌")
    return False


def start_mini_services(project_dir: Path) -> list[subprocess.Popen]:
    """Scan mini-services/* for dev scripts and start them in the background."""
    from glob import glob

    mini_root = project_dir / "mini-services"
    if not mini_root.is_dir():
        log("mini-services directory not found, skipping.", "ℹ️")
        return []

    procs = []
    for service_dir in sorted(mini_root.iterdir()):
        if not service_dir.is_dir():
            continue
        pkg = service_dir / "package.json"
        if not pkg.exists():
            continue

        log(f"Checking mini-service: {service_dir.name}", "📦")
        run_command(["bun", "install"], cwd=service_dir, check=False)

        name, _ = os.path.splitext(pkg.name)
        log(f"Starting {service_dir.name}...", "▶️")
        proc = run_streamed(["bun", "run", "dev"], cwd=service_dir)
        procs.append(proc)

    return procs


class ProcessManager:
    """Track child processes for graceful shutdown."""

    def __init__(self):
        self.processes: list[subprocess.Popen] = []
        self.original_sigint = None

    def register(self, proc: subprocess.Popen):
        self.processes.append(proc)

    def shutdown(self, signum=None, frame=None):
        log("\n🛑 Shutting down all services...", "")
        for proc in self.processes:
            if proc.poll() is not None:
                continue
            try:
                if IS_WINDOWS:
                    proc.send_signal(signal.CTRL_BREAK_EVENT)
                else:
                    proc.send_signal(signal.SIGTERM)
            except Exception:
                pass

        # Wait briefly, then force kill
        for proc in self.processes:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()

        log("✅ All services stopped.", "")
        sys.exit(0)


def main():
    parser = argparse.ArgumentParser(description="Run the Next.js project cross-platform")
    parser.add_argument("--no-db", action="store_true", help="Skip database push")
    parser.add_argument("--no-mini", action="store_true", help="Skip mini-services")
    parser.add_argument("--build", action="store_true",
                        help="Build for production then start")
    args = parser.parse_args()

    # --- Ensure bun is available ---
    bun = find_bun()
    if not bun:
        if not install_bun():
            log("bun is required. Install it manually: https://bun.sh/docs/install", "❌")
            sys.exit(1)
        # Re-check with updated env (installer adds to shell rc; try common paths)
        home = str(Path.home())
        extra_path = str(Path(home) / ".bun" / "bin")
        os.environ["PATH"] = extra_path + os.pathsep + os.environ["PATH"]
        bun = find_bun()
        if not bun:
            log("bun installed but not found in PATH. Restart your terminal and retry.", "❌")
            sys.exit(1)

    log(f"Using bun: {subprocess.run([bun, '--version'], capture_output=True, text=True).stdout.strip()}", "📋")

    # --- Install deps ---
    run_command([bun, "install"], cwd=PROJECT_DIR)

    mgr = ProcessManager()

    # Register signal handlers for graceful shutdown
    signal.signal(signal.SIGINT, mgr.shutdown)
    signal.signal(signal.SIGTERM, mgr.shutdown)

    if args.build:
        # Production build
        log("Building project for production...", "🔨")
        run_command([bun, "run", "build"], cwd=PROJECT_DIR)

        # Start the standalone server
        standalone_dir = PROJECT_DIR / ".next" / "standalone"
        if standalone_dir.is_dir():
            log("Starting production server...", "🚀")
            proc = run_streamed(
                [bun, "server.js"],
                cwd=standalone_dir
            )
            mgr.register(proc)
            wait_for_port("localhost", PORT)
            log(f"Production server running on http://localhost:{PORT}", "✅")
            log("Press Ctrl+C to stop.", "💡")
            try:
                proc.wait()
            except KeyboardInterrupt:
                mgr.shutdown()
        else:
            log("No standalone build found. Run `bun run build` first.", "❌")
            sys.exit(1)
        return

    # --- Dev mode ---
    if not args.no_db:
        log("Pushing database schema...", "🗄️ ")
        run_command([bun, "run", "db:push"], cwd=PROJECT_DIR, check=False)

    # Start Next.js dev server
    log("Starting Next.js dev server...", "🚀")
    env = os.environ.copy()
    env["PORT"] = env.get("PORT", str(PORT))
    env["HOSTNAME"] = env.get("HOSTNAME", HOST)

    proc = subprocess.Popen(
        [bun, "run", "dev"],
        cwd=str(PROJECT_DIR),
        env=env,
    )
    mgr.register(proc)

    if not wait_for_port("localhost", PORT):
        log("Next.js dev server failed to start in time.", "❌")
        sys.exit(1)
    log(f"Next.js dev server running on http://localhost:{PORT}", "✅")

    # Start mini-services
    if not args.no_mini:
        mini_procs = start_mini_services(PROJECT_DIR)
        for p in mini_procs:
            mgr.register(p)

    log("All services started. Press Ctrl+C to stop.", "💡")

    # Keep the main process alive
    try:
        while True:
            # If the main Next.js process dies, exit
            if proc.poll() is not None:
                log("Next.js dev server exited.", "❌")
                mgr.shutdown()
            time.sleep(1)
    except KeyboardInterrupt:
        mgr.shutdown()


if __name__ == "__main__":
    main()
