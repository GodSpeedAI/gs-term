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
bun run test        # unit + journey + conformance + architecture (130+ tests)
bun run e2e         # Playwright acceptance sequence A–G + Phase 2/3 (chromium)
bun run doctor      # mechanism readiness (--probe starts managed processes;
                    #  --require-semantic fails unless the semantic substrate is fully ready)
bash scripts/verify-all.sh [--node-free] [--release]
bun run verify      # typecheck + lint + test + e2e
```

Two validation levels. **Developer**: `bun test` may skip semantic proofs honestly on an
unbootstrapped checkout. **Release oracle** (`--release`, devbox: `devbox run verify-release`):
node-free, `GSTERM_REQUIRE_SEMANTIC=1` makes any semantic skip a failure,
`doctor --require-semantic` must pass — a green release job means the semantic substrate
actually ran. The same oracle runs on a fresh GitHub runner (`.github/workflows/verify.yml`):
Devbox toolchain → `devbox run bootstrap` (self-contained) → `devbox run verify-release`.

With the full toolchain, `devbox run bootstrap` provisions everything (pinned bun 1.4.x,
Rust 1.98.0 helper, SolidLSP uv env). Devbox is the reproducibility oracle, NOT a product
requirement.

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

- **Two semantic doors, one world.** An **action/run** (`agent.execute`, `agent.observe`) is intent:
  something was requested and executed. An **observation** (`RuntimeService.observe`) is a fact
  noticed about reality — a file appeared, a port opened — recorded as a run-less `observation.recorded`
  event with `source:"observation"` provenance, never as a fake action. The bridge (the only module
  that knows both layers) settles shell commands as runs and reconciles discovered world facts as
  observations. Attribution is explicit: `correlated`/`caused`/`unattributed`, with `causationId` set
  only when a cause is established (unknown causation stays null).

  ```
       INTENT ─► Cognate action/run ─► execution ──(correlation)──┐
                                                                  ▼
  REALITY ──► OBSERVATION ──► evidence/provenance ──► effects / world state
  ```
- **Structured execution = `@cognate/execution`** — `process.exec` + `filesystem.*` over an
  `ExecutionWorldProvider` registry (local + ssh worlds now; wsl provider is a drop-in later).
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

## Execution worlds (Phase 2 invariant)

> A semantic capability describes **what** is being done; the execution world/provider determines
> **where** it happens.

```
                SAME CAPABILITY: process.exec
                          │
              execution-world resolution (worldId)
                    /                \
             local provider      ssh provider
                    │                │
              local process     remote process (ssh2)
                    \                /
             SAME execution · effect · evidence model
             (world/provider/host provenance differs — never normalized away)
```

- **No `ssh.*` semantics anywhere.** `worldId` is an *input property* of `agent.execute`,
  `process.exec`, `world.snapshot`, and the WebMCP `execute_command` tool (an architecture test
  forbids provider references in the semantic layer).
- **Providers** are Cognate `ExecutionWorldProvider`s registered in ONE registry
  (`src/app/worlds.ts` is the only place provider mechanics live): `localExecutionWorld`
  (root-contained) and `sshExecutionWorld` (SFTP fs + remote exec, mandatory host-key pinning,
  ProxyJump-capable, fail-closed — `@cognate/execution-ssh`). WSL is a later drop-in.
- **Resource identity = `(worldId, path)`** — `semantic-world-proof.txt` in `local` and in
  `ssh-test` are different resources; effects and evidence carry the world.
- **Remote effects are evidence-backed**: snapshots before/after the execution through the
  world's own ports (SFTP walk + remote git), deriving `file.created` with remote provenance —
  exit code 0 is never treated as proof of side effects.
- **Authority:** capability grants are explicit (kernel policy); **world registration is the
  grant boundary** — unregistered worlds fail closed (`WorldUnavailableError`), and SSH
  credentials stay provider-side (agent/key-path/password-env references; `metadata` exposes
  only the auth *kind* + host-key fingerprint). Per-world policy is a known gap (DEBT D-002).

### SSH world configuration (`gsterm.toml`)

```toml
[worlds.ssh-test]
kind = "ssh"
display = "SSH test box"
host = "127.0.0.1"
port = 2222
username = "tester"
root = "/home/tester/gs-workspace"
auth = "agent"                            # or "key:~/.ssh/id_ed25519" / "password-env:MY_VAR"
host_key_fingerprints = ["SHA256:..."]    # pin the host key (required) …
host_keys_file = "~/.ssh/known_hosts"     # … and/or a known_hosts file
```

To run the same-capability proof against a **real** SSH host: configure a world as above, then
`bun run dev`, pick the world in the cockpit selector, and run
`sh -lc "printf hello > semantic-world-proof.txt"` in both worlds from the structured runner
(or the WebMCP `execute_command` tool with `worldId`). The inspector shows which world handled
each execution; effects carry per-world provenance.

## Focus Engine & Syntelligent Search (Phase 3)

The cockpit deterministically reduces the computational world around the goal and current
attention — no LLM. The loop:

```
user goal + human attention + accepted SharedFocus + current world + observed reality
        → Focus Engine (deterministic) → smallest useful working set + affordances
        → human/agent action → effects + observations + evidence → recompute
