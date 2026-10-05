# Assumptions, unknowns, and contradictions — gs-term interaction model

## Assumptions (each checkable at runtime; overturned → fix model first)

1. **A1 — Cognate has no external event-append API.** Verified in the checkout
   (`RuntimeService` surface: runs, invoke, state, projections, events-read, remote offers).
   Consequence: every semantic record is an agent run; mechanism bridges via `startRun`.
   *If Cognate later gains an observation-ingest primitive, migrate J1's bridge to it.*
2. **A2 — Shared thread state is the right world-state fold.** `updateSharedState` is durable,
   versioned, idempotent, caller-authorized, and its `state.changed` events are visible to
   projections (projections fold all committed events). It is tenant+thread scoped — v0 uses one
   thread per session (`world:<sessionId>`).
3. **A3 — One durable PTY session per server (v0).** Multiple WebSocket viewers attach to the
   same PTY (donor `compoundingtech/pty` detach/attach insight). No session pool, no respawn.
4. **A4 — Bash-only shell adapter (v0).** Injected via `bash --init-file`; preexec via DEBUG trap,
   precmd via `PROMPT_COMMAND`; markers are custom OSC sequences parsed server-side and stripped
   before reaching the browser. Other shells are future adapters behind the same interface.
5. **A5 — Effect scope = workspace-root filesystem diff + git status + session process tree +
   listening ports of session-tree PIDs.** Network/dataset effects are out of scope; their
   absence is *unobserved*, never claimed false.
6. **A6 — Structured execution stdout/stderr are captured; PTY-observed stdout/stderr are not**
   (they belong to the terminal stream). J1 records `output: unknown` rather than inventing it.
7. **A7 — WebMCP v0 projects outbound tools only** (`document.modelContext.registerTool`), via
   `@mcp-b/webmcp-polyfill` when native support is absent. Inbound consumption (D2) is a
   type-level seam.
8. **A8 — `cognate create --profile copilot` is only used for its vendored dependency closure**;
   the copilot agent, Astryx shell, AG-UI, and model providers are not mounted. The runtime is
   hand-composed (`createRuntime`), which the Cognate docs bless as the composition alternative.
9. **A9 — Kernel policy: allow-list by capability id for the app's callers; ActionPolicy allows
   `run.start`, `thread.state.read/update`, `remote.offer.publish/list` (boundary test), and
   continuation actions used by runs.** Human PTY access needs no Cognate policy (it is the
   compatibility surface) — machine authority is *never* inferred from it
   (`gsterm::machine_authority_is_explicit`).
10. **A10 — Time:** all timing from `Bun`/ISO timestamps recorded inside agent steps (replay-safe);
    wall-clock inside mechanism only.

## Unknowns (honestly unknown; do not resolve by guessing)

1. **U1 — Whether Connect `events({follow:true})` survives arbitrary browser network conditions**
   in the wild. Mitigation: client re-syncs from last position on every reconnect; the projection
   re-read is the authority, the stream is a hint.
2. **U2 — Whether WebMCP native support exists in the test browser.** E2E runs the polyfill
   (`installWebMCP()` preserves native context if present); the standard API is identical.
3. **U3 — Port attribution fidelity.** `ss -ltnp` needs owner PIDs; v0 attributes ports to
   session-tree PIDs only; listeners owned by other users are shown unattributed (`pid: null`)
   rather than wrongly associated.
4. **U4 — Git state between settlements is unobserved.** External modifications (outside any
   observed command) appear only at the next settlement/refresh — surfaced as `observedAt` age,
   never presented as live.
5. **U5 — Shell marker loss on abnormal PTY death** leaves an unsettled command: represented by
   absence (no execution record), not by a fabricated one.

## Contradictions

- None found between the prompt and AGENTS.md (see source-translation-map.md).
- Donor `ripulio/web-mcp` documents `navigator.modelContext` — **stale**; contradicted by the
  current W3C CG draft (`document.modelContext`). Current standard wins (prompt's explicit rule).
