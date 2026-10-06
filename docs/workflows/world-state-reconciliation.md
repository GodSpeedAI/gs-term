# Workflow: world state reconciliation (J3) and discovered facts (J6)

## Summary

The world view — cwd, repository state, session processes, listening ports, the last settled
execution — is re-derived from observed facts whenever a command settles or a viewer attaches. It is
written as versioned shared state with optimistic concurrency, so readers see coherent snapshots and
a restart preserves the view. Facts discovered *outside* any execution enter the log as run-less
observations, never as fabricated actions.

## Triggers

| Trigger | Source |
| --- | --- |
| `boot` | `startServer` after `session.start()` |
| `attach` | every WebSocket open |
| `run.completed` / `run.failed` / `run.cancelled` | the bridge's durable-run follower, filtered to `session:<id>` |

An explicit refresh is the same journey with a different trigger.

## Sequence

1. The trigger enqueues `reconcileWorld` on the bridge's serialised chain.
2. A fresh `world.snapshot` is invoked for the session world.
3. `readSharedState(threadId = "session:<sessionId>")` reads the current version and state.
4. `buildWorldState` composes the view:
   - `cwd`: `lastCwd` from shell markers → the previous state's cwd → the configured root;
   - `terminal`: live `alive`, `cols`, `rows`, `pid` from the session;
   - `repository`, `processes`, `ports`: from the snapshot;
   - `lastExecution`: from the triggering run's output when this was an `agent.observe` completion,
     otherwise the previous value.
5. `updateSharedState` with `expectedVersion` and a unique idempotency key. On a version conflict:
   re-read and retry, up to five attempts. Any other error is reported and the attempt stops.
6. `recordDiscoveredFacts` compares the new view against the previous one and records new facts as
   observations:
   - a listening port not present before → `port.available`
   - a repository that went clean → dirty → `git.dirty`
7. Each fact carries `attribution: {kind: "correlated", correlationId: "session:<id>",
   confidence: "observed"}` and a stable idempotency key. The **cause stays null**.

## Effect → observation fan-out (J6, Phase 2.5 increment)

`recordEffectObservations` runs over the derived effects of a settled execution and promotes the
focus-relevant kinds into the observation log so they can serve as Focus evidence:

- Included: `file.created`, `file.modified`, `file.deleted`, `port.opened`, `port.closed`,
  `git.dirty`, `git.clean`, `process.started`, `process.stopped`.
- Excluded: `none` and noise — low-value effects are not fanned out for completeness.
- Attribution is `caused` when a cause event id is supplied, `correlated` otherwise.
- Idempotency key: `effect:<executionId>:<kind>:<worldId>:<target>:<index>`.
- A failed record is skipped, never retried into a second fact.

## Detailed path

| Step | Symbols |
| --- | --- |
| triggers | `src/bridge/observation.ts:81` `reconcile`, `:93` `followRuns`, `src/server/index.ts:190` attach |
| snapshot | `src/bridge/observation.ts:115` `snapshot()` → `world.snapshot` |
| compose | `src/observers/snapshot.ts:42` `buildWorldState` |
| write | `src/bridge/observation.ts:227` `writeWorldState` |
| discovered facts | `src/bridge/observation.ts:182` `recordDiscoveredFacts` |
| fan-out | `src/bridge/observations.ts:23` `recordEffectObservations` |
| builders | `src/semantic/observations.ts` `factToObservation`, `effectToObservation` |

## State changes

| When | Change |
| --- | --- |
| successful write | `session:<id>` version advances; readers get `state.changed` |
| version conflict | nothing is written; a re-read precedes the retry |
| new port / newly dirty tree | a run-less observation is recorded, attributed but causally unknown |
| fan-out | one observation per focus-relevant effect, correlated (or caused) to the run |

## Honesty rules visible here

- An unobserved scope stays `unknown` with its reason; the previous observed value is retained
  rather than flipped to false.
- A port is only ever claimed when it could be attributed to the session's process tree.
- A working tree is `observed` / `no-repo` / `unknown` — never collapsed.
- A fact noticed during reconciliation has no cause. Inventing one would fabricate intent.
- Facts are world-scoped: the same path in two worlds produces two observations.

## Failure branches

| Branch | Behaviour |
| --- | --- |
| `world.snapshot` throws (unknown/disposed world) | `bridge-chain` error; no state written |
| Sustained version conflict | five attempts, then a reported error; the next trigger retries |
| Observation rejected | reported through `record-fact`; reconciliation continues |
| `followRuns` stream breaks | reported; reconciliation still happens on boot and attach |
| Process scope unknown | ports become unknown; effect diffing skips those scopes rather than claiming no change |

## Sequence diagram

```mermaid
sequenceDiagram
  participant T as Trigger (boot/attach/run.completed)
  participant B as Bridge
  participant W as world.snapshot
  participant TH as Shared state session:&lt;id&gt;
  participant O as Observations

  T->>B: reconcile(trigger) / follower event
  B->>W: snapshot(sessionWorldId)
  W-->>B: WorldSnapshot
  B->>TH: readSharedState(threadId)
  TH-->>B: {state, version}
  B->>B: buildWorldState(...)
  loop up to 5 attempts
    B->>TH: updateSharedState(expectedVersion, idempotencyKey)
    alt version conflict
      TH-->>B: conflict
      B->>TH: readSharedState again
    else accepted
      TH-->>B: new version
    end
  end
  B->>B: compare previous vs new (ports, repository.dirty)
  B->>O: observe(port.available | git.dirty)
  O-->>B: ObservationView
```

## Source trail

- `src/bridge/observation.ts` — `reconcile`, `followRuns`, `reconcileWorld`,
  `recordDiscoveredFacts`, `writeWorldState`, `threadId`
- `src/bridge/observations.ts` — `recordEffectObservations`
- `src/observers/snapshot.ts` — `takeWorldSnapshot`, `buildWorldState`
- `src/semantic/contracts.ts:234` — `WorldStateView`
- `test/journeys/journey-j3-world-state-reconciliation.test.ts` — repository, ports, honesty, `cd`
- `test/journeys/journey-j6-observations.test.ts` — facts without runs, cited causation, identity