# Canonical journey catalog — gs-term interaction model

Source: `.sea/interaction/interaction-model.sea` (flows carry `@journey` ids matching this
catalog). Rule: **no journey is implemented unless it appears here**; tests are named after
journey ids (`journey-j<N>-<slug>.test.ts`). Evidence classes: declared (prompt states it),
observed (verified in the checked-out environment), inferred (strongest reading), proposed.

Roles used below: **Operator** = human at a surface; **Automation** = machine caller (UI action,
WebMCP tool, future agent); **Observer** = server-side mechanism watchers (fs/git/process/port).

---

## J1 — human-command-observation

- **Purpose:** A command a human types into the terminal becomes a durable semantic execution in
  the same world machine executions enter — with effects and evidence, not scraped prose.
- **Actor / role:** Operator / Terminal Operator (surface: xterm → WS → PTY → Bash).
- **Initiating condition:** operator attached to a live terminal session; a command is entered.
- **Current state:** shell running at prompt; world state reflects the previous settlement.
- **Desired state:** command executed; its execution recorded, effects derived, evidence
  attached, world state reconciled.
- **Preconditions:** session alive; shell adapter markers active (bash init file injected);
  workspace root configured; Cognate runtime mounted with `agent.observe`.
- **Steps:**
  1. shell adapter emits command-start marker (command text + cwd + startedAt) — deterministic
     preexec trap, no prompt scraping;
  2. observer bridge captures the pre-execution world snapshot (fs + git + processes + ports);
  3. shell adapter emits command-exit marker (exit code + cwd + endedAt) — precmd hook;
  4. observer bridge starts run `agent.observe` (idempotency key per observation) with the
     observed facts + pre-snapshot;
  5. agent emits `execution.started`, records post-snapshot step, derives effects by diffing
     snapshots, emits `effect.observed` + `execution.completed`;
  6. observer bridge reconciles world shared state (J3 settlement) — cwd, repository, processes,
     ports, last execution.
- **Capabilities / actions:** `world.snapshot` (evidence gathering), shared-state
  `thread.state.update`, run `run.start`.
- **Policy / authority:** human PTY authority is unrestricted *shell* access (compatibility
  surface); the semantic record path is authorized as `run.start` + `thread.state.update`.
  Machine authority is never inferred from this (`gsterm::machine_authority_is_explicit`).
- **Artifacts / resources:** Resource `Execution` (flow J1), derived `Effect`, `Evidence`.
- **Outcomes:** execution recorded with `source: "pty"`; file effects (e.g. `touch`) observed.
- **Evidence sources:** shell markers (observed), pre/post snapshots (recorded steps),
  effect provenance `{what, how, confidence, refs}`.
- **Settlement criteria:** run terminal (`completed`) AND `execution.completed` +
  `effect.observed` events committed AND world state version advanced.
- **Failure / recovery:** marker lost or session killed mid-command → an incomplete observation
  is *not* settled (unknown ≠ false); next attach re-derives world state (J3/J4). Run failure is
  visible in run status; idempotency keys prevent duplicate observations.
- **Next decisions / affordances:** inspect execution in cockpit (J5); run structured command
  instead (J2); attach/reconnect (J4).
- **Known variants:** command with non-zero exit; command changing nothing (empty effect set is
  still evidence — "no observed change"); shell-builtin like `cd` (world cwd changes, no fs
  effect).

## J2 — structured-execution

- **Purpose:** A machine performs command execution through a Cognate capability — typed input,
  argv boundaries, durable identity — producing the same semantic execution kind as J1.
- **Actor / role:** Automation / Machine Caller. Specialization **J2-W** (WebMCP): actor =
  WebMCP consumer, surface = `document.modelContext.registerTool` tool whose `execute` calls the
  same client path; `source: "webmcp"`.
- **Initiating condition:** cockpit action button or WebMCP tool call with `{argv, cwd, worldId}`.
- **Current state:** no such execution exists.
- **Desired state:** execution settled in the execution world with effects + evidence.
- **Preconditions:** kernel policy grants `process.exec` to the caller; execution world
  registered (v0: `local`, root-contained); runtime mounted with `agent.execute`.
- **Steps:**
  1. surface calls `startRun("agent.execute", input, idempotencyKey)` via the shared client;
  2. agent emits `execution.started` (executionId minted as recorded step);
  3. agent records pre-snapshot step (`world.snapshot`);
  4. agent invokes `process.exec` (Cognate execution capability over the world provider);
  5. agent records post-snapshot step; derives effects by diff;
  6. agent emits `effect.observed` then `execution.completed`; returns structured output
     `{argv, exitCode, stdout, stderr, effects, ...}`;
  7. observer bridge reconciles world shared state (J3).
- **Capabilities / actions:** `process.exec` (Cognate `@cognate/execution`), `world.snapshot`,
  `filesystem.*` containment, `run.start`.
- **Policy / authority:** capability grant is explicit (kernel `Policy`, default-deny);
  containment = execution-world root (`PathEscapeError` outside); ActionPolicy `run.start`.
  This is `gsterm::machine_authority_is_explicit`.
- **Artifacts / resources:** Resource `Execution` (flow J2); output visible to the caller only
  through the run/caller tenancy.
- **Outcomes:** run `completed` with structured output; same event types as J1 with
  `source: "ui" | "webmcp"` — metadata, not a separate ontology.
- **Evidence sources:** recorded `process.exec` result (step), snapshots (steps), effect
  provenance.
- **Settlement criteria:** run terminal AND `execution.completed` + `effect.observed` committed
  AND projection `executions` contains the entry AND effects match a J1-equivalent observation
  for an equivalent command.
