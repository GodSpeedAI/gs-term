# Phase 3.5 — Native semantic reduction substrate

Baseline snapshot: `8d46fb981f82433098ee2ba69570329717462c2f` (chore: snapshot before semantic-reducer phase).

## Goal

Mount the modeled-but-unavailable semantic reducers (zvec-grep, zvec, SolidLSP) for real and
prove they reduce search materially better than lexical exploration alone:

```
QUERY / ATTENTION → Focus Engine → structural concept layer (graph + zvec)
  → candidate scope → {exact rg | conceptual zvec-grep} → SolidLSP verification
  → smallest source slice
```

## Recon-established facts (2026-10-05)

- zvec-grep upstream: github.com/zvec-ai/zvec-grep @ `28ef2009838e509bdbeb43d06e04d0cf98e0b071`,
  Rust tree `rust/` (workspace v0.0.1, edition 2024, rustc 1.98.0, Apache-2.0). Engine crate
  `zg-engine` exposes `ZvecGrep::{context, index, info, drop_index, close}` with serde'd
  ContextOptions/IndexOptions/InfoOptions. Builds locally (~15 min cold; cmake+C++ needed for
  llama.cpp/ort). NOT on crates.io/npm — integration must be source-pinned.
- `local/potion-code-16m-v2` (model2vec, minishlab/potion-code-16M-v2 @ `e9d2a44c…`, dim 256,
  cosine) is zg's default local embedding model; cache `~/.zvec-grep/models/model2vec/…`.
- zvec-rust 0.7.2 (+zvec-rust-build, Apache-2.0) on crates.io: safe bindings, HNSW cosine,
  FTS, scalar filters; collection = directory with single-process LOCK; prebuilt
  `libzvec_c_api.so` (38 MB) downloaded at build time; Linux x64/arm64 prebuilts exist.
- SolidLSP: NOT standalone; MIT ONLY at PyPI `serena-agent==1.7.0` (later upstream main
  relicensed the Serena app GPL; do not track main). Python >=3.11,<3.15. Synchronous API,
  `SolidLanguageServer.create(config, root)`; TS server = typescript-language-server 5.1.3 +
  tsserver 5.9.3, provisioned via npm into `<solidlsp_dir>/language_servers/static/…`.
- Bun 1.4.0 RUNS typescript-language-server + tsserver correctly (byte-identical LSP results
  vs Node; tsserver forks via process.execPath = bun). Proven with `node` absent from PATH.
  → **Node runtime required: NO.** A `node`→bun PATH shim satisfies SolidLSP's
  `shutil.which("node")` assert + the `#!/usr/bin/env node` shim launch.
- Devbox 0.17.5 works on this host; nixpkgs bun maxes at 1.3.13 → bootstrap pins
  bun 1.4.x by download; rustup(nix) + rust-toolchain.toml drives rustc 1.98.0.

## Architecture

```
gs-term Bun app (composition root: src/app/runtime.ts)
   │  managed mechanism processes (structured stdio IPC, never the PTY)
   ├── rust helper  `gsterm-semantic`  (one process: zg-engine + zvec-rust + model2vec)
   │     ├── zvec-grep engine   → workspace source index / hybrid retrieval
   │     ├── zvec-rust          → gs-term CONCEPT collection (never source chunks)
   │     └── model2vec port     → potion-code-16m-v2 embeddings for concepts
   └── python bridge `gsterm-solidlsp` (uv-managed, serena-agent==1.7.0 pinned)
         └── SolidLanguageServer → typescript-language-server (run BY BUN via node→bun shim)
```

- Responsibilities: zvec-grep owns workspace source retrieval; zvec owns gs-term concept
  objects; explicit structural graph stays authoritative (vector similarity never creates
  topology); SolidLSP owns language semantics; rg stays the exact tier.
- World scoping: the substrate is mounted for the LOCAL world only. Remote worlds report the
  mechanisms truthfully unavailable (J14); no silent local substitution.
- Tauri seam: the helper is a plain Rust bin with a thin JSON-line layer over
  `zg_engine::api` / `zvec_rust` types; no global state; binary + `libzvec_c_api.so` ship
  together ($ORIGIN rpath). No Tauri code now.

