#!/usr/bin/env bash
# gs-term validation gate — THE one verification path, identical inside and
# outside devbox (devbox only provides the toolchain).
#
# Two levels:
#   scripts/verify-all.sh                developer gate — semantic mechanisms may
#                                        skip honestly on an unbootstrapped checkout
#   scripts/verify-all.sh --node-free    additionally proves `node` is invisible
#                                        to the product path
#   scripts/verify-all.sh --release      RELEASE/CI ORACLE: node-free + no
#                                        semantic skips — missing semantic
#                                        dependencies are fatal, doctor must
#                                        satisfy the require-semantic profile,
#                                        GSTERM_SKIP_* is rejected
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_FREE=0
RELEASE=0
for arg in "$@"; do
  case "$arg" in
    --node-free) NODE_FREE=1 ;;
    --release) RELEASE=1; NODE_FREE=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

fail() { echo "FAIL: $*" >&2; exit 1; }

if [ "$RELEASE" = 1 ]; then
  for var in GSTERM_SKIP_RUST GSTERM_SKIP_SOLIDLSP GSTERM_SKIP_DOCTOR GSTERM_SKIP_E2E GSTERM_SKIP_SEMANTIC; do
    [ "${!var:-}" = "" ] || fail "$var is set — release verification refuses skips"
  done
  export GSTERM_REQUIRE_SEMANTIC=1
  echo "release gate: semantic skips are fatal (GSTERM_REQUIRE_SEMANTIC=1)"
fi

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

if [ "$RELEASE" = 1 ]; then
  section "domainforge projection (model round-trip)"
  timed bun -e 'import { readFileSync } from "node:fs"; import { loadSemanticProjection } from "@cognate/domainforge"; const r = loadSemanticProjection(readFileSync("domain/interaction-model.sea", "utf8"), { uri: "domain/interaction-model.sea" }); if (!r.ok) { console.error(r.error); process.exit(1); } console.log("model ok:", r.projection.objects.length, "objects, digest", r.projection.source.digest.slice(0, 19));'
fi

section "unit/integration tests"
timed bun test test/

if [ "${GSTERM_SKIP_RUST:-0}" != "1" ] && [ -f rust/Cargo.toml ]; then
  if [ "$RELEASE" = 1 ] && [ ! -x rust/target/release/gsterm-semantic ]; then
    fail "gsterm-semantic is not built — release verification requires it (run scripts/bootstrap.sh)"
  fi
  section "rust mechanism tests"
  timed bash -c 'cd rust && cargo test -p gsterm-semantic --release'
else
  if [ "$RELEASE" = 1 ]; then fail "rust mechanism tests were skipped — release verification requires them"; fi
  echo "SKIP rust tests (GSTERM_SKIP_RUST=1 or rust/ missing)"
fi

if [ "${GSTERM_SKIP_SOLIDLSP:-0}" != "1" ] && command -v uv >/dev/null 2>&1 && [ -f solidlsp/pyproject.toml ]; then
  section "solidlsp bridge selftest"
  timed bash -c 'cd solidlsp && uv run python selftest.py'
else
  if [ "$RELEASE" = 1 ]; then fail "solidlsp selftest was skipped — release verification requires it"; fi
  echo "SKIP solidlsp selftest (GSTERM_SKIP_SOLIDLSP=1 or uv/solidlsp missing)"
fi

if [ "${GSTERM_SKIP_DOCTOR:-0}" != "1" ]; then
  section "gs-term doctor"
  if [ "$RELEASE" = 1 ]; then
    timed bun run doctor --require-semantic || fail "doctor did not satisfy the require-semantic profile"
  else
    timed bun run doctor || fail "doctor reports unavailable mechanisms"
  fi
else
  if [ "$RELEASE" = 1 ]; then fail "doctor was skipped — release verification requires it"; fi
  echo "SKIP doctor (GSTERM_SKIP_DOCTOR=1)"
fi

if [ "${GSTERM_SKIP_E2E:-0}" != "1" ]; then
  section "e2e (playwright)"
  timed bun run e2e
else
  if [ "$RELEASE" = 1 ]; then fail "e2e was skipped — release verification requires it"; fi
  echo "SKIP e2e (GSTERM_SKIP_E2E=1)"
fi

echo ""
echo "ALL GATES PASSED ($(( $(date +%s) - TOTAL_START ))s total)${RELEASE:+ — RELEASE ORACLE}"