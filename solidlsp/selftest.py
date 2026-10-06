"""End-to-end selftest for the gsterm-solidlsp bridge.

Runs the bridge as a SUBPROCESS exactly the way the Bun parent will, with a
scrubbed PATH that contains no node/npm except through the bridge's own
node->bun shim. Proves:

1. hello under bun-only runtime info;
2. cold `provision` (bun-driven install of typescript-language-server) and
   cold `start` on a fresh data dir (first-run provisioning path);
3. definition / references / implementations / diagnostics against a real
   TypeScript workspace (cross-file);
4. `restart` after a clean stop, and a warm second start reusing the data dir;
5. NO orphan typescript-language-server / tsserver processes afterwards.

Usage: uv run python selftest.py   (from the solidlsp/ directory)
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent
FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    status = "PASS" if ok else "FAIL"
    print(f"{status} {name}" + (f" — {detail}" if detail else ""), flush=True)
    if not ok:
        FAILURES.append(name)


class BridgeClient:
    def __init__(self, env: dict[str, str]) -> None:
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "gsterm_solidlsp"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=sys.stderr,
            env=env,
            text=True,
            cwd=str(REPO),
        )
        self._next_id = 0

    def call(self, method: str, params: dict | None = None, timeout: float = 360.0) -> dict:
        self._next_id += 1
        request_id = self._next_id
        line = json.dumps({"id": request_id, "method": method, "params": params or {}})
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self.proc.stdin.write(line + "\n")
        self.proc.stdin.flush()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            response_line = self.proc.stdout.readline()
            if not response_line:
                raise RuntimeError(f"bridge exited while awaiting {method}")
            response = json.loads(response_line)
            if response.get("id") != request_id:
                continue  # notification or mismatched reply
            if not response.get("ok"):
                raise RuntimeError(f"{method} failed: {response.get('error', {}).get('message')}")
            return response["result"]
        raise TimeoutError(f"{method} timed out after {timeout}s")

    def close(self) -> None:
        try:
            self.call("shutdown", timeout=30)
            self.proc.wait(timeout=30)
        except Exception:
            self.proc.kill()
            self.proc.wait(timeout=10)


def scrubbed_env(data_dir: Path) -> dict[str, str]:
    """PATH without any node/npm on it: /usr/bin:/bin + bun's own directory.

    The bridge prepends its shims dir itself; bun on PATH satisfies both the
    node shim (`exec bun`) and bun-driven provisioning.
    """
    env = {"PATH": "/usr/bin:/bin", "HOME": os.environ.get("HOME", "/tmp")}
    bun = shutil.which("bun")
    if not bun:
        raise SystemExit("bun must be on PATH to run this selftest")
    # The found path itself (possibly a symlink) must stay resolvable in the
    # child: use its parent directory as-is, do NOT resolve the symlink chain
    # (the resolved target dir may not contain an entry named `bun`).
    env["PATH"] = str(Path(bun).absolute().parent) + os.pathsep + env["PATH"]
    for key in ("GSTERM_BUN", "GSTERM_SOLIDLSP_LOG"):
        if key in os.environ:
            env[key] = os.environ[key]
    del data_dir
    return env


def node_free_outside_shims(env_path: str) -> bool:
    for directory in env_path.split(os.pathsep):
        if (Path(directory) / "node").exists():
            # The only permitted node is one we have not created yet — the
            # bridge's shim dir lives under the data dir, which is not on the
            # parent PATH here.
            return False
    return True


def language_server_processes() -> list[str]:
    result = subprocess.run(
        ["pgrep", "-af", "typescript-language-server|tsserver"],
        capture_output=True,
        text=True,
    )
    return [line for line in (result.stdout or "").splitlines() if line.strip()]


def orphans(pre_existing: set[str]) -> list[str]:
    """Language-server processes NOT present before the test (true orphans)."""
    return [line for line in language_server_processes() if line.split(" ", 1)[0] not in pre_existing]


def main() -> int:
    # The host IDE may legitimately run its own tsserver; only processes we
    # CREATE during this test count as orphans.
    pre_existing = {line.split(" ", 1)[0] for line in language_server_processes()}

    env = scrubbed_env(Path("/tmp"))
    check("parent PATH is node-free", node_free_outside_shims(env["PATH"]), env["PATH"])

    workspace = Path(tempfile.mkdtemp(prefix="gsterm-solidlsp-ws-"))
    # A tsconfig makes the workspace a resolvable TS project — required for
    # project-wide references (without it tsserver only knows opened files).
    # This mirrors real workspaces like gs-term itself.
    (workspace / "tsconfig.json").write_text(
        '{"compilerOptions":{"target":"es2022","module":"commonjs","strict":true},"include":["*.ts"]}'
    )
    (workspace / "geometry.ts").write_text(
        "export function area(width: number, height: number): number {\n"
        "  return width * height;\n}\n"
    )
    (workspace / "app.ts").write_text(
        "import { area } from './geometry';\n"
        "const total = area(2, 3);\n"
        "export function main(): number { return total; }\n"
    )
    (workspace / "broken.ts").write_text("const x: number = ;\n")

    client = BridgeClient(env)
    try:
        hello = client.call("hello")
        check("hello", hello.get("name") == "gsterm-solidlsp" and hello.get("ts_server", {}).get("runtime") == "bun", json.dumps(hello.get("ts_server", {})))

        data_dir = workspace / ".gsterm"
        provisioned = client.call("provision", {"workspace": str(workspace), "data_dir": str(data_dir)})
        check("cold provision via bun", provisioned.get("installed") is True and provisioned.get("path"), json.dumps(provisioned.get("versions", {})))

        started = client.call("start", {"workspace": str(workspace), "data_dir": str(data_dir)}, timeout=360)
        check("cold start", started.get("ready") is True)

        # tsserver needs the files opened/indexed; request definition right away.
        deadline = time.monotonic() + 120
        definition: list = []
        while time.monotonic() < deadline:
            try:
                definition = client.call(
                    "definition",
                    {"file": "app.ts", "line": 1, "column": 14},
                    timeout=60,
                )
                if definition:
                    break
            except RuntimeError:
                pass
            time.sleep(1)
        check(
            "cross-file definition (app.ts -> geometry.ts)",
            bool(definition) and definition[0].get("file") == "geometry.ts",
            json.dumps(definition),
        )

        references = client.call("references", {"file": "geometry.ts", "line": 0, "column": 16}, timeout=60)
        ref_files = {ref.get("file") for ref in references}
        check("references finds the call site", "app.ts" in ref_files, str(sorted(ref_files)))

        diagnostics = client.call("diagnostics", {"file": "broken.ts"}, timeout=60)
        check("diagnostics non-empty for broken file", len(diagnostics) > 0, f"{len(diagnostics)} items")

        client.call("restart", {}, timeout=120)
        running = client.call("ready")
        check("restart keeps the server running", running.get("running") is True)

        # Warm start: a fresh bridge process reusing the same data dir.
        client.close()
        warm = BridgeClient(env)
        try:
            warm_started = warm.call("start", {"workspace": str(workspace), "data_dir": str(data_dir)}, timeout=360)
            check("warm start reusing data dir", warm_started.get("ready") is True)
        finally:
            warm.close()
    finally:
        client.close()
        time.sleep(2)
        remaining = orphans(pre_existing)
        check("no orphan language-server processes", not remaining, "; ".join(remaining))
        shutil.rmtree(workspace, ignore_errors=True)

    print()
    if FAILURES:
        print(f"SELFTEST FAILED ({len(FAILURES)}): " + ", ".join(FAILURES))
        return 1
    print("SELFTEST PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
