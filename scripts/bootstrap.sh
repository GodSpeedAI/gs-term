#!/usr/bin/env bash
# gs-term bootstrap: bun deps + Rust toolchain + helper build + SolidLSP sync.
# Idempotent and SELF-CONTAINED: a clean machine needs only this script (plus
# network). Used by `devbox run bootstrap` and standalone; the same gates run
# in scripts/verify-all.sh. Node.js is never installed or required.
#
# Explicit toolchain boundaries (no silent host dependence):
#   Bun     — pinned release downloaded into .devbin/bin (nixpkgs carries only 1.3.x)
#   Rust    — rustup + rust/rust-toolchain.toml (1.98.0); rustup installed here if missing
#   C/C++   — the first working `cc` on PATH is smoke-tested; a broken nix-toolchain
#             PATH is stripped deterministically (D-040 adjudication, see below)
set -euo pipefail
cd "$(dirname "$0")/.."

BUN_VERSION="${BUN_VERSION:-1.4.2}"
RUST_VERSION="$(sed -n 's/^channel = "\(.*\)"/\1/p' rust/rust-toolchain.toml | head -1)"

say() { printf '\n== %s ==\n' "$*"; }

# ── 0. Rust build toolchain boundary (D-040, explicit): the Rust build pins
#      CC/CXX to the HOST compiler when one exists. Nix gcc wrappers drag a
#      nix loader/libstdc++ boundary into bindgen/libclang loading (observed
#      on both the WSL host and GitHub runners) — and a PATH filter alone is
#      not enough because the devbox PROFILE dir (`.devbox/nix/profile/bin`)
#      also symlinks nix cc. So: discover the host cc on a nix-free PATH and
#      export CC/CXX explicitly; nix remains the source for python/uv/rg/... .
smoke_cc() {  # $1 = compiler
  # Inside the checkout: TMPDIR (e.g. GitHub's _temp) may be mounted noexec,
  # which would falsely fail the run-the-output half of the smoke.
  local tmp; tmp="$(mktemp -d "$PWD/.devbin/smoke.XXXXXX")" || return 1
  printf 'int main(void){return 0;}\n' > "$tmp/t.c" || return 1
  "$1" "$tmp/t.c" -o "$tmp/t" 2>/dev/null || { rm -rf "$tmp"; return 1; }
  "$tmp/t" 2>/dev/null; local status=$?
  rm -rf "$tmp"
  return "$status"
}
no_nix_path="$(printf %s "$PATH" | tr ':' '\n' | grep -vE '/nix/store/|/\.devbox/nix/' | paste -sd:)"
host_cc="$(PATH="$no_nix_path" command -v cc 2>/dev/null || true)"
if [ -n "$host_cc" ]; then
  # Trust build-essential; the smoke is a WARNING (runners have exec-quirks),
  # the real adjudication is the build itself — visible in the logs either way.
  if smoke_cc "$host_cc"; then
    smoke_note="smoke ok"
  else
    smoke_note="smoke FAILED (continuing; the build will adjudicate)"
  fi
  host_cxx="$(PATH="$no_nix_path" command -v 'c++' 2>/dev/null || true)"
  export CC="$host_cc"
  [ -n "$host_cxx" ] && export CXX="$host_cxx"
  say "C toolchain: CC=$CC (host; nix cc excluded; $smoke_note)"
elif command -v cc >/dev/null 2>&1; then
  say "C toolchain: no cc on a nix-free PATH — falling back to cc on PATH (nix): $(command -v cc)"
else
  echo "error: no C compiler found — install build-essential or enter devbox" >&2
  exit 1
fi

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

# ── 3. Rust toolchain (rustup + pinned rust-toolchain.toml) ──────────────────
if ! command -v cargo >/dev/null 2>&1; then
  say "installing rustup (toolchain ${RUST_VERSION} comes from rust/rust-toolchain.toml)"
  curl -fsSL https://sh.rustup.rs -o /tmp/rustup-init.sh || { echo "error: rustup download failed" >&2; exit 1; }
  sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain "${RUST_VERSION}" --no-modify-path
  rm -f /tmp/rustup-init.sh
fi
export PATH="$HOME/.cargo/bin:$PATH"
command -v cargo >/dev/null 2>&1 || { echo "error: cargo not found after rustup step" >&2; exit 1; }
echo "rustc $(rustc --version)"

# ── 4. Rust semantic helper ──────────────────────────────────────────────────
if [ -f rust/Cargo.toml ]; then
  say "building Rust helper (first build compiles llama.cpp; expect minutes)"
  (cd rust && cargo build --release -p gsterm-semantic)
  bash rust/scripts/install-artifacts.sh
else
  echo "error: rust/ workspace missing — the semantic helper cannot be built" >&2
  exit 1
fi

# ── 5. SolidLSP bridge (uv-managed Python) ───────────────────────────────────
if ! command -v uv >/dev/null 2>&1; then
  say "installing uv"
  curl -LsSf https://astral.sh/uv/install.sh -o /tmp/uv-install.sh || { echo "error: uv download failed" >&2; exit 1; }
  sh /tmp/uv-install.sh
  rm -f /tmp/uv-install.sh
  export PATH="$HOME/.local/bin:$PATH"
fi
if [ -f solidlsp/pyproject.toml ]; then
  say "syncing SolidLSP bridge environment (uv)"
  (cd solidlsp && uv sync)
else
  echo "error: solidlsp/ project missing — language intelligence cannot be mounted" >&2
  exit 1
fi

say "bootstrap complete"
echo "bun:        $(bun --version)"
echo "rust:       $(rustc --version)"
echo "helper:     $([ -x rust/artifacts/bin/gsterm-semantic ] && echo rust/artifacts/bin/gsterm-semantic || echo NOT-BUILT)"
echo "solidlsp:   $([ -d solidlsp/.venv ] && echo .venv-ready || echo NOT-SYNCED)"