- **Failure / recovery:** policy denial → run fails with invocation failure recorded (no side
  effects claimed); timeout via `ExecSpec.timeoutMs` (`timedOut` is evidence, not assumption);
  caller cancellation → run cancelled, process terminated.
- **Next decisions / affordances:** inspect (J5), repeat, or observe future effects (J3).
- **Known variants:** J2-W WebMCP specialization; future worlds (ssh/wsl/browser) are provider
  swaps on the same capability — catalogued seam, not implemented.

## J3 — world-state-reconciliation

- **Purpose:** The world view (cwd, repository, processes, ports) is derived from observed facts
  at settlement points, honestly marking unknown.
- **Actor / role:** Observer (mechanism) bridged into Cognate; triggered by J1/J2 settlement and
  by attach (J4).
- **Initiating condition:** an execution settled, or a session attach/refresh occurred.
- **Current state:** world state possibly stale.
- **Desired state:** world state = fold of latest observations, each provenance-tagged.
- **Preconditions:** observers available (fs walk, git CLI, /proc, `ss`); workspace root set.
- **Steps:**
  1. take snapshot (`world.snapshot` = fs + git + processes + ports in one coherent call);
  2. compute derived view: `repository.status ∈ {observed, no-repo, unknown}` — never false when
     unobserved;
  3. `updateSharedState("world:<session>", patch, idempotencyKey, expectedVersion)`;
  4. readers (cockpit J5) observe the versioned state; event stream carries `state.changed`.
- **Capabilities / actions:** `world.snapshot`; `thread.state.update` / `thread.state.read`.
- **Policy / authority:** caller authorization on the thread; snapshot values safe for durable
  state (no credentials).
- **Outcomes:** durable, versioned world state; restart-safe.
- **Evidence sources:** each snapshot field carries `observedAt` + method; ports/processes
  carry session-tree scoping where reasonably possible.
- **Settlement criteria:** shared-state version advanced; state readable after restart.
- **Failure / recovery:** observer failure → field set to `unknown` (with reason), previous
  observed value retained where useful — never silently "false".
- **Next decisions / affordances:** J5 inspection.
- **Known variants:** explicit refresh action (same journey, no settlement trigger).

## J4 — terminal-session-attach

- **Purpose:** The operator attaches or reconnects to the live PTY session; the terminal keeps
  working across disconnects; world continuity is preserved.
- **Actor / role:** Operator / Terminal Operator.
- **Initiating condition:** cockpit opened, or WebSocket dropped and reopened.
- **Current state:** session may or may not exist; scrollback bounded in memory.
- **Desired state:** viewer attached; stream flowing; resize honored; shell state intact.
- **Preconditions:** server alive; session manager holds one durable session per workspace (v0).
- **Steps:**
  1. client opens WS `/ws`; server sends session info (id, cols/rows, exit state);
  2. server replays bounded scrollback ring, then live bytes (binary frames; control in JSON);
  3. client fit-addon resize → control resize → `Bun.Terminal.resize` (verified via `stty size`);
  4. shell integration continues emitting markers regardless of viewer count;
  5. on PTY exit: server sends exit control; viewers informed; session marked dead (no respawn
     in v0 — explicit, visible, not hidden).
- **Capabilities / actions:** none (mechanism-only journey); triggers J3 on attach.
- **Settlement criteria:** bytes observed after attach; scrollback replay bounded; resize
  verified in-shell; disconnect does not kill the session; reconnect resumes.
- **Failure / recovery:** WS drop → session survives (acceptance: reconnect); PTY exit → visible
  terminal state (no fake shell); server shutdown → PTY + sockets closed deterministically.
- **Next decisions / affordances:** type (J1), inspect (J5).

## J5 — cockpit-inspection

- **Purpose:** The operator inspects world state, execution history with effects/evidence, and
  the semantic event timeline — the read side of the whole model.
- **Actor / role:** Operator / Cockpit Reader (surface: cockpit; also any client of
  `RuntimeService` reads — same projection, same tenant rules).
- **Initiating condition:** cockpit opened or state changed (live event follow).
- **Current state:** durable events + shared state + projection exist.
- **Desired state:** view consistent with durable truth; unknown rendered as unknown.
- **Steps:**
  1. `readSharedState("world:<session>")` → world panel;
  2. `readProjection("executions")` → execution history; `getRun` + `events({runId})` →
     inspector detail (effects, evidence, causal events);
  3. `events({follow: true})` → timeline (semantic events only — PTY bytes never appear);
  4. selection state is UI-local (projection of underlying state, never authoritative).
- **Policy / authority:** tenant-scoped reads; projection public flag; tenancy implicit.
- **Settlement criteria:** every displayed fact traceable to an event/state version; restart
  keeps history (acceptance G).
- **Known variants:** execution-history filter by `source` (metadata facet).

---

## Deferred journeys (catalogued seams — NOT implemented in this slice)

| id | journey | seam preserved by |
|---|---|---|
| D1 | migrate execution to ssh/wsl/browser world | `ExecutionWorldProvider` registry; capability unchanged |
| D2 | WebMCP capability *consumption* (external tab offers → Cognate) | Cognate `RemoteCapabilityOffer` interface + arch test; no tab control |
| D3 | checkpoint / world branching | append-only events + fold projections (no irreversible assumptions) |
| D4 | human approval / continuation gates | Cognate continuations (not used beyond what J1/J2 need) |
| D5 | collaboration / multi-viewer sessions | session manager already allows N viewers on one PTY |

Any implementation of a deferred journey must first be added to this catalog (skill rule).


