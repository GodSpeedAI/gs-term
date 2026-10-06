# Handoff — interaction model → Cognate implementation

For the downstream builder (read with `idm-to-cognate.md` + `cognate-api.md`). Keep this file and
the traceability map current when names change.

## Semantic source

- Canonical model: `.sea/interaction/interaction-model.sea` (validated; see `validation/`).
- Re-export: `domain/interaction-model.sea` is a **symlink** to the canonical file (single source;
  `cognate dev`-compatible). Decision recorded per `idm-to-cognate.md` gap note.
- Projection load: `loadSemanticProjection(source, { uri })` → `SemanticProjection`; ids verified:
  entities/resources → `controlplane::<name>`; flows → `gsterm::flow(...)`; policies → `gsterm::*`.
- Source digest at handoff: `sha256:4dddc4862e4c1e55018e480799a04899082db8ddbfd8d8d0ab8e4b30502645a2` (Phase 3.5: J9 catalog entry extended for mounted SolidLSP).

## Explicit capability bindings (`bindCapabilities` — nothing implicit)

| semanticId | capability id | version | provided by | journey |
|---|---|---|---|---|
| `controlplane::Execution` | `process.exec` | `1.0.0` | Cognate `executionWorldsComponent` | J2 |
| `controlplane::Evidence` | `world.snapshot` | `1.0.0` | app `observersComponent` | J1/J2/J3 |

`filesystem.*` (Cognate execution family) is available to agents as supporting capability for
containment/inspection; it is not bound to a resource because the model has no filesystem
resource — it is mechanism, not meaning.

## Agents (canonical journeys → runs)

| agent id | journey | input | emits | output |
|---|---|---|---|---|
| `agent.execute` | J2 (+J2-W) | `{argv, cwd, worldId, source, requestedBy, correlationId?}` | `execution.started`, `effect.observed`, `execution.completed` | structured execution summary |
| `agent.observe` | J1 | `{observationId, command, cwd, exitCode, startedAt, endedAt, preSnapshot, sessionId, source:"pty"}` | same three event types | structured execution summary |

Both agents are deterministic given recorded steps (`ctx.step`, `ctx.invoke`); ids minted inside
steps; no bare clock/randomness.

## World identity (Phase 2)

- ONE capability `process.exec` (+ `world.snapshot`) for every execution world; `worldId` in the
  input selects the provider (Cognate `ExecutionWorldProvider` registry: local + ssh; wsl later).
- **Resource identity = `(worldId, path)`** — equal paths in different worlds are different
  resources. `Effect.worldId` + snapshot `world: {worldId, kind, metadata}` carry provenance;
  metadata is provider-safe (host/port/username/auth kind/host key), never credentials.
- `world.snapshot` input: `{worldId?}` (default: the session world). Evidence structure is
  identical across worlds; `how`/`refs` carry the world. Remote processes/ports are honestly
  `unknown` (D-010).

## Event vocabulary (typed semantic events; PTY bytes never appear here)

- `execution.started` — `{executionId, source, surface, worldId, command, argv?, cwd, startedAt, actor}`
- `effect.observed` — `{executionId, observedAt, effects: Effect[]}` where
  `Effect = {kind: …, worldId, target, before?, after?, evidence: Evidence[]}` and
  `Evidence = {what, how, confidence: "observed"|"derived"|"unknown", refs: string[]}`
- `execution.completed` — `{executionId, exitCode|exitCode:null, timedOut?, endedAt, durationMs, output: {stdout?, stderr?}| "unknown", effectsCount, settled: "observed"|"derived"}`
- `execution.failed` — `{executionId, failedAt, reason}` — explicit non-settlement when a run
  cannot reach `execution.completed` (e.g. policy denial); rethrown so run status stays `failed`.
- Runtime-native (`run.*`) lifecycle events are the run-level record; cancellation is only
  visible there (agents cannot emit after abort — by design).
- Shared-state `state.changed` on thread `session:<sessionId>` (Cognate-native) carries J3's world
  view: `{sessionId, shell, cwd, terminal, repository, processes, ports, lastExecution, observedAt}`.

## Projections

| name | public | folds | keys (tenant-partitioned `<tenant>/…`) |
|---|---|---|---|
| `executions` | yes | `execution.*`, `run.failed`, `run.cancelled` | `<executionId>` entries + `run:<runId>` identity markers (filter markers out with `isMarkerKey`) |

World state intentionally uses shared thread state (not a projection) so writers get
idempotency + `expectedVersion`.

## Callers / authority

- Tenant `local`; actors: `human` (kind `user`, cockpit + bridge), `webmcp` (kind `agent`,
  browser WebMCP tools), `system` (kind `system`, observers/attach).
- Kernel policy: default-deny; allow `process.exec`, `filesystem.*`, `world.snapshot` to these
  actors. ActionPolicy: allow `run.start`, `thread.state.read/update`,
  `remote.offer.publish/list/revoke`, `continuation.resume/cancel` for these callers.