## New/changed layout

```
rust/                          # gs-term Rust workspace (committed source; build artifacts ignored)
  Cargo.toml  Cargo.lock  rust-toolchain.toml (1.98.0)
  crates/gsterm-semantic/      # helper bin: stdio JSON-lines protocol
  tests/ via cargo test -p gsterm-semantic
solidlsp/                      # uv project (committed pyproject.toml + uv.lock)
  src/gsterm_solidlsp/bridge.py
src/mechanisms/                # Bun mechanism layer (Cognate-free): helper + bridge clients,
                               # readiness model, lifecycle
src/semantic/concepts.ts       # curated gs-term concept registry (embedding inputs + links)
src/components/code.ts         # code.definition/references/implementations/diagnostics caps
src/doctor.ts                  # `bun run doctor`
devbox.json devbox.lock        # reproducible toolchain (NO Node)
scripts/bootstrap.sh           # bun deps + rust helper build + uv sync (+ model pre-seed)
scripts/verify-all.sh          # the one validation gate (same inside and outside devbox)
```

## Contracts

### gsterm-semantic protocol (stdio, one JSON object per line)

Request `{"id":n,"method":m,"params":{…}}` → `{"id":n,"ok":true,"result":…}` |
`{"id":n,"ok":false,"error":{"message":…}}`; async progress notifications
`{"method":"progress","params":…}`.

Methods: `hello`; `zg.index {root,embedding?,rebuild?}`; `zg.info {root,include_status?}`;
`zg.search {root,query,mode:hybrid|fts|vector|rg,limit?,refresh?,file_types?}` (→ normalized
items: relative_path, start/end line, bounded snippet, score, matched_by, symbol metadata,
freshness status); `zg.drop {root}`; `model.status`; `concept.ensure {path}`;
`concept.replace {path,docs:[{id,kind,label,text,metadata,links}],prune?}`;
`concept.query {path,text,topk?,kinds?}` (score = cosine DISTANCE, ascending);
`concept.stats {path}`; `shutdown`.

### gsterm-solidlsp protocol (stdio JSON-lines, same envelope)

`hello`; `start {workspace}` (PATH-shims node→bun; provisions TS server via bun if absent);
`ready`; `symbols {file}`; `workspace_symbols {query}`; `definition {file,line,column}`;
`references {file,line,column,include_declaration?}`; `implementations {…}`;
`hover {…}`; `diagnostics {file}`; `shutdown`. Locations are workspace-relative + 0-based.

### Config (`gsterm.toml`)

`[mechanisms]` section: `enabled` (default true), `helper_binary` (default discovery:
`rust/artifacts/bin/` then `rust/target/release/`), `solidlsp_project` (default `solidlsp`),
`model` (default `local/potion-code-16m-v2`), `data_dir` (default `<root>/.gsterm`).

## Implementation waves

- A (parallel): A1 rust helper crate + cargo tests; A2 solidlsp bridge + uv lock + bun-shim
  provisioning; A3 devbox + scripts + .gitignore housekeeping.
- B: Bun mechanism clients + readiness + config; `doctor`; concept registry.
- C: search planner routing + structural graph upgrade + code.* capabilities
  (component, agent intents, policy, bindings, WebMCP, .sea J9 extension, pinned-test updates).
- D: reduction acceptance proofs (`/ who calls this?`, concept query, architecture query),
  node-free discipline test, full validation, docs/DEBT, completion commit.

## Acceptance

- Conceptual query → Focus/Attention → zvec concept reduction → structural graph →
  zvec-grep source retrieval → rg verification → SolidLSP verification → small bounded result.
- Known symbol → SolidLSP directly (`/ who calls this?` uses semantic references).
- JS deps run under Bun; no Node in the required runtime graph; devbox clean proof with
  `command -v node` absent; doctor reports truthfully per mechanism.
- DomainForge validation, Phase 1–3 regressions, oxlint, typecheck, unit/integration, Rust
  tests, SolidLSP tests, planner tests, WebMCP tests, e2e — all green.
