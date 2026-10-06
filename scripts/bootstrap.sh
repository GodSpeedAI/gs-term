#!/usr/bin/env bash
# gs-term bootstrap: bun deps + Rust helper build + SolidLSP sync.
# Idempotent. Used by `devbox run bootstrap` and standalone; the same gates
# run in scripts/verify-all.sh. Node.js is never installed or required.
set -euo pipefail
cd "$(dirname "$0")/.."

BUN_VERSION="${BUN_VERSION:-1.4.2}"

say() { printf '\n== %s ==\n' "$*"; }

# ── 1. Bun (pinned; nixpkgs has only 1.3.x, so bootstrap by download) ─────────
mkdir -p .devbin/bin
if command -v bun >/dev/null 2>&1 && [ "$(bun --version)" = "$BUN_VERSION" ]; then
  say "bun ${BUN_VERSION} already available"
else
  say "installing bun ${BUN_VERSION} into .devbin/bin"
  zip="/tmp/bun-${BUN_VERSION}.zip"
  url="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip"
  curl -fsSL "$url" -o "$zip" || { echo "error: bun download failed (network?) — ${url}" >&2; exit 1; }
  python3 - "$zip" <<'PYEOF'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    z.extractall("/tmp/bun-extract")
PYEOF
  mv -f "/tmp/bun-extract/bun-linux-x64/bun" .devbin/bin/bun
  chmod +x .devbin/bin/bun
  rm -rf /tmp/bun-extract "$zip"
fi
export PATH="$PWD/.devbin/bin:$PATH"
echo "bun $(bun --version)"

# ── 2. JS dependencies ────────────────────────────────────────────────────────
say "bun install (frozen lockfile)"
bun install --frozen-lockfile

# ── 3. Rust semantic helper ──────────────────────────────────────────────────
if [ -f rust/Cargo.toml ]; then
  say "building Rust helper (first build compiles llama.cpp; expect minutes)"
  (cd rust && cargo build --release -p gsterm-semantic)
  bash rust/scripts/install-artifacts.sh
else
  echo "error: rust/ workspace missing — the semantic helper cannot be built" >&2
  exit 1
fi

# ── 4. SolidLSP bridge (uv-managed Python) ───────────────────────────────────
if [ -f solidlsp/pyproject.toml ]; then
  say "syncing SolidLSP bridge environment (uv)"
  (cd solidlsp && uv sync)
else
  echo "error: solidlsp/ project missing — language intelligence cannot be mounted" >&2
  exit 1
fi

say "bootstrap complete"
echo "bun:        $(bun --version)"
echo "helper:     $([ -x rust/artifacts/bin/gsterm-semantic ] && echo rust/artifacts/bin/gsterm-semantic || echo NOT-BUILT)"
echo "solidlsp:   $([ -d solidlsp/.venv ] && echo .venv-ready || echo NOT-SYNCED)"
