# Semantic substrate

Covers `src/mechanisms/substrate.ts`, `semantic-helper.ts`, `solidlsp.ts`, `jsonlines.ts`,
`readiness.ts`, `src/focus/concept-index.ts`, plus `rust/crates/gsterm-semantic/` and `solidlsp/`.

## Purpose

Provide the native semantic mechanisms — hybrid source retrieval, a curated concept store, and
language intelligence — as lazily started, world-gated, honestly-reported processes. When they are
missing, gs-term degrades and says so rather than silently substituting local results.

## Responsibilities

- Discover and start the Rust helper and the Python bridge.
- Speak their stdio JSON-lines protocols.
- Mount the substrate for the **local world only**.
- Report per-mechanism readiness with truthful status, version and reason.
- Keep the concept store fresh via a digest marker.
- Dispose both processes deterministically, leaving nothing behind.

## Non-responsibilities

- It does not rank or decide relevance. That is `src/focus/search.ts`.
- It does not record anything.
- It does not provide authority; mechanisms have none.

## Position in the system

```mermaid
flowchart TB
  RT["createGsTermRuntime"] --> SUB["SemanticSubstrate"]
  PLANNER["syntelligentSearch"] -->|helperFor(worldId)| SUB
  CODE["code.* component"] -->|solidlspFor(worldId, root)| SUB
  DOC["doctor"] --> READY["collectReadiness"]
  SUB --> HELPER["SemanticHelper<br/>gsterm-semantic (Rust)"]
  SUB --> LSP["SolidLspBridge<br/>gsterm-solidlsp (Python/uv)"]
  LSP --> TSS["typescript-language-server on Bun"]
  HELPER --> ZG["zvec-grep engine"]
  HELPER --> ZV["zvec concept collection"]
  HELPER --> EM["model2vec embedder<br/>local/potion-code-16m-v2"]
  READY -.->|probes| HELPER
  READY -.->|probes| LSP
```

## Core abstractions

### `SemanticSubstrate`

```ts
{ enabled, dataDir, helper, solidlsp,
  helperFor(worldId): SemanticHelper | undefined,
  solidlspFor(worldId, workspaceRoot): SolidLspBridge | undefined,
  readiness(), dispose() }
```

Both accessors return `undefined` for any world other than the local one. That is the whole point:
a remote world must report its mechanisms unavailable, not receive local answers.

### `SemanticHelper`

Wraps one Rust process. Discovers the binary (`GSTERM_HELPER_BIN` override, then `rust/artifacts`,
then `rust/target/release`), starts it lazily, and exposes: `hello`, `zgSearch` (hybrid semantic
source retrieval), `conceptReplace`, `conceptQuery`, `conceptStats`, `modelStatus`. Malformed lines
surface as structured errors; a bad line never kills the loop. Model cache lives under
`<dataDir>/models`, not a machine-global path.

### `SolidLspBridge`

Wraps one Python process running SolidLSP for TypeScript. Lazily started per workspace, with a
stable data dir so first-start provisioning happens once. Exposes `startWorkspace`, `symbols`,
`workspaceSymbols`, `definition`, `references`, `implementations`, `diagnostics`, `refresh`.

Mechanism positions are 0-based; the capability layer converts to the 1-based semantic convention
before anything reaches a surface.

### Concept index

`ensureConceptIndex` compares `conceptRegistryDigest()` with a marker file beside the store. On a
mismatch (or an empty store) it replaces all documents with pruning — the curated registry is the
whole truth, so stale concepts cannot linger. `conceptQueryFor` returns matches with their `links`.

Freshness is explicit and the digest is testable: `conceptRegistryDigest` accepts an override so a
test can prove it tracks content.

### Readiness

`collectReadiness({config, root, startProbes})` returns `MechanismReadiness[]` for:

| Mechanism | Status source |
| --- | --- |
| `bun` | `bun --version` |
| `pty` | `setsid` on PATH |
| `rg` | `rg --version` |
| `zvec-grep-rust`, `zvec-rust` | binary discovery; deep mode adds handshake + version |
| `potion-model` | `modelStatus`; deep mode reports revision |
| `solidlsp` | project present; deep mode starts the bridge and refreshes |
| `python-uv`, `typescript-server` | deep mode reports installed language-server state |
| `ssh` | `ssh -V` |

