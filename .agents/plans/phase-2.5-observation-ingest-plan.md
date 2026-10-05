# Phase 2.5 — first-class observation ingestion (Cognate + gs-term)

Narrow phase. Goal: validate the D-001 framework gap rigorously via the `building-with-cognate`
method, and only if confirmed, implement the smallest general Cognate observation primitive and
migrate gs-term's genuine observation paths onto it. Not the Focus Engine phase.

## Baseline snapshots (rollback boundary)

- cognate: `1e678c6e4d64126ae0b2df186c81057984a66a1d`
- gs-term: `89754b35008d0f31bd12d97b20e2b512c686c861`

## Framework-gap validation (building-with-cognate) — CONFIRMED

Existing primitives considered, none is an inbound observation-ingest door:

| primitive | what it is | why it is not the door |
|---|---|---|
| `RunContext.emit` | event door **during a run** | run-bound; action-shaped; fabricates intent for a noticed fact |
| `RuntimeService.startRun` | creates a run (intent) | would fabricate "I requested this" |
| `RuntimeService.updateState/updateSharedState` | appends `state.changed` `metadata.source:"caller"` | caller **mutation** provenance; an observation disguised as an edit |
| RealityTrace `Observation` (`realitytrace`, proto `ObservationReceipt`) | **outbound** evidence-delivery: committed event → external SXR | requires an existing `eventId`; `observationId` derived from source event; direction is event-log → external, not reality → log; "a receipt is not evidence or settlement" |
| `NewEvent` / `DurableStore.commit` | durable envelope | already supports `runId:null`,`causationId:null` — but it is a low-level store port, not an authorized semantic door (bypasses governor/idempotency/run semantics) |
| `cognitive-api` `SourceType:"observation"` | cognition already types observation as a knowledge **source** | conceptual precedent only; indexing, not ingest |
| kernel `observe(listener)` | outbound subscription | observe-listener, not ingestion |

**Why the gap is general** (not gs-term-local): any Cognate app with an external reality source
(sensor, webhook, fs watcher, SSH connection, reconciliation poller) faces exactly this. The
durable envelope already supports truthful run-less facts; the evidence layer already has an
`Observation` concept; cognition already types "observation" — but the **ingest door** is missing.

**Semantic distinction preserved:** action/intent (`run.*`, `execution.*` with `runId` set) vs
observation (`observation.recorded` with `runId:null`) vs inference/attribution (payload
`attribution: {kind, confidence}`, `causationId` cited only when `kind:"caused"`).

## The primitive (smallest general)

`RuntimeService.observe(caller, input): Promise<ObservationView>` — appends one run-less
`observation.recorded` event reusing the existing envelope/governor/idempotency/projections and
feeding RealityTrace's existing `Observation` evidence adapter. NOT a new subsystem.

- New action `observation.record` (ActionPolicy union) — authority checked like every service call.
- New stream helper `observationStream(tenant, worldId, resource)` — world-scoped identity at the
  stream level (local:/foo and ssh-test:/foo are distinct).
- `observationId` derived deterministically from the idempotency scope+key (stable on replay);
  `eventId` caller-chosen for deterministic replay.
- `runId: null`; `causationId = attribution.causationEventId ?? null` (**unknown causation stays
  null — never invented**); `metadata.source:"observation"` (vs `updateSharedState` `"caller"`).
- `emit` reserves the `observation.` prefix (can't smuggle a fabricated observation through the
  action door).

Scope boundary: `observe` is an **in-process** door in v0 (mechanism/observer privilege). The public
Connect surface does not expose it; `createRemoteRuntimeService.observe` throws `unimplemented`
(deliberate — observation ingest is not a remote-caller capability). Documented, not hidden.

## Files

**Cognate:** `runtime-api/src/types.ts` (ObservationSubject/Attribution/Input/View + `observe`);
`runtime-bun/src/index.ts` (ActionPolicy `observation.record`); `runtime-bun/src/fold.ts`
(`observationStream`); `runtime-bun/src/service.ts` (`observe` impl); `runtime-bun/src/executor.ts`
(reserve `observation.` in emit); `protocol-connect/src/index.ts` (remote `observe` → unimplemented);
`runtime-bun/test/observation.test.ts` (focused framework tests); concise docs.

**gs-term:** `src/semantic/contracts.ts` (ObservationRecord); `src/bridge/observations.ts` (real
door + builders: `recordObservation`, `effectToObservation`, `factToObservation`); `src/bridge/
observation.ts` (J3 reconciliation discovered facts → observations; follower execution effects →
correlated observations); `src/app/policy.ts` (grant `observation.record`); proof tests.

## Acceptance proofs (gs-term)

- **D pure foreign fact**: a fact outside any Cognate action enters via `observe`, provenance
  "observation", `runId:null`, no fabricated run, no false causation.
- **E correlated**: an execution's discovered effect recorded as an observation retaining
  correlation + cited causation, while remaining `runId:null` (distinct from the intent/run).
- **F unknown causation**: `observed:true, causedBy:unknown` — a fact observed (correlated to a
  session) whose cause is unknown: `causationId:null`, `attribution.confidence:"unknown"`.
- **G world identity**: same-named resource in local vs ssh-test stays two distinct observations.
- **Regression**: all Phase-1/2 tests stay green (J1/J2/J2-W/J3/J5, worlds, webmcp, conformance).

## Deferred / not this phase

D-002 per-world policy, D-031 kill parity, multi-session, search/Focus Engine, Oxlint, SolidLSP,
zvec/Graft, browser previews, checkpoints, branching. Interaction noted only.
