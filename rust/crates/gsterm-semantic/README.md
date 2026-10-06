# gsterm-semantic

> Reader-facing documentation for this helper lives in
> [docs/reference/rust-helper-protocol.md](../../../docs/reference/rust-helper-protocol.md), and its
> place in the system in
> [docs/subsystems/semantic-substrate.md](../../../docs/subsystems/semantic-substrate.md). This file
> remains the crate's own operational reference.

gs-term's native semantic helper: one managed Rust process hosting

- the **zvec-grep engine** (`zg-engine`, git-pinned) for hybrid semantic source retrieval;
- a **zvec concept collection** (`zvec-rust`) for gs-term's own concept objects;
- a **model2vec embedder** for `local/potion-code-16m-v2` (dimension 256).

It speaks newline-delimited JSON over stdio. gs-term's Bun application owns the
process lifecycle; nothing here knows about Bun, Cognate, or terminals. The
crate is a thin layer over the engine APIs (no global state beyond the lazy
model loader), so the same request shapes can later surface as Tauri commands
or an in-process Tauri module without a contract redesign.

## Provenance

| component | identity |
|---|---|
| zvec-grep engine | `zg-engine` @ `28ef2009838e509bdbeb43d06e04d0cf98e0b071` (github.com/zvec-ai/zvec-grep, Apache-2.0) — pinned as a cargo **git dependency** in `Cargo.toml`/`Cargo.lock`; verified resolvable because cargo finds `rust/crates/zg-engine` inside the repo by tree traversal |
| zvec vector DB | `zvec-rust`/`zvec-rust-build` `0.7.2` (crates.io, Apache-2.0); native `libzvec_c_api.so` from upstream prebuilt release, tracked under upstream zvec `1ab7975dfc2d2160054bafff614831b7099cd930` |
| embedding model | `local/potion-code-16m-v2` (minishlab/potion-code-16M-v2 @ `e9d2a44ca6a05ac6685f3b23709ea57eb7352d5b`, dim 256, cosine). sha256 pins reproduced from the upstream catalog: model.safetensors `75cf7a6c…23c`, tokenizer.json `107bbdcb…d45`. Cache: `$ZVEC_GREP_MODEL_CACHE` → `$ZVEC_GREP_HOME/models` → `~/.zvec-grep/models` (shared with the zg CLI) |
| llama.cpp | transitive of zg-engine; pinned `=0.1.154` because zg-engine breaks against `llama-cpp-2 >= 0.1.155` (`AddBos` moved) |

The model2vec math (mean-pool of token rows in f64, L2 normalize, f32 narrow)
is ported from `zg-engine/src/models/backends/model2vec/` (Apache-2.0) so
concept embeddings are arithmetically identical to the source indexer's.

## Protocol

One JSON object per line on stdin → one response line on stdout. Indexing
progress arrives as id-carrying notifications (`{"method":"progress",…}`).

```
{"id":1,"method":"hello","params":{}}
→ {"id":1,"ok":true,"result":{"name":"gsterm-semantic","version":"0.1.0",
    "zg_engine_revision":"28ef200…","zvec_version":"…","caps":["zg","concepts"],
    "model":{"reference":"local/potion-code-16m-v2","dimension":256}}}

zg.index   {root, embedding?, rebuild?}        → serialized zg-engine IndexResult (progress streamed)
zg.info    {root, include_status?}             → serialized zg-engine InfoResult
zg.search  {root, query, mode: hybrid|fts|vector, limit?, refresh?, file_types?}
           → {source, coverage, items:[{relative_path, start_line, end_line,
              snippet(≤400ch), score, matched_by, symbol_name, symbol_type, status}]}
zg.drop    {root}                              → {dropped: bool}
model.status {}                               → {reference, ready, path, dimension, revision}
concept.ensure  {path}                         → {doc_count}   (open-or-create)
concept.replace {path, docs:[{id,kind,label,text,metadata?,links?}], prune?}
                                                → {written, pruned}
concept.query   {path, text, topk?, kind?}      → {items:[{id,kind,label,score,metadata,links}]}
concept.stats   {path}                          → {doc_count}
shutdown    {}                                  → {bye:true} then exit 0
```

- **Scores are cosine DISTANCES**: 0 = identical, ascending = worse. Callers sort ascending.
- `concept.*` scores come from zvec; `zg.search` scores are engine fusion scores.
- Malformed lines get `{"id":null,"ok":false,"error":{...}}` and the process keeps serving.
- stdin EOF or `shutdown` ends the process cleanly; all concept writes flush per operation.

## Operational notes

- **One process per collection directory.** zvec holds an exclusive LOCK per
  concept-store path and cannot re-open it within the same process, so the
  helper caches open collections for its lifetime (`ConceptStore`). Never
  open the same concept store from a second process — including read-only.
- **Search self-heals**: `zg.search` uses the engine default
  `auto_update: true`, so a stale index refreshes synchronously during the
  query. Pass `refresh: "off"` to forbid refreshes (read-only hot path).
- **Artifacts**: run `bash scripts/install-artifacts.sh` after a release
  build; it stages the binary with `libzvec_c_api.so` (and the jieba dict
  data) beside it in `artifacts/bin/` and mirrors them in `artifacts/lib/`
  (Tauri sidecar layout). The `$ORIGIN` rpath makes the bin/ layout
  self-contained.
- **Build**: `cargo build --release -p gsterm-semantic` (rustc 1.98.0 via
  `rust-toolchain.toml`; needs cmake + a C++ toolchain for llama.cpp, ~15 min
  cold). Tests: `cargo test -p gsterm-semantic --release` — they reuse the
  machine's warm model cache via `ZVEC_GREP_MODEL_CACHE` and skip cleanly
  when no cache exists.
