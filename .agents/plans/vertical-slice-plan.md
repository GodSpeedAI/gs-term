# gs-term vertical slice — tranche plan

Method: `building-with-cognate` (model first → bindings → capabilities → journeys → evidence).
Evidence source: `.agents/prompts/start.md` + `AGENTS.md`. Canonical interaction model lives in
`.sea/interaction/` (see the deliverables there). This plan decomposes that model into tranches;
each tranche is a vertical slice covering one or more canonical journeys end to end (model, agent
and capabilities, surface, test), ordered by dependency and risk.

## Reconciliation with the task's development stages

The prompt's stages 1–7 map onto tranches T2–T7 below; T0/T1 (model + scaffold) are the skill's
mandatory first steps and run before stage 1.

## Tranches

### T0 — Interaction domain model (before any code)
- Derive the IDM from the prompt evidence into `.sea/interaction/`: `interaction-model.sea`,
  `canonical-journey-catalog.md`, `source-translation-map.md`, `assumptions-and-unknowns.md`,
  `handoff.md`, `README.md`, `validation/`.
- Validate with the installed DomainForge CLI; inspect the projection.
- Canonical journeys (ids named here are the test-name source):
  - **J1 `human-command-observation`** — human types into PTY; shell integration observes
    boundaries; observed execution settles with effects + evidence; world reconciled.
  - **J2 `structured-execution`** — machine (UI / WebMCP variant) starts a structured execution
    run through Cognate capability `process.exec` over an execution world; settles with effects +
    evidence. (WebMCP is a *specialization* of J2: actor = WebMCP consumer, surface =
    `document.modelContext`.)
  - **J3 `world-state-reconciliation`** — on execution settlement or attach, observers snapshot
    filesystem/git/processes/ports and update shared world state honestly (observed vs unknown).
  - **J4 `terminal-session-attach`** — operator attaches/reconnects to the live PTY session;
    bounded scrollback replay, world continuity, resize.
  - **J5 `cockpit-inspection`** — operator inspects world state, execution history, event
    timeline through cockpit projections (read-only).
- Deferred seams (catalogued, NOT implemented): execution-world migration (ssh/wsl/browser),
  WebMCP capability *consumption* (remote offers), checkpoints, branching, collaboration.

### T1 — Scaffold + runtime composition
- `cognate create` (profile: copilot — chosen for its `client`/`protocol-connect*` closure needed
  by the cockpit browser side; the copilot agent/UI itself is not used), vendored `@cognate/*`
  `file:` deps under `.cognate/vendor/`. Add + vendor `@cognate/execution` (not in the profile
  closure).

### T2 — Structured execution journey (prompt stage 2, risk: capability wiring)
- Execution world registry + `localExecutionWorld` (workspace-root containment) +
  `executionWorldsComponent`.
- Agent `agent.execute`: `execution.started` → pre-snapshot (`world.snapshot`) →
  `process.exec` → post-snapshot → derive effects → `execution.completed` + `effect.observed`.
- Public projection `executions` folds the events into a read model.
- Journey test **J2** with a real `touch` against a temp workspace: events, output, effects,
  evidence, projection — observable settlement, not just completion.

### T3 — PTY substrate (prompt stage 1, risk: transport)
- `Bun.Terminal` + `Bun.spawn(["bash", ...])`; bounded in-memory scrollback ring (no raw PTY bytes
  in the event log); WebSocket `/ws` protocol: text frames = JSON control
  (`attach/resize/session/exit/ping`), binary frames = byte stream (bidirectional).
- Terminal manager: one durable session, attach/detach, multiple viewers, resize,
  deterministic cleanup on server shutdown (PTY closed, sockets closed).
- Bash shell adapter: `--init-file` injection, DEBUG-trap preexec + PROMPT_COMMAND precmd emitting
  typed marker sequences (command start with text+cwd, command exit with code+cwd) — deterministic
  observation, no prompt-text scraping. Marker parser unit-tested from recorded byte streams.
- Journey test **J4**: real PTY — echo/observe output, resize (`stty size`), non-zero exit codes,
  disconnect/reconnect replays bounded scrollback.

### T4 — Human observation journey (prompt stage 3+4, risk: convergence)
- Shell observer bridge (mechanism→semantic adapter): on command start capture pre-snapshot; on
  exit call `startRun("agent.observe")` with `{command, cwd, exitCode, preSnapshot, source:"pty"}`.
- Agent `agent.observe` emits the *same* event types as `agent.execute`
  (`execution.started/completed`, `effect.observed`) — source is metadata, one ontology.
- Observers (plain functions behind the `world.snapshot` capability): filesystem walk, git status,
  process tree of the session, listening ports (`ss`) — each with provenance; unknown ≠ false.
