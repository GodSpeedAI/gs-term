# Rust helper protocol (`gsterm-semantic`)

One managed stdio JSON-lines process hosting the zvec-grep engine, a zvec concept collection, and a
model2vec embedder. The Bun application owns the lifecycle; the crate knows nothing about Bun,
Cognate or terminals.

Client: `src/mechanisms/semantic-helper.ts` (`SemanticHelper`).
Shared line handling: `src/mechanisms/jsonlines.ts`.

## Provenance

- the **zvec-grep engine** is a cargo **git dependency** pinned to a specific revision — not a fork;
- the **zvec collection** comes from zvec-rust;
- the embedder is model2vec for `local/potion-code-16m-v2`, dimension 256;
- concept embeddings use the same mean-pool math as the source indexer.

## Discovery

`discoverHelperBinary` checks, in order:

1. `GSTERM_HELPER_BIN`;
2. `rust/artifacts/bin/gsterm-semantic`;
3. `rust/target/release/gsterm-semantic`.

Returning `undefined` is a clean, expected result — not an error.

## Wire format

One JSON object per line, in and out.

Request:

```json
{"id": 1, "method": "hello", "params": {}}
```

Response:

```json
{"id": 1, "ok": true,  "result": { }}
{"id": 1, "ok": false, "error": {"message": "..."}}
```

A malformed input line produces `{"id": null, "ok": false, "error": {...}}` and the loop continues.
The helper never dies on bad input.

## Methods

| Method | Params | Result | Client |
| --- | --- | --- | --- |
| `hello` | `{}` | `{version, zvec_version, zg_engine_revision}` — the handshake | `helper.start()` |
| `model.status` | `{}` | `{ready, revision, path}` | `helper.modelStatus()` |
| `zg.search` | `{root, query, mode, limit}` | `{items: [{relative_path, start_line, symbol_name, snippet, matched_by, status}]}` | `helper.zgSearch()` |
| `concept.replace` | `{store, docs[], prune}` | `{doc_count}` | `helper.conceptReplace()` |
| `concept.query` | `{store, text, topk, kind}` | `{items: [{id, label, score, links[]}]}` | `helper.conceptQuery()` |
| `concept.stats` | `{store}` | `{doc_count}` | `helper.conceptStats()` |

Notes:

- **`zg.search`** is hybrid full-text plus vector retrieval over workspace **source**. `mode` is
  `hybrid`. `status` may be `possibly_stale`; the planner surfaces that in the result reason.
- **`concept.replace`** takes gs-term concept objects only — never source chunks. `prune` is always
  `true`: the curated registry is the whole truth, so stale concepts never linger.
- **Scores are cosine distances** — ascending is better. The planner formats them as distances.
- **Links** returned by `concept.query` are the authoritative structure; similarity only surfaced the
  concept.

## Operational notes

- The process is started lazily, shared process-wide, and disposed with the runtime.
- Model artifacts live under `<dataDir>/models` — a product-owned cache, not a machine-global path.
  The first index downloads them once.
- `dispose()` leaves no helper process running; `test/mechanisms/mechanisms.test.ts` asserts it.
- The crate keeps no global state beyond the lazy model loader, so the same request shapes could later
  surface as Tauri commands or an in-process module without a contract redesign.

## Source trail

- `rust/crates/gsterm-semantic/README.md` — protocol and provenance
- `rust/crates/gsterm-semantic/src/main.rs` — the dispatch loop
- `rust/crates/gsterm-semantic/src/zgrep.rs` — engine integration
- `rust/crates/gsterm-semantic/src/concepts.rs` — the concept collection
- `rust/crates/gsterm-semantic/src/model2vec.rs` — the embedder
- `rust/crates/gsterm-semantic/src/proto.rs` — request/response shapes
- `rust/crates/gsterm-semantic/tests/integration.rs` — protocol contract
- `rust/scripts/install-artifacts.sh` — staging into `rust/artifacts/`
- `src/mechanisms/semantic-helper.ts` — the Bun client
- `test/mechanisms/mechanisms.test.ts` — discovery, handshake, concept lifecycle, disposal