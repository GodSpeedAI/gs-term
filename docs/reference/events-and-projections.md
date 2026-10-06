# Event, observation and projection reference

## Event vocabulary

Runtime-native `run.*` events (`run.completed`, `run.failed`, `run.cancelled`) are the run-level
record. Agents emit the semantic events below. **Raw PTY bytes never appear in any event.**

### `execution.started`

```ts
{ executionId, source, surface, worldId, command, argv?, cwd, startedAt, actor }
```

| Field | Notes |
| --- | --- |
| `executionId` | a recorded step, or the bridge's observation id for PTY runs |
| `source` | `pty` \| `ui` \| `webmcp` — metadata only |
| `surface` | `terminal`, `cockpit`, `webmcp`, … |
| `argv` | present for structured runs; absent for PTY runs (the shell integration does not report it) |
| `actor` | the caller id (`human`, `webmcp`, `system`) |

### `effect.observed`

```ts
{ executionId, observedAt, effects: Effect[] }
```

### `execution.completed`

```ts
{ executionId, exitCode: number | null, timedOut?, endedAt, durationMs,
  output: { stdout, stderr } | "unknown", effectsCount,
  settled: "observed" | "derived" }
```

| Field | Notes |
| --- | --- |
| `output` | captured for structured runs (truncated at 64 KiB with a notice); the literal `"unknown"` for PTY runs |
| `settled` | `derived` when we diffed snapshots; `observed` when shell integration reported the boundary |

### `execution.failed`

```ts
{ executionId, failedAt, reason }
```

An explicit non-settlement: the run could not reach `execution.completed`. Emitted best-effort — an
aborted run blocks `ctx.emit` by design, and `run.cancelled` is then the record.

### Focus events

`focus.search.completed`, `focus.code.completed`, `focus.candidate.proposed`,
`focus.candidate.resolved`, `focus.pinned`.

### Shared state

`state.changed` on thread `session:<sessionId>` carries the world view.

## Effect reference

```ts
Effect { kind, worldId, target, before?, after?, evidence: Evidence[] }
```

| Kind | Derived from | Confidence |
| --- | --- | --- |
| `file.created` | a path present in post, absent in pre | `derived` |
| `file.modified` | `version` or `size` changed | `derived` |
| `file.deleted` | a path present in pre, absent in post | `derived` |
| `git.dirty` | clean → dirty | `observed` |
| `git.clean` | dirty → clean | `observed` |
| `process.started` | pid in post, not in pre | `observed` |
| `process.stopped` | pid in pre, not in post | `observed` |
| `port.opened` / `port.closed` | `protocol/port/pid` key diff | `observed` |
| `none` | no observed change in any scope | `derived` |

Process and port diffs require **both** snapshots to have observed the scope; otherwise nothing is
claimed for that scope.

## Evidence reference

```ts
Evidence { what, how, confidence: "observed" | "derived" | "unknown", refs: string[] }
```

| `how` | Used by |
| --- | --- |
| `snapshot-diff` | file effects and `none` |
| `git-status world=<id>` | git effects |
| `process-tree-diff` | process effects |
| `listening-ports-diff` | port effects |
| `reconciliation` | discovered-fact observations |
| `effect-observation` | fanned-out effect observations |

`refs` contains `<worldId>:<root>@<observedAt>` for snapshot diffs, or observation timestamps.

## Observation reference

```ts
ObservationRecord {
  kind: string,
  subject: { worldId?, resource, kind? },
  facts: unknown,
  source: { observer, provider?, method? },
  evidence?,
  attribution: ObservationAttribution,
  observedAt,
  idempotencyKey,
}
```

```ts
ObservationAttribution { kind, correlationId?, causationEventId?, confidence? }
```

`kind` is `unattributed` | `correlated` | `caused`. `causationEventId` is set **only** when
`kind === "caused"` — an unknown cause stays `null`.

### Observation kinds produced by gs-term

| Kind | Producer | Idempotency key |
| --- | --- | --- |
| `port.available` | reconciliation | `fact:port:<worldId>:<port>:<observedAt>` |
| `git.dirty` (discovered) | reconciliation | `fact:git-dirty:<worldId>:<observedAt>` |
| an effect kind (fanned out) | `recordEffectObservations` | `effect:<executionId>:<kind>:<worldId>:<target>:<index>` |

Fan-out covers `file.created`, `file.modified`, `file.deleted`, `port.opened`, `port.closed`,
`git.dirty`, `git.clean`, `process.started`, `process.stopped`. `none` and noise are excluded.

## Projection reference

### `executions` (public, version `1.0.1`)

```ts
ExecutionEntry {
  executionId, runId, correlationId,
  status: "started" | "settled" | "failed" | "cancelled",
  worldId?, source?, surface?, command?, argv?, cwd?, actor?,
  startedAt?, endedAt?, durationMs?, exitCode?, timedOut?,
  effects: Effect[], effectsCount, reason?,
}
```

Applied events:

| Event | Effect on the entry |
| --- | --- |
| `execution.started` | creates the entry, sets `status: started`, writes a `run:<runId>` marker key |
| `effect.observed` | sets `effects`, `effectsCount` |
| `execution.completed` | `status: settled` + exit code + timing |
| `execution.failed` | `status: failed` + reason |
| `run.failed` | resolves the execution via the marker, sets `status: failed` |
| `run.cancelled` | resolves the execution via the marker, sets `status: cancelled` |

**Key rules**

- Keys are tenant-partitioned: `<tenant>/<executionId>`.
- Keys prefixed `run:` are identity markers, not executions. Use `isMarkerKey(key)` (debt D-025).
- Bump `EXECUTIONS_PROJECTION_VERSION` when the key shape changes, so stale checkpoints rebuild.

## World state reference

Thread `session:<sessionId>`, payload `WorldStateView`:

```ts
{ sessionId, shell, cwd,
  terminal: { alive, cols, rows, pid },
  repository: GitObservation,
  processes: Scoped<ProcessObservation>,
  ports: Scoped<PortObservation>,
  lastExecution: { executionId, worldId, source, command, exitCode, endedAt } | null,
  observedAt }
```

Written with `expectedVersion` and an idempotency key; five retries on version conflict.

## Thread and action reference

| Thread prefix | Contents | Who may write |
| --- | --- | --- |
| `session:` | world state | any recognised actor |
| `focus:` | SharedFocus | **human only** |

Actions: `run.start`, `run.cancel`, `thread.state.read`, `thread.state.update`,
`observation.record`, `remote.offer.{publish,list,revoke,invoke}`,
`continuation.{resume,cancel}`.

## Source trail

- `src/semantic/contracts.ts:112-205` — payload and shape definitions
- `src/agents/execute.ts`, `src/agents/observe.ts` — emission sites
- `src/semantic/effects.ts` — derivation and evidence methods
- `src/bridge/observation.ts:182-225` — observation keys and attribution
- `src/bridge/observations.ts:11` — `FOCUS_RELEVANT`
- `src/projections/executions.ts` — the projection
- `.sea/interaction/handoff.md` — the event vocabulary section this reference is derived from