- World shared state thread `world:<session>`: cwd, repository{status: observed|no-repo|unknown},
  processes, ports, last execution — written via `updateSharedState` at settlement (J3).
- Journey tests **J1** (typed `touch` via simulated shell markers → real run → effects+evidence)
  and **J3** (world state honesty + git repo detection).

### T5 — WebMCP projection (prompt stage 5, risk: current-standard drift)
- `src/webmcp/`: capability descriptor registry → `document.modelContext.registerTool` adapter
  (polyfill `@mcp-b/webmcp-polyfill` `installWebMCP()`; standard API only —
  `registerTool/getTools/executeTool`, `{content:[{type:"text",text}]}` results). Tool `execute`
  calls the *same* client path as the UI (`startRun("agent.execute", …)`) — projection, not a
  second implementation.
- Consumption boundary: type-level seam + architecture test mapping external WebMCP capabilities
  onto Cognate `RemoteCapabilityOffer` (`publishRemoteOffer`/`listRemoteOffers`) — no tab control.
- Test: J2-WebMCP specialization — register → discover → invoke → same semantic execution shape.

### T6 — Cockpit (prompt stage 6)
- React cockpit (bundled by `Bun.build`, no CSS framework): terminal panel (xterm.js + fit),
  world panel (shared state), execution inspector (selected execution: run, events, effects,
  evidence), event timeline (Connect `events({follow:true})`, semantic events only), status bar
  (connection, session, world). Operational cockpit, dark and dense — not dashboard chrome.
- Journey test **J5**: cockpit reads projections/state that match durable runs.

### T7 — Hardening, acceptance, cleanup (prompt stage 7)
- Reconnect/resize/interrupt (Ctrl-C through PTY), idempotency, authority check (policy denies
  unauthorized `process.exec`), redaction check (no env/secret persistence), cleanup audit
  (PTYs/processes/sockets/watchers), bounded retention audit (scrollback ring; event log is
  append-only truth), restart durability (`.cognate/app.sqlite` + projection checkpoint rebuild).
- Playwright E2E (chromium cached): boot → type in terminal → human execution settles; UI/WebMCP
  structured execution settles; world reflects git repo/branch/dirty; port discovery; reconnect;
  WebMCP tool registered + invocable in-page.
- Full acceptance sequence A–G, validation suite, docs (`README.md` architecture/status),
  donor cleanup (`.tmp/donors/*` deleted, `.tmp/` kept), final `git diff` review, commit.

## Key architecture decisions (recorded for later agents)

1. **One semantic world, two doors.** Human commands and machine commands converge on the same
   event types, projection, and shared state. `source` (`pty`|`ui`|`webmcp`) is metadata.
2. **Events only via agent runs.** Cognate has no external event-append API; every semantic
   execution record is an agent run (`agent.execute` / `agent.observe`). Observers bridge
   mechanism → semantic through `startRun`, never by writing the log directly.
3. **World state = shared thread state** (`updateSharedState`/`readSharedState`), durable,
   versioned, caller-authorized; the `executions` projection = derived read model; the event
   stream (`events({follow:true})`) = timeline. Restart-safe by construction.
4. **Structured execution = Cognate's `@cognate/execution` package** (`process.exec` +
   `filesystem.*` over an `ExecutionWorldProvider` registry). No local reimplementation; ssh/wsl
   providers drop in later without semantic change.
5. **Mechanism stays Cognate-free.** `src/terminal`, `src/shell`, `src/observers` are plain Bun/
   OS code; only `src/app` (composition) talks to Cognate. PTY bytes never touch the event log.
6. **Evidence discipline.** Every effect carries `{what, how, confidence, refs}`; pre/post snapshots
   are recorded steps; unknown observations are represented as `unknown`, never as `false`.

## Commands (kept current as tranches land)

- `bun install` — deps
- `bun run dev` — boot server (runtime + WS + cockpit)
- `bun test` — unit + journey tests
- `bun run typecheck` — tsc --noEmit
- `bun run e2e` — Playwright acceptance


- Hand-composed `createRuntime` (documented alternative to profiles): SQLite store
  `.cognate/app.sqlite`, kernel policy (capability allow-list), `ActionPolicy`
  (`run.start`, `thread.state.read/update`, `remote.offer.*` as needed),
  our agents/components/projections, governance `off`.
- `loadSemanticProjection` on the canonical `.sea` + explicit `bindCapabilities` traceability
  (`gsterm::Execution` → `process.exec`, `gsterm::Evidence` → `world.snapshot`).
- Acceptance seam: `bun run dev` boots `/health` and the runtime; `bun test` green.
