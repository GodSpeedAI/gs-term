# Workflows: attach, inspection and durability (J4, J5)

## Summary

Two smaller but load-bearing workflows. **J4** keeps the terminal alive across viewer disconnects
and re-derives the world view on every attach. **J5** makes the semantic record inspectable: what
ran, where, with what output, effects and evidence — from durable, rebuildable state that survives a
restart.

---

## J4 — terminal session attach

### Sequence

1. The cockpit opens `/ws`; the server upgrades and attaches `{session, bridge}` to the socket.
2. On `open`, a `session` control frame is sent: id, cols, rows, alive flag, exit code.
3. `session.attach({output, exit})` is called. It registers listeners and **replays the bounded
   scrollback** to this viewer first.
4. Live bytes are broadcast as binary frames; the control frame remains JSON.
5. `bridge.reconcile("attach")` runs — the world view is re-derived from observed facts rather than
   trusted from a previous view.
6. A resize is a JSON control frame → `session.resize` → `Bun.Terminal.resize`. The UI verifies the
   result with `stty size`.
7. On disconnect, the socket's `detach` runs. The session does **not** end: it belongs to the server.
8. Reconnecting replays scrollback again, then resumes live bytes.

### Invariants

- Marker bytes never reach a viewer. The parser strips them before broadcast.
- Viewer count does not affect shell integration: markers flow regardless of attach state.
- On shell exit, viewers receive an `exit` control frame and the session is marked dead. There is no
  respawn and no fake shell.

### Failure branches

| Branch | Behaviour |
| --- | --- |
| WebSocket drop | the session survives; scrollback is bounded so nothing unbounded is retained |
| PTY exit | explicit `exit` frame; terminal state visible |
| Server shutdown | PTY and sockets closed deterministically (`SIGTERM` → `SIGKILL` after 2 s) |
| Invalid resize values | ignored (must be integers within bounds) |

### Source trail

`src/server/index.ts:172` `websocketHandlers`, `src/terminal/session.ts:115` `attach`,
`test/conformance/pty.test.ts`, `test/journeys/journey-j1-…` (markers never leak),
`e2e/acceptance.spec.ts` acceptance G.

---

## J5 — cockpit inspection

### What the cockpit reads

| Surface | Source | Shown as |
| --- | --- | --- |
| Execution rows | `client.projection("executions")` | command, source badge, world, status, duration |
| Execution detail | the same row | argv, cwd, actor, exit code, effects, evidence lines, output |
| World panel | `client.threadSharedState("session:<id>")` | cwd, repository, processes, ports, last execution |
| Timeline | `client.events({follow: true})` | live event feed, capped at 2 000 events client-side |

Raw projection rows are filtered through `isMarkerKey` so `run:` marker keys never render as
executions.

### The inspector

The inspector is the payoff of the whole design: for one execution it shows the effects and, per
effect, the evidence line naming what was observed, how it was observed, with what confidence, and
which snapshots support it. For a PTY-observed execution the Output section reads `unknown`; for a
structured execution it shows the captured output. Both are rendered honestly.

### Durability across restart

1. The shell process is new on every boot — a PTY is not durable state.
2. The `executions` projection is folded from the durable log, so history is still there.
3. Shared thread state `session:<id>` is durable, so the world view survives.
4. `reconcile("boot")` re-derives the view from the *current* facts, so a restart shows reality, not
   a stale claim.

This is the property `facts/events → reduction → current state` exists to protect.

### Failure branches

| Branch | Behaviour |
| --- | --- |
| Projection rows absent for a run | a runtime-level failure reached only the run record; the run marker keys map it if the execution existed |
| World view shows `unknown` | an observer could not read that scope; refresh after a command settles |
| Timeline truncated | client cap; the projection remains complete |
| Output `unknown` on a PTY execution | correct; PTY bytes are never reconstructed |

### Source trail

`src/projections/executions.ts`, `src/ui/executions.tsx`, `src/ui/inspector.tsx`,
`src/ui/world.tsx`, `src/ui/timeline.tsx`,
`test/journeys/journey-j5-restart-durability.test.ts`,
`e2e/acceptance.spec.ts` acceptance B/C/E/F/G.