```

- **Attention is distinct from focus.** `HumanAttention`/`AgentAttention` are transient; an
  `AttentionSnapshot` is frozen when `/` opens so a referent ("this", "that") never silently mutates
  (deterministic precedence, semantic entity identity — never DOM paths).
- **SharedFocus is human-governed.** An agent may only propose `FocusCandidate`s (action); Accept /
  Pin / Reject are human-only intentional transitions, enforced through Cognate's `ActionPolicy`
  (`gsterm::human_governs_shared_focus`) — not UI convention.
- **Syntelligent Search** (`focus.search`) is the deterministic narrowing entry point: exact `rg`,
  structural map, semantic where available — always world-local, always bounded, with an inspectable
  reduction receipt (`Why these?`). It never silently crosses worlds; unavailable mechanisms are
  reported truthfully (D-010 honesty).
- **Structural map** = the minimal deterministic graph (Graft-donor tier): typed edges from evidence,
  `contains` for hierarchy, explicit freshness — no LLM summaries.
- **Mechanisms (Phase 3.5 — mounted for real)**: `rg` (exact, real); `structural-map`
  (deterministic, now SolidLSP-enriched with `defines`/`references` provenance); a **Rust helper**
  (`rust/crates/gsterm-semantic`) hosting the **zvec-grep engine** (hybrid FTS+vector source
  retrieval, `local/potion-code-16m-v2` embeddings), a **zvec concept store** (gs-term's own
  concept objects — never source chunks; explicit links stay authoritative), and **SolidLSP**
  (the MIT `serena-agent==1.7.0` package under uv; typescript-language-server runs ON BUN via a
  node→bun shim — no Node in the runtime graph). Remote worlds report these honestly unavailable;
  local results are never silently substituted.
- **Routing is reduction**: known symbol → SolidLSP directly; exact identifier → rg; natural
  language → concepts → structural scope → zvec-grep → snippet verification → SolidLSP;
  architecture/domain questions → concepts + scope and STOP. Receipts record only stages that ran.
- **Precise code capabilities** (`code.definition/references/implementations/diagnostics`) are
  Cognate capabilities bound to `controlplane::Code Symbol`/`Diagnostic`, projected to WebMCP
  (`code_references`, `code_definition`, `code_diagnostics`) through the same descriptors.
- **`gs-term doctor`** reports honest per-mechanism readiness (Bun, PTY, rg, zvec-grep Rust,
  zvec, Potion model, SolidLSP, Python/uv, TypeScript server, SSH) and ends with
  `Node: not required` — an architectural statement, enforced by `scripts/verify-all.sh --node-free`.
- **WebMCP** projects the same Focus Engine (`focus_search`, `focus_inspect`,
  `focus_propose_candidate`); human resolution is deliberately NOT a WebMCP tool (the agent cannot
  self-accept).
- **Effect→observation fan-out** (bounded/idempotent) lets high-value derived effects become Focus
  evidence through the Cognate observation door (Phase-2.5 primitive).

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
- Remote (SSH) worlds observe files + git through the provider ports; remote processes/ports are
  honestly `unknown` (session-tree attribution is a local-PTY concept) — DEBT D-010.
- Local `exec` timeout/abort kills the spawned process but not its process group (grandchildren
  can hold stdio pipes) while the SSH supervisor kills the group — DEBT D-031.
- SSH worlds are explicit config; `~/.ssh/config` aliases are not resolved (DEBT D-009).
- The dev-token authenticator is a development boundary, not production auth.

Known debt is tracked durably in [`.agents/DEBT.md`](.agents/DEBT.md) (30+ items with owners and
statuses). The observation-ingest gap (D-001) was validated and **resolved** in Phase 2.5 with a
first-class Cognate `RuntimeService.observe` primitive; the per-world policy gap (D-002) remains an
upstream candidate.

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
`cloudflare/sandbox-sdk` (provider-boundary shape only). Phase 3.5 recon used
`zvec-ai/zvec-grep` @ `28ef200` (engine API + model2vec port; the engine itself is a pinned
cargo **git dependency**, not a fork) and the PyPI `serena-agent==1.7.0` metadata (license
audit: fully MIT at that exact release; upstream main later relicensed the Serena app to GPL —
do not track main).

