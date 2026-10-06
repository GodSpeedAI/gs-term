# Current status

**Phase 3.5 complete (2026-10-05)** — native semantic reduction substrate mounted and proven.

## What exists now

- **Terminal + cockpit + WebMCP + Cognate runtime** (Phases 1–3): real PTY (setsid bash, shell
  markers), structured execution across local/SSH worlds, observation ingestion, Focus Engine,
  Syntelligent Search with reduction receipts.
- **`gsterm-semantic`** (Rust, `rust/crates/gsterm-semantic`): managed helper hosting the
  zvec-grep engine (git-pinned `28ef200`), a zvec concept store (23 curated gs-term concepts from
  `src/semantic/concepts.ts`), and potion-code-16m-v2 embeddings (model2vec, dim 256). Build:
  `cargo build --release -p gsterm-semantic` + `rust/scripts/install-artifacts.sh`; artifacts in
  `rust/artifacts/` (git-ignored).
- **`gsterm-solidlsp`** (Python, `solidlsp/`): uv-managed stdio bridge over SolidLSP
  (`serena-agent==1.7.0`, MIT). Provisions typescript-language-server 5.1.3 + tsserver 5.9.3 via
  **bun** (node→bun + npm→bun shims in `<data_dir>/shims`) — no Node required. Selftest:
  `cd solidlsp && uv run python selftest.py`.
- **Mechanism layer** (`src/mechanisms/`): JSON-lines process client, helper/bridge clients,
  readiness model, world-gated substrate. `bun run doctor [--probe]` reports honest readiness
  and ends with `Node: not required`.
- **Planner routing** (`src/focus/search.ts`): SolidLSP-first for known symbols (rg is a stated
  fallback); concepts → structural scope → zvec-grep → rg verification → SolidLSP for natural
  language; architecture questions stop at the concept layer; evidence-first for failures.
- **`code.*` capabilities** (`src/components/code.ts`): definition/references/implementations/
  diagnostics bound to `controlplane::Code Symbol`/`Diagnostic`; projected via `agent.focus`
  intent `code` and WebMCP tools `code_references`/`code_definition`/`code_diagnostics`.
- **Devbox** (`devbox.json`/`devbox.lock`): python 3.12, uv, ripgrep, git, openssh, cmake, gcc,
  libclang (no node). `devbox run bootstrap` / `devbox run verify`; Rust toolchain via rustup +
  `rust/rust-toolchain.toml` (1.98.0). `scripts/verify-all.sh --node-free` proves the full gate
  runs with `node` invisible.

## Validation state (2026-10-05)

typecheck ✓ · oxlint 0 errors ✓ · 126 unit/journey/conformance tests ✓ · Rust helper 5 tests ✓ ·
SolidLSP selftest 10/10 ✓ · e2e Playwright 10/10 ✓ · doctor deep probe 9/10 ready (1 degraded:
TS-server provisioning state, honest) ✓ · node-free gate ✓ · DomainForge validate 0 violations ✓.

Acceptance proofs (`test/journeys/journey-j9-semantic-reduction.test.ts`):
- `/ who calls this?` on `syntelligentSearch` → 13 SolidLSP references incl. the true caller.
- Conceptual query ("stop an agent from taking over what the human is looking at" — wording absent
  from the code) → 169 files reduced to ≤5 via concepts → scope → zvec-grep → verification (~3 s).
- Architecture question → concepts + structural scope, zero source retrieval.

## Known watch items

See `.agents/DEBT.md`: D-040 (devbox nix gcc cannot build Rust here → host rustup), D-041
(tsserver navto needs loaded projects → planner warm-up), D-042 (node→bun shim boundary).
