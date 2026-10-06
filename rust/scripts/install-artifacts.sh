#!/usr/bin/env bash
# Stage the built gsterm-semantic helper + its native runtime assets into
# rust/artifacts/ (gitignored). Binary in bin/ (with the zvec .so beside it so
# the $ORIGIN rpath resolves); the same runtime assets in lib/ preserve the
# future Tauri-sidecar layout.
set -euo pipefail
cd "$(dirname "$0")/.."

target="${CARGO_TARGET_DIR:-target}/release/gsterm-semantic"
lib="${CARGO_TARGET_DIR:-target}/release/libzvec_c_api.so"
data="${CARGO_TARGET_DIR:-target}/release/data"

if [ ! -x "$target" ]; then
  echo "error: $target not found — run 'cargo build --release -p gsterm-semantic' first" >&2
  exit 1
fi

mkdir -p artifacts/bin artifacts/lib
cp -f "$target" artifacts/bin/gsterm-semantic
if [ -f "$lib" ]; then
  cp -f "$lib" artifacts/bin/libzvec_c_api.so
  cp -f "$lib" artifacts/lib/libzvec_c_api.so
fi
if [ -d "$data" ]; then
  rm -rf artifacts/lib/data artifacts/bin/data
  cp -r "$data" artifacts/lib/data
  cp -r "$data" artifacts/bin/data
fi

echo "artifacts staged:"
ls -la artifacts/bin
