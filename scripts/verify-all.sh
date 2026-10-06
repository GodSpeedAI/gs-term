#!/usr/bin/env bash
# gs-term validation gate — THE one verification path, identical inside and
# outside devbox (devbox only provides the toolchain). With --node-free, the
# PATH is scrubbed of every node/npm source first and the gate FAILS if any
# node binary is still visible: the product stack must run without Node.
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_FREE=0
[ "${1:-}" = "--node-free" ] && NODE_FREE=1

fail() { echo "FAIL: $*" >&2; exit 1; }

if [ "$NODE_FREE" = 1 ]; then
  # Scrub host PATH of node/npm managers, keep the bootstrapped bun dir.
  PATH="$(printf %s "$PATH" | tr ':' '\n' | grep -vE '(^|/)(node|nvm|\.nub|mise|volta|fnm|pnpm|npm|yarn)(/|$)|/mnt/c/' | paste -sd:)"
  export PATH
  hash -r 2>/dev/null || true
  if command -v node >/dev/null 2>&1; then
    fail "node visible at $(command -v node) — the required stack must be node-free"
  fi
  echo "node-free: OK"
  command -v bun >/dev/null 2>&1 || fail "bun not found after PATH scrub (run scripts/bootstrap.sh)"
fi

TOTAL_START=$(date +%s)
section() { printf '\n== %s ==\n' "$*"; }
timed() {
  local start=$(date +%s)
  "$@"
  echo "($(( $(date +%s) - start ))s)"
}

section "typecheck"
timed bun run typecheck

section "lint"
timed bun run lint

section "unit/integration tests"
timed bun test test/

if [ "${GSTERM_SKIP_RUST:-0}" != "1" ] && [ -f rust/Cargo.toml ]; then
  section "rust mechanism tests"
  timed bash -c 'cd rust && cargo test -p gsterm-semantic --release'
else
  echo "SKIP rust tests (GSTERM_SKIP_RUST=1 or rust/ missing)"
fi

if [ "${GSTERM_SKIP_SOLIDLSP:-0}" != "1" ] && command -v uv >/dev/null 2>&1 && [ -f solidlsp/pyproject.toml ]; then
  section "solidlsp bridge selftest"
  timed bash -c 'cd solidlsp && uv run python selftest.py'
else
  echo "SKIP solidlsp selftest (GSTERM_SKIP_SOLIDLSP=1 or uv/solidlsp missing)"
fi

if [ "${GSTERM_SKIP_DOCTOR:-0}" != "1" ]; then
  section "gs-term doctor (light)"
  timed bun run doctor || fail "doctor reports unavailable mechanisms"
else
  echo "SKIP doctor (GSTERM_SKIP_DOCTOR=1)"
fi

if [ "${GSTERM_SKIP_E2E:-0}" != "1" ]; then
  section "e2e (playwright)"
  timed bun run e2e
else
  echo "SKIP e2e (GSTERM_SKIP_E2E=1)"
fi

echo ""
echo "ALL GATES PASSED ($(( $(date +%s) - TOTAL_START ))s total)"
