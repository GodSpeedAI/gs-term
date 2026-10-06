# Workflow: human command observation (J1)

## Summary

A person types a command into a real terminal. Shell integration reports when it started and
finished; the observation bridge captures a world snapshot before and after; the `agent.observe`
agent diffs them and emits the same execution event vocabulary a structured run would. The PTY byte
stream is never parsed into output, so stdout is honestly `unknown`.

## Sequence

1. The browser sends keystrokes over `/ws`; the server writes them to the PTY.
2. bash runs the command. Its `DEBUG` trap fires first: `src/shell/bash-init.sh` emits marker `A`
   with `{command, cwd, startedAtMs}`.
3. `TerminalSession.handleData` parses the marker, strips it, and hands it to the bridge.
4. The bridge sees `A`, records the command, and — if no pre-snapshot is in flight — starts one.
5. The command runs. Output flows to viewers as clean bytes.
6. bash's prompt hook fires after the command: marker `D` with `{exitCode, cwd, endedAtMs}`.
7. The bridge sets `lastCwd = marker.cwd` (so a `cd` builtin is captured), **rotates the pre-snapshot
   synchronously**, and enqueues `recordObservation`.
8. `recordObservation` awaits the pre-snapshot and starts an `agent.observe` run with
   `idempotencyKey: observe:<sessionId>:<observationId>` and
   `correlationId: session:<sessionId>`.
9. The agent emits `execution.started` (execution id = observation id, `source: "pty"`,
   `surface: "terminal"`, world = session world).
10. The agent invokes `world.snapshot` for the post state.
11. `deriveEffects(pre, post)` runs; the agent emits `effect.observed`.
12. The agent emits `execution.completed` with `exitCode`, `endedAt`, `durationMs`,
    `output: "unknown"`, `effectsCount`, `settled: "observed"`.
13. The run completes. The bridge's follower sees `run.completed` for the session correlation.
14. The bridge reconciles world state and records newly discovered facts.

## Detailed path

| Step | Symbols |
| --- | --- |
| keystrokes | `src/server/index.ts:192` WS `message` → `session.write` |
| marker production | `src/shell/bash-init.sh` (`DEBUG` trap, `PROMPT_COMMAND`) |
| parsing | `src/shell/markers.ts:73` `MarkerParser.push` |
| dispatch | `src/terminal/session.ts:82` `handleData` → marker listeners |
| bridging | `src/bridge/observation.ts:55` `handleMarker` |
| run start | `src/bridge/observation.ts:125` `recordObservation` |
| agent | `src/agents/observe.ts:37` `observeAgent` |
| effects | `src/semantic/effects.ts:82` `deriveEffects` |
| reconcile | `src/bridge/observation.ts:93` `followRuns` → `:148` `reconcileWorld` |

## State changes

| When | Change |
| --- | --- |
| marker `A` | bridge holds a pending command and an in-flight pre-snapshot |
| marker `D` | `lastCwd` updated; the next pre-snapshot is in flight; a run is started |
| run start | `run.completed` eventually lands in the event log |
| `execution.started` | projection row appears with `status: started`, `source: pty` |
| `effect.observed` | the row's `effects` and `effectsCount` fill in |
| `execution.completed` | `status: settled`, `exitCode`, `durationMs` recorded |
| reconcile | shared state `session:<id>` gains the new cwd, repository/processes/ports, and `lastExecution` |
| discovered facts | run-less observations for new ports / a newly dirty tree |

## Failure branches

| Branch | Behaviour |
| --- | --- |
| A command runs with no `A` marker | `D` still rotates the snapshot; no observation is recorded |
| Markers lost (abnormal PTY death) | the command never settles — nothing is invented (debt D-018) |
| `world.snapshot` fails or is malformed | `execution.failed` is emitted and the run fails |
| Compound line (`a && b`) | bash's `DEBUG` trap records the first simple command (debt D-014) |
| Run aborted mid-flight | `ctx.emit` is blocked by design; `run.cancelled` is the record; the projection maps it via the marker key |
| Unknown world for the session | `WorldUnavailableError`; the run fails |
| The pre-snapshot cannot be read | `recordObservation` rejects; the bridge chain reports `bridge-chain` and continues |

## Sequence diagram

```mermaid
sequenceDiagram
  participant H as Human
  participant X as xterm.js / WS
  participant T as TerminalSession
  participant B as Bridge
  participant A as agent.observe
  participant O as Observers
  participant L as Event log
  participant S as Shared state

  H->>X: type "touch notes.txt"
  X->>T: bytes
  T->>T: bash + DEBUG trap
  T-->>B: marker A {command, cwd, startedAtMs}
  B->>O: world.snapshot (pre)
  T->>T: command runs
  T-->>B: marker D {exitCode, cwd, endedAtMs}
  B->>B: lastCwd = cwd; rotate pre-snapshot
  B->>A: startRun(agent.observe, preSnapshot)
  A->>L: execution.started
  A->>O: world.snapshot (post)
  O-->>A: WorldSnapshot
  A->>A: deriveEffects(pre, post)
  A->>L: effect.observed [file.created + evidence]
  A->>L: execution.completed (output: "unknown", settled: "observed")
  A-->>B: run.completed (correlation session:<id>)
  B->>O: world.snapshot (reconcile)
  B->>S: updateSharedState(expectedVersion)
  B->>L: observe() for newly discovered facts
```

## Source trail

- `src/shell/bash-init.sh`, `src/shell/markers.ts` — markers
- `src/terminal/session.ts:82` — `handleData`
- `src/bridge/observation.ts:55` — `handleMarker`; `:125` `recordObservation`
- `src/agents/observe.ts:37` — `observeAgent`
- `src/semantic/effects.ts:82` — `deriveEffects`
- `test/conformance/shell-markers.test.ts` — marker parser contract
- `test/conformance/pty.test.ts` — exit codes observed, markers never leak
- `test/journeys/journey-j1-human-command-observation.test.ts` — the end-to-end journey
- `e2e/acceptance.spec.ts` — acceptance A/B/D in a real browser
- `.sea/interaction/canonical-journey-catalog.md` — the J1 journey definition