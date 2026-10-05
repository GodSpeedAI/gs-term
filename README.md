# gs-term

A browser-native **semantic terminal / control plane** built on [Cognate](../cognate). The terminal
is not the primary abstraction — it is one compatibility surface over a computational world
modeled semantically:

```
state → affordances → action → effects → evidence → new state
```

Humans type into a real PTY (`xterm → WS → Bun.Terminal → bash`); machines run structured
executions through Cognate capabilities (`WebMCP / cockpit → client → agent run → process.exec`).
Both doors produce the **same semantic execution kind** with the same event vocabulary, the same
projection, and the same world state. `source` (`pty` | `ui` | `webmcp`) is metadata, never a
separate ontology.

The canonical semantic source is the interaction domain model in
[`.sea/interaction/`](.sea/interaction/README.md) (validated `.sea` + journey catalog J1–J5).
The tranche plan lives in [`.agents/plans/vertical-slice-plan.md`](.agents/plans/vertical-slice-plan.md).

## Run

```bash
bun install
bun run dev        # http://127.0.0.1:7317 — cockpit + PTY + WebMCP tools + Cognate runtime
```

Configuration is `gsterm.toml` + env overrides (`GSTERM_ROOT`, `GSTERM_PORT`, `GSTERM_HOSTNAME`,
`GSTERM_STORE`). The workspace root is the containment boundary for structured execution and the
observation scope; durable state lives in `.cognate/app.sqlite` (git-ignored).

## Validate

```bash
bun run typecheck   # tsc --noEmit
bun run test        # unit + journey + conformance + architecture (38 tests)
bun run e2e         # Playwright acceptance sequence A–G (chromium)
bun run verify      # all three
```

Journey tests are named after the catalog ids (`test/journeys/journey-j<N>-…`). The E2E suite
drives the real browser, real server, real PTY: typed commands settle with effects + evidence,
structured and WebMCP executions converge on the same read model, git/ports are observed in the
world view, and reload/restart preserve durable history.

## Architecture (as implemented)

```
┌ surfaces ────────────────────────────────────────────────────────────┐
│ xterm.js ⇄ WebSocket ⇄ PTY session       cockpit ⇄ Connect ⇄ client  │
│ (human, J1/J4)                           WebMCP ⇄ document.modelContext │
└───────┬──────────────────────────────────────────────┬───────────────┘
        │ shell-integration markers (OSC 7311)          │ agent.execute / read models
┌───────▼──────────────────────────────────┐  ┌────────▼─────────────────────────┐
│ mechanism (no @cognate imports)          │  │ semantic (Cognate)               │
│ terminal/, shell/, observers/            │→ │ bridge/ → agent runs → events    │
│ Bun.Terminal, bash DEBUG/PROMPT hooks,   │  │ projections, shared world state  │
│ fs walk, git CLI, /proc, ss              │  │ execution worlds (process.exec)  │
└──────────────────────────────────────────┘  └──────────────────────────────────┘
```

- **One event door.** Cognate has no external event-append API; every semantic record is an
  agent run (`agent.execute`, `agent.observe`). The bridge (the only module that knows both
  layers) turns shell observations into runs via `startRun`.
- **Structured execution = `@cognate/execution`** — `process.exec` + `filesystem.*` over an
  `ExecutionWorldProvider` registry (local world now; ssh/wsl providers are drop-in later).
- **World state = Cognate shared thread state** (`session:<id>`), written by the bridge at
  settlement with `expectedVersion` + idempotency; unknown ≠ false everywhere.
- **Derived read model** = public projection `executions` (tenant-partitioned keys, versioned
  checkpoint, rebuildable from the log). Timeline = `events({follow:true})`.
- **Evidence discipline**: effects carry `{what, how, confidence, refs}` from recorded
  pre/post snapshots; PTY-observed output is `unknown`, never reconstructed.
- **WebMCP is a projection**: `src/webmcp/project.ts` registers capability descriptors as
  `document.modelContext` tools whose `execute` runs the same client path as the cockpit
  buttons. The inverse seam (external tools → Cognate `RemoteCapabilityOffer`) is typed and
  test-covered but deliberately not built (D2).

## Decisions worth preserving

1. **`setsid` around the shell.** `Bun.spawn({terminal})` (Bun 1.4.0) does not session-lead the
   child; bash then reports "no job control" and Ctrl-C never reaches its processes. Spawning
   `setsid bash --init-file …` fixes job control, interrupt, and the process-group warnings.
2. **WebMCP input is JSON text.** The Chromium-matching surface (`@mcp-b/webmcp-polyfill` v5,
   `initializeWebMCPPolyfill`) takes `executeTool(tool, inputArgsJson: string)` and returns a
   JSON string — verified against the installed dist, not the docs (which describe a newer API).
3. **Shell markers, not prompt scraping.** Bash preexec (DEBUG trap) + precmd
   (`PROMPT_COMMAND`) emit OSC 7311 markers parsed and stripped server-side; environment-inherited
   prompt hooks from parent IDEs are discarded at init so they cannot masquerade as commands.
4. **Tenant-partitioned projection keys** (`<tenant>/<executionId>` + `run:<runId>` markers) —
   required by the runtime's public-projection read filter.
5. **Bounded, memory-only scrollback** (ring buffer, replayed on attach). Raw PTY bytes never
   touch durable storage or the event log.

## Current limitations (honest)

- Bash-only shell integration (the adapter interface is ready for other shells).
- One durable PTY session per server (`session.id = main`); multi-session is the next seam.
- PTY-observed executions do not capture stdout/stderr (`output: "unknown"`).
- Compound shell lines record their first simple command (bash DEBUG-trap semantics).
- Observers are settlement-time snapshots (fs/git/proc/ss), not continuous watchers;
  between-settlement external changes surface at the next observation.
- Effect diffs are scoped to workspace files (excluding `.git`, `node_modules`, `.cognate`),
  session-tree processes, and session-attributed ports; other effects are unobserved, not false.
- The dev-token authenticator is a development boundary, not production auth.

## Deliberate next seams (not built)

- Execution worlds: ssh/wsl/browser providers behind the same `process.exec` (registry-ready).
- WebMCP capability *consumption* via `RemoteCapabilityOffer` (interface + tests only).
- Checkpoints / world branching (events + folds make it possible; nothing blocks it).
- Additional shell adapters, multiple sessions, approval continuations.

## Donor-derived notes

Recon used shallow clones under `.tmp/donors/` (removed after extraction):
`WebMCP-org/npm-packages` (current WebMCP API + polyfill package), `compoundingtech/pty`
(session/detach model, conformance-suite testing philosophy), `xtermjs/xterm.js` (addon
surface), `ripulio/web-mcp` (stale-API counterexample), `kilian-ai/linuxontab` and
`cloudflare/sandbox-sdk` (provider-boundary shape only).