- Correlation: `sessionId` threads a session's runs; `runId` is the execution identity; the
  bridge passes `correlationId: session:<sessionId>` so one terminal session is one causal chain.

## Surfaces → same path

| surface | entry | lands on |
|---|---|---|
| cockpit run button | `client.startRun("agent.execute", …)` | J2 |
| WebMCP tool `execute` | same client call, `source:"webmcp"` | J2-W |
| human typing | shell markers → bridge → `startRun("agent.observe", …)` | J1 |
| cockpit reads | `readSharedState` / `readProjection` / `events({follow})` | J3/J5 |

## Test traceability

Journey tests: `test/journeys/journey-j<N>-<slug>.test.ts` per catalog id; conformance tests for
the PTY substrate; architecture tests for: no duplicated Cognate abstractions, bindings explicit,
WebMCP adapter is the only projection path, mechanism layer imports no `@cognate/*`.

## Validation record

See `validation/` for exact DomainForge commands and outputs; re-run after any `.sea` edit and
update the digest above.

## Phase 2.5 snapshot (observation-ingest)

```
Phase 2.5 baseline (rollback boundary):
  cognate: 1e678c6e4d64126ae0b2df186c81057984a66a1d
  gs-term: 89754b35008d0f31bd12d97b20e2b512c686c861

Phase 2.5 completion:
  cognate: fb7c250b3c164776c2585e53c810106ea9d6ad0a   (feat: add first-class observation ingestion)
  gs-term: the Phase 2.5 completion commit (this file) — refactor: use first-class Cognate observations
```

The Cognate primitive (`RuntimeService.observe`) is consumed by gs-term's bridge (reconciliation
discovered facts) and proved by `test/journeys/journey-j6-observations.test.ts` (D/E/F/G). The
distinction INTENT/action-run vs. REALITY/observation vs. inference/attribution is documented in
`docs/concepts.md` (Cognate) and the root `README.md` architecture section (gs-term).

## Phase 3 snapshot (Focus Engine / Syntelligent Search)

```
Phase 3 baseline (rollback boundary):
  gs-term: a109aa24df8f3a8641a957442112558d4dc5f796

Phase 3 completion:
  gs-term: the Phase 3 completion commit — feat: add focus engine and syntelligent search
```

Focus/attention/search semantics are modeled in `interaction-model.sea` (J7–J15), implemented across
`src/focus/` (attention, focus reducer, search planner, mechanisms) + `src/components/focus.ts`
(`focus.search`) + `src/agents/focus.ts` (`agent.focus`), and projected to the cockpit (`/` overlay +
Focus panel) and WebMCP (focus tools; human resolution excluded).

## Phase 3.5 snapshot — native semantic reduction substrate

Baseline snapshot `8d46fb9`; the modeled-but-unavailable mechanisms (D-033/D-034) are mounted:

- **gsterm-semantic** (Rust, `rust/crates/gsterm-semantic`): one managed stdio JSON-lines helper
  hosting the zvec-grep engine (git-pinned `28ef200`), a zvec concept collection (zvec-rust 0.7.2),
  and a model2vec embedder for `local/potion-code-16m-v2` (dim 256). Concept embeddings use the
  same mean-pool math as the source indexer. Scores are cosine DISTANCES (ascending = better).
- **gsterm-solidlsp** (Python, `solidlsp/`): uv-managed bridge over the `solidlsp` package from
  PyPI `serena-agent==1.7.0` — the ONLY MIT-clean distribution (upstream main relicensed the Serena
  application GPL; do not track main). Provisions typescript-language-server 5.1.3 + typescript
  5.9.3 via a node→bun shim (Bun runs the whole TS LSP chain; no Node in the runtime graph).
- **Bindings**: `code.definition` / `code.references` / `code.implementations` bound to
  `controlplane::Code Symbol`; `code.diagnostics` bound to `controlplane::Diagnostic`.
  `agent.focus` gained the `code` intent (WebMCP tools `code_references`, `code_definition`,
  `code_diagnostics` project the same capabilities; human-gated operations unchanged).
- **zvec responsibility split** unchanged: zvec-grep owns workspace source retrieval; the raw zvec
  collection stores ONLY gs-term concept objects (`src/semantic/concepts.ts`, digest-marked store
  in `<data_dir>/concepts`); explicit structural links stay authoritative — vector similarity never
  creates topology.
- **Planner routing** (`src/focus/search.ts`): known symbol → SolidLSP directly; exact identifier →
  rg (+ SolidLSP verification); natural language → concepts → structural scope → zvec-grep →
  rg snippet verification → SolidLSP; architecture/domain questions → concepts + structural scope
  and STOP; execution failures → evidence-first as before. Receipts record only stages that ran.