Light mode (default) starts no managed processes: discovery is the signal. Deep mode starts them and
reports provisioned truth. A failed bridge start disposes the bridge in a `finally` block, so probing
cannot leak a process.

Statuses are `ready`, `degraded`, `unavailable`. `reason` is required whenever status is not
`ready`.

## Internal operation

Creation resolves the data dir (`<workspaceRoot>/.gsterm` unless `mechanisms.data_dir`), constructs
both clients, and returns the world-gated accessors. Nothing starts at construction.

`helperFor`/`solidlspFor` return the client only when `enabled` **and** the world id matches the
local world. Search then probes those clients before use, so availability is observed rather than
configured.

`dispose()` awaits both disposals with `allSettled` so one failure cannot strand the other.

### The Rust helper

One managed stdio JSON-lines process hosting the zvec-grep engine (git-pinned revision), a zvec
concept collection, and a model2vec embedder for `local/potion-code-16m-v2` (dimension 256). Scores
are cosine **distances** — ascending is better. The crate is a thin layer over engine APIs with no
global state beyond the lazy model loader.

Protocol reference: [../reference/rust-helper-protocol.md](../reference/rust-helper-protocol.md).

### The SolidLSP bridge

A stdio JSON-lines server hosting SolidLSP for TypeScript, managed by `uv`, with **Bun replacing
Node** as the JavaScript runtime. It provisions typescript-language-server through a `node → bun`
shim, so no real Node binary enters the runtime graph.

Protocol reference: [../reference/solidlsp-protocol.md](../reference/solidlsp-protocol.md).

## State

| State | Location |
| --- | --- |
| concept store | `<dataDir>/concepts` + `.digest` marker |
| SolidLSP resources/caches | `<dataDir>/solidlsp-data` |
| embedding models | `<dataDir>/models` |
| helper binary | `rust/artifacts/bin/gsterm-semantic` (+ `libzvec_c_api.so`) |
| uv environment | `solidlsp/.venv`, locked by `solidlsp/uv.lock` |

## Lifecycle

Lazily started on first use, shared process-wide, disposed with the runtime.

## Failure modes

| Symptom | Cause | Behaviour |
| --- | --- | --- |
| `code.*` throws `SolidLSP not mounted` | remote world, or mechanisms disabled | explicit error, no local substitution |
| Helper binary not found | `cargo build --release -p gsterm-semantic` not run | doctor `unavailable`; search degrades to rg |
| `potion-model` unavailable | model artifacts absent | one-time download on first index |
| First SolidLSP start is slow | it provisions language-server resources | stable data dir means this happens once |
| `workspaceSymbols` empty on a cold project | tsserver needs a loaded project (debt D-041) | bounded retries, then rg position fallback |
| Probe fails inside search | a client could not start | that client is dropped; the other remains |
| A `node` binary is reachable | environment leak | `--node-free` verification fails the build |

## Extension points

- **A new mechanism**: host it as its own managed process with a JSON-lines protocol, add readiness
  reporting, expose it through the substrate's world-gated accessors, and register it in
  `resolveAvailability`. Keep it out of the semantic layer.
- **A new provider capability** (`provider.*`): the helper protocol already exposes enough to add
  methods without redesigning the contract.

## Source trail

- `src/mechanisms/substrate.ts` — `SemanticSubstrate`, `createSemanticSubstrate`, world gating
- `src/mechanisms/semantic-helper.ts` — `SemanticHelper`, `discoverHelperBinary`
- `src/mechanisms/solidlsp.ts` — `SolidLspBridge`
- `src/mechanisms/jsonlines.ts` — the shared line protocol
- `src/mechanisms/readiness.ts` — `collectReadiness`, `MechanismReadiness`
- `src/focus/concept-index.ts` — `ensureConceptIndex`, `conceptQueryFor`
- `src/config.ts` — `MechanismsConfig`, `mechanismDataDir`
- `src/doctor.ts` — `doctor`, `SEMANTIC_REQUIRED`
- `rust/crates/gsterm-semantic/README.md`, `rust/crates/gsterm-semantic/src/*`
- `solidlsp/README.md`, `solidlsp/src/gsterm_solidlsp/bridge.py`, `solidlsp/selftest.py`
- `test/mechanisms/mechanisms.test.ts` — discovery, handshake, disposal